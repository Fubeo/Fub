// La banda di stato: a sinistra ciò che sta succedendo al vault, a
// destra la modalità del foglio a fuoco e lo zoom. Fra le due, le view che dichiarano
// `ViewSurface::StatusBar` (le monta `ui/views.ts` in `#views-status`).
//
// Ogni voce si vede solo quando ha qualcosa da dire: una banda che ripete
// «tutto bene» in sei modi è rumore.
//
// Il documento a fuoco può portare le sue voci (`EditorSurface.status`: il
// foglio, le parole, la lingua). Se conta lui le parole, il conteggio della
// view dichiarata si fa da parte: lo stesso numero da due fonti non si dice.
import type { SurfacePaperFit, SurfaceStatus } from "../../../editors/core/registry";
import { settings, vaultStatus } from "../../../host/query";
import { onLanguage, t } from "../../../i18n/strings";
import { paneOf, selectedMode } from "../../../state/document-controller";
import { documentSessions } from "../../../state/document-session";
import { onEvent } from "../../../state/kernel";
import { activeTab, layout } from "../../../state/layout";
import { on, state } from "../../../state/store";
import { zoomBy } from "../../../state/zoom";
import type { Lifetime } from "../../../ui/lifetime";
import { Race } from "../../../ui/race";
import { setTooltip } from "../../../ui/tooltip";
import { animate, DURATION, prepareExit } from "../../../moto";
import { byId, follow } from "./dom";

/// Da quanto piccolo entra un segno che si accende: la molla elastica lo porta
/// oltre la misura, una volta, e lo posa.
const BEAT_SCALE = 0.8;

function show(el: HTMLElement | null, text: string, tone?: string): void {
  if (!el) return;
  el.hidden = text === "";
  el.textContent = text;
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

export function mountStatusBand(lifetime: Lifetime): void {
  const band = byId("status-band");
  if (!band) return;
  const index = byId("status-index");
  const saving = byId("status-saving");
  const mode = byId("status-mode");
  const zoom = byId<HTMLButtonElement>("status-zoom");
  const fits = [
    { fit: "width", button: byId<HTMLButtonElement>("status-fit-width"), label: "frame.status.fit.width" },
    { fit: "page", button: byId<HTMLButtonElement>("status-fit-page"), label: "frame.status.fit.page" },
  ] as const;

  // Il nome del vault non si ripete qui: lo dice già il chip nella barra del
  // titolo, che c'è sempre.
  // L'indice e la sorveglianza del disco: si dicono solo quando non sono a posto.
  const reads = new Race();
  lifetime.add(() => reads.cancel());
  const drawIndex = (): void => {
    if (!state.vaultRoot) {
      // Una lettura partita col vault di prima non deve scrivere su questo vuoto.
      reads.cancel();
      show(index, "");
      return;
    }
    void reads.last(async (expected) => {
      const status = await expected(vaultStatus().catch(() => null));
      if (lifetime.closed) return;
      if (!status) show(index, "");
      else if (status.indexing === "running") show(index, t("frame.status.indexing"), "busy");
      else if (!status.watching) show(index, t("frame.status.unwatched"), "warn");
      else show(index, "");
    });
  };
  drawIndex();
  lifetime.add(on("vault", drawIndex));
  lifetime.add(on("documents", drawIndex));

  // Il salvataggio di tutto ciò che è aperto, non solo del foglio a fuoco.
  const drawSaving = (): void => {
    if (!state.vaultRoot) {
      show(saving, "");
      return;
    }
    const pending = documentSessions.dirtyIds().length;
    show(saving, pending === 0 ? t("frame.status.saved") : t("frame.status.unsaved", { count: pending }), pending === 0 ? "ok" : "busy");
  };

  // Il documento a fuoco: la modalità, che è quella effettiva del controllore —
  // la ricordata dal riquadro, o la predefinita della superficie — col nome che
  // la superficie le dà. Una superficie con una modalità sola non ha niente da
  // dire. Parole e tempo di lettura li dichiara una view di stato
  // (`#views-status`): contarle anche qui sarebbe dirle due volte.
  const drawMode = (): void => {
    const tab = state.vaultRoot ? activeTab() : null;
    const pane = tab?.k === "doc" ? paneOf(layout.focus) : undefined;
    const several = (pane?.surface?.modes.length ?? 0) > 1;
    show(mode, several ? (selectedMode(pane)?.label() ?? "") : "");
    drawFit();
    drawSurface();
  };

  // Le voci della superficie a fuoco, prima della modalità. Un elemento per
  // voce, che resta finché la voce c'è: il fuoco su un pulsante non si perde
  // a ogni battuta.
  const end = mode?.parentElement ?? null;
  const items = new Map<string, HTMLElement>();
  let told: SurfaceStatus | null = null;
  let stopTelling: (() => void) | null = null;
  lifetime.add(() => {
    stopTelling?.();
    for (const el of items.values()) el.remove();
    items.clear();
  });
  const statusOf = () => {
    const tab = state.vaultRoot ? activeTab() : null;
    return tab?.k === "doc" ? paneOf(layout.focus)?.surface?.status ?? null : null;
  };
  function drawSurface(): void {
    const status = statusOf();
    // Un segno che si accende batte solo se il documento è lo stesso di prima:
    // passare a un documento che registra già non è un'accensione.
    const same = status !== null && status === told;
    if (status !== told) {
      stopTelling?.();
      told = status;
      stopTelling = status?.subscribe(drawSurface) ?? null;
    }
    if (status?.counts) band!.dataset.surfaceCounts = "";
    else delete band!.dataset.surfaceCounts;
    const list = status?.items() ?? [];
    const beats: HTMLElement[] = [];
    const ids = new Set(list.map((item) => item.id));
    for (const [id, el] of items) {
      if (ids.has(id)) continue;
      // Il segno che si spegne nello stesso documento se ne va come immagine:
      // a metà del battito, l'immagine prosegue da dov'era.
      const ghost = same && el.dataset.beat !== undefined ? prepareExit(el) : null;
      el.remove();
      items.delete(id);
      ghost?.play({ duration: DURATION.state });
    }
    for (const item of list) {
      let el = items.get(item.id);
      const button = item.open !== undefined;
      if (!el || (el instanceof HTMLButtonElement) !== button) {
        el?.remove();
        el = document.createElement(button ? "button" : "span");
        el.className = button ? "status-item status-item--button" : "status-item";
        el.dataset.surfaceItem = item.id;
        if (el instanceof HTMLButtonElement) {
          el.type = "button";
          const id = item.id;
          el.addEventListener("click", () => statusOf()?.items().find((each) => each.id === id)?.open?.());
        }
        items.set(item.id, el);
        if (item.beat && same) beats.push(el);
      }
      if (item.beat) el.dataset.beat = "";
      else delete el.dataset.beat;
      if (el.textContent !== item.text) el.textContent = item.text;
      if (item.hint) setTooltip(el, item.hint);
    }
    // Al loro posto, prima della modalità; un elemento che c'è già non si
    // sposta, che perderebbe il fuoco.
    let next: Element | null = mode;
    for (const item of [...list].reverse()) {
      const el = items.get(item.id)!;
      if (end && el.nextElementSibling !== next) end.insertBefore(el, next);
      next = el;
    }
    // Un battito solo, con la molla elastica: niente lampeggio.
    for (const el of beats) animate(el, { from: { scale: BEAT_SCALE }, spring: "elastic", whenReduced: "none", lifetime });
  }
  // L'adattamento della carta: soltanto dove la superficie lo offre adesso
  // (un documento in Pagina). Premuto, un altro clic torna alla carta vera.
  const fitOf = () => {
    const tab = state.vaultRoot ? activeTab() : null;
    return tab?.k === "doc" ? paneOf(layout.focus)?.surface?.paperFit ?? null : null;
  };
  // Il motore arriva dopo la superficie, e la modalità cambia: la superficie
  // a fuoco dice quando ridisegnare.
  let watched: SurfacePaperFit | null = null;
  let stopWatching: (() => void) | null = null;
  lifetime.add(() => stopWatching?.());
  const drawFit = (): void => {
    const paper = fitOf();
    if (paper !== watched) {
      stopWatching?.();
      watched = paper;
      stopWatching = paper?.subscribe(drawFit) ?? null;
    }
    const offers = paper?.offers() ?? [];
    for (const { fit, button, label } of fits) {
      if (!button) continue;
      button.hidden = !offers.includes(fit);
      button.textContent = t(label);
      button.setAttribute("aria-pressed", String(paper?.current() === fit));
      setTooltip(button, t("frame.status.fit.hint"));
    }
  };
  for (const { fit, button } of fits) {
    if (!button) continue;
    lifetime.listen(button, "click", () => {
      const paper = fitOf();
      if (!paper) return;
      paper.set(paper.current() === fit ? null : fit);
      drawFit();
    });
  }
  const drawDocument = (): void => {
    drawMode();
    drawSaving();
  };
  drawDocument();
  lifetime.add(on("active-doc", drawDocument));
  lifetime.add(on("layout", drawDocument));
  lifetime.add(on("vault", drawDocument));
  lifetime.add(documentSessions.subscribe(() => drawSaving()));
  // La superficie si monta dopo che il layout ha già detto la sua: il
  // controllore scrive la modalità effettiva sul riquadro (`data-mode`) quando
  // c'è, e la banda la rilegge allora.
  const panes = byId("panes");
  if (panes) follow(lifetime, panes, drawMode, { attributes: ["data-mode"], subtree: true });

  // Lo zoom: si vede quando non è al 100%, e un clic ce lo riporta.
  let percent = 100;
  const zoomReads = new Race();
  lifetime.add(() => zoomReads.cancel());
  const drawZoom = (): void => {
    if (!zoom) return;
    zoom.hidden = percent === 100;
    zoom.textContent = `${percent}%`;
    zoom.setAttribute("aria-label", t("frame.status.zoom", { percent }));
    setTooltip(zoom, t("frame.status.zoom.hint"));
  };
  const readZoom = (): void => {
    void zoomReads.last(async (expected) => {
      const entries = await expected(settings().catch(() => null));
      if (lifetime.closed || !entries) return;
      const value = entries.find((entry) => entry.spec.key === "appearance.zoom")?.value;
      percent = Math.round((typeof value === "number" ? value : 1) * 100);
      drawZoom();
    });
  };
  readZoom();
  lifetime.add(onEvent("setting_changed", ({ key }) => {
    if (key === "appearance.zoom") readZoom();
  }));
  if (zoom) lifetime.listen(zoom, "click", () => void zoomBy(0));

  lifetime.add(
    onLanguage(() => {
      drawIndex();
      drawDocument();
      drawZoom();
    }),
  );
}
