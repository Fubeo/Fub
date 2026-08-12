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
fn specie(e: &PluginError) -> String {
    match e {
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
fn faccia<T>(esito: &Result<T, PluginError>) -> String {
    match esito {
        Ok(_) => "ok".to_string(),
        Err(e) => specie(e),
    }
}

/// Un supporto che dice di no a certe scritture, e per il resto è il disco.
///
/// Serve al terzo banco: il doppio ha la sua manopola (`nega_scrittura`), il
/// kernel no — l'unico modo di fargli sentire un supporto che rifiuta è
/// dargliene uno (§15.1).
struct SupportoCheNegaLeScritture {
    inner: FsStorage,
    nega: String,
}

impl SupportoCheNegaLeScritture {
    fn no(&self, path: &Utf8Path) -> Option<std::io::Error> {
        path.as_str().contains(&self.nega).then(|| {
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "il supporto dice di no",
            )
        })
    }
}

impl VaultStorage for SupportoCheNegaLeScritture {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        match self.no(path) {
            Some(e) => Err(e),
            None => self.inner.write(path, bytes),
        }
    }
    fn update(
        &self,
        path: &Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
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
fn sui_due_host(
    storage: Option<Arc<dyn VaultStorage>>,
    prova: impl Fn(&mut dyn HostApi) -> Vec<(String, String)>,
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

    let mut dal_kernel = Vec::new();
    ws.with_host("prova.plugin", |host| dal_kernel = prova(host));

    let mut doppio = MemoryHost::new();
    let dal_doppio = prova(&mut doppio);

    assert_eq!(
        dal_kernel, dal_doppio,
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
fn assente_e_occupato_hanno_la_stessa_faccia_di_qua_e_di_la() {
    sui_due_host(None, |host| {
        let c_e = DocId::new("Idea.md");
        let non_c_e = DocId::new("mai-scritta.md");
        host.create_document(&c_e, "il testo").expect("si scrive");
        host.create_document(&DocId::new("Seconda.md"), "due")
            .expect("si scrive");
        let cestinata = host.trash_document(&c_e).expect("si cestina");
        host.create_document(&c_e, "di nuovo").expect("si riscrive");

        vec![
            (
                "leggere ciò che non c'è".into(),
                specie(&host.read_document(&non_c_e).unwrap_err()),
            ),
            (
                "creare su un path occupato".into(),
                specie(&host.create_document(&c_e, "secondo").unwrap_err()),
            ),
            (
                "rinominare ciò che non c'è".into(),
                specie(
                    &host
                        .rename_document(&non_c_e, &DocId::new("Altra.md"))
                        .unwrap_err(),
                ),
            ),
            (
                "rinominare su un path occupato".into(),
                specie(
                    &host
                        .rename_document(&DocId::new("Seconda.md"), &c_e)
                        .unwrap_err(),
                ),
            ),
            (
                "ripristinare una voce che nel cestino non c'è".into(),
                specie(
                    &host
                        .restore_document(&DocId::new(".trash/mai-cestinata.md"), None)
                        .unwrap_err(),
                ),
            ),
            (
                "ripristinare su un path che nel frattempo è tornato".into(),
                specie(&host.restore_document(&cestinata, None).unwrap_err()),
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
fn l_id_del_cestino_ha_la_stessa_forma_di_qua_e_di_la() {
    sui_due_host(None, |host| {
        let id = DocId::new("Progetti/Idea.md");
        host.create_document(&id, "il testo").expect("si scrive");
        let cestinato = host.trash_document(&id).expect("si cestina");
        let s = cestinato.to_string();

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
                host.restore_document(&cestinato, None)
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
fn un_supporto_che_dice_di_no_e_un_io_di_qua_e_di_la() {
    // Il kernel non ha una manopola: l'unico modo di fargli sentire un
    // rifiuto è dargli un supporto che rifiuta (§15.1).
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let storage = Arc::new(SupportoCheNegaLeScritture {
        inner: FsStorage,
        nega: "/data/".to_string(),
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
    let mut dal_kernel = String::new();
    ws.with_host("prova.plugin", |host| {
        dal_kernel = specie(&host.data_write("blob", b"i byte").unwrap_err());
    });

    // Il doppio ha la manopola, che è la stessa frase detta in memoria.
    let mut doppio = MemoryHost::new();
    doppio.nega_scrittura("blob");
    let dal_doppio = specie(&doppio.data_write("blob", b"i byte").unwrap_err());

    assert_eq!(
        (dal_kernel.as_str(), dal_doppio.as_str()),
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
fn le_scritture_lasciano_lo_stesso_vault_di_qua_e_di_la() {
    sui_due_host(None, |host| {
        let mut diario: Vec<(String, String)> = Vec::new();
        let id = DocId::new("Nota.md");

        // --- creazione ---
        diario.push(("creare".into(), faccia(&host.create_document(&id, "uno"))));
        diario.push((
            "e il testo è quello dato".into(),
            host.read_document(&id).unwrap_or_default(),
        ));
        diario.push((
            "ed è in elenco".into(),
            host.list_documents(None)
                .map(|p| p.items.contains(&id))
                .unwrap_or(false)
                .to_string(),
        ));
        diario.push((
            "e l'elenco ne conta uno".into(),
            host.list_documents(None)
                .map(|p| p.total)
                .unwrap_or(0)
                .to_string(),
        ));

        // --- scrittura intera, e la guardia della base ---
        let resa = host.write_document(&id, "due", WriteBase::Dictated);
        diario.push(("dettare una scrittura".into(), faccia(&resa)));
        let resa = resa.expect("la scrittura dettata riesce");
        diario.push((
            "la revisione resa è quella di adesso".into(),
            (host.document_revision(&id).ok().as_ref() == Some(&resa)).to_string(),
        ));
        diario.push((
            "ed è la base che la prossima accetta".into(),
            faccia(&host.write_document(&id, "tre", WriteBase::DescendsFrom(resa.clone()))),
        ));
        diario.push((
            "una base stantia".into(),
            faccia(&host.write_document(&id, "quattro", WriteBase::DescendsFrom(resa.clone()))),
        ));
        diario.push((
            "e dopo il rifiuto i byte sono intatti".into(),
            host.read_document(&id).unwrap_or_default(),
        ));
        diario.push((
            "discendere da ciò che non c'è".into(),
            faccia(&host.write_document(
                &DocId::new("Mai.md"),
                "x",
                WriteBase::DescendsFrom(resa),
            )),
        ));
        diario.push((
            "dettare ciò che non c'è lo crea".into(),
            faccia(&host.write_document(&DocId::new("Nata.md"), "n", WriteBase::Dictated)),
        ));

        // --- modifica chirurgica ---
        let base = host.document_revision(&id).expect("la revisione c'è");
        diario.push((
            "un edit".into(),
            faccia(&host.apply_edit(
                &id,
                EditRequest::new(
                    base.clone(),
                    vec![TextEdit::replace(Span { start: 0, end: 0 }, "A")],
                ),
            )),
        ));
        diario.push((
            "e il testo dopo l'edit".into(),
            host.read_document(&id).unwrap_or_default(),
        ));
        diario.push((
            "un edit su una base stantia".into(),
            faccia(&host.apply_edit(
                &id,
                EditRequest::new(
                    base,
                    vec![TextEdit::replace(Span { start: 0, end: 1 }, "X")],
                ),
            )),
        ));
        let base = host.document_revision(&id).expect("la revisione c'è");
        diario.push((
            "un edit fuori dal sorgente".into(),
            faccia(&host.apply_edit(
                &id,
                EditRequest::new(
                    base.clone(),
                    vec![TextEdit::replace(Span { start: 900, end: 901 }, "X")],
                ),
            )),
        ));
        diario.push((
            "due edit che si contendono lo stesso punto".into(),
            faccia(&host.apply_edit(
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
        diario.push((
            "un edit vuoto".into(),
            faccia(&host.apply_edit(&id, EditRequest::new(base, vec![]))),
        ));
        diario.push((
            "e dopo i rifiuti i byte".into(),
            host.read_document(&id).unwrap_or_default(),
        ));

        // --- rinomina, anche in una cartella che non c'è ---
        let dentro = DocId::new("Cartella/Rinominata.md");
        diario.push((
            "rinominare in una cartella che non c'è".into(),
            faccia(&host.rename_document(&id, &dentro)),
        ));
        diario.push((
            "e il testo ha seguito".into(),
            host.read_document(&dentro).unwrap_or_default(),
        ));
        diario.push((
            "mentre il nome vecchio non legge più".into(),
            faccia(&host.read_document(&id)),
        ));
        diario.push((
            "rinominare su sé stessi".into(),
            faccia(&host.rename_document(&dentro, &dentro)),
        ));

        // --- cestino e ripristino ---
        let cestinato = host.trash_document(&dentro).expect("si cestina");
        diario.push((
            "cestinare toglie dall'elenco".into(),
            host.list_documents(None)
                .map(|p| p.items.contains(&dentro))
                .unwrap_or(true)
                .to_string(),
        ));
        let voci = host.list_trash().expect("il cestino si elenca");
        diario.push(("e il cestino ha una voce".into(), voci.len().to_string()));
        diario.push((
            "che ricorda da dove veniva".into(),
            voci.first()
                .map(|v| v.original.to_string())
                .unwrap_or_default(),
        ));
        diario.push((
            "e quanto pesava".into(),
            voci.first().map(|v| v.size.to_string()).unwrap_or_default(),
        ));
        diario.push((
            "una voce cestinata non si legge come documento".into(),
            faccia(&host.read_document(&cestinato)),
        ));
        diario.push((
            "ripristinare senza dire dove".into(),
            host.restore_document(&cestinato, None)
                .map(|d| d.to_string())
                .unwrap_or_else(|e| specie(&e)),
        ));
        diario.push((
            "e il testo è tornato".into(),
            host.read_document(&dentro).unwrap_or_default(),
        ));
        diario.push((
            "e il cestino è vuoto".into(),
            host.list_trash().map(|v| v.len()).unwrap_or(99).to_string(),
        ));

        let cestinato = host.trash_document(&dentro).expect("si cestina");
        diario.push((
            "ripristinare altrove".into(),
            host.restore_document(&cestinato, Some(DocId::new("Altrove.md")))
                .map(|d| d.to_string())
                .unwrap_or_else(|e| specie(&e)),
        ));
        diario.push((
            "e il testo è là".into(),
            host.read_document(&DocId::new("Altrove.md"))
                .unwrap_or_default(),
        ));

        host.trash_document(&DocId::new("Altrove.md"))
            .expect("si cestina");
        diario.push((
            "svuotare il cestino conta".into(),
            host.empty_trash().map(|n| n.to_string()).unwrap_or_default(),
        ));
        diario.push((
            "e il cestino resta vuoto".into(),
            host.list_trash().map(|v| v.len()).unwrap_or(99).to_string(),
        ));
        diario.push((
            "svuotarlo di nuovo non distrugge niente".into(),
            host.empty_trash().map(|n| n.to_string()).unwrap_or_default(),
        ));

        diario.push((
            "un nome libero a partire da uno occupato".into(),
            host.free_name(&DocId::new("Nata.md")).to_string(),
        ));
        diario.push((
            "e a partire da uno libero".into(),
            host.free_name(&DocId::new("Libera.md")).to_string(),
        ));
        diario
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
fn ogni_nome_e_ogni_formato_si_giudicano_uguale_di_qua_e_di_la() {
    sui_due_host(None, |host| {
        let mut diario: Vec<(String, String)> = Vec::new();
        let partenza = DocId::new("Nota.md");
        host.create_document(&partenza, "uno due tre")
            .expect("si scrive");

        for nome in [
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
            let id = DocId::new(nome);
            diario.push((
                format!("creare {nome:?}"),
                faccia(&host.create_document(&id, "x")),
            ));
            diario.push((
                format!("scrivere {nome:?}"),
                faccia(&host.write_document(&id, "x", WriteBase::Dictated)),
            ));
            diario.push((
                format!("leggere {nome:?}"),
                faccia(&host.read_document(&id)),
            ));
            diario.push((
                format!("rinominare Nota.md in {nome:?}"),
                faccia(&host.rename_document(&partenza, &id)),
            ));
            diario.push((
                format!("e Nota.md dopo il tentativo su {nome:?}"),
                faccia(&host.read_document(&partenza)),
            ));
            diario.push((
                format!("cestinare {nome:?}"),
                faccia(&host.trash_document(&id)),
            ));
        }
        diario
    });
}
