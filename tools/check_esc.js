// Compiles every .esc script of an export with the JS ASHES compiler and
// reports errors (and a summary of events per script).
//
//   node tools/check_esc.js out/<game>/game.json [-v]
import fs from "node:fs";
import { compile } from "../src/escoria/ashes/compiler.js";

const game = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const verbose = process.argv.includes("-v");
let bad = 0, events = 0;
for (const [file, src] of Object.entries(game.scripts)) {
  const s = compile(src, file);
  events += s.events.size;
  if (s.errors.length) {
    bad++;
    console.log(`✗ ${file}`);
    for (const e of s.errors) console.log(`    ${e}`);
  } else if (verbose) console.log(`✓ ${file}: ${[...s.events.keys()].join(", ")}`);
}
const n = Object.keys(game.scripts).length;
console.log(`${n - bad}/${n} scripts without errors, ${events} events`);
process.exitCode = bad ? 1 : 0;
