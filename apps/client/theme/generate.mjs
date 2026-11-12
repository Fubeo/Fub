// **La generazione dei derivati del tema**: le sorgenti entrano, i file escono.
//
//     node apps/client/theme/generate.mjs             riscrive i derivati
//     node apps/client/theme/generate.mjs --verifica  dice se sono quelli che le sorgenti producono
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

/** @type {{ THEME_ICON_LIMITS: { icons: number, paths: number, icon_bytes: number, set_bytes: number } }} */
const mirrored = await vite.ssrLoadModule("/src/rules/mirrored.ts");
const iconLimits = mirrored.THEME_ICON_LIMITS;
/** @type {string[]} I nomi che un tema può ridisegnare: li tiene uguali a `iconNames()` una prova. */
const iconNames = JSON.parse(await readFile(join(AUTHOR, "icon-names.json"), "utf8"));

/// I nomi in righe di al più 100 caratteri, per il blocco del README.
function wrapNames(names) {
  const lines = [];
  let line = "";
  for (const name of names) {
    if (line !== "" && line.length + 1 + name.length > 100) {
      lines.push(line);
      line = "";
    }
    line = line === "" ? name : `${line} ${name}`;
  }
  if (line !== "") lines.push(line);
  return lines;
}

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
    content_gate: anatomy.CONTENT_GATE,
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
    `Dove una superficie offre anche \`file\` o \`adattato\` il cancello lo fa rispettare (\`content_gate\`): una regola che nomina una delle ${anatomy.CONTENT_GATE.hooks.length} classi di contenuto di \`hooks\` fuori da \`.look-tema\` è rifiutata (\`content-look\`), con \`!important\` o senza, e lo stesso un selettore di tipo o \`*\` dentro una cornice di \`scopes\` (${anatomy.CONTENT_GATE.scopes.map((hook) => `\`.${hook}\``).join(", ")}). Vale per i fogli, le pelli e i frammenti CSS.`,
    "",
    "## Struttura minima",
    "",
    "Una cartella installabile contiene `manifest.json`, un foglio per ogni luce dichiarata (`sheet-light.css` e/o `sheet-dark.css`), `skin.css` opzionale e asset locali. Il campione `sample/` è un bundle non-serie completo, generato dagli stessi cancelli.",
    "",
    "## Partire dalla serie",
    "",
    "Con `\"extends\": \"fub.serie\"` nel manifest un tema parte dal tema di serie e porta solo ciò che cambia. I fogli diventano facoltativi: una luce senza foglio usa quello di serie della stessa luce e dello stesso contrasto, anche alto. Un foglio portato dal tema resta completo: passa i ruoli e i contrasti come ogni foglio. La pelle di serie resta montata, e `skin.css` si aggiunge dopo di lei: una regola del tema vince su quella di serie a parità di specificità, e un componente che il tema non nomina resta vestito dalla serie, anche quando arriva con una versione di Fub più nuova. Una `skin.css` assente o vuota è il caso normale. Quando la serie cambia, il tema eredita il cambio. Ereditare da un altro tema non si può.",
    "",
    `Il manifest usa \`engine: ${engine}\`; l'id deve essere un singolo componente di path sicuro e \`asset_namespace\` deve essere esattamente \`theme://<id>/\`. Il tema non dichiara permessi; può dichiarare impostazioni sue (\`settings\`), che la shell mostra nelle Preferenze. Un engine sconosciuto, un id insicuro, un namespace diverso, un manifest malformato o una luce non dichiarata vengono rifiutati. Un tema \`theme-1\` resta installato ma la shell non lo monta: lo segnala con una diagnosi e ricade sul tema di serie.`,
    "",
    "## I caratteri del tema",
    "",
    "Un tema `theme-2` porta i suoi caratteri dichiarandoli nel manifest, non nel CSS: `@font-face` resta vietato nei fogli e nella pelle, perché un `src:` scritto a mano potrebbe chiamare la rete. Ogni voce di `fonts` ha `family`, `file`, `weight` e `style`:",
    "",
    "```json",
    "\"fonts\": [",
    "  { \"family\": \"Carta Serif\", \"file\": \"fonts/carta.woff2\", \"weight\": 400, \"style\": \"normal\" },",
    "  { \"family\": \"Carta Serif\", \"file\": \"fonts/carta-italic.woff2\", \"weight\": 400, \"style\": \"italic\" }",
    "]",
    "```",
    "",
    "- `family`: lettere e cifre ASCII, `-` e spazi singoli, al massimo 64 caratteri; non può essere una famiglia di serie né una parola chiave del CSS (`serif`, `monospace`, …).",
    "- `file`: un asset del tema, `fonts/<nome>.woff2`, cioè `theme://<id>/fonts/<nome>.woff2`. Solo WOFF2: il file deve cominciare con la firma `wOF2`.",
    "- `weight`: da 100 a 900. `style`: `normal` o `italic`. La stessa faccia non si dichiara due volte.",
    "",
    "La shell scrive da sé le regole `@font-face`, coi valori del manifest e il file in un URL `data:`, e la pelle usa la famiglia per nome: `font-family: \"Carta Serif\", var(--font-ui);`. Cambiato tema, i caratteri del tema precedente se ne vanno.",
    "",
    "## Le icone del tema",
    "",
    "Un tema `theme-2` può ridisegnare per nome le icone della shell. Il manifest nomina un set, un file JSON accanto a sé: `\"icons\": \"icons.json\"`. Il file dà a ogni nome i suoi tracciati, cioè i `d` dei `<path>`:",
    "",
    "```json",
    "{",
    "  \"search\": [\"M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z\", \"M21 21l-5-5\"],",
    "  \"folder\": [\"M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"]",
    "}",
    "```",
    "",
    "- Il file: `<nome>.json` accanto al manifest, in minuscolo, mai `manifest.json`.",
    "- Un tracciato porta solo comandi e numeri di un tracciato SVG (`M`, `L`, `C`, `A`, `Z`…, cifre, `.`, `,`, segni e spazi). Niente markup, virgolette, `url(` o riferimenti: il set è rifiutato per intero.",
    "- Il disegno sta nella griglia 24×24; tratto, angoli e colore (`currentColor`) restano quelli della shell e il tema non li cambia.",
    `- Al massimo ${iconLimits.icons} nomi, ${iconLimits.paths} tracciati e ${iconLimits.icon_bytes / 1024} KiB di tracciati per nome, ${iconLimits.set_bytes / 1024} KiB per il file.`,
    "",
    "Il tema non aggiunge icone: ridisegna quelle che ci sono. Un alias ridisegnato vale per il nome a cui punta (`folder` è `vault`). Un nome che oggi nessuno disegna non rifiuta il tema (un modulo può registrarlo più tardi), ma non si vede. Cambiato tema, o annullata l'anteprima, le icone già sullo schermo tornano a quelle del tema scelto.",
    "",
    `I ${iconNames.length} nomi che un tema può ridisegnare (\`theme/author/icon-names.json\`, tenuto uguale a \`iconNames()\` da \`src/ui/icon-names.test.ts\`):`,
    "",
    "```text",
    ...wrapNames(iconNames),
    "```",
    "",
    "## Limiti e pubblicazione",
    "",
    "- `manifest.json`: massimo 64 KiB.",
    "- Ogni foglio CSS e `skin.css`: massimo 4 MiB.",
    "- Asset: massimo 1.024 file, 64 MiB per file e 256 MiB complessivi.",
    "- Caratteri: massimo 8 voci in `fonts`, 2 MiB per file e 6 MiB complessivi.",
    `- Icone: massimo ${iconLimits.icons} nomi, ${iconLimits.paths} tracciati e ${iconLimits.icon_bytes / 1024} KiB per nome, ${iconLimits.set_bytes / 1024} KiB per il file del set.`,
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
