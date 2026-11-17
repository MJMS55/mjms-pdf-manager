import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import { movePage, exportPdf } from "../src/pdf.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, readdir } from "node:fs/promises";
import PhpParser from "php-parser";

async function source(labels) {
  const doc = await PDFDocument.create();
  for (const [i, label] of labels.entries()) {
    const page = doc.addPage([300 + i * 20, 400]);
    page.drawText(label, { x: 30, y: 300 });
  }
  return { doc };
}
async function textOf(bytes) {
  const loading = getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loading.promise;
  const result = [];
  for (let i = 1; i <= pdf.numPages; i++)
    result.push(
      (await (await pdf.getPage(i)).getTextContent()).items
        .map((x) => x.str)
        .join(" "),
    );
  await loading.destroy();
  return result;
}
test("Fusion, suppression et déplacement préservent le contenu et les dimensions", async () => {
  const a = await source(["Première", "Deuxième"]),
    b = await source(["Troisième"]);
  const rows = [
    { source: a, index: 0, annotations: [] },
    { source: a, index: 1, annotations: [] },
    { source: b, index: 0, annotations: [] },
  ];
  const reordered = movePage(rows, 2, 0);
  const final = reordered.filter((_, i) => i !== 1);
  const bytes = await exportPdf(final);
  assert.deepEqual(await textOf(bytes), ["Troisième", "Deuxième"]);
  const result = await PDFDocument.load(bytes);
  assert.equal(result.getPage(1).getWidth(), 320);
  assert.equal(a.doc.getPageCount(), 2);
});
test("Annotations texte, dessin et surlignage sont intégrées au PDF", async () => {
  const s = await source(["Original"]);
  const annotations = [
    {
      type: "text",
      text: "Validé été",
      point: [20, 200],
      size: 16,
      color: "#1565c0",
    },
    { type: "highlight", start: [20, 210], end: [130, 230], color: "#ffee00" },
    {
      type: "pen",
      points: [
        [20, 100],
        [100, 140],
      ],
      size: 16,
      color: "#cc0000",
    },
  ];
  const bytes = await exportPdf([{ source: s, index: 0, annotations }]);
  assert.match((await textOf(bytes))[0], /Validé été/);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.ok(bytes.length > 500);
});
test("Pages pivotées et rognées conservent leur géométrie", async () => {
  const s = await source(["Rotation"]);
  s.doc.getPage(0).setRotation(degrees(90));
  s.doc.getPage(0).setCropBox(10, 20, 250, 300);
  const bytes = await exportPdf([
    {
      source: s,
      index: 0,
      annotations: [
        {
          type: "text",
          text: "Note",
          point: [50, 70],
          size: 12,
          color: "#000000",
        },
      ],
    },
  ]);
  const result = await PDFDocument.load(bytes);
  assert.equal(result.getPage(0).getRotation().angle, 90);
  assert.deepEqual(result.getPage(0).getCropBox(), {
    x: 10,
    y: 20,
    width: 250,
    height: 300,
  });
  assert.match((await textOf(bytes))[0], /Note/);
});
test("Document vide refusé et déplacement hors limites sans effet", async () => {
  await assert.rejects(exportPdf([]));
  const p = [1, 2];
  assert.deepEqual(movePage(p, 0, -1), p);
  assert.deepEqual(movePage(p, 2, 0), p);
});
test("Tous les fichiers PHP sont syntaxiquement valides", async () => {
  const parser = new PhpParser({
    parser: { version: "8.3", suppressErrors: false },
  });
  for (const dir of ["appinfo", "lib/AppInfo", "lib/Controller", "templates"])
    for (const name of await readdir(dir))
      if (name.endsWith(".php"))
        parser.parseCode(await readFile(`${dir}/${name}`, "utf8"), name);
});

test("Le surlignage et le dessin sont visibles dans le rendu exporté", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await exportPdf([
    {
      source: { doc },
      index: 0,
      annotations: [
        { type: "highlight", start: [10, 20], end: [40, 50], color: "#ffff00" },
        {
          type: "pen",
          points: [
            [60, 80],
            [100, 80],
          ],
          size: 16,
          color: "#ff0000",
        },
      ],
    },
  ]);
  const loading = getDocument({ data: bytes, isEvalSupported: false });
  const pdf = await loading.promise,
    page = await pdf.getPage(1);
  const canvas = createCanvas(200, 200),
    ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale: 1 }),
  }).promise;
  const yellow = ctx.getImageData(20, 165, 1, 1).data,
    red = ctx.getImageData(80, 120, 1, 1).data;
  assert.ok(yellow[0] > 240 && yellow[1] > 240 && yellow[2] < 220);
  assert.ok(red[0] > 200 && red[1] < 80 && red[2] < 80);
  await loading.destroy();
});

test("La suppression individuelle préserve les autres annotations dans le PDF exporté", async () => {
  const { removeAnnotation } = await import("../src/pdf.js");
  const sourceDoc = await source(["Original"]);
  const annotations = ["Conserver", "Supprimer", "Encore présent"].map(
    (text, i) => ({
      type: "text",
      text,
      point: [20, 240 - i * 25],
      size: 14,
      color: "#000000",
    }),
  );
  const remaining = removeAnnotation(annotations, 1);
  assert.equal(annotations.length, 3);
  assert.equal(remaining.length, 2);
  const bytes = await exportPdf([
    { source: sourceDoc, index: 0, annotations: remaining },
  ]);
  const text = (await textOf(bytes))[0];
  assert.match(text, /Conserver/);
  assert.match(text, /Encore présent/);
  assert.doesNotMatch(text, /Supprimer/);
});
