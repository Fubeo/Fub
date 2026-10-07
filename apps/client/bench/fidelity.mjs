// **Il banco di fedeltà**: ciò che si vede è ciò che esce. Ogni scena del
// corpus (`fidelity-corpus.ts`) si disegna dalle tre strade che la mostrano,
// il foglio vivo, la Lettura e il PNG dell'export, e la Lettura e l'export si
// confrontano col foglio, pixel per pixel.
//
//     node bench/fidelity.mjs
//
// Il banco non ha baseline: il termine di paragone è il foglio stesso, nella
// stessa pagina e nello stesso browser, e una differenza fra le strade è
// sempre un errore, qualunque sia il sistema. Prima del corpus il banco
// prova sé stesso: una differenza messa apposta in una strada sola, un
// colore, un carattere, un corsivo, un tratteggio, deve farlo diventare
// rosso.
//
// # La soglia
//
// Due strade dello stesso browser non disegnano gli stessi pixel ai bordi:
// il foglio vivo è nel DOM, la Lettura in un'immagine, l'export in un canvas.
// `pixelmatch` riconosce l'antialiasing da sé; quello che resta si conta, e
// una scena passa se i pixel diversi sono al più `LIMIT` del totale. In
// Chromium le tre strade danno oggi gli stessi pixel su ogni scena, e la più
// piccola delle differenze messe apposta, il tratteggio tolto, ne cambia il
// 3%: lo 0,2% sta largo fra le due, e lascia posto a un altro browser.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { openStage, OUTPUT } from "./stage.mjs";

/// La soglia di colore di `pixelmatch`, e la parte dei pixel che può
/// cambiare (vedi sopra).
const THRESHOLD = 0.1;
const LIMIT = 0.002;
/// Le differenze messe apposta, ciascuna su una scena che la mostra.
const PLANTED = [
  ["forme", "colore"],
  ["testi", "carattere"],
  ["tipografia", "corsivo"],
  ["tratteggi", "tratteggio"],
];
const ROADS = ["read", "export"];
const out = join(OUTPUT, "fidelity");

const { base, browser, close } = await openStage();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 200 }, deviceScaleFactor: 2 });
  const shoot = async (scene, variant) => {
    await page.goto(`${base}/bench/fidelity.html?scene=${scene}${variant ? `&variant=${variant}` : ""}`);
    await page.waitForFunction(() => document.documentElement.dataset.fidelity !== undefined, null, { timeout: 30_000 });
    const state = await page.evaluate(() => [document.documentElement.dataset.fidelity, document.documentElement.dataset.error]);
    if (state[0] !== "ready") throw new Error(`${scene}: ${state[1]}`);
    const shots = {};
    for (const road of ["surface", ...ROADS]) shots[road] = PNG.sync.read(await page.locator(`#${road}`).screenshot());
    const result = {};
    for (const road of ROADS) {
      const { width, height } = shots.surface;
      const diff = new PNG({ width, height });
      const count = pixelmatch(shots.surface.data, shots[road].data, diff.data, width, height, { threshold: THRESHOLD });
      result[road] = { share: count / (width * height), diff, shots };
    }
    return result;
  };
  const keep = async (name, road, result) => {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, `${name}-surface.png`), PNG.sync.write(result.shots.surface));
    await writeFile(join(out, `${name}-${road}.png`), PNG.sync.write(result.shots[road]));
    await writeFile(join(out, `${name}-${road}-diff.png`), PNG.sync.write(result.diff));
  };
  const share = (value) => `${(value * 100).toFixed(3)}%`;

  for (const [scene, variant] of PLANTED) {
    const result = await shoot(scene, variant);
    const worst = Math.max(...ROADS.map((road) => result[road].share));
    const seen = worst > LIMIT;
    console.log(`${seen ? "ok  " : "NO  "} ${scene} con ${variant}: ${share(worst)} diversi`);
    if (!seen) failed = true;
  }

  await page.goto(`${base}/bench/fidelity.html`);
  await page.waitForFunction(() => document.documentElement.dataset.scenes !== undefined);
  const scenes = (await page.evaluate(() => document.documentElement.dataset.scenes)).split(" ");
  for (const scene of scenes) {
    const result = await shoot(scene, null);
    for (const road of ROADS) {
      const same = result[road].share <= LIMIT;
      console.log(`${same ? "ok  " : "NO  "} ${scene}, ${road === "read" ? "Lettura" : "export"}: ${share(result[road].share)} diversi`);
      if (!same) {
        failed = true;
        await keep(scene, road, result[road]);
      }
    }
  }
} finally {
  await close();
}
if (failed) {
  console.error(`Il banco di fedeltà è rosso: le immagini sono in ${out}.`);
  process.exit(1);
}
