// **Il giro della pre-alpha**: i compiti che una persona fa nella pre-alpha,
// di fila, sulla shell vera col finto host e il vault del banco, con una foto
// per ognuno.
//
//     npm run bench:giro -- --out=$TMPDIR/giro            # tutto il giro, a 1280×800
//     npm run bench:giro -- --out=$TMPDIR/giro --telefono # al telefono, 390×844
//     npm run bench:giro -- --solo=avvio                  # un gruppo solo
//     npm run bench:giro -- --luce=light                  # nella luce giorno
//     npm run bench:giro -- --port=1454 --strictPort      # su un'altra porta
//
// I gruppi e il loro ordine sono in `giro/elenco.mjs`; ogni gruppo ha il suo
// file accanto. Il palco è quello delle foto (`stage.mjs`): Vite con la config
// del banco, la Chromium pinnata, il locale italiano, l'ora ferma e il moto
// ridotto, perché il giro non aspetti le animazioni. `FUB_BENCH_PORT` sposta la
// porta per tutte le corse, `--port` per una.
//
// # Un compito
//
//     { id, nome, telefono?, fai(pagina, giro), controlla(pagina, host, giro) }
//
// - `fai` fa i gesti di una persona, con la tastiera o col puntatore;
// - `controlla` guarda il risultato nel DOM o nel finto host, e lancia se non
//   è quello giusto: non basta che non ci siano errori;
// - `telefono: true` lo fa girare anche con `--telefono`, dove la pagina è
//   quella del telefono (`mobile.html`) alla misura `PHONE` di `scene.mjs`.
//
// `giro` porta ciò che un compito non trova nella pagina: `base`, `telefono`,
// `luce`, `apri(query)` (carica la pagina del giro con una query del finto
// host) e `foto(nome)` (una foto in più, oltre a quella che il corridore
// scatta dopo `controlla`). `host` legge il finto host: `chiamate(porta)` dà
// gli argomenti delle chiamate a una porta, `testo(id)` il testo di un
// documento com'è adesso nel vault in memoria.
//
// # Che cosa dice
//
// Una riga per compito. Al primo compito che fallisce il giro si ferma (il
// successivo partirebbe da uno stato che non è il suo), lo dice col gruppo, il
// numero e il motivo, fotografa la pagina com'è (`…-errore.png`) ed esce con
// il codice 1. Anche un'eccezione non presa nella pagina durante un compito
// lo fa fallire. Le foto e il referto (`giro.json`) vanno in `--out`; senza,
// in `bench/.output/giro/`.
//
// Il giro non è un banco visivo: le foto non si confrontano coi pixel di una
// baseline. Si guardano.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openStage, openPage, OUTPUT } from "./stage.mjs";
import { GRUPPI } from "./giro/elenco.mjs";

/// Il telefono in piedi: la misura `PHONE` di `scene.mjs`, quella delle scene
/// di `mobile.html`.
export const PHONE = { width: 390, height: 844 };

/// Quanto aspetta, al più, un gesto o un'attesa dentro un compito. Il palco ha
/// i suoi tempi per l'avvio; qui un compito che non arriva deve dirlo presto.
const STEP_TIMEOUT_MS = 15_000;
/// Quanto aspetta, al più, che la pagina del banco sia pronta.
const READY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Gli argomenti.
// ---------------------------------------------------------------------------

/// Il valore di `--nome=x` o `--nome x`, se c'è.
function optionValue(argv, name) {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return argv[i].includes("=") ? argv[i].slice(name.length + 1) : argv[i + 1];
}

export function parseArgs(argv, gruppi = GRUPPI) {
  const known = ["--out", "--solo", "--luce", "--port", "--telefono", "--strictPort"];
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!known.includes(name)) throw new RangeError(`${name}: opzione sconosciuta (${known.join(", ")})`);
  }
  const solo = optionValue(argv, "--solo");
  if (solo !== undefined && !gruppi.some((g) => g.id === solo)) {
    throw new RangeError(`--solo=${solo}: non è un gruppo del giro (${gruppi.map((g) => g.id).join(", ")})`);
  }
  const luce = optionValue(argv, "--luce") ?? "dark";
  if (luce !== "dark" && luce !== "light") throw new RangeError(`--luce=${luce}: vale dark o light`);
  const portText = optionValue(argv, "--port");
  const port = portText === undefined ? undefined : Number(portText);
  if (portText !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
    throw new RangeError(`--port=${portText}: non è una porta`);
  }
  const outText = optionValue(argv, "--out");
  if (outText === "") throw new RangeError("--out vuole una cartella");
  return {
    out: resolve(outText ?? join(OUTPUT, "giro")),
    solo,
    luce,
    telefono: argv.includes("--telefono"),
    port,
    strictPort: argv.includes("--strictPort"),
  };
}

// ---------------------------------------------------------------------------
// Il corridore.
// ---------------------------------------------------------------------------

/// Il finto host visto da fuori: legge, non guida.
function hostOf(page) {
  return {
    async chiamate(porta) {
      return page.evaluate(
        (gate) =>
          window.bench.calls
            .filter((call) => call.gate === gate)
            .map((call) => JSON.parse(JSON.stringify(call.args ?? []))),
        porta,
      );
    },
    async testo(id) {
      return page.evaluate(async (doc) => {
        const { api } = await import("/bench/fake-ipc.ts");
        return (await api.readDocument(doc)).text;
      }, id);
    },
  };
}

/// La pagina ferma per una foto: il puntatore in un angolo (un tooltip non è
/// lo stato del compito), i caratteri caricati, due fotogrammi dipinti.
async function shoot(page, path) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path });
}

function slug(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function run(options) {
  const { out, solo, luce, telefono } = options;
  await mkdir(out, { recursive: true });
  const gruppi = GRUPPI.filter((g) => solo === undefined || g.id === solo);
  const piano = gruppi.map((g) => ({
    gruppo: g,
    compiti: g.compiti.filter((c) => !telefono || c.telefono === true),
  }));
  const referto = { luce, telefono, solo: solo ?? null, compiti: [] };
  const variante = `${luce}${telefono ? "-telefono" : ""}`;

  const stage = await openStage({ port: options.port, strictPort: options.strictPort });
  let failed = null;
  try {
    const page = await openPage(stage.browser, luce);
    if (telefono) await page.setViewportSize(PHONE);
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));

    let numero = 0;
    let photoName = "";
    const giro = {
      base: stage.base,
      telefono,
      luce,
      async apri(query = "") {
        const path = telefono ? "/mobile.html" : "/index.html";
        const search = [`light=${luce}`, query].filter(Boolean).join("&");
        await page.goto(`${stage.base}${path}?${search}`, { waitUntil: "load" });
        await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, {
          timeout: READY_TIMEOUT_MS,
        });
      },
      async foto(nome) {
        const file = `${photoName}-${slug(nome)}-${variante}.png`;
        await shoot(page, join(out, file));
        referto.compiti.at(-1)?.foto.push(file);
        return file;
      },
    };
    const host = hostOf(page);

    for (const { gruppo, compiti } of piano) {
      if (solo !== undefined) {
        if (gruppo.prepara) await gruppo.prepara(page, giro);
        else await apriIlVaultDelBanco(page, giro);
      }
      for (const compito of compiti) {
        numero += 1;
        photoName = `${String(numero).padStart(2, "0")}-${gruppo.id}-${compito.id}`;
        const voce = { gruppo: gruppo.id, id: compito.id, nome: compito.nome, esito: "in corso", foto: [], ms: 0 };
        referto.compiti.push(voce);
        const errorsBefore = pageErrors.length;
        const start = performance.now();
        try {
          await compito.fai(page, giro);
          await compito.controlla(page, host, giro);
          const thrown = pageErrors.slice(errorsBefore);
          if (thrown.length > 0) throw new Error(`la pagina ha lanciato: ${thrown.join(" · ")}`);
          const file = `${photoName}-${variante}.png`;
          await shoot(page, join(out, file));
          voce.foto.push(file);
          voce.esito = "fatto";
          voce.ms = Math.round(performance.now() - start);
          console.log(`✓ ${gruppo.id}/${compito.id} · ${compito.nome} (${voce.ms} ms)`);
        } catch (error) {
          voce.esito = "fallito";
          voce.ms = Math.round(performance.now() - start);
          voce.errore = String(error?.message ?? error).split("\n")[0];
          const file = `${photoName}-${variante}-errore.png`;
          try {
            await page.screenshot({ path: join(out, file) });
            voce.foto.push(file);
          } catch {
            // Una pagina chiusa non si fotografa: il motivo resta nel referto.
          }
          console.log(`✗ ${gruppo.id}/${compito.id} · ${compito.nome}: ${voce.errore}`);
          failed = voce;
          break;
        }
      }
      if (failed) break;
    }
  } finally {
    await stage.close();
  }

  const total = piano.reduce((n, p) => n + p.compiti.length, 0);
  const done = referto.compiti.filter((c) => c.esito === "fatto").length;
  referto.esito = failed ? "fallito" : "fatto";
  await writeFile(join(out, "giro.json"), `${JSON.stringify(referto, null, 2)}\n`);
  if (failed) {
    console.log(
      `Il giro si ferma a ${failed.gruppo}/${failed.id}: ${done} di ${total} compiti fatti, ` +
        `${total - done - 1} non provati. Foto e referto in ${out}`,
    );
    return 1;
  }
  console.log(`Il giro è verde: ${done} compiti (${variante}). Foto e referto in ${out}`);
  return 0;
}

/// Lo stato in cui il gruppo «avvio» lascia la pagina: il vault del banco
/// aperto, la cornice pronta, lo strato d'avvio sparito. Da qui parte un
/// gruppo che gira da solo e non dice da dove partire.
export async function apriIlVaultDelBanco(page, giro) {
  await giro.apri("");
  await page.waitForFunction(() => !document.querySelector(".avvio"), null, { timeout: READY_TIMEOUT_MS });
  await page.waitForSelector('#file-list li[role="treeitem"]', { state: "attached" });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(2);
  }
  process.exitCode = await run(options);
}
