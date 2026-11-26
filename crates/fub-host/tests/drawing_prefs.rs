//! Le preferenze del motore del disegno come impostazione `draw.motore`
//! (piano K6, T11; `crates/fub-host/src/drawing.rs`): l'host le dà a ogni
//! istanza che nasce e salva quelle che un comando cambia. Un valore di una
//! versione più nuova si legge e non si scrive, uno rotto si salta e non si
//! sovrascrive, una cartella non arriva al motore, e una scrittura che non
//! riesce lascia il valore di prima, nell'istanza e nel file.
#![cfg(feature = "drawing-complete")]

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::{DrawingCommandRequest, PluginError};
use fub_host::{doc_id, Host};
use serde_json::{json, Value};

const DISEGNO: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n</svg>\n";

/// Un vault e una cartella di configurazione che restano fra un host e
/// l'altro.
struct Posto {
    _vault: tempfile::TempDir,
    _config: tempfile::TempDir,
    root: Utf8PathBuf,
    config: Utf8PathBuf,
}

impl Posto {
    fn nuovo() -> Self {
        Self::con_preferenze(None)
    }

    /// Con `draw.motore` già scritto nelle impostazioni della macchina.
    fn con_preferenze(testo: Option<&str>) -> Self {
        let vault = tempfile::tempdir().expect("vault");
        let root = Utf8PathBuf::from_path_buf(vault.path().canonicalize().unwrap()).unwrap();
        std::fs::write(root.join("Disegno.svg"), DISEGNO).unwrap();
        let config = tempfile::tempdir().expect("config");
        let config_dir = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap();
        if let Some(testo) = testo {
            std::fs::write(
                fub_host::config::machine_settings_path(&config_dir),
                json!({"version": 1, "values": {"draw.motore": testo}}).to_string(),
            )
            .unwrap();
        }
        Posto {
            _vault: vault,
            _config: config,
            root,
            config: config_dir,
        }
    }

    /// Un host nuovo sul vault, con la configurazione del posto.
    fn host(&self) -> Host {
        let host = Host::without_watcher().with_config_dir(&self.config);
        host.open(&self.root).expect("il vault si apre");
        host
    }

    fn vault(&self) -> Option<&str> {
        Some(self.root.as_str())
    }

    /// Il testo di `draw.motore` nel file della macchina, se c'è.
    fn salvato(&self) -> Option<String> {
        let file = fub_host::config::machine_settings_path(&self.config);
        let testo = std::fs::read_to_string(file).ok()?;
        let valore: Value = serde_json::from_str(&testo).ok()?;
        valore["values"]["draw.motore"].as_str().map(str::to_string)
    }
}

fn apri(host: &Host, posto: &Posto) -> String {
    host.drawing_open(posto.vault(), &doc_id("Disegno.svg").unwrap(), DISEGNO)
        .expect("si apre")
        .instance
}

fn comando(
    host: &Host,
    posto: &Posto,
    istanza: &str,
    id: &str,
    valore: Value,
) -> Result<fub_abi::DrawingOutcome, PluginError> {
    host.drawing_command(
        posto.vault(),
        istanza,
        DrawingCommandRequest {
            revision: 0,
            id: id.into(),
            selection: vec![],
            value: valore,
            preview: false,
        },
    )
}

/// Il valore di una preferenza nell'istanza.
fn leggi(host: &Host, posto: &Posto, istanza: &str, chiave: &str) -> Value {
    comando(
        host,
        posto,
        istanza,
        "disegno.prefs.get",
        json!({"key": chiave}),
    )
    .expect("prefs.get risponde")
    .reading
    .expect("una lettura")
}

#[test]
fn una_preferenza_cambiata_si_salva_e_un_disegno_nuovo_la_rilegge() {
    let posto = Posto::nuovo();
    {
        let host = posto.host();
        let istanza = apri(&host, &posto);
        comando(
            &host,
            &posto,
            &istanza,
            "disegno.prefs.set",
            json!({"key": "keyboardIncrement", "value": 5}),
        )
        .expect("prefs.set");
        let salvato: Value =
            serde_json::from_str(&posto.salvato().expect("draw.motore è scritto")).unwrap();
        assert_eq!(
            salvato,
            json!({"v": 1, "prefs": {"keyboardIncrement": 5.0}})
        );
        host.close();
    }
    let host = posto.host();
    let istanza = apri(&host, &posto);
    assert_eq!(
        leggi(&host, &posto, &istanza, "keyboardIncrement"),
        json!(5.0)
    );

    // Tornata al valore di serie, la chiave lascia l'impostazione.
    comando(&host, &posto, &istanza, "disegno.prefs.reset", json!({})).expect("prefs.reset");
    assert_eq!(posto.salvato().unwrap_or_default(), "");
}

#[test]
fn una_versione_piu_nuova_si_legge_e_non_si_scrive() {
    let testo =
        json!({"v": 2, "prefs": {"keyboardIncrement": 6.0, "unaChiaveNuova": true}}).to_string();
    let posto = Posto::con_preferenze(Some(&testo));
    let host = posto.host();
    let istanza = apri(&host, &posto);
    assert_eq!(
        leggi(&host, &posto, &istanza, "keyboardIncrement"),
        json!(6.0)
    );
    let scrivi = comando(
        &host,
        &posto,
        &istanza,
        "disegno.prefs.set",
        json!({"key": "keyboardIncrement", "value": 2}),
    );
    assert!(
        matches!(scrivi, Err(PluginError::Conflict(_))),
        "{scrivi:?}"
    );
    assert_eq!(
        leggi(&host, &posto, &istanza, "keyboardIncrement"),
        json!(6.0)
    );
    assert_eq!(posto.salvato().as_deref(), Some(testo.as_str()));
}

#[test]
fn un_valore_rotto_si_salta_e_non_si_sovrascrive() {
    let posto = Posto::con_preferenze(Some("{non è JSON"));
    let host = posto.host();
    let istanza = apri(&host, &posto);
    assert_eq!(
        leggi(&host, &posto, &istanza, "keyboardIncrement"),
        json!(1.0)
    );
    let scrivi = comando(
        &host,
        &posto,
        &istanza,
        "disegno.prefs.set",
        json!({"key": "keyboardIncrement", "value": 2}),
    );
    assert!(
        matches!(scrivi, Err(PluginError::Conflict(_))),
        "{scrivi:?}"
    );
    assert_eq!(posto.salvato().as_deref(), Some("{non è JSON"));

    // Azzerata, si scrive di nuovo.
    host.reset_setting_for_user(posto.vault(), "draw.motore")
        .expect("si azzera");
    comando(
        &host,
        &posto,
        &istanza,
        "disegno.prefs.set",
        json!({"key": "keyboardIncrement", "value": 2}),
    )
    .expect("prefs.set");
    assert!(posto
        .salvato()
        .is_some_and(|t| t.contains("keyboardIncrement")));
}

/// Salvare e togliere una preimpostata della sfumatura con `draw.motore` che non si
/// scrive: un rifiuto nell'esito col perché, non un errore (la sessione del client
/// resta viva), il valore su disco non si tocca e l'istanza risponde ancora.
fn le_preimpostate_si_rifiutano_col_perche(testo: &str, perche: &str) {
    let posto = Posto::con_preferenze(Some(testo));
    let host = posto.host();
    let istanza = apri(&host, &posto);
    for (id, valore) in [
        ("disegno.gradient.presets.save", json!({"name": "Mare"})),
        ("disegno.gradient.presets.delete", json!({"name": "Mare"})),
    ] {
        let esito = comando(&host, &posto, &istanza, id, valore)
            .unwrap_or_else(|e| panic!("{id}: un rifiuto, non un errore: {e:?}"));
        assert_eq!(
            esito.refused,
            Some(fub_abi::DrawingRefusal::Unsupported),
            "{id}: {esito:?}"
        );
        assert_eq!(esito.ops, None, "{id}");
        assert_eq!(esito.reading, Some(json!({"prefs": perche})), "{id}");
        assert_eq!(posto.salvato().as_deref(), Some(testo), "{id}");
    }
    // L'istanza è viva: una lettura risponde ancora.
    assert!(leggi(&host, &posto, &istanza, "keyboardIncrement").is_number());
}

#[test]
fn le_preimpostate_con_una_versione_piu_nuova_si_rifiutano_col_perche() {
    let testo = json!({"v": 2, "prefs": {"keyboardIncrement": 6.0}}).to_string();
    le_preimpostate_si_rifiutano_col_perche(&testo, "newer");
}

#[test]
fn le_preimpostate_con_un_valore_rotto_si_rifiutano_col_perche() {
    le_preimpostate_si_rifiutano_col_perche("{non è JSON", "broken");
}

#[test]
fn una_cartella_si_rifiuta_prima_del_motore_e_non_si_salva_mai() {
    let testo =
        json!({"v": 1, "prefs": {"fontsFolder": "/etc", "keyboardIncrement": 3.0}}).to_string();
    let posto = Posto::con_preferenze(Some(&testo));
    let host = posto.host();
    let istanza = apri(&host, &posto);
    for cartella in [
        "fontsFolder",
        "pluginsFolder",
        "recoveryFolder",
        "templatesFolder",
    ] {
        let scrivi = comando(
            &host,
            &posto,
            &istanza,
            "disegno.prefs.set",
            json!({"key": cartella, "value": "/tmp"}),
        );
        assert!(
            matches!(scrivi, Err(PluginError::BadArgs(_))),
            "{cartella}: {scrivi:?}"
        );
        let leggi = comando(
            &host,
            &posto,
            &istanza,
            "disegno.prefs.get",
            json!({"key": cartella}),
        )
        .expect("risponde")
        .reading;
        assert_eq!(leggi, Some(json!("")), "{cartella}: il motore non la ha");
    }
    // Il prossimo salvataggio toglie la cartella scritta a mano.
    comando(
        &host,
        &posto,
        &istanza,
        "disegno.prefs.set",
        json!({"key": "constrainAngle", "value": 15}),
    )
    .expect("prefs.set");
    let salvato = posto.salvato().expect("scritto");
    assert!(!salvato.contains("Folder"), "{salvato}");
    assert!(salvato.contains("keyboardIncrement"), "{salvato}");
}

/// Una scrittura che non riesce (la cartella della configurazione in sola
/// lettura) lascia il valore di prima nel file e nell'istanza.
#[cfg(unix)]
#[test]
fn una_scrittura_che_non_riesce_lascia_il_valore_di_prima() {
    use std::os::unix::fs::PermissionsExt;
    let testo = json!({"v": 1, "prefs": {"keyboardIncrement": 3.0}}).to_string();
    let posto = Posto::con_preferenze(Some(&testo));
    let host = posto.host();
    let istanza = apri(&host, &posto);
    let sola_lettura = |dir: &Utf8Path, modo: u32| {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(modo)).unwrap();
    };
    let file = fub_host::config::machine_settings_path(&posto.config);
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o444)).unwrap();
    sola_lettura(&posto.config, 0o555);
    let scrivi = comando(
        &host,
        &posto,
        &istanza,
        "disegno.prefs.set",
        json!({"key": "keyboardIncrement", "value": 8}),
    );
    sola_lettura(&posto.config, 0o755);
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(scrivi.is_err(), "la scrittura doveva fallire: {scrivi:?}");
    assert_eq!(
        leggi(&host, &posto, &istanza, "keyboardIncrement"),
        json!(3.0)
    );
    assert_eq!(posto.salvato().as_deref(), Some(testo.as_str()));
}
