// Il disegno a parole: gli oggetti in albero, ciascuno col suo nome, per
// l'albero degli oggetti dell'editor e per l'elenco della Lettura.
//
// Il dato è quello della scena, le voci in ordine di documento che il lettore
// ricava dal testo: lo stesso per l'editor e per un documento che si guarda
// soltanto, e nessun secondo calcolo. Un nome dice che cosa è l'oggetto e,
// quando lo sa, come si chiama: il `title` di un gruppo, le parole di un
// testo, il nome di un livello. Lo stato di un livello è una parola, non un
// colore. Il colore di un oggetto lo aggiunge chi lo conosce: l'editor, che
// ha il painter.

import { plural, t, type Key } from "../../i18n/strings";
import type { Role } from "./scene/analysis";
import type { ElementItem, Item } from "./scene/classify";

/// Quanti caratteri di un testo entrano nel nome di un oggetto.
const NAME_CHARS = 60;

/// Un oggetto del disegno coi suoi figli, in ordine di documento.
export interface OutlineNode {
  readonly item: ElementItem;
  /// La chiave con cui l'editor sceglie l'oggetto: l'id, o `@` e il percorso.
  readonly key: string;
  /// Il nome proprio: il `title` dell'oggetto, il testo, il nome del livello;
  /// `null` se non ne ha.
  readonly name: string | null;
  readonly children: readonly OutlineNode[];
}

/// La chiave con cui l'editor sceglie un oggetto.
export function keyOf(item: { readonly id: string | null; readonly path: readonly number[] }): string {
  return item.id ?? `@${item.path.join(".")}`;
}

/// I ruoli che non sono oggetti: il nome e la descrizione di chi li contiene,
/// e la carta, che è il fondo.
const NOT_OBJECTS: ReadonlySet<Role> = new Set<Role>(["title", "desc", "paper"]);

const KINDS: Readonly<Record<Exclude<Role, "title" | "desc" | "paper">, Key>> = {
  layer: "draw.kind.layer",
  group: "draw.kind.group",
  link: "draw.kind.link",
  stroke: "draw.kind.stroke",
  arrow: "draw.tool.arrow",
  path: "draw.kind.path",
  rect: "draw.tool.rect",
  ellipse: "draw.tool.ellipse",
  circle: "draw.kind.circle",
  line: "draw.tool.line",
  polyline: "draw.kind.polyline",
  polygon: "draw.kind.polygon",
  text: "draw.kind.text",
  image: "draw.kind.image",
};

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
  name: string | null;
  readonly children: Building[];
}

/// Gli oggetti di `items` in albero: i figli della radice in cima, e sotto
/// ciascun contenitore i suoi. Titolo, descrizione e carta non sono oggetti:
/// il `title` di un contenitore ne diventa il nome.
export function outline(items: readonly Item[]): OutlineNode[] {
  const top: Building[] = [];
  const byPath = new Map<string, Building>();
  for (const item of items) {
    if (item.kind !== "element" || item.path.length === 0) continue;
    const parent = item.path.length === 1 ? null : byPath.get(item.path.slice(0, -1).join("."));
    if (item.path.length > 1 && parent === undefined) continue;
    if (NOT_OBJECTS.has(item.role)) {
      if (item.role === "title" && parent !== null && parent !== undefined && parent.name === null) parent.name = nameOf(item.text ?? "");
      continue;
    }
    const node: Building = { item, key: keyOf(item), name: null, children: [] };
    if (item.role === "layer") node.name = nameOf(item.layer?.name ?? "");
    else if (item.role === "text") node.name = nameOf((item.lines ?? []).join(" "));
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
}

/// Il nome di un oggetto a parole: «Rettangolo», «Testo «Cucina»», «Livello
/// «Sfondo», bloccato».
export function describe(node: OutlineNode, options: DescribeOptions = {}): string {
  const item = node.item;
  const role = item.role as keyof typeof KINDS;
  const kind = t(item.role === "stroke" && item.stroke?.tool === "highlighter" ? "draw.kind.highlighter" : KINDS[role]);
  const parts = [node.name === null ? kind : t("draw.describe.named", { kind, name: node.name })];
  if (item.layer?.locked) parts.push(t("draw.state.locked"));
  if (item.layer?.hidden) parts.push(t("draw.state.hidden"));
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
