import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, FeatureGroup, Polyline, Popup, useMap, Rectangle, Polygon } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
// @ts-ignore – leaflet-draw has no types by default


/**
 * Jena Parking Survey – single-file React component
 *
 * What it does
 * - Shows a Leaflet map (OSM tiles) centered on the area from your screenshot
 * - Lets you draw street segments (polylines) and tag them with parking metadata
 *   - Category: Free / Residents / Limited time
 *   - Hours/Rules (free text, e.g., "Mo–Fr 8–18h residents only")
 *   - Time limit (mins) for limited-time parking
 *   - Approx. number of spaces (integer)
 *   - Notes
 * - Filter by category, search by street name, and show a legend
 * - Autosaves to localStorage and allows export/import as GeoJSON for sharing
 *
 * No Google API needed; uses OpenStreetMap tiles. You may swap tiles if desired.
 */

const INITIAL_CENTER = [50.9279, 11.5865]; // Jena city center near the highlighted area
const INITIAL_ZOOM = 16; // zoomed into the neighborhood

// Rough bounding box rectangle around the focus area (from your screenshot)
const BOUNDS = [
  [50.9319, 11.5776], // NW
  [50.9240, 11.5969], // SE
];

// Category styles
const CATEGORY_STYLES = {
  free: { color: "#22c55e", weight: 6 }, // green
  residents: { color: "#ef4444", weight: 6 }, // red
  limited: { color: "#f59e0b", weight: 6 }, // orange
};

// Replace Legend with this version
function Legend() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        background: "rgba(255,255,255,0.9)",
        borderRadius: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: 12,
        fontSize: 14,
        zIndex: 1000,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Legend</div>
      <div><span style={{display:"inline-block",width:24,height:4,background:"#22c55e",borderRadius:2,marginRight:8}}/>Free (anyone)</div>
      <div><span style={{display:"inline-block",width:24,height:4,background:"#ef4444",borderRadius:2,marginRight:8}}/>Residents only</div>
      <div><span style={{display:"inline-block",width:24,height:4,background:"#f59e0b",borderRadius:2,marginRight:8}}/>Limited time</div>
    </div>
  );
}

// Replace Controls with this version
function Controls({ features, setFeatures, filter, setFilter, onExport, onImport, setBoundary }) {
  const totals = React.useMemo(() => {
    const t = { free: 0, residents: 0, limited: 0 };
    for (const f of features) {
      if (f?.properties?.category && Number.isFinite(f?.properties?.spaces)) {
        t[f.properties.category] += f.properties.spaces;
      }
    }
    return t;
  }, [features]);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 320,
        background: "rgba(255,255,255,0.95)",
        borderRadius: 16,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: 16,
        fontSize: 14,
        zIndex: 1000,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6 }}>Parking Survey</div>
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 10 }}>
        Draw segments along streets and tag them. Use the polygon/rectangle tool to draw the study area.
      </div>

      <label style={{ display: "inline-flex", alignItems: "center", marginRight: 12 }}>
        <input
          type="checkbox"
          checked={filter.free}
          onChange={(e) => setFilter((v) => ({ ...v, free: e.target.checked }))}
        />
        &nbsp;Free
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", marginRight: 12 }}>
        <input
          type="checkbox"
          checked={filter.residents}
          onChange={(e) => setFilter((v) => ({ ...v, residents: e.target.checked }))}
        />
        &nbsp;Residents
      </label>
      <label style={{ display: "inline-flex", alignItems: "center" }}>
        <input
          type="checkbox"
          checked={filter.limited}
          onChange={(e) => setFilter((v) => ({ ...v, limited: e.target.checked }))}
        />
        &nbsp;Limited
      </label>

      <div style={{ background: "#f9fafb", borderRadius: 12, padding: 12, marginTop: 12 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>Approx. spaces by category</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Free</span><span>{totals.free}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Residents</span><span>{totals.residents}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Limited</span><span>{totals.limited}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={onExport}
          style={{ padding: "8px 12px", borderRadius: 12, background: "#111827", color: "#fff", border: "none" }}
        >
          Export GeoJSON
        </button>
        <label style={{ padding: "8px 12px", borderRadius: 12, background: "#e5e7eb", cursor: "pointer" }}>
          Import
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            style={{ display: "none" }}
            onChange={onImport}
          />
        </label>
      </div>

      {/* NEW: Clear study area button */}
      <button
        onClick={() => setBoundary(null)}
        style={{
          marginTop: 10,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
        title="Remove the currently drawn study area polygon/rectangle"
      >
        Clear study area
      </button>

      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
        Data is autosaved to your browser. Export to share or back up.
      </div>
    </div>
  );
}

function useAutosave(features, setFeatures) {
  // Load on mount
  useEffect(() => {
    const raw = localStorage.getItem("jena-parking-features-v1");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setFeatures(parsed);
      } catch {}
    }
  }, [setFeatures]);

  // Save on change
  useEffect(() => {
    localStorage.setItem("jena-parking-features-v1", JSON.stringify(features));
  }, [features]);
}

function GeomanDraw({ onCreated, onEdited, onDeleted }) {
  const map = useMap();
  const drawnLayerGroupRef = useRef(L.featureGroup());
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if (!map.pm) {                      // <— guard
      console.warn("Geoman not loaded (map.pm is undefined). Did you import '@geoman-io/leaflet-geoman-free'?");
      return;
    }

    const drawnGroup = drawnLayerGroupRef.current;
    map.addLayer(drawnGroup);

    map.pm.addControls({
      position: "topleft",
      drawCircle: false,
      drawMarker: false,
      drawCircleMarker: false,
      drawText: false,
    });

    map.pm.setPathOptions({ color: "#2563eb", weight: 5 });

    map.on("pm:create", (e) => {
      const { layer, shape } = e;
      const geo = layer.toGeoJSON();

      if (shape === "Line") {
        drawnGroup.addLayer(layer);
        onCreated(geo, layer, "polyline");
      } else if (shape === "Polygon") {
        onCreated(geo, layer, "polygon");
        layer.remove();
      } else if (shape === "Rectangle") {
        onCreated(geo, layer, "rectangle");
        layer.remove();
      }
    });

    map.on("pm:edit", () => {
      const edits = [];
      drawnGroup.eachLayer((l) => edits.push(l.toGeoJSON()));
      onEdited(edits);
    });

    map.on("pm:remove", () => {
      const ids = [];
      drawnGroup.eachLayer((l) => ids.push(JSON.stringify(l.toGeoJSON().geometry)));
      onDeleted(ids);
    });
  }, [map, onCreated, onEdited, onDeleted]);

  return null;
}

// Prompt form for a feature's metadata
function MetadataForm({ feature, onSave, onCancel }) {
  const [category, setCategory] = useState(feature?.properties?.category || "free");
  const [spaces, setSpaces] = useState(feature?.properties?.spaces ?? 0);
  const [rules, setRules] = useState(feature?.properties?.rules || "");
  const [limitMins, setLimitMins] = useState(feature?.properties?.limitMins ?? 120);
  const [street, setStreet] = useState(feature?.properties?.street || "");
  const [notes, setNotes] = useState(feature?.properties?.notes || "");

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.4)",
      display:"grid", placeItems:"center", padding:16, zIndex:1000
    }}>
      <div style={{background:"#fff", borderRadius:16, padding:16, width:"100%", maxWidth:600}}>
        <div style={{fontSize:18, fontWeight:600, marginBottom:8}}>Segment details</div>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
          <label style={{fontSize:14}}>Street
            <input style={{width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6}}
              value={street} onChange={e=>setStreet(e.target.value)} placeholder="e.g., Lutherstraße"/>
          </label>

          <label style={{fontSize:14}}>Category
            <select style={{width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6}}
              value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="free">Free (anyone)</option>
              <option value="residents">Residents only</option>
              <option value="limited">Limited time</option>
            </select>
          </label>

          <label style={{fontSize:14}}>Approx. spaces
            <input type="number" style={{width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6}}
              value={spaces} onChange={e=>setSpaces(parseInt(e.target.value||"0"))}/>
          </label>

          <label style={{fontSize:14}}>Time limit (mins)
            <input type="number" disabled={category!=="limited"}
              style={{width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6}}
              value={limitMins} onChange={e=>setLimitMins(parseInt(e.target.value||"0"))}/>
          </label>

          <label style={{gridColumn:"1 / -1", fontSize:14}}>Rules / Hours
            <input style={{width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6}}
              value={rules} onChange={e=>setRules(e.target.value)}
              placeholder="e.g., Residents Mo–Fr 8–18h; free otherwise"/>
          </label>

          <label style={{gridColumn:"1 / -1", fontSize:14}}>Notes
            <textarea rows={3} style={{width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6}}
              value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observations, signage, construction, etc."/>
          </label>
        </div>

        <div style={{display:"flex", justifyContent:"flex-end", gap:8, marginTop:12}}>
          <button onClick={onCancel}>Cancel</button>
          <button style={{background:"#111827", color:"#fff", border:"none", padding:"8px 12px", borderRadius:12}}
            onClick={()=>onSave({category, spaces, rules, limitMins, street, notes})}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function JenaParkingMap() {
  const [features, setFeatures] = useState([]); // GeoJSON Feature[]
  const [filter, setFilter] = useState({ free: true, residents: true, limited: true });
  const [editingFeature, setEditingFeature] = useState(null);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [boundary, setBoundary] = useState(null); // [[lat,lng], ...] or null

  useAutosave(features, setFeatures);

  const handleCreated = (geo, layer, layerType) => {
    try {
      console.log("[handleCreated]", layerType, geo?.geometry?.type, geo);

      if (layerType === "polygon" || layerType === "rectangle") {
        const coords = geo?.geometry?.coordinates;
        if (Array.isArray(coords) && Array.isArray(coords[0]) && coords[0].length >= 3) {
          const ring = coords[0];             // [ [lng,lat], ... ]
          const latlngs = ring.map(([lng, lat]) => [lat, lng]);
          setBoundary(latlngs);

          // Zoom to it so you *see* the effect
          const map = layer?._map;
          if (map) map.fitBounds(L.polygon(latlngs).getBounds(), { padding: [20, 20] });
        } else {
          console.warn("No ring coords found for boundary:", coords);
        }
        return;
      }

      if (layerType === "polyline") {
        const newFeature = {
          type: "Feature",
          geometry: geo.geometry,
          properties: {
            category: "free",
            spaces: 0,
            rules: "",
            limitMins: 120,
            street: "",
            notes: "",
            images: [],
            _id: crypto.randomUUID(),
          },
        };
        setEditingIndex(features.length);
        setEditingFeature(newFeature);
        return;
      }
    } catch (err) {
      console.error("handleCreated error:", err);
    }
  };

  const handleEdited = (editedGeos) => {
    setFeatures(prev => prev.map(f => {
      const match = editedGeos.find(g => JSON.stringify(g.geometry) === JSON.stringify(f.geometry));
      return match ? { ...f, geometry: match.geometry } : f;
    }));
  };

  const handleDeleted = (deletedGeometryKeys) => {
    setFeatures(prev => prev.filter(f => !deletedGeometryKeys.includes(JSON.stringify(f.geometry))));
  };

  const onSaveFeature = (props) => {
    setFeatures(prev => {
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
    const gj = { type: "FeatureCollection", features };
    const blob = new Blob([JSON.stringify(gj, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jena-parking-survey.geojson";
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
        if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
          setFeatures(data.features);
        } else if (data.type === "Feature") {
          setFeatures([data]);
        } else {
          alert("Invalid GeoJSON file.");
        }
      } catch (err) {
        alert("Could not read file.");
      }
    };
    reader.readAsText(file);
  };

  return (
  <div style={{ position:"relative", width:"100%", height:"100vh" }}>
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      scrollWheelZoom
      style={{ width:"100%", height:"90vh", borderRadius:16, boxShadow:"0 6px 20px rgba(0,0,0,0.15)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {boundary && (
        <Polygon
          positions={boundary}
          pathOptions={{ color: "#111827", weight: 2, dashArray: "6 6", fillOpacity: 0.08 }}
          interactive={false}
        />
      )}

      {features.map((f, idx) => {
        const show = filter[f.properties?.category ?? "free"];
        if (!show) return null;
        const coords = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const style = CATEGORY_STYLES[f.properties?.category ?? "free"];
        return (
          <Polyline key={f.properties?._id || idx} positions={coords} pathOptions={style}
            eventHandlers={{ click: () => { setEditingIndex(idx); setEditingFeature(f); } }}>
            <Popup>
              <div style={{fontSize:14}}>
                <div style={{fontWeight:600}}>{f.properties?.street || "Unnamed street"}</div>
                <div>Category: {f.properties?.category}</div>
                {f.properties?.category === "limited" && <div>Time limit: {f.properties?.limitMins} min</div>}
                <div>Spaces: {f.properties?.spaces ?? 0}</div>
                {f.properties?.rules && <div>Rules: {f.properties.rules}</div>}
                {f.properties?.notes && <div>Notes: {f.properties.notes}</div>}
                <div style={{marginTop:6, fontSize:12, color:"#6b7280"}}>Click the line to edit.</div>
              </div>
            </Popup>
          </Polyline>
        );
      })}

      <GeomanDraw onCreated={handleCreated} onEdited={handleEdited} onDeleted={handleDeleted} />
    </MapContainer>

    <Legend />
    <Controls
      features={features}
      setFeatures={setFeatures}
      filter={filter}
      setFilter={setFilter}
      onExport={onExport}
      onImport={onImport}
      setBoundary={setBoundary}
    />

    {editingFeature && (
      <MetadataForm feature={editingFeature} onSave={onSaveFeature} onCancel={onCancelEdit} />
    )}

    <div style={{
      position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
      background:"rgba(255,255,255,0.9)", borderRadius:9999, padding:"8px 12px",
      fontSize:12, boxShadow:"0 4px 12px rgba(0,0,0,0.15)", zIndex:900
    }}>
      Draw a line along a street ➜ Save details ➜ Repeat. Use Export to share the survey as GeoJSON.
    </div>
  </div>
  );
}