# 0154 — La prima fotografia è copy-on-first-write

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: §25.3 (seguito della 0141)
**Commit**: *(questo commit)*

---

## La domanda

La [0141](0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md) ha
spostato la prima fotografia fuori dalla fase 1, e la chiama il runner, una
volta per apertura, prima della prima fetta. La finestra resta zero — la
fotografia precede qualunque scrittura dell'utente — ma il prezzo è una
**passata sull'intero vault** a ogni apertura: 1839 ms a freddo su 30 000 note
(banco `apertura_30k`, 4 core), più la fetta che la segue. La domanda di questo
verbale è se la passata sia il prezzo giusto per la garanzia, o se la garanzia
si possa avere **senza la passata**.

## La premessa, rimisurata

- **La passata fotografa anche chi non ne ha bisogno.** Su un vault di 30 000
  note, la prima apertura fotografa 30 000 originali; ma la garanzia che la
  0141 comprava è per **una** nota: quella che l'utente modificherà per prima.
  Tutte le altre fotografie sono lavoro che nessuno userà mai — e a ogni
  riapertura il vault è già versionato, quindi la passata non fotografa più
  niente e costa comunque la scansione.
- **Il momento in cui l'originale è a rischio è la prima sovrascrittura, non
  l'apertura.** La finestra che la 0141 chiudeva è «una modifica cancella per
  sempre lo stato in cui l'utente ha trovato la nota». Quel danno avviene
  **dentro** la scrittura: fra il parse e il disco, l'originale è ancora
  leggibile, e un istante dopo non lo è più. È lì che la fotografia deve
  stare — non prima, quando la nota non è ancora in pericolo.
- **Il kernel ha già il punto di applicazione.** `write_source` è il corpo di
  ogni scrittura — salvataggio, modifica chirurgica, ripristino dal cestino —
  e ha già l'ordine giusto: parse puro, poi disco. Fra i due c'è l'istante in
  cui l'originale è ancora leggibile, sotto il prestito esclusivo del
  workspace, con un `HostApi` che può leggerlo e scrivere lo snapshot.

## La decisione

**La prima fotografia diventa copy-on-first-write: un gancio generico sul
workspace, chiamato fra il parse e il disco, che fotografa la nota un istante
prima della sua prima sovrascrittura.** La passata all'apertura sparisce; la
fotografia a freddo va da 1839 ms a ~0.

Il gancio è **generico** — un id di plugin e una chiusura
`Fn(&mut dyn HostApi, &DocId) -> Result<(), PluginError>`, `Option`, default
`None` — perché il kernel non sa cosa sia una fotografia: sa solo che c'è un
istante in cui il contenuto che sta per sparire è ancora leggibile, e che
qualcuno può volerlo guardare. Il montaggio del versioning registra la
chiusura: se la nota ha già una storia non si fa niente (e non si paga nemmeno
una lettura); se non esiste — la scrittura è una creazione — non si fa niente,
e la prima versione sarà quella del testo nuovo, che l'evento `DocumentChanged`
fotografa da solo; altrimenti si fotografa **adesso**, e un errore ferma la
scrittura — sovrascrivere senza fotografia sarebbe la finestra che questo
meccanismo esiste per chiudere.

**La garanzia della 0141 resta, e la finestra resta zero.** La fotografia
precede ancora qualunque scrittura dell'utente: non perché la passata l'ha
scattata prima, ma perché la scrittura stessa la scatta prima di sovrascrivere.
Il *quando* è cambiato di un'unità osservabile — la nota mai toccata non ha
snapshot, e non ne ha bisogno: il file **è** l'originale — e il *chi* è
cambiato di nuovo: non più una chiusura nel runner, ma un gancio nel kernel.

**Il prezzo è dichiarato, ed è più piccolo di quello della 0141.** Una nota mai
toccata non ha snapshot: se l'utente la modifica, la fotografia scatta in
quell'istante, e la storia ha due voci — quella di prima e quella di adesso —
come con la passata. Un crash fra il COW fsyncato e la sovrascrittura è lo
stesso di oggi: o c'è o non c'è, e la finestra non è più larga di quella che la
0141 aveva già accettato. Ciò che si perde è la fotografia di note che nessuno
ha mai toccato — che non è un dato perso, è un dato mai esistito.

**Non è la forma (b) della 0141.** La (b) differiva la passata, aprendo una
finestra lunga quanto l'indicizzazione: chi scriveva subito perdeva lo stato
iniziale della nota. Qui la passata **non esiste più**: non c'è un momento in
cui la nota è senza protezione, perché la protezione è la scrittura stessa.

## Cosa resta

- **`first_snapshot_of_the_vault` resta come unità riusabile** — i test la
  chiamano a mano per avere lo stato che il gancio produce da solo, e la
  riconciliazione dopo un `Overflow` la riusa per chi non ha ancora una storia.
  Non la chiama più nessuno all'apertura.
- **Rename e trash non fotografano** (come prima): il file si sposta, il
  contenuto c'è, e la storia segue la nota con l'evento `DocumentRenamed`.
- **Le bozze non passano dal gancio** (0096): `Drafts::save` scrive sul
  `VaultStorage`, non su `write_source`.
- **La riconciliazione dopo un `Overflow` resta una passata** (`sweep(Tutti)`):
  è il caso in cui la passata è il prezzo giusto, perché gli eventi persi non
  si ricostruiscono da niente.
