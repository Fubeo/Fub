// Il disegno a parole: gli oggetti in albero, ciascuno col suo nome, per
// l'albero degli oggetti dell'editor e per l'elenco della Lettura.
//
// Il dato è quello della scena, le voci in ordine di documento che il lettore
// ricava dal testo: lo stesso per l'editor e per un documento che si guarda
// soltanto, e nessun secondo calcolo. Un nome dice che cosa è l'oggetto e,
// quando lo sa, come si chiama: il suo `title`, o le parole di un testo, o
// il nome di un livello. Un collegamento dice anche dove porta, col
// nome della nota. Lo stato di un livello è una parola, non un colore. Il
// colore di un oggetto lo aggiunge chi lo conosce: l'editor, che ha il
// painter.

import { pageName } from "../../rules/mirrored";
import { plural, t, type DrawKey } from "./strings";
import type { Role } from "./scene/analysis";
import type { ElementItem, Item } from "./scene/classify";
import type { Polygonal } from "./scene/parametric";
import type { Scene } from "./scene/read";

/// Quanti caratteri di un testo entrano nel nome di un oggetto.
const NAME_CHARS = 60;

/// Un oggetto del disegno coi suoi figli, in ordine di documento.
export interface OutlineNode {
  readonly item: ElementItem;
  /// La chiave con cui l'editor sceglie l'oggetto: l'id, o `@` e il percorso.
  readonly key: string;
  /// Il nome proprio: il nome del livello, il `title` dell'oggetto, le parole
  /// di un testo; `null` se non ne ha.
  readonly name: string | null;
  /// Dove porta un collegamento: il percorso del vault com'è scritto nel suo
  /// `href`. `null` per ogni altro oggetto, e per un collegamento che non
  /// porta nel vault.
  readonly target: string | null;
  readonly children: readonly OutlineNode[];
}

/// Dove porta il collegamento `item`, come [`OutlineNode.target`].
export type LinkTargets = (item: ElementItem) => string | null;

/// Dove portano i collegamenti di una scena letta, dall'indice: un
/// riferimento e il suo elemento cominciano allo stesso byte.
export function sceneTargets(scene: Scene): LinkTargets {
  const byStart = new Map(scene.index.links.map((link) => [link.bytes[0], link.path]));
  return (item) => byStart.get(item.bytes[0]) ?? null;
}

/// Il nome della nota a cui porta `target`, un percorso del vault com'è
/// scritto: il nome della pagina, senza cartelle, estensione e frammento, e
/// coi caratteri che il percorso codifica.
export function linkName(target: string): string {
  const path = target.split("#")[0]!;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Una codifica rotta resta com'è scritta.
  }
  return nameOf(pageName(decoded)) ?? nameOf(decoded) ?? target;
}

/// La chiave con cui l'editor sceglie un oggetto.
export function keyOf(item: { readonly id: string | null; readonly path: readonly number[] }): string {
  return item.id ?? `@${item.path.join(".")}`;
}

/// I ruoli che non sono oggetti: il nome e la descrizione di chi li contiene,
/// e la carta, che è il fondo.
const NOT_OBJECTS: ReadonlySet<Role> = new Set<Role>(["title", "desc", "paper"]);

const KINDS: Readonly<Record<Exclude<Role, "title" | "desc" | "paper">, DrawKey>> = {
  layer: "draw.kind.layer",
  group: "draw.kind.group",
  link: "draw.kind.link",
  stroke: "draw.kind.stroke",
  arrow: "draw.tool.arrow",
  // Un poligono regolare e una stella hanno sempre la geometria, che dà il
  // nome: questi due valgono soltanto da ripiego.
  ngon: "draw.tool.polygon",
  star: "draw.tool.star",
  path: "draw.kind.path",
  width: "draw.kind.width",
  rect: "draw.tool.rect",
  ellipse: "draw.tool.ellipse",
  circle: "draw.kind.circle",
  line: "draw.tool.line",
  polyline: "draw.kind.polyline",
  polygon: "draw.kind.polygon",
  text: "draw.kind.text",
  image: "draw.kind.image",
};

/// I poligoni regolari che hanno un nome, per numero di lati.
const NGONS: ReadonlyMap<number, DrawKey> = new Map<number, DrawKey>([
  [3, "draw.kind.ngon.3"],
  [4, "draw.kind.ngon.4"],
  [5, "draw.kind.ngon.5"],
  [6, "draw.kind.ngon.6"],
  [7, "draw.kind.ngon.7"],
  [8, "draw.kind.ngon.8"],
  [9, "draw.kind.ngon.9"],
  [10, "draw.kind.ngon.10"],
  [11, "draw.kind.ngon.11"],
  [12, "draw.kind.ngon.12"],
]);

/// Il nome di un poligono regolare o di una stella: «Esagono», «Poligono di
/// 20 lati», «Stella a 5 punte».
export function polygonalKind(polygonal: Pick<Polygonal, "shape" | "count">): string {
  const { shape, count } = polygonal;
  if (shape === "star") return t("draw.kind.star", { count });
  const named = NGONS.get(count);
  return named === undefined ? t("draw.kind.ngon", { count }) : t(named);
}

/// Che cosa è `item`, a parole: «Rettangolo», «Evidenziatura», «Esagono».
export function kindOf(item: ElementItem): string {
  if (item.role === "stroke" && item.stroke?.tool === "highlighter") return t("draw.kind.highlighter");
  if (item.polygonal !== undefined) return polygonalKind(item.polygonal);
  return t(KINDS[item.role as keyof typeof KINDS]);
}

/// Un testo come nome: gli spazi raccolti, e tagliato con i puntini oltre
/// [`NAME_CHARS`] caratteri.
function nameOf(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  const chars = Array.from(collapsed);
  return chars.length <= NAME_CHARS ? collapsed : `${chars.slice(0, NAME_CHARS - 1).join("").trimEnd()}…`;
}

interface Building {
  readonly item: ElementItem;
  readonly key: string;
  readonly name: string | null;
  readonly target: string | null;
  readonly children: Building[];
}

/// Gli oggetti di `items` in albero: i figli della radice in cima, e sotto
/// ciascun contenitore i suoi. Titolo, descrizione e carta non sono oggetti:
/// il primo `title` di un oggetto ne è il nome, anche al posto delle parole
/// di un testo, perché è il nome che qualcuno gli ha dato; un livello tiene
/// il suo, se ne ha uno. `targets` dice dove portano i collegamenti.
export function outline(items: readonly Item[], targets: LinkTargets = () => null): OutlineNode[] {
  const top: Building[] = [];
  const byPath = new Map<string, Building>();
  for (const item of items) {
    if (item.kind !== "element" || item.path.length === 0) continue;
    const parent = item.path.length === 1 ? null : byPath.get(item.path.slice(0, -1).join("."));
    if (item.path.length > 1 && parent === undefined) continue;
    if (NOT_OBJECTS.has(item.role)) continue;
    const title = nameOf(item.title ?? "");
    const name = item.role === "layer"
      ? nameOf(item.layer?.name ?? "") ?? title
      : title ?? (item.role === "text" ? nameOf((item.lines ?? []).join(" ")) : null);
    const node: Building = { item, key: keyOf(item), name, target: item.role === "link" ? targets(item) : null, children: [] };
    byPath.set(item.path.join("."), node);
    (parent?.children ?? top).push(node);
  }
  return top;
}

export interface DescribeOptions {
  /// Il nome del colore, se chi descrive lo sa.
  readonly color?: string | null;
  /// Dice quanti oggetti contiene un gruppo, per chi non ne mostra i figli.
  readonly parts?: boolean;
  /// Dice se è bloccato o nascosto; sì, se non si dice altro.
  readonly state?: boolean;
}

/// Il nome di un oggetto a parole: «Rettangolo», «Testo «Cucina»», «Livello
/// «Sfondo», bloccato», «Collegamento a «Pioggia»».
export function describe(node: OutlineNode, options: DescribeOptions = {}): string {
  const item = node.item;
  const kind = kindOf(item);
  const named = node.name === null ? kind : t("draw.describe.named", { kind, name: node.name });
  const parts = [node.target === null ? named : t("draw.describe.link", { link: named, note: linkName(node.target) })];
  if (item.locked && options.state !== false) parts.push(t("draw.state.locked"));
  if (item.hidden && options.state !== false) parts.push(t("draw.state.hidden"));
  if (options.color) parts.push(options.color);
  if (options.parts && (item.role === "group" || item.role === "link")) {
    parts.push(plural(node.children.length, "draw.describe.parts.one", "draw.describe.parts.other"));
  }
  return parts.join(", ");
}

/// Quanti oggetti ha il disegno, contati come li sceglie l'editor: i figli
/// dei livelli e gli oggetti alla radice, un gruppo per uno.
export function countObjects(nodes: readonly OutlineNode[]): number {
  let count = 0;
  for (const node of nodes) count += node.item.role === "layer" ? node.children.length : 1;
  return count;
}
