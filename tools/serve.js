// Static server for the viewer and the exports, without caching.
//
//   node tools/serve.js [port]      (default 8090; serves the repo root)
//   VIDEO_DIR=<dir>                 where autopilot recordings go (default out/videos)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = +(process.argv[2] || 8090);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".ttf": "font/ttf",
  ".otf": "font/otf", ".fnt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".pck": "application/octet-stream",
};

// POST /__video?name=x: a recording (player/autopilot.js) -> $VIDEO_DIR/x.webm
// POST /__log: a line of the autopilot's progress, printed here
const VIDEOS = path.resolve(process.env.VIDEO_DIR || path.join(root, "out", "videos"));

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method === "POST" && (p === "/__video" || p === "/__log")) {
    const parts = [];
    req.on("data", (d) => parts.push(d));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      if (p === "/__log") console.log(`[auto] ${body.toString()}`);
      else {
        const name = (new URL(req.url, "http://x").searchParams.get("name") || "recording").replace(/[^\w.-]/g, "_");
        fs.mkdirSync(VIDEOS, { recursive: true });
        const file = path.join(VIDEOS, `${name}.webm`);
        fs.writeFileSync(file, body);
        console.log(`[auto] video: ${file} (${Math.round(body.length / 1024)} KB)`);
      }
      res.writeHead(200).end("ok");
    });
    return;
  }
  let file = path.join(root, p);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    // "/player" -> "/player/": relative URLs in the page need the slash
    if (!p.endsWith("/")) return res.writeHead(301, { Location: p + "/" + new URL(req.url, "http://x").search }).end();
    file = path.join(file, "index.html");
  }
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end("404 " + p);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}/viewer/`));
