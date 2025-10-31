// Lightweight Geoman / Leaflet helpers used by App.jsx
// Keep these minimal and defensive (try/catch) to reduce repetitive boilerplate.

export function safeSetPmOptions(layer, opts = {}) {
  try {
    if (layer && layer.pm && typeof layer.pm.setOptions === 'function') {
      layer.pm.setOptions(opts);
    }
  } catch (err) {
    // swallow - best-effort
  }
}

export function safeDisablePm(layer) {
  try {
    if (layer && layer.pm && typeof layer.pm.disable === 'function') {
      layer.pm.disable();
    }
  } catch (err) {}
}

export function safeEnablePm(layer, opts = {}) {
  try {
    if (layer && layer.pm && typeof layer.pm.enable === 'function') {
      layer.pm.enable(opts);
    }
  } catch (err) {}
}

export function safeReInitLayer(layer) {
  try {
    if (typeof L !== 'undefined' && L.PM && typeof L.PM.reInitLayer === 'function') {
      try { L.PM.reInitLayer(layer); } catch (err) {}
    }
  } catch (err) {}
}

// Build a Leaflet FeatureGroup of invisible (or lightly visible) hit-polylines
// from a GeoJSON FeatureCollection. Returns the group (already added to map).
export function createGuidesFromFeatureCollection(map, guidesFc) {
  const group = L.featureGroup();
  if (!guidesFc || !Array.isArray(guidesFc.features)) {
    return group;
  }
  guidesFc.features.forEach((f) => {
    try {
      if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates)) return;
      const latlngs = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

      // Create a single guide line that is both visible and snappable
      const showColor = (f?.properties?.color) ? f.properties.color : (f?.properties?.side === 'left' ? '#2563eb' : (f?.properties?.side === 'right' ? '#10b981' : '#6b7280'));
      const guide = L.polyline(latlngs, {
        color: showColor,
        weight: 3,
        opacity: 0.7,
        dashArray: '4 4',
        interactive: true,
        pmIgnore: false,
      });
      guide._isSnapGuide = true;
      group.addLayer(guide);

      // Add continuous snapping behavior
      guide.on('pm:snapdrag', (e) => {
        try {
          if (!e.layer || !e.snapLatLng) return;
          
          // Calculate the actual closest point on the polyline
          const mousePoint = e.layer._map.latLngToLayerPoint(e.snapLatLng);
          const linePoints = guide.getLatLngs().map(ll => guide._map.latLngToLayerPoint(ll));
          
          let minDist = Infinity;
          let closestPoint = null;
          
          // Find closest point on line segments
          for (let i = 0; i < linePoints.length - 1; i++) {
            const p1 = linePoints[i];
            const p2 = linePoints[i + 1];
            const closest = L.LineUtil.closestPointOnSegment(mousePoint, p1, p2);
            const dist = mousePoint.distanceTo(closest);
            if (dist < minDist) {
              minDist = dist;
              closestPoint = closest;
            }
          }
          
          if (closestPoint) {
            // Update the snap point
            const snapLatLng = guide._map.layerPointToLatLng(closestPoint);
            e.layer.setLatLngs([snapLatLng]);
          }
        } catch (err) {
          console.warn('Snap handler error:', err);
        }
      });

      // Configure the guide for snapping
      try {
        if (guide.pm && typeof guide.pm.setOptions === 'function') {
          guide.pm.setOptions({
            pmIgnore: false,
            snapIgnore: false,
            preventMarkerRemoval: true,
            draggable: false,
            allowEditing: false,
            allowRemoval: false,
            snapDistance: 30,
          });
        }
        if (typeof L !== 'undefined' && L.PM && typeof L.PM.reInitLayer === 'function') {
          L.PM.reInitLayer(guide);
        }
      } catch {}
    } catch (err) {
      // skip invalid features
      console.warn('createGuidesFromFeatureCollection: skipping invalid feature', err);
    }
  });

  group.addTo(map);

  // Keep hit layers disabled (one-time setup) and prevent future editing
  try {
    const ensureGuidesDisabled = () => {
      try {
        group.eachLayer((lyr) => {
          if (lyr && lyr._isHit && lyr.pm) {
            try {
              safeDisablePm(lyr);
            } catch {}
          }
        });
      } catch {}
    };
    // Disable right away (in case Edit was already on)
    ensureGuidesDisabled();
    try { map.on('pm:globaleditmodetoggled', ensureGuidesDisabled); } catch {}
    // Remember to detach this when the group is removed
    group._ensureGuidesDisabled = ensureGuidesDisabled;
  } catch (err) {
    // ignore
  }

  // Re-init any PM hooks once all layers are attached
  if (typeof L !== 'undefined' && L.PM && typeof L.PM.reInitLayer === 'function') {
    group.eachLayer((lyr) => { try { L.PM.reInitLayer(lyr); } catch {} });
  }

  return group;
}
