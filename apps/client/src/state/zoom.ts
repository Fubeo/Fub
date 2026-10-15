// Lo zoom dell'interfaccia, come gesto: un passo avanti, uno indietro, il
// ritorno a 100%. Il valore vive nelle impostazioni (`appearance.zoom`); chi
// lo applica alla pagina lo legge da lì, non da qui.
import { api } from "../host/ipc";
import { settings } from "../host/query";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";

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
