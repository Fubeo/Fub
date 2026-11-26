//! Le parole di un testo in area vanno e tornano senza perdere un carattere
//! (K6 T16, `docs/reference/scene-format-text.md`, §4): le parole che si
//! danno a `text.editRange` sono, dopo che il file le ha scritte e riaperto,
//! le stesse parole, carattere per carattere, e nessuno spazio si perde o si
//! raddoppia fra una riga e l'altra. Gli a capo li rifà il motore nel
//! riquadro, con Inter: una parola più larga del riquadro, due spazi di
//! fila, una riga che finisce proprio sul bordo, gli a capo scritti (righe
//! vuote comprese), e il giro dopo il giro. Il testo di punto non cambia.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use fub_disegno::motore::{Disegni, Disegno};
use serde_json::json;

/// I disegni con Inter e tutte le famiglie accese.
fn disegni() -> Arc<Disegni> {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    disegni
}

/// Il testo in area del banco: un riquadro largo `larghezza` a corpo 20.
fn area(larghezza: &str) -> String {
    include_str!("famiglie/testo/area.svg")
        .replace("fub:wrap=\"200\"", &format!("fub:wrap=\"{larghezza}\""))
}

const AREA: &str = "oz1z1z1z1";

/// Il comando `id` con `valore` su `svg`, aperto da capo come lo riapre
/// l'editor: il file dopo, applicate le operazioni. `None` se non scrive.
fn comando(
    disegni: &Arc<Disegni>,
    svg: &str,
    id: &str,
    scelti: &[&str],
    valore: serde_json::Value,
) -> Option<String> {
    let (mut disegno, _) = Disegno::apri_con(disegni, svg).expect("si apre");
    let esito = disegno
        .comando(fub_abi::DrawingCommandRequest {
            revision: disegno.revisione(),
            id: format!("disegno.{id}"),
            selection: scelti.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("senza errore");
    assert_eq!(esito.refused, None, "{id}: {esito:?}");
    let ops = esito.ops?;
    let ops: serde_json::Value = serde_json::from_str(&ops).expect("json");
    Some(common::applica::applica(svg, &ops).expect("le operazioni si applicano"))
}

/// Le operazioni del comando `id` con `valore` su `svg`; `null` se non scrive.
fn ops(
    disegni: &Arc<Disegni>,
    svg: &str,
    id: &str,
    scelti: &[&str],
    valore: serde_json::Value,
) -> serde_json::Value {
    let (mut disegno, _) = Disegno::apri_con(disegni, svg).expect("si apre");
    let esito = disegno
        .comando(fub_abi::DrawingCommandRequest {
            revision: disegno.revisione(),
            id: format!("disegno.{id}"),
            selection: scelti.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("senza errore");
    esito.ops.map_or(serde_json::Value::Null, |o| {
        serde_json::from_str(&o).expect("json")
    })
}

/// Le parole nuove `parole` per il testo `id` di `svg`, come le manda il
/// campo «Testo» (`text.editRange`).
fn scrivi(disegni: &Arc<Disegni>, svg: &str, id: &str, parole: &str) -> String {
    comando(
        disegni,
        svg,
        "text.editRange",
        &[id],
        json!({"element": id, "text": parole}),
    )
    .unwrap_or_else(|| svg.to_string())
}

/// Il `<text>` di `id` in `svg`.
fn il_testo<'a>(svg: &'a str, id: &str) -> &'a str {
    let da = svg
        .find(&format!("<text id=\"{id}\""))
        .expect("il testo c'è");
    let a = svg[da..].find("</text>").expect("il testo si chiude") + da;
    &svg[da..a]
}

/// Le righe del testo `id`: il testo di ogni `<tspan>` e il suo `fub:join`.
fn righe(svg: &str, id: &str) -> Vec<(String, Option<String>)> {
    let testo = il_testo(svg, id);
    let mut fuori = Vec::new();
    let mut da = 0;
    while let Some(i) = testo[da..].find("<tspan") {
        let inizio = da + i;
        let chiude = testo[inizio..].find('>').expect("il tspan si apre") + inizio;
        let attributi = &testo[inizio..chiude];
        let vuoto = attributi.ends_with('/');
        let fine = if vuoto {
            chiude + 1
        } else {
            testo[chiude..]
                .find("</tspan>")
                .expect("il tspan si chiude")
                + chiude
        };
        let unione = attributi.find("fub:join=\"").map(|j| {
            attributi[j + 10..]
                .split('"')
                .next()
                .unwrap_or("")
                .to_string()
        });
        let parole = testo[(chiude + 1).min(fine)..fine]
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&");
        fuori.push((parole, unione));
        da = fine;
    }
    fuori
}

/// Le parole che legge chi apre il file: le righe di un paragrafo riunite
/// (`space` uno spazio, `word` niente), i paragrafi con `\n`; un paragrafo
/// scritto come uno spazio indivisibile è una riga vuota.
fn parole(svg: &str, id: &str) -> String {
    let righe = righe(svg, id);
    let mut fuori = String::new();
    for (i, (riga, unione)) in righe.iter().enumerate() {
        if i > 0 {
            fuori.push_str(match unione.as_deref() {
                Some("space") => " ",
                Some("word") => "",
                _ => "\n",
            });
        }
        let sola = unione.is_none() && righe.get(i + 1).is_none_or(|(_, u)| u.is_none());
        fuori.push_str(if sola && riga == "\u{a0}" { "" } else { riga });
    }
    fuori
}

/// Scrive `testo` nel testo in area di `svg`, riapre, lo cambia e lo
/// rimette: ogni volta il file ridà le parole scritte, e rimesse le stesse
/// parole il file torna quello del primo giro (nessuna deriva).
fn va_e_torna(disegni: &Arc<Disegni>, svg: &str, testo: &str) -> String {
    let primo = scrivi(disegni, svg, AREA, testo);
    assert!(il_testo(&primo, AREA).contains("fub:wrap=\""), "{primo}");
    assert_eq!(parole(&primo, AREA), testo, "{}", il_testo(&primo, AREA));
    let altro = format!("{testo}!");
    let secondo = scrivi(disegni, &primo, AREA, &altro);
    assert_eq!(
        parole(&secondo, AREA),
        altro,
        "{}",
        il_testo(&secondo, AREA)
    );
    let terzo = scrivi(disegni, &secondo, AREA, testo);
    assert_eq!(parole(&terzo, AREA), testo, "{}", il_testo(&terzo, AREA));
    assert_eq!(terzo, primo, "le stesse parole, lo stesso file");
    // Un cambio che non tocca le parole (l'interlinea) le lascia come sono.
    let alto = comando(
        disegni,
        &primo,
        "text.setRangeStyle",
        &[AREA],
        json!({"leading": 30}),
    )
    .expect("l'interlinea si scrive");
    assert_eq!(parole(&alto, AREA), testo, "{}", il_testo(&alto, AREA));
    primo
}

#[test]
fn una_parola_piu_larga_del_riquadro_si_spezza_e_torna_intera() {
    let disegni = disegni();
    let testo = "Le onde precipitevolissimevolmentissimamente tornano a riva";
    let file = va_e_torna(&disegni, &area("200"), testo);
    let righe = righe(&file, AREA);
    assert!(
        righe.iter().any(|(_, u)| u.as_deref() == Some("word")),
        "{righe:?}"
    );
    // La parola spezzata: nessuno spazio dove la riga va a capo.
    assert!(righe.iter().all(|(r, _)| !r.starts_with(' ')), "{righe:?}");
}

#[test]
fn due_spazi_di_fila_restano_due() {
    let disegni = disegni();
    for testo in [
        "Le onde  del mare tornano  a riva sotto la luna",
        "Le  onde  del  mare  tornano  a  riva  sotto  la  luna",
        "Tre spazi   in mezzo, e uno in fondo ",
    ] {
        va_e_torna(&disegni, &area("200"), testo);
    }
    // Gli spazi dove la riga va a capo: uno solo non si scrive, gli altri sì.
    let file = scrivi(
        &disegni,
        &area("200"),
        AREA,
        "Le onde  del mare tornano  a riva sotto la luna",
    );
    let righe = righe(&file, AREA);
    let spazi: usize = righe.iter().map(|(r, _)| r.matches(' ').count()).sum();
    let unioni = righe
        .iter()
        .filter(|(_, u)| u.as_deref() == Some("space"))
        .count();
    assert_eq!(spazi + unioni, 11, "{righe:?}");
}

#[test]
fn a_ogni_larghezza_le_parole_tornano_le_stesse() {
    let disegni = disegni();
    let testo = "Le onde  del mare\n\ntornano a riva: precipitevolissimevolmente, ogni sera.";
    let mut righe_viste = std::collections::BTreeSet::new();
    let mut larghezza = 30.0;
    while larghezza < 520.0 {
        let file = va_e_torna(&disegni, &area(&format!("{larghezza}")), testo);
        righe_viste.insert(righe(&file, AREA).len());
        larghezza += 23.5;
    }
    // Le larghezze provate vanno a capo in modi diversi.
    assert!(righe_viste.len() >= 5, "{righe_viste:?}");
}

#[test]
fn una_riga_che_finisce_proprio_sul_bordo() {
    let disegni = disegni();
    let testo = "Le onde del mare tornano a riva ogni sera";
    // Le larghezze in centesimi, come il file le scrive.
    let largo = |centesimi: u32| area(&format!("{}.{:02}", centesimi / 100, centesimi % 100));
    let quante =
        |centesimi: u32| righe(&scrivi(&disegni, &largo(centesimi), AREA, testo), AREA).len();
    // La larghezza dove una parola smette di starci: un centesimo sopra la
    // riga ci sta fino al bordo, un centesimo sotto va a capo.
    let (mut sotto, mut sopra) = (6_000, 40_000);
    let (n_sotto, n_sopra) = (quante(sotto), quante(sopra));
    assert!(n_sotto > n_sopra, "{n_sotto} {n_sopra}");
    while sopra - sotto > 1 {
        let mezzo = (sotto + sopra) / 2;
        if quante(mezzo) == n_sopra {
            sopra = mezzo;
        } else {
            sotto = mezzo;
        }
    }
    let fino_al_bordo = va_e_torna(&disegni, &largo(sopra), testo);
    let appena_meno = va_e_torna(&disegni, &largo(sotto), testo);
    assert!(
        righe(&appena_meno, AREA).len() > righe(&fino_al_bordo, AREA).len(),
        "{fino_al_bordo}\n{appena_meno}"
    );
    // Sul bordo nessuna riga comincia o finisce con lo spazio dell'a capo.
    for file in [&fino_al_bordo, &appena_meno] {
        for (riga, _) in righe(file, AREA) {
            assert!(!riga.starts_with(' ') && !riga.ends_with(' '), "{file}");
        }
    }
}

#[test]
fn gli_a_capo_scritti_restano_paragrafi_anche_vuoti() {
    let disegni = disegni();
    for testo in [
        "Uno\nDue tre quattro cinque sei sette otto nove",
        "Uno\n\nDue tre quattro cinque sei sette otto nove",
        "Uno\n\n\nDue",
        "\nIn testa una riga vuota",
        "In fondo una riga vuota\n",
    ] {
        va_e_torna(&disegni, &area("200"), testo);
    }
    // La riga vuota è uno spazio indivisibile, come la scrive l'editor: un
    // `tspan` vuoto non sposterebbe la riga dopo.
    let file = scrivi(&disegni, &area("200"), AREA, "Uno\n\nDue");
    assert_eq!(
        righe(&file, AREA),
        [
            ("Uno".to_string(), None),
            ("\u{a0}".to_string(), None),
            ("Due".to_string(), None)
        ]
    );
}

#[test]
fn il_testo_di_punto_non_cambia() {
    let disegni = disegni();
    let base = include_str!("famiglie/testo/base.svg");
    let punto = "ot1t1t1t1";
    // Le parole di un testo di punto vanno col `text` di sempre: le righe
    // come il campo le scrive, nessun `fub:wrap` e nessun `fub:join`.
    let fatte = ops(
        &disegni,
        base,
        "text.editRange",
        &[punto],
        json!({"element": punto, "text": "Pioggia\nsul mare!"}),
    );
    assert_eq!(
        fatte,
        json!([{"op": "text", "id": punto, "lines": ["Pioggia", "sul mare!"]}])
    );
    // Lo spazio in fondo a una riga di un testo di punto non si scrive, come
    // nel campo: SVG non lo mostra. Le righe restano quelle del file.
    let fatte = ops(
        &disegni,
        base,
        "text.editRange",
        &[punto],
        json!({"element": punto, "text": "Pioggia \nsul mare"}),
    );
    assert_eq!(
        fatte,
        json!([{"op": "text", "id": punto, "lines": ["Pioggia", "sul mare"]}])
    );
}

#[test]
fn convertito_in_area_un_testo_di_punto_non_prende_spazi() {
    let disegni = disegni();
    let base = include_str!("famiglie/testo/base.svg");
    let punto = "ot1t1t1t1";
    // Le righe del file sono a capo fra i `tspan`: quegli spazi non sono
    // testo (formato, §1), e il testo in area non li prende.
    let area = comando(
        &disegni,
        base,
        "type.convertToAreaType",
        &[punto],
        json!({}),
    )
    .expect("si converte");
    assert_eq!(
        parole(&area, punto),
        "Pioggia\nsul mare",
        "{}",
        il_testo(&area, punto)
    );
    // E tornato di punto, le righe di prima.
    let di_nuovo = comando(
        &disegni,
        &area,
        "type.convertToPointType",
        &[punto],
        json!({}),
    )
    .expect("si converte");
    assert_eq!(righe(&di_nuovo, punto), righe(base, punto));
    // Uno spazio che la riga del file scrive davvero resta, uno solo.
    let con_spazio = base.replace(">Pioggia</tspan>", ">Pioggia </tspan>");
    let area = comando(
        &disegni,
        &con_spazio,
        "type.convertToAreaType",
        &[punto],
        json!({}),
    )
    .expect("si converte");
    assert_eq!(
        parole(&area, punto),
        "Pioggia \nsul mare",
        "{}",
        il_testo(&area, punto)
    );
}
