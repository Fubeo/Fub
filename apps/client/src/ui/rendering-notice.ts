// Gli avvisi del percorso di disegno (`appearance.rendering`, solo Linux).
//
// L'host li compone prima che parta GTK (`crates/fub-app/src/disegno.rs`) e
// li consegna come `custom` col topic `rendering`, tirati con l'avviso di
// sessione: quando nascono non c'è ancora nessun ascoltatore. Qui diventano
// notifiche nella lingua della shell:
//
// - `driver_mismatch`: il modulo NVIDIA del kernel e le sue librerie hanno
//   versioni diverse, la pagina disegna col processore finché non si riavvia;
// - `nvidia_flicker`: NVIDIA prima del 555 sotto Wayland sfarfalla. Fub
//   **propone** e non cambia niente da solo: disegno col processore (vale dal
//   prossimo avvio), movimento calmo, o «lascia così», che scrive `gpu` e
//   spegne la proposta. Finché l'utente non sceglie, torna a ogni avvio.
import { api } from "../host/ipc";
import type { KernelEvent } from "../host/contract";
import { t } from "../i18n/strings";
import { onEvent } from "../state/kernel";
import { errorText } from "../host/errors";
import type { Lifetime } from "./lifetime";
import { notify, type NoticeAction } from "./notify";

export const RENDERING_TOPIC = "rendering";
const RENDERING_KEY = "appearance.rendering";
const MOTION_KEY = "appearance.motion";

/// Un avviso del percorso di disegno, come lo serializza `disegno::Avviso`.
export type RenderingNotice =
  | { kind: "driver_mismatch"; kernel: string; library: string }
  | { kind: "nvidia_flicker"; driver: string; offer_motion: boolean };

/// Il payload letto con sospetto: un `kind` che questa shell non conosce, o
/// un campo mancante, non è un avviso (degrado garbato).
export function renderingNoticeOf(event: Extract<KernelEvent, { type: "custom" }>): RenderingNotice | null {
  if (event.topic !== RENDERING_TOPIC) return null;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind === "driver_mismatch" && typeof record.kernel === "string" && typeof record.library === "string") {
    return { kind: "driver_mismatch", kernel: record.kernel, library: record.library };
  }
  if (record.kind === "nvidia_flicker" && typeof record.driver === "string") {
    return { kind: "nvidia_flicker", driver: record.driver, offer_motion: record.offer_motion === true };
  }
  return null;
}

/// Scrive un'impostazione da un gesto dell'avviso; un rifiuto si dice.
function choose(key: string, value: string, done: string): () => Promise<void> {
  return async () => {
    try {
      await api.setSetting(key, value);
      notify(done);
    } catch (error) {
      notify(t("rendering.choice_failed", { reason: errorText(error) }), "guasto");
    }
  };
}

/// Il testo, il tono e i gesti di un avviso.
export function renderingMessage(notice: RenderingNotice): {
  text: string;
  tone: "info" | "guasto";
  actions: NoticeAction[];
} {
  if (notice.kind === "driver_mismatch") {
    return {
      text: t("rendering.driver_mismatch", { kernel: notice.kernel, library: notice.library }),
      tone: "guasto",
      actions: [],
    };
  }
  const actions: NoticeAction[] = [
    {
      label: t("rendering.flicker.cpu"),
      hint: t("rendering.flicker.cpu.hint"),
      run: choose(RENDERING_KEY, "cpu", t("rendering.flicker.cpu.done")),
    },
  ];
  if (notice.offer_motion) {
    actions.push({
      label: t("rendering.flicker.motion"),
      hint: t("rendering.flicker.motion.hint"),
      run: choose(MOTION_KEY, "calm", t("rendering.flicker.motion.done")),
    });
  }
  actions.push({
    label: t("rendering.flicker.keep"),
    hint: t("rendering.flicker.keep.hint"),
    run: choose(RENDERING_KEY, "gpu", t("rendering.flicker.keep.done")),
  });
  return { text: t("rendering.flicker", { driver: notice.driver }), tone: "info", actions };
}

/// Ascolta gli avvisi del percorso di disegno. Va iscritta prima di tirare
/// l'avviso di sessione, come `listenForFailures`.
export function listenForRenderingNotices(lifetime: Lifetime): void {
  lifetime.add(
    onEvent("custom", (event) => {
      const notice = renderingNoticeOf(event);
      if (!notice) return;
      const message = renderingMessage(notice);
      notify(message.text, message.tone, message.actions);
    }),
  );
}
