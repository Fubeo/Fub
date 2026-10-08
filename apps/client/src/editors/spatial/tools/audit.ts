// La verifica dell'accessibilità (livello Standard): ciò che il pannello
// «Accessibilità» mostra, senza il pannello. I problemi su come il disegno si
// legge, ciascuno con l'oggetto a cui si riferisce e la correzione che si fa
// in un clic; e l'ordine in cui uno screen reader incontra gli oggetti.
//
// - **I problemi sono quelli del formato.** S001, il disegno senza titolo;
//   S009, un testo o un tratto a penna che contrasta poco con ciò che ha
//   sotto; S012, un'immagine senza descrizione; S013, un testo sotto i 12 px;
//   S017, due colori usati come codice che si distinguono soltanto per la
//   tinta. È la diagnostica che i due lati danno a chi apre il file (formato
//   della scena, §12), non una seconda regola: ciò che il pannello dice, lo
//   dice anche la shell.
// - **Prima il disegno, poi gli oggetti in ordine di documento**, che è
//   l'ordine in cui si leggono: chi scorre l'elenco percorre il disegno.
// - **Il colore più vicino.** Per S009 la correzione tiene la tinta e la
//   saturazione dell'oggetto e cambia la luminosità quanto basta, verso il
//   più scuro o il più chiaro, dove serve meno: il giallo su bianco diventa
//   un ocra, non un nero. Si misura come la diagnostica, con la stessa
//   opacità sullo stesso fondo, e il colore proposto la fa sparire in quel
//   punto. Quando nessuna luminosità basta, per un oggetto quasi trasparente,
//   non si propone niente.
// - **Il corpo giusto.** Per S013 il corpo che, con la scala dei gruppi che
//   contengono il testo, arriva a 12 px a grandezza naturale.
// - **La campitura giusta.** Per S017 la correzione dà una campitura a tutte
//   le aree di quel colore, non soltanto alla prima: le aree di un colore
//   sono una legenda, e una campitura a metà non distingue niente. Quale
//   campitura lo decide `patterns.ts`, che ne sceglie una che nessun'altra
//   area del disegno usa già.
// - **Un colore o un corpo di una riga sola** non si correggono dal testo:
//   lo scrive il suo `tspan`, e il pannello porta soltanto all'oggetto.
// - **L'ordine di lettura è l'ordine del documento**, quello dell'albero
//   degli oggetti, in profondità. Spostare un oggetto fra i suoi vicini
//   cambia anche quale si vede sopra: quando i due si sovrappongono, il
//   pannello lo dice prima di farlo.

import type { Confusion, Contrast, Measures, Smallness } from "../scene/accessibility";
import { contrast, MIN_CONTRAST, MIN_TEXT_SIZE, over } from "../scene/analysis";
import type { ElementItem } from "../scene/classify";
import type { Severity } from "../scene/diagnostics";
import type { Bounds } from "../scene/geometry";
import type { Scene } from "../scene/read";
import type { Rgb } from "../scene/values";
import { keyOf, type OutlineNode } from "../describe";

/// I codici di §12 che dicono come il disegno si legge.
export type AuditCode = "S001" | "S009" | "S012" | "S013" | "S017";

const AUDITED: ReadonlySet<string> = new Set<AuditCode>(["S001", "S009", "S012", "S013", "S017"]);

/// La correzione di un problema.
export type Fix =
  /// Il titolo del disegno, che si scrive nel suo campo.
  | { readonly kind: "title" }
  /// Un colore che si legge: il riempimento di un testo, o il colore di un
  /// tratto a penna, col contrasto che avrà.
  | { readonly kind: "color"; readonly color: string; readonly paint: "fill" | "stroke"; readonly ratio: number }
  /// Una descrizione, o l'immagine dichiarata decorativa.
  | { readonly kind: "describe" }
  /// Il corpo del testo, nelle sue coordinate.
  | { readonly kind: "size"; readonly size: number }
  /// Una campitura per le aree di un colore che si confonde con un altro: il
  /// colore e le chiavi di tutte le aree che lo portano, la prima compresa.
  | { readonly kind: "hatch"; readonly color: string; readonly keys: readonly string[] };

/// Un problema del disegno.
export interface Problem {
  readonly code: AuditCode;
  readonly severity: Severity;
  /// La chiave dell'oggetto; `null` per il disegno intero.
  readonly key: string | null;
  /// Il ruolo dell'oggetto, per dire che cosa è; `null` per il disegno.
  readonly role: ElementItem["role"] | null;
  /// Il dettaglio della diagnostica: il contrasto misurato, il corpo; per
  /// S017 i due colori e il contrasto fra loro, `#rrggbb #rrggbb r.rr`.
  readonly detail: string | null;
  /// Il contrasto che basta, per S009 e S017.
  readonly threshold: number | null;
  readonly fix: Fix | null;
}

/// I problemi della scena `scene`, con ciò che i controlli hanno misurato:
/// prima quello del disegno, poi gli altri in ordine di documento.
export function problemsOf(scene: Scene, measures: Measures): Problem[] {
  const items = new Map<number, ElementItem>();
  for (const item of scene.items) if (item.kind === "element") items.set(item.utf16[0], item);
  const contrasts = new Map<number, Contrast>(measures.contrasts.map((measured) => [measured.span.utf16[0], measured]));
  const sizes = new Map<number, Smallness>(measures.sizes.map((measured) => [measured.span.utf16[0], measured]));
  const confusions = new Map<number, Confusion>(measures.confusions.map((measured) => [measured.span.utf16[0], measured]));
  const found: Array<{ readonly at: number; readonly problem: Problem }> = [];
  for (const diagnostic of scene.diagnostics) {
    if (!AUDITED.has(diagnostic.code)) continue;
    const code = diagnostic.code as AuditCode;
    const at = diagnostic.utf16?.[0] ?? -1;
    const detail = diagnostic.detail ?? null;
    if (code === "S001") {
      found.push({ at: -1, problem: { code, severity: diagnostic.severity, key: null, role: null, detail, threshold: null, fix: { kind: "title" } } });
      continue;
    }
    const item = items.get(at);
    if (item === undefined) continue;
    let fix: Fix | null = null;
    let threshold: number | null = null;
    if (code === "S009") {
      const measured = contrasts.get(at);
      threshold = measured?.threshold ?? null;
      const color = measured === undefined || measured.line ? null : legibleColor(measured);
      if (color !== null) fix = { kind: "color", color: hex(color.rgb), paint: item.role === "stroke" ? "stroke" : "fill", ratio: color.ratio };
    } else if (code === "S012") {
      fix = { kind: "describe" };
    } else if (code === "S017") {
      threshold = MIN_CONTRAST;
      const measured = confusions.get(at);
      if (measured !== undefined) fix = { kind: "hatch", color: hex(measured.color), keys: areaKeys(measured, items) };
    } else {
      const measured = sizes.get(at);
      const size = measured === undefined || measured.line ? null : legibleSize(measured.scale);
      if (size !== null) fix = { kind: "size", size };
    }
    found.push({ at, problem: { code, severity: diagnostic.severity, key: keyOf(item), role: item.role, detail, threshold, fix } });
  }
  // Un oggetto con più problemi li ha in fila, nell'ordine dei codici.
  found.sort((a, b) => a.at - b.at || (a.problem.code < b.problem.code ? -1 : a.problem.code > b.problem.code ? 1 : 0));
  return found.map((each) => each.problem);
}

/// Le chiavi di tutte le aree di un colore confuso, in ordine di documento.
function areaKeys(measured: Confusion, items: ReadonlyMap<number, ElementItem>): string[] {
  const keys: string[] = [];
  for (const span of measured.areas) {
    const item = items.get(span.utf16[0]);
    if (item !== undefined) keys.push(keyOf(item));
  }
  return keys;
}

/// Il colore più vicino a quello misurato, con la stessa tinta e la stessa
/// saturazione, che contrasta abbastanza col fondo, e il contrasto che ha;
/// `null` se nessuna luminosità basta.
export function legibleColor(measured: Pick<Contrast, "color" | "under" | "threshold">): { readonly rgb: Rgb; readonly ratio: number } | null {
  const [rgb, alpha] = measured.color;
  const { under, threshold } = measured;
  const ratioOf = (color: Rgb): number => contrast(over(color, alpha, under), under);
  const [h, s, l] = toHsl(rgb);
  let best: { readonly rgb: Rgb; readonly ratio: number; readonly distance: number } | null = null;
  for (const end of [0, 1]) {
    const at = (t: number): Rgb => fromHsl(h, s, l + (end - l) * t);
    if (ratioOf(at(1)) < threshold) continue;
    // Il contrasto, andando verso un estremo, scende finché la luminosità si
    // avvicina a quella del fondo e poi sale: chi parte sotto la soglia la
    // passa una volta sola, e la bisezione trova il punto.
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 32; step++) {
      const mid = (lo + hi) / 2;
      if (ratioOf(at(mid)) >= threshold) hi = mid;
      else lo = mid;
    }
    const color = at(hi);
    const distance = Math.abs(end - l) * hi;
    if (best === null || distance < best.distance) best = { rgb: color, ratio: ratioOf(color), distance };
  }
  return best === null ? null : { rgb: best.rgb, ratio: best.ratio };
}

/// Il corpo che, con la scala `scale`, porta un testo a [`MIN_TEXT_SIZE`]
/// a grandezza naturale, al centesimo per eccesso; `null` se la scala non
/// lo permette.
export function legibleSize(scale: number): number | null {
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  let size = Math.ceil((MIN_TEXT_SIZE / scale) * 100) / 100;
  while (size * scale < MIN_TEXT_SIZE) size = (Math.round(size * 100) + 1) / 100;
  return Number.isFinite(size) ? size : null;
}

/// Un colore come lo scrive il file.
export function hex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/// Tinta in giri, saturazione e luminosità da 0 a 1.
function toHsl([r8, g8, b8]: Rgb): [number, number, number] {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const light = Math.min(1, Math.max(0, l));
  const chroma = (1 - Math.abs(2 * light - 1)) * s;
  const channel = (n: number): number => {
    const k = (n + h * 12) % 12;
    const value = light - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.min(255, Math.max(0, Math.round(value * 255)));
  };
  return [channel(0), channel(8), channel(4)];
}

// ---------------------------------------------------------------------------
// L'ordine di lettura.
// ---------------------------------------------------------------------------

/// Una riga dell'ordine di lettura.
export interface ReadingRow {
  readonly node: OutlineNode;
  /// Quanti contenitori stanno sopra di lei: 0 per un livello, o per un
  /// oggetto alla radice.
  readonly depth: number;
  /// La chiave del contenitore; `null` alla radice.
  readonly parent: string | null;
  /// La prima e l'ultima fra i figli del suo contenitore.
  readonly first: boolean;
  readonly last: boolean;
}

/// Gli oggetti nell'ordine in cui si leggono: l'ordine del documento, in
/// profondità.
export function readingOrder(nodes: readonly OutlineNode[]): ReadingRow[] {
  const rows: ReadingRow[] = [];
  const walk = (list: readonly OutlineNode[], depth: number, parent: string | null): void => {
    list.forEach((node, at) => {
      rows.push({ node, depth, parent, first: at === 0, last: at === list.length - 1 });
      walk(node.children, depth + 1, node.key);
    });
  };
  walk(nodes, 0, null);
  return rows;
}

/// Vero se due riquadri si sovrappongono con un'area: un oggetto che
/// passa oltre l'altro nell'ordine di lettura passa anche sopra o sotto di
/// lui.
export function overlaps(a: Bounds | null, b: Bounds | null): boolean {
  if (a === null || b === null) return false;
  return a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1];
}
