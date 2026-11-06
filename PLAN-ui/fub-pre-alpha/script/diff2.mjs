// node diff2.mjs a.png b.png out.diff.png → percentuale di pixel diversi
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const { richiedi: require } = await import("./client.mjs");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default ?? require("pixelmatch");
const [x, y, out] = process.argv.slice(2);
const a = PNG.sync.read(readFileSync(x)), b = PNG.sync.read(readFileSync(y));
if (a.width !== b.width || a.height !== b.height) { console.log(`misure ${a.width}x${a.height} contro ${b.width}x${b.height}`); process.exit(0); }
const d = new PNG({ width: a.width, height: a.height });
const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
if (out && n) writeFileSync(out, PNG.sync.write(d));
console.log(`${n} pixel, ${(100 * n / (a.width * a.height)).toFixed(2)}%`);
