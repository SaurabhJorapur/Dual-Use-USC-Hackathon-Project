"""Long-lived inference worker for the degradation model, spawned by server/src/degradation.js.

Loads the model once, then answers one JSON request per stdin line with one JSON response
per stdout line:
    in:  {"id": 1, "zipcode": "90007", "latitude": 34.022, "longitude": -118.285, "days_since_repair": 120}
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
CELLS, ZIPS = stats['cells'], stats['zips']
MIN_IMPACT = 1.0  # score points a factor must add to be listed


def lookup(req):
    """Feature row for the request: the location's own history, else its zip's averages."""
    lat, lng, zipcode = req.get('latitude'), req.get('longitude'), (req.get('zipcode') or '').strip()
    if lat is not None and lng is not None:
        key = f'{round(lat, 3):.3f},{round(lng, 3):.3f}'
        if key in CELLS.index:
            row = CELLS.loc[key]
            return row, 'location', row['zip'] or zipcode, row['street']
        zipcode = zipcode or None
    if zipcode and zipcode in ZIPS.index:
        return ZIPS.loc[zipcode], 'zipcode', zipcode, None
    return None, 'none', zipcode or None, None


def describe(feature, value, basis):
    where = 'within ~100 m' if basis == 'location' else 'per location in this ZIP (average)'
    n = round(value)
    if feature == 'past_311_density':
        if value > 10:
            return f'High historical complaint density (>10 calls in 100m radius; {n} in 2 years)'
        return f'Repeat streetlight complaints {where} ({n} in 2 years)'
    if feature == 'recent_311_density_365d':
        return f'{n} streetlight complaint{"s" if n != 1 else ""} {where} in the past year'
    if feature == 'days_since_last_patch':
        if value > 90:
            return f'Patch age exceeds 90 days ({n} days since last repair)'
        return f'Recent repair ({n} days ago): fresh repairs at this kind of site often fail again'
    if feature == 'avg_resolution_days':
        return f'Slow repair turnaround in this area (avg {n} days to close a request)'
    if feature == 'patch_type_code':
        return 'Last repair was a multi-light (circuit) issue' if value >= 1 else 'Last repair was a single-light issue'
    return feature


def predict(req):
    days = req.get('days_since_repair')
    row, basis, zipcode, street = lookup(req)
    if row is None:
        # No streetlight history at all: an unknown location with citywide-typical inputs.
        features = {**REFERENCE, 'past_311_density': 0.0, 'recent_311_density_365d': 0.0}
    else:
        features = {f: float(row[f]) if pd.notna(row.get(f)) else float(REFERENCE[f]) for f in FEATURES}
    if days is not None:
        features['days_since_last_patch'] = float(days)

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
        factors = ['No strong risk factors: typical or lower complaint history for this area']

    level = 'HIGH' if score >= THRESHOLDS['HIGH'] else 'MEDIUM' if score >= THRESHOLDS['MEDIUM'] else 'LOW'
    return {
        'degradation_risk_score': round(score, 1),
        'risk_level': level,
        'recommended_action': meta['recommended_actions'][level],
        'risk_factors': factors,
        'basis': basis,
        'location': {'zipcode': zipcode, 'street': street},
        'features': {f: round(v, 1) for f, v in features.items()},
        'model': {'type': meta['model_type'], 'data_as_of': meta['data_as_of'], 'auc_roc': meta['metrics']['auc_roc']},
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
