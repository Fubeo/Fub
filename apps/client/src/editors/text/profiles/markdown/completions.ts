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
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { isStrictlyInsideCode } from "./parser";
import { childName, pageName, resolutionKey } from "../../../../rules/mirrored";
import { TAG_CHARACTER } from "../../../../rules/mirrored";
import { tagInProgress } from "../../../../rules/syntax";

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
    const match = wikilinkContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const cursorOffset = ctx.pos - line.from;
    const afterCursor = line.text.slice(cursorOffset);
    const suffix = afterCursor.search(/(?:[|#]|\]\])/);
    const to = suffix === -1 ? line.to : ctx.pos + suffix;
    const after = line.text.slice(to - line.from);
    const docs = await searchNotes(match.query);
    return {
      from: line.from + match.from,
      to: line.from + to,
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

/// La sorgente CM6 dei tag; come `wikilinkSource`, esportata per i test.
export function tagSource(listTags: CompletionSources["listTags"]): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (isStrictlyInsideCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = tagContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const tags = await listTags();
    let to = ctx.pos - line.from;
    while (to < line.text.length) {
      const cp = line.text.codePointAt(to)!;
      const character = String.fromCodePoint(cp);
      if (!TAG_CHARACTER.test(character)) break;
      to += character.length;
    }
    return {
      from: line.from + match.from,
      to: line.from + to,
      options: tagCompletions(tags),
      // La stessa classe di `tagInCorso`, presa da lì: un `validFor` più
      // stretto chiuderebbe il popup su un carattere che il tag accetta.
      validFor: new RegExp(`^#${TAG_CHARACTER.source}*$`, "u"),
    };
  };
}

/// L'estensione CM6 dell'autocompletamento: attiva durante la digitazione, ma
/// SOLO dentro i due contesti (fuori, le sorgenti rispondono null e nessun
/// popup compare). `override` scavalca le sorgenti di default del linguaggio:
/// qui completiamo note e tag, non parole qualsiasi.
export function markdownCompletions(sources: CompletionSources): Extension {
  return autocompletion({
    override: [wikilinkSource(sources.searchNotes), tagSource(sources.listTags)],
    activateOnTyping: true,
  });
}
