// **La generazione dei derivati del tema**: le sorgenti entrano, i file escono.
//
//     node tema/genera.mjs             riscrive i derivati
//     node tema/genera.mjs --verifica  dice se sono quelli che le sorgenti producono
//
// Sono due, e hanno la stessa forma. I **due fogli** (§31.2) vengono dalla
// ricetta in OKLCH: si dichiara luminosità, croma e tinta, ed esce
// l'esadecimale. La **pelle** (§31.4) viene dai suoi pezzi, uno per componente:
// si scrive un componente per volta ed esce il file solo che il caricatore
// monta e che i presidi leggono.
//
// Stanno nello stesso script perché sono la stessa promessa — «rigenerare dà
// gli stessi byte» — e perché chi ha toccato l'una vuole verificare l'altra
// senza ricordarsi due comandi.
//
// # Perché passa da Vite e non da Node
//
// Perché la ricetta è codice della shell, e il codice della shell importa come
// importa la shell: `../contrast`, senza estensione, come tutti gli altri
// duecento import di `src/`. Node quel nome non lo risolve — vuole il file — e
// farglielo risolvere vorrebbe dire scrivere `../contrast.ts` in un file di
// produzione per far contento uno script. Sarebbe la coda che muove il cane, ed
// è esattamente la mossa che il banco visivo ha già rifiutato una volta: **si
// carica la cosa vera attraverso lo strumento che la sa caricare**, invece di
// piegare la cosa vera allo strumento.
//
// Vite è già una dipendenza e `ssrLoadModule` è tre righe. Il prezzo è un
// secondo di avvio; il ricavo è che la ricetta resta un modulo che la §31.6
// potrà importare nella webview senza toccarne un carattere.
//
// # Perché due modi e non uno
//
// `--verifica` non riscrive niente e ritorna 1 se i fogli su disco non sono
// quelli che la ricetta produce. È il verso che serve in CI e nel ciclo locale:
// senza, «rigenerare dà gli stessi byte» sarebbe una cosa che si dice, e la si
// scoprirebbe falsa il giorno in cui qualcuno ritocca un esadecimale a mano —
// cioè il giorno in cui la ricetta smette di essere la sorgente.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERIES = join(HERE, "..", "src", "theme", "serie");
const AUTHOR = join(HERE, "author");
const SAMPLE = join(AUTHOR, "sample");

const verify = process.argv.includes("--verify");

const vite = await createServer({
  root: join(HERE, ".."),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

/** @type {{ VARIANTS: readonly { light: string, contrast: string }[], SHEETS: Record<string,Record<string,string>>, sheet: (l: string, c: string) => string }} */
const recipe = await vite.ssrLoadModule("/src/theme/serie/recipe.ts");
/** @type {{ ORDINE: readonly string[], SKIN: string, assembla: (c: Record<string,string>) => string }} */
const skin = await vite.ssrLoadModule("/src/theme/serie/skin/order.ts");
/** @type {{ HOOKS: readonly string[], STATE_NAMES: readonly string[], COMPONENTS: readonly { name: string, hooks: readonly string[], states: readonly { name: string }[] }[], unassignedHooks: () => string[] }} */
const anatomy = await vite.ssrLoadModule("/src/theme/serie/anatomia.ts");
/** @type {{ REQUIRED_THEME_ROLES: readonly string[], THEME_CONTRAST_PAIRS: readonly unknown[] }} */
const contrast = await vite.ssrLoadModule("/src/theme/contrast-fixture.ts");

let diffCount = 0;

/// Scrive, o dice che è diverso. Il nome è quello che compare a video; `atteso`
/// è ciò che la sorgente produce.
async function derived(name, expected, source, base = SERIES) {
  const file = join(base, name);
  const onDisk = await readFile(file, "utf8").catch(() => null);

  if (onDisk === expected) {
    console.log(`· ${name}: uguale ${source}`);
    return;
  }

  diffCount += 1;
  if (verify) {
    console.error(`✗ ${name}: ${onDisk === null ? "non c'è" : `non è quello che si genera ${source}`}`);
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, expected);
  console.log(`✎ ${name}: riscritto (${expected.length} byte)`);
}

try {
  for (const { light, contrast } of recipe.VARIANTS) {
    await derived(
      recipe.SHEETS[light][contrast],
      recipe.sheet(light, contrast),
      "alla ricetta",
    );
  }

  // I pezzi si leggono **tutti**, non solo quelli elencati: `assembla` rifiuta
  // ciò che nessuno ha messo nell'ordine, e quel rifiuto è il punto — un pezzo
  // scritto e mai montato è la specie di silenzio che questo script esiste per
  // rompere.
  const folder = join(SERIES, "skin");
  const content = {};
  for (const f of (await readdir(folder)).sort()) {
    if (!f.endsWith(".css")) continue;
    content[f.slice(0, -".css".length)] = await readFile(join(folder, f), "utf8");
  }
  const assembledSkin = skin.assemble(content);
  await derived(skin.SKIN, assembledSkin, "ai suoi pezzi");

  const roles = [...new Set([...recipe.roles(), ...contrast.REQUIRED_THEME_ROLES])].sort();
  const assignedStates = anatomy.COMPONENTS.reduce(
    (count, component) => count + component.states.length,
    0,
  );
  const authorContract = {
    engine: "theme-1",
    required_roles: roles,
    hooks: [...anatomy.HOOKS],
    states: [...anatomy.STATE_NAMES],
    components: anatomy.COMPONENTS.map((component) => ({
      name: component.name,
      hooks: component.hooks,
      states: component.states.map((state) => state.name),
    })),
    contrast_pairs: contrast.THEME_CONTRAST_PAIRS,
    counts: {
      required_roles: roles.length,
      hooks: anatomy.HOOKS.length,
      state_names: anatomy.STATE_NAMES.length,
      assigned_states: assignedStates,
      components: anatomy.COMPONENTS.length,
      unassigned_hooks: anatomy.unassignedHooks().length,
    },
  };
  const contractText = `${JSON.stringify(authorContract, null, 2)}\n`;
  await derived("contract.json", contractText, "a ricetta, anatomia e fixture contrasto", AUTHOR);

  const guide = `# Tema theme-1\n\n` +
    `Fonte generata: \`npm run theme:generate\`. Verifica: \`npm run theme:verify\`.\n\n` +
    `Il contratto richiede **${roles.length} ruoli**, espone **${anatomy.HOOKS.length} hook**, ` +
    `**${anatomy.STATE_NAMES.length} stati** (${assignedStates} assegnazioni su ${anatomy.COMPONENTS.length} componenti). ` +
    `Hook non assegnati: **${anatomy.unassignedHooks().length}**. Gli elenchi e le coppie di contrasto sono in ` +
    `\`contract.json\`, generato dalle sorgenti della shell.\n\n` +
    `Una cartella installabile contiene \`manifest.json\`, un foglio per luce, \`skin.css\` e gli asset locali. ` +
    `Il campione \`sample/\` è un bundle non-serie completo, generato dagli stessi cancelli.\n`;
  await derived("README.md", guide, "ai conti del contratto", AUTHOR);

  const manifest = {
    id: "org.fub.theme-bench",
    name: "Fub Theme Bench",
    version: "1.0.0",
    engine: "theme-1",
    lights: ["dark", "light"],
    asset_namespace: "theme://org.fub.theme-bench/",
    motion: ["opacity", "transform"],
  };
  await derived("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, "al contratto theme-1", SAMPLE);
  await derived("sheet-dark.css", recipe.sheet("dark", "normal"), "alla ricetta", SAMPLE);
  await derived("sheet-light.css", recipe.sheet("light", "normal"), "alla ricetta", SAMPLE);
  await derived("skin.css", assembledSkin, "all'anatomia", SAMPLE);
} finally {
  await vite.close();
}

if (verify && diffCount > 0) {
  console.error(
    "\nI derivati si generano: «npm run tema:genera». Un esadecimale ritoccato a mano," +
      " o una regola scritta dentro la pelle montata, sparisce alla prima rigenerazione —" +
      " e fino ad allora dice il falso sulla sorgente.",
  );
}
process.exitCode = verify && diffCount > 0 ? 1 : 0;
