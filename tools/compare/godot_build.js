// A web build of a Godot project with the test probe (godot/probe.gd) as an
// autoload, made from a copy: the project itself is not touched.
//
//   node tools/compare/godot_build.js ../openquest-escoria [out/compare/build/openquest-escoria]
//
// The copy goes in <out>/project, the build in <out>/web (index.html).
// $GODOT: the Godot 4 editor binary (default: godot, from the PATH).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const GODOT = process.env.GODOT || "godot";
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(process.argv[2] || "");
if (!fs.existsSync(path.join(src, "project.godot"))) {
  console.error("usage: godot_build.js <godot project> [output]");
  process.exit(2);
}
const out = path.resolve(process.argv[3] || path.join("out/compare/build", path.basename(src)));
const proj = path.join(out, "project");
const web = path.join(out, "web");

fs.rmSync(proj, { recursive: true, force: true });
fs.mkdirSync(proj, { recursive: true });
fs.cpSync(src, proj, { recursive: true, filter: (f) => !/\/(build|\.git)(\/|$)/.test(f.slice(src.length)) });
fs.copyFileSync(path.join(here, "godot/probe.gd"), path.join(proj, "probe.gd"));

// the autoload, after escoria's
let pg = fs.readFileSync(path.join(proj, "project.godot"), "utf8");
if (!/\n\[autoload\]\n/.test(pg)) pg += "\n[autoload]\n";
pg = pg.replace(/\n\[autoload\]\n((?:[^\[\n].*\n|\n)*?)(?=\n\[|$)/, (m, body) => `\n[autoload]\n${body.replace(/\n*$/, "\n")}__probe="*res://probe.gd"\n`);
fs.writeFileSync(path.join(proj, "project.godot"), pg);

fs.rmSync(web, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
const run = (args) => execFileSync(GODOT, ["--headless", "--path", proj, ...args], { stdio: "inherit" });
run(["--import"]);
run(["--export-release", "Web", path.join(web, "index.html")]);
console.log(`build: ${web}/index.html`);
