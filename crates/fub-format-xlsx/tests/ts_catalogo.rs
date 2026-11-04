//! Il catalogo dei comandi dei fogli per la shell:
//! `apps/client/src/editors/grid/catalogo.generated.json` porta, per ogni
//! comando servito, l'id nel motore e in Fub, la chiave del titolo,
//! l'etichetta inglese, il posto nel menu (scheda e gruppo, sempre),
//! l'effetto sulla cartella e i campi del modulo dei parametri; e in più
//! l'elenco delle schede e dei gruppi del menu. Lo scrive questo file con
//! `UPDATE_MIRROR=1`, e il test fallisce se è stantio.
//!
//! Le schede e i gruppi che non sono soltanto del menu devono essere quelli
//! della barra dei fogli (`apps/client/src/editors/grid/ribbon/tabs.ts`), e
//! un comando che la barra mostra ha il posto dove la barra lo mostra per
//! primo.

use std::collections::BTreeMap;
use std::path::PathBuf;

use fub_format_xlsx::catalogo::{comandi, SCHEDE, SPAZIO};
use fub_motori::{Campo, ComandoFub, Posto, Scheda, Tipo};
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
        json!({"scheda": comando.posto.scheda, "gruppo": comando.posto.gruppo}),
    );
    out.insert("effetto".into(), json!(comando.effetto.nome()));
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
        "schede": SCHEDE.iter().map(scheda).collect::<Value>(),
        "comandi": ordinati.into_iter().map(comando).collect::<Value>(),
    })
}

fn scheda(scheda: &Scheda) -> Value {
    json!({
        "id": scheda.id,
        "solo": scheda.solo,
        "contesto": scheda.contesto,
        "gruppi": scheda
            .gruppi
            .iter()
            .map(|gruppo| json!({"id": gruppo.id, "solo": gruppo.solo}))
            .collect::<Value>(),
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

fn barra() -> String {
    let path = client("editors/grid/ribbon/tabs.ts");
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Il primo posto dove la barra mostra ogni comando che nomina per esteso:
/// in `tabs.ts` una scheda è un `id: "…"` senza punto rientrato di due
/// spazi, un gruppo uno rientrato di sei, un comando un id con il punto
/// dentro l'oggetto della scheda; le schede sono scritte nell'ordine della
/// barra. I comandi che la barra nomina con una costante o con un aiuto
/// fuori dall'oggetto (`CF`, `chartElement`) non ci sono: il controllo vale
/// per gli altri.
fn posti_della_barra(tabs: &str) -> BTreeMap<String, (String, String)> {
    let mut posti = BTreeMap::new();
    let (mut scheda, mut gruppo) = (String::new(), String::new());
    for riga in tabs.lines() {
        // Una riga senza rientro chiude la scheda: quello che segue (le
        // costanti, gli aiuti) non è nella barra finché non se ne apre
        // un'altra.
        if riga.starts_with(|c: char| !c.is_whitespace()) {
            scheda.clear();
            gruppo.clear();
            continue;
        }
        let Some(inizio) = riga.find("id: \"") else {
            continue;
        };
        let resto = &riga[inizio + 5..];
        let Some(fine) = resto.find('"') else {
            continue;
        };
        let id = &resto[..fine];
        let rientro = riga.len() - riga.trim_start().len();
        if id.contains('.') {
            if !scheda.is_empty() && !gruppo.is_empty() {
                posti
                    .entry(id.to_owned())
                    .or_insert_with(|| (scheda.clone(), gruppo.clone()));
            }
        } else if rientro == 2 && inizio == 2 {
            scheda = id.to_owned();
            gruppo.clear();
        } else if rientro == 6 && inizio == 6 {
            gruppo = id.to_owned();
        }
    }
    posti
}

#[test]
fn le_schede_e_i_gruppi_sono_quelli_della_barra() {
    let tabs = barra();
    for scheda in SCHEDE.iter().filter(|scheda| !scheda.solo) {
        assert!(
            tabs.contains(&format!("\n  id: \"{}\"", scheda.id)),
            "la scheda «{}» non è nella barra dei fogli, ma non è segnata `solo`",
            scheda.id
        );
        for gruppo in scheda.gruppi.iter().filter(|gruppo| !gruppo.solo) {
            assert!(
                tabs.contains(&format!("\n      id: \"{}\"", gruppo.id)),
                "il gruppo «{} › {}» non è nella barra dei fogli, ma non è segnato `solo`",
                scheda.id,
                gruppo.id
            );
        }
    }
    // E ogni scheda e gruppo della barra è nell'elenco, non soltanto del menu.
    let posti = posti_della_barra(&tabs);
    for (scheda, gruppo) in posti.values() {
        let posto = SCHEDE
            .iter()
            .find(|s| s.id == scheda)
            .and_then(|s| s.gruppi.iter().find(|g| g.id == gruppo).map(|g| (s, g)));
        assert!(
            posto.is_some_and(|(s, g)| !s.solo && !g.solo),
            "il gruppo «{scheda} › {gruppo}» della barra non è nell'elenco delle schede come gruppo della barra"
        );
    }
}

#[test]
fn un_comando_della_barra_ha_il_posto_dove_la_barra_lo_mostra_per_primo() {
    let posti = posti_della_barra(&barra());
    let catalogo = comandi().expect("il catalogo si fa");
    let mut controllati = 0;
    let mut diversi = Vec::new();
    for comando in &catalogo {
        let Some((scheda, gruppo)) = posti.get(&comando.motore) else {
            continue;
        };
        controllati += 1;
        let Posto {
            scheda: s,
            gruppo: g,
        } = comando.posto;
        if (s, g) != (scheda.as_str(), gruppo.as_str()) {
            diversi.push(format!(
                "{}: {s} › {g}, la barra {scheda} › {gruppo}",
                comando.motore
            ));
        }
    }
    assert!(
        diversi.is_empty(),
        "posti diversi dalla barra:\n{}",
        diversi.join("\n")
    );
    assert!(
        controllati > 100,
        "la lettura di tabs.ts ha trovato solo {controllati} comandi"
    );
}
