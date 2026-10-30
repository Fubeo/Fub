// Il contesto dei pezzi di createDrawEditor: lo stato e le funzioni che un
// pezzo dà agli altri. Ogni pezzo dichiara i suoi membri; i parametri
// dell'editor ci sono dall'inizio.

import type { DrawEditorOptions } from "../editor";
import type { ArrangingContext } from "./arranging";
import type { BarsContext } from "./bars";
import type { RailContext } from "./chrome/rail";
import type { PenOptionsContext } from "./chrome/pen-options";
import type { NibContext } from "./nib";
import type { ReplayContext } from "./replay";
import type { RulerContext } from "./ruler-ink";
import type { BareContext } from "./chrome/bare";
import type { OutlineContext } from "./chrome/outline";
import type { CommandSearchContext } from "./chrome/command-search";
import type { NavigatorContext } from "./chrome/navigator";
import type { CommandsContext } from "./chrome/commands";
import type { WorkspaceContext } from "./chrome/workspace";
import type { StatusContext } from "./chrome/status";
import type { BoardViewContext } from "./board-view";
import type { ClipboardCommandsContext } from "./clipboard-commands";
import type { ControlsContext } from "./controls";
import type { CurvatureToolContext } from "./curvature-tool";
import type { GestureBeginContext } from "./gesture-begin";
import type { HandZoomContext } from "./hand-zoom";
import type { InkShapeContext } from "./ink-shape";
import type { InputContext } from "./input";
import type { InsertsContext } from "./inserts";
import type { KeysContext } from "./keys";
import type { LayersGridContext } from "./layers-grid";
import type { LifeContext } from "./life";
import type { MarksContext } from "./marks";
import type { InkGesturesContext } from "./ink-gestures";
import type { OperationsContext } from "./operations";
import type { PanelContext } from "./panel";
import type { SelectionGesturesContext } from "./selection-gestures";
import type { SelectionCommandsContext } from "./selection-commands";
import type { StrokeShapesContext } from "./stroke-shapes";
import type { StageContext } from "./stage";
import type { StateContext } from "./state";
import type { StylingContext } from "./styling";
import type { SheetCursorContext } from "./sheet-cursor";
import type { ToolbarContext } from "./toolbar";
import type { ToolingContext } from "./tooling";
import type { TreeContext } from "./tree";
import type { VaultImagesContext } from "./vault-images";
import type { ViewContext } from "./view";
import type { Lifetime } from "../../../../ui/lifetime";
import type { SceneEngine } from "../../scene/engine";

export interface EditorContext extends
    StateContext, ToolbarContext, BarsContext, StageContext, ViewContext, MarksContext, TreeContext,
    PanelContext, StylingContext, ControlsContext, OperationsContext, ToolingContext, GestureBeginContext,
    SelectionGesturesContext, BoardViewContext,
    InkGesturesContext, InsertsContext,
    StrokeShapesContext, CurvatureToolContext, SheetCursorContext, InputContext,
    ArrangingContext, SelectionCommandsContext, InkShapeContext,
    LayersGridContext, KeysContext, ClipboardCommandsContext, VaultImagesContext, LifeContext, RailContext, PenOptionsContext,
    StatusContext, HandZoomContext, BareContext, OutlineContext, CommandSearchContext, NavigatorContext, CommandsContext,
    WorkspaceContext, NibContext, ReplayContext, RulerContext {
  readonly host: HTMLElement;
  readonly initial: SceneEngine;
  readonly owner: Lifetime;
  readonly options: DrawEditorOptions;
}
