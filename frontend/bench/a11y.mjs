// **Il contrasto reso**: `axe-core` su ogni scena, in tutte e due le luci (§31.1).
//
//     node bench/a11y.mjs
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
// (`src/theme/contrast.ts` la scrive una volta sola) e non condividono l'occhio:
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
import { SCENE, LIGHTS, sceneUrl } from "./scene.mjs";
import { openStage, openPage, prepareScene, OUTPUT } from "./stage.mjs";

/// **Il debito dichiarato**: le coppie che oggi stanno sotto la soglia.
///
/// Oggi è **vuoto**, e la storia di come si è svuotato è il motivo per cui
/// questa lista resta qui invece di essere cancellata.
///
/// È un elenco, non un'esenzione. Un'esenzione si scrive una volta e non si
/// guarda più; un elenco è un lucchetto che si chiude in tutte e due i versi —
/// una coppia che scende sotto soglia senza essere scritto qui è rossa, e una
/// scritto qui che nessuna scena produce più è rossa pure lei, perché è la foto
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
const DEBT = [];

/// Le regole di `axe` che questo presidio accende. Sono i due gradini di WCAG
/// per il contrasto del testo: 4,5:1 sul testo normale e 3:1 su quello grande,
/// che è la stessa promessa di `contrast.test.ts` — misurata dall'altro lato.
const RULES = ["color-contrast"];

const REPORT = join(OUTPUT, "contrasto");

const require = createRequire(import.meta.url);

/// Cosa è successo a una scena. Come per il fotografo, sono nomi e non booleani:
/// «non ha trovato testo» e «il testo ha contrasto» sono due cose diverse, e
/// distinguerle è metà del lavoro di questo file.
const OUTCOMES = {
  clean: "pulita",
  lowContrast: "contrasto basso",
  opaque: "muta",
  unstable: "instabile",
};

async function main() {
  await rm(REPORT, { recursive: true, force: true });
  await mkdir(REPORT, { recursive: true });

  const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  const stage = await openStage();
  const report = [];

  try {
    for (const light of LIGHTS) {
      const page = await openPage(stage.browser, light);
      for (const scene of SCENE) {
        report.push(await aScene(page, scene, light, stage.base, axeSource));
      }
      await page.context().close();
    }
  } finally {
    await stage.close();
  }

  await writeFile(
    join(REPORT, "contrasto.json"),
    `${JSON.stringify(
      report.map((r) => ({ ...r, scene: r.scene.id })),
      null,
      2,
    )}\n`,
  );
  return summary(report);
}

async function aScene(page, scene, light, base, axeSource) {
  const row = { scene, light, examined: 0, failures: [], declared: [], incompletes: [] };

  try {
    await prepareScene(page, scene, light, base, sceneUrl);
  } catch (e) {
    row.outcome = OUTCOMES.unstable;
    row.reason = e.message.split("\n")[0];
    console.error(`✗ ${scene.id} (${light}): ${row.reason}`);
    return row;
  }

  // `axe` si inietta a scena preparata: prima non ci sarebbe niente da leggere,
  // e dopo lo scatto la pagina è già passata alla prossima.
  await page.addScriptTag({ content: axeSource });
  const outcome = await page.evaluate(
    async (rules) =>
      // eslint-disable-next-line no-undef
      await window.axe.run(document, {
        runOnly: { type: "rule", values: rules },
        // Gli iframe sono `web_view` del catalogo e portano `about:blank`: non
        // c'è niente dentro, e chiederlo vorrebbe dire un timeout per scena.
        iframes: false,
      }),
    RULES,
  );

  const count = (group) => group.reduce((n, r) => n + r.nodes.length, 0);
  row.examined = count(outcome.passes) + count(outcome.violations) + count(outcome.incomplete);

  for (const rule of outcome.violations) {
    for (const node of rule.nodes) {
      const g = describe(rule, node);
      const declared = DEBT.find(
        (d) => d.light === light && d.front === g.front && d.behind === g.behind,
      );
      if (declared) {
        declared.seen = true;
        row.declared.push(g);
      } else {
        row.failures.push(g);
      }
    }
  }
  for (const rule of outcome.incomplete) {
    for (const node of rule.nodes) {
      row.incompletes.push(describe(rule, node));
    }
  }

  if (row.failures.length > 0) row.outcome = OUTCOMES.lowContrast;
  else if (row.examined === 0) row.outcome = OUTCOMES.opaque;
  else row.outcome = OUTCOMES.clean;

  print(row);
  return row;
}

/// Un rilievo, ridotto a ciò che serve per ripararlo: dove, quanto, e fra quali
/// due colori. Il resto di ciò che `axe` restituisce è la spiegazione della
/// regola, che è sempre la stessa e sta nel suo sito.
function describe(rule, node) {
  const data = node.any.find((c) => c.data)?.data ?? {};
  return {
    rule: rule.id,
    where: node.target.join(" "),
    text: (node.html ?? "").replace(/\s+/g, " ").slice(0, 90),
    measured: data.contrastRatio ?? null,
    expected: data.expectedContrastRatio ?? null,
    front: data.fgColor ?? null,
    behind: data.bgColor ?? null,
    reason: data.messageKey ?? null,
  };
}

function print(row) {
  const name = `${row.scene.id} (${row.light})`;
  if (row.outcome === OUTCOMES.opaque) {
    console.error(`✗ ${name}: nessun elemento esaminato — la pagina non ha text?`);
    return;
  }
  if (row.outcome === OUTCOMES.lowContrast) {
    console.error(`✗ ${name}: ${row.failures.length} sotto la soglia`);
    for (const g of row.failures) {
      const measurement = g.measured ? `${g.measured}:1 invece di ${g.expected}:1` : g.reason;
      console.error(`    ${g.where} — ${measurement}`);
      console.error(`      ${g.front ?? "?"} su ${g.behind ?? "?"} — ${g.text}`);
    }
    return;
  }
  const debt = row.declared.length > 0 ? `, ${row.declared.length} nel debito` : "";
  console.log(`· ${name}: ${row.examined} elementi${debt}`);
}

function summary(report) {
  const count = (outcome) => report.filter((r) => r.outcome === outcome).length;
  const incompletes = report.flatMap((r) => r.incompletes.map((i) => ({ ...i, row: r })));

  if (incompletes.length > 0) {
    console.log(`\n${incompletes.length} indecisi: axe non è riuscito a misurare lo sfondo.`);
    for (const i of incompletes) {
      console.log(`    ${i.row.scene.id} (${i.row.light}) ${i.where} — ${i.reason ?? "senza motivo"}`);
      console.log(`      ${i.text}`);
    }
  }

  // Il secondo verso del lucchetto: una coppia scritta nel debito che nessuna
  // scena produce più è la foto di un difetto riparato rimasta appesa al muro.
  const fixed = DEBT.filter((d) => !d.seen);
  if (fixed.length > 0) {
    console.error(`\n${fixed.length} voci del debito non si vedono più:`);
    for (const d of fixed) {
      console.error(`    ${d.front} su ${d.behind} (${d.light}) — ${d.cosa.split(".")[0]}`);
    }
    console.error("  Se sono riparate, si tolgono da DEBITO: è la metà del presidio" +
      " che dice che il tema è migliorato.");
  }

  const declared = report.reduce((n, r) => n + r.declared.length, 0);
  if (declared > 0) {
    console.log(`\n${declared} rilievi nel debito dichiarato, su ${DEBT.length} coppie:`);
    for (const d of DEBT) {
      console.log(`    ${d.front} su ${d.behind} — §${d.voce}`);
    }
  }

  const red =
    count(OUTCOMES.lowContrast) + count(OUTCOMES.opaque) + count(OUTCOMES.unstable) + fixed.length;
  const examined = report.reduce((n, r) => n + r.examined, 0);
  const redScenes =
    count(OUTCOMES.lowContrast) + count(OUTCOMES.opaque) + count(OUTCOMES.unstable);
  console.log(
    `\n${report.length - redScenes}/${report.length} scene pulite,` +
      ` ${examined} elementi misurati`,
  );
  console.log(`Il referto: ${join(REPORT, "contrasto.json")}`);

  if (red === 0) return 0;
  if (fixed.length > 0) return 1;
  if (count(OUTCOMES.lowContrast) > 0) {
    console.error(
      "\nUn testo sotto la soglia si ripara nel tema, non qui: la misura è sulla pagina" +
        " vera, quindi il numero che si legge è quello che vede chi guarda.",
    );
  }
  return 1;
}

process.exitCode = await main();
