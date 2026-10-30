// Gli stili del documento (livello Standard, con la parte «Stili» del
// Personalizzato): stili di testo e stili grafici, aspetti con un nome che
// gli oggetti seguono; e le operazioni che ne fanno uno, lo danno, lo
// aggiornano, tornano allo stile, scollegano, lo rinominano e lo tolgono,
// ciascuna in un passo che si annulla (formato della scena, stili).
//
// - **Uno stile è un prototipo:** un `text` o una `polyline` nella `defs`
//   della radice, con l'aspetto scritto come lo scriverebbe un oggetto. Si
//   legge e si dà col codice di «Copia lo stile» e «Incolla lo stile»
//   (`look.ts`), e dice soltanto ciò che scrive: chi lo segue tiene il
//   resto. L'editor scrive ogni valore che legge, anche quelli di SVG, così
//   che lo stile dica tutto ciò che l'oggetto mostrava.
// - **Seguire uno stile** è `fub:style` sull'oggetto, che porta comunque i
//   suoi attributi: un altro programma vede lo stesso disegno. Un testo,
//   anche l'etichetta di una forma, segue uno stile di testo; una forma, un
//   tracciato, una linea, un tratto a penna, un'immagine o un gruppo uno
//   grafico. Chi segue uno stile che non c'è, o dell'altro tipo, non segue
//   niente, e l'attributo resta.
// - **Un testo che segue uno stile tiene le sue parole:** lo stile scrive il
//   testo, e una parola in grassetto o in un altro colore resta com'è, se il
//   resto del testo non lo è.
// - **Le differenze** non si scrivono nel file: sono i campi che dare di
//   nuovo lo stile cambierebbe (`styleDifferences`).
// - **Aggiornare uno stile** dalla selezione dà a chi lo segue soltanto i
//   campi cambiati, e soltanto a chi non ne aveva una differenza.
// - **Chi non si riscrive** resta com'è e si conta: un oggetto bloccato, o
//   in un livello o in un gruppo bloccato. Togliere uno stile toglie
//   `fub:style` anche da un oggetto bloccato, che a vederlo resta com'è; da
//   uno in un livello o in un gruppo bloccato il motore non lo toglierebbe,
//   e allora lo stile resta.
// - **I nomi** seguono le regole dei campioni, fra gli stili dello stesso
//   tipo: uno stile di testo e uno grafico possono chiamarsi uguali.

import { followedKind } from "../scene/classify";
import { type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import { nodeOf } from "./arrange";
import type { Unit } from "./hit";
import { textNodesOf, type StyleKind } from "./look";
import { freshSwatchName, swatchNameProblem } from "./swatches";

export type { StyleField, StyleKind } from "./look";

/// Uno stile del documento, come lo mostra il pannello.
export interface DocumentStyle {
  readonly id: string;
  /// Il nome com'è scritto.
  readonly name: string;
  readonly kind: StyleKind;
  /// Il prototipo.
  readonly node: LeafNode;
  /// Quanti oggetti lo seguono.
  readonly followers: number;
}

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

/// Lo stile che segue `node`, fra `styles`; `null` se non ne segue uno, o se
/// segue uno stile che non c'è o dell'altro tipo.
export function followedStyle(node: ElementPart, styles: ReadonlyMap<string, DocumentStyle>): DocumentStyle | null {
  const id = node.details?.follows;
  const style = id === undefined ? undefined : styles.get(id);
  return style !== undefined && style.kind === followedKind(node.details!.role) ? style : null;
}

/// Gli oggetti di `units` che possono seguire uno stile di tipo `kind`, in
/// ordine: per uno grafico gli oggetti scelti che non sono testi, gruppi
/// compresi; per uno di testo i testi che la sezione «Testo» cambia, anche
/// dentro i gruppi scelti, ed etichette comprese.
export function selectionFollowers(model: DocumentModel, units: readonly Unit[], kind: StyleKind): ElementPart[] {
  if (kind === "text") return textNodesOf(model, units);
  return units.map((unit) => nodeOf(model, unit)).filter((node) => node.details !== null && followedKind(node.details.role) === "graphic");
}

/// L'anteprima di uno stile nel suo menu, come proprietà CSS: per uno di
/// testo «Aa» nei suoi caratteri e nel suo colore, per uno grafico un
/// quadratino col suo riempimento, il suo contorno e la sua opacità. Ciò
/// che lo stile non dice resta quello del menu.
export interface StyleSample {
  /// Il testo dell'anteprima; vuoto, un quadratino.
  readonly text: string;
  readonly css: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// I nomi.
// ---------------------------------------------------------------------------

/// Uno stile per i suoi nomi: il suo id, il nome e il tipo.
export type NamedStyle = Pick<DocumentStyle, "id" | "name" | "kind">;

/// Il problema del nome `name`, già pulito, per uno stile di tipo `kind`:
/// come per un campione, vuoto, un colore o di un altro stile dello stesso
/// tipo. `except` è lo stile che si rinomina.
export function styleNameProblem(styles: readonly NamedStyle[], kind: StyleKind, name: string, except: string | null = null): "empty" | "color" | "taken" | null {
  return swatchNameProblem(
    styles.filter((style) => style.kind === kind),
    name,
    except,
  );
}

/// Il nome di uno stile di tipo `kind` che arriva con gli appunti, non
/// vuoto e già pulito: lui se è libero, se no `name 2`, `name 3` e così
/// via, come per un campione.
export function arrivingStyleName(styles: readonly NamedStyle[], kind: StyleKind, name: string): string {
  return freshSwatchName(
    styles.filter((style) => style.kind === kind),
    name,
  );
}

// ---------------------------------------------------------------------------
// Il prototipo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------
