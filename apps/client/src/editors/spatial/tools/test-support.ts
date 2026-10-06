// Gli aiuti dei test degli strumenti: un motore aperto su un documento di
// prova e l'indice dei suoi oggetti, come li vede l'editor.

import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import type { Bounds } from "../scene/geometry";
import type { ContainerNode } from "../scene/model";
import { SceneIndexer, type SceneIndex, type Unit } from "./hit";

export const LAYER = '<g id="l1" fub:layer="Livello 1">';

export interface Opened {
  readonly engine: SceneEngine;
  readonly index: SceneIndex;
  /// L'indice di adesso, dopo le operazioni applicate al motore; con
  /// `scope`, quello del gruppo isolato.
  reindex(scope?: ContainerNode | null): SceneIndex;
  /// Gli oggetti che si vedono adesso, coi figli dei contenitori `open`.
  seen(open?: ReadonlySet<ContainerNode>): Unit[];
  /// Vero se adesso dentro `container` si sceglie.
  opens(container: ContainerNode): boolean;
  /// Il riquadro di tutto il disegno di adesso.
  extent(): Bounds | null;
  /// I collegamenti che si vedono adesso, a ogni profondità.
  links(): Unit[];
  /// Il riquadro della miniatura dell'elemento di id `id`, adesso.
  frame(id: string): Bounds | null;
}

export function open(source: string): Opened {
  const engine = SceneEngine.open(source);
  const builder = new PaintBuilder();
  const indexer = new SceneIndexer(builder, (id) => engine.holder(id));
  const reindex = (scope: ContainerNode | null = null): SceneIndex => {
    builder.build(engine);
    return indexer.index(engine.model!, scope);
  };
  const seen = (open?: ReadonlySet<ContainerNode>): Unit[] => {
    builder.build(engine);
    return indexer.seen(engine.model!, open);
  };
  const opens = (container: ContainerNode): boolean => {
    builder.build(engine);
    return indexer.opens(engine.model!, container);
  };
  const extent = (): Bounds | null => {
    builder.build(engine);
    return indexer.extent(engine.model!);
  };
  const links = (): Unit[] => {
    builder.build(engine);
    return indexer.links(engine.model!);
  };
  const frame = (id: string): Bounds | null => {
    builder.build(engine);
    const node = engine.holder(id);
    if (node === null) throw new Error(`nessun elemento ${id}`);
    return indexer.frameOf(engine.model!, node);
  };
  return { engine, index: reindex(), reindex, seen, opens, extent, links, frame };
}
