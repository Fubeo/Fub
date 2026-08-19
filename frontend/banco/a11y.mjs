// **Il contrasto reso**: `axe-core` su ogni scena, in tutte e due le luci (§31.1).
//
//     node banco/a11y.mjs
//
// # Perché serve, se i token hanno già il loro presidio
//
// Perché misurano due cose diverse, e la seconda è quella che si vede.
//
// `src/theme/contrast.test.ts` legge i **fogli come testo** e verifica le coppie
// che il tema promette: `--text` su `--bg`, `--muted` su `--bg-elev`, e così
// via. È una misura sulle intenzioni, ed è l'unica che possa dire *quale* token
// è sbagliato. Ma non sa niente di ciò che succede dopo: un'opacità che schiara
// un testo, un colore ereditato da un antenato che non è la superficie che si
// credeva, un elemento che ne copre un altro, un `color` scritto a mano in un
// punto che nessuno ha guardato. Nessuna di queste tre cose si vede leggendo un
// foglio, e tutte e tre si vedono guardando la pagina.
//
// Qui si guarda la pagina: la stessa che il fotografo ritrae, negli stessi
// gesti, con lo stesso corpus. Le due misure condividono l'aritmetica
// (`src/theme/contrasto.ts` la scrive una volta sola) e non condividono l'occhio:
// una legge i fogli, l'altra il DOM reso.
//
// # Quali regole, e perché dichiarate
//
// Solo il contrasto. Non perché il resto non conti, ma perché questa è la voce
// del contrasto: accendere qui l'intero `axe` vorrebbe dire un elenco di
// centinaia di rilievi che nessuno ha deciso di riparare, cioè un rosso che si
// impara a ignorare — e un presidio che si impara a ignorare è peggio di uno che
// non c'è, perché occupa il posto di quello che servirebbe. L'accessibilità
// completa è una voce sua, e quando arriverà si aggiungeranno regole a questo
// elenco invece di riscrivere questo file.
//
// # La regola che non trova niente
//
// Una regola che non si applica a nessun elemento e una regola che passa su
// tutti danno lo stesso verde — è la lezione della
// [0109](../../docs/decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md).
// Qui si conta quanti elementi `axe` ha davvero esaminato, e una scena che ne
// esamina **zero** è rossa: vuol dire che non c'è testo, cioè che la pagina non
// è quella che si credeva.
//
// # Gli indecisi
//
// `axe` restituisce un terzo esito oltre a «passa» e «non passa»: *incomplete* —
// non sono riuscito a dirlo. Succede quando lo sfondo di un testo non è un
// colore ma un'immagine, un gradiente o un canvas, e la misura non si può fare
// senza guardare i pixel. Non bloccano, perché non affermano niente; ma si
// stampano tutti, uno per uno, perché **non dire non è dire di sì** e un
// indeciso che sparisce è un difetto che nessuno ha deciso di tenere.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SCENE, LUCI, indirizzo } from "./scene.mjs";
import { apriIlPalco, apriUnaPagina, preparaScena, USCITA } from "./palco.mjs";

/// **Il debito dichiarato**: le coppie che oggi stanno sotto la soglia.
///
/// Oggi è **vuoto**, e la storia di come si è svuotato è il motivo per cui
/// questa lista resta qui invece di essere cancellata.
///
/// È un elenco, non un'esenzione. Un'esenzione si scrive una volta e non si
/// guarda più; un elenco è un lucchetto che si chiude in tutte e due i versi —
/// una coppia che scende sotto soglia senza essere scritta qui è rossa, e una
/// scritta qui che nessuna scena produce più è rossa pure lei, perché è la foto
/// di un difetto riparato che nessuno ha tolto dal muro. È il secondo verso che
/// ha fatto il lavoro: le cinque voci non le ha tolte qualcuno passando di qua,
/// le ha tolte questo banco diventando rosso quando la §31.2 le ha riparate.
///
/// La chiave, quando ce n'è una, è la **coppia di colori** e non il selettore: i
/// selettori sono le classi generate di CodeMirror (`.ͼz`, `.ͼq`), che cambiano
/// a ogni ricostruzione, mentre la coppia è il difetto vero e non cambia finché
/// non si tocca il foglio.
///
/// # Le cinque che c'erano, e cosa le ha pagate
///
/// Erano **tutte e cinque nel chiaro** — non un caso, ed è metà della ragione
/// per cui questo banco fotografa in due luci: lo scuro è il tema in cui si
/// lavora, quindi è quello che qualcuno guarda tutti i giorni.
///
/// Due erano debito già dichiarato altrove: `--syn-comment` e `--syn-function`
/// sul fondo del documento, sotto AA perché la tavolozza di sintassi era One
/// Light presa intera. Le pagava la **25.1**, l'alto contrasto — cioè le pagava
/// un domani. Le ha pagate invece la §31.2, che ha smesso di prendere una
/// tavolozza intera: le dieci specie dichiarano tinta e croma, la chiarezza la
/// trova la ricetta da una mira sola per tutta la famiglia, e la mira sta sopra
/// AA.
///
/// Le altre tre le vedeva **solo** la misura sul reso, ed erano la ragione per
/// cui questo file esiste accanto a `contrast.test.ts` invece che dentro:
///
/// - `--syn-name` sulla **riga attiva** invece che sul fondo (3,21:1). La
///   tabella dei token misurava ogni specie contro `--doc-bg`, che era l'unico
///   fondo che sapesse esistere.
/// - `--doc-heading` su `h3`, `h4`, `h5` (3,51:1). Alla coppia si chiedeva 3:1 e
///   non 4,5:1 perché «un titolo è testo grande»: vero per un `h1`, falso dal
///   terzo livello in giù.
/// - `--doc-link` sopra `--doc-fill` (3,9:1). `--doc-fill` è un **velo**
///   (`rgb(135 135 135 / 16%)`), e la formula dei token si rifiuta di misurare
///   ciò che ha un alpha — giustamente: senza sapere cosa c'è sotto, il numero
///   sarebbe inventato.
///
/// Nessuna delle tre è stata riparata guardando questo referto. Le ha riparate
/// la ricetta, perché la §31.2 ha reso «**sopra cosa sta**» una cosa che si
/// dichiara: `sopra: CARTA` sono tutti e tre i fondi del documento e non solo la
/// pagina, la mira di `--doc-heading` è quella del testo e non quella dei segni,
/// e `sopra: [...CARTA, "doc-bg+doc-fill"]` è il velo **composto** sul fondo
/// prima di misurarlo. Il velo non è più invisibile al presidio dei token
/// perché adesso c'è un posto in cui dire su cosa poggia.
///
/// Il che è anche il limite di quel presidio detto per bene: non vedeva quelle
/// tre coppie perché nessuno gliele aveva nominate. Questo banco le ha viste
/// senza che nessuno gliele nominasse — ed è la sola ragione per cui esiste.
const DEBITO = [];

/// Le regole di `axe` che questo presidio accende. Sono i due gradini di WCAG
/// per il contrasto del testo: 4,5:1 sul testo normale e 3:1 su quello grande,
/// che è la stessa promessa di `contrast.test.ts` — misurata dall'altro lato.
const REGOLE = ["color-contrast"];

const REFERTO = join(USCITA, "contrasto");

const require = createRequire(import.meta.url);

/// Cosa è successo a una scena. Come per il fotografo, sono nomi e non booleani:
/// «non ha trovato testo» e «il testo ha contrasto» sono due cose diverse, e
/// distinguerle è metà del lavoro di questo file.
const ESITI = {
  pulita: "pulita",
  contrastoBasso: "contrasto basso",
  muta: "muta",
  instabile: "instabile",
};

async function main() {
  await rm(REFERTO, { recursive: true, force: true });
  await mkdir(REFERTO, { recursive: true });

  const sorgenteAxe = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  const palco = await apriIlPalco();
  const referto = [];

  try {
    for (const luce of LUCI) {
      const page = await apriUnaPagina(palco.browser, luce);
      for (const scena of SCENE) {
        referto.push(await unaScena(page, scena, luce, palco.base, sorgenteAxe));
      }
      await page.context().close();
    }
  } finally {
    await palco.chiudi();
  }

  await writeFile(
    join(REFERTO, "contrasto.json"),
    `${JSON.stringify(
      referto.map((r) => ({ ...r, scena: r.scena.id })),
      null,
      2,
    )}\n`,
  );
  return riassunto(referto);
}

async function unaScena(page, scena, luce, base, sorgenteAxe) {
  const riga = { scena, luce, esaminati: 0, guasti: [], dichiarati: [], indecisi: [] };

  try {
    await preparaScena(page, scena, luce, base, indirizzo);
  } catch (e) {
    riga.esito = ESITI.instabile;
    riga.motivo = e.message.split("\n")[0];
    console.error(`✗ ${scena.id} (${luce}): ${riga.motivo}`);
    return riga;
  }

  // `axe` si inietta a scena preparata: prima non ci sarebbe niente da leggere,
  // e dopo lo scatto la pagina è già passata alla prossima.
  await page.addScriptTag({ content: sorgenteAxe });
  const esito = await page.evaluate(
    async (regole) =>
      // eslint-disable-next-line no-undef
      await window.axe.run(document, {
        runOnly: { type: "rule", values: regole },
        // Gli iframe sono `web_view` del catalogo e portano `about:blank`: non
        // c'è niente dentro, e chiederlo vorrebbe dire un timeout per scena.
        iframes: false,
      }),
    REGOLE,
  );

  const conta = (gruppo) => gruppo.reduce((n, r) => n + r.nodes.length, 0);
  riga.esaminati = conta(esito.passes) + conta(esito.violations) + conta(esito.incomplete);

  for (const regola of esito.violations) {
    for (const nodo of regola.nodes) {
      const g = descrivi(regola, nodo);
      const dichiarato = DEBITO.find(
        (d) => d.luce === luce && d.davanti === g.davanti && d.dietro === g.dietro,
      );
      if (dichiarato) {
        dichiarato.visto = true;
        riga.dichiarati.push(g);
      } else {
        riga.guasti.push(g);
      }
    }
  }
  for (const regola of esito.incomplete) {
    for (const nodo of regola.nodes) {
      riga.indecisi.push(descrivi(regola, nodo));
    }
  }

  if (riga.guasti.length > 0) riga.esito = ESITI.contrastoBasso;
  else if (riga.esaminati === 0) riga.esito = ESITI.muta;
  else riga.esito = ESITI.pulita;

  stampa(riga);
  return riga;
}

/// Un rilievo, ridotto a ciò che serve per ripararlo: dove, quanto, e fra quali
/// due colori. Il resto di ciò che `axe` restituisce è la spiegazione della
/// regola, che è sempre la stessa e sta nel suo sito.
function descrivi(regola, nodo) {
  const dati = nodo.any.find((c) => c.data)?.data ?? {};
  return {
    regola: regola.id,
    dove: nodo.target.join(" "),
    testo: (nodo.html ?? "").replace(/\s+/g, " ").slice(0, 90),
    misurato: dati.contrastRatio ?? null,
    preteso: dati.expectedContrastRatio ?? null,
    davanti: dati.fgColor ?? null,
    dietro: dati.bgColor ?? null,
    motivo: dati.messageKey ?? null,
  };
}

function stampa(riga) {
  const nome = `${riga.scena.id} (${riga.luce})`;
  if (riga.esito === ESITI.muta) {
    console.error(`✗ ${nome}: nessun elemento esaminato — la pagina non ha testo?`);
    return;
  }
  if (riga.esito === ESITI.contrastoBasso) {
    console.error(`✗ ${nome}: ${riga.guasti.length} sotto la soglia`);
    for (const g of riga.guasti) {
      const misura = g.misurato ? `${g.misurato}:1 invece di ${g.preteso}:1` : g.motivo;
      console.error(`    ${g.dove} — ${misura}`);
      console.error(`      ${g.davanti ?? "?"} su ${g.dietro ?? "?"} — ${g.testo}`);
    }
    return;
  }
  const debito = riga.dichiarati.length > 0 ? `, ${riga.dichiarati.length} nel debito` : "";
  console.log(`· ${nome}: ${riga.esaminati} elementi${debito}`);
}

function riassunto(referto) {
  const conta = (esito) => referto.filter((r) => r.esito === esito).length;
  const indecisi = referto.flatMap((r) => r.indecisi.map((i) => ({ ...i, riga: r })));

  if (indecisi.length > 0) {
    console.log(`\n${indecisi.length} indecisi: axe non è riuscito a misurare lo sfondo.`);
    for (const i of indecisi) {
      console.log(`    ${i.riga.scena.id} (${i.riga.luce}) ${i.dove} — ${i.motivo ?? "senza motivo"}`);
      console.log(`      ${i.testo}`);
    }
  }

  // Il secondo verso del lucchetto: una coppia scritta nel debito che nessuna
  // scena produce più è la foto di un difetto riparato rimasta appesa al muro.
  const riparate = DEBITO.filter((d) => !d.visto);
  if (riparate.length > 0) {
    console.error(`\n${riparate.length} voci del debito non si vedono più:`);
    for (const d of riparate) {
      console.error(`    ${d.davanti} su ${d.dietro} (${d.luce}) — ${d.cosa.split(".")[0]}`);
    }
    console.error("  Se sono riparate, si tolgono da DEBITO: è la metà del presidio" +
      " che dice che il tema è migliorato.");
  }

  const dichiarati = referto.reduce((n, r) => n + r.dichiarati.length, 0);
  if (dichiarati > 0) {
    console.log(`\n${dichiarati} rilievi nel debito dichiarato, su ${DEBITO.length} coppie:`);
    for (const d of DEBITO) {
      console.log(`    ${d.davanti} su ${d.dietro} — §${d.voce}`);
    }
  }

  const rossi =
    conta(ESITI.contrastoBasso) + conta(ESITI.muta) + conta(ESITI.instabile) + riparate.length;
  const esaminati = referto.reduce((n, r) => n + r.esaminati, 0);
  const sceneRosse =
    conta(ESITI.contrastoBasso) + conta(ESITI.muta) + conta(ESITI.instabile);
  console.log(
    `\n${referto.length - sceneRosse}/${referto.length} scene pulite,` +
      ` ${esaminati} elementi misurati`,
  );
  console.log(`Il referto: ${join(REFERTO, "contrasto.json")}`);

  if (rossi === 0) return 0;
  if (riparate.length > 0) return 1;
  if (conta(ESITI.contrastoBasso) > 0) {
    console.error(
      "\nUn testo sotto la soglia si ripara nel tema, non qui: la misura è sulla pagina" +
        " vera, quindi il numero che si legge è quello che vede chi guarda.",
    );
  }
  return 1;
}

process.exitCode = await main();
