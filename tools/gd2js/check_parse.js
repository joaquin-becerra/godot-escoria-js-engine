// Parses every .gd under the given folders and reports the ones that fail.
//   node tools/gd2js/check_parse.js <dir>...
import fs from "node:fs";
import path from "node:path";
import { parse } from "./parser.js";

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".gd")) files.push(p);
  }
};
for (const d of process.argv.slice(2)) walk(d);
let ok = 0;
const fails = [];
for (const f of files) {
  try {
    parse(fs.readFileSync(f, "utf8"));
    ok++;
  } catch (e) {
    fails.push(`${f}: ${e.message}`);
  }
}
for (const f of fails.slice(0, 40)) console.log("✗", f);
console.log(`${ok}/${files.length} .gd files read without errors`);
