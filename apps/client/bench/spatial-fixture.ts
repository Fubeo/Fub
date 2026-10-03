// I disegni con cui il banco misura l'editor: tre fixture deterministiche,
// scritte dal motore della scena con le operazioni degli strumenti, così il
// testo è quello che l'editor scriverebbe a mano, byte per byte.
//
// - `sparse`: 200 oggetti su un livello, il disegno di una lezione.
// - `dense`: 5 000 oggetti su quattro livelli, il limite del painter SVG DOM.
// - `ink`: 2 000 tratti a penna con la pressione, 100 campioni ciascuno.
//
// Le forme hanno la tavolozza e gli spessori della barra; i tratti hanno il
// pennello che la penna scrive, con `fub:at` a passi fissi da un'ora fissa.
// Il digest FNV-1a del testo fissa la fixture: un cambio del formato o degli
// strumenti lo sposta, e `spatial-fixture.test.ts` lo dice.

import { brushForInput, PF1_DEFAULTS } from "../src/editors/spatial/ink/brush";
import { quantizeInk, type InkSample } from "../src/editors/spatial/ink/sample";
import { SceneEngine } from "../src/editors/spatial/scene/engine";
import type { AddOp } from "../src/editors/spatial/scene/ops";
import type { Elem } from "../src/editors/spatial/scene/serialize";
import { strokeElem } from "../src/editors/spatial/tools/edit";
import { PALETTE, WIDTHS } from "../src/editors/spatial/tools/palette";
import { shapeElem, type ShapeTool } from "../src/editors/spatial/tools/shapes";

export type SpatialFixtureKind = "sparse" | "dense" | "ink";

export const SPATIAL_FIXTURE_KINDS: readonly SpatialFixtureKind[] = ["sparse", "dense", "ink"];

export interface SpatialFixture {
  readonly kind: SpatialFixtureKind;
  /// Il testo del file.
  readonly text: string;
  /// Gli oggetti disegnati, senza la carta e i livelli.
  readonly objects: number;
  readonly layers: number;
  /// I campioni di penna in tutto.
  readonly samples: number;
  /// La lunghezza in UTF-8, cioè il peso del file su disco.
  readonly bytes: number;
  readonly digest: string;
}

interface Recipe {
  readonly title: string;
  readonly seed: number;
  readonly layers: number;
  readonly objects: number;
  /// La parte dei tratti a penna sul totale, in centesimi; il resto sono forme.
  readonly pen: number;
  /// I campioni di un tratto.
  readonly samples: number;
  /// La penna con la pressione, o il mouse con la pressione simulata.
  readonly pressure: boolean;
}

const RECIPES: Readonly<Record<SpatialFixtureKind, Recipe>> = {
  sparse: { title: "Banco sparso", seed: 0x5a17, layers: 1, objects: 200, pen: 25, samples: 40, pressure: false },
  dense: { title: "Banco denso", seed: 0xde45, layers: 4, objects: 5_000, pen: 33, samples: 24, pressure: false },
  ink: { title: "Banco inchiostro", seed: 0x1c4, layers: 1, objects: 2_000, pen: 100, samples: 100, pressure: true },
};

const WIDTH = 1600;
const HEIGHT = 1000;
const SHAPES: readonly ShapeTool[] = ["rect", "ellipse", "line", "arrow"];
/// L'ora del primo tratto; i seguenti a 1,5 s l'uno dall'altro.
const AT = Date.UTC(2026, 9, 3, 9, 0, 0);
const AT_STEP_MS = 1_500;
/// Un campione ogni 8 ms: una penna a 120 Hz.
const SAMPLE_MS = 8;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/// FNV-1a a 32 bit sulle unità UTF-16 del testo.
export function textDigest(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/// Mulberry32: lo stesso generatore delle fixture della scena.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

const id = (prefix: "o" | "l", n: number): string => `${prefix}${n.toString(36).padStart(8, "0")}`;

function head(recipe: Recipe): string {
  const layers = Array.from(
    { length: recipe.layers },
    (_, i) => `  <g id="${id("l", i + 1)}" fub:layer="Livello ${i + 1}">\n  </g>\n`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"`
    + ` viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">\n`
    + `  <title>${recipe.title}</title>\n`
    + `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>\n`
    + layers
    + "</svg>\n"
  );
}

/// Un tratto che curva piano: la direzione gira di poco a ogni campione, come
/// una mano che scrive, e il tratto resta nella pagina.
function stroke(next: () => number, count: number, pressure: boolean): InkSample[] {
  const samples: InkSample[] = [];
  let x = 80 + next() * (WIDTH - 160);
  let y = 80 + next() * (HEIGHT - 160);
  let angle = next() * Math.PI * 2;
  let turn = (next() - 0.5) * 0.2;
  const step = 1.5 + next() * 2.5;
  for (let k = 0; k < count; k++) {
    const t = k * SAMPLE_MS;
    const p = 0.35 + 0.5 * Math.sin((Math.PI * k) / Math.max(1, count - 1)) + (next() - 0.5) * 0.1;
    samples.push(pressure ? { x, y, p: Math.min(1, Math.max(0, p)), t } : { x, y, t });
    turn += (next() - 0.5) * 0.04;
    turn = Math.max(-0.15, Math.min(0.15, turn));
    angle += turn;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    if (x < 20 || x > WIDTH - 20) angle = Math.PI - angle;
    if (y < 20 || y > HEIGHT - 20) angle = -angle;
    x = Math.min(WIDTH - 20, Math.max(20, x));
    y = Math.min(HEIGHT - 20, Math.max(20, y));
  }
  return samples;
}

function shape(next: () => number, n: number, tool: ShapeTool, color: string, width: number): Elem {
  const w = 20 + next() * 220;
  const h = 20 + next() * 160;
  const x = 10 + next() * (WIDTH - w - 20);
  const y = 10 + next() * (HEIGHT - h - 20);
  const flip = tool === "line" || tool === "arrow" ? next() < 0.5 : false;
  const from: [number, number] = [x, flip ? y + h : y];
  const to: [number, number] = [x + w, flip ? y : y + h];
  const elem = shapeElem(tool, id("o", n), from, to, { color, width }, 0);
  if (elem === null) throw new Error(`fixture: ${tool} ${n} è vuoto`);
  return elem;
}

/// Genera la fixture `kind`: lo stesso testo a ogni chiamata, in ogni browser.
export function generateSpatialFixture(kind: SpatialFixtureKind): SpatialFixture {
  const recipe = RECIPES[kind];
  if (recipe === undefined) throw new RangeError(`fixture del disegno sconosciuta: ${String(kind)}`);
  const next = random(recipe.seed);
  const ops: AddOp[] = [];
  let samples = 0;
  let strokes = 0;
  for (let n = 1; n <= recipe.objects; n++) {
    const layer = id("l", 1 + Math.floor(((n - 1) * recipe.layers) / recipe.objects));
    const color = PALETTE[Math.floor(next() * PALETTE.length)]!.color;
    const width = WIDTHS[Math.floor(next() * WIDTHS.length)]!.value;
    let elem: Elem;
    if (next() * 100 < recipe.pen) {
      const brush = brushForInput({ ...PF1_DEFAULTS, size: width, sim: false }, recipe.pressure);
      const ink = quantizeInk(stroke(next, recipe.samples, recipe.pressure));
      const at = new Date(AT + strokes * AT_STEP_MS).toISOString();
      elem = strokeElem(id("o", n), color, brush, ink, at);
      samples += recipe.samples;
      strokes += 1;
    } else {
      elem = shape(next, n, SHAPES[Math.floor(next() * SHAPES.length)]!, color, width);
    }
    ops.push({ op: "add", parent: layer, pos: { last: true }, elem });
  }
  const engine = SceneEngine.open(head(recipe));
  const outcome = engine.apply({ op: "batch", ops });
  if (outcome.outcome === "rejected") {
    throw new Error(`fixture ${kind}: il motore rifiuta l'oggetto ${outcome.index ?? "?"} (${outcome.reason}: ${outcome.detail})`);
  }
  const text = engine.text;
  return {
    kind,
    text,
    objects: recipe.objects,
    layers: recipe.layers,
    samples,
    bytes: new TextEncoder().encode(text).length,
    digest: textDigest(text),
  };
}
