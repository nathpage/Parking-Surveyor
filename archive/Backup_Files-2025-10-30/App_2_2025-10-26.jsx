```jsx
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



// ===================== i18n: translations =====================
const translations = {
  en: {
    appTitle: "Parking Survey",
    subtitle: "Draw segments along streets and tag them. Use the polygon/rectangle tool to draw the study area.",
    legend: "Legend",
    category: {
      free: "Free (anyone)",
      residents: "Residents only",
      limited: "Limited time",
    },
    approxSpaces: "Approx. spaces by category",
    measuredLength: "Measured length by category",
    exportGeoJSON: "Export GeoJSON",
    import: "Import",
    exportPDF: "Export PDF",
    exportWord: "Export Word",
    clearAll: "🗑️ Clear all data",
    clearStudy: "Clear study area",
    autosaveInfo: "Data is autosaved to your browser. Export to share or back up.",
    drawHint:
      "Draw a line along a street ➜ Save details ➜ Repeat. Use the polygon/rectangle tool to draw the study area.",

    pdf: {
      title: "Jena Parking Survey",
      subtitle: "Grete-Unrein-Str. / Forstweg / Lutherstraße and vicinity",
      generated: "Generated",
      studyArea: "Study area included",
      summary: "Summary",
      segments: "Segments",
      totalSpacesFree: "Total spaces (Free)",
      totalSpacesResidents: "Total spaces (Residents)",
      totalSpacesLimited: "Total spaces (Limited)",
      metric: "Metric",
      value: "Value",
      field_category: "Category",
      field_spaces: "Spaces",
      field_rules: "Rules / Hours",
      field_notes: "Notes",
      field_timelimit: "Time limit (mins)",
      footerPreparedBy: "Survey prepared by:",
    },
  },

  de: {
    appTitle: "Parkraumerhebung",
    subtitle:
      "Zeichnen Sie Abschnitte entlang der Straßen und markieren Sie diese. Verwenden Sie das Polygon- oder Rechteck-Werkzeug, um das Untersuchungsgebiet festzulegen.",
    legend: "Legende",
    category: {
      free: "Frei (öffentlich)",
      residents: "Nur Anwohner",
      limited: "Begrenzt (zeitlich)",
    },
    approxSpaces: "Geschätzte Stellplätze nach Kategorie",
    measuredLength: "Gemessene Länge nach Kategorie",
    exportGeoJSON: "GeoJSON exportieren",
    import: "Importieren",
    exportPDF: "PDF exportieren",
    exportWord: "Word exportieren",
    clearAll: "🗑️ Alle Daten löschen",
    clearStudy: "Untersuchungsgebiet löschen",
    autosaveInfo:
      "Daten werden automatisch im Browser gespeichert. Exportieren Sie zum Teilen oder Sichern.",
    drawHint:
      "Zeichnen Sie Linien entlang der Straßen ➜ Details speichern ➜ Wiederholen. Nutzen Sie den Export zum Teilen der Erhebung.",

    pdf: {
      title: "Parkraumerhebung Jena",
      subtitle: "Grete-Unrein-Straße / Forstweg / Lutherstraße und Umgebung",
      generated: "Erstellt am",
      studyArea: "Untersuchungsgebiet enthalten",
      summary: "Zusammenfassung",
      segments: "Straßenabschnitte",
      totalSpacesFree: "Gesamtzahl Stellplätze (Frei)",
      totalSpacesResidents: "Gesamtzahl Stellplätze (Anwohner)",
      totalSpacesLimited: "Gesamtzahl Stellplätze (Begrenzt)",
      metric: "Merkmal",
      value: "Wert",
      field_category: "Kategorie",
      field_spaces: "Stellplätze",
      field_rules: "Regeln / Zeiten",
      field_notes: "Notizen",
      field_timelimit: "Zeitbegrenzung (Minuten)",
      footerPreparedBy: "Erhebung erstellt von:",
    },
  },
};



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


export async function exportDocx({ features, boundary, lang = "en" }) {
  const t = translations[lang].pdf;

  const styles = {
    h1: (txt) =>
      new Paragraph({
        text: txt,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 120 },
      }),
    h2: (txt) =>
      new Paragraph({
        text: txt,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 160, after: 80 },
      }),
    title: new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(t.title)],
      spacing: { after: 300 },
      alignment: AlignmentType.CENTER,
    }),
    subtitle: (txt) =>
      new Paragraph({
        children: [new TextRun({ text: txt, italics: true })],
        spacing: { after: 200 },
        alignment: AlignmentType.CENTER,
      }),
    small: (txt) =>
      new Paragraph({
        children: [new TextRun({ text: txt, size: 18 })],
      }),
    caption: (txt) =>
      new Paragraph({
        children: [new TextRun({ text: txt, italics: true, size: 18, color: "555555" })],
        spacing: { after: 120 },
      }),
    spacer: new Paragraph({ children: [new TextRun("")], spacing: { after: 120 } }),
  };

  const children = [];
  children.push(
    styles.title,
    styles.subtitle(t.subtitle),
    styles.small(`${t.generated}: ${new Date().toLocaleString()}`)
  );
  if (boundary?.length >= 3) children.push(styles.small(t.studyArea));

  // summary
  const totals = { free: 0, residents: 0, limited: 0 };
  for (const f of features) {
    const c = f.properties?.category;
    const n = Number(f.properties?.spaces) || 0;
    if (c && totals[c] != null) totals[c] += n;
  }

  children.push(
    styles.h1(t.summary),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({ children: [new Paragraph(t.metric)] }),
            new TableCell({ children: [new Paragraph(t.value)] }),
          ],
        }),
        ...[
          [t.segments, String(features.length)],
          [t.totalSpacesFree, String(totals.free)],
          [t.totalSpacesResidents, String(totals.residents)],
          [t.totalSpacesLimited, String(totals.limited)],
        ].map(
          ([k, v]) =>
            new TableRow({
              children: [new TableCell({ children: [new Paragraph(k)] }), new TableCell({ children: [new Paragraph(v)] })],
            })
        ),
      ],
    }),
    styles.spacer
  );

  // segments
  const items = [...features].sort((a, b) =>
    (a.properties?.street ?? "").localeCompare(b.properties?.street ?? "")
  );

  for (const f of items) {
    const p = f.properties || {};
    const imgs = Array.isArray(p.images) ? p.images : [];
    const first = imgs[0];

    children.push(styles.h2(p.street || "Unnamed street"));

    const rows = [
      [t.field_category, p.category || ""],
      [t.field_spaces, String(p.spaces ?? "")],
      ...(p.category === "limited" ? [[t.field_timelimit, String(p.limitMins ?? "")]] : []),
      [t.field_rules, p.rules || ""],
      [t.field_notes, p.notes || ""],
    ];

    const metaTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                children: [new Paragraph(k)],
              }),
              new TableCell({
                width: { size: 70, type: WidthType.PERCENTAGE },
                children: [new Paragraph(v)],
              }),
            ],
          })
      ),
    });

    if (first) {
      const imgData = await dataUrlToUint8Array(first.dataUrl);
      const twoCol = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, children: [metaTable] }),
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: [new ImageRun({ data: imgData, transformation: { width: 320, height: 220 } })],
                  }),
                ],
              }),
            ],
          }),
        ],
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
        const cells = await Promise.all(
          pair.map(async (img) => {
            try {
              const data = await dataUrlToUint8Array(img.dataUrl);
              return new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ children: [new ImageRun({ data, transformation: { width: 260, height: 180 } })] }),
                  img.caption
                    ? new Paragraph({ children: [new TextRun({ text: img.caption, italics: true, size: 18 })] })
                    : new Paragraph("")
                ],
              });
            } catch {
              return new TableCell({ children: [new Paragraph("Image could not be embedded")] });
            }
          })
        );
        if (cells.length === 1) cells.push(new TableCell({ children: [new Paragraph("")] }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cells })] }));
      }
    }

    children.push(styles.spacer);
  }

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, lang === "de" ? "parkraumerhebung-jena.docx" : "jena-parking-survey.docx");
}


async function exportPdf({ features, boundary, lang = "en" }) {
  const t = translations[lang].pdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const nowLabel = `${t.generated}: ${new Date().toLocaleString()}`;

  // Cover
  doc.setFontSize(20);
  doc.text(t.title, pageW / 2, 30, { align: "center" });
  doc.setFontSize(12);
  doc.text(t.subtitle, pageW / 2, 40, { align: "center" });
  doc.text(nowLabel, pageW / 2, 48, { align: "center" });
  if (boundary?.length >= 3) doc.text(t.studyArea, pageW / 2, 56, { align: "center" });
  doc.addPage();

  // Summary
  const totals = { free: 0, residents: 0, limited: 0 };
  features.forEach((f) => {
    const c = f.properties?.category;
    const n = Number(f.properties?.spaces) || 0;
    if (c && totals[c] != null) totals[c] += n;
  });

  doc.setFontSize(16);
  doc.text(t.summary, 14, 18);
  autoTable(doc, {
    startY: 24,
    head: [[t.metric, t.value]],
    body: [
      [t.segments, String(features.length)],
      [t.totalSpacesFree, String(totals.free)],
      [t.totalSpacesResidents, String(totals.residents)],
      [t.totalSpacesLimited, String(totals.limited)],
    ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fillColor: [17, 24, 39] },
  });

  let y = (doc.lastAutoTable?.finalY || 24) + 10;
  if (y > pageH - 40) {
    doc.addPage();
    y = 18;
  }

  // Sort by street
  const items = [...features].sort((a, b) =>
    (a.properties?.street ?? "").localeCompare(b.properties?.street ?? "")
  );

  for (const f of items) {
    const p = f.properties || {};
    doc.setFontSize(14);
    doc.text(p.street || "Unnamed street", 14, y);
    y += 6;

    const imgs = Array.isArray(p.images) ? p.images : [];

    const imgBoxW = 60; // image column width
    const textBoxW = pageW - imgBoxW - 28;
    const tableX = 14;

    autoTable(doc, {
      startY: y,
      head: [[t.metric, t.value]],
      body: [
        [t.field_category, p.category || ""],
        [t.field_spaces, String(p.spaces ?? "")],
        ...(p.category === "limited" ? [[t.field_timelimit, String(p.limitMins ?? "")]] : []),
        [t.field_rules, p.rules || ""],
        [t.field_notes, p.notes || ""],
      ],
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 1.5 },
      tableWidth: textBoxW,
      margin: { left: tableX, right: imgBoxW + 14 },
      columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: textBoxW - 45 } },
    });

    const tableBottomY = doc.lastAutoTable.finalY;
    const topY = y;
    y = tableBottomY + 4;

    if (imgs.length > 0) {
      const img = imgs[0];
      const imgX = pageW - imgBoxW - 14;
      const imgY = topY;
      const maxH = Math.min(60, tableBottomY - topY);
      try {
        doc.addImage(img.dataUrl, "JPEG", imgX, imgY, imgBoxW, maxH, undefined, "FAST");
      } catch {
        try {
          doc.addImage(img.dataUrl, "PNG", imgX, imgY, imgBoxW, maxH, undefined, "FAST");
        } catch {}
      }
      if (img.caption) {
        doc.setFontSize(9);
        doc.text(String(img.caption), imgX, imgY + maxH + 4, { maxWidth: imgBoxW });
      }
    }

    if (imgs.length > 1) {
      const subImgs = imgs.slice(1);
      let subY = y;
      const maxW = (pageW - 28 - 6) / 2;
      const maxH = 55;
      for (let i = 0; i < subImgs.length; i++) {
        if (subY + maxH + 14 > pageH) {
          doc.addPage();
          subY = 18;
        }
        const col = i % 2;
        const x = 14 + col * (maxW + 6);
        const { dataUrl, caption = "" } = subImgs[i];
        try {
          doc.addImage(dataUrl, "JPEG", x, subY, maxW, maxH, undefined, "FAST");
        } catch {
          try {
            doc.addImage(dataUrl, "PNG", x, subY, maxW, maxH, undefined, "FAST");
          } catch {}
        }
        doc.text(String(caption), x, subY + maxH + 5, { maxWidth: maxW });
        if (col === 1) subY += maxH + 14;
      }
      if (subImgs.length % 2 === 1) subY += maxH + 14;
      y = subY + 6;
    }

    if (y > pageH - 40) {
      doc.addPage();
      y = 18;
    }
  }

  // footer page numbers & signature line
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.text(`${i}/${pages}`, pageW - 18, pageH - 8);
    if (i === pages) {
      doc.text(`${t.footerPreparedBy} ____________________`, 14, pageH - 8);
    }
  }

  doc.save(
    lang === "de" ? "parkraumerhebung-jena.pdf" : "jena-parking-survey.pdf"
  );
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
function Legend({ t }) {
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
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.legend}</div>
      <div><span style={{display:"inline-block",width:24,height:4,background="#22c55e",borderRadius:2,marginRight:8}}/>{t.category.free}</div>
      <div><span style={{display:"inline-block",width:24,height:4,background="#ef4444",borderRadius:2,marginRight:8}}/>{t.category.residents}</div>
      <div><span style={{display:"inline-block",width:24,height:4,background="#f59e0b",borderRadius:2,marginRight:8}}/>{t.category.limited}</div>
    </div>
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
        width: 340,
        background: "rgba(255,255,255,0.95)",
        borderRadius: 16,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        padding: 16,
        fontSize: 14,
        zIndex: 1000,
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

... (file truncated for brevity)
