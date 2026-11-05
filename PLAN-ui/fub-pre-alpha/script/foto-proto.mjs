// Fotografa PLAN-ui/scrittoio-2.html stato per stato e lo confronta con cattura2.
// node script/foto-proto.mjs <pagina.html> <cartella> [stato...]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
async function scatta(p) {
  // Solo per la foto: lo schermo in alto a sinistra, a pixel interi.
  await p.addStyleTag({ content: "#proto-box{position:fixed!important;top:0!important;left:0!important;z-index:9;border-radius:0!important}" });
  await p.waitForTimeout(50);
  const r = await p.locator("#proto-schermo").boundingBox();
  const [w, h] = await p.evaluate(() => [Number(document.getElementById("proto-schermo").width), Number(document.getElementById("proto-schermo").height)]);
  return p.screenshot({ clip: { x: Math.round(r.x), y: Math.round(r.y), width: w, height: h } });
}
const [pagina, outDir, ...solo] = process.argv.slice(2);
// FOTO_Q: una query in più (per esempio «prima=ombra,vassoio,sezioni»);
// FOTO_SOLO=1: niente fuoco, niente pagina intera, niente confronto.
const extra = process.env.FOTO_Q ? `&${process.env.FOTO_Q}` : "";
const soloFoto = process.env.FOTO_SOLO === "1";
const nm = join(process.cwd(), "anteprima-copia/apps/client/node_modules");
const { chromium } = await import(pathToFileURL(join(nm, "playwright/index.mjs")).href);
const { PNG } = (await import(pathToFileURL(join(nm, "pngjs/lib/png.js")).href)).default;
const pixelmatch = (await import(pathToFileURL(join(nm, "pixelmatch/index.js")).href)).default;
const html = await readFile(pagina);
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(1457, "127.0.0.1");
await mkdir(outDir, { recursive: true });
const src = await readFile(pagina, "utf8");
const stati = JSON.parse(/const STATI = (\[.*?\]);\n/.exec(src)[1]);
const b = await chromium.launch();
const errori = [];
const righe = [];
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
  p.on("pageerror", (e) => errori.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errori.push(m.text()));
  for (const s of stati) {
    if (solo.length && !solo.includes(s.id)) continue;
    for (const luce of ["light", "dark"]) {
      for (const larg of s.w700 ? ["piena", "700"] : ["piena"]) {
        const id = `${larg === "700" ? s.w700 : s.id}-${luce}`;
        await p.goto(`http://127.0.0.1:1457/?stato=${s.id}&luce=${luce}&larghezza=${larg}${extra}`);
        await p.waitForSelector(`#proto-box[data-pronto="${id}"]`, { timeout: 30000 });
        await p.waitForTimeout(250);
        const shot = await scatta(p);
        await writeFile(join(outDir, `${id}.png`), shot);
        if (soloFoto) continue;
        // confronto con la cattura
        try {
          const a = PNG.sync.read(shot);
          const c = PNG.sync.read(await readFile(join("cattura2", `${id}.png`)));
          if (a.width !== c.width || a.height !== c.height) righe.push(`${id}: misure ${a.width}x${a.height} contro ${c.width}x${c.height}`);
          else {
            const d = new PNG({ width: a.width, height: a.height });
            const n = pixelmatch(a.data, c.data, d.data, a.width, a.height, { threshold: 0.1 });
            righe.push(`${id}: ${n} pixel diversi`);
            if (n > 0) await writeFile(join(outDir, `${id}.diff.png`), PNG.sync.write(d));
          }
        } catch (e) {
          righe.push(`${id}: confronto non riuscito ${e.message}`);
        }
        // il fuoco, da tastiera
        await p.focus("#proto-fuoco");
        await p.keyboard.press("Space");
        await p.waitForTimeout(300);
        const fuoco = await p.evaluate(() => {
          const d = document.getElementById("proto-schermo").contentDocument;
          const a = d.activeElement;
          return a && a !== d.body ? `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}.${[...a.classList].join(".")} ${a.matches(":focus-visible") ? "visibile" : "NON visibile"}` : "nessuno";
        });
        righe.push(`${id} fuoco: ${fuoco}`);
        await writeFile(join(outDir, `${id}.fuoco.png`), await scatta(p));
      }
    }
  }
  // La pagina intera: computer e telefono.
  if (!soloFoto) {
  await p.goto("http://127.0.0.1:1457/?stato=nota");
  await p.waitForSelector('#proto-box[data-pronto="nota-light"]');
  await writeFile(join(outDir, "_pagina.png"), await p.screenshot({ fullPage: true }));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  righe.push(`telefono: scrollWidth ${sw[0]} clientWidth ${sw[1]}`);
  await writeFile(join(outDir, "_pagina-telefono.png"), await p.screenshot({ fullPage: true }));
  }
} finally {
  await b.close();
  server.close();
}
await writeFile(join(outDir, "_resoconto.txt"), [...righe, "", "errori:", ...errori].join("\n") + "\n");
console.log(righe.join("\n"));
console.log("errori:", errori.length ? errori.join("\n") : "nessuno");
