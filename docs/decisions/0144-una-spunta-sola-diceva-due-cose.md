# 0144 — Una spunta sola diceva due cose

**Stato**: accolta **Data**: 2026-08-11 **Chiude**: §26.6 **Commit**: *(questo
commit)*

---

La §26.6 chiedeva se «può leggere e scrivere gli appunti di sistema» sia **una**
domanda o **due**. La risposta è la **forma (a)** che la voce stessa
raccomandava: sono due, e il nome si spacca adesso.

## La decisione

**`fub:clipboard` non esiste più. Al suo posto ci sono `fub:read-clipboard` e
`fub:write-clipboard`**, in quest'ordine, al posto in cui stava il nome unico —
quarto e quinto di `permission::ALL`, che passa da tredici a quattordici.

La ragione è la stessa della
[0095](0095-cosa-guardo-e-cosa-sto-scrivendo.md), applicata al posto in cui il
repo non l'aveva ancora applicata: **una spunta deve corrispondere a una frase
che qualcuno possa voler dire**. La frase che il nome unico rendeva
inesprimibile è *«questo plugin può mettere un link negli appunti, non leggere
ciò che ci ho copiato dentro»* — ed è la frase che l'utente vuole dire quasi
sempre, perché la metà innocua è quella che un plugin chiede davvero («copia il
link di questa nota») e la metà pericolosa è quella che gli arrivava in
omaggio.

E la metà pericolosa è pericolosa in un modo che si misura, non che si teme: la
lettura degli appunti è **la sola superficie di questo elenco che non abbia
nessun campo da filtrare**. Chi legge il vault legge un documento che ha
nominato, e il parametro del permesso può restringerlo a un prefisso; chi legge
la selezione riceve almeno un `ViewContext.doc` da confrontare con una
allowlist. Il contenuto degli appunti è ciò che l'utente ha copiato **da
un'altra applicazione**: la password appena presa dal gestore di password,
l'IBAN, il token di accesso. Il solo recinto costruibile è il sì/no, e per
questo il sì/no deve essere **suo** e non condiviso con la scrittura.

## Che cosa questa decisione NON rimette in discussione

Che `fub:clipboard` esistesse **senza capacità** è già deciso, due volte: la
[0098](0098-un-permesso-si-vede-e-si-nega.md) (`:268-272`) ha scelto di non
presidiare il verso opposto della corrispondenza permesso↔famiglia, e la
[0021](0021-il-confine.md) (`:209`) l'aveva scritto prima. Nulla di quello
cambia: i nomi senza famiglia adesso sono **cinque** invece di quattro, e
restano per la stessa ragione di prima — toglierli vorrebbe dire scoprire il
giorno della prima capacità che il nome era libero.

Ciò che questo verbale aggiunge accanto a quella prosa, nei due punti in cui è
scritta (`options.rs`, `guard.rs`), è la mezza riga che le mancava: **un nome
tenuto senza famiglia va tenuto della grana giusta**. Tenerlo non basta, perché
la grana si corregge gratis solo finché nessun manifest l'ha scritto.

## Cosa si è scartato, e chi avrebbe pagato

- **(b) Un nome solo adesso, e si spacca il giorno della capacità.** Paga chi
  avrà scritto un manifest nel frattempo, e paga il rischio della 0095 al
  contrario: spaccare un permesso che qualcuno ha **già ottenuto** vuol dire
  togliergli qualcosa che aveva, cioè o rompergli il componente o concedergli in
  silenzio la metà che non aveva chiesto. Oggi il prezzo della (a) è zero
  manifest da migrare; domani non è più zero, e non torna a esserlo mai.
- **(c) Non spaccare mai, appoggiando la lettura a un altro cancello.** È la
  strada che la 0095 ha esaminato e scartato per `read-vault`, con l'argomento
  che vale identico qui: *«un permesso riusato è economico finché la sua grana è
  quella giusta; quando non lo è, il riuso non è parsimonia, è una decisione
  presa di nascosto»*. E qui non c'è nemmeno un cancello a cui appoggiarsi.
- **(d) La capacità vera adesso** — `interface host-clipboard` nel WIT con
  `read`/`write`. Paga chi mantiene il contratto, e **questa sì scadrebbe col
  freeze**, perché un'interfaccia nuova non è additiva. Resta fuori per la
  ragione della [0013](0013-elenco-delle-capacita.md): *«una capacità concessa a
  nessuno è superficie da mantenere e sandboxare per sempre»*. Le due cose sono
  indipendenti nel verso che conta: si può avere il nome giusto oggi e la
  capacità fra un anno; il contrario no.

## Perché adesso e non dopo il freeze

Un permesso è una stringa dell'`OptionMap` del manifest, non una firma: nessun
WIT è toccato, e la 0095 ha fatto questa mossa esatta scrivendo *«Nessuna firma
cambia. Non c'è ritaglio del congelato»*. La scadenza di questa voce non è il
freeze ed è **più vicina**: la finestra a costo zero si chiude col **primo
manifest** che scriva `fub:clipboard`, e i manifest cominciano a esistere con
M3.

## Il prezzo pagato, per intero

Sei posti, tutti quelli che la voce aveva misurato e nessuno in più:

- `crates/fub-abi/src/options.rs` — `CLIPBOARD` diventa `READ_CLIPBOARD` e
  `WRITE_CLIPBOARD`, `ALL` da `[&str; 13]` a `[&str; 14]`;
- `frontend/src/ui/permessi.ts` — `PERMESSI` e `FRASI`; la seconda è obbligata
  dal compilatore, perché `Record<Permesso, Chiave>` è esaustivo;
- `frontend/src/i18n/strings.ts` — due chiavi al posto di una, per due lingue;
- il conto `permessi-dichiarabili` in `glossario.md` e in `options.rs:433`, più
  la sua ripetizione in `architecture/mappa-visuale.md`, da **tredici** a
  **quattordici**;
- `docs/roadmap/strozzature.md`, dove i permessi senza capacità erano quattro e
  sono cinque;
- il commento di `guard.rs` accanto a `ogni_permesso_di_una_famiglia_e_nominato`,
  che è la copia in casa della prosa di `options.rs`.

**Zero manifest migrati**: nessuno lo dichiarava. **Zero WIT**: `grep -c
clipboard` su `abi.wit` e su `wit/frozen/0.1.0.wit` dava zero prima e dà zero
adesso.

## Chi se ne accorge se regredisce

`i_permessi_sono_gli_stessi_di_qua_e_di_la`
(`crates/fub-host/tests/interruttori.rs`) si è aggiornato da sé, perché legge i
due elenchi invece di conoscerli: verificato rosso togliendo
`"fub:write-clipboard"` da `PERMESSI` — *«la shell e il contratto non hanno lo
stesso elenco di permessi»*. Il conto `permessi-dichiarabili` prende il terzo
lato, la prosa, che nessun compilatore vede.

## Cosa resta scoperto

**Una casella, e sono i diciassette gesti del corpus.** I gesti di appunti sono
diciassette in sette degli otto file del corpus, e oggi devono essere tutti
core: la shell sa fare `navigator.clipboard.writeText` in un punto solo
(`frontend/src/ui/intents.ts:72`), raggiunto da un `if` su un `ns` letterale.
Questa decisione non li sposta e non pretende di spostarli — dà il **nome
giusto** al recinto che li recinterà. La casella è: *quando nasce la capacità
degli appunti, sono due famiglie e non una, e la lettura non ha parametro.*

**E resta un buco dichiarato, che era già dichiarato**: `fub:read-clipboard` e
`fub:write-clipboard` non governano niente, come i tre nomi senza famiglia
accanto a loro. Un utente che li nega oggi non nega niente, perché non c'è
ancora niente da negare — ed è esattamente la situazione che la 0098 ha scelto
di lasciare in piedi.

## La premessa che ha retto

Rimisurata contro i sorgenti di oggi, la premessa della voce era vera in ogni
sua parte: `permission::CLIPBOARD` esisteva con quel nome, la frase *«Può
leggere e scrivere gli appunti di sistema»* era davanti all'utente in due
lingue, nessuna capacità lo consumava, il contratto non lo nominava, e nessuno
dei cinque verbali che nominano gli appunti aveva mai posto la domanda della
grana. L'unica cosa che la voce non diceva, e che si vede solo aprendo il file,
è che la seconda tabella della shell è **obbligata dal compilatore**: `FRASI` è
un `Record<Permesso, Chiave>` esaustivo, quindi il prezzo della shell non si
poteva pagare a metà nemmeno volendo.
