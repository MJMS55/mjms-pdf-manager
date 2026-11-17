import { createHash } from "node:crypto";
// Local UI harness only. It does not validate a real Nextcloud server.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
const samples = {};
for (const [name, labels] of [
  ["Contrat.pdf", ["Contrat : page 1", "Contrat : page 2"]],
  ["Annexe.pdf", ["Annexe : page 1"]],
]) {
  const d = await PDFDocument.create();
  for (const label of labels) {
    const p = d.addPage([595, 842]);
    p.drawText(label, { x: 50, y: 740, size: 24 });
  }
  samples[name] = Buffer.from(await d.save());
}
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") {
        let html = (await readFile("templates/main.php", "utf8")).replace(
          /<\?php[\s\S]*?\?>/g,
          (code) => {
            const doubleQuoted = code.match(/p\(\$l->t\(("(?:[^"\\]|\\.)*")\)\);/);
            if (doubleQuoted) return JSON.parse(doubleQuoted[1]).replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
            const match = code.match(/p\(\$l->t\('([\s\S]*)'\)\);/);
            if (!match) return "";
            const text = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
            return text.replace(/[&<>"']/g, (c) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
          },
        );
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          `<html><head data-requesttoken="test"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>dialog{display:block}:root{--color-main-text:#202631;--color-main-background:#fff;--color-background-hover:#f5f7fa;--color-text-maxcontrast:#596579;--color-border:#dce2e9;--color-primary-element:#00679e;--color-background-dark:#e9edf2;--color-error:#b32020}body{margin:0;font:14px Arial}button,input,select,textarea{font:inherit;padding:9px;border:1px solid #ccd3dd;border-radius:7px;background:white}button{cursor:pointer}button.primary{background:#00679e;color:white}button:disabled{opacity:.5}h1,h2,p{margin:0 0 8px}header#nc{background:#00679e;color:white;padding:16px 30px}</style><link rel="stylesheet" href="/css/main.css"></head><body><header id="nc">Nextcloud · aperçu de développement</header>${html}<script>window.addEventListener('error',e=>{document.getElementById('status').textContent=e.message});window._oc_webroot='';window._oc_appswebroots={mjms_pdf_manager:''};window.OC={webroot:'',appswebroots:{mjms_pdf_manager:''},config:{modRewriteWorking:true}};</script><script src="/js/main.js"></script></body></html>`,
        );
        return;
      }
      if (url.pathname.endsWith("/api/mail") && req.method === "POST") {
        const request = new Request("http://localhost/api/mail", {
          method: "POST",
          headers: req.headers,
          body: req,
          duplex: "half",
        });
        const form = await request.formData();
        const pdf = await PDFDocument.load(await form.get("pdf").arrayBuffer());
        if (!form.get("to") || !form.get("subject") || !form.get("name"))
          throw new Error("Missing mail fields");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message:
              "Simulation réussie : PDF de " +
              pdf.getPageCount() +
              " page(s) reçu en pièce jointe. Aucun mail réel envoyé.",
          }),
        );
        return;
      }
      if (url.pathname.endsWith("/api/files")) {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            path: "/",
            writable: true,
            items: Object.entries(samples).map(([name, data]) => ({
              name,
              path: "/" + name,
              folder: false,
              size: data.length,
            })),
          }),
        );
        return;
      }
      if (url.pathname.endsWith('/api/source')) {
        const name = Object.keys(samples)[Number(url.searchParams.get('fileId')) - 1];
        res.writeHead(name ? 200 : 404, {'Content-Type':'application/json'});
        res.end(JSON.stringify(name ? {name,path:'/'+name,size:samples[name].length} : {message:'PDF introuvable'})); return;
      }
      if (url.pathname.endsWith("/api/pdf") && req.method === "GET") {
        res.setHeader("Content-Type", "application/pdf");
        res.end(samples[url.searchParams.has("fileId") ? Object.keys(samples)[Number(url.searchParams.get("fileId")) - 1] : url.searchParams.get("path").slice(1)]);
        return;
      }
      if (url.pathname.endsWith("/api/pdf") && req.method === "POST") {
        const request = new Request("http://localhost/api/pdf", {
          method: "POST",
          headers: req.headers,
          body: req,
          duplex: "half",
        });
        const form = await request.formData(),
          name = form.get("name");
        const data = Buffer.from(await form.get("pdf").arrayBuffer());
        await PDFDocument.load(data);
        const existing = samples[name],
          etag = existing
            ? createHash("sha256").update(existing).digest("hex")
            : null;
        if (
          existing &&
          (form.get("overwrite") !== "true" ||
            form.get("expectedEtag") !== etag)
        ) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              code: "file_exists",
              message: "Ce fichier existe déjà. Voulez-vous le remplacer ?",
              id: 1,
              etag,
            }),
          );
          return;
        }
        samples[name] = data;
        res.writeHead(existing ? 200 : 201, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({ path: "/" + name, id: 1, overwritten: !!existing }),
        );
        return;
      }
      if (
        !/^\/(js|css)\/[a-zA-Z0-9_./-]+$/.test(url.pathname) ||
        url.pathname.includes("..")
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        url.pathname.endsWith(".mjs") || url.pathname.endsWith(".js")
          ? "application/javascript"
          : url.pathname.endsWith(".css")
            ? "text/css"
            : url.pathname.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream",
      );
      res.end(await readFile("." + url.pathname));
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
  })
  .listen(8765, "127.0.0.1", () =>
    console.log("Preview http://127.0.0.1:8765"),
  );
