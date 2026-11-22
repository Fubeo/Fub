// Il menu dello zoom della banda del Disegno completo (K6 T11): ingrandisci,
// riduci, 100 %, adatta tutto e il campo della percentuale. Le sue voci sono i
// comandi `view.*` della mappa, e sono della vista di Fub: cambiano la camera del
// foglio, non il file, e non entrano nella cronologia.
//
// Lo stesso comando parte dalla voce della banda, da Ctrl+/ e dalla ricerca
// (`comando`). Il menu è un popover del kit: Esc lo chiude e riporta il fuoco
// alla voce della banda. Il campo rifiuta una percentuale fuori dai limiti della
// vista, lo dice, e lo zoom non cambia.

import { resolvedLanguage } from "../../../../../i18n/strings";
import { numberField, type NumberField } from "../../../../../kit/number-field";
import type { QuantityProblem } from "../../../../../kit/quantity";
import { openPopover, type PopoverHandle } from "../../../../../kit/popover";
import { openLifetime } from "../../../../../ui/lifetime";
import { t, type DrawKey } from "../../../strings";
import { DRAW_SCALE_LIMITS, ZOOM_STEP } from "../constants";
import type { EditorContext } from "../context";

/// I comandi `view.*` che il client fa: la mappa li dà «fatto» con la loro prova.
export const COMANDI_VISTA = ["view.zoomIn", "view.zoomOut", "view.actualSize", "view.fitAll", "view.setZoom"] as const;
export type ComandoVista = (typeof COMANDI_VISTA)[number];

export function isComandoVista(id: string): id is ComandoVista {
  return (COMANDI_VISTA as readonly string[]).includes(id);
}

/// Le voci del menu, nell'ordine in cui le vede chi lo apre. Il campo della
/// percentuale sta sotto, da solo (`view.setZoom`).
const VOCI: readonly { readonly id: Exclude<ComandoVista, "view.setZoom">; readonly chiave: DrawKey }[] = [
  { id: "view.zoomIn", chiave: "draw.zoom_in" },
  { id: "view.zoomOut", chiave: "draw.zoom_out" },
  { id: "view.actualSize", chiave: "draw.keys.actual" },
  { id: "view.fitAll", chiave: "draw.zoom.fit_all" },
];

/// Lo zoom detto come lo dice la banda («150 %»), nella lingua di adesso.
const percentuale = (scala: number): string =>
  new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0 }).format(scala);

/// Lo zoom di adesso, in percento: l'unità del campo.
const percentoDi = (ctx: EditorContext): number => ctx.camera.scale * 100;

/// Imposta lo zoom a `percento` attorno al centro di ciò che si vede. Fuori dai
/// limiti della vista rende il motivo, e lo zoom non cambia.
export function impostaZoom(ctx: EditorContext, percento: number): string | void {
  const { min, max } = DRAW_SCALE_LIMITS;
  const scala = percento / 100;
  if (!(scala >= min && scala <= max)) {
    return t("draw.zoom.out_of_range", { min: percentuale(min), max: percentuale(max) });
  }
  ctx.zoomBy(scala / ctx.camera.scale);
}

/// Le parole di ciò che non va nel campo. La percentuale non ha parti relative
/// né valori misti: quei due casi non arrivano qui.
function problema(problem: QuantityProblem | "mixed"): string {
  switch (problem) {
    case "empty":
      return t("draw.zoom.problem.empty");
    case "unit":
      return t("draw.zoom.problem.unit");
    case "finite":
      return t("draw.zoom.problem.finite");
    default:
      return t("draw.zoom.problem.syntax");
  }
}

export interface ZoomMenu {
  /// Apre il menu dalla voce della banda. Con `campo`, il fuoco va al campo della
  /// percentuale (`view.setZoom`, da Ctrl+/).
  apri(campo?: boolean): void;
  /// Fa il comando `view.*` `id`: le voci del menu, Ctrl+/ e la ricerca lo chiamano così.
  comando(id: ComandoVista): void;
}

/// Il menu dello zoom. `bottone` dà la voce della banda, a cui si ancora il menu e
/// da cui il fuoco torna quando si chiude; senza, si ancora alla radice dell'editor.
export function creaMenuZoom(ctx: EditorContext, bottone: () => HTMLElement | null): ZoomMenu {
  let aperto: { readonly popover: PopoverHandle; readonly primo: HTMLElement; readonly campo: HTMLElement } | null = null;

  const segnaAperto = (on: boolean): void => {
    const voce = bottone();
    if (voce === null) return;
    voce.setAttribute("aria-haspopup", "dialog");
    voce.setAttribute("aria-expanded", on ? "true" : "false");
  };

  const chiudi = (): void => {
    aperto?.popover.close("manual");
  };

  const esegui = (id: ComandoVista): void => {
    switch (id) {
      case "view.zoomIn":
        ctx.zoomBy(ZOOM_STEP);
        return;
      case "view.zoomOut":
        ctx.zoomBy(1 / ZOOM_STEP);
        return;
      case "view.actualSize":
        ctx.zoomBy(1 / ctx.camera.scale);
        return;
      case "view.fitAll":
        ctx.fit();
        return;
      case "view.setZoom":
        apri(true);
        return;
    }
  };

  const apri = (campo = false): void => {
    if (ctx.disposed) return;
    if (aperto !== null) {
      (campo ? aperto.campo : aperto.primo).focus();
      return;
    }
    const ancora = bottone() ?? ctx.root;
    // La vita del menu: chiusa col popover, e con lei i suoi ascolti e il campo.
    const vita = openLifetime();

    const menu = document.createElement("div");
    menu.className = "draw-zoom-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", t("draw.zoom.menu"));
    const voci = VOCI.map(({ id, chiave }) => {
      const voce = document.createElement("button");
      voce.type = "button";
      voce.className = "draw-zoom-item";
      voce.setAttribute("role", "menuitem");
      voce.dataset.command = id;
      voce.textContent = t(chiave);
      vita.listen(voce, "click", () => {
        chiudi();
        esegui(id);
      });
      return voce;
    });
    // Un solo elemento raggiungibile con Tab; le frecce vanno alle altre voci.
    const fuoco = (indice: number): void => {
      voci.forEach((voce, i) => {
        voce.tabIndex = i === indice ? 0 : -1;
      });
      voci[indice]?.focus();
    };
    vita.listen(menu, "keydown", (event: KeyboardEvent) => {
      const at = voci.indexOf(event.target as HTMLButtonElement);
      if (at < 0) return;
      let prossimo: number | null = null;
      if (event.key === "ArrowDown") prossimo = (at + 1) % voci.length;
      else if (event.key === "ArrowUp") prossimo = (at - 1 + voci.length) % voci.length;
      else if (event.key === "Home") prossimo = 0;
      else if (event.key === "End") prossimo = voci.length - 1;
      if (prossimo === null) return;
      event.preventDefault();
      fuoco(prossimo);
    });
    voci.forEach((voce, i) => {
      voce.tabIndex = i === 0 ? 0 : -1;
    });
    menu.append(...voci);

    const separatore = document.createElement("div");
    separatore.className = "draw-zoom-separator";
    separatore.setAttribute("role", "separator");

    // Il campo non taglia: un valore fuori dai limiti arriva a `impostaZoom`, che
    // lo rifiuta con il motivo. Niente `min`/`max` del campo, che lo porterebbero al
    // limite in silenzio.
    const percento: NumberField = numberField({
      label: t("draw.zoom.field"),
      value: percentoDi(ctx),
      unit: "%",
      units: { "%": 1 },
      places: 0,
      language: resolvedLanguage(),
      mixedText: t("draw.zoom.problem.syntax"),
      problem: problema,
      onCommit: (valore) => impostaZoom(ctx, valore),
      lifetime: vita,
    });
    const campoBox = document.createElement("div");
    campoBox.className = "draw-zoom-field";
    campoBox.append(percento.element);

    const contenuto = document.createElement("div");
    contenuto.className = "draw-zoom-body";
    contenuto.append(menu, separatore, campoBox);

    // Lo zoom cambia anche senza il menu (rotella, pizzico, Ctrl+/): il campo lo
    // segue, e non tocca ciò che si sta scrivendo.
    const stopStato = ctx.status.subscribe(() => percento.setValue(percentoDi(ctx)));
    vita.add(stopStato);

    const popover = openPopover({
      anchor: ancora,
      content: contenuto,
      placement: "top",
      align: "start",
      className: "draw-zoom-popover",
      label: t("draw.zoom.menu"),
      lifetime: ctx.life,
      onClose: () => {
        segnaAperto(false);
        aperto = null;
        vita.close();
      },
    });
    aperto = { popover, primo: voci[0] ?? menu, campo: percento.input };
    segnaAperto(true);
    if (campo) percento.focus();
  };

  return { apri, comando: esegui };
}

/// Installa il menu dello zoom nell'editor: `ctx.apriZoom` e `ctx.comandoVista`
/// (`status.ts` li chiama dalla banda e dai comandi).
export function installZoomMenu(ctx: EditorContext, bottone: () => HTMLElement | null): void {
  const menu = creaMenuZoom(ctx, bottone);
  ctx.apriZoom = () => menu.apri(false);
  ctx.comandoVista = (id) => menu.comando(id);
}
