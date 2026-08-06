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
/// **Cinque** [conta: stati-salvataggio] e non due, perché due sarebbero
/// «salvato» e «non salvato» e i due casi che questo tipo esiste per coprire —
/// *ho provato e non ci sono riuscito*, *è cambiato sotto e devo decidere* —
/// finirebbero indistinguibili da *devo ancora provare*, che è quello innocuo.
///
/// Il numero sta fra parentesi quadre e non a memoria: quando questa riga è
/// stata scritta diceva «quattro», ed era vera; poi è arrivato `conflitto` e la
/// riga è rimasta indietro senza che niente diventasse rosso. Un conteggio
/// scritto in una frase è **prosa che parla dei sorgenti** (§16.8), e da qui in
/// avanti lo rifà `check-prosa` a ogni giro.
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
/// **Quattro** [conta: esiti-cambio-sotto] risposte e non due, e la quarta è
/// quella che mancava:
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
export type CambioSotto = "muto" | "eco" | "altra_app" | "riscrittura";

/// Chi ha riscritto il file, **consumando l'eco che quell'evento era**.
///
/// Questa funzione non è pura, ed è l'unica di questo file a non esserlo: è la
/// **seconda metà** del conto degli echi, e la prima è `scriviContandoEco` qui
/// sotto. Il conto ha due eventi — nasce con la scrittura, muore con l'evento
/// che quella scrittura produce — e chi possiede un conto deve possedere i due
/// **eventi**, non i due segni. Finché la sottrazione stava nel `case "eco"` di
/// chi avvisa, la metà che toglie era una riga che il prossimo ramo (o il
/// prossimo ascoltatore di `document_changed`) si dimentica, e un ramo
/// dimenticato non si vede provando l'app: si vede un avviso di troppo, o di
/// meno, tre settimane dopo.
///
/// **L'eco si consuma anche quando non c'è niente da dire**, ed è la riga che
/// prima non c'era. Il `muto` di un buffer pulito tornava senza toccare il
/// conto: ogni salvataggio finito mentre l'utente aveva già smesso di battere —
/// cioè quasi tutti, perché l'autosave parte 400 ms dopo l'ultima battuta —
/// lasciava il suo eco appeso, e ogni eco appeso si mangia **il prossimo cambio
/// vero**. Bastava tornare a battere e una riscrittura del kernel o di un
/// plugin veniva scambiata per la nostra: l'avviso che doveva comparire non
/// compariva. Il commento su `Buffer.echi` dichiarava già la regola giusta — «il
/// primo evento non-watcher su quel documento lo consuma» — ed era il codice a
/// non applicarla.
///
/// `daFuori` risponde **prima** del contatore e non lo tocca mai, ed è
/// l'invariante che resta intero: un watcher non è mai un eco nostro, quindi il
/// caso grave — il lavoro di un'altra applicazione che stiamo per coprire — non
/// si può zittire, e un evento non nostro non può consumare l'attesa di una
/// nostra scrittura.
export function consumaCambioSotto(
  buf: { dirty: boolean; echi: number } | undefined,
  daFuori: boolean,
): CambioSotto {
  if (!buf) return "muto";
  if (daFuori) return buf.dirty ? "altra_app" : "muto";
  const nostro = buf.echi > 0;
  if (nostro) buf.echi -= 1;
  if (!buf.dirty) return "muto";
  return nostro ? "eco" : "riscrittura";
}

/// Scrive **contando l'eco**, e possiede tutta la nascita di quel conto: lo
/// mette prima di partire e se lo riprende se il kernel rifiuta.
///
/// L'eco si annuncia **prima** della scrittura, e non è un dettaglio d'ordine:
/// l'evento che quell'eco descrive lo emette il kernel *dentro* la scrittura,
/// cioè prima che la promise risolva. Contarlo dopo vuol dire che l'evento
/// arriva quando il contatore è ancora a zero, `cambioSotto` non trova niente
/// da consumare e risponde `riscrittura` — «il file è cambiato sotto di te»
/// detto di una scrittura nostra, che è esattamente l'avviso a vuoto per cui
/// `cambioSotto` esiste. Il difetto era nella riga giusta al posto sbagliato.
///
/// E la scrittura che fallisce toglie il suo: se il kernel ha rifiutato — disco
/// pieno, conflitto — non ha scritto niente, quindi nessun evento arriverà mai
/// a consumare quell'eco. Lasciarlo appeso è il difetto **simmetrico e
/// peggiore**: il prossimo cambio vero, quello di un kernel o di un plugin,
/// verrebbe scambiato per l'eco di una scrittura che non c'è stata, e l'avviso
/// che doveva comparire non comparirebbe.
///
/// Le due metà stanno qui, in un `try/catch` solo, invece che nei rami di chi
/// salva: i rami di fallimento di `saveDoc` sono due oggi e chi ne aggiungesse
/// un terzo — o un secondo chiamante di `writeDocument` — non deve doversi
/// ricordare di sottrarre. Un ramo dimenticato non si vede provando l'app.
///
/// E l'altra metà — quella che toglie l'eco quando l'evento **arriva** — è
/// `consumaCambioSotto` qui sopra: il conto vive tutto in questo file, e fuori
/// di qui le righe che lo muovono sono **zero** [conta: echi-fuori-dal-padrone].
/// Non è una promessa di stile: è la sola cosa che rende vero il paragrafo
/// precedente, perché un padrone che possiede metà di un conto non ne possiede
/// nessuna.
export async function scriviContandoEco<T>(
  buf: { echi: number },
  scrivi: () => Promise<T>,
): Promise<T> {
  buf.echi += 1;
  try {
    return await scrivi();
  } catch (e) {
    buf.echi -= 1;
    throw e;
  }
}
