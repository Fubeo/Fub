//! Le impostazioni viste dal **kernel** (§11.1,
//! [decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)):
//! chi dichiara una chiave, chi la può leggere, chi la può scrivere e cosa
//! succede a chi ci prova senza titolo.
//!
//! Le regole di *risoluzione* — vault sopra macchina sopra default, un valore
//! fuori specie che si scarta, una chiave di macchina scritta dentro un vault —
//! stanno nei test di modulo di `settings.rs`, dove lo store si costruisce senza
//! un workspace. Qui c'è ciò che si vede solo **attraverso il contratto**: il
//! manifest che dichiara, l'`HostApi` che presta, il canale dati che risponde,
//! e l'evento che parte.

use camino::Utf8PathBuf;
use fubmd_abi::options::permission;
use fubmd_abi::settings::{SettingKind, SettingSource, SettingSpec, SettingValue};
use fubmd_abi::traits::{IndexQuery, IndexResult, PluginManifest};
use fubmd_abi::{Event, PluginError};
use fubmd_kernel::{FormatRegistry, Trust, Workspace};
use fubmd_testkit::Banco;

/// Un manifest di core che dichiara delle impostazioni.
fn con_impostazioni(id: &str, settings: Vec<SettingSpec>) -> PluginManifest {
    PluginManifest::core(id, id).configuring(settings)
}

fn interruttore() -> SettingSpec {
    SettingSpec::toggle("versioning.enabled", "Versioning", true)
        .describing("Tiene uno storico.")
        .grouped("Vault")
        .program_writable()
}

/// Un'impostazione che **l'utente decide e un programma no**: è la riga non
/// negoziabile del §11.1, e il default del contratto la scrive da sé.
fn intoccabile() -> SettingSpec {
    SettingSpec::toggle("privacy.telemetry", "Telemetria", false)
}

#[test]
fn una_chiave_esiste_perche_un_manifest_la_dichiara() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    assert!(
        ws.setting("versioning.enabled").is_err(),
        "prima della dichiarazione la chiave non esiste"
    );

    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .expect("dichiarato");

    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(true),
        "e da subito vale il default dello schema: un valore c'è sempre"
    );
}

/// Le chiavi di impostazione sono uno degli otto spazi di nomi del §7.4, e non
/// per modo di dire: chi le dichiara deve poterle nominare.
#[test]
fn una_chiave_fuori_dal_proprio_namespace_non_si_dichiara() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    let manifest = PluginManifest::new("com.acme.tasks", "Tasks")
        .configuring(vec![SettingSpec::toggle("versioning.enabled", "V", false)]);

    let errore = ws
        .register_plugin(manifest, Trust::Community)
        .expect_err("una chiave nuda non è di un plugin");
    assert!(
        errore.to_string().contains("com.acme.tasks"),
        "il rifiuto dice a chi doveva intestarla: {errore}"
    );
    assert!(
        ws.plugins().is_empty(),
        "e il plugin non si dichiara affatto: una dichiarazione a metà è uno \
         stato che nessuno ha chiesto"
    );
}

#[test]
fn un_plugin_legge_le_impostazioni_dall_host_come_leggerebbe_il_resto() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .expect("dichiarato");

    let letto = ws.with_host("fubmd.versioning", |host| {
        host.setting("versioning.enabled")
    });
    assert_eq!(letto.unwrap(), SettingValue::Toggle(true));

    // E anche **la chiave di un altro**: la configurazione non è un recinto, e
    // un plugin di tema che non potesse leggere `editor.font-size` perché non è
    // sua sarebbe un plugin di tema inutile. Ciò che è recintato è la scrittura.
    ws.register_core_feature("fubmd.altro", "Altro").unwrap();
    let da_fuori = ws.with_host("fubmd.altro", |host| host.setting("versioning.enabled"));
    assert!(da_fuori.is_ok());
}

/// Il residuo della decisione 0010, chiuso: **quali chiavi sono scrivibili da un
/// programma**. Due cancelli, e nessuno dei due basta da solo.
#[test]
fn un_programma_scrive_solo_le_chiavi_che_si_sono_dichiarate_scrivibili() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore(), intoccabile()]),
        Trust::Core,
    )
    .expect("dichiarato");

    let esito = ws.with_host("fubmd.versioning", |host| {
        host.set_setting("versioning.enabled", SettingValue::Toggle(false))
    });
    assert!(esito.is_ok(), "la chiave si è dichiarata scrivibile");
    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(false)
    );

    let negato = ws.with_host("fubmd.versioning", |host| {
        host.set_setting("privacy.telemetry", SettingValue::Toggle(true))
    });
    assert!(
        matches!(negato, Err(PluginError::PermissionDenied(_))),
        "e questa no, nemmeno a chi l'ha dichiarata: {negato:?}"
    );
    assert_eq!(
        ws.setting("privacy.telemetry").unwrap(),
        SettingValue::Toggle(false),
        "il valore è rimasto quello"
    );
}

/// L'altro cancello: il permesso del manifest (§7.3).
#[test]
fn senza_il_permesso_non_si_scrive_nemmeno_una_chiave_scrivibile() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    // Un plugin di terzi che dichiara la chiave nel proprio namespace, e che
    // **non** dichiara `fubmd:write-settings`.
    let manifest =
        PluginManifest::new("com.acme.tasks", "Tasks").configuring(vec![SettingSpec::toggle(
            "com.acme.tasks:mostra",
            "Mostra",
            true,
        )
        .program_writable()]);
    ws.register_plugin(manifest, Trust::Community)
        .expect("dichiarato");

    let negato = ws.with_host("com.acme.tasks", |host| {
        host.set_setting("com.acme.tasks:mostra", SettingValue::Toggle(false))
    });
    assert!(
        matches!(&negato, Err(PluginError::PermissionDenied(m)) if m.to_string().contains(permission::WRITE_SETTINGS)),
        "il rifiuto nomina il permesso che manca: {negato:?}"
    );

    // Leggere invece passa: uno schema è pubblico per costruzione, e questo
    // store non contiene segreti (regola scritta in `fubmd_abi::settings`).
    let letto = ws.with_host("com.acme.tasks", |host| {
        host.setting("com.acme.tasks:mostra")
    });
    assert!(letto.is_ok(), "leggere non ha un permesso: {letto:?}");
}

#[test]
fn il_canale_dati_risponde_con_schema_valore_e_provenienza() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .expect("dichiarato");
    ws.register_plugin(
        con_impostazioni(
            "fubmd.editor",
            vec![SettingSpec::new(
                "editor.font-size",
                "Corpo",
                SettingKind::Number {
                    default: 14.0,
                    min: Some(8.0),
                    max: Some(72.0),
                },
            )],
        ),
        Trust::Core,
    )
    .expect("dichiarato");

    let IndexResult::Settings(tutte) = ws
        .query_index(IndexQuery::Settings { plugin: None })
        .expect("il kernel serve questa famiglia")
    else {
        panic!("risposta fuori tema");
    };
    assert_eq!(
        tutte
            .iter()
            .map(|e| e.spec.key.as_str())
            .collect::<Vec<_>>(),
        vec!["editor.font-size", "versioning.enabled"],
        "in ordine di chiave"
    );
    assert_eq!(tutte[1].source, SettingSource::Default);
    assert_eq!(tutte[1].spec.group, "Vault", "lo schema arriva intero");

    // Con un id, solo le sue: è ciò che serve al pannello di **un** plugin, e
    // ciò che permette di non filtrare per prefisso — le chiavi del core un
    // prefisso non ce l'hanno.
    let IndexResult::Settings(sue) = ws
        .query_index(IndexQuery::Settings {
            plugin: Some("fubmd.editor".into()),
        })
        .expect("serve")
    else {
        panic!("risposta fuori tema");
    };
    assert_eq!(sue.len(), 1);
    assert_eq!(sue[0].spec.key, "editor.font-size");

    // E dopo una scrittura la **provenienza** cambia insieme al valore: è ciò
    // da cui il pannello decide se mostrare «azzera».
    ws.set_setting("editor.font-size", SettingValue::Number(18.0))
        .unwrap();
    let IndexResult::Settings(dopo) = ws
        .query_index(IndexQuery::Settings {
            plugin: Some("fubmd.editor".into()),
        })
        .expect("serve")
    else {
        panic!("risposta fuori tema");
    };
    assert_eq!(dopo[0].value, SettingValue::Number(18.0));
    assert_eq!(dopo[0].source, SettingSource::Vault);
}

#[test]
fn cambiare_un_impostazione_e_un_fatto_che_si_annuncia() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .expect("dichiarato");
    let eventi = ws.bus().subscribe();

    ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
        .unwrap();

    let mut visti: Vec<Event> = Vec::new();
    while let Ok(notice) = eventi.try_recv() {
        visti.push(notice.event);
    }
    assert!(
        visti.iter().any(|e| matches!(
            e,
            Event::SettingChanged { key, .. } if key == "versioning.enabled"
        )),
        "senza l'evento, un interruttore spostato è invisibile a tutto il \
         resto finché qualcuno non ricarica: {visti:?}"
    );
}

#[test]
fn un_plugin_che_smette_si_porta_via_lo_schema_e_non_il_valore() {
    let mut ws = Banco::nuovo().senza_formato().senza_scansione().monta();
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .expect("dichiarato");
    ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
        .unwrap();

    ws.deactivate_plugin("fubmd.versioning").expect("spento");
    assert!(
        ws.setting("versioning.enabled").is_err(),
        "senza schema la chiave non si legge: è ciò che vuol dire «non c'è»"
    );

    // E riaccenderlo ritrova la configurazione di prima: spegnere una feature
    // non è riconfigurarla.
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .expect("ridichiarato");
    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(false)
    );
}

/// Il valore vive nel vault, non nel processo: è metà di ciò che il §11.1
/// chiedeva («dove stare scritto fra un avvio e l'altro»).
#[test]
fn un_valore_scritto_sopravvive_alla_chiusura_del_vault() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");

    {
        let mut ws = Workspace::new(&root, FormatRegistry::new());
        ws.register_plugin(
            con_impostazioni("fubmd.versioning", vec![interruttore()]),
            Trust::Core,
        )
        .unwrap();
        ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
            .unwrap();
    }

    assert!(
        root.join(".fubmd").join("settings.json").is_file(),
        "il livello del vault sta in `.fubmd/settings.json`, e viaggia col vault"
    );

    let mut ws = Workspace::new(&root, FormatRegistry::new());
    ws.register_plugin(
        con_impostazioni("fubmd.versioning", vec![interruttore()]),
        Trust::Core,
    )
    .unwrap();
    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(false)
    );
}
