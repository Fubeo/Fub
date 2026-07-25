//! Lo storage persistente per-plugin dell'[`HostApi`], e il suo recinto.
//!
//! Le capacità `data_*` sono nate per chiudere il buco che il dogfooding del
//! versioning aveva trovato: un `EventHandler` scritto come lo scriverebbe un
//! plugin non poteva tenere uno store su disco. Chiudendolo si è aperto un
//! confine di sicurezza — un plugin nomina blob, e i blob devono restare dentro
//! `.fubmd-data/plugins/<id>/`. Qui si verifica proprio quello: che ci restino,
//! che ogni plugin veda solo i propri, e che ogni tentativo di uscirne sia un
//! `PermissionDenied` e non un file scritto altrove.

use camino::Utf8PathBuf;
use fubmd_abi::error::PluginError;
use fubmd_kernel::{FormatRegistry, Workspace};

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let ws = Workspace::new(&root, FormatRegistry::new());
    (dir, ws)
}

#[test]
fn a_blob_written_by_a_plugin_lands_in_its_own_corner_of_the_vault() {
    let (dir, mut ws) = vault();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();

    ws.with_host("prova.plugin", |host| {
        host.data_write("cartella/dato.bin", b"contenuto").unwrap();
    });

    assert_eq!(
        std::fs::read(
            root.join(".fubmd-data")
                .join("plugins")
                .join("prova.plugin")
                .join("cartella")
                .join("dato.bin")
        )
        .unwrap(),
        b"contenuto",
        "lo spazio dati di un plugin è `.fubmd-data/plugins/<id>/`, \
         e le directory intermedie le crea l'host"
    );
}

#[test]
fn what_a_plugin_writes_it_can_read_back_list_and_remove() {
    let (_dir, mut ws) = vault();

    ws.with_host("prova.plugin", |host| {
        assert_eq!(
            host.data_read("mai-scritto").unwrap(),
            None,
            "mancare non è un errore"
        );

        host.data_write("indice.json", b"{}").unwrap();
        host.data_write("doc/a.md", b"prima").unwrap();
        host.data_write("doc/b.md", b"seconda").unwrap();

        assert_eq!(
            host.data_read("doc/a.md").unwrap().as_deref(),
            Some(&b"prima"[..])
        );
        assert_eq!(
            host.data_list("").unwrap(),
            vec!["doc/a.md", "doc/b.md", "indice.json"],
            "l'elenco è ricorsivo e ordinato: chi ricostruisce un indice ci conta"
        );
        assert_eq!(host.data_list("doc").unwrap(), vec!["doc/a.md", "doc/b.md"]);
        assert!(
            host.data_list("mai-esistita").unwrap().is_empty(),
            "un prefisso che non c'è è una lista vuota, non un errore"
        );

        host.data_remove("doc/a.md").unwrap();
        assert_eq!(host.data_read("doc/a.md").unwrap(), None);
        host.data_remove("doc/a.md")
            .expect("cancellare due volte riesce lo stesso");
    });
}

#[test]
fn two_plugins_do_not_see_each_others_data() {
    let (_dir, mut ws) = vault();

    ws.with_host("uno", |host| {
        host.data_write("stato.json", b"di uno").unwrap()
    });
    ws.with_host("due", |host| {
        host.data_write("stato.json", b"di due").unwrap()
    });

    ws.with_host("uno", |host| {
        assert_eq!(
            host.data_read("stato.json").unwrap().as_deref(),
            Some(&b"di uno"[..])
        );
        assert_eq!(
            host.data_list("").unwrap(),
            vec!["stato.json"],
            "lo stesso nome in due spazi diversi non è lo stesso blob"
        );
    });
}

#[test]
fn nothing_a_plugin_can_name_escapes_its_own_space() {
    let (dir, mut ws) = vault();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();

    // Ognuno di questi, senza recinto, scriverebbe fuori dallo spazio del
    // plugin — nel vault dell'utente, o oltre.
    let tentativi = [
        "../../../fuori.txt",
        "..",
        "/etc/passwd",
        "cartella/../../fuori.txt",
        "sotto\\cartella.txt",
        "./nascosto",
    ];

    ws.with_host("prova.plugin", |host| {
        for path in tentativi {
            let esito = host.data_write(path, b"non dovrei essere qui");
            assert!(
                matches!(esito, Err(PluginError::PermissionDenied(_))),
                "`{path}` doveva essere rifiutato, invece: {esito:?}"
            );
            assert!(matches!(
                host.data_read(path),
                Err(PluginError::PermissionDenied(_))
            ));
        }
        // Nemmeno il blob senza nome: è una richiesta malformata, non la radice.
        assert!(matches!(
            host.data_write("", b"niente"),
            Err(PluginError::BadArgs(_))
        ));
    });

    assert!(!root.join("fuori.txt").exists());
    assert!(!root.join(".fubmd-data").join("fuori.txt").exists());
}

#[test]
fn volatile_storage_is_namespaced_per_plugin() {
    // Due feature che scelgono la stessa chiave generica ("cursor", "config")
    // non devono pestarsi: `data_*` ha il recinto in firma, `storage_*` lo ha
    // nell'implementazione.
    let (_dir, mut ws) = vault();

    ws.with_host("uno", |host| {
        host.storage_set("config", serde_json::json!("di uno"))
    });
    ws.with_host("due", |host| {
        host.storage_set("config", serde_json::json!("di due"))
    });

    assert_eq!(
        ws.with_host("uno", |host| host.storage_get("config")),
        Some(serde_json::json!("di uno"))
    );
    assert_eq!(
        ws.with_host("due", |host| host.storage_get("config")),
        Some(serde_json::json!("di due"))
    );
    assert_eq!(
        ws.with_host("terzo", |host| host.storage_get("config")),
        None,
        "chi non ha mai scritto non vede le chiavi altrui"
    );
}

#[test]
fn the_clock_is_a_capability_too() {
    let (_dir, mut ws) = vault();

    let t = ws.with_host("prova.plugin", |host| host.now_unix_millis());

    // Non si verifica *che ora sia* — si verifica che l'ora arrivi dall'host e
    // sia plausibile: un plugin sandboxato non ha `SystemTime::now`.
    assert!(
        t > 1_700_000_000_000,
        "millisecondi dall'epoca UNIX, non secondi"
    );
}

#[test]
fn a_plugin_can_look_around_the_vault_not_only_react_to_events() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Appunto.txt"), "corpo").unwrap();
    std::fs::write(root.join("Altro.txt"), "altro").unwrap();

    let mut registry = FormatRegistry::new();
    registry.register(Box::new(TxtProvider));
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().unwrap();

    let visti = ws
        .with_host("prova.plugin", |host| host.list_documents())
        .unwrap();

    assert_eq!(
        visti.iter().map(|d| d.0.as_str()).collect::<Vec<_>>(),
        vec!["Altro.txt", "Appunto.txt"],
        "senza `list_documents` un plugin può leggere solo gli id che gli \
         arrivano dagli eventi: niente risposta a `vault-opened`, niente \
         funzionalità sull'intero vault"
    );
}

// --- provider minimo, solo per avere dei documenti da elencare ---------------

use fubmd_abi::error::FormatError;
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::FormatProvider;

struct TxtProvider;

impl FormatProvider for TxtProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "txt".into(),
            name: "Testo semplice (test)".into(),
            extensions: vec!["txt".into()],
        }
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
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
