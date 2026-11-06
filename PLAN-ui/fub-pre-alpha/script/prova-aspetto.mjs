// Prova D12: i controlli di Aspetto cambiano davvero la cornice, nelle due luci.
// Sceglie contrasto alto, densità compatta, tinta terracotta e spazio «Stretta»
// nello stato «aspetto», poi apre la nota e la confronta con quella di serie.
// node prova-aspetto.mjs <out-dir> <foto-dir>
import { chromium } from "./client.mjs";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const { richiedi: require } = await import("./client.mjs");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default ?? require("pixelmatch");

const [dir, fotoDir] = process.argv.slice(2);
mkdirSync(fotoDir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push(`pageerror ${e.message}`));
await p.route(/^https?:/, (r) => r.abort());
const pronto = async () => {
  await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
  await p.waitForTimeout(250);
};
const foto = async (nome) => {
  const buf = await p.locator("#sim-schermo").screenshot();
  writeFileSync(`${fotoDir}/${nome}.png`, buf);
  return PNG.sync.read(buf);
};
const diff = (a, c) => (a.width === c.width && a.height === c.height ? pixelmatch(a.data, c.data, null, a.width, a.height, { threshold: 0.1 }) : -1);
const scegli = async (stato) => {
  await p.selectOption("#sim-stato", stato);
  await pronto();
};
let falliti = 0;
const atteso = (ok, frase) => {
  console.log(`${ok ? "ok  " : "NO  "} ${frase}`);
  if (!ok) falliti++;
};

for (const luce of ["light", "dark"]) {
  await p.goto(`file://${dir}/simulatore.html#stato=nota-riposo&luce=${luce}&moto=ridotto`);
  await pronto();
  const serie = await foto(`nota-serie-${luce}`);
  await scegli("aspetto");
  const schermo = p.frameLocator("#sim-schermo");
  for (const sel of ['[data-setting-key="appearance.contrast"] [data-choice=high]', '[data-setting-key="appearance.density"] [data-choice=compact]', "#prefs-accent-terracotta", "#prefs-space-step-3"]) {
    await schermo.locator(sel).first().scrollIntoViewIfNeeded();
    await schermo.locator(sel).first().click();
    await p.waitForTimeout(150);
    const scelto = await schermo.locator(sel).first().getAttribute("aria-checked");
    atteso(scelto === "true", `${luce}: ${sel} resta scelto (aria-checked=${scelto})`);
  }
  const hash = await p.evaluate(() => location.hash);
  atteso(/p\.contrast=high/.test(hash) && /p\.density=compact/.test(hash) && /p\.compactness=3/.test(hash) && /p\.accent=/.test(hash), `${luce}: l'indirizzo porta le scelte (${hash.replace(/^#/, "").split("&").filter((x) => x.startsWith("p.")).join(" ")})`);
  await scegli("nota-riposo");
  const mia = await foto(`nota-scelte-${luce}`);
  const d = diff(serie, mia);
  atteso(d > 2000, `${luce}: la nota cambia con le scelte (${d} pixel diversi)`);
  const accento = await p.evaluate(() => getComputedStyle(document.getElementById("sim-schermo").contentDocument.documentElement).getPropertyValue("--accent").trim());
  console.log(`     ${luce}: --accent nella cornice = ${accento}`);
  await p.evaluate(() => { location.hash = ""; });
}
console.log(errori.length ? `errori:\n  ${errori.join("\n  ")}` : "errori: nessuno");
await b.close();
process.exit(falliti || errori.length ? 1 : 0);
