import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { saveAs } from "file-saver";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun
} from "docx";
import { translations } from "../i18n";

/* ---------------------- Tiny Helper 1 ---------------------- */
// Converts base64 DataURL (from uploaded image) to Uint8Array for docx embedding
export async function dataUrlToUint8Array(dataUrl) {
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

/* ---------------------- Helper 2 ---------------------- */
// Creates and downloads a PDF report
export async function exportPdf({ features, boundary, lang = "en" }) {
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
  });

  let y = (doc.lastAutoTable?.finalY || 24) + 10;
  if (y > pageH - 40) { doc.addPage(); y = 18; }

  const items = [...features].sort((a, b) =>
    (a.properties?.street ?? "").localeCompare(b.properties?.street ?? "")
  );

  for (const f of items) {
    const p = f.properties || {};
    doc.setFontSize(14);
    doc.text(p.street || "Unnamed street", 14, y);
    y += 6;

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
      tableWidth: pageW - 28,
      margin: { left: 14, right: 14 },
    });

    y = (doc.lastAutoTable?.finalY || y) + 8;
    if (y > pageH - 40) { doc.addPage(); y = 18; }
  }

  doc.save(lang === "de" ? "parkraumerhebung-jena.pdf" : "jena-parking-survey.pdf");
}


/* ---------------------- Helper 3 ---------------------- */
// Creates and downloads a DOCX report
export async function exportDocx({ features, boundary, lang = "en" }) {
  const t = translations[lang].pdf;

  const children = [
    new Paragraph({
      text: t.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 300 },
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: t.subtitle, italics: true })],
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun(`${t.generated}: ${new Date().toLocaleString()}`)],
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
    }),
    ...(boundary?.length >= 3
      ? [new Paragraph({ children: [new TextRun(t.studyArea)] })]
      : []),
  ];

  // Summary
  const totals = { free: 0, residents: 0, limited: 0 };
  for (const f of features) {
    const c = f.properties?.category;
    const n = Number(f.properties?.spaces) || 0;
    if (c && totals[c] != null) totals[c] += n;
  }

  children.push(
    new Paragraph({ text: t.summary, heading: HeadingLevel.HEADING_1 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
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
    })
  );

  // Per-segment
  const items = [...features].sort((a, b) =>
    (a.properties?.street ?? "").localeCompare(b.properties?.street ?? "")
  );

  for (const f of items) {
    const p = f.properties || {};
    children.push(new Paragraph({ text: p.street || "Unnamed street", heading: HeadingLevel.HEADING_2 }));

    const rows = [
      [t.field_category, p.category || ""],
      [t.field_spaces, String(p.spaces ?? "")],
      ...(p.category === "limited" ? [[t.field_timelimit, String(p.limitMins ?? "")]] : []),
      [t.field_rules, p.rules || ""],
      [t.field_notes, p.notes || ""],
    ];

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(
          ([k, v]) =>
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph(k)] }),
                new TableCell({ children: [new Paragraph(v)] }),
              ],
            })
        ),
      })
    );

    // (Optional) embed first image if present
    const first = Array.isArray(p.images) ? p.images[0] : null;
    if (first?.dataUrl) {
      try {
        const imgData = await dataUrlToUint8Array(first.dataUrl);
        children.push(new Paragraph({
          children: [new ImageRun({ data: imgData, transformation: { width: 320, height: 220 } })],
        }));
        if (first.caption) children.push(new Paragraph({ children: [new TextRun({ text: first.caption, italics: true })] }));
      } catch {}
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, lang === "de" ? "parkraumerhebung-jena.docx" : "jena-parking-survey.docx");
}