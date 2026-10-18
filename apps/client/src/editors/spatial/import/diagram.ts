// Il diagramma che si importa, letto da un file di un altro programma
// (Excalidraw, draw.io) e non ancora scritto: le forme, i testi, le linee, i
// tratti a mano e le immagini, coi loro livelli e le loro tavole, in un
// modello che non sa da dove viene. Lo legge un lettore per formato
// (`excalidraw.ts`, `drawio.ts`) e lo scrive uno scrittore solo
// (`write.ts`), con le operazioni dell'editor.
//
// - **Coordinate della tela d'origine.** Ogni numero è nelle unità del file
//   letto, con l'asse y in basso: lo scrittore sposta tutto in un colpo,
//   vicino all'origine.
// - **Gli angoli in gradi**, in senso orario come `rotate()`, attorno al
//   punto che dice il file (`Spin`).
// - **I colori** sono `#rrggbb` minuscoli: il lettore traduce ogni altra
//   forma, e un colore che non sa leggere diventa quello di partenza.
// - **Le note** dicono ciò che non entra, una volta per genere, con quante
//   volte è capitato: chi importa le legge prima di scrivere il disegno.

import type { Anchor, ConnectorKind } from "../scene/connectors";
import type { Bounds, Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { HatchKind } from "../tools/hatches";
import type { Dash } from "../tools/outline";
import type { TipShape, TipSize } from "../tools/tips";

/// Il contorno: colore, spessore e tratteggio del menu.
export interface Stroke {
  readonly color: string;
  readonly width: number;
  readonly dash: Dash;
}

/// Il riempimento: un colore pieno o una campitura.
export type Fill =
  | { readonly kind: "color"; readonly color: string }
  | {
      readonly kind: "hatch";
      readonly hatch: HatchKind;
      /// Il colore delle righe, e quello del fondo; `null` lascia vedere sotto.
      readonly color: string;
      readonly background: string | null;
      /// Il passo e lo spessore delle righe, nelle unità della tela.
      readonly spacing: number;
      readonly width: number;
    };

/// L'aspetto di una forma o di una linea. `stroke` e `fill` `null` non si
/// disegnano; `opacity` va da 0 a 1 e vale per tutto l'oggetto. `shadow`
/// vero se getta un'ombra, senza la sua etichetta.
export interface Look {
  readonly stroke: Stroke | null;
  readonly fill: Fill | null;
  readonly opacity: number;
  readonly shadow?: boolean;
}

/// Il carattere di un testo o di un suo pezzo.
export interface Type {
  /// Una delle famiglie di FubDraw (`tools/text.ts`).
  readonly family: string;
  readonly size: number;
  readonly color: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
}

/// Un pezzo di riga: il testo, e ciò che cambia rispetto al testo intero.
export interface Run {
  readonly text: string;
  readonly type: Partial<Type> | null;
}

/// Una riga orizzontale fra i paragrafi di un testo, come la `<hr>` di
/// un'etichetta HTML: passa a metà del paragrafo vuoto `paragraph`, da un
/// lato all'altro del testo. Un indice fuori dai paragrafi conta le righe
/// vuote tolte prima del primo (negativo) o dopo l'ultimo.
export interface Rule {
  readonly paragraph: number;
  readonly color: string;
  readonly width: number;
}

/// Un testo: il carattere di tutto, l'allineamento, l'interlinea in volte il
/// corpo e i paragrafi, ognuno coi suoi pezzi. Un paragrafo va a capo dove
/// lo dice il file, e in un testo in area anche dove finisce la larghezza.
/// Le righe orizzontali le disegna soltanto un testo in area con la sua
/// fascia.
export interface Content {
  readonly type: Type;
  readonly align: "start" | "middle" | "end";
  readonly leading: number;
  readonly paragraphs: readonly (readonly Run[])[];
  readonly rules?: readonly Rule[];
  /// Vero se il testo getta un'ombra.
  readonly shadow?: boolean;
}

/// La forma chiusa di una forma: un rettangolo con l'angolo `corner`,
/// un'ellisse, una forma della raccolta, per id, o un contorno chiuso di
/// tratti dritti e cubici coi punti in frazioni del riquadro, da (0, 0) in
/// alto a sinistra a (1, 1).
export type Form =
  | { readonly kind: "rect"; readonly corner: number }
  | { readonly kind: "ellipse" }
  | { readonly kind: "library"; readonly id: string }
  | { readonly kind: "outline"; readonly segments: readonly Segment[] };

/// La punta di un capo.
export interface End {
  readonly shape: TipShape;
  readonly size: TipSize;
}

/// Un capo di un connettore: agganciato a un oggetto del diagramma, per il
/// suo id d'origine e il lato, o libero. `at` è dove il file lo disegna: il
/// punto di un capo libero, e quello di un capo il cui oggetto non c'è.
export type Hook = { readonly node: string; readonly anchor: Anchor; readonly at: Point } | { readonly at: Point };

/// Una rotazione: l'angolo in gradi, in senso orario, attorno a `centre`.
export interface Spin {
  readonly angle: number;
  readonly centre: Point;
}

/// Un ribaltamento attorno a `centre`, orizzontale (`x`), verticale (`y`) o
/// tutti e due, prima della rotazione.
export interface Flip {
  readonly x: boolean;
  readonly y: boolean;
  readonly centre: Point;
}

interface Base {
  /// L'id nel file d'origine, a cui si agganciano i connettori; vuoto se non
  /// ne ha uno che serve.
  readonly key: string;
  /// Bloccato nel file d'origine.
  readonly locked: boolean;
  /// La rotazione dell'oggetto intero; `null` se è dritto.
  readonly spin: Spin | null;
}

/// Una forma chiusa nel riquadro `box`, con l'etichetta
/// `label` al centro se ne ha una.
export interface ShapeNode extends Base {
  readonly type: "shape";
  readonly form: Form;
  readonly box: Bounds;
  readonly look: Look;
  readonly label: Content | null;
  /// Il nome della forma, il suo `title`; senza, o vuoto, quello di
  /// partenza.
  readonly name?: string;
}

/// La fascia in cui un testo sta in altezza: il blocco delle sue righe, a
/// capo come le manda FubDraw, va in alto, in mezzo o in basso.
export interface Frame {
  readonly top: number;
  readonly bottom: number;
  readonly align: "top" | "middle" | "bottom";
}

/// Un testo. Con `width` è in area e va a capo a quella larghezza; senza, è
/// un testo a punto. `at` è dove comincia la linea di base della prima riga,
/// nel punto che l'allineamento tiene fermo; con `frame` la sua altezza è
/// soltanto una stima, e la riga di base la dà la fascia.
export interface TextNode extends Base {
  readonly type: "text";
  readonly at: Point;
  readonly width: number | null;
  readonly frame: Frame | null;
  readonly content: Content;
  readonly opacity: number;
}

/// Una linea fatta di punti: spezzata, o curva liscia che passa per i
/// punti; chiusa se l'ultimo torna al primo. Le punte vanno sui capi.
export interface PathNode extends Base {
  readonly type: "path";
  readonly points: readonly Point[];
  readonly smooth: boolean;
  readonly closed: boolean;
  readonly look: Look;
  readonly start: End | null;
  readonly end: End | null;
}

/// Un connettore: il tipo, i capi, le punte, e le etichette, ognuna a `t`
/// della sua lunghezza.
export interface LineNode extends Base {
  readonly type: "line";
  readonly kind: ConnectorKind;
  readonly from: Hook;
  readonly to: Hook;
  readonly look: Look;
  readonly start: End | null;
  readonly end: End | null;
  readonly labels: readonly { readonly content: Content; readonly t: number }[];
  /// Il percorso che il file disegna, nella forma del connettore: i due capi
  /// del dritto, i vertici del gomito, i quattro punti di Bézier del curvo.
  /// FubDraw lo tiene finché non si sposta un oggetto agganciato; `null` lo
  /// lascia calcolare a FubDraw.
  readonly route: readonly Point[] | null;
}

/// Un tratto a mano libera: i campioni, con la pressione se il file la ha
/// scritta, lo spessore della penna e se la pressione va simulata.
export interface InkNode extends Base {
  readonly type: "ink";
  readonly samples: readonly { readonly x: number; readonly y: number; readonly p?: number }[];
  readonly size: number;
  readonly thinning: number;
  readonly simulate: boolean;
  readonly color: string;
  readonly opacity: number;
}

/// Un'immagine raster, già in un `data:` che FubDraw legge, nel riquadro
/// `box`. `crop` è la parte dell'immagine che si vede, in frazioni del lato.
export interface ImageNode extends Base {
  readonly type: "image";
  readonly href: string;
  readonly box: Bounds;
  readonly opacity: number;
  readonly crop: Bounds | null;
  /// `null` se non è ribaltata.
  readonly flip: Flip | null;
  /// Vero se getta un'ombra.
  readonly shadow?: boolean;
}

/// Un gruppo, col suo nome se ne ha uno.
export interface GroupNode extends Base {
  readonly type: "group";
  readonly name: string;
  readonly children: readonly Node[];
}

export type Node = ShapeNode | TextNode | PathNode | LineNode | InkNode | ImageNode | GroupNode;

/// Un livello, dal basso in alto. Il nome vuoto prende quello di partenza.
export interface Layer {
  readonly name: string;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly nodes: readonly Node[];
}

/// Una tavola: il nome e il rettangolo sulla tela.
export interface Board {
  readonly name: string;
  readonly box: Bounds;
}

/// Ciò che non entra, per genere: il lettore lo conta, chi importa lo legge.
export type NoteKind =
  /// Un carattere a mano (Virgil, Excalifont, Comic Shanns) che diventa Inter.
  | "hand-font"
  /// Il tratto a mano di Excalidraw o lo stile «sketch» di draw.io.
  | "rough"
  /// Un riempimento che FubDraw non ha (a zigzag, a trattini).
  | "fill"
  /// Una punta che FubDraw non ha, o vuota dove FubDraw la riempie.
  | "tip"
  /// Un percorso disegnato a mano che il connettore ricalcola.
  | "route"
  /// Una forma senza equivalente, che diventa un rettangolo.
  | "stencil"
  /// Un'immagine che sta fuori dal file, o in un formato che non si legge.
  | "image"
  /// Un'immagine troppo pesante per un disegno, rimpicciolita.
  | "reduced"
  /// Un contenuto incorporato (una pagina web, un video).
  | "embed"
  /// Un collegamento su un oggetto.
  | "link"
  /// Un oggetto che non si sa leggere.
  | "unknown"
  /// Un testo con un aspetto HTML che FubDraw non tiene.
  | "html"
  /// Un'ombra lasciata fuori: con un filtro per ombra, il disegno non stava
  /// nei suoi limiti.
  | "shadow"
  /// Un segnaposto di draw.io (`%nome%`) lasciato com'è.
  | "placeholder";

/// Una nota: il genere, quante volte, e un esempio che la dice meglio, come
/// il nome di una forma; vuoto se non ce n'è uno che dica qualcosa a chi
/// importa.
export interface Note {
  readonly kind: NoteKind;
  readonly count: number;
  readonly sample: string;
}

/// Il diagramma letto.
export interface Diagram {
  /// Il formato da cui viene.
  readonly source: "excalidraw" | "drawio";
  /// Il colore della carta; `null` per il bianco.
  readonly background: string | null;
  readonly layers: readonly Layer[];
  readonly boards: readonly Board[];
  readonly notes: readonly Note[];
}

/// Le note di un lettore, per genere, nell'ordine in cui arrivano.
export class Notes {
  private readonly seen = new Map<NoteKind, { count: number; sample: string }>();

  /// Le note di `from`, per continuare a contare.
  constructor(from: readonly Note[] = []) {
    for (const { kind, count, sample } of from) this.seen.set(kind, { count, sample });
  }

  /// Conta `times` volte `kind`; `sample` vale se è il primo che ne ha uno.
  add(kind: NoteKind, sample = "", times = 1): void {
    const known = this.seen.get(kind);
    if (known === undefined) {
      this.seen.set(kind, { count: times, sample });
      return;
    }
    known.count += times;
    if (known.sample === "") known.sample = sample;
  }

  list(): Note[] {
    return [...this.seen].map(([kind, { count, sample }]) => ({ kind, count, sample }));
  }
}

/// Il riquadro da (`x`, `y`) per `width` × `height`.
export const boxOf = (x: number, y: number, width: number, height: number): Bounds => ({ min: [x, y], max: [x + width, y + height] });

/// Un colore come lo scrive FubDraw, da una delle forme dei due programmi:
/// `#rgb`, `#rrggbb`, `#rrggbbaa` (l'alfa si perde) e i nomi più comuni.
/// `null` per «nessuno» o per ciò che non si legge.
export function hexColor(input: string | undefined | null): string | null {
  if (input === undefined || input === null) return null;
  const text = input.trim().toLowerCase();
  const named = NAMED[text];
  if (named !== undefined) return named;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(text);
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text);
  if (long !== null) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(text);
  if (rgb !== null) return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

/// L'opacità di un colore `#rrggbbaa` o `rgba()`, da 0 a 1; 1 senza alfa.
export function alphaOf(input: string | undefined | null): number {
  if (input === undefined || input === null) return 1;
  const text = input.trim().toLowerCase();
  const long = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(text);
  if (long !== null) return parseInt(long[1]!, 16) / 255;
  const short = /^#[0-9a-f]{3}([0-9a-f])$/.exec(text);
  if (short !== null) return parseInt(short[1]! + short[1]!, 16) / 255;
  const rgba = /^rgba\(.*,\s*([\d.]+)\s*\)$/.exec(text);
  if (rgba !== null) return Math.min(1, Math.max(0, Number(rgba[1])));
  return 1;
}

/// I nomi di colore che i due programmi scrivono davvero.
const NAMED: Readonly<Record<string, string>> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  pink: "#ffc0cb",
  brown: "#a52a2a",
};
