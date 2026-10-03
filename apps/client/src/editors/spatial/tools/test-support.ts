// Gli aiuti dei test degli strumenti: un motore aperto su un documento di
// prova e l'indice dei suoi oggetti, come li vede l'editor.

import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import { SceneIndexer, type SceneIndex } from "./hit";

export const LAYER = '<g id="l1" fub:layer="Livello 1">';

export interface Opened {
  readonly engine: SceneEngine;
  readonly index: SceneIndex;
  /// L'indice di adesso, dopo le operazioni applicate al motore.
  reindex(): SceneIndex;
}

export function open(source: string): Opened {
  const engine = SceneEngine.open(source);
  const builder = new PaintBuilder();
  const indexer = new SceneIndexer(builder);
  const reindex = (): SceneIndex => {
    builder.build(engine);
    return indexer.index(engine.model!);
  };
  return { engine, index: reindex(), reindex };
}
