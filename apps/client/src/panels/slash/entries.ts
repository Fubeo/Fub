// Le voci del menu «/» nel testo: quali, con che nome, in che gruppo e in che
// ordine, e quali sono le tessere dei più usati. Il pannello le disegna (`panel.ts`) e la superficie le esegue; qui
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
import { byUse, rank, type RankContext } from "./rank";

/// Quanti risultati, al più, quando si scrive.
export const SLASH_RESULTS = 12;
/// Quante tessere dei più usati, in cima a menu appena aperto.
export const SLASH_TOP = 6;
/// Le tessere di un vault nuovo, prima di ogni uso: Attività, Titolo,
/// Riquadro, Tabella, Base, poi gli altri blocchi che si usano spesso.
/// Scheda viene subito dopo Base: la aggiunge il task che porta la sua voce.
export const SLASH_TOP_DEFAULTS: readonly string[] = [
  "markdown.list.task", "markdown.heading.2", "markdown.callout", "markdown.table", "markdown.base",
  "markdown.list.bullet", "markdown.codeblock", "markdown.quote", "markdown.image", "markdown.rule",
];

/// La voce sola dei colori, che apre la tavolozza.
export const COLOR_ENTRY = "slash.color";

/// «Base» (E12): crea un file `.base` accanto alla nota e la incorpora al
/// posto della riga. Non è un comando del registro ma un'azione della
/// superficie, che la offre (`has`) soltanto dove sa creare il file. Lo
/// stesso id è `BASE_ACTION` in `editors/text/profiles/markdown/slash.ts`.
export const BASE_ENTRY = "markdown.base";

/// «Blocco di un'altra nota» (E14, T30): sceglie un blocco di un'altra nota e
/// lo mette qui come blocco sincronizzato. Come la Base, un'azione della
/// superficie che la offre soltanto dove sa farla. Lo stesso id è
/// `SYNC_BLOCK_ACTION` in `editors/text/profiles/markdown/slash.ts`.
export const SYNC_BLOCK_ENTRY = "markdown.syncblock";

/// «Promemoria» (E10, T36): fa della riga un compito, se non lo è, e gli
/// mette un promemoria `⏰`, detto («/promemoria venerdì 9») o scelto nel
/// riquadro del giorno e dell'ora. Un'azione della superficie, come la Base;
/// lo stesso id è `REMINDER_ACTION` in `editors/text/profiles/markdown/slash.ts`.
export const REMINDER_ENTRY = "markdown.reminder";

/// «Lavagna» (E25, T47): crea un `.canvas` vuoto accanto alla nota, lo
/// incorpora al posto della riga e apre la zona lavagna già attiva.
/// Un'azione della superficie, come la Base; lo stesso id è `CANVAS_ACTION`
/// in `editors/text/profiles/markdown/slash.ts`.
export const CANVAS_ENTRY = "markdown.canvas";

/// Un comando che c'è soltanto con la componente delle Basi accesa.
const BASE_COMMAND = "base.view.add";

/// Un comando che c'è soltanto con la componente della lavagna accesa
/// (`fub.lavagna`): senza, il file nascerebbe e nessuno lo saprebbe mostrare.
const CANVAS_COMMAND = "canvas.create";

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
  // Non ha una forma Markdown sua: si chiama scrivendo il suo nome.
  [BASE_ENTRY]: "/base",
  // L'embed di una lavagna: `![[Nome.canvas]]`.
  [CANVAS_ENTRY]: "![[.canvas",
  [REMINDER_ENTRY]: "⏰",
};

/// Altri nomi con cui si cerca la stessa voce, in tutte e due le lingue: chi
/// scrive «h2», «todo» o «table» trova ciò che vuole senza conoscerne il
/// titolo. Le parole sono separate da spazi; un nome di più parole («da
/// fare») si trova scrivendole tutte, ciascuna come inizio di una parola.
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
  "markdown.list.task": "todo task compito compiti attività checkbox checklist casella spunta da fare",
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
  [BASE_ENTRY]: "base database dati data vista view raccolta collection",
  [CANVAS_ENTRY]: "lavagna canvas whiteboard board zona schede fili penna cards wires pen",
  [SYNC_BLOCK_ENTRY]: "sincronizzato sincronizza synced sync blocco block altra nota other note trasclusione transclusion",
  [REMINDER_ENTRY]: "promemoria ricordami ricorda sveglia avviso notifica reminder remind alarm alert notification",
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
  // La figura delle Basi nell'app (la componente `fub.base`).
  [BASE_ENTRY]: "collection",
  // La figura dei file `.canvas` nella testata della loro scheda.
  [CANVAS_ENTRY]: "dashboard",
  [SYNC_BLOCK_ENTRY]: "search",
  [REMINDER_ENTRY]: "fmt-alarm",
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
  if (["markdown.callout", "markdown.details", "markdown.columns", "markdown.table", BASE_ENTRY, "markdown.rule"].includes(id)) return "blocks";
  if (["markdown.codeblock", "markdown.mathblock", "markdown.diagram"].includes(id)) return "code";
  if (["markdown.mention", "markdown.date", REMINDER_ENTRY].includes(id)) return "people";
  if (id === "markdown.underline" || id === COLOR_ENTRY || isColorAction(id)) return "style";
  if (["markdown.toc", "markdown.property.add", "markdown.comment", "markdown.footnote"].includes(id)) return "page";
  return "media";
}

/// I gruppi delle righe nel loro ordine di serie.
export const SECTION_ORDER: readonly SlashSection[] = [
  "text", "lists", "blocks", "code", "media", "people", "style", "page", "vault",
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
  /// Falso: solo le azioni dell'editor, senza i comandi del vault (l'editor
  /// di una scheda della lavagna, `SlashScope`). Assente: anche i comandi.
  readonly commands?: boolean;
}

/// I gruppi nell'ordine scelto (`editor.slash.sections`), poi gli altri nel
/// loro ordine.
function sectionOrder(use: SlashUse): readonly SlashSection[] {
  const chosen = (use.sections ?? []).filter((id): id is SlashSection => (SECTION_ORDER as readonly string[]).includes(id));
  return [...new Set([...chosen, ...SECTION_ORDER])];
}

// «Oggi» si legge a ogni uso: preso una volta sola al caricamento del modulo
// restava fermo al giorno dell'avvio (e i test con l'orologio finto lo
// vedevano reale).
const NO_USE: SlashUse = {
  recent: [],
  favorites: [],
  chord: () => null,
  get today() {
    return new Date();
  },
};

/// Le voci di un'apertura: a menu appena aperto le tessere dei più usati e
/// le righe per gruppi; scrivendo un elenco solo, al più dodici dal più
/// pertinente, col comando rapido in cima.
export interface SlashResults {
  /// I più usati, come tessere; vuoto scrivendo.
  readonly top: readonly SlashMenuEntry[];
  readonly entries: readonly SlashMenuEntry[];
  /// I gruppi che hanno righe, nell'ordine in cui si vedono; vuoto scrivendo.
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
    // Dove il documento non è quello del riquadro, un comando del vault
    // agirebbe sul documento sbagliato.
    if (!action && use.commands === false) continue;
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
  // La Base subito dopo la Tabella, scritta come le altre voci: la trova
  // anche chi legge il catalogo per i suoi menu. Soltanto se le Basi ci sono
  // (la componente `fub.base` accesa registra i suoi comandi): altrimenti il
  // file nascerebbe e nessuno lo saprebbe mostrare.
  const bases = specs.some((spec) => spec.id === BASE_COMMAND);
  if (bases && has(BASE_ENTRY) && !hidden.has(BASE_ENTRY) && !listed.some((each) => each.id === BASE_ENTRY)) {
    const base = entry({
      id: BASE_ENTRY,
      label: t("slash.base"),
      description: t("slash.base.desc"),
      icon: SLASH_ICONS[BASE_ENTRY]!,
      hint: MARKDOWN_HINTS[BASE_ENTRY]!,
      section: sectionOf(BASE_ENTRY),
      action: true,
    });
    const table = listed.findIndex((each) => each.id === "markdown.table");
    listed.splice(table < 0 ? listed.length : table + 1, 0, base);
  }
  // La lavagna subito dopo l'incorporamento, fra i file: soltanto se la
  // lavagna c'è (la componente `fub.lavagna` accesa registra i suoi comandi).
  const boards = specs.some((spec) => spec.id === CANVAS_COMMAND);
  if (boards && has(CANVAS_ENTRY) && !hidden.has(CANVAS_ENTRY) && !listed.some((each) => each.id === CANVAS_ENTRY)) {
    const board = entry({
      id: CANVAS_ENTRY,
      label: t("slash.canvas"),
      description: t("slash.canvas.desc"),
      icon: SLASH_ICONS[CANVAS_ENTRY]!,
      hint: MARKDOWN_HINTS[CANVAS_ENTRY]!,
      section: sectionOf(CANVAS_ENTRY),
      action: true,
    });
    const embed = listed.findIndex((each) => each.id === "markdown.embed");
    listed.splice(embed < 0 ? listed.length : embed + 1, 0, board);
  }
  // Il blocco di un'altra nota subito dopo la trasclusione, dove la superficie
  // lo sa fare.
  if (has(SYNC_BLOCK_ENTRY) && !hidden.has(SYNC_BLOCK_ENTRY) && !listed.some((each) => each.id === SYNC_BLOCK_ENTRY)) {
    const synced = entry({
      id: SYNC_BLOCK_ENTRY,
      label: t("slash.syncblock"),
      description: t("slash.syncblock.desc"),
      icon: SLASH_ICONS[SYNC_BLOCK_ENTRY]!,
      // Nessuna forma Markdown la fa da sola: si sceglie la nota e il blocco.
      hint: null,
      section: sectionOf(SYNC_BLOCK_ENTRY),
      action: true,
    });
    const embed = listed.findIndex((each) => each.id === "markdown.embed");
    listed.splice(embed < 0 ? listed.length : embed + 1, 0, synced);
  }
  // Il promemoria subito dopo la data, dove la superficie lo sa fare.
  if (has(REMINDER_ENTRY) && !hidden.has(REMINDER_ENTRY) && !listed.some((each) => each.id === REMINDER_ENTRY)) {
    const reminder = entry({
      id: REMINDER_ENTRY,
      label: t("slash.reminder"),
      description: t("slash.reminder.desc"),
      icon: SLASH_ICONS[REMINDER_ENTRY]!,
      hint: MARKDOWN_HINTS[REMINDER_ENTRY]!,
      section: sectionOf(REMINDER_ENTRY),
      action: true,
    });
    const date = listed.findIndex((each) => each.id === "markdown.date");
    listed.splice(date < 0 ? listed.length : date + 1, 0, reminder);
  }
  if (colors.length > 0) {
    listed.push(entry({ id: COLOR_ENTRY, label: t("slash.color"), description: t("slash.color.desc"), icon: "fmt-color", hint: null, section: "style", action: true }));
  }
  return { listed, colors };
}

/// Un blocco che può stare fra le tessere: un'azione dell'editor che mette
/// qualcosa nella nota, non uno stile né un comando del vault.
function blockLike(entry: SlashMenuEntry): boolean {
  return entry.action && entry.section !== "style" && entry.section !== "vault";
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
    const blocks = new Map(listed.filter(blockLike).map((each) => [each.id, each]));
    const top = byUse(new Set(blocks.keys()), use, SLASH_TOP_DEFAULTS, SLASH_TOP).map((id) => blocks.get(id)!);
    const entries = order.flatMap((section) => listed.filter((each) => each.section === section));
    return { top, entries, sections: order.filter((section) => entries.some((each) => each.section === section)), filtering: false };
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
  return { top: [], entries, sections: [], filtering: true };
}
