// Lo zoom dell'interfaccia, come gesto: un passo avanti, uno indietro, il
// ritorno a 100%. Il valore vive nelle impostazioni (`appearance.zoom`); chi
// lo applica alla pagina lo legge da lì, non da qui.
import { api } from "../host/ipc";
import { settings } from "../host/query";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import type { Lifetime } from "../ui/lifetime";

/// I passi dello zoom: gli stessi di un browser, dentro i limiti che
/// `appearance.zoom` ammette.
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export async function zoomBy(step: -1 | 0 | 1): Promise<void> {
  try {
    const entries = await settings();
    const current = entries.find((entry) => entry.spec.key === "appearance.zoom")?.value;
    const now = typeof current === "number" ? current : 1;
    let next = 1;
    if (step > 0) next = ZOOM_STEPS.find((value) => value > now + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
    if (step < 0) next = [...ZOOM_STEPS].reverse().find((value) => value < now - 0.001) ?? ZOOM_STEPS[0]!;
    if (Math.abs(next - now) < 0.001) return;
    await api.setSetting("appearance.zoom", next);
    notify(t("shell.zoom_now", { percent: Math.round(next * 100) }), "info");
  } catch (error) {
    notify(t("shell.zoom_failed", { reason: errorText(error) }), "guasto");
  }
}

/// La dimensione del testo delle note, in punti di `appearance.body`: gli
/// stessi limiti che l'impostazione ammette.
export const TEXT_SIZE = { min: 12, max: 28, fallback: 17 } as const;

export async function textSizeBy(step: -1 | 1): Promise<void> {
  try {
    const entries = await settings();
    const current = entries.find((entry) => entry.spec.key === "appearance.body")?.value;
    const now = typeof current === "number" ? current : TEXT_SIZE.fallback;
    const next = Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, Math.round(now) + step));
    if (next === now) return;
    await api.setSetting("appearance.body", next);
    notify(t("shell.text_size_now", { size: next }), "info");
  } catch (error) {
    notify(t("shell.text_size_failed", { reason: errorText(error) }), "guasto");
  }
}

/// Quanto scorrere con Ctrl o Cmd premuto vale un passo: una tacca di rotella
/// ne vale uno, un pizzico sul trackpad ne accumula più d'uno.
const WHEEL_STEP = 50;

/// Ctrl o Cmd con la rotella sopra il testo di una nota cambia la dimensione
/// del testo. Le superfici che usano lo stesso gesto per un loro zoom (disegno,
/// canvas, grafo, immagini) lo consumano prima, e qui non arriva. Un passo alla
/// volta: il successivo legge il valore che il precedente ha scritto.
export function mountWheelTextSize(lifetime: Lifetime, change: (step: -1 | 1) => Promise<void> = textSizeBy): void {
  let pending = 0;
  let busy = false;
  lifetime.listen(document, "wheel", (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".cm-editor")) return;
    event.preventDefault();
    pending += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * WHEEL_STEP;
    if (busy || Math.abs(pending) < WHEEL_STEP) return;
    const step = pending < 0 ? 1 : -1;
    pending = 0;
    busy = true;
    void change(step).finally(() => { busy = false; });
  }, { passive: false });
}
