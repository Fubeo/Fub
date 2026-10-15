// Lo spazio dell'interfaccia, come gesto: un passo verso il foglio, uno verso
// la cornice, il ritorno al predefinito. Il valore vive nelle impostazioni
// (`chrome.compactness`); chi lo traduce in misure è la serie del tema, che lo
// rilegge quando l'impostazione cambia. Qui non si tocca nessuna misura.
import { errorText } from "../../host/errors";
import { api } from "../../host/ipc";
import { settings } from "../../host/query";
import { t } from "../../i18n/strings";
import { COMPACTNESS_STEPS, DEFAULT_COMPACTNESS, normalizedCompactness } from "../../theme/scrittoio/measures";
import { COMPACTNESS_KEY } from "../../theme/theme";
import { notify } from "../../ui/notify";

/// `1` stringe la cornice di un passo, `-1` la allarga, `0` torna al
/// predefinito. Ai due estremi non scrive niente e dice comunque a che passo
/// si è: è la risposta a «perché non succede più nulla».
export async function spaceBy(step: -1 | 0 | 1): Promise<void> {
  try {
    const entries = await settings();
    const now = normalizedCompactness(entries.find((entry) => entry.spec.key === COMPACTNESS_KEY)?.value);
    const next = step === 0 ? DEFAULT_COMPACTNESS : normalizedCompactness(now + step);
    if (next !== now) await api.setSetting(COMPACTNESS_KEY, next);
    notify(t("shell.space_now", { step: next + 1, steps: COMPACTNESS_STEPS }), "info");
  } catch (error) {
    notify(t("shell.space_failed", { reason: errorText(error) }), "guasto");
  }
}
