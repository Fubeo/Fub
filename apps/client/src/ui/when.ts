// Quando è successo, detto come lo direbbe una persona: «adesso», «2 min fa»,
// poi l'ora senza secondi, e la data quando non è oggi. I secondi stanno nel
// suggerimento (`exactTime`), per chi li cerca.
import { resolvedLanguage, t } from "../i18n/strings";

/// Sotto questa distanza è «adesso».
const NOW_MS = 45_000;
const HOUR_MS = 3_600_000;

export function relativeTime(when: number, now: number = Date.now()): string {
  const language = resolvedLanguage();
  const ago = now - when;
  if (ago < NOW_MS) return t("time.now");
  if (ago < HOUR_MS) {
    const minutes = Math.max(1, Math.round(ago / 60_000));
    return new Intl.RelativeTimeFormat(language, { style: "short" }).format(-minutes, "minute");
  }
  const at = new Date(when);
  const today = new Date(now).toDateString() === at.toDateString();
  return at.toLocaleString(language, today
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/// L'istante intero, secondi compresi: il suggerimento dell'ora relativa.
export function exactTime(when: number): string {
  return new Date(when).toLocaleString(resolvedLanguage());
}
