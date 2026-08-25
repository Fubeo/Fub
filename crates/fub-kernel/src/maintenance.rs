//! I **comandi che solo il kernel può eseguire sul vault** (§15.2): rifare il
//! derivato, raccogliere ciò che è rimasto indietro, mettere in un file ciò che
//! serve per chiedere aiuto, e svuotare il registro delle modifiche.
//!
//! # Perché sono comandi del registro, e non comandi dell'app
//!
//! Perché è ciò che la voce chiedeva, ed è la scelta giusta per la ragione della
//! [0009](../../../docs/decisions/README.md): un'azione
//! dichiarata una volta la trovano **tutti** — la palette, una scorciatoia che
//! l'utente si rimappa, una macro, la CLI del §27.1, il centro di comando.
//! Cablarli come comandi Tauri li avrebbe resi raggiungibili da una sola
//! superficie, che è precisamente la forma d'errore del §16.6. E la scorciatoia
//! non gliela dobbiamo dichiarare noi: il registro fabbrica una chiave di
//! impostazione per ogni comando (`register_command_provider`), quindi
//! «rimappa *questo*» è vero per costruzione anche per questi tre.
//!
//! # Perché li esegue il kernel, e non un `CommandProvider` che vive fuori
//!
//! Questa è la decisione di cui il modulo aveva bisogno, ed è la
//! [0086](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
//! generalizzata. Là si era imparato che un comando scritto in `fub-features`
//! non può toccare lo stato di vista, perché il proprietario non è un parametro:
//! **non ci arriva**. Qui succede lo stesso per tre volte, e per un motivo più
//! forte di un recinto: ciò che questi comandi fanno non sta sull'`HostApi`
//! affatto. Rifare l'indice, camminare il disco, leggere il registro di ciò che
//! è successo — nessuna di queste è una capacità, e nessuna deve diventarlo:
//! aggiungerla vorrebbe dire dare a **ogni** plugin montato il potere di
//! ributtare l'indice del vault, per servire tre comandi che sono nostri.
//!
//! La forma che ne esce è la regola riusabile, e vale la pena dirla in una riga:
//! **la dichiarazione sta nel registro, l'esecuzione sta dove sta il potere.**
//! Le `CommandSpec` di questo modulo passano dalla porta di tutti — stesso
//! `admit`, stessa convalida degli argomenti, stessa chiave di scorciatoia,
//! stesso posto negli elenchi —, e quando l'id è di questo provider il
//! workspace esegue da sé invece di prestare un `HostApi` che non basterebbe.
//! Il costo dichiarato è che [`Maintenance::invoke`] non viene mai chiamata, ed
//! è scritto lì sopra invece di essere lasciato scoprire a chi legge.
//!
//! # I tre, e cosa NON fanno
//!
//! - `vault.rebuild-index` — butta il **derivato** e lo rifà (anagrafe,
//!   grafo, indici). È l'operazione sicura per definizione: ciò che tocca è
//!   ricostruibile per classe ([0048](../../../docs/decisions/0188-identita-path-e-rename.md)),
//!   quindi non c'è niente da confermare e niente da annullare.
//! - `vault.repair` — ciò che il rebuild **non** fa: raccoglie gli spazi
//!   per-documento rimasti orfani (§13.2) e dice ciò che non può riparare da sé.
//!   È la riga che tiene i due comandi separati invece di dargli lo stesso
//!   corpo con due nomi.
//! - `vault.diagnostic-bundle` — scrive in un file ciò che serve per capire un
//!   guasto: com'è messo il vault, cosa non si è letto, cosa è rimasto non
//!   salvato, quali problemi trova il controllo di salute. Il file è un
//!   **derivato** e sta sotto `.fub/data/`, perché si può buttare — è una copia
//!   di fatti che stanno altrove.
//!
//! Cosa nessuno dei tre fa: **toccare le note**. La manutenzione qui dentro
//! ripara ciò che Fub si è costruito, non ciò che l'utente ha scritto; un
//! comando che «aggiusta» un documento è un'altra cosa e ha un'altra voce
//! (7.2). È anche la ragione per cui tutti e tre si dichiarano reversibili: non
//! c'è niente da tornare indietro, perché non si è perso niente.
//!
//! # Il quarto, che invece perde apposta
//!
//! - `vault.clear-journal` — svuota `.fub/journal.jsonl`. È l'unico di questo
//!   modulo che **si dichiara irreversibile**, e la riga qui sopra dice perché
//!   la differenza conta: gli altri tre non perdono niente, questo perde
//!   esattamente ciò che gli si chiede di perdere.
//!
//! Sta qui e non fra i comandi di `fub-features` per la regola di questo modulo
//! letta al contrario: il registro non è sull'`HostApi` e non deve diventarci —
//! un potere che serve a un gesto dell'utente non si concede a ogni plugin
//! montato per poterglielo servire. Ed è **un gesto dell'utente** e non
//! manutenzione: la 0086 ha stabilito che per un dato di questa specie chi lo
//! dichiara non è chi lo può togliere, e fino alla
//! [0103](../../../docs/decisions/0184-eventi-accodati-e-job.md) il
//! journal era l'unico dato dell'utente dentro il vault che **nessun gesto
//! dell'utente raggiungeva**.

use fub_abi::command::{CommandReach, CommandScope, CommandSpec};
use fub_abi::schema::SchemaVersion;
use fub_abi::text::Text;

/// Id del provider: lo spazio dati e la registrazione, come per gli altri.
pub const MAINTENANCE_ID: &str = "fub.maintenance";

/// Rifà il derivato del vault.
pub const VAULT_REBUILD_INDEX: &str = "vault.rebuild-index";
/// Raccoglie ciò che è rimasto indietro, e dice cosa non può riparare.
pub const VAULT_REPAIR: &str = "vault.repair";
/// Scrive un file con ciò che serve per capire un guasto.
pub const VAULT_DIAGNOSTIC_BUNDLE: &str = "vault.diagnostic-bundle";
/// Svuota il registro delle modifiche (§23.9). L'unico che perde qualcosa.
pub const VAULT_CLEAR_JOURNAL: &str = "vault.clear-journal";

/// Le chiavi delle frasi, nel catalogo di chi le ha scritte (0040).
pub(crate) const T_REBUILD_TITLE: &str = "cmd.vault.rebuild-index.title";
pub(crate) const T_REBUILD_DESC: &str = "cmd.vault.rebuild-index.desc";
pub(crate) const T_REPAIR_TITLE: &str = "cmd.vault.repair.title";
pub(crate) const T_REPAIR_DESC: &str = "cmd.vault.repair.desc";
pub(crate) const T_BUNDLE_TITLE: &str = "cmd.vault.diagnostic-bundle.title";
pub(crate) const T_BUNDLE_DESC: &str = "cmd.vault.diagnostic-bundle.desc";
pub(crate) const T_CLEAR_JOURNAL_TITLE: &str = "cmd.vault.clear-journal.title";
pub(crate) const T_CLEAR_JOURNAL_DESC: &str = "cmd.vault.clear-journal.desc";

/// Le frasi dell'**esito**, e i nomi dei loro argomenti.
///
/// Chiavi e non stringhe composte a pezzi: una frase costruita concatenando
/// spezzoni tradotti sta in piedi in italiano e cade nella lingua dopo, dove
/// l'ordine delle parti è un altro (0040). L'esito parziale della riparazione è
/// quindi una **chiave sua**, non la prima con tre code appese.
pub(crate) const T_REBUILT: &str = "cmd.vault.rebuild-index.done";
pub(crate) const T_REPAIRED: &str = "cmd.vault.repair.done";
pub(crate) const T_REPAIRED_PARZIALE: &str = "cmd.vault.repair.done-parziale";
pub(crate) const T_BUNDLE_WRITTEN: &str = "cmd.vault.diagnostic-bundle.done";
pub(crate) const T_JOURNAL_CLEARED: &str = "cmd.vault.clear-journal.done";
/// Il **piano** di uno svuotamento: quante righe cadranno.
///
/// Ce l'ha solo lui dei quattro, e non è un di più: gli altri tre in prova non
/// hanno niente da mostrare perché non perdono niente, e chi approva questo deve
/// poter vedere il conto di ciò che sta per sparire.
pub(crate) const T_JOURNAL_PLAN: &str = "cmd.vault.clear-journal.plan";

pub(crate) const A_DOCS: &str = "docs";
pub(crate) const A_ENTRIES: &str = "entries";
pub(crate) const A_SKIPPED: &str = "skipped";
pub(crate) const A_COLLECTED: &str = "collected";
pub(crate) const A_LOST: &str = "lost";
pub(crate) const A_UNREAD: &str = "unread";
pub(crate) const A_ORPHANS: &str = "orphans";
pub(crate) const A_PATH: &str = "path";
pub(crate) const A_LINES: &str = "lines";

/// Il provider che **dichiara** i tre comandi.
///
/// Non li esegue: vedi il § in testa al modulo.
pub struct Maintenance;

impl Maintenance {
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(VAULT_REBUILD_INDEX, Text::key(T_REBUILD_TITLE))
                .describing(Text::key(T_REBUILD_DESC))
                // Scrive — rifà l'anagrafe sul disco — ma non tocca una nota, e
                // ciò che rifà è derivato: reversibile perché non si perde
                // niente, non perché ci sia un annulla.
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            CommandSpec::new(VAULT_REPAIR, Text::key(T_REPAIR_TITLE))
                .describing(Text::key(T_REPAIR_DESC))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            CommandSpec::new(VAULT_DIAGNOSTIC_BUNDLE, Text::key(T_BUNDLE_TITLE))
                .describing(Text::key(T_BUNDLE_DESC))
                // Scrive **un file**, e quel file è un derivato in `.fub/data/`.
                // Il raggio è la sessione e non il vault: chi decide se
                // chiedere conferma confronta i raggi, e questo non tocca niente
                // di ciò che l'utente ha scritto.
                .with_scope(CommandScope::writing(CommandReach::Session)),
            CommandSpec::new(VAULT_CLEAR_JOURNAL, Text::key(T_CLEAR_JOURNAL_TITLE))
                .describing(Text::key(T_CLEAR_JOURNAL_DESC))
                // Il raggio è il **vault**: ciò che sparisce sta dentro il
                // vault e viaggia con lui. E `irreversible`, che non è una
                // formalità — è la riga che la palette legge per scrivere «non
                // reversibile» accanto al nome, cioè l'unico attrito che questo
                // gesto ha, e quello giusto: chi lo cerca lo vuole.
                .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
        ]
    }
}

impl fub_abi::traits::CommandProvider for Maintenance {
    fn commands(&self) -> Vec<CommandSpec> {
        Maintenance::specs()
    }

    /// **Non viene chiamata**, ed è dichiarato invece che nascosto: il workspace
    /// riconosce gli id di questo provider e li esegue da sé, perché ciò che
    /// fanno non sta sull'`HostApi` (vedi il § in testa al modulo). Se questa
    /// riga venisse eseguita vorrebbe dire che quel riconoscimento si è rotto, e
    /// l'errore lo dice invece di far finta di aver fatto qualcosa.
    fn invoke(
        &self,
        command: &str,
        _args: serde_json::Value,
        _mode: fub_abi::command::InvokeMode,
        _host: &mut dyn fub_abi::traits::HostApi,
    ) -> Result<fub_abi::command::CommandOutcome, fub_abi::error::PluginError> {
        Err(fub_abi::error::PluginError::Internal(
            format!(
                "`{command}` is a maintenance command: the kernel runs it, \
                 and this call means it was not recognized"
            )
            .into(),
        ))
    }
}

/// Il nome del file del bundle diagnostico, dentro la radice dei derivati.
pub const BUNDLE_FILE: &str = "diagnostics.json";

/// Ciò che un bundle diagnostico porta.
///
/// Un record e non un `serde_json::Value` composto a mano: questo file lo
/// leggerà qualcuno che sta cercando un guasto, e i campi che ci sono devono
/// essere gli stessi ogni volta — un oggetto costruito riga per riga perde un
/// campo il giorno in cui un ramo non lo aggiunge, e chi legge non può sapere
/// se manca il dato o se il dato era vuoto.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Diagnostics {
    /// La versione di schema (§15.3): ce l'ha anche un derivato, perché senza,
    /// la versione dopo dovrebbe indovinare che un file senza campo è di prima.
    pub v: SchemaVersion,
    /// Millisecondi UNIX in cui è stato scritto.
    pub at: u64,
    /// La versione di Fub che l'ha scritto.
    pub fub: String,
    /// Quanti documenti sono indicizzati e quante voci ha l'anagrafe.
    pub documents: usize,
    pub entries: usize,
    /// Quante righe del registro non si sono lette (§15.2). Zero è la risposta
    /// normale; diverso da zero è il primo posto dove guardare.
    pub journal_pruned: usize,
    /// Quante bozze ci sono, e quante di queste sono **orfane** — cioè l'unica
    /// copia rimasta di un testo la cui nota non c'è più.
    pub drafts: usize,
    pub drafts_orphans: usize,
    /// I problemi che il controllo di salute trova (7.2), per controllo.
    ///
    /// È il primo lettore vero di `IndexQuery::VaultHealth`: quella query
    /// esisteva e non la chiedeva nessuno.
    pub health: Vec<(String, usize)>,
}

/// La versione di schema del bundle.
pub const DIAGNOSTICS_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Le frasi dei tre comandi, nelle due lingue che il progetto porta (0040,
/// 0041).
///
/// Sta qui accanto ai comandi che traduce, e non nel catalogo del core: è la
/// regola di [`crate::locale`] — *un catalogo che si allontana dalle stringhe
/// che traduce è un catalogo che si aggiorna a metà*.
pub fn catalog() -> Vec<fub_abi::text::StringCatalog> {
    use fub_abi::text::StringCatalog;
    vec![
        StringCatalog::new("it")
            .with(T_REBUILD_TITLE, "Ricostruisci l'indice del vault")
            .with(
                T_REBUILD_DESC,
                "Rilegge il vault e rifà anagrafe, grafo e indici. Non tocca le note: \
                 ciò che rifà si può buttare per definizione.",
            )
            .with(T_REPAIR_TITLE, "Ripara il vault")
            .with(
                T_REPAIR_DESC,
                "Raccoglie i dati rimasti attaccati a note che non ci sono più, e \
                 dice ciò che non può riparare da sé.",
            )
            .with(T_BUNDLE_TITLE, "Scrivi un rapporto diagnostico")
            .with(T_BUNDLE_WRITTEN, "Rapporto diagnostico scritto in {path}.")
            .with(
                T_BUNDLE_DESC,
                "Mette in un file com'è messo il vault, cosa non si è letto e cosa è \
                 rimasto non salvato: è ciò da allegare quando qualcosa va storto.",
            )
            .with(
                T_REBUILT,
                "Indice rifatto: {docs} documenti, {entries} voci, {skipped} scartati.",
            )
            .with(
                T_REPAIRED,
                "Riparato: raccolti {collected} spazi rimasti attaccati a note che non \
                 ci sono più. Niente altro da segnalare.",
            )
            .with(
                T_REPAIRED_PARZIALE,
                "Raccolti {collected} spazi orfani. Restano fuori: {lost} righe del \
                 registro illeggibili, {unread} drafts che non si sono lette, {orphans} \
                 drafts senza la loro note — quelle sono l'unica copia di quel testo e \
                 non si buttano da sole.",
            )
            .with(T_CLEAR_JOURNAL_TITLE, "Svuota il registro delle modifiche")
            .with(
                T_CLEAR_JOURNAL_DESC,
                "Cancella le righe che dicono quale nota di questo vault è stata \
                 creata, modificata, cestinata o rinominata, quando e da chi \
                 (`.fub/journal.jsonl`). Le note non si toccano. Non si può \
                 annullare.",
            )
            .with(T_JOURNAL_PLAN, "{lines} righe del registro, tutte.")
            .with(T_JOURNAL_CLEARED, "Registro svuotato: {lines} righe."),
        StringCatalog::new("en")
            .with(T_REBUILD_TITLE, "Rebuild the vault index")
            .with(
                T_REBUILD_DESC,
                "Re-reads the vault and rebuilds the file list, the graph and the \
                 indexes. It does not touch your notes: what it rebuilds is \
                 disposable by definition.",
            )
            .with(T_REPAIR_TITLE, "Repair the vault")
            .with(
                T_REPAIR_DESC,
                "Collects data left attached to notes that no longer exist, and \
                 reports what it cannot repair by itself.",
            )
            .with(T_BUNDLE_TITLE, "Write a diagnostic report")
            .with(T_BUNDLE_WRITTEN, "Diagnostic report written to {path}.")
            .with(
                T_BUNDLE_DESC,
                "Writes to a file how the vault is doing, what could not be read and \
                 what was left unsaved: it is what to attach when something breaks.",
            )
            .with(
                T_REBUILT,
                "Index rebuilt: {docs} documents, {entries} entries, {skipped} skipped.",
            )
            .with(
                T_REPAIRED,
                "Repaired: collected {collected} spaces left attached to notes that no \
                 longer exist. Nothing else to report.",
            )
            .with(
                T_REPAIRED_PARZIALE,
                "Collected {collected} orphaned spaces. Left out: {lost} unreadable \
                 journal lines, {unread} drafts that could not be read, {orphans} \
                 drafts without their note — those are the only copy of that text and \
                 will not be discarded on their own.",
            )
            .with(T_CLEAR_JOURNAL_TITLE, "Empty the change log")
            .with(
                T_CLEAR_JOURNAL_DESC,
                "Deletes the lines saying which note of this vault was created, \
                 edited, trashed or renamed, when and by whom \
                 (`.fub/journal.jsonl`). Your notes are not touched. This cannot be \
                 undone.",
            )
            .with(T_JOURNAL_PLAN, "{lines} log lines, all of them.")
            .with(T_JOURNAL_CLEARED, "Log emptied: {lines} lines."),
    ]
}
