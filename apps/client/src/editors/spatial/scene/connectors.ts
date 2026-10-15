// I connettori, le linee che uniscono due oggetti e li seguono (formato della
// scena, connettori): un `path` con `fub:shape="connector"` e `fub:geom`, che
// porta il tipo della linea e i punti del suo percorso; `d` si calcola da lì,
// come per la freccia. `fub:from` e `fub:to` dicono a che cosa sono
// agganciati i due capi, con l'id dell'oggetto e il punto d'aggancio; un capo
// senza è libero. L'etichetta di un connettore è un `text` con `fub:along`:
// l'id del connettore, dove sta lungo la linea e a che distanza.
//
// - **La geometria scritta è quella che si vede.** `fub:geom` porta i punti
//   del percorso già calcolati, nelle coordinate del connettore: chi non sa
//   niente degli agganci rigenera `d` da lì, e un altro programma vede la
//   linea in `d`. Gli agganci servono a FubDraw per ricalcolare il percorso
//   quando un oggetto si sposta.
// - **La lettura vuole la grammatica intera:** un tipo sconosciuto, un
//   numero di valori sbagliato o un valore che non è un numero lasciano un
//   tracciato qualunque, che si legge da `d`. Un aggancio o un'etichetta fuori
//   grammatica non si usano, e restano nel file come sono.
// - **Il `d` si calcola dalla geometria com'è scritta**, così chi lo rigenera
//   da `fub:geom` ottiene lo stesso testo: `connectorAttrs` scrive la
//   geometria, la rilegge e ne calcola il `d`.
//
// È `connectors.rs` di `fub-scene`, regola per regola: i casi scritti a mano
// in `apps/client/src/__fixtures__/scene-connectors/cases.json` valgono per
// tutte e due.

import { formatNumber } from "../number";
import type { Segment } from "./geometry";
import type { Point } from "./matrix";
import { pathData } from "./serialize";
import { number, numberList } from "./values";

/// Come va la linea: dritta, a gomito, coi tratti orizzontali e verticali, o
/// curva, una curva di Bézier cubica.
export type ConnectorKind = "straight" | "elbow" | "curved";

export const CONNECTOR_KINDS: readonly ConnectorKind[] = ["straight", "elbow", "curved"];

/// Il percorso di un connettore, come lo porta `fub:geom`: dritto, due punti;
/// a gomito, i vertici dal primo all'ultimo; curvo, l'inizio, i due punti di
/// controllo e la fine.
export interface ConnectorGeom {
  readonly kind: ConnectorKind;
  readonly points: readonly Point[];
}

/// I vertici di un gomito, al più: un percorso senza ostacoli ne ha sei.
export const MAX_ELBOW_POINTS = 64;

/// Dove un capo si aggancia all'oggetto: scelto da FubDraw, verso il centro,
/// o al centro di uno dei quattro lati, nel verso dell'oggetto.
export type Anchor = "auto" | "center" | "top" | "right" | "bottom" | "left";

export const ANCHORS: readonly Anchor[] = ["auto", "center", "top", "right", "bottom", "left"];

/// I quattro lati, nell'ordine in cui il pannello li propone.
export const SIDES: readonly Exclude<Anchor, "auto" | "center">[] = ["top", "right", "bottom", "left"];

/// Un capo agganciato: l'id dell'oggetto e il punto d'aggancio.
export interface ConnectorEnd {
  readonly id: string;
  readonly anchor: Anchor;
}

/// Dove sta l'etichetta di un connettore: `t` è la frazione della lunghezza
/// della linea dal suo inizio, da 0 a 1; `offset` la distanza fra la linea e
/// il bordo più vicino dell'etichetta, positiva dalla parte che guarda in
/// alto a destra: sopra una linea orizzontale, a destra di una verticale, e
/// di una obliqua dove la perpendicolare va più verso l'alto a destra; di
/// una parallela a (1, -1), dove le due sono alla pari, quella in alto a
/// sinistra. Negativa dall'altra parte, qualunque sia il verso della linea.
export interface LabelPlace {
  readonly id: string;
  readonly t: number;
  readonly offset: number;
}

/// I decimali di `t` in `fub:along`.
export const ALONG_DECIMALS = 4;

/// Gli spazi fra le parole di un aggancio e di un'etichetta: quelli di SVG.
const SPACES = /[ \t\n\r\f]+/;

/// Quanti numeri vuole il percorso di `kind`: esattamente, o al meno e al più.
function counts(kind: ConnectorKind): readonly [number, number] {
  if (kind === "straight") return [4, 4];
  if (kind === "curved") return [8, 8];
  return [4, MAX_ELBOW_POINTS * 2];
}

/// Il tipo scritto, se è uno dei tre, scritto così.
export function parseConnectorKind(value: string): ConnectorKind | null {
  return (CONNECTOR_KINDS as readonly string[]).includes(value) ? (value as ConnectorKind) : null;
}

/// Il percorso di `fub:geom`; `null` se è fuori dalla grammatica.
export function readConnectorGeom(geom: string): ConnectorGeom | null {
  const text = geom.replace(/^[ \t\n\r\f]+/, "");
  const end = text.search(SPACES);
  if (end <= 0) return null;
  const kind = parseConnectorKind(text.slice(0, end));
  if (kind === null) return null;
  const numbers = numberList(text.slice(end));
  if (numbers === null || numbers.some((value) => !Number.isFinite(value))) return null;
  const [least, most] = counts(kind);
  if (numbers.length < least || numbers.length > most || numbers.length % 2 !== 0) return null;
  const points: Point[] = [];
  for (let i = 0; i < numbers.length; i += 2) points.push([numbers[i]!, numbers[i + 1]!]);
  return { kind, points };
}

/// `fub:geom` di `geom`, coi numeri del formato: due decimali.
export function writeConnectorGeom(geom: ConnectorGeom): string {
  return [geom.kind, ...geom.points.map(([x, y]) => `${formatNumber(x, 2)} ${formatNumber(y, 2)}`)].join(" ");
}

/// I segmenti del percorso di `geom`.
export function connectorSegments(geom: ConnectorGeom): Segment[] {
  const [first, ...rest] = geom.points;
  const out: Segment[] = [{ kind: "move", to: first! }];
  if (geom.kind === "curved") {
    out.push({ kind: "cubic", c1: rest[0]!, c2: rest[1]!, to: rest[2]! });
  } else {
    for (const point of rest) out.push({ kind: "line", to: point });
  }
  return out;
}

/// Il `d` di `geom`: `M` e `L` per una linea dritta o a gomito, `M` e `C` per
/// una curva.
export function connectorPath(geom: ConnectorGeom): string {
  return pathData(connectorSegments(geom));
}

/// `fub:geom` e `d` di `geom`: il `d` è quello della geometria come si
/// rilegge da ciò che è scritto, così chi lo rigenera ottiene lo stesso testo.
export function connectorAttrs(geom: ConnectorGeom): { readonly "fub:geom": string; readonly d: string } {
  const written = writeConnectorGeom(geom);
  return { "fub:geom": written, d: connectorPath(readConnectorGeom(written)!) };
}

/// Il capo di `fub:from` o `fub:to`: l'id e il punto d'aggancio, due parole;
/// `null` fuori dalla grammatica.
export function readConnectorEnd(value: string): ConnectorEnd | null {
  const words = value.split(SPACES).filter((word) => word !== "");
  if (words.length !== 2) return null;
  const [id, anchor] = words as [string, string];
  return (ANCHORS as readonly string[]).includes(anchor) ? { id, anchor: anchor as Anchor } : null;
}

/// `fub:from` o `fub:to` di `end`.
export function writeConnectorEnd(end: ConnectorEnd): string {
  return `${end.id} ${end.anchor}`;
}

/// Il posto di `fub:along`: l'id del connettore, `t` fra 0 e 1 e la
/// distanza; `null` fuori dalla grammatica.
export function readLabelPlace(value: string): LabelPlace | null {
  const words = value.split(SPACES).filter((word) => word !== "");
  if (words.length !== 3) return null;
  const [id, at, away] = words as [string, string, string];
  const t = number(at);
  const offset = number(away);
  if (t === null || offset === null || !Number.isFinite(offset) || !(t >= 0 && t <= 1)) return null;
  return { id, t, offset };
}

/// `fub:along` di `place`: `t` con quattro decimali, la distanza con due.
export function writeLabelPlace(place: LabelPlace): string {
  const t = Math.min(1, Math.max(0, place.t));
  return `${place.id} ${formatNumber(t, ALONG_DECIMALS)} ${formatNumber(place.offset, 2)}`;
}
