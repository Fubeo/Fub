import { openLifetime } from "../../ui/lifetime";
import type { AttachmentDeposit } from "./attachment-target";
import { commitRecording, createAudioRecorder, recoverableRecordings, type AudioRecorder, type CrashDeposit } from "./recorder";
import { t } from "../../i18n/strings";

export interface RecorderSurfaceDeps {
  staging: CrashDeposit;
  attachment: AttachmentDeposit;
  /** Caller inserts the relative audio embed into its live document buffer. */
  onEmbed(link: string): void;
}

/** A mounted, disposable recorder with an explicit recovery action after restart. */
export function mountRecorderSurface(host: HTMLElement, deps: RecorderSurfaceDeps): () => void {
  const life = openLifetime();
  const root = document.createElement("section");
  root.className = "media-recorder";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const start = document.createElement("button");
  start.type = "button";
  start.textContent = t("pane.recorder.open");
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = t("media.recorder.stop");
  stop.disabled = true;
  const recovery = document.createElement("div");
  root.append(start, stop, status, recovery);
  host.append(root);
  let recorder: AudioRecorder | null = null;
  let working = false;

  async function save(id: string): Promise<void> {
    working = true;
    start.disabled = true;
    stop.disabled = true;
    status.textContent = t("media.recorder.saving");
    try {
      const saved = await commitRecording(deps.staging, id, deps.attachment);
      if (life.closed) return;
      try {
        deps.onEmbed(saved.link);
        status.textContent = t("media.recorder.saved", { id: saved.id });
      } catch (error) {
        status.textContent = t("media.recorder.saved_no_embed", { id: saved.id, reason: String(error) });
      }
      await showRecovery().catch((error) => {
        if (!life.closed) status.textContent = t("media.recorder.saved_no_recovery", { id: saved.id, reason: String(error) });
      });
    } catch (error) {
      if (!life.closed) status.textContent = t("media.recorder.staged", { reason: String(error) });
    } finally {
      working = false;
      if (!life.closed) start.disabled = false;
    }
  }

  async function showRecovery(): Promise<void> {
    const entries = await recoverableRecordings(deps.staging);
    if (life.closed) return;
    recovery.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("media.recorder.recover", { size: entry.bytes });
      life.listen(button, "click", () => { if (!working) void save(entry.id); });
      recovery.append(button);
    }
  }

  life.listen(start, "click", () => {
    if (working || recorder?.state === "recording") return;
    recorder?.destroy();
    recorder = createAudioRecorder(deps.staging, {
      onState(state, reason) {
        if (life.closed) return;
        status.textContent = reason ? `${state}: ${reason}` : state;
        stop.disabled = state !== "recording";
      },
    });
    working = true;
    start.disabled = true;
    void recorder.start().catch((error) => {
      if (!life.closed) status.textContent = String(error);
    }).finally(() => {
      working = false;
      if (!life.closed) start.disabled = false;
    });
  });
  life.listen(stop, "click", () => {
    if (working || recorder?.state !== "recording") return;
    const current = recorder;
    working = true;
    stop.disabled = true;
    void current.stop().then((meta) => save(meta.id)).catch((error) => {
      if (!life.closed) status.textContent = t("media.recorder.recoverable", { reason: String(error) });
    }).finally(() => { working = false; });
  });
  void showRecovery().catch((error) => {
    if (!life.closed) status.textContent = t("media.recorder.recovery_unavailable", { reason: String(error) });
  });
  life.add(() => {
    recorder?.destroy();
    root.remove();
  });
  return () => life.close();
}
