import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees, PDFName } from "pdf-lib";
import { exportPdf, restoreEditing } from "../src/pdf.js";
import {
  bounds,
  transform,
  hitAnnotation,
  resizeBox,
} from "../src/annotations.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
test("Editable multipage export preserves the clean source through repeated saves", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  doc.addPage([300, 400]).setRotation(degrees(90));
  const annotations = [
    {
      type: "text",
      point: [30, 80],
      text: "Rééditable",
      size: 16,
      color: "#123456",
      opacity: 0.6,
    },
    {
      type: "pen",
      size: 16,
      width: 3,
      opacity: 0.8,
      color: "#123456",
      points: [
        [10, 10],
        [30, 30],
      ],
      pressures: [0.1, 1],
    },
  ];
  const rows = [
    { source: { doc }, index: 1, annotations },
    { source: { doc }, index: 0, annotations: [] },
  ];
  const first = await PDFDocument.load(await exportPdf(rows));
  const restored = await restoreEditing(first);
  assert.deepEqual(restored.annotations, [annotations, []]);
  const clean = await PDFDocument.load(restored.bytes);
  assert.equal(clean.getPage(0).getRotation().angle, 90);
  const changed = structuredClone(restored.annotations);
  changed[0][0].text = "Modifié";
  const second = await PDFDocument.load(
    await exportPdf(
      changed.map((annotations, index) => ({
        source: { doc: clean },
        index,
        annotations,
      })),
    ),
  );
  const again = await restoreEditing(second);
  assert.equal(again.annotations[0][0].text, "Modifié");
  const loading = getDocument({
    data: again.bytes.slice(),
    isEvalSupported: false,
  });
  const pdf = await loading.promise;
  assert.equal((await (await pdf.getPage(1)).getTextContent()).items.length, 0);
  await loading.destroy();
});
test("Translation and resizing use viewport conversion at zoom and rotation", () => {
  const v = {
    scale: 2,
    convertToViewportPoint: (x, y) => [y * 2, x * 2],
    convertToPdfPoint: (x, y) => [y / 2, x / 2],
  };
  const a = { type: "rectangle", start: [10, 20], end: [30, 40] };
  const b = bounds(a, v);
  assert.deepEqual(
    transform(
      a,
      v,
      b,
      b.map((n) => n + 20),
    ),
    { type: "rectangle", start: [20, 30], end: [40, 50] },
  );
});
test("Shapes export and invalid editing metadata is refused", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  const annotations = ["rectangle", "circle", "line", "arrow", "highlight"].map(
    (type) => ({
      type,
      start: [20, 30],
      end: [100, 150],
      color: "#aabbcc",
      size: 16,
      width: 2,
      opacity: 0.4,
    }),
  );
  const result = await PDFDocument.load(
    await exportPdf([{ source: { doc }, index: 0, annotations }]),
  );
  assert.equal((await restoreEditing(result)).annotations[0].length, 5);
  const invalid = await PDFDocument.load(
    await exportPdf([{ source: { doc }, index: 0, annotations }]),
  );
  invalid.catalog.set(
    PDFName.of("MJMSEditing"),
    invalid.context.register(
      invalid.context.flateStream(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            pages: [[{ ...annotations[0], opacity: 10 }]],
          }),
        ),
      ),
    ),
  );
  await assert.rejects(restoreEditing(invalid));
});

test("Four corners resize text up and down while the opposite corner stays fixed", () => {
  const box = [100, 100, 200, 140];
  for (const [corner, dx, dy, fixed] of [
    ["se", 50, 20, [100, 100]],
    ["nw", -50, -20, [200, 140]],
    ["ne", 50, -20, [100, 140]],
    ["sw", -50, 20, [200, 100]],
  ]) {
    const bigger = resizeBox(box, corner, dx, dy, true, 8, 0.5, 6);
    const smaller = resizeBox(box, corner, -dx / 2, -dy / 2, true, 8, 0.5, 6);
    assert.ok(bigger[2] - bigger[0] > 100);
    assert.ok(smaller[2] - smaller[0] < 100);
    assert.ok([bigger[0], bigger[2]].includes(fixed[0]));
    assert.ok([bigger[1], bigger[3]].includes(fixed[1]));
    assert.ok(
      Math.abs((bigger[2] - bigger[0]) / (bigger[3] - bigger[1]) - 2.5) < 1e-8,
    );
  }
});
test("Hit targets scale from CSS pixels, and text mode selects text over lower annotations", () => {
  const v = { scale: 4, convertToViewportPoint: (x, y) => [x * 4, y * 4] };
  const text = { type: "text", point: [20, 40], text: "Texte", size: 16 };
  const rectangle = { type: "rectangle", start: [0, 0], end: [200, 200] };
  assert.equal(hitAnnotation([text, rectangle], v, [80, 160], 48, ["text"]), 0);
  assert.equal(hitAnnotation([text, rectangle], v, [80, 160], 48), 1);
  assert.equal(hitAnnotation([text], v, [80, 160 + 40], 48, ["text"]), 0);
  assert.equal(hitAnnotation([text], v, [80, 160 + 60], 48, ["text"]), null);
});
test("Reducing a text box lowers the exported font size and persists after reopen", async () => {
  const v = {
    scale: 1,
    convertToViewportPoint: (x, y) => [x, -y],
    convertToPdfPoint: (x, y) => [x, -y],
  };
  const a = {
    type: "text",
    point: [40, 100],
    text: "Taille modifiée",
    size: 24,
    color: "#1565c0",
  };
  const b = bounds(a, v),
    to = resizeBox(
      b,
      "se",
      -(b[2] - b[0]) / 2,
      -(b[3] - b[1]) / 2,
      true,
      8,
      8 / 24,
      96 / 24,
    );
  const reduced = transform(a, v, b, to);
  assert.equal(reduced.size, 12);
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  const saved = await PDFDocument.load(
    await exportPdf([{ source: { doc }, index: 0, annotations: [reduced] }]),
  );
  assert.equal((await restoreEditing(saved)).annotations[0][0].size, 12);
});
