// La Scrivania del banco (T40): `?scrivania=1` piena, `?scrivania=vuota` con
// i riquadri senza niente da dire, `?scrivania=nessuno` con tutti i riquadri
// tolti.
//
// L'albero ha la forma che disegna il provider vero (`dashboard/desk.rs` in
// fub-features), già tradotto: le chiavi `desk:<id>`, la riga di comandi
// `fub:desk-tile` con un'azione pronta per ogni posto, «Rimetti:» in fondo.
// Le azioni `desk.move`, `desk.hide` e `desk.show` cambiano davvero l'ordine
// di questa scenografia, così il trascinamento e Ctrl Maiusc ↑↓ si vedono.
// Il mese è agosto 2026 con oggi il 19, il giorno del banco (`MOMENT`): la foto non cambia col
// calendario.
import type { ActionRef, UiNode } from "../src/host/contract";

export type DeskCase = "piena" | "vuota" | "nessuno";

export function deskCase(param: string | null): DeskCase | null {
  if (param === "1") return "piena";
  if (param === "vuota") return "vuota";
  if (param === "nessuno") return "nessuno";
  return null;
}

const ALL = ["pinned", "recent", "tasks", "base", "month"] as const;
type Tile = (typeof ALL)[number];

const TITLES: Record<Tile, string> = {
  pinned: "Appuntate",
  recent: "Recenti",
  tasks: "Compiti di oggi",
  base: "Base",
  month: "Il mese",
};

const action = (name: string, payload: unknown = null): ActionRef => ({ action: name, payload });
const text = (content: string): UiNode => ({ node: "text", content });
const keyed = (key: string, node: UiNode): UiNode => ({ ...node, key }) as UiNode;
const empty = (title: string, detail: string | null = null): UiNode => ({ node: "empty_state", title, detail, action: null });
const button = (label: string, act: ActionRef, intent: "neutral" | "primary" = "neutral"): UiNode =>
  ({ node: "button", label, intent, action: act }) as UiNode;

function note(path: string, subtitle: string | null, key: string): UiNode {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return {
    node: "list_item",
    title: name,
    subtitle,
    action: action("desk.open", { doc: path }),
    selected: false,
    key,
    drag: { kind: "document", doc: path },
  } as UiNode;
}

function body(tile: Tile, full: boolean): UiNode[] {
  switch (tile) {
    case "pinned":
      return full
        ? [{ node: "list", items: [
            note("Progetti/Il banco che vede.md", "Progetti", "pinned:Progetti/Il banco che vede.md"),
            note("Guida/Sintassi di Fub.md", "Guida", "pinned:Guida/Sintassi di Fub.md"),
          ] }]
        : [empty("Nessuna nota appuntata", "Le note che appunti compaiono qui.")];
    case "recent":
      return full
        ? [{ node: "list", items: [
            note("Diario/2026-08-19.md", "19 ago 2026, 09:12", "recent:Diario/2026-08-19.md"),
            note("Guida/Frammenti di codice.md", "18 ago 2026, 18:40", "recent:Guida/Frammenti di codice.md"),
            note("Casa/Affitto di via Roma.md", "17 ago 2026, 11:05", "recent:Casa/Affitto di via Roma.md"),
            note("Archivio/Prima idea.md", "2 ago 2026, 21:30", "recent:Archivio/Prima idea.md"),
          ] }]
        : [empty("Nessuna nota nel vault")];
    case "tasks":
      return full
        ? [{ node: "list", items: [
            { node: "list_item", title: "Pagare l'affitto", subtitle: "Affitto di via Roma", action: action("desk.open", { doc: "Casa/Affitto di via Roma.md" }), selected: false, key: "task:Casa/Affitto di via Roma.md#12" } as UiNode,
            { node: "list_item", title: "Rivedere le foto del banco", subtitle: "Il banco che vede", action: action("desk.open", { doc: "Progetti/Il banco che vede.md" }), selected: false, key: "task:Progetti/Il banco che vede.md#40" } as UiNode,
          ] }]
        : [empty("Nessun compito per oggi")];
    case "base":
      return full
        ? [
            keyed("base:Opere.base", {
              node: "custom",
              ns: "fub:base",
              payload: { base: "Opere.base" },
              fallback: [{ node: "list_item", title: "Opere", subtitle: "Apri la Base", action: action("desk.open", { doc: "Opere.base" }), selected: false } as UiNode],
            }),
            keyed("base-choice", { node: "select", field: "base", label: "Base da mostrare", value: ["Opere.base"], options: [{ value: "", label: "Nessuna" }, { value: "Opere.base", label: "Opere.base" }], multiple: false, action: action("desk.base") } as UiNode),
          ]
        : [
            empty("La Base scelta non c'è più", "«Vecchia» è stata spostata o cancellata. Scegline un'altra qui sotto."),
            keyed("base-choice", { node: "select", field: "base", label: "Base da mostrare", value: [""], options: [{ value: "", label: "Nessuna" }, { value: "Liste/Libri.base", label: "Liste/Libri.base" }], multiple: false, action: action("desk.base") } as UiNode),
          ];
    case "month":
      return month();
  }
}

/// Agosto 2026: il primo è sabato, le settimane cominciano il lunedì.
function month(): UiNode[] {
  const days = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
  const offset = 5;
  const rows: UiNode[] = [];
  for (let week = 0; week * 7 - offset < 31; week++) {
    const cells: UiNode[] = [];
    for (let d = 0; d < 7; d++) {
      const n = week * 7 + d - offset + 1;
      if (n < 1 || n > 31) {
        cells.push(text(""));
        continue;
      }
      const date = `2026-08-${String(n).padStart(2, "0")}`;
      cells.push(keyed(date, button(String(n), action("desk.day", { date }), n === 19 ? "primary" : "neutral")));
    }
    rows.push(keyed(`week-${week}`, { node: "row", cells, action: null }));
  }
  return [
    text("Agosto 2026"),
    keyed("month-2026-08", {
      node: "table",
      columns: days.map((title) => ({ title, align: "center" })),
      rows,
    } as UiNode),
  ];
}

function frame(instance: string, tile: Tile, at: number, count: number, full: boolean): UiNode {
  const key = `desk:${tile}`;
  const moves = Array.from({ length: count }, (_, to) => action("desk.move", { tile, to }));
  const hide = action("desk.hide", { tile });
  const fallback: UiNode[] = [];
  if (at > 0) fallback.push(button("Sposta su", moves[at - 1]!));
  if (at + 1 < count) fallback.push(button("Sposta giù", moves[at + 1]!));
  fallback.push(button("Togli", hide));
  const head = keyed(`${key}:head`, {
    node: "stack",
    dir: "row",
    gap: 8,
    children: [
      { node: "heading", level: 3, content: TITLES[tile] },
      keyed(`${key}:commands`, { node: "custom", ns: "fub:desk-tile", payload: { desk: instance, frame: key, tile, at, moves, hide }, fallback }),
    ],
  });
  return keyed(key, { node: "stack", dir: "column", gap: 6, children: [head, ...body(tile, full)] });
}

/// La Scrivania di una scena: l'ordine vive qui, come l'impostazione vera.
export function deskScene(which: DeskCase) {
  let order: Tile[] = which === "nessuno" ? [] : [...ALL];
  const full = which === "piena";

  const tree = (instance: string): UiNode => {
    const children: UiNode[] = [];
    if (order.length === 0) {
      children.push(keyed("desk-empty", empty("La Scrivania è vuota", "Rimetti un riquadro con i bottoni qui sotto.")));
    } else {
      children.push(keyed("desk-board", {
        node: "stack",
        dir: "row",
        gap: 12,
        children: order.map((tile, at) => frame(instance, tile, at, order.length, full)),
      }));
    }
    const hidden = ALL.filter((tile) => !order.includes(tile));
    if (hidden.length > 0) {
      children.push(keyed("desk-hidden", {
        node: "stack",
        dir: "row",
        gap: 6,
        children: [text("Rimetti:"), ...hidden.map((tile) => keyed(`desk-show:${tile}`, button(TITLES[tile], action("desk.show", { tile }))))],
      }));
    }
    return { node: "stack", dir: "column", gap: 12, children };
  };

  const act = (instance: string, name: string, payload: unknown): UiNode => {
    const p = (payload ?? {}) as { tile?: Tile; to?: number };
    const tile = p.tile;
    if (tile && ALL.includes(tile)) {
      if (name === "desk.move" && order.includes(tile)) {
        const rest = order.filter((t) => t !== tile);
        rest.splice(Math.min(p.to ?? 0, rest.length), 0, tile);
        order = rest;
      } else if (name === "desk.hide") {
        order = order.filter((t) => t !== tile);
      } else if (name === "desk.show" && !order.includes(tile)) {
        order = [...order, tile];
      }
    }
    return tree(instance);
  };

  return { tree, act };
}
