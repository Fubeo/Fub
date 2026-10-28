// Le parole del selettore del colore del kit (`kit/color/picker.ts`) nel
// disegno: le stesse per il pozzo della barra e per i colori dell'ispettore.

import type { ColorPickerText } from "../../../kit/color/picker";
import { t } from "../strings";

/// I testi del selettore, nella lingua di adesso.
export function drawPickerText(): ColorPickerText {
  return {
    area: t("draw.chrome.picker.area"),
    areaValue: (s, v) => t("draw.chrome.picker.area.value", { s: String(s), v: String(v) }),
    hue: t("draw.chrome.picker.hue"),
    alpha: t("draw.chrome.picker.alpha"),
    format: t("draw.chrome.picker.format"),
    formats: { hex: "HEX", rgb: "RGB", hsl: "HSL", oklch: "OKLCH" },
    code: t("draw.chrome.picker.code"),
    invalid: t("draw.chrome.picker.invalid"),
    eyedropper: t("draw.chrome.picker.eyedropper"),
    recommended: t("draw.chrome.picker.recommended"),
    documentColors: t("draw.chrome.picker.document"),
    recent: t("draw.chrome.picker.recent"),
    theme: t("draw.chrome.picker.theme"),
    none: t("draw.chrome.none"),
  };
}
