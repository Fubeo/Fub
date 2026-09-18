// **L'accessibilità resa**: `axe-core` su ogni scena, in tutte e due le luci
// (§31.1), più i gesti che un browser compie davvero quando si usa la tastiera.
//
//     node bench/a11y.mjs
//
// Una scansione strutturale non basta: il nome può esserci ma il fuoco non
// arrivare mai, un controllo può avere un ruolo valido ma non reagire a Invio,
// e un `aria-disabled` può continuare ad attivare l'azione. Questo banco usa
// axe per tutte le regole applicabili e il browser per il percorso osservabile.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SCENE, LIGHTS, sceneUrl } from "./scene.mjs";
import { openStage, openPage, prepareScene, OUTPUT } from "./stage.mjs";
/// Debito storico dichiarato. Non è un'esenzione dalle altre regole:
/// ogni violazione fuori dal debito resta bloccante e viene riportata.
const DEBT = [];

const REPORT = join(OUTPUT, "accessibilita");

const require = createRequire(import.meta.url);

const OUTCOMES = {
  clean: "pulita",
  violations: "violazioni",
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
    join(REPORT, "accessibilita.json"),
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

  // `axe` si inietta a scena preparata: ogni passata usa il documento corrente.
  await page.addScriptTag({ content: axeSource });
  const outcome = await page.evaluate(
    async () =>
      // eslint-disable-next-line no-undef
      await window.axe.run(document, {
        // Gli iframe sono web_view del catalogo e portano `about:blank`: il
        // documento figlio non appartiene alla superficie che si sta provando.
        iframes: false,
      }),
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

  if (row.failures.length > 0) row.outcome = OUTCOMES.violations;
  else if (row.examined === 0) row.outcome = OUTCOMES.opaque;
  else row.outcome = OUTCOMES.clean;

  print(row);
  return row;
}

/// Un rilievo axe, ridotto a regola e indicazioni che permettono di ripararlo.
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
  if (row.outcome === OUTCOMES.violations) {
    console.error(`✗ ${name}: ${row.failures.length} violazioni`);
    for (const issue of row.failures) {
      console.error(`    [${issue.rule ?? "browser"}] ${issue.where} — ${issue.reason ?? issue.help ?? "senza dettaglio"}`);
      if (issue.helpUrl) console.error(`      ${issue.helpUrl}`);
      if (issue.measured) console.error(`      ${issue.measured}:1 invece di ${issue.expected}:1`);
      if (issue.text) console.error(`      ${issue.text}`);
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
    console.log(`\n${incompletes.length} indecisi: axe non è riuscito a determinare una regola.`);
    for (const i of incompletes) {
      console.log(`    ${i.row.scene.id} (${i.row.light}) [${i.rule}] ${i.where} — ${i.reason ?? "senza motivo"}`);
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
    count(OUTCOMES.violations) + count(OUTCOMES.opaque) + count(OUTCOMES.unstable) + fixed.length;
  const examined = report.reduce((n, r) => n + r.examined, 0);
  const redScenes =
    count(OUTCOMES.violations) + count(OUTCOMES.opaque) + count(OUTCOMES.unstable);
  console.log(
    `\n${report.length - redScenes}/${report.length} scene pulite,` +
      ` ${examined} elementi esaminati`,
  );
  console.log(`Il referto: ${join(REPORT, "accessibilita.json")}`);

  if (red === 0) return 0;
  return 1;
}

process.exitCode = await main();
