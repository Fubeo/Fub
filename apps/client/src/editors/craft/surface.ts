// Il contenuto della scheda di un file Craft o di un XMP (N7), in sola lettura.
//
// Chiede a `state/craft-previews.ts` l'anteprima `large` del documento e la
// disegna. Con l'immagine: la vista delle immagini (`mountImageView`, lo zoom
// e la barra di una foto) e sotto la riga dei dati, cioè l'app, la versione
// del formato se il file la dice, il peso. Senza: un riquadro col nome del
// file e la riga dei dati, con ciò che succede all'anteprima («Preparo
// l'anteprima…», «File troppo grande per l'anteprima») e, se un'app installata
// sa farla, il pulsante «Crea l'anteprima con …». Aprendo la scheda, se l'app
// c'è e l'anteprima manca, la si chiede da sola una volta (D-1). Un XMP si
// disegna con `xmp-view.ts`.
//
// Tutto ciò che la scheda accende vive nella `Lifetime` della superficie: una
// risposta che arriva a scheda chiusa si scarta.

import type { SurfaceMountContext } from "../core/registry";
import type { CraftPreview } from "../../host/craft";
import { asPluginError, errorText } from "../../host/errors";
import { onLanguage, t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { previewOf, watchCraftPreviews, type CraftPreviewAnswer } from "../../state/craft-previews";
import { decodeImage, mountImageView } from "../media/image-view";
import { CRAFT_PROFILE, craftInfoText, fileName, type CraftSurfaceDeps } from "./index";
import { mountXmpView } from "./xmp-view";

/// Oltre questo peso il bundle non legge il file e non dà anteprima né
/// metadati (D-8): il gemello di `container::MAX_FILE_BYTES` di
/// `fub-format-craft`.
export const CRAFT_MAX_FILE_BYTES = 64 * 1024 * 1024;

/// Il file è troppo grande perché il bundle lo legga.
export function tooLarge(preview: CraftPreview): boolean {
  return preview.image === null && preview.info.bytes > CRAFT_MAX_FILE_BYTES;
}

/// L'anteprima manca e un'app installata può farla: c'è il pulsante.
export function offersRender(preview: CraftPreview): boolean {
  return preview.image === null && !preview.queued && preview.render !== null && !tooLarge(preview);
}

/// I byte del PNG che l'anteprima porta in base64.
function pngBytes(data: string): Uint8Array {
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
    preview.image ? `${preview.image.width}x${preview.image.height}:${preview.image.data.length}` : "",
    preview.render?.app ?? "",
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
  let autoAsked = false;
  let drawn: string | null = null;
  let shown: CraftPreviewAnswer | null = null;
  /// La frase della riga di stato, quando la scheda mostra soltanto quella.
  let said: (() => string) | null = null;
  let drawing: Lifetime | null = null;
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

  function load(render: boolean, force = false): void {
    const mine = ++ticket;
    previewOf(doc, "large", { render, ...(revision === undefined ? {} : { revision }) }).then(
      (answer) => {
        if (life.closed || mine !== ticket || !answer) return;
        revision = undefined;
        // D-1: la prima volta che la scheda vede un'anteprima che l'app può
        // fare, la chiede; intanto non mostra il pulsante per un istante.
        if (!autoAsked && profile === CRAFT_PROFILE && offersRender(answer.preview)) {
          autoAsked = true;
          load(true);
          return;
        }
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

  function draw(answer: CraftPreviewAnswer, force = false): void {
    const sign = signature(answer);
    if (!force && sign === drawn) return;
    drawn = sign;
    shown = answer;
    said = null;
    const preview = answer.preview;
    if (profile !== CRAFT_PROFILE) {
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
  }

  function drawImage(preview: CraftPreview): void {
    const image = preview.image!;
    const bytes = pngBytes(image.data);
    const decoded = decodeImage(
      { handle: "", id: doc, len: bytes.byteLength, mime: "image/png", kind: "image", revision: preview.revision },
      bytes,
    );
    const card = document.createElement("div");
    card.className = "craft-card";
    const own = replace(card);
    const view = mountImageView(decoded, t("craft.figure.alt", { name }), own);
    card.append(view.element, paragraph("craft-info", craftInfoText(preview.info)));
  }

  function drawEmpty(answer: CraftPreviewAnswer, broken: string | null): void {
    const preview = answer.preview;
    const box = document.createElement("div");
    box.className = "craft-empty";
    box.append(paragraph("craft-empty-name", name), paragraph("craft-info", craftInfoText(preview.info)));
    const state = paragraph("craft-empty-state", stateText(answer, broken));
    state.setAttribute("role", "status");
    box.append(state);
    const own = replace(box);
    if (!offersRender(preview)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "craft-render";
    button.textContent = t("craft.render", { app: preview.render!.app });
    own.listen(button, "click", () => {
      if (button.disabled) return;
      button.disabled = true;
      // Ridisegnata comunque: se l'app non l'ha presa, il pulsante torna.
      load(true, true);
    });
    box.append(button);
  }

  function stateText(answer: CraftPreviewAnswer, broken: string | null): string {
    const preview = answer.preview;
    if (broken !== null) return t("craft.failed", { reason: broken });
    if (tooLarge(preview)) return t("craft.too_large");
    if (preview.queued) return t("craft.queued");
    if (answer.renderError !== null) return t("craft.render_failed", { reason: errorText(answer.renderError) });
    return t("craft.no_preview");
  }

  const loading = paragraph("craft-status", t("craft.loading"));
  loading.setAttribute("role", "status");
  root.replaceChildren(loading);
  said = () => t("craft.loading");
  // Un'anteprima arrivata da un job, un documento cambiato, il vault che
  // cambia: si richiede, e la risposta tenuta risponde subito se c'è.
  watchCraftPreviews(life, (changed) => {
    if (changed === "" || changed === doc) load(false);
  });
  life.add(onLanguage(() => {
    if (shown) draw(shown, true);
    else if (said && root.firstElementChild) root.firstElementChild.textContent = said();
  }));
  load(false);
}
