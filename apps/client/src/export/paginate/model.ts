// Il modello dell'impaginatore dell'esportazione in PDF (E28, ADR 0247): le
// scatole che la vista misura e le pagine che le regole ne fanno.
//
// Niente DOM qui. La vista (T69b) misura ogni blocco della resa per la stampa
// e lo descrive come una scatola: quanto è alta, di quali righe è fatta, di
// che specie è. Le regole (`rules.ts`) decidono dove voltare pagina e danno,
// per ogni pagina, quali fasce di quali scatole ci stanno e dove. La vista poi
// sposta ciò che ha disegnato in quelle fasce, come faceva l'impaginatore della
// prova (`export/probe.ts`) con i suoi tagli.
//
// Tutte le misure sono pixel CSS, nella colonna del testo: l'altezza utile di
// una pagina (o di una colonna, con due colonne) è quella fra i margini.

/// Un commento mostrato come nota: accanto al suo paragrafo, nel margine
/// esterno, o in fondo al documento (`notePlacement` in `rules.ts`). La vista
/// lo misura già nella forma in cui uscirà: largo quanto il margine, o quanto
/// la colonna del testo in fondo.
export interface MarginNote {
  readonly id: string;
  readonly height: number;
  /// Dove sta il segno del commento, dal bordo alto della sua scatola: la
  /// nota comincia alla sua altezza. Senza, all'altezza della scatola.
  readonly at?: number;
}

interface BoxBase {
  /// L'identità del blocco nella nota: la ritrovano l'indice (T73) e il clic
  /// sulla pagina (T76).
  readonly id: string;
  /// Lo spazio sopra la scatola. In cima a una pagina o a una colonna non
  /// c'è: la pagina comincia col blocco.
  readonly gap?: number;
  /// I commenti ancorati alla scatola, nell'ordine della nota.
  readonly notes?: readonly MarginNote[];
}

/// Un titolo: non si spezza e resta col blocco che lo segue.
export interface HeadingBox extends BoxBase {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly height: number;
}

/// Un paragrafo, una voce d'elenco, una citazione: si spezza fra le righe,
/// senza lasciare una riga sola in fondo o in cima (vedove e orfane).
export interface ParagraphBox extends BoxBase {
  readonly kind: "paragraph";
  /// L'altezza di ogni riga, dall'alto: la loro somma è la scatola.
  readonly lines: readonly number[];
}

/// Un blocco di codice: si spezza fra le righe, con la stessa regola delle
/// righe sole del paragrafo.
export interface CodeBox extends BoxBase {
  readonly kind: "code";
  readonly lines: readonly number[];
}

/// Una tabella: corta non si spezza; lunga continua nella pagina dopo fra
/// due righe, con l'intestazione ripetuta.
export interface TableBox extends BoxBase {
  readonly kind: "table";
  /// L'altezza della riga d'intestazione (0 se la tabella non l'ha).
  readonly header: number;
  /// L'altezza di ogni riga del corpo, dall'alto.
  readonly rows: readonly number[];
}

/// Una figura, un'immagine, una formula, un riquadro, un diagramma, una
/// scheda: non si spezza; più alto di una pagina, si rimpicciolisce.
export interface BlockBox extends BoxBase {
  readonly kind: "block";
  readonly height: number;
}

/// Il separatore (`---`): una linea, oppure, se così è regolato, una pagina
/// nuova (`applyBreaks` in `breaks.ts`).
export interface SeparatorBox extends BoxBase {
  readonly kind: "separator";
  readonly height: number;
}

/// Perché comincia una pagina nuova: ogni Titolo 2, il separatore, il punto
/// scelto a mano sulla pagina (D17, `<!-- pagina -->`, T76), o una nota nuova
/// di un PDF di più note (T78).
export type BreakReason = "titolo2" | "separatore" | "mano" | "capitolo";

/// Un'interruzione di pagina: una scatola senza altezza.
export interface BreakBox {
  readonly kind: "break";
  readonly id: string;
  readonly reason: BreakReason;
}

export type Box = HeadingBox | ParagraphBox | CodeBox | TableBox | BlockBox | SeparatorBox | BreakBox;

/// Le scatole che occupano spazio sulla pagina.
export type FlowBox = Exclude<Box, BreakBox>;

/// Dove vanno le note dei commenti.
export type NotePlacement = "margine" | "fondo";

/// La pagina vista dalle regole.
export interface PageFrame {
  /// L'altezza utile di una colonna: fra il margine alto e quello basso.
  readonly height: number;
  /// Una colonna o due: con due, si riempie la prima e poi la seconda.
  readonly columns: 1 | 2;
  /// La larghezza del margine che ospita le note (quello destro; a specchio,
  /// il più stretto dei due). Decide con `columns` dove vanno le note.
  readonly noteMargin: number;
  /// Lo spazio sotto una scatola rimpicciolita, dove la pagina dice «è stata
  /// rimpicciolita» (la scritta la mette chi disegna). Facoltativo, 0.
  readonly fitLabel?: number;
  /// Lo spazio fra una nota nel margine e la successiva. Facoltativo, 0.
  readonly noteGap?: number;
  /// L'altezza del titolo sopra le note in fondo («Commenti», lo scrive chi
  /// disegna): resta con la prima nota. Facoltativo, 0 = nessun titolo.
  readonly notesHeading?: number;
}

/// Una fascia di una scatola messa su una pagina.
export interface Placement {
  /// L'indice della scatola nell'elenco dato a `paginate`.
  readonly box: number;
  readonly id: string;
  /// `corpo`: una fascia della scatola; `intestazione`: l'intestazione di una
  /// tabella ripetuta nella pagina dopo; `nota`: una nota in fondo, della
  /// scatola che la porta (`note` ne dice l'identità, la fascia è la nota
  /// intera); `titolo-note`: il titolo sopra le note in fondo (`box` -1).
  readonly part: "corpo" | "intestazione" | "nota" | "titolo-note";
  readonly note?: string;
  /// La fascia, nelle coordinate della scatola non rimpicciolita: da `from` a
  /// `to` pixel dal suo bordo alto.
  readonly from: number;
  readonly to: number;
  /// La colonna (0 o 1) e il bordo alto della fascia, dal margine alto.
  readonly column: number;
  readonly y: number;
  /// 1, o meno se la fascia era più alta della pagina e si è rimpicciolita.
  readonly scale: number;
  /// La fascia continua una scatola cominciata in una pagina prima.
  readonly continued: boolean;
  /// La scatola continua nella pagina dopo.
  readonly continues: boolean;
}

/// Una nota accanto al suo paragrafo, nel margine.
export interface SideNote {
  readonly box: number;
  readonly id: string;
  /// Il bordo alto della nota, dal margine alto della pagina.
  readonly y: number;
  /// 1, o meno per una nota più alta della pagina.
  readonly scale: number;
}

export interface Page {
  readonly placements: readonly Placement[];
  readonly notes: readonly SideNote[];
}

export interface Pagination {
  /// Almeno una: una nota vuota esce come una pagina bianca.
  readonly pages: readonly Page[];
  /// Dove sono finite le note.
  readonly notes: NotePlacement;
  /// La pagina (da 0) dove comincia ogni scatola, nell'ordine dell'elenco;
  /// -1 per un'interruzione. Serve all'indice coi numeri veri (T73).
  readonly firstPage: readonly number[];
}

/// L'altezza intera di una scatola.
export function boxHeight(box: FlowBox): number {
  switch (box.kind) {
    case "paragraph":
    case "code":
      return sum(box.lines);
    case "table":
      return box.header + sum(box.rows);
    default:
      return box.height;
  }
}

export function sum(values: readonly number[], from = 0, to = values.length): number {
  let total = 0;
  for (let i = from; i < to; i++) total += values[i];
  return total;
}
