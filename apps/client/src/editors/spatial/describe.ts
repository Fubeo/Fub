// Il disegno a parole: gli oggetti in albero, ciascuno col suo nome, per
// l'albero degli oggetti dell'editor e per l'elenco della Lettura.
//
// Il dato è quello della scena, le voci in ordine di documento che il lettore
// ricava dal testo: lo stesso per l'editor e per un documento che si guarda
// soltanto, e nessun secondo calcolo. Un nome dice che cosa è l'oggetto e,
// quando lo sa, come si chiama: il suo `title`, o le parole di un testo o
// dell'etichetta di una forma, o il nome di un livello. Una forma con
// l'etichetta si chiama con le parole che si vedono, e il suo `title`, se ne
// ha uno, dice che cosa è al posto del tipo. Un collegamento dice anche dove
// porta, col nome della nota, e un connettore da che cosa a che cosa va. Lo
// stato di un livello è una parola, non un colore. Il colore di un oggetto lo
// aggiunge chi lo conosce: l'editor, che ha il painter.

import { pageName } from "../../rules/mirrored";
import { plural, t, type DrawKey } from "./strings";
import type { Role } from "./scene/analysis";
import type { ConnectorFacts, ElementItem, Item } from "./scene/classify";
import type { ConnectorEnd } from "./scene/connectors";
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
  /// di un testo o dell'etichetta di una forma; `null` se non ne ha.
  readonly name: string | null;
  /// Che cosa è, al posto del tipo, per una forma che ha la sua etichetta e
  /// un `title`: il `title`, perché il nome sono le parole dell'etichetta, le
  /// stesse che si vedono. «Decisione «Controlla l'ordine»», non «Tracciato
  /// «Decisione»». Per un'istanza che ha un `title`, il nome del suo
  /// simbolo: «Presa «Cucina»». `null` per ogni altro oggetto, che dice il
  /// suo tipo.
  readonly kind: string | null;
  /// Dove porta un collegamento: il percorso del vault com'è scritto nel suo
  /// `href`. `null` per ogni altro oggetto, e per un collegamento che non
  /// porta nel vault.
  readonly target: string | null;
  /// I due capi di un connettore a parole; `null` per ogni altro oggetto.
  readonly connection: Connection | null;
  /// Il connettore come lo dice l'elenco della Lettura; `null` se un capo è
  /// libero, e per ogni altro oggetto.
  readonly joined: Joined | null;
  readonly children: readonly OutlineNode[];
}

/// I capi di un connettore, le parole già pronte per la frase: il nome
/// proprio dell'oggetto agganciato fra caporali, o il suo tipo se non ne ha
/// uno; `null` per un capo libero. Sono lette al momento, nella lingua di
/// adesso: l'albero resta lo stesso se la lingua cambia.
export interface Connection {
  readonly from: string | null;
  readonly to: string | null;
}

/// Un connettore con tutti e due i capi agganciati, per la Lettura, dove la
/// freccia separa i capi: il nome proprio dell'oggetto o il suo tipo, senza
/// caporali, e le parole della prima etichetta del connettore, se ne ha. Anche
/// questi seguono la lingua.
export interface Joined {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
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
/// la carta, che è il fondo, le risorse con la `defs` che le tiene e i
/// simboli, che si vedono soltanto in chi li usa, e le tavole, che si
/// cambiano col loro strumento.
const NOT_OBJECTS: ReadonlySet<Role> = new Set<Role>(["title", "desc", "paper", "defs", "resource", "board", "symbol"]);

const KINDS: Readonly<Record<Exclude<Role, "title" | "desc" | "paper" | "defs" | "resource" | "board" | "symbol">, DrawKey>> = {
  layer: "draw.kind.layer",
  group: "draw.kind.group",
  link: "draw.kind.link",
  stroke: "draw.kind.stroke",
  arrow: "draw.tool.arrow",
  connector: "draw.kind.connector",
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
  instance: "draw.kind.instance",
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

/// Un testo a parole: gli spazi raccolti; `null` se non ne ha.
function wordsOf(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed === "" ? null : collapsed;
}

/// Le righe di un testo come le legge chi lo guarda: unite con uno spazio,
/// tranne una che continua la parola della riga prima, `fub:join="word"` in
/// un testo in area, che si unisce senza («Pronto» e «?» sono «Pronto?»).
/// Come il paragrafo del formato della scena; `null` se non ne ha.
function textOf(item: ElementItem): string | null {
  let out = "";
  (item.lines ?? []).forEach((line, at) => {
    const words = wordsOf(line);
    if (words !== null) out += out === "" || item.glued?.[at] === true ? words : ` ${words}`;
  });
  return out === "" ? null : out;
}

/// Un testo come nome: gli spazi raccolti, e tagliato con i puntini oltre
/// [`NAME_CHARS`] caratteri.
function nameOf(text: string): string | null {
  const collapsed = wordsOf(text);
  if (collapsed === null) return null;
  const chars = Array.from(collapsed);
  return chars.length <= NAME_CHARS ? collapsed : `${chars.slice(0, NAME_CHARS - 1).join("").trimEnd()}…`;
}

/// Un nodo mentre l'albero si costruisce: il nome e i capi di un connettore
/// si sanno soltanto quando tutti gli oggetti ci sono.
interface Building {
  readonly item: ElementItem;
  readonly key: string;
  name: string | null;
  kind: string | null;
  readonly target: string | null;
  connection: Connection | null;
  joined: Joined | null;
  readonly children: Building[];
}

/// Il nome proprio di `node` fra caporali, o il suo tipo se non ne ha uno.
function endWords(node: Building): string {
  return node.name === null ? kindOf(node.item) : t("draw.describe.quoted", { name: node.name });
}

/// Il nome proprio di `node`, o il suo tipo se non ne ha uno.
function plainWords(node: Building): string {
  return node.name ?? kindOf(node.item);
}

/// I ruoli delle forme che possono avere un'etichetta dentro. Un tracciato
/// conta anche aperto: il nome non chiede la geometria, e l'etichetta che lo
/// nomina dice lo stesso che cosa è.
const LABELLED: ReadonlySet<Role> = new Set<Role>(["rect", "ellipse", "circle", "ngon", "star", "polygon", "path"]);

/// Dà a ogni forma nei gruppi `groups` le parole della sua etichetta, il
/// primo testo che la nomina: sono il testo che si vede, e il nome di chi lo
/// legge lo contiene. Se la forma ha un `title`, questo prende il posto del
/// tipo (vedi [`OutlineNode.kind`]). Il gruppo che tiene soltanto la forma e
/// lei, senza un `title`, si chiama come la forma.
function nameByLabels(groups: readonly Building[]): void {
  for (const group of groups) {
    const seen = new Set<string>();
    for (const label of group.children) {
      const { inside, role, textPath, along } = label.item;
      if (role !== "text" || inside === undefined || textPath !== undefined || along !== undefined || seen.has(inside)) continue;
      seen.add(inside);
      const shape = group.children.find((child) => child.item.id === inside);
      const words = nameOf(textOf(label.item) ?? "");
      if (shape === undefined || !LABELLED.has(shape.item.role) || words === null) continue;
      if (shape.name !== null) shape.kind = shape.name;
      shape.name = words;
      if (group.children.length === 2) group.name ??= words;
    }
  }
}

/// L'oggetto a cui è agganciato un capo, se c'è.
function attached(end: ConnectorEnd | null, byId: ReadonlyMap<string, Building>): Building | null {
  return end === null ? null : byId.get(end.id) ?? null;
}

/// Dà ai connettori in `connectors` i capi e, se non hanno un `title`, il nome
/// delle parole della loro prima etichetta: quella in cima al documento che
/// ne ha. Un capo il cui id non c'è, o è di un livello o di un altro
/// connettore, è libero. `all` sono gli oggetti dell'albero in ordine di
/// documento: una passata sola, con due indici per id.
function connect(all: readonly Building[], connectors: readonly Building[]): void {
  const byId = new Map<string, Building>();
  const labels = new Map<string, string>();
  for (const node of all) {
    const { id, role, along } = node.item;
    if (id !== null && role !== "layer" && role !== "connector" && !byId.has(id)) byId.set(id, node);
    if (along !== undefined && !labels.has(along.id)) {
      const words = textOf(node.item);
      if (words !== null) labels.set(along.id, words);
    }
  }
  for (const node of connectors) {
    const facts: ConnectorFacts | undefined = node.item.connector;
    const start = attached(facts?.from ?? null, byId);
    const end = attached(facts?.to ?? null, byId);
    const label = node.item.id === null ? null : labels.get(node.item.id) ?? null;
    if (node.name === null && label !== null) node.name = nameOf(label);
    node.connection = {
      get from() {
        return start === null ? null : endWords(start);
      },
      get to() {
        return end === null ? null : endWords(end);
      },
    };
    if (start !== null && end !== null) {
      node.joined = {
        get from() {
          return plainWords(start);
        },
        get to() {
          return plainWords(end);
        },
        label,
      };
    }
  }
}

/// Gli oggetti di `items` in albero: i figli della radice in cima, e sotto
/// ciascun contenitore i suoi. Titolo, descrizione e carta non sono oggetti:
/// il primo `title` di un oggetto ne è il nome, anche al posto delle parole
/// di un testo, perché è il nome che qualcuno gli ha dato; un livello tiene
/// il suo, se ne ha uno. `targets` dice dove portano i collegamenti. Una
/// forma con un'etichetta prende il nome dalle sue parole, e il suo `title`
/// dice che cosa è al posto del tipo; il gruppo che tiene soltanto lei e la
/// forma, senza un `title`, ha il nome della forma. Un connettore senza
/// `title` prende il nome dalla sua prima etichetta, e dice a quali oggetti
/// è agganciato. Un'istanza senza `title` si chiama come il suo simbolo;
/// con un `title`, il simbolo dice che cosa è al posto del tipo.
export function outline(items: readonly Item[], targets: LinkTargets = () => null): OutlineNode[] {
  return outlineAll(items, targets).nodes;
}

/// L'albero degli oggetti e, per id, quello del contenuto di ogni simbolo,
/// che non sta sul foglio: l'editor lo mostra quando si modifica il
/// simbolo. I nomi si danno come in [`outline`].
export interface Outline {
  readonly nodes: OutlineNode[];
  readonly symbols: ReadonlyMap<string, readonly OutlineNode[]>;
}

/// [`outline`], coi contenuti dei simboli.
export function outlineAll(items: readonly Item[], targets: LinkTargets = () => null): Outline {
  const top: Building[] = [];
  const contents = new Map<string, Building[]>();
  const byPath = new Map<string, Building>();
  const all: Building[] = [];
  const connectors: Building[] = [];
  const groups: Building[] = [];
  // I simboli non sono oggetti, ma danno il nome alle loro istanze, che
  // possono venire prima di loro nel documento.
  const symbols = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== "element" || item.role !== "symbol" || item.id === null) continue;
    const name = nameOf(item.title ?? "");
    if (name !== null) symbols.set(item.id, name);
  }
  for (const item of items) {
    if (item.kind !== "element" || item.path.length === 0) continue;
    if (item.role === "symbol" && item.id !== null && !contents.has(item.id)) {
      // Un simbolo non è un oggetto: tiene soltanto i figli.
      const children: Building[] = [];
      contents.set(item.id, children);
      byPath.set(item.path.join("."), { item, key: keyOf(item), name: null, kind: null, target: null, connection: null, joined: null, children });
      continue;
    }
    const parent = item.path.length === 1 ? null : byPath.get(item.path.slice(0, -1).join("."));
    if (item.path.length > 1 && parent === undefined) continue;
    if (NOT_OBJECTS.has(item.role)) continue;
    const title = nameOf(item.title ?? "");
    const symbol = item.role === "instance" && item.symbol !== undefined ? (symbols.get(item.symbol) ?? null) : null;
    const name = item.role === "layer"
      ? nameOf(item.layer?.name ?? "") ?? title
      : title ?? (item.role === "text" ? nameOf(textOf(item) ?? "") : symbol);
    const kind = title !== null && symbol !== null && title !== symbol ? symbol : null;
    const node: Building = { item, key: keyOf(item), name, kind, target: item.role === "link" ? targets(item) : null, connection: null, joined: null, children: [] };
    byPath.set(item.path.join("."), node);
    (parent?.children ?? top).push(node);
    all.push(node);
    if (item.role === "connector") connectors.push(node);
    else if (item.role === "group") groups.push(node);
  }
  if (groups.length > 0) nameByLabels(groups);
  if (connectors.length > 0) connect(all, connectors);
  return { nodes: top, symbols: contents };
}

export interface DescribeOptions {
  /// Il nome del colore, se chi descrive lo sa.
  readonly color?: string | null;
  /// Dice quanti oggetti contiene un gruppo, per chi non ne mostra i figli.
  readonly parts?: boolean;
  /// Dice se è bloccato o nascosto; sì, se non si dice altro.
  readonly state?: boolean;
}

/// Il connettore `connector` con i suoi capi: «Connettore da «Ingresso» a
/// «Verifica»», «Connettore da «Ingresso»», «Connettore verso «Verifica»».
function joinedTo(connector: string, connection: Connection | null): string {
  if (connection === null) return connector;
  const { from, to } = connection;
  if (from !== null && to !== null) return t("draw.describe.connector.both", { connector, from, to });
  if (from !== null) return t("draw.describe.connector.from", { connector, from });
  if (to !== null) return t("draw.describe.connector.to", { connector, to });
  return connector;
}

/// Il nome di un oggetto a parole: «Rettangolo», «Testo «Cucina»», «Livello
/// «Sfondo», bloccato», «Collegamento a «Pioggia»».
export function describe(node: OutlineNode, options: DescribeOptions = {}): string {
  const item = node.item;
  const kind = node.kind ?? kindOf(item);
  const named = node.name === null ? kind : t("draw.describe.named", { kind, name: node.name });
  const parts = [node.target === null ? joinedTo(named, node.connection) : t("draw.describe.link", { link: named, note: linkName(node.target) })];
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
