// **L'estrazione dei valori attesi dal prototipo.** A mano, fuori dalla CI.
//
//     node bench/conformita/estrai.mjs editor
//     node bench/conformita/estrai.mjs editor --rev=origin/piano/editor-completo
//
// Il prototipo non sta in `main`: sta sul ramo del suo piano (`PROTOTIPO.ramo`
// nella mappa). Questo script lo prende da git alla revisione `--rev` (per
// difetto `origin/<ramo>`, quindi prima `git fetch`), lo apre in Playwright,
// lo porta in ogni stato della mappa coi suoi pulsanti (luce, larghezza, moto
// ridotto) e con il `prepara` della vista, legge gli stili calcolati di ogni
// pezzo e scrive `bench/conformita/<prototipo>.json`. Quel file è generato:
// la sua intestazione dice il comando, il ramo, il commit e il file sorgente,
// e non si modifica a mano.
//
// Un selettore che nel prototipo non trova un elemento visibile ferma
// l'estrazione: la mappa è sbagliata, e un valore atteso mancante sarebbe un
// confronto che non si fa.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { CONTESTO_DI_BASE, espandi, espressioniFub, sentinelle, traduzioneDi, validaTraduzioni } from "./confronto.mjs";
import { gesto, leggi, riposo } from "./leggi.mjs";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/// La finestra del browser del prototipo: abbastanza larga perché la misura
/// «piena» del riquadro `#win` non scenda sotto le soglie dei suoi
/// `@container` (1180 px, l'ispettore).
const FINESTRA_PROTOTIPO = { width: 1680, height: 1000 };

const [nome, ...opzioni] = process.argv.slice(2);
if (!nome || nome.startsWith("--")) {
  console.error("uso: node bench/conformita/estrai.mjs <prototipo> [--rev=<revisione git>]");
  process.exit(2);
}
const mappa = await import(pathToFileURL(here(`./mappa-${nome}.mjs`)).href);
const { PROTOTIPO, STATI, VISTE, PEZZI, TRADUZIONI } = mappa;
const erroriTraduzioni = validaTraduzioni(TRADUZIONI, PEZZI);
if (erroriTraduzioni.length) {
  for (const e of erroriTraduzioni) console.error(`TRADUZIONI: ${e}`);
  process.exit(2);
}
const rev = opzioni.find((o) => o.startsWith("--rev="))?.slice("--rev=".length) ?? `origin/${PROTOTIPO.ramo}`;
/// Dove stanno i selettori del prototipo: dentro `#win` di default, o dentro
/// lo schermo di `PROTOTIPO.radice` (un `<iframe>` con un suo documento).
const radiceSchermo = PROTOTIPO.radice ?? "#win";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", cwd: here(".") }).trim();
/// La radice del repository: `git archive` legge i percorsi da lì.
const radice = git("rev-parse", "--show-toplevel");
const commit = git("rev-parse", `${rev}^{commit}`);
const cartella = PROTOTIPO.file.split("/")[0];
const temp = await mkdtemp(join(tmpdir(), "fub-conformita-"));

/// Aspetta che nel prototipo non scorra più niente: animazioni d'entrata e
/// transizioni dei passaggi del mouse cambiano proprio gli stili che si
/// leggono.
async function fermo(page) {
  await page.evaluate(async () => {
    const vive = document.getAnimations().filter((a) => a.playState === "running");
    await Promise.race([
      Promise.all(vive.map((a) => a.finished.catch(() => null))),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

try {
  // `git archive` della sola cartella del prototipo, scompattata in una
  // cartella temporanea: il file si apre da lì con le sue risorse vicine.
  const tar = execFileSync("git", ["archive", commit, cartella], { cwd: radice, maxBuffer: 1 << 28 });
  execFileSync("tar", ["-x", "-C", temp], { input: tar });
  const sorgente = join(temp, PROTOTIPO.file);
  const sha256 = createHash("sha256").update(await readFile(sorgente)).digest("hex");

  const browser = await chromium.launch({
    args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"],
  });
  const valori = {};
  try {
    for (const [idVista, vista] of Object.entries(VISTE)) {
      for (const idStato of vista.stati) {
        const stato = STATI[idStato];
        const pezzi = PEZZI.filter((p) => p.vista === idVista && (p.stati ?? vista.stati).includes(idStato));
        if (pezzi.length === 0) continue;
        const context = await browser.newContext({
          viewport: FINESTRA_PROTOTIPO,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          locale: "it-IT",
        });
        const page = await context.newPage();
        await page.goto(pathToFileURL(sorgente).href);
        // I comandi di luce, larghezza e moto sono quelli dell'editor, salvo
        // che la mappa dica i suoi (`PROTOTIPO.comandi`, per un prototipo con
        // altri controlli).
        if (PROTOTIPO.comandi) {
          await PROTOTIPO.comandi(page, stato.prototipo);
        } else {
          await page.click(`[data-set="light"][data-v="${stato.prototipo.luce}"]`);
          await page.click(`[data-set="width"][data-v="${stato.prototipo.larghezza}"]`);
          await page.click('[data-set="motion"][data-v="ridotto"]');
        }
        await vista.prototipo.prepara(page);
        await fermo(page);
        const leggiPezzo = async (pezzo) => {
          const proprieta = espandi(pezzo.proprieta);
          if (pezzo.gesto) await gesto(page, radiceSchermo, pezzo.gesto.tipo, pezzo.gesto.prototipo);
          await fermo(page);
          const [letti] = await leggi(page, radiceSchermo, [{ selettore: pezzo.prototipo, proprieta }]);
          if (pezzo.gesto) await riposo(page);
          if (!letti) {
            throw new Error(
              `${pezzo.id} [${idStato}]: «${pezzo.prototipo}» non trova un elemento visibile nel prototipo`,
            );
          }
          return letti;
        };
        // Prima la tavolozza vera, poi le sentinelle al posto dei token della
        // traduzione (`confronto.mjs` spiega perché): la seconda lettura dice
        // di quali token è fatto ogni colore. Le sentinelle sono le stesse per
        // ogni contesto; ogni pezzo le legge con la traduzione del suo.
        const crudi = [];
        for (const pezzo of pezzi) crudi.push(await leggiPezzo(pezzo));
        await page.evaluate(({ radice: r, sent }) => {
          const contenitore = document.querySelector(r);
          // Lo schermo in un iframe (`PROTOTIPO.radice` su un `<iframe>`): le
          // sentinelle vanno sulla radice del suo documento.
          const win = contenitore instanceof HTMLIFrameElement ? contenitore.contentDocument.documentElement : contenitore;
          for (const [t, [r2, g, b]] of Object.entries(sent)) win.style.setProperty(t, `rgb(${r2}, ${g}, ${b})`);
        }, { radice: radiceSchermo, sent: sentinelle(TRADUZIONI[CONTESTO_DI_BASE]) });
        await fermo(page);
        for (const [i, pezzo] of pezzi.entries()) {
          const finti = await leggiPezzo(pezzo);
          const fub = {};
          for (const [p, v] of Object.entries(crudi[i])) {
            const espr = espressioniFub(v, finti[p], traduzioneDi(pezzo, TRADUZIONI));
            if (espr) fub[p] = espr;
          }
          valori[pezzo.id] ??= {};
          valori[pezzo.id][idStato] = {
            prototipo: pezzo.prototipo,
            contesto: pezzo.contesto ?? CONTESTO_DI_BASE,
            proprieta: crudi[i],
            fub,
          };
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const uscita = {
    _intestazione:
      `File generato: non modificarlo a mano. Lo rigenera, da apps/client, ` +
      `\`node bench/conformita/estrai.mjs ${nome}\` (dopo \`git fetch\`), che legge ` +
      `${PROTOTIPO.file} dal ramo ${PROTOTIPO.ramo} al commit ${commit}.`,
    prototipo: nome,
    ramo: PROTOTIPO.ramo,
    commit,
    file: PROTOTIPO.file,
    sha256,
    traduzioni: TRADUZIONI,
    valori,
  };
  const destinazione = here(`./${nome}.json`);
  await writeFile(destinazione, `${JSON.stringify(uscita, null, 2)}\n`);
  const n = Object.values(valori).reduce((s, v) => s + Object.keys(v).length, 0);
  console.log(`${n} letture di ${Object.keys(valori).length} pezzi dal prototipo ${nome} @ ${commit.slice(0, 9)} → ${destinazione}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
