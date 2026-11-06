// Cattura gli stati delle pagine di piano approvate (lavagna, penne, celle,
// disegno sul motore, ricette…) come catture del simulatore: DOM + CSS + PNG.
//
// node cattura-piani.mjs <cartella delle pagine> <out> <piani.json> [solo=id,..]
//
// Ogni voce di piani.json:
//   { id, pagina, palco, passi?, luci?: {light:[passi], dark:[passi]},
//     misura?: [w, h], mostra?: [selettori], trasparente?: bool, nascondi?: [selettori] }
// I passi: {clic}, {scegli:[sel, valore]}, {tasto}, {riempi:[sel, testo]},
// {passa}, {trascina:[x1,y1,x2,y2]}, {attesa}.
//
// Il palco si stacca dal resto della pagina: tutto ciò che non lo contiene né
// gli sta dentro sparisce, e il palco riempie la finestra della misura data.
// Con `mostra`, dentro il palco restano visibili solo quei pezzi; con
// `trasparente`, lo sfondo è trasparente (uno strato sopra un'altra cattura).
// Le pagine non si toccano: si leggono da file:// e basta. Nessuna porta.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { serialize } from "./serializza.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [protoDir, out, specPath, soloArg] = process.argv.slice(2);
if (!protoDir || !out || !specPath) throw new Error("uso: node cattura-piani.mjs <pagine> <out> <piani.json> [solo=..]");
const solo = soloArg?.startsWith("solo=") ? new Set(soloArg.slice(5).split(",")) : null;
const { chromium } = await import("./client.mjs");
const spec = JSON.parse(await readFile(join(here, specPath), "utf8").catch(() => readFile(specPath, "utf8")));

function isola({ palco, mostra, trasparente, nascondi }) {
  const st = document.querySelector(palco);
  if (!st) throw new Error(`palco assente: ${palco}`);
  const via = new Set();
  for (let e = st.parentElement; e; e = e.parentElement) via.add(e);
  for (const anc of via) {
    anc.setAttribute("data-sim-via", "");
    for (const c of anc.children) {
      if (c === st || via.has(c) || ["STYLE", "SCRIPT", "LINK", "META", "TITLE", "HEAD"].includes(c.tagName)) continue;
      // I popover del kit vivono in fondo a body ma appartengono al palco:
      // restano se sono aperti.
      if (c.matches?.(".kit-popover, .kit-menu, #shell-tooltip") && c.getBoundingClientRect().width > 0) continue;
      c.setAttribute("data-sim-fuori", "");
    }
  }
  st.setAttribute("data-sim-palco", "");
  for (const sel of nascondi ?? []) for (const el of st.querySelectorAll(sel)) el.setAttribute("data-sim-fuori", "");
  if (mostra?.length) {
    const tenuti = mostra.flatMap((sel) => [...document.querySelectorAll(sel)]);
    const sopra = new Set();
    for (const t of tenuti) for (let e = t.parentElement; e && e !== document.body; e = e.parentElement) sopra.add(e);
    for (const el of st.querySelectorAll("*")) {
      if (sopra.has(el)) el.setAttribute("data-sim-sopra", "");
      else if (!tenuti.some((t) => t === el || t.contains(el))) el.setAttribute("data-sim-velo", "");
    }
    st.setAttribute("data-sim-sopra", "");
  }
  const s = document.createElement("style");
  s.id = "sim-isola";
  s.textContent = `
[data-sim-fuori] { display: none !important; }
/* Alcune pagine di piano danno un display proprio a blocchi che poi nascondono
 * con hidden (ricette.html): qui hidden vince, come deve vincere nel client. */
[hidden] { display: none !important; }
html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; height: 100% !important; min-height: 0 !important; min-width: 0 !important; }
[data-sim-via] { position: relative !important; margin: 0 !important; padding: 0 !important; border: 0 !important; max-width: none !important; width: 100% !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important; }
[data-sim-palco] { position: absolute !important; inset: 0 !important; width: auto !important; height: auto !important; max-width: none !important; max-height: none !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; border: 0 !important; transform: none !important; }
[data-sim-velo] { visibility: hidden !important; }
[data-sim-sopra] { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
${trasparente ? "html, body, [data-sim-via], [data-sim-palco] { background: transparent !important; }" : ""}
`;
  document.head.append(s);
  window.dispatchEvent(new Event("resize"));
}

async function passo(page, p) {
  if (p.clic) await page.click(p.clic, { timeout: 8000 });
  else if (p.scegli) await page.selectOption(p.scegli[0], p.scegli[1]);
  else if (p.tasto) await page.keyboard.press(p.tasto);
  else if (p.riempi) await page.fill(p.riempi[0], p.riempi[1]);
  else if (p.passa) await page.hover(p.passa);
  else if (p.trascina) {
    const [x1, y1, x2, y2] = p.trascina;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 });
    await page.mouse.move(x2, y2, { steps: 6 });
    if (!p.tieni) await page.mouse.up();
  } else if (p.attesa) await page.waitForTimeout(p.attesa);
  await page.waitForTimeout(p.dopo ?? 250);
}

await mkdir(out, { recursive: true });
// Gli argomenti del banco (bench/stage.mjs), gli stessi di foto-sim.mjs: senza,
// i caratteri si disegnano diversi e il confronto dei pixel conta ogni testo.
const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
let fatti = 0;
try {
  for (const e of spec) {
    if (solo && !solo.has(e.id)) continue;
    const luci = e.luci ?? { light: [], dark: [] };
    for (const [luce, passiLuce] of Object.entries(luci)) {
      const page = await browser.newPage({ viewport: { width: e.vista?.[0] ?? 1400, height: e.vista?.[1] ?? 1000 } });
      try {
        await page.emulateMedia({ colorScheme: luce === "dark" ? "dark" : "light", reducedMotion: "reduce" });
        await page.goto(pathToFileURL(join(protoDir, e.pagina)).href, { waitUntil: "load" });
        await page.waitForTimeout(500);
        for (const p of [...passiLuce, ...(e.passi ?? [])]) await passo(page, p);
        await page.waitForTimeout(e.attesa ?? 500);
        const [w, h] = e.misura ?? [960, 620];
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate(isola, { palco: e.palco, mostra: e.mostra, trasparente: e.trasparente, nascondi: e.nascondi });
        await page.waitForTimeout(400);
        await page.mouse.move(w - 2, h - 2);
        await page.screenshot({ path: join(out, `${e.id}-${luce}.png`), omitBackground: Boolean(e.trasparente) });
        const cap = await page.evaluate(serialize, []);
        await writeFile(join(out, `${e.id}-${luce}.json`), JSON.stringify(cap));
        fatti++;
        console.log(`ok ${e.id} ${luce} ${Math.round(cap.body.length / 1024)} KB dom`);
      } catch (err) {
        console.log(`ERRORE ${e.id} ${luce} ${String(err.message ?? err).split("\n").slice(0, 2).join(" | ")}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`fatti ${fatti}`);
