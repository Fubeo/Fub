// Il motore della lavagna: il menu contestuale della superficie, pubblico.
// Metodo della classe `CanvasEngine`, montato sul suo prototipo da
// `engine.ts` (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { MENU_RULE, menuBelow, type SurfaceMenu, type SurfaceMenuClipboard, type SurfaceMenuEntry, type SurfaceMenuItem } from "../core/editor-menu";
import { CANVAS_LAYOUTS, menuChord } from "./chrome/commands";
// I colori delle schede e dei fili (T47).
import { JSON_CANVAS_COLORS, NOTE_COLORS, colorChoiceOf, colorMenuLabel, type CanvasColorChoice } from "./colors";
import { MenuEntryMaker, ColorMenuMaker } from "./engine-parts";
import type { CanvasEngine } from "./engine";

export const menuApi = {
  // --- menu -----------------------------------------------------------------------

  /** Il menu del tasto destro nel punto `at` della finestra (`null`: dalla
   *  tastiera, sulla selezione). Una scheda o un collegamento fuori dalla
   *  selezione diventano la selezione; sul vuoto si aggiunge lì. */
  contextMenu(this: CanvasEngine, at: { x: number; y: number } | null): SurfaceMenu | null {
    if (this._destroyed || !this._doc || this._isSceneOversized()) return null;
    const element = at ? this._elementAt(at.x, at.y) : null;
    if (at && (!element || !this._viewport.contains(element))) return null;
    const node = element ? this._nodeAt(element) : this._selection[0] ?? null;
    const edge = node ? null : element ? this._edgeAt(element) : this._edgeSelection[0] ?? null;
    const chosen = node ? !this._selection.includes(node) : edge ? !this._edgeSelection.includes(edge) : at !== null && (this._selection.length > 0 || this._edgeSelection.length > 0);
    if (chosen) {
      this._selection = node ? [node] : [];
      this._edgeSelection = edge ? [edge] : [];
      this._options.onSelectionChange();
      this._displaySelection();
    }
    // Le voci vengono dal catalogo dei comandi (T48): il nome, il tasto, se
    // si può e perché no. Il menu dice solo quali voci, in che ordine e su
    // che cosa (`args`); `refocus` rimette il fuoco sulla tela dopo il gesto.
    const catalog = new Map(this.commands().map((command) => [command.id, command]));
    const entry: MenuEntryMaker = (id, args, refocus = true, extra = {}) => {
      const command = catalog.get(id);
      if (!command) throw new Error(`canvas: il comando ${id} non è nel catalogo`);
      const why = command.disabled();
      const chord = menuChord(command.keys);
      return {
        id,
        label: command.label,
        ...(chord === undefined ? {} : { chord }),
        enabled: why === null,
        ...(why === null ? {} : { description: why }),
        ...(command.danger ? { danger: true } : {}),
        ...extra,
        run: () => {
          if (command.disabled() !== null) return;
          command.run(args);
          this._statusSettle();
          if (refocus) this._viewport.focus();
        },
      };
    };
    const writable = !this._readOnly;
    // «Colore ›» (T47): Nessuno e i sei di JSON Canvas col loro pallino,
    // «Colori delle note ›» coi nove, «Altro…» che apre il selettore. Tutte
    // scelte esclusive, segnata quella di adesso; `null` (colori diversi) non
    // ne segna nessuna, come un colore che non è un colore.
    let swatches: ReadonlyMap<CanvasColorChoice, string> | null = null;
    const colors: ColorMenuMaker = (current, args) => {
      swatches ??= this._colorSwatches();
      const chosen = current === null ? null : colorChoiceOf(current);
      const choice = (value: CanvasColorChoice): SurfaceMenuItem => {
        const swatch = swatches!.get(value);
        return entry(`canvas.color.${value}`, args, value !== "other", {
          label: colorMenuLabel(value),
          radio: true,
          checked: chosen === value,
          ...(swatch === undefined ? {} : { swatches: [swatch] }),
        });
      };
      return {
        id: "canvas.color",
        label: t("canvas_menu.color"),
        enabled: writable,
        items: [
          choice("none"),
          ...JSON_CANVAS_COLORS.map(choice),
          MENU_RULE,
          {
            id: "canvas.color.notes",
            label: t("canvas_menu.color.notes"),
            enabled: writable,
            items: NOTE_COLORS.map((color) => choice(color.id)),
          },
          choice("other"),
        ],
      };
    };
    if (node) {
      const nodes = this._selectedNodes();
      const one = nodes.length === 1 ? nodes[0]! : null;
      const box = this._stage.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(node)}"]`)?.getBoundingClientRect();
      const at = box ? menuBelow(box) : undefined;
      // Copia, Taglia e Incolla portano le schede, i fili fra loro e l'inchiostro (T68).
      const clipboard: SurfaceMenuClipboard = {
        offers: { cut: writable, copy: true, paste: writable },
        run: (op) => this._clipboardMenu(op),
      };
      if (one?.type !== "group") {
        // Dentro la scheda attiva (una cella, la nota che si scrive, la
        // pagina), o dalla tastiera con la scheda attiva, il menu porta in
        // testa «Apri a lato» su quel punto (T45).
        const inside = node === this._activeId && (element === null || this._insideActive(element, true));
        return { target: this._cardMenuTarget(nodes, node), at, context: this._cardMenu(nodes, entry, colors, inside), clipboard };
      }
      // Un gruppo solo ha il suo menu di sempre.
      const context: SurfaceMenuEntry[] = [
        colors(one.color),
        entry("canvas.duplicate"),
        {
          id: "canvas.order",
          label: t("canvas_menu.order"),
          enabled: writable,
          items: [entry("canvas.bring_front"), entry("canvas.send_back")],
        },
        entry("canvas.fit_selection", undefined, false),
        entry("canvas.delete"),
      ];
      return { target: { kind: "group", ref: node }, at, context, clipboard };
    }
    if (edge) {
      const current = this._doc.edges.find((one) => one.id === edge);
      if (!current) return null;
      return {
        target: { kind: "edge", ref: edge },
        context: [colors(current.color, { edge }), entry("canvas.edge.reverse", { edge }), entry("canvas.delete")],
      };
    }
    const here = at ? { at } : undefined;
    return {
      target: { kind: "empty" },
      clipboard: { offers: { paste: writable }, run: (op) => this._clipboardMenu(op) },
      context: [
        {
          id: "canvas.add",
          label: t("canvas_menu.add_here"),
          enabled: writable,
          items: [
            // La scheda nasce in scrittura (IMP-042): il fuoco resta nel suo testo.
            entry("canvas.add.text", here, false),
            ...(this._options.onPickFile ? [entry("canvas.add.file", here, false)] : []),
            entry("canvas.add.link", here),
            entry("canvas.add.group", here),
          ],
        },
        // «Disponi ›» senza selezione (LIC T25): tutte le schede fuori dai gruppi.
        {
          id: "canvas.arrange",
          label: t("canvas_menu.arrange"),
          enabled: writable,
          items: CANVAS_LAYOUTS.map((kind) => entry(`canvas.layout.${kind}`)),
        },
        entry("canvas.copy_code"),
        entry("canvas.paste_code", undefined, false),
        MENU_RULE,
        entry("canvas.fit", undefined, false),
        ...(at ? [entry("canvas.zoom_in", here, false), entry("canvas.zoom_out", here, false)] : []),
        // Nascondi o Mostra il navigatore (T55), quella che c'è.
        ...["canvas.navigator.hide", "canvas.navigator.show"].filter((id) => catalog.has(id)).map((id) => entry(id, undefined, false)),
        // Il menu radiale (T63), anche dalla tastiera (Maiusc+F10): il fuoco
        // va al menu, non torna sulla lavagna.
        entry("canvas.radial", here, false),
      ],
    };
  },
};
export type MenuApi = typeof menuApi;
