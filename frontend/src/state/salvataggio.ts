// Lo **stato del salvataggio** di un documento (§20.4): il fatto, non il modo
// in cui si disegna.
//
// Sta in un file suo e non accanto ai buffer per una ragione che si è vista
// provandolo: `panels/document.ts` monta editor, tab e riquadri, e importarlo
// vuol dire portarsi dietro mezza shell e un `document` globale. La decisione
// che qui dentro c'è — quale dei due fatti veri insieme vince — si prova in
// mezzo secondo e senza un DOM, ed è la stessa disciplina di `raccogli` in
// `ui/notify.ts`.

/// L'esito dell'ultima scrittura di un buffer.
export type Esito = "ok" | "in_corso" | "fallito";

/// Cosa la barra di stato dice del documento che si sta guardando.
///
/// Quattro e non due, perché due sarebbero «salvato» e «non salvato» e il caso
/// che questa voce esiste per coprire — *ho provato e non ci sono riuscito* —
/// finirebbe indistinguibile da *devo ancora provare*, che è quello innocuo.
export type StatoSalvataggio = "salvato" | "in_corso" | "non_salvato" | "fallito";

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
  if (buf.esito === "fallito") return "fallito";
  if (buf.esito === "in_corso") return "in_corso";
  return buf.dirty ? "non_salvato" : "salvato";
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
