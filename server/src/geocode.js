// Turns a caller's free-text location ("Vermont & Jefferson", "1200 W 37th Pl", "90007")
// into map coordinates. Tries the US Census geocoder first (handles street addresses and
// intersections), then Photon and Nominatim (OpenStreetMap) for landmarks and partial
// names. Results are restricted to the Los Angeles area. Never throws: returns null.

const UA = { 'User-Agent': 'CivicLine/1.0 (municipal call triage demo)' };
// west, south, east, north
const BOX = { west: -118.95, south: 33.65, east: -117.9, north: 34.4 };
const CENTER = { lat: 34.0522, lng: -118.2437 };

const cache = new Map();
let queue = Promise.resolve();

const inBox = ({ lat, lng }) => lat >= BOX.south && lat <= BOX.north && lng >= BOX.west && lng <= BOX.east;

export function normalizeLocation(text) {
  let q = text
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\b(on-?ramp|off-?ramp|near|corner of|by the|outside)\b\s*(at|of)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\bCA\b|California|\b9\d{4}\b/i.test(q)) q += /los angeles/i.test(q) ? ', CA' : ', Los Angeles, CA';
  return q;
}

const STOP = new Set(['and', 'the', 'los', 'angeles', 'st', 'ave', 'blvd', 'rd', 'dr']);
const words = (s) => s.toLowerCase().match(/[a-z0-9]{2,}/g)?.filter((w) => !STOP.has(w)) || [];
const sharesWord = (query, text) => {
  const have = new Set(words(text));
  return words(query.replace(/,\s*(Los Angeles, )?CA$/i, '')).some((w) => have.has(w));
};

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function census(q) {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.search = new URLSearchParams({ address: q, benchmark: 'Public_AR_Current', format: 'json' });
  const match = (await getJson(url)).result?.addressMatches?.[0];
  return match && { lat: match.coordinates.y, lng: match.coordinates.x };
}

async function photon(q) {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({ q, limit: '1', lat: CENTER.lat, lon: CENTER.lng, bbox: `${BOX.west},${BOX.south},${BOX.east},${BOX.north}` });
  const hit = (await getJson(url)).features?.[0];
  if (!hit || !sharesWord(q, Object.values(hit.properties).join(' '))) return null; // Photon is fuzzy: reject unrelated matches
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng };
}

async function nominatim(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'us', bounded: '1', viewbox: `${BOX.west},${BOX.north},${BOX.east},${BOX.south}` });
  const hit = (await getJson(url))[0];
  return hit && { lat: Number(hit.lat), lng: Number(hit.lon) };
}

async function lookup(text) {
  const q = normalizeLocation(text);
  for (const provider of [census, photon, nominatim]) {
    try {
      const point = await provider(q);
      if (point && inBox(point)) return point;
    } catch (err) {
      console.warn(`[geocode] ${provider.name} failed for "${text}":`, err.message);
    }
  }
  return null;
}

/** @returns {Promise<{lat:number,lng:number}|null>} */
export function geocode(text) {
  const key = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (!key) return Promise.resolve(null);
  if (!cache.has(key)) {
    // Serialize lookups, ~1/s, to respect the free geocoders' usage policies.
    const result = queue.then(() => lookup(text));
    queue = result.then(() => new Promise((r) => setTimeout(r, 1000)));
    cache.set(key, result);
  }
  return cache.get(key);
}
