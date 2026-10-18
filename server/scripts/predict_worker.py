"""Long-lived inference worker for the public safety risk model, spawned by server/src/degradation.js.

Loads the model once, then answers one JSON request per stdin line with one JSON response
per stdout line:
    in:  {"id": 1, "latitude": 34.062, "longitude": -118.307, "area": "Olympic"}
    out: {"id": 1, "result": {...}}  or  {"id": 1, "error": "..."}
"""

import json
import os
import sys

import joblib
import pandas as pd

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(SERVER_DIR, 'models')

model = joblib.load(os.path.join(MODELS_DIR, 'degradation_model.joblib'))
stats = joblib.load(os.path.join(MODELS_DIR, 'cell_stats.joblib'))
with open(os.path.join(MODELS_DIR, 'model_metadata.json')) as f:
    meta = json.load(f)

FEATURES = meta['features']
REFERENCE = meta['feature_reference']
THRESHOLDS = meta['risk_thresholds']
CELLS, AREAS = stats['cells'], stats['areas']
AREA_NAMES = {name.lower(): name for name in AREAS.index}  # requests match LAPD area names in any case
MIN_IMPACT = 1.0  # score points a factor must add to be listed


def lookup(req):
    """Feature row for the request: the location's own history, else its LAPD area's averages."""
    lat, lng = req.get('latitude'), req.get('longitude')
    area = (req.get('area') or '').strip()
    area = AREA_NAMES.get(area.lower(), area)
    if lat is not None and lng is not None:
        key = f'{round(lat, 3):.3f},{round(lng, 3):.3f}'
        if key in CELLS.index:
            row = CELLS.loc[key]
            if pd.notna(row['days_since_last_incident']):
                return row, 'location', row['area'] or area, row['street']
            area = area or row['area']
    if area and area in AREAS.index:
        return AREAS.loc[area], 'area', area, None
    return None, 'none', area or None, None


def describe(feature, value, basis):
    where = 'within ~100 m' if basis == 'location' else 'per active location in this area (average)'
    n = round(value)
    if feature == 'crime_count_365d':
        return f'{n} reported crime{"s" if n != 1 else ""} {where} in the past year'
    if feature == 'collision_count_365d':
        return f'{n} traffic collision{"s" if n != 1 else ""} {where} in the past year'
    if feature == 'violent_count_365d':
        return f'{n} violent crime{"s" if n != 1 else ""} {where} in the past year'
    if feature == 'injury_collision_count_365d':
        return f'{n} injury collision{"s" if n != 1 else ""} {where} in the past year'
    if feature == 'days_since_last_serious':
        return 'No violent crime or injury collision here in the past year' if n >= 365 else f'Last violent crime or injury collision {n} days before the data cutoff'
    if feature == 'recent_incidents_90d':
        return f'Recent activity: {n} incident{"s" if n != 1 else ""} in the last 90 days'
    if feature == 'days_since_last_incident':
        return f'Last incident only {n} day{"s" if n != 1 else ""} before the data cutoff'
    if feature == 'weapon_share_365d':
        return f'{value:.0%} of crimes here involved a weapon'
    if feature == 'night_share_365d':
        return f'{value:.0%} of incidents happen at night (8 pm to 6 am)'
    if feature == 'area_incidents_per_cell_365d':
        return f'Busy surrounding LAPD area (avg {n} incidents per active location per year)'
    return feature


def predict(req):
    row, basis, area, street = lookup(req)
    if row is None:
        # No incident history at all: an unknown location with citywide-typical inputs and no recent activity.
        features = {**REFERENCE, 'crime_count_365d': 0.0, 'collision_count_365d': 0.0, 'violent_count_365d': 0.0,
                    'injury_collision_count_365d': 0.0, 'recent_incidents_90d': 0.0, 'days_since_last_incident': 365.0,
                    'days_since_last_serious': 400.0}
    else:
        features = {f: float(row[f]) if pd.notna(row.get(f)) else float(REFERENCE[f]) for f in FEATURES}

    frame = pd.DataFrame([features], columns=FEATURES)
    score = float(model.predict_proba(frame)[0, 1] * 100)

    # Which inputs push the score up: swap each for the citywide median and see how much the score drops.
    variants = pd.DataFrame([{**features, f: REFERENCE[f]} for f in FEATURES], columns=FEATURES)
    impacts = score - model.predict_proba(variants)[:, 1] * 100
    factors = [
        describe(f, features[f], basis)
        for f, impact in sorted(zip(FEATURES, impacts), key=lambda x: -x[1])
        if impact >= MIN_IMPACT
    ]
    if not factors:
        factors = ['No strong risk factors: typical or lower incident history for this area']

    level = 'HIGH' if score >= THRESHOLDS['HIGH'] else 'MEDIUM' if score >= THRESHOLDS['MEDIUM'] else 'LOW'
    rounded = round(score, 1)
    return {
        'risk_score': rounded,
        'degradation_risk_score': rounded,  # older name, kept for existing clients
        'risk_level': level,
        'recommended_action': meta['recommended_actions'][level],
        'risk_factors': factors,
        'basis': basis,
        'location': {'area': area, 'street': street},
        'features': {f: round(v, 3) for f, v in features.items()},
        'model': {'type': meta['model_type'], 'target': meta['target'], 'data_as_of': meta['data_as_of'], 'auc_roc': meta['metrics']['auc_roc']},
    }


def main():
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get('id')
            out = {'id': req_id, 'result': predict(req)}
        except Exception as err:  # noqa: BLE001 - report to the caller instead of dying
            out = {'id': req_id, 'error': str(err)}
        print(json.dumps(out), flush=True)


if __name__ == '__main__':
    main()
