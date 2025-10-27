import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, Popup, useMap, Polygon, Circle, CircleMarker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { getPathLength } from "geolib";
import { exportPdf, exportDocx } from "./exports/docs";
import { translations } from "./i18n";

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
              style={{ display: "block", width: 30, height: 30, lineHeight: "30px", textAlign: "center" }}
            >
              ✖️
            </a>
          )}
        </div>
      </div>
    </>
  );
}

// GeomanDraw: bridge from Geoman -> React state
function GeomanDraw({ onCreated, onEdited, onDeleted }) {
  const map = useMap();
  const drawnLayerGroupRef = useRef(L.featureGroup());
  const initRef = useRef(false);

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
      removalMode: true,
    });

    map.pm.setPathOptions({ color: "#2563eb", weight: 5 });

    map.on("pm:create", (e) => {
      const { layer, shape } = e;
      const fid = crypto.randomUUID();
      layer._fid = fid;

      const geo = layer.toGeoJSON();

      if (shape === "Line") {
        onCreated(geo, layer, "polyline");
        layer.remove();
      } else if (shape === "Polygon") {
        onCreated(geo, layer, "polygon");
        layer.remove();
      } else if (shape === "Rectangle") {
        onCreated(geo, layer, "rectangle");
        layer.remove();
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
  }, [map, onCreated, onEdited, onDeleted]);

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
  const map = useMap();
  const ref = React.useRef(null);
  const isTouch = useIsTouch();

  useEffect(() => {
    const layer = ref.current;
    if (!layer || !map?.pm) return;

    layer._fid = feature.properties?._id;

    // keep edit OFF by default (no vertices shown)
    try { if (layer.pm) layer.pm.disable(); } catch {}

    const handleEdit = () => {
      const geo = layer.toGeoJSON();
      onEdit?.(feature.properties._id, geo);
    };
    const handleRemove = () => {
      onDelete?.(feature.properties._id);
    };
    layer.on("pm:edit", handleEdit);
    layer.on("pm:remove", handleRemove);

    const onGlobalEditToggle = (e) => {
      try {
        if (e.enabled) {
          layer.pm && layer.pm.enable({ allowSelfIntersection: true, snappable: true });
        } else {
          layer.pm && layer.pm.disable();
        }
      } catch {}
    };

    map.on("pm:globaleditmodetoggled", onGlobalEditToggle);

    return () => {
      layer.off("pm:edit", handleEdit);
      layer.off("pm:remove", handleRemove);
      map.off("pm:globaleditmodetoggled", onGlobalEditToggle);
      try { layer.pm && layer.pm.disable(); } catch {}
    };
  }, [map, feature, onEdit, onDelete]);

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

  return (
    <Polyline ref={ref} positions={coords} pathOptions={style} eventHandlers={handlers}>
      <Popup closeButton autoPan>
        <div style={{ fontSize: 14 }}>
          {children}
          {TouchPopupControls}
        </div>
      </Popup>
    </Polyline>
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

  useAutosave(features, setFeatures, boundary, setBoundary);

  const handleCreated = (geo, layer, layerType) => {
    try {
      if (layerType === "polygon" || layerType === "rectangle") {
        const coords = geo?.geometry?.coordinates;
        if (Array.isArray(coords) && Array.isArray(coords[0]) && coords[0].length >= 3) {
          const ring = coords[0];
          const latlngs = ring.map(([lng, lat]) => [lat, lng]);
          setBoundary(latlngs);
          const map = layer?._map;
          if (map) map.fitBounds(L.polygon(latlngs).getBounds(), { padding: [20, 20] });
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

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden" }}>
      {/* Language selector (top-left, above map) */}
      <div style={{ position: "absolute", top: 10, left: 44, zIndex: 1001 }}>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          style={{
            padding: "6px 8px",
            border: "1px solid #ddd",
            borderRadius: 8,
            background: "rgba(255,255,255,0.95)",
            fontSize: 13,
          }}
          aria-label="Language"
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
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
  	  maxNativeZoom={19}   // tiles exist to z=19
  	  maxZoom={22}         // allow zooming past 19 by scaling
  	  keepBuffer={5}       // keep more tiles around to avoid flashes
	/>

        {boundary && (
          <Polygon positions={boundary} pathOptions={{ color: "#111827", weight: 2, dashArray: "6 6", fillOpacity: 0.08 }} interactive={false} />
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

        <GeomanDraw onCreated={handleCreated} />
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

      {/* Hint bar — localized */}
      <div
        style={{
          position: "absolute",
          bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(255,255,255,0.7)",
          backdropFilter: "blur(6px)",
          borderRadius: 9999,
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 900,
        }}
      >
        {t.drawHint}
      </div>
    </div>
  );
}