import { widthOf, alphaOf } from "./annotations.js";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 300;
export function movePage(pages, from, to) {
  if (from < 0 || to < 0 || from >= pages.length || to >= pages.length)
    return pages;
  const result = [...pages];
  const [page] = result.splice(from, 1);
  result.splice(to, 0, page);
  return result;
}
export function colorRgb(hex) {
  return rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
}
export async function exportPdf(pages) {
  if (!pages.length) throw new Error("Ajoutez au moins une page.");
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const clean = await PDFDocument.create();
  for (const item of pages) {
    const [page] = await output.copyPages(item.source.doc, [item.index]);
    output.addPage(page);
    const [base] = await clean.copyPages(item.source.doc, [item.index]);
    clean.addPage(base);
    for (const a of item.annotations) {
      const color = colorRgb(a.color);
      if (a.type === "text")
        page.drawText(a.text, {
          x: a.point[0],
          y: a.point[1],
          size: a.size,
          font,
          color,
          opacity: alphaOf(a),
          rotate: degrees(page.getRotation().angle),
          lineHeight: a.size * 1.2,
        });
      if (a.type === "highlight")
        page.drawRectangle({
          x: Math.min(a.start[0], a.end[0]),
          y: Math.min(a.start[1], a.end[1]),
          width: Math.abs(a.end[0] - a.start[0]),
          height: Math.abs(a.end[1] - a.start[1]),
          color,
          opacity: alphaOf(a),
        });
      if (a.type === "pen")
        for (let i = 1; i < a.points.length; i++)
          page.drawLine({
            start: { x: a.points[i - 1][0], y: a.points[i - 1][1] },
            end: { x: a.points[i][0], y: a.points[i][1] },
            thickness:
              (widthOf(a) *
                ((a.pressures?.[i] ?? 1) + (a.pressures?.[i - 1] ?? 1))) /
              2,
            opacity: alphaOf(a),
            color,
          });
      if (["rectangle", "circle", "line", "arrow"].includes(a.type)) {
        const x = Math.min(a.start[0], a.end[0]),
          y = Math.min(a.start[1], a.end[1]),
          w = Math.abs(a.end[0] - a.start[0]),
          h = Math.abs(a.end[1] - a.start[1]);
        const options = {
          borderColor: color,
          borderWidth: widthOf(a),
          borderOpacity: alphaOf(a),
        };
        if (a.type === "rectangle")
          page.drawRectangle({ x, y, width: w, height: h, ...options });
        else if (a.type === "circle")
          page.drawEllipse({
            x: x + w / 2,
            y: y + h / 2,
            xScale: Math.max(0.1, w / 2),
            yScale: Math.max(0.1, h / 2),
            ...options,
          });
        else {
          const line = (p, q) =>
            page.drawLine({
              start: { x: p[0], y: p[1] },
              end: { x: q[0], y: q[1] },
              thickness: widthOf(a),
              color,
              opacity: alphaOf(a),
            });
          line(a.start, a.end);
          if (a.type === "arrow") {
            const angle = Math.atan2(
                a.end[1] - a.start[1],
                a.end[0] - a.start[0],
              ),
              len = Math.max(8, widthOf(a) * 4);
            for (const d of [-0.5, 0.5])
              line(a.end, [
                a.end[0] - len * Math.cos(angle + d),
                a.end[1] - len * Math.sin(angle + d),
              ]);
          }
        }
      }
    }
  }
  // A clean base prevents duplicate painted annotations when reopening an export.
  output.catalog.set(
    PDFName.of("MJMSBase"),
    output.context.register(output.context.flateStream(await clean.save())),
  );
  output.catalog.set(
    PDFName.of("MJMSEditing"),
    output.context.register(
      output.context.flateStream(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            pages: pages.map((p) =>
              p.annotations.map((a) => ({ ...a, size: a.size || 16 })),
            ),
          }),
        ),
      ),
    ),
  );
  output.setProducer("MJMS-PDF-Manager");
  const bytes = await output.save();
  if (bytes.length > MAX_BYTES)
    throw new Error("Le résultat dépasse la limite de 50 Mio.");
  return bytes;
}

export function removeAnnotation(annotations, index) {
  return annotations.filter((_, i) => i !== index);
}

export async function restoreEditing(doc) {
  const base = doc.catalog.lookup(PDFName.of("MJMSBase"));
  const model = doc.catalog.lookup(PDFName.of("MJMSEditing"));
  if (!base && !model) return null;
  if (!(base instanceof PDFRawStream) || !(model instanceof PDFRawStream))
    throw new Error("Données MJMS invalides.");
  const data = decodePDFRawStream(model).decode();
  if (data.length > MAX_BYTES)
    throw new Error("Annotations MJMS trop volumineuses.");
  const state = JSON.parse(new TextDecoder().decode(data));
  const bytes = decodePDFRawStream(base).decode();
  if (
    bytes.length > MAX_BYTES ||
    state.version !== 1 ||
    !Array.isArray(state.pages) ||
    state.pages.length !== doc.getPageCount()
  )
    throw new Error("Version ou pages MJMS invalides.");
  const clean = await PDFDocument.load(bytes);
  if (clean.getPageCount() !== state.pages.length)
    throw new Error("Pages MJMS incohérentes.");
  const point = (p) =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7);
  for (const annotations of state.pages) {
    if (!Array.isArray(annotations) || annotations.length > 10000)
      throw new Error("Annotations MJMS invalides.");
    for (const a of annotations) {
      if (
        !a ||
        ![
          "text",
          "highlight",
          "pen",
          "rectangle",
          "circle",
          "line",
          "arrow",
        ].includes(a.type) ||
        !/^#[0-9a-f]{6}$/i.test(a.color) ||
        !Number.isFinite(a.size) ||
        a.size < 8 ||
        a.size > 96
      )
        throw new Error("Annotation MJMS invalide.");
      if (
        a.width !== undefined &&
        (!Number.isFinite(a.width) || a.width < 0.5 || a.width > 20)
      )
        throw new Error("Épaisseur MJMS invalide.");
      if (
        a.opacity !== undefined &&
        (!Number.isFinite(a.opacity) || a.opacity < 0.05 || a.opacity > 1)
      )
        throw new Error("Opacité MJMS invalide.");
      if (
        a.type === "text"
          ? !point(a.point) || typeof a.text !== "string" || a.text.length > 500
          : a.type === "pen"
            ? !Array.isArray(a.points) ||
              a.points.length > 200000 ||
              !a.points.every(point)
            : !point(a.start) || !point(a.end)
      )
        throw new Error("Géométrie MJMS invalide.");
      if (
        a.pressures !== undefined &&
        (!Array.isArray(a.pressures) ||
          a.pressures.length !== a.points?.length ||
          !a.pressures.every((n) => Number.isFinite(n) && n >= 0.1 && n <= 1))
      )
        throw new Error("Pression MJMS invalide.");
    }
  }
  return { bytes, annotations: state.pages };
}
