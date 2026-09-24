// Le view audio/video (P07/F23): percorsi locali veri, codec dichiarati.
//
// I byte arrivano dalla porta e diventano un `blob:` revocato al teardown;
// `<audio>`/`<video>` con `controls` e `preload="metadata"` — mai autoplay,
// mai preload dell'intero file. Il codec dichiarato e' il MIME del
// descrittore (tabella condivisa, non cifre per-view); se il browser non lo
// decodifica, l'evento `error` diventa una riga che nomina MIME e dimensione,
// con offerta di apertura esterna. Niente URL remoti qui: il remoto passa dal
// viewer isolato o dal browser esterno, default negato.

import type { Lifetime } from "../../ui/lifetime";
import type { ResourceDescriptor } from "./media-types";
import { t } from "../../i18n/strings";

export interface MediaError {
  readonly id: string;
  readonly mime: string;
  readonly bytes: number;
  readonly reason: string;
}

export interface PlayerView {
  readonly element: HTMLElement;
  destroy(): void;
}

function errorBox(error: MediaError, life: Lifetime, onOpenExternal?: () => void | Promise<void>): HTMLElement {
  const box = document.createElement("div");
  box.className = "media-error";
  box.setAttribute("role", "alert");
  const title = document.createElement("p");
  title.textContent = `${error.id} (${error.mime}, ${formatBytes(error.bytes)})`;
  const reason = document.createElement("p");
  reason.textContent = error.reason;
  box.append(title, reason);
  if (onOpenExternal) {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = t("media.open_external");
    life.listen(open, "click", () => {
      void Promise.resolve().then(onOpenExternal).catch((failure) => {
        reason.textContent = t("media.open_external_failed", { reason: String(failure) });
      });
    });
    box.append(open);
  }
  return box;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function mountPlayer(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array | string,
  tag: "audio" | "video",
  life: Lifetime,
  onOpenExternal?: () => void | Promise<void>,
): PlayerView {
  const wrap = document.createElement("div");
  wrap.className = tag === "audio" ? "media-audio" : "media-video";
  if (typeof bytes !== "string" && bytes.byteLength === 0) {
    wrap.append(
      errorBox(
        { id: descriptor.id, mime: descriptor.mime, bytes: 0, reason: t("media.player.empty") },
        life,
        onOpenExternal,
      ),
    );
    return { element: wrap, destroy: () => life.close() };
  }
  const player = document.createElement(tag);
  if (player.canPlayType(descriptor.mime) === "") {
    wrap.append(errorBox({
      id: descriptor.id,
      mime: descriptor.mime,
      bytes: descriptor.len,
      reason: t("media.player.undecodable", { mime: descriptor.mime }),
    }, life, onOpenExternal));
    return { element: wrap, destroy: () => life.close() };
  }
  const url = typeof bytes === "string"
    ? bytes
    : URL.createObjectURL(new Blob([bytes as BlobPart], { type: descriptor.mime }));
  const ownedBlob = typeof bytes !== "string";
  let revoked = false;
  function releaseUrl(): void {
    if (!ownedBlob || revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  }
  player.controls = true;
  player.preload = "metadata";
  player.src = url;
  wrap.append(player);
  life.listen(player, "error", () => {
    const box = errorBox(
      {
        id: descriptor.id,
        mime: descriptor.mime,
        bytes: descriptor.len,
        reason: t("media.player.undecodable", { mime: descriptor.mime }),
      },
      life,
      onOpenExternal,
    );
    player.pause();
    player.removeAttribute("src");
    player.replaceWith(box);
    releaseUrl();
  });
  life.add(() => {
    releaseUrl();
    player.pause();
    player.removeAttribute("src");
    player.load();
    wrap.remove();
  });
  return { element: wrap, destroy: () => life.close() };
}

/** Monta un lettore audio con metadati differiti e teardown che rilascia. */
export function mountAudioView(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array | string,
  life: Lifetime,
  onOpenExternal?: () => void | Promise<void>,
): PlayerView {
  return mountPlayer(descriptor, bytes, "audio", life, onOpenExternal);
}

/** Monta un lettore video con metadati differiti e teardown che rilascia. */
export function mountVideoView(
  descriptor: ResourceDescriptor,
  bytes: Uint8Array | string,
  life: Lifetime,
  onOpenExternal?: () => void | Promise<void>,
): PlayerView {
  return mountPlayer(descriptor, bytes, "video", life, onOpenExternal);
}
