// leaflet.heat is a plain script that extends the global `L`, so expose Leaflet
// globally before it loads (import this module before 'leaflet.heat').
import L from 'leaflet';

window.L = L;
export default L;
