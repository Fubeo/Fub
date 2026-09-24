// Named `.base` views on indexed notes. The surface owns only its local view
// choice and rendering; edits go through registered commands with CAS.
import { currentTheme, type Theme } from "../../theme/theme";
import { EVERY_DOCUMENT } from "../../host/contract";
import { api } from "../../host/ipc";
import { registerCustomRenderer } from "../../ui/custom";
import { errorText, isErrorKind } from "../../host/errors";
import { onLanguage, t } from "../../i18n/strings";
import type { DocumentUpdate } from "../text/engine";
import { onEvent } from "../../state/kernel";
import type { EditorSurface, SurfaceMountContext } from "../core/registry";
import { uniformRowRange } from "../grid/engine";
import {
  BASE_FORMAT, BASE_MAP_ATTRIBUTION_FALLBACK, BASE_RENDERER_NS,
  allowedBaseTileUrl, baseRowsToCsv, baseSurfaceModes, cellText, deriveBaseRows, expectedProperty,
  fetchAllDocuments, parseBaseEmbed, parseBaseViews, persistBaseView,
  planBaseView, prepareBaseMutations, restoreBaseView,
  type BaseCellValue, type BasePlan, type BaseRow, type BaseSurfaceDeps,
} from "./data";

export interface BaseMountDeps extends BaseSurfaceDeps {
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  /** Trusted host-supplied exact-host allowlist; .base YAML cannot grant it. */
  readonly mapTileHosts?: readonly string[];
}
const SVG = "http://www.w3.org/2000/svg";
const VISIBLE_STEP = 100;
const TABLE_ROW_HEIGHT = 36;
const TABLE_VIEWPORT_HEIGHT = 560;
const labels = () => ({
  view: t("menu.view"), search: t("rail.search"), retry: t("app.retry"),
  loading: t("search.loading"), more: t("search.more", { shown: VISIBLE_STEP, total: VISIBLE_STEP }),
});
function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", action);
  return element;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function mountBaseSurface(
  profile: string, context: SurfaceMountContext, deps: BaseMountDeps,
  options: { view?: string | null; persistSelection?: boolean; container?: string | null } = {},
): EditorSurface {
  if (profile !== "base") throw new Error(`base surface profile ${profile} is not registered`);
  const root = document.createElement("div");
  root.className = "base-surface";
  root.dataset.format = BASE_FORMAT;
  root.dataset.theme = currentTheme();
  const toolbar = document.createElement("div");
  toolbar.className = "base-toolbar";
  const views = document.createElement("select");
  views.className = "base-views";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "base-search";
  const newNote = button("+", () => void createNote());
  const copyCsv = button("Copy CSV", () => void copyResults());
  copyCsv.className = "base-csv-copy";
  const downloadCsv = button("Export CSV", () => exportResults());
  downloadCsv.className = "base-csv";
  const status = document.createElement("div");
  status.className = "base-status";
  status.setAttribute("role", "status");
  const body = document.createElement("div");
  body.className = "base-body";
  toolbar.append(views, search, newNote, copyCsv, downloadCsv, status);
  root.append(toolbar, body);
  context.parent.replaceChildren(root);

  let destroyed = false;
  let readOnly = false;
  let source = "";
  let names: string[] = [];
  let activeView: string | null = options.view ?? null;
  let plan: BasePlan | null = null;
  let rows: BaseRow[] = [];
  let summaries: Record<string, BaseCellValue> = {};
  let displayed = VISIBLE_STEP;
  let error: string | null = null;
  let generation = 0;
  let pending: AbortController | null = null;
  let tileCleanup: (() => void) | null = null;
  let writeEpoch = 0;
  let persistQueue = Promise.resolve();
  const localLanes = new Map<string, Set<string>>();
  const downloads = new Map<string, number>();
  const saveLanes = (view: string) => {
    const laneNames = [...(localLanes.get(view) ?? [])];
    persistQueue = persistQueue.then(() => destroyed ? undefined : deps.setViewState(`base.kanban-lanes:${context.documentId}:${view}`, laneNames)).catch(presentError);
  };
  const container = options.container === undefined ? context.documentId || null : options.container;
  const valid = (ticket: number) => !destroyed && generation === ticket;
  const filteredRows = (): BaseRow[] => {
    const needle = search.value.trim().toLocaleLowerCase();
    return needle ? rows.filter((row) => row.doc.toLocaleLowerCase().includes(needle) || Object.values(row.values).some((value) => cellText(value).toLocaleLowerCase().includes(needle))) : rows;
  };
  const presentError = (reason: unknown): void => {
    error = errorText(reason);
    status.textContent = error;
    body.replaceChildren(button(labels().retry, () => void reload(true)));
  };
  const fillOptions = (): void => {
    views.replaceChildren(...names.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === activeView;
      return option;
    }));
  };
  const reload = async (replan: boolean): Promise<void> => {
    const ticket = ++generation;
    pending?.abort();
    const request = new AbortController();
    pending = request;
    status.textContent = labels().loading;
    try {
      const definition = source;
      if (replan || !plan) {
        const nextNames = await parseBaseViews(deps, definition);
        if (!valid(ticket)) return;
        if (options.persistSelection === false && options.view && !nextNames.includes(options.view)) {
          throw new Error(`base: vista inesistente ${options.view}`);
        }
        let chosen = activeView;
        if (!chosen || !nextNames.includes(chosen)) {
          const restored = options.persistSelection === false ? null : await restoreBaseView(deps, context.documentId);
          if (!valid(ticket)) return;
          chosen = restored && nextNames.includes(restored) ? restored : (nextNames[0] ?? null);
        }
        if (!chosen) throw new Error("base: nessuna vista definita");
        const nextPlan = await planBaseView(deps, definition, chosen);
        if (!valid(ticket)) return;
        names = nextNames;
        activeView = chosen;
        plan = nextPlan;
        if (nextPlan.viewType === "kanban") {
          const saved = await deps.viewState<unknown>(`base.kanban-lanes:${context.documentId}:${nextPlan.view}`);
          if (!valid(ticket)) return;
          if (saved === null) localLanes.set(nextPlan.view, new Set());
          else if (Array.isArray(saved) && saved.length <= 128 && saved.every((lane) => typeof lane === "string" && lane.length <= 256)) localLanes.set(nextPlan.view, new Set(saved));
          else throw new Error("base: corsie salvate malformate");
        }
        fillOptions();
      }
      const nextPlan = plan;
      if (!nextPlan) throw new Error("base: piano assente");
      const found = await fetchAllDocuments(deps, EVERY_DOCUMENT, nextPlan.allProperties ? { kind: "all" } : { kind: "keys", keys: nextPlan.requiredProps }, { offset: 0, limit: 256 }, request.signal);
      if (!valid(ticket)) return;
      const result = await deriveBaseRows(deps, definition, nextPlan.view, found.rows, Date.now(), container);
      if (!valid(ticket)) return;
      rows = result.rows;
      summaries = result.summaries;
      displayed = VISIBLE_STEP;
      error = null;
      draw();
    } catch (failure) {
      if (!valid(ticket) || request.signal.aborted) return;
      presentError(failure);
    } finally {
      if (pending === request) pending = null;
    }
  };
  const open = (doc: string): void => { void Promise.resolve(deps.onOpenDocument(doc)).catch(presentError); };
  const editCell = async (row: BaseRow, column: string, value: string | null): Promise<void> => {
    if (readOnly || !plan || column.startsWith("formula.") || column.startsWith("file.")) return;
    const expected = expectedProperty(row, column);
    const view = plan.view;
    const epoch = writeEpoch;
    const definition = source;
    newNote.disabled = true;
    try {
      const mutations = await prepareBaseMutations(deps, definition, view, [{ doc: row.doc, key: column, expected, value }]);
      if (destroyed || readOnly || writeEpoch !== epoch || source !== definition || plan?.view !== view) return;
      for (const mutation of mutations) {
        if (destroyed || readOnly || writeEpoch !== epoch || source !== definition || plan?.view !== view) return;
        await deps.invokeCommand(mutation.command, mutation.args);
      }
      if (!destroyed) await reload(true);
    } catch (failure) {
      if (destroyed) return;
      // No optimistic overwrite. The original observation stays on screen and
      // the next explicit reload will fetch the conflicting authoritative note.
      if (isErrorKind(failure, "conflict")) {
        draw();
        status.textContent = errorText(failure);
      } else presentError(failure);
    } finally { newNote.disabled = readOnly; }
  };
  const editable = (row: BaseRow, column: string): HTMLElement => {
    const field = document.createElement("span");
    field.className = "base-cell";
    const value = row.values[column];
    const writable = !readOnly && !column.startsWith("formula.") && !column.startsWith("file.") && value?.kind !== "error";
    if (value?.kind === "bool") {
      const control = document.createElement("input");
      control.type = "checkbox";
      control.checked = value.value;
      control.disabled = !writable;
      control.setAttribute("aria-label", `${row.doc} ${column}`);
      control.addEventListener("change", () => void editCell(row, column, control.checked ? "true" : "false"));
      field.append(control);
    } else if (writable && (!value || value.kind === "empty" || value.kind === "text" || value.kind === "number")) {
      const control = document.createElement("input");
      control.type = "text";
      control.value = cellText(value);
      control.setAttribute("aria-label", `${row.doc} ${column}`);
      control.addEventListener("change", () => void editCell(row, column, control.value === "" ? null : JSON.stringify(control.value)));
      field.append(control);
    } else {
      field.textContent = cellText(value);
      if (value?.kind === "error") field.classList.add("base-cell-error");
    }
    return field;
  };
  const drawTable = (page: BaseRow[]): void => {
    const viewport = document.createElement("div");
    viewport.className = "base-table-viewport";
    viewport.style.cssText = `max-height:${TABLE_VIEWPORT_HEIGHT}px;overflow:auto;`;
    const table = document.createElement("table");
    table.className = "base-table";
    table.style.tableLayout = "fixed";
    const head = table.createTHead().insertRow();
    for (const column of ["", ...(plan?.columns ?? [])]) { const th = document.createElement("th"); th.textContent = column ? plan?.columnLabels[column] ?? column : t("menu.file"); head.append(th); }
    const tableBody = table.createTBody();
    const spacer = (height: number): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      tr.setAttribute("aria-hidden", "true");
      const td = tr.insertCell();
      td.colSpan = (plan?.columns.length ?? 0) + 1;
      td.style.cssText = `height:${height}px;padding:0;border:0`;
      return tr;
    };
    const renderWindow = () => {
      const range = uniformRowRange(page.length, viewport.scrollTop, viewport.clientHeight || TABLE_VIEWPORT_HEIGHT, TABLE_ROW_HEIGHT);
      if (!range) { tableBody.replaceChildren(); return; }
      const fragment = document.createDocumentFragment();
      if (range.start) fragment.append(spacer(range.start * TABLE_ROW_HEIGHT));
      for (let index = range.start; index <= range.end; index++) {
        const row = page[index]!;
        const tr = document.createElement("tr");
        tr.dataset.doc = row.doc;
        tr.style.height = `${TABLE_ROW_HEIGHT}px`;
        const fileCell = tr.insertCell();
        fileCell.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        fileCell.append(button(row.doc, () => open(row.doc)));
        for (const column of plan?.columns ?? []) {
          const cell = tr.insertCell();
          cell.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          cell.append(editable(row, column));
        }
        fragment.append(tr);
      }
      if (range.end + 1 < page.length) fragment.append(spacer((page.length - range.end - 1) * TABLE_ROW_HEIGHT));
      tableBody.replaceChildren(fragment);
    };
    viewport.addEventListener("scroll", renderWindow);
    viewport.append(table);
    body.append(viewport);
    renderWindow();
  };
  const drawCards = (page: BaseRow[], list: boolean): void => {
    const gallery = document.createElement("div");
    gallery.className = list ? "base-list" : "base-cards";
    for (const row of page) {
      const card = document.createElement("article");
      card.className = "base-card";
      card.dataset.doc = row.doc;
      card.append(button(row.doc, () => open(row.doc)));
      for (const column of plan?.columns ?? []) {
        const field = document.createElement("div");
        field.className = "base-field";
        const label = document.createElement("span");
        label.textContent = plan?.columnLabels[column] ?? column;
        field.append(label, editable(row, column));
        card.append(field);
      }
      gallery.append(card);
    }
    body.append(gallery);
  };
  const drawKanban = (page: BaseRow[]): void => {
    const key = plan?.group, view = plan?.view;
    if (!key || !view) throw new Error("base: board senza gruppo");
    const groups = new Map<string, BaseRow[]>();
    for (const row of page) {
      const name = cellText(row.values[key]);
      const members = groups.get(name) ?? [];
      members.push(row);
      groups.set(name, members);
    }
    for (const name of localLanes.get(view) ?? []) if (!groups.has(name)) groups.set(name, []);
    const board = document.createElement("div");
    board.className = "base-kanban";
    const writable = !readOnly && !key.startsWith("formula.") && !key.startsWith("file.");
    const remember = (name: string) => {
      let lanes = localLanes.get(view);
      if (!lanes) { lanes = new Set(); localLanes.set(view, lanes); }
      if (lanes.size >= 128 && !lanes.has(name)) throw new Error("base: troppe corsie");
      lanes.add(name);
      saveLanes(view);
    };
    for (const [name, members] of groups) {
      const lane = document.createElement("section");
      lane.className = "base-kanban-column";
      lane.dataset.group = name;
      const heading = document.createElement("h3");
      heading.textContent = `${name || "∅"} (${members.length})`;
      lane.append(heading);
      if (writable && name) {
        lane.append(button(t("base.lane.rename"), () => {
          const input = document.createElement("input");
          input.value = name;
          input.setAttribute("aria-label", t("base.lane.rename_named", { name }));
          heading.replaceWith(input);
          input.focus();
          input.select();
          let finished = false;
          const commit = () => {
            if (finished) return;
            finished = true;
            const next = input.value.trim();
            if (!next || next === name) { draw(); return; }
            if (next.length > 256 || groups.has(next)) { status.textContent = "base: corsia duplicata o troppo lunga"; draw(); return; }
            remember(next);
            localLanes.get(view)?.delete(name);
            saveLanes(view);
            void (async () => {
              try {
                await persistQueue;
                for (const member of rows.filter((row) => cellText(row.values[key]) === name)) {
                  const [mutation] = await prepareBaseMutations(deps, source, view, [{ doc: member.doc, key, expected: expectedProperty(member, key), value: JSON.stringify(next) }]);
                  if (destroyed || readOnly || !mutation) return;
                  await deps.invokeCommand(mutation.command, mutation.args);
                }
                await reload(true);
              } catch (failure) { if (!destroyed) { status.textContent = errorText(failure); void reload(true); } }
            })();
          };
          input.addEventListener("keydown", (event) => { if (event.key === "Enter") commit(); else if (event.key === "Escape") { finished = true; draw(); } });
          input.addEventListener("blur", () => { if (input.isConnected) commit(); });
        }));
      }
      if (writable) lane.append(button("+ Card", () => void createNote(name)));
      for (const row of members) {
        const card = document.createElement("article");
        card.className = "base-kanban-card";
        card.draggable = writable;
        card.append(button(row.doc, () => open(row.doc)));
        if (writable) card.addEventListener("dragstart", (event) => event.dataTransfer?.setData("application/x-fub-base-doc", row.doc));
        lane.append(card);
      }
      if (writable) {
        lane.addEventListener("dragover", (event) => event.preventDefault());
        lane.addEventListener("drop", (event) => {
          event.preventDefault();
          const target = page.find((row) => row.doc === event.dataTransfer?.getData("application/x-fub-base-doc"));
          if (target && cellText(target.values[key]) !== name) void editCell(target, key, JSON.stringify(name));
        });
      }
      board.append(lane);
    }
    if (writable) {
      const add = document.createElement("input");
      add.placeholder = t("base.lane.add_placeholder");
      add.setAttribute("aria-label", t("base.lane.add"));
      add.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const name = add.value.trim();
        if (!name || name.length > 256 || groups.has(name)) { status.textContent = "base: corsia duplicata o vuota"; return; }
        remember(name);
        draw();
      });
      board.append(add);
    }
    body.append(board);
  };
  const drawMap = (page: BaseRow[]): void => {
    const config = plan?.map;
    if (!config) throw new Error("base: coordinate non configurate");
    const wrapper = document.createElement("div");
    wrapper.className = "base-map";
    wrapper.dataset.provider = "offline";
    const atlas = svg("svg", { viewBox: "0 0 720 360", role: "img", "aria-label": t("base.map.label"), tabindex: "0" });
    atlas.classList.add("base-map-atlas");
    const world = svg("g", {});
    const tiles = svg("g", { class: "base-map-tiles" });
    const grid = svg("g", { class: "base-map-grid" });
    const mercatorY = (lat: number) => {
      const phi = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
      return (1 - Math.asinh(Math.tan(phi)) / Math.PI) * 180;
    };
    world.append(tiles);
    for (let lon = -150; lon <= 150; lon += 30) grid.append(svg("line", { x1: String((lon + 180) * 2), x2: String((lon + 180) * 2), y1: "0", y2: "360", stroke: "currentColor", opacity: ".25" }));
    for (let lat = -60; lat <= 60; lat += 30) grid.append(svg("line", { x1: "0", x2: "720", y1: String(mercatorY(lat)), y2: String(mercatorY(lat)), stroke: "currentColor", opacity: ".25" }));
    world.append(grid);
    for (const row of page) {
      const lat = row.values[config.lat_key], lon = row.values[config.lon_key];
      if (lat?.kind !== "number" || lon?.kind !== "number" || !Number.isFinite(lat.value) || !Number.isFinite(lon.value) || Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180) continue;
      const name = config.label_key ? cellText(row.values[config.label_key]) || row.doc : row.doc;
      const marker = svg("circle", { cx: String((lon.value + 180) * 2), cy: String(mercatorY(lat.value)), r: "5", class: "base-map-marker", role: "button", tabindex: "0", "aria-label": name });
      const color = config.color_key ? row.values[config.color_key] : undefined;
      if (color?.kind === "text" && /^#[0-9a-fA-F]{3,8}$/.test(color.value)) marker.setAttribute("fill", color.value);
      marker.append(svg("title", {}));
      marker.querySelector("title")!.textContent = name;
      marker.addEventListener("click", () => open(row.doc));
      marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(row.doc); } });
      world.append(marker);
    }
    atlas.append(world);
    let zoom = 1, x = 0, y = 0;
    const update = () => { world.setAttribute("transform", `translate(${x} ${y}) scale(${zoom})`); };
    const provider = config.provider;
    const allowedHosts = deps.mapTileHosts ?? [];
    const template = provider?.url_template;
    const firstTile = provider?.network && provider.kind !== "offline" && template
      ? allowedBaseTileUrl(template, provider.kind, allowedHosts, 1, 0, 0) : null;
    const attribution = document.createElement("p");
    attribution.className = "base-map-attribution";
    let tileRequest: AbortController | null = null;
    const tileUrls = new Set<string>();
    const releaseTiles = () => {
      tileRequest?.abort();
      tileRequest = null;
      for (const url of tileUrls) URL.revokeObjectURL(url);
      tileUrls.clear();
      tiles.replaceChildren();
    };
    tileCleanup = releaseTiles;
    const paintTiles = async () => {
      if (!provider || provider.kind === "offline" || !template || !firstTile || wrapper.dataset.provider === "offline") return;
      releaseTiles();
      const request = new AbortController();
      tileRequest = request;
      const level = Math.min(3, Math.floor(Math.log2(zoom)) + 1), count = 2 ** level;
      try {
        const images = document.createDocumentFragment();
        // Browser <image href=https:> follows redirects past the allowlist.
        // Fetch without redirects/credentials, bound bytes, then paint local blobs.
        for (let col = 0; col < count; col++) for (let row = 0; row < count; row++) {
          const url = allowedBaseTileUrl(template, provider.kind, allowedHosts, level, col, row);
          if (!url) throw new Error("tile endpoint outside allowlist");
          const response = await fetch(url, { signal: request.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
          const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
          const types = provider.kind === "vector" ? ["image/svg+xml"] : ["image/png", "image/jpeg", "image/webp"];
          if (!response.ok || !mime || !types.includes(mime) || !response.body || Number(response.headers.get("content-length") ?? 0) > 1024 * 1024) throw new Error("tile response unavailable or unsupported");
          const reader = response.body.getReader();
          const chunks: ArrayBuffer[] = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 1024 * 1024) throw new Error("tile exceeds 1 MiB");
              chunks.push(new Uint8Array(value).buffer as ArrayBuffer);
            }
          } finally { reader.releaseLock(); }
          if (request.signal.aborted || !wrapper.isConnected) return;
          const blobUrl = URL.createObjectURL(new Blob(chunks, { type: mime }));
          tileUrls.add(blobUrl);
          images.append(svg("image", { x: String(col * 720 / count), y: String(row * 360 / count), width: String(720 / count), height: String(360 / count), href: blobUrl }));
        }
        if (!request.signal.aborted && wrapper.isConnected) tiles.replaceChildren(images);
      } catch (reason) {
        if (request.signal.aborted) return;
        wrapper.dataset.provider = "offline";
        releaseTiles();
        attribution.textContent = t("base.map.tiles_failed", { reason: errorText(reason) });
      }
    };
    const zoomBy = (factor: number) => { zoom = Math.max(1, Math.min(8, zoom * factor)); update(); if (wrapper.dataset.provider !== "offline") void paintTiles(); };
    let drag: { x: number; y: number } | null = null;
    atlas.addEventListener("pointerdown", (event) => { if (event.target !== atlas && event.target !== grid && !(event.target instanceof SVGLineElement)) return; drag = { x: event.clientX, y: event.clientY }; atlas.setPointerCapture(event.pointerId); });
    atlas.addEventListener("pointermove", (event) => { if (!drag) return; const bounds = atlas.getBoundingClientRect(); x += (event.clientX - drag.x) * 720 / bounds.width; y += (event.clientY - drag.y) * 360 / bounds.height; drag = { x: event.clientX, y: event.clientY }; update(); });
    atlas.addEventListener("pointerup", () => { drag = null; });
    atlas.addEventListener("lostpointercapture", () => { drag = null; });
    atlas.addEventListener("wheel", (event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    atlas.addEventListener("keydown", (event) => {
      if (event.target !== atlas) return;
      if (event.key === "+" || event.key === "=") zoomBy(1.2);
      else if (event.key === "-") zoomBy(1 / 1.2);
      else if (event.key === "ArrowLeft") x += 25;
      else if (event.key === "ArrowRight") x -= 25;
      else if (event.key === "ArrowUp") y += 25;
      else if (event.key === "ArrowDown") y -= 25;
      else return;
      event.preventDefault(); update();
    });
    if (firstTile && provider) {
      attribution.textContent = t("base.map.offline", { provider: provider.attribution ?? new URL(firstTile).hostname });
      wrapper.append(button(t("base.map.enable"), () => {
        wrapper.dataset.provider = provider.kind;
        void paintTiles();
        attribution.textContent = provider.attribution ?? new URL(firstTile).hostname;
      }));
    } else {
      attribution.textContent = provider?.kind && provider.kind !== "offline"
        ? t("base.map.tiles_denied")
        : BASE_MAP_ATTRIBUTION_FALLBACK;
    }
    wrapper.append(button("+", () => zoomBy(1.2)), button("−", () => zoomBy(1 / 1.2)), atlas, attribution);
    body.append(wrapper);
  };
  const draw = (): void => {
    tileCleanup?.();
    tileCleanup = null;
    body.replaceChildren();
    if (error) { body.append(button(labels().retry, () => void reload(true))); return; }
    const matches = filteredRows();
    const page = plan?.viewType === "table" ? matches : matches.slice(0, displayed);
    try {
      if (plan?.viewType === "table") drawTable(page);
      else if (plan?.viewType === "cards") drawCards(page, false);
      else if (plan?.viewType === "list") drawCards(page, true);
      else if (plan?.viewType === "kanban") drawKanban(page);
      else if (plan?.viewType === "map") drawMap(page);
      if (plan?.viewType !== "table" && displayed < matches.length) body.append(button(t("search.more", { shown: Math.min(displayed, matches.length), total: matches.length }), () => { displayed += VISIBLE_STEP; draw(); }));
      const footer = document.createElement("dl");
      footer.className = "base-summaries";
      for (const [key, value] of Object.entries(summaries)) { const label = document.createElement("dt"); label.textContent = key; const amount = document.createElement("dd"); amount.textContent = cellText(value); footer.append(label, amount); }
      body.append(footer);
      status.textContent = t("search.count_limited", { shown: matches.length, total: rows.length });
    } catch (failure) { presentError(failure); }
  };
  async function createNote(lane?: string): Promise<void> {
    if (readOnly) return;
    newNote.disabled = true;
    try {
      const defaults: Record<string, unknown> = Object.assign(Object.create(null), plan?.createDefaults ?? {});
      if (lane !== undefined && plan?.group) {
        const key = plan.group.replace(/^prop\./, "");
        if (Object.prototype.hasOwnProperty.call(defaults, key) && defaults[key] !== lane) throw new Error("base: corsia incompatibile con il filtro");
        defaults[key] = lane;
      }
      await deps.invokeCommand("note.create", Object.keys(defaults).length ? { properties: JSON.stringify(defaults) } : {});
      if (!destroyed) await reload(true);
    }
    catch (failure) { presentError(failure); }
    finally { newNote.disabled = readOnly; }
  }
  async function copyResults(): Promise<void> {
    try { await navigator.clipboard.writeText(baseRowsToCsv(filteredRows(), plan?.columns ?? [])); status.textContent = "CSV"; }
    catch (failure) { presentError(failure); }
  }
  function exportResults(): void {
    try {
      const csv = baseRowsToCsv(filteredRows(), plan?.columns ?? []);
      const filename = `${(plan?.view ?? "base").replace(/[^a-zA-Z0-9_-]+/g, "_")}.csv`;
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      root.append(link);
      try { link.click(); status.textContent = filename; }
      finally {
        link.remove();
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
        downloads.set(url, timer);
      }
    } catch (failure) { presentError(failure); }
  }
  // Base owns no derived index. Member changes and index completion invalidate
  // every open view, including embeds. Coalesce one event burst and let the
  // generation/AbortController discard stale in-flight derivations.
  let refreshQueued = false;
  const memberChanged = () => {
    writeEpoch++;
    if (destroyed || !source || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!destroyed) void reload(false);
    });
  };
  const stopEvents = [
    onEvent("document_changed", (event) => { if (!event.changes || event.changes.aspects.length) memberChanged(); }),
    onEvent("document_removed", memberChanged),
    onEvent("document_renamed", memberChanged),
    onEvent("index_updated", memberChanged),
    onEvent("batch_ended", memberChanged),
    onEvent("overflow", memberChanged),
  ];
  const relabel = () => {
    views.setAttribute("aria-label", labels().view);
    search.setAttribute("aria-label", labels().search);
    search.placeholder = labels().search;
    newNote.setAttribute("aria-label", t("explorer.new.hint"));
    copyCsv.setAttribute("aria-label", "CSV");
    if (!error && rows.length) draw();
  };
  const stopLanguage = onLanguage(relabel);
  relabel();
  views.addEventListener("change", () => {
    activeView = views.value;
    plan = null;
    const chosen = activeView;
    if (options.persistSelection !== false) {
      persistQueue = persistQueue.then(() => destroyed ? undefined : persistBaseView(deps, context.documentId, chosen)).catch(presentError);
    }
    void reload(true);
  });
  search.addEventListener("input", () => { displayed = VISIBLE_STEP; draw(); });
  const modes = baseSurfaceModes();
  return {
    family: "structured", profile: "base", surfaceId: context.paneId, modes,
    setMode(mode: string) { if (!modes.some((candidate) => candidate.id === mode)) throw new RangeError(`surface mode ${mode} is not supported`); root.dataset.surfaceMode = mode; },
    setDoc(text: string) { source = text; void reload(true); },
    syncDoc(update: DocumentUpdate | string) { const next = typeof update === "string" ? update : update.text; if (next !== source) { source = next; void reload(true); } },
    getDoc() { return source; },
    focus() { search.focus(); },
    setReadOnly(next: boolean) {
      if (readOnly === next) return;
      if (next) writeEpoch++;
      readOnly = next;
      root.dataset.readOnly = String(next);
      newNote.disabled = next;
      draw();
    },
    setTheme(theme: Theme) { root.dataset.theme = theme; },
    destroy() {
      destroyed = true; generation++; pending?.abort(); tileCleanup?.();
      for (const stop of stopEvents) stop();
      for (const [url, timer] of downloads) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
      downloads.clear();
      stopLanguage(); root.remove();
    },
  };
}

/** Native fenced and file-backed Base embeds use the same surface and data ports. */
export function registerBaseRenderer(onOpenDocument: (doc: string) => void | Promise<void>): void {
  registerCustomRenderer(BASE_RENDERER_NS, (host, payload) => {
    const embed = parseBaseEmbed({ node: "custom", ns: BASE_RENDERER_NS, payload, fallback: [] });
    if (!embed) return;
    let disposed = false;
    const surface = mountBaseSurface("base", {
      paneId: `base:embed:${crypto.randomUUID()}`,
      documentId: embed.base ?? embed.container ?? "",
      parent: host,
    }, {
      queryIndex: api.queryIndex,
      invokeCommand: api.invokeCommand,
      viewState: api.viewState,
      setViewState: api.setViewState,
      onOpenDocument,
    }, { view: embed.view, persistSelection: false, container: embed.container ?? embed.base ?? null });
    const source = embed.source === undefined
      ? api.readDocument(embed.base!).then((document) => document.text)
      : Promise.resolve(embed.source);
    void source.then((text) => {
      if (!disposed) surface.setDoc(text);
    }, (error: unknown) => {
      if (disposed) return;
      surface.destroy();
      host.textContent = errorText(error);
    });
    return () => { disposed = true; surface.destroy(); };
  }, (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const fields = payload as Record<string, unknown>;
    return typeof fields.source === "string" || typeof fields.base === "string";
  });
}
