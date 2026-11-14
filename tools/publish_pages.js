// Builds the GitHub Pages site (the player with the demos of pages/games.json)
// in out/pages/ and, with --push, publishes it to the gh-pages branch.
//
//   node tools/publish_pages.js            only builds out/pages/ (try it: python3 -m http.server -d out/pages 8000)
//   node tools/publish_pages.js --push     builds it and force-pushes it to origin's gh-pages
//
// The site: pages/index.html (the home page, reads pages/games.json), pages/img/,
// player/, src/, geje-test/ (walkthroughs + golden runs, for geje.run() in the
// console), geje-builds/<game>/ of each demo (make them first with tools/export.js)
// and an exports.json with only those games. gh-pages always holds a single
// commit (a new repo each time, force-pushed), so the demos don't pile up in
// the history. On GitHub: Settings → Pages → branch gh-pages, folder / (once).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out", "pages");
const push = process.argv.includes("--push");
const MAX_FILE = 100 * 1024 * 1024; // GitHub refuses bigger files
const MAX_SITE = 1024 * 1024 * 1024; // Pages: 1 GB per site

const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });

const { games } = JSON.parse(fs.readFileSync(path.join(root, "pages", "games.json"), "utf8"));
const missing = games.filter((g) => !fs.existsSync(path.join(root, "geje-builds", g.game, "game.json")));
if (missing.length) {
  console.error(`no build for: ${missing.map((g) => g.game).join(", ")} (node tools/export.js <project>)`);
  process.exit(1);
}
for (const g of games) if (!fs.existsSync(path.join(root, "pages", "img", `${g.game}.jpg`))) console.warn(`warning: no pages/img/${g.game}.jpg`);

// ---- the site
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
copy("pages/index.html", "index.html");
copy("pages/games.json", "games.json");
copy("pages/img", "img");
copy("player");
copy("src");
copy("LICENSE");
copy("THIRD_PARTY_NOTICES.md");
fs.mkdirSync(path.join(out, "geje-test"));
for (const f of fs.readdirSync(path.join(root, "geje-test"))) if (f.endsWith(".json")) copy(`geje-test/${f}`);
copy("geje-test/golden");
fs.mkdirSync(path.join(out, "geje-builds"));
for (const g of games) copy(`geje-builds/${g.game}`);
fs.writeFileSync(path.join(out, "geje-builds", "exports.json"), JSON.stringify(games.map((g) => g.game)));
fs.writeFileSync(path.join(out, ".nojekyll"), ""); // served as they are (no Jekyll)

// ---- sizes
let total = 0;
const big = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const s = fs.statSync(p).size;
      total += s;
      if (s > MAX_FILE) big.push(path.relative(out, p));
    }
  }
};
walk(out);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`site: ${path.relative(root, out)}/ · ${mb(total)} · ${games.length} demos: ${games.map((g) => g.game).join(", ")}`);
if (big.length) {
  console.error(`files over 100 MB (GitHub refuses them): ${big.join(", ")}`);
  process.exit(1);
}
if (total > MAX_SITE) {
  console.error(`the site is over 1 GB (the Pages limit)`);
  process.exit(1);
}
if (!push) {
  console.log("try it: python3 -m http.server -d out/pages 8000 → http://localhost:8000/ · publish: --push");
  process.exit(0);
}

// ---- gh-pages: one commit, force-pushed
const remote = git(["remote", "get-url", "origin"]);
const engineCommit = git(["rev-parse", "--short", "HEAD"]);
const who = ["user.name", "user.email"].flatMap((k) => ["-c", `${k}=${git(["config", k])}`]);
git(["init", "-q", "-b", "gh-pages"], out);
git(["add", "-A"], out);
git([...who, "commit", "-q", "-m", `Site: ${games.length} demos (engine ${engineCommit})`], out);
console.log(`pushing to ${remote} gh-pages…`);
execFileSync("git", ["push", "-f", remote, "gh-pages"], { cwd: out, stdio: "inherit" });
const m = /github[^:/]*[:/]([^/]+)\/(.+?)(\.git)?$/.exec(remote);
console.log(`done${m ? `: https://${m[1]}.github.io/${m[2]}/` : ""} (first time: Settings → Pages → gh-pages, /)`);
