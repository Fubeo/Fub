// Il contesto dei pezzi di createDrawEditor: lo stato e le funzioni che un
// pezzo dà agli altri. Ogni pezzo dichiara i suoi membri; i parametri
// dell'editor ci sono dall'inizio.

import type { DrawEditorOptions } from "../editor";
import type { ArrangingContext } from "./arranging";
import type { BarsContext } from "./bars";
import type { BezierToolContext } from "./bezier-tool";
import type { BoardToolContext } from "./board-tool";
import type { ClipboardCommandsContext } from "./clipboard-commands";
import type { ControlsContext } from "./controls";
import type { CurvatureToolContext } from "./curvature-tool";
import type { CuttingContext } from "./cutting";
import type { DropperToolContext } from "./dropper-tool";
import type { GradientGestureContext } from "./gradient-gesture";
import type { GradientToolContext } from "./gradient-tool";
import type { GuideDragContext } from "./guide-drag";
import type { ImageCommandsContext } from "./image-commands";
import type { InputContext } from "./input";
import type { InsertsContext } from "./inserts";
import type { KeysContext } from "./keys";
import type { LayersGridContext } from "./layers-grid";
import type { LifeContext } from "./life";
import type { MarksContext } from "./marks";
import type { MasksNodesContext } from "./masks-nodes";
import type { NodeGesturesContext } from "./node-gestures";
import type { OperationsContext } from "./operations";
import type { PanelContext } from "./panel";
import type { PenSymmetryContext } from "./pen-symmetry";
import type { SelectionCommandsContext } from "./selection-commands";
import type { ShapesConnectorContext } from "./shapes-connector";
import type { StageContext } from "./stage";
import type { StateContext } from "./state";
import type { StylingContext } from "./styling";
import type { SymbolPanelContext } from "./symbol-panel";
import type { TextToolContext } from "./text-tool";
import type { ToolbarContext } from "./toolbar";
import type { ToolingContext } from "./tooling";
import type { TreeContext } from "./tree";
import type { VaultImagesContext } from "./vault-images";
import type { ViewContext } from "./view";
import type { WidthToolContext } from "./width-tool";
import type { Lifetime } from "../../../../ui/lifetime";
import type { SceneEngine } from "../../scene/engine";

export interface EditorContext extends
    StateContext, ToolbarContext, BarsContext, StageContext, ViewContext, MarksContext, TreeContext,
    PanelContext, StylingContext, ControlsContext, OperationsContext, ToolingContext, GuideDragContext,
    PenSymmetryContext, BoardToolContext, CuttingContext, WidthToolContext, DropperToolContext,
    GradientToolContext, GradientGestureContext, NodeGesturesContext, InsertsContext, SymbolPanelContext,
    ShapesConnectorContext, BezierToolContext, CurvatureToolContext, TextToolContext, InputContext,
    ArrangingContext, SelectionCommandsContext, ImageCommandsContext, MasksNodesContext,
    LayersGridContext, KeysContext, ClipboardCommandsContext, VaultImagesContext, LifeContext {
  readonly host: HTMLElement;
  readonly initial: SceneEngine;
  readonly owner: Lifetime;
  readonly options: DrawEditorOptions;
}
