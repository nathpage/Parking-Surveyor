```jsx
// App_2025-10-26.jsx
import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';

export default function App() {
  const [pos, setPos] = useState([50.9279, 11.5865]);

  useEffect(() => {
    if (!window.L || !window.L.Map) return;
    const map = L.map('map').setView(pos, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OSM contributors'
    }).addTo(map);

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawCircle: false,
      drawText: false,
    });

    map.pm.setPathOptions({ color: '#2563eb', weight: 5 });

    map.on('pm:create', (e) => {
      console.log('created', e.shape);
    });
  }, [pos]);

  return (
    <div id="map" style={{ height: '100vh', width: '100%' }} />
  )
}
```