use super::*;
use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::session::ViewContext;
use fub_abi::settings::{SettingScope, SettingValue};
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::ui::{ActionId, UiAction};
use fub_host::doc_id;

struct Banco {
    host: Arc<Host>,
    root: Utf8PathBuf,
    _dirs: (tempfile::TempDir, tempfile::TempDir),
}

fn banco() -> Banco {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
    std::fs::write(root.join("Uno.md"), "# Uno\n\n[[Due]]\n").unwrap();
    std::fs::write(root.join("Due.md"), "# Due\n").unwrap();
    let config = tempfile::tempdir().expect("config");
    let host = Host::without_watcher()
        .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
    host.open(&root).expect("il vault si apre");
    Banco {
        host: Arc::new(host),
        root,
        _dirs: (dir, config),
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

fn contesto(doc: &str) -> Option<ViewContext> {
    Some(ViewContext::new("main").with_doc(Some(doc_id(doc).unwrap())))
}

/// Due pubblicazioni mandate senza aspettare (il cursore, poi il cambio
/// di nota) lasciano nel kernel l'ultima: ripubblicarla non cambia niente,
/// mentre ripubblicare la prima sì.
#[test]
fn due_contesti_mandati_di_fila_lasciano_l_ultimo() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        for _ in 0..20 {
            let (a, b) = tokio::join!(
                set_active_context_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    contesto("Uno.md"),
                    vault.clone()
                ),
                set_active_context_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    contesto("Due.md"),
                    vault.clone()
                ),
            );
            a.unwrap();
            b.unwrap();
            let ancora = set_active_context_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                contesto("Due.md"),
                vault.clone(),
            )
            .await
            .unwrap();
            assert!(ancora.is_empty(), "il kernel è rimasto su Uno: {ancora:?}");
            let indietro = set_active_context_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                contesto("Uno.md"),
                vault.clone(),
            )
            .await
            .unwrap();
            assert!(
                !indietro.is_empty(),
                "nessuna view segue il documento: la prova non direbbe niente"
            );
        }
    });
}

/// Le scritture della stessa chiave mandate senza aspettare (la scheda
/// dell'ispettore, a ogni clic) arrivano in ordine, e la lettura chiesta
/// dopo le vede.
#[test]
fn lo_stato_di_vista_scritto_di_fila_resta_l_ultimo_e_si_rilegge() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        let scrivi = |valore: u32| {
            set_view_state_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                "inspector.tab".into(),
                Some(serde_json::json!(valore)),
                vault.clone(),
            )
        };
        let (a, b, c, letto) = tokio::join!(
            scrivi(1),
            scrivi(2),
            scrivi(3),
            view_state_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                "inspector.tab".into(),
                vault.clone()
            ),
        );
        a.unwrap();
        b.unwrap();
        c.unwrap();
        assert_eq!(letto.unwrap(), Some(serde_json::json!(3)));
    });
    // E la porta dell'host, fuori dalla corsia, legge lo stesso valore.
    assert_eq!(
        banco
            .host
            .view_state(
                Some(banco.root.as_str()),
                SHELL_OWNER,
                SHELL_INSTANCE,
                "inspector.tab"
            )
            .unwrap(),
        Some(serde_json::json!(3))
    );
}

/// Gli errori dei comandi e delle azioni restano quelli tipizzati
/// dell'host: la corsia non li fa diventare `Internal`.
#[test]
fn in_corsia_gli_errori_restano_tipizzati() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        let diretto = banco
            .host
            .invoke_user_command(
                vault.as_deref(),
                "fub.nessuno",
                serde_json::Value::Null,
                InvokeMode::Apply,
            )
            .unwrap_err();
        let in_corsia = invoke_command_in_lane(
            Arc::clone(&banco.host),
            &corsie,
            "fub.nessuno".into(),
            None,
            None,
            vault.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(&in_corsia).unwrap(),
            serde_json::to_value(&diretto).unwrap()
        );
        assert!(
            !matches!(in_corsia, PluginError::Internal(_)),
            "{in_corsia:?}"
        );

        let azione = view_action_in_lane(
            Arc::clone(&banco.host),
            &corsie,
            view_instance("fub.nessuna".into(), None, None),
            UiAction {
                action: ActionId("apri".into()),
                payload: serde_json::Value::Null,
                fields: Vec::new(),
            },
            vault.clone(),
        )
        .await
        .unwrap_err();
        assert!(!matches!(azione, PluginError::Internal(_)), "{azione:?}");

        let senza_vault = set_active_context_in_lane(
            Arc::clone(&banco.host),
            &corsie,
            contesto("Uno.md"),
            Some("/non/esiste".into()),
        )
        .await
        .unwrap_err();
        assert!(
            !matches!(senza_vault, PluginError::Internal(_)),
            "{senza_vault:?}"
        );
    });
}

/// Gli effetti nativi registrati al posto della finestra.
#[derive(Clone, Default)]
struct Finestra(Arc<std::sync::Mutex<Vec<String>>>);

impl NativeSettings for Finestra {
    fn set_zoom(&self, scale: f64) -> Result<(), String> {
        self.0.lock().unwrap().push(format!("zoom {scale}"));
        Ok(())
    }

    fn set_frame_rate(&self, beyond_60: bool) {
        self.0
            .lock()
            .unwrap()
            .push(format!("fotogrammi {beyond_60}"));
    }
}

fn zoom_letto(risposta: IndexResult) -> Option<f64> {
    match risposta {
        IndexResult::Settings(voci) => voci
            .into_iter()
            .find(|voce| voce.spec.key == fub_host::settings::APPEARANCE_ZOOM)
            .and_then(|voce| voce.value.as_number()),
        altro => panic!("non sono impostazioni: {altro:?}"),
    }
}

/// Un cursore dello zoom trascinato manda le scritture senza aspettare,
/// e la shell rilegge le impostazioni subito dopo: come sul thread
/// principale la domanda vede l'ultima scrittura, e la finestra resta
/// sull'ultimo zoom.
#[test]
fn le_impostazioni_scritte_di_fila_lasciano_l_ultima_nel_file_e_nella_finestra() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let finestra = Finestra::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        for _ in 0..10 {
            let scrivi = |valore: f64| {
                set_setting_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    finestra.clone(),
                    fub_host::settings::APPEARANCE_ZOOM.into(),
                    SettingValue::Number(valore),
                    vault.clone(),
                )
            };
            let (a, b, c, letta) = tokio::join!(
                scrivi(1.1),
                scrivi(1.2),
                scrivi(1.3),
                query_index_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    IndexQuery::Settings { plugin: None },
                    vault.clone()
                ),
            );
            a.unwrap();
            b.unwrap();
            c.unwrap();
            assert_eq!(zoom_letto(letta.unwrap()), Some(1.3));
        }
    });
    let effetti = finestra.0.lock().unwrap();
    assert_eq!(effetti.len(), 30);
    for giro in effetti.chunks(3) {
        assert_eq!(giro, ["zoom 1.1", "zoom 1.2", "zoom 1.3"]);
    }
}

/// Passare a un profilo riporta lo zoom del profilo nella finestra, in
/// fila con le scritture: lo zoom scritto dopo il passaggio resta.
#[test]
fn uno_zoom_scritto_dopo_il_cambio_di_profilo_resta_nella_finestra() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let finestra = Finestra::default();
    let vault = Some(banco.root.to_string());
    let (attivo, _) = banco
        .host
        .settings_profiles(vault.as_deref(), SettingScope::Machine)
        .unwrap();
    runtime().block_on(async {
        let (cambio, scritta) = tokio::join!(
            switch_settings_profile_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                finestra.clone(),
                SettingScope::Machine,
                attivo.clone(),
                vault.clone(),
            ),
            set_setting_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                finestra.clone(),
                fub_host::settings::APPEARANCE_ZOOM.into(),
                SettingValue::Number(1.4),
                vault.clone(),
            ),
        );
        cambio.unwrap();
        scritta.unwrap();
    });
    let effetti = finestra.0.lock().unwrap();
    assert_eq!(
        effetti.last().map(String::as_str),
        Some("zoom 1.4"),
        "{effetti:?}"
    );
}

/// Tre clic di fila sulla puntina e la sidebar che rilegge subito:
/// la lettura vede l'ultimo clic.
#[test]
fn l_organizzazione_scritta_di_fila_si_rilegge_con_l_ultimo_clic() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        for _ in 0..10 {
            let appunta = |sì: bool| {
                set_pinned_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    "Uno.md".into(),
                    sì,
                    vault.clone(),
                )
            };
            let (a, b, c, letta) = tokio::join!(
                appunta(true),
                appunta(false),
                appunta(true),
                query_index_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    IndexQuery::Organization,
                    vault.clone()
                ),
            );
            a.unwrap();
            b.unwrap();
            c.unwrap();
            let IndexResult::Organization(organizzazione) = letta.unwrap() else {
                panic!("non è l'organizzazione");
            };
            assert_eq!(organizzazione.pinned, ["Uno.md"]);
            appunta(false).await.unwrap();
        }
    });
}

/// Il vault corrente scelto due volte di fila resta l'ultimo, e chiudere
/// e riaprire lo stesso vault di fila lo lascia aperto.
#[test]
fn i_vault_cambiati_di_fila_restano_nell_ordine_in_cui_partono() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let altro = tempfile::tempdir().expect("tempdir");
    let secondo = Utf8PathBuf::from_path_buf(altro.path().canonicalize().unwrap()).unwrap();
    std::fs::write(secondo.join("Tre.md"), "# Tre\n").unwrap();
    let finestre = Arc::new(document_windows::DocumentWindows::default());
    runtime().block_on(async {
        open_vault_in_lane(Arc::clone(&banco.host), &corsie, secondo.to_string())
            .await
            .expect("il secondo vault si apre");
        for _ in 0..10 {
            let (a, b) = tokio::join!(
                set_current_vault_in_lane(Arc::clone(&banco.host), &corsie, secondo.to_string()),
                set_current_vault_in_lane(Arc::clone(&banco.host), &corsie, banco.root.to_string()),
            );
            a.unwrap();
            b.unwrap();
            assert_eq!(banco.host.current().as_ref(), Some(&banco.root));
        }
        for _ in 0..3 {
            let (chiuso, aperto) = tokio::join!(
                close_vault_in_lane(
                    (Arc::clone(&banco.host), Arc::clone(&finestre)),
                    &corsie,
                    secondo.to_string()
                ),
                open_vault_in_lane(Arc::clone(&banco.host), &corsie, secondo.to_string()),
            );
            assert!(chiuso.unwrap().is_empty());
            aperto.unwrap();
            assert!(banco.host.vaults().contains(&secondo));
        }
    });
}

fn shell() -> ResourceCaller {
    ResourceCaller {
        label: "main".into(),
        origin: "tauri://localhost/".into(),
    }
}

/// Un PDF che si chiude mentre l'ultimo pezzo è in volo: il pezzo chiesto
/// prima della chiusura si legge, e dopo la chiusura il prestito non c'è
/// più.
#[test]
fn un_pezzo_chiesto_prima_della_chiusura_del_prestito_si_legge() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        for _ in 0..20 {
            let aperta = resource_open_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                shell(),
                "Uno.md".into(),
                vault.clone(),
            )
            .await
            .expect("la risorsa si apre");
            let (letto, chiuso) = tokio::join!(
                resource_read_chunk_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    shell(),
                    aperta.handle,
                    0,
                    4
                ),
                resource_close_in_lane(Arc::clone(&banco.host), &corsie, shell(), aperta.handle),
            );
            letto.expect("il pezzo chiesto prima della chiusura si legge");
            chiuso.unwrap();
            let dopo = resource_read_chunk_in_lane(
                Arc::clone(&banco.host),
                &corsie,
                shell(),
                aperta.handle,
                0,
                4,
            )
            .await;
            assert!(dopo.is_err(), "il prestito chiuso si legge ancora");
        }
    });
}

/// Il recinto delle risorse e gli errori dell'host restano quelli
/// tipizzati anche in corsia.
#[test]
fn in_corsia_le_risorse_e_i_vault_rispondono_con_gli_errori_di_prima() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let vault = Some(banco.root.to_string());
    runtime().block_on(async {
        let visore = resource_open_in_lane(
            Arc::clone(&banco.host),
            &corsie,
            ResourceCaller {
                label: "fub-viewer".into(),
                origin: "tauri://localhost/".into(),
            },
            "Uno.md".into(),
            vault.clone(),
        )
        .await
        .unwrap_err();
        assert!(
            matches!(visore, PluginError::PermissionDenied(_)),
            "{visore:?}"
        );

        let diretto = banco
            .host
            .set_current(Utf8Path::new("/non/esiste"))
            .unwrap_err();
        let in_corsia =
            set_current_vault_in_lane(Arc::clone(&banco.host), &corsie, "/non/esiste".into())
                .await
                .unwrap_err();
        assert_eq!(
            serde_json::to_value(&in_corsia).unwrap(),
            serde_json::to_value(&diretto).unwrap()
        );
        assert!(
            !matches!(in_corsia, PluginError::Internal(_)),
            "{in_corsia:?}"
        );
    });
}

/// Un vault aperto e un export di supporto mandati di fila, con la
/// destinazione dentro quel vault: l'export lo vede già aperto e rifiuta,
/// e il rapporto non entra nelle note. Fuori fila l'export poteva
/// partire prima dell'apertura e scrivere nel vault.
#[test]
fn l_export_di_supporto_vede_il_vault_aperto_subito_prima() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    runtime().block_on(async {
        let anteprima = support_preview_in_lane(Arc::clone(&banco.host), &corsie, None, None)
            .await
            .expect("l'anteprima si raccoglie");
        for giro in 0..10 {
            let altro = tempfile::tempdir().expect("tempdir");
            let secondo = Utf8PathBuf::from_path_buf(altro.path().canonicalize().unwrap()).unwrap();
            let destinazione = secondo.join(format!("supporto-{giro}.json"));
            let (aperto, esportato) = tokio::join!(
                open_vault_in_lane(Arc::clone(&banco.host), &corsie, secondo.to_string()),
                support_export_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    anteprima.clone(),
                    fub_host::support::ExportConsent {
                        acknowledged_preview: true,
                        include_log: false,
                        destination: destinazione.to_string(),
                    },
                ),
            );
            aperto.expect("il vault si apre");
            let rifiuto = esportato.expect_err("dentro un vault aperto non si scrive");
            assert!(matches!(rifiuto, PluginError::BadArgs(_)), "{rifiuto:?}");
            assert!(!destinazione.exists(), "il rapporto è entrato nel vault");
            let chiusi = banco
                .host
                .close_vault(&secondo)
                .expect("il vault si chiude");
            assert!(chiusi.is_empty(), "{chiusi:?}");
        }
    });
}

/// Un recupero e la salute chiesta subito dopo, senza aspettare: la
/// salute vede il file già riscritto. Gli errori del recupero restano
/// quelli dell'host anche in corsia.
#[test]
fn la_salute_chiesta_dopo_un_recupero_lo_vede() {
    let banco = banco();
    let corsie = domande::Corsie::default();
    let config = banco
        .host
        .configuration_root()
        .expect("il banco ha una cartella di configurazione")
        .to_owned();
    let impostazioni = fub_host::config::machine_settings_path(&config);
    let sana = |rapporti: &[fub_host::support::ConfigReport]| {
        rapporti
            .iter()
            .find(|rapporto| rapporto.path == impostazioni.as_str())
            .map(|rapporto| matches!(rapporto.status, fub_host::support::ConfigStatus::Healthy))
            .expect("la salute elenca le impostazioni")
    };
    runtime().block_on(async {
        for _ in 0..10 {
            std::fs::write(&impostazioni, b"{ non json").unwrap();
            let prima = config_health_in_lane(Arc::clone(&banco.host), &corsie)
                .await
                .unwrap();
            assert!(!sana(&prima), "il file guasto risulta sano");
            let (recupero, salute) = tokio::join!(
                recover_config_in_lane(
                    Arc::clone(&banco.host),
                    &corsie,
                    impostazioni.to_string(),
                    fub_host::support::RecoverAction::ResetEmpty,
                ),
                config_health_in_lane(Arc::clone(&banco.host), &corsie),
            );
            assert!(recupero.unwrap().backup.is_some());
            assert!(sana(&salute.unwrap()), "la salute non vede il recupero");
        }
        let estraneo = recover_config_in_lane(
            Arc::clone(&banco.host),
            &corsie,
            config.join("altro.json").to_string(),
            fub_host::support::RecoverAction::ResetEmpty,
        )
        .await
        .unwrap_err();
        assert!(matches!(estraneo, PluginError::BadArgs(_)), "{estraneo:?}");
    });
}

/// Il recupero di un file va nella corsia dove quel file si scrive: lo
/// stato di vista con `set_view_state`, il resto con l'indice.
#[test]
fn il_recupero_va_nella_corsia_dove_il_file_si_scrive() {
    let banco = banco();
    let config = banco.host.configuration_root().unwrap().to_owned();
    let corsia = |path: Utf8PathBuf| support::recover_lane(&banco.host, path.as_str());
    assert_eq!(
        corsia(fub_host::config::view_states_path(&config)),
        domande::CORSIA_STATO
    );
    assert_eq!(
        corsia(fub_host::config::machine_settings_path(&config)),
        domande::CORSIA_INDICE
    );
    assert_eq!(
        corsia(fub_host::config::vault_registry_path(&config)),
        domande::CORSIA_INDICE
    );
    assert_eq!(corsia(config.join("altro.json")), domande::CORSIA_INDICE);
}
