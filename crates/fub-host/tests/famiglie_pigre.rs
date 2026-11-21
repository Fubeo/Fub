//! Il Disegno completo lato host (piano K6 T3,
//! `docs/architecture/disegno-completo.md`): le famiglie del motore nascono
//! al loro primo comando, si iscrivono nel `Budget` di K3 solo allora, il
//! `Budget` le libera e il comando dopo le rifà; con il componente spento nel
//! vault non nasce niente e restano i tre comandi di K5.
//!
//! Il vault è una cartella temporanea con il disegno del vettore
//! `rettangolo` dei gesti (lo stesso di `tests/drawing.rs`): il banco di
//! `fub-testkit` apre i provider WASM, e qui serve solo l'host con un motore
//! del disegno suo, sui suoi servizi, per contare le cache del suo `Budget`.
//! Le prove accendono `Filtro::Tutte`, che l'IPC non può accendere: nessuna
//! riga della mappa è ancora «fatto».

#![cfg(feature = "drawing-complete")]

use std::sync::{Arc, Barrier};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::{
    DrawingCommandRequest, DrawingOutcome, PluginError, DRAWING_COMMANDS,
    DRAWING_COMMAND_FAMILY_PREPARE, DRAWING_COMMAND_FILL_COLOR, DRAWING_COMMAND_WIDTH,
};
use fub_disegno::famiglie::{Famiglia, Filtro};
use fub_disegno::motore::Disegni;
use fub_host::componenti::{Azione, Orfani};
use fub_host::{doc_id, Host};
use fub_motori::{Caratteri, Config, Generiche, Servizi, Tetto};

/// Il disegno del vettore `rettangolo` dei gesti: un rettangolo nel livello 1.
const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <title>Prova</title>\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n";

/// Il rettangolo del disegno.
const RETTANGOLO: &str = "oa1a1a1a1";

/// Il Disegno completo, l'id della riga dei Componenti.
const COMPLETO: &str = "fub.disegno-completo";

/// Un comando del nucleo che cambia il documento.
const DEL_NUCLEO: &str = "disegno.edit.duplicate";

/// Un comando dei tracciati.
const DEI_TRACCIATI: &str = "disegno.object.expand";

const ATTESA: Duration = Duration::from_secs(20);

/// Un vault temporaneo con il disegno, aperto da un host con un motore suo.
struct Prova {
    _config: tempfile::TempDir,
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
    servizi: Arc<Servizi>,
    disegni: Arc<Disegni>,
}

impl Prova {
    fn nuova() -> Self {
        Self::con(None)
    }

    /// Con queste impostazioni del vault, scritte prima di aprirlo.
    fn con(values: Option<serde_json::Value>) -> Self {
        let servizi = Servizi::nuovi(Config {
            fili: Some(2),
            tetto: Tetto::fisso(1 << 40),
        });
        let generiche = Generiche {
            serif: "Serif".into(),
            sans: "Sans".into(),
            mono: "Mono".into(),
        };
        servizi
            .fornisci_caratteri(Caratteri::nuovi([], generiche))
            .unwrap_or_else(|_| panic!("i caratteri si danno una volta"));
        let disegni = Disegni::nuovi(Arc::clone(&servizi));
        disegni.filtra(Filtro::Tutte);

        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        std::fs::write(root.join("Disegno.svg"), DISEGNO).unwrap();
        if let Some(values) = values {
            std::fs::create_dir_all(root.join(".fub")).unwrap();
            std::fs::write(
                root.join(".fub").join("settings.json"),
                serde_json::json!({"version": 1, "values": values}).to_string(),
            )
            .unwrap();
        }
        let config = tempfile::tempdir().expect("config");
        let host = Host::without_watcher()
            .with_drawing_engine(Arc::clone(&disegni))
            .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
        host.open(&root).expect("il vault si apre");
        Prova {
            _config: config,
            _dir: dir,
            root,
            host,
            servizi,
            disegni,
        }
    }

    fn vault(&self) -> Option<&str> {
        Some(self.root.as_str())
    }

    /// Apre il disegno nel motore e dà l'istanza.
    fn apri(&self) -> String {
        let doc = doc_id("Disegno.svg").unwrap();
        self.host
            .drawing_open(self.vault(), &doc, DISEGNO)
            .expect("il disegno si apre")
            .instance
    }

    fn comando(
        &self,
        instance: &str,
        id: &str,
        value: serde_json::Value,
    ) -> Result<DrawingOutcome, PluginError> {
        self.host.drawing_command(
            self.vault(),
            instance,
            DrawingCommandRequest {
                revision: 0,
                id: id.into(),
                selection: vec![RETTANGOLO.into()],
                value,
                preview: false,
            },
        )
    }

    fn prepara(&self, instance: &str, famiglia: &str) -> Result<DrawingOutcome, PluginError> {
        self.comando(
            instance,
            DRAWING_COMMAND_FAMILY_PREPARE,
            serde_json::json!({ "famiglia": famiglia }),
        )
    }

    /// Le cache nel `Budget` dei servizi del motore: qui solo le famiglie.
    fn cache(&self) -> usize {
        self.servizi.memoria().quante()
    }

    fn nate(&self) -> Vec<Famiglia> {
        self.disegni.famiglie().nate()
    }
}

fn unserved<T: std::fmt::Debug>(result: Result<T, PluginError>) {
    assert!(
        matches!(result, Err(PluginError::Unserved(_))),
        "{result:?}"
    );
}

/// Un disegno aperto, i suoi comandi elencati e uno dei tre di K5 dato: il
/// Semplice non fa nascere nessuna famiglia.
#[test]
fn nel_semplice_nessuna_famiglia_nasce() {
    let prova = Prova::nuova();
    let instance = prova.apri();
    let comandi = prova
        .host
        .drawing_commands(prova.vault(), &instance, &[RETTANGOLO.into()])
        .expect("i comandi");
    // Nessuna riga è «fatto»: si elencano i tre di K5.
    let ids: Vec<&str> = comandi.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, DRAWING_COMMANDS);
    prova
        .comando(&instance, DRAWING_COMMAND_WIDTH, serde_json::json!(3))
        .expect("lo spessore");
    assert!(prova.nate().is_empty(), "{:?}", prova.nate());
    assert_eq!(prova.cache(), 0, "nessuna cache `disegno.*`");
}

/// Un comando del nucleo fa nascere solo il nucleo; uno dei tracciati anche
/// i tracciati, e nessun'altra. Svuotato il `Budget`, i byte delle famiglie
/// tornano a zero e il comando dopo le rifà.
#[test]
fn ogni_famiglia_nasce_al_suo_primo_comando_e_il_budget_la_libera() {
    let prova = Prova::nuova();
    let instance = prova.apri();

    let duplicato = prova
        .comando(&instance, DEL_NUCLEO, serde_json::Value::Null)
        .expect("il comando del nucleo risponde");
    assert_eq!(duplicato.refused, None, "{duplicato:?}");
    assert!(
        duplicato.ops.is_some(),
        "il duplicato scrive: {duplicato:?}"
    );
    assert_eq!(prova.nate(), [Famiglia::Nucleo]);
    assert_eq!(prova.cache(), 1);

    prova
        .comando(&instance, DEI_TRACCIATI, serde_json::Value::Null)
        .expect("il comando dei tracciati risponde");
    assert_eq!(prova.nate(), [Famiglia::Nucleo, Famiglia::Tracciati]);
    assert_eq!(prova.cache(), 2);

    prova.servizi.memoria().svuota_tutto();
    assert!(prova.nate().is_empty());
    assert_eq!(prova.disegni.famiglie().byte(), 0);
    assert_eq!(prova.cache(), 0);

    prova
        .comando(&instance, DEL_NUCLEO, serde_json::Value::Null)
        .expect("il comando del nucleo risponde di nuovo");
    assert_eq!(prova.nate(), [Famiglia::Nucleo]);
    assert_eq!(prova.disegni.famiglie().nascite(Famiglia::Nucleo), 2);
    assert_eq!(prova.cache(), 1);
}

/// Il Completo spento nel vault: ogni `disegno.*` oltre ai tre di K5, e
/// `famiglia.prepara`, risponde `Unserved`, e nessuna famiglia nasce; i tre
/// di K5 funzionano, e il file si salva e si riapre uguale.
#[test]
fn spento_restano_i_tre_di_k5_e_niente_nasce() {
    let prova = Prova::con(Some(serde_json::json!({"components.off": [COMPLETO]})));
    let instance = prova.apri();
    unserved(prova.comando(&instance, DEL_NUCLEO, serde_json::Value::Null));
    unserved(prova.prepara(&instance, "tracciati"));
    let comandi = prova
        .host
        .drawing_commands(prova.vault(), &instance, &[RETTANGOLO.into()])
        .expect("i comandi");
    let ids: Vec<&str> = comandi.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, DRAWING_COMMANDS);
    // Il rettangolo non ha tratto: il riempimento è il comando che scrive.
    let riempimento = prova
        .comando(
            &instance,
            DRAWING_COMMAND_FILL_COLOR,
            serde_json::Value::Null,
        )
        .expect("il riempimento");
    assert_eq!(riempimento.refused, None, "{riempimento:?}");
    assert!(
        riempimento.ops.is_some(),
        "il riempimento scrive: {riempimento:?}"
    );
    assert!(prova.nate().is_empty());
    assert_eq!(prova.cache(), 0);
    assert_eq!(prova.disegni.famiglie().lavori_avviati(), 0);

    // Il client salva il testo che tiene, e il disegno si riapre uguale.
    let doc = doc_id("Disegno.svg").unwrap();
    prova
        .host
        .drawing_close(prova.vault(), &instance)
        .expect("si chiude");
    let (testo, revisione) = prova.host.read_document(prova.vault(), &doc).unwrap();
    assert_eq!(testo, DISEGNO);
    prova
        .host
        .write_document(
            prova.vault(),
            &doc,
            &testo,
            fub_abi::WriteBase::DescendsFrom(revisione),
        )
        .expect("si salva");
    assert_eq!(
        std::fs::read_to_string(prova.root.join("Disegno.svg")).unwrap(),
        DISEGNO
    );
    let riaperto = prova
        .host
        .drawing_open(prova.vault(), &doc, &testo)
        .expect("si riapre");
    assert_eq!(riaperto.revision, 0);
    assert!(prova.nate().is_empty());
}

/// Spento mentre le famiglie sono nate: si liberano e lasciano il `Budget`.
/// Riacceso, il comando dopo le rifà.
#[test]
fn spegnere_il_completo_libera_le_famiglie() {
    let prova = Prova::nuova();
    let instance = prova.apri();
    prova
        .comando(&instance, DEL_NUCLEO, serde_json::Value::Null)
        .expect("il nucleo");
    assert_eq!(prova.cache(), 1);

    let esito = prova
        .host
        .apply_components(
            prova.vault(),
            Azione::Spegni {
                id: COMPLETO.into(),
                anche_questi: false,
                orfani: Orfani::Chiedi,
            },
            true,
        )
        .expect("l'host risponde")
        .expect("si spegne");
    assert!(esito.applicato);
    assert!(prova.nate().is_empty());
    assert_eq!(prova.cache(), 0);
    // Il disegno resta aperto nel Semplice.
    assert_eq!(prova.host.drawing_instances(prova.vault()).unwrap(), 1);
    unserved(prova.comando(&instance, DEL_NUCLEO, serde_json::Value::Null));

    let esito = prova
        .host
        .apply_components(
            prova.vault(),
            Azione::Accendi {
                id: COMPLETO.into(),
            },
            true,
        )
        .expect("l'host risponde")
        .expect("si accende");
    assert!(esito.applicato);
    prova
        .comando(&instance, DEL_NUCLEO, serde_json::Value::Null)
        .expect("il nucleo di nuovo");
    assert_eq!(prova.nate(), [Famiglia::Nucleo]);
}

/// Due `famiglia.prepara` insieme: un lavoro solo, e la famiglia pronta.
#[test]
fn due_preparazioni_insieme_fanno_un_lavoro_solo() {
    let prova = Prova::nuova();
    let instance = prova.apri();
    let barriera = Barrier::new(2);
    std::thread::scope(|s| {
        let fili: Vec<_> = (0..2)
            .map(|_| {
                s.spawn(|| {
                    barriera.wait();
                    prova.prepara(&instance, "tracciati")
                })
            })
            .collect();
        for filo in fili {
            let esito = filo.join().unwrap().expect("prepara risponde");
            assert_eq!(esito.refused, None, "{esito:?}");
            let stato = esito.reading.as_ref().expect("la lettura")["stato"].clone();
            assert!(stato == "in-corso" || stato == "pronta", "{esito:?}");
        }
    });
    let famiglie = prova.disegni.famiglie();
    assert!(famiglie.aspetta_i_lavori(ATTESA));
    assert_eq!(famiglie.lavori_avviati(), 1);
    assert_eq!(prova.nate(), [Famiglia::Tracciati]);
    let pronta = prova.prepara(&instance, "tracciati").unwrap();
    assert_eq!(pronta.reading.unwrap()["stato"], "pronta");
    assert_eq!(famiglie.lavori_avviati(), 1);
}

/// Con `Filtro::Fatte`, quello dell'app, una riga «da fare» della mappa
/// risponde `Unserved`, e la sua famiglia non nasce.
#[test]
fn con_le_sole_righe_fatte_una_da_fare_e_unserved() {
    let prova = Prova::nuova();
    prova.disegni.filtra(Filtro::Fatte);
    let instance = prova.apri();
    unserved(prova.comando(&instance, DEI_TRACCIATI, serde_json::Value::Null));
    assert!(prova.nate().is_empty());
    assert_eq!(prova.cache(), 0);
}
