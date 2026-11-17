//! Le sei porte del disegno lato host (`crates/fub-host/src/drawing.rs`, piano
//! K5): un disegno si apre nel motore, segue il testo, risponde ai gesti con
//! le operazioni dei vettori dei gesti e si chiude.
//!
//! Lo stesso file si compila nei due giri: con il motore (`cargo test -p
//! fub-host --test drawing`) le porte lo raggiungono; senza (`cargo test -p
//! fub-host --no-default-features --features draw --test drawing`) ogni porta
//! risponde `unserved` e il client ricade sugli strumenti semplici.

use camino::Utf8PathBuf;
use fub_abi::PluginError;
use fub_host::{doc_id, Host};

/// Il disegno del vettore `rettangolo` dei gesti.
const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <title>Prova</title>\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

struct Vault {
    _config: tempfile::TempDir,
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
}

impl Vault {
    fn on(host: Host) -> Self {
        Self::with_settings(host, None)
    }

    /// Un vault con queste impostazioni nel suo file, scritte prima di
    /// aprirlo.
    fn with_settings(host: Host, values: Option<serde_json::Value>) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        std::fs::write(root.join("Disegno.svg"), DISEGNO).unwrap();
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        if let Some(values) = values {
            std::fs::create_dir_all(root.join(".fub")).unwrap();
            std::fs::write(
                root.join(".fub").join("settings.json"),
                serde_json::json!({"version": 1, "values": values}).to_string(),
            )
            .unwrap();
        }
        let config = tempfile::tempdir().expect("config");
        let host =
            host.with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
        host.open(&root).expect("il vault si apre");
        Vault {
            _config: config,
            _dir: dir,
            root,
            host,
        }
    }

    fn new() -> Self {
        Self::on(Host::without_watcher())
    }

    fn vault(&self) -> Option<&str> {
        Some(self.root.as_str())
    }
}

/// Il Motore del disegno, l'id della riga dei Componenti.
const MOTORE: &str = "fub.motore-vettoriale";

/// Un vault che ha spento il motore si apre anche in una build che il motore
/// non ce l'ha, senza errori; il disegno risponde `unserved` in tutte e due.
#[test]
fn un_vault_con_il_motore_spento_si_apre_in_ogni_build() {
    let vault = Vault::with_settings(
        Host::without_watcher(),
        Some(serde_json::json!({"components.off": [MOTORE]})),
    );
    let doc = doc_id("Disegno.svg").unwrap();
    let aperto = vault.host.drawing_open(vault.vault(), &doc, DISEGNO);
    assert!(
        matches!(aperto, Err(PluginError::Unserved(_))),
        "{aperto:?}"
    );
}

#[cfg(not(feature = "engine-drawing"))]
#[test]
fn senza_il_motore_ogni_porta_risponde_unserved() {
    use fub_abi::{DrawingChange, DrawingSync};
    let vault = Vault::new();
    let host = &vault.host;
    let doc = doc_id("Disegno.svg").unwrap();
    let unserved = |result: Result<(), PluginError>| {
        assert!(
            matches!(result, Err(PluginError::Unserved(_))),
            "{result:?}"
        );
    };
    unserved(host.drawing_open(vault.vault(), &doc, DISEGNO).map(drop));
    let sync = DrawingSync {
        revision: 1,
        change: DrawingChange::Text {
            text: DISEGNO.into(),
        },
    };
    unserved(
        host.drawing_sync(vault.vault(), "disegno-1", sync)
            .map(drop),
    );
    unserved(
        host.drawing_commands(vault.vault(), "disegno-1", &[])
            .map(drop),
    );
    unserved(host.drawing_close(vault.vault(), "disegno-1"));
}

#[cfg(feature = "engine-drawing")]
mod con_il_motore {
    use std::sync::Arc;
    use std::time::Duration;

    use fub_abi::{
        DrawingChange, DrawingCommandRequest, DrawingEdit, DrawingGesture, DrawingSync,
        DRAWING_COMMANDS, DRAWING_COMMAND_WIDTH,
    };
    use fub_disegno::motore::Disegni;
    use fub_host::componenti::{Azione, Orfani};
    use fub_motori::{Caratteri, Config, Generiche, Servizi, Tetto, Voce};
    use serde_json::Value;

    use super::*;

    /// Il vettore `rettangolo` dei gesti, scritto dal client.
    fn vettore() -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/src/__fixtures__/disegno-gesti/rettangolo.json");
        let vettore: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("il vettore")).unwrap();
        assert_eq!(vettore["input"], DISEGNO, "il disegno è quello del vettore");
        vettore
    }

    fn gesto(vettore: &Value, revision: u64) -> DrawingGesture {
        let mut gesto = vettore["gesture"].clone();
        gesto["revision"] = Value::String(revision.to_string());
        serde_json::from_value(gesto).expect("il gesto si legge")
    }

    /// Le operazioni con gli id nuovi scritti come il vettore li scrive
    /// (`@1`, `@2`, …, nell'ordine in cui compaiono).
    fn canoniche(ops: &str, nuovi: &[&str]) -> Value {
        let mut testo = ops.to_string();
        for (n, id) in nuovi.iter().enumerate() {
            testo = testo.replace(&format!("\"{id}\""), &format!("\"@{}\"", n + 1));
        }
        serde_json::from_str(&testo).expect("ops in JSON")
    }

    #[test]
    fn apre_segue_il_testo_disegna_un_rettangolo_e_chiude() {
        let vault = Vault::new();
        let host = &vault.host;
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = host
            .drawing_open(vault.vault(), &doc, DISEGNO)
            .expect("si apre");
        assert_eq!(aperto.revision, 0);
        assert!(aperto.mapped >= 2, "{aperto:?}");
        assert_eq!(host.drawing_instances(vault.vault()).unwrap(), 1);

        // Il titolo cambia: «Prova» diventa «Prova 2».
        let from = (DISEGNO.find("Prova</title>").unwrap() + "Prova".len()) as u32;
        let length_before = DISEGNO.len() as u32;
        let sync = DrawingSync {
            revision: 1,
            change: DrawingChange::Edits {
                edits: vec![DrawingEdit {
                    from,
                    to: from,
                    deleted: String::new(),
                    inserted: " 2".into(),
                }],
                length_before,
                length_after: length_before + 2,
            },
        };
        let synced = host
            .drawing_sync(vault.vault(), &aperto.instance, sync)
            .expect("il testo segue");
        assert_eq!(synced.revision, 1);

        let vettore = vettore();
        let esito = host
            .drawing_gesture(vault.vault(), &aperto.instance, gesto(&vettore, 1))
            .expect("il gesto");
        assert_eq!(esito.refused, None, "{esito:?}");
        let ops = esito.ops.as_deref().expect("il rettangolo scrive");
        let grezze: Value = serde_json::from_str(ops).unwrap();
        let nuovo = grezze[0]["elem"]["attrs"]["id"]
            .as_str()
            .expect("l'id del rettangolo")
            .to_string();
        assert_eq!(
            canoniche(ops, &[&nuovo]),
            vettore["expect"]["ops"],
            "le operazioni del vettore"
        );

        let comandi = host
            .drawing_commands(
                vault.vault(),
                &aperto.instance,
                std::slice::from_ref(&nuovo),
            )
            .expect("i comandi");
        let ids: Vec<&str> = comandi.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, DRAWING_COMMANDS);
        let comando = host
            .drawing_command(
                vault.vault(),
                &aperto.instance,
                DrawingCommandRequest {
                    revision: 1,
                    id: DRAWING_COMMAND_WIDTH.into(),
                    selection: vec![nuovo],
                    value: serde_json::json!(2),
                },
            )
            .expect("il comando risponde");
        assert_eq!(comando.revision, 1);

        host.drawing_close(vault.vault(), &aperto.instance)
            .expect("si chiude");
        assert_eq!(host.drawing_instances(vault.vault()).unwrap(), 0);
        let chiusa = host.drawing_gesture(vault.vault(), &aperto.instance, gesto(&vettore, 1));
        assert!(
            matches!(chiusa, Err(PluginError::NotFound(_))),
            "{chiusa:?}"
        );
        let di_nuovo = host.drawing_close(vault.vault(), &aperto.instance);
        assert!(
            matches!(di_nuovo, Err(PluginError::NotFound(_))),
            "{di_nuovo:?}"
        );
    }

    #[test]
    fn una_richiesta_malformata_non_arriva_al_motore() {
        let vault = Vault::new();
        let host = &vault.host;
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = host.drawing_open(vault.vault(), &doc, DISEGNO).unwrap();
        let doppia = host.drawing_commands(
            vault.vault(),
            &aperto.instance,
            &["oa1a1a1a1".into(), "oa1a1a1a1".into()],
        );
        assert!(matches!(doppia, Err(PluginError::BadArgs(_))), "{doppia:?}");
        let vuota = host.drawing_commands(vault.vault(), &aperto.instance, &[String::new()]);
        assert!(matches!(vuota, Err(PluginError::BadArgs(_))), "{vuota:?}");
        let mut zoom = gesto(&vettore(), 0);
        zoom.zoom = 0.0;
        let zero = host.drawing_gesture(vault.vault(), &aperto.instance, zoom);
        assert!(matches!(zero, Err(PluginError::BadArgs(_))), "{zero:?}");
        let colore = host.drawing_command(
            vault.vault(),
            &aperto.instance,
            DrawingCommandRequest {
                revision: 0,
                id: DRAWING_COMMAND_WIDTH.into(),
                selection: vec![],
                value: serde_json::json!(-1),
            },
        );
        assert!(matches!(colore, Err(PluginError::BadArgs(_))), "{colore:?}");
        // La richiesta sbagliata non ha toccato l'istanza.
        let esito = host
            .drawing_gesture(vault.vault(), &aperto.instance, gesto(&vettore(), 0))
            .unwrap();
        assert_eq!(esito.refused, None);
    }

    #[test]
    fn due_finestre_sullo_stesso_file_sono_due_istanze() {
        let vault = Vault::new();
        let host = &vault.host;
        let doc = doc_id("Disegno.svg").unwrap();
        let una = host.drawing_open(vault.vault(), &doc, DISEGNO).unwrap();
        let altra = host.drawing_open(vault.vault(), &doc, DISEGNO).unwrap();
        assert_ne!(una.instance, altra.instance);
        assert_eq!(host.drawing_instances(vault.vault()).unwrap(), 2);
        host.drawing_close(vault.vault(), &una.instance).unwrap();
        let esito = host
            .drawing_gesture(vault.vault(), &altra.instance, gesto(&vettore(), 0))
            .expect("l'altra resta");
        assert!(esito.ops.is_some());
    }

    #[test]
    fn un_istanza_si_raggiunge_solo_dal_suo_vault() {
        let uno = Vault::new();
        let altro_dir = tempfile::tempdir().unwrap();
        let altro = Utf8PathBuf::from_path_buf(altro_dir.path().canonicalize().unwrap()).unwrap();
        std::fs::write(altro.join("Nota.md"), "# Altro\n").unwrap();
        uno.host.open(&altro).unwrap();
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = uno.host.drawing_open(uno.vault(), &doc, DISEGNO).unwrap();
        let fuori = uno
            .host
            .drawing_commands(Some(altro.as_str()), &aperto.instance, &[]);
        assert!(matches!(fuori, Err(PluginError::NotFound(_))), "{fuori:?}");
    }

    /// Un'istanza di un vault chiuso, e una porta chiamata prima che il vault
    /// sia montato, danno l'errore dei comandi Grid.
    #[test]
    fn un_vault_chiuso_o_non_montato_da_l_errore_dei_comandi_grid() {
        let vault = Vault::new();
        let host = &vault.host;
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = host.drawing_open(vault.vault(), &doc, DISEGNO).unwrap();
        host.close_vault(&vault.root).expect("il vault si chiude");
        let grid = host
            .grid_bytes_close(vault.vault(), "xlsx-grid", "xlsx-1")
            .expect_err("Grid su un vault chiuso");
        let disegno = host
            .drawing_commands(vault.vault(), &aperto.instance, &[])
            .expect_err("il disegno su un vault chiuso");
        assert_eq!(disegno, grid);
        let chiusa = host
            .drawing_close(vault.vault(), &aperto.instance)
            .expect_err("chiudere in un vault chiuso");
        assert_eq!(chiusa, grid);

        // Riaperto, il vault non ha più le istanze di prima.
        host.open(&vault.root).unwrap();
        let sparita = host.drawing_commands(vault.vault(), &aperto.instance, &[]);
        assert!(
            matches!(sparita, Err(PluginError::NotFound(_))),
            "{sparita:?}"
        );

        let vuoto = Host::without_watcher();
        let grid = vuoto
            .grid_bytes_close(None, "xlsx-grid", "xlsx-1")
            .unwrap_err();
        let disegno = vuoto.drawing_open(None, &doc, DISEGNO).unwrap_err();
        assert_eq!(disegno, grid);
    }

    /// La chiusura del vault con un gesto in corso: il gesto finisce con un
    /// esito o con l'errore del vault chiuso, mai a metà, e l'istanza si
    /// chiude dopo.
    #[test]
    fn la_chiusura_del_vault_aspetta_il_gesto_in_corso() {
        let vault = Arc::new(Vault::new());
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = vault
            .host
            .drawing_open(vault.vault(), &doc, DISEGNO)
            .unwrap();
        let mut lungo = gesto(&vettore(), 0);
        let mezzo = lungo.events[1];
        let fine = lungo.events.pop().unwrap();
        lungo.events.truncate(1);
        lungo.events.extend(std::iter::repeat_n(mezzo, 50_000));
        lungo.events.push(fine);
        let gesto = {
            let vault = Arc::clone(&vault);
            let instance = aperto.instance.clone();
            std::thread::spawn(move || vault.host.drawing_gesture(vault.vault(), &instance, lungo))
        };
        std::thread::sleep(Duration::from_millis(5));
        vault
            .host
            .close_vault(&vault.root)
            .expect("il vault si chiude");
        match gesto.join().expect("il gesto non panica") {
            Ok(esito) => assert!(esito.ops.is_some(), "{esito:?}"),
            Err(PluginError::NotFound(_) | PluginError::Conflict(_)) => {}
            Err(other) => panic!("{other:?}"),
        }
    }

    /// Un motore che non si costruisce è `Internal`, non `Unserved`; un
    /// nuovo tentativo lo ricostruisce.
    #[test]
    fn un_motore_che_non_si_costruisce_e_internal_e_si_riprova() {
        // Servizi senza caratteri: il motore non nasce.
        let servizi = Servizi::nuovi(Config {
            fili: Some(1),
            tetto: Tetto::fisso(64 * 1024 * 1024),
        });
        let vault = Vault::on(
            Host::without_watcher().with_drawing_engine(Disegni::nuovi(Arc::clone(&servizi))),
        );
        let doc = doc_id("Disegno.svg").unwrap();
        let fermo = vault.host.drawing_open(vault.vault(), &doc, DISEGNO);
        assert!(matches!(fermo, Err(PluginError::Internal(_))), "{fermo:?}");
        assert_eq!(vault.host.drawing_instances(vault.vault()).unwrap(), 0);

        let generiche = Generiche {
            serif: "Serif".into(),
            sans: "Sans".into(),
            mono: "Mono".into(),
        };
        servizi
            .fornisci_caratteri(Caratteri::nuovi([], generiche))
            .unwrap_or_else(|_| panic!("i caratteri si danno una volta"));
        let riprova = vault.host.drawing_open(vault.vault(), &doc, DISEGNO);
        assert!(
            riprova.is_ok(),
            "il nuovo tentativo ricostruisce: {riprova:?}"
        );
    }

    /// Mille istanze aperte restano: il budget svuota le cache, non chiude
    /// i disegni.
    #[test]
    fn mille_istanze_restano_aperte() {
        let vault = Vault::new();
        let host = &vault.host;
        let doc = doc_id("Disegno.svg").unwrap();
        let istanze: Vec<String> = (0..1000)
            .map(|_| {
                host.drawing_open(vault.vault(), &doc, DISEGNO)
                    .expect("si apre")
                    .instance
            })
            .collect();
        assert_eq!(host.drawing_instances(vault.vault()).unwrap(), 1000);
        for instance in [&istanze[0], &istanze[999]] {
            let esito = host
                .drawing_gesture(vault.vault(), instance, gesto(&vettore(), 0))
                .expect("il gesto");
            assert!(esito.ops.is_some(), "{esito:?}");
        }
        host.close_vault(&vault.root).unwrap();
        assert!(host.drawing_instances(vault.vault()).is_err());
    }

    // -----------------------------------------------------------------------
    // Il motore spento nel vault (D-14 (a)): la riga dei Componenti.

    /// Un motore suo, con i caratteri: nasce alla prima apertura.
    fn motore() -> Arc<Disegni> {
        let servizi = Servizi::nuovi(Config {
            fili: Some(1),
            tetto: Tetto::fisso(64 * 1024 * 1024),
        });
        let generiche = Generiche {
            serif: "Serif".into(),
            sans: "Sans".into(),
            mono: "Mono".into(),
        };
        servizi
            .fornisci_caratteri(Caratteri::nuovi([], generiche))
            .unwrap_or_else(|_| panic!("i caratteri si danno una volta"));
        Disegni::nuovi(servizi)
    }

    fn acceso(motore: &Disegni) -> bool {
        Voce::acceso(motore)
    }

    fn applica(host: &Host, vault: Option<&str>, azione: Azione) {
        let esito = host
            .apply_components(vault, azione, true)
            .expect("l'host risponde")
            .expect("la scelta si applica");
        assert!(esito.applicato, "{esito:?}");
    }

    fn spegni(host: &Host, vault: Option<&str>) {
        applica(
            host,
            vault,
            Azione::Spegni {
                id: MOTORE.into(),
                anche_questi: false,
                orfani: Orfani::Chiedi,
            },
        );
    }

    fn accendi(host: &Host, vault: Option<&str>) {
        applica(host, vault, Azione::Accendi { id: MOTORE.into() });
    }

    fn unserved<T: std::fmt::Debug>(result: Result<T, PluginError>) {
        assert!(
            matches!(result, Err(PluginError::Unserved(_))),
            "{result:?}"
        );
    }

    /// Spento il motore nel vault, l'apertura è `unserved` e niente si
    /// costruisce: la voce del motore resta spenta.
    #[test]
    fn spento_nel_vault_l_apertura_e_unserved_e_niente_si_costruisce() {
        let disegni = motore();
        let vault = Vault::with_settings(
            Host::without_watcher().with_drawing_engine(Arc::clone(&disegni)),
            Some(serde_json::json!({"components.off": [MOTORE]})),
        );
        let doc = doc_id("Disegno.svg").unwrap();
        unserved(vault.host.drawing_open(vault.vault(), &doc, DISEGNO));
        assert_eq!(vault.host.drawing_instances(vault.vault()).unwrap(), 0);
        assert!(!acceso(&disegni), "spento, il motore non nasce");
    }

    /// Un vault che aveva spento i disegni prima che il motore fosse una riga
    /// (`fub.draw` in `plugins.disabled`): la riga del motore non è in
    /// `components.off`, ma il motore conta spento.
    #[test]
    fn spenti_i_disegni_il_motore_conta_spento() {
        let disegni = motore();
        let vault = Vault::with_settings(
            Host::without_watcher().with_drawing_engine(Arc::clone(&disegni)),
            Some(serde_json::json!({"plugins.disabled": ["fub.draw"]})),
        );
        let doc = doc_id("Disegno.svg").unwrap();
        unserved(vault.host.drawing_open(vault.vault(), &doc, DISEGNO));
        assert_eq!(vault.host.drawing_instances(vault.vault()).unwrap(), 0);
        assert!(!acceso(&disegni), "spenti i disegni, il motore non nasce");
    }

    /// Aperto, spento: le istanze si chiudono, le loro richieste dopo sono
    /// `unserved` e il motore, senza più istanze, si libera. Riacceso,
    /// nessuna istanza si riapre da sé, e una nuova apertura funziona.
    #[test]
    fn spento_a_meta_sessione_il_gesto_dopo_e_unserved_e_riacceso_si_riapre() {
        let disegni = motore();
        let vault = Vault::on(Host::without_watcher().with_drawing_engine(Arc::clone(&disegni)));
        let host = &vault.host;
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = host.drawing_open(vault.vault(), &doc, DISEGNO).unwrap();
        host.drawing_gesture(vault.vault(), &aperto.instance, gesto(&vettore(), 0))
            .expect("acceso, il gesto risponde");
        assert!(acceso(&disegni));

        spegni(host, vault.vault());
        assert_eq!(host.drawing_instances(vault.vault()).unwrap(), 0);
        unserved(host.drawing_gesture(vault.vault(), &aperto.instance, gesto(&vettore(), 0)));
        unserved(host.drawing_commands(vault.vault(), &aperto.instance, &[]));
        unserved(host.drawing_close(vault.vault(), &aperto.instance));
        unserved(host.drawing_open(vault.vault(), &doc, DISEGNO));
        assert!(!acceso(&disegni), "nessuna istanza: il motore si libera");

        // Riacceso subito: l'istanza di prima non torna.
        accendi(host, vault.vault());
        assert_eq!(host.drawing_instances(vault.vault()).unwrap(), 0);
        let vecchia = host.drawing_gesture(vault.vault(), &aperto.instance, gesto(&vettore(), 0));
        assert!(
            matches!(vecchia, Err(PluginError::NotFound(_))),
            "{vecchia:?}"
        );
        assert!(!acceso(&disegni), "riacceso, nasce alla prima apertura");
        let nuovo = host
            .drawing_open(vault.vault(), &doc, DISEGNO)
            .expect("si riapre");
        assert_ne!(nuovo.instance, aperto.instance);
        let esito = host
            .drawing_gesture(vault.vault(), &nuovo.instance, gesto(&vettore(), 0))
            .expect("il gesto");
        assert!(esito.ops.is_some(), "{esito:?}");
        assert!(acceso(&disegni));
    }

    /// Due vault, il motore spento in uno solo: le istanze dell'altro restano,
    /// e il motore resta costruito.
    #[test]
    fn spento_in_un_vault_l_altro_tiene_i_suoi_disegni() {
        let disegni = motore();
        let uno = Vault::on(Host::without_watcher().with_drawing_engine(Arc::clone(&disegni)));
        let host = &uno.host;
        let altro_dir = tempfile::tempdir().unwrap();
        let altro = Utf8PathBuf::from_path_buf(altro_dir.path().canonicalize().unwrap()).unwrap();
        std::fs::write(altro.join("Disegno.svg"), DISEGNO).unwrap();
        host.open(&altro).unwrap();
        let altro = Some(altro.as_str());
        let doc = doc_id("Disegno.svg").unwrap();
        let qui = host.drawing_open(uno.vault(), &doc, DISEGNO).unwrap();
        let li = host.drawing_open(altro, &doc, DISEGNO).unwrap();

        spegni(host, uno.vault());
        assert_eq!(host.drawing_instances(uno.vault()).unwrap(), 0);
        assert_eq!(host.drawing_instances(altro).unwrap(), 1);
        unserved(host.drawing_gesture(uno.vault(), &qui.instance, gesto(&vettore(), 0)));
        let esito = host
            .drawing_gesture(altro, &li.instance, gesto(&vettore(), 0))
            .expect("l'altro vault disegna ancora");
        assert!(esito.ops.is_some(), "{esito:?}");
        assert!(acceso(&disegni), "l'altro vault lo usa: il motore resta");
        assert!(host.drawing_open(altro, &doc, DISEGNO).is_ok());
    }

    /// Un gesto in corso quando il motore si spegne: finisce, con un esito o
    /// con `unserved`, mai a metà; l'istanza si chiude dopo.
    #[test]
    fn spegnere_aspetta_il_gesto_in_corso() {
        let vault = Arc::new(Vault::on(
            Host::without_watcher().with_drawing_engine(motore()),
        ));
        let doc = doc_id("Disegno.svg").unwrap();
        let aperto = vault
            .host
            .drawing_open(vault.vault(), &doc, DISEGNO)
            .unwrap();
        let mut lungo = gesto(&vettore(), 0);
        let mezzo = lungo.events[1];
        let fine = lungo.events.pop().unwrap();
        lungo.events.truncate(1);
        lungo.events.extend(std::iter::repeat_n(mezzo, 50_000));
        lungo.events.push(fine);
        let gesto = {
            let vault = Arc::clone(&vault);
            let instance = aperto.instance.clone();
            std::thread::spawn(move || vault.host.drawing_gesture(vault.vault(), &instance, lungo))
        };
        std::thread::sleep(Duration::from_millis(5));
        spegni(&vault.host, vault.vault());
        match gesto.join().expect("il gesto non panica") {
            Ok(esito) => assert!(esito.ops.is_some(), "{esito:?}"),
            Err(PluginError::Unserved(_)) => {}
            Err(other) => panic!("{other:?}"),
        }
        assert_eq!(vault.host.drawing_instances(vault.vault()).unwrap(), 0);
    }
}
