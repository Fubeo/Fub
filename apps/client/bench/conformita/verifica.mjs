// **La verifica della conformità al prototipo**: gli stili calcolati
// dell'app, pezzo per pezzo, contro quelli estratti dal prototipo.
//
//     npm run bench:conformita                          # tutte le mappe, tutte e due le luci
//     npm run bench:conformita -- --light=dark          # una luce
//     npm run bench:conformita -- --only=lanciatore     # i pezzi il cui id comincia così
//     npm run bench:conformita -- --prototipo=editor    # una mappa
//     npm run bench:conformita -- --attese              # anche i pezzi che attendono
//
// Un pezzo con `attende` (la PR o il ramo che lo porta dal prototipo) ha i
// suoi valori attesi già estratti, ma nell'app non si legge: il suo
// selettore, e a volte la sua scena, nascono con quel lavoro. La riga di
// riepilogo li conta. Con `--attese` si leggono lo stesso: serve a misurare
// quei lavori prima di unirli, su un ramo locale che li contiene. Chi unisce
// il lavoro toglie `attende` dai suoi pezzi.
//
// Per ogni mappa `mappa-<prototipo>.mjs` legge i valori attesi da
// `<prototipo>.json` (generato da `estrai.mjs`) e le eccezioni da
// `eccezioni-<prototipo>.json`; apre ogni vista nella scena del banco che la
// mappa nomina, alla finestra dello stato, legge gli stessi stili sugli
// elementi corrispondenti e li confronta con le tolleranze di
// `confronto.mjs`.
//
// È rosso, ed esce con 1, se:
//
// - una proprietà differisce e nessuna eccezione la copre;
// - un selettore dell'app non trova un elemento visibile;
// - i valori attesi non sono quelli della mappa (un pezzo, uno stato, un
//   selettore o una proprietà nuova senza rigenerare `<prototipo>.json`);
// - un'eccezione è scritta male o non copre più niente;
// - una proprietà di `DA_COPRIRE` ora coincide col prototipo (va tolta da lì).
//
// I colori fatti di token del prototipo si confrontano con la loro
// espressione coi token di Fub, risolta nell'app (`confronto.mjs`, «I token»).
//
// Il referto intero va in `bench/.output/conformita/<prototipo>.json`.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCENE, sceneUrl } from "../scene.mjs";
import { OUTPUT, openPage, openStage, prepareScene } from "../stage.mjs";
import {
  CONTESTO_DI_BASE,
  TOLLERANZA,
  applicaEccezioni,
  confrontaPezzo,
  coperture,
  espandi,
  scriviDifferenza,
  scriviMancante,
  validaEccezioni,
  validaTraduzioni,
} from "./confronto.mjs";
import { gesto, leggi, riposo, risolvi } from "./leggi.mjs";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const REFERTO = join(OUTPUT, "conformita");

const opzione = (nome) =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(`--${nome}=`.length);
const luce = opzione("light");
const solo = opzione("only");
const soloPrototipo = opzione("prototipo");
const ancheAttese = process.argv.includes("--attese");
if (luce && luce !== "dark" && luce !== "light") {
  console.error(`--light vuole dark o light, non «${luce}»`);
  process.exit(2);
}

const prototipi = (await readdir(here(".")))
  .map((f) => /^mappa-(.+)\.mjs$/.exec(f)?.[1])
  .filter(Boolean)
  .filter((p) => !soloPrototipo || p === soloPrototipo)
  .sort();
if (prototipi.length === 0) {
  console.error("nessuna mappa da verificare: un controllo senza mappe sarebbe un verde vuoto");
  process.exit(1);
}

/// Controlla che i valori attesi siano quelli della mappa: stessi pezzi, stessi
/// stati, stessi selettori del prototipo, stesse proprietà.
function controllaAttesi(nome, attesi, pezzi, viste) {
  const errori = [];
  const rigenera = `rigenera con \`node bench/conformita/estrai.mjs ${nome}\``;
  for (const pezzo of pezzi) {
    const vista = viste[pezzo.vista];
    if (!vista) {
      errori.push(`${pezzo.id}: la vista «${pezzo.vista}» non è nella mappa`);
      continue;
    }
    for (const stato of pezzo.stati ?? vista.stati) {
      const v = attesi.valori[pezzo.id]?.[stato];
      if (!v) {
        errori.push(`${pezzo.id} [${stato}]: nessun valore atteso: ${rigenera}`);
        continue;
      }
      if (v.prototipo !== pezzo.prototipo) {
        errori.push(`${pezzo.id} [${stato}]: estratto da «${v.prototipo}», la mappa dice «${pezzo.prototipo}»: ${rigenera}`);
      }
      if (v.contesto !== (pezzo.contesto ?? CONTESTO_DI_BASE)) {
        errori.push(`${pezzo.id} [${stato}]: estratto nel contesto «${v.contesto}», la mappa dice «${pezzo.contesto ?? CONTESTO_DI_BASE}»: ${rigenera}`);
      }
      const voluti = espandi(pezzo.proprieta);
      const letti = Object.keys(v.proprieta);
      if (voluti.length !== letti.length || voluti.some((p) => !letti.includes(p))) {
        errori.push(`${pezzo.id} [${stato}]: le proprietà estratte non sono quelle della mappa: ${rigenera}`);
      }
    }
  }
  for (const id of Object.keys(attesi.valori)) {
    if (!pezzi.some((p) => p.id === id)) {
      errori.push(`${id}: ha valori estratti ma non è più nella mappa: ${rigenera}`);
    }
  }
  return errori;
}

const stage = await openStage();
let rosso = false;
try {
  for (const nome of prototipi) {
    const { STATI, VISTE, PEZZI, TRADUZIONI, DA_COPRIRE = [] } = await import(pathToFileURL(here(`./mappa-${nome}.mjs`)).href);
    const attesi = JSON.parse(await readFile(here(`./${nome}.json`), "utf8"));
    const eccezioni = JSON.parse(await readFile(here(`./eccezioni-${nome}.json`), "utf8"));

    const errori = [
      ...controllaAttesi(nome, attesi, PEZZI, VISTE),
      ...validaEccezioni(eccezioni, PEZZI).map((e) => `eccezioni-${nome}.json: ${e}`),
    ];
    errori.push(...validaTraduzioni(TRADUZIONI, PEZZI).map((e) => `TRADUZIONI: ${e}`));
    if (JSON.stringify(attesi.traduzioni) !== JSON.stringify(TRADUZIONI)) {
      errori.push(`le TRADUZIONI dei token non sono quelle dell'estrazione: rigenera con \`node bench/conformita/estrai.mjs ${nome}\``);
    }
    const copertura = coperture(DA_COPRIRE, PEZZI);
    errori.push(...copertura.errori.map((e) => `DA_COPRIRE: ${e}`));

    const scelti = PEZZI.filter((p) => (ancheAttese || !p.attende) && (!solo || p.id.startsWith(solo)));
    const attese = ancheAttese ? [] : PEZZI.filter((p) => p.attende);
    const statiFatti = new Set();
    const differenze = [];
    const mancanti = [];
    let confronti = 0;

    for (const [idVista, vista] of Object.entries(VISTE)) {
      // Una vista coi soli pezzi che attendono non apre la scena: può non
      // esserci ancora.
      if (!scelti.some((p) => p.vista === idVista)) continue;
      const scena = SCENE.find((s) => s.id === vista.app.scena);
      if (!scena) {
        errori.push(`vista «${idVista}»: la scena «${vista.app.scena}» non è in bench/scene.mjs`);
        continue;
      }
      for (const idStato of vista.stati) {
        const stato = STATI[idStato];
        if (!stato) {
          errori.push(`vista «${idVista}»: lo stato «${idStato}» non è in STATI`);
          continue;
        }
        if (luce && stato.luce !== luce) continue;
        const pezzi = scelti.filter((p) => p.vista === idVista && (p.stati ?? vista.stati).includes(idStato));
        if (pezzi.length === 0) continue;
        const page = await openPage(stage.browser, stato.luce);
        try {
          await page.setViewportSize(stato.finestra);
          await prepareScene(page, scena, stato.luce, stage.base, sceneUrl);
          if (vista.app.prepara) await vista.app.prepara(page);
          for (const pezzo of pezzi) {
            const proprieta = espandi(pezzo.proprieta);
            if (pezzo.gesto) await gesto(page, null, pezzo.gesto.tipo, pezzo.gesto.app);
            const [trovati] = await leggi(page, null, [{ selettore: pezzo.app, proprieta }]);
            if (pezzo.gesto) await riposo(page);
            const estratto = attesi.valori[pezzo.id]?.[idStato] ?? null;
            const atteso = estratto && { ...estratto.proprieta };
            // I colori fatti di token: l'atteso è l'espressione coi token di
            // Fub, risolta qui sotto l'elemento (`confronto.mjs`, «I token»).
            const voci = Object.entries(estratto?.fub ?? {}).map(([proprieta, espressioni]) => ({ proprieta, espressioni }));
            if (trovati && voci.length) {
              const risolti = await risolvi(page, pezzo.app, voci);
              voci.forEach((v, i) => {
                atteso[v.proprieta] = v.espressioni.map((come, j) => ({ come, valore: risolti[i][j] }));
              });
            }
            const esito = confrontaPezzo(pezzo, idStato, atteso, trovati);
            differenze.push(...esito.differenze);
            mancanti.push(...esito.mancanti);
            confronti += proprieta.length;
            statiFatti.add(`${pezzo.id} ${idStato}`);
          }
        } finally {
          await page.context().close();
        }
      }
    }

    // Le eccezioni che non coprono più niente sono rosse solo se la corsa
    // ha guardato dove dicono: con `--light` o `--only` una parte resta fuori.
    const { rosse, giustificate, inutili } = applicaEccezioni(differenze, [...eccezioni, ...copertura.voci]);
    const inutiliGuardate = inutili.filter((e) =>
      [...statiFatti].some((k) => {
        const [id, stato] = k.split(" ");
        return id === e.pezzo && (!e.stati || e.stati.includes(stato));
      }),
    );
    const daCoprire = giustificate.filter((d) => d.eccezione.daCoprire);
    const volute = giustificate.filter((d) => !d.eccezione.daCoprire);
    const pezziInteri = DA_COPRIRE.filter((d) => !d.proprieta).length;

    const pezziGuardati = new Set([...statiFatti].map((k) => k.split(" ")[0])).size;
    console.log(
      `conformità a ${nome} (${attesi.ramo} @ ${attesi.commit.slice(0, 9)}): ` +
        `${pezziGuardati} pezzi, ${statiFatti.size} letture, ${confronti} proprietà; ` +
        `${volute.length} differenze con eccezione, ${daCoprire.length} da coprire, ${pezziInteri} pezzi interi da coprire`,
    );
    if (attese.length) {
      const perLavoro = Map.groupBy(attese, (p) => p.attende);
      console.log(
        `  attendono (non letti, --attese per leggerli): ` +
          [...perLavoro].map(([lavoro, pezzi]) => `${lavoro} ${pezzi.length}`).join(", "),
      );
    }
    console.log(
      `  tolleranze: ${TOLLERANZA.lunghezza} px, ±${TOLLERANZA.canale} per canale, ±${TOLLERANZA.alfa} di alfa`,
    );
    for (const e of errori) console.log(`ROSSO ${e}`);
    for (const m of mancanti) console.log(`ROSSO ${scriviMancante(m)}`);
    for (const d of rosse) console.log(`ROSSO ${scriviDifferenza(d)}`);
    for (const e of inutiliGuardate) {
      if (e.daCoprire) {
        console.log(`ROSSO ${e.pezzo} ${e.proprieta} ora coincide col prototipo: toglilo da DA_COPRIRE in mappa-${nome}.mjs`);
      } else {
        console.log(`ROSSO eccezione non più usata: ${e.pezzo} ${e.proprieta}${e.stati ? ` [${e.stati.join(", ")}]` : ""} (${e.riferimento}): toglila`);
      }
    }
    if (statiFatti.size === 0 && !solo) {
      console.log(`ROSSO ${nome}: nessun pezzo confrontato`);
      rosso = true;
    }
    if (errori.length || mancanti.length || rosse.length || inutiliGuardate.length) rosso = true;

    await mkdir(REFERTO, { recursive: true });
    await writeFile(
      join(REFERTO, `${nome}.json`),
      `${JSON.stringify({ prototipo: nome, commit: attesi.commit, errori, mancanti, rosse, eccezioni: volute, daCoprire, inutili: inutiliGuardate }, null, 2)}\n`,
    );
  }
} finally {
  await stage.close();
}
if (rosso) {
  console.log("conformità al prototipo: ROSSO");
  process.exit(1);
}
console.log("conformità al prototipo: verde");
