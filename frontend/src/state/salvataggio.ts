// Lo **stato del salvataggio** di un documento (§20.4): il fatto, non il modo
// in cui si disegna.
//
// Sta in un file suo e non accanto ai buffer per una ragione che si è vista
// provandolo: `panels/document.ts` monta editor, tab e riquadri, e importarlo
// vuol dire portarsi dietro mezza shell e un `document` globale. La decisione
// che qui dentro c'è — quale dei due fatti veri insieme vince — si prova in
// mezzo secondo e senza un DOM, ed è la stessa disciplina di `raccogli` in
// `ui/notify.ts`.

import { isErrorKind } from "../host/errors";

/// L'esito dell'ultima scrittura di un buffer.
///
/// `conflitto` è separato da `fallito` e non è una sfumatura (§18.1): i due si
/// riparano in due modi che non si somigliano. Un disco pieno si riprova — la
/// prossima battuta ci riprova da sola, ed è giusto così. Un conflitto no:
/// riprovare è la sovrascrittura silenziosa che la guardia esiste per
/// impedire, e ciò che manca non è un tentativo ma una **decisione**. Tenerli
/// insieme vorrebbe dire che l'autosave, insistendo, risolve da sé un caso in
/// cui insistere è il danno.
export type Esito = "ok" | "in_corso" | "fallito" | "conflitto";

/// Cosa la barra di stato dice del documento che si sta guardando.
///
/// Quattro e non due, perché due sarebbero «salvato» e «non salvato» e il caso
/// che questa voce esiste per coprire — *ho provato e non ci sono riuscito* —
/// finirebbe indistinguibile da *devo ancora provare*, che è quello innocuo.
export type StatoSalvataggio =
  | "salvato"
  | "in_corso"
  | "non_salvato"
  | "fallito"
  | "conflitto";

/// La regola, ed è l'unica decisione di questo pezzo: **un fallimento si vede
/// finché non è stato riparato**. Un salvataggio fallito resta scritto anche se
/// nel frattempo l'utente ha continuato a battere (cioè anche a buffer sporco):
/// è ciò che distingue «non l'ho ancora scritto» da «non riesco a scriverlo», e
/// invertire i due rami vorrebbe dire che la prossima battuta nasconde il
/// guasto.
///
/// È una funzione pura, per la ragione di `raccogli` in `ui/notify.ts`: è la
/// parte di questo lavoro che si può sbagliare in un modo che, guardando l'app
/// mentre tutto funziona, non si vede.
export function statoDi(buf: { dirty: boolean; esito: Esito } | undefined): StatoSalvataggio | null {
  if (!buf) return null;
  // Prima di `fallito` per la stessa ragione per cui `fallito` viene prima di
  // tutto il resto, e in più una sua: è l'unico stato che l'utente deve
  // **risolvere** invece di aspettare, e uno stato da risolvere che si nasconde
  // dietro uno da aspettare non viene risolto.
  if (buf.esito === "conflitto") return "conflitto";
  if (buf.esito === "fallito") return "fallito";
  if (buf.esito === "in_corso") return "in_corso";
  return buf.dirty ? "non_salvato" : "salvato";
}

/// **Che specie di fallimento è questo**, e quindi cosa se ne fa chi salva.
///
/// È una funzione e non un `if` in mezzo a `saveDoc` per la ragione di tutto
/// questo file: è una decisione, e le decisioni si provano dove non c'è un DOM.
/// La domanda che risponde è quella che il §18.1 ha reso possibile fare — prima
/// il salvataggio aveva un ramo solo, perché un solo esito era distinguibile.
///
/// `conflitto` non è una sfumatura di `fallito`: un disco pieno si **riprova**,
/// e la battuta dopo ci riprova da sola; un conflitto no, perché riprovare è la
/// sovrascrittura silenziosa che la guardia ha appena impedito. Ciò che manca
/// non è un tentativo ma una decisione, e la decisione è dell'utente.
///
/// Che la specie si legga dal `kind` e non da una sottostringa del messaggio è
/// la [0041](../../../docs/decisions/0041-un-errore-e-testo-che-qualcuno-legge.md):
/// il messaggio è già tradotto quando arriva, e cercarci dentro «conflict»
/// smetterebbe di funzionare nella lingua in cui l'app viene usata.
export function esitoDelFallimento(e: unknown): "conflitto" | "fallito" {
  return isErrorKind(e, "conflict") ? "conflitto" : "fallito";
}

/// Cosa è successo quando qualcuno riscrive un file **sotto un buffer sporco**.
///
/// Quattro risposte e non due, e la quarta è quella che mancava:
///
///   - `muto` — il buffer è pulito: non c'è niente da coprire, e la ricarica se
///     ne occupa da sé;
///   - `eco` — l'ha riscritto **il nostro salvataggio**, e l'evento che ce lo
///     dice è il ritorno di quella scrittura;
///   - `altra_app` — l'ha riscritto qualcun altro fuori da Fub (watcher): quel
///     lavoro non è nostro e non lo possiamo rifare;
///   - `riscrittura` — l'ha riscritto il kernel o un plugin: lo si riottiene
///     rifacendo l'operazione.
///
/// La riga che conta è la seconda. Senza, scrivere una nota e continuare a
/// battere durante il debounce dice a ogni salvataggio «il file è cambiato sotto
/// di te» — del file che contiene ciò che abbiamo appena scritto noi. È il
/// difetto peggiore che un centro notifiche possa avere: **un avviso che compare
/// quando non è successo niente insegna a ignorare quelli che contano**.
///
/// L'eco non può mangiarsi il caso grave, ed è l'unico invariante di questa
/// funzione: `daFuori` risponde prima del contatore, sempre.
export function cambioSotto(
  buf: { dirty: boolean; echi: number } | undefined,
  daFuori: boolean,
): "muto" | "eco" | "altra_app" | "riscrittura" {
  if (!buf?.dirty) return "muto";
  if (daFuori) return "altra_app";
  return buf.echi > 0 ? "eco" : "riscrittura";
}
