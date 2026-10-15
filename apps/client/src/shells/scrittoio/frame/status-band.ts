// La banda di stato: a sinistra il vault e ciò che gli sta succedendo, a
// destra la modalità del foglio a fuoco e lo zoom. Fra le due, le view che dichiarano
// `ViewSurface::StatusBar` (le monta `ui/views.ts` in `#views-status`).
//
// Ogni voce si vede solo quando ha qualcosa da dire: una banda che ripete
// «tutto bene» in sei modi è rumore.
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
import { byId, follow } from "./dom";

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
  const vault = byId("status-vault");
  const index = byId("status-index");
  const saving = byId("status-saving");
  const mode = byId("status-mode");
  const zoom = byId<HTMLButtonElement>("status-zoom");
  const vaultName = byId("vault-path");

  // Il vault: lo stesso nome che la barra del titolo mostra nel chip.
  const drawVault = (): void => {
    const name = vaultName?.textContent?.trim() ?? "";
    show(vault, state.vaultRoot ? name : "", "ok");
    if (vault) setTooltip(vault, state.vaultRoot);
  };
  drawVault();
  if (vaultName) follow(lifetime, vaultName, drawVault);
  lifetime.add(on("vault", drawVault));

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
  };
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
