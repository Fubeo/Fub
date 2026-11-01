//! `fub-cli componenti` dal di fuori: il binario vero su un vault temporaneo,
//! senza l'app (`--standalone`). Lo stato si guarda in `plugins.disabled`
//! (`config --get`) e in che cosa è montato (`plugin --list`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

struct Vault {
    _tmp: tempfile::TempDir,
    vault: PathBuf,
    config: PathBuf,
}

fn vault() -> Vault {
    let tmp = tempfile::tempdir().unwrap();
    let vault = tmp.path().join("vault");
    let config = tmp.path().join("config");
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(vault.join("nota.md"), "# Nota\n\nUna riga.\n").unwrap();
    Vault {
        vault: vault.canonicalize().unwrap(),
        config,
        _tmp: tmp,
    }
}

fn run(v: &Vault, args: &[&str]) -> Output {
    run_in(&v.vault, &v.config, args)
}

fn run_in(vault: &Path, config: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_fub-cli"))
        .env_remove("FUB_CONFIG_DIR")
        .env_remove("FUB_VAULT")
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "--config-dir",
            config.to_str().unwrap(),
            "--standalone",
        ])
        .args(args)
        .output()
        .unwrap()
}

/// Un comando che riesce, in testo: quello che stampa.
fn text(v: &Vault, args: &[&str]) -> String {
    let output = run(v, args);
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

/// Un comando che riesce, in JSON: il `data` della busta.
fn json(v: &Vault, args: &[&str]) -> Value {
    let mut all = vec!["--format", "json"];
    all.extend_from_slice(args);
    let output = run(v, &all);
    assert!(
        output.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["ok"], true);
    envelope["data"].clone()
}

/// Un comando che non riesce: il codice d'uscita e quello che dice.
fn refused(v: &Vault, args: &[&str]) -> (i32, String) {
    let output = run(v, args);
    assert!(!output.status.success(), "{args:?} doveva fallire");
    (
        output.status.code().unwrap(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn disabled(v: &Vault) -> Vec<String> {
    let data = json(v, &["config", "--get", "plugins.disabled"]);
    let mut ids: Vec<String> = data["value"]
        .as_array()
        .map(|ids| {
            ids.iter()
                .map(|id| id.as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids
}

/// Gli id dei bundle montati.
fn mounted(v: &Vault) -> Vec<String> {
    let data = json(v, &["--limit", "500", "plugin", "--list"]);
    let mut ids: Vec<String> = data["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["mounted"] == true)
        .map(|b| b["id"].as_str().unwrap().to_string())
        .collect();
    ids.sort();
    ids
}

fn item<'a>(list: &'a Value, id: &str) -> &'a Value {
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id)
        .unwrap_or_else(|| panic!("{id} non è nell'elenco"))
}

#[test]
fn l_elenco_dice_chi_e_acceso_perche_e_chi_lo_richiede() {
    let v = vault();
    let list = json(&v, &["componenti"]);
    assert_eq!(list["offset"], 0);
    assert!(list["total"].as_u64().unwrap() > 20);

    let graph = item(&list, "fub.graph");
    assert_eq!(graph["enabled"], true);
    assert_eq!(graph["reason"], "chosen");
    assert_eq!(graph["name"], "Grafo");
    let properties = item(&list, "fub.properties");
    let by: Vec<&str> = properties["required_by"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    assert!(by.contains(&"fub.template"), "{by:?}");
    assert_eq!(item(&list, "fub.markdown")["reason"], "core");
    let penna = item(&list, "fub.penna");
    assert_eq!(penna["reason"], "required");
    assert_eq!(
        penna["required_by"],
        serde_json::json!(["fub.lavagna", "fub.pdf"])
    );

    // A pagine, con offset e limit.
    let page = json(&v, &["--limit", "2", "--offset", "1", "componenti"]);
    assert_eq!(page["items"].as_array().unwrap().len(), 2);
    assert_eq!(page["offset"], 1);
    assert_eq!(page["limit"], 2);
    assert_eq!(page["total"], list["total"]);

    // In testo, una riga per componente, con le colonne.
    let lines = text(&v, &["componenti"]);
    let row = |id: &str| {
        lines
            .lines()
            .find(|line| line.split_whitespace().nth(2) == Some(id))
            .unwrap_or_else(|| panic!("nessuna riga per {id}"))
            .to_string()
    };
    let properties = row("fub.properties");
    assert!(properties.starts_with("acceso"), "{properties}");
    assert!(properties.contains("scelto"), "{properties}");
    assert!(properties.contains("Proprietà"), "{properties}");
    assert!(
        properties.contains("← fub.base, fub.template"),
        "{properties}"
    );

    // Spento, l'elenco lo dice.
    text(&v, &["--yes", "componenti", "spegni", "fub.graph"]);
    let graph = item(&json(&v, &["componenti"]), "fub.graph").clone();
    assert_eq!(graph["enabled"], false);
    assert_eq!(graph["reason"], "off");
    let lines = text(&v, &["componenti"]);
    let line = lines
        .lines()
        .find(|line| line.split_whitespace().nth(2) == Some("fub.graph"))
        .unwrap();
    assert!(line.starts_with("spento"), "{line}");
}

#[test]
fn perche_dice_scelto_richiesto_nucleo_e_spento() {
    let v = vault();
    assert_eq!(
        text(&v, &["componenti", "perche", "fub.graph"]).trim(),
        "fub.graph è attivo perché l'hai scelto."
    );
    assert_eq!(
        text(&v, &["componenti", "perche", "fub.penna"]).trim(),
        "fub.penna è attivo perché lo richiedono: fub.lavagna, fub.pdf."
    );
    assert_eq!(
        text(&v, &["componenti", "perche", "fub.markdown"]).trim(),
        "fub.markdown fa parte del nucleo: non si spegne."
    );
    // Proprietà spenta ma richiesta da Template: è accesa perché serve.
    text(&v, &["--yes", "plugin", "--disable", "fub.properties"]);
    assert_eq!(
        text(&v, &["componenti", "perche", "fub.properties"]).trim(),
        "fub.properties è attivo perché lo richiedono: fub.base, fub.template."
    );
    text(&v, &["--yes", "componenti", "spegni", "fub.graph"]);
    let why = json(&v, &["componenti", "perche", "fub.graph"]);
    assert_eq!(why["reason"], "off");
    assert_eq!(why["message"], "fub.graph è spento.");

    let (code, message) = refused(&v, &["componenti", "perche", "fub.niente"]);
    assert_eq!(code, 1);
    assert!(
        message.contains("nessun componente si chiama «fub.niente»"),
        "{message}"
    );
}

#[test]
fn spegnere_e_riaccendere_il_grafo_lascia_tutto_com_era() {
    let v = vault();
    let disabled_before = disabled(&v);
    let mounted_before = mounted(&v);
    assert!(mounted_before.contains(&"fub.graph".to_string()));

    let off = text(&v, &["--yes", "componenti", "spegni", "fub.graph"]);
    assert_eq!(off.trim(), "fub.graph spento.");
    assert_eq!(disabled(&v), ["fub.graph"]);
    assert!(!mounted(&v).contains(&"fub.graph".to_string()));

    let on = text(&v, &["--yes", "componenti", "accendi", "fub.graph"]);
    assert_eq!(on.trim(), "fub.graph acceso.");
    assert_eq!(disabled(&v), disabled_before);
    assert_eq!(mounted(&v), mounted_before);
}

#[test]
fn proprieta_serve_ad_altri_e_si_spegne_solo_con_anche_questi() {
    let v = vault();
    let (code, message) = refused(&v, &["--yes", "componenti", "spegni", "fub.properties"]);
    assert_eq!(code, 5);
    assert!(message.contains("Serve a"), "{message}");
    assert!(message.contains("fub.template"), "{message}");
    assert!(message.contains("--anche-questi"), "{message}");
    assert!(disabled(&v).is_empty(), "il rifiuto non scrive");

    let off = json(
        &v,
        &[
            "--yes",
            "componenti",
            "spegni",
            "fub.properties",
            "--anche-questi",
        ],
    );
    let also: Vec<&str> = off["also_disabled"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap())
        .collect();
    assert!(also.contains(&"fub.template"), "{also:?}");
    let now = disabled(&v);
    assert!(now.contains(&"fub.properties".to_string()), "{now:?}");
    assert!(now.contains(&"fub.template".to_string()), "{now:?}");
    let mounted = mounted(&v);
    assert!(!mounted.contains(&"fub.properties".to_string()));
    assert!(!mounted.contains(&"fub.template".to_string()));

    // Riaccendere Template riaccende anche Proprietà, e lo dice.
    let on = text(&v, &["--yes", "componenti", "accendi", "fub.template"]);
    assert!(
        on.contains("Attivati anche Proprietà (fub.properties): Template non funziona senza."),
        "{on}"
    );
    let now = disabled(&v);
    assert!(!now.contains(&"fub.properties".to_string()), "{now:?}");
    assert!(!now.contains(&"fub.template".to_string()), "{now:?}");
}

#[test]
fn il_nucleo_non_si_spegne_e_accenderlo_non_fa_niente() {
    let v = vault();
    let (code, message) = refused(&v, &["--yes", "componenti", "spegni", "fub.markdown"]);
    assert_eq!(code, 4);
    assert!(
        message.contains("fub.markdown fa parte del nucleo: non si spegne"),
        "{message}"
    );
    let on = json(&v, &["--yes", "componenti", "accendi", "fub.markdown"]);
    assert_eq!(on["writes"], serde_json::json!([]));
    assert!(on["message"].as_str().unwrap().contains("nucleo"));
    assert!(disabled(&v).is_empty());

    let (code, message) = refused(&v, &["--yes", "componenti", "spegni", "fub.niente"]);
    assert_eq!(code, 1);
    assert!(
        message.contains("nessun componente si chiama «fub.niente»"),
        "{message}"
    );
}

#[test]
fn spegnere_un_componente_gia_spento_non_scrive() {
    let v = vault();
    text(&v, &["--yes", "componenti", "spegni", "fub.stats"]);
    assert_eq!(disabled(&v), ["fub.stats"]);
    // Nessuna scrittura: non chiede nemmeno conferma.
    let again = text(&v, &["--no-input", "componenti", "spegni", "fub.stats"]);
    assert_eq!(again.trim(), "fub.stats è già spento.");
    assert_eq!(disabled(&v), ["fub.stats"]);
    // Acceso, accenderlo di nuovo non scrive.
    let on = text(&v, &["--no-input", "componenti", "accendi", "fub.graph"]);
    assert_eq!(on.trim(), "fub.graph è già acceso.");
}

#[test]
fn senza_yes_fuori_da_un_terminale_non_scrive() {
    let v = vault();
    let (code, message) = refused(&v, &["componenti", "spegni", "fub.graph"]);
    assert_eq!(code, 4);
    assert!(message.contains("--yes"), "{message}");
    assert!(disabled(&v).is_empty());
}

#[test]
fn gli_id_che_non_esistono_piu_si_ignorano_e_restano() {
    let v = vault();
    text(
        &v,
        &[
            "--yes",
            "config",
            "--set",
            "plugins.disabled=fub.sparito,fub.graph",
        ],
    );
    assert_eq!(disabled(&v), ["fub.graph", "fub.sparito"]);
    let list = json(&v, &["componenti"]);
    assert!(list["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["id"] != "fub.sparito"));
    assert_eq!(item(&list, "fub.graph")["enabled"], false);

    text(&v, &["--yes", "componenti", "accendi", "fub.graph"]);
    assert_eq!(disabled(&v), ["fub.sparito"]);
    text(&v, &["--yes", "componenti", "spegni", "fub.stats"]);
    assert_eq!(disabled(&v), ["fub.sparito", "fub.stats"]);
}

#[test]
fn dry_run_con_togli_mostra_l_effetto_e_non_cambia_niente() {
    let v = vault();
    // Template spento e Proprietà spenta ma tenuta accesa da Base: spegnere
    // Base lascia Proprietà senza nessuno.
    text(
        &v,
        &[
            "--yes",
            "config",
            "--set",
            "plugins.disabled=fub.template,fub.properties",
        ],
    );
    let before_disabled = disabled(&v);
    let before_mounted = mounted(&v);

    let ask = json(&v, &["--dry-run", "componenti", "spegni", "fub.base"]);
    assert_eq!(ask["dry_run"], true);
    assert_eq!(ask["orphans"], serde_json::json!(["fub.properties"]));
    assert!(ask["message"]
        .as_str()
        .unwrap()
        .contains("Non servono più a nessuno: Proprietà (fub.properties)"));

    let dry = json(
        &v,
        &["--dry-run", "componenti", "spegni", "fub.base", "--togli"],
    );
    assert_eq!(dry["dry_run"], true);
    assert_eq!(dry["orphans_choice"], "remove");
    assert_eq!(
        dry["writes"],
        serde_json::json!([{ "id": "fub.base", "enabled": false }])
    );
    let dry_text = text(
        &v,
        &["--dry-run", "componenti", "spegni", "fub.base", "--togli"],
    );
    assert!(
        dry_text.starts_with("Prova, non cambia niente:"),
        "{dry_text}"
    );
    assert_eq!(disabled(&v), before_disabled);
    assert_eq!(mounted(&v), before_mounted);

    // Davvero, con --togli: Base spenta, e Proprietà non è più montata.
    text(
        &v,
        &["--yes", "componenti", "spegni", "fub.base", "--togli"],
    );
    let now = disabled(&v);
    assert!(now.contains(&"fub.base".to_string()), "{now:?}");
    assert!(!mounted(&v).contains(&"fub.properties".to_string()));

    // --togli e --tieni insieme non vanno.
    let (code, _) = refused(
        &v,
        &["componenti", "spegni", "fub.base", "--togli", "--tieni"],
    );
    assert_eq!(code, 2);
}
