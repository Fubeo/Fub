use super::*;

fn test_root() -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(std::env::current_dir().expect("current dir"))
        .expect("current dir is UTF-8")
        .join("vault-test")
}

/// Una voce senza sidecar vale per ogni cartella, sotto il nome che ha e
/// sotto quello de-timbrato: anche il timbro si legge dalla forma, e una
/// nota può chiamarsi davvero così.
#[test]
fn a_trash_entry_without_sidecar_may_come_from_any_folder() {
    let mut origins = TrashOrigins::default();
    origins.unplaced(&DocId::new(".trash/Idea.2026-07-24T15-30-00.md"));
    origins.placed.insert(DocId::new("Diario/Nota.md"));

    for held in [
        "Idea.md",
        "Diario/Idea.md",
        "Archivio/2026/Idea.2026-07-24T15-30-00.md",
        "Diario/Nota.md",
    ] {
        assert!(origins.may_hold(&DocId::new(held)), "{held}");
    }
    for free in ["Diario/Altro.md", "Nota.md", "Archivio/Nota.md"] {
        assert!(!origins.may_hold(&DocId::new(free)), "{free}");
    }
}

#[test]
fn a_backslash_id_never_composes_a_path() {
    // Su Windows `Path::join` legge `\\` come separatore e ne risolve i
    // `..`: il recinto deve rifiutarlo prima di comporre, su ogni sistema.
    let root = test_root();
    let vault = Vault::on(&root, Arc::new(crate::storage::MemStorage::new())).expect("vault");
    for escape in ["..\\..\\Windows\\System32\\hosts", "note\\..\\..\\x.md"] {
        assert!(
            matches!(
                vault.path_for(&DocId::new(escape)),
                Err(KernelError::BadName { .. })
            ),
            "{escape} must not compose a path"
        );
    }
    assert!(vault.path_for(&DocId::new("note/a.md")).is_ok());
}

#[test]
fn a_missing_gitignore_is_an_empty_policy() {
    let root = test_root();
    let vault = Vault::on(&root, Arc::new(crate::storage::MemStorage::new()))
        .expect("an absent .gitignore is valid");
    assert!(!vault.is_ignored(&root.join("note/Idea.md")));
}

#[test]
fn the_vault_reads_gitignore_at_construction_and_scan() {
    let root = test_root();
    let storage: Arc<dyn VaultStorage> = Arc::new(crate::storage::MemStorage::new());
    storage
        .write(&root.join(GITIGNORE_FILE), b"cache/\n!cache/keep.md")
        .expect("gitignore");
    let vault = Vault::on(&root, Arc::clone(&storage)).expect("vault");
    assert!(vault.is_ignored(&root.join("cache/drop.md")));
    assert!(!vault.is_ignored(&root.join("cache/keep.md")));

    storage
        .write(&root.join(GITIGNORE_FILE), b"generated/")
        .expect("updated gitignore");
    storage
        .write(&root.join("generated/result.md"), b"result")
        .expect("generated file");
    assert!(vault.scan().expect("scan").files.is_empty());
}

#[test]
fn an_invalid_gitignore_is_an_observable_io_error() {
    let root = test_root();
    let storage: Arc<dyn VaultStorage> = Arc::new(crate::storage::MemStorage::new());
    storage
        .write(&root.join(GITIGNORE_FILE), &[0xFF])
        .expect("invalid gitignore bytes");
    match Vault::on(&root, storage) {
        Err(KernelError::Io { path, source }) => {
            assert_eq!(path, root.join(GITIGNORE_FILE));
            assert_eq!(source.kind(), std::io::ErrorKind::InvalidData);
        }
        _ => panic!("an invalid .gitignore must fail visibly"),
    }
}

#[test]
fn what_is_ignored_is_ignored_at_any_depth() {
    // La politica d'esclusione non guarda il disco: il vault si apre in
    // memoria, dove una radice che sta per nascere è legittima (0160).
    let root = test_root();
    let v = Vault::on(&root, Arc::new(crate::storage::MemStorage::new()))
        .expect("an in-memory vault opens");
    assert!(!v.is_ignored(&root.join("note/Idea.md")));
    assert!(v.is_ignored(&root.join(".trash/Idea.md")));
    assert!(v.is_ignored(&root.join(".obsidian/plugins/x/main.js")));
    assert!(v.is_ignored(&root.join("node_modules/pacchetto/readme.md")));
    // Un file nascosto è nascosto anche in fondo a un path pulito.
    assert!(v.is_ignored(&root.join("note/.bozza.md")));
    // Fuori dal vault non è "ignorato": è di qualcun altro, e a dirlo è
    // `doc_id_for_path`.
    assert!(!v.is_ignored(Utf8Path::new("/altrove/.trash/Idea.md")));
}

/// **Un vault che è anche un repo** (difetto 0118): `target/` è ciò che
/// scrive Cargo, e da quando il vault dice *cosa contiene* invece di
/// filtrare per estensione (§14.1) ogni file lì dentro prendeva un
/// [`DocId`] ed entrava in anagrafe — decine di migliaia di voci, un indice
/// che le porta, e una ricerca che pesca artefatti.
///
/// Il banco sta qui e non solo sulla costante perché è un difetto che si
/// vede **dal vault**, non dalla lista: la lista si legge e sembra a posto.
#[test]
fn a_vault_that_is_also_a_repo_does_not_index_what_cargo_writes() {
    let root = test_root();
    let v = Vault::on(&root, Arc::new(crate::storage::MemStorage::new()))
        .expect("an in-memory vault opens");
    for rel in ["target/debug/appunti.md", "Idea.md"] {
        let path = root.join(rel);
        v.storage().write(&path, b"x").expect("write");
    }
    let seen: Vec<String> = v
        .scan()
        .expect("scan")
        .files
        .into_iter()
        .map(|f| f.id.0)
        .collect();
    assert_eq!(
        seen,
        vec!["Idea.md"],
        "\"target/\" was entering the entry store"
    );
    assert!(v.is_ignored(&root.join("target/debug/appunti.md")));
}

/// Un vault con le impostazioni di un vero montaggio, con la politica di
/// esclusione già dichiarata.
fn declaring_vault(values: &[(&str, fub_abi::settings::SettingValue)]) -> Vault {
    let root = test_root();
    let storage: Arc<dyn VaultStorage> = Arc::new(crate::storage::MemStorage::new());
    let mut store = crate::settings::SettingsStore::open(
        &root,
        Arc::clone(&storage),
        crate::settings::MachineSettings::in_memory(),
    );
    store
        .declare("fub", &crate::ignore::ignore_settings())
        .expect("the two exclusion keys");
    for (key, value) in values {
        store.set(key, value.clone()).expect("declared key");
    }
    Vault::on(&root, storage)
        .expect("un vault in memoria si apre")
        .watching(Arc::new(std::sync::RwLock::new(store)))
}

/// **La casella dei nascosti** (§3.2 del catalogo): mostrarli è una
/// preferenza, e vale davvero — ma non è un grimaldello sulla struttura.
/// Con l'interruttore acceso la bozza è un documento, e la cartella di Fub,
/// il cestino e il temporaneo di una scrittura restano fuori.
#[test]
fn showing_hidden_files_does_not_open_the_structure() {
    use fub_abi::settings::SettingValue;
    let v = declaring_vault(&[(crate::ignore::SHOW_HIDDEN, SettingValue::Toggle(true))]);
    let root = v.root();
    assert!(!v.is_ignored(&root.join("note/.bozza.md")));
    assert!(v.is_ignored(&root.join(".fub/data/anagrafe.json")));
    assert!(v.is_ignored(&root.join(".trash/Idea.2026-07-24T15-30-00.md")));
    assert!(v.is_ignored(&root.join("note/.Idea.md.tmp1234-5")));
    // Il compagno di lock è l'unico dei quattro che non se ne va mai — non
    // si può togliere senza rompere il lock (difetto 0151) — quindi è
    // l'unico per cui «non si vede» deve essere una regola e non un
    // istante. Sta nella radice apposta: oggi ogni file protetto sta dentro
    // `.fub/`, e un banco che lo mettesse lì proverebbe `.fub`.
    assert!(
        v.is_ignored(&v.root().join(".Idea.md.lock")),
        "the lock companion of a root-level file was a document, \
             and it never goes away"
    );
    // E l'elenco delle cartelle escluse è l'altra metà, che questa non tocca.
    assert!(v.is_ignored(&v.root().join("node_modules/pacchetto/readme.md")));
}

/// La metà che impedisce alla riparazione di diventare «tutto ciò che
/// finisce per `.lock`»: un `Cargo.lock` o un `flake.lock` non sono note di
/// nessuno, ma sono file che uno può tenersi nel vault, e non cominciano
/// per punto.
#[test]
fn a_lock_file_that_is_not_ours_stays_in_the_vault() {
    use fub_abi::settings::SettingValue;
    let v = declaring_vault(&[(crate::ignore::SHOW_HIDDEN, SettingValue::Toggle(true))]);
    for lock in ["Cargo.lock", "note/flake.lock"] {
        let lock = v.root().join(lock);
        assert!(
            !v.is_ignored(&lock),
            "{lock} disappeared from the vault: the lock companion rule \
                 expanded to anyone ending with \".lock\""
        );
    }
}

/// **La casella della costante** (§15.6): l'elenco è dato, e dichiararne uno
/// diverso cambia cosa il vault contiene senza ricompilare niente.
#[test]
fn the_excluded_folders_are_declared_by_the_vault() {
    use fub_abi::settings::SettingValue;
    let v = declaring_vault(&[(
        crate::ignore::EXCLUDED_FOLDERS,
        SettingValue::List(vec!["build".into()]),
    )]);
    let root = v.root();
    assert!(v.is_ignored(&root.join("build/out.md")));
    assert!(!v.is_ignored(&root.join("node_modules/pacchetto/readme.md")));
    // La struttura non è nell'elenco e non ci entra: toglierla dalla lista
    // non la rivela.
    assert!(v.is_ignored(&root.join(".fub/settings.json")));
}

/// **La prima metà della 0176, dalle due porte.** `build/` è la forma che
/// scrive per prima chi arriva da un `.gitignore`, e confrontata per
/// uguaglianza con il nome che il disco restituisce non combaciava con
/// niente: quella riga non escludeva un bel niente, e a dirlo non c'era
/// nessuno — un'esclusione che non scatta non dà errore, dà un vault che
/// indicizza `build/`.
#[test]
fn a_folder_declared_with_a_slash_stays_out_of_the_vault() {
    use fub_abi::settings::SettingValue;
    let v = declaring_vault(&[(
        crate::ignore::EXCLUDED_FOLDERS,
        SettingValue::List(vec!["build/".into()]),
    )]);
    for rel in ["build/out.md", "note/Idea.md"] {
        let path = v.root().join(rel);
        v.storage().write(&path, b"x").expect("write");
    }
    let seen: Vec<String> = v
        .scan()
        .expect("scan")
        .files
        .into_iter()
        .map(|f| f.id.0)
        .collect();
    assert_eq!(
        seen,
        vec!["note/Idea.md"],
        "\"build/\" did not exclude anything"
    );
    assert!(v.is_ignored(&v.root().join("build/out.md")));
}

/// **La seconda metà della 0176, dalle due porte.** L'elenco si chiama
/// «cartelle escluse»: un file che si chiama come una di loro è un file di
/// questo vault, e toglierlo è toglierlo davvero — niente [`DocId`],
/// niente voce d'anagrafe, nessun evento che lo dica.
///
/// Le due porte si provano insieme apposta: la scansione la specie ce
/// l'ha in mano dalla voce di directory, il watcher ha in mano un path e
/// basta, e se le due rispondessero diverso il file rientrerebbe al primo
/// salvataggio o sparirebbe al primo evento.
#[test]
fn a_file_named_like_an_excluded_folder_stays_in_the_vault() {
    use fub_abi::settings::SettingValue;
    let v = declaring_vault(&[(
        crate::ignore::EXCLUDED_FOLDERS,
        SettingValue::List(vec!["archivio".into()]),
    )]);
    for rel in ["archivio", "note/archivio/vecchia.md", "note/Idea.md"] {
        let path = v.root().join(rel);
        v.storage().write(&path, b"x").expect("write");
    }
    let seen: Vec<String> = v
        .scan()
        .expect("scan")
        .files
        .into_iter()
        .map(|f| f.id.0)
        .collect();
    assert_eq!(
        seen,
        vec!["archivio", "note/Idea.md"],
        "the file \"archivio\" disappeared from the vault along with the folder"
    );
    assert!(!v.is_ignored(&v.root().join("archivio")));
    // E la cartella che si chiama come lui resta fuori, dai due versi: il
    // path del file dentro, e il path della cartella stessa.
    assert!(v.is_ignored(&v.root().join("note/archivio/vecchia.md")));
    assert!(v.is_ignored(&v.root().join("note/archivio")));
}

/// **Le due porte d'ingresso guardano lo stesso vault.** Il watcher chiede
/// `is_ignored`, la scansione cammina: se le due politiche non fossero la
/// stessa, un file che la scansione non elenca rientrerebbe al primo
/// salvataggio — che è il difetto per cui `is_ignored` esiste.
#[test]
fn the_watcher_and_the_scan_share_the_same_policy() {
    use fub_abi::settings::SettingValue;
    let v = declaring_vault(&[(crate::ignore::SHOW_HIDDEN, SettingValue::Toggle(true))]);
    for (rel, content) in [
        ("note/Idea.md", "a note"),
        ("note/.bozza.md", "a draft"),
        (".fub/data/anagrafe.json", "{}"),
        (".trash/Vecchia.md", "trashed"),
        ("node_modules/pacchetto/readme.md", "npm stuff"),
    ] {
        let path = v.root().join(rel);
        v.storage().write(&path, content.as_bytes()).expect("write");
    }
    let seen: Vec<String> = v
        .scan()
        .expect("scan")
        .files
        .into_iter()
        .map(|f| f.id.0)
        .collect();
    assert_eq!(seen, vec!["note/.bozza.md", "note/Idea.md"]);
    for rel in [
        "note/Idea.md",
        "note/.bozza.md",
        ".fub/data/anagrafe.json",
        ".trash/Vecchia.md",
        "node_modules/pacchetto/readme.md",
    ] {
        let path = v.root().join(rel);
        assert_eq!(
            v.is_ignored(&path),
            !seen.contains(&rel.to_string()),
            "{rel}: the two gates do not say the same thing"
        );
    }
}

/// **La casella dei collegamenti** (§15.6, consegnata dalla 0058): non si
/// seguono, e il caso che lo rende una decisione invece che una preferenza è
/// questo — una cartella che contiene un collegamento a se stessa. Se la
/// camminata li seguisse senza saper riconoscere un nodo già visitato,
/// questo banco non fallirebbe: non tornerebbe affatto.
#[cfg(unix)]
#[test]
fn a_ring_of_links_does_not_stop_the_scan() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::create_dir(root.join("note")).expect("folder");
    std::fs::write(root.join("note/Idea.md"), "a note").expect("note");
    std::os::unix::fs::symlink(root.join("note"), root.join("note/anello")).expect("symlink");
    let scan = Vault::open(&root)
        .expect("the just-created root opens")
        .scan()
        .expect("scan");
    assert_eq!(scan.files.len(), 1, "{:?}", scan.files[0].id);
    assert_eq!(scan.folders, vec!["note".to_string()]);
}
