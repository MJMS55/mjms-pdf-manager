import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("js", { recursive: true });
await build({
  entryPoints: { main: "src/main.js", files: "src/files.js" },
  outdir: "js",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  "js/pdf.worker.mjs",
);
for (const folder of ["cmaps", "standard_fonts", "wasm"])
  await cp(`node_modules/pdfjs-dist/${folder}`, `js/${folder}`, {
    recursive: true,
  });
await mkdir("licenses", { recursive: true });
await copyFile("node_modules/pdf-lib/LICENSE.md", "licenses/pdf-lib.txt");
await copyFile("node_modules/pdfjs-dist/LICENSE", "licenses/pdfjs.txt");
for (const name of ["auth", "router", "browser-storage", "files"]) {
  await copyFile(
    `node_modules/@nextcloud/${name}/LICENSE`,
    `licenses/nextcloud-${name}.txt`,
  );
}
