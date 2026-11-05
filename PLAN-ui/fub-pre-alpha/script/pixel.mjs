// node pixel.mjs in.png x,y [x,y ...]  → il colore di ogni punto (hex)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/fubeo/.cache/fub-k1/tmp/scrittoio2/anteprima-copia/apps/client/package.json");
const { chromium } = require("playwright");
const [inp, ...pts] = process.argv.slice(2);
const data = readFileSync(inp).toString("base64");
const b = await chromium.launch();
const p = await b.newPage();
const out = await p.evaluate(async ({ data, pts }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${data}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return pts.map((s) => {
    const [x, y] = s.split(",").map(Number);
    const d = g.getImageData(x, y, 1, 1).data;
    return `${s} #${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  });
}, { data, pts });
console.log(out.join("\n"));
await b.close();
