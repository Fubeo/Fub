// Autocompletamento stile Obsidian: `[[` completa i nomi pagina delle note,
// `#` completa i tag del vault. Le sorgenti dati sono INIETTATE
// (`CompletionSources`): questo modulo non importa `api.ts`, così resta puro e
// testabile in node — è la shell (`panels/document.ts`) a passare la ricerca
// per nome e i tag.
//
// Dal §21.5 la sorgente delle note **cerca** invece di elencare: prende il
// prefisso e restituisce una finestra ordinata per pertinenza, dalla stessa
// porta di ogni altra superficie che accetta del testo e propone delle note
// (0082). Cosa risponda a prefisso vuoto — appena si è scritto `[[` e non altro
// — non lo decide questo file: lo decide chi inietta la sorgente, ed è una
// domanda sulla shell, non sull'editor.
//
// Il riconoscimento del contesto è in funzioni pure sul testo prima del
// cursore (`wikilinkContext`, `tagContext`): sono loro il comportamento da
// presidiare nei test, senza bisogno di un DOM né di una `EditorView`.
//
// Il terzo contesto non viene dal vault: dentro un recinto `mermaid` ancora
// vuoto si offrono i modelli di diagramma (`diagram-templates.ts`, caricato
// solo lì). Anche lui si riconosce su un `EditorState` (`diagramFenceContext`),
// senza vista.
import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  selectedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isTaskLine, mentionDates } from "./dates";
import { isStrictlyInsideCode } from "./parser";
import { liveStrings } from "./strings";
import { catalogLanguage, resolvedLanguage, t } from "../../../../i18n/strings";
import { childName, pageName, resolutionKey } from "../../../../rules/mirrored";
import { TAG_CHARACTER } from "../../../../rules/mirrored";
import { tagInProgress } from "../../../../rules/syntax";
import {
  calloutTypeSource,
  codeLanguageSource,
  dismissSlashMenu,
  slashDismissed,
  slashIcon,
  slashSource,
  type SlashMenuSource,
} from "./slash";

/// Le sorgenti dati dei completamenti.
///
/// `cercaNote` prende ciò che si è scritto dopo `[[` e restituisce i DocId che
/// combaciano, **già in ordine di pertinenza**; `listTags` i tag con la
/// frequenza (mirror di `TagCount`).
///
/// Prendeva un argomento in meno, e la differenza è tutta la §21.5: era
/// `listNotes()`, cioè l'elenco intero del vault, e il filtro lo faceva
/// CodeMirror. Adesso la domanda porta con sé il prefisso e la risposta è una
/// finestra — la [0082](../../../docs/decisions/0182-provider-e-porte-generiche.md),
/// che su questa superficie ha dovuto decidere due volte: la porta unica come
/// per tutte, e il fatto che qui il budget non è per invocazione ma **per
/// battuta**.
///
/// Che l'ordine sia già quello giusto è una proprietà, non un dettaglio: chi
/// disegna non deve riordinare (vedi `wikilinkSource`).
export interface CompletionSources {
  searchNotes(prefix: string): Promise<string[]>;
  listTags(): Promise<{ name: string; count: number }[]>;
  /// I titoli della nota che `page` nomina come sta scritto nel link; `page`
  /// vuota è la nota stessa (`[[#…`). Assente, `[[Nota#` non completa.
  headingsOf?(page: string): Promise<readonly HeadingOption[]>;
  /// I titoli del vault che contengono `text`, per `[[##…`, già in ordine.
  searchHeadings?(text: string): Promise<readonly VaultHeading[]>;
  /// I blocchi con un id della nota che `page` nomina, per `[[Nota#^`; `page`
  /// vuota è la nota stessa. Assente, `#^` non completa.
  blocksOf?(page: string): Promise<readonly BlockOption[]>;
  /// Il menu «/» nel testo (`slash.ts`). Assente, il «/» è testo.
  slash?: SlashMenuSource;
  /// Le persone per `@` (K5). Assente, `@` non propone persone.
  people?: PeopleSource;
  /// Le date per `@` (K6). Assente, `@` non propone date.
  dates?: DateSource;
}

/// Le date come le vede `@`: dove sta la giornaliera di un giorno
/// (`daily.folder` e `daily.format` di `fub.template`, `state/dates.ts`) e
/// quando comincia la settimana.
export interface DateSource {
  /// Il path della giornaliera di `iso` (`YYYY-MM-DD`), senza estensione.
  dailyPath(iso: string): string;
  /// Il primo giorno della settimana: 1 = lunedì … 7 = domenica.
  firstDay(): number;
  /// Oggi; assente, l'orologio.
  today?(): Date;
}

/// Le persone come le vede `@`: note di una cartella del vault
/// (`files.people-folder`, `state/people.ts`).
export interface PeopleSource {
  /// La cartella, senza barre ai bordi; vuota, `@` non propone persone.
  folder(): string;
  /// Le persone il cui nome combacia con `text`, già in ordine.
  search(text: string): Promise<string[]>;
  /// Crea la nota della persona nella cartella.
  create(name: string): Promise<string | null>;
}

/// Un blocco da proporre: il suo id e l'inizio del suo testo.
export interface BlockOption {
  readonly id: string;
  readonly text: string;
}

/// Un titolo da proporre: il testo e il livello.
export interface HeadingOption {
  readonly text: string;
  readonly level: number;
}

/// Un titolo del vault, con la nota che lo porta.
export interface VaultHeading extends HeadingOption {
  readonly doc: string;
}

/// Un contesto di completamento riconosciuto nel testo prima del cursore:
/// `from` è l'offset (nel testo passato) da cui il completamento sostituisce,
/// `query` è ciò che l'utente ha già digitato lì.
export interface ContextMatch {
  from: number;
  query: string;
}

/// C'è un wikilink `[[` aperto (senza `]]` di chiusura in mezzo) prima del
/// cursore? Si guarda l'ULTIMO `[[`: così `vedi [[Alpha]] e [[Be` è attivo su
/// `Be`, non sul legame già chiuso. Un wikilink non attraversa le righe: un
/// a-capo dopo il `[[` lo spegne.
export function wikilinkContext(before: string): ContextMatch | null {
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const query = before.slice(open + 2);
  if (query.includes("]]") || query.includes("\n")) return null;
  const separator = query.search(/[|#]/);
  return { from: open + 2, query: separator === -1 ? query : query.slice(0, separator) };
}

/// `[[Nota#tit` o `[[#tit`: il titolo che si sta scrivendo dentro un wikilink
/// aperto. `page` è la nota come sta scritta (vuota per la nota stessa),
/// `from` è dove comincia il titolo, subito dopo il `#`. Non vale per
/// `[[##…` (titoli del vault), né per un blocco `#^` o dopo l'alias `|`.
export function headingContext(before: string): (ContextMatch & { page: string }) | null {
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const inner = before.slice(open + 2);
  if (inner.includes("]]") || inner.includes("\n") || inner.includes("|") || inner.startsWith("##")) return null;
  const hash = inner.indexOf("#");
  if (hash === -1) return null;
  const query = inner.slice(hash + 1);
  if (query.startsWith("^") || query.includes("#")) return null;
  return { from: open + 2 + hash + 1, query, page: inner.slice(0, hash) };
}

/// `[[Nota#^id` o `[[#^id`: l'id di blocco che si sta scrivendo dentro un
/// wikilink aperto. `from` è subito dopo il `^`.
export function blockContext(before: string): (ContextMatch & { page: string }) | null {
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const inner = before.slice(open + 2);
  if (inner.includes("]]") || inner.includes("\n") || inner.includes("|") || inner.startsWith("##")) return null;
  const hash = inner.indexOf("#^");
  if (hash === -1) return null;
  const query = inner.slice(hash + 2);
  if (!/^[A-Za-z0-9-]*$/u.test(query)) return null;
  return { from: open + 2 + hash + 2, query, page: inner.slice(0, hash) };
}

/// Quanti caratteri del testo di un blocco accompagnano il suo id.
const BLOCK_TEXT = 60;
const BLOCK_ID_AT_END = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

/// Gli id di blocco di una nota Markdown, nell'ordine in cui compaiono: un
/// `^id` in fondo a una riga, o su una riga sua, che allora nomina il blocco
/// sopra. Il frontmatter e i blocchi di codice non ne hanno.
export function blockIds(markdown: string): BlockOption[] {
  const lines = markdown.split(/\r?\n/u);
  const found: BlockOption[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
    if (close !== -1) start = close + 1;
  }
  let previous = "";
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]!;
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const match = BLOCK_ID_AT_END.exec(line);
    if (match && !seen.has(match[1]!)) {
      seen.add(match[1]!);
      const own = line.slice(0, match.index).trim();
      const text = (own === "" ? previous : own).replace(/^(?:[>\s]*(?:[-*+]|\d+[.)])?\s*(?:\[.\]\s*)?)/u, "");
      found.push({ id: match[1]!, text: text.length > BLOCK_TEXT ? `${text.slice(0, BLOCK_TEXT - 1)}…` : text });
    }
    if (line.trim() !== "") previous = line.trim();
  }
  return found;
}

/// `[[##testo`: un titolo cercato in tutto il vault. `from` è l'inizio di
/// `##`, che il completamento sostituisce con `Nota#Titolo`.
export function vaultHeadingContext(before: string): ContextMatch | null {
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const inner = before.slice(open + 2);
  if (!inner.startsWith("##") || inner.includes("]]") || inner.includes("\n") || inner.includes("|")) return null;
  return { from: open + 2, query: inner.slice(2) };
}

/// Un titolo come lo scrive un link: senza i caratteri che il wikilink usa
/// per sé, che lo chiuderebbero o ne aprirebbero un altro campo.
export function headingLinkText(text: string): string {
  return text.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim();
}

/// Il cursore è su un token `#...` a inizio parola?
///
/// Le regole non sono di questo file: sono quelle di `tagInCorso`, cioè le
/// stesse classi di caratteri con cui la vivi preview decora e con cui il
/// contratto indicizza (§4.4). Erano scritte qui una seconda volta, e diverse:
/// il carattere prima del `#` doveva non essere `[\p{L}\p{N}_#]`, mentre la
/// regola vera è «non alfanumerico» — quindi su `vedi.#tag` il popup si apriva
/// e la decorazione non compariva, e su `_#tag` succedeva l'inverso.
export function tagContext(before: string): ContextMatch | null {
  const m = tagInProgress(before);
  return m && { from: m.from, query: m.query };
}

/// Il testo da inserire completando una nota: il nome (o il path, per gli
/// omonimi) più il `]]` di chiusura — ma SOLO se non è già lì subito dopo il
/// cursore, altrimenti si raddoppierebbe.
export function wikilinkInsertText(name: string, textAfterCursor: string): string {
  return textAfterCursor.startsWith("]]") ? name : `${name}]]`;
}

/// Il path di un DocId senza l'ultima estensione (`Progetti/Alpha.md` →
/// `Progetti/Alpha`): la forma univoca di un wikilink quando il solo nome
/// pagina è ambiguo.
function pathWithoutExtension(doc: string): string {
  const base = childName(doc);
  return doc.slice(0, doc.length - base.length) + pageName(doc);
}

/// Le opzioni per il completamento wikilink. `label` = nome pagina, `detail` =
/// path (per orientarsi tra cartelle). Per i nomi pagina ambigui — stesso nome
/// in cartelle diverse, confrontati con la `resolutionKey`, cioè esattamente
/// come li confronta chi risolve i link — si inserisce il path senza
/// estensione, che è la forma univoca.
///
/// L'ambiguità si guarda **dentro `docs`**, che dal §21.5 non è più il vault
/// intero ma la finestra dei più pertinenti. Non è un indebolimento della
/// regola quanto sembra: due note omonime combaciano *identicamente* col
/// prefisso che le nomina — stesso nome, stesso campo, stesso punteggio —
/// quindi arrivano vicine nell'ordine, e una finestra che ne contenga una sola
/// è una finestra tagliata esattamente fra due risultati a pari merito. Resta
/// possibile, e il verso dello sbaglio è quello buono: si inserisce il nome
/// nudo, cioè ciò che l'utente avrebbe scritto a mano, e a decidere quale nota
/// sia resta chi risolve i link (`resolutionKey`) — non questo file.
///
/// I `docs` arrivano **ordinati** da chi li ha cercati, e questa funzione
/// preserva l'ordine: è un `map`, non un `sort`.
export function noteCompletions(
  docs: string[],
  alreadyClosed: boolean,
  preservePath = false,
): Completion[] {
  const seen = new Map<string, number>();
  for (const doc of docs) {
    const key = resolutionKey(pageName(doc));
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return docs.map((doc) => {
    const name = pageName(doc);
    const ambiguous = (seen.get(resolutionKey(name)) ?? 0) > 1;
    const insert = preservePath || ambiguous ? pathWithoutExtension(doc) : name;
    return {
      label: name,
      detail: doc,
      apply: wikilinkInsertText(insert, alreadyClosed ? "]]" : ""),
      type: "text",
    };
  });
}

/// Le opzioni per il completamento tag: `label` = `#nome` (il `#` fa parte del
/// token sostituito, quindi anche del match), `detail` = quante note lo
/// portano. Le gerarchie arrivano già intere dal kernel (`area/job`).
export function tagCompletions(tags: { name: string; count: number }[]): Completion[] {
  return tags.map((t) => ({
    label: `#${t.name}`,
    detail: String(t.count),
    type: "keyword",
  }));
}

/// La sorgente CM6 dei wikilink. Esportata (oltre che composta in
/// `markdownCompletions`) perché è testabile headless con un
/// `CompletionContext` costruito su un `EditorState`.
export function wikilinkSource(searchNotes: CompletionSources["searchNotes"]): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const match = wikilinkContext(before);
    if (!match) return null;
    // Dopo `#` si scrive un titolo, non il nome della nota: lo completano le
    // sorgenti dei titoli.
    if (headingContext(before) || vaultHeadingContext(before) || blockContext(before)) return null;
    const cursorOffset = ctx.pos - line.from;
    const afterCursor = line.text.slice(cursorOffset);
    const suffix = afterCursor.search(/(?:[|#]|\]\])/);
    const to = suffix === -1 ? line.to : ctx.pos + suffix;
    const after = line.text.slice(to - line.from);
    const docs = await searchNotes(match.query);
    return {
      from: line.from + match.from,
      // `to` è già una posizione del documento: sommarci di nuovo l'inizio
      // della riga la portava oltre la fine fuori dalla prima riga, e Invio
      // falliva in silenzio lasciando il posto all'a capo.
      to,
      options: noteCompletions(
        docs,
        after.startsWith("]]") || after.startsWith("|") || after.startsWith("#"),
        match.query.includes("/"),
      ),
      // **Due righe che erano una, e sono la §21.5.**
      //
      // Prima c'era `validFor: /^[^\[\]\n]*$/`, e non era un dettaglio: era la
      // riga che rendeva sostenibile chiedere l'elenco intero del vault. Con
      // lei la sorgente partiva **una volta** per `[[` e CodeMirror rifiltrava
      // da sé mentre si digitava. Adesso il filtro lo fa il kernel, sul
      // prefisso, quindi la sorgente deve ripartire a ogni battuta: `validFor`
      // sparisce, e ciò che prima non costava niente adesso costa un giro —
      // misurato, non stimato (banco `una_ricerca.rs`, fase 5).
      //
      // E `filter: false`, che è la stessa decisione vista dall'altro lato:
      // l'ordine di queste opzioni è la **rilevanza** calcolata da chi ha
      // l'indice. Senza, il fuzzy di CodeMirror riordinerebbe (e scarterebbe)
      // secondo un criterio suo, e le due ricerche dell'app tornerebbero due —
      // che è precisamente ciò che la 0082 esiste per impedire.
      filter: false,
    };
  };
}

/// Fin dove arriva il campo che si completa: fino a `|`, `#` o `]]` dopo il
/// cursore, o alla fine della riga. `closed` dice se il link è già chiuso.
function fieldEnd(ctx: CompletionContext): { to: number; closed: boolean } {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const afterCursor = line.text.slice(ctx.pos - line.from);
  const suffix = afterCursor.search(/(?:[|#]|\]\])/);
  const to = suffix === -1 ? line.to : ctx.pos + suffix;
  const after = line.text.slice(to - line.from);
  return { to, closed: after.startsWith("]]") || after.startsWith("|") };
}

/// La sorgente dei titoli di una nota, dopo `[[Nota#` o `[[#`.
export function headingSource(headingsOf: NonNullable<CompletionSources["headingsOf"]>): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = headingContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const { to, closed } = fieldEnd(ctx);
    const headings = await headingsOf(match.page);
    return {
      from: line.from + match.from,
      to,
      options: headings.map((heading) => {
        const text = headingLinkText(heading.text);
        return { label: text, detail: `H${heading.level}`, apply: closed ? text : `${text}]]`, type: "text" };
      }),
      // Qui i titoli sono pochi e tutti in mano: il filtro può farlo
      // CodeMirror mentre si scrive, senza un altro giro.
      validFor: /^[^[\]|#^\n]*$/,
    };
  };
}

/// La sorgente dei blocchi di una nota, dopo `[[Nota#^` o `[[#^`.
export function blockSource(blocksOf: NonNullable<CompletionSources["blocksOf"]>): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = blockContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const { to, closed } = fieldEnd(ctx);
    const blocks = await blocksOf(match.page);
    return {
      from: line.from + match.from,
      to,
      options: blocks.map((block) => ({
        label: block.id,
        detail: block.text,
        apply: closed ? block.id : `${block.id}]]`,
        type: "text",
      })),
      validFor: /^[A-Za-z0-9-]*$/u,
    };
  };
}

/// La sorgente dei titoli del vault, dopo `[[##`: ogni opzione scrive
/// `Nota#Titolo`, con il percorso dove due note hanno lo stesso nome.
export function vaultHeadingSource(searchHeadings: NonNullable<CompletionSources["searchHeadings"]>): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = vaultHeadingContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const { to, closed } = fieldEnd(ctx);
    const headings = match.query.trim() === "" ? [] : await searchHeadings(match.query);
    const docsByName = new Map<string, Set<string>>();
    for (const heading of headings) {
      const key = resolutionKey(pageName(heading.doc));
      docsByName.set(key, (docsByName.get(key) ?? new Set()).add(heading.doc));
    }
    return {
      from: line.from + match.from,
      to,
      options: headings.map((heading) => {
        const name = pageName(heading.doc);
        const ambiguous = (docsByName.get(resolutionKey(name))?.size ?? 0) > 1;
        const target = `${ambiguous ? pathWithoutExtension(heading.doc) : name}#${headingLinkText(heading.text)}`;
        return { label: headingLinkText(heading.text), detail: heading.doc, apply: closed ? target : `${target}]]`, type: "text" };
      }),
      // Come per le note: l'ordine è di chi cerca, e si ricerca a ogni battuta.
      filter: false,
    };
  };
}

/// Dove finisce il tag che il cursore attraversa: i caratteri da tag dopo
/// il cursore fanno parte del token sostituito.
function tagEnd(text: string, offset: number): number {
  let to = offset;
  while (to < text.length) {
    const character = String.fromCodePoint(text.codePointAt(to)!);
    if (!TAG_CHARACTER.test(character)) break;
    to += character.length;
  }
  return to;
}

/// Tab nel completamento dei tag completa un segmento alla volta: su `#pro`
/// con `#progetti/fub/alfa` scelto mette `#progetti/` e il popup resta,
/// filtrato sui figli. L'ultimo segmento si accetta intero. Restituisce il
/// testo da scrivere al posto del token, o `null` se non resta un segmento.
export function tagSegment(typed: string, label: string): string | null {
  const start = label.toLowerCase().startsWith(typed.toLowerCase()) ? typed.length : 1;
  const slash = label.indexOf("/", start);
  return slash < 0 || slash === label.length - 1 ? null : label.slice(0, slash + 1);
}

/// Il tasto: agisce solo col popup dei tag aperto (le altre sorgenti non
/// hanno etichette `#` di tipo `keyword`); altrove Tab resta il rientro.
export function completeTagSegment(view: EditorView): boolean {
  if (completionStatus(view.state) !== "active") return false;
  const option = selectedCompletion(view.state);
  if (!option || option.type !== "keyword" || !option.label.startsWith("#")) return false;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const match = tagContext(view.state.sliceDoc(line.from, head));
  if (!match) return false;
  const from = line.from + match.from;
  const segment = tagSegment(view.state.sliceDoc(from, head), option.label);
  if (segment === null) {
    acceptCompletion(view);
    return true;
  }
  view.dispatch({
    changes: { from, to: line.from + tagEnd(line.text, head - line.from), insert: segment },
    selection: { anchor: from + segment.length },
    userEvent: "input.type",
  });
  return true;
}

/// La sorgente CM6 dei tag; come `wikilinkSource`, esportata per i test.
export function tagSource(listTags: CompletionSources["listTags"]): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = tagContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const tags = await listTags();
    return {
      from: line.from + match.from,
      to: line.from + tagEnd(line.text, ctx.pos - line.from),
      options: tagCompletions(tags),
      // La stessa classe di `tagInCorso`, presa da lì: un `validFor` più
      // stretto chiuderebbe il popup su un carattere che il tag accetta.
      validFor: new RegExp(`^#${TAG_CHARACTER.source}*$`, "u"),
    };
  };
}

/// Il corpo ancora vuoto di un recinto `mermaid`, col cursore dentro: la
/// parola che si sta scrivendo (`query`, da `from` a `to`, fine riga), il
/// rientro della riga (`indent`: spazi e `>` di una lista o di una citazione)
/// e la chiusura da aggiungere dopo il modello se il recinto non ce l'ha.
export interface DiagramFenceMatch {
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly indent: string;
  readonly close: string;
}

/// Il cursore sta nel corpo di un recinto `mermaid` che non ha ancora niente
/// oltre alla parola che si scrive? «Niente» ammette righe vuote e commenti
/// `%%`, come la direttiva `%% stile:` messa prima. Un corpo con già un
/// diagramma non è un contesto: un modello lo raddoppierebbe. Né lo è la riga
/// d'apertura, dove si scrive l'info, né la chiusura.
export function diagramFenceContext(state: EditorState, pos: number): DiagramFenceMatch | null {
  let node: SyntaxNode | null = syntaxTree(state).resolve(pos, -1);
  while (node && node.name !== "FencedCode") node = node.parent;
  if (!node) return null;
  const info = node.getChild("CodeInfo");
  if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== "mermaid") return null;
  const marks = node.getChildren("CodeMark");
  const opening = state.doc.lineAt(node.from);
  const closing = marks.length >= 2 ? state.doc.lineAt(marks[marks.length - 1]!.from) : null;
  if (pos <= opening.to || (closing && pos >= closing.from)) return null;
  const line = state.doc.lineAt(pos);
  const typed = /^([\s>]*)([\p{L}\p{N}_-]*)$/u.exec(state.sliceDoc(line.from, pos));
  if (!typed || state.sliceDoc(pos, line.to).trim() !== "") return null;
  const bodyEnd = closing ? closing.from - 1 : node.to;
  const others = [
    line.from > opening.to + 1 ? state.sliceDoc(opening.to + 1, line.from - 1) : "",
    line.to < bodyEnd ? state.sliceDoc(line.to + 1, bodyEnd) : "",
  ].join("\n");
  const empty = others.split("\n").every((row) => {
    const content = row.replace(/^[\s>]*/, "");
    return content === "" || content.startsWith("%%");
  });
  if (!empty) return null;
  const indent = typed[1]!;
  const mark = marks[0]!;
  return {
    from: line.from + indent.length,
    to: line.to,
    query: typed[2]!,
    indent,
    close: closing ? "" : `\n${indent}${state.sliceDoc(mark.from, mark.to)}`,
  };
}

type DiagramTemplates = typeof import("./diagram-templates");
let templates: Promise<DiagramTemplates> | undefined;

/// La sorgente CM6 dei modelli di diagramma. Si apre scrivendo la prima
/// parola del corpo, o a richiesta (Ctrl+Spazio) su una riga vuota. Il filtro
/// è `matchTemplates` e non il fuzzy di CodeMirror, che guarderebbe soltanto
/// l'etichetta: `torta` deve trovare il grafico a torta anche in inglese, e
/// `seq` la sequenza anche in italiano. `today` è iniettabile per i test.
///
/// Il riconoscimento del recinto è sincrono; i corpi dei modelli arrivano con
/// un `import()` al primo recinto, così non pesano sul chunk del documento.
export function diagramTemplateSource(today: () => Date = () => new Date()): CompletionSource {
  return (ctx: CompletionContext): Promise<CompletionResult | null> | null => {
    const match = diagramFenceContext(ctx.state, ctx.pos);
    if (!match || (match.query === "" && !ctx.explicit)) return null;
    templates ??= import("./diagram-templates").catch((error: unknown) => {
      templates = undefined;
      throw error;
    });
    return templates.then(({ matchTemplates, templateText }) => {
      const language = catalogLanguage(resolvedLanguage());
      const section = t("mermaid.template.section");
      const day = today();
      const options = matchTemplates(match.query, (template) => t(template.name)).map((template): Completion => ({
        label: t(template.name),
        detail: template.keyword,
        info: t(template.description),
        type: "text",
        section,
        apply: templateText(template, language, match.indent, day) + match.close,
      }));
      if (options.length === 0) return null;
      return { from: match.from, to: match.to, options, filter: false };
    });
  };
}

/// `:nome` prima del cursore (H14): i due punti a inizio riga o dopo uno
/// spazio o una parentesi, poi almeno due caratteri di nome. Dopo una lettera
/// o una cifra non vale, così `ore 10:30`, `http:` e `chiave:valore` restano
/// testo.
export function emojiContext(before: string): ContextMatch | null {
  const match = /(?:^|[\s([{"'«])(:([\p{L}\p{N}_+'-]{2,}))$/u.exec(before);
  if (!match) return null;
  return { from: before.length - match[1]!.length, query: match[2]! };
}

type EmojiData = typeof import("./emoji-data");
let emojiData: Promise<EmojiData> | undefined;

/// Il punteggio di un nome per `query`: 0 se comincia così, 1 se una sua
/// parola comincia così, -1 se non c'entra.
function emojiScore(names: readonly string[], query: string): number {
  let best = -1;
  for (const name of names) {
    if (name.startsWith(query)) return 0;
    if (name.split(/[_']/).some((part) => part.startsWith(query))) best = 1;
  }
  return best;
}

/// Le emoji che rispondono a `query`, prima i nomi della lingua dell'app,
/// poi gli altri; a pari merito, l'ordine dei dati.
export function matchEmoji(
  entries: EmojiData["EMOJI"],
  query: string,
  language: "it" | "en",
): { char: string; name: string }[] {
  const q = query.toLowerCase();
  const scored: { char: string; name: string; score: number; at: number }[] = [];
  entries.forEach((entry, at) => {
    const own = language === "it" ? entry.it : entry.en;
    const other = language === "it" ? entry.en : entry.it;
    const a = emojiScore(own, q);
    const b = emojiScore(other, q);
    if (a < 0 && b < 0) return;
    const score = a >= 0 ? a : 2 + b;
    // Il nome mostrato è quello che ha risposto, così si vede perché c'è.
    const hit = (a >= 0 ? own : other).find((name) => name.startsWith(q) || name.split(/[_']/).some((part) => part.startsWith(q)));
    scored.push({ char: entry.char, name: hit ?? own[0] ?? "", score, at });
  });
  scored.sort((x, y) => x.score - y.score || x.at - y.at);
  return scored.slice(0, 40).map(({ char, name }) => ({ char, name }));
}

/// La sorgente CM6 delle emoji. I dati arrivano con un `import()` alla prima
/// richiesta, come i modelli di diagramma; il filtro è `matchEmoji`, che
/// cerca nelle due lingue.
export function emojiSource(): CompletionSource {
  return (ctx: CompletionContext): Promise<CompletionResult | null> | null => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = emojiContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    emojiData ??= import("./emoji-data").catch((error: unknown) => {
      emojiData = undefined;
      throw error;
    });
    return emojiData.then(({ EMOJI }) => {
      const language = catalogLanguage(resolvedLanguage()) === "it" ? "it" : "en";
      const section = liveStrings.t("emoji.section");
      const options = matchEmoji(EMOJI, match.query, language).map(({ char, name }): Completion => ({
        label: `${char} ${name}`,
        displayLabel: `${char}  ${name.replace(/_/g, " ")}`,
        type: "text",
        section,
        apply: char,
      }));
      if (options.length === 0) return null;
      // Un `:` di chiusura già scritto (`:fuoco:`) va via con il nome.
      const to = ctx.state.sliceDoc(ctx.pos, ctx.pos + 1) === ":" ? ctx.pos + 1 : ctx.pos;
      return { from: line.from + match.from, to, options, filter: false };
    });
  };
}

/// `@nome` all'inizio di una parola: chi si sta nominando (K5). `from` è la
/// `@`, che il completamento sostituisce; `query` sono fino a quattro parole
/// separate da uno spazio. Uno spazio in fondo, o una `@` attaccata a una
/// parola (`mario@posta.it`), non è una menzione.
export function mentionContext(before: string): ContextMatch | null {
  const match = /(?:^|[\s([{"'«])(@((?:[\p{L}\p{N}_.'-]+(?: [\p{L}\p{N}_.'-]+){0,3})?))$/u.exec(before);
  if (!match) return null;
  return { from: before.length - match[1]!.length, query: match[2]! };
}

/// Il nome di una persona nuova, come diventa il nome della sua nota: senza i
/// segni che un wikilink o un path non reggono.
export function personName(query: string): string {
  return query.replace(/[[\]|#^/\\:]/g, "").replace(/\s+/g, " ").trim();
}

/// Il wikilink a una persona: il path senza estensione, così resta univoco,
/// e il nome come testo, così si legge il nome e non la cartella.
export function personLink(path: string, name: string): string {
  return `[[${path}|${name}]]`;
}

/// Le opzioni di `@` per le persone: quelle trovate, nell'ordine dell'indice,
/// e in fondo «Nuova persona» se nessuna si chiama come ciò che si è scritto.
export function personCompletions(docs: readonly string[], query: string, people: PeopleSource): Completion[] {
  const section = liveStrings.t("mention.people");
  const options: Completion[] = docs.map((doc) => {
    const name = pageName(doc);
    return { label: `@${name}`, displayLabel: name, detail: doc, type: "text", section, apply: personLink(pathWithoutExtension(doc), name) };
  });
  const name = personName(query);
  const folder = people.folder();
  if (name && folder && !docs.some((doc) => resolutionKey(pageName(doc)) === resolutionKey(name))) {
    options.push({
      label: `@${name}`,
      displayLabel: liveStrings.t("mention.new_person", { name }),
      type: "text",
      section,
      apply: (view, _completion, from, to) => {
        const insert = personLink(`${folder}/${name}`, name);
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.complete" });
        void people.create(name).catch(() => {});
      },
    });
  }
  return options;
}

/// Le opzioni di `@` per le date: il link alla giornaliera di ogni giorno
/// riconosciuto, col giorno scritto per esteso come testo; in un compito,
/// anche la scadenza `📅 YYYY-MM-DD`.
export function dateCompletions(query: string, dates: DateSource, task: boolean): Completion[] {
  const language = catalogLanguage(resolvedLanguage()) === "it" ? "it" : "en";
  const found = mentionDates(query, dates.today?.() ?? new Date(), dates.firstDay(), language);
  const long = new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const short = new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric" });
  const section = liveStrings.t("mention.dates");
  const due = liveStrings.t("mention.due");
  return found.flatMap(({ iso, said }): Completion[] => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    const date = new Date(y, m - 1, d);
    const text = short.format(date);
    const link: Completion = { label: `@${said}`, displayLabel: long.format(date), detail: said, type: "text", section, apply: personLink(dates.dailyPath(iso), text) };
    return task ? [link, { label: `@${said} 📅`, displayLabel: `📅 ${text}`, detail: due, type: "text", section, apply: `📅 ${iso}` }] : [link];
  });
}

/// La sorgente CM6 di `@`: le persone (K5) e le date (K6). Fuori dal codice e
/// fuori da un wikilink aperto, dove `@` è testo del nome.
export function mentionSource(sources: { people?: PeopleSource; dates?: DateSource }): CompletionSource {
  const { people, dates } = sources;
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    if (wikilinkContext(before)) return null;
    const match = mentionContext(before);
    if (!match) return null;
    const docs = people?.folder() ? await people.search(match.query).catch(() => []) : [];
    const options = [
      ...(dates ? dateCompletions(match.query, dates, isTaskLine(line.text)) : []),
      ...(people?.folder() ? personCompletions(docs, match.query, people) : []),
    ];
    if (options.length === 0) return null;
    return { from: line.from + match.from, options, filter: false };
  };
}

/// L'estensione CM6 dell'autocompletamento: attiva durante la digitazione, ma
/// SOLO dentro i suoi contesti (fuori, le sorgenti rispondono null e nessun
/// popup compare). `override` scavalca le sorgenti di default del linguaggio:
/// qui completiamo note, tag e modelli di diagramma, non parole qualsiasi.
export function markdownCompletions(sources: CompletionSources): Extension {
  return [
    Prec.highest(keymap.of([
      { key: "Tab", run: completeTagSegment },
      // Esc sul menu «/» lo chiude e lascia il testo: prima del keymap del
      // completamento, che lo chiuderebbe soltanto.
      ...(sources.slash ? [{ key: "Escape", run: dismissSlashMenu }] : []),
    ])),
    ...(sources.slash ? [slashDismissed] : []),
    autocompletion({
      override: [
        wikilinkSource(sources.searchNotes),
        ...(sources.headingsOf ? [headingSource(sources.headingsOf)] : []),
        ...(sources.searchHeadings ? [vaultHeadingSource(sources.searchHeadings)] : []),
        ...(sources.blocksOf ? [blockSource(sources.blocksOf)] : []),
        tagSource(sources.listTags),
        diagramTemplateSource(),
        emojiSource(),
        ...(sources.people || sources.dates ? [mentionSource(sources)] : []),
        calloutTypeSource(),
        codeLanguageSource(),
        ...(sources.slash ? [slashSource(sources.slash)] : []),
      ],
      ...(sources.slash ? { addToOptions: [slashIcon(sources.slash)] } : {}),
      activateOnTyping: true,
    }),
  ];
}
