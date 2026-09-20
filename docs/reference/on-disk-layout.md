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

Se la cartella di configurazione non è disponibile, l'host può lavorare in
memoria. Un file illeggibile non viene riscritto da uno stato vuoto.

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

## Radice del vault

| Percorso | Classe | Contenuto |
|---|---|---|
| `**/*.md` e altri formati registrati | utente | documenti |
| allegati e file sconosciuti | utente | contenuto da preservare |
| `.trash/` | utente | file cestinati |
| `.fub/` | servizio | stato, cache e storage namespaced |

Un file sconosciuto esiste anche se nessun provider lo riconosce. Non viene
eliminato né escluso da un backup senza una scelta esplicita.

## Stato del vault

| Percorso | Classe | Schema | Proprietario |
|---|---|---:|---|
| `.fub/settings.json` | autorevole | 1 | kernel/host impostazioni |
| `.fub/workspace.json` | autorevole | 1 | organizzazione |
| `.fub/journal.jsonl` | autorevole operativo | 1 | registro mutazioni |
| `.fub/drafts/` | autorevole | 1 | bozze non consolidate |
| `.fub/data/entries.json` | derivata | 5 | anagrafe dei file |
| `.fub/data/trash/*.json` | sidecar | 1 | provenienza del cestino |
| `.fub/plugins/<id>/` | per-plugin | proprio | storage persistente namespaced |

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
    └── <timestamp>.md
```

`versions.json` è un indice ricostruibile. `meta.json` e gli snapshot sono
autorevoli: eliminarli perde la memoria delle versioni. Ogni `VersionRef`
nell'indice registra la dimensione in byte e l'impronta FNV-1a del contenuto.
La lettura per anteprima o `version.restore` verifica che il `VersionRef`
esista, che il blob sia leggibile e che dimensione e impronta corrispondano ai
byte dello snapshot, prima di decodificarlo come UTF-8. Se anche una sola
verifica fallisce, l'operazione restituisce un errore senza scrivere il
documento corrente o l'indice.

`version.restore` cattura la revisione del documento prima di leggere lo
snapshot e usa quella revisione per la scrittura condizionata. Il confronto e
scambio (CAS) impedisce agli writer cooperativi di sovrascrivere una modifica
intervenuta durante la lettura. Per gli writer esterni è best-effort: una
modifica già osservabile al confronto produce un conflitto. Il conflitto e gli
errori di lettura o confronto non modificano documento e indice. Sui file
regolari sostituibili anche un errore di scrittura preserva i byte precedenti;
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

Il drill backup/restore dell'issue #7 resta una prova offline separata del
fixture storico e del restore completo con `Host`; non è l'applicatore globale
e il suo manifesto indipendente può mantenere l'impronta legacy prevista dal
drill. `fub.versioning::version.restore` resta invece una scrittura CAS di un
solo documento.

