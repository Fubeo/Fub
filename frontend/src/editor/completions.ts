// Autocompletamento stile Obsidian: `[[` completa i nomi pagina delle note,
// `#` completa i tag del vault. Le sorgenti dati sono INIETTATE
// (`CompletionSources`): questo modulo non importa `api.ts`, così resta puro e
// testabile in node — sarà la shell (`editor.ts`/`main.ts`) a passare
// `api.listDocuments` e `api.listTags`.
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
import { childName, pageName } from "../rules/organizer";

/// Le sorgenti dati dei completamenti. `listNotes` restituisce i DocId del
/// vault; `listTags` i tag con la frequenza (mirror di `TagCount`).
export interface CompletionSources {
  listNotes(): Promise<string[]>;
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
/// `Be`, non sul link già chiuso. Un wikilink non attraversa le righe: un
/// a-capo dopo il `[[` lo spegne.
export function wikilinkContext(before: string): ContextMatch | null {
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const query = before.slice(open + 2);
  if (query.includes("]]") || query.includes("\n")) return null;
  return { from: open + 2, query };
}

/// Il cursore è su un token `#...` a inizio parola? Regole:
/// - i caratteri di tag sono lettere/cifre Unicode, `_`, `-`, `/` (le
///   gerarchie `area/lavoro` passano intere);
/// - il carattere prima del `#` non dev'essere di parola (`a#b` no) né un
///   altro `#` (il `##` di un heading no);
/// - il `#` di un heading «vero» (`# Titolo`) non matcha mai da solo: lo
///   spazio dopo il `#` non è un carattere di tag, quindi il token si spezza.
export function tagContext(before: string): ContextMatch | null {
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const m = /#([\p{L}\p{N}_/-]*)$/u.exec(line);
  if (!m) return null;
  const hash = lineStart + (m.index ?? 0);
  const prev = before.charAt(hash - 1);
  if (prev && /[\p{L}\p{N}_#]/u.test(prev)) return null;
  return { from: hash, query: m[1] };
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
/// in cartelle diverse, confronto case-insensitive come la risoluzione dei
/// link — si inserisce il path senza estensione, che è la forma univoca.
export function noteCompletions(docs: string[], alreadyClosed: boolean): Completion[] {
  const seen = new Map<string, number>();
  for (const doc of docs) {
    const key = pageName(doc).toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return docs.map((doc) => {
    const name = pageName(doc);
    const ambiguous = (seen.get(name.toLowerCase()) ?? 0) > 1;
    const insert = ambiguous ? pathWithoutExtension(doc) : name;
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
/// portano. Le gerarchie arrivano già intere dal kernel (`area/lavoro`).
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
export function wikilinkSource(listNotes: CompletionSources["listNotes"]): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = wikilinkContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const docs = await listNotes();
    const after = ctx.state.sliceDoc(ctx.pos, Math.min(ctx.state.doc.length, ctx.pos + 2));
    return {
      from: line.from + match.from,
      options: noteCompletions(docs, after === "]]"),
      // Restare valida mentre si digita il nome: si rifiltra senza richiamare
      // la sorgente; `]` o `[` chiudono/cambiano il contesto.
      validFor: /^[^\[\]\n]*$/,
    };
  };
}

/// La sorgente CM6 dei tag; come `wikilinkSource`, esportata per i test.
export function tagSource(listTags: CompletionSources["listTags"]): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = tagContext(ctx.state.sliceDoc(line.from, ctx.pos));
    if (!match) return null;
    const tags = await listTags();
    return {
      from: line.from + match.from,
      options: tagCompletions(tags),
      validFor: /^#[\p{L}\p{N}_/-]*$/u,
    };
  };
}

/// L'estensione CM6 dell'autocompletamento: attiva durante la digitazione, ma
/// SOLO dentro i due contesti (fuori, le sorgenti rispondono null e nessun
/// popup compare). `override` scavalca le sorgenti di default del linguaggio:
/// qui completiamo note e tag, non parole qualsiasi.
export function markdownCompletions(sources: CompletionSources): Extension {
  return autocompletion({
    override: [wikilinkSource(sources.listNotes), tagSource(sources.listTags)],
    activateOnTyping: true,
  });
}
