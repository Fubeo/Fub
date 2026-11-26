//! La cartella collegata: non viaggia coi profili di macchina, sparisce e torna.

use super::*;

// --- la cartella collegata non viaggia coi profili di macchina --------------

/// Il valore scritto della chiave della cartella collegata, `None` se vuoto.
fn linked_key(host: &Host) -> Option<String> {
    let entry = host
        .machine_settings()
        .into_iter()
        .find(|entry| entry.spec.key == fub_host::settings::DEVELOPER_THEME_FOLDER)
        .expect("the key is declared");
    match entry.value {
        fub_abi::settings::SettingValue::Text(folder) if !folder.is_empty() => Some(folder),
        _ => None,
    }
}

/// Un profilo come lo scriverebbe chi vuole collegare `folder` di nascosto:
/// quello attivo esportato, rinominato, con la chiave dentro.
fn profile_with_folder(host: &Host, name: &str, folder: &str) -> String {
    let (active, _) = host.settings_profiles(None, SettingScope::Machine).unwrap();
    let exported = host
        .export_settings_profile(None, SettingScope::Machine, &active)
        .unwrap();
    let mut profile: serde_json::Value = serde_json::from_str(&exported).unwrap();
    profile["name"] = name.into();
    profile["values"][fub_host::settings::DEVELOPER_THEME_FOLDER] = folder.into();
    profile["values"][fub_host::settings::DEVELOPER_MODE] = true.into();
    profile.to_string()
}

/// Un profilo importato e attivato con la chiave non collega niente: nessun
/// osservatore, nessun tema, e il valore resta quello di prima.
#[test]
fn an_imported_profile_does_not_link_a_folder() {
    let (_config_dir, config) = folders();
    let host = developer(&config, true);
    let evil = profile_with_folder(&host, "altrove", "/");
    host.import_settings_profile(None, SettingScope::Machine, &evil)
        .expect("the rest of the profile imports");
    let exported = host
        .export_settings_profile(None, SettingScope::Machine, "altrove")
        .unwrap();
    assert!(
        !exported.contains(fub_host::settings::DEVELOPER_THEME_FOLDER),
        "{exported}"
    );
    host.switch_settings_profile(None, SettingScope::Machine, "altrove")
        .unwrap();
    assert_eq!(linked_key(&host), None);
    assert_eq!(host.watched_theme_folder(), None);
    assert!(host.theme_link().is_none());
    assert!(host.themes().unwrap().is_empty());
}

/// Cambiare, copiare e azzerare un profilo lasciano la cartella collegata
/// com'era, ed esportarlo non la porta fuori.
#[test]
fn switching_or_resetting_a_profile_keeps_the_linked_folder() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let host = developer(&config, true);
    link(&host, &folder);
    // L'impostazione tiene la forma canonica (su Windows col prefisso
    // `\\?\`); quella mostrata nel `ThemeLink` è la normale.
    let kept = Some(folder.canonicalize_utf8().unwrap().to_string());
    assert_eq!(linked_key(&host), kept);
    let (first, _) = host.settings_profiles(None, SettingScope::Machine).unwrap();
    assert!(!host
        .export_settings_profile(None, SettingScope::Machine, &first)
        .unwrap()
        .contains(fub_host::settings::DEVELOPER_THEME_FOLDER));

    let other = profile_with_folder(&host, "altrove", "/");
    host.import_settings_profile(None, SettingScope::Machine, &other)
        .unwrap();
    host.switch_settings_profile(None, SettingScope::Machine, "altrove")
        .unwrap();
    assert_eq!(linked_key(&host), kept);
    host.reset_settings_profile(None, SettingScope::Machine, "altrove")
        .unwrap();
    assert_eq!(linked_key(&host), kept);

    // Il primo profilo ha ancora la chiave scritta prima di cambiare: copiarlo
    // non la porta nella copia, e attivare la copia dopo «Scollega» non
    // ricollega niente.
    host.duplicate_settings_profile(None, SettingScope::Machine, &first, "copia")
        .unwrap();
    // Sul disco la copia non ha la chiave (l'esportazione la toglierebbe
    // comunque: si guarda il file).
    let on_disk: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fub_host::config::machine_settings_path(&config)).unwrap(),
    )
    .unwrap();
    let copy = &on_disk["profiles"]["copia"]["values"];
    assert!(copy.is_object(), "{on_disk}");
    assert!(
        copy.get(fub_host::settings::DEVELOPER_THEME_FOLDER)
            .is_none(),
        "{copy}"
    );
    assert!(
        on_disk["profiles"][first.as_str()]["values"]
            .get(fub_host::settings::DEVELOPER_THEME_FOLDER)
            .is_some(),
        "the source still holds it: the copy really dropped it"
    );
    host.unlink_theme_folder().unwrap();
    host.switch_settings_profile(None, SettingScope::Machine, "copia")
        .unwrap();
    assert_eq!(linked_key(&host), None);
    host.switch_settings_profile(None, SettingScope::Machine, &first)
        .unwrap();
    assert_eq!(linked_key(&host), None, "switching back does not relink");
    assert_eq!(host.watched_theme_folder(), None);
}

/// Con un vault aperto la modalità sviluppatore passa dal `Workspace`:
/// spegnerla smonta lo stesso l'osservatore.
#[cfg(feature = "notify-watcher")]
#[test]
fn developer_mode_off_with_a_vault_open_unmounts_the_watch() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let (_vault_dir, v) = vault();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);
    host.open(&v).expect("opens");
    link(&host, &folder);
    assert!(host.watched_theme_folder().is_some());
    assert!(host.theme_link().unwrap().watched);
    set_developer(&host, false);
    assert_eq!(host.watched_theme_folder(), None);
    std::fs::write(folder.join("skin.css"), ".surface { color: red; }\n").unwrap();
    no_event(&got);
}

// --- la cartella collegata sparisce e torna ---------------------------------

/// Salva `skin.css` finché un evento lo dice, con l'osservatore vivo: i
/// salvataggi arrivano di nuovo. Una scadenza, non un'attesa senza fine.
#[cfg(feature = "notify-watcher")]
fn saves_arrive_again(folder: &Utf8Path, got: &mpsc::Receiver<ThemeLink>) {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let mut round = 0;
    while std::time::Instant::now() < deadline {
        round += 1;
        std::fs::write(
            folder.join("skin.css"),
            format!(".surface {{ color: inherit; }} /* {round} */\n"),
        )
        .unwrap();
        while let Ok(event) = got.recv_timeout(Duration::from_millis(400)) {
            if event.state == ThemeLinkState::Ready
                && event.watched
                && event.changed.iter().any(|file| file == "skin.css")
            {
                return;
            }
        }
    }
    panic!("the saves never arrived again");
}

/// Un build che rifà la cartella (`rm -rf dist`, poi i file di nuovo) prima
/// che l'osservatore se ne accorga: la cartella è un'altra, il vecchio
/// osservatore è morto, e il custode rimonta da solo. I salvataggi arrivano.
#[cfg(feature = "notify-watcher")]
#[test]
fn a_folder_rebuilt_in_place_is_watched_again() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("dist");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);
    let folder = link(&host, &folder).folder;
    let folder = Utf8PathBuf::from(folder);

    std::fs::remove_dir_all(&folder).unwrap();
    write_theme(&folder, "acme.collegato", "theme-2", "");
    saves_arrive_again(&folder, &got);
    assert!(host.theme_link().unwrap().watched);
    host.close_theme_link();
}

/// La cartella tolta: l'evento dice `missing` e non guardata; rimessa, il
/// custode la riprova da solo, la shell la rilegge e i salvataggi arrivano.
#[cfg(feature = "notify-watcher")]
#[test]
fn a_folder_that_comes_back_is_watched_again() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    let folder = source.join("carta");
    write_theme(&folder, "acme.collegato", "theme-2", "");
    let (host, got) = linking(&config);
    let folder = Utf8PathBuf::from(link(&host, &folder).folder);

    std::fs::remove_dir_all(&folder).unwrap();
    let mut last = next_event(&got);
    while let Ok(more) = got.recv_timeout(Duration::from_millis(600)) {
        last = more;
    }
    assert_eq!(last.state, ThemeLinkState::Missing);
    assert!(!last.watched, "a removed folder is not watched any more");
    assert!(!host.theme_link().unwrap().watched);

    write_theme(&folder, "acme.collegato", "theme-2", "");
    // Il custode la riprova da solo e lo dice: pronta e guardata.
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let event = got
            .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
            .expect("the keeper says the folder is back");
        if event.state == ThemeLinkState::Ready && event.watched {
            break;
        }
    }
    saves_arrive_again(&folder, &got);
    host.close_theme_link();
}
