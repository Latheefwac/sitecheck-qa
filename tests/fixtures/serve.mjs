// Tiny static server for the demo fixture site (has deliberate defects for testing the platform).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const types = { ".html": "text/html; charset=utf-8", ".xml": "application/xml", ".txt": "text/plain", ".svg": "image/svg+xml", ".jpg": "image/png", ".webp": "image/png", ".ico": "image/png" };
const port = Number(process.env.PORT || 4321);
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"success":true}'); }
  const file = path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<h1>Not found</h1>"); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "x-powered-by": "Express 4.17.1" });
  res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
}).listen(port, () => console.log(`Fixture site on http://localhost:${port}`));
