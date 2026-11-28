// **Il banco delle animazioni**: lo stesso gesto nel prototipo e nell'app, a
// tempo fermo, e il moto campionato dai due lati.
//
//     npm run bench:animazioni                          # tutte le voci, le due luci, moto pieno e ridotto
//     npm run bench:animazioni -- --light=dark          # una luce
//     npm run bench:animazioni -- --only=menu           # le voci il cui id comincia così
//     node bench/conformita/animazioni.mjs --estrai editor   # rigenera i valori attesi dal prototipo
//
// Le voci stanno nella mappa del prototipo (`ANIMAZIONI` di
// `mappa-<prototipo>.mjs`, scritte in `editor/animazioni.mjs`). Per ogni
// voce, ogni stato (di base le due luci a 1280 px) e ogni moto (pieno e
// ridotto):
//
// 1. si apre il prototipo (con `--estrai`, da git come `estrai.mjs`) o la
//    scena dell'app (come `verifica.mjs`), e si fa il `prepara` della voce a
//    tempo vero;
// 2. si leggono a riposo i colori degli elementi, coi token tradotti;
// 3. si ferma il tempo (`campiona.mjs` dice come e perché), si fa il `gesto`;
// 4. si leggono le corse nate dal gesto (`document.getAnimations()`: tipo,
//    proprietà, ritardo, durata, curva) e le pose ai punti 0, 25, 50, 75 e
//    100 % della corsa del prototipo;
// 5. si ridà il tempo e si rileggono i colori a riposo.
//
// `--estrai` scrive i valori del prototipo in `<prototipo>-animazioni.json`
// (generato, con l'intestazione che dice il comando); la verifica li confronta
// con l'app (`confronto-animazioni.mjs`) ed esce con 1 se una differenza non
// ha un'eccezione (`eccezioni-<prototipo>-animazioni.json`, la forma di
// `eccezioni-<prototipo>.json` con gli stati scritti `chiaro-1280/pieno`) né
// una voce in `DA_COPRIRE_ANIMAZIONI`, se un elemento non si trova, se i valori
// attesi non sono quelli della mappa. Il referto intero va in
// `bench/.output/conformita/<prototipo>-animazioni.json`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { SCENE, sceneUrl } from "../scene.mjs";
import { OUTPUT, openPage, openStage, prepareScene } from "../stage.mjs";
import {
  FOTOGRAMMA,
  campionaNellaPagina,
  corseNellaPagina,
  fermoNellaPagina,
  liberaNellaPagina,
  riposoNellaPagina,
  tempiDelPrototipo,
} from "./campiona.mjs";
import {
  CONTESTO_DI_BASE,
  applicaEccezioni,
  espressioniFub,
  scriviDifferenza,
  scriviMancante,
  sentinelle,
  traduzioneDi,
  validaEccezioni,
} from "./confronto.mjs";
import {
  PROGRESSO,
  confrontaCampioni,
  confrontaCorse,
  confrontaPartenza,
  confrontaRidotto,
  confrontaRiposo,
  copertureAnimazioni,
  pezziAnimazioni,
  proprietaARiposo,
  scriviSelettore,
  statoMoto,
  validaVoci,
} from "./confronto-animazioni.mjs";
import { leggi, risolvi } from "./leggi.mjs";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const REFERTO = join(OUTPUT, "conformita");
const FINESTRA_PROTOTIPO = { width: 1680, height: 1000 };
/// Gli stati di base di una voce: le due luci, a finestra piena.
const LUCI = ["chiaro-1280", "scuro-1280"];
const MOTI = ["pieno", "ridotto"];

const opzione = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(`--${nome}=`.length);
const estrai = process.argv.includes("--estrai");
const luce = opzione("light");
const solo = opzione("only");
const soloPrototipo = opzione("prototipo") ?? process.argv.slice(2).find((a) => !a.startsWith("--"));

const nomi = (await readdir(here(".")))
  .map((f) => /^mappa-(.+)\.mjs$/.exec(f)?.[1])
  .filter(Boolean)
  .filter((p) => !soloPrototipo || p === soloPrototipo)
  .sort();
const mappe = [];
for (const nome of nomi) {
  const mappa = await import(pathToFileURL(here(`./mappa-${nome}.mjs`)).href);
  if (mappa.ANIMAZIONI?.length) mappe.push({ nome, mappa });
}
if (mappe.length === 0) {
  console.error("nessuna mappa con ANIMAZIONI: un controllo senza voci sarebbe un verde vuoto");
  process.exit(1);
}

/// Gli elementi di una voce visti da un lato: selettore, proprietà, contesto.
const elementiDi = (voce, lato) =>
  voce.elementi.map((e) => ({ id: e.id, selettore: e[lato], proprieta: e.proprieta, contesto: e.contesto ?? voce.contesto }));

/// Lo stesso giro dai due lati, dal riposo alla fine del moto. `tempiDa`
/// sceglie gli istanti da leggere, avute le corse.
async function misura(page, lato, voce, { radice, motore, tempiDa }) {
  const elementi = elementiDi(voce, lato);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await page.evaluate(riposoNellaPagina, { motore });
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  try {
    await voce[lato].gesto(page);
    if (voce[lato].attende) await page.waitForSelector(voce[lato].attende);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { corse, fine } = await page.evaluate(corseNellaPagina, { radice, elementi });
    const tempi = tempiDa({ corse, fine });
    const campioni = await page.evaluate(campionaNellaPagina, { radice, elementi, tempi: tempi.tempi });
    return { corse, fine, ...tempi, campioni };
  } finally {
    await page.evaluate(liberaNellaPagina).catch(() => undefined);
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await cdp.detach().catch(() => undefined);
    await page.evaluate(fermoNellaPagina);
  }
}

/// I colori a riposo nel prototipo, e di quali token sono fatti: la lettura
/// vera, poi le sentinelle al posto dei token (come `estrai.mjs`).
async function riposoPrototipo(page, radice, voce, traduzioni) {
  const elementi = elementiDi(voce, "prototipo").filter((e) => proprietaARiposo(e).length);
  const richieste = elementi.map((e) => ({ selettore: e.selettore, proprieta: proprietaARiposo(e) }));
  const crudi = await leggi(page, radice, richieste);
  await page.evaluate(
    ({ r, sent }) => {
      const win = document.querySelector(r);
      for (const [t, [r2, g, b]] of Object.entries(sent)) win.style.setProperty(t, `rgb(${r2}, ${g}, ${b})`);
    },
    { r: radice, sent: sentinelle(traduzioni[CONTESTO_DI_BASE]) },
  );
  await page.evaluate(fermoNellaPagina);
  const finti = await leggi(page, radice, richieste);
  await page.evaluate(
    ({ r, nomi: n }) => {
      const win = document.querySelector(r);
      for (const t of n) win.style.removeProperty(t);
    },
    { r: radice, nomi: Object.keys(traduzioni[CONTESTO_DI_BASE]) },
  );
  await page.evaluate(fermoNellaPagina);
  const out = {};
  elementi.forEach((e, i) => {
    if (!crudi[i]) {
      out[e.id] = null;
      return;
    }
    const fub = {};
    for (const [p, v] of Object.entries(crudi[i])) {
      const espr = espressioniFub(v, finti[i]?.[p], traduzioneDi({ contesto: e.contesto }, traduzioni));
      if (espr) fub[p] = espr;
    }
    out[e.id] = { proprieta: crudi[i], fub };
  });
  return out;
}

/// I colori a riposo nell'app, e l'atteso del prototipo coi token di Fub
/// risolti sotto l'elemento (come `verifica.mjs`).
async function riposoApp(page, voce, attesi) {
  const elementi = elementiDi(voce, "app").filter((e) => proprietaARiposo(e).length);
  const trovati = await leggi(page, null, elementi.map((e) => ({ selettore: e.selettore, proprieta: proprietaARiposo(e) })));
  const out = {};
  for (const [i, e] of elementi.entries()) {
    const estratto = attesi?.[e.id] ?? null;
    const atteso = estratto && { ...estratto.proprieta };
    const voci = Object.entries(estratto?.fub ?? {}).map(([proprieta, espressioni]) => ({ proprieta, espressioni }));
    if (trovati[i] && voci.length) {
      const risolti = await risolvi(page, e.selettore, voci);
      voci.forEach((v, j) => {
        atteso[v.proprieta] = v.espressioni.map((come, k) => ({ come, valore: risolti[j][k] }));
      });
    }
    out[e.id] = { atteso, trovato: trovati[i] };
  }
  return out;
}

const statiDi = (voce) => (voce.stati ?? LUCI).filter((s) => !luce || s.startsWith(luce === "dark" ? "scuro" : "chiaro"));

// ── l'estrazione dal prototipo ─────────────────────────────────────────────

async function estraiPrototipo({ nome, mappa }) {
  const { PROTOTIPO, STATI, TRADUZIONI, ANIMAZIONI } = mappa;
  const rev = opzione("rev") ?? `origin/${PROTOTIPO.ramo}`;
  const radice = PROTOTIPO.radice ?? "#win";
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", cwd: here(".") }).trim();
  const radiceRepo = git("rev-parse", "--show-toplevel");
  const commit = git("rev-parse", `${rev}^{commit}`);
  const temp = await mkdtemp(join(tmpdir(), "fub-animazioni-"));
  try {
    const tar = execFileSync("git", ["archive", commit, PROTOTIPO.file.split("/")[0]], { cwd: radiceRepo, maxBuffer: 1 << 28 });
    execFileSync("tar", ["-x", "-C", temp], { input: tar });
    const sorgente = join(temp, PROTOTIPO.file);
    const sha256 = createHash("sha256").update(await readFile(sorgente)).digest("hex");
    const browser = await chromium.launch({
      args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"],
    });
    const voci = {};
    try {
      for (const voce of ANIMAZIONI) {
        for (const idStato of voce.stati ?? LUCI) {
          const stato = STATI[idStato];
          for (const moto of MOTI) {
            const context = await browser.newContext({
              viewport: FINESTRA_PROTOTIPO,
              deviceScaleFactor: 1,
              reducedMotion: moto === "ridotto" ? "reduce" : "no-preference",
              locale: "it-IT",
            });
            try {
              const page = await context.newPage();
              await page.goto(pathToFileURL(sorgente).href);
              await page.click(`[data-set="light"][data-v="${stato.prototipo.luce}"]`);
              await page.click(`[data-set="width"][data-v="${stato.prototipo.larghezza}"]`);
              await page.click(`[data-set="motion"][data-v="${moto}"]`);
              await page.evaluate(fermoNellaPagina);
              if (voce.prototipo.prepara) await voce.prototipo.prepara(page);
              await page.evaluate(fermoNellaPagina);
              const prima = await riposoPrototipo(page, radice, voce, TRADUZIONI);
              const misurato = await misura(page, "prototipo", voce, {
                radice,
                motore: false,
                tempiDa: ({ corse, fine }) => tempiDelPrototipo(corse, fine),
              });
              for (const [id, c] of Object.entries(misurato.campioni.at(-1).letture)) {
                if (!c) throw new Error(`${voce.id}.${id} [${idStato}/${moto}]: nessun elemento visibile nel prototipo alla fine del moto`);
              }
              const dopo = await riposoPrototipo(page, radice, voce, TRADUZIONI);
              voci[voce.id] ??= {};
              voci[voce.id][idStato] ??= {};
              voci[voce.id][idStato][moto] = {
                elementi: Object.fromEntries(
                  elementiDi(voce, "prototipo").map((e) => [e.id, { prototipo: e.selettore, proprieta: e.proprieta, contesto: e.contesto ?? CONTESTO_DI_BASE }]),
                ),
                ...misurato,
                prima,
                dopo,
              };
            } finally {
              await context.close();
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
    const uscita = {
      _intestazione:
        `File generato: non modificarlo a mano. Lo rigenera, da apps/client, ` +
        `\`node bench/conformita/animazioni.mjs --estrai ${nome}\` (dopo \`git fetch\`), che legge ` +
        `${PROTOTIPO.file} dal ramo ${PROTOTIPO.ramo} al commit ${commit}.`,
      prototipo: nome,
      ramo: PROTOTIPO.ramo,
      commit,
      file: PROTOTIPO.file,
      sha256,
      fotogramma: FOTOGRAMMA,
      traduzioni: TRADUZIONI,
      voci,
    };
    const destinazione = here(`./${nome}-animazioni.json`);
    await writeFile(destinazione, `${JSON.stringify(uscita, null, 1)}\n`);
    const n = Object.values(voci).reduce((s, v) => s + Object.values(v).reduce((t, m) => t + Object.keys(m).length, 0), 0);
    console.log(`${n} misure di ${Object.keys(voci).length} voci dal prototipo ${nome} @ ${commit.slice(0, 9)} → ${destinazione}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

// ── la verifica nell'app ─────────────────────────────────────────────────

/// I valori attesi sono quelli della mappa: stesse voci, stati, moti,
/// selettori del prototipo e proprietà.
function controllaAttesi(nome, attesi, voci) {
  const errori = [];
  const rigenera = `rigenera con \`node bench/conformita/animazioni.mjs --estrai ${nome}\``;
  for (const voce of voci) {
    for (const stato of voce.stati ?? LUCI) {
      for (const moto of MOTI) {
        const v = attesi.voci[voce.id]?.[stato]?.[moto];
        if (!v) {
          errori.push(`${voce.id} [${statoMoto(stato, moto)}]: nessun valore atteso: ${rigenera}`);
          continue;
        }
        for (const e of voce.elementi) {
          const x = v.elementi[e.id];
          const contesto = e.contesto ?? voce.contesto ?? CONTESTO_DI_BASE;
          if (!x || JSON.stringify(x.prototipo) !== JSON.stringify(e.prototipo) || x.contesto !== contesto || x.proprieta.join() !== e.proprieta.join()) {
            errori.push(`${voce.id}.${e.id} [${statoMoto(stato, moto)}]: l'estrazione non è quella della mappa: ${rigenera}`);
          }
        }
        for (const id of Object.keys(v.elementi)) {
          if (!voce.elementi.some((e) => e.id === id)) errori.push(`${voce.id}.${id}: estratto ma non più nella mappa: ${rigenera}`);
        }
      }
    }
  }
  for (const id of Object.keys(attesi.voci)) {
    if (!voci.some((v) => v.id === id)) errori.push(`${id}: ha valori estratti ma non è più nella mappa: ${rigenera}`);
  }
  return errori;
}

/// Confronta una misura dell'app con quella del prototipo, elemento per
/// elemento.
function confrontaMisura(voce, idStato, moto, atteso, trovato, riposo) {
  const stato = statoMoto(idStato, moto);
  const differenze = [];
  const mancanti = [];
  const note = [];
  const righe = [];
  for (const elemento of voce.elementi) {
    const idPezzo = `${voce.id}.${elemento.id}`;
    const base = { pezzo: idPezzo, stato, selettorePrototipo: scriviSelettore(elemento.prototipo), selettoreApp: scriviSelettore(elemento.app) };
    const aggiungi = (lista) => differenze.push(...lista.map((d) => ({ ...base, ...d })));
    if (!trovato.campioni.at(-1).letture[elemento.id]) {
      mancanti.push({ ...base, lato: "app" });
      continue;
    }
    for (const quando of ["prima", "dopo"]) {
      const r = riposo[quando][elemento.id];
      const a = atteso[quando][elemento.id];
      if (!r || (!a && !r.trovato)) continue;
      // Un elemento che nasce col gesto non ha un «prima» da nessun lato.
      if (quando === "prima" && (!a || !r.trovato)) {
        if (a || r.trovato) aggiungi([{ proprieta: "prima", atteso: a ? "c'è" : "non c'è", trovato: r.trovato ? "c'è" : "non c'è", motivo: "prima del gesto l'elemento c'è da un lato solo" }]);
        continue;
      }
      const esito = confrontaRiposo({ elemento, idPezzo, stato, quando: quando === "prima" ? "da" : "a", atteso: r.atteso, trovato: r.trovato });
      differenze.push(...esito.differenze);
      mancanti.push(...esito.mancanti);
    }
    if (moto === "ridotto") {
      aggiungi(confrontaRidotto({ elemento, proto: atteso.corse[elemento.id], app: trovato.corse[elemento.id] }));
      continue;
    }
    const campioni = confrontaCampioni({ elemento, finestra: atteso.finestre[elemento.id], proto: atteso.campioni, app: trovato.campioni, fotogramma: FOTOGRAMMA });
    aggiungi(campioni.differenze);
    righe.push(...campioni.righe.map((r) => ({ pezzo: idPezzo, stato, ...r })));
    aggiungi(confrontaPartenza({ elemento, proto: atteso.campioni, app: trovato.campioni }));
    const campioniRossi = new Set(campioni.differenze.map((d) => d.proprieta.split(".")[1]));
    const corse = confrontaCorse({ elemento, proto: atteso.corse[elemento.id], app: trovato.corse[elemento.id], campioniRossi });
    aggiungi(corse.differenze);
    note.push(...corse.note.map((n) => `${idPezzo} [${stato}] ${n}`));
  }
  return { differenze, mancanti, note, righe };
}

async function verificaApp(stage, { nome, mappa }) {
  const { STATI, TRADUZIONI, ANIMAZIONI, DA_COPRIRE_ANIMAZIONI = [] } = mappa;
  const attesi = JSON.parse(await readFile(here(`./${nome}-animazioni.json`), "utf8"));
  const eccezioni = JSON.parse(await readFile(here(`./eccezioni-${nome}-animazioni.json`), "utf8"));
  const pezzi = pezziAnimazioni(ANIMAZIONI);
  const copertura = copertureAnimazioni(DA_COPRIRE_ANIMAZIONI, ANIMAZIONI);
  const errori = [
    ...validaVoci(ANIMAZIONI, STATI),
    ...controllaAttesi(nome, attesi, ANIMAZIONI),
    ...validaEccezioni(eccezioni, pezzi).map((e) => `eccezioni-${nome}-animazioni.json: ${e}`),
    ...copertura.errori.map((e) => `DA_COPRIRE_ANIMAZIONI: ${e}`),
  ];
  if (JSON.stringify(attesi.traduzioni) !== JSON.stringify(TRADUZIONI)) {
    errori.push(`le TRADUZIONI dei token non sono quelle dell'estrazione: rigenera con \`node bench/conformita/animazioni.mjs --estrai ${nome}\``);
  }
  const differenze = [];
  const mancanti = [];
  const note = [];
  const righe = [];
  const guardati = new Set();
  for (const voce of ANIMAZIONI.filter((v) => !solo || v.id.startsWith(solo))) {
    const scena = SCENE.find((s) => s.id === voce.app.scena);
    if (!scena) {
      errori.push(`voce «${voce.id}»: la scena «${voce.app.scena}» non è in bench/scene.mjs`);
      continue;
    }
    for (const idStato of statiDi(voce)) {
      const stato = STATI[idStato];
      for (const moto of MOTI) {
        const atteso = attesi.voci[voce.id]?.[idStato]?.[moto];
        if (!atteso) continue;
        const page = await openPage(stage.browser, stato.luce, { reducedMotion: moto === "ridotto" ? "reduce" : "no-preference" });
        try {
          await page.setViewportSize(stato.finestra);
          await prepareScene(page, scena, stato.luce, stage.base, sceneUrl);
          if (voce.app.prepara) await voce.app.prepara(page);
          await page.evaluate(fermoNellaPagina);
          const prima = await riposoApp(page, voce, atteso.prima);
          const trovato = await misura(page, "app", voce, {
            radice: null,
            motore: true,
            tempiDa: ({ fine }) => ({ tempi: [...new Set([...atteso.tempi, fine])].sort((a, b) => a - b) }),
          });
          const dopo = await riposoApp(page, voce, atteso.dopo);
          const esito = confrontaMisura(voce, idStato, moto, atteso, trovato, { prima, dopo });
          differenze.push(...esito.differenze);
          mancanti.push(...esito.mancanti);
          note.push(...esito.note);
          righe.push(...esito.righe);
          for (const e of voce.elementi) guardati.add(`${voce.id}.${e.id} ${statoMoto(idStato, moto)}`);
        } finally {
          await page.context().close();
        }
      }
    }
  }
  const { rosse, giustificate, inutili } = applicaEccezioni(differenze, [...eccezioni, ...copertura.voci]);
  const inutiliGuardate = inutili.filter((e) =>
    [...guardati].some((k) => {
      const [id, stato] = k.split(" ");
      return id === e.pezzo && (!e.stati || e.stati.includes(stato));
    }),
  );
  const daCoprire = giustificate.filter((d) => d.eccezione.daCoprire);
  const volute = giustificate.filter((d) => !d.eccezione.daCoprire);
  console.log(
    `animazioni di ${nome} (${attesi.ramo} @ ${attesi.commit.slice(0, 9)}): ${guardati.size} misure; ` +
      `${volute.length} differenze con eccezione, ${daCoprire.length} da coprire`,
  );
  console.log(`  soglia: un fotogramma (${Math.round(FOTOGRAMMA * 10) / 10} ms) e ±${PROGRESSO} della corsa`);
  for (const e of errori) console.log(`ROSSO ${e}`);
  for (const m of mancanti) console.log(`ROSSO ${scriviMancante(m)}`);
  for (const d of rosse) console.log(`ROSSO ${scriviDifferenza(d)}`);
  for (const e of inutiliGuardate) {
    if (e.daCoprire) console.log(`ROSSO ${e.pezzo} ${e.proprieta} ora coincide col prototipo: toglilo da DA_COPRIRE_ANIMAZIONI`);
    else console.log(`ROSSO eccezione non più usata: ${e.pezzo} ${e.proprieta}${e.stati ? ` [${e.stati.join(", ")}]` : ""} (${e.riferimento}): toglila`);
  }
  if (guardati.size === 0 && !solo) {
    console.log(`ROSSO ${nome}: nessuna animazione confrontata`);
    errori.push("nessuna animazione confrontata");
  }
  await mkdir(REFERTO, { recursive: true });
  await writeFile(
    join(REFERTO, `${nome}-animazioni.json`),
    `${JSON.stringify({ prototipo: nome, commit: attesi.commit, errori, mancanti, rosse, eccezioni: volute, daCoprire, inutili: inutiliGuardate, note, campioni: righe }, null, 2)}\n`,
  );
  return errori.length > 0 || mancanti.length > 0 || rosse.length > 0 || inutiliGuardate.length > 0;
}

if (estrai) {
  for (const m of mappe) await estraiPrototipo(m);
} else {
  const stage = await openStage();
  let rosso = false;
  try {
    for (const m of mappe) if (await verificaApp(stage, m)) rosso = true;
  } finally {
    await stage.close();
  }
  if (rosso) {
    console.log("animazioni come il prototipo: ROSSO");
    process.exit(1);
  }
  console.log("animazioni come il prototipo: verde");
}
