// Gli aiuti dei test del painter SVG DOM (`svg-dom*.test.ts`): il disegno
// ostile, gli URL dei blob contati, l'ospite di 800 per 600 con la sua vita
// e le viste, con `setUp` e `tearDown` che ogni file monta attorno ai test.

import { vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { PaintBuilder, type PaintScene } from "./paint";
import { toScreen, type View } from "../view";
import { LARGE_SCENE_SHAPES } from "./svg-dom";

export const LAYER = '<g id="l1" fub:layer="Livello 1">';

/// Un disegno con tutto ciò che non deve entrare vivo: uno script, un
/// `foreignObject` con HTML, un gestore d'evento, un `use`, un collegamento.
export const HOSTILE = doc(
  `<title>Ostile</title><desc>d</desc>${LAYER}`
    + '<rect id="a" x="1" y="1" width="10" height="10" fill="#ff0000"/>'
    + '<script>parent.rubato = true</script>'
    + '<foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml" onclick="x()">html</div></foreignObject>'
    + '<rect width="5" height="5" onload="x()"/><use href="#a" x="20"/>'
    + '<a href="Note/altra.md"><circle id="c" cx="5" cy="5" r="2"/></a>'
    + '<rect id="b" x="30" y="1" width="10" height="10"/></g>',
);

export let urls = 0;
export const blobs = new Map<string, Blob>();
export const live = new Set<string>();
export let host: HTMLElement;
export let owner: Lifetime;

/// Prima di ogni test: gli URL dei blob contati e l'ospite nuovo, con la sua vita.
export function setUp(): void {
  urls = 0;
  blobs.clear();
  live.clear();
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:scena-${++urls}`;
    blobs.set(url, blob as Blob);
    live.add(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    live.delete(url);
  });
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => Promise.resolve());
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: 600 });
  document.body.append(host);
  owner = openLifetime();
}

/// Dopo ogni test: chiude la vita, svuota il documento e toglie i finti.
export function tearDown(): void {
  owner.close();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

export function sceneOf(engine: SceneEngine, builder: PaintBuilder): PaintScene {
  return builder.build(engine);
}

/// Tanti rettangoli quanti fanno grande una scena.
export function largeRects(): string {
  return Array.from({ length: LARGE_SCENE_SHAPES }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1"/>`).join("");
}

/// La vista di scala `scale` e angolo `angle` che tiene fermo il centro della
/// vista di 800 per 600, spostata di `shift` come la vista di partenza.
export function aroundCenter(scale: number, angle: number, shift: readonly [number, number] = [0, 0]): View {
  const center: [number, number] = [400 - shift[0], 300 - shift[1]];
  const [x, y] = toScreen({ scale, angle, tx: 0, ty: 0 }, center);
  return { scale, angle, tx: 400 - x, ty: 300 - y };
}

/// Aspetta le decodifiche già partite.
export async function decoded(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}
