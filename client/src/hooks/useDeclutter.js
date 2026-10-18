import { useEffect, useMemo, useState } from 'react';
import { declutterPins } from '../lib/declutter';

// Pins closer than CELL_PX on screen merge into one (with a count); from SHOW_ALL_ZOOM every pin shows.
export const CELL_PX = 44;
export const SHOW_ALL_ZOOM = 15;

/**
 * Groups map items by screen position at the current zoom of `map` (a Leaflet map, or null before
 * it mounts). `latLng(item)` and `outranks(a, b)` should be stable (module-level) functions.
 * Returns `[{ item, count }]`.
 */
export function useDeclutter(map, items, latLng, outranks) {
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    if (!map) return undefined;
    const onZoom = () => setZoom(map.getZoom());
    onZoom();
    map.on('zoomend', onZoom);
    return () => map.off('zoomend', onZoom);
  }, [map]);

  return useMemo(() => {
    if (!map || zoom === null || zoom >= SHOW_ALL_ZOOM) return items.map((item) => ({ item, count: 1 }));
    const points = items.map((item) => ({ item, ...map.project(latLng(item), zoom) }));
    return declutterPins(points, CELL_PX, outranks);
  }, [map, zoom, items, latLng, outranks]);
}
