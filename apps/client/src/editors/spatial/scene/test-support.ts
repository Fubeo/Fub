// Gli strumenti dei test della scena: i documenti di prova, il controllo che
// una scena copra la sorgente senza perdere un byte (`check_lossless` di
// `crates/fub-scene/tests/common/mod.rs`) e i generatori delle fixture grandi
// di `crates/fub-scene/tests/mirror.rs`, rifatti qui passo per passo.

import { expect } from "vitest";
import { encodeInk, decodeInk, inkDuration, inkFromSamples, inkLength, inkSample, type Ink } from "../ink/codec";
import { INK_MAX_SAMPLES, type InkSample, type InkScale } from "../ink/sample";
import type { Role } from "./analysis";
import type { ElementItem, ForeignItem, Item, Tags } from "./classify";
import type { Diagnostic } from "./diagnostics";
import { readScene, MAX_ELEMENTS, type Scene } from "./read";
import { utf8Length, type Span } from "./text";
import { FUB_NS, SVG_NS } from "./xml";

/// La radice di un documento FubDraw di prova, con i tre namespace.
export const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1" viewBox="0 0 100 100">';

/// Un documento FubDraw con `body` dentro la radice.
export function doc(body: string): string {
  return `${HEAD}${body}</svg>`;
}

/// Legge `source`, che deve essere una scena, e verifica che le voci la
/// coprano senza perdite.
export function load(source: string): Scene {
  const scene = readScene(source);
  checkLossless(source, scene);
  return scene;
}

/// La diagnostica tranne S001: i documenti di prova non hanno un titolo.
export function findings(scene: Scene): Diagnostic[] {
  return scene.diagnostics.filter((d) => d.code !== "S001");
}

export function elements(scene: Scene): ElementItem[] {
  return scene.items.filter((item): item is ElementItem => item.kind === "element");
}

export function foreign(scene: Scene): ForeignItem[] {
  return scene.items.filter((item): item is ForeignItem => item.kind === "foreign");
}

/// La voce modificabile al percorso `path`.
export function at(scene: Scene, path: readonly number[]): ElementItem | undefined {
  return elements(scene).find((e) => e.path.length === path.length && e.path.every((v, i) => v === path[i]));
}

/// Il ruolo dell'elemento al percorso `path`, o `null` se è estraneo.
/// Fallisce se a quel percorso non c'è niente.
export function role(scene: Scene, path: readonly number[]): Role | null {
  const element = at(scene, path);
  if (element !== undefined) return element.role;
  if (path.length === 0) throw new Error("un percorso non vuoto");
  const parent = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const covered = foreign(scene).some(
    (block) =>
      block.parentPath !== null &&
      block.parentPath.length === parent.length &&
      block.parentPath.every((v, i) => v === parent[i]) &&
      block.elements[0] <= index &&
      index < block.elements[1],
  );
  if (!covered) throw new Error(`nessun elemento al percorso ${JSON.stringify(path)}`);
  return null;
}

/// Il ruolo del primo figlio della radice di `doc(body)`.
export function first(body: string): Role | null {
  return role(load(doc(body)), [0]);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/// Il testo dei byte `[from, to)` di `source`.
export function slice(bytes: Uint8Array, span: Span): string {
  return decoder.decode(bytes.subarray(span.bytes[0], span.bytes[1]));
}

/// Il testo di uno span di `source`, dai suoi byte UTF-8.
export function text(source: string, span: Span): string {
  return slice(encoder.encode(source), span);
}

function isXmlSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\r" || c === "\n";
}

/// L'offset UTF-16 di ogni byte di `source` nel testo normalizzato a LF: il
/// BOM conta, un `\r` prima di `\n` no. `-1` dove un byte sta in mezzo a un
/// carattere.
export function utf16Prefix(source: string): Int32Array {
  const out = new Int32Array(utf8Length(source) + 1).fill(-1);
  let byte = 0;
  let units = 0;
  for (let i = 0; i < source.length; ) {
    const cp = source.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    out[byte] = units;
    if (!(cp === 0x0d && source.charCodeAt(i + 1) === 0x0a)) units += width;
    byte += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += width;
  }
  out[byte] = units;
  return out;
}

/// Quanti elementi stanno al primo livello di un frammento ben formato: un
/// contatore indipendente dal lettore.
export function countElements(fragment: string): number {
  let i = 0;
  let depth = 0;
  let count = 0;
  const skip = (from: number, end: string): number => {
    const found = fragment.indexOf(end, from);
    if (found < 0) throw new Error("non chiuso");
    return found + end.length;
  };
  while (i < fragment.length) {
    if (fragment[i] !== "<") {
      i++;
      continue;
    }
    if (fragment.startsWith("<!--", i)) i = skip(i, "-->");
    else if (fragment.startsWith("<![CDATA[", i)) i = skip(i, "]]>");
    else if (fragment.startsWith("<?", i)) i = skip(i, "?>");
    else if (fragment.startsWith("<!", i)) i = skipMarkup(fragment, i);
    else if (fragment.startsWith("</", i)) {
      depth--;
      i = skip(i, ">");
    } else {
      const end = skipMarkup(fragment, i);
      if (depth === 0) count++;
      if (fragment[end - 2] !== "/") depth++;
      i = end;
    }
  }
  return count;
}

/// L'indice dopo il `>` che chiude il markup che comincia a `start`, saltando
/// i valori fra virgolette e le parentesi quadre di un `DOCTYPE`.
function skipMarkup(text: string, start: number): number {
  let quote: string | null = null;
  let brackets = 0;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[") brackets++;
    else if (c === "]") brackets--;
    else if (c === ">" && brackets === 0) return i + 1;
  }
  throw new Error(`markup non chiuso a ${start}`);
}

type Indices = { one: number } | { range: readonly [number, number] };

/// Verifica che ogni contenitore, il documento compreso, sia coperto dalle
/// voci dei suoi figli e da spazi soltanto; che gli indici degli elementi
/// siano contigui e contino davvero gli elementi della sorgente; che gli span
/// UTF-16 siano quelli del testo normalizzato a LF.
export function checkLossless(source: string, scene: Scene): void {
  if (scene.truncated || scene.readOnly.includes("too-many-elements")) {
    expect(scene.items).toEqual([]);
    return;
  }
  const bytes = encoder.encode(source);
  const utf16 = utf16Prefix(source);
  const text = (span: Span): string => slice(bytes, span);
  // L'inizio di ogni riga, in byte.
  const lineStarts = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a || bytes[i] === 0x0d) lineStarts.push(i + 1);
  // I controlli che passano non costruiscono messaggi: una scena densa ha
  // decine di migliaia di span.
  const checkSpan = (span: Span): void => {
    const [from, to] = span.bytes;
    if (from <= to && utf16[from] === span.utf16[0] && utf16[to] === span.utf16[1]) return;
    expect(from).toBeLessThanOrEqual(to);
    expect([utf16[from], utf16[to]], `UTF-16 di ${JSON.stringify(text(span))}`).toEqual([...span.utf16]);
  };
  const key = (path: readonly number[] | null): string => (path === null ? "doc" : path.join("/"));
  const bom = source.startsWith("﻿") ? 3 : 0;
  const containers = new Map<string, [number, number]>([["doc", [bom, bytes.length]]]);
  const children = new Map<string, Array<[Span, Indices]>>();
  const push = (parent: string, entry: [Span, Indices]): void => {
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [entry]);
    else list.push(entry);
  };
  const content = (path: readonly number[], tags: Tags, span: Span): void => {
    checkSpan(tags.open);
    expect(tags.open.bytes[0]).toBe(span.bytes[0]);
    if (tags.close !== null) {
      checkSpan(tags.close);
      expect(text(tags.open).endsWith(">")).toBe(true);
      expect(text(tags.close).startsWith("</")).toBe(true);
      expect(tags.close.bytes[1]).toBe(span.bytes[1]);
      containers.set(key(path), [tags.open.bytes[1], tags.close.bytes[0]]);
    } else {
      expect(tags.open.bytes).toEqual(span.bytes);
      expect(text(span).endsWith("/>")).toBe(true);
    }
  };
  for (const item of scene.items as Item[]) {
    if (item.kind === "root") {
      checkSpan(item);
      content([], item.tags, item);
      push("doc", [item, { one: 0 }]);
    } else if (item.kind === "element") {
      checkSpan(item);
      const itemText = text(item);
      if (!(itemText.startsWith("<") && itemText.endsWith(">"))) throw new Error(`voce senza tag: ${itemText}`);
      const start = item.bytes[0];
      // L'ultima riga che comincia entro `start`.
      let lo = 0;
      let hi = lineStarts.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (lineStarts[mid]! <= start) lo = mid + 1;
        else hi = mid;
      }
      // Il rientro è la testa della riga: si confronta sui byte, senza
      // decodificare la riga fino all'elemento, che in un file scritto su
      // una riga sola renderebbe il controllo quadratico.
      let lineStart = lineStarts[lo - 1]!;
      if (lineStart === 0 && bom > 0) lineStart = bom;
      const indent = encoder.encode(item.indent);
      const head = bytes.subarray(lineStart, lineStart + indent.length);
      if (lineStart + indent.length > start || !head.every((b, i) => b === indent[i])) {
        throw new Error(`rientro ${JSON.stringify(item.indent)} su ${JSON.stringify(decoder.decode(bytes.subarray(lineStart, start)))}`);
      }
      if (item.tags !== undefined) content(item.path, item.tags, item);
      push(key(item.path.slice(0, -1)), [item, { one: item.path[item.path.length - 1]! }]);
    } else {
      checkSpan(item);
      const blockText = text(item);
      const trimmed = blockText.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
      expect(trimmed).not.toBe("");
      expect(trimmed, blockText).toBe(blockText);
      push(key(item.parentPath), [item, { range: item.elements }]);
    }
  }
  for (const parent of children.keys()) expect(containers.has(parent), `${parent} non è un contenitore`).toBe(true);
  for (const [parent, [start, end]] of containers) {
    let cursor = start;
    let next = 0;
    for (const [span, indices] of children.get(parent) ?? []) {
      expect(span.bytes[0], `voci sovrapposte in ${parent}`).toBeGreaterThanOrEqual(cursor);
      const gap = decoder.decode(bytes.subarray(cursor, span.bytes[0]));
      expect([...gap].every(isXmlSpace), `byte di nessuno in ${parent}: ${JSON.stringify(gap)}`).toBe(true);
      cursor = span.bytes[1];
      if ("one" in indices) {
        expect(indices.one, `indici in ${parent}`).toBe(next);
        next++;
      } else {
        const [from, to] = indices.range;
        expect(from, `indici in ${parent}`).toBe(next);
        expect(to - from).toBe(countElements(text(span)));
        next = to;
      }
    }
    expect(cursor).toBeLessThanOrEqual(end);
    const gap = decoder.decode(bytes.subarray(cursor, end));
    expect([...gap].every(isXmlSpace), `byte di nessuno in ${parent}: ${JSON.stringify(gap)}`).toBe(true);
    expect(next, `elementi di ${parent}`).toBe(countElements(decoder.decode(bytes.subarray(start, end))));
  }
  // Gli span dell'indice e della diagnostica, nelle due coordinate.
  const { index } = scene;
  for (const excerpt of [...(index.title ? [index.title] : []), ...(index.desc ? [index.desc] : []), ...index.texts]) {
    checkSpan(excerpt);
    expect(text(excerpt).startsWith("<")).toBe(true);
  }
  for (const reference of [...index.links, ...index.embeds]) {
    checkSpan(reference);
    checkSpan(reference.href);
    expect(reference.bytes[0] < reference.href.bytes[0] && reference.href.bytes[1] < reference.bytes[1]).toBe(true);
  }
  for (const diagnostic of scene.diagnostics) {
    if (diagnostic.bytes !== undefined) checkSpan({ bytes: diagnostic.bytes, utf16: diagnostic.utf16! });
  }
}

// ---------------------------------------------------------------------------
// I generatori di `mirror.rs`.
// ---------------------------------------------------------------------------

/// mulberry32, come `Mulberry32` di `mirror.rs`: uno stato che avanza di
/// `0x6d2b79f5` a ogni numero, in aritmetica a 32 bit.
export class Mulberry32 {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /// Un intero in `0..n`, col resto.
  below(n: number): number {
    return this.next() % n;
  }

  /// `below(n)` diviso per `unit`, in doppia precisione.
  fraction(n: number, unit: number): number {
    return this.below(n) / unit;
  }
}

/// FNV-1a a 32 bit sui byte UTF-8, in esadecimale su otto cifre.
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/// `value` con `digits` decimali impliciti, senza zeri finali e senza
/// esponente: `decimal(12050, 2)` è `120.5`.
export function decimal(value: number, digits: number): string {
  const unit = 10 ** digits;
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const integer = Math.floor(magnitude / unit);
  const fraction = magnitude % unit;
  let out = `${sign}${integer}`;
  if (fraction > 0) out += `.${String(fraction).padStart(digits, "0").replace(/0+$/, "")}`;
  return out;
}

type Child = { element: El } | { raw: string };

/// Un elemento con gli attributi nell'ordine in cui li si dà.
export class El {
  private readonly attrs: Array<[string, string]> = [];
  private body: string | null = null;
  private readonly children: Child[] = [];

  constructor(private readonly name: string) {}

  a(name: string, value: string | number): El {
    this.attrs.push([name, String(value)]);
    return this;
  }

  text(text: string): El {
    this.body = text;
    return this;
  }

  child(child: El): El {
    this.children.push({ element: child });
    return this;
  }

  raw(line: string): El {
    this.children.push({ raw: line });
    return this;
  }

  /// Scrive l'elemento come §7: una riga per elemento, due spazi di rientro
  /// per livello, il testo sulla riga del tag, i gruppi vuoti aperti.
  write(depth: number, newline: string, out: string[]): void {
    const indent = "  ".repeat(depth);
    out.push(indent, "<", this.name);
    for (const [name, value] of this.attrs) out.push(" ", name, '="', escape(value, true), '"');
    if (this.body !== null) {
      out.push(">", escape(this.body, false), `</${this.name}>`);
    } else if (this.children.length === 0 && this.name !== "g") {
      out.push("/>");
    } else {
      out.push(">", newline);
      for (const child of this.children) {
        if ("element" in child) child.element.write(depth + 1, newline, out);
        else out.push("  ".repeat(depth + 1), child.raw, newline);
      }
      out.push(indent, `</${this.name}>`);
    }
    out.push(newline);
  }
}

/// Gli escape di §7: negli attributi anche virgolette, tabulazioni e a capo.
function escape(text: string, attribute: boolean): string {
  let out = "";
  for (const c of text) {
    if (c === "&") out += "&amp;";
    else if (c === "<") out += "&lt;";
    else if (c === ">") out += "&gt;";
    else if (attribute && c === '"') out += "&quot;";
    else if (attribute && c === "\t") out += "&#9;";
    else if (attribute && c === "\n") out += "&#10;";
    else if (attribute && c === "\r") out += "&#13;";
    else out += c;
  }
  return out;
}

function svg(width: number, height: number): El {
  return new El("svg")
    .a("xmlns", SVG_NS)
    .a("xmlns:fub", FUB_NS)
    .a("fub:version", 1)
    .a("viewBox", `0 0 ${width} ${height}`)
    .a("width", width)
    .a("height", height);
}

function paper(width: number, height: number): El {
  return new El("rect")
    .a("id", "fub-paper")
    .a("fub:role", "paper")
    .a("x", 0)
    .a("y", 0)
    .a("width", width)
    .a("height", height)
    .a("fill", "#ffffff");
}

function layer(id: string, name: string): El {
  return new El("g").a("id", id).a("fub:layer", name);
}

function document(root: El, newline: string): string {
  const out: string[] = [];
  root.write(0, newline, out);
  return out.join("");
}

/// Il `d` di un tratto: la spezzata dei suoi campioni quantizzati, chiusa.
function polylineD(ink: Ink): string {
  const digits = ink.scale === 10 ? 1 : 2;
  const parts: string[] = [];
  for (let i = 0; i < inkLength(ink); i++) {
    const sample = inkSample(ink, i);
    parts.push(`${i === 0 ? "M" : " L"}${decimal(sample[0]!, digits)} ${decimal(sample[1]!, digits)}`);
  }
  return `${parts.join("")} Z`;
}

function stroke(id: string, tool: string, at: string, brush: string, ink: string, d: string, fill: string): El {
  let element = new El("path")
    .a("id", id)
    .a("fub:tool", tool)
    .a("fub:at", at)
    .a("fub:brush", brush)
    .a("d", d)
    .a("fill", fill);
  if (tool === "highlighter") element = element.a("fill-opacity", "0.4");
  return element.a("fub:ink", ink);
}

function drawn(
  id: string,
  tool: string,
  at: string,
  brush: string,
  samples: InkSample[],
  scale: InkScale,
  fill: string,
): El {
  const ink = inkFromSamples(samples, scale);
  expect(decodeInk(encodeInk(ink))).toEqual(ink);
  return stroke(id, tool, at, brush, encodeInk(ink), polylineD(ink), fill);
}

const BRUSH =
  "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1";

const BRUSHES = [
  BRUSH,
  "pf1 size=8 thinning=0.6 smoothing=0.5 streamline=0.4 taperStart=12 taperEnd=12 capStart=0 capEnd=0",
  "pf1 size=2.5 thinning=-0.2 smoothing=0.7 streamline=0.6 taperStart=0 taperEnd=0 capStart=1 capEnd=1",
];

const PALETTE = ["#000000", "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#f0e442", "#e69f00", "#56b4e9"];

const WORDS = ["mare", "nuvola", "pioggia", "fiume", "vento", "sole", "neve", "lago"];

export const DENSE_SEED = 0x20261002;
export const INK_SEED = 0x20261003;

function randomPoints(rng: Mulberry32, count: number): string {
  const points: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = rng.below(160_000);
    const y = rng.below(100_000);
    points.push(`${decimal(x, 2)} ${decimal(y, 2)}`);
  }
  return points.join(" ");
}

/// `dense` di `mirror.rs`: un disegno FubDraw di esattamente `MAX_ELEMENTS`
/// elementi, con le estrazioni nello stesso ordine.
export function dense(seed: number): string {
  const LAYERS = 8;
  const rng = new Mulberry32(seed);
  let nextId = 0;
  const id = (): string => `o${String(++nextId).padStart(8, "0")}`;
  const budget = MAX_ELEMENTS - 3 - LAYERS;
  let root = svg(1600, 1000).child(new El("title").text("Denso")).child(paper(1600, 1000));
  let last = "fub-paper";
  const rect = (me: string): El =>
    new El("rect")
      .a("id", me)
      .a("x", decimal(rng.below(160_000), 2))
      .a("y", decimal(rng.below(100_000), 2))
      .a("width", decimal(1 + rng.below(20_000), 2))
      .a("height", decimal(1 + rng.below(20_000), 2))
      .a("fill", PALETTE[rng.below(8)]!);
  const circle = (me: string): El =>
    new El("circle")
      .a("id", me)
      .a("cx", decimal(rng.below(160_000), 2))
      .a("cy", decimal(rng.below(100_000), 2))
      .a("r", decimal(1 + rng.below(10_000), 2))
      .a("fill", PALETTE[rng.below(8)]!);
  for (let k = 1; k <= LAYERS; k++) {
    let quota = Math.floor(budget / LAYERS) + (k === LAYERS ? budget % LAYERS : 0);
    let group = layer(`l${String(k).padStart(8, "0")}`, `Livello ${k}`);
    while (quota > 0) {
      let kind = rng.below(10);
      const tspans = kind === 7 ? 1 + rng.below(3) : 0;
      const cost = kind === 7 ? 1 + tspans : kind === 8 ? 3 : 1;
      if (cost > quota) kind = 0;
      const me = id();
      let element: El;
      switch (kind) {
        case 0:
          element = rect(me);
          break;
        case 1:
          element = new El("ellipse")
            .a("id", me)
            .a("cx", decimal(rng.below(160_000), 2))
            .a("cy", decimal(rng.below(100_000), 2))
            .a("rx", decimal(1 + rng.below(20_000), 2))
            .a("ry", decimal(1 + rng.below(20_000), 2))
            .a("fill", PALETTE[rng.below(8)]!);
          break;
        case 2:
          element = circle(me);
          break;
        case 3: {
          const p = randomPoints(rng, 2).split(" ");
          element = new El("line")
            .a("id", me)
            .a("x1", p[0]!)
            .a("y1", p[1]!)
            .a("x2", p[2]!)
            .a("y2", p[3]!)
            .a("stroke", PALETTE[rng.below(8)]!)
            .a("stroke-width", 2);
          break;
        }
        case 4: {
          const count = 3 + rng.below(4);
          element = new El("polyline")
            .a("id", me)
            .a("points", randomPoints(rng, count))
            .a("fill", "none")
            .a("stroke", PALETTE[rng.below(8)]!);
          break;
        }
        case 5: {
          const count = 3 + rng.below(4);
          element = new El("polygon").a("id", me).a("points", randomPoints(rng, count)).a("fill", PALETTE[rng.below(8)]!);
          break;
        }
        case 6: {
          let d = `M${randomPoints(rng, 1)}`;
          for (let s = 0; s < 3; s++) {
            switch (rng.below(4)) {
              case 0:
                d += ` L${randomPoints(rng, 1)}`;
                break;
              case 1:
                d += ` Q${randomPoints(rng, 2)}`;
                break;
              case 2:
                d += ` C${randomPoints(rng, 3)}`;
                break;
              default: {
                const r = decimal(1 + rng.below(20_000), 2);
                const large = rng.below(2);
                const sweep = rng.below(2);
                const to = randomPoints(rng, 1);
                d += ` A${r} ${r} 0 ${large} ${sweep} ${to}`;
              }
            }
          }
          element = new El("path").a("id", me).a("d", d).a("fill", "none").a("stroke", PALETTE[rng.below(8)]!);
          break;
        }
        case 7: {
          const x = decimal(rng.below(160_000), 2);
          let text = new El("text")
            .a("id", me)
            .a("x", x)
            .a("y", decimal(rng.below(100_000), 2))
            .a("fill", "#000000")
            .a("font-family", "Inter, sans-serif")
            .a("font-size", 16);
          for (let line = 0; line < tspans; line++) {
            const dy = line === 0 ? 0 : 20;
            const word = WORDS[rng.below(8)]!;
            text = text.child(new El("tspan").a("x", x).a("dy", dy).text(word));
          }
          element = text;
          break;
        }
        case 8: {
          const dx = rng.below(1000);
          const dy = rng.below(1000);
          element = new El("g").a("id", me).a("transform", `translate(${dx} ${dy})`);
          element.child(rect(id())).child(circle(id()));
          break;
        }
        default:
          element = new El("use").a("id", me).a("href", `#${last}`);
      }
      last = me;
      quota -= kind === 0 ? 1 : cost;
      group = group.child(element);
    }
    root = root.child(group);
  }
  return document(root, "\n");
}

/// `ink` di `mirror.rs`: quaranta tratti generati e quantizzati, e quanti
/// campioni hanno in tutto.
export function ink(seed: number): [source: string, samples: number] {
  const rng = new Mulberry32(seed);
  let strokes = layer("l00000001", "Livello 1");
  let clock = 0;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const count = i === 0 ? 1 : i === 1 ? 2 : i === 2 ? INK_MAX_SAMPLES : 2 + rng.below(1500);
    const pressure = rng.below(2) === 1 || i === 2;
    const tilt = rng.below(2) === 1 || i === 2;
    const scale: InkScale = rng.below(2) === 1 || i === 2 ? 100 : 10;
    const highlighter = rng.below(8) === 0;
    const fill = highlighter ? PALETTE[5]! : PALETTE[rng.below(8)]!;
    const brush = `${BRUSHES[rng.below(3)]!} sim=${pressure ? 0 : 1}`;
    clock += rng.below(2000);
    const samples: InkSample[] = [];
    let x = 0;
    let y = 0;
    let t = 0;
    for (let k = 0; k < count; k++) {
      if (k === 0) {
        x = rng.fraction(160_000, 100);
        y = rng.fraction(100_000, 100);
      } else {
        x += (rng.below(2001) - 1000) / 1000;
        y += (rng.below(2001) - 1000) / 1000;
      }
      const p = pressure ? rng.fraction(1001, 1000) : undefined;
      if (k > 0) t += rng.fraction(17_001, 1000);
      if (tilt) {
        const a = rng.fraction(90_001, 1000);
        const z = rng.fraction(360_000, 1000);
        samples.push(p === undefined ? { x, y, t, a, z } : { x, y, p, t, a, z });
      } else {
        samples.push(p === undefined ? { x, y, t } : { x, y, p, t });
      }
    }
    const quantized = inkFromSamples(samples, scale);
    const h = 9 + Math.floor(clock / 3_600_000);
    const m = Math.floor(clock / 60_000) % 60;
    const s = Math.floor(clock / 1000) % 60;
    const ms = clock % 1000;
    const pad = (v: number, n: number): string => String(v).padStart(n, "0");
    const when = `2026-10-02T${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}Z`;
    const tool = highlighter ? "highlighter" : "pen";
    strokes = strokes.child(drawn(`o${pad(i + 1, 8)}`, tool, when, brush, samples, scale, fill));
    clock += Math.max(inkDuration(quantized) ?? 0, 0);
    total += inkLength(quantized);
  }
  const root = svg(1600, 1000).child(new El("title").text("Inchiostro")).child(paper(1600, 1000)).child(strokes);
  return [document(root, "\n"), total];
}

/// Quel che `generated.json` fissa di una fixture generata.
export function facts(seed: number, source: string, scene: Scene): unknown {
  const codes: Record<string, number> = {};
  for (const diagnostic of scene.diagnostics) codes[diagnostic.code] = (codes[diagnostic.code] ?? 0) + 1;
  return {
    seed,
    bytes: utf8Length(source),
    fnv1a: fnv1a(source),
    items: scene.items.length,
    diagnostics: codes,
    summary: scene.summary,
  };
}
