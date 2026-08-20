//! **I due host rispondono con la stessa faccia agli stessi fatti** (0219).
//!
//! Il contratto ha due implementazioni: il kernel, che è quella vera, e
//! [`MemoryHost`], che è quella contro cui si sviluppa. Chi scrive un plugin
//! sceglie il ramo sulla **specie** dell'errore, non sulla prosa — è la ragione
//! per cui il contratto ha `already-exists` e `not-found` accanto a `bad-args`
//! invece di una sola porta di rifiuto: `bad-args` è «hai sbagliato a
//! chiedere», e chi la sente correggerà l'argomento; `already-exists` è «c'è
//! già», e chi la sente sceglierà un altro nome.
//!
//! Se i due host danno facce diverse allo stesso fatto, quel ramo è scritto
//! contro il doppio e sbagliato sul kernel — e la differenza non la vede
//! nessuno, perché i due non si confrontano mai. Questo file è il posto in cui
//! si confrontano.
//!
//! Sta in `fub-features` perché è **l'unico crate che vede tutti e due**: il
//! kernel non conosce l'SDK e l'SDK non conosce il kernel, per invariante
//! (`crates/fub-abi/tests/dependency_invariant.rs`).
//!
//! Il banco non prova *cosa succede* — quello è lavoro dei banchi di ciascuno
//! dei due: prova **quale faccia** esce, e la chiede ai due host con la stessa
//! funzione, perché una prova scritta una volta sola non può descrivere due
//! comportamenti diversi senza accorgersene.
//!
//! # Le famiglie che toccano i byte dell'utente (0222)
//!
//! La 0219 aveva portato qui **le facce dei rifiuti**, e lì si era fermata: ciò
//! che i due host fanno quando la scrittura *riesce* non lo confrontava nessuno.
//! È la metà che conta di più, perché è quella su cui si scrive del codice — che
//! il testo creato si rilegga com'è stato dato, che la revisione resa sia la
//! base valida della scrittura dopo, che una base stantia non lasci dietro di sé
//! nemmeno un byte, che una rinomina porti con sé il testo e liberi il nome
//! vecchio, che il cestino tolga dall'elenco senza distruggere e che il
//! ripristino riporti indietro lo stesso id con lo stesso contenuto.
//!
//! Confrontarle ha trovato tre punti in cui i due rispondevano diverso, e tutti
//! e tre dalla stessa parte — il doppio era più permissivo del vault vero, che è
//! il verso peggiore: il codice scritto contro il doppio passa e si rompe in
//! produzione. Sono scritti dove sono stati riparati, in
//! `fub-sdk/src/testing/mod.rs`.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::{EditRequest, TextEdit, WriteBase};
use fub_abi::error::PluginError;
use fub_abi::model::{DocId, Span};
use fub_abi::traits::{DataWrite, HostApi};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{
    DirEntry, FormatRegistry, FsStorage, MachineSettings, Stat, VaultStorage, Workspace,
};
use fub_sdk::testing::MemoryHost;
use std::sync::Arc;

/// La specie di un errore, senza la prosa: è ciò su cui chi chiama sceglie, ed
/// è quindi la sola cosa che i due host si devono.
fn kind(and: &PluginError) -> String {
    match and {
        PluginError::UnknownCommand(_) => "unknown-command",
        PluginError::UnknownView(_) => "unknown-view",
        PluginError::UnknownJob(_) => "unknown-job",
        PluginError::BadArgs(_) => "bad-args",
        PluginError::PermissionDenied(_) => "permission-denied",
        PluginError::Internal(_) => "internal",
        PluginError::Conflict(_) => "conflict",
        PluginError::Unserved(_) => "unserved",
        PluginError::Cancelled(_) => "cancelled",
        PluginError::NotFound(_) => "not-found",
        PluginError::AlreadyExists(_) => "already-exists",
        PluginError::Io(_) => "io",
    }
    .to_string()
}

/// L'esito di un'operazione ridotto a ciò su cui chi chiama si dirama: `ok`,
/// oppure la specie del rifiuto.
fn face<T>(outcome: &Result<T, PluginError>) -> String {
    match outcome {
        Ok(_) => "ok".to_string(),
        Err(and) => kind(and),
    }
}

/// Un supporto che dice di no a certe scritture, e per il resto è il disco.
///
/// Serve al terzo banco: il doppio ha la sua manopola (`denies_write`), il
/// kernel no — l'unico modo di fargli sentire un supporto che rifiuta è
/// dargliene uno (§15.1).
struct WriteRejectingStorage {
    inner: FsStorage,
    rejects: String,
}

impl WriteRejectingStorage {
    fn no(&self, path: &Utf8Path) -> Option<std::io::Error> {
        path.as_str().contains(&self.rejects).then(|| {
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "il supporto dice di no",
            )
        })
    }
}

impl VaultStorage for WriteRejectingStorage {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        match self.no(path) {
            Some(and) => Err(and),
            None => self.inner.write(path, bytes),
        }
    }
    fn update(
        &self,
        path: &Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// Gira la stessa prova sui due host e pretende la stessa risposta.
///
/// La prova rende un elenco di coppie `(il fatto, la faccia)` invece di
/// asserire per conto proprio: così il rosso dice **quale** fatto ha ricevuto
/// risposte diverse e cosa hanno risposto i due, che è l'unica informazione
/// utile qui.
fn on_the_two_host(
    storage: Option<Arc<dyn VaultStorage>>,
    test: impl Fn(&mut dyn HostApi) -> Vec<(String, String)>,
) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = match storage {
        None => Workspace::new(&root, registry).expect("l'apertura del vault riesce"),
        Some(s) => Workspace::on(&root, registry, s, MachineSettings::in_memory())
            .expect("l'apertura del vault riesce"),
    };
    // Un plugin dichiarato, perché `with_host` è la sola via che attraversa
    // davvero il confine, e il kernel non presta capacità a una stringa (§7.3).
    ws.register_core_feature("prova.plugin", "prova.plugin")
        .expect("dichiarato");
    ws.reindex().expect("reindex");

    let mut from_the_kernel = Vec::new();
    ws.with_host("prova.plugin", |host| from_the_kernel = test(host));

    let mut double = MemoryHost::new();
    let from_the_double = test(&mut double);

    assert_eq!(
        from_the_kernel, from_the_double,
        "i due host devono dare la stessa faccia agli stessi fatti — a sinistra \
         il kernel, a destra il doppio"
    );
}

/// Il documento che non c'è, e il path che è già occupato.
///
/// Sono i sei rami su cui il doppio rispondeva `bad-args` — «hai sbagliato a
/// chiedere» — mentre il kernel diceva «non c'è» o «c'è già»: le due risposte
/// da cui dipende cosa fa chi chiama.
#[test]
fn absent_and_occupied_have_the_same_face_here_and_there() {
    on_the_two_host(None, |host| {
        let c_and = DocId::new("Idea.md");
        let not_c_and = DocId::new("mai-scritta.md");
        host.create_document(&c_and, "il testo").expect("si scrive");
        host.create_document(&DocId::new("Seconda.md"), "due")
            .expect("si scrive");
        let trashed = host.trash_document(&c_and).expect("si cestina");
        host.create_document(&c_and, "di nuovo").expect("si riscrive");

        vec![
            (
                "leggere ciò che non c'è".into(),
                kind(&host.read_document(&not_c_and).unwrap_err()),
            ),
            (
                "creare su un path occupato".into(),
                kind(&host.create_document(&c_and, "secondo").unwrap_err()),
            ),
            (
                "rinominare ciò che non c'è".into(),
                kind(
                    &host
                        .rename_document(&not_c_and, &DocId::new("Altra.md"))
                        .unwrap_err(),
                ),
            ),
            (
                "rinominare su un path occupato".into(),
                kind(
                    &host
                        .rename_document(&DocId::new("Seconda.md"), &c_and)
                        .unwrap_err(),
                ),
            ),
            (
                "ripristinare una voce che nel cestino non c'è".into(),
                kind(
                    &host
                        .restore_document(&DocId::new(".trash/mai-cestinata.md"), None)
                        .unwrap_err(),
                ),
            ),
            (
                "ripristinare su un path che nel frattempo è tornato".into(),
                kind(&host.restore_document(&trashed, None).unwrap_err()),
            ),
        ]
    });
}

/// Il giro del cestino, dove conta la **forma** dell'id.
///
/// `trash_document` rende un id, e quell'id è l'unica cosa che chi chiama ha in
/// mano per ripristinare: se i due lo costruiscono con forme diverse, il codice
/// che lo maneggia — che lo mostri, che ne ricavi il nome di prima, che lo
/// riporti indietro — è scritto contro una forma sola. Qui non si confrontano
/// gli id (il timbro dipende dall'orologio, e il doppio non ne ha uno) ma la
/// forma: la cartella, la piattezza, l'estensione in coda, e che il giro di
/// andata e ritorno riporti lo stesso id dai due lati.
#[test]
fn the_id__of_the_trash_has_the_same_form__of_here__and__of_the() {
    on_the_two_host(None, |host| {
        let id = DocId::new("Progetti/Idea.md");
        host.create_document(&id, "il testo").expect("si scrive");
        let trashed = host.trash_document(&id).expect("si cestina");
        let s = trashed.to_string();

        vec![
            (
                "sta nel cestino".into(),
                s.starts_with(".trash/").to_string(),
            ),
            (
                "il cestino è piatto".into(),
                (s.matches('/').count() == 1).to_string(),
            ),
            (
                "l'estensione resta in coda".into(),
                s.ends_with(".md").to_string(),
            ),
            (
                "e il ripristino rende lo stesso id".into(),
                host.restore_document(&trashed, None)
                    .expect("si ripristina")
                    .to_string(),
            ),
        ]
    });
}

/// Il supporto che dice di no non è un difetto di chi ha scritto il codice.
///
/// Sul canale dati il doppio insegnava `io` — che è la faccia giusta, e il
/// contratto la scrive accanto alla variante — mentre il kernel rispondeva
/// `internal`, cioè «segnala un bug» a chi invece ha ragione di riprovare.
/// Il doppio ha una manopola per rifiutare; il kernel sente un rifiuto solo se
/// glielo dà il supporto, quindi qui i due arrivano allo stesso fatto per due
/// strade, e la prova è che ne escano con la stessa faccia.
#[test]
fn a_support_that__says__of_no__and__a_io__of_here__and__of_the() {
    // Il kernel non ha una manopola: l'unico modo di fargli sentire un
    // rifiuto è dargli un supporto che rifiuta (§15.1).
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let storage = Arc::new(WriteRejectingStorage {
        inner: FsStorage,
        rejects: "/data/".to_string(),
    });
    let mut ws = Workspace::on(
        &root,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.register_core_feature("prova.plugin", "prova.plugin")
        .expect("dichiarato");
    let mut from_the_kernel = String::new();
    ws.with_host("prova.plugin", |host| {
        from_the_kernel = kind(&host.data_write("blob", b"i byte").unwrap_err());
    });

    // Il doppio ha la manopola, che è la stessa frase detta in memoria.
    let mut double = MemoryHost::new();
    double.denies_write("blob");
    let from_the_double = kind(&double.data_write("blob", b"i byte").unwrap_err());

    assert_eq!(
        (from_the_kernel.as_str(), from_the_double.as_str()),
        ("io", "io"),
        "il supporto che dice di no è «il mondo», non «un difetto di chi ha \
         scritto il codice»: chi lo sente ha ragione di riprovare, e con \
         `internal` non lo saprebbe"
    );
}

/// **Le cinque famiglie che toccano i byte dell'utente, quando riescono.**
///
/// Creazione, scrittura, rinomina, cestinazione, ripristino: il giro intero, e
/// a ogni passo la domanda che chi ha scritto il plugin farebbe subito dopo —
/// *cosa c'è adesso nel vault?*. Non si confrontano i due host fra loro a colpi
/// di `assert` separati: si fa lo stesso giro con la stessa funzione e si
/// pretende lo stesso diario, perché due giri scritti due volte descrivono due
/// comportamenti diversi senza accorgersene.
///
/// Le revisioni non si confrontano fra i due — sono opache apposta, e nessuno
/// promette che il kernel e il doppio le derivino allo stesso modo. Ciò che si
/// confronta è la **relazione**: che quella resa dalla scrittura sia quella che
/// il documento ha adesso, e che sia una base che la scrittura dopo accetta.
#[test]
fn the_writes_leave_the__same_vault__of_here__and__of_the() {
    on_the_two_host(None, |host| {
        let mut journal: Vec<(String, String)> = Vec::new();
        let id = DocId::new("Nota.md");

        // --- creazione ---
        journal.push(("creare".into(), face(&host.create_document(&id, "uno"))));
        journal.push((
            "e il testo è quello dato".into(),
            host.read_document(&id).unwrap_or_default(),
        ));
        journal.push((
            "ed è in elenco".into(),
            host.list_documents(None)
                .map(|p| p.items.contains(&id))
                .unwrap_or(false)
                .to_string(),
        ));
        journal.push((
            "e l'elenco ne conta uno".into(),
            host.list_documents(None)
                .map(|p| p.total)
                .unwrap_or(0)
                .to_string(),
        ));

        // --- scrittura intera, e la guardia della base ---
        let resa = host.write_document(&id, "due", WriteBase::Dictated);
        journal.push(("dettare una scrittura".into(), face(&resa)));
        let resa = resa.expect("la scrittura dettata riesce");
        journal.push((
            "la revisione resa è quella di adesso".into(),
            (host.document_revision(&id).ok().as_ref() == Some(&resa)).to_string(),
        ));
        journal.push((
            "ed è la base che la prossima accetta".into(),
            face(&host.write_document(&id, "tre", WriteBase::DescendsFrom(resa.clone()))),
        ));
        journal.push((
            "una base stantia".into(),
            face(&host.write_document(&id, "quattro", WriteBase::DescendsFrom(resa.clone()))),
        ));
        journal.push((
            "e dopo il rifiuto i byte sono intatti".into(),
            host.read_document(&id).unwrap_or_default(),
        ));
        journal.push((
            "discendere da ciò che non c'è".into(),
            face(&host.write_document(&DocId::new("Mai.md"), "x", WriteBase::DescendsFrom(resa))),
        ));
        journal.push((
            "dettare ciò che non c'è lo crea".into(),
            face(&host.write_document(&DocId::new("Nata.md"), "n", WriteBase::Dictated)),
        ));

        // --- modifica chirurgica ---
        let base = host.document_revision(&id).expect("la revisione c'è");
        journal.push((
            "un edit".into(),
            face(&host.apply_edit(
                &id,
                EditRequest::new(
                    base.clone(),
                    vec![TextEdit::replace(Span { start: 0, end: 0 }, "A")],
                ),
            )),
        ));
        journal.push((
            "e il testo dopo l'edit".into(),
            host.read_document(&id).unwrap_or_default(),
        ));
        journal.push((
            "un edit su una base stantia".into(),
            face(&host.apply_edit(
                &id,
                EditRequest::new(
                    base,
                    vec![TextEdit::replace(Span { start: 0, end: 1 }, "X")],
                ),
            )),
        ));
        let base = host.document_revision(&id).expect("la revisione c'è");
        journal.push((
            "un edit fuori dal sorgente".into(),
            face(&host.apply_edit(
                &id,
                EditRequest::new(
                    base.clone(),
                    vec![TextEdit::replace(
                        Span {
                            start: 900,
                            end: 901,
                        },
                        "X",
                    )],
                ),
            )),
        ));
        journal.push((
            "due edit che si contendono lo stesso punto".into(),
            face(&host.apply_edit(
                &id,
                EditRequest::new(
                    base.clone(),
                    vec![
                        TextEdit::replace(Span { start: 0, end: 3 }, "X"),
                        TextEdit::replace(Span { start: 1, end: 4 }, "Y"),
                    ],
                ),
            )),
        ));
        journal.push((
            "un edit vuoto".into(),
            face(&host.apply_edit(&id, EditRequest::new(base, vec![]))),
        ));
        journal.push((
            "e dopo i rifiuti i byte".into(),
            host.read_document(&id).unwrap_or_default(),
        ));

        // --- rinomina, anche in una cartella che non c'è ---
        let within = DocId::new("Cartella/Rinominata.md");
        journal.push((
            "rinominare in una cartella che non c'è".into(),
            face(&host.rename_document(&id, &within)),
        ));
        journal.push((
            "e il testo ha seguito".into(),
            host.read_document(&within).unwrap_or_default(),
        ));
        journal.push((
            "mentre il nome vecchio non legge più".into(),
            face(&host.read_document(&id)),
        ));
        journal.push((
            "rinominare su sé stessi".into(),
            face(&host.rename_document(&within, &within)),
        ));

        // --- cestino e ripristino ---
        let trashed = host.trash_document(&within).expect("si cestina");
        journal.push((
            "cestinare toglie dall'elenco".into(),
            host.list_documents(None)
                .map(|p| p.items.contains(&within))
                .unwrap_or(true)
                .to_string(),
        ));
        let entries = host.list_trash().expect("il cestino si elenca");
        journal.push(("e il cestino ha una voce".into(), entries.len().to_string()));
        journal.push((
            "che ricorda da dove veniva".into(),
            entries.first()
                .map(|v| v.original.to_string())
                .unwrap_or_default(),
        ));
        journal.push((
            "e quanto pesava".into(),
            entries.first().map(|v| v.size.to_string()).unwrap_or_default(),
        ));
        journal.push((
            "una voce cestinata non si legge come documento".into(),
            face(&host.read_document(&trashed)),
        ));
        journal.push((
            "ripristinare senza dire dove".into(),
            host.restore_document(&trashed, None)
                .map(|d| d.to_string())
                .unwrap_or_else(|and| kind(&and)),
        ));
        journal.push((
            "e il testo è tornato".into(),
            host.read_document(&within).unwrap_or_default(),
        ));
        journal.push((
            "e il cestino è vuoto".into(),
            host.list_trash().map(|v| v.len()).unwrap_or(99).to_string(),
        ));

        let trashed = host.trash_document(&within).expect("si cestina");
        journal.push((
            "ripristinare altrove".into(),
            host.restore_document(&trashed, Some(DocId::new("Altrove.md")))
                .map(|d| d.to_string())
                .unwrap_or_else(|and| kind(&and)),
        ));
        journal.push((
            "e il testo è là".into(),
            host.read_document(&DocId::new("Altrove.md"))
                .unwrap_or_default(),
        ));

        host.trash_document(&DocId::new("Altrove.md"))
            .expect("si cestina");
        journal.push((
            "svuotare il cestino conta".into(),
            host.empty_trash()
                .map(|n| n.to_string())
                .unwrap_or_default(),
        ));
        journal.push((
            "e il cestino resta vuoto".into(),
            host.list_trash().map(|v| v.len()).unwrap_or(99).to_string(),
        ));
        journal.push((
            "svuotarlo di nuovo non distrugge niente".into(),
            host.empty_trash()
                .map(|n| n.to_string())
                .unwrap_or_default(),
        ));

        journal.push((
            "un nome libero a partire da uno occupato".into(),
            host.free_name(&DocId::new("Nata.md")).to_string(),
        ));
        journal.push((
            "e a partire da uno libero".into(),
            host.free_name(&DocId::new("Libera.md")).to_string(),
        ));
        journal
    });
}

/// **Ogni nome, giudicato dalle cinque famiglie.**
///
/// Diciannove nomi per sei domande: crearlo, scriverlo, leggerlo, rinominarci
/// sopra, guardare se chi è partito è ancora al suo posto, cestinarlo. È una
/// tabella e non cinque banchi perché la cosa che si vuole vedere è proprio la
/// **riga**: un nome che il kernel rifiuta e il doppio accetta si legge in un
/// colpo d'occhio, e la differenza sta quasi sempre in una casella sola.
///
/// Ci sono i tre recinti del §15.5 — chi risale (`../`), chi non è portabile
/// (`aux.md`, `con:due.md`), chi non nomina un file (`Cartella/`, `a//b.md`) —
/// e accanto due nomi che *sembrano* buoni e non lo sono per un'altra ragione:
/// `nota.txt` e `senzapunto` non hanno un provider che li parsi, e una scrittura
/// che nessuno può rileggere non è una scrittura.
#[test]
fn every_name__and_every_format_is_judge__equal__of_here__and__of_the() {
    on_the_two_host(None, |host| {
        let mut journal: Vec<(String, String)> = Vec::new();
        let source = DocId::new("Nota.md");
        host.create_document(&source, "uno due tre")
            .expect("si scrive");

        for name in [
            "../fuori.md",
            "/assoluto.md",
            "",
            "aux.md",
            "con:due.md",
            "finisce.md ",
            "finisce.md.",
            "Cartella/",
            "a//b.md",
            "./qui.md",
            "con\nnewline.md",
            "con\\backslash.md",
            "con*stella.md",
            "con?punto.md",
            "nota.txt",
            "senzapunto",
            "Nota.MD",
            "spazio dentro.md",
            "é-accento.md",
        ] {
            let id = DocId::new(name);
            journal.push((
                format!("creare {name:?}"),
                face(&host.create_document(&id, "x")),
            ));
            journal.push((
                format!("scrivere {name:?}"),
                face(&host.write_document(&id, "x", WriteBase::Dictated)),
            ));
            journal.push((
                format!("leggere {name:?}"),
                face(&host.read_document(&id)),
            ));
            journal.push((
                format!("rinominare Nota.md in {name:?}"),
                face(&host.rename_document(&source, &id)),
            ));
            journal.push((
                format!("e Nota.md dopo il tentativo su {name:?}"),
                face(&host.read_document(&source)),
            ));
            journal.push((
                format!("cestinare {name:?}"),
                face(&host.trash_document(&id)),
            ));
        }
        journal
    });
}
