# 0046 — L'anagrafe del vault: cosa c'è, cosa ne so, e cosa non devo rileggere

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §14.1 + §14.2 (seduta 14) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/14-entry-cartelle-lista.md)

---

Il piano diceva che §14.1 e §14.2 sono **lo stesso lavoro visto da due lati**, e
lo diceva in una riga: «è il `VaultEntry` del §14.1 esteso ai *documenti*, non
solo agli asset». Farle separate avrebbe voluto dire aggiungere due volte gli
stessi campi alla stessa scansione. Questo verbale le chiude insieme, e le altre
due voci della seduta — la cartella come cittadino (§14.3) e il canale
per-cartella della lista (§14.4) — restano aperte: sono l'altra coppia, e questa
non le decide.

Il difetto era una cosa sola detta in due modi:

> **Il vault vede solo i documenti, e di quelli non si ricorda niente.**

Un PNG nel vault non esisteva: nessuna query lo nominava, nessun evento lo
annunciava, e il controllo di salute — che pure sa dire quando un wikilink non
risolve — su `![[foto.png]]` **taceva**, perché non aveva modo di sapere se quel
file ci fosse. Dall'altro lato, `reindex` rileggeva e riparsava l'intero vault a
ogni apertura, e lo faceva **prima** di chiedere agli indici se gli
interessasse: «un indice persistente riconosce e salta gli immutati» era vero
per l'indice e falso per il kernel, che pagava comunque lettura e parse di
tutto.

## La decisione: una tabella, e la domanda che le dà senso

`VaultEntry { id, kind, size, mtime, fingerprint }` per **ogni** file del vault,
e una scansione che li vede tutti — non solo le estensioni dei provider
registrati.

```rust
pub struct VaultEntry {
    pub id: DocId,                       // il path, come ogni altra chiave (0043)
    pub kind: EntryKind,                 // Document | Asset | Unknown
    pub size: u64,
    pub mtime: u64,                      // millisecondi UNIX
    pub fingerprint: Option<Revision>,   // se qualcuno ne ha già avuto i byte
}
```

Si chiede da `IndexQuery::Entries { of_kind, page }`, e la firma che la rende
utile è nel trait degli indici:

```rust
fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> { Vec::new() }
```

È **la domanda che mancava**. Il default vuoto vuol dire «mandami tutto», cioè
il comportamento di prima: chi non la implementa non si accorge che esiste.

## Le decisioni prese, da NON ridiscutere senza motivo

### La specie non si persiste, perché non è una proprietà del file

`EntryKind` è una proprietà del file **dato chi è registrato adesso**. Un
`.canvas` è `Unknown` oggi e `Document` il giorno che qualcuno rivendica
quell'estensione, senza che un byte sia cambiato. Una specie scritta su disco
sopravviverebbe alla registrazione del provider e direbbe la cosa sbagliata per
sempre; ricalcolarla costa il confronto di un'estensione, e la regola sta in
[`rules::media::kind_of`](../../crates/fub-abi/src/rules/media.rs) perché chi
indicizza, chi disegna e a M5 un guest WASM devono dividere allo stesso modo.

`Unknown` non è un errore ed è **metà del valore** dell'anagrafe: un file che
nessuno riconosce esiste lo stesso — occupa spazio, si cancella per sbaglio, e
un backup che lo saltasse lo perderebbe in silenzio.

### Il MIME è una regola, non un campo

`mime_of` è funzione pura del nome. Metterlo in `VaultEntry` sarebbe stato
scriverne una copia per ogni file di ogni vault, e la copia sarebbe invecchiata
alla prima riga aggiunta alla tabella. Il limite è dichiarato: un `.png` che
dentro è un JPEG risponde `image/png`, e chi ha bisogno della verità dei byte la
legge dai byte.

### `list_documents` continua a restituire solo documenti

L'anagrafe è una domanda **in più**, non una risposta diversa alla domanda di
prima. Cambiare `list_documents` avrebbe fatto comparire dei PNG in ogni elenco
che oggi si aspetta note — e sarebbe stata una rottura travestita da estensione.

E deve esistere come domanda **per la stessa ragione per cui la
[0013](0013-elenco-delle-capacita.md) tenne `create_folder` fuori
dall'`HostApi`**: una capacità che produce stato che nessuna query vede, nessun
evento annuncia e nessuno può interrogare non è una capacità, è un buco. Il
`VaultEntry` senza `IndexQuery::Entries` sarebbe stato esattamente quello.

### `mtime + size` basta a **saltare**, non a **credere**

È il criterio di git, di rsync e di make, e sbaglia in due versi che non costano
uguale: un falso «cambiato» costa una rilettura, un falso «immutato» costa un
indice fermo su un documento vecchio — cioè una bugia silenziosa.

Il caso in cui il secondo capita davvero è la scrittura che avviene **nello
stesso istante** in cui si scrive la tabella. Da lì la regola che git chiama
*racily clean*: la tabella ricorda **quando è stata scritta**, e ciò che ha una
data maggiore o uguale a quella non si crede mai. Costa la rilettura dei pochi
file toccati nell'ultimo millisecondo della scansione.

### L'impronta si calcola **dove i byte sono già in mano**

Mai aprendo un file apposta. Il kernel la calcola sui documenti che deve
comunque leggere per parsarli; per gli allegati **nessuno la calcola in questo
giro**, perché leggere ogni byte di ogni PNG all'apertura è esattamente il costo
che l'anagrafe esiste per togliere. Chi la vorrà — dedup (13.1), duplicati
(3.2), integrità (24.2) — la farà calcolare da un job, che è il posto del lavoro
lungo ([0032](0032-il-runner-dei-job.md)).

`None` non vuol dire «file vuoto» e non vuol dire «mai letto»: vuol dire che
nessuno ha ancora pagato la lettura dei suoi byte. Ed è la stessa
[`Revision`](../../crates/fub-abi/src/edit.rs) di `document_revision`: un
secondo tipo opaco accanto a quello sarebbe stato due nomi per la stessa idea.

Il guadagno vero non è saltare i file con la data uguale — quello lo sapeva fare
anche `stat`. È che dopo un `git checkout` che ha ritimbrato mille file senza
cambiarne uno, la data non combacia ma il contenuto sì: il kernel li rilegge
tutti e mille, e **nessuno li riparsa**, perché l'impronta li riconosce.

### Un allegato che cambia emette i **suoi** eventi

`EntryChanged` / `EntryRemoved` / `EntryRenamed`, con la specie dentro e mai
`Document`. Non sono tre casi in più di `DocumentChanged`, e la ragione è
retroattiva: chi ascolta `DocumentChanged` è codice scritto quando un documento
era l'unica cosa che il vault contenesse, e consegnargli un PNG lo farebbe
leggere un modello che non esiste. Sarebbe una bugia per ogni handler già
scritto, compresi quelli di terzi a M5.

Sono **recuperabili** ([0033](0033-la-grana-di-un-abbonamento.md)): entrano in
`names()` e non in `touched()`, perché nominano un file ma non un documento
toccato.

### La tabella è un dato **derivato**, e la disciplina segue da lì

Vive in `.fub-data/entries.json`, che è la radice di ciò che si può buttare:
versione di schema dal primo giorno (§15.3), scrittura atomica, e **illeggibile
→ si butta e si ricostruisce**, senza un avviso e senza bloccare niente.

È l'opposto di [`organization`](../../crates/fub-kernel/src/organization.rs),
che davanti a un file che non ha potuto leggere si **rifiuta di
sovrascriverlo**: quello è autorevole — perso, non si ricostruisce da niente — e
questo no. Buttare questa tabella costa una riapertura lenta, cioè esattamente
il comportamento che c'era prima che esistesse.

La *classe* («derivato o autorevole») non è ancora dicibile nel contratto: è il
§15.4, che questa voce non chiude. Ciò che evita è di far nascere il posto nuovo
**indovinando per imitazione**: la classe è quella della radice in cui sta, ed è
scritta lì.

### Il cliente vero è il controllo di salute

Ora distingue **un allegato che c'è** da **uno che manca**: prima taceva su
tutti, perché era l'unica cosa onesta che potesse fare — un allegato nel kernel
non esisteva. `![[foto.png]]` non risulta più rotto se la foto c'è, e risulta
rotto se non c'è.

Il risolutore che il modulo delle regole riceve è ora una `VaultView`: il grafo
**e** l'anagrafe. Sono due cose e non una perché rispondono a due domande
diverse — dove arriva un link fra note lo sa il grafo, se il PNG che una nota
mostra esiste lo sa l'anagrafe.

Il cliente **visibile** è l'albero della shell, che si alimenta da
`IndexQuery::Entries` invece che da `list_documents`: era l'ultimo dato che la
shell chiedeva fuori da `IndexQuery` (§14.4), cioè l'unico che un provider non
avrebbe saputo chiedere. Un giro solo, e la specie la sceglie la domanda.

### Il cliente della firma nuova è la ricerca

`SearchIndex` tiene nel proprio manifest una seconda mappa: `DocId` → revisione
del **sorgente** da cui è stato ricavato ciò che sta nell'indice. Non è una
ridondanza rispetto alle impronte che già teneva: quelle sono impronte del
*modello* — id, testo, tag — e servono a non riscrivere in tantivy ciò che è
identico *dopo* il parse; questa è l'impronta dei **byte**, e serve a non
arrivare al parse. Fra le due c'è un parser, e non si deriva l'una dall'altra.

Vive dentro lo stesso manifest, quindi eredita lo stesso guardiano: opstamp e
versione di schema. Se il manifest è di un'altra epoca non se ne crede nessuna
parte — dire «ce l'ho» a sproposito farebbe *saltare* un documento.

Come la impara è la parte che non si indovina dal diff. `on_document_indexed`
riceve un **modello**, e da un modello la revisione del sorgente non si
ricalcola: l'unico posto in cui l'indice la vede è la domanda del kernel. Quindi
`up_to_date` **dichiara** le revisioni che sta per ricevere, e ogni consegna
**consuma** la propria. Con tre regole che tengono in piedi la cosa:

- non si dichiara ciò che si è appena detto di avere (quel documento non
  arriverà, e la dichiarazione lasciata lì la raccoglierebbe la prima consegna
  successiva — cioè il primo salvataggio a sessione aperta, che porta un testo
  nuovo);
- `reconcile` — che il kernel chiama a fine giro — **azzera** ciò che resta:
  quello è di un documento che non è arrivato;
- nessuna dichiarazione = nessuna promessa. La revisione si **dimentica**, e
  alla prossima apertura quel documento si rilegge.

Tutte e tre vanno nella stessa direzione: sbagliare verso la rilettura.

## Cosa si è scartato, e perché

- **Persistere la specie.** Vedi sopra: sopravviverebbe alla registrazione del
  provider che la smentisce.
- **Il MIME come campo di `VaultEntry`.** Una copia per file di una funzione
  pura del nome.
- **Calcolare l'impronta degli allegati alla scansione.** È il costo che
  l'anagrafe esiste per togliere. Chi la vuole la chiede a un job.
- **Far emettere `DocumentChanged` agli allegati.** Sarebbe stato meno codice e
  una bugia retroattiva per ogni handler già scritto.
- **Cambiare `list_documents` perché restituisse tutto.** Una rottura travestita
  da estensione.
- **`up_to_date` con `&mut self`.** Chiedere a un indice cosa ha già non lo
  cambia. La mappa delle dichiarazioni sta dietro un `Mutex` e non dietro la
  firma.
- **Un tipo opaco nuovo per l'impronta.** `Revision` è già l'identità di un
  contenuto, e due nomi per la stessa idea divergono.
- **Fidarsi di `mtime + size` da soli.** Bastano a saltare la lettura, non a
  saltare il parse: la regola *racily clean* e l'impronta sono le due cose che
  rendono il salto sicuro.
- **Far fallire l'apertura se la tabella non si scrive.** Chi non riesce a
  scrivere una cache ha comunque aperto il vault.

## Cosa resta scoperto (e dove è scritto)

- **Le altre due voci della seduta.** §14.3 (la cartella come cittadino, che
  sblocca `create_folder`) e §14.4 (il canale per-cartella e paginato della
  lista) restano aperte, e sono l'altra coppia. `IndexQuery::Entries` **pagina
  già** e non peggiora il §14.4 — la shell fa un giro solo dove prima ne faceva
  uno — ma non è ancora una lista per-cartella.
- **L'albero della shell mostra ancora i soli documenti.** Cosa succeda
  cliccando un allegato, e quindi se abbia senso disegnarlo lì, è del
  §14.3/§14.4. Qui è cambiato *da dove arriva* l'elenco, non cosa contiene.
- **Nessuno calcola l'impronta degli allegati.** Dedup, rilevamento duplicati e
  verifica d'integrità hanno adesso il campo in cui metterla e non il job che la
  riempie.
- **La politica della cartella allegati e le thumbnail** (§14.1, due caselle su
  quattro) restano: la prima è una chiave di impostazione da dichiarare
  ([0036](0036-le-impostazioni-e-i-tre-stati.md)), la seconda un derivato in
  `.fub-data/` da far nascere quando ci sarà chi lo disegna.
- **`.fub-data/entries.json` è il secondo file derivato che si scrive la propria
  disciplina a mano** (dopo il manifest della ricerca). Il §15.3 e il §15.4 sono
  esattamente questo, e questa voce li **nomina** senza chiuderli: la versione
  di schema c'è, la classe è scritta in prosa in testa al modulo, e finché la
  classe non è dicibile nel contratto ogni posto nuovo la ripete.
- **Il rename di un allegato è un giro sull'intero vault**, perché un allegato
  non è un nodo del grafo — non ha link uscenti e non partecipa alla risoluzione
  per nome — quindi le sorgenti da riscrivere si trovano camminando la cache dei
  metadati. Si paga quando qualcuno sposta un allegato: quanto costa già un
  rename di nota con molti backlink.
- **Il mirror TS ha dovuto rinominare un tipo.** In Rust i due `VaultEntry` —
  questo e quello del registro dei vault (`fub_host`) — stanno in crate diversi;
  in TypeScript no, e due `interface` omonime **si fondono in silenzio**. Il
  secondo è ora `KnownVault` di là dal confine. È il §16.5 (mirror generati, non
  scritti) che si fa vedere: un generatore avrebbe dovuto decidere la stessa
  cosa, ma non l'avrebbe scoperta per caso.
