// All geometry is stored in PDF points; the viewport alone handles zoom/rotation.
export const widthOf = (a) => a.width ?? (a.size || 16) / 8;
export const alphaOf = (a) => a.opacity ?? (a.type === "highlight" ? 0.3 : 1);
export function bounds(a, v) {
  let points = a.points || [a.start, a.end].filter(Boolean);
  if (a.type === "text") {
    const p = v.convertToViewportPoint(...a.point),
      lines = a.text.split("\n");
    let width =
      Math.max(...lines.map((l) => l.length), 1) * a.size * v.scale * 0.65;
    if (typeof document !== "undefined") {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${a.size * v.scale}px Helvetica, Arial, sans-serif`;
      width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    }
    return [
      p[0],
      p[1] - a.size * v.scale,
      p[0] + width,
      p[1] + (lines.length - 1) * a.size * v.scale * 1.2,
    ];
  }
  const q = points.map((p) => v.convertToViewportPoint(...p));
  return [
    Math.min(...q.map((p) => p[0])),
    Math.min(...q.map((p) => p[1])),
    Math.max(...q.map((p) => p[0])),
    Math.max(...q.map((p) => p[1])),
  ];
}
export function transform(a, v, from, to) {
  const map = (p) => {
    const q = v.convertToViewportPoint(...p);
    return v.convertToPdfPoint(
      to[0] +
        ((q[0] - from[0]) * (to[2] - to[0])) / Math.max(1, from[2] - from[0]),
      to[1] +
        ((q[1] - from[1]) * (to[3] - to[1])) / Math.max(1, from[3] - from[1]),
    );
  };
  const b = structuredClone(a);
  for (const key of ["point", "start", "end"]) if (b[key]) b[key] = map(b[key]);
  if (b.points) b.points = b.points.map(map);
  if (b.type === "text")
    b.size = Math.max(
      8,
      Math.min(96, (b.size * (to[3] - to[1])) / Math.max(1, from[3] - from[1])),
    );
  return b;
}
export function drawAnnotations(ctx, item, v, extra = null) {
  ctx.save();
  for (const a of [...item.annotations, ...(extra ? [extra] : [])]) {
    ctx.fillStyle = ctx.strokeStyle = a.color;
    ctx.globalAlpha = alphaOf(a);
    ctx.lineWidth = widthOf(a) * v.scale;
    ctx.lineCap = ctx.lineJoin = "round";
    if (a.type === "text") {
      const q = v.convertToViewportPoint(...a.point);
      ctx.font = `${a.size * v.scale}px Helvetica, Arial, sans-serif`;
      a.text
        .split("\n")
        .forEach((line, i) =>
          ctx.fillText(line, q[0], q[1] + i * a.size * v.scale * 1.2),
        );
    } else if (a.type === "pen") {
      for (let i = 1; i < a.points.length; i++) {
        ctx.lineWidth =
          (widthOf(a) *
            v.scale *
            ((a.pressures?.[i] ?? 1) + (a.pressures?.[i - 1] ?? 1))) /
          2;
        ctx.beginPath();
        ctx.moveTo(...v.convertToViewportPoint(...a.points[i - 1]));
        ctx.lineTo(...v.convertToViewportPoint(...a.points[i]));
        ctx.stroke();
      }
    } else {
      const q = v.convertToViewportPoint(...a.start),
        r = v.convertToViewportPoint(...a.end),
        x = Math.min(q[0], r[0]),
        y = Math.min(q[1], r[1]),
        w = Math.abs(q[0] - r[0]),
        h = Math.abs(q[1] - r[1]);
      if (a.type === "highlight") ctx.fillRect(x, y, w, h);
      else if (a.type === "rectangle") ctx.strokeRect(x, y, w, h);
      else if (a.type === "circle") {
        ctx.beginPath();
        ctx.ellipse(
          x + w / 2,
          y + h / 2,
          Math.max(0.1, w / 2),
          Math.max(0.1, h / 2),
          0,
          0,
          2 * Math.PI,
        );
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(...q);
        ctx.lineTo(...r);
        ctx.stroke();
        if (a.type === "arrow") {
          const angle = Math.atan2(r[1] - q[1], r[0] - q[0]),
            len = Math.max(8, widthOf(a) * 4) * v.scale;
          ctx.beginPath();
          ctx.moveTo(
            r[0] - len * Math.cos(angle - 0.5),
            r[1] - len * Math.sin(angle - 0.5),
          );
          ctx.lineTo(...r);
          ctx.lineTo(
            r[0] - len * Math.cos(angle + 0.5),
            r[1] - len * Math.sin(angle + 0.5),
          );
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

// Tolerances are passed in viewport pixels converted from CSS pixels by the UI.
export function hitAnnotation(annotations, v, q, tolerance = 8, types = null) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (types && !types.includes(a.type)) continue;
    const b = bounds(a, v);
    if (
      q[0] >= b[0] - tolerance &&
      q[0] <= b[2] + tolerance &&
      q[1] >= b[1] - tolerance &&
      q[1] <= b[3] + tolerance
    )
      return i;
  }
  return null;
}
export function resizeBox(
  box,
  corner,
  dx,
  dy,
  uniform = false,
  minSize = 8,
  minScale = 0,
  maxScale = Infinity,
) {
  const west = corner.includes("w"),
    north = corner.includes("n");
  const fixed = [west ? box[2] : box[0], north ? box[3] : box[1]];
  const original = [west ? box[0] : box[2], north ? box[1] : box[3]];
  const delta = [original[0] - fixed[0], original[1] - fixed[1]];
  let moved = [original[0] + dx, original[1] + dy];
  if (uniform) {
    const projected =
      ((moved[0] - fixed[0]) * delta[0] + (moved[1] - fixed[1]) * delta[1]) /
      Math.max(1, delta[0] ** 2 + delta[1] ** 2);
    const scale = Math.max(minScale, Math.min(maxScale, projected));
    moved = [fixed[0] + delta[0] * scale, fixed[1] + delta[1] * scale];
  } else {
    moved = [
      west
        ? Math.min(fixed[0] - minSize, moved[0])
        : Math.max(fixed[0] + minSize, moved[0]),
      north
        ? Math.min(fixed[1] - minSize, moved[1])
        : Math.max(fixed[1] + minSize, moved[1]),
    ];
  }
  return [
    Math.min(fixed[0], moved[0]),
    Math.min(fixed[1], moved[1]),
    Math.max(fixed[0], moved[0]),
    Math.max(fixed[1], moved[1]),
  ];
}
