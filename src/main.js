import { t } from "./l10n.js";
import {
  drawAnnotations,
  bounds,
  transform,
  hitAnnotation,
  resizeBox,
} from "./annotations.js";
import { generateUrl, generateFilePath } from "@nextcloud/router";
import { getRequestToken } from "@nextcloud/auth";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import {
  MAX_BYTES,
  MAX_PAGES,
  movePage,
  exportPdf,
  removeAnnotation,
  restoreEditing,
} from "./pdf.js";

const boot = () => {
  const $ = (id) => document.getElementById(id);
  const base = generateFilePath("mjms_pdf_manager", "js", "").replace(
    /\/$/,
    "",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = base + "/pdf.worker.mjs";
  let pages = [],
    selected = null,
    busy = false,
    dirty = false,
    history = [],
    future = [],
    annotationSelection = null,
    textEditing = null,
    sources = [],
    viewport = null,
    background = null,
    renderVersion = 0,
    dragId = null;
  let preferredSaveFolder = "/";
  let cloudMode = "import",
    cloudPath = "/",
    cloudWritable = false;
  const status = (message, error = false) => {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
    $("editor-status").textContent = message;
    $("editor-status").classList.toggle("error", error);
  };
  const clonePages = () =>
    pages.map((p) => ({ ...p, annotations: structuredClone(p.annotations) }));
  const snapshot = () => {
    future = [];
    history.push(
      pages.map((p) => ({ ...p, annotations: structuredClone(p.annotations) })),
    );
    if (history.length > 20) history.shift();
    dirty = true;
  };
  function controls() {
    for (const id of ["import-local", "import-cloud"]) $(id).disabled = busy;
    for (const id of ["save", "download", "reset", "mail"])
      $(id).disabled = busy || !pages.length;
    $("editor-redo").disabled = busy || !future.length;
    $("delete-selected").disabled =
      busy ||
      !pages.find((p) => p.id === selected)?.annotations[annotationSelection];
    $("apply-annotation").disabled =
      busy ||
      !pages.find((p) => p.id === selected)?.annotations[annotationSelection];
    $("undo").disabled = busy || !history.length;
    $("editor-undo").disabled = busy || !history.length;
    const current = pages.findIndex((p) => p.id === selected);
    $("open-editor").disabled = busy || current < 0;
    $("editor-prev").disabled = busy || current <= 0;
    $("editor-next").disabled =
      busy || current < 0 || current >= pages.length - 1;
    for (const id of [
      "editor-zoom",
      "place-text-center",
      "close-editor",
      "mail-send",
      "mail-cancel",
    ])
      $(id).disabled = busy;
    for (const field of $("mail-form").querySelectorAll("input,textarea"))
      field.disabled = busy;
    for (const b of $("annotation-list").querySelectorAll("button"))
      b.disabled = busy;
    $("clear-annotations").disabled =
      busy || !pages.find((p) => p.id === selected)?.annotations.length;
    $("page-count").textContent = pages.length;
    $("empty").hidden = !!pages.length;
    const editing = !!textEditing;
    for (const id of [
      "editor-prev",
      "editor-next",
      "editor-zoom",
      "close-editor",
      "editor-undo",
      "editor-redo",
      "place-text-center",
      "apply-annotation",
      "delete-selected",
      "clear-annotations",
      "annotation-tool",
    ])
      $(id).disabled ||= editing;
    for (const field of $("annotation-dialog").querySelectorAll(
      ".mjms-editor input,.mjms-editor textarea,[data-tool]",
    ))
      field.disabled = busy || editing;
    $("annotation-tool").disabled = busy || editing;
    for (const id of ["inline-save", "inline-cancel"]) $(id).disabled = busy;
    $("selection-edit").disabled =
      busy ||
      editing ||
      pages.find((p) => p.id === selected)?.annotations[annotationSelection]
        ?.type !== "text";
    $("selection-delete").disabled = busy || editing;
    for (const b of $("annotation-list").querySelectorAll("button"))
      b.disabled = busy || editing;
    $("cloud-confirm").disabled =
      busy || (cloudMode === "save" && !cloudWritable);
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    controls();
    try {
      await fn();
    } catch (e) {
      status(e.message || t("An error occurred."), true);
      if ($("cloud-dialog").open) {
        $("cloud-status").textContent = e.message;
        $("cloud-status").className = "error";
      }
      if ($("mail-dialog").open) {
        $("mail-status").textContent = e.message;
        $("mail-status").className = "error";
      }
    } finally {
      busy = false;
      controls();
    }
  }
  async function request(route, options = {}) {
    const response = await fetch(
      generateUrl("/apps/mjms_pdf_manager" + route),
      {
        ...options,
        headers: { requesttoken: getRequestToken(), ...options.headers },
        credentials: "same-origin",
      },
    );
    if (!response.ok) {
      let message = t("The server rejected the request (") + response.status + ").";
      let data = {};
      try {
        data = await response.json();
        message = data.message || message;
      } catch {}
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return response;
  }
  async function addFiles(files) {
    let bytesTotal = sources.reduce((n, s) => n + s.bytes, 0),
      count = pages.length;
    const added = [],
      pending = [];
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES || bytesTotal + file.size > MAX_BYTES)
          throw new Error(
            t("50 MiB limit for all imports. Clear the workspace to release previous files."),
          );
        let bytes = new Uint8Array(await file.arrayBuffer());
        if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
          throw new Error(file.name + t(" : this file is not a PDF."));
        let doc;
        try {
          doc = await PDFDocument.load(bytes);
        } catch {
          throw new Error(
            file.name +
              t(" : encrypted or unreadable PDF. Unlock it before importing."),
          );
        }
        if (doc.isEncrypted)
          throw new Error(file.name + t(" : encrypted PDFs are not supported."));
        const restored = await restoreEditing(doc);
        if (restored) {
          bytes = restored.bytes;
          doc = await PDFDocument.load(bytes);
        }
        count += doc.getPageCount();
        if (count > MAX_PAGES)
          throw new Error(t("Limit of 300 pages per document."));
        const loading = pdfjs.getDocument({
          data: bytes.slice(),
          isEvalSupported: false,
          cMapUrl: base + "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: base + "/standard_fonts/",
          wasmUrl: base + "/wasm/",
        });
        loading.onPassword = () => loading.destroy();
        const view = await loading.promise;
        const source = {
          doc,
          view,
          loading,
          name: file.name,
          bytes: file.size,
        };
        pending.push(source);
        bytesTotal += file.size;
        for (let index = 0; index < doc.getPageCount(); index++)
          added.push({
            id: crypto.randomUUID(),
            source,
            index,
            annotations: restored?.annotations[index] || [],
          });
      }
    } catch (e) {
      for (const s of pending) await s.loading.destroy();
      throw e;
    }
    snapshot();
    sources.push(...pending);
    pages.push(...added);
    selected ||= pages[0]?.id;
    await render();
    status(
      t("{count} page(s) added. Export will merge the pages in this order.", { count: added.length }),
    );
  }
  async function thumbnail(item, canvas) {
    const page = await item.source.view.getPage(item.index + 1);
    const natural = page.getViewport({ scale: 1 });
    const v = page.getViewport({
      scale: Math.min(1, 220 / natural.width, 310 / natural.height),
    });
    canvas.width = v.width;
    canvas.height = v.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: v })
      .promise;
    drawAnnotations(canvas.getContext("2d"), item, v);
  }
  function button(text, label, action) {
    const b = document.createElement("button");
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.onclick = (e) => {
      e.stopPropagation();
      if (!busy) run(action);
    };
    return b;
  }
  async function render() {
    $("pages").replaceChildren();
    controls();
    for (const [index, item] of pages.entries()) {
      const card = document.createElement("article");
      card.className = "mjms-card" + (selected === item.id ? " selected" : "");
      card.draggable = true;
      card.dataset.id = item.id;
      card.tabIndex = 0;
      card.setAttribute("aria-label", t("Page {number}, {name}", {number: index + 1, name: item.source.name}));
      const canvas = document.createElement("canvas");
      card.append(canvas);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = `${index + 1}. ${item.source.name} · p. ${item.index + 1}`;
      title.title = title.textContent;
      card.append(title);
      const actions = document.createElement("div");
      actions.className = "actions";
      const move = async (delta) => {
        snapshot();
        pages = movePage(pages, index, index + delta);
        await render();
      };
      const left = button("←", t("Move page earlier"), () => move(-1));
      left.disabled = index === 0;
      const right = button("→", t("Move page later"), () => move(1));
      right.disabled = index === pages.length - 1;
      actions.append(
        button(t("Annotate"), t("Annotate this page"), () => openEditor(item.id)),
        left,
        right,
        button("×", t("Delete this page"), async () => {
          snapshot();
          pages = pages.filter((p) => p.id !== item.id);
          if (selected === item.id) selected = pages[0]?.id;
          await render();
        }),
      );
      card.append(actions);
      card.onclick = () => {
        if (!busy)
          run(async () => {
            selected = item.id;
            await render();
          });
      };
      card.onkeydown = (e) => {
        if (e.target === card && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          card.click();
        }
      };
      card.ondragstart = (e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        dragId = item.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
      };
      card.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      };
      card.ondrop = (e) => {
        e.preventDefault();
        if (busy || !dragId || dragId === item.id) return;
        const from = pages.findIndex((p) => p.id === dragId);
        dragId = null;
        run(async () => {
          snapshot();
          pages = movePage(pages, from, index);
          await render();
        });
      };
      card.ondragend = () => (dragId = null);
      $("pages").append(card);
      await thumbnail(item, canvas);
    }
    if ($("annotation-dialog").open) await renderEditor();
  }
  async function renderEditor() {
    const version = ++renderVersion,
      item = pages.find((p) => p.id === selected),
      canvas = $("editor-canvas");
    cancelGesture();
    viewport = null;
    background = null;
    renderAnnotationList(item);
    if (!item) {
      canvas.width = 1;
      canvas.height = 1;
      $("selection-label").textContent = t("Select a thumbnail.");
      return;
    }
    $("selection-label").textContent =
      t("Page {number} · {name}", {number: pages.indexOf(item) + 1, name: item.source.name});
    const page = await item.source.view.getPage(item.index + 1),
      natural = page.getViewport({ scale: 1 });
    const v = page.getViewport({
        scale: Math.min(
          4096 / natural.width,
          4096 / natural.height,
          ((Math.max(1, window.devicePixelRatio || 1) *
            Math.max(240, $("editor-wrap").clientWidth - 32)) /
            natural.width) *
            Number($("editor-zoom").value),
        ),
      }),
      off = document.createElement("canvas");
    off.width = v.width;
    off.height = v.height;
    await page.render({ canvasContext: off.getContext("2d"), viewport: v })
      .promise;
    if (version !== renderVersion) return;
    viewport = v;
    background = off;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.style.width = `${v.width / Math.max(1, window.devicePixelRatio || 1)}px`;
    paint();
    controls();
  }
  function paint(extra = null) {
    if (!background) return;
    const ctx = $("editor-canvas").getContext("2d");
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(background, 0, 0);
    const item = pages.find((p) => p.id === selected);
    if (item)
      drawAnnotations(
        ctx,
        textEditing?.index !== null && textEditing
          ? {
              ...item,
              annotations: item.annotations.filter(
                (_, i) => i !== textEditing.index,
              ),
            }
          : item,
        viewport,
        extra,
      );
    updateSelectionOverlay();
  }
  let gesture = null;
  function point(event) {
    const c = $("editor-canvas"),
      r = c.getBoundingClientRect();
    return viewport.convertToPdfPoint(
      Math.max(
        0,
        Math.min(c.width, ((event.clientX - r.left) * c.width) / r.width),
      ),
      Math.max(
        0,
        Math.min(c.height, ((event.clientY - r.top) * c.height) / r.height),
      ),
    );
  }
  const currentItem = () => pages.find((p) => p.id === selected);
  function selectAnnotation(index, reveal = false) {
    annotationSelection = index;
    const a = currentItem()?.annotations[index];
    if (a) {
      $("annotation-text").value = a.text || "";
      $("annotation-size").value = Math.round((a.size || 16) * 10) / 10;
      $("annotation-color").value = a.color;
      $("annotation-width").value = a.width ?? (a.size || 16) / 8;
      $("annotation-opacity").value =
        a.opacity ?? (a.type === "highlight" ? 0.3 : 1);
    }
    paint();
    if (reveal && a)
      $("selection-overlay").scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    controls();
  }
  function cancelGesture() {
    if (gesture?.original && currentItem()?.id === gesture.pageId)
      currentItem().annotations[gesture.index] = gesture.original;
    gesture = null;
  }
  function settings() {
    return {
      size: Math.max(8, Math.min(96, Number($("annotation-size").value) || 16)),
      width: Math.max(
        0.5,
        Math.min(20, Number($("annotation-width").value) || 2),
      ),
      opacity: Math.max(
        0.05,
        Math.min(1, Number($("annotation-opacity").value) || 0.3),
      ),
      color: $("annotation-color").value,
    };
  }
  function cssScale() {
    const c = $("editor-canvas");
    return c.getBoundingClientRect().width / c.width;
  }
  function updateSelectionOverlay() {
    const overlay = $("selection-overlay"),
      actions = $("selection-actions"),
      a = currentItem()?.annotations[annotationSelection];
    overlay.hidden = actions.hidden = !a || !viewport || !!textEditing;
    if (!a || !viewport || textEditing) return;
    const b = bounds(a, viewport),
      ratio = cssScale();
    const left = b[0] * ratio,
      top = b[1] * ratio,
      width = Math.max(1, (b[2] - b[0]) * ratio),
      height = Math.max(1, (b[3] - b[1]) * ratio);
    Object.assign(overlay.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    Object.assign(actions.style, {
      left: `${Math.max(0, Math.min(left, $("editor-stage").clientWidth - 190))}px`,
      top: `${Math.max(0, top - 48)}px`,
    });
  }
  function setTool(type) {
    cancelGesture();
    $("annotation-tool").value = type;
    $("annotation-opacity").value = type === "highlight" ? 0.3 : 1;
    for (const b of $("annotation-dialog").querySelectorAll("[data-tool]"))
      b.setAttribute("aria-pressed", String(b.dataset.tool === type));
    $("editor-canvas").style.cursor =
      type === "select" ? "default" : "crosshair";
    paint();
  }
  async function refreshAnnotations() {
    renderAnnotationList(currentItem());
    paint();
    controls();
    const card = [...$("pages").children].find(
      (c) => c.dataset.id === selected,
    );
    if (card && currentItem())
      await thumbnail(currentItem(), card.querySelector("canvas"));
  }
  function beginManipulation(e, index, corner = null) {
    const item = currentItem();
    selectAnnotation(index);
    gesture = {
      index,
      original: structuredClone(item.annotations[index]),
      box: bounds(item.annotations[index], viewport),
      start: viewport.convertToViewportPoint(...point(e)),
      corner,
      before: clonePages(),
      pageId: item.id,
      pointerId: e.pointerId,
    };
    $("editor-canvas").setPointerCapture(e.pointerId);
    $("editor-canvas").style.cursor = corner
      ? corner === "nw" || corner === "se"
        ? "nwse-resize"
        : "nesw-resize"
      : "grabbing";
  }
  function startTextEdit(index = null, p = null) {
    if (busy || !viewport || textEditing) return;
    cancelGesture();
    const a =
      index === null
        ? {
            type: "text",
            point: p,
            text: "",
            ...settings(),
          }
        : currentItem().annotations[index];
    if (a?.type !== "text") return;
    annotationSelection = index;
    textEditing = { index, pageId: selected, draft: structuredClone(a) };
    const b = bounds({ ...a, text: a.text || t("Your text") }, viewport),
      ratio = cssScale(),
      stage = $("editor-stage");
    const left = Math.max(0, Math.min(b[0] * ratio, stage.clientWidth - 220)),
      top = Math.max(0, b[1] * ratio);
    const editor = $("inline-text-editor");
    editor.hidden = false;
    Object.assign(editor.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.min(stage.clientWidth - left, Math.max(220, (b[2] - b[0]) * ratio + 32))}px`,
    });
    const input = $("inline-text");
    input.value = a.text;
    input.style.fontSize = `${Math.max(14, a.size * viewport.scale * ratio)}px`;
    input.style.color = a.color;
    paint();
    controls();
    input.focus();
    input.select();
    status(
      t("Write on the page, then confirm. Ctrl+Enter: confirm; Esc: cancel."),
    );
  }
  function cancelTextEdit() {
    textEditing = null;
    $("inline-text-editor").hidden = true;
    paint();
    controls();
  }
  async function commitTextEdit() {
    if (!textEditing) return;
    const edit = textEditing,
      text = $("inline-text").value.trim();
    if (!text) throw new Error(t("Enter text, or cancel."));
    const font = await currentItem().source.doc.embedFont(
      StandardFonts.Helvetica,
    );
    try {
      font.encodeText(text.replace(/\n/g, ""));
    } catch {
      throw new Error(
        t("Use Latin characters (French accents are supported)."),
      );
    }
    if (edit.index === null || text !== edit.draft.text) {
      snapshot();
      if (edit.index === null) {
        currentItem().annotations.push({ ...edit.draft, text });
        annotationSelection = currentItem().annotations.length - 1;
      } else currentItem().annotations[edit.index].text = text;
    }
    textEditing = null;
    $("inline-text-editor").hidden = true;
    $("annotation-text").value = "";
    setTool("select");
    selectAnnotation(annotationSelection);
    await refreshAnnotations();
    status(
      t("Text ready: drag it or pull a handle to resize it."),
    );
  }
  $("inline-save").onclick = () => run(commitTextEdit);
  $("inline-cancel").onclick = cancelTextEdit;
  $("inline-text").onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelTextEdit();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run(commitTextEdit);
    }
  };
  $("selection-edit").onclick = () => startTextEdit(annotationSelection);
  $("selection-delete").onclick = () => $("delete-selected").click();
  for (const handle of $("selection-overlay").querySelectorAll("[data-corner]"))
    handle.onpointerdown = (e) => {
      if (
        busy ||
        textEditing ||
        gesture ||
        !viewport ||
        annotationSelection === null
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      beginManipulation(e, annotationSelection, handle.dataset.corner);
    };
  for (const b of $("annotation-dialog").querySelectorAll("[data-tool]"))
    b.onclick = () => setTool(b.dataset.tool);
  $("editor-canvas").onpointerdown = (e) => {
    if (
      busy ||
      !viewport ||
      gesture ||
      textEditing ||
      e.button !== 0 ||
      e.isPrimary === false
    )
      return;
    e.preventDefault();
    const type = $("annotation-tool").value,
      p = point(e),
      q = viewport.convertToViewportPoint(...p),
      item = currentItem();
    const index = hitAnnotation(
      item.annotations,
      viewport,
      q,
      12 / cssScale(),
      type === "text" ? ["text"] : null,
    );
    if (type === "select" || (type === "text" && index !== null)) {
      if (index === null) {
        selectAnnotation(null);
        return;
      }
      beginManipulation(e, index);
      return;
    }
    if (type === "text") {
      startTextEdit(null, p);
      return;
    }
    annotationSelection = null;
    gesture = {
      annotation: {
        type,
        ...settings(),
        ...(type === "pen"
          ? {
              points: [p],
              pressures: [
                e.pointerType === "pen" ? Math.max(0.1, e.pressure) : 1,
              ],
            }
          : { start: p, end: p }),
      },
      pageId: item.id,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    paint(gesture.annotation);
  };
  $("editor-canvas").onpointermove = (e) => {
    if (!viewport) return;
    if (!gesture) {
      const tool = $("annotation-tool").value;
      if (!busy && !textEditing && (tool === "select" || tool === "text")) {
        const hit = hitAnnotation(
          currentItem().annotations,
          viewport,
          viewport.convertToViewportPoint(...point(e)),
          12 / cssScale(),
          tool === "text" ? ["text"] : null,
        );
        $("editor-canvas").style.cursor =
          hit === null ? (tool === "text" ? "crosshair" : "default") : "grab";
      }
      return;
    }
    if (gesture.pointerId !== e.pointerId) return;
    if (gesture.original) {
      const q = viewport.convertToViewportPoint(...point(e)),
        g = gesture,
        dx = q[0] - g.start[0],
        dy = q[1] - g.start[1],
        b = g.box;
      const dest = g.corner
        ? resizeBox(
            b,
            g.corner,
            dx,
            dy,
            g.original.type === "text",
            8 / cssScale(),
            8 / (g.original.size || 16),
            96 / (g.original.size || 16),
          )
        : [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
      currentItem().annotations[g.index] = transform(
        g.original,
        viewport,
        b,
        dest,
      );
      g.changed = Math.hypot(dx, dy) * cssScale() > 1;
      paint();
    } else {
      const a = gesture.annotation;
      for (const event of e.getCoalescedEvents?.().length
        ? e.getCoalescedEvents()
        : [e]) {
        const p = point(event);
        if (a.type === "pen") {
          a.points.push(p);
          a.pressures.push(
            event.pointerType === "pen" ? Math.max(0.1, event.pressure) : 1,
          );
        } else a.end = p;
      }
      paint(a);
    }
  };
  $("editor-canvas").onpointerup = (e) => {
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const g = gesture;
    gesture = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    $("editor-canvas").style.cursor =
      $("annotation-tool").value === "select" ? "default" : "crosshair";
    if (g.original && !g.changed) {
      paint();
      return;
    }
    run(async () => {
      if (g.original) {
        if (g.changed) {
          history.push(g.before);
          if (history.length > 20) history.shift();
          future = [];
          dirty = true;
        }
      } else {
        const a = g.annotation;
        if (
          a.type === "pen"
            ? a.points.length < 2
            : Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1]) < 2
        ) {
          paint();
          return;
        }
        snapshot();
        currentItem().annotations.push(a);
        annotationSelection = currentItem().annotations.length - 1;
      }
      await refreshAnnotations();
      selectAnnotation(annotationSelection);
    });
  };
  $("editor-canvas").onpointercancel = () => {
    cancelGesture();
    paint();
  };
  $("editor-canvas").onlostpointercapture = () => {
    if (gesture) {
      cancelGesture();
      paint();
    }
  };
  $("editor-canvas").ondblclick = (e) => {
    if (busy || !viewport || textEditing) return;
    const index = hitAnnotation(
      currentItem().annotations,
      viewport,
      viewport.convertToViewportPoint(...point(e)),
      12 / cssScale(),
      ["text"],
    );
    if (index !== null) startTextEdit(index);
  };
  $("annotation-tool").onchange = () => setTool($("annotation-tool").value);
  $("apply-annotation").onclick = () =>
    run(async () => {
      const a = currentItem()?.annotations[annotationSelection];
      if (!a) return;
      const text = $("annotation-text").value.trim();
      if (a.type === "text") {
        if (!text) throw new Error(t("Enter text."));
        const font = await currentItem().source.doc.embedFont(
          StandardFonts.Helvetica,
        );
        font.encodeText(text.replace(/\n/g, ""));
      }
      snapshot();
      Object.assign(a, settings(), a.type === "text" ? { text } : {});
      await refreshAnnotations();
    });
  $("delete-selected").onclick = () =>
    run(async () => {
      if (annotationSelection === null) return;
      snapshot();
      currentItem().annotations.splice(annotationSelection, 1);
      annotationSelection = null;
      await refreshAnnotations();
    });
  $("editor-redo").onclick = () =>
    run(async () => {
      if (!future.length) return;
      cancelGesture();
      history.push(clonePages());
      pages = future.pop();
      annotationSelection = null;
      dirty = true;
      await render();
      status(t("Change redone."));
    });
  $("annotation-dialog").addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || busy) return;
    if ((e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      (e.shiftKey || e.key.toLowerCase() === "y"
        ? $("editor-redo")
        : $("undo")
      ).click();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      $("delete-selected").click();
    }
  });

  async function addText(p, size, color) {
    const text = $("annotation-text").value.trim();
    if (!text) {
      startTextEdit(null, p);
      return;
    }
    if (!Number.isFinite(size) || size < 8 || size > 96)
      throw new Error(t("Size must be between 8 and 96."));
    const item = pages.find((p) => p.id === selected);
    const font = await item.source.doc.embedFont(StandardFonts.Helvetica);
    try {
      font.encodeText(text.replace(/\n/g, ""));
    } catch {
      throw new Error(
        t("Use Latin characters (French accents are supported)."),
      );
    }
    snapshot();
    item.annotations.push({
      type: "text",
      point: p,
      text,
      ...settings(),
      size,
      color,
    });
    annotationSelection = item.annotations.length - 1;
    await refreshAnnotations();
    setTool("select");
    selectAnnotation(annotationSelection);
    status(
      t("Text added: drag to move it; pull a handle to resize it."),
    );
  }
  function renderAnnotationList(item) {
    const list = $("annotation-list");
    list.replaceChildren();
    if (!item?.annotations.length) {
      const li = document.createElement("li");
      li.textContent = t("No annotations added.");
      list.append(li);
      return;
    }
    item.annotations.forEach((a, index) => {
      const li = document.createElement("li"),
        label = document.createElement("span");
      label.textContent =
        a.type === "text"
          ? t("Text: ") + a.text
          : a.type === "pen"
            ? t("Freehand drawing")
            : {
                highlight: t("Highlight"),
                rectangle: t("Rectangle"),
                circle: t("Ellipse"),
                line: t("Line"),
                arrow: t("Arrow"),
              }[a.type] || a.type;
      li.append(
        button(
          t("Select"),
          t("Select annotation ") + (index + 1),
          async () => {
            setTool("select");
            selectAnnotation(index, true);
          },
        ),
        label,
        button(
          t("Delete"),
          t("Delete annotation ") + (index + 1),
          async () => {
            snapshot();
            item.annotations = removeAnnotation(item.annotations, index);
            annotationSelection = null;
            await refreshAnnotations();
            status(t("Annotation deleted. You can undo this action."));
          },
        ),
      );
      list.append(li);
    });
  }
  async function openEditor(id) {
    cancelGesture();
    annotationSelection = null;
    selected = id;
    $("editor-status").textContent = "";
    if (!$("annotation-dialog").open) $("annotation-dialog").showModal();
    await renderEditor();
  }
  $("open-editor").onclick = () => run(() => openEditor(selected));
  $("close-editor").onclick = () => $("annotation-dialog").close();
  $("annotation-dialog").oncancel = (e) => {
    if (textEditing) {
      e.preventDefault();
      cancelTextEdit();
    } else if (busy) e.preventDefault();
  };
  $("annotation-dialog").onclose = () => {
    cancelTextEdit();
    cancelGesture();
    viewport = null;
    background = null;
    run(() => render());
  };
  let lastEditorWidth = 0;
  new ResizeObserver((entries) => {
    const width = entries[0].contentRect.width;
    if (Math.abs(width - lastEditorWidth) < 2) return;
    lastEditorWidth = width;
    if ($("annotation-dialog").open && !busy && !gesture && !textEditing)
      run(renderEditor);
  }).observe($("editor-wrap"));
  $("editor-zoom").onchange = () => run(() => renderEditor());
  for (const [id, delta] of [
    ["editor-prev", -1],
    ["editor-next", 1],
  ])
    $(id).onclick = () =>
      run(async () => {
        const index = pages.findIndex((p) => p.id === selected) + delta;
        if (index >= 0 && index < pages.length)
          await openEditor(pages[index].id);
      });
  $("editor-undo").onclick = () => $("undo").click();
  $("place-text-center").onclick = () => {
    if (!viewport || busy) return;
    const p = viewport.convertToPdfPoint(
      viewport.width / 2,
      viewport.height / 2,
    );
    if (!$("annotation-text").value.trim()) startTextEdit(null, p);
    else
      run(() =>
        addText(
          p,
          Number($("annotation-size").value),
          $("annotation-color").value,
        ),
      );
  };
  $("mail").onclick = () => {
    if (busy || !pages.length) return;
    $("mail-status").textContent = "";
    $("mail-status").className = "";
    $("mail-attachment").textContent =
      t("{count} page(s) in the attached PDF.", { count: pages.length });
    $("mail-dialog").showModal();
  };
  $("mail-cancel").onclick = () => $("mail-dialog").close();
  $("mail-dialog").oncancel = (e) => {
    if (busy) e.preventDefault();
  };
  $("mail-form").onsubmit = (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    run(async () => {
      const name = $("mail-name").value.trim();
      if (!/^.+\.pdf$/i.test(name) || /[\\/:*?"<>|\x00-\x1f]/.test(name))
        throw new Error(
          t("Choose a valid attachment name ending in .pdf."),
        );
      $("mail-status").className = "";
      $("mail-status").textContent = t("Preparing PDF and sending…");
      const bytes = await exportPdf(pages);
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error(
          t("The attachment exceeds 10 MiB. Export the PDF and use a Nextcloud share."),
        );
      const data = new FormData();
      for (const [key, id] of [
        ["to", "mail-to"],
        ["subject", "mail-subject"],
        ["body", "mail-body"],
      ])
        data.append(key, $(id).value);
      data.append("name", name);
      data.append("pdf", new Blob([bytes], { type: "application/pdf" }), name);
      const result = await (
        await request("/api/mail", { method: "POST", body: data })
      ).json();
      $("mail-dialog").close();
      status(result.message);
    });
  };

  $("clear-annotations").onclick = () =>
    run(async () => {
      snapshot();
      pages.find((p) => p.id === selected).annotations = [];
      annotationSelection = null;
      await render();
    });
  $("import-local").onclick = () => $("local-files").click();
  $("local-files").onchange = (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) run(() => addFiles(files));
  };
  $("undo").onclick = () =>
    run(async () => {
      if (!history.length) return;
      cancelGesture();
      future.push(clonePages());
      annotationSelection = null;
      pages = history.pop() || pages;
      if (!pages.some((p) => p.id === selected)) selected = pages[0]?.id;
      dirty = true;
      await render();
      status(t("Last change undone."));
    });
  $("reset").onclick = () =>
    run(async () => {
      if (!confirm(t("Clear the workspace and discard changes?"))) return;
      pages = [];
      history = [];
      future = [];
      annotationSelection = null;
      selected = null;
      for (const source of sources) await source.loading.destroy();
      sources = [];
      dirty = false;
      await render();
      status(t("Workspace cleared."));
    });
  $("download").onclick = () =>
    run(async () => {
      const bytes = await exportPdf(pages),
        url = URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download = "Document.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status(t("PDF exported."));
    });
  async function browse(path) {
    const result = await (
      await request("/api/files?path=" + encodeURIComponent(path))
    ).json();
    cloudPath = result.path;
    cloudWritable = result.writable;
    $("cloud-path").textContent = cloudPath;
    $("cloud-items").replaceChildren();
    $("cloud-status").textContent = "";
    $("cloud-up").disabled = cloudPath === "/";
    for (const node of result.items) {
      if (cloudMode === "save" && !node.folder) continue;
      const row = document.createElement("label");
      row.className = "cloud-row";
      if (node.folder) {
        const b = button("▸ " + node.name, t("Open ") + node.name, () =>
          browse(node.path),
        );
        row.append(b);
      } else {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.value = node.path;
        check.dataset.name = node.name;
        check.dataset.size = node.size;
        row.append(check, document.createTextNode(node.name));
      }
      $("cloud-items").append(row);
    }
    if (!$("cloud-items").childElementCount)
      $("cloud-items").textContent =
        cloudMode === "save"
          ? t("No subfolders.")
          : t("No PDFs or subfolders.");
    controls();
  }
  function openCloud(mode) {
    return run(async () => {
      cloudMode = mode;
      $("cloud-title").textContent =
        mode === "save" ? t("Save PDF") : t("Choose PDFs");
      $("save-name-label").hidden = mode !== "save";
      $("cloud-confirm").textContent =
        mode === "save" ? t("Save here") : t("Import selection");
      await browse(mode === "save" ? preferredSaveFolder : "/");
      $("cloud-dialog").showModal();
    });
  }
  $("import-cloud").onclick = () => openCloud("import");
  $("save").onclick = () => openCloud("save");
  $("cloud-up").onclick = () =>
    run(() => browse(cloudPath.slice(0, cloudPath.lastIndexOf("/")) || "/"));
  function confirmOverwrite(name, folder, message) {
    const dialog = $("overwrite-dialog");
    $("overwrite-target").textContent =
      (folder.replace(/\/$/, "") || "") + "/" + name;
    $("overwrite-message").textContent = message;
    dialog.returnValue = "cancel";
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "overwrite"),
        { once: true },
      );
      dialog.showModal();
    });
  }
  async function saveToCloud(form) {
    // Keep the generated PDF and destination unchanged throughout the confirmation.
    for (;;) {
      try {
        return await (
          await request("/api/pdf", { method: "POST", body: form })
        ).json();
      } catch (error) {
        if (
          error.status !== 409 ||
          !["file_exists", "file_changed"].includes(error.data?.code)
        )
          throw error;
        if (
          !(await confirmOverwrite(
            form.get("name"),
            form.get("folder"),
            error.message,
          ))
        ) {
          $("cloud-status").className = "";
          $("cloud-status").textContent =
            t("Replacement cancelled. You can choose another name.");
          status(t("Save cancelled: the existing file has been kept."));
          return null;
        }
        form.set("overwrite", "true");
        form.set("expectedEtag", error.data.etag);
        form.set("expectedId", String(error.data.id));
      }
    }
  }
  $("cloud-confirm").onclick = () =>
    run(async () => {
      if (cloudMode === "import") {
        const checks = [...$("cloud-items").querySelectorAll("input:checked")];
        if (!checks.length) throw new Error(t("Select at least one PDF."));
        if (
          checks.reduce((n, c) => n + Number(c.dataset.size), 0) +
            sources.reduce((n, s) => n + s.bytes, 0) >
          MAX_BYTES
        )
          throw new Error(t("The selection exceeds the 50 MiB limit."));
        const files = [];
        for (const check of checks) {
          const blob = await (
            await request("/api/pdf?path=" + encodeURIComponent(check.value))
          ).blob();
          files.push(
            new File([blob], check.dataset.name, { type: "application/pdf" }),
          );
        }
        await addFiles(files);
        $("cloud-dialog").close();
      } else {
        status(t("Creating and saving PDF…"));
        const bytes = await exportPdf(pages),
          form = new FormData();
        form.append("folder", cloudPath);
        form.append("name", $("save-name").value);
        form.append(
          "pdf",
          new Blob([bytes], { type: "application/pdf" }),
          "document.pdf",
        );
        const result = await saveToCloud(form);
        if (!result) return;
        dirty = false;
        preferredSaveFolder = cloudPath;
        $("cloud-dialog").close();
        status(
          (result.overwritten
            ? t("PDF replaced in Nextcloud: ")
            : t("PDF saved in Nextcloud: ")) + result.path,
        );
      }
    });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  controls();
  const incomingFileId = new URL(window.location.href).searchParams.get(
    "fileId",
  );
  if (incomingFileId !== null)
    run(async () => {
      if (
        !/^[1-9]\d*$/.test(incomingFileId) ||
        !Number.isSafeInteger(Number(incomingFileId))
      )
        throw new Error(t("Invalid PDF ID."));
      status(t("Opening PDF from Nextcloud…"));
      const query = "?fileId=" + encodeURIComponent(incomingFileId);
      const source = await (await request("/api/source" + query)).json();
      const blob = await (await request("/api/pdf" + query)).blob();
      await addFiles([
        new File([blob], source.name, { type: "application/pdf" }),
      ]);
      $("save-name").value = source.name;
      $("mail-name").value = source.name;
      preferredSaveFolder =
        source.path.slice(0, source.path.lastIndexOf("/")) || "/";
      status(
        t("PDF opened: ") +
          source.name +
          t(". You can organize and annotate its pages."),
      );
    });
};
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", boot);
else boot();
