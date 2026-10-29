// Le voci del menu «/» nel testo: quali, con che nome, in che sezione e in che
// ordine. La superficie le disegna dentro il suo completamento e le esegue
// (`editors/text/profiles/markdown/completions.ts`); qui c'è soltanto la
// regola, pura sui dati.
//
// Le voci vengono dal registro, come quelle del «/» con la selezione e di
// «Comandi ▸»: i comandi offerti in `slash`. Quelli di `fub.formatting` sono
// azioni dell'editor (titoli, liste, blocchi, inserimenti) e vanno nelle loro
// sezioni; gli altri sono comandi del vault. Spento `fub.formatting`, restano
// soltanto i comandi del vault: la shell non tiene un elenco suo di blocchi.
import type { CommandSpec } from "../host/contract";
import type { SlashMenuEntry, SlashSection } from "../editors/core/editor-menu";
import { displayBinding } from "../ui/commands";
import { fuzzyScore } from "../ui/palette";
import { ACTION_LOOKS } from "./format-bar";

/// Quante voci recenti stanno in cima, a menu appena aperto.
export const SLASH_RECENT = 5;

/// La scorciatoia Markdown che fa lo stesso: la si impara guardando il menu.
const MARKDOWN_HINTS: Readonly<Record<string, string>> = {
  "markdown.heading.1": "#",
  "markdown.heading.2": "##",
  "markdown.heading.3": "###",
  "markdown.heading.4": "####",
  "markdown.heading.5": "#####",
  "markdown.heading.6": "######",
  "markdown.quote": ">",
  "markdown.callout": "> [!",
  "markdown.list.bullet": "-",
  "markdown.list.ordered": "1.",
  "markdown.list.task": "- [ ]",
  "markdown.table": "|",
  "markdown.rule": "---",
  "markdown.codeblock": "```",
  "markdown.mathblock": "$$",
  "markdown.diagram": "```mermaid",
  "markdown.wikilink": "[[",
  "markdown.embed": "![[",
  "markdown.footnote": "[^",
  "markdown.comment": "%%",
  "markdown.details": "<details>",
  "markdown.columns": "> [!columns]",
  "markdown.toc": "```toc",
  "markdown.mention": "@",
  "markdown.date": "@",
  "markdown.linkcard": "https://",
};

/// Altri nomi con cui si cerca la stessa voce, in tutte e due le lingue: chi
/// scrive «h2», «todo» o «table» trova ciò che vuole senza conoscerne il
/// titolo.
const ALIASES: Readonly<Record<string, string>> = {
  "markdown.paragraph": "testo paragrafo text paragraph p",
  "markdown.heading.1": "h1 titolo heading",
  "markdown.heading.2": "h2 titolo heading",
  "markdown.heading.3": "h3 titolo heading",
  "markdown.heading.4": "h4 titolo heading",
  "markdown.heading.5": "h5 titolo heading",
  "markdown.heading.6": "h6 titolo heading",
  "markdown.quote": "citazione quote blockquote",
  "markdown.callout": "callout avviso nota admonition",
  "markdown.list.bullet": "elenco puntato lista bullet list ul",
  "markdown.list.ordered": "elenco numerato lista ordered numbered list ol",
  "markdown.list.task": "todo task attività checkbox casella",
  "markdown.table": "tabella table",
  "markdown.rule": "separatore linea divider rule hr",
  "markdown.codeblock": "codice code blocco block",
  "markdown.mathblock": "formula math latex equazione",
  "markdown.diagram": "diagramma diagram mermaid grafico",
  "markdown.image": "immagine image img",
  "markdown.link": "link collegamento url",
  "markdown.wikilink": "link nota note wikilink",
  "markdown.embed": "incorpora embed nota transclusion",
  "markdown.footnote": "nota piè pagina footnote",
  "markdown.property.add": "proprietà property frontmatter yaml",
  "markdown.comment": "commento comment",
  "markdown.details": "ripiegabile toggle details apri chiudi collapse fisarmonica",
  "markdown.columns": "colonne columns affianca griglia layout fianco side",
  "markdown.toc": "indice sommario toc table of contents titoli headings outline contents",
  "markdown.mention": "persona menziona menzione people person mention contatto @",
  "markdown.date": "data giorno oggi domani scadenza date day today tomorrow due reminder @",
  "markdown.linkcard": "segnalibro web link collegamento url sito anteprima scheda bookmark web link preview card",
  "markdown.underline": "sottolineato underline",
};

/// La sezione di un'azione dell'editor.
function sectionOf(id: string): SlashSection {
  if (id === "markdown.paragraph" || id.startsWith("markdown.heading.") || id === "markdown.quote" || id === "markdown.callout" || id === "markdown.details") {
    return "text";
  }
  if (id.startsWith("markdown.list.")) return "lists";
  return "insert";
}

const SECTION_ORDER: readonly SlashSection[] = ["recent", "text", "lists", "insert", "vault"];

/// Quanto bene una voce risponde alla query; più basso è meglio, `null` se non
/// risponde. Prima il titolo che comincia così, poi che lo contiene, poi gli
/// altri nomi, poi la sottosequenza, poi la descrizione. Una query con uno
/// spazio vuole parole intere: «titolo 2», non le lettere sparse di una frase
/// che continua dopo un «/» lasciato com'era.
export function slashScore(entry: Pick<SlashMenuEntry, "id" | "label" | "description">, query: string): number | null {
  const q = fold(query.trim());
  if (q === "") return 0;
  const label = fold(entry.label);
  const aliases = fold(ALIASES[entry.id] ?? "");
  const words = fold(entry.id.replace(/[._-]/g, " "));
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  if (aliases.split(" ").some((alias) => alias.startsWith(q))) return 2;
  if (words.includes(q)) return 3;
  if (q.includes(" ")) return null;
  const fuzzy = fuzzyScore(label, q);
  if (fuzzy !== null) return 4 + fuzzy / 100;
  if (fold(entry.description).includes(q)) return 6;
  return null;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// Le voci del «/» per `query`. A query vuota: i recenti in cima, poi le
/// sezioni nell'ordine di sempre, ognuna nell'ordine dei comandi. Con una
/// query: un elenco solo, dal più pertinente.
export function slashMenuEntries(
  specs: readonly CommandSpec[],
  query: string,
  has: (id: string) => boolean,
  recent: readonly string[] = [],
  chord: (id: string) => string | null = () => null,
): SlashMenuEntry[] {
  const entries: SlashMenuEntry[] = [];
  for (const spec of specs) {
    if (!spec.surfaces.includes("slash")) continue;
    const action = has(spec.id);
    // Un'azione dell'editor che questa superficie non sa fare non c'è: il
    // registro la manderebbe a una superficie che non la conosce.
    if (!action && ACTION_LOOKS[spec.id]) continue;
    const binding = action ? chord(spec.id) : spec.keybinding;
    entries.push({
      id: spec.id,
      label: spec.title,
      description: spec.description,
      icon: ACTION_LOOKS[spec.id]?.icon ?? "",
      hint: MARKDOWN_HINTS[spec.id] ?? (binding ? displayBinding(binding) : null),
      section: action ? sectionOf(spec.id) : "vault",
      action,
    });
  }
  if (query.trim() !== "") {
    return entries
      .map((entry, index) => ({ entry, index, score: slashScore(entry, query) }))
      .filter((each): each is { entry: SlashMenuEntry; index: number; score: number } => each.score !== null)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((each) => each.entry);
  }
  const top = recent
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is SlashMenuEntry => entry !== undefined)
    .slice(0, SLASH_RECENT);
  const rest = entries.filter((entry) => !top.includes(entry));
  return [
    ...top.map((entry) => ({ ...entry, section: "recent" as const })),
    ...SECTION_ORDER.flatMap((section) => rest.filter((entry) => entry.section === section)),
  ];
}
