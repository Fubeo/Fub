// Gli aiuti dei test degli strumenti: un motore aperto su un documento di
// prova e l'indice dei suoi oggetti, come li vede l'editor.

import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import type { Bounds } from "../scene/geometry";
import { SceneIndexer, type SceneIndex, type Unit } from "./hit";

export const LAYER = '<g id="l1" fub:layer="Livello 1">';

export interface Opened {
  readonly engine: SceneEngine;
  readonly index: SceneIndex;
  /// L'indice di adesso, dopo le operazioni applicate al motore.
  reindex(): SceneIndex;
  /// Il riquadro di tutto il disegno di adesso.
  extent(): Bounds | null;
  /// I collegamenti che si vedono adesso, a ogni profondità.
  links(): Unit[];
}

export function open(source: string): Opened {
  const engine = SceneEngine.open(source);
  const builder = new PaintBuilder();
  const indexer = new SceneIndexer(builder);
  const reindex = (): SceneIndex => {
    builder.build(engine);
    return indexer.index(engine.model!);
  };
  const extent = (): Bounds | null => {
    builder.build(engine);
    return indexer.extent(engine.model!);
  };
  const links = (): Unit[] => {
    builder.build(engine);
    return indexer.links(engine.model!);
  };
  return { engine, index: reindex(), reindex, extent, links };
}
