# Cosa Fub scrive sul disco

Questa è la mappa di **chi scrive dove**. Mostra la classe, la versione di schema e la disciplina di scrittura per ogni file. Questo documento è la metà documentale del [§15.4](../roadmap/15-il-disco.md). La sua motivazione è spiegata nella [decisione 0048](../decisions/0048-una-radice-sola.md).

[← architecture/](README.md) · [il colpo d'occhio](mappa-visuale.md) · [i tre numeri di versione](../versionamento.md)

## Chi ci arriva

Il `VaultStorage` (`kernel/storage.rs`) è un supporto solo per i byte sotto la linea del vault (la cartella principale dei documenti). Questo concetto è spiegato nella [0064](../decisions/0064-il-supporto-sta-sotto.md).

Il supporto gestisce:
- Il vault.
- Il cestino e i suoi sidecar (file di metadati aggiuntivi).
- Lo spazio dati dei plugin (estensioni funzionali).
- Le tre righe di `.fub/`: `workspace.json`, `settings.json` ed `entries.json`.

Questi file usano il supporto in base alla [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md). Questa decisione garantisce la loro atomicità.

Dentro un workspace (lo spazio di lavoro) il supporto è **uno**. Esso è condiviso tra il vault, i tre store e il registro delle mutazioni. Fuori dal vault i file appartengono alla macchina e la funzione `write_atomic` gestisce la loro atomicità.

## La regola

**Tutti i dati scritti da Fub dentro un vault si trovano in una radice sola: `.fub/`.** La profondità definisce la classe:

| Dove | Classe | Cosa vuol dire |
|---|---|---|
| `<vault>/.fub/` | **autorevole** | Il file è irrecuperabile in caso di perdita. I lettori bloccati mantengono il file esistente. |
| `<vault>/.fub/data/` | **derivato** | Il sistema ricrea il file leggendo il vault. I lettori bloccati ricreano il file in modo silenzioso. |

La cartella `<vault>/.trash/` resta fuori dalla radice. Questo cestino appartiene all'utente ed è **condiviso con Obsidian** (`kernel/vault.rs`, `TRASH_DIR`). La cartella contiene i file eliminati dall'utente.

Il contratto omette la classe. La funzione `data_write` ignora questo attributo. Il path rappresenta l'unico indicatore attuale della classe. Il sistema userà una seconda famiglia di capacità per rendere esplicito il derivato. Questa modifica rappresenta il residuo del §15.4 e aspetta l'implementazione. Nel frattempo, questa tabella funge da definizione operativa. Le tre righe di eccezioni sono descritte nelle sezioni successive.

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
| `.fub/data/plugins/<id>/…` | possessori di `DataWrite` | dichiarata derivata, **di fatto entrambe** (sotto) | per plugin | `VaultStorage::write` (`host/kernel.rs`) |
| `.fub/data/plugins/fub.search/` | `features/search.rs` | derivato | 5 | l'indice tantivy e un `manifest.json` |
| `.fub/data/plugins/fub.versioning/` | `features/versioning.rs` | **autorevole** (sotto) | 1 | `versions.json` deriva dallo store, mentre gli snapshot sono autorevoli |
| `.fub/data/plugins/<id>/doc/<documento>/…` | regola generale | ereditata dal plugin | del plugin | lo stato per-documento della [0044](../decisions/0044-lo-stato-per-documento.md): il posto risiede in `abi/rules/doc_data.rs`. Il kernel migra i dati durante il rename. Questo include i rename ad app chiusa, riconosciuti dall'impronta alla riapertura ([0099](../decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md)) |
| `.trash/` | `kernel/vault.rs` | **contenuto dell'utente** | — | un rename, condiviso con Obsidian |

## Cosa c'è dentro il registro delle mutazioni

Il registro delle mutazioni documenta le azioni dell'utente riga per riga. Il suo contenuto segue una regola scritta.

### Contenuto del registro
Il registro memorizza i dettagli degli eventi:
- **Timestamp**: quando è successo.
- **Autore**: chi l'ha chiesto (l'`Origin` intera).
- **Gruppo**: dentro quale lotto.
- **Azione**: creazione, salvataggio, modifica, cestinamento, ripristino o rinomina di una nota.

Il registro esclude il testo eliminato o sostituito. Fino alla [0103](../decisions/0103-un-registro-dice-cosa-e-successo.md), la modifica includeva i byte sostituiti dall'utente. Attualmente il registro salva solo l'**impronta**:
- Lo span toccato.
- La quantità di byte presenti in precedenza.

Un audit trova risposte su *quando, chi, dove e quanto*. Il sistema sposta la conservazione dei contenuti storici nel versioning (il sistema di controllo delle versioni). `JournalOp::is_invertible` identifica le operazioni invertibili esplicitamente. Le quattro varianti strutturali ammettono l'inversione. Le due varianti testuali impediscono l'inversione diretta.

### Regole di conservazione
Il registro mantiene i path e i tempi in chiaro per garantire la sua funzione. L'utente definisce la durata della conservazione tramite due criteri:

1. **Finestra temporale (`journal.retention.days`)**: Definisce i giorni di conservazione. I record oltre questa finestra decadono. Il valore zero indica una conservazione permanente. Questo rappresenta l'impostazione predefinita per un dato autorevole.
2. **Limite strutturale**: Fissa il tetto a diecimila record. Questo limite dipende dal volume delle scritture.

Il sistema evita l'esecuzione di due potature separate. Seleziona il taglio più avanzato tra i due criteri. Da quel punto, scorre una volta sola fino al confine di lotto.

Gestione dei record anomali:
- **Record datati ma illeggibili**: Subiscono la valutazione standard.
- **Record senza data**: Bloccano la scansione per evitare l'eliminazione di dati ignoti.

### Svuotamento manuale
L'utente può usare il comando `vault.clear-journal` (`kernel/maintenance.rs`). Questo comando distrugge tutti i record intenzionalmente. Elimina anche le righe ignorate dalla potatura standard. È l'unico comando di manutenzione irreversibile. Gli altri tre comandi di manutenzione mantengono i dati intatti. Lo svuotamento richiede un gesto esplicito dell'utente, differenziandosi dalla potatura automatica.

## Fuori dal vault

La configurazione risiede nella cartella della macchina (`host/config.rs`: `config_dir`, `FUB_CONFIG_DIR`, o la modalità portable vicino all'eseguibile). Questa cartella contiene i dati legati all'installazione locale. Questi file restano separati dal vault.

| Posto | Chi lo scrive | Classe | Schema | Scrittura |
|---|---|---|---|---|
| `settings.json` | `kernel/settings.rs` | autorevole | 1 | Atomica. Il sistema aggiorna il file rileggendolo sotto lock. |
| `vaults.json` | `host/vaults.rs` | autorevole | 1 | Atomica. Il sistema aggiorna il registro dei vault conosciuti sotto lock ([0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)). |
| `view-state.json` | `kernel/viewstate.rs` | autorevole | 1 | Atomica. Il sistema salva la posizione dell'esemplare di vista sotto lock ([0037](../decisions/0037-lo-stato-di-vista.md)). |
| `.<nome>.lock` | `kernel/storage.rs` | indipendente | — | Compagno di lock per ciascuno dei tre file. Il file risulta vuoto e serve esclusivamente per l'apertura controllata ([0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md)). |

I tre file richiedono un aggiornamento continuo. Due installazioni di Fub sulla stessa cartella mantengono copie separate in memoria. Una semplice riscrittura cancellerebbe le modifiche parallele. Una scrittura atomica omette questa protezione a causa della sostituzione integrale del file. 

Le modifiche passano da `update_atomic` (`kernel/storage.rs`). Questa funzione esegue tre passi:
1. Rilegge i dati sotto lock.
2. Fonde i cambiamenti.
3. Restituisce lo stato fuso al chiamante.

Il lock risiede su un file adiacente. La scrittura atomica sostituisce l'inode (l'identificatore del file nel sistema). Un lock sul file rimpiazzato consentirebbe l'accesso simultaneo.

## Le tre righe che contraddicono la regola

Questo documento espone apertamente le eccezioni per garantire una mappa accurata. Questo elenco definisce le correzioni necessarie per la seconda metà del §15.4.

Il registro delle mutazioni rispetta la regola generale. Il suo sviluppo ha seguito questa tabella fin dall'inizio. Il piano originale in `todo.md` suggeriva `.fub/data/`. Questa scelta avrebbe trattato il registro come un file derivato. Gli snapshot del versioning (l'eccezione numero uno qui sotto) rientrano esattamente in questa descrizione. Tuttavia, il registro risiede un livello superiore per mantenere la sua natura autorevole, evitando di generare una quarta eccezione.

Ecco le tre eccezioni attuali:

1. **Gli snapshot del versioning appaiono come derivati pur essendo autorevoli.** La ricostruzione di stati passati risulta impossibile. La loro posizione dipende dallo spazio dati del plugin, che è uno solo. L'introduzione della famiglia `cache_*` risolverà il problema. I dati `data_*` diventeranno autorevoli salendo di un livello. La ricerca, essendo derivata, si sposterà in `cache_*` e permetterà la ricostruzione.
2. **Il sidecar del cestino appartiene a una classe mista, eludendo le due classi standard.** La sua perdita comporta conseguenze minori. Il ripristino di `progetti/Nota.md` lo sposta nella radice anziché in `progetti/`. Questo meccanismo si chiama **degrado garbato** (`kernel/vault.rs`). Corrisponde al comportamento di Obsidian, il quale gestisce i file cestinati privi di sidecar.
3. ~~**I dati di `data_write` mancano di scrittura atomica**~~ — **Questa terza eccezione appartiene al passato.** Prima, un crash durante la scrittura troncava i file autorevoli come gli snapshot. La decisione [0064](../decisions/0064-il-supporto-sta-sotto.md) ha centralizzato i cinque punti vulnerabili in **uno** solo. La decisione [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) ha implementato la soluzione: `VaultStorage::write` assicura l'atomicità in modo automatico. Questa evoluzione spiega la priorità del §15.1 rispetto al §15.2.

**L'indice di ricerca evita il passaggio standard.** La funzione `plugin_data_dir` fornisce a tantivy (il motore di ricerca) una cartella fisica del filesystem. Questo rappresenta un limite accettato della 0064. Queste scritture perdono l'atomicità e la futura cifratura. Questa mancanza risulta innocua per un dato derivato, ma delimita i confini del supporto cifrato.

## Il nome di prima

Il sistema usava **due** radici dentro il vault (una per l'autorevole e una, separata, per il derivato) prima della [0048](../decisions/0048-una-radice-sola.md). Attualmente ne esiste **una**, descritta nelle sezioni precedenti.

Il sistema omette le traduzioni dei vecchi nomi. Il kernel (il nucleo del sistema) gestiva un rename automatico per i vault precedenti. Questo codice risulta rimosso insieme al vecchio nome del progetto. Il vecchio formato riguarda zero vault esterni a questa macchina. Mantenere una migrazione inutile comporterebbe la conservazione di un nome obsoleto per sempre.

Questo stabilisce una regola chiara per i futuri cambi di layout: **una migrazione di layout resta facoltativa prima della pubblicazione del progetto, diventando obbligatoria successivamente.** Questa distinzione riflette la responsabilità delle modifiche. Gli sviluppatori spostano le cartelle prima del rilascio. Gli utenti affrontano le migrazioni dopo la pubblicazione.

## Cosa manca attualmente

La tabella integrerà nuovi elementi in futuro. Ogni elemento possiede una voce specifica:
- Temi e snippet (§6.2).
- Plugin installati da file (§20.2).
- Il buffer di crash ([§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery)). Il suo journal esiste già come prima riga convertita di questo elenco ad aver guadagnato una riga nella tabella.
- Thumbnail e cache derivate (§14.1).
- I backup (§18.2).
- I layout salvati (§11.2).

**Ogni nuovo elemento definisce la sua posizione tramite questa tabella, evitando l'imitazione.** Ciascun elemento aggiungerà una riga contenente la propria classe, la versione di schema (§15.3) e la disciplina di scrittura.
