// Il motore della lavagna: il menu della lavagna e il menu radiale. Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { MENU_RULE, type SurfaceMenu, type SurfaceMenuEntry, type SurfaceMenuItem } from "../core/editor-menu";
import { cardKindOf } from "../core/cards/contract";
import { CANVAS_ALIGN, CANVAS_LAYOUTS, CANVAS_TOOL_KEYS, menuChord } from "./chrome/commands";
import { openCanvasRadial } from "./chrome/radial";
import type { Radial, RadialPointer } from "../spatial/tools/radial";
import { noteExcerptOf } from "./excerpt";
import { inkStrokeTool } from "./ink-record";
import { type CanvasNode } from "./model";
import { MenuEntryMaker, ColorMenuMaker } from "./engine-parts";
import { cardMenuName } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const menuMethods = {
  /**
   * La testata del menu di una scheda (T17): «Scheda di {specie}» col nome
   * (il file, l'indirizzo, la prima riga del testo), o «{n} schede».
   */
  _cardMenuTarget(this: CanvasEngine, nodes: readonly CanvasNode[], ref: string): SurfaceMenu["target"] {
    if (nodes.length !== 1) return { kind: "node", ref, label: t("canvas_menu.header_many", { n: String(nodes.length) }) };
    const one = nodes[0]!;
    const kind = one.type === "text" ? "text" : cardKindOf(one) ?? "file";
    const label = t("canvas_menu.header", { kind: t(`canvas_menu.kind.${kind}`) });
    const name = cardMenuName(one);
    return name ? { kind: "node", ref, label, name } : { kind: "node", ref, label };
  },

  /**
   * Il menu «Scheda della lavagna» (T17), voci del catalogo nell'ordine di
   * `tasto-destro.md`: Apri, Apri a lato, Collega… · C; Colore › (scelte
   * esclusive), Disponi ›, Duplica; in fondo, in rosso, Togli dalla lavagna e,
   * con le schede di file, Sposta anche il file nel cestino. Con più schede
   * niente Apri né Collega…; in sola lettura le voci che cambiano sono spente
   * col perché, non nascoste. Con `inside` (il tasto destro dentro la scheda
   * attiva) in testa c'è «Apri a lato» sul punto in cui si è (T45): ciò che
   * la scheda non fa, nell'editor intero.
   */
  _cardMenu(this: CanvasEngine, nodes: readonly CanvasNode[], entry: MenuEntryMaker, colors: ColorMenuMaker, inside = false): SurfaceMenuEntry[] {
    const one = nodes.length === 1 ? nodes[0]! : null;
    const readOnly = this._readOnly ? t("canvas.commands.why.read_only") : null;
    const state = (why: string | null): Pick<SurfaceMenuItem, "enabled" | "description"> =>
      why === null ? { enabled: true } : { enabled: false, description: why };
    const context: SurfaceMenuEntry[] = [];
    if (inside && one?.type === "file" && this._besideHere() !== null) {
      context.push(entry("canvas.open_beside_here", undefined, false, { icon: "draw-open-link" }), MENU_RULE);
    }
    // «Parti…» per prima, come nel prototipo (T28): riapre il selettore.
    if (one && this._options.parts && this._partsNote(one)) context.push(entry("canvas.parts", undefined, false));
    // «Mostra tutto il file» sotto «Parti…» (T75, prototipo T28); in sola lettura no.
    if (one && !this._readOnly && noteExcerptOf(one)) context.push(entry("canvas.whole_file", undefined, false));
    if (one?.type === "text") {
      context.push(entry("canvas.edit", undefined, false));
      // Convertire (T70): il testo in una nota nuova; il dialogo prende il fuoco.
      if (this._options.notes) context.push(entry("canvas.extract_note", undefined, false));
    }
    if (one?.type === "file" && one.file) {
      context.push(entry(cardKindOf(one) === "image" ? "canvas.open_viewer" : "canvas.open", undefined, false));
      // «Ritaglia e ruota» (T78), come nel prototipo T28 dopo Apri; in sola
      // lettura la voce non c'è.
      if (!this._readOnly && this._cropImage(one) && this._cropRenderer()) {
        context.push(entry("canvas.crop", undefined, false, { icon: "draw-image" }));
      }
      if (this._options.onOpenPathBeside) context.push(entry("canvas.open_beside", undefined, false));
      // «Spargi le pagine…» (T72): solo su un PDF; spenta, col perché, se non si apre.
      if (cardKindOf(one) === "pdf") context.push(entry("canvas.spread_pages", undefined, false));
      // Convertire (T70): il testo della nota accanto; un altro file al posto di questo.
      if (this._options.notes && cardKindOf(one) === "note") context.push(entry("canvas.copy_note_text"));
      if (this._options.onPickFile) context.push(entry("canvas.replace_file", undefined, false));
    }
    if (one?.type === "link") {
      context.push(entry("canvas.open_url", undefined, false));
      if (this._options.cards) context.push(entry("canvas.web_preview", undefined, false));
    }
    // Collega… si fa anche con C, il tasto dello strumento.
    if (one) context.push(entry("canvas.connect", undefined, true, { chord: menuChord([CANVAS_TOOL_KEYS.connect]) }));
    if (context.length) context.push(MENU_RULE);
    const two = nodes.length >= 2 ? null : t("canvas.commands.why.two");
    const three = nodes.length >= 3 ? null : t("canvas.commands.why.three");
    context.push(
      { ...colors(this._chosenColor()), ...state(readOnly) },
      {
        id: "canvas.arrange",
        label: t("canvas_menu.arrange"),
        ...state(readOnly),
        items: [
          entry("canvas.bring_front"),
          entry("canvas.send_back"),
          MENU_RULE,
          {
            id: "canvas.align",
            label: t("canvas_menu.align_to"),
            ...state(readOnly ?? two),
            items: CANVAS_ALIGN.map((axis) => entry(`canvas.align.${axis}`)),
          },
          {
            id: "canvas.distribute",
            label: t("canvas_menu.distribute"),
            ...state(readOnly ?? three),
            items: [entry("canvas.distribute_x"), entry("canvas.distribute_y")],
          },
          // «Disponi» col nucleo (LIC T25): griglia, riga, colonna, albero.
          MENU_RULE,
          ...CANVAS_LAYOUTS.map((kind) => entry(`canvas.layout.${kind}`)),
        ],
      },
      entry("canvas.duplicate"),
      // La lavagna come codice (LIC T25): «Incolla codice» apre la conferma, che prende il fuoco.
      entry("canvas.copy_code"),
      entry("canvas.paste_code", undefined, false),
      MENU_RULE,
      entry("canvas.delete"),
    );
    if (this._options.onTrashPath && nodes.some((node) => node.type === "file")) context.push(entry("canvas.trash_file", undefined, false));
    return context;
  },

  /**
   * Apre il menu radiale in `x`, `y` della finestra (`openRadial`, che a un
   * bordo lo sposta dove si vede intero): Annulla e Ripeti, gli ultimi tre
   * strumenti e gli ultimi tre colori della penna. `held` è il puntatore
   * ancora giù che l'ha aperto, che il menu segue; `keyboard` lo apre dalla
   * tastiera, col fuoco sulla prima voce.
   */
  _openRadial(this: CanvasEngine, x: number, y: number, held: RadialPointer | null, keyboard = false): void {
    if (this._destroyed || !this._doc) return;
    // Le voci sono comandi del catalogo, letti adesso: dopo una voce la banda
    // di stato si rilegge, come dopo una voce del menu.
    const catalog = new Map(this.commands().map((command) => [command.id, command]));
    let radial: Radial | null = null;
    radial = openCanvasRadial(x, y, {
      command: (id) => {
        const command = catalog.get(id);
        return command === undefined ? null : {
          ...command,
          run: (args) => {
            command.run(args);
            this._statusSettle();
          },
        };
      },
      tool: this._tool,
      recentTools: this._recentTools,
      color: this._penColor,
      recentColors: this._recentColors,
      readOnly: this._readOnly || this._isSceneOversized(),
      pickTool: (tool) => {
        this._recordPending();
        this._pickTool(tool);
      },
      pickColor: (color) => {
        const tool = inkStrokeTool(this._penChoice);
        this._choosePen({ ...this._penChoice, color: { ...this._penChoice.color, [tool]: color } }, true);
      },
    }, {
      held,
      keyboard,
      onClose: () => {
        if (this._radial === radial) this._radial = null;
      },
    });
    this._radial = radial;
  },

  /** «Menu radiale» del menu del tasto destro: dove si è cliccato, o al centro della vista dalla tastiera. */
  _openRadialFromMenu(this: CanvasEngine, at: { x: number; y: number } | null): void {
    if (at) {
      this._openRadial(at.x, at.y, null);
      return;
    }
    const rect = this._viewport.getBoundingClientRect();
    this._openRadial(rect.left + rect.width / 2, rect.top + rect.height / 2, null, true);
  },
};
export type MenuMethods = typeof menuMethods;
