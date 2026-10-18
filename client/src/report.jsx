import React from 'react';
import ReactDOM from 'react-dom/client';
import ReportPage from './pages/ReportPage.jsx';
import './index.css';

// Separate entry from the dashboard (main.jsx) so the report page stays small on weak
// connections: no map, charts or realtime client.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ReportPage />
  </React.StrictMode>,
);

// Keeps the page openable offline and enables Background Sync where supported. Production
// only: the dev server's modules aren't cacheable this way.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const api = encodeURIComponent(import.meta.env.VITE_API_URL || '');
  navigator.serviceWorker.register(`/report-sw.js?api=${api}`, { scope: '/report/' }).catch((err) => console.warn('[reports] service worker not registered', err));
}
