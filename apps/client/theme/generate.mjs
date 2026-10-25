// **La generazione dei derivati del tema**: le sorgenti entrano, i file escono.
//
//     node tema/genera.mjs             riscrive i derivati
//     node tema/genera.mjs --verifica  dice se sono quelli che le sorgenti producono
//
// Sono due, e hanno la stessa forma. I **fogli** (§31.2) vengono dalla
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
const SERIES = join(HERE, "..", "src", "theme", "scrittoio");
const AUTHOR = join(HERE, "author");
const SAMPLE = join(AUTHOR, "sample");

const verify = process.argv.includes("--verify");

const vite = await createServer({
  root: join(HERE, ".."),
  server: { middlewareMode: true },
  // Solo moduli SSR: nessuna pagina client da pre-bundlare durante la generazione.
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
  logLevel: "warn",
});

/** @type {{ VARIANTS: readonly { light: string, contrast: string }[], SHEETS: Record<string,Record<string,string>>, sheet: (l: string, c: string) => string, roles: () => string[], OPTIONAL_ROLES: readonly string[] }} */
const recipe = await vite.ssrLoadModule("/src/theme/scrittoio/recipe.ts");
/** @type {{ SKIN: string, assemble: (c: Record<string,string>) => string }} */
const skin = await vite.ssrLoadModule("/src/theme/scrittoio/skin/order.ts");
/** @type {{ HOOKS: readonly string[], HOOK_LAYERS: Readonly<Record<string, string>>, LAYERS: readonly string[], STATE_NAMES: readonly string[], COMPONENTS: readonly { name: string, part: string, hooks: readonly string[], states: readonly { name: string }[] }[] }} */
const anatomy = await vite.ssrLoadModule("/src/theme/scrittoio/anatomia.ts");
/** @type {{ THEME_2_ENGINE: string, THEME_2_PROFILE: { requiredRoles: readonly string[], contrastPairs: readonly unknown[], optionalPairs?: readonly unknown[], preferenceTokens: readonly string[], vocabulary: { properties?: readonly string[], functions?: readonly string[], atRules?: readonly string[] } } }} */
const profile = await vite.ssrLoadModule("/src/theme/scrittoio/profile.ts");

let diffCount = 0;

/// Scrive, o dice che è diverso. Il nome è quello che compare a video; `atteso`
/// è ciò che la sorgente produce.
async function derived(name, expected, source, base = SERIES, label = name) {
  const file = join(base, name);
  const onDisk = await readFile(file, "utf8").catch(() => null);

  if (onDisk === expected) {
    console.log(`· ${label}: uguale ${source}`);
    return;
  }

  diffCount += 1;
  if (verify) {
    console.error(`✗ ${label}: ${onDisk === null ? "non c'è" : `non è quello che si genera ${source}`}`);
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, expected);
  console.log(`✎ ${label}: riscritto (${expected.length} byte)`);
}

/// I pezzi di una pelle come stanno sulla cartella: si leggono **tutti**, non
/// solo quelli elencati, perché `assemble` rifiuta ciò che nessuno ha messo
/// nell'ordine, e quel rifiuto è il punto.
async function parts(folder) {
  const content = {};
  for (const f of (await readdir(folder)).sort()) {
    if (!f.endsWith(".css")) continue;
    content[f.slice(0, -".css".length)] = await readFile(join(folder, f), "utf8");
  }
  return content;
}

try {
  for (const { light, contrast } of recipe.VARIANTS) {
    await derived(recipe.SHEETS[light][contrast], recipe.sheet(light, contrast), "alla ricetta");
  }

  // I pezzi si leggono **tutti**, non solo quelli elencati: `assemble` rifiuta
  // ciò che nessuno ha messo nell'ordine, e quel rifiuto è il punto — un pezzo
  // scritto e mai montato è la specie di silenzio che questo script esiste per
  // rompere.
  const assembledSkin = skin.assemble(await parts(join(SERIES, "skin")));
  await derived(skin.SKIN, assembledSkin, "ai suoi pezzi");

  const engine = profile.THEME_2_ENGINE;
  const roles = [...new Set([...recipe.roles(), ...profile.THEME_2_PROFILE.requiredRoles])].sort();
  const assignedStates = anatomy.COMPONENTS.reduce((count, component) => count + component.states.length, 0);
  const authorContract = {
    engine,
    required_roles: roles,
    hooks: [...anatomy.HOOKS],
    layers: Object.fromEntries(anatomy.HOOKS.map((hook) => [hook, anatomy.HOOK_LAYERS[hook]])),
    states: [...anatomy.STATE_NAMES],
    components: anatomy.COMPONENTS.map((component) => ({
      name: component.name,
      part: component.part,
      hooks: component.hooks,
      states: component.states.map((state) => state.name),
    })),
    contrast_pairs: profile.THEME_2_PROFILE.contrastPairs,
    optional_roles: [...recipe.OPTIONAL_ROLES],
    optional_pairs: profile.THEME_2_PROFILE.optionalPairs ?? [],
    preference_tokens: [...profile.THEME_2_PROFILE.preferenceTokens],
    vocabulary: profile.THEME_2_PROFILE.vocabulary,
    counts: {
      required_roles: roles.length,
      optional_roles: recipe.OPTIONAL_ROLES.length,
      hooks: anatomy.HOOKS.length,
      state_names: anatomy.STATE_NAMES.length,
      assigned_states: assignedStates,
      components: anatomy.COMPONENTS.length,
      preference_tokens: profile.THEME_2_PROFILE.preferenceTokens.length,
    },
  };
  const contractText = `${JSON.stringify(authorContract, null, 2)}\n`;
  const layerCount = (layer) => anatomy.HOOKS.filter((hook) => anatomy.HOOK_LAYERS[hook] === layer).length;
  await derived("contract.json", contractText, "a ricetta, anatomia e profilo", AUTHOR);

  const guide = [
    `# Tema ${engine}`,
    "",
    "Fonte generata: `npm run theme:generate`. Verifica: `npm run theme:verify`.",
    "",
    `Il contratto richiede **${roles.length} ruoli**, espone **${anatomy.HOOKS.length} hook**, **${anatomy.STATE_NAMES.length} stati** (${assignedStates} assegnazioni su ${anatomy.COMPONENTS.length} componenti) e lascia ridichiarare alla persona **${profile.THEME_2_PROFILE.preferenceTokens.length} token**. Gli elenchi, le coppie di contrasto e il vocabolario CSS in più sono in \`contract.json\`, generato dalle sorgenti della shell.`,
    "",
    `Dichiara anche **${recipe.OPTIONAL_ROLES.length} ruoli facoltativi** (\`optional_roles\`): i segni di Fub sulla carta del tema (\`--doc-ins\`, \`--doc-find\`, …) e la carta chiara di un file (\`--paper-*\`). Un tema che non li dichiara ha i ripieghi della struttura; se li dichiara, le loro coppie (\`optional_pairs\`) si contano come le altre.`,
    "",
    "## Strati",
    "",
    "Ogni hook appartiene a uno strato, e `contract.json` lo dice in `layers`:",
    "",
    `- **cornice** (${layerCount("cornice")} hook): barre, pannelli, menu, righelli, scrivania. È del tema, sempre.`,
    `- **segno** (${layerCount("segno")} hook): ciò che Fub disegna sul contenuto, cioè selezione, cursore, fuoco, ricerca, revisioni, correttore, commenti e maniglie. È del tema, con i colori della carta su cui sta (\`--doc-*\`).`,
    `- **contenuto** (${layerCount("contenuto")} hook): ciò che il file dice. Chi ne ha l'autorità lo dichiara la modalità della superficie, con uno di tre aspetti che la shell mette sulla radice del contenuto: \`look-tema\`, \`look-file\` o \`look-adattato\`.`,
    "",
    "Una regola sul contenuto vale quando il tema lo veste: si scrive sotto `.look-tema`, come `.look-tema .rich-heading`.",
    "",
    "## Struttura minima",
    "",
    "Una cartella installabile contiene `manifest.json`, un foglio per ogni luce dichiarata (`sheet-light.css` e/o `sheet-dark.css`), `skin.css` opzionale e asset locali. Il campione `sample/` è un bundle non-serie completo, generato dagli stessi cancelli.",
    "",
    `Il manifest usa \`engine: ${engine}\`; l'id deve essere un singolo componente di path sicuro e \`asset_namespace\` deve essere esattamente \`theme://<id>/\`. Il tema non dichiara permessi; può dichiarare impostazioni sue (\`settings\`), che la shell mostra nelle Preferenze. Un engine sconosciuto, un id insicuro, un namespace diverso, un manifest malformato o una luce non dichiarata vengono rifiutati. Un tema \`theme-1\` resta installato ma la shell non lo monta: lo segnala con una diagnosi e ricade sul tema di serie.`,
    "",
    "## Limiti e pubblicazione",
    "",
    "- `manifest.json`: massimo 64 KiB.",
    "- Ogni foglio CSS e `skin.css`: massimo 4 MiB.",
    "- Asset: massimo 1.024 file, 64 MiB per file e 256 MiB complessivi.",
    "- Link simbolici, traversal e file non regolari sono rifiutati.",
    "- L'installazione copia in `<config>/themes/.tmp-…` e pubblica con rename atomico; un id già presente è una collisione e non viene sovrascritto.",
    "",
    "## Fallback e anteprima",
    "",
    "La shell valida ogni luce prima di mostrarla nel catalogo. Se un tema installato non è leggibile o non supera il gate client, non viene montato e la resa ricade sul tema di serie con una diagnosi. La preview delle Preferenze è temporanea: non scrive `appearance.theme` né la cache, Annulla o la chiusura del pannello rimontano la selezione precedente, e solo Applica persiste la nuova scelta.",
    "",
    "## Ciclo autore",
    "",
    "Da `apps/client`: eseguire `npm run theme:generate`, poi `npm run theme:verify`; per la resa usare anche `npm run bench:verify` e `npm run bench:a11y`. Non modificare a mano `contract.json`, questo README o i file del campione: sono derivati e la verifica byte-per-byte deve restare verde.",
    "",
  ].join("\n");
  await derived("README.md", guide, "ai conti del contratto", AUTHOR);

  const manifest = {
    id: "org.fub.theme-bench",
    name: "Fub Theme Bench",
    version: "1.0.0",
    engine,
    lights: ["dark", "light"],
    asset_namespace: "theme://org.fub.theme-bench/",
    motion: ["opacity", "transform"],
  };
  await derived("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, `al contratto ${engine}`, SAMPLE);
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
