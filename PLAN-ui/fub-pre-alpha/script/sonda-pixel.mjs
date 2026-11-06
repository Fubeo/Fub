// Sonda: quale foglio di stile del simulatore allontana uno stato dalla cattura.
// Monta lo stato, poi toglie un <style data-proto> alla volta e misura la
// differenza con la foto del client.
// node sonda-pixel.mjs <out-dir> <stato> <cattura.png> [luce]
import { chromium } from "./client.mjs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { richiedi: require } = await import("./client.mjs");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default ?? require("pixelmatch");
const [dir, id, ref, luce = "light"] = process.argv.slice(2);
const a = PNG.sync.read(readFileSync(ref));
const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: Math.max(1440, a.width), height: Math.max(1000, a.height) } });
await p.route(/^https?:/, (r) => r.abort());
await p.goto(`file://${dir}/simulatore.html#stato=${id}&luce=${luce}&moto=ridotto`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
await p.addStyleTag({
  content:
    "#sim-box{position:fixed!important;top:0!important;left:0!important;display:block!important;gap:0!important;z-index:999;margin:0!important;padding:0!important}" +
    " #sim-fig-b,#sim-cap-a,#sim-segno{visibility:hidden!important}" +
    " .sim-vetro{width:auto!important;height:auto!important;border-radius:0!important;box-shadow:none!important}" +
    " #sim-schermo{transform:none!important}",
});
await p.waitForTimeout(300);
const misura = async (nome) => {
  await p.waitForTimeout(150);
  const shot = PNG.sync.read(await p.screenshot({ clip: { x: 0, y: 0, width: a.width, height: a.height } }));
  const n = pixelmatch(a.data, shot.data, null, a.width, a.height, { threshold: 0.1 });
  console.log(`${((100 * n) / (a.width * a.height)).toFixed(2)}%  ${nome}`);
};
await misura("tutto");
const etichette = await p.evaluate(() => [...document.getElementById("sim-schermo").contentDocument.querySelectorAll("style[data-proto]")].map((s) => s.getAttribute("data-proto")));
console.log("fogli:", etichette.join(" | "));
for (const e of etichette.filter((e) => /^(nuovo:|solo-simulatore)/.test(e))) {
  const tolto = await p.evaluate((e) => {
    const s = document.getElementById("sim-schermo").contentDocument.querySelector(`style[data-proto="${e}"]`);
    const t = s.textContent;
    s.textContent = "";
    return t;
  }, e);
  await misura(`senza ${e}`);
  await p.evaluate(([e, t]) => (document.getElementById("sim-schermo").contentDocument.querySelector(`style[data-proto="${e}"]`).textContent = t), [e, tolto]);
}
const info = await p.evaluate(() => {
  const d = document.getElementById("sim-schermo").contentDocument;
  const el = d.querySelector("#vault-name, .vault-name, .vault-switcher-name") ?? d.querySelector(".titlebar *");
  const cs = el ? d.defaultView.getComputedStyle(el) : null;
  return cs ? { el: el.className || el.id, font: cs.font, ls: cs.letterSpacing, fvs: cs.fontVariationSettings, fos: cs.fontOpticalSizing, ffs: cs.fontFeatureSettings } : null;
});
console.log(JSON.stringify(info));
const src = await p.evaluate(() => document.getElementById("sim-schermo").srcdoc);
const p2 = await b.newPage({ viewport: { width: a.width, height: a.height } });
await p2.route(/^https?:/, (r) => r.abort());
await p2.setContent(src);
await p2.evaluate(() => document.fonts.ready);
await p2.waitForTimeout(400);
const s2 = PNG.sync.read(await p2.screenshot());
console.log("in cima, senza iframe:", ((100 * pixelmatch(a.data, s2.data, null, a.width, a.height, { threshold: 0.1 })) / (a.width * a.height)).toFixed(2) + "%");
await b.close();
