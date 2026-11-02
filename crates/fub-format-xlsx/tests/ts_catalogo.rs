//! Il catalogo dei comandi dei fogli per la shell:
//! `apps/client/src/editors/grid/catalogo.generated.json` porta, per ogni
//! comando servito, l'id nel motore e in Fub, la chiave del titolo,
//! l'etichetta inglese, il posto nella barra e i campi del modulo dei
//! parametri. Lo scrive questo file con `UPDATE_MIRROR=1`, e il test fallisce
//! se è stantio.
//!
//! Le schede e i gruppi del catalogo devono essere quelli della barra dei
//! fogli (`apps/client/src/editors/grid/ribbon/tabs.ts`).

use std::collections::BTreeSet;
use std::path::PathBuf;

use fub_format_xlsx::catalogo::{comandi, SPAZIO};
use fub_motori::{Campo, ComandoFub, Posto, Tipo};
use serde_json::{json, Map, Value};

const RIGENERA: &str = "UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --test ts_catalogo";

fn client(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src")
        .join(path)
}

fn campo(campo: &Campo) -> Value {
    let mut out = Map::new();
    out.insert("nome".into(), json!(campo.nome));
    out.insert("tipo".into(), json!(campo.tipo.nome()));
    out.insert("facoltativo".into(), json!(campo.facoltativo));
    if let Tipo::Scelta { valori, aperta } = &campo.tipo {
        out.insert("valori".into(), json!(valori));
        out.insert("aperta".into(), json!(aperta));
    }
    if let Some(gruppo) = campo.uno_fra {
        out.insert("unoFra".into(), json!(gruppo));
    }
    Value::Object(out)
}

fn comando(comando: &ComandoFub) -> Value {
    let mut out = Map::new();
    out.insert("motore".into(), json!(comando.motore));
    out.insert("id".into(), json!(comando.id));
    out.insert("titolo".into(), json!(comando.titolo));
    out.insert("etichetta".into(), json!(comando.etichetta));
    out.insert(
        "posto".into(),
        match comando.posto {
            Posto::Barra { scheda, gruppo } => json!({"scheda": scheda, "gruppo": gruppo}),
            Posto::Tavolozza => Value::Null,
        },
    );
    let modulo = &comando.parametri;
    out.insert("campi".into(), modulo.campi.iter().map(campo).collect());
    if !modulo.altre_forme.is_empty() {
        out.insert(
            "altreForme".into(),
            modulo
                .altre_forme
                .iter()
                .map(|forma| forma.iter().map(campo).collect::<Value>())
                .collect(),
        );
    }
    if modulo.aperto {
        out.insert("aperto".into(), json!(true));
    }
    Value::Object(out)
}

fn catalogo(comandi: &[ComandoFub]) -> Value {
    let mut ordinati: Vec<&ComandoFub> = comandi.iter().collect();
    ordinati.sort_by(|a, b| a.id.cmp(&b.id));
    json!({
        "$generato": format!(
            "File generato da crates/fub-format-xlsx/tests/ts_catalogo.rs, non modificare a mano; rigenera con {RIGENERA}"
        ),
        "spazio": SPAZIO,
        "comandi": ordinati.into_iter().map(comando).collect::<Value>(),
    })
}

fn testo(valore: &Value) -> String {
    let mut out = serde_json::to_string_pretty(valore).expect("il catalogo è JSON");
    out.push('\n');
    out
}

#[test]
fn il_catalogo_della_shell_è_quello_del_motore() {
    let comandi = comandi().expect("il catalogo si fa");
    let atteso = testo(&catalogo(&comandi));
    let path = client("editors/grid/catalogo.generated.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &atteso).expect("scrive il catalogo");
        return;
    }
    let scritto = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}; rigeneralo con `{RIGENERA}`", path.display()));
    assert!(
        scritto == atteso,
        "il catalogo della shell è stantio: rigeneralo con `{RIGENERA}`"
    );
}

#[test]
fn un_catalogo_vecchio_si_vede() {
    let comandi = comandi().expect("il catalogo si fa");
    let nuovo = testo(&catalogo(&comandi));
    let vecchio = testo(&catalogo(&comandi[1..]));
    assert_ne!(nuovo, vecchio, "un comando in meno cambia il file");
    let ordine = {
        let mut rovesciati = comandi.clone();
        rovesciati.reverse();
        testo(&catalogo(&rovesciati))
    };
    assert_eq!(nuovo, ordine, "il file non dipende dall'ordine del motore");
}

#[test]
fn le_schede_e_i_gruppi_sono_quelli_della_barra() {
    let path = client("editors/grid/ribbon/tabs.ts");
    let tabs = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let mut posti = BTreeSet::new();
    for comando in comandi().expect("il catalogo si fa") {
        if let Posto::Barra { scheda, gruppo } = comando.posto {
            posti.insert(scheda);
            posti.extend(gruppo);
        }
    }
    for id in posti {
        assert!(
            tabs.contains(&format!("id: \"{id}\"")),
            "la scheda o il gruppo «{id}» del catalogo non è nella barra dei fogli"
        );
    }
}
