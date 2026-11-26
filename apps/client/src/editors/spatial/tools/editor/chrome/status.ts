// La banda di stato del disegno (E1): lo zoom, le misure (dove sta il puntatore
// e la selezione), quanti oggetti, la vista girata. Chi ospita l'editor la legge
// con `items()` e la ridisegna a ogni `subscribe`: nello Scrittoio è lo `status`
// della superficie, al posto delle parole.
//
// Nel Disegno completo la voce dello zoom apre il suo menu (`zoom-menu.ts`), e
// la voce del navigatore accende e spegne la panoramica (`navigator.ts`); le
// misure stanno in una voce sola, `info`, che si ricalcola al più una volta per
// fotogramma: il puntatore si muove a ogni tocco, la selezione può avere 50 000
// elementi, e una lettura vecchia non si mostra.

import { CAMBIA_UNITA } from "./unita";
import { plural, t } from "../../../strings";
import type { Point } from "../../../scene/matrix";
import type { EditorContext } from "../context";
import { editSymbol, exitSymbol } from "../symbol-mode";
import { creaMenuZoom, isComandoVista, type ComandoVista } from "./zoom-menu";
import { COMANDO_ZOOM_SCELTA, comandoVisualizza, isComandoVisualizza, statoVisualizza, voceVisualizza, type ComandoVisualizza } from "./visualizza";

/// Una voce della banda: un fatto, e se c'è che cosa fa un clic.
export interface DrawStatusItem {
  readonly id: string;
  readonly text: string;
  readonly hint?: string;
  readonly open?: () => void;
  /// Il clic agisce sul posto e non apre niente: il fuoco resta al foglio
  /// (`SurfaceStatusItem.inPlace`).
  readonly inPlace?: boolean;
}

export interface DrawStatus {
  items(): readonly DrawStatusItem[];
  /// Avvisa quando una voce può essere cambiata.
  subscribe(listener: () => void): () => void;
}

/// I comandi che la banda e Ctrl+/ fanno nel Disegno completo: quelli dello zoom, quelli
/// di ≡ › Visualizza, e il navigatore.
export type ComandoBanda = ComandoVista | ComandoVisualizza | typeof COMANDO_ZOOM_SCELTA | "navigator";

export function isComandoBanda(id: string): id is ComandoBanda {
  return isComandoVista(id) || isComandoVisualizza(id) || id === COMANDO_ZOOM_SCELTA || id === "navigator";
}

export interface StatusContext {
  status: DrawStatus;
  /// Dove sta il puntatore sul foglio, nella scena; `null` fuori.
  statusPointer: Point | null;
  /// Una voce può essere cambiata: la vista, la selezione, il puntatore. La banda
  /// si ridisegna al fotogramma successivo.
  statusChanged: () => void;
  /// Apre il menu dello zoom dalla sua voce della banda (il Disegno completo).
  apriZoom: () => void;
  /// Fa un comando del Disegno completo: dalla banda, da Ctrl+/ o dalla ricerca.
  comandoVista: (id: ComandoBanda) => void;
}

/// Il fotogramma che porta le misure: `requestAnimationFrame` nel browser, un suo
/// doppio nei test.
export interface StatusFrame {
  request(richiesta: () => void): number;
  cancel(handle: number): void;
}

const FOTOGRAMMA: StatusFrame = {
  request(richiesta) {
    const id = requestAnimationFrame(richiesta);
    return id;
  },
  cancel(id) {
    cancelAnimationFrame(id);
  },
};

/// La misura della selezione letta a un fotogramma, e la versione del disegno che
/// l'ha letta. Una lettura di un'altra versione è vecchia: non si mostra.
interface Misura {
  readonly versione: number;
  readonly selezione: { readonly larghezza: number; readonly altezza: number } | null;
}

/// La misura lungo un lato di una cornice con la matrice `[a, b, c, d]`.
const along = (length: number, x: number, y: number): number => length * Math.hypot(x, y);

/// Le voci del client che la banda porta nel Disegno completo: `null` se la voce si fa,
/// il perché se è spenta, `undefined` se non è di questa parte.
export function voceClienteBanda(id: string): string | null | undefined {
  if (isComandoVista(id)) return null;
  if (id === "navigator") return null;
  if (id === "info") return t("draw.status.info.shown");
  return undefined;
}

/// Tutte le voci del client del Disegno completo (la banda e ≡ › Visualizza): la regola
/// di `completo/comandi.ts` le legge da qui, con l'editor che le fa.
export function voceClienteCompleto(ctx: EditorContext, id: string): string | null | undefined {
  // `null` vuol dire «si fa»: non si confonde con «non è di questa parte» (`??` lo
  // scambierebbe per assente, e una voce fatta comparirebbe come non collegata).
  if (id === CAMBIA_UNITA) return null;
  const immagini = voceImmagini(ctx, id);
  if (immagini !== undefined) return immagini;
  const esporta = voceEsporta(ctx, id);
  if (esporta !== undefined) return esporta;
  const visualizza = voceVisualizza(ctx, id);
  return visualizza !== undefined ? visualizza : voceClienteBanda(id);
}

/// Le voci delle immagini dell'interfaccia di VectorCraft che fa il client: Ritaglia
/// immagine apre lo strumento (`ritaglio-immagine.ts`), Inserisci… sceglie un'immagine
/// del vault (`vault-images.ts`). Le loro righe del motore passano da `COMANDI_DI_FUB`.
export const VOCI_IMMAGINI: Readonly<Record<string, (ctx: EditorContext) => void>> = {
  "ui.cropImage": (ctx) => ctx.cropImage(),
  "file.place": (ctx) => void ctx.vaultImage(),
};

/// Lo stato di una voce di `VOCI_IMMAGINI`: `null` se si fa, il perché se è spenta,
/// `undefined` se non è una di loro.
export function voceImmagini(ctx: EditorContext, id: string): string | null | undefined {
  if (VOCI_IMMAGINI[id] === undefined) return undefined;
  if (!ctx.editable()) return t("draw.disabled.read_only");
  if (id === "file.place") return ctx.insertsImages(ctx.features) ? null : t("draw.place.off");
  if (ctx.croppingImage()) return null;
  return ctx.selectedUnits().some((unit) => unit.role === "image") ? null : t("draw.crop.none");
}

/// Le voci di File che esportano, come in VectorCraft: aprono la finestra «Esporta» di chi
/// monta l'editor (`onExport`, `surface.ts`) già sul formato, o sulla selezione. Il file lo
/// scrive l'host, che lo legge dal vault: si esporta anche in sola lettura.
export const VOCI_ESPORTA: Readonly<Record<string, (ctx: EditorContext) => void>> = {
  "file.exportAs": (ctx) => ctx.options.onExport?.(),
  "file.export.png": (ctx) => ctx.options.onExport?.({ format: "png" }),
  "file.export.svg": (ctx) => ctx.options.onExport?.({ format: "svg" }),
  "file.export.pdf": (ctx) => ctx.options.onExport?.({ format: "pdf" }),
  "file.exportSelection": (ctx) => ctx.options.onExport?.({ what: "selection" }),
};

/// Lo stato di una voce di `VOCI_ESPORTA`: `null` se si fa, il perché se è spenta,
/// `undefined` se non è una di loro.
export function voceEsporta(ctx: EditorContext, id: string): string | null | undefined {
  if (VOCI_ESPORTA[id] === undefined) return undefined;
  if (ctx.options.onExport === undefined || !ctx.has("export")) return t("draw.export.off");
  if (id === "file.exportSelection" && ctx.selection.length === 0) return t("draw.export.noselection");
  return null;
}

/// Lo stato con la spunta delle voci del Disegno completo, `undefined` se non ne hanno.
export function statoClienteCompleto(ctx: EditorContext, id: string): boolean | undefined {
  return statoVisualizza(ctx, id);
}

/// I comandi del motore che il Disegno completo fa con la regola di Fub: «Sblocca
/// tutto» e «Mostra tutto» toccano solo gli oggetti che si vedono e si cambiano
/// (`flagged`), e un livello bloccato o nascosto resta com'è, con ciò che
/// contiene; il motore vede i livelli di Fub come gruppi e li attraverserebbe.
const COMANDI_DI_FUB: Readonly<Record<string, (ctx: EditorContext) => void>> = {
  "disegno.object.unlockAll": (ctx) => ctx.unflagAll("locked"),
  "disegno.object.showAll": (ctx) => ctx.unflagAll("hidden"),
  // Blocca guide è della vista, come in VectorCraft: le guide le prende il client (`guide-linee.ts`).
  "disegno.view.guides.lock": (ctx) => ctx.setGuidesLocked(!ctx.guidesLocked),
  // Modificare un simbolo è la modalità di Fub, che il motore non tiene fra le richieste.
  "disegno.symbol.edit": editSymbol,
  "disegno.symbol.exitEditing": exitSymbol,
  // Il ritaglio è uno strumento sul foglio, e non perde i pixel: il clipPath di `crop.ts`.
  "disegno.object.cropImage": VOCI_IMMAGINI["ui.cropImage"]!,
  // Incorpora e Inserisci leggono i file del vault, che il motore non vede.
  "disegno.links.embed": (ctx) => void ctx.embedImages(),
  "disegno.file.place": VOCI_IMMAGINI["file.place"]!,
};

/// Fa il comando del motore `id` con la regola di Fub, se è uno di quelli
/// (`COMANDI_DI_FUB`): vero se è partito, falso se va al motore.
export function comandoDiFub(ctx: EditorContext, id: string): boolean {
  const comando = COMANDI_DI_FUB[id];
  if (comando === undefined) return false;
  comando(ctx);
  return true;
}

export function installStatus(ctx: EditorContext, frame: StatusFrame = FOTOGRAMMA): void {
  const listeners = new Set<() => void>();
  ctx.statusPointer = null;

  // Le voci cambiano al più una volta per fotogramma: `statusChanged` chiede il
  // fotogramma, e lì si legge la selezione e si avvisa la banda. Una richiesta
  // sola per fotogramma, anche con cento movimenti del puntatore.
  let versione = 0;
  let misura: Misura | null = null;
  let fotogramma: number | null = null;
  const leggi = (): void => {
    fotogramma = null;
    if (ctx.disposed) return;
    const scelti = ctx.selectedUnits();
    const trovata = scelti.length > 0 ? ctx.frameOf(scelti) : null;
    misura = {
      versione,
      selezione: trovata === null ? null : {
        larghezza: along(trovata.box.max[0] - trovata.box.min[0], trovata.matrix[0], trovata.matrix[1]),
        altezza: along(trovata.box.max[1] - trovata.box.min[1], trovata.matrix[2], trovata.matrix[3]),
      },
    };
    for (const listener of [...listeners]) listener();
  };
  ctx.statusChanged = () => {
    versione += 1;
    fotogramma ??= frame.request(leggi);
  };
  ctx.life.add(() => {
    if (fotogramma !== null) frame.cancel(fotogramma);
    fotogramma = null;
    listeners.clear();
  });

  /// Le misure: dove sta il puntatore, e la selezione accanto. Un'unica voce.
  const infoDi = (puntatore: Point | null, selezione: Misura["selezione"]): string | null => {
    const punto = puntatore === null ? null : t("draw.status.pointer", { x: ctx.coordText(puntatore[0]), y: ctx.coordText(puntatore[1]) });
    const dimensioni = selezione === null
      ? null
      : t("draw.status.size", { width: ctx.lengthText(selezione.larghezza), height: ctx.lengthText(selezione.altezza) });
    if (punto !== null && dimensioni !== null) return t("draw.status.info", { pointer: punto, size: dimensioni });
    return punto ?? dimensioni;
  };

  const items = (): DrawStatusItem[] => {
    if (ctx.disposed) return [];
    const list: DrawStatusItem[] = [];
    const zoom = ctx.zoomText();
    // Nel Disegno completo la voce apre il menu dello zoom, e c'è il navigatore; negli
    // altri spazi la banda resta com'era: un clic torna al 100 %, sul posto.
    const nelCompleto = ctx.space === "full" && ctx.completoVoci?.() != null;
    if (nelCompleto) {
      list.push({ id: "zoom", text: zoom, hint: t("draw.status.zoom.menu", { zoom }), open: () => ctx.apriZoom() });
    } else {
      list.push({ id: "zoom", text: zoom, hint: t("draw.zoom_reset", { zoom }), open: () => ctx.zoomBy(1 / ctx.camera.scale), inPlace: true });
    }
    if (ctx.camera.angle !== 0) {
      const angle = ctx.turnText(ctx.camera.angle);
      list.push({ id: "turn", text: t("draw.status.turn", { angle }), hint: t("draw.turn.button", { angle }), open: () => ctx.turnView(0), inPlace: true });
    }
    if (ctx.outline) list.push({ id: "outline", text: t("draw.outlines"), hint: t("draw.status.outline.hint"), open: () => ctx.setOutline(false), inPlace: true });
    // Una lettura che non è di questa versione del disegno è vecchia: non si mostra.
    const selezione = misura !== null && misura.versione === versione ? misura.selezione : null;
    const info = infoDi(ctx.statusPointer, selezione);
    if (info !== null) list.push({ id: "info", text: info, hint: t("draw.status.info.hint") });
    if (nelCompleto) {
      list.push({
        id: "navigator",
        text: t(ctx.navigator ? "draw.status.navigator.on" : "draw.status.navigator.off"),
        hint: t("draw.status.navigator.hint"),
        open: () => ctx.comandoVista("navigator"),
        inPlace: true,
      });
    }
    const count = ctx.currentIndex().units.length;
    const chosen = ctx.selectedUnits();
    if (chosen.length > 0) {
      list.push({ id: "objects", text: t("draw.status.chosen", { chosen: chosen.length, count }), hint: t("draw.status.objects.hint") });
    } else {
      list.push({ id: "objects", text: plural(count, "draw.status.objects.one", "draw.status.objects.other"), hint: t("draw.status.objects.hint") });
    }
    return list;
  };

  ctx.status = {
    items,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const menu = creaMenuZoom(ctx, () => ctx.root.ownerDocument.querySelector<HTMLElement>('[data-surface-item="zoom"]'));
  ctx.apriZoom = () => menu.apri(false);
  ctx.comandoVista = (id) => {
    if (id === "navigator") {
      ctx.setNavigator(!ctx.navigator);
      return;
    }
    // «Zoom sulla selezione» è la vista dell'editor (`fitSelection`): niente file, niente cronologia.
    if (id === COMANDO_ZOOM_SCELTA) {
      ctx.fitSelection();
      return;
    }
    if (isComandoVisualizza(id)) {
      comandoVisualizza(ctx, id);
      return;
    }
    menu.comando(id);
  };
}
