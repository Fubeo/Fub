import type { Theme } from "../../theme/theme";
import type {
  EditorSurface,
  SurfaceFactory,
  SurfaceMountContext,
  SurfaceRequest,
  SurfaceViewState,
} from "../core/registry";
import { GridEngine, type GridDocumentChange } from "./engine";

export interface GridSurfaceMountContext extends SurfaceMountContext {
  readonly initialText?: string;
  readonly onChange?: (change: GridDocumentChange) => void;
  readonly onSelectionChange?: () => void;
  readonly theme?: Theme;
}

export interface GridEditorSurface extends EditorSurface {
  readonly family: "grid";
  readonly profile: "sheet";
  setDoc(source: string): void;
  syncDoc(source: string): void;
  currentText(): string;
  undo(): boolean;
  redo(): boolean;
}

let nextGridSurfaceId = 1;

class GridSurface implements GridEditorSurface {
  readonly family = "grid" as const;
  readonly profile = "sheet" as const;
  readonly surfaceId = `grid-surface-${nextGridSurfaceId++}`;
  private readonly engine: GridEngine;
  private readOnly = false;
  private suspended = false;
  private theme: Theme;

  constructor(engine: GridEngine, theme: Theme) {
    this.engine = engine;
    this.theme = theme;
  }

  setDoc(source: string): void {
    this.engine.setDocument(source);
  }

  syncDoc(source: string): void {
    this.engine.synchronizeDocument(source);
  }

  currentText(): string {
    return this.engine.currentSource();
  }

  undo(): boolean {
    return this.engine.undo();
  }

  redo(): boolean {
    return this.engine.redo();
  }

  focus(): void {
    this.engine.focus();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.engine.setReadOnly(readOnly);
  }

  setTheme(theme: unknown): void {
    if (theme !== "light" && theme !== "dark") return;
    this.theme = theme;
    this.engine.setTheme(theme);
  }

  captureViewState(): SurfaceViewState {
    return { version: 1, value: this.engine.captureViewState() };
  }

  restoreViewState(state: SurfaceViewState): void {
    if (state.version !== 1) return;
    this.engine.restoreViewState(state.value);
  }

  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.engine.suspend();
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.engine.resume();
    this.engine.setReadOnly(this.readOnly);
    this.engine.setTheme(this.theme);
  }

  destroy(): void {
    this.engine.destroy();
  }
}

export interface GridSurfaceFactory extends SurfaceFactory {
  readonly family: "grid";
  readonly profile: "sheet";
  mount(request: SurfaceRequest, context: SurfaceMountContext): GridEditorSurface;
}

export const gridSurfaceFactory: GridSurfaceFactory = {
  family: "grid",
  profile: "sheet",
  supportedVersions: [1],
  mount(_request, context) {
    const gridContext = context as GridSurfaceMountContext;
    const theme = gridContext.theme ?? "dark";
    const engine = new GridEngine(gridContext.parent, {
      onChange: gridContext.onChange ?? (() => {}),
      onSelectionChange: gridContext.onSelectionChange,
      theme,
    });
    if (gridContext.initialText !== undefined) engine.setDocument(gridContext.initialText);
    return new GridSurface(engine, theme);
  },
};
