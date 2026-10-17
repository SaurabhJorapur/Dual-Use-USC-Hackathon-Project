"""Trains the predictive asset degradation model on MyLA311 streetlight requests.

A streetlight repair "fails again" when a new streetlight request is filed at the same
location (~100 m cell: lat/lng rounded to 3 decimals) after it was repaired. The model
answers: given a location's repair history as of a date T, will it get another
streetlight complaint within the next 90 days?

Training rows are quarterly snapshots (location, T) for every location with at least one
completed repair before T. Features only use data from before T, the target only data
from [T, T+90d), and the holdout uses later snapshots than training, so the reported
metrics reflect forecasting the future, not memorizing it.

Usage (from server/):
    .venv/bin/python scripts/train_model.py                 # server/data/raw_data.csv, or every MyLA311-*.csv
    .venv/bin/python scripts/train_model.py --input "data/MyLA311-*2024*.csv"

Writes:
    models/degradation_model.joblib   trained classifier
    models/cell_stats.joblib          per-location and per-zip features as of the end of the data (for inference)
    models/model_metadata.json        features, metrics, risk thresholds
    data/aggregated_risk_map.json     top high-risk locations for the dashboard map
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

STREETLIGHT_TYPES = {'Single Streetlight Issue': 0, 'Multiple Streetlight Issue': 1}
PATCH_TYPES = {v: k for k, v in STREETLIGHT_TYPES.items()}
COLUMNS = ['SRNumber', 'CreatedDate', 'ClosedDate', 'RequestType', 'ZipCode', 'Latitude', 'Longitude', 'StreetName', 'Suffix']
DATE_FORMAT = '%m/%d/%Y %I:%M:%S %p'
# Los Angeles bounding box; drops (0, 0) and mis-geocoded rows.
LAT_RANGE, LNG_RANGE = (33.6, 34.4), (-118.7, -118.1)

FEATURES = ['days_since_last_patch', 'past_311_density', 'recent_311_density_365d', 'avg_resolution_days', 'patch_type_code']
HORIZON = pd.Timedelta(days=90)
DENSITY_WINDOW = pd.Timedelta(days=730)
RECENT_WINDOW = pd.Timedelta(days=365)
CHUNK_ROWS = 500_000
TOP_HOTSPOTS = 200


def log(msg):
    print(msg, flush=True)


def input_files(pattern):
    if pattern:
        files = sorted(glob.glob(pattern if os.path.isabs(pattern) else os.path.join(SERVER_DIR, pattern)))
    else:
        raw = os.path.join(DATA_DIR, 'raw_data.csv')
        files = [raw] if os.path.exists(raw) else sorted(glob.glob(os.path.join(DATA_DIR, 'MyLA311-*.csv')))
    if not files:
        sys.exit(f'No input CSVs found (looked for {pattern or "data/raw_data.csv or data/MyLA311-*.csv"}).')
    return files


def load_requests(files):
    """Streams the CSVs in chunks, keeping only geolocated streetlight requests."""
    parts = []
    for path in files:
        started, kept, seen = time.time(), 0, 0
        for chunk in pd.read_csv(path, usecols=COLUMNS, dtype=str, chunksize=CHUNK_ROWS):
            seen += len(chunk)
            chunk = chunk[chunk['RequestType'].isin(STREETLIGHT_TYPES.keys())]
            kept += len(chunk)
            parts.append(chunk)
        log(f'  {os.path.basename(path)}: {seen:,} rows, {kept:,} streetlight requests ({time.time() - started:.0f}s)')

    df = pd.concat(parts, ignore_index=True).drop_duplicates('SRNumber', keep='last')
    df['created'] = pd.to_datetime(df['CreatedDate'], format=DATE_FORMAT, errors='coerce')
    df['closed'] = pd.to_datetime(df['ClosedDate'], format=DATE_FORMAT, errors='coerce')
    df['lat'] = pd.to_numeric(df['Latitude'], errors='coerce')
    df['lng'] = pd.to_numeric(df['Longitude'], errors='coerce')
    df = df[df['created'].notna() & df['lat'].between(*LAT_RANGE) & df['lng'].between(*LNG_RANGE)].copy()
    # A close before the request was created is a data error; treat the request as never closed.
    df.loc[df['closed'] < df['created'], 'closed'] = pd.NaT

    df['cell_lat'] = df['lat'].round(3)
    df['cell_lng'] = df['lng'].round(3)
    df['cell'] = df['cell_lat'].map('{:.3f}'.format) + ',' + df['cell_lng'].map('{:.3f}'.format)
    df['zip'] = df['ZipCode'].fillna('').str.extract(r'(\d{5})', expand=False).fillna('')
    df['street'] = (df['StreetName'].fillna('') + ' ' + df['Suffix'].fillna('')).str.strip().str.title()
    df['patch_type_code'] = df['RequestType'].map(STREETLIGHT_TYPES).astype(int)
    df['resolution_days'] = (df['closed'] - df['created']).dt.total_seconds() / 86400
    return df[['cell', 'cell_lat', 'cell_lng', 'zip', 'street', 'created', 'closed', 'patch_type_code', 'resolution_days']]


def effective_end(df):
    """Last day of the last month with normal volume. Exports trail off (a few stray rows for
    months after the real cutoff), and those months would look like nothing failed."""
    monthly = df.groupby(df['created'].dt.to_period('M')).size()
    full = monthly[monthly >= 0.25 * monthly.median()]
    return full.index.max().to_timestamp(how='end').normalize()


def features_at(df, T, zip_of_cell, global_resolution):
    """Per-cell features using only requests before T (cells with at least one completed repair)."""
    closed = df[df['closed'].notna() & (df['closed'] < T)].sort_values('closed')
    if closed.empty:
        return pd.DataFrame(columns=FEATURES)
    last = closed.groupby('cell').tail(1).set_index('cell')
    out = pd.DataFrame(index=last.index)
    out['days_since_last_patch'] = (T - last['closed']).dt.total_seconds() / 86400
    out['patch_type_code'] = last['patch_type_code']

    before = df[df['created'] < T]
    out['past_311_density'] = before[before['created'] >= T - DENSITY_WINDOW].groupby('cell').size().reindex(out.index, fill_value=0)
    out['recent_311_density_365d'] = before[before['created'] >= T - RECENT_WINDOW].groupby('cell').size().reindex(out.index, fill_value=0)

    # Repair turnaround for the area: the cell's own history, falling back to its zip, then citywide.
    recent_closed = closed[closed['closed'] >= T - DENSITY_WINDOW]
    by_cell = recent_closed.groupby('cell')['resolution_days'].mean()
    by_zip = recent_closed.groupby('zip')['resolution_days'].mean()
    zip_fallback = zip_of_cell.reindex(out.index).map(by_zip)
    out['avg_resolution_days'] = by_cell.reindex(out.index).fillna(zip_fallback).fillna(global_resolution)
    return out[FEATURES]


def build_snapshots(df, zip_of_cell, global_resolution):
    start = df['created'].min() + DENSITY_WINDOW  # full lookback window for every snapshot
    end = df['created'].max() - HORIZON  # full 90-day outcome window
    dates = pd.date_range(start.normalize(), end, freq='QS')
    if len(dates) < 3:
        sys.exit(f'Not enough history: need {DENSITY_WINDOW.days} days of lookback plus {HORIZON.days}-day outcomes '
                 f'over several quarters; data covers {df["created"].min().date()} to {df["created"].max().date()}.')
    frames = []
    for T in dates:
        feats = features_at(df, T, zip_of_cell, global_resolution)
        future = df[(df['created'] >= T) & (df['created'] < T + HORIZON)]['cell'].unique()
        feats['failed_again_90d'] = feats.index.isin(future).astype(int)
        feats['snapshot'] = T
        frames.append(feats)
        log(f'  {T.date()}: {len(feats):,} locations, {feats["failed_again_90d"].mean():.1%} failed again within 90 days')
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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input', help='CSV path or glob, relative to server/ (default: data/raw_data.csv or data/MyLA311-*.csv)')
    args = parser.parse_args()

    files = input_files(args.input)
    log(f'Reading {len(files)} file(s) in chunks of {CHUNK_ROWS:,} rows...')
    df = load_requests(files)
    as_of = effective_end(df)
    dropped = int((df['created'] > as_of).sum())
    df = df[df['created'] <= as_of]
    if dropped:
        log(f'Data thins out after {as_of.date()}: dropped {dropped:,} trailing requests so empty months are not read as "no failures".')
    log(f'{len(df):,} geolocated streetlight requests, {df["cell"].nunique():,} locations, {df["created"].min().date()} to {as_of.date()}')

    zip_of_cell = df.groupby('cell')['zip'].agg(lambda z: z.mode().iat[0] if len(z.mode()) else '')
    global_resolution = float(df['resolution_days'].median())

    log('\nBuilding quarterly snapshots (features before T, outcome in the 90 days after)...')
    snaps = build_snapshots(df, zip_of_cell, global_resolution)

    # Time-based split: the last 4 snapshots are the holdout; training snapshots end before their outcomes overlap.
    test_dates = sorted(snaps['snapshot'].unique())[-4:]
    test = snaps[snaps['snapshot'].isin(test_dates)]
    train = snaps[snaps['snapshot'] + HORIZON <= test_dates[0]]
    log(f'\nTrain: {len(train):,} rows ({train["snapshot"].min().date()} to {train["snapshot"].max().date()}), '
        f'test: {len(test):,} rows ({test["snapshot"].min().date()} to {test["snapshot"].max().date()})')

    model, model_type = make_model()
    model.fit(train[FEATURES], train['failed_again_90d'])
    test_prob = model.predict_proba(test[FEATURES])[:, 1]
    y = test['failed_again_90d'].to_numpy()

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
    model.fit(snaps[FEATURES], snaps['failed_again_90d'])

    # Inference lookup: every location's features as of the end of the data.
    now_feats = features_at(df, as_of + pd.Timedelta(days=1), zip_of_cell, global_resolution)
    cells = df.groupby('cell').agg(lat=('cell_lat', 'first'), lng=('cell_lng', 'first'),
                                   street=('street', lambda s: s.mode().iat[0] if len(s.mode()) else ''))
    cells['zip'] = zip_of_cell
    cells = cells.join(now_feats, how='left')
    cells['past_311_density'] = cells['past_311_density'].fillna(0)
    cells['recent_311_density_365d'] = cells['recent_311_density_365d'].fillna(0)
    zips = cells[cells['zip'] != ''].groupby('zip').agg(
        lat=('lat', 'mean'), lng=('lng', 'mean'), past_311_density=('past_311_density', 'mean'),
        recent_311_density_365d=('recent_311_density_365d', 'mean'), avg_resolution_days=('avg_resolution_days', 'mean'),
        patch_type_code=('patch_type_code', lambda s: int(s.mode().iat[0]) if len(s.mode()) else 0),
    )

    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(model, os.path.join(MODELS_DIR, 'degradation_model.joblib'))
    joblib.dump({'cells': cells, 'zips': zips}, os.path.join(MODELS_DIR, 'cell_stats.joblib'))

    reference = {f: round(float(snaps[f].median()), 2) for f in FEATURES}
    metadata = {
        'model_type': model_type,
        'trained_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'data_as_of': as_of.date().isoformat(),
        'source_files': [os.path.basename(f) for f in files],
        'request_types': list(STREETLIGHT_TYPES),
        'patch_types': {str(k): v for k, v in PATCH_TYPES.items()},
        'target': 'failed_again_90d: a new streetlight request in the same ~100 m cell within 90 days',
        'cell': 'lat/lng rounded to 3 decimals (~111 m x 92 m)',
        'features': FEATURES,
        'feature_reference': reference,  # medians, used to explain which inputs raise the risk
        'global_avg_resolution_days': round(global_resolution, 2),
        'risk_thresholds': {'HIGH': round(high_cut * 100, 1), 'MEDIUM': round(medium_cut * 100, 1)},
        'recommended_actions': {
            'HIGH': 'Schedule Proactive Inspection within 14 Days',
            'MEDIUM': 'Add to Next Routine Inspection Cycle (within 45 Days)',
            'LOW': 'No Action Needed; Continue Monitoring',
        },
        'metrics': metrics,
    }
    with open(os.path.join(MODELS_DIR, 'model_metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)

    # Static hotspot map: current risk at every repaired location, top HIGH-risk ones only.
    scored = cells.dropna(subset=['days_since_last_patch']).copy()
    scored['score'] = model.predict_proba(scored[FEATURES])[:, 1] * 100
    top = scored[scored['score'] >= high_cut * 100].sort_values('score', ascending=False).head(TOP_HOTSPOTS)
    hotspots = [
        {
            'id': cell, 'lat': float(r.lat), 'lng': float(r.lng), 'zipcode': r.zip, 'label': r.street or 'Unnamed street',
            'score': round(float(r.score), 1), 'risk_level': 'HIGH',
            'density': int(r.past_311_density), 'recent_density': int(r.recent_311_density_365d),
            'days_since_last_patch': int(r.days_since_last_patch), 'avg_resolution_days': round(float(r.avg_resolution_days), 1),
            'patch_type': PATCH_TYPES[int(r.patch_type_code)],
        }
        for cell, r in top.iterrows()
    ]
    with open(os.path.join(DATA_DIR, 'aggregated_risk_map.json'), 'w') as f:
        json.dump({'generated_at': metadata['trained_at'], 'data_as_of': metadata['data_as_of'], 'model_type': model_type,
                   'risk_thresholds': metadata['risk_thresholds'], 'hotspots': hotspots}, f, indent=1)

    log(f'\nSaved models/degradation_model.joblib, models/cell_stats.joblib ({len(cells):,} locations, {len(zips):,} zips), '
        f'models/model_metadata.json and data/aggregated_risk_map.json ({len(hotspots)} hotspots).')


if __name__ == '__main__':
    main()
