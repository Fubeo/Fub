# 0102 — I byte di un trasferimento non stanno nel record, e leggerli è posizionale

|  |  |
|---|---|
| **Decisa** | 2026-08-05 |
| **Origine** | `todo.md` §23.6 ([seduta 23](../roadmap/23-cosa-costano-le-decisioni-chiuse.md)) — **chiude la voce** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/23-cosa-costano-le-decisioni-chiuse.md) ·
[import ed export sono trait, 0006](0006-import-export-come-trait.md) ·
[il lavoro lungo vede il vault, 0027](0027-il-lavoro-lungo-vede-il-vault.md) ·
[chi legge non aspetta chi legge, 0024](0024-chi-legge-non-aspetta-chi-legge.md)
· [un tetto che si fa sentire, 0094](0094-un-tetto-che-si-fa-sentire.md)

---

La [0006](0006-import-export-come-trait.md) ha deciso che il confine del
trasferimento è **di byte e non di path**, ed è la più protettiva delle prime
dieci: il capitolo che in ogni altra applicazione tocca il filesystem più di
tutti non chiede **nessuna** capacità filesystem, e a M5 la sandbox non deve
concedere niente. Questa decisione non la riapre. Riapre il prezzo, che quel
verbale dichiarava in una riga e mezza: *«sorgente e artefatti stanno in
memoria, e uno `stream` al confine resta additivo»*.

La decisione in una riga:

> **I byte di un trasferimento non stanno per forza dentro il record: da una
> parte e dall'altra c'è una chiave che l'host timbra e solo l'host risolve. E
> una lettura di sorgente è *posizionale*, perché la cosa che si importa più
> spesso è un archivio, e la directory di un archivio sta in fondo.**

## Cosa la rilettura ha cambiato, prima che si progettasse qualcosa

### La scusa della 0006 è scaduta, e il verbale che l'ha fatta scadere ha un numero

Il verbale della 0006 nomina «un vault Obsidian da 4 GiB» una volta sola, e non
per dire che non ci sta: per dire che **non deve starci**, *«finché un job non
vede il vault»*. Era un rimando a un buco allora aperto — il lavoro lungo, §9.1.
La [0027](0027-il-lavoro-lungo-vede-il-vault.md) quel buco l'ha chiuso: un job
riceve l'`HostApi` per chiamata, quindi un import da 4 GiB adesso è una cosa che
**si può chiedere**, e la sola frase che spiegava perché non fosse un problema
diceva l'opposto di quello che si legge oggi.

Non è un errore della 0006: è una condizione scritta bene, che è diventata falsa
quando doveva. Il difetto è che nessuno era tornato a leggerla.

### Due strade su tre sono strutturalmente incapaci, e la voce aveva già scritto perché senza accorgersene

La voce elencava tre forme: uno `stream<u8>` di WASI, un metodo a **chunk** con
un cursore tenuto dall'host, o un **handle** opaco. Suggeriva la terza per
simmetria con la 0006 — chi apre e chi legge resta l'host — che è un buon
argomento ma è un argomento di *stile*.

La ragione vera stava nella casella successiva della stessa voce: *«un
contenitore e uno stream non sono due voci»*, e *«`.docx`, `.epub`, `.odt` e
mezzo mondo dei backup **sono lo stesso zip**»*. Uno zip tiene la propria
directory **in fondo**. Le prime due forme sono tutte e due sequenziali: chi sa
solo andare avanti non sfoglia un archivio, lo scarica tutto — e siamo
esattamente al punto di partenza, con in più una firma nuova da mantenere.

Quindi non è che la terza strada sia la più elegante: è **l'unica che chiude la
voce che la voce ha dichiarato di voler chiudere**. Sceglierne un'altra avrebbe
prodotto un giro chiuso a metà, che è la stessa trappola della
[0101](0101-una-voce-non-e-un-passo.md).

### Il difetto peggiore stava fuori dalla voce, per la terza volta

Dopo la [0099](0099-una-rinomina-che-non-ha-visto-nessuno.md) e la
[0101](0101-una-voce-non-e-un-passo.md), succede di nuovo. La voce dichiarava
d'essere **P1** e non P0 con questa frase: *«un modo nuovo accanto a quello che
c'è è additivo, e la 0006 lo dice»*. Misurandola sul presidio invece che
crederla, la frase è **falsa** — e non per questa voce soltanto.

`wit_additivity` confronta il contratto vivo con la linea di base congelata, e
una delle sue regole è «una funzione **nuova** è additiva». È vera sulle
interfacce che il plugin **importa**: un componente già compilato non la chiama,
non se ne accorge, continua a girare. È il caso della
[0013](0013-elenco-delle-capacita.md), ed è quello che si aveva in testa
scrivendo la regola — l'autotest che la copriva aggiungeva `host-env::notify`,
cioè proprio un'importata.

Sulle interfacce che il plugin **esporta** la stessa regola è falsa nel verso
peggiore: una funzione in più non è qualcosa che il vecchio può ignorare, è
qualcosa che deve **fornire**. Un componente compilato contro `fub:abi@0.1.0`
esporta le funzioni di allora; un world che ne pretende una in più è un world
che quel componente non soddisfa, e non si instanzia affatto. Non è una minor
travestita da riga in coda: è una major.

E ne erano già passate due, verdi:

| funzione | da dove | perché nessuno se n'è accorto |
|---|---|---|
| `index::up-to-date` | [0047](0047-la-cartella-esiste-nel-kernel.md) (§14.2) | la [0051](0051-l-alimentazione-risponde.md) scrive perfino *«`up-to-date` NON è toccata»*, e sul suo oggetto ha ragione — ma la funzione era comunque nata dopo la linea di base, su un'interfaccia esportata |
| `view::interests` | [0033](0033-la-grana-di-un-abbonamento.md) | stessa storia: interfaccia esportata, presidio verde, nessuna riga nella tabella dei ritagli |

Nessuna delle due è in `wit-congelato.md`. Il presidio non le ha nascoste per
malizia: la regola era stata **scritta guardando il lato che si concede e
applicata anche al lato che si deve**.

## Cosa si è fatto

### Il verso dell'import: un contenuto che può essere una chiave

`ImportSource` non porta più un `Vec<u8>` ma un `SourceContent`:

```rust
pub enum SourceContent {
    Bytes(Vec<u8>),
    Streamed(StreamedSource),   // { handle: SourceHandle, len: u64, prologue: Vec<u8> }
}
```

Tre cose meritano il nome che hanno.

**Restare in memoria non è vietato**, ed è il caso comune: un `.md` incollato,
un CSV di duemila righe. `Bytes` è ancora lì. Ciò che cambia è che adesso la
scelta si può **dichiarare** invece di essere l'unica — chi apre la sorgente
decide, e chi la legge non deve saperlo.

Il **prologo** è un assaggio (8 KiB lato host) che viaggia dentro il record. Non
è una comodità: è ciò che permette al *dispatch* di riconoscere una firma di
formato — un `PK\x03\x04`, un `%PDF`, un frontmatter — senza aprire un giro di
letture e senza che il kernel debba indovinare dal nome. Chi ha bisogno di più
di così ha bisogno di un host, e ce l'ha dentro `import`.

La **`len`** è quanto l'host ha visto **prima** della chiamata, ed è documentata
così. Per questo il ciclo di `ImportSource::read_all` si ferma su una lettura
vuota e **non** sul conto: se il file è cambiato sotto, fermarsi a `len` sarebbe
troncare in silenzio, e crederci sarebbe la stessa fiducia mal riposta del
*racily clean* che la 0047 aveva già incontrato altrove.

### Il verso dell'export: un artefatto si versa, non si accumula

Simmetrico, e più semplice, perché qui a produrre è il provider:

```rust
pub trait ArtifactSink: Send {
    fn open_artifact(&mut self, path: &str, media_type: &str) -> Result<ArtifactHandle, PluginError>;
    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError>;
    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError>;
}
```

`ExportProvider::export` riceve `out: &mut dyn ArtifactSink` e ci versa dentro
mentre produce. L'`ExportArtifact` che torna porta un `ArtifactContent`, che è
`Bytes` **oppure** `Delivered(u64)`: consegnato, e tanti byte. Un export
dell'intero vault in PDF non costruisce più un `Vec<ExportArtifact>` con dentro
tutto il vault reso.

Il guadagno che non si vede nella firma: **c'è una strada sola**. Il provider
markdown scrive attraverso il sink sempre, e chi chiama sceglie il comportamento
**scegliendo il sink** — `MemorySink` per un anteprima o un download,
`DirectorySink` per una cartella scelta dall'utente. Non ci sono due rami da
tenere allineati, quindi non c'è il ramo che si dimentica.

### Una famiglia in più, e sta dalla parte di chi legge

`TransferRead::read_source(handle, offset, len)` è la diciannovesima
`Capability` (`Capability::Transfer`) e la sedicesima famiglia di trait. Due
scelte, tutte e due argomentate nel codice.

**Non ha un permesso.** `permission()` risponde `None`, come le altre famiglie
che non concedono niente di nuovo: un handle non si costruisce, si **riceve**, e
nomina esattamente la sorgente che l'utente ha appena scelto nel dialogo di
sistema e nient'altro. Chiedere una spunta nel manifest per «leggere i byte che
ti ho appena dato» insegnerebbe a spuntare, che è la lezione della
[0100](0100-i-tasti-che-arrivano-da-fuori.md) letta al contrario.

**Sta in `ReadApi` e non in `HostApi`**, ed è la correzione che il compilatore
ha imposto per primo ma che il verbale avrebbe dovuto imporre comunque. Servire
la lettura di una sorgente da 4 GiB sotto il prestito esclusivo vuol dire tenere
il lock in scrittura per il tempo di una migrazione: è **letteralmente** il
difetto che la [0024](0024-chi-legge-non-aspetta-chi-legge.md) ha misurato — la
fame di chi scrive — riprodotto sull'operazione più lunga che l'applicazione
conosca. `ReadOnly::denies` la lascia passare, perché un'anteprima *è* una
simulazione e leggere la sorgente è ciò che la simulazione fa.

Il `READ_CHUNK` di 256 KiB **non** entra nel contratto. È la grana con cui
`read_all` chiede, e l'host può sempre dare meno; un numero pubblicato sarebbe
una promessa congelata, che è la forma che la
[0094](0094-un-tetto-che-si-fa-sentire.md) ha già scartato per `random-bytes`.

### Chi apre e chi chiude, e perché il kernel non chiude

`Workspace::open_source` timbra la chiave e `close_source` la ritira; le chiavi
**salgono e non si riciclano**, così un handle chiuso non diventa mai per
sbaglio un handle di qualcun altro — chiuderlo e riusarlo risponde `BadArgs`, e
c'è un test che lo dice.

Il kernel **non** chiude alla fine di un `import`, di proposito: la coppia
preview→apply della 0006 è due chiamate sulla stessa sorgente, e chiuderla in
mezzo vorrebbe dire riaprirla, cioè rileggere tutto per rispondere due volte
alla stessa domanda. Apre chi ha aperto il dialogo, e chiude lo stesso.

### Il presidio, riparato

`wit_additivity` adesso calcola le interfacce **esportate dal world** e tratta
una funzione nuova su una di quelle come un'obbligazione, non come un'aggiunta —
con il messaggio che dice cosa fare (una riga argomentata, e una riga nella
tabella dei ritagli). Le due che erano già passate stanno in
`OBBLIGAZIONI_NOTE`, ognuna col suo perché: **non è un condono**, è il modo di
renderle visibili senza riscrivere la storia, ed è la stessa forma
dell'allowlist di `serialize_non_riscrive` — il costo è reale e lo paga chi lo
sceglie, invece di ereditarlo in silenzio. Una riga nuova lì dentro va
argomentata.

Accanto all'autotest verde che c'era («una funzione nuova» su un'importata, che
resta additiva) ne sta adesso uno rosso sulla stessa parola: `format::describe`,
cioè la stessa aggiunta su un'esportata. Le due caselle sono vicine di
proposito: la regola non è «una funzione nuova», è «da che parte».

E la tabella *Cosa conta come aggiunta* di `wit-congelato.md` non ha più una
casella sola per la parola «funzione».

## Il prezzo, misurato invece che temuto

Due campi cambiano tipo nella linea di base — `import-source.bytes` e
`export-artifact.bytes` diventano `content` — quindi è un **ritaglio**, e sta
nella tabella. È il quinto di questa seduta dopo la
[0092](0092-una-base-si-dichiara.md), la
[0093](0093-le-selezioni-sono-n-e-il-buffer-e-uno.md), la 0094 e la 0101, ed è
uno dei pochi che il file della linea di base lo tocca **davvero**: i due campi
c'erano già quando `0.1.0.wit` è stato tagliato, quindi qui non vale la ragione
della [0049](0049-una-posizione-dentro-un-documento.md) — non si sta ritipando
qualcosa che non era mai stato pubblicato, si sta cambiando qualcosa che c'era.
Il che è il motivo per cui si fa **adesso**: prima del freeze M4 lo paga questo
repo, dopo lo pagherebbe una major.

Ciò che **non** si è pagato: nessuna capacità filesystem, di nessun tipo, in
nessuno dei due versi. La conclusione della 0006 vale identica dopo questa
decisione — un plugin WASM di M5 riceve una chiave e un prologo, e continua a
non sapere dove sia il vault.

## Cosa resta fuori

- **Sfogliare un archivio** non è qui dentro. Qui c'è la sola cosa che serviva
  per poterlo fare: leggere a un `offset`. Chi aprirà `.docx` ed `.epub`
  scriverà il proprio lettore di zip sopra `read_source`, senza chiedere niente
  all'host — che è esattamente ciò che la voce voleva rendere possibile.
- **Rollback e resume** (17.3) restano dove la 0006 li aveva lasciati: l'inverso
  di un lotto sopra un journal, e nessuno dei due esiste.
- **La scrittura di una sorgente** non esiste e non deve: `TransferRead` legge,
  e basta. Chi posa byte fuori dal vault lo fa attraverso un sink che gli ha
  dato l'host, o non lo fa.
