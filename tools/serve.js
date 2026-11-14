// Static server for the viewer and the exports, without caching.
//
//   node tools/serve.js [port]      (default 8090; serves the repo root)
//   VIDEO_DIR=<dir>                 where recordings go (default out/videos)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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

// A recording made of frames (player/geje_test.js, geje.record()): ffmpeg
// takes the JPEG frames in order and writes $VIDEO_DIR/<name>.mp4
//   POST /__rec/start?name=x&fps=30   POST /__rec/frame?name=x (a JPEG)   POST /__rec/end?name=x
const recordings = new Map(); // name -> {ff, file, frames, done}
function recording(p, q, body, res) {
  const name = (q.get("name") || "recording").replace(/[^\w.-]/g, "_");
  if (p === "/__rec/start") {
    recordings.get(name)?.ff.stdin.end();
    fs.mkdirSync(VIDEOS, { recursive: true });
    const file = path.join(VIDEOS, `${name}.mp4`);
    const fps = +(q.get("fps") || 30);
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", file], { stdio: ["pipe", "inherit", "inherit"] });
    const rec = { ff, file, frames: 0, done: new Promise((ok) => ff.on("close", ok)) };
    recordings.set(name, rec);
    console.log(`[rec] ${name}: recording to ${file} at ${fps} fps`);
    return res.writeHead(200).end("ok");
  }
  const rec = recordings.get(name);
  if (!rec) return res.writeHead(404).end("no such recording");
  if (p === "/__rec/frame") {
    rec.frames++;
    // ffmpeg's pace: answer when it took the frame (the page sends the next one then)
    if (rec.ff.stdin.write(body)) return res.writeHead(200).end("ok");
    return rec.ff.stdin.once("drain", () => res.writeHead(200).end("ok"));
  }
  rec.ff.stdin.end();
  rec.done.then((code) => {
    recordings.delete(name);
    const size = fs.existsSync(rec.file) ? Math.round(fs.statSync(rec.file).size / 1024) : 0;
    console.log(`[rec] ${name}: ${rec.frames} frames -> ${rec.file} (${size} KB, ffmpeg ${code})`);
    res.writeHead(code === 0 ? 200 : 500).end(JSON.stringify({ file: rec.file, frames: rec.frames, kb: size }));
  });
}

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (req.method === "POST" && p.startsWith("/__rec/")) {
    const parts = [];
    req.on("data", (d) => parts.push(d));
    req.on("end", () => recording(p, new URL(req.url, "http://x").searchParams, Buffer.concat(parts), res));
    return;
  }
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
