# Layout su disco

> **Ambito:** file scritti da Fub a livello macchina e dentro un vault.
> **Fonti autorevoli:** moduli proprietari, `SchemaVersion` e test degli schemi.

## Regola di lettura

Ogni voce è classificata come:

- **utente**: contenuto del vault;
- **autorevole**: stato non ricostruibile;
- **derivata**: cache ricostruibile;
- **diagnostica**: utile per supporto, non fonte del prodotto;
- **dipende dal plugin**: il proprietario dichiara autorità e migrazione.

Non classificare una directory intera per il solo nome.

## Configurazione della macchina

La cartella viene scelta in ordine:

1. `FUB_CONFIG_DIR`;
2. `fub-config/` accanto all'eseguibile se esiste `fub.portable`;
3. cartella di configurazione dell'utente per il sistema operativo.

| Percorso relativo | Classe | Schema | Contenuto |
|---|---|---:|---|
| `settings.json` | autorevole | 1 | impostazioni della macchina |
| `vaults.json` | autorevole | 1 | vault recenti, preferiti, nome e icona |
| `view-state.json` | autorevole locale | 1 | stato delle view di questa macchina |
| `themes/<id>/manifest.json` | installato | manifest | identità e compatibilità del tema |
| `themes/<id>/` | installato | per tema | fogli, skin e asset |
| `logs/fub.log` | diagnostica | n/a | log del processo |
| `wasm-plugins/inventory.json` | autorevole | 1 | componenti installati e scelte della macchina |
| `wasm-plugins/components/<installation>-<sha256>.wasm` | installato | componente | eseguibile verificato |
| `installed-limited.json` | autorevole | n/a | avvio limitato dei componenti installati |
| `catalog-trust.json` | autorevole, dell'operatore | n/a | chiavi del catalogo firmato e generazione minima |
| `catalog-feed.json` | autorevole, dell'operatore | n/a | feed firmato del catalogo |
| `sync/vaults/<chiave>/` | autorevole locale | n/a | stato di sync di un vault |
| `services-token` | segreto | n/a | token dei servizi salvato da `fub-cli login` |

Se la cartella di configurazione non è disponibile, l'host può lavorare in
memoria. Un file illeggibile non viene riscritto da uno stato vuoto.

Lo stato di sync è di un vault, non della macchina. La chiave viene dallo
SHA-256 della radice canonica del vault. La cartella tiene replica,
abbinamento, coda, cursore, conflitti e l'endpoint a cui la coppia è legata. Un
vault spostato riparte come replica nuova, e la cartella del percorso vecchio
non viene cancellata. I file di una versione precedente, scritti direttamente
in `sync/` e condivisi da tutti i vault, non vengono adottati né cancellati.

Sync e pubblicazione leggono il token da `FUB_SERVICES_TOKEN_FILE`, poi da
`FUB_SERVICES_TOKEN`, poi da `services-token`. Il file vale soltanto se è
regolare, non è un collegamento e, su Unix, è leggibile dal solo proprietario,
come lo scrive `login`.

La cornice della shell (rail con ordine e icone nascoste, pannelli laterali
affiancati, stato e strumenti del riquadro, cornice della finestra) sta in
`settings.json` come impostazioni `chrome.*`. Le chiavi `localStorage` di prima
(`fub.shell.rail.v1`, `fub.layout.sidebar`, `fub.layout.inspector`) si adottano
una volta, solo se l'impostazione è ancora al default, e si cancellano dopo
una scrittura riuscita.

## Componenti WASM installati

`fub_wasm_host::installed::InstalledPluginStore` riceve esplicitamente la
configurazione scelta dall'host nativo. Dopo `open`, usa la capability della
directory e non deduce percorsi dal manifest o dai dati del vault.

L'inventario schema 1 conserva `next_installation` e `plugins`. Ogni record
ha identità monotona, manifest, digest SHA-256, `enabled` e `consent`.
Contatore e identità attraversano JSON come stringhe decimali. Il consenso
può essere `undecided`, `denied` o `granted` e riguarda gli esatti byte
installati; non concede capability. La fiducia resta `Trust::Community`.

Il blob identificato dal contenuto viene pubblicato prima dell'inventario, che
usa una compare-and-swap (CAS) cooperativa. File `.part` e blob non referenziati
sono invisibili allo store. Un errore nella pubblicazione lascia intatto
l'inventario precedente; un file corrotto, illeggibile o con schema futuro non
viene reinterpretato come vuoto. Il load ricontrolla il digest senza eseguire
il guest; una validazione attiva esplicita ricontrolla anche il manifest sugli
esatti byte. Un id duplicato, anche con versione diversa, richiede una scelta
esplicita.

La rimozione ritira il record prima del cleanup del blob. Un cleanup fallito è
riportato nell'esito e può lasciare un orfano invisibile. La reinstallazione ha
nuova identità e nessun consenso ereditato. Il chiamante deve completare il
teardown prima di rimuovere: lo store non possiede le istanze e non monta in
automatico. `InstalledPluginStore` non salva né scopre componenti installati in
`.fub/plugins/<id>/` e non cancella quella directory.

Il bootstrap desktop usa la stessa configurazione di log e host. Prima di
leggere o istanziare un componente seleziona soltanto i record enabled con
consenso `granted`; al riavvio rilegge queste scelte. Le cinque porte IPC
desktop delegano a `InstalledPluginManager`, che persiste le decisioni e
riconcilia i vault aperti. La decisione persistente è nell'
[ADR 0200](../decisions/0200-inventario-componenti-installati.md).

`installed-limited.json` sceglie l'avvio limitato dei componenti installati:
`{"enabled": true, "reason": "…"}`, al massimo 4 KiB, campi sconosciuti
rifiutati. La scelta vale per l'apertura e non tocca `enabled` né il consenso
dell'inventario. Un file assente vale avvio normale; un file presente ma
illeggibile avvia in modo limitato e ne dice il motivo.

`catalog-trust.json` e `catalog-feed.json` li prepara chi amministra la
macchina. Fub li legge soltanto quando un comando del catalogo li chiede, mai
all'avvio né dalla rete, e nessun argomento IPC ne nomina un altro. Il primo,
al massimo 64 KiB e con i campi sconosciuti rifiutati, tiene `keys` (id della
chiave di firma → chiave pubblica) e `min_generation`, la generazione minima
del feed come stringa decimale; senza il file o senza chiavi il catalogo
risponde `Unserved`. Il secondo, al massimo 4 MiB, è il feed firmato. Un file
illeggibile è un errore, non un catalogo vuoto. L'artefatto scelto per
un'installazione dal catalogo si legge come la sorgente di un'installazione
diretta: file regolare, nessun collegamento simbolico, al massimo 64 MiB.

## Configurazione dell'app mobile

Sul mobile la cartella dati dell'app tiene `mobile-storage.json` (autorevole,
schema 1, al massimo 128 KiB, campi sconosciuti rifiutati): la scelta fra vault
privato e cartella condivisa e il permesso sulla cartella dato dal sistema
(URI dell'albero su Android, bookmark security-scoped su iOS). Ogni scrittura
porta la `revision` letta, e una revisione diversa è `Conflict`; il file si
sostituisce con una rinomina atomica. Uno schema diverso da 1 è rifiutato e il
file non viene riscritto. Un permesso non più persistito chiede un nuovo
consenso e non ripiega mai sul vault privato.

## Radice del vault

| Percorso | Classe | Contenuto |
|---|---|---|
| `**/*.md` e altri formati registrati | utente | documenti |
| allegati e file sconosciuti | utente | contenuto da preservare |
| `.trash/` | utente | file cestinati |
| `.fub/` | servizio | stato, cache e storage namespaced |

Un file sconosciuto esiste anche se nessun provider lo riconosce. Non viene
eliminato né escluso da un backup senza una scelta esplicita.

I file `.<nome>.lock` sono compagni persistenti del protocollo di coordinamento
dello storage, anche quando si trovano nella radice o nel cestino. Non sono
contenuto utente né voci da svuotare e non vengono rimossi al rilascio del lock.
La forma riservata riguarda i file: `Cargo.lock` e i contenuti di directory con
nomi simili restano dati dell'utente.

## Stato del vault

| Percorso | Classe | Schema | Proprietario |
|---|---|---:|---|
| `.fub/settings.json` | autorevole | 1 | kernel/host impostazioni |
| `.fub/workspace.json` | autorevole | 1 | organizzazione |
| `.fub/journal.jsonl` | autorevole operativo | 1 | registro mutazioni |
| `.fub/mounts.json` | autorevole | 1 | kernel/host mount esterni espliciti |
| `.fub/drafts/` | autorevole | 1 | bozze non consolidate |
| `.fub/rename-recovery/*.json` | autorevole operativo | 1 | kernel/host rinomina |
| `.fub/data/entries.json` | derivata | 5 | anagrafe dei file |
| `.fub/data/trash/*.json` | sidecar | 1 | provenienza del cestino |
| `.fub/plugins/<id>/` | per-plugin | proprio | storage persistente namespaced |
| `.fub/plugins/fub.commands/archive-recovery.json` | autorevole operativo | 1 | `fub.commands` |

`properties.types` è un valore autorevole dentro `.fub/settings.json`. Il valore
ha un proprio schema JSON `{ "version": 1, "types": { ... } }`: separa la
dichiarazione per nome dai valori, che restano nel frontmatter, e dagli indici,
che sono ricostruibili. Una versione futura o un valore illeggibile non viene
riscritto durante la lettura; finché non è compreso, il kernel usa
l'interpretazione convenzionale e l'editor rifiuta di sovrascriverlo.
Gli intent di rinomina hanno un nome deterministico derivato da sorgente,
destinazione e revisione della preimmagine. Lo schema 1 conserva stato
(`active` o `cancelled`), path, preimmagine e riscritture dei backlink con la
revisione risultante attesa. L'intent viene pubblicato prima di spostare
side-data o file. Alla riapertura, dopo l'indicizzazione completa, l'host
classifica i byte osservati: riprende in avanti soltanto una preimmagine ancora
alla sorgente, completa le riscritture se la stessa preimmagine è già alla
destinazione e riprende all'indietro uno stato `cancelled`. Collisioni,
preimmagini cambiate o posizioni ambigue restano conflitti senza
sovrascrittura. Un record corrotto o con schema futuro resta sul disco e viene
segnalato senza impedire il recupero degli altri record validi.

`archive-recovery.json` conserva l'intero batch di `vault.archive`: ogni voce
ha sorgente, destinazione, preimmagine e stato `pending`, `done` o `conflict`.
Il comando valida tutte le preimmagini e le destinazioni prima della prima
mutazione, quindi pubblica il record. Dopo ogni rinomina ne aggiorna lo stato;
alla riapertura riconcilia anche il caso in cui il file sia stato spostato ma
lo stato non sia ancora stato scritto. Il record terminale viene rimosso. I
file compagni `*.lock` dello storage non sono intent e vengono ignorati dalla
scansione.

`mounts.json` è un oggetto JSON con `schema: 1` e `mounts`: ogni voce
contiene `mount` (`name`, `target` assoluto, `namespace`) e `identity`
(`volume`, `file`). `target` è il path reale, risolto una volta alla
registrazione: senza collegamenti negli antenati, nella forma di
`canonicalize` (su Windows quella estesa `\\?\`). Il namespace è l'identità
stabile di routing; non è un `DocId` del vault. L'assenza del file significa
nessun mount. Uno schema futuro, un file corrotto o duplicati strutturali
vengono rifiutati, non reinterpretati come registro vuoto né sovrascritti. Una singola destinazione assente, sostituita
o non più verificabile resta invece configurata ma inattiva: il vault apre,
pubblica una diagnostica e non espone quella rotta; `mount.remove` continua a
poterla eliminare senza toccare i byte esterni. Gli aggiornamenti fondono una
singola aggiunta/rimozione sotto il lock atomico dello storage; l'aggiunta
rivalida identità e componenti senza symlink prima e dopo il commit e annulla la
voce se la seconda verifica fallisce. Unmount modifica solo il registro, mai i
byte nella cartella esterna. I contenuti esterni non sono inclusi nello snapshot
globale del vault: il backup conserva il riferimento.

Il nome esatto delle chiavi sotto lo storage plugin appartiene al plugin.

## Storage dei plugin

Lo storage persistente usa una radice per id. Due esempi mostrano perché la
classificazione è per proprietario:

### Ricerca

L'indice Tantivy di `fub.search` è derivato. Una versione incompatibile può
essere eliminata e ricostruita dai documenti.

### Versioning

`fub.versioning` conserva:

```text
.fub/plugins/fub.versioning/
├── versions.json
└── <impronta>/
    ├── meta.json
    └── <timestamp>.<estensione>
```

`versions.json` è un indice ricostruibile. `meta.json` e gli snapshot sono
autorevoli: eliminarli perde la memoria delle versioni. Ogni nuova versione
pota le altre per fasce: tutte sotto le 24 ore, una per ora fino a 7 giorni,
una per giorno fino a 90. Oltre resta solo la più recente. Ogni `VersionRef`
nell'indice registra la dimensione in byte e l'impronta FNV-1a del contenuto.
Gli snapshot conservano i byte originali, anche per allegati binari, senza
convertire BOM o terminatori di riga. Il nome riprende l'estensione del file;
se manca, contiene soltanto il timestamp.

La lettura verifica che il `VersionRef` esista, che il blob sia leggibile e che
dimensione e impronta corrispondano ai byte dello snapshot. L'anteprima mostra
il testo quando è UTF-8, altrimenti indica la dimensione del contenuto binario.
`version.restore` usa sempre i byte originali, senza decodifica testuale.
Una verifica fallita non sovrascrive il documento corrente.

Se l'indice manca o non è leggibile, lo store lo ricostruisce dagli snapshot e
prova a ripubblicarlo. Un errore di scrittura del solo indice genera un avviso:
view e comandi possono ancora ricostruire e leggere la cronologia dai dati
autorevoli.

`version.restore` cattura la revisione del documento prima di leggere lo
snapshot e usa quella revisione per la scrittura condizionata. Il confronto e
scambio (CAS) impedisce agli writer cooperativi di sovrascrivere una modifica
intervenuta durante la lettura. Per gli writer esterni è best-effort: una
modifica già osservabile al confronto produce un conflitto. Il conflitto e gli
errori di lettura o confronto non sovrascrivono il documento corrente; una
preimmagine già fotografata resta conservata anche se il commit fallisce.
Sui file regolari sostituibili anche un errore di scrittura preserva i byte precedenti;
per symlink, hardlink o conteggio dei nomi non disponibile, la scrittura
in-place preserva l'identità ma un errore può lasciare i byte modificati.
Quando riesce, il ripristino è una scrittura normale: fotografa prima il
contenuto sostituito e, se il contenuto cambia, crea una nuova versione; quando
esiste una versione precedente, il comando dichiara anche il ripristino inverso.

Quindi `.fub/plugins/` non è né tutta cache né tutto dato autorevole.

## Cestino

Quando Fub cestina `Appunti/Nota.md`:

```text
.trash/Nota.md
.fub/data/trash/Nota.md.json
```

Il sidecar conserva provenienza e timbro. Se manca o non corrisponde, il file
resta ripristinabile con il fallback sicuro previsto; il contenuto non viene
scartato.

Il comando esplicito `trash.os` (`doc` obbligatorio) tenta invece il cestino
del sistema. Su Linux usa la directory Trash freedesktop sotto
`$XDG_DATA_HOME` oppure `$HOME/.local/share`; non crea una voce `.trash/`
nel vault quando il trasferimento OS riesce. L'esito del comando distingue
`os` da `internal_fallback` e, in quest'ultimo caso, specifica
`unsupported` o `unavailable`. Un backend non disponibile o un ambiente XDG
non valido lascia il file intatto per il percorso normale: `.trash/`, sidecar,
registro, indici ed eventi restano quelli della cancellazione interna. Su
Windows e macOS usano il fallback perché il backend OS segnala non supportato.
Il registro marca il trasferimento OS come non annullabile dai
comandi interni: il recupero avviene dal cestino del sistema.

## Versioni di schema

Una versione futura viene rifiutata quando interpretarla potrebbe perdere dati.

| Famiglia | Su incompatibilità |
|---|---|
| anagrafe e indice | elimina e ricostruisci |
| impostazioni, organizzazione, bozze | migra o rifiuta |
| versioni | migra o rifiuta gli snapshot; ricostruisci soltanto l'indice |
| sidecar del cestino | usa il fallback definito |
| diagnostica | rigenera |
| storage di terzi | applica la policy del plugin |

## Scrittura

I file autorevoli seguono:

- scrittura temporanea;
- flush quando richiesto dal formato;
- sostituzione atomica;
- lock di macchina quando più processi possono competere;
- nessuna riscrittura se il file di partenza non è stato letto in modo
  affidabile.

## Scrittore del vault

Un vault ha un solo processo scrittore alla volta. Il lock è un file fratello
della radice, `<cartella madre>/.<nome del vault>.writer.lock`, preso con un
`flock` esclusivo non bloccante (`LockFileEx` su Windows). Lo prende
`Host::open` prima della recovery degli snapshot e del mount, e lo rilascia la
chiusura della sessione dopo il teardown. App, CLI e host nativo del clipper non
ne prendono uno proprio: passano tutti dall'host.

Il file sta fuori dal vault perché l'applicazione di uno snapshot sostituisce la
radice con una rename e l'azzeramento della demo la cancella: un lock interno
cambierebbe inode e un secondo processo otterrebbe un lock diverso. Il file non
si rimuove mai. Un secondo processo riceve `Conflict` con la chiave
`host.vault.writer_busy`; la CLI la riporta come `busy` (exit code 5). Dentro
lo stesso host il lease è condiviso: riaprire un vault già aperto, o aprirlo in
due chiamate concorrenti, non si esclude da solo. Snapshot e azzeramento della
demo tengono il lease dalla chiusura alla riapertura.

## Snapshot globale offline

L'applicazione globale di uno snapshot è distinta dal backup per-file di
`fub.versioning` e dal drill indipendente dell'issue
[#7](https://github.com/Fubeo/Fub/issues/7). Lo scope completo comprende
documenti, allegati, file sconosciuti, `.trash/`, ogni voce autorevole sotto
`.fub/` e lo storage autorevole dei plugin. La configurazione macchina resta
fuori dal vault. Le cache dichiarate ricostruibili non entrano nel manifest:
`.fub/data/plugins/<id>/` è cache solo quando contiene `.fub-cache-root`;
altrimenti è storage autorevole legacy.

Il modulo `fub_kernel::snapshot` usa un manifest schema 1, ordinato per path
relativo normalizzato. Ogni entry registra classe, proprietario, schema quando
applicabile, dimensione e digest SHA-256. Il kernel non possiede il
`FormatRegistry`: documenti, allegati e sconosciuti usano una sola classe
`user`; settings/organizzazione/drafts/journal, cestino, sidecar e plugin hanno
classi proprie. Il preflight rifiuta versioni future, path assoluti o con
traversal, duplicati, symlink, file speciali, entry mancanti e mismatch di
dimensione o digest.

La base revision è il digest deterministico del manifest autorevole live.
L'applicazione richiede un vault chiuso/quiescente e una radice canonica priva
di symlink, prende un lock cooperativo stabile sibling, prepara uno staging
privato e ricontrolla la base revision
immediatamente prima del commit. Un record persistente coordina `prepare`,
`commit` e `finalize`: la root precedente resta in un contenitore `.old` finché
la nuova è pubblicata. La recovery startup riconosce solo schema, id e nomi
propri, completa o annulla la fase osservata e non cancella artefatti ignoti.
Se la root pubblicata non corrisponde al manifest atteso e la precedente è
ancora intera, la recovery rimette la precedente al suo posto e sposta la
pubblicata accanto, in un contenitore `.rejected` che non cancella: il vault
si riapre invece di restare bloccato.


Per lo schema 1 la pubblicazione ricrea il contenitore con directory POSIX
`0700` e file `0600`, anche se la sorgente aveva permessi più permissivi:
owner, ACL, xattr e bit executable non fanno parte del manifest e non vengono
preservati. Su Windows non c'è questa normalizzazione POSIX: ACL e proprietà
sono quelle con cui il filesystem crea lo staging (normalmente ereditate dal
parent), non sono rappresentate né garantite dallo snapshot.
Writer cooperativi ottengono all-or-old-or-new. Writer esterni, filesystem senza
rename o fsync durevoli e guasti che impediscono il rollback sono fuori dalla
garanzia universale; l'esito espone una necessità di recovery invece di fingere
atomicità. Alla riapertura le cache escluse sono invalidate e ricostruite.

I comandi dell'host `vault.snapshot.create` (`target`) e `vault.snapshot.apply`
(`source`, `backup`) portano questo protocollo nel registro dei comandi. Le
destinazioni sono path assoluti, nuovi e fuori dal vault. Entrambi chiudono il
vault, lavorano sotto il claim di applicazione e lo riaprono anche dopo un
errore, così la recovery dell'apertura completa o annulla la fase osservata.
Il ripristino legge e valida lo snapshot prima di chiudere il vault. Poi
cattura lo stato attuale e lo scrive in `backup`, e riallinea la base revision
dello snapshot su quella appena catturata prima di applicarlo. La prova a vuoto
esegue gli stessi controlli di destinazione e di lettura senza chiudere niente.
Dopo il ripristino la shell ricarica la finestra, perché ogni stato in memoria
appartiene al contenuto sostituito.

Il drill backup/restore dell'issue #7 resta una prova offline separata del
fixture storico e del restore completo con `Host`; non è l'applicatore globale
e il suo manifesto indipendente può mantenere l'impronta legacy prevista dal
drill. `fub.versioning::version.restore` resta invece una scrittura CAS di un
solo documento.

