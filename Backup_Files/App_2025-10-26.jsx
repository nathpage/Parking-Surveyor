import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, FeatureGroup, Polyline, Popup, useMap, Rectangle, Polygon } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getPathLength } from "geolib";


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

import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, Media, ImageRun } from "docx";
import { saveAs } from "file-saver";

function safe(text) { return (text ?? "").toString(); }

// helper: dataURL -> Uint8Array
async function dataUrlToUint8Array(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    const [, base64] = dataUrl.split(",");
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
}

export async function exportDocx({ features, boundary }) {
  const styles = {
    h1: (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 120 } }),
    h2: (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 80 } }),
    title: new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun("Jena Parking Survey")],
      spacing: { after: 300 },
      alignment: AlignmentType.CENTER,
    }),
    subtitle: (t) => new Paragraph({
      children: [new TextRun({ text: t, italics: true })],
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
    }),
    small: (t) => new Paragraph({ children: [new TextRun({ text: t, size: 18 })] }),
    caption: (t) => new Paragraph({
      children: [new TextRun({ text: t, italics: true, size: 18, color: "555555" })],
      spacing: { after: 120 },
    }),
    spacer: new Paragraph({ children: [new TextRun("")], spacing: { after: 120 } }),
  };

  const children = [];
  children.push(
    styles.title,
    styles.subtitle("Grete-Unrein-Str. / Forstweg / Lutherstraße and vicinity"),
    styles.small(`Generated: ${new Date().toLocaleString()}`),
  );
  if (boundary?.length >= 3) children.push(styles.small("Study area defined by surveyor."));

  // Summary
  const totals = { free: 0, residents: 0, limited: 0 };
  for (const f of features) {
    const c = f.properties?.category;
    const n = Number(f.properties?.spaces) || 0;
    if (c && totals[c] != null) totals[c] += n;
  }
  children.push(
    styles.h1("Summary"),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [new TableCell({ children: [new Paragraph("Metric")] }),
                     new TableCell({ children: [new Paragraph("Value")] })],
        }),
        ...[
          ["Segments", String(features.length)],
          ["Total spaces (Free)", String(totals.free)],
          ["Total spaces (Residents)", String(totals.residents)],
          ["Total spaces (Limited)", String(totals.limited)],
        ].map(([k, v]) => new TableRow({
          children: [new TableCell({ children: [new Paragraph(k)] }),
                     new TableCell({ children: [new Paragraph(v)] })],
        })),
      ],
    }),
    styles.spacer
  );

  // Segments
  const items = [...features].sort((a, b) =>
    safe(a.properties?.street).localeCompare(safe(b.properties?.street))
  );

  for (const f of items) {
    const p = f.properties || {};
    const imgs = Array.isArray(p.images) ? p.images : [];
    const first = imgs[0];

    children.push(styles.h2(safe(p.street) || "Unnamed street"));

    const rows = [
      ["Category", safe(p.category)],
      ["Spaces", String(p.spaces ?? "")],
      ...(p.category === "limited" ? [["Time limit (mins)", String(p.limitMins ?? "")]] : []),
      ["Rules / Hours", safe(p.rules)],
      ["Notes", safe(p.notes)],
    ];
    const metaTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: rows.map(([k, v]) =>
        new TableRow({
          children: [
            new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph(k)] }),
            new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [new Paragraph(v)] }),
          ],
        })
      ),
    });

    if (first) {
      const imgData = await dataUrlToUint8Array(first.dataUrl);
      const imgW = 320, imgH = 220; // px

      const twoCol = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({
          children: [
            new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, children: [metaTable] }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: [ new ImageRun({ data: imgData, transformation: { width: imgW, height: imgH } }) ],
                }),
              ],
            }),
          ],
        })],
      });

      children.push(twoCol);
      if (first.caption) children.push(styles.caption(first.caption));
    } else {
      children.push(metaTable);
    }

    if (imgs.length > 1) {
      const rest = imgs.slice(1);
      for (let i = 0; i < rest.length; i += 2) {
        const pair = rest.slice(i, i + 2);
        const cells = await Promise.all(pair.map(async (img) => {
          try {
            const data = await dataUrlToUint8Array(img.dataUrl);
            return new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ children: [ new ImageRun({ data, transformation: { width: 260, height: 180 } }) ] }),
                img.caption ? new Paragraph({ children: [ new TextRun({ text: img.caption, italics: true, size: 18 }) ] }) : new Paragraph(""),
              ],
            });
          } catch {
            return new TableCell({ children: [ new Paragraph("Image could not be embedded") ] });
          }
        }));
        if (cells.length === 1) cells.push(new TableCell({ children: [new Paragraph("")] }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [ new TableRow({ children: cells }) ] }));
      }
    }

    children.push(styles.spacer);
  }

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, "jena-parking-survey.docx");
}

async function exportPdf({ features, boundary }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const now = new Date().toLocaleString();

  // Cover
  doc.setFontSize(20);
  doc.text("Jena Parking Survey", pageW/2, 30, { align: "center" });
  doc.setFontSize(12);
  doc.text("Grete-Unrein-Str. / Forstweg / Lutherstraße and vicinity", pageW/2, 40, { align: "center" });
  doc.text(`Generated: ${now}`, pageW/2, 48, { align: "center" });
  if (boundary?.length >= 3) doc.text("Study area included", pageW/2, 56, { align: "center" });
  doc.addPage();

  // Summary
  const totals = { free: 0, residents: 0, limited: 0 };
  features.forEach(f => {
    const c = f.properties?.category;
    const n = Number(f.properties?.spaces) || 0;
    if (c && totals[c] != null) totals[c] += n;
  });

  doc.setFontSize(16);
  doc.text("Summary", 14, 18);
  autoTable(doc, {
    startY: 24,
    head: [["Metric", "Value"]],
    body: [
      ["Segments", String(features.length)],
      ["Total spaces (Free)", String(totals.free)],
      ["Total spaces (Residents)", String(totals.residents)],
      ["Total spaces (Limited)", String(totals.limited)],
    ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fillColor: [17,24,39] },
  });

  let y = (doc.lastAutoTable?.finalY || 24) + 10;
  if (y > pageH - 40) { doc.addPage(); y = 18; }

  // Sort by street
  const items = [...features].sort((a,b)=>safe(a.properties?.street).localeCompare(safe(b.properties?.street)));

  for (const f of items) {
    const p = f.properties || {};
    doc.setFontSize(14);
    doc.text(safe(p.street) || "Unnamed street", 14, y);
    y += 6;

    const imgs = Array.isArray(p.images) ? p.images : [];

    // Define space for text (left) and image (right)
    const imgBoxW = 60; // width reserved for image column
    const textBoxW = pageW - imgBoxW - 28; // left margin 14, right margin 14
    const tableX = 14;

    autoTable(doc, {
      startY: y,
      head: [["Field", "Value"]],
      body: [
        ["Category", safe(p.category)],
        ["Spaces", String(p.spaces ?? "")],
        ...(p.category === "limited" ? [["Time limit (mins)", String(p.limitMins ?? "")]] : []),
        ["Rules / Hours", safe(p.rules)],
        ["Notes", safe(p.notes)],
      ],
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 1.5 },
      tableWidth: textBoxW,
      margin: { left: tableX, right: imgBoxW + 14 },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: textBoxW - 35 },
      },
    });

    const tableBottomY = doc.lastAutoTable.finalY;
    const topY = y;
    y = tableBottomY + 4;

    // Add first image to the right of the table
    if (imgs.length > 0) {
      const img = imgs[0];
      const imgX = pageW - imgBoxW - 14;
      const imgY = topY;
      const maxH = Math.min(60, tableBottomY - topY); // fit vertically
      try {
        doc.addImage(img.dataUrl, "JPEG", imgX, imgY, imgBoxW, maxH, undefined, "FAST");
      } catch {
        try { doc.addImage(img.dataUrl, "PNG", imgX, imgY, imgBoxW, maxH, undefined, "FAST"); } catch {}
      }
      if (img.caption) {
        doc.setFontSize(9);
        doc.text(safe(img.caption), imgX, imgY + maxH + 4, { maxWidth: imgBoxW });
      }
    }

    // Add any remaining images below the table (optional)
    if (imgs.length > 1) {
      const subImgs = imgs.slice(1);
      let subY = y;
      const maxW = (pageW - 28 - 6) / 2;
      const maxH = 55;
      for (let i = 0; i < subImgs.length; i++) {
        if (subY + maxH + 14 > pageH) { doc.addPage(); subY = 18; }
        const col = i % 2;
        const x = 14 + col * (maxW + 6);
        const { dataUrl, caption = "" } = subImgs[i];
        try {
          doc.addImage(dataUrl, "JPEG", x, subY, maxW, maxH, undefined, "FAST");
        } catch {
          try { doc.addImage(dataUrl, "PNG", x, subY, maxW, maxH, undefined, "FAST"); } catch {}
        }
        doc.text(safe(caption), x, subY + maxH + 5, { maxWidth: maxW });
        if (col === 1) subY += maxH + 14;
      }
      if (subImgs.length % 2 === 1) subY += maxH + 14;
      y = subY + 6;
    }

    if (y > pageH - 40) { doc.addPage(); y = 18; }
  }

  doc.save("jena-parking-survey.pdf");
}


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

function Controls({
  features,
  setFeatures,
  filter,
  setFilter,
  onExport,
  onImport,
  setBoundary,
  boundary,            // <— NEW: pass this prop from parent
}) {
  const totals = React.useMemo(() => {
    const t = { free: 0, residents: 0, limited: 0 };
    for (const f of features) {
      if (f?.properties?.category && Number.isFinite(f?.properties?.spaces)) {
        t[f.properties.category] += f.properties.spaces;
      }
    }
    return t;
  }, [features]);

  const meters = React.useMemo(() => {
    const m = { free: 0, residents: 0, limited: 0 };
    for (const f of features) {
      const c = f.properties?.category;
      if (c && m[c] != null) m[c] += Number(f.properties?.length_m || 0);
    }
    return m;
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

      {/* NEW: Export PDF */}
      <button
        onClick={() => exportPdf({ features, boundary })}
        style={{ marginTop: 10, padding: "8px 12px", borderRadius: 12, background: "#111827", color: "#fff", border: "none" }}
        title="Generate a committee-ready PDF report"
      >
        Export PDF
      </button>

      <button
        onClick={() => exportDocx({ features, boundary })}
        style={{
          marginTop: 10,
          padding: "8px 12px",
          borderRadius: 12,
          background: "#2563eb",
          color: "#fff",
          border: "none",
        }}
      >
        Export Word
      </button>

      <button
        onClick={() => {
          if (window.confirm("Are you sure you want to delete all saved data and start over?")) {
            localStorage.removeItem("jena-parking-features-v1");
            setFeatures([]);
            setBoundary(null);
          }
        }}
        style={{
          marginTop: 8,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#fee2e2", 
          borderColor: "#fca5a5", 
          color: "#b91c1c",
        }}
        title="Delete all locally saved annotations and reset the map"
      >
        🗑️ Clear all data
      </button>

      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
        Data is autosaved to your browser. Export to share or back up.
      </div>
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
    localStorage.setItem(
      "jena-parking-features-v1",
      JSON.stringify({ features, boundary })
    );
  }, [features, boundary]);
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
      const fid = crypto.randomUUID();
      layer._fid = fid;

      const geo = layer.toGeoJSON();

      if (shape === "Line") {
        // DO NOT keep the draw layer on the map; React will render the colored Polyline
        onCreated(geo, layer, "polyline", fid);
        layer.remove();       // <— this removes the blue line
      } else if (shape === "Polygon") {
        onCreated(geo, layer, "polygon", fid);
        layer.remove();
      } else if (shape === "Rectangle") {
        onCreated(geo, layer, "rectangle", fid);
        layer.remove();
      }
    });

    // single-layer edit callbacks
    map.on("pm:edit", (e) => {
      const layer = e.layer;
      if (!layer || !layer._fid) return;
      onEdited([{ _fid: layer._fid, geo: layer.toGeoJSON() }]);
    });

    map.on("pm:remove", (e) => {
      const layer = e.layer;
      if (!layer || !layer._fid) return;
      onDeleted([layer._fid]);
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
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  // Prefer JPEG to keep size down
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

function MetadataForm({ feature, onSave, onCancel }) {
  const [category, setCategory] = useState(feature?.properties?.category || "free");
  const [spaces, setSpaces] = useState(feature?.properties?.spaces ?? 0);
  const [rules, setRules] = useState(feature?.properties?.rules || "");
  const [limitMins, setLimitMins] = useState(feature?.properties?.limitMins ?? 120);
  const [street, setStreet] = useState(feature?.properties?.street || "");
  const [notes, setNotes] = useState(feature?.properties?.notes || "");
  const [images, setImages] = useState(feature?.properties?.images || []); // [{dataUrl, caption}]

  async function handleAddImages(e) {
    const files = Array.from(e.target.files || []).slice(0, 12);
    const dataUrls = [];
    for (const f of files) {
      try {
        dataUrls.push(await compressImage(f, 1280, 0.75));
      } catch {
        dataUrls.push(await fileToDataUrl(f)); // fallback
      }
    }
    const newImgs = dataUrls.map((d) => ({ dataUrl: d, caption: "" }));
    setImages(prev => [...prev, ...newImgs]);
    e.target.value = "";
  }

  function updateCaption(i, val) {
    setImages((prev) => prev.map((img, idx) => (idx === i ? { ...img, caption: val } : img)));
  }

  function removeImage(i) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"grid", placeItems:"center", padding:16, zIndex:1000 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:16, width:"100%", maxWidth:700 }}>
        <div style={{ fontSize:18, fontWeight:600, marginBottom:8 }}>Segment details</div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <label style={{ fontSize:14 }}>Street
            <input style={{ width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 }}
              value={street} onChange={(e)=>setStreet(e.target.value)} placeholder="e.g., Lutherstraße"/>
          </label>

          <label style={{ fontSize:14 }}>Category
            <select style={{ width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 }}
              value={category} onChange={(e)=>setCategory(e.target.value)}>
              <option value="free">Free (anyone)</option>
              <option value="residents">Residents only</option>
              <option value="limited">Limited time</option>
            </select>
          </label>

          <label style={{ fontSize:14 }}>Approx. spaces
            <input
              type="number"
              style={{ width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 }}
              value={spaces}
              onChange={(e)=>{
                setSpaces(parseInt(e.target.value||"0"));
                // mark manual override
                feature.properties = feature.properties || {};
                feature.properties.spacesEdited = true;
              }}
            />
          </label>

	  {feature?.properties?.length_m && (
  	    <label style={{ fontSize: 12, color: "#6b7280" }}>
    	      Estimated length: {feature.properties.length_m} m (≈ {Math.round(feature.properties.length_m / 5.5)} spaces)
  	    </label>
	  )}

          <label style={{ fontSize:14 }}>Time limit (mins)
            <input type="number" disabled={category!=="limited"}
              style={{ width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 }}
              value={limitMins} onChange={(e)=>setLimitMins(parseInt(e.target.value||"0"))}/>
          </label>

          <label style={{ gridColumn:"1 / -1", fontSize:14 }}>Rules / Hours
            <input style={{ width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 }}
              value={rules} onChange={(e)=>setRules(e.target.value)} placeholder="e.g., Residents Mo–Fr 8–18h; free otherwise"/>
          </label>

          <label style={{ gridColumn:"1 / -1", fontSize:14 }}>Notes
            <textarea rows={3} style={{ width:"100%", marginTop:6, padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 }}
              value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Observations, signage, construction, etc."/>
          </label>

          {/* Images */}
          <div style={{ gridColumn:"1 / -1" }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Photos</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
              {images.map((img, i) => (
                <div key={i} style={{ width:150 }}>
                  <img src={img.dataUrl} alt={`photo-${i}`} style={{ width:"100%", height:100, objectFit:"cover", borderRadius:8, border:"1px solid #eee" }}/>
                  <input
                    placeholder="Caption (optional)"
                    value={img.caption}
                    onChange={(e)=>updateCaption(i, e.target.value)}
                    style={{ width:"100%", marginTop:6, padding:"4px 6px", border:"1px solid #ddd", borderRadius:6, fontSize:12 }}
                  />
                  <button onClick={()=>removeImage(i)} style={{ marginTop:4, fontSize:12, border:"1px solid #eee", borderRadius:6, background:"#fff", padding:"4px 6px" }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <label style={{ padding:"8px 12px", borderRadius:8, background:"#e5e7eb", cursor:"pointer", display:"inline-block" }}>
              Add photos
              <input type="file" accept="image/*" multiple style={{ display:"none" }} onChange={handleAddImages}/>
            </label>
          </div>
        </div>

        <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:12 }}>
          <button onClick={onCancel}>Cancel</button>
          <button
            style={{ background:"#111827", color:"#fff", border:"none", padding:"8px 12px", borderRadius:12 }}
            onClick={()=>onSave({ category, spaces, rules, limitMins, street, notes, images })}
          >
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

  useAutosave(features, setFeatures, boundary, setBoundary);

  const handleCreated = (geo, layer, layerType, fid) => {
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
  	const coords = geo.geometry.coordinates; // [ [lng, lat], ... ]
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

  	// Push immediately so totals & colored line update at once
  	setFeatures(prev => {
    	  const idx = prev.length;
    	  // open the form on this new feature
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

  const handleEdited = (edits) => {
    setFeatures(prev =>
      prev.map(f => {
        const id = f?.properties?._id;
        const hit = edits.find(e => e._fid === id);
        if (!hit) return f;

        const coords = hit.geo.geometry.coordinates;
        const points = coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
        const newLen = getPathLength(points);
        const next = { ...f, geometry: hit.geo.geometry, properties: { ...f.properties } };

        next.properties.length_m = Math.round(newLen);
        if (!next.properties.spacesEdited) {
          next.properties.spaces = Math.max(1, Math.round(newLen / 5.5));
        }
        return next;
      })
    );
  };

  const handleDeleted = (deletedIds) => {
    setFeatures(prev => prev.filter(f => f?.properties?._id && !deletedIds.includes(f.properties._id)));
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
    const payload = {
      type: "Survey",
      version: 1,
      features,
      boundary,        // save as [[lat,lng], ...]
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
		<div>Length: {f.properties?.length_m ?? 0} m {f.properties?.spacesEdited ? "(manual spaces)" : "(auto spaces)"}</div>
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
      boundary={boundary}
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