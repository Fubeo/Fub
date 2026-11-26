//! Installare da una cartella, con la modalità sviluppatore.

use super::*;

// --- installare da una cartella, con la modalità sviluppatore ---------------

/// L'host con la modalità sviluppatore accesa o spenta, scritta come la
/// scrive la persona dalle Impostazioni.
pub(super) fn developer(config: &Utf8Path, on: bool) -> Host {
    let host = installed(config);
    set_developer(&host, on);
    host
}

pub(super) fn set_developer(host: &Host, on: bool) {
    host.set_setting_for_user(
        None,
        fub_host::settings::DEVELOPER_MODE,
        fub_abi::settings::SettingValue::Toggle(on),
    )
    .expect("la modalità sviluppatore è un'impostazione della macchina");
}

pub(super) fn write_versioned_theme(root: &Utf8Path, id: &str, version: &str) {
    write_theme(root, id, "theme-2", "");
    let manifest = std::fs::read_to_string(root.join("manifest.json")).unwrap();
    std::fs::write(
        root.join("manifest.json"),
        manifest.replace(
            r#""version": "1.0.0""#,
            &format!(r#""version": "{version}""#),
        ),
    )
    .unwrap();
}

/// Il controllo di una cartella che passa le porte: l'impronta che
/// l'installazione chiede.
pub(super) fn checked(host: &Host, root: &Utf8Path) -> String {
    match host.check_theme_folder(root).expect("reads the folder") {
        ThemeFolderCheck::Ready { digest, .. } => digest,
        other => panic!("expected Ready, got {other:?}"),
    }
}

/// Il rifiuto tipizzato del controllo di una cartella.
pub(super) fn refused(host: &Host, root: &Utf8Path) -> ThemeFolderRefusal {
    match host
        .check_theme_folder(root)
        .expect("a refusal is an outcome")
    {
        ThemeFolderCheck::Refused { folder, refusal } => {
            assert_eq!(folder, root.as_str());
            refusal
        }
        other => panic!("expected Refused, got {other:?}"),
    }
}

/// Il giro della shell: controlla, poi installa coi byte controllati.
pub(super) fn install_folder(host: &Host, root: &Utf8Path, replace: bool) -> ThemeFolderInstall {
    let digest = checked(host, root);
    host.install_theme_from_folder(replace, &digest)
        .expect("installs from the folder")
}

pub(super) fn themes_dir_is_empty(config: &Utf8Path) -> bool {
    fub_host::config::themes_dir(config)
        .read_dir()
        .map(|mut it| it.next().is_none())
        .unwrap_or(true)
}

pub(super) fn themes_entries(config: &Utf8Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(fub_host::config::themes_dir(config))
        .map(|entries| {
            entries
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// Con la chiave accesa, una cartella temporanea diventa un tema installato:
/// stesso posto e stessa fiducia di ogni tema che non è di serie.
#[test]
fn a_theme_installs_from_a_folder_with_developer_mode_on() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_versioned_theme(&root, "acme.carta", "0.3.2");
    let host = developer(&config, true);

    assert_eq!(
        install_folder(&host, &root, false),
        ThemeFolderInstall::Installed {
            id: "acme.carta".into(),
            name: "Prova".into(),
            version: "0.3.2".into(),
            replaced: false,
        }
    );
    assert!(fub_host::config::themes_dir(&config)
        .join("acme.carta/manifest.json")
        .is_file());
    let listed = host.themes().unwrap();
    let carta = listed
        .iter()
        .find(|theme| theme.manifest.id == "acme.carta")
        .expect("listed");
    assert_eq!(carta.trust, "community");
    assert!(
        root.join("manifest.json").is_file(),
        "the source stays where it is"
    );
}

/// Spenta (il default), l'host rifiuta di leggere e di installare: la regola
/// non è il bottone nascosto. Spenta dopo il controllo, l'installazione si
/// ferma: la chiave si rilegge a ogni chiamata.
#[test]
fn installing_from_a_folder_is_refused_with_developer_mode_off() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_versioned_theme(&root, "acme.carta", "0.3.2");

    let off = installed(&config);
    let error = off.check_theme_folder(&root).expect_err("off by default");
    assert!(
        matches!(error, fub_abi::PluginError::PermissionDenied(_)),
        "{error:?}"
    );
    let error = off
        .install_theme_from_folder(false, "sha256:any")
        .expect_err("off by default");
    assert!(
        matches!(error, fub_abi::PluginError::PermissionDenied(_)),
        "{error:?}"
    );
    assert!(themes_dir_is_empty(&config));
    // Il rifiuto arriva alla shell come frase del catalogo, non come chiave.
    let shown = off.localized_error(None, error);
    let wire = serde_json::to_value(&shown).expect("serializes");
    let sentence = wire["message"].as_str().expect("a sentence on the wire");
    assert!(!sentence.starts_with("host.theme_folder."), "{sentence}");

    let host = developer(&config, true);
    let digest = checked(&host, &root);
    set_developer(&host, false);
    let error = host
        .install_theme_from_folder(false, &digest)
        .expect_err("turned off after the check");
    assert!(
        matches!(error, fub_abi::PluginError::PermissionDenied(_)),
        "{error:?}"
    );
    assert!(themes_dir_is_empty(&config));
}

/// L'installazione non prende un path: installa soltanto la cartella che il
/// controllo ha letto, e solo se l'impronta è la sua. Senza controllo, con
/// un'impronta inventata o con quella di un controllo superato è `Unchecked`,
/// e niente si scrive; un'impronta sbagliata non tocca il controllo valido.
#[test]
fn only_the_checked_folder_can_be_installed() {
    let (_config_dir, config) = folders();
    let (_a_dir, a) = folders();
    let (_b_dir, b) = folders();
    write_versioned_theme(&a, "acme.carta", "0.3.2");
    write_versioned_theme(&b, "acme.lino", "1.0.0");
    let host = developer(&config, true);
    let unchecked = |replace: bool, digest: &str| {
        assert_eq!(
            host.install_theme_from_folder(replace, digest).unwrap(),
            ThemeFolderInstall::Unchecked,
            "{digest}"
        );
    };

    unchecked(false, &fub_host::theme::theme_tree_digest(&a).unwrap());
    let first = checked(&host, &a);
    unchecked(false, "sha256:made-up");
    let second = checked(&host, &b);
    unchecked(false, &first);
    assert!(themes_dir_is_empty(&config));
    assert!(matches!(
        host.install_theme_from_folder(false, &second).unwrap(),
        ThemeFolderInstall::Installed { .. }
    ));

    // Un rifiuto scarta la cartella controllata prima.
    let digest = checked(&host, &a);
    let (_empty_dir, empty) = folders();
    assert_eq!(refused(&host, &empty), ThemeFolderRefusal::NotATheme);
    unchecked(false, &digest);
    assert_eq!(themes_entries(&config), vec!["acme.lino".to_string()]);
}

/// Il controllo è un permesso che vale una volta e per un esito. Installato,
/// non installa di nuovo; una collisione lo lascia solo per «Sostituisci», una
/// volta; il «no» (o il rifiuto del cancello della shell) lo scarta, e allora
/// una richiesta di sostituire che arriva dopo non tocca niente.
#[test]
fn a_checked_folder_installs_once() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    std::fs::write(new.join("skin.css"), ".surface { color: red; }\n").unwrap();
    let host = developer(&config, true);
    let installed_skin = fub_host::config::themes_dir(&config).join("acme.carta/skin.css");
    let old_skin = ".surface { color: inherit; }\n";

    let digest = checked(&host, &old);
    assert!(matches!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Installed { .. }
    ));
    for replace in [false, true] {
        assert_eq!(
            host.install_theme_from_folder(replace, &digest).unwrap(),
            ThemeFolderInstall::Unchecked,
            "the same digest does not install twice (replace: {replace})"
        );
    }

    // «No» a «Sostituisci»: il permesso si scarta.
    let digest = checked(&host, &new);
    assert!(matches!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Collision { .. }
    ));
    host.forget_theme_folder();
    assert_eq!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Unchecked
    );
    assert_eq!(std::fs::read_to_string(&installed_skin).unwrap(), old_skin);

    // Il rifiuto del cancello della shell su una cartella pronta, lo stesso.
    let digest = checked(&host, &new);
    host.forget_theme_folder();
    assert_eq!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Unchecked
    );
    assert_eq!(std::fs::read_to_string(&installed_skin).unwrap(), old_skin);

    // Dopo la collisione il permesso risponde solo a «Sostituisci», una volta.
    let digest = checked(&host, &new);
    assert!(matches!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Collision { .. }
    ));
    assert!(matches!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Installed { replaced: true, .. }
    ));
    assert_eq!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Unchecked
    );

    // Una collisione seguita da un'altra domanda senza `replace` consuma il
    // permesso: non si gira in tondo.
    let digest = checked(&host, &old);
    assert!(matches!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Collision { .. }
    ));
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Unchecked
    );
    assert_eq!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Unchecked
    );
    assert_eq!(
        std::fs::read_to_string(&installed_skin).unwrap(),
        ".surface { color: red; }\n"
    );
}

/// L'esito parla solo dei byte controllati: una cartella che dopo il
/// controllo cambia id (e ora cadrebbe su un tema installato) è «cambiata»,
/// non una collisione col manifest riletto.
#[test]
fn an_install_speaks_only_of_the_checked_bytes() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.lino", "1.0.0");
    let host = developer(&config, true);
    install_folder(&host, &old, false);

    let digest = checked(&host, &new);
    let manifest = std::fs::read_to_string(new.join("manifest.json")).unwrap();
    std::fs::write(
        new.join("manifest.json"),
        manifest.replace("acme.lino", "acme.carta"),
    )
    .unwrap();
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Changed
    );

    // E un tema revocato, lo stesso: prima l'impronta.
    fub_host::theme::set_theme_revoked(&config, "acme.carta", true).unwrap();
    std::fs::write(new.join("manifest.json"), &manifest).unwrap();
    let digest = checked(&host, &new);
    std::fs::write(
        new.join("manifest.json"),
        manifest.replace("acme.lino", "acme.carta"),
    )
    .unwrap();
    assert_eq!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Changed
    );
    assert_eq!(themes_entries(&config), vec!["acme.carta".to_string()]);
}

/// Un tema installato che non si legge (la radice che non è una cartella, il
/// manifest rotto) è una collisione senza versione, e si può sostituire: la
/// persona lo vede nella domanda e decide lei.
#[test]
fn an_unreadable_installed_theme_collides_and_can_be_replaced() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);
    let themes = fub_host::config::themes_dir(&config);

    install_folder(&host, &old, false);
    std::fs::write(themes.join("acme.carta/manifest.json"), "{ not json").unwrap();
    let unknown = ThemeFolderInstall::Collision {
        id: "acme.carta".into(),
        name: "Prova".into(),
        version: "0.4.0".into(),
        installed_version: None,
    };
    let digest = checked(&host, &new);
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        unknown
    );
    assert!(matches!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Installed { replaced: true, .. }
    ));
    assert_eq!(host.themes().unwrap()[0].manifest.version, "0.4.0");

    std::fs::remove_dir_all(themes.join("acme.carta")).unwrap();
    std::fs::write(themes.join("acme.carta"), "not a folder").unwrap();
    let digest = checked(&host, &new);
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        unknown
    );
    assert!(matches!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Installed { replaced: true, .. }
    ));
    assert!(themes.join("acme.carta/manifest.json").is_file());
    assert_eq!(themes_entries(&config), vec!["acme.carta".to_string()]);
}

/// Prova che l'installazione si ferma su ciò che blocca, con e senza
/// «Sostituisci», e che niente sotto `themes/` cambia: né il tema installato
/// né una staging rimasta.
pub(super) fn assert_blocked(
    host: &Host,
    config: &Utf8Path,
    new: &Utf8Path,
    why: ThemeBlock,
    path: &Utf8Path,
) {
    let before = themes_entries(config);
    for replace in [false, true] {
        let digest = checked(host, new);
        assert_eq!(
            host.install_theme_from_folder(replace, &digest).unwrap(),
            ThemeFolderInstall::Blocked {
                why,
                path: path.to_string(),
                installed: true,
            },
            "replace: {replace}"
        );
    }
    assert_eq!(themes_entries(config), before);
}

/// Un tema installato col file della versione del catalogo che non si legge
/// (rotto) non si sostituisce: potrebbe dire «revocato». L'esito è `Blocked`
/// col perché tipizzato, e il tema resta com'è.
#[test]
fn an_installed_theme_whose_pointer_does_not_read_is_blocked() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);
    let themes = fub_host::config::themes_dir(&config);
    install_folder(&host, &old, false);
    std::fs::write(themes.join("acme.carta/.fub-current.json"), "{ not json").unwrap();

    // Il posto è il nome canonico della cartella dei temi, come lo apre
    // l'installazione: su Windows è un'altra scrittura della cartella
    // temporanea (il nome lungo al posto di `RUNNER~1`). Alla persona arriva
    // nella forma normale, senza il prefisso `\\?\` (#482).
    let themes = themes.canonicalize_utf8().unwrap();
    let shown = fub_host::vault_path::plain_text(themes.join("acme.carta").as_str()).into_owned();
    #[cfg(windows)]
    assert!(!shown.starts_with(r"\\?\"), "{shown}");
    assert_blocked(
        &host,
        &config,
        &new,
        ThemeBlock::Pointer,
        Utf8Path::new(&shown),
    );
    assert_eq!(
        std::fs::read_to_string(themes.join("acme.carta/.fub-current.json")).unwrap(),
        "{ not json"
    );
}

/// Un tema revocato il cui file della versione non si lascia aprire: la
/// revoca non si legge, ma non per questo il tema si sostituisce. È
/// `Blocked`, e il file della revoca resta.
#[cfg(unix)]
#[test]
fn a_revoked_theme_whose_pointer_cannot_be_opened_is_blocked() {
    use std::os::unix::fs::PermissionsExt;
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);
    let themes = fub_host::config::themes_dir(&config);
    install_folder(&host, &old, false);
    fub_host::theme::set_theme_revoked(&config, "acme.carta", true).unwrap();
    let pointer = themes.join("acme.carta/.fub-current.json");
    std::fs::set_permissions(&pointer, std::fs::Permissions::from_mode(0o000)).unwrap();
    // Chi gira come root legge lo stesso: la prova non dice niente.
    let readable = std::fs::read(&pointer).is_ok();
    if !readable {
        assert_blocked(
            &host,
            &config,
            &new,
            ThemeBlock::Pointer,
            &themes.join("acme.carta"),
        );
    }
    std::fs::set_permissions(&pointer, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(fub_host::theme::theme_revoked(&config, "acme.carta"));
}

/// Un link simbolico al posto del tema installato, o della cartella dei temi
/// di Fub, non è un difetto della cartella scelta: è `Blocked` (`link`) col
/// posto, e Fub non scrive attraverso il link.
#[cfg(unix)]
#[test]
fn a_symlink_in_the_themes_folder_is_blocked_not_refused() {
    let (_config_dir, config) = folders();
    let (_elsewhere_dir, elsewhere) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&elsewhere, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);
    let themes = fub_host::config::themes_dir(&config);
    std::fs::create_dir_all(&themes).unwrap();
    std::os::unix::fs::symlink(&elsewhere, themes.join("acme.carta")).unwrap();

    assert_blocked(
        &host,
        &config,
        &new,
        ThemeBlock::Link,
        &themes.join("acme.carta"),
    );
    assert!(std::fs::symlink_metadata(themes.join("acme.carta"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(
        std::fs::read_to_string(elsewhere.join("manifest.json"))
            .unwrap()
            .contains("0.3.2"),
        "nothing is written through the link"
    );

    std::fs::remove_file(themes.join("acme.carta")).unwrap();
    std::fs::remove_dir(&themes).unwrap();
    let (_real_dir, real) = folders();
    std::os::unix::fs::symlink(&real, &themes).unwrap();
    for replace in [false, true] {
        let digest = checked(&host, &new);
        assert_eq!(
            host.install_theme_from_folder(replace, &digest).unwrap(),
            ThemeFolderInstall::Blocked {
                why: ThemeBlock::Link,
                path: themes.to_string(),
                installed: false,
            }
        );
    }
    assert!(std::fs::read_dir(&real).unwrap().next().is_none());
}

/// La cartella dei temi di Fub che non è una cartella (un file) è `Blocked`
/// (`layout`), non un guasto del disco.
#[test]
fn a_themes_folder_that_is_a_file_is_blocked() {
    let (_config_dir, config) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);
    let themes = fub_host::config::themes_dir(&config);
    std::fs::create_dir_all(themes.parent().unwrap()).unwrap();
    std::fs::write(&themes, "not a folder").unwrap();
    let digest = checked(&host, &new);
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Blocked {
            why: ThemeBlock::Layout,
            path: themes.to_string(),
            installed: false,
        }
    );
    assert_eq!(std::fs::read_to_string(&themes).unwrap(), "not a folder");
}

/// Un id già installato: l'esito lo dice con le due versioni e non tocca
/// niente; con `replace` (la stessa cartella controllata) il nuovo prende il
/// posto del vecchio. Spegnere la chiave fra le due domande ferma la seconda e
/// lascia il vecchio.
#[test]
fn an_installed_id_collides_and_replace_swaps_it() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    std::fs::write(new.join("skin.css"), ".surface { color: red; }\n").unwrap();
    let host = developer(&config, true);
    install_folder(&host, &old, false);

    let digest = checked(&host, &new);
    let outcome = host.install_theme_from_folder(false, &digest).unwrap();
    assert_eq!(
        outcome,
        ThemeFolderInstall::Collision {
            id: "acme.carta".into(),
            name: "Prova".into(),
            version: "0.4.0".into(),
            installed_version: Some("0.3.2".into()),
        }
    );
    let installed_skin = fub_host::config::themes_dir(&config).join("acme.carta/skin.css");
    assert_eq!(
        std::fs::read_to_string(&installed_skin).unwrap(),
        ".surface { color: inherit; }\n",
        "a collision touches nothing"
    );

    let outcome = host.install_theme_from_folder(true, &digest).unwrap();
    assert_eq!(
        outcome,
        ThemeFolderInstall::Installed {
            id: "acme.carta".into(),
            name: "Prova".into(),
            version: "0.4.0".into(),
            replaced: true,
        }
    );
    assert_eq!(
        std::fs::read_to_string(&installed_skin).unwrap(),
        ".surface { color: red; }\n"
    );
    assert_eq!(
        host.themes().unwrap()[0].manifest.version,
        "0.4.0",
        "the inventory reads the new one"
    );
    assert_eq!(themes_entries(&config), vec!["acme.carta".to_string()]);

    let digest = checked(&host, &old);
    assert!(matches!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Collision { .. }
    ));
    set_developer(&host, false);
    let error = host
        .install_theme_from_folder(true, &digest)
        .expect_err("off between the collision and «Sostituisci»");
    assert!(matches!(error, fub_abi::PluginError::PermissionDenied(_)));
    assert_eq!(
        std::fs::read_to_string(&installed_skin).unwrap(),
        ".surface { color: red; }\n"
    );
}

/// Un tema installato revocato dal catalogo non si sostituisce da cartella:
/// la copia nuova non ha puntatore, e cancellerebbe la revoca. L'esito lo
/// dice prima della domanda «Sostituisci», e anche chiedendo `replace` niente
/// si tocca: il tema resta revocato.
#[test]
fn a_revoked_installed_theme_is_not_replaced_from_a_folder() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    std::fs::write(new.join("skin.css"), ".surface { color: red; }\n").unwrap();
    let host = developer(&config, true);
    install_folder(&host, &old, false);
    fub_host::theme::set_theme_revoked(&config, "acme.carta", true).unwrap();

    for replace in [false, true] {
        let digest = checked(&host, &new);
        assert_eq!(
            host.install_theme_from_folder(replace, &digest).unwrap(),
            ThemeFolderInstall::Revoked {
                id: "acme.carta".into(),
                name: "Prova".into(),
                version: "0.4.0".into(),
            },
            "replace: {replace}"
        );
    }
    assert!(fub_host::theme::theme_revoked(&config, "acme.carta"));
    assert_eq!(
        std::fs::read_to_string(fub_host::config::themes_dir(&config).join("acme.carta/skin.css"))
            .unwrap(),
        ".surface { color: inherit; }\n"
    );
    assert_eq!(themes_entries(&config), vec!["acme.carta".to_string()]);
}

/// La cartella di chi scrive un tema non porta lo stato del catalogo: il
/// puntatore alla versione (che `read_theme` seguirebbe), le sue copie
/// temporanee e le generazioni. Il controllo lo rifiuta per nome, e niente si
/// scrive.
#[test]
fn a_folder_with_catalog_state_is_refused() {
    let (_config_dir, config) = folders();
    let host = developer(&config, true);
    for (file, make) in [
        (".fub-current.json", false),
        (".fub-current-1-2.json", false),
        (".generations", true),
    ] {
        let (_dir, root) = folders();
        write_versioned_theme(&root, "acme.carta", "0.3.2");
        if make {
            std::fs::create_dir_all(root.join(file).join("1-2")).unwrap();
            write_versioned_theme(&root.join(file).join("1-2"), "acme.carta", "9.9.9");
        } else {
            std::fs::write(
                root.join(file),
                r#"{"version": 1, "generation": "", "revoked": true}"#,
            )
            .unwrap();
        }
        assert_eq!(
            refused(&host, &root),
            ThemeFolderRefusal::CatalogState { file: file.into() },
            "{file}"
        );
        assert!(themes_dir_is_empty(&config), "{file}");
    }
}

/// Un rifiuto della cartella è un esito tipizzato, coi campi per dirlo: mai
/// un errore col messaggio dell'host da interpretare. `PermissionDenied` resta
/// solo la modalità spenta.
#[test]
fn a_refused_folder_is_a_typed_outcome() {
    let (_config_dir, config) = folders();
    let host = developer(&config, true);

    let (_empty_dir, empty) = folders();
    std::fs::write(empty.join("skin.css"), ".surface {}\n").unwrap();
    assert_eq!(refused(&host, &empty), ThemeFolderRefusal::NotATheme);

    let (_permissions_dir, permissions) = folders();
    write_theme(
        &permissions,
        "acme.carta",
        "theme-2",
        r#", "permissions": ["net"]"#,
    );
    assert_eq!(
        refused(&host, &permissions),
        ThemeFolderRefusal::Permissions
    );

    let (_engine_dir, engine) = folders();
    write_theme(&engine, "acme.carta", "theme-9", "");
    assert_eq!(
        refused(&host, &engine),
        ThemeFolderRefusal::Engine {
            declared: "theme-9".into()
        }
    );

    let (_series_dir, series) = folders();
    write_theme(&series, fub_host::theme::SERIES_ID, "theme-2", "");
    assert_eq!(refused(&host, &series), ThemeFolderRefusal::Series);

    let (_malformed_dir, malformed) = folders();
    write_theme(&malformed, "acme.carta", "theme-2", "");
    std::fs::write(malformed.join("manifest.json"), "{ not json").unwrap();
    assert!(
        matches!(
            refused(&host, &malformed),
            ThemeFolderRefusal::Malformed { .. }
        ),
        "a manifest that is not JSON"
    );
    assert!(themes_dir_is_empty(&config));
}

/// Un link simbolico dentro la cartella è un traversal, come per
/// `install_theme`, e il rifiuto nomina il file relativo alla cartella.
#[cfg(unix)]
#[test]
fn a_symlink_inside_the_folder_is_refused() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_versioned_theme(&root, "acme.carta", "0.3.2");
    std::os::unix::fs::symlink("/etc", root.join("escape")).unwrap();

    assert_eq!(
        refused(&developer(&config, true), &root),
        ThemeFolderRefusal::Traversal {
            path: "escape".into()
        }
    );
    assert!(themes_dir_is_empty(&config));
}

/// Leggere la cartella non scrive niente: il manifest, un fascio per luce e
/// l'impronta dei byte. Dei byte degli asset viaggiano solo quelli che il
/// cancello della shell legge (i caratteri, le icone); degli altri il nome.
#[test]
fn checking_a_folder_reads_both_lights_and_writes_nothing() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_versioned_theme(&root, "acme.carta", "0.3.2");
    std::fs::write(
        root.join("skin.css"),
        ".surface { background: url(\"theme://acme.carta/carta.png\"); }\n",
    )
    .unwrap();
    std::fs::write(root.join("carta.png"), [0x89, b'P', b'N', b'G']).unwrap();

    let check = developer(&config, true)
        .check_theme_folder(&root)
        .expect("reads the folder");
    let ThemeFolderCheck::Ready {
        folder,
        manifest,
        skin,
        assets,
        lights,
        digest,
    } = check
    else {
        panic!("expected Ready, got {check:?}");
    };
    assert_eq!(folder, root.as_str());
    assert_eq!(manifest.id, "acme.carta");
    assert_eq!(digest, fub_host::theme::theme_tree_digest(&root).unwrap());
    let order: Vec<_> = lights.iter().map(|light| light.light).collect();
    assert_eq!(
        order,
        vec![
            fub_abi::theme::ThemeLight::Light,
            fub_abi::theme::ThemeLight::Dark
        ]
    );
    assert_eq!(lights[1].sheet.as_deref(), Some("body { color: #ddd; }\n"));
    assert!(assets.is_empty(), "an image travels by name");
    assert!(skin.as_deref().unwrap().contains("carta.png"), "{skin:?}");
    assert_eq!(
        lights[0].named,
        vec!["theme://acme.carta/carta.png".to_string()]
    );
    assert!(themes_dir_is_empty(&config), "a check writes nothing");
}

/// L'installazione pubblica solo i byte controllati: una cartella cambiata
/// dopo il controllo si ferma con `Changed`, e niente si scrive. Con
/// `replace` il tema installato resta com'era. Anche una cartella che dopo il
/// controllo è diventata da rifiutare è «cambiata», non un rifiuto nuovo.
#[test]
fn a_folder_changed_after_the_check_is_not_installed() {
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);

    let digest = checked(&host, &old);
    std::fs::write(old.join("skin.css"), ".surface { color: blue; }\n").unwrap();
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Changed
    );
    assert!(
        themes_dir_is_empty(&config),
        "nothing published, no staging left"
    );

    install_folder(&host, &old, false);
    let digest = checked(&host, &new);
    assert!(matches!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Collision { .. }
    ));
    std::fs::write(new.join("skin.css"), ".surface { color: red; }\n").unwrap();
    assert_eq!(
        host.install_theme_from_folder(true, &digest).unwrap(),
        ThemeFolderInstall::Changed,
        "changed before «Sostituisci»"
    );
    assert_eq!(
        std::fs::read_to_string(fub_host::config::themes_dir(&config).join("acme.carta/skin.css"))
            .unwrap(),
        ".surface { color: blue; }\n",
        "the installed theme stays as it was"
    );
    assert_eq!(
        themes_entries(&config),
        vec!["acme.carta".to_string()],
        "no staging and no copy set aside are left"
    );

    let (_other_dir, other) = folders();
    write_versioned_theme(&other, "acme.lino", "1.0.0");
    let digest = checked(&host, &other);
    std::fs::write(other.join(".fub-current.json"), "{}").unwrap();
    assert_eq!(
        host.install_theme_from_folder(false, &digest).unwrap(),
        ThemeFolderInstall::Changed,
        "catalog state appeared after the check"
    );
}

/// Una cartella tolta o rinominata dopo il controllo non c'è più: niente da
/// leggere non è un guasto del disco, è una cartella che non ha più i byte
/// del controllo (`Changed`).
#[test]
fn a_folder_moved_after_the_check_is_changed() {
    let (_config_dir, config) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);

    let digest = checked(&host, &new);
    let moved = new.with_file_name(format!("{}-spostata", new.file_name().unwrap()));
    std::fs::rename(&new, &moved).unwrap();
    let outcome = host.install_theme_from_folder(false, &digest).unwrap();
    std::fs::rename(&moved, &new).unwrap();
    assert_eq!(outcome, ThemeFolderInstall::Changed);
    assert!(themes_dir_is_empty(&config), "nothing written");
}

/// Una sostituzione che il disco ferma prima dello scambio (la cartella dei
/// temi non si scrive) è `Failed` col suo perché tipizzato (`denied`), e il
/// tema installato resta intatto: la
/// copia nuova si prepara accanto, il vecchio non si toglie prima.
///
/// L'esito `ReplaceFailed` (il nuovo non entra **e** il vecchio non torna al
/// suo nome) non si provoca qui: dopo che il vecchio è stato spostato da parte
/// nella stessa cartella, rimetterlo è un `rename` che il disco non rifiuta a
/// comando in una cartella temporanea. Lo provano i test di unità di
/// `theme::install`, con un guasto iniettato nello scambio.
#[cfg(unix)]
#[test]
fn a_replace_the_disk_refuses_keeps_the_installed_theme() {
    use std::os::unix::fs::PermissionsExt;
    let (_config_dir, config) = folders();
    let (_old_dir, old) = folders();
    let (_new_dir, new) = folders();
    write_versioned_theme(&old, "acme.carta", "0.3.2");
    write_versioned_theme(&new, "acme.carta", "0.4.0");
    let host = developer(&config, true);
    install_folder(&host, &old, false);
    let digest = checked(&host, &new);

    let themes = fub_host::config::themes_dir(&config);
    std::fs::set_permissions(&themes, std::fs::Permissions::from_mode(0o555)).unwrap();
    // Chi gira come root scrive lo stesso: la prova non dice niente.
    let writable = std::fs::create_dir(themes.join(".probe")).is_ok();
    let result = host.install_theme_from_folder(true, &digest);
    std::fs::set_permissions(&themes, std::fs::Permissions::from_mode(0o755)).unwrap();
    if writable {
        return;
    }
    let outcome = result.expect("a disk that refuses is an outcome");
    assert!(
        matches!(
            outcome,
            ThemeFolderInstall::Failed {
                cause: fub_host::theme::DiskCause::Denied,
                ..
            }
        ),
        "{outcome:?}"
    );
    let listed = host.themes().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].manifest.version, "0.3.2", "the old one stays");
}
