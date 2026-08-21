# 0006 — Import/export come trait, non come codice dell'app

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.7 (primo giro) |
| **Commit** | `a138ada` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[PIANO.md](../PIANO.md)

---

- [x] **`ImportProvider`** (`can_handle(source) -> bool`,
  `import(source, request, host) -> Result<ImportReport>`) e
  **`ExportProvider`** (`targets() -> Vec<ExportTarget>`,
  `export(request, host)`), in `abi/transfer.rs` e rispecchiati nel WIT
  (`transfer`, `importer`, `exporter`, più due export del world: tutto additivo,
  la linea di base non si tocca).
- [x] **`ImportReport` nel contratto, e niente `MigrationPlan`**: il piano *è*
  il rapporto di una prova a vuoto (`ImportMode::Preview`). Log
  (`TransferNote { level, message, entry }`), esiti per documento
  (`ImportOutcome`) e politica dei duplicati (`ConflictPolicy`) stanno qui e non
  nel primo importer. Rollback e resume no: sono la
  [decisione 0011](../decisions/0011-il-lotto.md) + §15.2.
- [x] Primo cliente vero: `MarkdownImport`/`MarkdownExport` in
  `fub-format-markdown`, registrati nel `Workspace` (`register_import_provider`
  / `register_export_provider`) e provati end-to-end contro il kernel — preview
  che non scrive, tre politiche di conflitto, selezione per cartella e per
  query, export con e senza metadati, round-trip vault→artefatti→vault.

*Sblocca:* 17 (~120 voci), 6.3 (export PDF/Pandoc/Typst), 15.1 (BibTeX/CSL),
14.3 (email/EML), 11.4 (CSV/JSON).

**Fatto, con quattro decisioni che valgono per tutte e centoventi le voci.**

*Il confine è di byte, non di path.* Una sorgente arriva **già letta**
(`ImportSource { name, media_type, bytes }`) e un export esce come
`ExportArtifact { path, media_type, bytes }`, dove `path` è il posto *dentro
l'esito*. Chi apre il dialogo di sistema e chi posa i byte è l'host — che è già
l'unico a sapere dov'è il vault. La conseguenza è quella che conta: il capitolo
che in ogni altra applicazione tocca il filesystem più di tutti **non chiede
nessuna capacità filesystem**, e a M5 la sandbox non deve concedere niente. Un
`path: String` nella firma sarebbe stato il contrario: una porta da richiudere
con una major. Prezzo dichiarato: sorgente e artefatti stanno in memoria, e uno
`stream` al confine resta additivo.

*Il piano è il rapporto di una prova a vuoto.* 17.3 chiede preview, validation e
pre-migration report; la risposta non è un `MigrationPlan` gemello di
`ImportReport` — due tipi che dicono la stessa cosa in due momenti divergono al
primo campo aggiunto a uno solo — ma `ImportMode { Preview, Apply }`, con lo
stesso rapporto in uscita e la modalità dentro, così chi lo legge non deve
ricordarsi la domanda. Il rapporto non porta un conteggio (`documents` lo è già)
né un id di lotto: `changed()` nomina i documenti toccati, che è l'input di cui
il rollback avrà bisogno, e il rollback è la [decisione 0011](0011-il-lotto.md).

*L'errore è «non ho potuto cominciare».* Sorgente illeggibile o destinazione
ignota sono `PluginError`; un documento saltato per conflitto, una riga di CSV
malformata, un allegato che non c'è sono `ImportOutcome`/`TransferNote` dentro
un rapporto valido. Un import di 4000 note che ne perde 3 è riuscito con tre
problemi, e chiamarlo fallito costringerebbe ogni importer a inventarsi il
proprio modo di dirlo.

*L'import scrive, l'export legge, e si vede dalla firma.* `import` è `&mut self`
(17.3 chiede resume e retry: un provider che riprende ricorda — con `&self`
quella famiglia sarebbe chiusa dalla firma, che è il difetto imputato a
`ViewProvider` nel §2.4); `export` è `&self` con un host in sola lettura, quindi
il kernel lo serve sotto prestito **condiviso** come `render_view`: un export
lungo non mette in coda le letture dell'app. Il dispatch dell'import chiede
esplicitamente `can_handle` invece di dedurlo da un `BadArgs` come fa
`query_index`, perché una sorgente si riconosce **senza** provare a importarla —
e provare, qui, vuol dire scrivere. I byte stanno dentro `ImportSource` e non
solo nel parametro di `import` perché `.docx`, `.epub`, `.odt` e mezzo mondo dei
backup sono lo stesso contenitore zip: un dispatch sul solo nome sceglie il
provider sbagliato.

*Trovato per strada e chiuso:* `KernelHost::read_document`/`write_document`
**non validavano il `DocId`**. Fino a qui l'unico input esterno che diventava un
`DocId` passava dai comandi IPC, che lo sanitizzano; un importer invece nomina i
documenti a partire dal nome di una sorgente, cioè da una stringa che l'utente
non ha scritto — e `../../.ssh/authorized_keys` non sarebbe stato un `DocId`
fantasma, sarebbe stata una scrittura fuori dal vault. Ora il confine delle
capacità applica `valid_doc_id` e risponde `PermissionDenied` come fa `data_*`,
e `ImportSource::stem()` riduce il nome a un componente solo perché non ci si
arrivi per distrazione.

*Chiesta dall'import, e concessa:* `HostApi::free_name`. La convenzione D3
(`nome`, `nome 1`, …) la sa solo il vault, che conosce l'occupato in memoria
**e** sul disco; un importer che risolvesse `ConflictPolicy::Rename` rifacendola
darebbe nomi diversi da `create_note` e dal ripristino dal cestino. Con ~50
importer nel solo 17.1, l'alternativa erano cinquanta convenzioni. È una voce in
più nell'elenco della
[decisione 0013](../decisions/0013-elenco-delle-capacita.md), trovata come la
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) dice che si
trovano: da un cliente vero.

*Resta fuori, dichiarato:* **rollback e resume**
([decisione 0011](../decisions/0011-il-lotto.md) + §15.2: senza lotto e senza
journal, un `batch_id` qui sarebbe un campo che nessuno consuma — e un import di
N documenti emette oggi N eventi, che è esattamente il debito della
[decisione 0011](../decisions/0011-il-lotto.md)); il **lavoro lungo** (§9.1: un
import gira nel giro sincrono, quindi un vault Obsidian da 4 GiB non entra — e
non deve, finché un job non vede il vault); il **modello parsato** a un exporter
(§4.2: l'export markdown vuole la sorgente com'è, ma un export PDF/Typst
dovrebbe riparsare per conto proprio); i **contenitori** (zip, cartelle: una
sorgente per volta — la firma regge N documenti in un rapporto, il primo cliente
non ne ha bisogno); e la **superficie IPC**, perché senza il dialogo di sistema
sarebbero due comandi Tauri senza chiamanti — cioè la scorciatoia bespoke contro
cui è scritto il piano. La quarta copia del protocollo di dispatch nel
`Workspace` è il prezzo già previsto dal §7.2.
