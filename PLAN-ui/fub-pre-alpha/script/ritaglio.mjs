// node ritaglio.mjs out.png x y w h scala a.png b.png [c.png] → i ritagli affiancati, ingranditi
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const { richiedi: require } = await import("./client.mjs");
const { PNG } = require("pngjs");
const [out, X, Y, W, H, S, ...imgs] = process.argv.slice(2);
const [x, y, w, h, s] = [X, Y, W, H, S].map(Number);
const o = new PNG({ width: w * s * imgs.length + 4 * (imgs.length - 1), height: h * s });
o.data.fill(255);
imgs.forEach((f, k) => {
  const a = PNG.sync.read(readFileSync(f));
  for (let j = 0; j < h * s; j++) for (let i = 0; i < w * s; i++) {
    const sx = x + Math.floor(i / s), sy = y + Math.floor(j / s);
    const si = (sy * a.width + sx) * 4, di = (j * o.width + k * (w * s + 4) + i) * 4;
    for (let c = 0; c < 4; c++) o.data[di + c] = a.data[si + c];
  }
});
writeFileSync(out, PNG.sync.write(o));
