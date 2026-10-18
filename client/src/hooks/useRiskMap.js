import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** The risk model's precomputed high-risk locations (server/data/aggregated_risk_map.json). */
export function useRiskMap() {
  const [riskMap, setRiskMap] = useState({ hotspots: [], meta: null, error: null });

  useEffect(() => {
    let cancelled = false;
    api
      .riskMap()
      .then(({ hotspots, ...meta }) => !cancelled && setRiskMap({ hotspots, meta, error: null }))
      .catch((err) => !cancelled && setRiskMap({ hotspots: [], meta: null, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  return riskMap;
}
