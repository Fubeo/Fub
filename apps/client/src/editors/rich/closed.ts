// Ciò che il formato non riscriverebbe senza perdite (versione 3 della
// proiezione): i blocchi chiusi (`locked`) e, con `body_only`, ciò che sta
// fuori dal corpo.
//
// Il formato rifiuta al salvataggio una proiezione che cambia l'uno o l'altro
// (`host.rich.locked.*`); la superficie non lo lascia nemmeno scrivere, così
// chi scrive non accumula lavoro che il salvataggio rifiuterebbe. La regola dei
// blocchi è quella del formato: i blocchi chiusi restano, uguali e nello
// stesso ordine, e spostarli interi si può. Fuori dal corpo restano la pagina
// dell'ultima sezione, le intestazioni e i piè di pagina, i commenti, la
// registrazione delle modifiche e le note; un elenco di una specie che il
// documento non ha vorrebbe una numerazione nuova, che sta fuori anche lei.
// L'autorità resta il formato: ciò che qui sfugge lo rifiuta lui.
import type { Node as PmNode } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { commentsOf } from "./comments";
import { GO_TO } from "./rich-motion";
import { writeBlock, writeComment, writePage, writeRunning, type Block, type Page, type Role, type RunningText } from "./projection";
import { tracking } from "./track";

/// I blocchi chiusi della proiezione, scritti come li scrive la proiezione.
export function closedBlocks(blocks: readonly Block[]): string[] {
  return blocks.filter((block) => block.locked === true).map(writeBlock);
}

/// Ciò che sta fuori dal corpo, in una forma che si confronta.
export function outsideOf(doc: PmNode): string {
  const running = (value: unknown) => (value ? writeRunning(value as RunningText) : "");
  const parts = [
    commentsOf(doc).map(writeComment).join(","),
    String(tracking(doc)),
    doc.attrs.page ? writePage(doc.attrs.page as Page) : "",
    running(doc.attrs.header),
    running(doc.attrs.footer),
  ];
  const notes: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "section") parts.push(running(node.attrs.header), running(node.attrs.footer));
    // Una nota spostata resta la stessa nota: conta quali ci sono, non dove.
    if (node.type.name === "atom" && node.attrs.kind === "note") notes.push((node.attrs.k as string | null) ?? "");
    return true;
  });
  // Una nota nuova non ha `k`: il numero la conta.
  parts.push(`${notes.length}:${notes.sort().join(",")}`);
  return parts.join("\n");
}

/// Le specie di elenco del documento: puntato, numerato.
export function listKinds(doc: PmNode): Set<boolean> {
  const out = new Set<boolean>();
  doc.descendants((node) => {
    const role = node.type.name === "para" ? (node.attrs.role as Role) : null;
    if (role?.kind === "list") out.add(role.ordered);
    return node.type.name !== "para";
  });
  return out;
}

/// `after` tiene ciò che `before` aveva fuori dal corpo, e non vuole elenchi
/// di una specie che `before` non ha.
export function keepsOutside(before: PmNode, after: PmNode): boolean {
  if (outsideOf(before) !== outsideOf(after)) return false;
  const had = listKinds(before);
  for (const kind of listKinds(after)) if (!had.has(kind)) return false;
  return true;
}

/// Un blocco chiuso del documento: dove comincia e che cosa è.
export interface ClosedPlace {
  readonly pos: number;
  readonly kind: "para" | "table";
  /// Le prime parole del paragrafo; vuoto per una tabella o un paragrafo
  /// senza testo.
  readonly excerpt: string;
}

/// Quante lettere dice l'estratto di un paragrafo chiuso.
const EXCERPT = 40;

/// I blocchi chiusi del documento, nell'ordine in cui si leggono.
export function closedPlaces(doc: PmNode): ClosedPlace[] {
  const out: ClosedPlace[] = [];
  doc.descendants((node, pos) => {
    if (node.attrs.locked === true && (node.type.name === "para" || node.type.name === "table")) {
      const kind = node.type.name;
      const text = kind === "para" ? node.textContent.replace(/\s+/g, " ").trim() : "";
      out.push({ pos, kind, excerpt: text.length > EXCERPT ? `${text.slice(0, EXCERPT).trimEnd()}…` : text });
      return false;
    }
    return node.type.name !== "para";
  });
  return out;
}

/// Porta il cursore all'inizio del blocco che comincia in `pos`, come si va a
/// un commento: si legge anche in sola lettura, e non scrive niente.
export function goToBlock(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || (node.type.name !== "para" && node.type.name !== "table")) return false;
    if (dispatch) {
      const selection = TextSelection.near(state.doc.resolve(pos + 1));
      dispatch(state.tr.setSelection(selection).scrollIntoView().setMeta(GO_TO, true));
    }
    return true;
  };
}
