# 0127 — La mutazione è il prodotto della scrittura, non il suo presupposto

**Stato**: accolta
**Data**: 2026-08-06
**Estende**: la [0119](0119-il-piano-si-fa-in-lettura-e-si-applica-in-scrittura.md)
allo stato **persistito** di una feature, e chiude una premessa che il difetto
di partenza dichiarava e non aveva verificato
**Commit**: *(questo commit)*

---

## La domanda

Il difetto misurato diceva questo, parola per parola:

> nel dedup di `snapshot`, la nota che risorge fa `doc.deleted_at.take()`
> **prima** di `write_meta`: se la scrittura fallisce è viva in memoria e
> cestinata sul disco. Qui l'inversione non è possibile — costa un ripristino
> del campo.

La prima metà è vera. La seconda è una premessa, ed è quella che questo verbale
è servito a verificare: *l'inversione è davvero impossibile?*

## L'inversione era possibile, e la premessa sembrava vera per una ragione sola

`Inner::write_meta` aveva questa firma:

```rust
fn write_meta(&self, id: &DocId, host: &mut dyn HostApi) -> Result<(), PluginError>
```

Legge `self.docs[id].deleted_at` e lo serializza. Quindi sì: per scriverla
bisognava averla già mutata. `write_index` faceva lo stesso, un passo più
grande — serializza `self.docs` **intera**. È da qui che nasce «l'inversione
non è possibile»: guardando le due firme è letteralmente vero che la scrittura
prende lo stato mutato.

Ma la firma non è un vincolo, è una scelta, e sotto ce n'era una che nessuno
aveva contato: **`write_index` già faceva `self.docs.clone()`**. Serializzare
la mappa che i documenti *avranno* invece di quella che hanno costa esattamente
lo stesso — una clonazione, la stessa di prima. La premessa era vera della
firma e falsa del problema.

Che è la forma già scritta due volte in questo file, e nessuno l'aveva letta
come una regola: `prune` **non cancellava** i blob, li *restituiva*, e `spazza`
li toglieva solo dopo che l'indice era sul disco. Lì la conclusione era già
quella giusta — si decide in memoria, si rende vero sul disco, e solo un disco
d'accordo autorizza il passo dopo. Il tombstone era rimasto fuori da quella
disciplina perché il campo è uno e sembrava troppo piccolo per meritarla.

## Cosa vede l'utente, prima

Ripristina una nota dal cestino. La vede tornare. Chiude l'app, riapre, la nota
è di nuovo cestinata. Nessuno dice perché.

E c'è un dettaglio che rende questo caso peggiore degli altri della stessa
famiglia: `.take()` **consuma**. Fallita la scrittura, la stessa identica
chiamata ripetuta trova `deleted_at` già a `None`, decide che non c'è niente da
risuscitare e non riprova nemmeno. La riparazione non arriva al salvataggio
successivo: arriva solo quando il contenuto della nota cambia davvero. Una nota
ripristinata con lo stesso testo che aveva resta morta nella storia per sempre.

## La decisione

`Inner::docs` cambia in **un posto solo**:

```rust
fn applica(
    &mut self,
    piano: BTreeMap<String, DocVersions>,
    meta_di: &DocId,
    host: &mut dyn HostApi,
) -> Result<(), PluginError> {
    if let Some(doc) = piano.get(meta_di.as_str()) {
        scrivi_meta(meta_di, doc, host)?;
    }
    scrivi_index(&piano, host)?;
    self.docs = piano;
    Ok(())
}
```

Chi vuole cambiare qualcosa costruisce il **piano** — la mappa che i documenti
avranno — e lo consegna. Se il disco dice di no, l'anagrafe in memoria non si è
mossa di un millimetro, e non c'è nessun ramo d'errore da ricordarsi di
scrivere: chi domani aggiunge un campo a `DocVersions` eredita l'ordine giusto
senza sapere che esiste. È la differenza fra riparare il difetto e togliere di
mezzo la forma che lo produce — la prova del secondo chiamante, che qui sono
quattro.

Perché non un ripristino nel ramo d'errore, cioè la strada che il difetto
proponeva: perché il ripristino è un elenco di campi, e un elenco di campi si
dimentica. La forma gemella della shell — `scriviContandoEco` in
`frontend/src/state/salvataggio.ts` — possiede il ripristino in una funzione
sola per la stessa ragione, ma là il fallimento *deve* poter restituire qualcosa
di parziale. Qui non deve: la scrittura o è andata o non è andata, e allora non
serve restituire niente — basta non essersi mossi.

Il `meta.json` va **prima** dell'indice, e non è un dettaglio. L'autorità è
l'indice: `VersionStore::open` ricostruisce dai `meta.json` solo quando
`versions.json` manca o è illeggibile. Se il meta passa e l'indice no, per chi
legge il disco non è cambiato niente, e la memoria nemmeno: concordano.
L'ordine inverso lascerebbe l'autorità avanti e la memoria indietro — cioè
esattamente il difetto, spostato di una riga.

Insieme al tombstone sono passate al piano anche le altre mutazioni dello
stesso file: `prune` diventa la funzione libera `pota`, che assottiglia
l'elenco **del piano**; e `ensure_dir` diventa `dir_per`, che il nome della
cartella lo *trova* senza installarlo. Prenotare la cartella in memoria voleva
dire lasciare, dopo un primo salvataggio fallito, un documento che il disco non
ha mai visto e che `documents()` elencava.

## Il conto: sei contro una

Il difetto ne dichiarava **una**. Cercando la forma — uno stato vivo mutato, e
solo dopo una scrittura che può fallire col `?` — in `fub-features` e
`fub-kernel` ne sono venute fuori **sei**, cinque delle quali in questo stesso
file:

1. `snapshot`, ramo del dedup: il `.take()` del tombstone — quella dichiarata,
   e la peggiore per irreparabilità, non per gravità.
2. `snapshot`, ramo normale: `versions.push` e `deleted_at = None` prima delle
   due scritture. Il blob è già sul disco e l'indice non lo nomina: al riavvio
   la versione appena salvata sparisce dalla storia.
3. `rename`: `docs.remove(from)` + `docs.insert(to)` prima delle scritture. In
   memoria la storia è sotto il nome nuovo, sul disco sotto il vecchio; al
   riavvio è appesa a un path che non esiste più, cioè invisibile.
4. `tombstone`: `deleted_at = Some(now)` prima delle scritture. E peggiora da
   sé, perché la riconciliazione dopo un `Overflow` salta i documenti per cui
   `is_deleted` è vero — e `is_deleted` legge la memoria. Entro la sessione il
   tombstone non viene mai ritentato.
5. `ensure_dir`: la cartella prenotata in memoria prima del blob.
6. Fuori dal versioning: `EntryStore::store` in `crates/fub-kernel/src/entries.rs`
   assegna `self.known` prima di scrivere il file. Resta com'è — è una cache
   derivata, l'errore non risale col `?` ma viene loggato dal chiamante, e alla
   riapertura si rilegge il file vecchio e al massimo si riscansiona il vault.
   È la stessa forma con una posta diversa, ed è dichiarata qui perché la
   prossima volta non vada ricontata.

Le prime cinque sono chiuse tutte insieme, perché `applica` non lascia scelta.

Il resto del codebase applica già la forma giusta e lo dice: `settings.rs`
(«su disco prima, in memoria dopo»), `viewstate.rs` (`update_atomic`),
`organization.rs` (`store(&next)?` e poi `*data = next`), `search.rs`
(`persist` scrive e *poi* segna `manifest_at`). La regola c'era; il versioning
era il crate che non l'aveva ereditata.

## Le premesse cadute

- **«Qui l'inversione non è possibile»** — falsa, e sembrava vera perché
  `write_meta` e `write_index` leggevano da `self`. Il costo temuto era una
  clonazione della mappa; la clonazione c'era già dentro `write_index`.
- **«Costa un ripristino del campo»** — falsa nel senso che conta: costa **zero**
  ripristini, perché non c'è niente da ripristinare se non ci si è mossi.
- **Il commento sopra `prune`** diceva: *«se `write_index` fallisce si esce di
  qui con tutti i contenuti al loro posto e un indice vecchio che li nomina
  tutti: si perde la potatura, non una versione»*. Regge a metà. È corretto
  sulla direzione dell'errore — mai un indice che nomina blob spariti, ed è
  quello che il suo banco verificava — ma «non una versione» era falso in due
  sensi: la versione appena scritta *non* è nell'indice vecchio, e in memoria
  `prune` aveva già tolto le potate, quindi la copia che l'app mostrava era più
  povera del disco. Il commento argomentava la potatura e taceva sulle due
  righe sopra di sé. **Un commento che argomenta bene una riga può coprire
  quella accanto**: è la seconda volta in due giri.
- **Il difetto peggiore stava dentro la voce**, per una volta — ma non era
  quello descritto: il `.take()` che rende la ritentata cieca è più grave del
  disallineamento che la frase nominava, e il `rename` (caso 3) perde una
  storia intera dove il dedup perdeva un campo.

## Chi glielo dice, all'utente

Niente di nuovo, ed è la risposta giusta: il canale c'era già. `snapshot` e
`tombstone` rendono un `Result`, il versioning gira dentro un handler, e
`deliver_to_handlers` raccoglie l'esito di ogni handler e lo emette come guasto
a nome suo ([0052](0052-cio-che-va-storto-e-un-evento.md)). Uno snapshot che
non si scrive **si vede già**. Ciò che mancava non era il messaggio: era che il
messaggio dicesse la verità. Prima l'utente riceveva l'avviso *e* vedeva la
nota tornare viva, e delle due si fidava di quella che vedeva.

Nessun esito parziale da raccontare con due conti nel senso della
[0101](0101-una-voce-non-e-un-passo.md): qui l'operazione o è
avvenuta o non è avvenuta, e adesso lo è davvero.

## I banchi, e il rosso

Quattro banchi nuovi in `crates/fub-features/src/versioning.rs`, tutti sul
ramo d'errore vero — `MemoryHost::nega_scrittura` fa dire di no al disco a metà
partita, senza permessi POSIX e senza filesystem in sola lettura.

- `a_resurrection_the_disk_refuses_leaves_the_note_dead_in_memory_too` gira
  **due volte**, una negando il `meta.json` della cartella e una negando
  l'indice, perché a fallire può essere l'una o l'altra scrittura e la garanzia
  deve valere per tutte e due.
- `a_tombstone_the_disk_refuses_leaves_the_note_alive_in_memory_too` è la prova
  del secondo chiamante: `tombstone` non ha una riga sua di riparazione, eredita.
- `a_snapshot_the_disk_refuses_does_not_invent_a_document` chiude `dir_per`.
- `a_resurrection_the_disk_accepts_is_alive_in_memory_and_on_disk` è l'altro
  verso: un presidio che guarda solo il ramo d'errore è cieco a una riparazione
  che rompe il caso normale.

**Rosso verificato uno per uno**, rimettendo il vecchio ordine dentro
`applica` (installa in memoria, poi scrivi): i primi tre falliscono, ognuno col
suo messaggio — *«la memoria è andata avanti da sola: mostra viva una nota che
al riavvio è di nuovo cestinata»*, *«la memoria l'ha già sepolta e il disco no:
il cestino si svuota al riavvio»*, *«l'anagrafe nomina un documento che sul
disco non esiste»* — e il quarto resta verde, com'è giusto. Il verso opposto
provato a parte, con un `applica` che installa in memoria e non scrive mai.

E lì il quarto banco **è passato a vuoto**, che è la classe di difetto che
questo repo ha già incontrato più di dodici volte. La ragione: uno store
riaperto su un disco vuoto risponde «non cancellata» anche di una nota che non
conosce, perché `is_deleted` è falso sia per una nota viva sia per una nota che
non c'è. Il banco chiedeva la cosa sbagliata. Riparato chiedendo **prima** che
il documento riaperto abbia la sua versione, e solo dopo che non sia cestinato:
*una domanda su un campo non vuol dire niente se nessuno ha verificato che il
record esista*.

Zero firme di contratto toccate, WIT intatto, nessuna dipendenza nuova.

## Cosa resta fuori

- `EntryStore::store` (caso 6), per la ragione scritta sopra.
- `pota` muta ancora il piano e non lo stato vivo, ma il *suo* fallimento
  possibile — `spazza` che non riesce a togliere un blob — resta silenzioso di
  proposito: la direzione innocua dell'errore è il blob orfano, e quella regola
  non cambia.
- La finestra fra `scrivi_meta` riuscita e `scrivi_index` fallita lascia sul
  disco un `meta.json` che dice «viva» sotto un indice che dice «cestinata».
  Non morde finché l'indice c'è — è lui l'autorità — ma se l'indice andasse
  perduto, la ricostruzione dai meta risusciterebbe quella nota. È il costo di
  due scritture senza una transazione, ed è dichiarato qui perché la prossima
  volta non sembri una scoperta.
