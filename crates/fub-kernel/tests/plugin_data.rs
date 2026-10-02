//! Lo storage persistente per-plugin dell'[`HostApi`], e il suo recinto.
//!
//! Le capacità `data_*` sono nate per chiudere il buco che il dogfooding del
//! versioning aveva trovato: un `EventHandler` scritto come lo scriverebbe un
//! plugin non poteva tenere uno store su disco. Chiudendolo si è aperto un
//! confine di sicurezza — un plugin nomina blob, e i blob devono restare dentro
//! `.fub/plugins/<id>/` per i dati autorevoli e `.fub/data/plugins/<id>/` per la cache. Qui si verifica proprio quello: che ci restino,
//! che ogni plugin veda solo i propri, e che ogni tentativo di uscirne sia un
//! `PermissionDenied` e non un file scritto altrove.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::error::PluginError;
use fub_kernel::storage::{DirEntry, FsStorage, Merge, Stat, VaultStorage};
use fub_kernel::{data_root, FormatRegistry, MachineSettings, Workspace};
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
            root.join(".fub")
                .join("plugins")
                .join("prova.plugin")
                .join("cartella")
                .join("dato.bin")
        )
        .unwrap(),
        b"contenuto",
        "authoritative plugin data lives in `.fub/plugins/<id>/`, \
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

/// **Un elenco che non si legge non è un elenco vuoto, né uno più corto.**
///
/// Il contratto concede il vuoto al solo prefisso che non esiste. Una
/// cartella dello spazio che il supporto non lascia elencare spariva invece in
/// silenzio: il ripristino di un backup riportava meno file dicendo di esserci
/// riuscito, e la ricostruzione dell'indice delle versioni ne dimenticava.
#[cfg(unix)]
#[test]
fn a_listing_that_fails_is_not_a_shorter_list() {
    use std::os::unix::fs::PermissionsExt;

    let mut ws = vault();
    let root = ws.root().to_path_buf();
    ws.with_host("prova.plugin", |host| {
        host.data_write("index.json", b"{}").unwrap();
        host.data_write("doc/a.md", b"first").unwrap();
        assert!(
            host.data_list("index.json").unwrap().is_empty(),
            "a blob has no blobs below it"
        );
    });

    let doc = root.join(".fub/plugins/prova.plugin/doc");
    let set = |mode| {
        std::fs::set_permissions(&doc, std::fs::Permissions::from_mode(mode)).expect("permissions")
    };
    set(0o000);
    if std::fs::read_dir(&doc).is_ok() {
        // Chi gira da root elenca lo stesso: il guasto non si riproduce.
        set(0o755);
        return;
    }
    let (whole, below) = ws.with_host("prova.plugin", |host| {
        (host.data_list(""), host.data_list("doc"))
    });
    set(0o755);

    assert!(
        matches!(whole, Err(PluginError::Io(_))),
        "a folder that cannot be listed is a fault: {whole:?}"
    );
    assert!(
        matches!(below, Err(PluginError::Io(_))),
        "the prefix itself cannot be listed: {below:?}"
    );
}

#[test]
fn cache_blobs_use_the_derived_root_without_mixing_authoritative_data() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();

    ws.with_host("prova.plugin", |host| {
        host.data_write("authoritative.json", b"keep").unwrap();
        host.cache_write("index.json", b"rebuildable").unwrap();
        assert_eq!(
            host.data_read("authoritative.json").unwrap().as_deref(),
            Some(&b"keep"[..])
        );
        assert_eq!(
            host.cache_read("index.json").unwrap().as_deref(),
            Some(&b"rebuildable"[..])
        );
        assert_eq!(
            host.data_read("index.json").unwrap(),
            None,
            "cache blobs are not authoritative data when the canonical root exists"
        );
        assert_eq!(host.cache_read("authoritative.json").unwrap(), None);
    });

    assert!(root
        .join(".fub/plugins/prova.plugin/authoritative.json")
        .exists());
    assert!(root
        .join(".fub/data/plugins/prova.plugin/index.json")
        .exists());
    assert!(
        root.join(".fub/data/plugins/prova.plugin/.fub-cache-root")
            .exists(),
        "a cache write marks the derived root so data_* cannot mistake it for legacy data"
    );
}

#[test]
fn a_cache_write_on_a_plugin_without_data_is_not_authoritative() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();

    ws.with_host("prova.plugin", |host| {
        host.cache_write("index.json", b"rebuildable").unwrap();
        assert_eq!(
            host.cache_read("index.json").unwrap().as_deref(),
            Some(&b"rebuildable"[..])
        );
        assert_eq!(
            host.data_read("index.json").unwrap(),
            None,
            "cache-first must not make `.fub/data/plugins/<id>/` look like leftover data"
        );
        assert!(
            host.data_list("").unwrap().is_empty(),
            "a plugin that has only cache has no authoritative blobs"
        );
    });

    assert!(
        !root.join(".fub/plugins/prova.plugin").exists(),
        "cache-first does not invent a canonical tree"
    );
    assert!(root
        .join(".fub/data/plugins/prova.plugin/index.json")
        .exists());
    assert!(root
        .join(".fub/data/plugins/prova.plugin/.fub-cache-root")
        .exists());
}

#[test]
fn a_cache_write_migrates_legacy_data_before_creating_cache() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();
    let legacy = data_root(&root).join("plugins/prova.plugin/old.json");
    std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    std::fs::write(&legacy, b"legacy").unwrap();

    ws.with_host("prova.plugin", |host| {
        host.cache_write("index.json", b"rebuildable").unwrap();
        assert_eq!(
            host.data_read("old.json").unwrap().as_deref(),
            Some(&b"legacy"[..]),
            "legacy bytes move to the canonical root before cache is written"
        );
        assert_eq!(host.data_read("index.json").unwrap(), None);
        assert_eq!(
            host.cache_read("index.json").unwrap().as_deref(),
            Some(&b"rebuildable"[..])
        );
    });

    assert_eq!(
        std::fs::read(root.join(".fub/plugins/prova.plugin/old.json")).unwrap(),
        b"legacy"
    );
    assert!(
        !legacy.exists(),
        "the old tree is no longer a second source"
    );
    assert!(root
        .join(".fub/data/plugins/prova.plugin/.fub-cache-root")
        .exists());
}

/// Le due strade di `cache_write`: quella diretta dell'host del kernel e quella
/// staccata dei job, che passa dal token preparato senza custodire il
/// workspace. Devono fare la stessa cosa, ed è ciò che le prove qui sotto
/// chiedono a entrambe.
#[derive(Clone, Copy, Debug)]
enum CacheWrite {
    Direct,
    Detached,
}

impl CacheWrite {
    fn write(self, ws: &mut Mounted, rel: &str, bytes: &[u8]) -> Result<(), PluginError> {
        match self {
            CacheWrite::Direct => ws.with_host("prova.plugin", |host| host.cache_write(rel, bytes)),
            CacheWrite::Detached => ws
                .prepare_plugin_data_io("prova.plugin", rel)?
                .write_cache(bytes),
        }
    }
}

/// Un vault con tutte e due le radici dei dati di `prova.plugin`: la canonica,
/// nata da una scrittura diretta, e la legacy senza marcatore, che è ancora
/// dato autorevole.
fn both_roots() -> (Mounted, Utf8PathBuf) {
    let ws = vault();
    let root = ws.root().to_path_buf();
    let put = |rel: &str, body: &[u8]| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };
    put(".fub/plugins/prova.plugin/timers.json", b"{}");
    put(".fub/data/plugins/prova.plugin/old.json", b"legacy");
    put(
        ".fub/data/plugins/prova.plugin/doc/Nota.md/x",
        b"legacy space",
    );
    (ws, root)
}

/// AUDIT-DATI-04: con la radice canonica già presente, la scrittura di cache
/// staccata posava il marcatore sui dati legacy, che da lì gli snapshot
/// escludevano e un ripristino toglieva. Adesso entrambe le strade portano i
/// dati nella radice canonica prima di posare il marcatore.
#[test]
fn a_cache_write_moves_legacy_data_even_when_the_canonical_root_exists() {
    for path in [CacheWrite::Direct, CacheWrite::Detached] {
        let (mut ws, root) = both_roots();

        path.write(&mut ws, "index.json", b"rebuildable")
            .unwrap_or_else(|error| panic!("{path:?}: {error:?}"));

        let canonical = root.join(".fub/plugins/prova.plugin");
        assert_eq!(
            std::fs::read(canonical.join("old.json")).unwrap(),
            b"legacy",
            "{path:?}"
        );
        assert_eq!(
            std::fs::read(canonical.join("doc/Nota.md/x")).unwrap(),
            b"legacy space",
            "{path:?}"
        );
        assert_eq!(
            std::fs::read(canonical.join("timers.json")).unwrap(),
            b"{}",
            "{path:?}"
        );
        let legacy = root.join(".fub/data/plugins/prova.plugin");
        assert!(!legacy.join("old.json").exists(), "{path:?}");
        assert!(!legacy.join("doc/Nota.md/x").exists(), "{path:?}");
        assert!(legacy.join(".fub-cache-root").exists(), "{path:?}");
        ws.with_host("prova.plugin", |host| {
            assert_eq!(
                host.data_read("old.json").unwrap().as_deref(),
                Some(&b"legacy"[..]),
                "{path:?}"
            );
            assert_eq!(
                host.cache_read("index.json").unwrap().as_deref(),
                Some(&b"rebuildable"[..]),
                "{path:?}"
            );
        });
    }
}

/// Un nome preso da tutte e due le radici non si sceglie: la scrittura di
/// cache si rifiuta, il marcatore non si posa e i due dati restano dove sono.
#[test]
fn a_name_in_both_roots_stops_the_cache_write_and_leaves_the_legacy_root_authoritative() {
    for path in [CacheWrite::Direct, CacheWrite::Detached] {
        let (mut ws, root) = both_roots();
        std::fs::write(
            root.join(".fub/plugins/prova.plugin/old.json"),
            b"canonical",
        )
        .unwrap();

        let refused = path.write(&mut ws, "index.json", b"rebuildable");

        assert!(
            matches!(refused, Err(PluginError::Io(_))),
            "{path:?}: {refused:?}"
        );
        let legacy = root.join(".fub/data/plugins/prova.plugin");
        assert!(
            !legacy.join(".fub-cache-root").exists(),
            "{path:?}: the marker turned legacy data into cache"
        );
        assert_eq!(
            std::fs::read(legacy.join("old.json")).unwrap(),
            b"legacy",
            "{path:?}"
        );
        assert_eq!(
            std::fs::read(root.join(".fub/plugins/prova.plugin/old.json")).unwrap(),
            b"canonical",
            "{path:?}"
        );
        assert!(!legacy.join("index.json").exists(), "{path:?}");
    }
}

/// Un supporto che, acceso l'interruttore, non sa dire se la radice vecchia
/// dei dati di `prova.plugin` c'è.
struct LegacyStatFails {
    inner: FsStorage,
    failing: AtomicBool,
}

impl VaultStorage for LegacyStatFails {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
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
        if self.failing.load(Ordering::Relaxed) && path.ends_with(".fub/data/plugins/prova.plugin")
        {
            return Err(std::io::Error::other("il disco non risponde"));
        }
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// **Una radice di cui il disco non sa dire niente non è una radice
/// assente.** Fra dati autorevoli e cache si sceglie guardando quali radici ci
/// sono, e una `stat` fallita valeva «non c'è»: la lettura cercava nella
/// radice sbagliata e rispondeva «mai scritto», e una scrittura di cache
/// posava il marcatore dentro i dati vecchi — che da lì in poi, tornato il
/// disco, nessuno leggeva più.
#[test]
fn a_legacy_root_that_cannot_be_stat_is_not_taken_for_cache() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let legacy = data_root(&root).join("plugins/prova.plugin/old.json");
    std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    std::fs::write(&legacy, b"legacy").unwrap();
    let storage = Arc::new(LegacyStatFails {
        inner: FsStorage,
        failing: AtomicBool::new(false),
    });
    let mut ws = Workspace::on(
        &root,
        FormatRegistry::new(),
        storage.clone() as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.register_core_feature("prova.plugin", "prova.plugin")
        .expect("dichiarato");

    storage.failing.store(true, Ordering::Relaxed);
    ws.with_host("prova.plugin", |host| {
        assert!(
            host.data_read("old.json").is_err(),
            "letto come mai scritto"
        );
        assert!(
            host.data_list("").is_err(),
            "elencato dalla radice sbagliata"
        );
        assert!(host.cache_write("index.json", b"rebuildable").is_err());
    });
    let io = |rel| ws.prepare_plugin_data_io("prova.plugin", rel).unwrap();
    assert!(io("old.json").read_authoritative().is_err());
    assert!(io("index.json").write_cache(b"rebuildable").is_err());
    storage.failing.store(false, Ordering::Relaxed);

    ws.with_host("prova.plugin", |host| {
        assert_eq!(
            host.data_read("old.json").unwrap().as_deref(),
            Some(&b"legacy"[..]),
            "i dati vecchi sono diventati cache"
        );
    });
}

#[test]
fn removing_canonical_data_does_not_reveal_a_cache_copy() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();
    let cache = data_root(&root).join("plugins/prova.plugin/shared.json");

    ws.with_host("prova.plugin", |host| {
        host.data_write("shared.json", b"authoritative").unwrap();
        host.cache_write("shared.json", b"derived").unwrap();
        assert_eq!(
            host.data_read("shared.json").unwrap().as_deref(),
            Some(&b"authoritative"[..])
        );
        host.data_remove("shared.json").unwrap();
        assert_eq!(
            host.data_read("shared.json").unwrap(),
            None,
            "removing visible data does not fall back to the cache tree"
        );
        assert_eq!(
            host.cache_read("shared.json").unwrap().as_deref(),
            Some(&b"derived"[..])
        );
    });

    assert!(
        cache.exists(),
        "the cache copy remains available only through cache_*"
    );
}

#[test]
fn kernel_cache_rejects_an_empty_path() {
    let mut ws = vault();

    ws.with_host("prova.plugin", |host| {
        assert!(matches!(host.cache_read(""), Err(PluginError::BadArgs(_))));
        assert!(matches!(
            host.cache_write("", b"nothing"),
            Err(PluginError::BadArgs(_))
        ));
    });
}

#[test]
fn an_old_plugin_data_root_remains_readable_without_migration() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();
    let legacy = data_root(&root).join("plugins/prova.plugin/old.json");
    std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    std::fs::write(&legacy, b"legacy").unwrap();

    ws.with_host("prova.plugin", |host| {
        assert_eq!(
            host.data_read("old.json").unwrap().as_deref(),
            Some(&b"legacy"[..])
        );
        assert!(host
            .data_list("")
            .unwrap()
            .contains(&"old.json".to_string()));
        host.data_write("new.json", b"new").unwrap();
    });

    assert_eq!(
        std::fs::read(&legacy).unwrap(),
        b"legacy",
        "legacy-only roots remain authoritative until a migration creates the canonical root"
    );
    assert_eq!(
        std::fs::read(data_root(&root).join("plugins/prova.plugin/new.json")).unwrap(),
        b"new",
        "writes stay on the selected legacy tree while the canonical root is absent"
    );
    assert!(
        !root.join(".fub/plugins/prova.plugin").exists(),
        "the fallback must not create a second canonical tree"
    );
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

    ws.with_host("prova.plugin", |host| {
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
        ws.register_core_feature(plugin, plugin).expect("declared");
    }
    ws.reindex().unwrap();

    let seen = ws
        .with_host("prova.plugin", |host| host.list_documents(None))
        .unwrap();

    let mut names: Vec<&str> = seen.items.iter().map(|d| d.0.as_str()).collect();
    names.sort();
    assert_eq!(
        names,
        vec!["Note.txt", "Other.txt"],
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
