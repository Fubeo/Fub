// La vista grafo del vault: renderer force-directed su Canvas.
//
// # Cosa è questo file, dalla §3.3
//
// **La metà shell di un componente che sta di là dal confine.** Il grafo è un
// `ViewProvider` (`crates/fub-features/src/graph.rs`): è lui a chiedere al
// canale dati quali documenti ci sono e quali archi li legano, e a mandarli qui
// dentro un `UiKind::Custom { ns: "fub:graph", payload }`. Questo file non parla
// con il kernel: riceve un payload e disegna.
//
// La divisione è quella che il §3.3 chiedeva, e la riga passa dove deve. `UiNode`
// non esprime un canvas, **né deve** — un protocollo dichiarativo che esprimesse
// un force-directed sarebbe un motore grafico travestito da enum — quindi il
// disegno resta di qua. Ciò che è passato di là sono i **dati**, che era la
// parte davvero privilegiata: finché a decidere nodi e archi era questo file, la
// vista a grafo era una cosa che solo la shell poteva fare.
//
// Di conseguenza questo modulo non è più un pannello e non ha più un overlay.
// Non si registra in `ui/panel-host.ts` — chi si registra è il pannello che
// `ui/views.ts` crea per il riquadro che ospita la view — e non sa **dove** sta
// disegnando: riceve un elemento, e quell'elemento è un riquadro dell'area
// principale, cioè una superficie con linguetta, che si divide e che si ricorda com'era.
//
// # Il 2.0: l'orchestratore sottile
//
// La fisica, il disegno e l'interazione stanno nei lotti B (`sim/*`,
// `render/*`, `interaction.ts`); qui resta solo il binding: leggere il payload,
// caricare la conf (`config.ts`), creare il `chart` e il `physics-panel`,
// e collegarli agli eventi della shell (il segnale `layout` per le note aperte,
// `onLanguage` per i testi). Il dispose restituisce lo smontaggio di entrambi.

import { openViewIn, layout, pane, panes } from "../state/layout";
import { registerCustomRenderer, type OnAction } from "../ui/custom";
import { registerShellCommand } from "../ui/commands";
import { $ } from "../ui/dom";
import { on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import { onLanguage, resolvedLanguage, t } from "../i18n/strings";
import { onEvent } from "../state/kernel";
import { setTooltip } from "../ui/tooltip";
import { GROUP_TOKENS } from "../graph/render/atlas";
import { nodeLabel } from "../graph/render/painter";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";
import { loadConfig, saveConfig } from "../graph/config";
import type { Chart } from "../graph/chart";
import type { SavedLayout } from "../graph/sim/memory";
import type { PanelCopy, PhysicsPanel } from "../graph/physics-panel";
type GraphEngine = typeof import("../graph/lazy");

/// Il namespace con cui il grafo arriva dal provider. È `fub_features::graph::GRAPH_NS`,
/// e la costanza dei due nomi è il contratto fra le due metà del componente.
export const GRAPH_NS = "fub:graph";
/// L'id della `ViewSpec` che il provider dichiara (`fub_features::graph::GRAPH_VIEW`).
///
/// Che questo file lo conosca **non** è la conoscenza privata che il §1.2 ha
/// tolto ai pannelli: quella era la shell che sapeva quali pannelli esistono.
/// Questo è un componente che conosce il proprio altro capo — la stessa cosa che
/// fa già con lo `ns` — e i due nomi viaggiano insieme perché nominano lo stesso
/// componente.
export const GRAPH_VIEW = "graph";

/// L'azione con cui si chiede al provider di aprire una nota, e la chiave del
/// suo payload. Gemelle di `OPEN` e `DOC` in `graph.rs`.
const OPEN = "open";
const DOC = "doc";


/// Ciò che arriva nel `payload` del nodo custom. La forma la decide `graph.rs`,
/// e questo tipo è la sua lettura di qua: se le due divergono, il grafo si
/// disegna vuoto invece di lanciare — un payload storto viene da un provider, e
/// un provider può essere di terzi.
interface GraphData {
  nodes: string[];
  edges: { from: string; to: string }[];
  /** Indexed current last-modification time, not historical graph snapshots. */
  modified: Record<string, number>;
  /// Il gruppo di ogni nodo (cartella o primo tag), se il provider lo manda.
  groups: Record<string, string>;
  /// La vista locale in corso, o `null` per il grafo intero.
  local: { seed: string; depth: number; direction: string } | null;
  filter: { showOrphans: boolean; showAttachments: boolean };
  groupBy: "folder" | "tag";
}

/// Attacca la metà shell del grafo: il renderer del suo `ns` e il comando che lo
/// apre.
export function mountGraph(lifetime: Lifetime): void {
  lifetime.listen($("#show-graph"), "click", () => openGraph());
  lifetime.add(on("active-doc", (doc) => {
    if (doc) lastDocument = doc;
  }));

  // Il grafo come **comando** (§18.2): era un bottone nella barra, e chi non lo
  // trovava con il mouse non lo trovava. L'id e la scorciatoia sono quelli di
  // prima — chi li ha imparati li tiene — ed è cambiato cosa fa: apriva un
  // overlay sopra tutto, adesso apre una linguetta nel riquadro col fuoco. Che sia un
  // comando è la parte che la 0077 ha reso non negoziabile.
  registerShellCommand({
    id: "shell.graph",
    title: "commands.graph",
    description: "commands.graph.desc",
    layer: "global",
    run: () => openGraph(),
  });

  registerCustomRenderer(GRAPH_NS, renderGraph);
}

/// Apre il grafo nel riquadro col fuoco.
///
/// **Nel riquadro col fuoco e non in uno nuovo**, che è la stessa regola con cui
/// si apre una nota dall'esploratore: chi lo vuole di lato divide prima, ed è un
/// gesto che ha già un comando suo (`shell.pane.split.right`). L'alternativa —
/// dividere da sé — deciderebbe al posto dell'utente come vuole la finestra, e
/// lo farebbe ogni volta.
///
/// Se la linguetta c'è già ci si sposta sopra: lo garantisce `apriVistaIn`, e per il
/// grafo conta più che per una nota — due linguetta sullo stesso grafo sarebbero due
/// simulazioni che girano insieme.
function openGraph(): void {
  openViewIn(layout.focus, GRAPH_VIEW);
}

/// I documenti aperti in un riquadro qualunque: sono i nodi che il grafo accende.
///
/// Erano **uno** — la nota attiva — e con N riquadri non lo sono più. Prenderne
/// uno solo vorrebbe dire scegliere fra due note che l'utente sta guardando
/// entrambe; e la nota «attiva» sarebbe per giunta `null` proprio mentre si
/// guarda il grafo, visto che il fuoco ce l'ha lui.
function openDocuments(): Set<string> {
  const open = new Set<string>();
  for (const id of panes()) {
    const p = pane(id);
    if (!p) continue;
    for (const tab of p.tabs) {
      if (tab.k === "doc") open.add(tab.doc);
    }
  }
  return open;
}

/// Legge il payload del provider, con la tolleranza che si deve a un dato che
/// viene da fuori.
function readData(payload: unknown): GraphData {
  const o = (payload ?? {}) as { nodes?: unknown; edges?: unknown; modified?: unknown };
  const nodes = Array.isArray(o.nodes) ? [...new Set(o.nodes.filter((n): n is string => typeof n === "string"))].sort() : [];
  const rawTimes: Record<string, unknown> = o.modified && typeof o.modified === "object" && !Array.isArray(o.modified)
    ? o.modified as Record<string, unknown> : {};
  const modified: Record<string, number> = Object.create(null);
  for (const id of nodes) {
    const raw = rawTimes[id];
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value)) modified[id] = value;
  }
  const edges = Array.isArray(o.edges)
    ? o.edges.filter(
        (e): e is { from: string; to: string } =>
          !!e && typeof e.from === "string" && typeof e.to === "string",
      )
    : [];
  const extra = (payload ?? {}) as { groups?: unknown; local?: unknown; filter?: unknown; group_by?: unknown };
  const groups: Record<string, string> = Object.create(null);
  if (extra.groups && typeof extra.groups === "object" && !Array.isArray(extra.groups)) {
    for (const [id, name] of Object.entries(extra.groups as Record<string, unknown>)) {
      if (typeof name === "string" && name !== "") groups[id] = name;
    }
  }
  const rawLocal = extra.local as { seed?: unknown; depth?: unknown; direction?: unknown } | undefined;
  const local = rawLocal && typeof rawLocal.seed === "string"
    ? {
      seed: rawLocal.seed,
      depth: typeof rawLocal.depth === "number" ? rawLocal.depth : 1,
      direction: typeof rawLocal.direction === "string" ? rawLocal.direction : "outbound",
    }
    : null;
  const rawFilter = (extra.filter ?? {}) as { show_orphans?: unknown; show_attachments?: unknown };
  return {
    nodes,
    edges,
    modified,
    groups,
    local,
    filter: {
      showOrphans: rawFilter.show_orphans !== false,
      showAttachments: rawFilter.show_attachments === true,
    },
    groupBy: extra.group_by === "tag" ? "tag" : "folder",
  };
}

/// L'ultima nota su cui si stava lavorando: il seme del grafo locale. Col
/// grafo a fuoco la nota attiva è `null`, quindi la si ricorda da prima.
let lastDocument: string | null = null;

/// Il layout dell'ultimo grafo smontato. Il grafo si rimonta a ogni ritorno
/// sulla sua linguetta e a ogni azione della barra: senza, ripartiva ogni
/// volta dalla semina e dalla vista intera. Resta in memoria, non nel vault.
let rememberedLayout: SavedLayout | null = null;

/// Costruisce i testi del pannello nella lingua corrente. Le chiavi dei campi
/// e dei preset sono letterali, così il compilatore verifica che ogni
/// `t(key)` sia una chiave vera del catalogo — niente cast.
type ChiaveP8 =
  | "graph.conf.fisica"
  | "graph.conf.vista"
  | "graph.empty"
  | "graph.list.label"
  | "graph.list.open"
  | "graph.list.more"
  | "graph.list.empty"
  | "graph.status.selected"
  | "graph.status.none";
function testoP8(chiave: ChiaveP8, doc = "", n = 0): string {
  switch (chiave) {
    case "graph.conf.fisica":
      return t("graph.conf.fisica");
    case "graph.conf.vista":
      return t("graph.conf.vista");
    case "graph.empty":
      return t("graph.empty");
    case "graph.list.label":
      return t("graph.list.label");
    case "graph.list.open":
      return t("graph.list.open", { doc });
    case "graph.list.more":
      return t("graph.list.more", { n });
    case "graph.list.empty":
      return t("graph.list.empty");
    case "graph.status.selected":
      return t("graph.status.selected", { doc });
    case "graph.status.none":
      return t("graph.status.none");
  }
}
function panelCopy(): PanelCopy {
  const presets: Record<string, string> = {
    "organica": t("graph.preset.organica"),
    "costellazione": t("graph.preset.costellazione"),
    "alveare": t("graph.preset.alveare"),
    "nebulosa": t("graph.preset.nebulosa"),
    "rigido": t("graph.preset.rigido"),
    "custom": t("graph.preset.custom"),
  };
  const fields: Record<string, string> = {
    repulsion: t("graph.conf.repulsione"),
    baseLength: t("graph.conf.lunghezzaBase"),
    springStiffness: t("graph.conf.rigiditaMolla"),
    springDamping: t("graph.conf.smorzamentoMolla"),
    gravity: t("graph.conf.gravita"),
    friction: t("graph.conf.attrito"),
    maxSpeed: t("graph.conf.maxVelocita"),
    degreeWeight: t("graph.conf.pesoGrado"),
    collisions: t("graph.conf.collisioni"),
    theta: t("graph.conf.theta"),
    jitter: t("graph.conf.jitter"),
    cooling: t("graph.conf.raffreddamento"),
    glow: t("graph.conf.glow"),
    pulse: t("graph.conf.pulse"),
    trail: t("graph.conf.trail"),
    grid: t("graph.conf.griglia"),
    edgeCurvature: t("graph.conf.curvaturaArchi"),
    labelDensity: t("graph.conf.densitaEtichette"),
  };
  return {
    title: t("graph.conf.titolo"),
    preset: t("graph.conf.preset"),
    warm: t("graph.conf.riscalda"),
    unpin: t("graph.conf.sblocca"),
    reset: t("graph.conf.reimposta"),
    open: t("graph.conf.apri"),
    close: t("graph.conf.chiudi"),
    physicsSection: testoP8("graph.conf.fisica"),
    viewSection: testoP8("graph.conf.vista"),
    presets,
    fields,
  };
}

/// Il renderer di `fub:graph`: disegna il grafo dentro `host` e restituisce
/// come spegnerlo. Sottile: la fisica, il disegno e l'interazione stanno nei
/// lotti B; qui si legano a una conf persistente, un pannello di fisica e
/// gli eventi della shell (layout, lingua).
function renderGraph(host: HTMLElement, payload: unknown, onAction: OnAction): () => void {
  const data = readData(payload);
  const config = loadConfig();
  // I passi della timeline sono **giorni** (locali), non millisecondi: con
  // migliaia di note ogni istante di modifica era un passo da mezzo secondo.
  const dayOf = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);
  const times = [...new Set(Object.values(data.modified).map(dayOf))].sort((a, b) => a - b);
  const visible = new Set(data.nodes);
  let cutoffIndex = times.length;
  let playTimer: number | undefined;
  // La superficie locale del grafo: l'host è il riquadro della view, e i
  // canvas del pittore sono absolute inset-0 sul loro contenitore — se quel
  // contenitore fosse l'host, coprirebbero anche stato ed elenco (il click
  // sul summary arrivava al canvas; Invio funzionava perché è tastiera). La
  // superficie di disegno è quindi un'area dedicata: il grafico si monta lì
  // dentro, gli overlay strettamente grafici (conto, pannello fisica) stanno
  // con lui, e lo stato testuale con l'elenco restano fuori dal suo hit
  // testing. Geometria inline e non in pelle: il vocabolario degli hook è
  // chiuso (`theme/serie/anatomia.ts`) e questa è geometria della superficie,
  // come gli stili inline con cui il pittore sovrappone i suoi canvas.
  const previousStyle = {
    display: host.style.display,
    flexDirection: host.style.flexDirection,
    minHeight: host.style.minHeight,
  };
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.minHeight = "0";
  const viewport = document.createElement("div");
  viewport.className = "graph-viewport";
  viewport.style.position = "relative";
  viewport.style.flex = "1 1 auto";
  viewport.style.minWidth = "0";
  viewport.style.minHeight = "0";
  viewport.style.overflow = "hidden";
  // Il motore (chart + pannello fisica + sim/render/interaction) arriva lazy
  // da `graph/lazy.ts`: resta fuori dal bundle iniziale e si carica solo al
  // primo mount. Fino all'arrivo, il chrome testuale vive già — conto, stato
  // vuoto, selezione, elenco — e il viewport mostra il caricamento con
  // `aria-busy`, mai un canvas nero. La registrazione del renderer resta
  // sincrona: chi apre il grafo vede subito la superficie, non un'attesa.
  viewport.setAttribute("aria-busy", "true");
  let chart: Chart | null = null;
  let panel: PhysicsPanel | null = null;
  let disposed = false;
  const settleEngine = (engine: GraphEngine): void => {
    if (disposed) return;
    const next = engine.createChart({ config, data, layout: rememberedLayout });
    next.setVisibleNodes(cutoffIndex === times.length ? null : visible);
    chart = next;
    const created = engine.createPhysicsPanel({
      config,
      onChange: (c) => {
        saveConfig(c);
        next.setConfig(c);
      },
      onWarm: () => next.warm(1),
      onUnpinAll: () => next.unpinNodes(),
      copy: panelCopy,
      restoreFocus: () => {
        const c = viewport.querySelector<HTMLCanvasElement>("canvas.graph-main");
        if (c) c.focus();
      },
    });
    panel = created;
    // L'apertura nota: il grafico non conosce `onAction`, lo riceve qui.
    next.open = (id: string) => onAction({ action: OPEN, payload: { [DOC]: id } }, []);
    next.onFocusChange = showSelection;
    next.mount(viewport);
    drawLegend(next.setGroups(Object.keys(data.groups).length > 0 ? data.groups : null));
    viewport.append(count, created.element);
    refreshLive();
    viewport.removeAttribute("aria-busy");
  };
  const failEngine = (error: unknown): void => {
    if (disposed) return;
    chart?.unmount();
    chart = null;
    panel?.destroy();
    panel = null;
    viewport.removeAttribute("aria-busy");
    status.textContent = errorText(error);
    notify(errorText(error), "guasto");
  };
  // Renderer scelto dal registro a runtime: l'import statico avvierebbe
  // il caricamento del motore anche senza alcuna superficie grafo.
  void import("../graph/lazy").then(settleEngine).catch(failEngine);
  // U45: il conto di nodi e archi resta leggibile sopra il canvas — i ruoli
  // `--muted`/`--text-sm` sono già corretti nella skin (A06 chiusa), qui il
  // testo si rilegge a ogni cambio lingua come prima.
  const count = document.createElement("div");
  count.className = "graph-count";
  count.textContent = t("graph.count", { note: data.nodes.length, edges: data.edges.length });
  viewport.append(count);
  // U47: un canvas con zero note non è un canvas nero — resta montato (serve
  // al focus tastiera e al resize) ma lo stato vuoto è testuale e distinto,
  // con `role="status"` come i `pending` del protocollo (vedi `ui/node.ts`).
  // Nessun retry qui: il grafo non ha un meccanismo di ricarica proprio, e
  // aggiungerne uno sarebbe il retry loop vietato da U47.
  const empty = document.createElement("div");
  empty.className = "graph-empty";
  empty.setAttribute("role", "status");
  empty.hidden = data.nodes.length > 0;
  empty.textContent = testoP8("graph.empty");
  // U46: il nodo selezionato oltre il canvas — nome testuale con `aria-live`
  // discreto (`polite`: annuncia le transizioni senza martellare a ogni frame;
  // gli stati del canvas restano muti). Vuoto = nessun annuncio, mai una
  // chiave nuda.
  const status = document.createElement("div");
  status.className = "graph-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = testoP8("graph.status.none");
  // U46/U48: equivalente accessibile agli stessi dati della simulazione —
  // `<details>` chiuso di default, lista paginata da 50 (stessa finestra di
  // `search.ts`, mai l'intero vault in DOM: nessun elemento per nodo). Ogni
  // riga apre la stessa azione del click (`OPEN`+`DOC`), senza duplicare la
  // simulazione: legge `chart.nodeId(i)` e seleziona con `chart.focusNode(i)`.
  // I08: ogni listener della lista è registrato qui — `drawList` li ricrea a
  // ogni pagina, quindi il disposer li scioglie prima di svuotare la lista.
  const listDisposers: Array<() => void> = [];
  const PAGE = 50;
  let page = 0;
  const list = document.createElement("details");
  list.className = "graph-list";
  const summary = document.createElement("summary");
  summary.className = "graph-list-summary";
  summary.textContent = testoP8("graph.list.label");
  const listBox = document.createElement("ul");
  listBox.className = "graph-list-items";
  listBox.setAttribute("role", "list");
  listBox.setAttribute("aria-label", testoP8("graph.list.label"));
  list.append(summary, listBox);
  function trackListButton(open: HTMLButtonElement, run: () => void): void {
    open.addEventListener("click", run);
    listDisposers.push(() => open.removeEventListener("click", run));
  }
  function drawList(): void {
    // Prima del mount del motore non c'è simulazione: la lista vive sui dati
    // del provider, mai un lancio.
    const live = chart;
    const total = live && typeof live.nodeCount === "function" ? live.nodeCount() : data.nodes.length;
    const indices: number[] = [];
    for (let i = 0; i < total; i++) {
      const id = live && typeof live.nodeId === "function" ? live.nodeId(i) : data.nodes[i];
      if (id && visible.has(id)) indices.push(i);
    }
    const shown = indices.length;
    const pages = Math.max(1, Math.ceil(shown / PAGE));
    if (page > pages - 1) page = pages - 1;
    if (page < 0) page = 0;
    const start = page * PAGE;
    const end = Math.min(shown, start + PAGE);
    for (const release of listDisposers.splice(0)) release();
    listBox.replaceChildren();
    const selected = live && typeof live.focusedNode === "function" ? live.focusedNode() : -1;
    for (let position = start; position < end; position++) {
      const i = indices[position];
      const id = live && typeof live.nodeId === "function" ? live.nodeId(i) : (data.nodes[i] ?? null);
      if (id === null) continue;
      const li = document.createElement("li");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "graph-list-open";
      open.textContent = nodeLabel(id);
      open.setAttribute("aria-label", testoP8("graph.list.open", id));
      setTooltip(open, id);
      if (i === selected) open.setAttribute("aria-current", "true");
      const at = i;
      trackListButton(open, () => {
        chart?.focusNode(at);
        void (chart ? chart.open(id) : onAction({ action: OPEN, payload: { [DOC]: id } }, []));
      });
      li.append(open);
      listBox.append(li);
    }
    if (shown === 0) {
      const li = document.createElement("li");
      li.className = "graph-list-empty";
      li.textContent = testoP8("graph.list.empty");
      listBox.append(li);
    }
    if (pages > 1) {
      const li = document.createElement("li");
      li.className = "graph-list-page";
      const prev = document.createElement("button");
      prev.type = "button";
      prev.disabled = page === 0;
      prev.textContent = "‹";
      prev.setAttribute("aria-label", t("graph.list.previous"));
      trackListButton(prev, () => {
        page = Math.max(0, page - 1);
        drawList();
      });
      const info = document.createElement("span");
      info.className = "graph-list-info";
      info.textContent = `${page + 1}/${pages}`;
      info.setAttribute("aria-label", t("graph.list.page", { page: page + 1, pages }));
      const next = document.createElement("button");
      next.type = "button";
      next.disabled = page >= pages - 1;
      next.textContent = "›";
      next.setAttribute("aria-label", t("graph.list.next"));
      trackListButton(next, () => {
        page = Math.min(pages - 1, page + 1);
        drawList();
      });
      li.append(prev, info, next);
      listBox.append(li);
    }
    // Riga "altre": quante restano fuori dalla pagina (U12: mai tacere il
    // totale oltre la finestra), con azione che avanza di una pagina —
    // stesso meccanismo della lista, mai un retry loop nuovo.
    if (end < shown) {
      const li = document.createElement("li");
      li.className = "graph-list-more";
      const more = document.createElement("button");
      more.type = "button";
      more.textContent = testoP8("graph.list.more", "", shown - end);
      trackListButton(more, () => {
        page = Math.min(pages - 1, page + 1);
        drawList();
      });
      li.append(more);
      listBox.append(li);
    }
  }
  // La selezione cambia da tastiera (frecce/Invio/Esc), da click o dalla
  // lista stessa: un punto solo aggiorna stato testuale ed evidenziazione.
  // Prima del mount c'è solo il testo; dopo, anche il canvas.
  function showSelection(index: number): void {
    const live = chart;
    const id = live && typeof live.nodeId === "function" ? live.nodeId(index) : (data.nodes[index] ?? null);
    status.textContent = id === null ? testoP8("graph.status.none") : testoP8("graph.status.selected", id);
    drawList();
  }
  // Il motore appena montato rilegge ciò che il chrome testuale sa già:
  // note aperte, etichetta tastiera, selezione corrente.
  function refreshLive(): void {
    const live = chart;
    if (!live) return;
    live.setOpenDocuments(openDocuments());
    live.setA11yLabel(t("graph.a11y.superficie", { note: data.nodes.length, edges: data.edges.length }));
  }
  // Filter over current indexed last-modification dates, not old graph snapshots.
  // Keep simulation/layout stable while revealing nodes.
  const timeline = document.createElement("div");
  timeline.className = "graph-timeline";
  timeline.hidden = times.length === 0;
  const timeLabel = document.createElement("label");
  const timeInput = document.createElement("input");
  timeInput.type = "range";
  timeInput.min = "0";
  timeInput.max = String(times.length);
  timeInput.value = String(cutoffIndex);
  timeLabel.append(timeInput);
  const timeValue = document.createElement("span");
  const play = document.createElement("button");
  play.type = "button";
  timeline.append(timeLabel, timeValue, play);
  function timeText(): string {
    return cutoffIndex === times.length
      ? t("graph.time.all")
      : t("graph.time.by", { date: new Date(times[cutoffIndex]).toLocaleDateString(resolvedLanguage()) });
  }
  function updateTimeline(): void {
    visible.clear();
    const cutoff = cutoffIndex === times.length ? Infinity : times[cutoffIndex];
    for (const id of data.nodes) {
      if (data.modified[id] === undefined || dayOf(data.modified[id]) <= cutoff) visible.add(id);
    }
    chart?.setVisibleNodes(cutoffIndex === times.length ? null : visible);
    timeInput.value = String(cutoffIndex);
    timeValue.textContent = timeText();
    const edges = data.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)).length;
    count.textContent = t("graph.count", { note: visible.size, edges });
    empty.hidden = visible.size > 0;
    drawList();
  }
  timeLabel.setAttribute("aria-label", t("graph.time.label"));
  timeValue.textContent = timeText();
  play.textContent = t("graph.time.play");
  const onTimeInput = (): void => {
    clearInterval(playTimer);
    playTimer = undefined;
    play.textContent = t("graph.time.play");
    cutoffIndex = Number(timeInput.value);
    updateTimeline();
  };
  const onPlay = (): void => {
    if (playTimer !== undefined) {
      clearInterval(playTimer);
      playTimer = undefined;
      play.textContent = t("graph.time.play");
      return;
    }
    if (cutoffIndex === times.length) cutoffIndex = 0;
    updateTimeline();
    play.textContent = t("graph.time.pause");
    // Una riproduzione dura al più una trentina di secondi, qualunque sia
    // quanti giorni copre il vault.
    const stride = Math.max(1, Math.ceil(times.length / 60));
    playTimer = window.setInterval(() => {
      cutoffIndex = Math.min(times.length, cutoffIndex + stride);
      updateTimeline();
      if (cutoffIndex >= times.length) {
        clearInterval(playTimer);
        playTimer = undefined;
        play.textContent = t("graph.time.play");
      }
    }, 500);
  };
  timeInput.addEventListener("input", onTimeInput);
  play.addEventListener("click", onPlay);
  // La barra dei controlli: grafo della nota o intero, profondità e verso,
  // colori per cartella o tag, orfani e allegati. Sono le azioni che il
  // provider sa già fare; qui diventano visibili.
  const toolbar = document.createElement("div");
  toolbar.className = "graph-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", t("graph.toolbar"));
  const act = (action: string, payload: Record<string, unknown>) => onAction({ action, payload }, []);
  const seedButton = document.createElement("button");
  seedButton.type = "button";
  if (data.local) {
    seedButton.textContent = t("graph.local.leave");
    seedButton.addEventListener("click", () => act("seed", { [DOC]: "" }));
  } else {
    const seed = lastDocument;
    seedButton.textContent = seed ? t("graph.local.enter", { doc: nodeLabel(seed) }) : t("graph.local.none");
    seedButton.disabled = !seed;
    seedButton.addEventListener("click", () => {
      if (seed) act("seed", { [DOC]: seed });
    });
  }
  toolbar.append(seedButton);
  const select = (label: string, value: string, options: [string, string][], run: (value: string) => void): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "graph-toolbar-field";
    const name = document.createElement("span");
    name.textContent = label;
    const field = document.createElement("select");
    for (const [key, text] of options) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = text;
      option.selected = key === value;
      field.append(option);
    }
    field.addEventListener("change", () => run(field.value));
    wrap.append(name, field);
    return wrap;
  };
  if (data.local) {
    toolbar.append(
      select(t("graph.local.depth"), String(data.local.depth), [["1", "1"], ["2", "2"], ["3", "3"]], (v) => act("depth", { depth: Number(v) })),
      select(t("graph.local.direction"), data.local.direction, [
        ["outbound", t("graph.local.outbound")],
        ["inbound", t("graph.local.inbound")],
        ["both", t("graph.local.both")],
      ], (v) => act("direction", { direction: v })),
    );
  }
  toolbar.append(select(t("graph.group.label"), data.groupBy, [
    ["folder", t("graph.group.folder")],
    ["tag", t("graph.group.tag")],
  ], (v) => act("group_by", { group_by: v })));
  const toggle = (label: string, checked: boolean, key: string): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "graph-toolbar-field";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", () => act("filter", { key }));
    wrap.append(box, document.createTextNode(label));
    return wrap;
  };
  toolbar.append(
    toggle(t("graph.filter.orphans"), data.filter.showOrphans, "show_orphans"),
    toggle(t("graph.filter.attachments"), data.filter.showAttachments, "show_attachments"),
  );
  // Il grafo non si ridisegna da solo (la simulazione non riparte sotto il
  // mouse); quando il vault cambia lo dice, e si aggiorna a richiesta.
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "graph-refresh";
  refresh.hidden = true;
  refresh.textContent = t("graph.refresh");
  refresh.addEventListener("click", () => act("refresh", {}));
  toolbar.append(refresh);
  const stopIndex = onEvent("index_updated", () => {
    refresh.hidden = false;
  });
  const legend = document.createElement("ul");
  legend.className = "plain-list graph-legend";
  legend.setAttribute("aria-label", t("graph.group.legend"));
  const drawLegend = (names: string[]): void => {
    legend.replaceChildren();
    legend.hidden = names.length === 0;
    names.forEach((name, index) => {
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "graph-swatch";
      swatch.style.background = `var(${GROUP_TOKENS[index] ?? "--muted"})`;
      swatch.setAttribute("aria-hidden", "true");
      li.append(swatch, document.createTextNode(name === "" ? "/" : name));
      legend.append(li);
    });
  };
  drawLegend([]);
  host.append(toolbar, legend, viewport, timeline, empty, status, list);
  drawList();
  // `on` restituisce il disposer della registrazione: il renderer deve
  // rimuovere il listener quando il grafo viene smontato, non solo ignorare
  // gli eventi con una guard. Fino al mount il layout non ha un canvas da
  // aggiornare; dopo, il live.
  const unsubscribeLayout = on("layout", () => {
    chart?.setOpenDocuments(openDocuments());
  });
  const unsubscribeLanguage = onLanguage(() => {
    if (disposed) return;
    const visibleEdges = data.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)).length;
    count.textContent = t("graph.count", { note: visible.size, edges: visibleEdges });
    timeLabel.setAttribute("aria-label", t("graph.time.label"));
    timeValue.textContent = timeText();
    play.textContent = t(playTimer === undefined ? "graph.time.play" : "graph.time.pause");
    empty.textContent = testoP8("graph.empty");
    summary.textContent = testoP8("graph.list.label");
    listBox.setAttribute("aria-label", testoP8("graph.list.label"));
    // La selezione va ridetta nella nuova lingua; la pagina resta dov'è.
    showSelection(chart && typeof chart.focusedNode === "function" ? chart.focusedNode() : -1);
    chart?.setA11yLabel(t("graph.a11y.superficie", { note: data.nodes.length, edges: data.edges.length }));
    panel?.updateLanguage();
  });
  // A single owner closes both the synchronous chrome and the pending import.
  // Mark disposed first: a settled lazy import must not mount into a removed pane.
  return () => {
    if (disposed) return;
    disposed = true;
    clearInterval(playTimer);
    timeInput.removeEventListener("input", onTimeInput);
    play.removeEventListener("click", onPlay);
    unsubscribeLayout();
    unsubscribeLanguage();
    stopIndex();
    toolbar.remove();
    legend.remove();
    for (const release of listDisposers.splice(0)) release();
    rememberedLayout = chart?.snapshot() ?? rememberedLayout;
    chart?.unmount();
    chart = null;
    panel?.destroy();
    panel = null;
    viewport.remove();
    timeline.remove();
    empty.remove();
    status.remove();
    list.remove();
    host.style.display = previousStyle.display;
    host.style.flexDirection = previousStyle.flexDirection;
    host.style.minHeight = previousStyle.minHeight;
  };
}
