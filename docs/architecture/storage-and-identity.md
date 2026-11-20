# Storage e identità

> **Domanda:** come rimangono coerenti path, documenti, cache e sidecar durante
> le modifiche?
> **Fonti autorevoli:** `crates/fub-kernel/src/`, schemi persistenti e test di
> integrazione.

## Livelli di identità

| Identità | Significato |
|---|---|
| path assoluto | posizione sul filesystem della macchina |
| `DocId` | path relativo canonico nel vault |
| revisione | impronta della sorgente su cui è calcolata una modifica |
| ancora o heading | posizione indirizzabile dentro un documento |
| id di plugin o view | identità namespaced di una registrazione |

`DocId` non è un UUID indipendente dal path. Rename e move cambiano il path
pubblico e devono aggiornare ogni derivato collegato.

## Dati autorevoli e derivati

```mermaid
flowchart TD
    FILE["file del vault"] --> MODEL["modello ricostruibile"]
    FILE --> INDEX["indici ricostruibili"]
    FILE --> ENTRY["anagrafe ricostruibile"]
    SETTINGS["impostazioni"] --> AUTH["stato autorevole"]
    ORG["organizzazione"] --> AUTH
    DRAFTS["bozze"] --> AUTH
    VERSIONS["versioni"] --> AUTH
    PLUGIN["storage plugin"] --> CLASSIFY["classificazione del proprietario"]
```

Una posizione sotto `.fub/data/` non determina da sola che il dato sia una
cache. Lo schema e il proprietario dichiarano se può essere ricostruito.

## Apertura del vault

L'apertura separa struttura e contenuto:

1. inventaria le voci;
2. rende disponibile l'albero;
3. legge i documenti;
4. aggiorna anagrafe e indici;
5. pubblica avanzamento ed eventuali file non letti.

La prima fotografia del vault viene consegnata senza lasciare una finestra in
cui watcher e scansione possano perdere una modifica.

## Modifiche esterne

Il watcher consegna lotti di path toccati o rinominati. Una cartella spostata
dentro il vault, rinominata o portata via arriva come un path solo: il lotto
riallinea i file che stanno sotto quella cartella con la stessa differenza fra
disco e anagrafe della riconciliazione d'apertura. Se il backend dichiara di
aver perso eventi, per esempio per una coda di notifica piena, la
riconciliazione copre l'intero vault.

Su Linux inotify mette un osservatore per cartella, e il loro numero è un
budget dell'utente condiviso con gli altri programmi. Il rilevatore quindi non
guarda l'albero in modo ricorsivo: cammina lui il vault e guarda una per una le
cartelle che la politica di esclusione ammette (`WatchScope` del kernel). Una
cartella esclusa dalle regole che nessuna riga del `.gitignore` può negare
(struttura, nascosti, `files.excluded-folders`, quindi `.git` e
`node_modules` di serie) non prende osservatori, né lei né ciò che contiene;
una esclusa soltanto dal `.gitignore` si guarda ancora, perché può contenere
un file ripreso da una negazione. `.fub` si guarda da sola, senza scendere:
lì cambia `settings.json`, e a ogni lotto il rilevatore confronta la politica
con quella con cui sta guardando e, se è cambiata, aggiunge o lascia le
cartelle. Una cartella nata o spostata dentro il vault prende l'osservatore
prima che il lotto la cammini, così niente cade fra i due. Se il sistema
rifiuta un osservatore per il limite, il rilevamento è morto e lo dice come
ogni altro errore del backend (`VaultStatus.watching` a `false` e un guasto
del vault). Windows e macOS guardano l'albero con un handle solo e restano
ricorsivi.

Un file del lotto che non si legge, perché non è UTF-8, supera il tetto o il
parser lo rifiuta, è un avviso di quel path: il resto del lotto prosegue. Una
rinomina che non si può convalidare, con la destinazione già spostata di nuovo
o illeggibile, si riconcilia come due path toccati, così l'id vecchio non resta
in anagrafe.

## Lettura e scrittura

Le scritture autorevoli passano dal kernel. Il percorso comune:

```mermaid
sequenceDiagram
    participant CALLER as Host o comando
    participant KERNEL as Kernel
    participant STORE as VaultStorage
    participant DISK as Filesystem
    participant BUS as Event bus

    CALLER->>KERNEL: edit con revisione
    KERNEL->>STORE: verifica identità e policy
    STORE->>DISK: scrittura atomica
    DISK-->>STORE: esito
    STORE-->>KERNEL: nuova revisione
    KERNEL->>BUS: evento accodato
    KERNEL-->>CALLER: report tipizzato
```

Nei percorsi staccati dell'host il chiamante non tiene il lock del workspace
durante codice esterno. Gli eventi vengono pubblicati dopo l'operazione
autorevole.

## Cancellazione

Il cestino dell'app e la rimozione osservata dal watcher condividono la stessa
coda in memoria, ma soltanto il primo sposta il file. Dopo la mossa riuscita il
kernel ritira modello, grafo e contesto attivo, quindi notifica gli indici
esterni senza tenere il lock del workspace. Perdite e panici degli indici
diventano avvisi; non annullano la cancellazione, perché il vault resta la fonte
autorevole e l'indice è ricostruibile.

Il fatto `DocumentRemoved` viene accodato dopo il ritorno degli indici. Il
watcher conserva l'attore del proprio lotto e drena una volta alla fine. Il
cestino elimina anche la bozza, registra la mossa nel journal e restituisce il
nuovo `DocId` della voce cestinata.

I compagni `.<nome>.lock`, riconosciuti dal protocollo dello storage, non sono
voci cestinate: il catalogo li esclude e non li conta. Lo svuotamento toglie
quelli che nessuno tiene più (vedi «CAS cooperativa»). File utente come `Cargo.lock` e contenuti di directory con nomi
simili restano invece visibili e conservano le normali regole del cestino.

Svuotare il cestino distrugge soltanto le voci che al censimento avevano già
un sidecar valido, e ciascuna solo se subito prima della rimozione è ancora lo
stesso file: identità, dimensione, data e timbro di cambiamento. Una voce che
un'altra finestra o un altro processo Fub ha sostituito nel frattempo resta,
col suo sidecar, e non si conta. Un guasto del supporto durante quel controllo
non è una voce cambiata: risale come errore `Io`, come quello della rimozione,
e il cestino non risulta svuotato. Fra quell'ultimo controllo e la rimozione
resta la finestra di una chiamata di sistema: chiuderla vorrebbe un lock
inter-processo sul vault che il kernel non ha.

### CAS cooperativa

`RootedFsStorage` coordina i writer Fub tramite un file stabile
`.<nome>.lock` accanto al target, aperto relativamente alla capability.
La creazione è esclusiva; soltanto `AlreadyExists` conduce all'apertura del
lock esistente, senza troncarlo.

Il file non resta nel vault. Il detentore lo toglie al rilascio, mentre tiene
ancora il lock, e chiude l'handle dopo; uno spostamento toglie entrambi i
compagni, quello della sorgente e quello della destinazione, quindi il cestino,
il ripristino, la rinomina e lo spostamento non lasciano niente accanto ai
file. Chi acquisisce il lock controlla poi che il nome porti ancora al file
che tiene (stessa identità: `dev`/`ino`, o volume e indice su Windows): chi
aspettava su un compagno appena tolto ottiene un file senza nome, se ne
accorge e riparte da capo. Così l'esclusione fra writer resta quella di un
file stabile. Su Windows un compagno tolto ma ancora aperto risponde «accesso
negato» finché l'ultimo handle non si chiude: l'apertura riprova per al più
due secondi. Un compagno non vuoto non è nato da Fub, che nel lock non scrive,
e non si toglie.

Un processo che muore col lock in mano (un'uscita forzata durante un
salvataggio) lascia il file, ma il sistema rilascia il lock. La scansione
d'apertura raccoglie i compagni che attraversa e
`VaultStorage::remove_abandoned_lock` toglie quelli che si riescono a prendere
senza aspettare, vuoti e ancora con la stessa identità; lo svuotamento del
cestino fa lo stesso dentro `.trash/`. Un compagno tenuto adesso, da questo
processo o da un altro Fub, resta. Il criterio è il lock e non l'età o un pid,
che su un vault condiviso fra macchine non dicono niente.

La scansione non entra in `.fub/`, che non è contenuto dell'utente, ma il
supporto del vault vi prende i lock delle impostazioni, dell'anagrafe, delle
bozze, dei sidecar del cestino e dello stato per documento dei plugin.
All'apertura `Vault::service_locks` cerca lì soltanto i compagni, senza
produrre voci né seguire collegamenti, e la stessa pulizia toglie quelli vuoti
e liberi. Dello spazio di un plugin (`.fub/plugins/<id>/`) si guardano solo gli
spazi per documento (`doc/`, `doc~trash/`), che scrive il kernel: il resto può
essere la cartella che `Workspace::plugin_data_dir` consegna a un motore
nativo. L'indice di ricerca vi tiene `.tantivy-writer.lock` e
`.tantivy-meta.lock`, che hanno la stessa forma ma seguono il protocollo di
tantivy: sono stabili per costruzione, e prenderne uno anche solo per un
istante farebbe fallire l'apertura del suo writer.

`FsStorage`, usato fuori dal vault, segue ancora il protocollo del file stabile
e non partecipa alla pulizia. Il cestino del sistema sposta la nota fuori dal
vault con `FsStorage` e non lascia niente accanto a lei: su Linux la mossa è
`renameat2` con `RENAME_NOREPLACE`, senza lock, e il ripiego per i filesystem
che non la offrono prende il lock della destinazione, nel cestino del sistema.
Su Windows e su macOS il backend non c'è e la nota va nel cestino del vault,
con il supporto del vault. Un backend nuovo che spostasse con `FsStorage` su
Windows, dove la mossa serializza la sorgente con il file stabile, lascerebbe
il compagno nella cartella della nota: il passo dentro il vault va fatto con il
supporto del vault.

Il lock viene acquisito prima della rilettura e resta detenuto durante il
confronto e la sostituzione atomica. Un errore di apertura o acquisizione
impedisce la scrittura e mantiene la specie I/O originale. La diagnostica
distingue lo stadio del lock dall'operazione protetta.

La CAS è esatta fra writer che rispettano questo protocollo. Con writer
esterni che ignorano il lock la protezione resta best-effort.

### File in sola lettura

La scrittura atomica rinomina un temporaneo sopra il file, e la rename chiede
il permesso della cartella, non quello del file. Per questo `RootedFsStorage` e
`FsStorage` guardano il file che c'è già **prima** di creare il temporaneo: se
non è scrivibile la scrittura si ferma con `io::ErrorKind::PermissionDenied` e
un messaggio che nomina il file, e file e cartella restano come erano. Su
Windows conta l'attributo di sola lettura; su Unix il bit di scrittura della
classe che si applica al processo (proprietario, gruppo effettivo o
supplementare, altri). Root non scavalca il controllo: per lui un file è in
sola lettura quando nessuna classe ha il bit di scrittura. Un file nuovo e un
file scrivibile si scrivono come prima.

Il kernel porta questo rifiuto al contratto come
`PluginError::PermissionDenied`, non come `Io`; lo riconosce dal tipo che lo
storage mette dentro l'errore, quindi gli altri permessi negati del sistema
(una cartella che non si elenca o non si scrive) restano `Io`. La shell lo dice una volta per
documento («è in sola lettura: Fub non lo sovrascrive»), tiene la bozza
sporca e lascia che il salvataggio automatico riprovi in silenzio finché il
file non torna scrivibile o l'utente preme «Riprova».

## Snapshot globale

Lo snapshot globale è una responsabilità del kernel, non del provider di
versioning e non dell'IPC. `fub_kernel::snapshot` enumera soltanto lo stato
autorevole: documenti, allegati e sconosciuti condividono la classe `user`
perché il kernel non possiede il `FormatRegistry`; cestino,
settings/organizzazione/drafts/journal, sidecar autorevoli e storage persistente
dei plugin hanno classi core proprie. La cache `.fub/data/plugins/<id>/` è
derivata soltanto quando contiene `.fub-cache-root`; senza marker è storage
autorevole legacy. La configurazione macchina e gli altri derivati
ricostruibili restano fuori.

La fotografia produce un manifest schema 1 deterministico. Ogni path relativo
normalizzato porta classe, owner, schema quando applicabile, size e SHA-256.
Preflight completo rifiuta prima di scrivere schema futuro, path traversal,
duplicati, symlink/file speciali, entry mancanti e mismatch di size/digest. La
base revision è il digest del manifest live; il kernel la rilegge sotto un lock
sibling stabile immediatamente prima del commit. Non deduce l'autorità dal solo
prefisso `.fub/data/`.

L'applicazione offline usa staging sibling privato e un record persistente
idempotente:

```mermaid
sequenceDiagram
    participant H as Host chiuso
    participant K as Kernel snapshot
    participant L as Root live
    participant S as Staging sibling
    H->>K: recovery startup
    H->>K: apply(snapshot)
    K->>K: preflight + base revision sotto lock
    K->>S: prepare e fsync
    K->>L: rename vecchia root in .old
    K->>L: rename staging in root
    K->>K: finalize solo dopo verifica
    H->>K: riapertura e ricostruzione derivati
```

La vecchia root resta disponibile fino a `finalize`; un crash fra le fasi viene
risolto dalla recovery riconoscendo soltanto schema, transaction id e nomi
propri. File ignoti non vengono rimossi. La garanzia all-or-old-or-new vale tra
writer cooperativi; writer esterni e filesystem senza rename/fsync durevoli non
sono coperti da atomicità universale. Il restore per-file di `fub.versioning` e
il drill backup #7 rimangono percorsi separati.

## Rename

Un rename deve considerare:

- collisione con un documento vivo;
- differenze di maiuscole del filesystem;
- aggiornamento del `DocId`;
- sessioni aperte;
- bozze;
- anagrafe e indici;
- organizzazione;
- riferimenti che una feature decide di riscrivere;
- evento unico e ricongiunto.

La validazione dell'identità del nome vive in regole condivise, non in ogni
chiamante.

Su Windows il backend ancorato usa `NtSetInformationFile` con il directory
handle e un nome UTF-16, senza riaprire il path ambientale della root. Il lock
sibling della sorgente precede la sua apertura: due writer Fub concorrenti non
possono dichiarare entrambi lo spostamento, anche verso destinazioni diverse.
La syscall rifiuta atomicamente una destinazione occupata. Inoltre `cap_std`
nega la condivisione della cancellazione sulle directory Windows aperte: la
root non può essere rinominata o cancellata durante il mount.

## Sidecar

Un sidecar contiene informazioni che non appartengono al file principale ma ne
descrivono stato o provenienza. Deve avere:

- schema o forma riconoscibile;
- comportamento su versione futura;
- legame verificabile con il file a cui si riferisce, quando l'omonimia è
  possibile;
- fallback che non distrugga il documento.

## Lo stesso contenuto

Il vault non tiene un indice per contenuto. La domanda «c'è già un file di
questo tipo con questi byte?» si risponde con l'indice vivo del workspace, cioè
le voci dell'anagrafe in memoria con misura, data e impronta, e dove l'indice
non basta la risposta è «non so». Chi copia un contenuto nel vault la usa per
riusare un file che c'è già, anche con un altro nome, invece di duplicarlo.
`Workspace::prepare_same_content` prende i candidati, `PreparedSameContent::invoke`
confronta i byte già in memoria, e l'host la espone come `Host::same_content`.

```mermaid
flowchart TD
    Q["contenuto che arriva"] --> T{"scansione finita?"}
    T -- "no" --> U["non so: si copia"]
    T -- "sì" --> E{"0 byte?"}
    E -- "sì" --> N
    E -- "no" --> C{"al più 64 candidati?"}
    C -- "no" --> U
    C -- "sì" --> H["impronta della voce o calcolata"]
    H --> B{"byte uguali?"}
    B -- "sì" --> F["trovato: il primo per percorso"]
    B -- "no" --> N["non trovato"]
```

I candidati sono le voci dell'indice vivo con la stessa misura e la stessa
estensione del nome che si vuole scrivere, fuori dal cestino, da `.fub/` e
dalle cartelle escluse. L'estensione è quella grezza dell'ultimo segmento,
piegata in minuscolo e confrontata uguale: il registro dei formati non si
interroga, quindi `.md` e `.markdown` sono due tipi anche se un formato li
servisse entrambi. È prudente di proposito: chi riusa un file scrive un
collegamento a lui, e quel collegamento non deve cambiare estensione. Un `.txt`
con i byte di una nota `.md` non è quella nota, e un file senza estensione
trova solo un file senza estensione. Un contenuto di 0 byte non si ritrova mai.
La domanda non legge `.fub/data/entries.json`: quella tabella si scrive alla
fine dell'indicizzazione e alla chiusura, mentre l'indice vivo conosce subito
un file scritto o cambiato nella sessione. Prima che la scansione abbia
installato l'anagrafe la risposta è «non so»; l'host però pubblica un vault
solo dopo la scansione, e un rebuild svuota e rimette l'anagrafe nello stesso
prestito, quindi da `Host::same_content` questo «non so» non arriva. Un file
che l'indice non conosce ancora, perché è arrivato da fuori senza il
rilevatore, non è un candidato: la risposta è «non trovato», e chi chiede
copia.

Ogni candidato porta un'impronta: quella della voce, se misura e data del file
sono ancora quelle della voce e l'impronta è nella forma corrente
(`Revision::is_current_form`), oppure una calcolata leggendo il file a pezzi.
Un'impronta FNV-1a di una tabella scritta prima di SHA-256 non dice né sì né
no, e si ricalcola. L'impronta sceglie il candidato, ma solo un confronto dei
byte intero dà «trovato»: un'impronta vecchia può solo far copiare. Un
candidato che non si legge, che cambia mentre lo si legge (misura, data, segno
del cambio o identità) o che non ha più la misura cercata si salta, e della
sua impronta non si impara niente.

Un'impronta calcolata torna all'indice vivo sotto il lucchetto del workspace
(`Workspace::learn_fingerprints`), nello stesso vault a cui si è fatta la
domanda, insieme al **testimone** del file letto (`FileWitness`: segno del
cambio e identità, presi dalla domanda fuori dal lucchetto). Si tiene soltanto
se:

- la data letta è anteriore all'istante della domanda, preso dall'orologio del
  vault (*racily clean*);
- la voce ha ancora la misura e la data lette: una voce cambiata nel
  frattempo, da una scrittura o dal rilevatore, non torna indietro;
- la riga dell'anagrafe con quella misura e quella data, se c'è, descrive lo
  stesso file. Un file sostituito da un altro con la stessa misura e la stessa
  data, senza il rilevatore, ha una voce che descrive ancora quello di prima,
  e l'impronta del nuovo certificherebbe i metadati del vecchio.

Sotto il lucchetto si confronta soltanto: nessuna domanda al supporto, e la
riga dell'anagrafe non si copia. L'indice tiene il testimone accanto
all'impronta finché la voce non cambia. La domanda dopo crede l'impronta solo
se il file appena guardato ha lo stesso testimone, e `store_entries` non la
scrive in una riga il cui file adesso è un altro: alla riapertura quel file si
rilegge invece di essere certificato con i byte di prima. I testimoni si
confrontano con la regola di «Lo stesso file», qui sotto.

### Lo stesso file

Ogni punto che decide «il file è quello che conosco» usa una regola sola, di
`fub_kernel::transfer`: due testimoni (`FileWitness`) sono lo stesso file se
timbro di cambiamento (`ctime` su unix, `ChangeTime` su Windows) e identità
coincidono. Un campo noto da una parte sola è un file cambiato, che si
rilegge; ignoto da entrambe le parti non decide, e restano peso e data. La
usano l'anagrafe quando eredita impronta e metadati da una riga, il riuso
delle righe alla riapertura, `learn_fingerprints`, lo svuotamento del cestino
e il prestito delle letture a pezzi. Sui supporti dove il timbro è la data
(FAT) l'identità resta l'unico segno di un file messo sopra un altro.
Timbro e identità si chiedono insieme, con `VaultStorage::witness`: su
Windows è un handle solo, aperto una volta; gli altri supporti hanno un
default che chiama `change_stamp` e `file_identity`.

La riga di `entries.json` porta il timbro del file **letto**, non di quello
che c'è quando la si scrive. La voce viva ricorda da quale file viene la sua
impronta (`CoreIndex::learned_on`): la lettura della seconda fase, con il
testimone preso prima di leggere, la riga certificata alla riapertura, una
domanda sul contenuto. `store_entries` scrive il timbro solo se quel
testimone coincide ancora con il file di adesso; una voce che non lo sa (una
scrittura di Fub, il rilevatore) va senza timbro, e la riapertura la rilegge.
Così un file rinominato sopra un altro con lo stesso peso e la stessa data,
dopo la lettura, non viene certificato con i byte di prima.

Un timbro ricordato vale solo se era già fermo quando si è guardato il file:
più vecchio di una grana, presa larga a due secondi (`CHANGE_STAMP_GRAIN`),
dell'orologio letto prima di guardarlo (`change_stamp_settled`). Una
riscrittura venuta dopo, con lo stesso peso e la stessa data, nella stessa
grana non cambierebbe il timbro. Per questo `store_entries` scrive la riga
senza timbro quando non era fermo, e la riapertura rilegge quel file; la
memoria delle revisioni fa lo stesso (`craft-formats.md`). Il prestito e il
cestino confrontano due letture della stessa chiamata e non ricordano niente:
lì la grana non si chiede.

La consegna è un prestito esclusivo breve: `Custody::write` prende il turno di
scrittura prima del lucchetto, quindi non entra a metà del lavoro di un altro
writer, e non drena eventi, perché imparare un'impronta non ne produce.
L'indice non ha un lucchetto suo fuori dal workspace. Su disco la porta
l'anagrafe (`EntryStore`), l'unica che scrive `entries.json`, la prossima
volta che si scrive. Il formato non cambia: l'impronta è il campo che la voce
già porta.

Ci sono due limiti, costanti con nome: `MAX_CANDIDATES`, 64 candidati, e
`MAX_BYTES_READ`, 512 MiB letti per domanda. Oltre questi limiti la risposta è
«non so» e chi chiede copia: nel dubbio si copia. Troppi candidati danno lo
stesso «non so» a ogni domanda con quei byte; il budget finito invece no,
perché le impronte imparate rendono la domanda dopo più economica. Per questo
`Host::same_content` fa da sé un secondo giro, uno solo, quando il primo ha
finito il budget e ha insegnato almeno un'impronta all'indice. Il contenuto
che arriva si confronta dove sta, senza copia.

Il lucchetto del workspace non si tiene mentre si legge. La domanda prende i
candidati, lascia il lucchetto, legge, e rientra solo per consegnare le
impronte imparate. I collegamenti simbolici non si seguono: lo storage è
radicato nel vault, e nessuna lettura ne esce.

## Schemi

Ogni formato persistente ha una propria `SchemaVersion`. Gli schemi non
avanzano tutti insieme.

- un derivato incompatibile può essere eliminato e ricostruito;
- un dato autorevole richiede migrazione o rifiuto;
- un file scritto da una versione più nuova non viene reinterpretato a metà;
- un fallback silenzioso è ammesso soltanto quando non può perdere dati.

Il catalogo preciso è in
[`../reference/on-disk-layout.md`](../reference/on-disk-layout.md).

## Invarianti

- nessun path esterno alla radice viene accettato per errore;
- ogni scrittura autorevole è atomica o lascia intatto il valore precedente;
- un file senza permesso di scrittura non si sovrascrive;
- la revisione impedisce overwrite silenziosi;
- cache e autorità sono classificate per formato;
- rename, watcher e indice convergono sullo stesso `DocId`;
- i file sconosciuti vengono preservati.
