// Ciò che il sistema è, riportato al kernel (§12.3).
//
// Questa shell è l'unica parte di Fub che sappia davvero in che lingua legge
// l'utente e in che fuso vive: la webview porta un ICU intero, e il lato Rust
// — per rispondere alla stessa domanda — avrebbe bisogno di un database dei
// fusi orari, cioè di una dipendenza che il kernel non porta, per dare una
// risposta peggiore. Quindi il locale segue la strada del contesto di sessione:
// lo pubblica la shell, il kernel lo custodisce senza derivarlo, e chi sta
// dentro il confine lo chiede con `HostEnv::user_locale`.
//
// Ciò che questo modulo NON fa: decidere. Sopra a quello che riporta stanno le
// chiavi `locale.*` (§11.1), e a comporre le due cose è il kernel. Qui si
// riferisce un fatto, non si applica una preferenza.
import { api } from "../host/ipc";
import type { HourCycle, Locale, Weekday } from "../host/contract";

// I sette giorni nell'ordine di `Intl.Locale.getWeekInfo()`, che è quello di
// ISO 8601: lunedì = 1.
const GIORNI: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

// Il tipo di `Intl.Locale.getWeekInfo`, che non tutte le lib TS dichiarano
// ancora e che non tutti i motori implementano (è recente). Dichiararlo qui e
// chiamarlo dietro un controllo è ciò che permette di usarlo dove c'è senza
// rompere dove non c'è.
type ConWeekInfo = Intl.Locale & { getWeekInfo?: () => { firstDay: number } };

// Il primo giorno della settimana secondo il motore, o `null` se non lo sa.
//
// Non c'è una tabella di riserva, ed è deliberato: una tabella scritta a mano
// sarebbe un ICU in miniatura che sbaglia sui paesi che nessuno ha guardato, e
// sbaglierebbe **in silenzio**. Quando il motore non lo sa, il kernel tiene il
// suo default — lunedì, che è quello di ISO 8601 — e resta la chiave
// `locale.first-day-of-week` per chi vuole decidere.
function primoGiorno(lingua: string): Weekday | null {
  try {
    const info = (new Intl.Locale(lingua) as ConWeekInfo).getWeekInfo?.();
    return info ? (GIORNI[info.firstDay - 1] ?? null) : null;
  } catch {
    return null;
  }
}

// L'orologio secondo il motore. `h11`/`h12` sono due modi di scrivere le 12 ore
// (mezzanotte come `0` o come `12`), `h23`/`h24` due modi di scrivere le 24: la
// differenza sta in come si stampa un'ora sola, non in quale quadrante si legge,
// e il contratto tiene la seconda distinzione perché è quella che l'utente vede.
function orologio(lingua: string): HourCycle {
  try {
    const risolto = new Intl.DateTimeFormat(lingua, {
      hour: "numeric",
    }).resolvedOptions().hourCycle;
    return risolto === "h11" || risolto === "h12" ? "h12" : "h23";
  } catch {
    return "h23";
  }
}

// Cosa il sistema dice **adesso**.
export function systemLocale(): Locale {
  const language = navigator.language || "und";
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    timezone = "";
  }
  return {
    language,
    timezone,
    // `getTimezoneOffset` conta i minuti da aggiungere all'ora LOCALE per
    // ottenere UTC; il contratto conta quelli da aggiungere a UTC per ottenere
    // l'ora locale. Il segno invertito è la sola cosa che c'è da ricordare, ed
    // è il genere di dettaglio che si sbaglia una volta sola e per sempre.
    utc_offset_minutes: -new Date().getTimezoneOffset(),
    first_day_of_week: primoGiorno(language) ?? "monday",
    hour_cycle: orologio(language),
  };
}

// Riporta al kernel cosa il sistema dice. Rende `true` se è cambiato qualcosa.
export async function publishSystemLocale(): Promise<boolean> {
  try {
    return await api.setSystemLocale(systemLocale());
  } catch {
    // Un locale che non si riesce a pubblicare lascia il kernel col precedente
    // (o col default), che è un peggioramento visibile e reversibile: non vale
    // fermare l'avvio della shell.
    return false;
  }
}

// Pubblica adesso, e **ripubblica quando la finestra torna in primo piano**.
//
// Le due sorgenti di cambio sono l'utente che tocca le impostazioni del sistema
// e l'ora legale che scatta da sola. Nessuna delle due manda un evento alla
// webview, e un timer che le insegua sarebbe un timer acceso per sempre su una
// cosa che cambia due volte l'anno: il ritorno del focus è il momento in cui
// l'utente sta per **guardare** l'app, cioè l'unico in cui vale accorgersene.
//
// `onChange` scatta solo quando qualcosa è davvero cambiato: chi ridisegna
// perché la finestra ha ripreso il focus ridisegnerebbe a ogni alt-tab.
export function mountLocale(onChange: () => void): void {
  void publishSystemLocale();
  window.addEventListener("focus", () => {
    void publishSystemLocale().then((cambiato) => {
      if (cambiato) onChange();
    });
  });
}
