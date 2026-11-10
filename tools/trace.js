// Runs an exported game's intro in Node (no browser, no drawing) and prints
// what happened: the lines said, the rooms entered, errors, and the globals at
// the end. For comparing a game before and after a change to the engine or
// the exporter.
//
//   node tools/trace.js <exported game> [clicks]
//
// <exported game> is a folder name in out/ (e.g. openquest-escoria). It
// starts the game from :init, clicks the title screen's exit, then "clicks"
// (ends the speech) [clicks] times, 0.6 s apart (default 40).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, nClicks = "40"] = process.argv.slice(2);
if (!name) {
  console.log("usage: node tools/trace.js <exported game in out/> [clicks]");
  process.exit(1);
}
const gameDir = path.join(base, "out", name);

// the little of the browser the engine touches without drawing
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Audio = class { constructor(u) { this.src = u; this.paused = true; } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } addEventListener() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { fullscreenElement: null, createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {} }) }) };
globalThis.fetch = async (u) => ({ ok: true, text: async () => fs.readFileSync(path.join(gameDir, u.slice(2)), "utf8") });

const imp = (f) => import(new URL("file://" + path.join(base, f)).href);
const { GameData } = await imp("src/godot/game_data.js");
const { Escoria } = await imp("src/escoria/escoria.js");
const { API } = await imp("src/escoria/ports.js");
const { GameUI } = await imp("src/escoria/ui/game_ui.js");

const game = new GameData("./", JSON.parse(fs.readFileSync(path.join(gameDir, "game.json"))));
game.loadImagesIn = async () => {};
game.loadImage = async () => null;
const trace = [];
let gameUI;
const esc = new Escoria(game, {
  log: (m, l) => { if (l === "error") trace.push("ERROR " + m); },
  ui: {
    say: (o, t, x) => { trace.push(`SAY ${o.globalId}: ${t}`); return gameUI.say(o, t, x.cmd); },
    quit() { trace.push("QUIT"); },
  },
});
if (game.json.ports) await (await import(new URL("file://" + path.join(gameDir, game.json.ports)).href)).install(esc, API);
gameUI = await GameUI.create(esc, game.json.width || 1280, game.json.height || 800);

const run = async (s) => {
  for (let i = 0; i < s * 30; i++) {
    esc.update(1 / 30);
    gameUI.update(1 / 30);
    esc.frameDrawn();
    await null;
    await null;
  }
};
let room = null;
const watchRoom = () => {
  const r = esc.roomObject?.globalId;
  if (r && r !== room) trace.push(`ROOM ${(room = r)}`);
};
esc.runStartEvent("init");
await run(3);
watchRoom();
const exit = [...esc.objects.keys()].find((k) => esc.objects.get(k).node?.props?.is_exit);
if (exit) esc.runObjectEvent(exit, "exit_scene");
for (let i = 0; i < +nClicks; i++) {
  gameUI.endSpeech?.();
  await run(0.6);
  watchRoom();
}
const g = [...esc.globals.values].filter(([k]) => !k.startsWith("i/")).sort();
console.log(trace.join("\n") + "\n--- globals\n" + g.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n"));
process.exit(0);
