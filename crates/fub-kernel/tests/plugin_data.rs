//! Lo storage persistente per-plugin dell'[`HostApi`], e il suo recinto.
//!
//! Le capacità `data_*` sono nate per chiudere il buco che il dogfooding del
//! versioning aveva trovato: un `EventHandler` scritto come lo scriverebbe un
//! plugin non poteva tenere uno store su disco. Chiudendolo si è aperto un
//! confine di sicurezza — un plugin nomina blob, e i blob devono restare dentro
//! `.fub/data/plugins/<id>/`. Qui si verifica proprio quello: che ci restino,
//! che ogni plugin veda solo i propri, e che ogni tentativo di uscirne sia un
//! `PermissionDenied` e non un file scritto altrove.

use camino::Utf8PathBuf;
use fub_abi::error::PluginError;
use fub_kernel::{data_root, FormatRegistry, Workspace};
use fub_testkit::{Bench, Mounted};

fn vault() -> Mounted {
    // I plugin di prova si dichiarano prima di usare un host (§7.3): un id che
    // nessuno ha dichiarato riceve un host che nega tutto.
    Bench::new()
        .without_format()
        .without_scan()
        .with_plugins(["prova.plugin", "uno", "due"])
        .mounts()
}

#[test]
fn a_blob_written_by_a_plugin_lands_in_its_own_corner_of_the_vault() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();

    ws.with_host("prova.plugin", |host| {
        host.data_write("cartella/dato.bin", b"contenuto").unwrap();
    });

    assert_eq!(
        std::fs::read(
            data_root(&root)
                .join("plugins")
                .join("prova.plugin")
                .join("cartella")
                .join("dato.bin")
        )
        .unwrap(),
        b"contenuto",
        "a plugin's data space is `.fub/data/plugins/<id>/`, \
         and intermediate directories are created by the host"
    );
}

#[test]
fn what_a_plugin_writes_it_can_read_back_list_and_remove() {
    let mut ws = vault();

    ws.with_host("prova.plugin", |host| {
        assert_eq!(
            host.data_read("never-written").unwrap(),
            None,
            "missing is not an error"
        );

        host.data_write("index.json", b"{}").unwrap();
        host.data_write("doc/a.md", b"first").unwrap();
        host.data_write("doc/b.md", b"second").unwrap();

        assert_eq!(
            host.data_read("doc/a.md").unwrap().as_deref(),
            Some(&b"first"[..])
        );
        assert_eq!(
            host.data_list("").unwrap(),
            vec!["doc/a.md", "doc/b.md", "index.json"],
            "the list is recursive and sorted: anyone rebuilding an index counts on it"
        );
        assert_eq!(host.data_list("doc").unwrap(), vec!["doc/a.md", "doc/b.md"]);
        assert!(
            host.data_list("never-existing").unwrap().is_empty(),
            "a nonexistent prefix yields an empty list, not an error"
        );

        host.data_remove("doc/a.md").unwrap();
        assert_eq!(host.data_read("doc/a.md").unwrap(), None);
        host.data_remove("doc/a.md")
            .expect("deleting twice succeeds anyway");
    });
}

#[test]
fn two_plugins_do_not_see_each_others_data() {
    let mut ws = vault();

    ws.with_host("uno", |host| {
        host.data_write("state.json", b"one's data").unwrap()
    });
    ws.with_host("due", |host| {
        host.data_write("state.json", b"two's data").unwrap()
    });

    ws.with_host("uno", |host| {
        assert_eq!(
            host.data_read("state.json").unwrap().as_deref(),
            Some(&b"one's data"[..])
        );
        assert_eq!(
            host.data_list("").unwrap(),
            vec!["state.json"],
            "the same name in two different spaces is not the same blob"
        );
    });
}

#[test]
fn nothing_a_plugin_can_name_escapes_its_own_space() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();

    // Ognuno di questi, senza recinto, scriverebbe fuori dallo spazio del
    // plugin — nel vault dell'utente, o oltre.
    let attempts = [
        "../../../outside.txt",
        "..",
        "/etc/passwd",
        "folder/../../outside.txt",
        "back\\slash.txt",
        "./hidden",
    ];

    ws.with_host("test.plugin", |host| {
        for path in attempts {
            let result = host.data_write(path, b"I should not be here");
            assert!(
                matches!(result, Err(PluginError::PermissionDenied(_))),
                "`{path}` was supposed to be refused, instead: {result:?}"
            );
            assert!(matches!(
                host.data_read(path),
                Err(PluginError::PermissionDenied(_))
            ));
        }
        // Nemmeno il blob senza nome: è una richiesta malformata, non la radice.
        assert!(matches!(
            host.data_write("", b"nothing"),
            Err(PluginError::BadArgs(_))
        ));
    });

    assert!(!root.join("outside.txt").exists());
    assert!(!data_root(&root).join("outside.txt").exists());
}

// Lo `storage_*` volatile è stato TOLTO dal contratto con la decisione 0013 (linea di base
// ritagliata in `crates/fub-abi/wit/frozen/0.1.0.wit`), e con esso il test che ne provava lo
// spazio dei nomi. Ciò che quel test difendeva — due feature che scelgono la
// stessa chiave generica non si pestano — resta vero e provato qui sopra per
// `data_*`, dove il recinto sta nella firma invece che nell'implementazione.

#[test]
fn the_clock_is_a_capability_too() {
    let mut ws = vault();

    let t = ws.with_host("prova.plugin", |host| host.now_unix_millis());

    // Non si verifica *che ora sia* — si verifica che l'ora arrivi dall'host e
    // sia plausibile: un plugin sandboxato non ha `SystemTime::now`.
    assert!(
        t > 1_700_000_000_000,
        "milliseconds from UNIX epoch, not seconds"
    );
}

#[test]
fn a_plugin_can_look_around_the_vault_not_only_react_to_events() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Note.txt"), "body").unwrap();
    std::fs::write(root.join("Other.txt"), "other").unwrap();

    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(TxtProvider))
        .expect("no extension conflict");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in ["prova.plugin", "uno", "due"] {
        ws.register_core_feature(plugin, plugin)
            .expect("declared");
    }
    ws.reindex().unwrap();

    let seen = ws
        .with_host("prova.plugin", |host| host.list_documents(None))
        .unwrap();

    assert_eq!(
        seen.items.iter().map(|d| d.0.as_str()).collect::<Vec<_>>(),
        vec!["Other.txt", "Note.txt"],
        "without `list_documents` a plugin can only read the ids that arrive \
         from events: no response to `vault-opened`, no functionality over the \
         entire vault"
    );
}

// --- provider minimo, solo per avere dei documenti da elencare ---------------

use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;

struct TxtProvider;

impl FormatProvider for TxtProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("txt", "Plain text (test)", &["txt"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source = source.text().unwrap_or_default();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
        Ok(model)
    }
    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}
