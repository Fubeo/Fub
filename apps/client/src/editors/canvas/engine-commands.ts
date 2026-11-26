// Il motore della lavagna: i comandi, la banda di stato, disponi e allinea,
// lo stile del testo, la barra della selezione, i colori, la ricerca dei
// comandi. Metodi della classe `CanvasEngine`, montati sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import { cardKindOf } from "../core/cards/contract";
import {
  CANVAS_LAYOUTS,
  type CanvasTip,
  CANVAS_ALIGN,
  CANVAS_COLORS,
  CANVAS_TIPS,
  commandHint,
  toolOfCommand,
  type CanvasAlign,
  type CanvasColorId,
  type CanvasCommandArgs,
  type CanvasCommandBehaviour,
  type CanvasLayout,
  type CanvasNudge,
} from "./chrome/commands";
import { CANVAS_INK_TOOLS, CANVAS_WRITING_TOOLS } from "./chrome/rail";
import { type CanvasChosenText } from "./chrome/options";
import { type TextStyle, isTextAlign, isTextSize, textStyle, withTextStyle } from "./text-style";
import { type CanvasSelectionBar, selectionBarWanted, type SelectionBarShow } from "./chrome/selection-bar";
import { canvasStatusItems, statusSignature, dropFolderOf, type CanvasStatusPort } from "./chrome/status";
import { SHARED_RECENT_COMMANDS, openCommandSearch } from "./chrome/command-search";
import { pickerText as canvasPickerText } from "./pen-menu";
import {
  JSON_CANVAS_COLORS,
  NOTE_COLORS,
  colorMenuLabel,
  type CanvasColorChoice,
  colorLook,
  colorValueOf,
  writeColor,
} from "./colors";
import { createColorPicker, openPopover } from "../../kit";
import { PARTS_PICKER_MIN_SECTIONS } from "./parts-picker";
import type { CanvasNode, CanvasEdge } from "./model";
import { type CanvasIntentOp } from "./wasm/core";
import { CANVAS_SNAP, CanvasArrange } from "./engine-options";
import { CANVAS_ZOOM_STEP } from "./engine-parts";
import { looseCards, isVaultPath, externalUrl } from "./engine-geometry";
import { setOp, writingName } from "./engine-names";
import { readCodeList } from "./code-text";
import { cardTarget } from "./sources";
import { noteExcerptOf } from "./excerpt";
import type { CanvasEngine } from "./engine";

export const commandsMethods = {
  _layoutSelection(this: CanvasEngine, axis: CanvasArrange): void {
    if (this._readOnly || !this._doc) return;
    this._writeOps(this._arrangeOps(axis));
  },

  /**
   * `align` o `distribute` delle schede scelte: i lati e i passi li decide il
   * nucleo (`layout::arrange`). `null` con meno di due schede (tre per
   * distribuire), come i bottoni spenti.
   */
  _arrangeOps(this: CanvasEngine, axis: CanvasArrange): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    if (axis === "distribute-x" || axis === "distribute-y") {
      return ids.length >= 3 ? [{ op: "distribute", ids, axis: axis === "distribute-x" ? "x" : "y" }] : null;
    }
    return ids.length >= 2 ? [{ op: "align", ids, to: axis }] : null;
  },

  /**
   * «Disponi» (LIC T25): `layout` delle schede scelte, o, senza selezione,
   * delle schede libere (il nucleo le sceglie se mancano gli `ids`). `null`
   * con meno di due, come la voce spenta.
   */
  _layoutOps(this: CanvasEngine, kind: CanvasLayout): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    if (ids.length >= 2) return [{ op: "layout", ids, kind }];
    if (ids.length === 0 && this._doc && looseCards(this._doc.nodes).length >= 2) return [{ op: "layout", kind }];
    return null;
  },

  /**
   * Perché «Disponi» è spento: una scheda sola scelta o, senza selezione,
   * meno di due schede libere (quelle che il nucleo dispone: non gruppi, e
   * non dentro un gruppo).
   */
  _layoutWhy(this: CanvasEngine): string | null {
    const chosen = this._selectedNodes().length;
    if (chosen === 1) return t("canvas.commands.why.two");
    if (chosen >= 2) return null;
    if (!this._doc?.nodes.length) return t("canvas.commands.why.empty");
    return looseCards(this._doc.nodes).length >= 2 ? null : t("canvas.commands.why.two");
  },

  /** «Disponi»: scrive il `layout`; se le schede sono già disposte così lo dice, mai il silenzio. */
  _arrangeLayout(this: CanvasEngine, kind: CanvasLayout): void {
    if (this._readOnly || this._isSceneOversized()) return;
    const ops = this._layoutOps(kind);
    if (!ops) return;
    const compiled = this._compileIntent(ops, "canvas.change_refused");
    if (!compiled) return;
    if (compiled.patches.length === 0) {
      this._showNotice(t("canvas.layout.nothing"));
      return;
    }
    this._commit(compiled.patches, "input");
  },

  /** Ciò che la banda legge della lavagna e ciò che può chiederle. */
  _statusPort(this: CanvasEngine): CanvasStatusPort {
    const port: CanvasStatusPort = {
      zoomPercent: () => Math.round(this._camera.zoom * 100),
      chosenCount: () => this._selection.length,
      writing: () => {
        const id = this._writingId;
        const entry = id === null ? undefined : this._cards.get(id);
        if (!entry || entry.article.dataset.cardEditing === undefined) return null;
        // In un foglio, anche la cella: «Misure.xlsx · D4» (T27).
        const cell = this._writingContext?.cell ?? "";
        return cell === "" ? writingName(entry.node) : `${writingName(entry.node)} · ${cell}`;
      },
      readOnlyWhy: () => (this._readOnly
        ? (this._unwritable ? t("canvas.unwritable") : t("canvas.status.readonly.panel"))
        : null),
      folder: () => dropFolderOf(this._attachmentDeclared, this._dropChoice, this._options.documentId ?? ""),
      twins: () => {
        const ids = this._shownTwins();
        if (ids === null) return null;
        return {
          count: ids.length,
          frame: () => {
            const chosen = new Set(ids);
            const nodes = this._doc?.nodes.filter((node) => chosen.has(node.id)) ?? [];
            if (nodes.length === 0) return;
            this._fitCamera(true, nodes);
            this._statusSettle();
          },
        };
      },
      zoomTo: (zoom) => {
        if (this._destroyed || !this._doc) return;
        const rect = this._viewport.getBoundingClientRect();
        this._zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, zoom / this._camera.zoom);
        this._statusSettle();
      },
      command: (id) => {
        const found = this.commands().find((command) => command.id === id);
        if (!found) return null;
        return {
          label: found.label,
          hint: commandHint(found),
          disabled: found.disabled(),
          run: () => {
            found.run();
            this._statusSettle();
          },
        };
      },
      zoomMenuAt: () => {
        const rect = this._viewport.getBoundingClientRect();
        return { x: Math.round(rect.right), y: Math.round(rect.bottom) };
      },
    };
    const openSettings = this._options.onOpenSettings;
    return openSettings ? { ...port, openSettings } : port;
  },

  /** Che cosa fa il comando `id` su questa tela, o `null` se non lo conosce. */
  _commandBehaviour(this: CanvasEngine, id: string): CanvasCommandBehaviour | null {
    const writable = (): string | null => (this._readOnly ? t("canvas.commands.why.read_only") : null);
    const withSelection = (): string | null =>
      writable() ?? (this._selectedNodes().length > 0 ? null : t("canvas.commands.why.no_selection"));
    const withNodes = (): string | null => (this._doc?.nodes.length ? null : t("canvas.commands.why.empty"));
    const only = (): CanvasNode | null => {
      const nodes = this._selectedNodes();
      return nodes.length === 1 ? nodes[0]! : null;
    };
    const center = (): { x: number; y: number } => {
      const rect = this._viewport.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const world = (args?: CanvasCommandArgs) => (args?.at ? this._screenToWorld(args.at.x, args.at.y) : undefined);
    const add = (type: CanvasNode["type"]): CanvasCommandBehaviour => ({
      disabled: writable,
      op: (input) => this._addOps(type, undefined, world(input)),
      run: (args) => this._addNode(type, undefined, world(args)),
    });
    if (id.startsWith("canvas.color.")) {
      // I colori (T47): nessuno, i sei, i nove delle note; «Altro…» apre il
      // selettore del kit.
      const choice = id.slice("canvas.color.".length) as CanvasColorId;
      if (!(CANVAS_COLORS as readonly string[]).includes(choice)) return null;
      return {
        disabled: () => writable() ?? (this._selectedNodes().length || this._edgeSelection.length ? null : t("canvas.commands.why.no_selection")),
        // «Altro…» scrive il colore che il selettore dà (`value`).
        op: (input) => {
          const value = colorValueOf(choice);
          if (value === null) return input?.value === undefined ? null : this._colorOps(input.value, input.edge);
          return this._colorOps(value, input?.edge);
        },
        run: (args) => {
          const value = colorValueOf(choice);
          if (value === null) this._openColorPicker(args?.edge);
          else this._colorSelection(value, args?.edge);
        },
      };
    }
    if (id.startsWith("canvas.layout.")) {
      // «Disponi» (LIC T25): `layout` sulle schede scelte, o su tutte quelle
      // fuori dai gruppi; le posizioni le decide il nucleo.
      const kind = id.slice("canvas.layout.".length) as CanvasLayout;
      if (!(CANVAS_LAYOUTS as readonly string[]).includes(kind)) return null;
      return {
        disabled: () => writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : this._layoutWhy()),
        op: () => this._layoutOps(kind),
        run: () => this._arrangeLayout(kind),
      };
    }
    if (id.startsWith("canvas.align.")) {
      const axis = id.slice("canvas.align.".length) as CanvasAlign;
      if (!(CANVAS_ALIGN as readonly string[]).includes(axis)) return null;
      return {
        disabled: () => writable() ?? (this._selectedNodes().length >= 2 ? null : t("canvas.commands.why.two")),
        op: () => this._arrangeOps(axis),
        run: () => this._layoutSelection(axis),
      };
    }
    if (id.startsWith("canvas.text_size.") || id.startsWith("canvas.text_align.")) {
      // La misura e l'allineamento del testo (T92): delle schede di testo
      // scelte, in un commit, e delle prossime dello strumento Testo.
      const size = id.startsWith("canvas.text_size.") ? id.slice("canvas.text_size.".length) : null;
      const align = id.startsWith("canvas.text_align.") ? id.slice("canvas.text_align.".length) : null;
      const change: Partial<TextStyle> | null = isTextSize(size) ? { size } : isTextAlign(align) ? { align } : null;
      if (change === null) return null;
      return {
        disabled: () => writable()
          ?? (this._isSceneOversized() ? t("canvas.too_large") : null)
          ?? (this._tool === "text" || this._chosenTextNodes().length > 0 ? null : t("canvas.commands.why.no_text_card")),
        // Le prossime schede del Testo non sono nel file: scrivono solo le scelte.
        op: () => this._styleTextOps(change),
        run: () => this._styleText(change),
      };
    }
    if (id.startsWith("canvas.tips.")) {
      const tip = id.slice("canvas.tips.".length) as CanvasTip;
      if (!(CANVAS_TIPS as readonly string[]).includes(tip)) return null;
      return {
        disabled: writable,
        run: () => {
          this._tips = tip;
          this._canvasOptions.sync();
        },
      };
    }
    if (id.startsWith("canvas.nudge.")) {
      const [way, far] = id.slice("canvas.nudge.".length).split(".") as [CanvasNudge, string | undefined];
      const step = far === "far" ? CANVAS_SNAP * 4 : far === "fine" ? 1 : CANVAS_SNAP;
      const dx = way === "left" ? -step : way === "right" ? step : 0;
      const dy = way === "up" ? -step : way === "down" ? step : 0;
      return {
        disabled: withNodes,
        // In sola lettura le frecce scelgono la scheda vicina: non scrivono.
        op: () => (this._readOnly ? null : this._nudgeOps(dx, dy)),
        run: () => this._nudge(dx, dy, way === "down" || way === "right"),
      };
    }
    const tool = toolOfCommand(id);
    if (tool !== null) {
      // C con due schede scelte le collega: la sola volta che uno strumento
      // scrive. Con un filo scelto C non collega (`run` sotto), e così `op`.
      const pair = tool === "connect" ? { op: () => (this._edgeSelection.length > 0 ? null : this._connectPairOps()) } : {};
      return {
        disabled: () => (CANVAS_WRITING_TOOLS.has(tool) ? writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null) : null),
        ...pair,
        run: () => {
          // C con una scheda scelta comincia il filo da lei, come «Collega…»
          // (T17); con due le collega (T67, D-19 (a)); senza, sceglie lo
          // strumento.
          const chosen = tool === "connect" && this._edgeSelection.length === 0 ? this._selectedNodes() : [];
          if (chosen.length === 2) this._connectPair(chosen[0]!, chosen[1]!);
          else if (chosen.length === 1) this._beginConnectFrom(chosen[0]!.id);
          else this._pickTool(tool);
        },
      };
    }
    if (id === "canvas.parts") {
      // «Parti…» (T74): una sola scheda di nota; spenta se la nota, l'ultima
      // volta che se ne è letto il sommario, non aveva due sezioni.
      if (!this._options.parts) return null;
      return {
        disabled: () => {
          const why = writable();
          if (why !== null) return why;
          const one = only();
          if (!one || !this._partsNote(one)) return t("canvas.commands.why.one_note");
          const count = this._partsCounts.get(one.file!);
          return count !== undefined && count < PARTS_PICKER_MIN_SECTIONS ? t("canvas.commands.why.no_sections") : null;
        },
        run: () => {
          const one = only();
          if (one && this._partsNote(one)) void this._openParts(one.id, "command");
        },
      };
    }
    if (id === "canvas.whole_file") {
      // «Mostra tutto il file» (T75): la scheda-estratto torna la nota intera.
      return {
        disabled: () => {
          const why = writable();
          if (why !== null) return why;
          const one = only();
          return one && noteExcerptOf(one) ? null : t("canvas.commands.why.one_excerpt");
        },
        op: () => {
          const one = only();
          return one ? this._wholeFileOps(one.id) : null;
        },
        run: () => {
          const one = only();
          if (one) this._showWholeFile(one.id);
        },
      };
    }
    if (id === "canvas.crop") {
      // «Ritaglia e ruota» (T78): senza il renderer delle immagini non c'è
      // niente da tagliare, e il comando non c'è.
      if (!this._cropRenderer()) return null;
      return {
        disabled: () => {
          const why = writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null);
          if (why !== null) return why;
          const one = only();
          if (!one || !this._cropImage(one)) return t("canvas.commands.why.one_image");
          return this._cropUnreadable(one.id) ? t("canvas.crop.why.unreadable") : null;
        },
        run: () => {
          const one = only();
          if (one) this._beginCrop(one.id);
        },
      };
    }
    if (id === "canvas.extract_note" || id === "canvas.copy_note_text") {
      // Convertire (T70): senza la porta delle note i due comandi non ci sono.
      if (!this._options.notes) return null;
      if (id === "canvas.extract_note") {
        return {
          disabled: () => writable() ?? (only()?.type === "text" ? null : t("canvas.commands.why.one_text")),
          // `value` è il percorso della nota appena nata: la crea la shell, prima.
          op: (input) => {
            const one = only();
            return one?.type === "text" && input?.value ? [{ op: "convert", id: one.id, file: input.value }] : null;
          },
          run: () => {
            const one = only();
            if (one?.type === "text") void this._extractNote(one.id).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      }
      return {
        disabled: () => {
          const one = only();
          return writable() ?? (one && cardKindOf(one) === "note" ? null : t("canvas.commands.why.one_note"));
        },
        // `value` è il testo letto dalla nota (o dalle sezioni dell'estratto).
        op: (input) => {
          const one = only();
          return one && cardKindOf(one) === "note" && input?.value !== undefined ? this._copyNoteTextOps(one, input.value) : null;
        },
        run: () => {
          const one = only();
          if (one && cardKindOf(one) === "note") void this._copyNoteText(one.id).catch((error: unknown) => this._showIntakeError(error));
        },
      };
    }
    switch (id) {
      case "canvas.replace_file":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            if (!this._options.onPickFile) return t("canvas.commands.why.no_file_picker");
            return only()?.type === "file" ? null : t("canvas.commands.why.one_file");
          },
          // `value` è il file scelto nel selettore.
          op: (input) => {
            const one = only();
            return one?.type === "file" && input?.value ? this._replaceFileOps(one, input.value) : null;
          },
          run: () => {
            const one = only();
            if (one?.type === "file") void this._replaceFile(one.id).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      // «Il dito scrive» (T64): una scelta di questo computer, anche in sola lettura.
      case "canvas.finger_writes":
        return {
          disabled: () => null,
          run: () => this._setFingerWrites(!this._fingerWritesSetting),
        };
      case "canvas.escape":
        return {
          disabled: () => (this._selection.length || this._edgeSelection.length || this._strokeSelection.size || this._tool !== "select"
            ? null
            : t("canvas.commands.why.no_selection")),
          run: () => {
            // Un filo cominciato da «Collega…» si lascia prima di tutto.
            if (this._connectFrom !== null) this._pickTool("select");
            else if (this._selection.length || this._edgeSelection.length || this._strokeSelection.size) this._clearSelection();
            else this._pickTool("select");
          },
        };
      case "canvas.undo":
        return { disabled: () => (this._undo.length || this._pending ? null : t("canvas.commands.why.no_undo")), run: () => void this.undo() };
      case "canvas.redo":
        return { disabled: () => (this._redo.length ? null : t("canvas.commands.why.no_redo")), run: () => void this.redo() };
      case "canvas.commands":
        return { disabled: () => null, run: () => this._openCommandSearch() };
      case "canvas.add.text":
        // Nasce in scrittura, dove dice il menu o in un posto libero vicino al
        // centro (IMP-042); lasciata vuota se ne va (T44).
        return {
          ...add("text"),
          run: (args) => (args?.at ? this._placeText(args.at.x, args.at.y) : this._placeText()),
        };
      case "canvas.add.link":
        return add("link");
      case "canvas.add.group":
        return add("group");
      case "canvas.add.file":
        return {
          disabled: () => writable() ?? (this._options.onPickFile ? null : t("canvas.commands.why.no_file_picker")),
          // `value` è il file scelto nel selettore.
          op: (input) => (input?.value ? this._addOps("file", input.value, world(input)) : null),
          run: (args) => void this._addFileNode(world(args)).catch((error: unknown) => this._showIntakeError(error)),
        };
      case "canvas.duplicate":
        return { disabled: withSelection, op: () => this._duplicateOps(), run: () => this._duplicateSelection() };
      case "canvas.select_all":
        return { disabled: withNodes, run: () => this._selectAll() };
      case "canvas.enter":
        return {
          disabled: () => (this._selectionFocus() ? null : t("canvas.commands.why.no_selection")),
          // Su una scheda di testo apre il campo: `value` è il testo che vi si registra.
          op: (input) => {
            const focus = this._selectionFocus();
            return focus?.type === "text" && !this._readOnly && input?.value !== undefined ? this._textOps(focus.id, input.value) : null;
          },
          run: () => {
            const focus = this._selectionFocus();
            if (focus) this._enterOrEdit(focus);
          },
        };
      case "canvas.edit":
        return {
          disabled: () => writable() ?? (only()?.type === "text" ? null : t("canvas.commands.why.one_text")),
          // Apre il campo della scheda: `value` è il testo che vi si registra.
          op: (input) => {
            const one = only();
            return one?.type === "text" && input?.value !== undefined ? this._textOps(one.id, input.value) : null;
          },
          run: () => {
            const one = only();
            if (one?.type === "text") this._beginCardEdit(one);
          },
        };
      case "canvas.open":
        return {
          disabled: () => {
            const one = only();
            return one?.type === "file" && one.file ? null : t("canvas.commands.why.one_file");
          },
          run: () => {
            const one = only();
            if (one) this._openFileNode(one);
          },
        };
      case "canvas.open_url":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "link") return t("canvas.commands.why.one_link");
            return externalUrl(one.url ?? "") !== null && this._options.media ? null : t("canvas.commands.why.no_url");
          },
          run: () => {
            const one = only();
            const destination = one?.type === "link" ? externalUrl(one.url ?? "") : null;
            const media = this._options.media;
            if (!destination || !media) return;
            if (media.openViewer) void media.openViewer(destination);
            else void media.openExternal(destination);
          },
        };
      // Il menu della scheda (T17).
      case "canvas.open_beside":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "file" || !one.file) return t("canvas.commands.why.one_file");
            return this._options.onOpenPathBeside ? null : t("canvas.commands.why.no_beside");
          },
          run: () => {
            const one = only();
            const beside = this._options.onOpenPathBeside;
            if (one?.type !== "file" || !one.file || !beside) return;
            const path = `/${one.file.replace(/^\/+/, "")}${one.subpath ?? ""}`;
            void Promise.resolve(beside(path, this._options.documentId)).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      // «Apri a lato per questo» (T45): la scheda attiva, allo stesso punto.
      case "canvas.open_beside_here":
        return {
          label: () => this._besideHere()?.label ?? null,
          disabled: () => {
            if (this._besideHere() === null) return t("canvas.commands.why.no_active_card");
            return this._besideOpener() ? null : t("canvas.commands.why.no_beside");
          },
          run: () => {
            const here = this._besideHere();
            const open = this._besideOpener();
            if (!here || !open) return;
            void Promise.resolve(open(here.path, this._options.documentId)).catch((error: unknown) => this._showIntakeError(error));
          },
        };
      case "canvas.open_viewer":
        return {
          disabled: () => {
            const one = only();
            return one && cardKindOf(one) === "image" ? null : t("canvas.commands.why.one_image");
          },
          run: () => {
            const one = only();
            if (!one || cardKindOf(one) !== "image" || one.type !== "file" || !one.file) return;
            const path = `/${cardTarget(one).path.replace(/^\/+/, "")}`;
            void this._options.onOpenPath?.(path, this._options.documentId);
          },
        };
      case "canvas.web_preview":
        return {
          disabled: () => {
            const one = only();
            if (one?.type !== "link") return t("canvas.commands.why.one_link");
            const button = this._webPreviewButton(one.id);
            return button && !button.disabled ? null : t("canvas.commands.why.no_preview");
          },
          // Lo stesso gesto del pulsante della scheda: la sua porta, una
          // richiesta sola.
          run: () => {
            const one = only();
            const button = one ? this._webPreviewButton(one.id) : null;
            if (button && !button.disabled) button.click();
          },
        };
      case "canvas.connect":
        // Con una scheda comincia il filo da lei; con due le collega, come C
        // (T67, D-19 (a)): così vale anche nella barra della selezione (T51).
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            const count = this._selectedNodes().length;
            return count === 1 || count === 2 ? null : t("canvas.commands.why.one_or_two");
          },
          // Con una scheda sola il filo si tira col gesto: scrive solo con due.
          op: () => this._connectPairOps(),
          run: () => {
            const chosen = this._selectedNodes();
            if (chosen.length === 2) this._connectPair(chosen[0]!, chosen[1]!);
            else if (chosen.length === 1) this._beginConnectFrom(chosen[0]!.id);
          },
        };
      case "canvas.group":
        return {
          disabled: () => withSelection() ?? (this._isSceneOversized() ? t("canvas.too_large") : null),
          op: () => this._groupOps(),
          run: () => this._groupSelection(),
        };
      case "canvas.trash_file":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            if (!this._options.onTrashPath) return t("canvas.commands.why.no_trash");
            return this._selectedNodes().some((node) => node.type === "file" && isVaultPath(cardTarget(node).path))
              ? null
              : t("canvas.commands.why.no_file_card");
          },
          // Il cestino è della shell (`onTrashPath`); poi le schede se ne vanno.
          op: () => this._removeOps(this._selectedNodes().map((node) => node.id), []),
          run: () => void this._trashSelectedFiles().catch((error: unknown) => this._showIntakeError(error)),
        };
      case "canvas.spread_pages":
        return {
          disabled: () => {
            const why = writable();
            if (why !== null) return why;
            const one = only();
            if (one?.type !== "file" || cardKindOf(one) !== "pdf" || !isVaultPath(cardTarget(one).path)) return t("canvas.commands.why.no_pdf");
            if (!this._options.cards?.pdfPages) return t("canvas.commands.why.no_pdf_reader");
            return this._pdfBroken.has(cardTarget(one).path) ? t("canvas.commands.why.pdf_unreadable") : null;
          },
          // `value` sono le pagine scritte nel campo; il conto e le misure le
          // legge `canvas.apply` dal PDF, come qui li legge la tela. Quante
          // pagine nasceranno lo sa solo il conto: l'etichetta del gruppo
          // resta quella di serie del nucleo.
          op: (input) => {
            const one = only();
            return one && input?.value ? [{ op: "spread_pages", id: one.id, pages: input.value }] : null;
          },
          run: () => void this._spreadPages().catch((error: unknown) => this._showIntakeError(error)),
        };
      case "canvas.edge.reverse":
        return {
          disabled: () => writable() ?? (this._edgeSelection.length ? null : t("canvas.commands.why.no_edge")),
          op: (input) => this._reverseOps(input?.edge ?? this._edgeSelection[0]),
          run: (args) => this._reverseEdge(args?.edge ?? this._edgeSelection[0]),
        };
      case "canvas.delete":
        return {
          disabled: () => writable() ?? (this._selection.length || this._edgeSelection.length ? null : t("canvas.commands.why.no_selection")),
          op: () => this._removeOps(this._selection, this._edgeSelection),
          run: () => this._deleteSelection(),
        };
      case "canvas.bring_front":
        return { disabled: withSelection, op: () => this._reorderOps("front"), run: () => this._reorderSelection("front") };
      case "canvas.send_back":
        return { disabled: withSelection, op: () => this._reorderOps("back"), run: () => this._reorderSelection("back") };
      // La lavagna come codice (LIC T25). Copiare non scrive: vale anche in
      // sola lettura. Incollare legge gli appunti, controlla e chiede.
      case "canvas.copy_code":
        return {
          disabled: () => this._copyCodeWhy(),
          run: () => this._copyCode(),
        };
      case "canvas.paste_code":
        return {
          disabled: () => writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null),
          // `value` è il testo degli appunti: la lista che scriverebbe, se è una lista.
          op: (input) => {
            const read = input?.value === undefined ? null : readCodeList(input.value);
            return read?.ok ? (read.ops as CanvasIntentOp[]) : null;
          },
          run: () => void this._pasteCode(),
        };
      case "canvas.distribute_x":
      case "canvas.distribute_y": {
        const axis = id === "canvas.distribute_x" ? "distribute-x" : "distribute-y";
        return {
          disabled: () => writable() ?? (this._selectedNodes().length >= 3 ? null : t("canvas.commands.why.three")),
          op: () => this._arrangeOps(axis),
          run: () => this._layoutSelection(axis),
        };
      }
      // I menu della riga delle opzioni (T50).
      case "canvas.pen_menu":
        return {
          disabled: () => writable() ?? (this._isSceneOversized() ? t("canvas.too_large") : null),
          run: () => {
            // Con uno strumento che non scrive a mano, prima lo strumento
            // della penna: la riga mostra il pulsante e il menu ci si apre.
            if (!CANVAS_INK_TOOLS.has(this._tool)) this._pickTool(this._penChoice.tool);
            this._penMenu.open();
          },
        };
      case "canvas.color_menu":
        return { disabled: withSelection, run: () => this._canvasOptions.openColorMenu() };
      case "canvas.align_menu":
        return {
          disabled: () => writable() ?? (this._selectedNodes().length >= 2 ? null : t("canvas.commands.why.two")),
          run: () => this._canvasOptions.openAlignMenu(),
        };
      case "canvas.fit":
        return {
          disabled: () => null,
          // Un salto (T53): vola, o arriva subito col movimento ridotto.
          run: () => this._jumpCamera(this._fitTarget(this._doc?.nodes ?? [])),
        };
      case "canvas.fit_selection":
        return {
          disabled: () => (this._selectedNodes().length ? null : t("canvas.commands.why.no_selection")),
          run: () => this._jumpCamera(this._fitTarget(this._selectedNodes())),
        };
      case "canvas.zoom_reset":
        return { disabled: () => null, run: () => this._zoomToActual() };
      // Il menu radiale (T63): dove si è cliccato, o al centro della vista.
      case "canvas.radial":
        return { disabled: () => null, run: (args) => this._openRadialFromMenu(args?.at ?? null) };
      // La griglia di questa lavagna (T71): la vista, anche in sola lettura.
      case "canvas.grid_toggle":
        return { disabled: () => null, run: () => this._toggleGrid() };
      // Senza interfaccia (T65): la vista, anche in sola lettura.
      case "canvas.bare":
        return { disabled: () => null, run: () => this._workspace.setBare(!this._workspace.bare) };
      // Il navigatore (T55): c'è la voce che serve adesso, Nascondi o Mostra.
      case "canvas.navigator.hide":
      case "canvas.navigator.show": {
        const hide = id === "canvas.navigator.hide";
        if (hide === this._navigatorClosed()) return null;
        return { disabled: () => null, run: () => this._setNavigatorHidden(hide) };
      }
      case "canvas.zoom_in":
      case "canvas.zoom_out":
        return {
          disabled: () => null,
          run: (args) => {
            const at = args?.at ?? center();
            this._zoomAt(at.x, at.y, id === "canvas.zoom_in" ? CANVAS_ZOOM_STEP : 1 / CANVAS_ZOOM_STEP);
          },
        };
      default:
        return null;
    }
  },

  /**
   * Le punte di un filo nuovo, come dice la riga delle opzioni: alla fine
   * (`toEnd: "arrow"`, come sempre), all'inizio, o nessuna. JSON Canvas mette
   * la punta alla fine quando `toEnd` manca: «nessuna» la scrive.
   */
  _tipEnds(this: CanvasEngine): Pick<CanvasEdge, "fromEnd" | "toEnd"> {
    if (this._tips === "none") return { toEnd: "none" };
    if (this._tips === "start") return { fromEnd: "arrow", toEnd: "none" };
    return { toEnd: "arrow" };
  },

  /** Le schede di testo fra quelle scelte. */
  _chosenTextNodes(this: CanvasEngine): CanvasNode[] {
    return this._selectedNodes().filter((node) => node.type === "text");
  },

  /**
   * La misura e l'allineamento che la riga segna (T92): quelli delle schede
   * di testo scelte (`null` se sono diversi); senza, col Testo quelli delle
   * sue prossime schede, e nessuno con le altre schede (i controlli sono
   * spenti).
   */
  _chosenText(this: CanvasEngine): CanvasChosenText {
    const nodes = this._chosenTextNodes();
    if (nodes.length === 0) return this._tool === "text" ? this._textNext : { size: null, align: null };
    const styles = nodes.map(textStyle);
    const first = styles[0]!;
    return {
      size: styles.every((style) => style.size === first.size) ? first.size : null,
      align: styles.every((style) => style.align === first.align) ? first.align : null,
    };
  },

  /**
   * Cambia la misura o l'allineamento (T92): le prossime schede dello
   * strumento Testo lo prendono, e le schede di testo scelte lo scrivono in
   * `fub:text`, tutte in un commit (un annulla). Ogni scheda tiene l'altro
   * valore suo; una che si mostra già così non cambia, e tornata di serie
   * perde il campo. Il testo della scheda non si tocca.
   */
  _styleText(this: CanvasEngine, change: Partial<TextStyle>): void {
    if (this._readOnly || this._destroyed) return;
    this._textNext = { ...this._textNext, ...change };
    this._writeOps(this._styleTextOps(change));
    this._canvasOptions.sync();
  },

  /**
   * La `set` di `fub:text` di ogni scheda di testo scelta che con `change` si
   * mostra diversa; `null` se nessuna cambia.
   */
  _styleTextOps(this: CanvasEngine, change: Partial<TextStyle>): CanvasIntentOp[] | null {
    const ops: CanvasIntentOp[] = [];
    for (const node of this._chosenTextNodes()) {
      const next = withTextStyle(node, { ...textStyle(node), ...change });
      const op = next ? setOp(node, next) : null;
      if (op) ops.push(op);
    }
    return ops.length > 0 ? ops : null;
  },

  /** Il colore delle schede scelte: `undefined` quello di serie, `null` se sono diversi. */
  _chosenColor(this: CanvasEngine): string | null | undefined {
    const colors = new Set(this._selectedNodes().map((node) => node.color ?? ""));
    if (colors.size > 1) return null;
    const [only] = colors;
    return only ? only : undefined;
  },

  // --- la barra della selezione (T51) ------------------------------------------

  /**
   * Mostra la barra della selezione sopra le schede scelte, o la toglie: la
   * toglie durante un gesto sulle schede (spostare, ridimensionare, scegliere
   * col rettangolo o col lazo), con la penna giù e mentre si scrive in una
   * scheda (`selectionBarWanted`), e quando le schede sono tutte fuori dalla
   * vista. Con la penna giù torna quando si alza (il silenzio della penna).
   * Lo zoom e lo spostamento della vista non la tolgono: la barra segue le
   * schede a ogni passo della camera (`_followSelectionBar`, #411 C-06).
   */
  _syncSelectionBar(this: CanvasEngine): void {
    const bar = this._selectionBar as CanvasSelectionBar | undefined;
    // Le preferenze arrivano anche durante il costruttore, prima della barra.
    if (!bar) return;
    const shown = this._doc && !this._destroyed && !this._isSceneOversized() && this._isShown();
    const nodes = shown ? this._selectedNodes() : [];
    // I tratti scelti col Lazo (T86) contano come le schede.
    const units = shown ? this._chosenStrokes() : [];
    const chosen = nodes.length + units.length;
    const pen = this._penDown;
    // Col ritaglio aperto la sua barra prende il posto di quella della selezione.
    const writing = this._editor !== null || this._activeId !== null || this._canvasOptions.mode === "writing" || this._crop !== null;
    // La vista ha cambiato misura, o la scheda: la barra del ritaglio si riposa.
    this._placeCropBar();
    if (!selectionBarWanted({ chosen, gesture: this._cardGestureActive(), pen, writing })) {
      bar.hide();
      if (pen && chosen > 0 && this._quiet.active) this._quiet.defer("selection-bar", () => this._syncSelectionBar());
      return;
    }
    const one = nodes.length === 1 ? nodes[0]! : null;
    const open = one?.type === "file" && one.file ? "canvas.open" : one?.type === "link" ? "canvas.open_url" : null;
    bar.show({
      chosen: nodes.length,
      open,
      crop: one !== null && !this._readOnly && this._cropImage(one) && this._cropRenderer(),
      strokes: this._strokesShown(units),
      ...this._selectionBarWhere(nodes, units),
    });
  },

  /**
   * La barra della selezione già mostrata segue le schede scelte alla camera
   * di adesso (#411 C-06): solo il posto, senza rifare i pulsanti, così
   * regge un passo di zoom a ogni fotogramma.
   */
  _followSelectionBar(this: CanvasEngine): void {
    const bar = this._selectionBar as CanvasSelectionBar | undefined;
    if (!bar?.shown) return;
    bar.follow(this._selectionBarWhere(this._selectedNodes(), this._chosenStrokes()));
  },

  /** Dove sta la barra della selezione: il riquadro delle schede e dei tratti scelti sullo schermo, e la vista. */
  _selectionBarWhere(
    this: CanvasEngine,
    nodes: readonly CanvasNode[],
    units: readonly { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }[],
  ): Pick<SelectionBarShow, "box" | "view" | "offset"> {
    const zoom = this._camera.zoom;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of nodes) {
      left = Math.min(left, node.x);
      top = Math.min(top, node.y);
      right = Math.max(right, node.x + node.width);
      bottom = Math.max(bottom, node.y + node.height);
    }
    for (const unit of units) {
      left = Math.min(left, unit.minX);
      top = Math.min(top, unit.minY);
      right = Math.max(right, unit.maxX);
      bottom = Math.max(bottom, unit.maxY);
    }
    const box = {
      left: left * zoom + this._camera.x,
      top: top * zoom + this._camera.y,
      right: right * zoom + this._camera.x,
      bottom: bottom * zoom + this._camera.y,
    };
    const rect = this._viewport.getBoundingClientRect();
    return {
      box,
      view: { width: rect.width || 800, height: rect.height || 600 },
      offset: { left: this._viewport.offsetLeft, top: this._viewport.offsetTop },
    };
  },

  /**
   * Raggruppa (T51): un gruppo attorno alle schede scelte, con un margine,
   * messo nella pila subito sotto la prima di loro, così resta dietro; poi è
   * scelto lui. Un passo d'annulla solo.
   */
  _groupSelection(this: CanvasEngine): void {
    if (!this._doc || this._readOnly || this._isSceneOversized()) return;
    const group = this._writeOps(this._groupOps())?.[0];
    if (group === undefined) return;
    this._selection = [group];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._render();
  },

  /** `group` delle schede scelte: il rettangolo, il margine e il posto nella pila li dà il nucleo. */
  _groupOps(this: CanvasEngine): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    return ids.length > 0 ? [{ op: "group", ids }] : null;
  },

  /** La prima scheda scelta, a cui vanno le frecce e Invio. */
  _selectionFocus(this: CanvasEngine): CanvasNode | undefined {
    const first = this._selection[0];
    return first ? this._doc?.nodes.find((n) => n.id === first) : undefined;
  },

  _selectAll(this: CanvasEngine): void {
    if (!this._doc) return;
    this._selection = this._doc.nodes.map((n) => n.id);
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._render();
  },

  /**
   * Le frecce: con la lavagna scrivibile spostano la scelta di `dx`, `dy`;
   * in sola lettura passano alla scheda dopo (`forward`) o prima; senza
   * scelta prendono la prima scheda.
   */
  _nudge(this: CanvasEngine, dx: number, dy: number, forward: boolean): void {
    if (!this._doc) return;
    const focus = this._selectionFocus();
    if (focus && !this._readOnly) {
      this._writeOps(this._nudgeOps(dx, dy));
    } else if (focus) {
      const index = this._doc.nodes.indexOf(focus);
      const next = this._doc.nodes[index + (forward ? 1 : -1)];
      if (next) {
        this._selection = [next.id];
        this._options.onSelectionChange();
        this._render();
      }
    } else if (this._doc.nodes.length) {
      this._selection = [this._doc.nodes[0].id];
      this._options.onSelectionChange();
      this._render();
    }
  },

  /** Il colore `color` (`undefined`: quello di serie) al filo `edge`, o alle schede scelte, o ai fili scelti. */
  _colorSelection(this: CanvasEngine, color: string | undefined, edge?: string): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._colorOps(color, edge));
  },

  /**
   * `color` di ciò che il menu colora: il filo `edge`, o le schede scelte, o
   * i fili scelti (nell'ordine della lavagna). `undefined` toglie il colore.
   * `null` se non c'è niente da colorare.
   */
  _colorOps(this: CanvasEngine, color: string | undefined, edge?: string): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const nodes = edge === undefined ? this._selectedNodes().map((node) => node.id) : [];
    const wires = edge === undefined ? this._edgeSelection : [edge];
    const ids = nodes.length > 0 ? nodes : doc.edges.filter((one) => wires.includes(one.id)).map((one) => one.id);
    return ids.length > 0 ? [{ op: "color", ids, color: color ?? null }] : null;
  },

  /** `move` delle schede scelte di `dx`, `dy` (le frecce): un gruppo si sposta da solo. */
  _nudgeOps(this: CanvasEngine, dx: number, dy: number): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    return ids.length > 0 && (dx !== 0 || dy !== 0) ? [{ op: "move", ids, dx, dy }] : null;
  },

  // --- i colori (T47) ---------------------------------------------------------

  /**
   * Il colore di ciò che il menu colora: il filo `edge`, o le schede scelte,
   * o i fili scelti. `undefined` quello di serie, `null` se sono diversi.
   */
  _targetColor(this: CanvasEngine, edge?: string): string | null | undefined {
    if (edge !== undefined) return this._doc?.edges.find((one) => one.id === edge)?.color;
    if (this._selectedNodes().length) return this._chosenColor();
    const colors = new Set((this._doc?.edges ?? []).filter((one) => this._edgeSelection.includes(one.id)).map((one) => one.color ?? ""));
    if (colors.size > 1) return null;
    const [only] = colors;
    return only ? only : undefined;
  },

  /**
   * I pallini del menu dei colori: il colore che la pelle dà a ogni scelta,
   * letto da un campione con la sua chiave dentro la lavagna. Così il menu
   * mostra le tinte del tema di adesso e non ne scrive una sua; «Nessuno» è
   * un pallino vuoto, «Altro…» non ne ha.
   */
  _colorSwatches(this: CanvasEngine): ReadonlyMap<CanvasColorChoice, string> {
    const swatches = new Map<CanvasColorChoice, string>([["none", "transparent"]]);
    const probe = document.createElement("span");
    probe.hidden = true;
    this._root.append(probe);
    try {
      for (const choice of [...JSON_CANVAS_COLORS, ...NOTE_COLORS.map((color) => color.id)]) {
        probe.dataset.canvasColor = choice;
        const value = getComputedStyle(probe).getPropertyValue("--canvas-color").trim();
        if (value) swatches.set(choice, value);
      }
    } finally {
      probe.remove();
    }
    return swatches;
  },

  /**
   * «Altro…» (T47): il selettore del kit sotto la scheda scelta (o sulla
   * lavagna, per un filo), col colore di adesso, i nove delle note fra i
   * consigliati e i colori liberi della lavagna fra quelli del documento. Un
   * colore scelto si scrive `#rrggbb` minuscolo; Esc o un clic fuori lo
   * chiudono, e con la lavagna si chiude anche lui.
   */
  _openColorPicker(this: CanvasEngine, edge?: string): void {
    if (!this._doc || this._readOnly || this._destroyed) return;
    this._colorPicker?.close();
    const current = this._targetColor(edge);
    const own = openLifetime();
    const free = new Set<string>();
    for (const one of [...this._doc.nodes, ...this._doc.edges]) {
      if (colorLook(one.color)?.key === "custom" && free.size < 12) free.add(one.color!.toLowerCase());
    }
    const picker = createColorPicker({
      value: current && colorLook(current) && current.startsWith("#") ? current : null,
      text: canvasPickerText(),
      recommended: NOTE_COLORS.map((color) => ({ color: color.hex, name: colorMenuLabel(color.id) })),
      documentColors: [...free].map((color) => ({ color, name: color })),
      onChange: (color) => {
        const value = writeColor(color);
        if (value === null) return;
        this._recordPending();
        this._colorSelection(value, edge);
      },
      lifetime: own,
    });
    const first = edge === undefined && this._selection[0];
    const card = first ? this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(first)}"]`) : null;
    const handle = openPopover({
      anchor: card ?? this._viewport,
      content: picker.element,
      label: t("canvas.color.command.other"),
      className: "kit-color-popover",
      lifetime: own,
      onClose: () => {
        if (this._colorPicker === handle) this._colorPicker = null;
        own.close();
      },
    });
    this._colorPicker = handle;
    picker.focus();
  },

  /**
   * L'inversione del filo `edge`: `reverse` del nucleo, che scambia estremi e
   * lati e tiene le punte sulla scheda a cui stavano, come `reversedEdge` di
   * `model.ts` (#353). `null` se il filo non c'è.
   */
  _reverseOps(this: CanvasEngine, edge: string | undefined): CanvasIntentOp[] | null {
    const current = edge === undefined ? undefined : this._doc?.edges.find((one) => one.id === edge);
    return current ? [{ op: "reverse", ids: [current.id] }] : null;
  },

  /**
   * Apre la ricerca dei comandi sopra la tela, in alto al centro. Esc la
   * chiude e rimette il fuoco dov'era, anche nel campo di una scheda; un
   * comando scelto chiude prima il campo (il testo si registra) e poi parte.
   */
  _openCommandSearch(this: CanvasEngine): void {
    if (this._destroyed || !this._doc || this._searching) return;
    const recents = this._options.recentCommands ?? SHARED_RECENT_COMMANDS;
    const documentId = this._options.documentId ?? "";
    const viewport = this._viewport;
    const anchor = {
      getBoundingClientRect: () => {
        const rect = viewport.getBoundingClientRect();
        return { left: rect.left, top: rect.top + 8, width: rect.width, height: 0 };
      },
    };
    const commands = this.commands().filter((command) => command.id !== "canvas.commands");
    this._searching = true;
    const search = openCommandSearch({
      anchor,
      commands,
      recent: () => recents.list(documentId),
      lifetime: this._life,
      onClose: (reason, chosen) => {
        this._commandSearch = null;
        this._searching = false;
        if (this._destroyed) return;
        const editor = this._editor;
        if (chosen) {
          if (editor) this._leaveField(true);
          recents.remember(documentId, chosen.id);
          if (chosen.disabled() === null) chosen.run();
          this._statusSettle();
          return;
        }
        // Esc riporta il fuoco nel campo; un gesto fuori lo lascia, come
        // l'avrebbe lasciato senza la ricerca.
        if (editor && reason !== "escape" && !editor.place.contains(document.activeElement)) this._leaveField(false);
      },
    });
    this._commandSearch = search;
    // I recenti ricordati arrivano dopo la prima lettura, e l'elenco si rifà.
    void recents.load(documentId).then(() => {
      if (this._commandSearch === search) search.refresh();
    });
  },
  /**
   * Avvisa la banda se una sua voce è cambiata, a fine gesto: dentro un gesto
   * (un trascinamento, una panoramica, la rotella che gira) non dice niente, e
   * con la stessa firma di prima non avvisa.
   */
  _statusSettle(this: CanvasEngine): void {
    // La barra della selezione si rilegge anche lei qui: dentro un gesto sulle
    // schede sparisce. Dentro un gesto della camera (la rotella, il volo) la
    // segue già `_followSelectionBar`, senza rifarla a ogni passo (#411 C-06).
    if (!this._gestureActive() || this._cardGestureActive()) this._syncSelectionBar();
    if (this._destroyed || !this._doc || this._gestureActive()) return;
    // Il navigatore si rilegge con la banda, a fine gesto e al cambio del documento (T55).
    this._navigator.settle();
    this._twinsShown = this._twinsKey();
    const shown = statusSignature(canvasStatusItems(this._statusPort()));
    if (shown === this._statusShown) return;
    this._statusShown = shown;
    this._options.onStatusChange?.();
  },
};
export type CommandsMethods = typeof commandsMethods;
