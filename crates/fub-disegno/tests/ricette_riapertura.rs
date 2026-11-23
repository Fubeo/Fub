//! Le ricette alla riapertura (K6, giro «le ricette alla riapertura»): un comando su un oggetto con la
//! ricetta scrive un file che si riapre con la ricetta, senza perdite.
//!
//! Tre strade: nascondere, mostrare, bloccare e sbloccare (lo stato non conta nell'impronta); un corpo
//! riscritto che non disegna niente, anche sotto una maschera di opacità (la ricetta rimette l'oggetto
//! che l'import non porta); un riempimento a sfumatura privata agganciato ai campioni (il corpo
//! riscritto con la sua sfumatura). Le operazioni si applicano al testo come nel client
//! (`common::applica`); Annulla e Ripeti byte per byte li prova `casi.test.ts` sugli stessi casi delle
//! famiglie (`aspetto.json`, `colore.json`).

#![cfg(feature = "completo")]

mod common;

use fub_abi::{DrawingCommandRequest, DrawingOpen};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

/// Un oggetto con due riempimenti: un aspetto impilato, quindi una ricetta.
const DUE: &str = include_str!("famiglie/aspetto/due-riempimenti.svg");
/// Lo stesso oggetto dentro un gruppo.
const GRUPPO: &str = include_str!("famiglie/aspetto/due-riempimenti-gruppo.svg");
/// Lo stesso oggetto nascosto col suo `display`, l'impronta di prima.
const NASCOSTO: &str = include_str!("famiglie/aspetto/due-riempimenti-nascosto.svg");
/// Un oggetto con la ricetta e una maschera di opacità.
const MASCHERA: &str = include_str!("famiglie/aspetto/maschera-dopo.svg");
/// I campioni dei colori, con `ox4x4x4x4` riempito da una sfumatura privata.
const CAMPIONI: &str = include_str!("famiglie/colore/campioni-scenari.svg");

const OGGETTO: &str = "oa1a1a1a1";

fn apri(testo: &str) -> (Disegno, DrawingOpen) {
    let disegni = common::disegni();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    Disegno::apri_con(&disegni, testo).expect("il disegno si apre")
}

/// Apre `testo`, dà il comando e ne applica le operazioni: il file che Fub scrive. `None` se il
/// comando è rifiutato, col perché.
fn dopo(testo: &str, id: &str, selezione: &[&str], valore: Value) -> Result<String, String> {
    let (mut disegno, aperto) = apri(testo);
    let esito = disegno
        .comando(DrawingCommandRequest {
            revision: aperto.revision,
            id: format!("disegno.{id}"),
            selection: selezione.iter().map(|s| s.to_string()).collect(),
            value: valore,
            preview: false,
        })
        .expect("il comando risponde");
    if let Some(r) = esito.refused {
        return Err(format!("{r:?}"));
    }
    let ops: Value =
        serde_json::from_str(esito.ops.as_deref().expect("le operazioni")).expect("JSON");
    Ok(common::applica::applica(testo, &ops).expect("le operazioni si applicano al testo"))
}

fn fatto(testo: &str, id: &str, selezione: &[&str]) -> String {
    dopo(testo, id, selezione, json!({})).unwrap_or_else(|r| panic!("{id} rifiutato: {r}"))
}

/// Il file si riapre senza perdite: ogni ricetta vale (una che non vale lascia un avviso).
fn senza_perdite(testo: &str) {
    let (_, aperto) = apri(testo);
    assert!(
        aperto.losses.is_empty(),
        "perdite alla riapertura: {:?}\n{testo}",
        aperto.losses
    );
}

/// Il file si riapre senza perdite oltre a quelle del file di partenza `prima` (le risorse dei
/// campioni, che non sono oggetti del disegno, ci sono già).
fn senza_perdite_nuove(prima: &str, testo: &str) {
    let chiave = |a: &DrawingOpen| -> Vec<String> {
        a.losses
            .iter()
            .map(|l| format!("{} {}", l.element, l.detail))
            .collect()
    };
    let gia = chiave(&apri(prima).1);
    let nuove: Vec<String> = chiave(&apri(testo).1)
        .into_iter()
        .filter(|l| !gia.contains(l))
        .collect();
    assert!(
        nuove.is_empty(),
        "perdite nuove alla riapertura: {nuove:?}\n{testo}"
    );
}

/// Le ricette del file, come stanno nel `<metadata>`.
fn ricette(testo: &str) -> Vec<&str> {
    testo
        .match_indices("<vectorcraft:recipe ")
        .map(|(i, _)| {
            let fine = testo[i..]
                .find("</vectorcraft:recipe>")
                .map_or(testo.len(), |f| i + f);
            &testo[i..fine]
        })
        .collect()
}

/// L'oggetto riaperto è quello della ricetta: Riduci, che sa ridurre solo un aspetto impilato,
/// toglie un riempimento.
fn ha_due_riempimenti(testo: &str) {
    let ridotto = fatto(testo, "appearance.reduceToBasic", &[OGGETTO]);
    assert!(
        ridotto.matches("<rect ").count() < testo.matches("<rect ").count(),
        "{ridotto}"
    );
}

/// La lettura delle maschere di `testo` riaperto sull'oggetto: una, agganciata.
fn una_maschera(testo: &str) {
    let (mut disegno, aperto) = apri(testo);
    let esito = disegno
        .comando(DrawingCommandRequest {
            revision: aperto.revision,
            id: "disegno.transparency.opacityMaskInfo".into(),
            selection: vec![OGGETTO.into()],
            value: json!({}),
            preview: false,
        })
        .expect("la lettura");
    let letta = esito.reading.expect("la lettura della maschera c'è");
    assert_eq!(
        letta.as_array().map(Vec::len),
        Some(1),
        "una maschera sola: {letta}"
    );
}

// --- 1. nascondere, mostrare, bloccare, sbloccare -------------------------------------------------

#[test]
fn nascosto_si_riapre_con_la_ricetta_e_nascosto() {
    let nascosto = fatto(DUE, "object.hide", &[OGGETTO]);
    assert!(nascosto.contains("display=\"none\""), "{nascosto}");
    assert_eq!(ricette(&nascosto), ricette(DUE), "la ricetta resta com'era");
    senza_perdite(&nascosto);
    // Riaperto è nascosto: Mostra tutto lo mostra, e il file torna quello di partenza.
    assert_eq!(fatto(&nascosto, "object.showAll", &[]), DUE);
}

#[test]
fn il_file_nascosto_di_prima_si_riapre_con_la_ricetta() {
    senza_perdite(NASCOSTO);
    let mostrato = fatto(NASCOSTO, "object.showAll", &[]);
    assert!(!mostrato.contains("display="), "{mostrato}");
    senza_perdite(&mostrato);
    ha_due_riempimenti(&mostrato);
}

#[test]
fn bloccato_si_riapre_con_la_ricetta_e_sbloccato_torna_al_file_di_partenza() {
    let bloccato = fatto(DUE, "object.lock", &[OGGETTO]);
    assert!(bloccato.contains("fub:locked=\"true\""), "{bloccato}");
    assert_eq!(ricette(&bloccato), ricette(DUE));
    senza_perdite(&bloccato);
    // Riaperto è bloccato: Riduci lo rifiuta.
    assert_eq!(
        dopo(&bloccato, "appearance.reduceToBasic", &[OGGETTO], json!({}))
            .err()
            .as_deref(),
        Some("Locked")
    );
    let sbloccato = fatto(&bloccato, "object.unlockAll", &[]);
    assert_eq!(sbloccato, DUE);
    ha_due_riempimenti(&sbloccato);
}

#[test]
fn nascondere_e_bloccare_due_volte_di_fila_torna_al_file_di_partenza() {
    let mut testo = DUE.to_string();
    for _ in 0..2 {
        testo = fatto(&testo, "object.hide", &[OGGETTO]);
        senza_perdite(&testo);
        testo = fatto(&testo, "object.lock", &[OGGETTO]);
        senza_perdite(&testo);
        testo = fatto(&testo, "object.unlockAll", &[]);
        senza_perdite(&testo);
        testo = fatto(&testo, "object.showAll", &[]);
        senza_perdite(&testo);
        assert_eq!(testo, DUE);
    }
}

#[test]
fn dentro_un_gruppo_nascondere_e_bloccare_tengono_la_ricetta() {
    let nascosto = fatto(GRUPPO, "object.hide", &[OGGETTO]);
    senza_perdite(&nascosto);
    let bloccato = fatto(&nascosto, "object.lock", &[OGGETTO]);
    senza_perdite(&bloccato);
    let sbloccato = fatto(&bloccato, "object.unlockAll", &[]);
    assert_eq!(fatto(&sbloccato, "object.showAll", &[]), GRUPPO);
}

#[test]
fn riscritto_da_nascosto_resta_nascosto_con_la_ricetta() {
    let comandi = [
        ("paint.setFill", json!({ "color": "#00aa00" })),
        ("transparency.set", json!({ "opacity": 50 })),
        ("stroke.set", json!({ "weight": 6 })),
        ("appearance.addFill", json!({})),
    ];
    let mut riscritti = Vec::new();
    for (comando, valore) in comandi {
        let Ok(testo) = dopo(NASCOSTO, comando, &[OGGETTO], valore) else {
            continue;
        };
        senza_perdite(&testo);
        let tag = testo
            .match_indices('<')
            .map(|(i, _)| &testo[i..i + testo[i..].find('>').unwrap_or(0)])
            .find(|t| t.contains("id=\"oa1a1a1a1\""))
            .expect("l'oggetto c'è");
        assert!(tag.contains("display=\"none\""), "{comando}: {tag}");
        assert_eq!(testo.matches("display=").count(), 1, "{comando}: {testo}");
        assert_ne!(
            ricette(&testo),
            ricette(NASCOSTO),
            "{comando}: la ricetta è nuova"
        );
        // Mostrato, la ricetta resta.
        let mostrato = fatto(&testo, "object.showAll", &[]);
        assert!(!mostrato.contains("display="), "{mostrato}");
        assert_eq!(ricette(&mostrato), ricette(&testo));
        senza_perdite(&mostrato);
        riscritti.push(comando);
    }
    assert!(
        !riscritti.is_empty(),
        "almeno un comando riscrive l'oggetto nascosto"
    );
}

// --- 2. un corpo riscritto che non disegna niente, anche sotto una maschera -------------------------

#[test]
fn la_ricetta_svuotata_si_riapre_due_volte_di_fila() {
    for comando in ["appearance.clear", "paint.none"] {
        let svuotato = fatto(DUE, comando, &[OGGETTO]);
        senza_perdite(&svuotato);
        // Riaperto è l'oggetto della ricetta, già vuoto: lo stesso comando non ha niente da fare.
        assert_eq!(
            dopo(&svuotato, comando, &[OGGETTO], json!({}))
                .err()
                .as_deref(),
            Some("Empty")
        );
        // Un riempimento nuovo sull'oggetto vuoto riapre ancora.
        let riempito = fatto(&svuotato, "appearance.addFill", &[OGGETTO]);
        senza_perdite(&riempito);
    }
}

#[test]
fn la_ricetta_svuotata_dentro_un_gruppo_si_riapre() {
    let svuotato = fatto(GRUPPO, "appearance.clear", &[OGGETTO]);
    senza_perdite(&svuotato);
    assert!(
        svuotato.contains("<g id=\"o8hhrn30a\"><rect id=\"oa1a1a1a1\""),
        "{svuotato}"
    );
    // Riaperto, l'oggetto vuoto sta al suo posto nel gruppo: un colore nuovo lo riscrive lì, con lo
    // stesso id, e il gruppo resta com'è.
    let colorato = dopo(
        &svuotato,
        "paint.setFill",
        &[OGGETTO],
        json!({ "color": "#00aa00" }),
    )
    .expect("il colore si mette");
    senza_perdite(&colorato);
    assert!(
        colorato.contains(
            "<g id=\"o8hhrn30a\"><rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#00aa00\"/><ellipse id=\"oe1e1e1e1\""
        ),
        "{colorato}"
    );
    // Un riempimento in più fa la ricetta dell'oggetto, non quella del gruppo che lo contiene.
    let riempito = fatto(&svuotato, "appearance.addFill", &[OGGETTO]);
    senza_perdite(&riempito);
    assert!(riempito.contains("for=\"oa1a1a1a1\""), "{riempito}");
    assert!(!riempito.contains("for=\"o8hhrn30a\""), "{riempito}");
    assert!(riempito.contains("<ellipse id=\"oe1e1e1e1\""), "{riempito}");
}

#[test]
fn ogni_comando_che_riscrive_la_maschera_la_riapre_due_volte() {
    let comandi = [
        ("appearance.clear", json!({})),
        ("paint.none", json!({})),
        ("transparency.set", json!({ "opacity": 50 })),
        ("stroke.set", json!({ "weight": 6 })),
        ("appearance.addFill", json!({})),
        ("appearance.addStroke", json!({})),
        ("paint.setFill", json!({ "color": "#00aa00" })),
        ("paint.swap", json!({})),
        ("edit.colors.invert", json!({})),
    ];
    for (comando, valore) in comandi {
        let mut testo = MASCHERA.to_string();
        for giro in 0..2 {
            match dopo(&testo, comando, &[OGGETTO], valore.clone()) {
                Ok(t) => testo = t,
                // La seconda volta può non avere niente da fare: l'oggetto riaperto è già così.
                Err(r) if giro == 1 && r == "Empty" => continue,
                Err(r) => panic!("{comando} (giro {giro}) rifiutato: {r}"),
            }
            senza_perdite(&testo);
            una_maschera(&testo);
        }
    }
}

#[test]
fn riduci_si_fa_sulla_maschera_e_la_riapre() {
    let due = fatto(MASCHERA, "appearance.addFill", &[OGGETTO]);
    senza_perdite(&due);
    let ridotto = fatto(&due, "appearance.reduceToBasic", &[OGGETTO]);
    senza_perdite(&ridotto);
    una_maschera(&ridotto);
    // Ridotto, non ha più niente da ridurre.
    assert_eq!(
        dopo(&ridotto, "appearance.reduceToBasic", &[OGGETTO], json!({}))
            .err()
            .as_deref(),
        Some("Empty")
    );
}

// --- 3. una sfumatura privata agganciata ai campioni ----------------------------------------------

#[test]
fn il_campione_piu_vicino_su_una_sfumatura_privata_si_riapre_due_volte() {
    let agganciato = fatto(CAMPIONI, "addon.color.applyNearestSwatch", &["ox4x4x4x4"]);
    assert!(
        agganciato.contains("<g id=\"ox4x4x4x4\">"),
        "lo stesso id: {agganciato}"
    );
    senza_perdite_nuove(CAMPIONI, &agganciato);
    // La seconda volta i colori sono già quelli dei campioni.
    match dopo(
        &agganciato,
        "addon.color.applyNearestSwatch",
        &["ox4x4x4x4"],
        json!({}),
    ) {
        Ok(ancora) => senza_perdite_nuove(CAMPIONI, &ancora),
        Err(r) => assert_eq!(r, "Empty"),
    }
}

// --- 4. un gruppo con dentro un oggetto con la ricetta -----------------------------------------------

/// Aggiungi riempimento sugli oggetti del gruppo: il gruppo resta lo stesso elemento, senza una
/// ricetta sua, e ogni oggetto si riscrive per sé con la sua; due volte di fila, senza perdite.
#[test]
fn aggiungere_un_riempimento_agli_oggetti_del_gruppo_lascia_il_gruppo() {
    let mut testo = GRUPPO.to_string();
    for _ in 0..2 {
        testo = dopo(
            &testo,
            "appearance.addFill",
            &["o8hhrn30a"],
            json!({ "target": "contents" }),
        )
        .unwrap_or_else(|r| panic!("rifiutato: {r}"));
        senza_perdite(&testo);
        assert!(testo.contains("<g id=\"o8hhrn30a\">"), "{testo}");
        assert!(
            !ricette(&testo)
                .iter()
                .any(|r| r.contains("for=\"o8hhrn30a\"")),
            "il gruppo non ha una ricetta sua: {testo}"
        );
        assert_eq!(ricette(&testo).len(), 2, "una ricetta per oggetto: {testo}");
    }
}

/// Aggiungi riempimento sul gruppo intero: il riempimento è del gruppo, che si riscrive con la sua
/// ricetta, e si riapre senza perdite.
#[test]
fn aggiungere_un_riempimento_al_gruppo_lo_riscrive_con_la_sua_ricetta() {
    let riempito = fatto(GRUPPO, "appearance.addFill", &["o8hhrn30a"]);
    senza_perdite(&riempito);
    assert!(
        ricette(&riempito)
            .iter()
            .any(|r| r.contains("for=\"o8hhrn30a\"")),
        "{riempito}"
    );
}

// --- 5. le voci della pila (K6 T15, voci d'aspetto) -----------------------------------------------

/// Un oggetto con un riempimento rosso sotto uno blu: la pila a due colori, con la sua ricetta.
const COLORI: &str = include_str!("famiglie/aspetto/due-riempimenti-colori.svg");

/// I riempimenti del corpo di `OGGETTO`, nell'ordine in cui il file li scrive (dal primo, sotto, all'ultimo).
/// Gli id dei pezzi cambiano a ogni scrittura: il loro ordine e i loro colori sono quello che conta.
fn riempimenti_del_corpo(testo: &str) -> Vec<String> {
    let apre = format!("<g id=\"{OGGETTO}\">");
    if let Some(inizio) = testo.find(&apre) {
        // Più riempimenti: il corpo è un gruppo con un pezzo per riempimento.
        let corpo = &testo[inizio..];
        let corpo = &corpo[..corpo.find("</g>").expect("la fine del corpo")];
        return corpo
            .match_indices("fill=\"")
            .map(|(i, _)| {
                corpo[i + 6..]
                    .split('"')
                    .next()
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();
    }
    // Un riempimento solo: il corpo è l'elemento stesso, col suo `fill`.
    let inizio = testo
        .find(&format!("id=\"{OGGETTO}\""))
        .expect("il corpo dell'oggetto");
    let etichetta = &testo[inizio..];
    let etichetta = &etichetta[..etichetta.find('>').expect("la fine dell'elemento")];
    etichetta
        .split("fill=\"")
        .nth(1)
        .and_then(|r| r.split('"').next())
        .map(|colore| vec![colore.to_string()])
        .unwrap_or_default()
}

/// Togliere una voce della pila: il file che resta si riapre senza perdite, con la voce che è rimasta.
/// Togliere l'ultima voce di una forma non si fa, anche due volte di fila.
#[test]
fn togliere_una_voce_si_riapre_senza_perdite() {
    // Togliere il rosso (voce 0) lascia il blu. La ricetta resta, come dopo Riduci: il file si riapre
    // senza perdite con il solo blu.
    let blu = dopo(
        COLORI,
        "appearance.removeItem",
        &[OGGETTO],
        json!({"index": 0}),
    )
    .expect("togliere il rosso");
    senza_perdite(&blu);
    assert_eq!(ricette(&blu).len(), 1, "{blu}");
    assert_eq!(riempimenti_del_corpo(&blu), ["#0000ff"], "{blu}");
    // Togliere l'ultimo riempimento lascerebbe la forma senza colore: si rifiuta, anche la seconda volta.
    for _ in 0..2 {
        assert_eq!(
            dopo(
                &blu,
                "appearance.removeItem",
                &[OGGETTO],
                json!({"index": 0})
            )
            .err()
            .as_deref(),
            Some("Unsupported")
        );
    }
}

/// Un oggetto con un riempimento e un contorno: togliere il riempimento lascia il contorno, che si riapre
/// senza perdite; togliere anche il contorno lascerebbe la forma senza nulla, e si rifiuta.
const RIEMPIMENTO_E_CONTORNO: &str = include_str!("famiglie/aspetto/contorno.svg");

/// Gli attributi dell'elemento `OGGETTO` nel file (la sua marca, dal suo id alla chiusura).
fn marca_di_oggetto(testo: &str) -> &str {
    let inizio = testo.find(&format!("id=\"{OGGETTO}\"")).expect("l'oggetto");
    let resto = &testo[inizio..];
    &resto[..resto.find('>').expect("la fine della marca")]
}

#[test]
fn togliere_il_riempimento_lascia_il_contorno_che_si_riapre() {
    let contorno = dopo(
        RIEMPIMENTO_E_CONTORNO,
        "appearance.removeItem",
        &[OGGETTO],
        json!({"index": 0}),
    )
    .expect("togliere il riempimento");
    senza_perdite(&contorno);
    let marca = marca_di_oggetto(&contorno);
    assert!(marca.contains("fill=\"none\""), "{marca}");
    assert!(marca.contains("stroke=\"#000000\""), "{marca}");
    assert_eq!(
        dopo(
            &contorno,
            "appearance.removeItem",
            &[OGGETTO],
            json!({"index": 0})
        )
        .err()
        .as_deref(),
        Some("Unsupported")
    );
    // Togliere il contorno invece lascia il riempimento, e si riapre anche quello.
    let riempito = dopo(
        RIEMPIMENTO_E_CONTORNO,
        "appearance.removeItem",
        &[OGGETTO],
        json!({"index": 1}),
    )
    .expect("togliere il contorno");
    senza_perdite(&riempito);
    let marca = marca_di_oggetto(&riempito);
    assert!(marca.contains("fill=\"#ff0000\""), "{marca}");
    assert!(marca.contains("stroke=\"none\""), "{marca}");
}

/// Duplicare una voce: la copia nasce sopra la sua voce, il file con le tre voci si riapre senza perdite
/// con la ricetta della pila, e togliere la copia riporta il file di prima, byte per byte.
#[test]
fn duplicare_una_voce_si_riapre_senza_perdite() {
    let tre = dopo(
        COLORI,
        "appearance.duplicateItem",
        &[OGGETTO],
        json!({"index": 0}),
    )
    .expect("duplicare il rosso");
    senza_perdite(&tre);
    assert_eq!(ricette(&tre).len(), 1, "{tre}");
    assert_eq!(
        riempimenti_del_corpo(&tre),
        ["#ff0000", "#ff0000", "#0000ff"],
        "{tre}"
    );
    // La copia è la voce 1, sopra il rosso originale: togliendola torna la pila di prima.
    let torna = dopo(
        &tre,
        "appearance.removeItem",
        &[OGGETTO],
        json!({"index": 1}),
    )
    .expect("togliere la copia");
    senza_perdite(&torna);
    assert_eq!(
        riempimenti_del_corpo(&torna),
        ["#ff0000", "#0000ff"],
        "{torna}"
    );
    // Il secondo duplicato di fila rifà la cosa giusta: quattro voci, niente errore.
    let quattro = dopo(
        &tre,
        "appearance.duplicateItem",
        &[OGGETTO],
        json!({"index": 0}),
    )
    .expect("duplicare di nuovo");
    senza_perdite(&quattro);
    assert_eq!(
        riempimenti_del_corpo(&quattro),
        ["#ff0000", "#ff0000", "#ff0000", "#0000ff"],
        "{quattro}"
    );
}

/// Spostare una voce: il file con le voci scambiate si riapre senza perdite, e spostarla di nuovo riporta
/// il file di prima, byte per byte. Spostarla dove sta già non cambia niente e non fa un passo.
#[test]
fn spostare_una_voce_si_riapre_senza_perdite() {
    let scambiato = dopo(
        COLORI,
        "appearance.moveItem",
        &[OGGETTO],
        json!({"from": 0, "to": 1}),
    )
    .expect("spostare il rosso sopra il blu");
    senza_perdite(&scambiato);
    assert_eq!(
        riempimenti_del_corpo(&scambiato),
        ["#0000ff", "#ff0000"],
        "{scambiato}"
    );
    let torna = dopo(
        &scambiato,
        "appearance.moveItem",
        &[OGGETTO],
        json!({"from": 1, "to": 0}),
    )
    .expect("spostare di nuovo");
    senza_perdite(&torna);
    assert_eq!(
        riempimenti_del_corpo(&torna),
        ["#ff0000", "#0000ff"],
        "{torna}"
    );
    // Il blu è già in cima: spostarlo più in alto non cambia niente.
    assert_eq!(
        dopo(
            COLORI,
            "appearance.moveItem",
            &[OGGETTO],
            json!({"from": 1, "to": 9})
        )
        .err()
        .as_deref(),
        Some("Empty")
    );
}
