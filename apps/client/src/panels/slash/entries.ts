// Le voci del menu «/» nel testo: quali, con che nome, in che sezione e in che
// ordine. Il pannello le disegna (`panel.ts`) e la superficie le esegue; qui
// c'è soltanto la regola, pura sui dati.
//
// Le voci vengono dal registro, come quelle del «/» con la selezione e di
// «Comandi ▸»: i comandi offerti in `slash`. Quelli di `fub.formatting` sono
// azioni dell'editor (titoli, liste, blocchi, inserimenti) e vanno nelle loro
// sezioni; gli altri sono comandi del vault. Spento `fub.formatting`, restano
// soltanto i comandi del vault: la shell non tiene un elenco suo di blocchi.
//
// I venti colori non stanno nell'elenco: «Colore ›» li apre in una
// tavolozza, e scrivendo («/blu») si trovano lo stesso, perché restano
// azioni dell'editor che la superficie sa fare.
import type { CommandSpec } from "../../host/contract";
import type { SlashMenuEntry, SlashPicker, SlashPlace, SlashSection } from "../../editors/core/editor-menu";
import { t } from "../../i18n/strings";
import { displayBinding } from "../../ui/commands";
import { ACTION_LOOKS } from "../format-bar";
import { quickCommand } from "./quick";
import { rank, type RankContext } from "./rank";

/// Quante voci recenti stanno in cima, a menu appena aperto.
export const SLASH_RECENT = 5;
/// Quanti risultati, al più, quando si scrive.
export const SLASH_RESULTS = 12;
/// Quanti Suggeriti.
const SUGGESTED = 3;

/// La voce sola dei colori, che apre la tavolozza.
export const COLOR_ENTRY = "slash.color";

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
  "markdown.paragraph": "testo paragrafo normale text paragraph plain",
  "markdown.heading.1": "h1 titolo heading",
  "markdown.heading.2": "h2 titolo heading",
  "markdown.heading.3": "h3 titolo heading",
  "markdown.heading.4": "h4 titolo heading",
  "markdown.heading.5": "h5 titolo heading",
  "markdown.heading.6": "h6 titolo heading",
  "markdown.quote": "citazione quote blockquote",
  "markdown.callout": "riquadro callout avviso admonition box",
  "markdown.list.bullet": "puntato lista bullet list ul",
  "markdown.list.ordered": "numerato lista ordered numbered list ol",
  "markdown.list.task": "todo task attività checkbox casella spunta",
  "markdown.table": "tabella table griglia grid",
  "markdown.rule": "separatore linea divider rule hr",
  "markdown.codeblock": "codice code blocco block",
  "markdown.mathblock": "formula math latex equazione equation",
  "markdown.diagram": "diagramma diagram mermaid grafico schema",
  "markdown.image": "immagine image img foto picture",
  "markdown.link": "link collegamento url",
  "markdown.wikilink": "link nota note wikilink collegamento",
  "markdown.embed": "incorpora embed nota transclusion",
  "markdown.footnote": "nota piè pagina footnote",
  "markdown.property.add": "proprietà property frontmatter yaml metadati",
  "markdown.comment": "commento comment nascosto",
  "markdown.details": "ripiegabile toggle details apri chiudi collapse fisarmonica",
  "markdown.columns": "colonne columns affianca layout fianco side",
  "markdown.toc": "indice sommario toc contents titoli headings outline",
  "markdown.mention": "persona menziona menzione people person mention contatto",
  "markdown.date": "data giorno oggi domani scadenza date day today tomorrow due",
  "markdown.linkcard": "pagina web sito segnalibro scheda anteprima bookmark web page site card",
  "markdown.underline": "sottolineato underline",
  [COLOR_ENTRY]: "colore color colori colors evidenzia fondo testo",
};

/// Le icone delle voci che nella barra non ne hanno una: nel «/» ogni riga
/// ha la sua, nel set `fmt-*` della barra.
const SLASH_ICONS: Readonly<Record<string, string>> = {
  "markdown.paragraph": "fmt-text",
  "markdown.heading.1": "fmt-h1",
  "markdown.heading.2": "fmt-h2",
  "markdown.heading.3": "fmt-h3",
  "markdown.heading.4": "fmt-h4",
  "markdown.heading.5": "fmt-h5",
  "markdown.heading.6": "fmt-h6",
  "markdown.mention": "fmt-person",
  "markdown.date": "fmt-date",
  "markdown.linkcard": "fmt-webpage",
  "markdown.property.add": "fmt-property",
  [COLOR_ENTRY]: "fmt-color",
};

/// La scorciatoia Markdown di una voce, se ne ha una; `null` per un accordo.
export function markdownHint(id: string): string | null {
  return MARKDOWN_HINTS[id] ?? null;
}

/// Le voci che aprono un passo.
const PICKERS: Readonly<Record<string, SlashPicker>> = {
  "markdown.table": "table",
  "markdown.date": "date",
  "markdown.callout": "callout",
  "markdown.wikilink": "note",
  "markdown.embed": "embed",
  "markdown.codeblock": "code",
  "markdown.diagram": "diagram",
  [COLOR_ENTRY]: "color",
};

/// Un colore del testo o del fondo.
export function isColorAction(id: string): boolean {
  return id.startsWith("markdown.color.") || id.startsWith("markdown.background.");
}

/// La sezione di un'azione dell'editor.
function sectionOf(id: string): SlashSection {
  if (id === "markdown.paragraph" || id.startsWith("markdown.heading.") || id === "markdown.quote") return "text";
  if (id.startsWith("markdown.list.")) return "lists";
  if (["markdown.callout", "markdown.details", "markdown.columns", "markdown.table", "markdown.rule"].includes(id)) return "blocks";
  if (["markdown.codeblock", "markdown.mathblock", "markdown.diagram"].includes(id)) return "code";
  if (["markdown.mention", "markdown.date"].includes(id)) return "people";
  if (id === "markdown.underline" || id === COLOR_ENTRY || isColorAction(id)) return "style";
  if (["markdown.toc", "markdown.property.add", "markdown.comment", "markdown.footnote"].includes(id)) return "page";
  return "media";
}

/// Le sezioni nell'ordine delle linguette. Suggeriti e Recenti ci sono solo
/// a menu appena aperto.
export const SECTION_ORDER: readonly SlashSection[] = [
  "suggested", "favorites", "recent", "text", "lists", "blocks", "code", "media", "people", "style", "page", "vault",
];

/// Ciò che il pannello sa dell'uso e del posto.
export interface SlashUse {
  readonly recent: readonly string[];
  readonly favorites: readonly string[];
  readonly chord: (id: string) => string | null;
  readonly today: Date;
  /// Le voci tolte dal menu (`editor.slash.hidden`): restano comandi.
  readonly hidden?: readonly string[];
  /// L'ordine scelto delle sezioni (`editor.slash.sections`); quelle non
  /// dette seguono nel loro ordine, gli id sconosciuti non contano.
  readonly sections?: readonly string[];
}

/// Le sezioni nell'ordine dell'uso: Suggeriti, Preferiti e Recenti in cima,
/// poi quelle scelte, poi le altre.
function sectionOrder(use: SlashUse): readonly SlashSection[] {
  const head = SECTION_ORDER.slice(0, 3);
  const rest = SECTION_ORDER.slice(3);
  const chosen = (use.sections ?? []).filter((id): id is SlashSection => (rest as readonly string[]).includes(id));
  return [...head, ...new Set([...chosen, ...rest])];
}

const NO_USE: SlashUse = { recent: [], favorites: [], chord: () => null, today: new Date() };

/// Le voci di un'apertura: per sezioni a menu appena aperto, al più dodici
/// dal più pertinente scrivendo, i comandi rapidi in cima.
export interface SlashResults {
  readonly entries: readonly SlashMenuEntry[];
  /// Le sezioni che hanno voci, nell'ordine delle linguette.
  readonly sections: readonly SlashSection[];
  /// Si è scritto qualcosa.
  readonly filtering: boolean;
}

function entry(base: Omit<SlashMenuEntry, "params" | "quick" | "span" | "why" | "picker"> & Partial<SlashMenuEntry>): SlashMenuEntry {
  return { picker: PICKERS[base.id] ?? null, params: {}, quick: false, span: null, why: null, ...base };
}

/// Tutte le voci che la superficie sa fare, nell'ordine del registro, coi
/// colori fuori dall'elenco e «Colore ›» al posto loro.
export function slashCatalog(specs: readonly CommandSpec[], has: (id: string) => boolean, use: SlashUse = NO_USE): { listed: SlashMenuEntry[]; colors: SlashMenuEntry[] } {
  const listed: SlashMenuEntry[] = [];
  const colors: SlashMenuEntry[] = [];
  const hidden = new Set(use.hidden ?? []);
  for (const spec of specs) {
    if (hidden.has(spec.id)) continue;
    const action = has(spec.id);
    if (isColorAction(spec.id)) {
      if (action) colors.push(entry({ id: spec.id, label: spec.title, description: spec.description, icon: "fmt-color", hint: null, section: "style", action }));
      continue;
    }
    if (!spec.surfaces.includes("slash")) continue;
    // Un'azione dell'editor che questa superficie non sa fare non c'è: il
    // registro la manderebbe a una superficie che non la conosce.
    if (!action && ACTION_LOOKS[spec.id]) continue;
    const binding = action ? use.chord(spec.id) : spec.keybinding;
    listed.push(entry({
      id: spec.id,
      label: spec.title,
      description: spec.description,
      icon: SLASH_ICONS[spec.id] ?? ACTION_LOOKS[spec.id]?.icon ?? "",
      hint: MARKDOWN_HINTS[spec.id] ?? (binding ? displayBinding(binding) : null),
      section: action ? sectionOf(spec.id) : "vault",
      action,
    }));
  }
  if (colors.length > 0) {
    listed.push(entry({ id: COLOR_ENTRY, label: t("slash.color"), description: t("slash.color.desc"), icon: "fmt-color", hint: null, section: "style", action: true }));
  }
  return { listed, colors };
}

/// Le voci che stanno bene dopo il blocco sopra, nell'ordine in cui le si
/// propone.
function suggestionsFor(place: SlashPlace): readonly string[] {
  if (place.inList || place.above === "task") return ["markdown.list.task", "markdown.list.bullet", "markdown.paragraph"];
  if (place.above === "list") return ["markdown.list.bullet", "markdown.list.task", "markdown.paragraph"];
  if (place.above === "heading") return ["markdown.paragraph", "markdown.list.task", "markdown.list.bullet"];
  return ["markdown.paragraph", "markdown.heading.2", "markdown.list.task"];
}

/// Le voci del «/» per `query`, dove si scrive.
export function slashMenuEntries(
  specs: readonly CommandSpec[],
  query: string,
  has: (id: string) => boolean,
  place: SlashPlace = { line: "empty", above: null, inList: false },
  use: SlashUse = NO_USE,
): SlashResults {
  const { listed, colors } = slashCatalog(specs, has, use);
  const order = sectionOrder(use);
  if (query.trim() === "") {
    const pick = (ids: readonly string[], section: SlashSection, max: number) =>
      ids.map((id) => listed.find((each) => each.id === id)).filter((each): each is SlashMenuEntry => each !== undefined)
        .slice(0, max).map((each) => ({ ...each, section }));
    const favorites = pick(use.favorites, "favorites", SLASH_RESULTS);
    const top = pick(use.recent.filter((id) => !use.favorites.includes(id)), "recent", SLASH_RECENT);
    const suggested = pick(suggestionsFor(place), "suggested", SUGGESTED);
    const entries = [...suggested, ...favorites, ...top, ...order.flatMap((section) => listed.filter((each) => each.section === section))];
    return { entries, sections: order.filter((section) => entries.some((each) => each.section === section)), filtering: false };
  }
  const recentRank = (id: string) => {
    const at = use.recent.indexOf(id);
    return use.favorites.includes(id) ? 1 : at < 0 ? 0 : 1 - at / Math.max(use.recent.length, 1);
  };
  const fitting = new Set(place.inList ? ["markdown.list.task", "markdown.list.bullet", "markdown.list.ordered"] : []);
  const ctx: RankContext = { recency: recentRank, fits: (id) => (fitting.has(id) ? 1 : 0) };
  const ranked = [...listed, ...colors]
    .map((each, index) => {
      const match = rank({ id: each.id, label: each.label, aliases: (ALIASES[each.id] ?? "").split(" ").filter(Boolean) }, query, ctx);
      return { each, index, match };
    })
    .filter((one): one is typeof one & { match: NonNullable<typeof one.match> } => one.match !== null)
    .sort((a, b) => a.match.score - b.match.score || a.index - b.index)
    .slice(0, SLASH_RESULTS)
    .map(({ each, match }) => ({ ...each, span: match.span, why: match.why ?? null }));
  const quick = quickCommand(query, use.today);
  const quickEntry = quick && has(quick.id) && !use.hidden?.includes(quick.id)
    ? [entry({
        id: quick.id,
        label: quick.label,
        description: listed.find((each) => each.id === quick.id)?.description ?? "",
        icon: quick.icon,
        hint: null,
        section: sectionOf(quick.id),
        action: true,
        picker: null,
        params: quick.params,
        quick: true,
      })]
    : [];
  const entries = [...quickEntry, ...ranked].slice(0, SLASH_RESULTS);
  return { entries, sections: [], filtering: true };
}
