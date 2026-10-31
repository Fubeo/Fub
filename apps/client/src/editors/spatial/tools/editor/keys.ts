// L'editor del disegno: le frecce, le finestre e l'elenco dei tasti. Un pezzo
// di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { promptForm, showKeys, type FormField, type KeyGroup, type MoreKeys } from "../../../../ui/form-dialog";
import { formatNumber } from "../../number";
import type { Op } from "../../scene/ops";
import { t, type DrawKey } from "../../strings";
import { gesture as asGesture } from "../edit";
import { GRID_MAJOR } from "../grid";
import { sceneArrow } from "../../view";
import type { Unit } from "../hit";
import { featuresFor, levelsAbove, toolKeys, toolsOf, type Feature, type Level } from "../registry";
import {
  BAR_FEATURES,
  COPY_STYLE_BINDING,
  IMAGE_BINDING,
  NUDGE,
  NUDGE_SHIFT,
  PASTE_STYLE_BINDING,
} from "./constants";
import type { EditorContext } from "./context";

/// Di quanto le frecce muovono il cursore del foglio, in pixel: con Maiusc a
/// passi lunghi, con Ctrl o ⌘ a passi corti.
const CURSOR_PX = 10;

const CURSOR_PX_SHIFT = 50;

const CURSOR_PX_FINE = 1;

/// Le frecce, come direzione.
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/// Le frecce come si leggono nell'elenco dei tasti.
const ARROW_KEYS = "←↑→↓";

/// Il nome di ogni livello, come lo dice l'elenco dei tasti.
const LEVEL_NAMES: Readonly<Record<Level, DrawKey>> = {
  essential: "draw.level.essential",
  standard: "draw.level.standard",
  expert: "draw.level.expert",
  custom: "draw.level.custom",
};

/// Ciò che le frecce, le finestre e l'elenco dei tasti dà agli altri pezzi dell'editor.
export interface KeysContext {
  focusArrange: () => boolean;
  arrows: (event: KeyboardEvent) => boolean;
  visit: (units: readonly Unit[], at: number) => boolean;
  walk: (step: 1 | -1) => boolean;
  walkList: (anchor: Unit | null) => readonly Unit[];
  properties: () => Promise<void>;
  PLACES: 2;
  keys: () => Promise<void>;
}

/// Monta le frecce, le finestre e l'elenco dei tasti.
export function installKeys(ctx: EditorContext): void {
  const {
    folio, has, arrangeBar, editable, currentIndex, announce, lengthSpoken, lengthField, fieldValue, selectedUnits, labelOf, showPanel, rootText, commit, moveSelection, select, frameBounds, cancelGesture, gridOn, moveCursor, moveCursorOnGrid, arrangeFocus, boundsOf, placeSelection, resizeSelection, moveOnGrid, resizeOnGrid,
    options
  } = ctx;
  // --- Frecce, finestre ed elenco dei tasti -----------------------------------

  /// Alt+F10: il fuoco va alla barra della selezione, se c'è.
  const focusArrange = (): boolean => {
    if (arrangeBar.hidden) return false;
    arrangeFocus.sync(null);
    const target = arrangeFocus.current();
    if (target === null) return false;
    target.focus();
    return true;
  };
  ctx.focusArrange = focusArrange;

  /// Le frecce sul foglio. Con una selezione la spostano, e con Ctrl o ⌘ la
  /// ridimensionano; senza, o mentre la tastiera preme, muovono il cursore.
  /// Con l'aggancio vanno di riga in riga della griglia, cinque con Maiusc.
  /// Con lo strumento Sfumatura spostano il capo o il punto scelto, mai
  /// l'oggetto; col contagocce muovono sempre il cursore, che prende da ciò
  /// che gli sta sotto.
  ///
  /// Sul foglio girato il cursore libero va dove la freccia punta sullo
  /// schermo, come il puntatore; il resto va lungo l'asse del disegno che si
  /// vede più vicino a lei, e Ctrl o ⌘ allarga con → e ↓ e stringe con ← e ↑
  /// la misura che si vede in quel verso.
  const arrows = (event: KeyboardEvent): boolean => {
    const direction = ARROWS[event.key];
    if (direction === undefined) return false;
    const [x, y] = sceneArrow(ctx.camera, direction);
    const grow = direction[0] + direction[1];
    const fine = event.ctrlKey || event.metaKey;
    const lines = event.shiftKey ? GRID_MAJOR : 1;
    if (ctx.pressed === null && ctx.selection.length > 0 && editable()) {
      const step = event.shiftKey ? NUDGE_SHIFT : NUDGE;
      const [gx, gy] = [x === 0 ? 0 : grow, y === 0 ? 0 : grow];
      if (gridOn()) {
        if (fine) resizeOnGrid(gx, gy, lines);
        else moveOnGrid(x, y, lines);
      } else if (fine) {
        resizeSelection(gx * step, gy * step);
      } else {
        moveSelection(selectedUnits(), x * step, y * step);
      }
      return true;
    }
    // Ctrl o ⌘ lascia il cursore libero, come lascia libero il puntatore.
    if (gridOn() && !fine) {
      moveCursorOnGrid(x, y, lines);
      return true;
    }
    const px = fine ? CURSOR_PX_FINE : event.shiftKey ? CURSOR_PX_SHIFT : CURSOR_PX;
    moveCursor(direction[0] * px, direction[1] * px);
    return true;
  };
  ctx.arrows = arrows;

  /// Sceglie l'oggetto `at` in ordine di documento, lo porta in vista e lo
  /// dice. `false` se non c'è.
  const visit = (units: readonly Unit[], at: number): boolean => {
    const unit = units[at];
    if (unit === undefined) return false;
    cancelGesture();
    select([unit.key]);
    frameBounds(unit.bounds);
    announce(t("draw.walk", { object: labelOf(unit), index: at + 1, count: units.length }));
    return true;
  };
  ctx.visit = visit;

  /// Tab con una selezione: l'oggetto dopo l'ultimo scelto, o con Maiusc
  /// quello prima del primo. Oltre le estremità il Tab esce dal foglio. Con
  /// lo strumento Sfumatura passa prima di capo in capo e di punto in punto,
  /// e oltre l'ultimo all'oggetto dopo; con lo strumento Tavola, di tavola in
  /// tavola.
  const walk = (step: 1 | -1): boolean => {
    if (ctx.selection.length === 0 || ctx.pressed !== null) return false;
    const anchor = currentIndex().get(step > 0 ? ctx.selection[ctx.selection.length - 1]! : ctx.selection[0]!);
    const units = walkList(anchor);
    const at = anchor === null ? -1 : units.indexOf(anchor);
    return at >= 0 && visit(units, at + step);
  };
  ctx.walk = walk;

  /// Gli oggetti fra cui passano Tab, Inizio e Fine: quelli che si scelgono
  /// o, per un oggetto scelto dentro un gruppo, i suoi fratelli.
  const walkList = (anchor: Unit | null): readonly Unit[] => {
    const index = currentIndex();
    return anchor === null || index.units.includes(anchor) ? index.units : index.siblings(anchor);
  };
  ctx.walkList = walkList;

  /// Invio: le proprietà della selezione, o del disegno. Col pannello, il
  /// fuoco va al pannello, che le mostra anche in sola lettura; senza, una
  /// finestra le chiede, e il fuoco torna dov'era.
  async function properties(): Promise<void> {
    if (ctx.asking) return;
    if (has("properties")) {
      cancelGesture();
      showPanel(true);
      return;
    }
    if (!editable()) return;
    ctx.asking = true;
    cancelGesture();
    try {
      if (ctx.selection.length > 0) await placeDialog();
      else await documentDialog();
    } finally {
      ctx.asking = false;
    }
  }
  ctx.properties = properties;

  const PLACES = 2;
  ctx.PLACES = PLACES;

  const placeDialog = async (): Promise<void> => {
    const before = boundsOf(selectedUnits());
    if (before === null) return;
    const w = before.max[0] - before.min[0];
    const h = before.max[1] - before.min[1];
    const fields = [
      lengthField("x", "X", before.min[0]),
      lengthField("y", "Y", before.min[1]),
      // Un lato più corto di un centesimo non ha una misura da scrivere.
      { ...lengthField("w", t("draw.field.width"), w, 0.01), disabled: w < 0.01 },
      { ...lengthField("h", t("draw.field.height"), h, 0.01), disabled: h < 0.01 },
    ];
    const shown = fields.map((field) => field.value);
    const answer = await promptForm({ title: t("draw.properties.selection"), fields });
    if (answer === null || ctx.disposed || !editable()) return;
    // Mentre la finestra era aperta il disegno può essere cambiato: valgono
    // gli oggetti scelti adesso, e i campi non toccati restano esatti.
    const units = selectedUnits();
    const from = boundsOf(units);
    if (from === null) return;
    const exact = [from.min[0], from.min[1], from.max[0] - from.min[0], from.max[1] - from.min[1]];
    const value = (id: string, at: number): number => (answer[id] === undefined || answer[id] === shown[at] ? exact[at]! : fieldValue(answer[id]));
    const [x, y, width, height] = [value("x", 0), value("y", 1), value("w", 2), value("h", 3)];
    if (width === exact[2] && height === exact[3]) {
      moveSelection(units, x - from.min[0], y - from.min[1]);
      return;
    }
    if (placeSelection(units, from, { min: [x, y], max: [x + width, y + height] })) {
      announce(t("draw.resized", { width: lengthSpoken(width), height: lengthSpoken(height) }));
    }
  };

  const documentDialog = async (): Promise<void> => {
    const title = rootText("title");
    const desc = rootText("desc");
    const page = ctx.scene.root.page;
    const fields: FormField[] = [
      { id: "title", label: t("draw.field.title"), value: title, kind: "text" },
      { id: "desc", label: t("draw.field.desc"), value: desc, kind: "multiline" },
    ];
    const sizeFields = page === null ? null : [lengthField("w", t("draw.field.page_width"), page.width, 1), lengthField("h", t("draw.field.page_height"), page.height, 1)];
    const size = sizeFields?.map((field) => field.value) ?? null;
    if (sizeFields !== null) fields.push(...sizeFields);
    const answer = await promptForm({ title: t("draw.properties.document"), fields });
    if (answer === null || ctx.disposed || !editable()) return;
    const ops: Op[] = [];
    const meta: { title?: string | null; desc?: string | null } = {};
    const nextTitle = (answer.title ?? "").trim();
    const nextDesc = (answer.desc ?? "").trim();
    if (nextTitle !== title.trim()) meta.title = nextTitle === "" ? null : nextTitle;
    if (nextDesc !== desc.trim()) meta.desc = nextDesc === "" ? null : nextDesc;
    if (Object.keys(meta).length > 0) ops.push({ op: "meta", ...meta });
    const now = ctx.scene.root.page;
    if (now !== null && size !== null && (answer.w !== size[0] || answer.h !== size[1])) {
      const width = answer.w === size[0] ? now.width : fieldValue(answer.w ?? "");
      const height = answer.h === size[1] ? now.height : fieldValue(answer.h ?? "");
      ops.push({ op: "page", viewBox: [now.x, now.y, width, height].map((v) => formatNumber(v, PLACES)).join(" ") });
    }
    commit("draw.properties.document", asGesture(ops));
  };

  /// I tasti dei comandi della selezione, delle parti `at` che ne hanno.
  const arrangeKeys = (at: ReadonlySet<Feature>): KeyGroup[] => {
    if (!BAR_FEATURES.some((feature) => at.has(feature))) return [];
    const arrange = at.has("arrange");
    const links = at.has("links");
    const rows: KeyGroup["rows"] = [
      ...(arrange ? ([["Mod-d", t("draw.duplicate")], ["Mod-g", t("draw.group")], ["Mod-Shift-g", t("draw.ungroup")]] as const) : []),
      ...(links && options.links !== undefined ? [["Mod-k", t("draw.keys.link")] as const] : []),
      ...(links ? [["Mod-Shift-k", t("draw.unlink")] as const] : []),
      ...(arrange
        ? ([
            ["Mod-Shift-] Shift-PageUp", t("draw.order.front")],
            ["Mod-] PageUp", t("draw.order.forward")],
            ["Mod-[ PageDown", t("draw.order.backward")],
            ["Mod-Shift-[ Shift-PageDown", t("draw.order.back")],
          ] as const)
        : []),
      ...(arrange
        ? ([
            ["Alt-a Alt-d Alt-w Alt-s", t("draw.keys.align")],
            ["Alt-h Alt-v", t("draw.keys.center")],
            ["Alt-Shift-h Alt-Shift-v", t("draw.keys.distribute")],
          ] as const)
        : []),
      ["Alt-F10", t("draw.keys.arrange")],
    ];
    return [{ title: t("draw.arrange"), rows }];
  };

  /// I tasti della griglia, se le parti `at` la offrono.
  const gridKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("grid")
      ? [
          {
            title: t("draw.keys.grid"),
            rows: [
              ["# Mod-'", t("draw.keys.grid.show")],
              ["%", t("draw.keys.grid.snap")],
              ["Mod", t("draw.keys.grid.free")],
            ],
          },
        ]
      : [];



  /// I tasti del pannello delle proprietà, se le parti `at` lo offrono.
  const propertiesKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("properties")
      ? [
          {
            title: t("draw.properties"),
            rows: [
              ["Enter", t("draw.keys.properties.apply")],
              ["↑↓", t("draw.keys.properties.step")],
              ["Mod-Enter", t("draw.keys.properties.text")],
              ["Escape", t("draw.keys.properties.revert")],
            ],
          },
        ]
      : [];






  /// I tasti delle forme dal tratto, se le parti `at` le offrono.
  const recognizeKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("recognize") ? [{ title: t("draw.feature.recognize"), rows: [["Shift", t("draw.keys.recognize.regular")]] }] : [];

  /// I tasti della cronologia, se le parti `at` la offrono.
  const historyKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("history")
      ? [
          {
            title: t("draw.history"),
            rows: [
              ["Enter Space", t("draw.keys.history.go")],
              ["F2", t("draw.keys.history.rename")],
              ["Delete", t("draw.keys.history.unmark")],
              ["Escape", t("draw.keys.history.leave")],
            ],
          },
        ]
      : [];

  /// I tasti della verifica dell'accessibilità, se le parti `at` la offrono.
  const accessKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("accessibility")
      ? [
          {
            title: t("draw.access"),
            rows: [
              ["ArrowUp ArrowDown Home End", t("draw.keys.access.walk")],
              ["Enter Space", t("draw.keys.access.go")],
              ["Alt-ArrowUp Alt-ArrowDown", t("draw.keys.access.move")],
              ["Escape", t("draw.keys.access.leave")],
            ],
          },
        ]
      : [];



  /// I tasti della selezione avanzata.
  const selectionKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("selection")
      ? [
          {
            title: t("draw.selection.menu"),
            rows: [
              ["Mod", t("draw.keys.deep")],
              ["Mod-Enter", t("draw.keys.isolate")],
              ["Escape", t("draw.keys.isolate.exit")],
              ["Mod-Shift-l", t("draw.keys.lock")],
              ["Mod-Shift-h", t("draw.keys.hide")],
              ["Shift-F10", t("draw.keys.menu")],
            ],
          },
        ]
      : [];

  /// L'elenco dei tasti delle parti `at`, nei gruppi in cui si usano.
  /// I tasti dell'evidenziatore, se le parti `at` lo offrono.
  const highlighterKeys = (at: ReadonlySet<Feature>): KeyGroup[] =>
    at.has("highlighter") ? [{ title: t("draw.tool.highlighter"), rows: [["Shift", t("draw.keys.highlighter.straight")]] }] : [];

  /// I tasti del foglio delle annotazioni.
  const sheetKeys = (): KeyGroup[] =>
    folio === undefined
      ? []
      : [
          {
            title: t("draw.keys.sheet"),
            rows: [
              ["PageUp PageDown", t("draw.keys.sheet.turn")],
              ["Enter", t("draw.keys.sheet.add")],
              ["F2", t("draw.keys.sheet.note")],
            ],
          },
        ];

  const keyGroups = (at: ReadonlySet<Feature>): KeyGroup[] => [
    { title: t("draw.keys.tools"), rows: toolsOf(at).map((spec) => [toolKeys(spec), t(spec.label)] as const) },
    {
      title: t("draw.keys.cursor"),
      rows: [
        [ARROW_KEYS, t(gridOn(at) ? "draw.keys.cursor.move.grid" : "draw.keys.cursor.move")],
        ["Space Enter", t("draw.keys.cursor.press")],
        ["Space", t("draw.keys.space.hand")],
        ["Escape", t("draw.keys.cancel")],
      ],
    },
    {
      title: t("draw.objects"),
      rows: [
        [ARROW_KEYS, t(gridOn(at) ? "draw.keys.nudge.grid" : "draw.keys.nudge")],
        [`Mod-${ARROW_KEYS}`, t(gridOn(at) ? "draw.keys.resize.grid" : "draw.keys.resize")],
        ["[ ]", t("draw.keys.rotate")],
        ["[ ]", t("draw.keys.nib")],
        ["Shift-h Shift-v", t("draw.keys.flip")],
        ["Tab Shift-Tab", t("draw.keys.walk")],
        ["Home End", t("draw.keys.ends")],
        ["Enter", t(at.has("properties") ? "draw.keys.properties.panel" : "draw.properties")],
        ...(options.links === undefined ? [] : [["Alt-Enter", t("draw.keys.link.open")] as const]),
        ["Delete", t("draw.delete")],
        ["Mod-a", t("draw.keys.all")],
        ["Escape", t("draw.keys.deselect")],
        ...(at.has("layers")
          ? [["F2", t("draw.keys.rename")] as const, ["Mod-f", t("draw.keys.filter")] as const, ["Alt-ArrowUp Alt-ArrowDown", t("draw.keys.step")] as const]
          : []),
      ],
    },
    ...sheetKeys(),
    ...arrangeKeys(at),
    ...selectionKeys(at),
    ...highlighterKeys(at),
    ...recognizeKeys(at),
    ...gridKeys(at),
    ...propertiesKeys(at),
    {
      title: t("draw.view"),
      rows: [
        ["+", t("draw.zoom_in")],
        ["-", t("draw.zoom_out")],
        ["0 Mod-0", t("draw.keys.actual")],
        ["Shift-1", t("draw.fit")],
        ["Shift-2", t("draw.fit.selection")],
        ["Mod-y", t("draw.outlines")],
        ["Mod-/", t("draw.keys.commands")],
        ["Mod-.", t("draw.bare")],
        ...(at.has("gestures") ? ([["4", t("draw.turn.left")], ["6", t("draw.turn.right")], ["5", t("draw.turn.straighten")]] as const) : []),
        // Col menu della selezione il radiale sta in fondo a quel menu.
        ...(at.has("gestures") && !at.has("selection") ? ([["Shift-F10", t("draw.keys.radial")]] as const) : []),
      ],
    },
    {
      title: t("draw.edit"),
      rows: [
        ["Mod-z", t("draw.undo")],
        ["Mod-Shift-z", t("draw.redo")],
        ["Mod-x", t("draw.cut")],
        ["Mod-c", t("draw.copy")],
        ["Mod-v", t("draw.keys.paste")],
        ["Mod-Shift-v", t("draw.paste.in_place")],
        ...(at.has("style") ? ([[COPY_STYLE_BINDING, t("draw.style.copy")], [PASTE_STYLE_BINDING, t("draw.style.paste")]] as const) : []),
        ...(ctx.insertsImages(at) ? [[IMAGE_BINDING, t("draw.image.vault")] as const] : []),
        ["?", t("draw.keys")],
      ],
    },
    ...historyKeys(at),
    ...accessKeys(at),
  ];

  /// I tasti che i livelli sopra quello di adesso aggiungono, col livello da
  /// cui valgono: una riga è nuova se il suo gruppo non aveva i suoi tasti.
  /// Per il Personalizzato sono quelli delle parti che non ha, col livello
  /// pronto da cui valgono; con uno spazio di lavoro, quelli di Completo.
  const moreKeys = (): MoreKeys => {
    const seen = new Set<string>();
    const remember = (group: KeyGroup, keys: string): boolean => {
      const id = `${group.title}\u0000${keys}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    };
    for (const group of keyGroups(ctx.features)) for (const [keys] of group.rows) remember(group, keys);
    const groups: KeyGroup[] = [];
    // Con uno spazio di lavoro, i tasti che mancano sono quelli di Completo.
    if (ctx.byWorkspace) {
      for (const group of keyGroups(featuresFor("expert"))) {
        const rows = group.rows.filter(([keys]) => remember(group, keys));
        if (rows.length > 0) groups.push({ title: group.title, rows });
      }
      return { groups, note: t("draw.keys.more.workspace") };
    }
    for (const above of levelsAbove(ctx.level)) {
      for (const group of keyGroups(featuresFor(above))) {
        const rows = group.rows.filter(([keys]) => remember(group, keys));
        if (rows.length > 0) groups.push({ title: t("draw.keys.from_level", { group: group.title, level: t(LEVEL_NAMES[above]) }), rows });
      }
    }
    return { groups, note: ctx.level === "custom" ? t("draw.keys.more.custom") : t("draw.keys.more", { level: t(LEVEL_NAMES[ctx.level]) }) };
  };

  /// I tasti che fanno altro rispetto a prima, per chi li ha in mano: quelli
  /// degli strumenti che ci sono, Spazio e il menu.
  const changedKeys = (): { changed?: KeyGroup } => {
    const tools = new Set(toolsOf(ctx.features).map((spec) => spec.id));
    const rows: [string, string][] = [];
    if (tools.has("hand")) rows.push(["h", t("draw.keys.changed.hand")]);
    if (tools.has("hand")) rows.push(["Space", t("draw.keys.changed.space")]);
    if (has("selection") && has("gestures")) rows.push(["Shift-F10", t("draw.keys.changed.menu")]);
    rows.push(["Mod-y", t("draw.keys.changed.outline")]);
    return rows.length === 0 ? {} : { changed: { title: t("draw.keys.changed"), rows } };
  };

  /// «?»: l'elenco dei tasti di questo livello, e con «Mostra tutto» quelli
  /// dei livelli sopra. Il livello non si cambia da qui: lo sceglie chi
  /// prepara il vault, e l'Essenziale resta tale anche in mano a un bambino.
  async function keys(): Promise<void> {
    if (ctx.asking) return;
    ctx.asking = true;
    cancelGesture();
    try {
      // Sul foglio i livelli non si cambiano: niente tasti degli altri.
      await showKeys(t("draw.keys"), keyGroups(ctx.features), folio === undefined ? moreKeys() : undefined, {
        search: { label: t("draw.keys.search"), empty: t("draw.keys.search.none") },
        ...changedKeys(),
      });
    } finally {
      ctx.asking = false;
    }
  }
  ctx.keys = keys;
}
