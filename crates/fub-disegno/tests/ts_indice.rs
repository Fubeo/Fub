//! L'indice dei comandi del Disegno completo per il client (piano K6, T5;
//! `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//!
//! `apps/client/src/editors/spatial/completo/indice.generated.json` porta
//! una voce per ogni riga fatta della mappa e per ogni riga di Fub che ha un
//! posto: fonte, id, il comando da chiamare, le etichette italiana e
//! inglese, il posto, la famiglia, il tasto del motore, l'effetto e se ha
//! una finestra. `completo/famiglie/<id>/schema.generated.json` porta i
//! campi delle finestre di ogni famiglia, che il modulo di T6 disegna. Li
//! scrive questo file con `UPDATE_MIRROR=1`, e il test cade se sono
//! stantii.
//!
//! Le etichette passano per il glossario (`glossario.tsv`): nessuna porta
//! il nome del motore o una parola del gergo (`apps/client/src/i18n/gergo.ts`,
//! letto qui). Un'etichetta senza traduzione resta inglese, e il test la
//! elenca.

#![cfg(feature = "completo")]

use std::path::PathBuf;

use fub_abi::DRAWING_FAMILIES;
use fub_disegno::catalogo::{
    glossario, indice, mappa, minimo_del_campo, predefiniti_del_comando, FonteMappa, Glossario,
    Lingua, Stato, Voce, SPAZIO,
};
use fub_motori::{Campo, Tipo};
use regex::Regex;
use serde_json::{json, Map, Value};

const RIGENERA: &str = "UPDATE_MIRROR=1 cargo test -p fub-disegno --test ts_indice";

fn completo(percorso: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/editors/spatial/completo")
        .join(percorso)
}

fn generato() -> String {
    format!(
        "File generato da crates/fub-disegno/tests/ts_indice.rs, non modificare a mano; rigenera con {RIGENERA}"
    )
}

/// Il comando che il client chiama per la voce: il comando del motore, un
/// effetto con `disegno.effect.apply`, uno strumento del motore; una voce
/// dell'interfaccia o un pannello è del client.
fn chiamata(voce: &Voce) -> Value {
    match voce.fonte {
        FonteMappa::Motore => json!({ "comando": voce.comando.id }),
        FonteMappa::Effetto => json!({
            "comando": format!("{SPAZIO}.effect.apply"),
            "valore": { "effect": voce.id },
        }),
        FonteMappa::Strumento => json!({ "strumento": voce.id }),
        FonteMappa::Interfaccia | FonteMappa::Pannello => match alias_allinea(&voce.id) {
            Some((comando, valore)) => json!({
                "comando": format!("{SPAZIO}.{comando}"),
                "valore": valore,
            }),
            None => json!({ "client": voce.id }),
        },
    }
}

/// Le voci `align.*` dell'interfaccia (T13, giro 2) sono il comando del motore con il
/// suo valore fisso: così passano dal percorso unico, anche da Ctrl+/ (la sezione
/// «Allinea» aggiunge `to`). Le altre voci dell'interfaccia restano del client.
fn alias_allinea(id: &str) -> Option<(&'static str, Value)> {
    Some(match id {
        "align.horizontalLeft" => ("object.align", json!({ "horizontal": "left" })),
        "align.horizontalCenter" => ("object.align", json!({ "horizontal": "center" })),
        "align.horizontalRight" => ("object.align", json!({ "horizontal": "right" })),
        "align.horizontalVerticalCenter" => ("object.align", json!({ "horizontal": "center", "vertical": "center" })),
        "align.verticalTop" => ("object.align", json!({ "vertical": "top" })),
        "align.verticalCenter" => ("object.align", json!({ "vertical": "center" })),
        "align.verticalBottom" => ("object.align", json!({ "vertical": "bottom" })),
        "align.distributeVerticalTop" => ("object.distribute", json!({ "vertical": "top" })),
        "align.distributeVerticalCenter" => ("object.distribute", json!({ "vertical": "center" })),
        "align.distributeVerticalBottom" => ("object.distribute", json!({ "vertical": "bottom" })),
        "align.distributeHorizontalLeft" => ("object.distribute", json!({ "horizontal": "left" })),
        "align.distributeHorizontalCenter" => ("object.distribute", json!({ "horizontal": "center" })),
        "align.distributeHorizontalRight" => ("object.distribute", json!({ "horizontal": "right" })),
        "align.distributeVerticalSpace" => ("object.distributeSpacing", json!({ "axis": "vertical" })),
        "align.distributeHorizontalSpace" => ("object.distributeSpacing", json!({ "axis": "horizontal" })),
        _ => return None,
    })
}

fn voce(voce: &Voce) -> Value {
    let mut out = Map::new();
    out.insert("fonte".into(), json!(voce.fonte.nome()));
    out.insert("id".into(), json!(voce.id));
    out.insert("chiamata".into(), chiamata(voce));
    out.insert(
        "etichetta".into(),
        json!({ "it": voce.etichetta_it, "en": voce.etichetta_en }),
    );
    out.insert("posto".into(), json!(voce.posto));
    out.insert("famiglia".into(), json!(voce.famiglia));
    out.insert("tasto".into(), json!(voce.tasto));
    out.insert("effetto".into(), json!(voce.comando.effetto.nome()));
    out.insert("finestra".into(), json!(voce.finestra));
    if let Some(sotto) = &voce.sotto {
        out.insert("sotto".into(), json!(sotto));
    }
    Value::Object(out)
}

fn ordinate(voci: &[Voce]) -> Vec<&Voce> {
    let mut ordinate: Vec<&Voce> = voci.iter().collect();
    ordinate.sort_by(|a, b| (a.fonte, &a.id).cmp(&(b.fonte, &b.id)));
    ordinate
}

fn indice_json(voci: &[Voce]) -> Value {
    json!({
        "$generato": generato(),
        "voci": ordinate(voci).into_iter().map(voce).collect::<Value>(),
    })
}

/// Un campo con i suoi vincoli di finestra (`minimo`, `predefinito`) se il
/// comando ne ha: i predefiniti vengono dallo schema del motore, i minimi da
/// `catalogo::minimo_del_campo`.
fn campo_con_vincoli(campo_del_modulo: &Campo, comando: &str) -> Value {
    let mut out = campo(campo_del_modulo);
    let Value::Object(mappa) = &mut out else {
        return out;
    };
    if let Some(minimo) = minimo_del_campo(comando, &campo_del_modulo.nome) {
        mappa.insert("minimo".into(), json!(minimo));
    }
    if let Some((_, valore)) = predefiniti_del_comando(comando)
        .into_iter()
        .find(|(nome, _)| *nome == campo_del_modulo.nome)
    {
        let predefinito = valore
            .parse::<f64>()
            .map(|n| json!(n))
            .or_else(|_| valore.parse::<bool>().map(|b| json!(b)))
            .unwrap_or_else(|_| json!(valore));
        mappa.insert("predefinito".into(), predefinito);
    }
    out
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

/// Gli schemi delle finestre di una famiglia.
fn schema_json(famiglia: &str, voci: &[Voce]) -> Value {
    let finestre: Vec<Value> = ordinate(voci)
        .into_iter()
        .filter(|v| v.famiglia == famiglia && v.finestra)
        .map(|v| {
            let modulo = &v.comando.parametri;
            let mut out = Map::new();
            out.insert("fonte".into(), json!(v.fonte.nome()));
            out.insert("id".into(), json!(v.id));
            out.insert(
                "campi".into(),
                modulo
                    .campi
                    .iter()
                    .map(|c| campo_con_vincoli(c, &v.id))
                    .collect(),
            );
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
        })
        .collect();
    json!({
        "$generato": generato(),
        "famiglia": famiglia,
        "finestre": finestre,
    })
}

fn testo(valore: &Value) -> String {
    let mut out = serde_json::to_string_pretty(valore).expect("l'indice è JSON");
    out.push('\n');
    out
}

/// Scrive il file con `UPDATE_MIRROR=1`, se no lo confronta.
fn scrivi_o_confronta(percorso: PathBuf, atteso: &str) -> Option<String> {
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(cartella) = percorso.parent() {
            std::fs::create_dir_all(cartella).expect("la cartella del file generato");
        }
        std::fs::write(&percorso, atteso).expect("scrive il file generato");
        return None;
    }
    match std::fs::read_to_string(&percorso) {
        Ok(scritto) if scritto == atteso => None,
        Ok(_) => Some(format!("{} è stantio", percorso.display())),
        Err(e) => Some(format!("{}: {e}", percorso.display())),
    }
}

fn voci() -> Vec<Voce> {
    indice().unwrap_or_else(|m| {
        panic!(
            "l'indice non si importa:\n{}",
            m.iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        )
    })
}

#[test]
fn l_indice_del_client_e_quello_della_mappa() {
    let voci = voci();
    let mut stantii = Vec::new();
    stantii.extend(scrivi_o_confronta(
        completo("indice.generated.json"),
        &testo(&indice_json(&voci)),
    ));
    for famiglia in DRAWING_FAMILIES {
        stantii.extend(scrivi_o_confronta(
            completo(&format!("famiglie/{famiglia}/schema.generated.json")),
            &testo(&schema_json(famiglia, &voci)),
        ));
    }
    assert!(
        stantii.is_empty(),
        "{}; rigenerali con `{RIGENERA}`",
        stantii.join("\n")
    );
}

/// Le voci di alcune righe della mappa, come se fossero fatte.
fn voci_finte() -> Vec<Voce> {
    let righe: Vec<_> = mappa()
        .iter()
        .filter(|r| {
            matches!(
                (r.fonte, r.id.as_str()),
                (FonteMappa::Motore, "edit.colors.invert")
                    | (FonteMappa::Motore, "edit.duplicate")
                    | (FonteMappa::Strumento, "rectangle")
                    | (FonteMappa::Effetto, "stylize.roundCorners")
            )
        })
        .collect();
    fub_disegno::catalogo::voci_di(&righe).expect("le righe si importano")
}

#[test]
fn un_indice_vecchio_si_vede() {
    let voci = voci_finte();
    assert_eq!(voci.len(), 4);
    let nuovo = testo(&indice_json(&voci));
    let vecchio = testo(&indice_json(&voci[1..]));
    assert_ne!(nuovo, vecchio, "una voce in meno cambia il file");
    let mut rovesciate = voci.clone();
    rovesciate.reverse();
    assert_eq!(
        nuovo,
        testo(&indice_json(&rovesciate)),
        "il file non dipende dall'ordine"
    );
    // La finestra di Round Corners… va negli schemi degli effetti, coi suoi
    // campi; le altre famiglie non la vedono.
    let effetti = schema_json("effetti", &voci);
    let finestre = effetti["finestre"].as_array().unwrap();
    assert_eq!(finestre.len(), 1, "{effetti}");
    assert_eq!(finestre[0]["id"], "stylize.roundCorners");
    assert_eq!(finestre[0]["campi"][0]["nome"], "radius");
    assert_eq!(schema_json("nucleo", &voci)["finestre"], json!([]));
    // La voce dice come si chiama.
    let indice = indice_json(&voci);
    let per_id = |id: &str| {
        indice["voci"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == id)
            .cloned()
            .unwrap()
    };
    assert_eq!(
        per_id("edit.duplicate")["chiamata"],
        json!({ "comando": "disegno.edit.duplicate" })
    );
    assert_eq!(
        per_id("stylize.roundCorners")["chiamata"],
        json!({ "comando": "disegno.effect.apply", "valore": { "effect": "stylize.roundCorners" } })
    );
    assert_eq!(
        per_id("rectangle")["chiamata"],
        json!({ "strumento": "rectangle" })
    );
    assert_eq!(per_id("rectangle")["effetto"], "cambia");
    assert_eq!(per_id("edit.colors.invert")["finestra"], false);
}

/// Le parole del gergo, lette da `apps/client/src/i18n/gergo.ts`.
fn gergo() -> Vec<Regex> {
    let file =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/i18n/gergo.ts");
    let sorgente = std::fs::read_to_string(&file).expect("gergo.ts");
    let voce = Regex::new(r"parola:\s*/((?:[^/\\]|\\.)+)/([a-z]*)").unwrap();
    let parole: Vec<Regex> = voce
        .captures_iter(&sorgente)
        .map(|c| {
            let bandiere = if c[2].contains('i') { "(?i)" } else { "" };
            Regex::new(&format!("{bandiere}{}", &c[1]))
                .unwrap_or_else(|e| panic!("la parola /{}/ di gergo.ts: {e}", &c[1]))
        })
        .collect();
    assert!(
        parole.len() >= 10,
        "gergo.ts si legge: {} parole",
        parole.len()
    );
    parole
}

/// Le etichette che arriverebbero a chi disegna, di ogni riga che Fub
/// offre (non esclusa), come le scrive l'indice.
fn etichette(g: &Glossario) -> Vec<(String, String, String)> {
    mappa()
        .iter()
        .filter(|r| r.stato != Stato::Escluso)
        .map(|r| {
            (
                format!("{} {}", r.fonte.nome(), r.id),
                g.applica(Lingua::It, &r.etichetta_it),
                g.applica(Lingua::En, &r.etichetta),
            )
        })
        .collect()
}

/// Le etichette col nome del motore o con una parola del gergo.
fn parole_sbagliate(etichette: &[(String, String, String)], gergo: &[Regex]) -> Vec<String> {
    let craft = Regex::new(r"(?i)craft").unwrap();
    let segnaposto = Regex::new(r"\{[^}]*\}").unwrap();
    let mut errori = Vec::new();
    for (riga, it, en) in etichette {
        for testo in [it, en] {
            if craft.is_match(testo) {
                errori.push(format!("{riga}: «{testo}» nomina il motore"));
            }
        }
        // Il gergo guarda i testi italiani, come `gergo.test.ts`.
        let letto = segnaposto.replace_all(it, " ");
        for parola in gergo {
            if parola.is_match(&letto) {
                errori.push(format!("{riga}: «{it}» ha la parola di gergo /{parola}/"));
            }
        }
    }
    errori
}

#[test]
fn nessuna_etichetta_nomina_il_motore_o_usa_il_gergo() {
    let gergo = gergo();
    let errori = parole_sbagliate(&etichette(glossario()), &gergo);
    assert!(errori.is_empty(), "{}", errori.join("\n"));
    // Senza il glossario, «VectorCraft» arriverebbe a chi disegna.
    let crudo = parole_sbagliate(&etichette(&Glossario::default()), &gergo);
    assert!(
        crudo.iter().any(|e| e.contains("nomina il motore")),
        "{crudo:?}"
    );
    // E una parola del gergo si vede.
    let finto = vec![("prova".into(), "Il buffer del disegno".into(), "x".into())];
    assert_eq!(parole_sbagliate(&finto, &gergo).len(), 1);
}

#[test]
fn le_etichette_senza_traduzione_restano_inglesi_e_si_elencano() {
    let senza: Vec<String> = mappa()
        .iter()
        .filter(|r| r.stato != Stato::Escluso && r.etichetta_it == r.etichetta)
        .map(|r| format!("{} {} «{}»", r.fonte.nome(), r.id, r.etichetta))
        .collect();
    // Le etichette che `it.tsv` del motore non traduce: l'indice le mostra
    // in inglese. Chi porta la riga le traduce in `it.tsv` (patch del motore)
    // o nel glossario.
    println!(
        "{} etichette senza traduzione:\n{}",
        senza.len(),
        senza.join("\n")
    );
    let voci = voci_finte();
    for v in &voci {
        assert!(!v.etichetta_it.is_empty() && !v.etichetta_en.is_empty());
    }
    // Il glossario si applica: la tavola resta tavola anche nell'indice.
    assert_eq!(
        glossario().applica(Lingua::It, "Nuova tavola da disegno"),
        "Nuova tavola"
    );
    assert_eq!(
        glossario().applica(Lingua::It, "Aggiungi nuova traccia"),
        "Aggiungi nuovo tratto"
    );
}
