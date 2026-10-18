"""Trains the public safety risk model on LAPD crime and traffic collision records.

For every ~100 m location (cell: lat/lng rounded to 3 decimals) the model answers: given the
incidents there as of a date T, will a violent crime or an injury collision happen in that
cell within the next 90 days? (Any crime or collision at all is near-certain on LA's busiest
blocks, so that target only ranked locations by volume.)

Training rows are quarterly snapshots (location, T) for every location with at least one
incident in the year before T. Features only use data from before T, the target only data
from [T, T+90d), and the holdout uses later snapshots than training, so the reported
metrics reflect forecasting the future, not memorizing it.

Usage (from server/):
    .venv/bin/python scripts/train_model.py
    .venv/bin/python scripts/train_model.py --crime "data/Crime_Data_*.csv" --collisions "data/Traffic_Collision_*.csv"

Writes:
    models/degradation_model.joblib   trained classifier (file name kept so the server's loader is unchanged)
    models/cell_stats.joblib          per-location and per-LAPD-area features as of the end of the data (for inference)
    models/model_metadata.json        features, metrics, risk thresholds
    data/aggregated_risk_map.json     top high-risk locations per LAPD area for the dashboard map
"""

import argparse
import glob
import json
import os
import sys
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_score, recall_score, roc_auc_score

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(SERVER_DIR, 'data')
MODELS_DIR = os.path.join(SERVER_DIR, 'models')

CRIME_COLUMNS = ['DR_NO', 'DATE OCC', 'TIME OCC', 'AREA NAME', 'Crm Cd', 'Weapon Used Cd', 'LOCATION', 'Cross Street', 'LAT', 'LON']
COLLISION_COLUMNS = ['DR Number', 'Date Occurred', 'Time Occurred', 'Area Name', 'MO Codes', 'Address', 'Cross Street', 'Location']
# Violent crime: homicide, rape / sexual assault, robbery, aggravated assault, shots fired, brandishing, kidnapping.
VIOLENT_CRIME_CODES = {
    '110', '113', '121', '122', '815', '820', '821', '210', '220', '230', '231', '235', '236',
    '250', '251', '753', '761', '910', '920',
}
# LAPD collision MO codes: 3027 fatal, 3024 severe, 3025 visible injury (3026 complaint of pain and
# 3028 no injury are left out: pain-only reports are common and minor).
INJURY_MO_CODES = {'3024', '3025', '3027'}
CRIME_DATE_FORMAT = '%Y %b %d %I:%M:%S %p'
COLLISION_DATE_FORMAT = '%m/%d/%Y'
# Los Angeles bounding box; drops (0, 0) and mis-geocoded rows.
LAT_RANGE, LNG_RANGE = (33.6, 34.4), (-118.7, -118.1)
# Crime data starts in 2020; collisions go back to 2010 but only the overlap is used.
START = pd.Timestamp('2020-01-01')
# A month counts as fully reported at this share of the median month. Strict on purpose: LAPD's
# crime export halves after Q1 2024 (new reporting system), which must not read as "fewer incidents".
FULL_MONTH_SHARE = 0.75

FEATURES = [
    'crime_count_365d', 'collision_count_365d', 'violent_count_365d', 'injury_collision_count_365d',
    'recent_incidents_90d', 'days_since_last_incident', 'days_since_last_serious',
    'weapon_share_365d', 'night_share_365d', 'area_incidents_per_cell_365d',
]
NO_SERIOUS_DAYS = 400  # "never in the lookback year": longer than any real gap, so the trees can split on it
HORIZON = pd.Timedelta(days=90)
LOOKBACK = pd.Timedelta(days=365)
RECENT_WINDOW = pd.Timedelta(days=90)
CHUNK_ROWS = 500_000
# Map pins: the riskiest HIGH-tier locations in each LAPD area, so the map covers the whole city
# instead of only the few busiest blocks (whose risk is near-certain and says little).
HOTSPOTS_PER_AREA = 7


def log(msg):
    print(msg, flush=True)


def input_files(pattern, default):
    pattern = pattern or default
    files = sorted(glob.glob(pattern if os.path.isabs(pattern) else os.path.join(SERVER_DIR, pattern)))
    if not files:
        sys.exit(f'No input CSVs found for {pattern}.')
    return files


def read_chunks(path, columns):
    started, parts = time.time(), []
    for chunk in pd.read_csv(path, usecols=columns, dtype=str, chunksize=CHUNK_ROWS):
        parts.append(chunk)
    df = pd.concat(parts, ignore_index=True)
    log(f'  {os.path.basename(path)}: {len(df):,} rows ({time.time() - started:.0f}s)')
    return df


def squash(s):
    return s.fillna('').str.replace(r'\s+', ' ', regex=True).str.strip()


def clean_text(s):
    """'7800    BEEMAN    AV' -> '7800 Beeman Av'; '246TH ST' -> '246th St' (title() would give '246Th')."""
    return squash(s).str.title().str.replace(r'(\d)(St|Nd|Rd|Th)\b', lambda m: m.group(1) + m.group(2).lower(), regex=True)


def night_flag(times):
    """20:00-05:59 from 'HHMM' strings."""
    hour = pd.to_numeric(times.fillna('').str.zfill(4).str[:2], errors='coerce')
    return ((hour >= 20) | (hour < 6)).fillna(False)


def label(street, cross):
    return np.where(cross != '', street + ' & ' + cross, street)


def load_crimes(files):
    df = pd.concat([read_chunks(f, CRIME_COLUMNS) for f in files], ignore_index=True).drop_duplicates('DR_NO', keep='last')
    out = pd.DataFrame({
        'date': pd.to_datetime(df['DATE OCC'], format=CRIME_DATE_FORMAT, errors='coerce'),
        'lat': pd.to_numeric(df['LAT'], errors='coerce'),
        'lng': pd.to_numeric(df['LON'], errors='coerce'),
        'source': 'crime',
        'serious': df['Crm Cd'].fillna('').str.strip().isin(VIOLENT_CRIME_CODES),
        'weapon': df['Weapon Used Cd'].fillna('').str.strip() != '',
        'night': night_flag(df['TIME OCC']),
        'street': label(clean_text(df['LOCATION']), clean_text(df['Cross Street'])),
        'area': squash(df['AREA NAME']),  # LAPD's own spelling, e.g. '77th Street', 'West LA'
    })
    return out


def load_collisions(files):
    df = pd.concat([read_chunks(f, COLLISION_COLUMNS) for f in files], ignore_index=True).drop_duplicates('DR Number', keep='last')
    coords = df['Location'].fillna('').str.extract(r'\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)')
    out = pd.DataFrame({
        'date': pd.to_datetime(df['Date Occurred'], format=COLLISION_DATE_FORMAT, errors='coerce'),
        'lat': pd.to_numeric(coords[0], errors='coerce'),
        'lng': pd.to_numeric(coords[1], errors='coerce'),
        'source': 'collision',
        'serious': df['MO Codes'].fillna('').str.split().apply(lambda codes: not INJURY_MO_CODES.isdisjoint(codes)),
        'weapon': False,
        'night': night_flag(df['Time Occurred']),
        'street': label(clean_text(df['Address']), clean_text(df['Cross Street'])),
        'area': squash(df['Area Name']),
    })
    return out


def effective_end(dates):
    """Last day of the last fully reported month (exports trail off, and LAPD crime halves after Q1 2024)."""
    monthly = dates.groupby(dates.dt.to_period('M')).size()
    full = monthly[monthly >= FULL_MONTH_SHARE * monthly.median()]
    return full.index.max().to_timestamp(how='end').normalize()


def mode_by_cell(df, column):
    """Most common value of `column` per cell (fast: one count, then the top row per cell)."""
    counts = df[df[column] != ''].groupby(['cell', column]).size().reset_index(name='n')
    return counts.sort_values('n').drop_duplicates('cell', keep='last').set_index('cell')[column]


def features_at(df, T, area_of_cell):
    """Per-cell features using only incidents in the year before T (cells with at least one)."""
    window = df[(df['date'] < T) & (df['date'] >= T - LOOKBACK)]
    if window.empty:
        return pd.DataFrame(columns=FEATURES)
    by_cell = window.groupby('cell')
    out = pd.DataFrame(index=by_cell.size().index)
    crimes = window[window['source'] == 'crime']
    out['crime_count_365d'] = crimes.groupby('cell').size().reindex(out.index, fill_value=0)
    out['collision_count_365d'] = window[window['source'] == 'collision'].groupby('cell').size().reindex(out.index, fill_value=0)
    out['recent_incidents_90d'] = window[window['date'] >= T - RECENT_WINDOW].groupby('cell').size().reindex(out.index, fill_value=0)
    out['days_since_last_incident'] = (T - by_cell['date'].max()).dt.days
    serious = window[window['serious']]
    out['violent_count_365d'] = serious[serious['source'] == 'crime'].groupby('cell').size().reindex(out.index, fill_value=0)
    out['injury_collision_count_365d'] = serious[serious['source'] == 'collision'].groupby('cell').size().reindex(out.index, fill_value=0)
    out['days_since_last_serious'] = (T - serious.groupby('cell')['date'].max()).dt.days.reindex(out.index).fillna(NO_SERIOUS_DAYS)
    out['weapon_share_365d'] = crimes.groupby('cell')['weapon'].mean().reindex(out.index).fillna(0.0)
    out['night_share_365d'] = by_cell['night'].mean()

    # Neighborhood context: average incidents per active location in the cell's LAPD area.
    area = area_of_cell.reindex(out.index).fillna('')
    totals = out['crime_count_365d'] + out['collision_count_365d']
    per_cell = totals.groupby(area).mean()
    out['area_incidents_per_cell_365d'] = area.map(per_cell).fillna(totals.mean())
    return out[FEATURES].astype(float)


def build_snapshots(features_fn, events, first_date, as_of, target, what):
    """Quarterly (location, T) rows: features from before T, target = an `events` row in the cell within 90 days."""
    start = first_date + LOOKBACK  # full lookback window for every snapshot
    end = as_of - HORIZON  # full 90-day outcome window
    dates = pd.date_range(start.normalize(), end, freq='QS')
    if len(dates) < 6:
        sys.exit(f'Not enough history for quarterly snapshots: data covers {first_date.date()} to {as_of.date()}.')
    frames = []
    for T in dates:
        feats = features_fn(T)
        future = events[(events['date'] >= T) & (events['date'] < T + HORIZON)]['cell'].unique()
        feats[target] = feats.index.isin(future).astype(int)
        feats['snapshot'] = T
        frames.append(feats)
        log(f'  {T.date()}: {len(feats):,} locations, {feats[target].mean():.1%} had {what} within 90 days')
    return pd.concat(frames)


def make_model():
    try:
        from xgboost import XGBClassifier

        model = XGBClassifier(
            n_estimators=400, max_depth=5, learning_rate=0.05, subsample=0.8, colsample_bytree=0.9,
            eval_metric='auc', n_jobs=-1, tree_method='hist',
        )
        return model, 'XGBClassifier'
    except Exception as err:  # noqa: BLE001 - xgboost missing or its OpenMP runtime (libomp) not installed
        from sklearn.ensemble import HistGradientBoostingClassifier

        log(f'  XGBoost unavailable ({str(err).splitlines()[0][:80]}...); using scikit-learn HistGradientBoostingClassifier.')
        return HistGradientBoostingClassifier(max_iter=400, max_depth=5, learning_rate=0.05, random_state=42), 'HistGradientBoostingClassifier'


def fit_with_holdout(snaps, features, target):
    """Scores a model on the last 4 quarters, then refits on everything for deployment.
    Returns (model, model_type, metrics, high_cut, medium_cut) with cuts as probabilities."""
    # Time-based split: the last 4 snapshots are the holdout; training snapshots end before their outcomes overlap.
    test_dates = sorted(snaps['snapshot'].unique())[-4:]
    test = snaps[snaps['snapshot'].isin(test_dates)]
    train = snaps[snaps['snapshot'] + HORIZON <= test_dates[0]]
    log(f'\nTrain: {len(train):,} rows ({train["snapshot"].min().date()} to {train["snapshot"].max().date()}), '
        f'test: {len(test):,} rows ({test["snapshot"].min().date()} to {test["snapshot"].max().date()})')

    model, model_type = make_model()
    model.fit(train[features], train[target])
    test_prob = model.predict_proba(test[features])[:, 1]
    y = test[target].to_numpy()

    # Risk levels by score percentile on the holdout: top 10% HIGH, next 20% MEDIUM.
    high_cut, medium_cut = float(np.quantile(test_prob, 0.90)), float(np.quantile(test_prob, 0.70))
    def at(threshold):
        pred = (test_prob >= threshold).astype(int)
        return {'threshold': round(threshold * 100, 1), 'precision': round(float(precision_score(y, pred, zero_division=0)), 3),
                'recall': round(float(recall_score(y, pred, zero_division=0)), 3)}
    metrics = {
        'auc_roc': round(float(roc_auc_score(y, test_prob)), 4),
        'average_precision': round(float(average_precision_score(y, test_prob)), 4),
        'base_rate': round(float(y.mean()), 4),
        'high': at(high_cut),
        'medium_or_high': at(medium_cut),
        'train_rows': int(len(train)),
        'test_rows': int(len(test)),
    }

    log('\n=== Holdout performance (later quarters than any training data) ===')
    log(f'  Model:             {model_type}')
    log(f'  AUC-ROC:           {metrics["auc_roc"]:.3f}')
    log(f'  Average precision: {metrics["average_precision"]:.3f}   (base rate {metrics["base_rate"]:.1%})')
    log(f'  HIGH   (score >= {metrics["high"]["threshold"]:.1f}):   precision {metrics["high"]["precision"]:.1%}, recall {metrics["high"]["recall"]:.1%}')
    log(f'  MEDIUM+ (score >= {metrics["medium_or_high"]["threshold"]:.1f}): precision {metrics["medium_or_high"]["precision"]:.1%}, recall {metrics["medium_or_high"]["recall"]:.1%}')

    # Refit on every snapshot for deployment; the holdout numbers above describe this setup.
    log('\nRefitting on all snapshots...')
    model, _ = make_model()
    model.fit(snaps[features], snaps[target])
    return model, model_type, metrics, high_cut, medium_cut


def top_per_area(cells, model, features, high_cut, active_col):
    """Current risk at every active location; the riskiest HIGH-tier ones in each LAPD area."""
    scored = cells.dropna(subset=[active_col]).copy()
    scored['score'] = model.predict_proba(scored[features])[:, 1] * 100
    high = scored[scored['score'] >= high_cut * 100].sort_values('score', ascending=False)
    return high.groupby('area', sort=False).head(HOTSPOTS_PER_AREA).sort_values('score', ascending=False)


def location_table(df, area_of_cell):
    cells = df.groupby('cell').agg(lat=('cell_lat', 'first'), lng=('cell_lng', 'first'))
    cells['street'] = mode_by_cell(df, 'street').reindex(cells.index).fillna('')
    cells['area'] = area_of_cell.reindex(cells.index).fillna('')
    return cells


def write_json(path, data, indent=1):
    with open(path, 'w') as f:
        json.dump(data, f, indent=indent)


def train_safety(df, area_of_cell, as_of, sources):
    log('\nBuilding quarterly snapshots (features from the year before T, outcome in the 90 days after)...')
    snaps = build_snapshots(lambda T: features_at(df, T, area_of_cell), df[df['serious']], df['date'].min(), as_of,
                            'serious_incident_90d', 'a violent crime or injury collision')
    model, model_type, metrics, high_cut, medium_cut = fit_with_holdout(snaps, FEATURES, 'serious_incident_90d')

    # Inference lookup: every location's features as of the end of the data.
    cells = location_table(df, area_of_cell).join(features_at(df, as_of + pd.Timedelta(days=1), area_of_cell), how='left')
    areas = cells[cells['area'] != ''].dropna(subset=['days_since_last_incident']).groupby('area')[FEATURES].mean()
    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(model, os.path.join(MODELS_DIR, 'degradation_model.joblib'))
    joblib.dump({'cells': cells, 'areas': areas}, os.path.join(MODELS_DIR, 'cell_stats.joblib'))

    metadata = {
        'model_type': model_type,
        'trained_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'data_as_of': as_of.date().isoformat(),
        'data_from': df['date'].min().date().isoformat(),
        'source_files': [os.path.basename(f) for f in sources],
        'target': 'serious_incident_90d: a violent crime or an injury collision (fatal, severe or visible injury) in the same ~100 m cell within 90 days',
        'violent_crime_codes': sorted(VIOLENT_CRIME_CODES),
        'injury_mo_codes': sorted(INJURY_MO_CODES),
        'cell': 'lat/lng rounded to 3 decimals (~111 m x 92 m)',
        'features': FEATURES,
        'feature_reference': {f: round(float(snaps[f].median()), 3) for f in FEATURES},  # medians, used to explain which inputs raise the risk
        'risk_thresholds': {'HIGH': round(high_cut * 100, 1), 'MEDIUM': round(medium_cut * 100, 1)},
        'recommended_actions': {
            'HIGH': 'Prioritize for patrol presence and a traffic-safety review within 14 days',
            'MEDIUM': 'Include in the next routine patrol and street-safety cycle (within 45 days)',
            'LOW': 'No action needed; continue monitoring',
        },
        'metrics': metrics,
    }
    write_json(os.path.join(MODELS_DIR, 'model_metadata.json'), metadata, indent=2)

    top = top_per_area(cells, model, FEATURES, high_cut, 'days_since_last_incident')
    hotspots = [
        {
            'id': cell, 'lat': float(r.lat), 'lng': float(r.lng), 'label': r.street or 'Unnamed street', 'area': r.area,
            'score': round(float(r.score), 1), 'risk_level': 'HIGH',
            'crimes_365d': int(r.crime_count_365d), 'collisions_365d': int(r.collision_count_365d),
            'violent_365d': int(r.violent_count_365d), 'injury_collisions_365d': int(r.injury_collision_count_365d),
            'recent_incidents_90d': int(r.recent_incidents_90d), 'days_since_last_incident': int(r.days_since_last_incident),
        }
        for cell, r in top.iterrows()
    ]
    write_json(os.path.join(DATA_DIR, 'aggregated_risk_map.json'), {
        'generated_at': metadata['trained_at'], 'data_as_of': metadata['data_as_of'], 'model_type': model_type,
        'target': metadata['target'], 'risk_thresholds': metadata['risk_thresholds'], 'hotspots': hotspots,
    })
    log(f'\nSaved models/degradation_model.joblib, models/cell_stats.joblib ({len(cells):,} locations, {len(areas):,} areas), '
        f'models/model_metadata.json and data/aggregated_risk_map.json ({len(hotspots)} hotspots).')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--crime', help='Crime CSV path or glob, relative to server/ (default: data/Crime_Data_*.csv)')
    parser.add_argument('--collisions', help='Collision CSV path or glob, relative to server/ (default: data/Traffic_Collision_*.csv)')
    args = parser.parse_args()

    crime_files = input_files(args.crime, os.path.join('data', 'Crime_Data_*.csv'))
    collision_files = input_files(args.collisions, os.path.join('data', 'Traffic_Collision_*.csv'))
    log(f'Reading {len(crime_files) + len(collision_files)} file(s)...')
    df = pd.concat([load_crimes(crime_files), load_collisions(collision_files)], ignore_index=True)
    df = df[df['date'].notna() & (df['date'] >= START) & df['lat'].between(*LAT_RANGE) & df['lng'].between(*LNG_RANGE)].copy()
    df['cell_lat'] = df['lat'].round(3)
    df['cell_lng'] = df['lng'].round(3)
    df['cell'] = df['cell_lat'].map('{:.3f}'.format) + ',' + df['cell_lng'].map('{:.3f}'.format)
    area_of_cell = mode_by_cell(df, 'area')

    ends = {source: effective_end(group['date']) for source, group in df.groupby('source')}
    as_of = min(ends.values())
    log('Fully reported through: ' + ', '.join(f'{s} {d.date()}' for s, d in ends.items()) + f' -> using data up to {as_of.date()}')
    df = df[df['date'] <= as_of]
    counts = df['source'].value_counts()
    log(f'{len(df):,} incidents ({counts.get("crime", 0):,} crimes, {counts.get("collision", 0):,} collisions), '
        f'{df["cell"].nunique():,} locations, {df["date"].min().date()} to {as_of.date()}')

    train_safety(df, area_of_cell, as_of, crime_files + collision_files)


if __name__ == '__main__':
    main()
