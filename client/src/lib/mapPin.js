// Classic teardrop map pin (inline SVG) for Leaflet divIcons; the tip sits on the location.
const PIN_PATH = 'M12 1C6 1 1.5 5.5 1.5 11.3c0 7.6 9.1 17.6 9.9 18.4a.85.85 0 0 0 1.2 0c.8-.8 9.9-10.8 9.9-18.4C22.5 5.5 18 1 12 1z';

/** Leaflet icon options matching pinHtml's 24×32 box, anchored at the tip. */
export const PIN_ICON = { iconSize: [24, 32], iconAnchor: [12, 31], popupAnchor: [0, -28] };

/**
 * @param {string} color pin fill
 * @param {{ glyph?: string, extra?: string }} [opts] glyph replaces the white center dot
 *   (an SVG string); extra is appended inside the pin (e.g. a count badge).
 */
export function pinHtml(color, { glyph = '', extra = '' } = {}) {
  const center = glyph ? '' : '<circle cx="12" cy="11.5" r="4" fill="#fff"/>';
  return (
    `<span class="map-pin"><svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">` +
    `<path d="${PIN_PATH}" fill="${color}" stroke="#fff" stroke-width="1.5"/>${center}</svg>` +
    `${glyph ? `<span class="map-pin__glyph">${glyph}</span>` : ''}${extra}</span>`
  );
}
