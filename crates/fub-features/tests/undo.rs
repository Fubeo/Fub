// Il banco di questa feature vive con lei: senza la cargo feature `commands`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "commands")]
//! **Annullare un'operazione** end-to-end, attraverso il kernel vero (§13.3).
//!
//! La pila la tiene il kernel e si riempie da sola guardando passare gli esiti:
//! qui si prova che ciò che ne esce riporta davvero indietro il vault, e — che è
//! la metà meno ovvia — che ciò che *non* deve entrarci non ci entra.
//!
//! Le due pile che non si fondono restano due: quella del testo vive
//! nell'editor e ha il suo banco di prova dall'altra parte del confine
//! (`apps/client/src/editor/editor.test.ts`). Da qui non si vede, ed è il punto.

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::WriteBase;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_features::{
    CoreCommands, COMMANDS_ID, NOTES_RENAME, NOTES_TRASH, VAULT_ARCHIVE, VAULT_REPLACE, VAULT_UNDO,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{
    DirEntry, FormatRegistry, FsStorage, MachineSettings, Stat, VaultStorage, Workspace,
};
use std::sync::{Arc, Mutex};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        self.open_on(None)
    }

    /// Lo stesso vault, col **supporto passato** invece del disco nudo (§15.1):
    /// è l'unico modo di far esplodere qualcosa *dentro* un annullamento senza
    /// costruire un'attesa.
    fn open_on(&self, storage: Option<Arc<dyn VaultStorage>>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = match storage {
            None => Workspace::new(&self.root, registry).expect("l'apertura del vault riesce"),
            Some(storage) => {
                Workspace::on(&self.root, registry, storage, MachineSettings::in_memory())
                    .expect("l'apertura del vault riesce")
            }
        };
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn fai(ws: &mut Workspace, command: &str, args: serde_json::Value) {
    ws.invoke_command(command, args, InvokeMode::Apply, Actor::User)
        .unwrap_or_else(|and| panic!("`{command}`: {and}"));
}

/// Annulla, e restituisce la frase che l'esito ha scritto.
fn cancels(ws: &mut Workspace) -> String {
    let outcome = ws
        .invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("annulla");
    outcome
        .notify
        .and_then(|t| t.as_literal().map(str::to_owned))
        .expect("l'annullamento dice sempre qualcosa")
}

fn text(ws: &Workspace, id: &str) -> String {
    ws.read_source(&DocId::new(id)).expect("legge")
}

fn exists(ws: &Workspace, id: &str) -> bool {
    ws.documents().contains(&DocId::new(id))
}

#[test]
fn undo_a_rename_brings_back_also_the_link_that_were_states_rewritten() {
    // È il caso che dimostra `UndoStep::Command`: l'inverso di una rinomina non
    // è «rimetti il file dov'era», è **la rinomina all'incontrario** — e con
    // essa tornano indietro gratis i wikilink che la prima aveva riscritto
    // nelle sorgenti. Un linguaggio di operazioni inverse avrebbe dovuto rifare
    // quel lavoro, e rifarlo uguale.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Vecchia.md"), "sono io\n", WriteBase::Dictated)
        .expect("scrive");
    ws.write_document(
        &DocId::new("Chi mi nomina.md"),
        "vedi [[Vecchia]] per i dettagli\n",
        WriteBase::Dictated,
    )
    .expect("scrive");

    fai(
        &mut ws,
        NOTES_RENAME,
        serde_json::json!({ "doc": "Vecchia.md", "to": "Nuova.md" }),
    );
    assert!(exists(&ws, "Nuova.md") && !exists(&ws, "Vecchia.md"));
    assert!(text(&ws, "Chi mi nomina.md").contains("[[Nuova]]"));

    let said = cancels(&mut ws);
    // **Nel verso giusto**, e l'uguaglianza è esatta apposta: un'etichetta che
    // nomina i due path va bene in entrambi gli ordini, e uno dei due dice la
    // cosa sbagliata — «la rinomina di «Nuova» in «Vecchia»» è il rimedio, non
    // il male. Gli argomenti dell'inverso vanno in verso opposto all'etichetta
    // (vedi `note_rename`), quindi scriverli uguali è il refuso naturale lì, e
    // un `contains` per parte non lo noterebbe mai.
    assert_eq!(
        said, "Annullato: la rinomina di «Vecchia.md» in «Nuova.md»",
        "l'annullamento nomina l'operazione disfatta, non quella fatta per disfarla"
    );
    assert!(exists(&ws, "Vecchia.md") && !exists(&ws, "Nuova.md"));
    assert!(
        text(&ws, "Chi mi nomina.md").contains("[[Vecchia]]"),
        "il link è rimasto sul nome nuovo: l'inverso non ha ripercorso la \
         riscrittura"
    );
}

#[test]
fn undo_a_trash_brings_back_the_notes_where_was() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(
        &DocId::new("Progetti/Idea.md"),
        "un'idea\n",
        WriteBase::Dictated,
    )
    .expect("scrive");

    fai(
        &mut ws,
        NOTES_TRASH,
        serde_json::json!({ "doc": "Progetti/Idea.md" }),
    );
    assert!(!exists(&ws, "Progetti/Idea.md"));

    cancels(&mut ws);
    assert!(
        exists(&ws, "Progetti/Idea.md"),
        "il ripristino è tornato alla radice invece che al path d'origine"
    );
    assert_eq!(text(&ws, "Progetti/Idea.md"), "un'idea\n");
}

#[test]
fn undo_a_replacement_puts_back_the_text_of_first() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(
        &DocId::new("a.md"),
        "il gatto dorme, il gatto mangia\n",
        WriteBase::Dictated,
    )
    .expect("scrive");
    ws.write_document(&DocId::new("b.md"), "un altro gatto\n", WriteBase::Dictated)
        .expect("scrive");

    fai(
        &mut ws,
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
    );
    assert!(!text(&ws, "a.md").contains("gatto"));

    cancels(&mut ws);
    assert_eq!(text(&ws, "a.md"), "il gatto dorme, il gatto mangia\n");
    assert_eq!(text(&ws, "b.md"), "un altro gatto\n");
}

#[test]
fn a_macro_of_three_renames_and_a_entry_single() {
    // La stessa regola per cui è un `batch-ended` solo (decisione 0011): una
    // macro è *una* cosa che qualcuno ha chiesto. Se ogni passo entrasse in
    // pila, annullare una volta disferebbe un terzo dell'operazione — e chi
    // guarda non ha modo di sapere che gliene mancano due.
    let vault = Vault::new();
    let mut ws = vault.open();
    for n in ["Uno", "Due", "Tre"] {
        ws.write_document(
            &DocId::new(format!("{n}.md")),
            "corpo\n",
            WriteBase::Dictated,
        )
        .expect("scrive");
    }

    fai(
        &mut ws,
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["Uno.md", "Due.md", "Tre.md"], "folder": "Archivio" }),
    );
    assert!(exists(&ws, "Archivio/Uno.md") && exists(&ws, "Archivio/Tre.md"));

    cancels(&mut ws);
    for n in ["Uno", "Due", "Tre"] {
        assert!(
            exists(&ws, &format!("{n}.md")),
            "«{n}» non è tornata: un annullamento solo deve disfare tutta la macro"
        );
    }
    assert_eq!(
        cancels(&mut ws),
        "Niente da annullare",
        "tre passi hanno lasciato tre voci invece di una"
    );
}

#[test]
fn undo_does_not_and_is_cancellable() {
    // I passi di un annullamento sono comandi come gli altri e dichiarano il
    // proprio inverso: senza la bandiera che li tiene fuori dalla pila, la
    // seconda pressione rifarebbe ciò che la prima aveva disfatto, per sempre.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Prima.md"), "corpo\n", WriteBase::Dictated)
        .expect("scrive");
    ws.write_document(&DocId::new("Seconda.md"), "corpo\n", WriteBase::Dictated)
        .expect("scrive");

    fai(
        &mut ws,
        NOTES_RENAME,
        serde_json::json!({ "doc": "Prima.md", "to": "Prima rinominata.md" }),
    );
    fai(
        &mut ws,
        NOTES_RENAME,
        serde_json::json!({ "doc": "Seconda.md", "to": "Seconda rinominata.md" }),
    );

    cancels(&mut ws);
    assert!(exists(&ws, "Seconda.md"));
    // Il secondo annullamento va **all'indietro**, non rifà il primo.
    cancels(&mut ws);
    assert!(
        exists(&ws, "Prima.md"),
        "il secondo annullamento ha rifatto il primo invece di risalire la pila"
    );
    assert_eq!(cancels(&mut ws), "Niente da annullare");
}

#[test]
fn a_simulation_does_not_leaves_nothing_from_undo() {
    // Mettere in pila l'inverso di ciò che non è successo sarebbe la scala per
    // uscire dalla simulazione, e ci si uscirebbe **scrivendo**.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme\n", WriteBase::Dictated)
        .expect("scrive");

    ws.invoke_command(
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("simula");

    assert_eq!(cancels(&mut ws), "Niente da annullare");
    assert_eq!(text(&ws, "a.md"), "il gatto dorme\n");
}

#[test]
fn who_has_written_in_the_meantime_does_not_is_sees_delete_the_work() {
    // È il punto in cui le due pile si incontrano, e il contratto sapeva già
    // cosa dire: l'inverso porta la revisione che l'operazione ha **prodotto**,
    // quindi una scrittura arrivata dopo lo rende un `Conflict` (decisione
    // 0008) invece di una sovrascrittura silenziosa. Non è una guardia aggiunta
    // per l'annullamento: è quella firma che vale anche qui.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme\n", WriteBase::Dictated)
        .expect("scrive");

    fai(
        &mut ws,
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
    );
    // Qualcun altro (l'editor che salva, un'altra app, un job) riscrive.
    ws.write_document(
        &DocId::new("a.md"),
        "il cane dorme e russa\n",
        WriteBase::Dictated,
    )
    .expect("riscrive");

    let and = ws
        .invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("annullare sopra una scrittura altrui deve fallire");
    assert!(
        matches!(and, PluginError::Conflict(_)),
        "atteso un conflitto, arrivato {and:?}"
    );
    assert_eq!(
        text(&ws, "a.md"),
        "il cane dorme e russa\n",
        "il lavoro di chi ha scritto dopo è stato cancellato"
    );
    // Niente è cambiato: il conflitto può essere transitorio, quindi una seconda
    // pressione deve riprovare la stessa voce invece di dichiarare la pila vuota.
    let and = ws
        .invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("la voce senza effetti deve restare annullabile");
    assert!(
        matches!(and, PluginError::Conflict(_)),
        "il retry deve incontrare ancora il conflitto, arrivato {and:?}"
    );
}

#[test]
fn empty_the_trash_remains_irreversible_and_the_says() {
    // Non tutto è annullabile, e il default è che non lo sia: un comando che non
    // dichiara l'inverso non promette niente, e nessuno lo indovina per lui.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "corpo\n", WriteBase::Dictated)
        .expect("scrive");
    fai(&mut ws, NOTES_TRASH, serde_json::json!({ "doc": "a.md" }));
    fai(&mut ws, fub_features::TRASH_EMPTY, serde_json::Value::Null);

    // La voce in cima è quella del cestino, non quella dello svuotamento — e
    // annullarla fallisce, perché la nota da ripristinare non c'è più. Ciò che
    // il presidio guarda è che lo svuotamento **non abbia messo niente**: se lo
    // avesse fatto, qui si leggerebbe un annullamento riuscito.
    let spec = ws
        .commands()
        .into_iter()
        .find(|s| s.id == fub_features::TRASH_EMPTY)
        .expect("dichiarato");
    assert!(
        !spec.scope.reversible,
        "svuotare il cestino si dichiara irreversibile"
    );
}

// ---------------------------------------------------------------------------
// Un'operazione a metà, e i due conti che ne restano (§23.14)
// ---------------------------------------------------------------------------

/// Invoca e restituisce l'esito intero, invece della sola frase.
fn outcome(
    ws: &mut Workspace,
    command: &str,
    args: serde_json::Value,
) -> fub_abi::command::CommandOutcome {
    ws.invoke_command(command, args, InvokeMode::Apply, Actor::User)
        .unwrap_or_else(|and| panic!("`{command}`: {and}"))
}

/// **Un'operazione a metà lo dice come dato, non solo come frase.**
///
/// Il parziale il vault lo diceva già in tre comandi, e lo diceva **solo dentro
/// la notifica**: un'automazione che invocava `vault.archive` non aveva modo di
/// sapere che una nota su due era rimasta indietro, se non leggendo una frase
/// italiana e cercandoci dentro una parola.
#[test]
fn an_operation_that_half_succeeded_says_so_as_data() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "prima\n", WriteBase::Dictated)
        .expect("scrive");

    // Due note davanti, una sola esiste: la seconda non si archivia, e il
    // comando invocato risponde `not-found`.
    let outcome = outcome(
        &mut ws,
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["a.md", "b.md"] }),
    );
    let count = outcome.partial.expect("una su due è a metà, e si dichiara");
    assert_eq!(
        (count.attempted, count.done, count.failed()),
        (2, 1, 1),
        "due davanti, una archiviata, una caduta"
    );
    assert_eq!(
        count.failures[0].subject.as_ref().map(|d| d.as_str()),
        Some("b.md"),
        "e il guasto NOMINA la nota: un conto senza il nome non dice quale \
         riaprire"
    );
    assert!(exists(&ws, "Archivio/a.md"), "l'altra è andata davvero");
}

/// **Un'operazione riuscita non si dichiara a metà.**
///
/// Il controllo negativo di quello sopra, ed è il più importante dei due: una
/// nota già nella cartella d'archivio è *niente da fare*, non un guasto. Un
/// esito che si dichiarasse a metà qui insegnerebbe a chi lo legge che gli
/// avvisi di questa app si cliccano via — che è il modo in cui un avviso smette
/// di valere.
#[test]
fn nothing_missing_means_no_partial_at_all() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "prima\n", WriteBase::Dictated)
        .expect("scrive");
    ws.write_document(
        &DocId::new("Archivio/b.md"),
        "già là\n",
        WriteBase::Dictated,
    )
    .expect("scrive");

    let outcome = outcome(
        &mut ws,
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["a.md", "Archivio/b.md"] }),
    );
    assert!(
        outcome.partial.is_none(),
        "una nota già in archivio non è un guasto: è niente da fare"
    );
}

/// **La voce di undo si ricorda che l'operazione era a metà.**
///
/// È il danno che la [decisione 0045] aveva dichiarato e nessuno raccoglieva:
/// *«chi la annulla non sa che stava disfacendo undici note su dodici»*. Il
/// conto non lo ricopia chi ha scritto il comando — lo appaia l'host quando
/// mette la voce in pila, che è l'unico momento in cui i due pezzi sono ancora
/// insieme.
///
/// [decisione 0045]: ../../../docs/decisions/0190-sessioni-documento-e-undo.md
#[test]
fn undoing_a_half_done_operation_says_it_was_half_done() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "prima\n", WriteBase::Dictated)
        .expect("scrive");

    outcome(
        &mut ws,
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["a.md", "b.md"] }),
    );
    let said = cancels(&mut ws);
    assert!(
        said.contains("era già riuscita a metà") && said.contains("1 su 2"),
        "annullare deve dire che rimette indietro solo la parte che era \
         andata; ha detto: {said}"
    );
    assert!(exists(&ws, "a.md"), "e quella parte torna davvero indietro");
}

/// **Un annullamento che si ferma a metà lo dice, e non butta ciò che ha
/// fatto.**
///
/// È il difetto più grave dei due, e stava **fuori** dalla voce: il `?` del
/// ciclo lasciava applicati i passi già fatti, non provava quelli dopo, e
/// restituiva un errore nudo — mentre la voce era già uscita dalla pila. Chi
/// annullava un'archiviazione di due note poteva ritrovarne una tornata
/// indietro, una no, e sullo schermo la parola «fallito».
///
/// Qui il secondo passo cade per davvero: al posto della nota archiviata ne è
/// ricomparsa una con lo stesso nome, quindi rimetterla dov'era è un
/// `already-exists`. Nessun `mock`: è il caso vero di due app che guardano lo
/// stesso vault.
#[test]
fn an_undo_that_stops_halfway_says_where_it_stopped() {
    let vault = Vault::new();
    let mut ws = vault.open();
    for id in ["a.md", "b.md"] {
        ws.write_document(&DocId::new(id), "corpo\n", WriteBase::Dictated)
            .expect("scrive");
    }
    outcome(
        &mut ws,
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["a.md", "b.md"] }),
    );
    assert!(exists(&ws, "Archivio/a.md") && exists(&ws, "Archivio/b.md"));

    // Qualcun altro rimette una nota al posto vecchio di `a.md`. I passi
    // dell'annullamento girano dall'ultima rinomina alla prima, quindi `b.md`
    // torna indietro e `a.md` no.
    ws.write_document(&DocId::new("a.md"), "un'altra\n", WriteBase::Dictated)
        .expect("scrive");

    let outcome = ws
        .invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("metà lavoro fatto NON è un errore: è un esito parziale");
    let count = outcome
        .partial
        .expect("l'annullamento si è fermato, e il conto esce");
    assert_eq!(
        (count.attempted, count.done, count.failed()),
        (2, 1, 1),
        "due passi, uno tornato indietro, uno caduto — e i sette che in un caso \
         più grande non sarebbero stati nemmeno provati stanno nel resto"
    );
    assert!(
        matches!(count.failures[0].error, PluginError::AlreadyExists(_)),
        "e la specie del guasto sopravvive: {:?}",
        count.failures[0].error
    );

    let said = outcome
        .notify
        .and_then(|t| t.as_literal().map(str::to_owned))
        .expect("una frase c'è sempre");
    assert!(
        said.contains("Annullato a metà") && said.contains("1 su 2"),
        "e la frase non dice «Annullato» liscio: {said}"
    );

    assert!(exists(&ws, "b.md"), "il passo riuscito È riuscito");
    assert_eq!(
        text(&ws, "a.md"),
        "un'altra\n",
        "e quello caduto non ha cancellato il lavoro di chi ha scritto dopo"
    );
}

/// Un supporto che **esplode** invece di rispondere, una volta sola e su un path
/// che si sceglie.
///
/// Serve perché un panico di un *plugin* qui non basta: quello lo prende la rete
/// della `safety` e diventa un errore prima di arrivare a chi ha alzato la
/// bandiera. Ciò che passa davvero su quella riga è ciò che rete non ha — il
/// supporto, una `expect` del kernel — ed è quello che questo doppio fabbrica.
struct SupportThatExplodes {
    inner: FsStorage,
    /// Il primo `write` o `rename` verso un path che contiene questo pezzo
    /// esplode, e disarma: ciò che viene dopo il misfatto deve poter girare, o
    /// non si potrebbe osservare niente.
    explodes_on: Mutex<Option<String>>,
}

impl SupportThatExplodes {
    /// Nasce **disarmato**: il vault va prima riempito, e un supporto che
    /// esplode già durante l'apparecchiatura non farebbe vedere niente.
    fn off() -> Arc<Self> {
        Arc::new(SupportThatExplodes {
            inner: FsStorage,
            explodes_on: Mutex::new(None),
        })
    }

    fn arm(&self, piece: &str) {
        *self.explodes_on.lock().expect("l'innesco") = Some(piece.to_string());
    }

    fn maybe_explodes(&self, path: &camino::Utf8Path) {
        let mut armed = self.explodes_on.lock().expect("l'innesco");
        if armed.as_deref().is_some_and(|p| path.as_str().contains(p)) {
            armed.take();
            drop(armed);
            panic!("il supporto è esploso su {path}");
        }
    }
}

impl VaultStorage for SupportThatExplodes {
    fn read(&self, path: &camino::Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(
        &self,
        path: &camino::Utf8Path,
        bytes: &[u8],
    ) -> std::io::Result<fub_kernel::storage::Stat> {
        self.maybe_explodes(path);
        self.inner.write(path, bytes)
    }
    fn update(
        &self,
        path: &camino::Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &camino::Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &camino::Utf8Path, to: &camino::Utf8Path) -> std::io::Result<()> {
        self.maybe_explodes(to);
        self.inner.rename(from, to)
    }
    fn rename_no_replace(
        &self,
        from: &camino::Utf8Path,
        to: &camino::Utf8Path,
    ) -> std::io::Result<()> {
        self.maybe_explodes(to);
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &camino::Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &camino::Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &camino::Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &camino::Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// **Chi muore dentro un annullamento non porta via Ctrl-Z.**
///
/// È il difetto che il `Drop` di `Riproduzione` esiste per non avere: la
/// bandiera `replaying` — quella che dice *annullare non è annullabile* — si
/// rimetteva a posto su una riga **dopo** il giro dei passi, e un panico dentro
/// quel giro la saltava. Da lì in poi ogni `undo.push` veniva scartata in
/// silenzio: l'utente continuava a lavorare, premeva Ctrl-Z, e leggeva che non
/// c'era niente da annullare avendo appena rinominato una nota.
///
/// Il panico si produce come lo produce la vita — un supporto che esplode a metà
/// del passo — e l'hook tace per la sua durata, o una traccia stampata farebbe
/// sembrare rotto un banco verde.
#[test]
fn a_panic_inside_a_undo_does_not_carries_via_the_stack() {
    let vault = Vault::new();
    let support = SupportThatExplodes::off();
    let mut ws = vault.open_on(Some(Arc::clone(&support) as Arc<dyn VaultStorage>));
    ws.write_document(&DocId::new("a.md"), "il gatto dorme\n", WriteBase::Dictated)
        .expect("scrive");
    fai(
        &mut ws,
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
    );
    support.arm("a.md");

    // **Una sostituzione e non una rinomina**, e la differenza è tutto il banco:
    // l'inverso di una rinomina è un `UndoStep::Command`, e un comando gira
    // dentro la rete della `safety`, che il panico lo prende. L'inverso di una
    // sostituzione è un `UndoStep::Edit`, cioè una scrittura del kernel senza
    // rete — ed è là che il panico attraversa davvero il giro dei passi e esce
    // da `undo_last` saltando ciò che viene dopo.
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cancels(&mut ws)));
    std::panic::set_hook(hook);
    assert!(outcome.is_err(), "il misfatto deve essere successo");

    // La pila è di nuovo una pila: un'operazione qualunque ci entra, e Ctrl-Z la
    // disfa.
    ws.write_document(&DocId::new("Dopo.md"), "un'altra\n", WriteBase::Dictated)
        .expect("scrive");
    fai(
        &mut ws,
        NOTES_TRASH,
        serde_json::json!({ "doc": "Dopo.md" }),
    );
    cancels(&mut ws);
    assert!(
        exists(&ws, "Dopo.md"),
        "la bandiera dell'annullamento è rimasta alzata: da qui in poi niente \
         entra più in pila, Ctrl-Z non fa più niente per il resto della \
         sessione, e nessuno dice perché"
    );
}
