// Da dove vengono le voci del tema montato.
//
// La schermata delle preferenze (`preferences/theme-settings.ts`) non sa da
// dove vengono le voci né dove si scrivono: lo chiede a una sorgente. Questa è
// la sorgente vera. Le voci sono quelle che il tema dichiara nel manifest, già
// risolte da `theme/theme.ts` col valore del registro; si scrivono e si
// azzerano come ogni altra impostazione, con la chiave `<id>:<nome>`.
//
// Un tema dichiara le sue voci al registro quando il suo bundle si monta, cioè
// con un vault aperto. Senza, le voci si leggono col valore di default ma non
// si possono scrivere: la sorgente lo dice (`locked`) invece di lasciar fallire
// la scrittura.
import type { SettingKind } from "../../host/contract";
import { api } from "../../host/ipc";
import { t } from "../../i18n/strings";
import { on, state } from "../../state/store";
import type { ThemeOption } from "../../theme/options";
import { currentThemeOptions } from "../../theme/theme";
import type { Lifetime } from "../../ui/lifetime";
import {
  setThemeSettingsSource,
  type ThemeSettingKind,
  type ThemeSettings,
  type ThemeSettingsSource,
  type ThemeSettingValue,
} from "./preferences/theme-settings";

/// In quanti passi il cursore divide un intervallo che non è di interi.
const SLIDER_STEPS = 100;

function kindOf(kind: SettingKind): ThemeSettingKind | null {
  if (kind.kind === "toggle") return { kind: "toggle", default: kind.default };
  if (kind.kind === "choice") {
    return {
      kind: "choice",
      default: kind.default,
      options: kind.options.map((option) => ({ value: option.value, label: option.label })),
    };
  }
  if (kind.kind === "number") {
    const { min, max } = kind;
    // L'host rifiuta un tema che dichiara un numero senza i due estremi.
    if (typeof min !== "number" || typeof max !== "number") return null;
    const whole = [min, max, kind.default].every(Number.isInteger);
    return { kind: "number", default: kind.default, min, max, step: whole ? 1 : (max - min) / SLIDER_STEPS };
  }
  return null;
}

function entryOf(option: ThemeOption): ThemeSettings["entries"][number] | null {
  const kind = kindOf(option.setting.kind);
  // Una lista non è un valore che un tema possa dichiarare.
  if (!kind || Array.isArray(option.value)) return null;
  return {
    spec: {
      key: option.key,
      label: option.setting.label,
      ...(option.setting.description ? { description: option.setting.description } : {}),
      kind,
    },
    value: option.value,
  };
}

/// Le voci del tema montato come le legge la schermata. `locked` c'è quando il
/// registro non le conosce: dice perché non si possono scrivere.
export function readThemeSettings(): ThemeSettings & { locked?: string } {
  const { themeId, themeName, options } = currentThemeOptions();
  const entries = options.flatMap((option) => entryOf(option) ?? []);
  const undeclared = entries.length > 0 && options.some((option) => !option.declared);
  if (!undeclared) return { themeId, themeName, entries };
  return {
    themeId,
    themeName,
    entries,
    locked: t(state.vaultRoot ? "prefs.theme.locked.undeclared" : "prefs.theme.locked.no_vault"),
  };
}

function declared(key: string): boolean {
  return currentThemeOptions().options.some((option) => option.key === key && option.declared);
}

export const themeSettingsSource: ThemeSettingsSource = {
  read: () => Promise.resolve(readThemeSettings()),
  // Una chiave che il tema montato non dichiara non si scrive da qui: fra la
  // lettura e il gesto il tema può essere cambiato.
  write: (key: string, value: ThemeSettingValue) =>
    declared(key) ? api.setSetting(key, value) : Promise.reject(new Error(t("prefs.theme.locked.gone"))),
  reset: (key: string) =>
    declared(key) ? api.resetSetting(key) : Promise.reject(new Error(t("prefs.theme.locked.gone"))),
  // Il segnale arriva dopo ogni rilettura delle impostazioni e dopo ogni
  // cambio di tema: le due cose che cambiano ciò che `read` rende.
  subscribe: (listener) => on("theme", listener),
};

export function mountThemeSettingsSource(lifetime: Lifetime): void {
  lifetime.add(setThemeSettingsSource(themeSettingsSource));
}
