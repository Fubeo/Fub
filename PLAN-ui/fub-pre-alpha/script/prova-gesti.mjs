// Prova i gesti del telefono nel simulatore: strisciate, bordo, pressione lunga.
// node prova-gesti.mjs <out-dir> <foto-dir>
import { chromium } from "./client.mjs";
import { mkdirSync } from "node:fs";
const [dir, fotoDir] = process.argv.slice(2);
mkdirSync(fotoDir, { recursive: true });
const b = await chromium.launch();
// Tocchi veri via CDP: il mouse premuto di Playwright si ferma sull'iframe
// srcdoc (aspetta un trascinamento che non arriva), e il telefono si tocca.
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const tocca = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
const errori = [];
p.on("pageerror", (e) => errori.push(`pageerror ${e.message}`));
await p.route(/^https?:/, (r) => r.abort());
p.setDefaultTimeout(10000);
setTimeout(() => {
  console.log("NO   la prova non finisce in 90 s");
  process.exit(2);
}, 90000).unref();
const pronto = async () => {
  await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 10000 });
  await p.waitForTimeout(250);
};
const stato = () => p.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("stato"));
// Dal punto (x, y) dello schermo del telefono al punto della pagina.
const punto = async (x, y) => {
  const box = await p.locator("#sim-schermo").boundingBox();
  const w = Number(await p.locator("#sim-schermo").getAttribute("width"));
  const k = box.width / w;
  return [box.x + x * k, box.y + y * k];
};
const striscia = async (x0, x1, y) => {
  const [a, ya] = await punto(x0, y);
  const [c] = await punto(x1, y);
  await tocca("touchStart", a, ya);
  for (let i = 1; i <= 8; i++) {
    await p.waitForTimeout(16);
    await tocca("touchMove", a + ((c - a) * i) / 8, ya);
  }
  await tocca("touchEnd");
  await p.waitForTimeout(150);
  await pronto();
};
let falliti = 0;
const atteso = async (id, frase) => {
  const s = await stato();
  console.log(`${s === id ? "ok  " : "NO  "} ${frase}: ${s}`);
  if (s !== id) falliti++;
};

await p.goto(`file://${dir}/simulatore.html#stato=nota-riposo&larghezza=tel&moto=ridotto`);
await pronto();
await striscia(120, 300, 420);
await atteso("tel-cassetto", "da sinistra a destra sul testo apre il cassetto");
await p.locator("#sim-schermo").screenshot({ path: `${fotoDir}/cassetto.png` });
await striscia(300, 100, 420);
await atteso("nota-riposo", "a sinistra sul cassetto lo chiude");
await striscia(300, 100, 420);
await atteso("tel-ispettore", "da destra a sinistra apre l'ispettore");
await striscia(100, 300, 420);
await atteso("nota-riposo", "a destra sull'ispettore lo chiude");
await striscia(120, 300, 420);
await striscia(6, 200, 420);
await atteso("nota-riposo", "dal bordo torna indietro");
// La pressione lunga sul testo apre il menu del tocco.
const [x, y] = await punto(150, 420);
await tocca("touchStart", x, y);
await p.waitForTimeout(700);
await tocca("touchEnd");
await p.waitForTimeout(200);
const menu = await p.evaluate(() => {
  const d = document.getElementById("sim-schermo").contentDocument;
  return [...d.querySelectorAll('[role="menu"]')].filter((m) => m.getBoundingClientRect().width > 0).length;
});
const msg = await p.locator("#sim-msg").textContent();
console.log(`${menu ? "ok  " : "NO  "} la pressione lunga apre un menu (${menu} visibili; «${msg.trim()}»)`);
if (!menu) falliti++;
await p.locator("#sim-schermo").screenshot({ path: `${fotoDir}/pressione-lunga.png` });
console.log(errori.length ? `errori:\n  ${errori.join("\n  ")}` : "errori: nessuno");
await b.close();
process.exit(falliti || errori.length ? 1 : 0);
