//! **Il recinto è uno, e ogni path che entra ci passa.**
//!
//! Il recinto è una funzione del contratto — `path_policy::fenced`, e la sua
//! forma per chi arriva da fuori `path_policy::fenced_doc_id` — e la proprietà
//! che questo banco tiene non è «quella funzione risponde bene» (lo prova il
//! suo modulo, e la fixture del §6.2 lo prova anche contro la gemella
//! TypeScript): è che **chi compone un path la chiama**. Le quattro porte che
//! erano rimaste aperte sullo stesso muro stavano tutte lì — non nella regola,
//! ma in un sito che non gliela chiedeva.
//!
//! - `Vault::path_for` è l'unico posto in cui questo vault compone un path
//!   assoluto, e il recinto lessicale che stava a valle (`starts_with` sulla
//!   cartella del cestino) confrontava i segmenti **così come sono scritti**:
//!   `.trash/../../fuori.txt` comincia per `.trash` segmento per segmento, e il
//!   sistema operativo, che i `..` li risolve, apriva fuori (0158);
//! - il ripristino con una destinazione scelta dal chiamante fa **nascere** un
//!   nome, e lo giudicava col solo recinto: `.nascosta/Nota.md` è legale su
//!   ogni filesystem e la scansione lo salta, cioè la nota tornava invisibile a
//!   chi l'aveva ripristinata (0186);
//! - le chiavi di `.fub/workspace.json` arrivano dal disco e nominano documenti
//!   e cartelle, e non passavano da nessun varco (0177);
//! - il doppio del contratto non applicava recinto affatto, cioè chi prova una
//!   view contro `MemoryHost` vedeva passare i path che l'host vero rifiuta
//!   (0220 — quel presidio sta in `crates/fub-sdk`, che è dove vive il doppio).
//!
//! Ogni test qui sotto è rosso se si toglie la riparazione della sua riga, e la
//! forma è sempre la stessa: si costruisce il path ostile **fuori** dalle
//! strade che già lo rifiutano, e si guarda il disco.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_kernel::storage::{FsStorage, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, OrganizationStore, Vault, Workspace};
use fub_testkit::SampleText;

struct Bench {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Bench {
    /// La radice del vault è una **sottocartella** del temporaneo, non il
    /// temporaneo: così ciò che scappa dalla radice atterra in un posto che
    /// esiste e che sparisce con il banco. Se la radice fosse il temporaneo
    /// stesso, un test rosso lascerebbe il suo file in `/tmp` e il test dopo —
    /// o il verde di domani — leggerebbe quel residuo invece del proprio
    /// fallimento, che è il modo in cui un presidio smette di essere un
    /// presidio senza che nessuno lo tocchi.
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
        std::fs::create_dir_all(&root).expect("la radice");
        Bench { _dir: dir, root }
    }

    fn write(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        std::fs::create_dir_all(path.parent().expect("un file ha una cartella")).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn vault(&self) -> Vault {
        Vault::on(&self.root, Arc::new(FsStorage) as Arc<dyn VaultStorage>)
            .expect("l'apertura del vault riesce")
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(SampleText::by_extension("txt").boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::on(
            &self.root,
            registry,
            Arc::new(FsStorage),
            MachineSettings::in_memory(),
        )
        .expect("l'apertura del vault riesce");
        ws.reindex().expect("la scansione della radice");
        ws
    }
}

// ---------------------------------------------------------------------------
// 0158 — il recinto del cestino non si accontenta di come un path è scritto
// ---------------------------------------------------------------------------

/// Svuotare il cestino è l'unica cancellazione che il vault sa fare, e vale
/// **solo** dentro `.trash/`. L'id arriva da `list_trash`, ma `Vault` è una
/// superficie pubblica e la guardia deve reggere anche a chi lo compone da sé:
/// finché confrontava i segmenti come sono scritti, `.trash/../fuori.txt`
/// passava — comincia per `.trash` — e il file cancellato era quello vero.
#[test]
fn a_deletion_in_the_trash_not_goes_back_outside() {
    let bench = Bench::new();
    bench.write("fuori.txt", "il file di qualcun altro");
    bench.write(".trash/Idea.txt", "cestinata");
    let vault = bench.vault();

    let outcome = vault.remove_trashed(&DocId::new(".trash/../fuori.txt"));

    assert!(
        outcome.is_err(),
        "un id che risale non è una voce del cestino"
    );
    assert!(
        bench.root.join("fuori.txt").exists(),
        "il file fuori dal cestino è ancora lì"
    );
}

/// L'altro verso della stessa porta: la **destinazione** di un ripristino. A
/// livello di vault non la guardava nessuno — `leave_trash` controllava da dove
/// si parte e non dove si arriva — quindi un `to` che risale spostava la voce
/// fuori dalla radice.
#[test]
fn a_restore_not_lands_outside_from_the_root() {
    let bench = Bench::new();
    bench.write(".trash/Idea.txt", "cestinata");
    let vault = bench.vault();

    let outcome = vault.restore_trashed(&DocId::new(".trash/Idea.txt"), &DocId::new("../fuori.txt"));

    assert!(outcome.is_err(), "una destinazione che risale si rifiuta");
    assert!(
        !bench
            .root
            .parent()
            .expect("la radice ha un genitore")
            .join("fuori.txt")
            .exists(),
        "niente è stato scritto fuori dalla radice"
    );
    assert!(
        bench.root.join(".trash/Idea.txt").exists(),
        "e la voce del cestino non si è mossa"
    );
}

/// Il recinto sta in `path_for`, cioè nel punto in cui il path si compone: chi
/// aggiunge il tredicesimo sito lo eredita senza saperlo. La prova è che una
/// lettura qualunque — che con il cestino non c'entra niente — lo applica già.
#[test]
fn no_path_composed_from_this_vault_exits_from_the_root() {
    let bench = Bench::new();
    bench.write("fuori.txt", "il file di qualcun altro");
    let vault = bench.vault();

    assert!(vault.path_for(&DocId::new("../fuori.txt")).is_err());
    assert!(vault.read(&DocId::new("../fuori.txt")).is_err());
    assert!(!vault.exists(&DocId::new("../fuori.txt")));
    assert!(vault.write(&DocId::new("../scritto.txt"), "no").is_err());
    assert!(!bench
        .root
        .parent()
        .expect("la radice ha un genitore")
        .join("scritto.txt")
        .exists());
}

// ---------------------------------------------------------------------------
// 0186 — una destinazione scelta dal chiamante è un nome che nasce
// ---------------------------------------------------------------------------

/// Un ripristino con `to` è il caso in cui il path d'origine era occupato e
/// l'utente ne ha digitato un altro: quel nome **nasce adesso**, e un nome che
/// nasce non comincia col punto. Se ci riuscisse, la nota tornerebbe in un
/// posto che la scansione salta — invisibile a chi l'ha ripristinata, e con la
/// sua voce fantasma in anagrafe.
#[test]
fn a_restore_does_not_land_where_the_scan_does_not_watch() {
    let bench = Bench::new();
    bench.write("Idea.txt", "un'idea");
    let mut ws = bench.workspace();
    let trashed = ws.delete_document(&DocId::new("Idea.txt")).unwrap();

    let err = ws
        .restore_from_trash(&trashed, Some(DocId::new(".nascosta/Idea.txt")))
        .unwrap_err();

    assert!(err.to_string().contains("nome non valido"), "{err}");
    assert!(
        !bench.root.join(".nascosta").exists(),
        "niente è stato creato nella cartella nascosta"
    );
    assert!(
        !ws.documents().contains(&DocId::new(".nascosta/Idea.txt")),
        "e in anagrafe non è comparsa nessuna voce fantasma"
    );
}

/// Il verso opposto, che è la ragione per cui le due strade fanno due domande
/// diverse: **senza** `to` non nasce nessun nome, ne torna uno che c'era. Una
/// nota che si chiamava `CON.txt` — legale su Linux, impossibile su Windows —
/// deve poter tornare, o si perde un file per un nome che il vault conteneva
/// già.
#[test]
fn a_restore_to_its_place_brings_back_a_name_that_would_not_be_created() {
    let bench = Bench::new();
    bench.write("CON.txt", "un nome che su Windows non si crea");
    let mut ws = bench.workspace();
    let trashed = ws.delete_document(&DocId::new("CON.txt")).unwrap();

    let returned = ws
        .restore_from_trash(&trashed, None)
        .expect("il nome c'era già: torna");

    assert_eq!(returned, DocId::new("CON.txt"));
    assert!(bench.root.join("CON.txt").exists());
}

// ---------------------------------------------------------------------------
// 0177 — le chiavi del sidecar dell'organizzazione arrivano dal disco
// ---------------------------------------------------------------------------

/// `.fub/workspace.json` è un file di testo dentro il vault: lo scrive Fub, ma
/// lo può scrivere anche una mano. Ogni sua chiave nomina un documento o una
/// cartella, e finché non passava da nessun varco un `pinned` che risale
/// diventava una riga della sidebar e un path composto da chi la disegna.
///
/// Ciò che resta vale: il recinto scarta le chiavi che non nominano un posto di
/// questo vault, non il file.
#[test]
fn a_key_written_a_hand_passes_from_the_fence_as_every_other_path() {
    let bench = Bench::new();
    bench.write(
        ".fub/workspace.json",
        r#"{
          "version": 1,
          "icons": {"..\\..\\altrove": "📌", "Nota.txt": "📘"},
          "pinned": ["../../.ssh/authorized_keys", "Nota.txt"],
          "spaces": [".fub"],
          "order": {"": ["../outside.txt", "Nota.txt"]}
        }"#,
    );

    let (store, failure) = OrganizationStore::open(&bench.root, Arc::new(FsStorage));

    assert!(failure.is_none(), "il file si legge: {failure:?}");
    let org = store.snapshot();
    assert_eq!(
        org.icons.keys().collect::<Vec<_>>(),
        vec!["Nota.txt"],
        "l'icona che risale non è di nessuno"
    );
    assert_eq!(org.pinned, ["Nota.txt"], "e nemmeno il preferito");
    assert!(
        org.spaces.is_empty(),
        "lo spazio macchina non è una cartella da organizzare"
    );
    assert_eq!(
        org.order[""],
        ["Nota.txt"],
        "un ordine nomina i figli di una cartella, non i vicini di sopra"
    );

    let warnings = store.take_warnings();
    assert_eq!(warnings.len(), 1, "e qualcuno lo dice: {warnings:?}");
    assert!(
        warnings[0].contains("non stanno in questo vault"),
        "{}",
        warnings[0]
    );
}
