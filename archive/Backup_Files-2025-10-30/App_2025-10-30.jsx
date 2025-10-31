```jsx
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, Popup, useMap, Polygon, Circle, CircleMarker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { getPathLength } from "geolib";
import { exportPdf, exportDocx } from "./exports/docs";
import { translations } from "./i18n";
import * as turf from "@turf/turf";
import "leaflet-geometryutil"; // adds L.GeometryUtil.* helpers

// Shared Overpass helper (fetch OSM roads for bbox)
async function fetchOSMRoadsForBBox(bboxArr) {
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
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: `data=${encodeURIComponent(query)}`
      });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      data = await res.json(); break;
    } catch (err) { lastErr = err; }
  }
  if (!data) throw lastErr || new Error("Overpass request failed");

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
          <span>{fmtMeters(meters.residents)</span>
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
```