// Il contenuto della scheda di un file Craft o di un XMP (N7), in sola lettura.
//
// Chiede a `state/craft-previews.ts` l'anteprima `large` del documento e la
// disegna. Con l'immagine: la vista delle immagini (`mountImageView`, lo zoom
// e la barra di una foto) e sotto la riga dei dati, cioè l'app, la versione
// del formato se il file la dice, il peso. Senza: un riquadro col nome del
// file e la riga dei dati, con ciò che succede all'anteprima («Preparo
// l'anteprima…», «Il file non si legge: forse è rotto»: la frase viene da
// `missing`, il perché che il bundle dice) e, se un'app installata sa farla,
// ciò che il consenso dice (`consent.ts`): la domanda, la riga «spente» o il
// pulsante «Crea l'anteprima con …». `craft.preview` non avvia mai l'app:
// la chiede soltanto `renderPreview`, dopo un gesto. La scheda nata da un
// gesto (`context.gesture`) col consenso acceso la chiede una volta al
// montaggio; ogni altra scheda (riaperta all'avvio, rimontata, aperta da un
// link `fub://` o da una vista) mostra il pulsante (T23). Un XMP si disegna
// con `xmp-view.ts`.
//
// Una foto RAW (profilo `raw`) è la stessa scheda: il JPEG che il RAW ha
// dentro, nella vista dello zoom che parte con l'orientamento dell'anteprima
// (la foto si vede dritta, e la riga dello zoom dice le misure dritte), sotto
// la riga dei dati («Foto RAW · CR3 · 24.2 MiB») e i dati del suo XMP
// (`photo-data.ts`); senza JPEG, il riquadro con la domanda o il pulsante di
// LightCraft, e i dati dell'XMP sotto. La scheda non chiede mai l'anteprima
// all'app quando il JPEG c'è.
//
// Tutto ciò che la scheda accende vive nella `Lifetime` della superficie: una
// risposta che arriva a scheda chiusa si scarta.

import type { SurfaceMountContext } from "../core/registry";
import type { CraftPreview } from "../../host/craft";
import { asPluginError, errorText } from "../../host/errors";
import { onLanguage, t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { previewOf, renderPreview, watchCraftPreviews, type CraftPreviewAnswer } from "../../state/craft-previews";
import { mountConsent, settingsLink } from "./consent";
import { decodeImage, mountImageView } from "../media/image-view";
import { RAW_PROFILE, XMP_PROFILE, craftInfoText, fileName, type CraftSurfaceDeps } from "./index";
import { mountXmpView } from "./xmp-view";
import { showPhotoData } from "./photo-data";

/// L'anteprima manca e un'app installata può farla: c'è il pulsante. Il
/// bundle non offre l'app per un file oltre il peso massimo; la scheda lo
/// rispetta anche se l'offerta arrivasse.
export function offersRender(preview: CraftPreview): boolean {
  return preview.image === null && !preview.queued && preview.render !== null && preview.missing !== "over_limit";
}

/// L'impostazione del peso massimo, di T19: la frase di `over_limit` ci
/// rimanda.
const CRAFT_MAX_SETTING = "craft.preview-max-mib";

/// Il peso massimo come lo dice l'impostazione: i MiB interi, uno spazio che
/// non va a capo e «MiB» («64 MiB», non il «64.0 MiB» di `formatBytes`).
export function limitText(bytes: number | null): string {
  return bytes === null ? "\u2014" : `${Math.floor(bytes / 1048576)}\u00a0MiB`;
}

/// I byte dell'immagine che l'anteprima porta in base64.
function imageBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

/// Ciò che si vede di una risposta: se non cambia, non si ridisegna (lo zoom
/// della vista resta dov'era).
function signature(answer: CraftPreviewAnswer): string {
  const preview = answer.preview;
  return [
    preview.revision,
    preview.origin,
    preview.queued,
    preview.image
      ? `${preview.image.media_type}:${preview.image.width}x${preview.image.height}:${preview.image.orientation}:${preview.image.data.length}`
      : "",
    preview.missing ?? "",
    preview.render ? `${preview.render.app}:${preview.render.consent}` : "",
    answer.renderError === null ? "" : errorText(answer.renderError),
  ].join("\u0000");
}

/// Disegna nella superficie `root` la scheda del documento di `context`.
export function mountCraftContent(
  profile: string,
  root: HTMLElement,
  context: SurfaceMountContext,
  deps: CraftSurfaceDeps,
  life: Lifetime,
): void {
  if (life.closed) return;
  const doc = context.documentId;
  const name = fileName(doc);
  /// La revisione che la sessione ha letto: la prima domanda non si
  /// accontenta di una risposta più vecchia.
  let revision = context.revision;
  let ticket = 0;
  let drawn: string | null = null;
  let shown: CraftPreviewAnswer | null = null;
  /// La frase della riga di stato, quando la scheda mostra soltanto quella.
  let said: (() => string) | null = null;
  let drawing: Lifetime | null = null;
  /// Il gesto che ha fatto nascere la scheda: vale per la prima risposta e
  /// poi si spegne, così un ridisegno non chiede di nuovo.
  let gesture = context.gesture === true;
  life.add(() => {
    drawing?.close();
    drawing = null;
  });

  function replace(...nodes: Node[]): Lifetime {
    drawing?.close();
    drawing = openLifetime();
    root.removeAttribute("aria-busy");
    root.replaceChildren(...nodes);
    return drawing;
  }

  function status(text: () => string): void {
    drawn = null;
    shown = null;
    said = text;
    const line = paragraph("craft-status", text());
    line.setAttribute("role", "status");
    replace(line);
  }

  function load(force = false): void {
    const mine = ++ticket;
    previewOf(doc, "large", revision === undefined ? {} : { revision }).then(
      (answer) => {
        if (life.closed || mine !== ticket || !answer) return;
        revision = undefined;
        draw(answer, force);
      },
      (error: unknown) => {
        if (life.closed || mine !== ticket) return;
        // Il componente spento: il comando non c'è, e la scheda dice ciò che
        // dice un file senza superficie.
        if (asPluginError(error)?.kind === "unknown_command") status(() => t("surface.unavailable"));
        else status(() => t("craft.failed", { reason: errorText(error) }));
      },
    );
  }

  /// Chiede l'anteprima all'app: il gesto c'è (la scheda nata da un gesto, il
  /// pulsante, il «Sì»). La risposta in coda ridisegna; un rifiuto lo dice,
  /// e `no_consent` fa richiedere (torna la domanda o la riga «spente»).
  function render(): void {
    const mine = ++ticket;
    renderPreview(doc, "large").then(
      (answer) => {
        if (life.closed || mine !== ticket || !answer) return;
        draw(answer, true);
      },
      (error: unknown) => {
        if (life.closed || mine !== ticket) return;
        if (asPluginError(error)?.kind === "permission_denied") {
          load(true);
          return;
        }
        if (shown) draw({ preview: shown.preview, renderError: error }, true);
        else status(() => t("craft.render_failed", { reason: errorText(error) }));
      },
    );
  }

  function draw(answer: CraftPreviewAnswer, force = false): void {
    const born = gesture;
    gesture = false;
    const sign = signature(answer);
    if (!force && sign === drawn) return;
    drawn = sign;
    shown = answer;
    said = null;
    const preview = answer.preview;
    if (profile === XMP_PROFILE) {
      const view = mountXmpView(preview, deps, openLifetime());
      replace(view.element).add(() => view.destroy());
      return;
    }
    if (preview.image) {
      try {
        drawImage(preview);
        return;
      } catch (error) {
        // Un PNG che non si decodifica: il riquadro, col motivo.
        drawEmpty(answer, errorText(error));
        return;
      }
    }
    drawEmpty(answer, null);
    if (born && offersRender(preview) && preview.render!.consent === "on") render();
  }

  function drawImage(preview: CraftPreview): void {
    const image = preview.image!;
    const bytes = imageBytes(image.data);
    const raw = profile === RAW_PROFILE;
    const decoded = decodeImage(
      {
        handle: "",
        id: doc,
        len: bytes.byteLength,
        mime: image.media_type,
        kind: "image",
        revision: preview.revision,
      },
      bytes,
    );
    const card = document.createElement("div");
    card.className = "craft-card";
    const own = replace(card);
    // Un JPEG non dice le sue misure nella firma: le dice l'anteprima. Il
    // JPEG di un RAW si mostra con l'orientamento che il RAW scrive.
    const view = raw
      ? mountImageView(
        { ...decoded, width: decoded.width ?? image.width, height: decoded.height ?? image.height },
        t("craft.figure.alt", { name }),
        own,
        image.orientation,
      )
      : mountImageView(decoded, t("craft.figure.alt", { name }), own);
    card.append(view.element, paragraph("craft-info", craftInfoText(preview.info, doc)));
    if (raw) showPhotoData(card, doc, deps, own);
  }

  function drawEmpty(answer: CraftPreviewAnswer, broken: string | null): void {
    const preview = answer.preview;
    const box = document.createElement("div");
    box.className = "craft-empty";
    box.append(paragraph("craft-empty-name", name), paragraph("craft-info", craftInfoText(preview.info, doc)));
    const state = paragraph("craft-empty-state", stateText(answer, broken));
    state.setAttribute("role", "status");
    box.append(state);
    // Il fuoco era nella scheda: dopo il ridisegno lo prende il primo
    // pulsante della domanda, e mai lo si ruba da fuori.
    const focused = root.contains(document.activeElement);
    const own = replace(box);
    if (broken === null && !preview.queued && answer.renderError === null && preview.missing === "over_limit") {
      const link = settingsLink(CRAFT_MAX_SETTING, deps.onOpenSettings, own);
      if (link) box.append(link);
    }
    // I dati dell'XMP di un RAW stanno sotto il riquadro anche senza JPEG.
    if (profile === RAW_PROFILE) showPhotoData(root, doc, deps, own);
    if (!offersRender(preview)) return;
    mountConsent(box, preview.render!, { render, openSettings: deps.onOpenSettings, focused }, own);
    if (focused && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }

  function stateText(answer: CraftPreviewAnswer, broken: string | null): string {
    const preview = answer.preview;
    if (broken !== null) return t("craft.failed", { reason: broken });
    if (preview.queued) return t("craft.queued");
    if (answer.renderError !== null) return t("craft.render_failed", { reason: errorText(answer.renderError) });
    switch (preview.missing) {
      case "over_limit":
        return t("craft.over_limit", { limit: limitText(preview.limit_bytes) });
      case "unreadable":
        return t("craft.unreadable");
      case "failed":
        return t("craft.cli_failed", { app: preview.render?.app ?? preview.info.editor });
      default:
        return t("craft.no_preview");
    }
  }

  const loading = paragraph("craft-status", t("craft.loading"));
  loading.setAttribute("role", "status");
  root.replaceChildren(loading);
  said = () => t("craft.loading");
  // Un'anteprima arrivata da un job, un documento cambiato, il vault che
  // cambia: si richiede, e la risposta tenuta risponde subito se c'è.
  watchCraftPreviews(life, (changed) => {
    if (changed === "" || changed === doc) load();
  });
  life.add(onLanguage(() => {
    if (shown) draw(shown, true);
    else if (said && root.firstElementChild) root.firstElementChild.textContent = said();
  }));
  load();
}
