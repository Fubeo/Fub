// Fotografa ogni stato del simulatore (le due luci, le larghezze che ha) e lo
// confronta con la foto presa durante la cattura dal client vero.
// node foto-sim.mjs <out-dir> <foto-dir> [solo=id,id]
import { chromium } from "/home/fubeo/Progetti/Fub/apps/client/node_modules/playwright/index.mjs";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire("/home/fubeo/Progetti/Fub/apps/client/package.json");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default ?? require("pixelmatch");
const { STATI } = await import("./stati-sim.mjs");
const [dir, fotoDir, soloArg] = process.argv.slice(2);
const solo = soloArg ? new Set(soloArg.replace(/^solo=/, "").split(",")) : null;
const CARTELLE = ["nuove6", "nuove5", "nuove2", "nuove4", "nuove3", "nuove", "s2", "avvio"].map((c) => join(import.meta.dirname, "..", "catture", c));
const pngDi = (key) => CARTELLE.map((c) => join(c, `${key}.png`)).find(existsSync);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push(e.message));
await p.route(/^https?:/, (r) => r.abort());
const righe = [];
for (const s of STATI) {
  if (solo && !solo.has(s.id)) continue;
  const larghe = s.g === "Telefono" ? ["tel"] : ["piena", ...(s.w700 ? ["700"] : []), ...(s.tel ? ["tel"] : [])];
  for (const larghezza of larghe) {
    for (const luce of ["light", "dark"]) {
      const base = s.g === "Telefono" ? s.id : larghezza === "700" ? s.w700 : larghezza === "tel" ? s.tel : s.id;
      const key = `${base}-${luce}`;
      await p.goto(`file://${dir}/simulatore.html#stato=${s.id}&luce=${luce}&larghezza=${larghezza}&moto=pieno`);
      await p.waitForFunction((k) => document.getElementById("sim-box").dataset.pronto === k, key, { timeout: 20000 }).catch(() => errori.push(`non pronto ${key}`));
      await p.waitForTimeout(150);
      const out = join(fotoDir, `${s.id}--${larghezza}-${luce}.png`);
      // lo schermo a scala 1, fermo in alto a sinistra (come foto-proto.mjs)
      const r = await p.evaluate(() => { const f = document.getElementById("sim-schermo"); return { x: 0, y: 0, width: +f.width, height: +f.height }; });
      await p.setViewportSize({ width: Math.max(1400, r.width), height: Math.max(1000, r.height) });
      await p.evaluate(() => {
        let st = document.getElementById("foto-fissa");
        if (!st) { st = document.createElement("style"); st.id = "foto-fissa"; document.head.append(st); }
        st.textContent = "#sim-box{position:fixed!important;top:0!important;left:0!important;width:auto!important;height:auto!important;overflow:visible!important;z-index:999;border-radius:0!important;margin:0!important;border:0!important;padding:0!important} #sim-schermo{transform:none!important} #sim-segno{display:none!important}";
      });
      await p.waitForTimeout(80);
      await p.screenshot({ path: out, clip: r });
      const ref = pngDi(key);
      let diff = "—";
      if (ref) {
        const a = PNG.sync.read(readFileSync(ref));
        const c = PNG.sync.read(readFileSync(out));
        if (a.width === c.width && a.height === c.height) {
          const d = new PNG({ width: a.width, height: a.height });
          const n = pixelmatch(a.data, c.data, d.data, a.width, a.height, { threshold: 0.1 });
          diff = `${(100 * n / (a.width * a.height)).toFixed(2)}%`;
          if (n > 0) writeFileSync(out.replace(/\.png$/, ".diff.png"), PNG.sync.write(d));
        } else diff = `misura ${a.width}x${a.height} ≠ ${c.width}x${c.height}`;
      }
      righe.push(`${s.id}\t${larghezza}\t${luce}\t${diff}`);
    }
  }
}
writeFileSync(join(fotoDir, "confronto.tsv"), righe.join("\n") + "\n");
console.log(righe.join("\n"));
console.log("errori:", errori.length ? errori.join("\n") : "nessuno");
await b.close();
