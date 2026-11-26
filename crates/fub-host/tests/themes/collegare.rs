//! Collegare una cartella: il tema cambia al salvataggio.

use super::*;

// --- collegare una cartella, e il tema cambia al salvataggio (PA T37) -------

/// L'host con la modalità sviluppatore accesa e un'uscita degli eventi del
/// tema collegato che li manda in un canale.
#[cfg(feature = "notify-watcher")]
pub(super) fn linking(config: &Utf8Path) -> (Host, mpsc::Receiver<ThemeLink>) {
    let host = developer(config, true);
    let (sent, got) = mpsc::channel();
    let sent = std::sync::Mutex::new(sent);
    host.set_theme_link_sink(std::sync::Arc::new(move |link: &ThemeLink| {
        let _ = sent.lock().unwrap().send(link.clone());
    }));
    (host, got)
}

pub(super) fn link(host: &Host, folder: &Utf8Path) -> ThemeLink {
    match host
        .link_theme_folder(folder)
        .expect("developer mode is on")
    {
        ThemeFolderLink::Linked { link } => link,
        other => panic!("the folder should link: {other:?}"),
    }
}

/// Il primo evento entro qualche secondo (il debounce è di 200 ms).
#[cfg(feature = "notify-watcher")]
pub(super) fn next_event(got: &mpsc::Receiver<ThemeLink>) -> ThemeLink {
    got.recv_timeout(Duration::from_secs(10))
        .expect("the linked folder sends an event")
}

/// Nessun evento per un po': i salvataggi fatti non arrivano più.
#[cfg(feature = "notify-watcher")]
pub(super) fn no_event(got: &mpsc::Receiver<ThemeLink>) {
    if let Ok(link) = got.recv_timeout(Duration::from_millis(900)) {
        panic!("no event was expected, got {link:?}");
    }
}

/// Aspetta che l'osservatore abbia consegnato tutto ciò che c'era, e svuota.
#[cfg(feature = "notify-watcher")]
pub(super) fn drain(got: &mpsc::Receiver<ThemeLink>) {
    while got.recv_timeout(Duration::from_millis(600)).is_ok() {}
}

#[cfg(feature = "notify-watcher")]
#[test]
fn a_linked_folder_sends_an_event_on_save_and_none_after_unlink() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);

    let linked = link(&host, &folder);
    assert_eq!(linked.state, ThemeLinkState::Ready);
    assert_eq!(linked.id.as_deref(), Some("acme.collegato"));
    assert!(host.watched_theme_folder().is_some());
    // Il tema compare fra gli altri, in sviluppo, e si legge dal suo posto:
    // niente è copiato nella cartella dei temi.
    let listed = host.themes().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].trust, "development");
    assert!(!fub_host::config::themes_dir(&config)
        .join("acme.collegato")
        .exists());

    std::fs::write(folder.join("skin.css"), ".surface { color: red; }\n").unwrap();
    let event = next_event(&got);
    assert_eq!(event.id.as_deref(), Some("acme.collegato"));
    assert_eq!(event.state, ThemeLinkState::Ready);
    assert_eq!(event.changed, ["skin.css"]);
    let payload = host
        .read_theme("acme.collegato", fub_abi::theme::ThemeLight::Light)
        .unwrap();
    assert_eq!(payload.skin.as_deref(), Some(".surface { color: red; }\n"));
    drain(&got);

    host.unlink_theme_folder().unwrap();
    assert_eq!(host.watched_theme_folder(), None);
    assert!(host.theme_link().is_none());
    std::fs::write(folder.join("skin.css"), ".surface { color: blue; }\n").unwrap();
    no_event(&got);
    assert!(host.themes().unwrap().is_empty(), "unlinked, it is gone");
}

/// Un editor che salva con un rename (un temporaneo, poi il nome vero) fa
/// un cambio solo, col nome vero.
#[cfg(feature = "notify-watcher")]
#[test]
fn a_save_by_rename_is_one_change() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);
    link(&host, &folder);

    let temporary = folder.join(".skin.css.tmp");
    std::fs::write(&temporary, ".surface { color: green; }\n").unwrap();
    std::fs::rename(&temporary, folder.join("skin.css")).unwrap();
    let event = next_event(&got);
    assert_eq!(event.changed, ["skin.css"]);
    no_event(&got);
    host.close_theme_link();
}

/// Un salvataggio a metà che rompe il manifest arriva come rifiuto, con l'id
/// di prima; la cartella cancellata arriva come `missing`.
#[cfg(feature = "notify-watcher")]
#[test]
fn a_broken_save_is_refused_and_a_deleted_folder_is_missing() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);
    link(&host, &folder);

    std::fs::write(folder.join("manifest.json"), "{ non è json").unwrap();
    let event = next_event(&got);
    assert!(
        matches!(
            event.state,
            ThemeLinkState::Refused {
                refusal: ThemeFolderRefusal::Malformed { .. }
            }
        ),
        "{event:?}"
    );
    assert_eq!(
        event.id.as_deref(),
        Some("acme.collegato"),
        "the last id read"
    );
    assert!(host.themes().unwrap().is_empty());
    drain(&got);

    std::fs::remove_dir_all(&folder).unwrap();
    let mut last = next_event(&got);
    while let Ok(more) = got.recv_timeout(Duration::from_millis(600)) {
        last = more;
    }
    assert_eq!(last.state, ThemeLinkState::Missing);
    assert_eq!(last.id.as_deref(), Some("acme.collegato"));
    assert_eq!(host.theme_link().unwrap().state, ThemeLinkState::Missing);
    host.close_theme_link();
    assert_eq!(host.watched_theme_folder(), None);
}

/// Montare e smontare due volte non lascia niente: dopo l'ultimo «Scollega»
/// nessun osservatore resta, e nessun evento arriva.
#[cfg(feature = "notify-watcher")]
#[test]
fn linking_and_unlinking_twice_leaves_nothing() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);
    for _ in 0..2 {
        link(&host, &folder);
        assert!(host.watched_theme_folder().is_some());
        host.unlink_theme_folder().unwrap();
        assert_eq!(host.watched_theme_folder(), None);
    }
    std::fs::write(folder.join("skin.css"), ".surface { color: red; }\n").unwrap();
    no_event(&got);
}

/// Un'altra cartella smonta la vecchia; spegnere la modalità sviluppatore
/// smonta tutto, e il tema collegato sparisce dall'elenco.
#[cfg(feature = "notify-watcher")]
#[test]
fn another_folder_or_developer_mode_off_unmounts_the_watch() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let first = source.join("carta");
    let second = source.join("lino");
    write_theme(&first, "acme.carta", "theme-2", "");
    write_theme(&second, "acme.lino", "theme-2", "");
    let (host, got) = linking(&config);
    link(&host, &first);
    link(&host, &second);
    assert_eq!(
        host.watched_theme_folder().as_deref(),
        Some(second.canonicalize_utf8().unwrap().as_path())
    );
    std::fs::write(first.join("skin.css"), ".surface { color: red; }\n").unwrap();
    no_event(&got);
    assert_eq!(
        host.themes()
            .unwrap()
            .iter()
            .map(|theme| theme.manifest.id.as_str())
            .collect::<Vec<_>>(),
        ["acme.lino"]
    );

    set_developer(&host, false);
    assert_eq!(host.watched_theme_folder(), None);
    assert!(host.themes().unwrap().is_empty());
    assert!(host.theme_link().is_none());
    std::fs::write(second.join("skin.css"), ".surface { color: red; }\n").unwrap();
    no_event(&got);
    // Riaccesa, la chiave è rimasta: si guarda di nuovo.
    set_developer(&host, true);
    assert!(host.watched_theme_folder().is_some());
    host.close_theme_link();
}

/// Un id uguale a un tema installato non si collega, e lo stato lo dice;
/// niente è scritto nella chiave.
#[test]
fn a_linked_id_equal_to_an_installed_theme_is_refused() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let installed_copy = source.join("installato");
    write_theme(&installed_copy, "acme.carta", "theme-2", "");
    fub_host::theme::install_theme(&config, &installed_copy).unwrap();
    let folder = source.join("carta");
    write_theme(&folder, "acme.carta", "theme-2", "");
    let host = developer(&config, true);

    match host.link_theme_folder(&folder).unwrap() {
        ThemeFolderLink::Refused { link } => {
            assert_eq!(link.state, ThemeLinkState::Collision);
            assert_eq!(link.id.as_deref(), Some("acme.carta"));
        }
        other => panic!("a collision does not link: {other:?}"),
    }
    assert!(host.theme_link().is_none());
    assert_eq!(host.watched_theme_folder(), None);
}

/// I rifiuti delle porte dell'installazione valgono anche per collegare: una
/// cartella senza manifest non si collega.
#[test]
fn a_folder_that_is_not_a_theme_is_not_linked() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let empty = source.join("vuota");
    std::fs::create_dir_all(&empty).unwrap();
    let host = developer(&config, true);
    match host.link_theme_folder(&empty).unwrap() {
        ThemeFolderLink::Refused { link } => assert_eq!(
            link.state,
            ThemeLinkState::Refused {
                refusal: ThemeFolderRefusal::NotATheme
            }
        ),
        other => panic!("{other:?}"),
    }
    assert!(host.theme_link().is_none());
}

/// Un link simbolico dentro la cartella è un'uscita: collegare si rifiuta,
/// come all'installazione.
#[cfg(unix)]
#[test]
fn a_folder_with_a_symlink_inside_is_not_linked() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let host = developer(&config, true);
    let linked = source.join("con-link");
    write_theme(&linked, "acme.link", "theme-2", "");
    std::fs::remove_file(linked.join("skin.css")).unwrap();
    std::os::unix::fs::symlink("/etc/hostname", linked.join("skin.css")).unwrap();
    match host.link_theme_folder(&linked).unwrap() {
        ThemeFolderLink::Refused { link } => assert!(
            matches!(
                link.state,
                ThemeLinkState::Refused {
                    refusal: ThemeFolderRefusal::Traversal { .. }
                }
            ),
            "{link:?}"
        ),
        other => panic!("{other:?}"),
    }
    assert!(host.theme_link().is_none());
}

/// Senza modalità sviluppatore non si collega; la chiave non si scrive dalla
/// porta della webview, ma si azzera (è «Scollega»).
#[test]
fn linking_needs_developer_mode_and_the_key_is_not_written_by_the_webview() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let off = developer(&config, false);
    assert!(matches!(
        off.link_theme_folder(&folder),
        Err(fub_abi::PluginError::PermissionDenied(_))
    ));
    let written = off.set_setting_for_user(
        None,
        fub_host::settings::DEVELOPER_THEME_FOLDER,
        fub_abi::settings::SettingValue::Text(folder.to_string()),
    );
    assert!(
        matches!(written, Err(fub_abi::PluginError::PermissionDenied(_))),
        "{written:?}"
    );
    off.reset_setting_for_user(None, fub_host::settings::DEVELOPER_THEME_FOLDER)
        .expect("resetting is unlinking");
}

/// L'app riaperta con la cartella che non c'è più: nessun blocco, e lo stato
/// dice `missing` perché la shell lo dica.
#[test]
fn reopening_with_the_folder_gone_says_missing() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    {
        let host = developer(&config, true);
        link(&host, &folder);
        host.close_theme_link();
    }
    std::fs::remove_dir_all(&folder).unwrap();
    let reopened = installed(&config);
    reopened.sync_theme_link();
    let link = reopened.theme_link().expect("the key survives the restart");
    assert_eq!(link.state, ThemeLinkState::Missing);
    assert!(!link.watched, "a missing folder is not watched");
    assert!(reopened.themes().unwrap().is_empty());
    assert!(reopened
        .read_theme("acme.collegato", fub_abi::theme::ThemeLight::Light)
        .is_err());
    reopened.close_theme_link();
}
