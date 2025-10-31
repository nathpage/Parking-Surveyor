import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, Popup, useMap, Polygon, Circle, CircleMarker } from "react-leaflet";
import { SnapLoadingState } from "./utils/loadingState";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { getPathLength } from "geolib";
import { exportPdf, exportDocx } from "./exports/docs";
import { translations } from "./i18n";
import * as turf from "@turf/turf";
import "leaflet-geometryutil"; // adds L.GeometryUtil.* helpers
import { safeReInitLayer, createGuidesFromFeatureCollection, safeDisablePm, safeSetPmOptions } from "./utils/geomanHelpers";
import useGeomanLayer from "./hooks/useGeomanLayer";
import useGuideManager from "./hooks/useGuideManager";
import useGlobalEditGuard from "./hooks/useGlobalEditGuard";

// Shared Overpass helper (fetch OSM roads for bbox)
async function fetchOSMRoadsForBBox(bboxArr, onProgress) {
  const [w, s, e, n] = bboxArr;
  const query = `
    [out:json][timeout:25];
    (way["highway"]["highway"!~"footway|path|cycleway|steps|bridleway"](${s},${w},${n},${e}););
    out geom;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter"
  ];
  
  let data = null, lastErr = null;
  const maxRetries = 2; // Try each endpoint up to 2 times on timeout
  
  for (let endpointIdx = 0; endpointIdx < endpoints.length; endpointIdx++) {
    const url = endpoints[endpointIdx];
    
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        if (onProgress) {
          const attemptInfo = retry > 0 ? ` (retry ${retry}/${maxRetries - 1})` : '';
          onProgress(`Fetching from server ${endpointIdx + 1}/${endpoints.length}${attemptInfo}...`);
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
        
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (res.status === 504 || res.status === 502 || res.status === 503) {
          lastErr = new Error(`Server temporarily unavailable (${res.status})`);
          if (retry < maxRetries - 1) {
            if (onProgress) {
              onProgress(`Server busy, retrying in 2 seconds...`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue; // Retry this endpoint
          }
          continue; // Move to next endpoint
        }
        
        if (!res.ok) { 
          lastErr = new Error(`HTTP ${res.status}`); 
          continue; // Try next endpoint
        }
        
        data = await res.json(); 
        break; // Success!
      } catch (err) { 
        lastErr = err;
        if (err.name === 'AbortError') {
          lastErr = new Error('Request timed out after 30 seconds');
          if (onProgress && retry < maxRetries - 1) {
            onProgress(`Request timed out, retrying...`);
          }
          if (retry < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue; // Retry
          }
        }
      }
    }
    
    if (data) break; // Success, no need to try other endpoints
  }
  
  if (!data) {
    const errorMsg = lastErr?.message || "Overpass request failed";
    throw new Error(`Unable to load street data: ${errorMsg}. Please try again or check your internet connection.`);
  }

  const features = (data.elements || [])
    .filter(el => el.type === "way" && Array.isArray(el.geometry))
    .map(el => turf.lineString(el.geometry.map(g => [g.lon, g.lat]), { id: el.id }));
  return turf.featureCollection(features);
}


function PanelToggle({ open, setOpen, label }) {
  return (
    <div
      className="leaflet-top leaflet-right"
      style={{ right: 0, top: "calc(10px + env(safe-area-inset-top, 0px))", zIndex: 1002 }}
    >
      <div className="leaflet-control leaflet-bar">
        <a
          href="#"
          title={label}
          onClick={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          style={{
            display: "block",
            width: 34,
            height: 34,
            lineHeight: "34px",
            textAlign: "center",
            userSelect: "none",
          }}
        >
          {open ? "⮝" : "⮟"}
        </a>
      </div>
    </div>
  );
}

const INITIAL_CENTER = [50.9279, 11.5865];
const INITIAL_ZOOM = 16;

// Category styles
const CATEGORY_STYLES = {
  free: { color: "#22c55e", weight: 8 },
  residents: { color: "#ef4444", weight: 8 },
  limited: { color: "#f59e0b", weight: 8 },
};

function LegendControl({ t }) {
  const [open, setOpen] = React.useState(false);

  // shared styles
  const padLeft = 12;  // use a little extra space for thumb
  // push above the iOS bottom bar
  const padBottom = "calc(12px + env(safe-area-inset-bottom, 0px))";

  return (
    <>
      {/* Legend panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            left: padLeft,
            bottom: `calc(52px + ${padBottom})`, // leave space for the pill button
            background: "rgba(255,255,255,0.95)",
            borderRadius: 14,
            boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
            padding: "12px 14px",
            fontSize: 14,
            zIndex: 1100,
            backdropFilter: "saturate(120%) blur(4px)",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.legend}</div>
          <div><span style={{display:"inline-block",width:24,height:4,background:"#22c55e",borderRadius:2,marginRight:8}}/> {t.category.free}</div>
          <div><span style={{display:"inline-block",width:24,height:4,background:"#ef4444",borderRadius:2,marginRight:8}}/> {t.category.residents}</div>
          <div><span style={{display:"inline-block",width:24,height:4,background:"#f59e0b",borderRadius:2,marginRight:8}}/> {t.category.limited}</div>
        </div>
      )}

      {/* Toggle button (NOT a Leaflet control) */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Hide legend" : "Show legend"}
        style={{
          position: "absolute",
          left: padLeft,
          bottom: padBottom,
          zIndex: 1101,
          border: "none",
          outline: "none",
          padding: "8px 12px",
          borderRadius: 9999,
          background: "#111827",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          WebkitTapHighlightColor: "transparent", // iOS tap bubble off
          WebkitAppearance: "none",
          userSelect: "none",
          cursor: "pointer",
        }}
      >
        {open ? "✕" : "Legend"}
      </button>
    </>
  );
}

// ——— Shared button styles / variants ———
const BTN_BASE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: 40,                 // fixed height for ALL buttons
  padding: "0 14px",          // no vertical padding, keeps heights identical
  borderRadius: 12,
  fontWeight: 600,
  fontSize: 16,
  lineHeight: 1,              // normalize text metrics across elements
  border: "1px solid transparent",
  boxSizing: "border-box",    // consistent sizing model
  cursor: "pointer",
  userSelect: "none",
  WebkitAppearance: "none",   // iOS normalize
  appearance: "none",
  outline: "none",
};

const BTN_VARIANTS = {
  dark:   { background: "#111827", color: "#fff" },
  brand:  { background: "#2563eb", color: "#fff" },
  light:  { background: "#fff",    color: "#111827", border: "1px solid #e5e7eb" },
  muted:  { background: "#e5e7eb", color: "#111827", border: "1px solid #e5e7eb" },
  danger: { background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" },
};

function mergeStyles(...objs) {
  return Object.assign({}, ...objs);
}

// Button component (for <button>)
function Btn({ variant = "dark", full, style, ...props }) {
  return (
    <button
      {...props}
      style={mergeStyles(
        BTN_BASE,
        BTN_VARIANTS[variant],
        full ? { gridColumn: "1 / -1" } : null,
        style
      )}
    />
  );
}

// Label-as-button (for file input)
function LabelBtn({ variant = "muted", htmlFor, full, style, children }) {
  return (
    <label
      htmlFor={htmlFor}
      style={mergeStyles(
        BTN_BASE,
        BTN_VARIANTS[variant],
        full ? { gridColumn: "1 / -1" } : null,
        style
      )}
    >
      {children}
    </label>
  );
}

function Controls({
  t,
  lang,
  features,
  setFeatures,
  filter,
  setFilter,
  onExport,
  onImport,
  setBoundary,
  boundary,
}) {
  const totals = React.useMemo(() => {
    const acc = { free: 0, residents: 0, limited: 0 };
    for (const f of features) {
      if (f?.properties?.category && Number.isFinite(f?.properties?.spaces)) {
        acc[f.properties.category] += f.properties.spaces;
      }
    }
    return acc;
  }, [features]);

  const meters = React.useMemo(() => {
    const acc = { free: 0, residents: 0, limited: 0 };
    for (const f of features) {
      const c = f.properties?.category;
      if (c && acc[c] != null) acc[c] += Number(f.properties?.length_m || 0);
    }
    return acc;
  }, [features]);

  const fmtMeters = (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)} km` : `${Math.round(n)} m`);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: "min(92vw, 340px)",
        maxHeight: "82vh",
        overflowY: "auto",
        background: "rgba(255,255,255,0.95)",
        borderRadius: 16,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: 16,
        fontSize: 14,
        zIndex: 1000,
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6 }}>{t.appTitle}</div>
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 10 }}>{t.subtitle}</div>

      <label style={{ display: "inline-flex", alignItems: "center", marginRight: 12 }}>
        <input
          type="checkbox"
          checked={filter.free}
          onChange={(e) => setFilter((v) => ({ ...v, free: e.target.checked }))}
        />
        &nbsp;{t.category.free}
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", marginRight: 12 }}>
        <input
          type="checkbox"
          checked={filter.residents}
          onChange={(e) => setFilter((v) => ({ ...v, residents: e.target.checked }))}
        />
        &nbsp;{t.category.residents}
      </label>
      <label style={{ display: "inline-flex", alignItems: "center" }}>
        <input
          type="checkbox"
          checked={filter.limited}
          onChange={(e) => setFilter((v) => ({ ...v, limited: e.target.checked }))}
        />
        &nbsp;{t.category.limited}
      </label>

      {/* Spaces by category */}
      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 12, marginTop: 12 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>{t.approxSpaces}</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t.category.free}</span>
          <span>{totals.free}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t.category.residents}</span>
          <span>{totals.residents}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t.category.limited}</span>
          <span>{totals.limited}</span>
        </div>
      </div>

      {/* Measured lengths */}
      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 12, marginTop: 8 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>{t.measuredLength}</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t.category.free}</span>
          <span>{fmtMeters(meters.free)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t.category.residents}</span>
          <span>{fmtMeters(meters.residents)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t.category.limited}</span>
          <span>{fmtMeters(meters.limited)}</span>
        </div>
      </div>

      {/* Actions grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginTop: 12,
        }}
      >
        <Btn onClick={onExport} variant="dark">
          {t.exportGeoJSON}
        </Btn>

        {/* Hidden file input + label-as-button */}
        <input
          id="importFile"
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          style={{ display: "none" }}
          onChange={onImport}
        />
        <LabelBtn
          variant="muted"
          htmlFor="importFile"
        >
          {t.import}
        </LabelBtn>

        <Btn
          onClick={() => exportPdf({ features, boundary, lang })}
          variant="dark"
        >
          {t.exportPDF}
        </Btn>

        <Btn
          onClick={() => exportDocx({ features, boundary, lang })}
          variant="brand"
        >
          {t.exportWord}
        </Btn>

        {/* Full-width buttons below */}
        <Btn onClick={() => setBoundary(null)} variant="light" full style={{ height: 40 }}>
          {t.clearStudy}
        </Btn>

        <Btn
          onClick={() => {
            const confirmMsg =
              t.confirmClearAll ??
              (lang === "de"
                ? "Alle gespeicherten Daten wirklich löschen?"
                : "Really delete all saved data?");
            if (window.confirm(confirmMsg)) {
              localStorage.removeItem("jena-parking-features-v1");
              setFeatures([]);
              setBoundary(null);
            }
          }}
          variant="danger"
          full
          style={{ gap: 8, height: 40 }}
        >
          <span role="img" aria-label={t.ariaTrash ?? "trash"}>🗑️</span>
          {t.clearAll}
        </Btn>
      </div>

      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>{t.autosaveInfo}</div>
    </div>
  );
}

function useAutosave(features, setFeatures, boundary, setBoundary) {
  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem("jena-parking-features-v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.features)) setFeatures(parsed.features);
        if (Array.isArray(parsed.boundary)) setBoundary(parsed.boundary);
      }
    } catch {}
  }, [setFeatures, setBoundary]);

  // save
  useEffect(() => {
    localStorage.setItem("jena-parking-features-v1", JSON.stringify({ features, boundary }));
  }, [features, boundary]);
}

// Function for Location
function LocateControl() {
  const map = useMap();
  const [pos, setPos] = React.useState(null);
  const [acc, setAcc] = React.useState(null);
  const [watching, setWatching] = React.useState(false);

  const startLocate = React.useCallback(() => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setWatching(true);
    map.locate({
      setView: true,
      watch: true,
      maxZoom: 18,
      enableHighAccuracy: true,
    });
  }, [map]);

  const stopLocate = React.useCallback(() => {
    setWatching(false);
    try {
      map.stopLocate();
    } catch {}
  }, [map]);

  React.useEffect(() => {
    const onFound = (e) => {
      setPos(e.latlng);
      setAcc(e.accuracy);
    };
    const onErr = (e) => {
      console.warn("Geolocation error:", e.message);
    };
    map.on("locationfound", onFound);
    map.on("locationerror", onErr);
    return () => {
      map.off("locationfound", onFound);
      map.off("locationerror", onErr);
      try {
        map.stopLocate();
      } catch {}
    };
  }, [map]);

  return (
    <>
      {pos && (
        <>
          <CircleMarker
            center={pos}
            radius={6}
            pathOptions={{ color: "#2563eb", weight: 2, fillColor: "#3b82f6", fillOpacity: 1 }}
          />
          {Number.isFinite(acc) && (
            <Circle center={pos} radius={acc} pathOptions={{ color: "#3b82f6", fillOpacity: 0.08, weight: 1 }} />
          )}
        </>
      )}

      <div className="leaflet-top leaflet-left" style={{ left: 0, top: 282 }}>
        <div className="leaflet-control leaflet-bar">
          {!watching ? (
            <a
              href="#"
              title="Locate me"
              onClick={(e) => {
                e.preventDefault();
                startLocate();
              }}
              style={{ display: "block", width: 30, height: 30, lineHeight: "30px", textAlign: "center" }}
            >
              📍
            </a>
          ) : (
            <a
              href="#"
              title="Stop locating"
              onClick={(e) => {
                e.preventDefault();
                stopLocate();
              }}
              style={{ display: "block", width: 30, height: 30, lineHeight: "30px", textAlign: "center", zIndex: 999 }}
            >
              ✖️
            </a>
          )}
        </div>
      </div>
    </>
  );
}

// Editable boundary layer component
function EditableBoundary({ boundary, setBoundary }) {
  const map = useMap();
  const layerRef = React.useRef(null);

  // create / update the leaflet polygon that Geoman can edit
  React.useEffect(() => {
    if (!boundary || boundary.length < 3) {
      // remove old layer if boundary cleared
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch {}
        layerRef.current = null;
      }
      return;
    }

    if (!layerRef.current) {
      const layer = L.polygon(boundary, {
        color: "#111827",
        weight: 2,
        dashArray: "6 6",
        fillOpacity: 0.08,
        interactive: false // Make it non-interactive
      });
      layer.addTo(map);

      // Completely disable any editing capabilities
      if (layer.pm) {
        try {
          safeSetPmOptions(layer, {
            snappable: false,
            pmIgnore: true,
            preventMarkerRemoval: true,
            draggable: false,
            allowEditing: false,
          });
          layer.pm.disable();
        } catch {}
      }
      try { safeReInitLayer(layer); } catch {}

            // helper: read current polygon and push into React state
      const commitBoundary = () => {
        try {
          const rings = layer.getLatLngs();
          const ring = (Array.isArray(rings) && Array.isArray(rings[0])) ? rings[0] : rings;
          const next = ring.map(ll => [ll.lat, ll.lng]);
          setBoundary(next);
        } catch {}
      };

      // We intentionally do NOT wire Geoman edit listeners for the study
      // boundary so that it remains non-editable after creation. The
      // boundary value is set at creation time by the draw handler and
      // can only be changed by replacing the study area.
      layerRef.current = layer;
      return () => {
        // nothing to remove — editing is disabled for the boundary
      };
    } else {
      // update geometry without recreating
      try { layerRef.current.setLatLngs(boundary); } catch {}
    }
  }, [map, boundary, setBoundary]);

  // cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch {}
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

// Global guard to ensure snap guides (blue/green helpers) never become editable
function PmGuideGuard() {
  const map = useMap();

  React.useEffect(() => {
    const guard = () => {
      try {
        map.eachLayer((lyr) => {
          if (lyr && lyr._isSnapGuide && lyr.pm) {
            try {
              // keep guides non-editable and not draggable
              safeDisablePm(lyr);
              safeSetPmOptions(lyr, { snappable: false, draggable: false, pmIgnore: false, snapIgnore: false });
            } catch {}
          }
        });
      } catch {}
    };

    // run once immediately (covers the case where Edit was already enabled)
    guard();

    // Run once to set initial state, but don't respond to edit mode changes
    try {
      guard();
    } catch {}

    return () => {
      // No event listeners to clean up
    }
    
  }, [map]);

  return null;
}

// Persistent, visible snap guides for "Snap: Auto"
// - Fetches OSM roads for the current (padded) bounds when active
// - Draws visible offset guides for both sides so users can see where snapping will happen
function SnapGuides({ active, setExternalRoadsGetter, offsetMeters = 4, boundary }) {
  const map = useMap();
  // guide manager centralizes creation / removal and listener cleanup
  const guideManager = useGuideManager(map);
  const { 
    createFromFc, 
    removeAll: removeManagedGuides, 
    disableAll: disableManagedGuides, 
    groupRef: managedGroupRef,
    buildOffsetGuides: buildManagedGuides 
  } = guideManager;
  const roadsFcRef = useRef(null);
  const lastBBoxRef = useRef(null);
  const fetchingRef = useRef(false);

  // --- loading UI state for progress bar ---
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [statusMessage, setStatusMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const progressTimerRef = useRef(null);

  const beginLoading = React.useCallback((message = 'Loading snap guides...') => {
    try { if (progressTimerRef.current) { clearInterval(progressTimerRef.current); } } catch {}
    setLoading(true);
    setProgress(0.1);
    setStatusMessage(message);
    setErrorMessage('');
    SnapLoadingState.setState({ loading: true, progress: 0.1 });
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => {
        const newP = Math.min(0.85, p + 0.03);
        SnapLoadingState.setState({ loading: true, progress: newP });
        return newP;
      });
    }, 200);
  }, []);

  const endLoading = React.useCallback(() => {
    try {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    } catch {}
    setProgress(1);
    SnapLoadingState.setState({ loading: true, progress: 1 });
    setTimeout(() => {
      setLoading(false);
      setProgress(0);
      SnapLoadingState.setState({ loading: false, progress: 0 });
    }, 400);
  }, []);

  // --- helper: remove all guides (updated for pm:globaleditmodetoggled cleanup) ---
  const removeAllGuides = React.useCallback(() => {
    try { removeManagedGuides(); } catch {}
    // also ensure no stray layers
    try { map.eachLayer((lyr) => { if (lyr && lyr._isSnapGuide) try { map.removeLayer(lyr); } catch {} }); } catch {}
    // also stop any progress animation
    try {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    } catch {}
    setLoading(false);
    setProgress(0);
  }, [map]);

  // --- helper: clip a LineString to a Polygon and return only inside segments ---
  const clipLineToPolygon = React.useCallback((line, polygon) => {
    try {
      if (!line || !polygon) return [];
      // Split the line by the polygon border
      const border = turf.polygonToLine(polygon);
      const split = turf.lineSplit(line, border);

      // If nothing was split, check if the line is wholly inside
      const collect = (ls) => {
        // use midpoint test
        const lenKm = turf.length(ls, { units: "kilometers" });
        const mid = turf.along(ls, Math.max(0, lenKm / 2), { units: "kilometers" });
        return turf.booleanPointInPolygon(mid, polygon);
      };

      if (!split || !split.features?.length) {
        return collect(line) ? [line] : [];
      }

      // Keep only the parts whose midpoint lies inside the polygon
      return split.features.filter((seg) => collect(seg));
    } catch {
      return [];
    }
  }, []);

  // Rebuild guides from current roads + boundary and hand to guide manager
  const rebuildGuides = React.useCallback(() => {
    try {
      // clear previous managed guides
      try { removeManagedGuides(); } catch {}
      if (!roadsFcRef.current || !roadsFcRef.current.features?.length) return;
      if (!boundary || boundary.length < 3) return;

      const ringLngLat = boundary.map(([lat, lng]) => [lng, lat]);
      const poly = turf.polygon([[...ringLngLat, ringLngLat[0]]]);

      const features = [];
      roadsFcRef.current.features.forEach((road) => {
        try {
          const left = turf.lineOffset(road, Math.abs(offsetMeters), { units: "meters" });
          const right = turf.lineOffset(road, -Math.abs(offsetMeters), { units: "meters" });
          const clippedLeft = clipLineToPolygon(left, poly);
          const clippedRight = clipLineToPolygon(right, poly);

          const addSegs = (segments, side) => {
            segments.forEach((seg) => {
              try {
                const feat = turf.lineString(seg.geometry.coordinates, { side });
                features.push(feat);
              } catch {}
            });
          };
          addSegs(clippedLeft, 'left');
          addSegs(clippedRight, 'right');
        } catch {}
      });

      const fc = turf.featureCollection(features);
      try { createFromFc(fc); } catch (err) { console.warn('rebuildGuides.createFromFc failed', err); }
    } catch (err) {
      console.warn('rebuildGuides failed', err);
    }
  }, [boundary, offsetMeters, clipLineToPolygon, createFromFc, removeManagedGuides]);

  // expose roads getter (unchanged)
  useEffect(() => {
    if (typeof setExternalRoadsGetter === "function") {
      setExternalRoadsGetter(() => roadsFcRef.current);
    }
  }, [setExternalRoadsGetter]);

  // fetch / react to active+boundary (unchanged from your version)
  const maybeFetch = React.useCallback(async () => {
    const hasBoundary = boundary && Array.isArray(boundary) && boundary.length >= 3;
    if (!active || !hasBoundary) {
      removeAllGuides();
      roadsFcRef.current = null;
      lastBBoxRef.current = null;
      return;
    }
    const coords = boundary.map(([lat, lng]) => [lng, lat]);
    const poly = turf.polygon([[...coords, coords[0]]]);
    const bboxArr = turf.bbox(poly);
    const cur = bboxArr.join(",");

    if (lastBBoxRef.current && cur === lastBBoxRef.current) {
      rebuildGuides();
      return;
    }

    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      beginLoading('Loading street data...');
      const fc = await fetchOSMRoadsForBBox(bboxArr, (msg) => {
        setStatusMessage(msg);
      });
      setProgress(0.9);
      setStatusMessage('Building guides...');
      roadsFcRef.current = fc;
      lastBBoxRef.current = cur;
      rebuildGuides();
      endLoading();
      console.log("[snap] guides visible for roads:", fc.features.length);
    } catch (err) {
      console.warn("[snap] failed to fetch guides:", err);
      // Stop the progress animation immediately
      try {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
      } catch {}
      // Show error state
      setLoading(false);
      setProgress(0);
      setErrorMessage(err.message || 'Failed to load street data');
      SnapLoadingState.setState({ loading: false, progress: 0 });
      // Show error for 10 seconds
      setTimeout(() => {
        setErrorMessage('');
      }, 10000);
    } finally {
      fetchingRef.current = false;
    }
  }, [active, boundary, rebuildGuides, removeAllGuides, beginLoading, endLoading]);

  useEffect(() => {
    if (!active) {
      roadsFcRef.current = null;
      lastBBoxRef.current = null;
      removeAllGuides();
      setLoading(false);
      setProgress(0);
      return;
    }
    setTimeout(() => { try { maybeFetch(); } catch {} }, 0);
    return () => { removeAllGuides(); };
  }, [active, maybeFetch, removeAllGuides]);

  // rebuild on finalized boundary (unchanged from your version, but add loading UI)
  useEffect(() => {
    const handler = () => {
      beginLoading();
      lastBBoxRef.current = null;
      removeAllGuides();
      setTimeout(async () => {
        try { await maybeFetch(); } catch {}
        endLoading();
      }, 0);
    };
    try { map.on('ps:boundary-finalized', handler); } catch {}
    return () => { try { map.off('ps:boundary-finalized', handler); } catch {} };
  }, [map, removeAllGuides, maybeFetch, beginLoading, endLoading]);

  return (
    <>
      {loading && !errorMessage && (
        <div style={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(255,255,255,0.95)",
          padding: "8px 12px",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          backdropFilter: "blur(4px)",
          zIndex: 1102,
        }}>
          <div style={{fontSize: 13, color: "#374151", textAlign: "center"}}>{statusMessage}</div>
          <div style={{width: 200, height: 2, background: "#e5e7eb", borderRadius: 1, marginTop: 8, overflow: "hidden"}}>
            <div style={{height: "100%", background: "#3b82f6", width: `${progress * 100}%`, transition: "width 200ms ease-out"}} />
          </div>
        </div>
      )}
      {errorMessage && (
        <div style={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(254, 242, 242, 0.98)",
          padding: "12px 16px",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          backdropFilter: "blur(4px)",
          zIndex: 1102,
          maxWidth: "90%",
          width: 400,
          border: "1px solid #fecaca"
        }}>
          <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8}}>
            <div style={{flex: 1}}>
              <div style={{fontSize: 13, color: "#991b1b", fontWeight: 500}}>
                ⚠️ {errorMessage}
              </div>
              <div style={{fontSize: 12, color: "#7f1d1d", marginTop: 6}}>
                Try drawing a smaller study area or try again later.
              </div>
            </div>
            <button
              onClick={() => setErrorMessage('')}
              style={{
                background: "transparent",
                border: "none",
                color: "#991b1b",
                fontSize: 18,
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                minWidth: "auto"
              }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Helper function to find shortest path through guide network
function findShortestGuidePath(map, startInfo, endInfo) {
  // Collect all guide layers
  const guides = [];
  map.eachLayer((layer) => {
    if (layer._isSnapGuide && layer.getLatLngs) {
      guides.push(layer);
    }
  });
  
  if (guides.length === 0) return null;
  
  // Build graph: find all intersection points between guides
  const intersections = [];
  const connectionThreshold = 0.005; // ~5 meters tolerance for connections
  
  // Check each pair of guides for intersections
  for (let i = 0; i < guides.length; i++) {
    for (let j = i + 1; j < guides.length; j++) {
      const line1Coords = guides[i].getLatLngs().map(ll => [ll.lng, ll.lat]);
      const line2Coords = guides[j].getLatLngs().map(ll => [ll.lng, ll.lat]);
      
      const line1 = turf.lineString(line1Coords);
      const line2 = turf.lineString(line2Coords);
      
      try {
        const intersects = turf.lineIntersect(line1, line2);
        if (intersects.features.length > 0) {
          intersects.features.forEach(pt => {
            intersections.push({
              point: pt,
              guides: [guides[i], guides[j]]
            });
          });
        }
      } catch (e) {
        // Skip invalid geometries
      }
      
      // Also check endpoints that are very close (within threshold)
      [0, line1Coords.length - 1].forEach(idx1 => {
        [0, line2Coords.length - 1].forEach(idx2 => {
          const pt1 = turf.point(line1Coords[idx1]);
          const pt2 = turf.point(line2Coords[idx2]);
          const dist = turf.distance(pt1, pt2, { units: 'kilometers' });
          if (dist < connectionThreshold) {
            intersections.push({
              point: pt1,
              guides: [guides[i], guides[j]]
            });
          }
        });
      });
    }
  }
  
  // Build graph nodes: start point, end point, and all intersections
  const nodes = [
    { id: 'start', point: startInfo.point, guide: startInfo.guide },
    { id: 'end', point: endInfo.point, guide: endInfo.guide },
    ...intersections.map((inter, idx) => ({
      id: `inter_${idx}`,
      point: inter.point,
      guides: inter.guides
    }))
  ];
  
  // Build edges with distances
  const edges = [];
  
  // Connect nodes that share a guide
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const node1 = nodes[i];
      const node2 = nodes[j];
      
      // Find a common guide
      const guide1Set = node1.guides || [node1.guide];
      const guide2Set = node2.guides || [node2.guide];
      
      const sharedGuide = guide1Set.find(g => guide2Set.includes(g));
      
      if (sharedGuide) {
        const dist = turf.distance(node1.point, node2.point, { units: 'kilometers' });
        edges.push({
          from: node1.id,
          to: node2.id,
          distance: dist,
          guide: sharedGuide
        });
      }
    }
  }
  
  // Dijkstra's algorithm
  const distances = {};
  const previous = {};
  const unvisited = new Set();
  
  nodes.forEach(node => {
    distances[node.id] = node.id === 'start' ? 0 : Infinity;
    previous[node.id] = null;
    unvisited.add(node.id);
  });
  
  while (unvisited.size > 0) {
    let current = null;
    let minDist = Infinity;
    unvisited.forEach(id => {
      if (distances[id] < minDist) {
        minDist = distances[id];
        current = id;
      }
    });
    
    if (current === null || distances[current] === Infinity) break;
    if (current === 'end') break;
    
    unvisited.delete(current);
    
    // Check neighbors
    edges.forEach(edge => {
      if (edge.from === current && unvisited.has(edge.to)) {
        const alt = distances[current] + edge.distance;
        if (alt < distances[edge.to]) {
          distances[edge.to] = alt;
          previous[edge.to] = { id: current, edge };
        }
      } else if (edge.to === current && unvisited.has(edge.from)) {
        const alt = distances[current] + edge.distance;
        if (alt < distances[edge.from]) {
          distances[edge.from] = alt;
          previous[edge.from] = { id: current, edge };
        }
      }
    });
  }
  
  // Reconstruct path
  if (distances['end'] === Infinity) {
    return null; // No path found
  }
  
  const pathSegments = [];
  let current = 'end';
  
  while (previous[current]) {
    const prev = previous[current];
    pathSegments.unshift({
      from: nodes.find(n => n.id === prev.id),
      to: nodes.find(n => n.id === current),
      edge: prev.edge
    });
    current = prev.id;
  }
  
  // Build the actual path coordinates by following guides
  const finalPath = [];
  
  pathSegments.forEach((segment, idx) => {
    const guide = segment.edge.guide;
    const guideLatLngs = guide.getLatLngs();
    const guideLine = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: guideLatLngs.map(ll => [ll.lng, ll.lat])
      }
    };
    
    try {
      const sliced = turf.lineSlice(segment.from.point, segment.to.point, guideLine);
      const coords = sliced.geometry.coordinates;
      
      // Add to path, avoiding duplicates at junction points
      if (idx === 0) {
        coords.forEach(coord => finalPath.push(L.latLng(coord[1], coord[0])));
      } else {
        coords.slice(1).forEach(coord => finalPath.push(L.latLng(coord[1], coord[0])));
      }
    } catch (e) {
      // If lineSlice fails, just connect with straight line
      if (idx === 0) {
        finalPath.push(L.latLng(segment.from.point.geometry.coordinates[1], segment.from.point.geometry.coordinates[0]));
      }
      finalPath.push(L.latLng(segment.to.point.geometry.coordinates[1], segment.to.point.geometry.coordinates[0]));
    }
  });
  
  return finalPath.length > 0 ? finalPath : null;
}

function GeomanDraw({ onCreated, onEdited, onDeleted, snapSide, getRoadsFc, boundary }) {
  const map = useMap();
  const drawnLayerGroupRef = useRef(L.featureGroup());
  const initRef = useRef(false);
  const guideManager = useGuideManager(map);

  // working state during a draw
  const workingRef   = useRef(null);   // leaflet layer being drawn
  const roadsRef     = useRef(null);   // turf FC of roads in view
  const guidesRef    = useRef(null);   // leaflet FeatureGroup of snap guides
  const offsetRef    = useRef(null);   // turf LineString (offset roadside)
  const snapSideRef  = useRef(snapSide);
  useEffect(() => { snapSideRef.current = snapSide; }, [snapSide]);
  
  const clearGuides = React.useCallback(() => {
    if (guidesRef.current) {
      try {
        // Clean up any layers and event listeners
        const group = guidesRef.current;
        try {
          if (group._ensureGuidesDisabled) {
            try { map.off('pm:globaleditmodetoggled', group._ensureGuidesDisabled); } catch {}
          }
        } catch {}
        group.eachLayer((layer) => {
          try { if (layer.pm) layer.pm.disable(); } catch {}
          try { group.removeLayer(layer); } catch {}
        });
        try { map.removeLayer(group); } catch {}
      } catch {}
      guidesRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    if (snapSide === "off") {
      // clear any per-draw, invisible snapping guides and offset line
      if (typeof clearGuides === "function") clearGuides();
      offsetRef.current = null;
    }
  }, [snapSide, clearGuides]);

  // --- helpers ---

  const snapAllVertices = React.useCallback((layer) => {
    const off = offsetRef.current;
    if (!off || !layer?.getLatLngs) return;

    let latlngs = layer.getLatLngs();
    const nested = Array.isArray(latlngs) && Array.isArray(latlngs[0]) && latlngs[0].lat === undefined;
    if (nested) latlngs = latlngs[0];

    for (let i = 0; i < latlngs.length; i++) {
      const ll = latlngs[i];
      const np = turf.nearestPointOnLine(off, turf.point([ll.lng, ll.lat]), { units: "meters" });
      const snapped = L.latLng(np.geometry.coordinates[1], np.geometry.coordinates[0]);
      latlngs[i] = snapped;
    }
    if (nested) layer.setLatLngs([latlngs]); else layer.setLatLngs(latlngs);
    layer.redraw?.();
  }, []);

  // Memoized wrapper around guide manager's buildOffsetGuides
  const buildOffsetGuides = React.useCallback((roadFeature, side="left", meters=4) => {
    if (!guideManager || !roadFeature) return;
    try {
      const { group, offsetLine } = guideManager.buildOffsetGuides(roadFeature, side, meters);
      guidesRef.current = group;
      offsetRef.current = offsetLine;
    } catch (err) {
      console.warn("Failed to build offset guides", err);
    }
  }, [guideManager]);


  // choose left/right in **projected pixels** (robust)
  const computeSideForClick = React.useCallback((roadFeature, clickLngLat) => {
    const pt = turf.point(clickLngLat);
    const nearest = turf.nearestPointOnLine(roadFeature, pt, { units: "meters" });
    const coords = roadFeature.geometry.coordinates;
    const idx = Math.max(0, Math.min((nearest.properties?.index ?? 0), coords.length - 2));
    const [aLng, aLat] = coords[idx], [bLng, bLat] = coords[idx + 1];
    const [nLng, nLat] = nearest.geometry.coordinates;

    // project to pixels
    const A = map.project(L.latLng(aLat, aLng));
    const B = map.project(L.latLng(bLat, bLng));
    const N = map.project(L.latLng(nLat, nLng));
    const C = map.project(L.latLng(clickLngLat[1], clickLngLat[0]));

    const roadVec  = { x: B.x - A.x, y: B.y - A.y };
    const clickVec = { x: C.x - N.x, y: C.y - N.y };
    const cross = roadVec.x * clickVec.y - roadVec.y * clickVec.x;
    return cross > 0 ? "left" : "right";
  }, [map]);

  const findClosestRoad = React.useCallback((roadsFc, clickLngLat) => {
    let best = null, bestDist = Infinity;
    const pt = turf.point(clickLngLat);
    for (const f of roadsFc.features) {
      try {
        const nearest = turf.nearestPointOnLine(f, pt, { units: "meters" });
        const d = Number.isFinite(nearest.properties?.dist) ? nearest.properties.dist : Infinity;
        if (d < bestDist) { bestDist = d; best = f; }
      } catch {}
    }
    return best;
  }, []);

  const snapMarkerAndPolyline = React.useCallback((marker, layer) => {
    const off = offsetRef.current;
    if (!off || !marker || !layer) return;

    const m = marker.getLatLng();
    const np = turf.nearestPointOnLine(off, turf.point([m.lng, m.lat]), { units: "meters" });
    const snappedLL = L.latLng(np.geometry.coordinates[1], np.geometry.coordinates[0]);

    // move the interactive handle
    marker.setLatLng(snappedLL);

    // update the working polyline’s last vertex
    let latlngs = layer.getLatLngs();
    // normalize possible nesting ([[LatLng,...]])
    const nested = Array.isArray(latlngs) && Array.isArray(latlngs[0]) && latlngs[0].lat === undefined;
    if (nested) latlngs = latlngs[0];

    if (latlngs.length) {
      latlngs[latlngs.length - 1] = snappedLL;
      if (nested) layer.setLatLngs([latlngs]); else layer.setLatLngs(latlngs);
      layer.redraw?.();
    }
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if (!map.pm) {
      console.warn("Geoman not loaded (map.pm is undefined). Did you import '@geoman-io/leaflet-geoman-free'?");
      return;
    }

    const drawnGroup = drawnLayerGroupRef.current;
    map.addLayer(drawnGroup);

    map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawCircle: false,
      drawText: false,
      drawPolyline: true,
      drawPolygon: true,
      drawRectangle: true,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      removalMode: true
    });

    map.pm.setPathOptions({ color: "#2563eb", weight: 5 });
    map.pm.setGlobalOptions({
      snappable: true,
      snapDistance: 30,
      snapSegment: true,
      snapVertex: false,         // Disable vertex snapping completely
      snapMiddle: false,
      snapSegmentWeight: 1,      // Maximum weight for segment snapping
      snapSegmentPrecision: 1,   // Increase precision of segment snapping
    });

    
    // ---- START DRAW (bind to working layer) ----
    map.on("pm:drawstart", async (e) => {
      if (e.shape !== "Line" && e.shape !== "Polyline") return;

      workingRef.current = e.workingLayer || null;
      clearGuides();
      
      // Set up tracking for guide snapping
      if (workingRef.current) {
        workingRef.current._guidePoints = [];
        workingRef.current._snapGuide = null;
        
        // Listen for clicks on the map to track guide points
        const clickHandler = (clickE) => {
          const snapPoint = [clickE.latlng.lng, clickE.latlng.lat];
          let closestGuide = null;
          let minDist = Infinity;
          
          // Find closest guide
          map.eachLayer((layer) => {
            if (!layer._isSnapGuide || !layer.getLatLngs) return;
            
            const line = {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: layer.getLatLngs().map(ll => [ll.lng, ll.lat])
              }
            };
            const np = turf.nearestPointOnLine(line, turf.point(snapPoint));
            if (np.properties.dist < minDist) {
              minDist = np.properties.dist;
              closestGuide = layer;
            }
          });
          
          // Accept guides within 20 meters (reasonable snapping distance)
          if (closestGuide && minDist < 0.02) {
            const guideLatLngs = closestGuide.getLatLngs();
            const guideLine = {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: guideLatLngs.map(ll => [ll.lng, ll.lat])
              }
            };
            const snappedPoint = turf.nearestPointOnLine(guideLine, turf.point(snapPoint));
            
            workingRef.current._guidePoints.push({
              point: snappedPoint,
              guide: closestGuide
            });
          }
        };
        
        map.on('click', clickHandler);
        workingRef.current._clickHandler = clickHandler;
      }

      if (snapSideRef.current === "off") return;

      // Enable Geoman snapping to any registered snap layers (our invisible hitboxes)
      if (e.workingLayer?.pm) {
        safeSetPmOptions(e.workingLayer, {
          snappable: true,
          snapDistance: 60,
          snapSegment: true,
          snapVertex: false,         // Disable vertex snapping
          snapMiddle: false,
          snapSegmentWeight: 1,      // Maximum weight for segment snapping
          snapSegmentPrecision: 1,   // Increase precision of segment snapping
        });
      }
      map.pm.setGlobalOptions({
        snappable: true,
        snapDistance: 60,
        snapSegment: true,
        snapVertex: false,         // Disable vertex snapping
        snapMiddle: false,
        snapSegmentWeight: 1,      // Maximum weight for segment snapping
        snapSegmentPrecision: 1,   // Increase precision of segment snapping
      });
      map.pm.enableGlobalSnap?.();
    });

    // ---- VERTEX ADDED (handle guide snapping and path following) ----
    map.on("pm:vertexadded", (e) => {
      try {
        if (snapSideRef.current === "off") {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[pm:vertexadded] Snap is OFF, skipping');
          }
          return;
        }

        // active working layer and roads
        const wrk = e.workingLayer || workingRef.current;
        if (!wrk || !wrk.getLatLngs) {
          console.log('[pm:vertexadded] No working layer');
          return;
        }
        
        // Track points for guide following
        if (!wrk._guidePoints) wrk._guidePoints = [];
        
        // Find which guide (if any) we snapped to
        const snapPoint = [e.latlng.lng, e.latlng.lat];
        let closestGuide = null;
        let minDist = Infinity;
        let guideCount = 0;
        
        // Search all layers on the map for snap guides
        map.eachLayer((layer) => {
          if (!layer._isSnapGuide || !layer.getLatLngs) return;
          guideCount++;
          
          const line = {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: layer.getLatLngs().map(ll => [ll.lng, ll.lat])
            }
          };
          const np = turf.nearestPointOnLine(line, turf.point(snapPoint));
          if (np.properties.dist < minDist && np.properties.dist < 0.000001) {
            minDist = np.properties.dist;
            closestGuide = layer;
          }
        });
        
        console.log('[pm:vertexadded] Found', guideCount, 'guides, closest dist:', minDist, 'closestGuide:', !!closestGuide);

        // If we snapped to a guide, save the point and guide
        if (closestGuide) {
          const guideLatLngs = closestGuide.getLatLngs();
          const guideLine = {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: guideLatLngs.map(ll => [ll.lng, ll.lat])
            }
          };
          const snappedPoint = turf.nearestPointOnLine(guideLine, turf.point(snapPoint));
          let snappedLL = L.latLng(snappedPoint.geometry.coordinates[1], snappedPoint.geometry.coordinates[0]);
          
          wrk._guidePoints.push({
            point: snappedPoint,
            guide: closestGuide
          });
          
          console.log('[pm:vertexadded] Pushed guide point, total:', wrk._guidePoints.length);

          // If this is our second point on the same guide, generate the path
          if (wrk._guidePoints.length === 2 && 
              wrk._guidePoints[0].guide === wrk._guidePoints[1].guide) {
            
            console.log('[pm:vertexadded] TWO POINTS on same guide! Generating path...');
            
            const guide = wrk._guidePoints[0].guide;
            const start = wrk._guidePoints[0].point;
            const end = wrk._guidePoints[1].point;
            
            // Get all points along the guide between our two snap points
            const guidePath = turf.lineSlice(
              start,
              end,
              guideLine
            );
            
            console.log('[pm:vertexadded] Generated path with', guidePath.geometry.coordinates.length, 'points');
            
            // Replace the polyline points with the guide path
            const pathLatLngs = guidePath.geometry.coordinates.map(
              coord => L.latLng(coord[1], coord[0])
            );
            wrk.setLatLngs(pathLatLngs);
            
            // Finish the drawing since we have our path
            map.pm.Draw.Line._finishShape();
            return;
          } else if (wrk._guidePoints.length === 2) {
            console.log('[pm:vertexadded] Two points but different guides');
          }
          
          } else {
          // When not drawing along a guide, snap to the nearest point
          const roadsFc = (typeof getRoadsFc === "function") ? getRoadsFc() : null;
          if (!roadsFc || !roadsFc.features?.length) return;

          const clickLngLat = [e.latlng.lng, e.latlng.lat];
          const road = findClosestRoad(roadsFc, clickLngLat);
          if (!road) return;

          const side = computeSideForClick(road, clickLngLat);
          const dist = side === "left" ? 4 : -4;
          const off = turf.lineOffset(road, dist, { units: "meters" });
          offsetRef.current = off;

          const np = turf.nearestPointOnLine(off, turf.point(clickLngLat), { units: "meters" });
          let snappedLL = L.latLng(np.geometry.coordinates[1], np.geometry.coordinates[0]);

        // move the interactive handle when available
        const marker = e.marker;
        if (marker?.setLatLng) marker.setLatLng(snappedLL);

        // replace the last vertex in the working polyline
        let latlngs = wrk.getLatLngs();
        const nested = Array.isArray(latlngs) && Array.isArray(latlngs[0]) && latlngs[0].lat === undefined;
        if (nested) latlngs = latlngs[0];

        if (latlngs.length === 0) {
          // if no vertices yet, let Geoman place the first on click; we only preview
          wrk.addLatLng(snappedLL);
        } else {
          latlngs[latlngs.length - 1] = snappedLL;
          if (nested) wrk.setLatLngs([latlngs]); else wrk.setLatLngs(latlngs);
        }
        wrk.redraw?.();
          }
      } catch {}
    });

    // ---- CONTINUOUS CURSOR SNAP (while moving mouse in draw mode) ----
    map.on("pm:drawmousemove", (e) => {
      try {
        if (snapSideRef.current === "off") return;

        const wrk = e.workingLayer || workingRef.current;
        if (!wrk || !wrk.getLatLngs) return;

        const roadsFc = (typeof getRoadsFc === "function") ? getRoadsFc() : null;
        if (!roadsFc || !roadsFc.features?.length) return;

        const clickLngLat = [e.latlng.lng, e.latlng.lat];

        // pick nearest road and compute side vs. the click
        const road = findClosestRoad(roadsFc, clickLngLat);
        if (!road) return;

        const side = computeSideForClick(road, clickLngLat);
        const dist = side === "left" ? 4 : -4;
        const off = turf.lineOffset(road, dist, { units: "meters" });
        offsetRef.current = off;

        // snap the floating cursor position to the offset line
  const np = turf.nearestPointOnLine(off, turf.point(clickLngLat), { units: "meters" });
  let snappedLL = L.latLng(np.geometry.coordinates[1], np.geometry.coordinates[0]);

        // Update the working polyline so the preview point follows the snapped location
        let latlngs = wrk.getLatLngs();
        const nested = Array.isArray(latlngs) && Array.isArray(latlngs[0]) && latlngs[0].lat === undefined;
        if (nested) latlngs = latlngs[0];

        if (latlngs.length === 0) {
          // if no vertices yet, let Geoman place the first on click; we only preview
          wrk.addLatLng(snappedLL);
        } else {
          latlngs[latlngs.length - 1] = snappedLL;
          if (nested) wrk.setLatLngs([latlngs]); else wrk.setLatLngs(latlngs);
        }
        wrk.redraw?.();
      } catch {}
    });

    // ---- END DRAW ----
    map.on("pm:drawend", () => {
      // Clean up click handler
      if (workingRef.current && workingRef.current._clickHandler) {
        map.off('click', workingRef.current._clickHandler);
      }
      
      clearGuides();
      workingRef.current = null;
      roadsRef.current   = null;
      offsetRef.current  = null;
    });

    // create / edit / remove -> hand off to React state
    map.on("pm:create", (e) => {
      const { layer, shape } = e;
      console.debug("[pm:create] shape=", shape, "layer?", !!layer);
      
      // Check if we should apply guide path following
      const wrk = workingRef.current;
      if (shape === "Line" && wrk && wrk._guidePoints && wrk._guidePoints.length === 2) {
        const startInfo = wrk._guidePoints[0];
        const endInfo = wrk._guidePoints[1];
        
        // If same guide, use simple lineSlice
        if (startInfo.guide === endInfo.guide) {
          const guide = startInfo.guide;
          const guideLatLngs = guide.getLatLngs();
          const guideLine = {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: guideLatLngs.map(ll => [ll.lng, ll.lat])
            }
          };
          
          const guidePath = turf.lineSlice(startInfo.point, endInfo.point, guideLine);
          const pathLatLngs = guidePath.geometry.coordinates.map(coord => L.latLng(coord[1], coord[0]));
          layer.setLatLngs(pathLatLngs);
        } else {
          // Different guides - find shortest path through guide network
          const pathLatLngs = findShortestGuidePath(map, startInfo, endInfo);
          if (pathLatLngs && pathLatLngs.length > 0) {
            layer.setLatLngs(pathLatLngs);
          }
        }
      }
      
      const fid = crypto.randomUUID();
      layer._fid = fid;
      const geo = layer.toGeoJSON();
      
      // Clear any per-draw guides when creating a study area; persistent
      // snappable segments are managed by the SnapGuides component which
      // listens for the finalized boundary event.
      if (shape === "Polygon" || shape === "Rectangle") {
        try { clearGuides(); } catch {}
      }

      if (shape === "Line") {
        console.debug("[pm:create] creating polyline");
        onCreated(geo, layer, "polyline"); layer.remove();
      } else if (shape === "Polygon") {
        console.debug("[pm:create] creating polygon with coords", geo?.geometry?.coordinates?.[0]?.length);
        onCreated(geo, layer, "polygon"); layer.remove();
      } else if (shape === "Rectangle") {
        console.debug("[pm:create] creating rectangle");
        onCreated(geo, layer, "rectangle"); layer.remove();
      }
    });

    map.on("pm:edit", (e) => {
      const layer = e.layer;
      if (!layer || !layer._fid) return;
      onEdited?.([{ _fid: layer._fid, geo: layer.toGeoJSON() }]);
    });

    map.on("pm:remove", (e) => {
      const layer = e.layer;
      if (!layer || !layer._fid) return;
      onDeleted?.([layer._fid]);
    });
  }, [
    map,
    clearGuides,
    fetchOSMRoadsForBBox,
    buildOffsetGuides,
    computeSideForClick,
    findClosestRoad,
    snapMarkerAndPolyline,
    onCreated, onEdited, onDeleted
  ]);

  return null;
}


async function compressImage(file, maxW = 1280, quality = 0.75) {
  const imgUrl = URL.createObjectURL(file);
  const img = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.src = imgUrl;
  });
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  URL.revokeObjectURL(imgUrl);
  return dataUrl;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MetadataForm({ feature, onSave, onCancel, onDelete }) {
  const [category, setCategory] = useState(feature?.properties?.category || "free");
  const [spaces, setSpaces] = useState(feature?.properties?.spaces ?? 0);
  const [rules, setRules] = useState(feature?.properties?.rules || "");
  const [limitMins, setLimitMins] = useState(feature?.properties?.limitMins ?? 120);
  const [street, setStreet] = useState(feature?.properties?.street || "");
  const [notes, setNotes] = useState(feature?.properties?.notes || "");
  const [images, setImages] = useState(feature?.properties?.images || []);

  async function handleAddImages(e) {
    const files = Array.from(e.target.files || []).slice(0, 12);
    const dataUrls = [];
    for (const f of files) {
      try {
        dataUrls.push(await compressImage(f, 1280, 0.75));
      } catch {
        dataUrls.push(await fileToDataUrl(f));
      }
    }
    const newImgs = dataUrls.map((d) => ({ dataUrl: d, caption: "" }));
    setImages((prev) => [...prev, ...newImgs]);
    e.target.value = "";
  }

  function updateCaption(i, val) {
    setImages((prev) => prev.map((img, idx) => (idx === i ? { ...img, caption: val } : img)));
  }

  function removeImage(i) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div style={{ background: "#fff", borderRadius: 16, padding: 16, width: "100%", maxWidth: 700 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Segment details</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>ID: {feature?.properties?._id?.slice(0, 8) || "—"}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ fontSize: 14 }}>
            Street
            <input
              style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="e.g., Lutherstraße"
            />
          </label>

          <label style={{ fontSize: 14 }}>
            Category
            <select
              style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="free">Free (anyone)</option>
              <option value="residents">Residents only</option>
              <option value="limited">Limited time</option>
            </select>
          </label>

          <label style={{ fontSize: 14 }}>
            Approx. spaces
            <input
              type="number"
              style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
              value={spaces}
              onChange={(e) => {
                const v = parseInt(e.target.value || "0");
                setSpaces(v);
                feature.properties = feature.properties || {};
                feature.properties.spacesEdited = true;
              }}
            />
          </label>

          {feature?.properties?.length_m && (
            <label style={{ fontSize: 12, color: "#6b7280", display: "flex", alignItems: "flex-end" }}>
              Estimated length: {feature.properties.length_m} m (≈ {Math.round(feature.properties.length_m / 5.5)} spaces)
            </label>
          )}

          <label style={{ fontSize: 14 }}>
            Time limit (mins)
            <input
              type="number"
              disabled={category !== "limited"}
              style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
              value={limitMins}
              onChange={(e) => setLimitMins(parseInt(e.target.value || "0"))}
            />
          </label>

          <label style={{ gridColumn: "1 / -1", fontSize: 14 }}>
            Rules / Hours
            <input
              style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="e.g., Residents Mo–Fr 8–18h; free otherwise"
            />
          </label>

          <label style={{ gridColumn: "1 / -1", fontSize: 14 }}>
            Notes
            <textarea
              rows={3}
              style={{ width: "100%", marginTop: 6, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observations, signage, construction, etc."
            />
          </label>

          {/* Images */}
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Photos</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {images.map((img, i) => (
                <div key={i} style={{ width: 150 }}>
                  <img
                    src={img.dataUrl}
                    alt={`photo-${i}`}
                    style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8, border: "1px solid #eee" }}
                  />
                  <input
                    placeholder="Caption (optional)"
                    value={img.caption}
                    onChange={(e) => updateCaption(i, e.target.value)}
                    style={{ width: "100%", marginTop: 6, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }}
                  />
                  <button
                    onClick={() => removeImage(i)}
                    style={{ marginTop: 4, fontSize: 12, border: "1px solid #eee", borderRadius: 6, background: "#fff", padding: "4px 6px" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <label style={{ padding: "8px 12px", borderRadius: 8, background: "#e5e7eb", cursor: "pointer", display: "inline-block" }}>
              Add photos
              <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleAddImages} />
            </label>
          </div>
        </div>

        {/* Footer with Delete (left) + Cancel/Save (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => {
              if (window.confirm("Delete this segment?")) {
                onDelete?.(feature?.properties?._id);
              }
            }}
            style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", padding: "8px 12px", borderRadius: 12 }}
            title="Delete this segment"
          >
            🗑️ Delete segment
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancel}>Cancel</button>
            <button
              style={{ background: "#111827", color: "#fff", border: "none", padding: "8px 12px", borderRadius: 12 }}
              onClick={() => onSave({ category, spaces, rules, limitMins, street, notes, images })}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function useIsTouch() {
  const [isTouch, setIsTouch] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia?.("(pointer: coarse)");
    const update = () => setIsTouch(!!(mql?.matches || "ontouchstart" in window));
    update();
    mql?.addEventListener?.("change", update);
    return () => mql?.removeEventListener?.("change", update);
  }, []);
  return isTouch;
}


// --- React-leaflet polyline wrapper that hooks Geoman for per-layer edit/remove ---
function PolylineWithGeoman({ feature, style, onEdit, onDelete, onClick, children }) {
  const ref = React.useRef(null);
  const isTouch = useIsTouch();

  // Delegate per-layer Geoman wiring to a reusable hook
  useGeomanLayer(ref, feature, { onEdit, onRemove: onDelete }, {
    defaultPmOptions: feature.geometry?.type === "Polygon" ? { pmIgnore: true, snapIgnore: true } : { pmIgnore: false, snapIgnore: false },
    skipWiring: feature.geometry?.type === "Polygon"
  });

  const coords = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

  // Desktop vs Mobile event handlers
  const handlers = isTouch
    ? {
        // tap -> open popup (don’t open editor directly on touch)
        click: (e) => {
          e.originalEvent?.preventDefault?.();
          e.originalEvent?.stopPropagation?.();
          e.target.openPopup();
        },
      }
    : {
        mouseover: (e) => e.target.openPopup(),  // hover show
        mouseout: (e) => e.target.closePopup(),  // hover hide
        click: (e) => {                           // click -> open editor
          e.target.closePopup();
          onClick?.();
        },
      };

  // Inline edit button (only for touch)
  const TouchPopupControls = isTouch ? (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();      // keep the popup from closing due to map click bubbling
          onClick?.();               // open editor modal
        }}
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#111827",
          color: "#fff",
          fontSize: 12
        }}
      >
        Edit segment
      </button>
    </div>
  ) : null;

  // Separate handlers for hitbox that reference the visible line
  const hitboxHandlers = isTouch
    ? {
        click: (e) => {
          e.originalEvent?.preventDefault?.();
          e.originalEvent?.stopPropagation?.();
          if (ref.current) {
            ref.current.openPopup();
          }
        },
      }
    : {
        mouseover: () => {
          if (ref.current) {
            ref.current.openPopup();
          }
        },
        mouseout: () => {
          if (ref.current) {
            ref.current.closePopup();
          }
        },
        click: () => {
          if (ref.current) {
            ref.current.closePopup();
          }
          onClick?.();
        },
      };

  return (
    <>
      {/* Invisible wider hitbox for easier clicking */}
      <Polyline
        positions={coords}
        pathOptions={{
          ...style,
          weight: 20, // Much wider hitbox
          opacity: 0, // Completely invisible
          fillOpacity: 0
        }}
        eventHandlers={hitboxHandlers}
        pmIgnore={true}
      />
      {/* Visible line on top */}
      <Polyline ref={ref} positions={coords} pathOptions={style} eventHandlers={handlers}>
        <Popup closeButton autoPan>
          <div style={{ fontSize: 14 }}>
            {children}
            {TouchPopupControls}
          </div>
        </Popup>
      </Polyline>
    </>
  );
}

export default function JenaParkingMap() {
  const [features, setFeatures] = useState([]);
  const [filter, setFilter] = useState({ free: true, residents: true, limited: true });
  const [editingFeature, setEditingFeature] = useState(null);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [boundary, setBoundary] = useState(null);
  const [lang, setLang] = useState("en");
  const t = translations[lang];
  const [panelOpen, setPanelOpen] = useState(false);
  const [snapSide, setSnapSide] = useState("off"); // "off" | "auto"
  const snapActive = snapSide === "auto" && Array.isArray(boundary) && boundary.length >= 3;

  useAutosave(features, setFeatures, boundary, setBoundary);

  const handleCreated = (geo, layer, layerType) => {
    try {
      console.debug("[handleCreated]", layerType, geo?.geometry?.type);
      if (layerType === "polygon" || layerType === "rectangle") {
        const coords = geo?.geometry?.coordinates;
        if (Array.isArray(coords) && Array.isArray(coords[0]) && coords[0].length >= 3) {
          const ring = coords[0];
          const latlngs = ring.map(([lng, lat]) => [lat, lng]);
          setBoundary(latlngs);
          const map = layer?._map;
          if (map) {
     	    map.fitBounds(L.polygon(latlngs).getBounds(), { padding: [20, 20] });
     	    // tell SnapGuides to fetch for this fresh boundary
     	    setTimeout(() => { try { map.fire('ps:boundary-finalized'); } catch {} }, 0);
	  }
        } else {
          console.warn("No ring coords found for boundary:", coords);
        }
        return;
      }

      if (layerType === "polyline") {
        const coords = geo.geometry.coordinates;
        const points = coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
        const totalLength = getPathLength(points);
        const estimatedSpaces = Math.max(1, Math.round(totalLength / 5.5));

        const fid = layer._fid || crypto.randomUUID();

        const newFeature = {
          type: "Feature",
          geometry: geo.geometry,
          properties: {
            _id: fid,
            category: "free",
            spaces: estimatedSpaces,
            rules: "",
            limitMins: 120,
            street: "",
            notes: "",
            length_m: Math.round(totalLength),
            spacesEdited: false,
          },
        };

        setFeatures((prev) => {
          const idx = prev.length;
          setEditingIndex(idx);
          setEditingFeature(newFeature);
          return [...prev, newFeature];
        });

        return;
      }
    } catch (err) {
      console.error("handleCreated error:", err);
    }
  };

  const deleteFeatureById = (id) => {
    setFeatures((prev) => prev.filter((f) => f?.properties?._id !== id));
    setEditingFeature(null);
    setEditingIndex(-1);
  };

  const onSaveFeature = (props) => {
    setFeatures((prev) => {
      const arr = [...prev];
      if (editingIndex >= 0 && editingIndex < arr.length) {
        arr[editingIndex] = { ...editingFeature, properties: { ...editingFeature.properties, ...props } };
      } else {
        arr.push({ ...editingFeature, properties: { ...editingFeature.properties, ...props } });
      }
      return arr;
    });
    setEditingFeature(null);
    setEditingIndex(-1);
  };

  const onCancelEdit = () => {
    setEditingFeature(null);
    setEditingIndex(-1);
  };

  const onExport = () => {
    const payload = {
      type: "Survey",
      version: 1,
      features,
      boundary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jena-parking-survey.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.type === "Survey" && Array.isArray(data.features)) {
          setFeatures(data.features);
          if (Array.isArray(data.boundary)) setBoundary(data.boundary);
        } else if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
          setFeatures(data.features);
        } else {
          alert("Invalid file format.");
        }
      } catch {
        alert("Could not read file.");
      }
    };
    reader.readAsText(file);
  };

  // Shared control button/select style matching Leaflet's default controls
  const controlStyle = {
    padding: "5px 10px",
    border: "2px solid rgba(0,0,0,0.2)",
    borderRadius: 4,
    background: "#fff",
    color: "#333",
    fontSize: 13,
    fontFamily: "inherit",
    boxShadow: "0 1px 5px rgba(0,0,0,0.65)",
    cursor: "pointer",
    minWidth: 30,
    minHeight: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Yellow style for snap toggle button
  const snapControlStyle = {
    ...controlStyle,
    background: "#ffd700",
    color: "#000",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden" }}>
      {/* Control container (top-left) - consistent with Leaflet controls */}
      <div style={{ position: "absolute", top: 10, left: 54, zIndex: 999, display: "flex", gap: 6, alignItems: "flex-start" }}>
        {/* Language selector */}
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          style={controlStyle}
          aria-label="Language"
        >
          <option value="en">🇬🇧 EN</option>
          <option value="de">🇩🇪 DE</option>
        </select>

        {/* Snap control */}
        <select
          value={snapSide}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "auto" && (!boundary || !Array.isArray(boundary) || boundary.length < 3)) {
              alert("Please draw a study area first (use the polygon/rectangle tool).");
              return;
            }
            setSnapSide(val);
          }}
          style={snapControlStyle}
          aria-label="Snap mode"
        >
          <option value="off">📍 Snap: Off</option>
          <option value="auto">🧲 Snap: Auto</option>
        </select>
      </div>

      <PanelToggle open={panelOpen} setOpen={setPanelOpen} label={panelOpen ? t.ui.hidePanel : t.ui.showPanel} />

      <MapContainer
        center={INITIAL_CENTER}
        zoom={INITIAL_ZOOM}
        scrollWheelZoom
        maxZoom={22}
        zoomControl={true}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          borderRadius: 0,
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // tiles exist to z=19
          maxNativeZoom={19}
          // allow zooming past 19 by scaling
          maxZoom={22}
          // keep more tiles around to avoid flashes
          keepBuffer={5}
        />

        {boundary && (
          <EditableBoundary boundary={boundary} setBoundary={setBoundary} />
        )}

        {panelOpen && (
          <Controls
            t={t}
            lang={lang}
            features={features}
            setFeatures={setFeatures}
            filter={filter}
            setFilter={setFilter}
            onExport={onExport}
            onImport={onImport}
            setBoundary={setBoundary}
            boundary={boundary}
          />
        )}

        {features.map((f, idx) => {
          const show = filter[f.properties?.category ?? "free"];
          if (!show) return null;

          const style = CATEGORY_STYLES[f.properties?.category ?? "free"];

          return (
            <PolylineWithGeoman
              key={f.properties?._id || idx}
              feature={f}
              style={style}
              onClick={() => {
                setEditingIndex(idx);
                setEditingFeature(f);
              }}
              onEdit={(id, geo) => {
                setFeatures((prev) =>
                  prev.map((ff) => {
                    if (ff.properties?._id !== id) return ff;
                    const coords = geo.geometry.coordinates;
                    const points = coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
                    const newLen = getPathLength(points);
                    const next = {
                      ...ff,
                      geometry: geo.geometry,
                      properties: { ...ff.properties, length_m: Math.round(newLen) },
                    };
                    if (!next.properties.spacesEdited) {
                      next.properties.spaces = Math.max(1, Math.round(newLen / 5.5));
                    }
                    return next;
                  })
                );
              }}
              onDelete={(id) => deleteFeatureById(id)}
            >
              <div style={{ fontSize: 14 }}>
                <div style={{ fontWeight: 600 }}>{f.properties?.street || "Unnamed street"}</div>
                <div>Category: {f.properties?.category}</div>
                {f.properties?.category === "limited" && <div>Time limit: {f.properties?.limitMins} min</div>}
                <div>Spaces: {f.properties?.spaces ?? 0}</div>
                {f.properties?.rules && <div>Rules: {f.properties.rules}</div>}
                {f.properties?.notes && <div>Notes: {f.properties.notes}</div>}
                <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>Click to edit</div>
                <div>
                  Length: {f.properties?.length_m ?? 0} m {f.properties?.spacesEdited ? "(manual spaces)" : "(auto spaces)"}
                </div>
              </div>
            </PolylineWithGeoman>
          );
        })}

        {/* Global guard for snap guides */}
        {snapActive && <PmGuideGuard />}
        {/* Visible guides and pre-fetched roads when Snap: Auto */}
        {snapActive && (
          <SnapGuides
            active={true}
            boundary={boundary}
            setExternalRoadsGetter={(getterFactory) => { JenaParkingMap._getRoadsFc = getterFactory; }}
            offsetMeters={4}
          />
        )}
        <GeomanDraw
          onCreated={handleCreated}
          onEdited={() => {}}
          onDeleted={() => {}}
          snapSide={snapSide}
          // call the stored getter to obtain the FeatureCollection
          getRoadsFc={() => (typeof JenaParkingMap._getRoadsFc === "function" ? JenaParkingMap._getRoadsFc() : null)}
          boundary={boundary}
        />
        <LocateControl />
      </MapContainer>

   

      {editingFeature && (
        <MetadataForm
          feature={editingFeature}
          onSave={onSaveFeature}
          onCancel={onCancelEdit}
          onDelete={deleteFeatureById}
        />
      )}

      <LegendControl t={t} />
      
      <SnapLoadingBar />
    </div>
  );
}

// Loading indicator for snap guide data
function SnapLoadingBar() {
  const [state, setState] = React.useState({ loading: false, progress: 0 });
  
  React.useEffect(() => {
    return SnapLoadingState.subscribe(setState);
  }, []);

  if (!state.loading) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(255,255,255,0.95)",
      padding: "8px 12px",
      borderRadius: 8,
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      backdropFilter: "blur(4px)",
      zIndex: 1102,
    }}>
      <div style={{fontSize: 13, color: "#374151", textAlign: "center"}}>Loading snap guides...</div>
      <div style={{width: 200, height: 2, background: "#e5e7eb", borderRadius: 1, marginTop: 8, overflow: "hidden"}}>
        <div style={{height: "100%", background: "#3b82f6", width: `${state.progress * 100}%`, transition: "width 200ms ease-out"}} />
      </div>
    </div>
  );
}
