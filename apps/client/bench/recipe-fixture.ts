// Le ricette delle scene `settings-recipes-*` e `recipe-dialog-*` (`?recipes=<caso>`,
// piano A1, T13). Sono i dati che l'host darebbe a `recipesList` e a
// `recipeSimulate`, nei casi che il prototipo `PLAN-ui/ricette.html` mostra: la
// sezione piena, vuota, con problemi, col limite delle ricette lette, e la finestra
// di una ricetta con venti passi e una nota fissa.
//
// Il finto di `src/host/fake.ts` tiene già le ricette (l'opzione `recipes`, T10);
// qui si scrivono solo i casi, più i comandi che i passi usano, con il loro titolo e
// i loro parametri: senza il registro, la finestra non direbbe gli argomenti in
// parole (`stepArgsInWords`) e non troverebbe le note fisse (`fixedNotes`).
//
// Soltanto le sue scene lo hanno: senza `?recipes=` il vault non ha ricette, come prima.

import type { CommandReach, CommandSpec, CommandSurface, ParamSpec, RecipeProblem, RecipeStatus, RecipeStepInfo } from "../src/host/contract";
import type { FakeRecipe } from "../src/host/fake";

export type RecipeCase = "vuota" | "piena" | "problemi" | "limite" | "venti";

const CASES: readonly RecipeCase[] = ["vuota", "piena", "problemi", "limite", "venti"];

export function recipeCase(value: string | null): RecipeCase | null {
  return CASES.find((name) => name === value) ?? null;
}

// --- i comandi dei passi --------------------------------------------------------

function param(name: string, title: string, kind: "text" | "document", required: boolean): ParamSpec {
  return {
    name,
    title,
    description: "",
    kind: kind === "document" ? { kind: "document" } : { kind: "text" },
    required,
  };
}

function command(
  id: string,
  title: string,
  description: string,
  params: ParamSpec[],
  reach: CommandReach,
  keybinding: string | null = null,
): CommandSpec {
  return {
    id,
    title,
    description,
    keybinding,
    params,
    scope: { writes: true, reach, reversible: true },
    surfaces: [],
  };
}

export const PROPERTY = "note.property.set";
export const RENAME = "note.rename";
export const FROM_TEMPLATE = "note.from_template";

/// I comandi che la sezione e i passi usano, con i titoli e i parametri del
/// registro. `recipes.new` è il comando che la sezione offre con «Nuova ricetta».
export const RECIPE_COMMANDS: readonly CommandSpec[] = [
  command(
    "recipes.new",
    "Nuova ricetta",
    "Scrive una ricetta d'esempio nella cartella delle ricette e la apre.",
    [param("title", "Titolo", "text", false)],
    "vault",
  ),
  command(
    PROPERTY,
    "Imposta proprietà",
    "Scrive una chiave del frontmatter della nota.",
    [param("doc", "Nota", "document", false), param("key", "Chiave", "text", true), param("value", "Valore", "text", true)],
    "document",
  ),
  command(
    RENAME,
    "Rinomina la nota",
    "Cambia il nome del documento aperto",
    [param("doc", "Nota", "document", false), param("to", "Nuovo nome", "text", true)],
    "document",
    "Mod-Shift-r",
  ),
  command(
    FROM_TEMPLATE,
    "Nuova nota da template",
    "Crea una nota dal template scelto, nella cartella indicata.",
    [param("template", "Template", "text", true), param("name", "Nome", "text", false), param("folder", "Cartella", "text", false)],
    "vault",
  ),
];

export const RECIPE_COMMAND_IDS: ReadonlySet<string> = new Set(RECIPE_COMMANDS.map((spec) => spec.id));

// --- le righe -------------------------------------------------------------------

/// Un passo come lo dà l'host: il titolo e il raggio del comando dal registro. Un
/// comando che il registro non ha è un passo sconosciuto (titolo e raggio `null`).
function step(run: string, args: Record<string, unknown>): RecipeStepInfo {
  const spec = RECIPE_COMMANDS.find((candidate) => candidate.id === run);
  return {
    run,
    title: spec?.title ?? null,
    args,
    writes: spec?.scope.writes ?? false,
    reach: spec?.scope.reach ?? null,
    reversible: spec?.scope.reversible ?? false,
  };
}

/// L'impronta è opaca: qui basta che sia diversa per ogni ricetta, in esadecimale.
function fingerprint(n: number): string {
  return n.toString(16).padStart(4, "0").repeat(16);
}

interface Row {
  id: string;
  title: string;
  description: string;
  doc: string;
  status: RecipeStatus;
  n: number;
  steps?: RecipeStepInfo[];
  problems?: RecipeProblem[];
  keybinding?: string;
  surfaces?: CommandSurface[];
  /// La frase che la prova dà sulla nota aperta, nella bench (`plan.summary`).
  plan: string;
}

function row(fields: Row): FakeRecipe {
  const mounted = fields.status === "adottata";
  return {
    id: fields.id,
    title: fields.title,
    description: fields.description,
    doc: fields.doc,
    status: fields.status,
    fingerprint: fingerprint(fields.n),
    problems: fields.problems ?? [],
    steps: fields.steps ?? [],
    command: `recipe.${fields.id}:run`,
    keybinding: fields.keybinding ?? null,
    surfaces: fields.surfaces ?? [],
    mounted,
    allowed: mounted,
    plan: { summary: fields.plan, docs: [], edits: [] },
  };
}

// --- il caso «piena»: le cinque ricette della prima stesura del prototipo -------

const ARCHIVIA = row({
  id: "archivia-la-nota",
  title: "Archivia la nota",
  description: "Segna la data di oggi e sposta la nota in Archivio.",
  doc: "Recipes/Archivia.md",
  status: "proposta",
  n: 1,
  keybinding: "Mod-Alt-a",
  surfaces: ["slash"],
  steps: [
    step(PROPERTY, { doc: "{{doc}}", key: "archiviata", value: "{{date}}" }),
    step(RENAME, { doc: "{{doc}}", to: "Archivio/{{title}}.md" }),
  ],
  plan: "«archiviata» diventa 2026-08-19 e la nota va in «Archivio/Benvenuto.md».",
});

const RIUNIONE = row({
  id: "riunione",
  title: "Riunione di oggi",
  description: "Crea il verbale di oggi dal template «Riunione», nella cartella Riunioni.",
  doc: "Recipes/Riunione.md",
  status: "adottata",
  n: 2,
  keybinding: "Mod-Alt-r",
  steps: [step(FROM_TEMPLATE, { template: "Riunione", name: "Verbale {{date}}", folder: "Riunioni" })],
  plan: "Crea «Riunioni/Verbale 2026-08-19.md» dal template «Riunione».",
});

const LETTA = row({
  id: "segna-come-letta",
  title: "Segna come letta",
  description: "Mette «letta: sì» nelle proprietà della nota.",
  doc: "Recipes/Letture/Segna come letta.md",
  status: "cambiata",
  n: 3,
  steps: [step(PROPERTY, { doc: "{{doc}}", key: "letta", value: true })],
  plan: "«letta» diventa sì.",
});

const RESOCONTO = row({
  id: "resoconto-gruppo-di-lettura",
  title:
    "Prepara il resoconto settimanale del gruppo di lettura con le note della settimana, la data di oggi e il nome di chi ha condotto l'incontro",
  description: "Una nota nuova dal template «Resoconto», nella cartella Gruppo di lettura/Resoconti/2026.",
  doc: "Recipes/Gruppo di lettura/Resoconto settimanale con la data e il nome di chi conduce.md",
  status: "adottata",
  n: 4,
  steps: [step(FROM_TEMPLATE, { template: "Resoconto", name: "Resoconto {{date}}", folder: "Gruppo di lettura/Resoconti/2026" })],
  plan: "Crea «Gruppo di lettura/Resoconti/2026/Resoconto 2026-08-19.md».",
});

const UNKNOWN_COMMAND: RecipeProblem = {
  code: "comando-sconosciuto",
  field: "steps[2].run",
  line: 14,
  message: "Il comando «note.archive» non c'è in questo Fub. Per spostare una nota si usa «note.rename».",
};

const PLACEHOLDER_PROBLEM: RecipeProblem = {
  code: "segnaposto-sconosciuto",
  field: "steps[2].args.to",
  line: 16,
  message: "«{{titolo}}» non è un segnaposto. Il nome della nota si scrive «{{title}}».",
};

const ATTIVITA = (problems: RecipeProblem[]) =>
  row({
    id: "chiudi-le-attivita",
    title: "Chiudi le attività",
    description: "Spunta le attività aperte e archivia la nota.",
    doc: "Recipes/Chiudi le attività.md",
    status: "problemi",
    n: 5,
    problems,
    plan: "",
  });

// --- il caso «problemi»: ognuna con il suo codice, dove e che cosa non va -----

const SVUOTA = row({
  id: "svuota-il-cestino",
  title: "Svuota il cestino",
  description: "Toglie per sempre le note nel cestino.",
  doc: "Recipes/Svuota.md",
  status: "problemi",
  n: 6,
  problems: [
    {
      code: "non-si-annulla",
      field: "steps[0].run",
      line: 9,
      message: "«Svuota il cestino» non si annulla. Una ricetta usa soltanto comandi che si possono annullare.",
    },
  ],
  plan: "",
});

const RIUNIONE_DOPPIA = (copy: boolean, n: number) =>
  row({
    id: "riunione",
    title: "Riunione di oggi",
    description: "Crea il verbale di oggi dal template «Riunione».",
    doc: copy ? "Recipes/Riunione (copia).md" : "Recipes/Riunione.md",
    status: "problemi",
    n,
    problems: [
      {
        code: "id-ripetuto",
        field: "id",
        line: 3,
        message: copy
          ? "Anche «Recipes/Riunione.md» usa l'id «riunione». Nessuna delle due si accende finché una non cambia id."
          : "Anche «Recipes/Riunione (copia).md» usa l'id «riunione». Nessuna delle due si accende finché una non cambia id.",
      },
    ],
    plan: "",
  });

const LIBRI = row({
  id: "indice-dei-libri",
  title: "Indice dei libri",
  description: "Aggiunge la nota all'indice dei libri letti.",
  doc: "Recipes/Libri.md",
  status: "problemi",
  n: 9,
  problems: [
    {
      code: "versione-futura",
      field: "fub-recipe",
      line: 1,
      message: "È scritta per una versione di Fub più nuova («fub-recipe: 2»). Questa la lascia spenta.",
    },
  ],
  plan: "",
});

// --- il caso «venti»: venti passi, e una nota fissa nell'ultimo ----------------

/// Le diciotto proprietà del prototipo, col valore che ciascuna prende.
const TWENTY_PROPERTIES: readonly (readonly [string, unknown])[] = [
  ["stato", "chiuso"],
  ["chiuso-il", "{{date}}"],
  ["ora", "{{time}}"],
  ["revisore", "Giulia"],
  ["priorità", "bassa"],
  ["fase", "archivio"],
  ["budget-finale", "da contare"],
  ["cliente-avvisato", false],
  ["fatture", "da chiudere"],
  ["materiali", "restituiti"],
  ["lezioni", "da scrivere"],
  ["anno", "{{year}}"],
  ["mese", "{{month}}"],
  ["responsabile", "nessuno"],
  ["visibile", false],
  ["etichetta", "concluso"],
  ["colore", "grigio"],
  ["revisione", 3],
];

const CHIUDI_PROGETTO = row({
  id: "chiudi-il-progetto",
  title: "Chiudi il progetto",
  description: "Segna il progetto come chiuso, lo sposta fra i chiusi e aggiorna l'indice.",
  doc: "Recipes/Progetti/Chiudi il progetto.md",
  status: "proposta",
  n: 7,
  steps: [
    ...TWENTY_PROPERTIES.map(([key, value]) => step(PROPERTY, { doc: "{{doc}}", key, value })),
    step(RENAME, { doc: "{{doc}}", to: "Progetti/Chiusi/{{title}}.md" }),
    step(PROPERTY, { doc: "Progetti/Indice dei progetti.md", key: "ultimo-chiuso", value: "{{title}}" }),
  ],
  plan: "Cambiano 20 proprietà e la nota va in «Progetti/Chiusi/Benvenuto.md».",
});

// --- il caso «limite»: più ricette di quante Fub ne legge ----------------------

/// Gli stati delle righe generate: il prototipo li alterna, e così la sezione
/// mostra quante ricette si guardano.
const REVISION_STATES: readonly RecipeStatus[] = ["adottata", "adottata", "proposta", "adottata", "cambiata"];

/// Il limite di `fub-features` (`recipes.problem.troppe`): Fub legge le prime 200.
const READ_LIMIT = 200;

function manyRecipes(): FakeRecipe[] {
  return Array.from({ length: READ_LIMIT }, (_, index) => {
    const i = index + 1;
    const n = String(i).padStart(3, "0");
    return row({
      id: `revisione-${n}`,
      title: `Ricetta ${n}: segna la revisione`,
      description: "Mette «rivista: oggi» nelle proprietà della nota.",
      doc: `Recipes/Revisioni/${n}.md`,
      status: REVISION_STATES[i % REVISION_STATES.length]!,
      n: 100 + i,
      steps: [step(PROPERTY, { doc: "{{doc}}", key: "rivista", value: "{{date}}" })],
      plan: "",
    });
  });
}

/// Le ricette che il caso mette nel vault, come le darebbe `recipesList`.
export function recipesOf(value: RecipeCase): FakeRecipe[] {
  switch (value) {
    case "vuota":
      return [];
    case "piena":
      return [ARCHIVIA, RIUNIONE, LETTA, RESOCONTO, ATTIVITA([UNKNOWN_COMMAND])];
    case "problemi":
      return [ATTIVITA([UNKNOWN_COMMAND, PLACEHOLDER_PROBLEM]), SVUOTA, RIUNIONE_DOPPIA(false, 10), RIUNIONE_DOPPIA(true, 11), LIBRI];
    case "limite":
      return manyRecipes();
    case "venti":
      return [CHIUDI_PROGETTO];
  }
}

/// I problemi del vault intero (`RecipeList.problems`): il limite delle ricette
/// lette, che l'host dice con la sua frase.
export function recipeTrouble(value: RecipeCase): RecipeProblem[] {
  if (value !== "limite") return [];
  return [
    {
      code: "troppe",
      field: "",
      line: null,
      message: `Il vault ha più di ${READ_LIMIT} ricette: Fub legge soltanto le prime ${READ_LIMIT}, in ordine di percorso.`,
    },
  ];
}
