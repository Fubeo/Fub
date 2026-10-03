// Un foglio finto per le prove della sessione live: l'overlay registra
// i tratti che riceve, la camera è quella che le si dà.

import { vi } from "vitest";
import type { Camera } from "../../../spatial/camera";
import type { InkPreview, SceneOverlay } from "../painter/overlay";
import { IDENTITY, type Matrix } from "../scene/matrix";
import { ROOT } from "../scene/ops";
import type { DrawStage } from "../tools/editor";
import type { LiveStage } from "./registry";

export interface FakeStage extends LiveStage {
  /// I tratti mostrati adesso, per chiave.
  readonly inks: Map<string, InkPreview>;
  /// Ogni chiamata, in ordine: `set <chiave>`, `clear <chiave>`, `flush`.
  readonly log: string[];
  readonly overlay: { setInk: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> };
  shown: boolean;
}

export function fakeStage(options: { width?: number; height?: number; layers?: Record<string, Matrix> } = {}): FakeStage {
  const inks = new Map<string, InkPreview>();
  const log: string[] = [];
  const overlay = {
    setInk: vi.fn((key: string, ink: InkPreview | null) => {
      if (ink === null) {
        inks.delete(key);
        log.push(`clear ${key}`);
      } else {
        inks.set(key, ink);
        log.push(`set ${key}`);
      }
    }),
    flush: vi.fn(() => log.push("flush")),
    setView: vi.fn(),
    setHandles: vi.fn(),
    dispose: vi.fn(),
  };
  let camera: Camera = { scale: 1, tx: 0, ty: 0 };
  const stage: DrawStage = {
    overlay: overlay as unknown as SceneOverlay,
    layerMatrix: (id) => options.layers?.[id] ?? (id === ROOT ? IDENTITY : null),
    get camera() {
      return camera;
    },
    setCamera(next) {
      camera = next;
    },
    width: options.width ?? 800,
    height: options.height ?? 600,
  };
  const root = document.createElement("div");
  root.className = "vector-surface";
  const draw = document.createElement("div");
  draw.className = "vector-draw";
  root.append(draw);
  const fake: FakeStage = {
    root,
    stage,
    inks,
    log,
    overlay,
    shown: true,
    visible: () => fake.shown,
  };
  return fake;
}
