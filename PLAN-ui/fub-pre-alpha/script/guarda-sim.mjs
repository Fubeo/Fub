// Guarda alcuni stati del simulatore v2: una foto della scatola per ognuno, gli
// errori della pagina e ciò che il simulatore non ha trovato.
// node guarda-sim.mjs <out-dir> <foto-dir> stato[:larghezza[:luce[:moto]]] ...
import { chromium } from "./client.mjs";
import { mkdirSync } from "node:fs";
const [dir, fotoDir, ...specs] = process.argv.slice(2);
mkdirSync(fotoDir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push("pageerror " + e.message));
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errori.push(`console.${m.type()} ${m.text()}`));
await p.route(/^https?:/, (r) => r.abort());
for (const spec of specs) {
  const [stato, larghezza = "piena", luce = "light", moto = "pieno"] = spec.split(":");
  const t0 = Date.now();
  await p.goto(`file://${dir}/simulatore.html#stato=${stato}&luce=${luce}&larghezza=${larghezza}&moto=${moto}`);
  await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 }).catch(() => errori.push(`non pronto ${spec}`));
  await p.waitForTimeout(300);
  const info = await p.evaluate(() => ({
    pronto: document.getElementById("sim-box").dataset.pronto,
    manca: document.getElementById("sim-box").dataset.manca ?? "",
    msg: document.getElementById("sim-msg").textContent,
    pezzi: [...document.querySelectorAll("#sim-pezzi li")].length,
  }));
  const nome = spec.replace(/:/g, "--");
  // La barra appiccicata coprirebbe la cima della foto di <main>.
  await p.evaluate(() => { document.querySelector(".sim-bar").style.position = "static"; });
  await p.locator("main").screenshot({ path: `${fotoDir}/${nome}.png` });
  console.log(`${spec}\t${Date.now() - t0} ms\tpronto=${info.pronto}\tpezzi=${info.pezzi}${info.manca ? `\tMANCA ${info.manca}` : ""}${info.msg ? `\tmsg ${info.msg}` : ""}`);
}
console.log("errori:", errori.length ? `\n  ${errori.join("\n  ")}` : "nessuno");
await b.close();
