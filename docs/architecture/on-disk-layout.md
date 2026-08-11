# Cosa Fub scrive sul disco

Questa è la mappa di **chi scrive dove**, e per ogni file dice classe, versione
di schema e disciplina di scrittura. È la metà documentale del
[§15.4](../roadmap/15-il-disco.md); il perché sta nella [decisione
0048](../decisions/0048-una-radice-sola.md).

[← architecture/](README.md) · [il colpo d'occhio](mappa-visuale.md) · [i tre
numeri di versione](../versionamento.md)

## Chi ci arriva

Sotto la linea del vault — cioè dentro la cartella dei documenti — i byte
passano da un solo supporto, `VaultStorage` (`kernel/storage.rs`). È la
[0064](../decisions/0064-il-supporto-sta-sotto.md).

Ci passano:
- Il vault.
- Il cestino e i suoi sidecar (i file di metadati che gli stanno accanto).
- Lo spazio dati dei plugin.
- Le tre righe di `.fub/`: `workspace.json`, `settings.json` ed `entries.json`.

Passando di lì diventano atomici, ed è la
[0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md): una scrittura o c'è
o non c'è.

Dentro un workspace il supporto è **uno**, condiviso fra il vault, i tre store e
il registro delle mutazioni. Fuori dal vault i file sono della macchina, e
l'atomicità la dà `write_atomic`.

## La regola

**Tutti i dati scritti da Fub dentro un vault si trovano in una radice sola:
`.fub/`.** La profondità definisce la classe:

| Dove | Classe | Cosa vuol dire |
|---|---|---|
| `<vault>/.fub/` | **autorevole** | Se si perde, è perso. Chi non riesce a leggerlo tiene il file che c'è. |
| `<vault>/.fub/data/` | **derivato** | Si rifà rileggendo il vault. Chi non riesce a leggerlo lo rifà in silenzio. |

`<vault>/.trash/` sta fuori dalla radice apposta: è dell'utente, e lo
**condivide con Obsidian** (`kernel/vault.rs`, `TRASH_DIR`).

La classe il contratto non la dice: `data_write` non la guarda, e oggi si legge
solo dal path. Il derivato diventerà esplicito con una seconda famiglia di
capacità — è il residuo del §15.4, e ancora non c'è. Fino ad allora la
definizione operativa è questa tabella, più le tre eccezioni qui sotto.

## Dentro il vault

| Posto | Chi lo scrive | Classe | Schema | Scrittura |
|---|---|---|---|---|
| `.fub/workspace.json` | `kernel/organization.rs` | autorevole | 1 | `VaultStorage::write`, conserva il file esistente in caso di errore di lettura |
| `.fub/settings.json` | `kernel/settings.rs` | autorevole | 1 | `VaultStorage::write`; esclude le chiavi di scope `machine` |
| `.fub/journal.jsonl` | `kernel/journal.rs` | autorevole | 1, **su ogni riga** | `VaultStorage::append` — aggiunge in coda, omettendo `fsync`, **dopo** il successo della mutazione ([0067](../decisions/0067-il-registro-di-cio-che-e-successo.md)) |
| `.fub/drafts/<documento>.json` | `kernel/drafts.rs` | autorevole | 1, **per bozza** | `VaultStorage::write` — produce una bozza per file, rendendo ogni salvataggio automatico una *scrittura* diretta ([0088](../decisions/0088-cio-che-non-e-ancora-successo.md)) |
| `.fub/data/entries.json` | `kernel/entries.rs` | derivato | 2 | `VaultStorage::write` |
| `.fub/data/diagnostics.json` | `kernel/workspace.rs` (`vault.diagnostic-bundle`) | derivato | 1 | `VaultStorage::write` — copia fatti esterni e permette la sua distruzione |
| `.fub/data/trash/<nome>.json` | `kernel/vault.rs` | **classe indipendente** (sotto) | 1 | `VaultStorage::write`, best-effort |
| `.fub/data/plugins/<id>/…` | possessori di `DataWrite` | dichiarata derivata, **di fatto entrambe** (sotto) | per plugin | `VaultStorage::write` (`kernel/host/kernel.rs`) |
| `.fub/data/plugins/fub.search/` | `features/search.rs` | derivato | 5 | l'indice tantivy e un `manifest.json` |
| `.fub/data/plugins/fub.versioning/` | `features/versioning.rs` | **autorevole** (sotto) | 1 | `versions.json` deriva dallo store, mentre gli snapshot sono autorevoli |
| `.fub/data/plugins/<id>/doc/<documento>/…` | regola generale | ereditata dal plugin | del plugin | lo stato per-documento della [0044](../decisions/0044-lo-stato-per-documento.md): il posto risiede in `abi/rules/doc_data.rs`. Il kernel migra i dati durante il rename. Questo include i rename ad app chiusa, riconosciuti dall'impronta alla riapertura ([0099](../decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md)) |
| `.trash/` | `kernel/vault.rs` | **contenuto dell'utente** | — | un rename, condiviso con Obsidian |

## Cosa c'è dentro il registro delle mutazioni

Il registro delle mutazioni scrive una riga per ogni azione dell'utente.

### Contenuto del registro
Ogni riga dice:
- **Quando**: il timestamp.
- **Chi**: l'`Origin` intera, cioè chi l'ha chiesto.
- **Dentro quale lotto**.
- **Cosa**: creazione, salvataggio, modifica, cestinamento, ripristino o
  rinomina di una nota.

Quello che **non** c'è è il testo cancellato o sostituito. Fino alla
[0103](../decisions/0103-un-registro-dice-cosa-e-successo.md) una modifica si
portava dietro i byte che l'utente aveva sostituito; adesso resta solo
l'**impronta**: lo span toccato, e quanti byte c'erano prima.

Così un audit risponde a *quando, chi, dove e quanto*, e il contenuto storico lo
tiene il versioning. `JournalOp::is_invertible` dice a voce alta quali
operazioni tornano indietro: le quattro strutturali sì, le due testuali no.

### Regole di conservazione
Path e tempi restano in chiaro: senza, il registro non servirebbe a niente. A
decidere per quanto restano sono due criteri:

1. **Una finestra di giorni (`journal.retention.days`)**. I record più vecchi
   decadono. Zero vuol dire per sempre, ed è il default: è un dato autorevole.
2. **Un tetto di diecimila record**, che morde quando si scrive molto.

Le potature non sono due. Si prende il taglio più avanti fra i due criteri, e da
lì si scorre una volta sola fino al confine di lotto.

I record strani:
- **Datati ma illeggibili**: si giudicano come gli altri.
- **Senza data**: fermano la scansione, perché buttare un dato ignoto è peggio
  che tenerlo.

### Svuotamento manuale
Il comando `vault.clear-journal` (`kernel/maintenance.rs`) butta tutto, comprese
le righe che la potatura salterebbe. È l'unico comando di manutenzione
irreversibile: gli altri tre lasciano i dati dove sono. Serve un gesto esplicito
dell'utente, e questo lo distingue dalla potatura automatica.

## Fuori dal vault

La configurazione della macchina sta nella cartella della macchina
(`host/config.rs`: `config_dir`, `FUB_CONFIG_DIR`, o la modalità portable
accanto all'eseguibile). Riguarda l'installazione locale, non il vault, e per
questo sta fuori.

| Posto | Chi lo scrive | Classe | Schema | Scrittura |
|---|---|---|---|---|
| `settings.json` | `kernel/settings.rs` | autorevole | 1 | Atomica: si rilegge sotto lock e si riscrive. |
| `vaults.json` | `host/vaults.rs` | autorevole | 1 | Atomica, sotto lock. È il registro dei vault conosciuti ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)). |
| `view-state.json` | `kernel/viewstate.rs` | autorevole | 1 | Atomica, sotto lock. È dove si è fermato ogni esemplare di vista ([0037](../decisions/0037-lo-stato-di-vista.md)). |
| `.<nome>.lock` | `kernel/storage.rs` | indipendente | — | Un compagno di lock per ciascuno dei tre. È vuoto: serve solo ad aprirlo ([0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md)). |

Questi tre file si aggiornano di continuo, e due Fub aperti sulla stessa
cartella ne tengono due copie in memoria. Riscriverli e basta cancellerebbe le
modifiche dell'altro — anche riscrivendoli in modo atomico, perché atomico vuol
dire che il file nuovo sostituisce il vecchio intero.

Per questo passano da `update_atomic` (`kernel/storage.rs`), che fa tre cose:
1. Rilegge sotto lock.
2. Fonde i cambiamenti.
3. Restituisce al chiamante lo stato fuso.

Il lock sta su un file **accanto**, non sul file stesso: la scrittura atomica
cambia l'inode (il numero con cui il sistema identifica il file), e un lock
preso sul file sostituito non tratterrebbe più nessuno.

## Le tre righe che contraddicono la regola

Le eccezioni stanno scritte qui perché una mappa che le nasconde è una mappa
sbagliata. Sono anche l'elenco di cosa correggere nella seconda metà del §15.4.

Il registro delle mutazioni **non** è fra loro, e per poco. Il piano in
`todo.md` lo metteva in `.fub/data/`, cioè fra i derivati — che è esattamente il
posto sbagliato in cui stanno gli snapshot del versioning, l'eccezione numero
uno. Si è scritto un livello più su, dove la sua classe è quella vera, e la
quarta eccezione non è nata.

Le tre di oggi:

1. **Gli snapshot del versioning sembrano derivati e sono autorevoli.** Uno
   stato passato non si ricostruisce da nessuna parte. Stanno lì perché lo
   spazio dati di un plugin è uno solo. Li sistemerà la famiglia `cache_*`: i
   `data_*` salgono di un livello e diventano autorevoli, la ricerca — che
   derivata lo è davvero — scende in `cache_*` e si può rifare.
2. **Il sidecar del cestino non sta in nessuna delle due classi.** Perderlo
   costa poco: `progetti/Nota.md` ripristinato torna nella radice invece che in
   `progetti/`. Si chiama **degrado garbato** (`kernel/vault.rs`), ed è quello
   che fa Obsidian con i file cestinati senza sidecar.
3. ~~**I dati di `data_write` non erano atomici**~~ — **questa eccezione non c'è
   più.** Prima un crash a metà scrittura troncava anche un file autorevole,
   snapshot compresi. La [0064](../decisions/0064-il-supporto-sta-sotto.md) ha
   ridotto cinque punti di scrittura a **uno**, e la
   [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) ha reso quell'uno
   atomico: oggi `VaultStorage::write` lo è senza che nessuno lo chieda. È il
   motivo per cui il §15.1 veniva prima del §15.2.

**L'indice di ricerca passa di fianco al supporto.** `plugin_data_dir` dà a
tantivy una cartella vera del filesystem, ed è un limite accettato della 0064:
quelle scritture non sono atomiche e non saranno cifrate. Su un dato derivato
non fa danno, ma segna fin dove arriverà il supporto cifrato.

## Il nome di prima

Prima della [0048](../decisions/0048-una-radice-sola.md) le radici dentro il
vault erano **due**: una per l'autorevole e una, separata, per il derivato.
Adesso è **una**, ed è quella descritta qui sopra.

I vecchi nomi non sono tradotti da nessuna parte. Il kernel aveva un rename
automatico per i vault di prima, ed è stato tolto insieme al vecchio nome del
progetto: fuori da questa macchina quei vault sono zero, e tenere la migrazione
avrebbe voluto dire tenere per sempre anche il nome vecchio.

Da qui la regola per i cambi di layout futuri: **prima della pubblicazione una
migrazione è facoltativa, dopo è obbligatoria.** Cambia chi paga. Prima del
rilascio le cartelle le sposta chi sviluppa; dopo, le migrazioni le subisce chi
usa l'app.

## Cosa manca attualmente

Queste righe la tabella non ce l'ha ancora. Ognuna ha già la sua voce aperta:
- Temi e snippet (§6.2).
- Plugin installati da file (§20.2).
- Il buffer di crash
  ([§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery)). È l'unica voce
  di questo elenco che una riga in tabella ce l'ha già in parte: il suo journal.
- Thumbnail e cache derivate (§14.1).
- I backup (§18.2).
- I layout salvati (§11.2).

**Il posto si sceglie da questa tabella, non imitando l'ultimo file che si è
guardato.** Ognuna aggiungerà una riga con la sua classe, la sua versione di
schema (§15.3) e la sua disciplina di scrittura.
