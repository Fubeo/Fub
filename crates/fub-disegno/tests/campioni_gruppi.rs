//! I gruppi di colori nel file (K6 T14): `fub:group` su ogni campione del gruppo
//! (`docs/reference/scene-format-resources.md` §2). Un file coi gruppi si riapre uguale, un file di
//! prima non cambia, un `fub:group` che non si legge come gruppo resta com'è, fub-scene vede ancora i
//! campioni; i cinque comandi dei gruppi si annullano e si ripetono al byte; «Campioni predefiniti»
//! non stacca chi usa un campione e dice le sue perdite. I casi della mappa stanno in
//! `tests/famiglie/colore.json`.
#![cfg(feature = "completo")]

mod common;

use std::path::Path;
use std::sync::Arc;

use fub_abi::{DrawingCommandRequest, DrawingLossKind, DrawingOutcome, PluginError};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use fub_scene::{Item, Role};
use serde_json::{json, Value};

/// La frase di un gruppo vuoto (`campioni::TESTO_GRUPPO_VUOTO`).
const GRUPPO_VUOTO: &str = "Un gruppo di colori vuoto non si salva: scegli almeno un campione.";

fn motore() -> Arc<Disegni> {
    let disegni = common::disegni();
    disegni.filtra(Filtro::Tutte);
    disegni
}

fn banco(nome: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/famiglie/colore")
            .join(nome),
    )
    .expect("il banco si legge")
}

fn comando(d: &mut Disegno, id: &str, valore: Value) -> Result<DrawingOutcome, PluginError> {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: vec![],
        value: valore,
        preview: false,
    })
}

/// Il comando su `svg`: il file dopo le sue operazioni, e l'esito.
fn esegue(ds: &Arc<Disegni>, svg: &str, id: &str, valore: Value) -> (String, DrawingOutcome) {
    let (mut d, _) = Disegno::apri_con(ds, svg).expect("si apre");
    let esito = comando(&mut d, id, valore).unwrap_or_else(|e| panic!("{id}: {e:?}"));
    assert!(esito.refused.is_none(), "{id}: {:?}", esito.refused);
    let ops: Value = serde_json::from_str(esito.ops.as_deref().expect("operazioni")).expect("json");
    let dopo = common::applica::applica(svg, &ops).expect("le operazioni si applicano");
    (dopo, esito)
}

/// Le operazioni dell'esito, una per una (quelle del `batch`).
fn piatte(esito: &DrawingOutcome) -> Vec<Value> {
    let ops: Value = serde_json::from_str(esito.ops.as_deref().expect("operazioni")).expect("json");
    common::applica::piatte(&ops)
}

/// Un gruppo: il nome e i nomi dei membri, in ordine.
type Gruppo = (String, Vec<String>);

/// I gruppi come il motore li vede (`swatch.list`): nome e membri, in ordine.
fn gruppi(ds: &Arc<Disegni>, svg: &str) -> Vec<Gruppo> {
    let (mut d, _) = Disegno::apri_con(ds, svg).expect("si apre");
    let lettura = comando(&mut d, "swatch.list", json!({}))
        .expect("la lettura risponde")
        .reading
        .expect("una lettura");
    lettura["groups"]
        .as_array()
        .expect("i gruppi")
        .iter()
        .map(|g| {
            let membri = g["swatches"]
                .as_array()
                .expect("i membri")
                .iter()
                .map(|n| n.as_str().expect("un nome").to_string())
                .collect();
            (g["name"].as_str().expect("un nome").to_string(), membri)
        })
        .collect()
}

/// Le perdite vere dell'apertura: le note «Unmapped» delle risorse in `<defs>` ci sono in ogni file.
fn vere(perdite: &[fub_abi::DrawingLoss]) -> Vec<&fub_abi::DrawingLoss> {
    perdite
        .iter()
        .filter(|p| p.kind != DrawingLossKind::Unmapped)
        .collect()
}

fn coppie(lista: &[(&str, &[&str])]) -> Vec<Gruppo> {
    lista
        .iter()
        .map(|(g, m)| (g.to_string(), m.iter().map(|s| s.to_string()).collect()))
        .collect()
}

/// Il file riaperto non ha perdite in più dell'originale, e Annulla e Ripeti (il testo di prima e
/// quello di dopo, come li manda l'editor) tornano al byte.
fn riapre_e_annulla(ds: &Arc<Disegni>, prima: &str, dopo: &str) {
    let (_, aperto_prima) = Disegno::apri_con(ds, prima).expect("l'originale si apre");
    let (_, aperto) = Disegno::apri_con(ds, dopo).expect("il file dopo si apre");
    assert!(
        vere(&aperto.losses).len() <= vere(&aperto_prima.losses).len(),
        "nessuna perdita in più: {:?}",
        vere(&aperto.losses)
    );
    let (mut d, _) = Disegno::apri_con(ds, prima).expect("si apre");
    for testo in [dopo, prima, dopo] {
        d.sincronizza(fub_abi::DrawingSync {
            revision: d.revisione() + 1,
            change: fub_abi::DrawingChange::Text {
                text: testo.to_string(),
            },
        })
        .expect("il testo passa");
        assert!(d.aspetta_il_reimport(std::time::Duration::from_secs(30)));
        assert_eq!(d.testo(), testo, "Annulla e Ripeti al byte");
    }
}

#[test]
fn un_file_coi_gruppi_si_riapre_uguale_al_byte() {
    let ds = motore();
    let svg = banco("gruppi.svg");
    let (d, aperto) = Disegno::apri_con(&ds, &svg).expect("si apre");
    assert!(vere(&aperto.losses).is_empty(), "{:?}", aperto.losses);
    assert_eq!(d.testo(), svg);
    assert_eq!(
        gruppi(&ds, &svg),
        coppie(&[
            ("Caldi", &["Arancio", "Giallo"]),
            ("Freddi", &["Verde", "Cielo"])
        ])
    );
    // Un comando dei campioni che non tocca i gruppi li lascia al byte: aggiunge e basta.
    let (dopo, esito) = esegue(
        &ds,
        &svg,
        "swatch.new",
        json!({ "name": "Rosso", "color": "#ff0000" }),
    );
    let ops = piatte(&esito);
    assert_eq!(ops.len(), 1, "{ops:?}");
    assert_eq!(ops[0]["op"], "add");
    for riga in svg.lines().filter(|r| !r.contains("</defs>")) {
        assert!(dopo.contains(riga), "la riga «{riga}» resta: {dopo}");
    }
    assert_eq!(
        gruppi(&ds, &dopo),
        coppie(&[
            ("Caldi", &["Arancio", "Giallo"]),
            ("Freddi", &["Verde", "Cielo"])
        ])
    );
    riapre_e_annulla(&ds, &svg, &dopo);
}

#[test]
fn nuovo_gruppo_si_riapre_con_gli_stessi_gruppi_nello_stesso_ordine() {
    let ds = motore();
    let svg = banco("gruppi.svg");
    let (dopo, _) = esegue(
        &ds,
        &svg,
        "swatch.newGroup",
        json!({ "name": "Miei", "swatches": ["Blu"] }),
    );
    assert_eq!(
        gruppi(&ds, &dopo),
        coppie(&[
            ("Caldi", &["Arancio", "Giallo"]),
            ("Freddi", &["Verde", "Cielo"]),
            ("Miei", &["Blu"]),
        ])
    );
    // Senza nome il gruppo è «Gruppo colori», non il nome inglese del motore.
    let (senza_nome, _) = esegue(
        &ds,
        &svg,
        "swatch.newGroup",
        json!({ "colors": ["#123456"] }),
    );
    let ultimi = gruppi(&ds, &senza_nome);
    assert_eq!(
        ultimi.last().map(|g| g.0.as_str()),
        Some("Gruppo colori"),
        "{ultimi:?}"
    );
    assert!(
        senza_nome.contains("fub:group=\"Gruppo colori\""),
        "{senza_nome}"
    );
    // Riaperto e salvato di nuovo: uguale.
    let (d, _) = Disegno::apri_con(&ds, &dopo).expect("si riapre");
    assert_eq!(d.testo(), dopo);
}

#[test]
fn un_file_di_prima_non_cambia() {
    let ds = motore();
    for nome in ["campioni.svg", "campioni-ordinati.svg", "base.svg"] {
        let svg = banco(nome);
        let (d, aperto) = Disegno::apri_con(&ds, &svg).expect("si apre");
        assert_eq!(d.testo(), svg, "{nome}");
        assert!(gruppi(&ds, &svg).is_empty(), "{nome}");
        let (_, prima) = Disegno::apri_con(&ds, &svg).expect("si apre");
        assert_eq!(aperto.losses, prima.losses, "{nome}");
    }
    // Un comando sui campioni di un file di prima non scrive gruppi.
    let svg = banco("campioni.svg");
    let (dopo, _) = esegue(
        &ds,
        &svg,
        "swatch.new",
        json!({ "name": "Verde", "color": "#009e73" }),
    );
    assert!(!dopo.contains("fub:group"), "{dopo}");
}

/// Un disegno con le `defs` date e un oggetto che usa il primo campione.
fn con_defs(defs: &str) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n{defs}\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"url(#r1a1a1a1a) #0072b2\"/>\n  </g>\n</svg>\n"
    )
}

fn campione(id: &str, nome: &str, gruppo: Option<&str>, colore: &str) -> String {
    let gruppo = gruppo
        .map(|g| format!(" fub:group=\"{g}\""))
        .unwrap_or_default();
    format!("    <linearGradient id=\"{id}\" fub:role=\"swatch\" fub:name=\"{nome}\"{gruppo} gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"{colore}\"/></linearGradient>\n")
}

#[test]
fn un_fub_group_che_non_e_un_gruppo_resta_com_e() {
    let ds = motore();
    let blu = campione("r1a1a1a1a", "Blu", None, "#0072b2");
    let casi: Vec<(&str, String)> = vec![
        (
            "vuoto",
            format!(
                "  <defs id=\"fub-defs\">\n{}{}  </defs>",
                campione("r1a1a1a1a", "Blu", Some(""), "#0072b2"),
                campione("r2b2b2b2b", "Arancio", Some("  "), "#e69f00")
            ),
        ),
        (
            "col nome di un campione",
            format!("  <defs id=\"fub-defs\">\n{blu}{}  </defs>", campione("r2b2b2b2b", "Arancio", Some("Blu"), "#e69f00")),
        ),
        (
            "col nome di un motivo",
            format!(
                "  <defs id=\"fub-defs\">\n{blu}{}    <pattern id=\"r9z9z9z9z\" fub:role=\"swatch\" fub:name=\"Righe\" x=\"0\" y=\"0\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\"><rect x=\"0\" y=\"0\" width=\"4\" height=\"8\" fill=\"#000000\"/></pattern>\n  </defs>",
                campione("r2b2b2b2b", "Arancio", Some("Righe"), "#e69f00")
            ),
        ),
        (
            "col nome di un campione riservato",
            format!(
                "  <defs id=\"fub-defs\">\n{blu}{}{}  </defs>",
                campione("r2b2b2b2b", "Arancio", Some("[None]"), "#e69f00"),
                campione("r3c3c3c3c", "Viola", Some("[Registration]"), "#cc79a7")
            ),
        ),
        (
            "su una radialGradient",
            format!("  <defs id=\"fub-defs\">\n{blu}    <radialGradient id=\"r6f6f6f6f\" fub:role=\"private\" fub:group=\"Caldi\" cx=\"0.5\" cy=\"0.5\" r=\"0.5\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#000000\"/></radialGradient>\n  </defs>"),
        ),
        (
            "su un pattern",
            format!("  <defs id=\"fub-defs\">\n{blu}    <pattern id=\"r7a7a7a7a\" fub:role=\"private\" fub:group=\"Caldi\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\"><rect x=\"0\" y=\"0\" width=\"4\" height=\"8\" fill=\"#000000\"/></pattern>\n  </defs>"),
        ),
        (
            "su un campione rotto",
            format!("  <defs id=\"fub-defs\">\n{blu}    <linearGradient id=\"r8b8b8b8b\" fub:role=\"swatch\" fub:name=\"Rotto\" fub:group=\"Caldi\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ff0000\"/><stop offset=\"1\" stop-color=\"#0000ff\"/></linearGradient>\n  </defs>"),
        ),
        (
            "coi membri sparsi",
            format!(
                "  <defs id=\"fub-defs\">\n{}{}{}  </defs>",
                campione("r1a1a1a1a", "Blu", Some("Caldi"), "#0072b2"),
                campione("r2b2b2b2b", "Arancio", None, "#e69f00"),
                campione("r3c3c3c3c", "Viola", Some("Caldi"), "#cc79a7")
            ),
        ),
        (
            "coi membri in due defs",
            format!(
                "  <defs id=\"fub-defs\">\n{}  </defs>\n  <defs id=\"altre\">\n{}  </defs>",
                campione("r1a1a1a1a", "Blu", Some("Caldi"), "#0072b2"),
                campione("r2b2b2b2b", "Arancio", Some("Caldi"), "#e69f00")
            ),
        ),
    ];
    for (nome, defs) in casi {
        let svg = con_defs(&defs);
        if nome == "col nome di un motivo" {
            let scena = fub_scene::read(&svg).expect("la scena si legge");
            assert!(
                scena
                    .items
                    .iter()
                    .any(|i| matches!(i, Item::Element(e) if e.motif.is_some())),
                "il banco ha un motivo vero"
            );
        }
        let (d, _) = Disegno::apri_con(&ds, &svg).unwrap_or_else(|e| panic!("{nome}: {e}"));
        assert_eq!(d.testo(), svg, "{nome}");
        assert!(gruppi(&ds, &svg).is_empty(), "{nome}: nessun gruppo");
        // Un comando dei campioni aggiunge il suo, e il resto resta al byte.
        let (dopo, esito) = esegue(
            &ds,
            &svg,
            "swatch.new",
            json!({ "name": "Nuovo", "color": "#123456" }),
        );
        let ops = piatte(&esito);
        assert_eq!(ops.len(), 1, "{nome}: {ops:?}");
        assert_eq!(ops[0]["op"], "add", "{nome}");
        for riga in svg.lines().filter(|r| !r.contains("</defs>")) {
            assert!(dopo.contains(riga), "{nome}: la riga «{riga}» resta");
        }
    }
}

#[test]
fn fub_scene_vede_ancora_il_campione_con_fub_group() {
    let svg = banco("gruppi.svg");
    let scena = fub_scene::read(&svg).expect("la scena si legge");
    assert!(scena.editable(), "{:?}", scena.read_only);
    let nomi: Vec<String> = scena
        .items
        .iter()
        .filter_map(|i| match i {
            Item::Element(e) if e.role == Role::Resource => {
                e.swatch.as_ref().map(|s| s.name.clone())
            }
            _ => None,
        })
        .collect();
    assert_eq!(nomi, ["Blu", "Arancio", "Giallo", "Verde", "Cielo"]);
    assert!(
        !scena.items.iter().any(|i| matches!(i, Item::Foreign(_))),
        "nessuna parte estranea"
    );
}

#[test]
fn i_comandi_dei_gruppi_si_annullano_e_si_ripetono_al_byte() {
    let ds = motore();
    let gruppi_svg = banco("gruppi.svg");
    let campioni_svg = banco("campioni.svg");
    let casi: [(&str, &str, Value); 4] = [
        (
            "swatch.newGroup",
            &campioni_svg,
            json!({ "name": "Miei", "swatches": ["Blu", "Arancio"] }),
        ),
        ("swatch.ungroup", &gruppi_svg, json!({ "name": "Caldi" })),
        (
            "swatch.editGroup",
            &gruppi_svg,
            json!({ "group": "Freddi", "colors": ["#00aa00", "#56b4e9", "#123456"], "rename": "Mari" }),
        ),
        ("swatch.resetDefaults", &gruppi_svg, json!({})),
    ];
    for (id, svg, valore) in casi {
        let (dopo, _) = esegue(&ds, svg, id, valore);
        assert_ne!(dopo, svg, "{id} cambia il file");
        riapre_e_annulla(&ds, svg, &dopo);
    }
    // Aggiungi ai campioni di un tema salvato.
    let (mut d, _) = Disegno::apri_con(&ds, &campioni_svg).expect("si apre");
    let salvato = comando(
        &mut d,
        "colorTheme.save",
        json!({ "colors": ["#ff0000", "#00ff00"], "name": "Tema" }),
    )
    .expect("il tema si salva");
    assert!(salvato.ops.is_none());
    let esito = comando(
        &mut d,
        "colorTheme.addToSwatches",
        json!({ "name": "Tema" }),
    )
    .expect("si aggiunge");
    let ops: Value = serde_json::from_str(esito.ops.as_deref().expect("operazioni")).expect("json");
    let dopo = common::applica::applica(&campioni_svg, &ops).expect("si applica");
    assert_eq!(
        gruppi(&ds, &dopo),
        coppie(&[("Tema", &["R=255 G=0 B=0", "R=0 G=255 B=0"])])
    );
    riapre_e_annulla(&ds, &campioni_svg, &dopo);
}

#[test]
fn un_gruppo_vuoto_si_rifiuta_col_suo_perche() {
    let ds = motore();
    for (svg, id, valore) in [
        (
            banco("campioni.svg"),
            "swatch.newGroup",
            json!({ "name": "Vuoto" }),
        ),
        (banco("campioni.svg"), "swatch.newGroup", json!({})),
        (
            banco("gruppi.svg"),
            "swatch.editGroup",
            json!({ "group": "Freddi", "colors": [] }),
        ),
    ] {
        let (mut d, _) = Disegno::apri_con(&ds, &svg).expect("si apre");
        match comando(&mut d, id, valore.clone()) {
            Err(PluginError::BadArgs(perche)) => {
                assert_eq!(perche.to_string(), GRUPPO_VUOTO, "{id} {valore}")
            }
            altro => panic!("{id} {valore}: atteso il perché del gruppo vuoto, non {altro:?}"),
        }
        assert_eq!(d.testo(), svg, "niente cambia");
    }
    // Un gruppo che non c'è.
    let svg = banco("gruppi.svg");
    let (mut d, _) = Disegno::apri_con(&ds, &svg).expect("si apre");
    for (id, valore) in [
        ("swatch.ungroup", json!({ "name": "Tiepidi" })),
        (
            "swatch.editGroup",
            json!({ "group": "Tiepidi", "colors": ["#000000"] }),
        ),
    ] {
        match comando(&mut d, id, valore) {
            Err(PluginError::BadArgs(perche)) => {
                assert_eq!(
                    perche.to_string(),
                    "«Tiepidi» non è un gruppo di colori del disegno."
                )
            }
            altro => panic!("{id}: {altro:?}"),
        }
    }
    // Eliminare l'ultimo campione di un gruppo lo fa sparire, senza rifiuto.
    let (dopo, _) = esegue(
        &ds,
        &banco("gruppi.svg"),
        "swatch.ungroup",
        json!({ "name": "Freddi" }),
    );
    assert_eq!(
        gruppi(&ds, &dopo),
        coppie(&[("Caldi", &["Arancio", "Giallo"])])
    );
}

/// Il riempimento dell'oggetto `id` com'è scritto nel file.
/// Il nome di un gruppo nuovo: senza nome, o di soli spazi, diventa «Gruppo colori» (lo dà il comando di
/// Fub, prima del motore); con spazi intorno il motore li toglie, e un nome lungo resta intero. È quello che
/// la finestra «Nuovo gruppo colori…» manda (K6 T14, gruppi).
#[test]
fn il_nome_di_serie_e_quello_senza_spazi() {
    let ds = motore();
    let svg = banco("campioni.svg");
    let lungo = "Caldi e freddi della stagione lunga da tenere sul tavolo di lavoro per il progetto";
    for (valore, atteso) in [
        (json!({ "swatches": ["Blu"] }), "Gruppo colori"),
        (json!({ "name": "   ", "swatches": ["Blu"] }), "Gruppo colori"),
        (json!({ "name": "  Caldi  ", "swatches": ["Blu"] }), "Caldi"),
        (json!({ "name": lungo, "swatches": ["Blu"] }), lungo),
    ] {
        let (dopo, _) = esegue(&ds, &svg, "swatch.newGroup", valore.clone());
        assert_eq!(gruppi(&ds, &dopo), coppie(&[(atteso, &["Blu"][..])]), "{valore}");
    }
}

fn riempimento(svg: &str, id: &str) -> String {
    let da = svg.find(&format!("id=\"{id}\"")).expect("l'oggetto c'è");
    let tag = &svg[da..da + svg[da..].find('>').expect("il tag si chiude")];
    tag.split("fill=\"")
        .nth(1)
        .expect("un riempimento")
        .split('"')
        .next()
        .expect("chiuso")
        .to_string()
}

#[test]
fn campioni_predefiniti_non_staccano_chi_usa_un_campione() {
    let ds = motore();
    let svg = banco("gruppi.svg");
    // Arancio (globale) colora oa1; il ripristino ne ha uno di serie con lo stesso nome italiano.
    assert_eq!(riempimento(&svg, "oa1a1a1a1"), "url(#r2b2b2b2b) #e69f00");
    for replace in [false, true] {
        let (dopo, esito) = esegue(
            &ds,
            &svg,
            "swatch.resetDefaults",
            json!({ "replace": replace }),
        );
        // Le quattro sfumature di serie non entrano: si dice, non in silenzio.
        let sfumature: Vec<&str> = esito
            .losses
            .iter()
            .filter(|p| p.kind == DrawingLossKind::Unsupported)
            .map(|p| p.element.as_str())
            .collect();
        assert_eq!(
            sfumature,
            ["Bianco, nero", "Radiale bianco, nero", "Tramonto", "Oceano"],
            "replace {replace}"
        );
        // Riaperto, l'oggetto ha il colore di prima, e nessun riferimento appeso.
        let (d, aperto) = Disegno::apri_con(&ds, &dopo).expect("si riapre");
        assert!(
            vere(&aperto.losses).is_empty(),
            "replace {replace}: {:?}",
            vere(&aperto.losses)
        );
        assert_eq!(d.testo(), dopo);
        let colore = riempimento(&dopo, "oa1a1a1a1");
        assert!(colore.ends_with("#e69f00"), "replace {replace}: {colore}");
        if let Some(rif) = colore.strip_prefix("url(#") {
            let id = rif.split(')').next().expect("chiuso");
            let campione = dopo.find(&format!("id=\"{id}\"")).expect("il campione c'è");
            assert!(
                dopo[campione..]
                    .split("</linearGradient>")
                    .next()
                    .unwrap()
                    .contains("#e69f00"),
                "replace {replace}: il campione usato ha il colore dell'oggetto"
            );
        }
        let nomi = gruppi(&ds, &dopo);
        assert!(nomi.iter().any(|g| g.0 == "Grigi"), "{nomi:?}");
        assert!(nomi.iter().any(|g| g.0 == "Brillanti"), "{nomi:?}");
        if replace {
            assert!(
                !nomi.iter().any(|g| g.0 == "Caldi"),
                "replace toglie i gruppi del disegno"
            );
            assert!(
                !dopo.contains("fub:name=\"Cielo\""),
                "replace toglie i campioni del disegno"
            );
        } else {
            assert!(nomi
                .iter()
                .any(|g| g.0 == "Caldi" && g.1 == ["Arancio", "Giallo"]));
            // Arancio, Giallo, Verde, Blu e Viola c'erano: non tornano una seconda volta.
            for nome in ["Arancio", "Giallo", "Verde", "Blu"] {
                assert_eq!(
                    dopo.matches(&format!("fub:name=\"{nome}\"")).count(),
                    1,
                    "{nome}"
                );
            }
        }
        riapre_e_annulla(&ds, &svg, &dopo);
    }
}

/// I `dopo` dei casi della mappa (scritti dalla scena del client, che riformatta gli elementi toccati)
/// si riaprono nel motore coi gruppi attesi, uguali al byte e senza perdite.
#[test]
fn i_dopo_scritti_dal_client_si_riaprono_coi_gruppi() {
    let ds = motore();
    let attesi: [(&str, Vec<Gruppo>); 4] = [
        (
            "gruppi-nuovo-dopo.svg",
            coppie(&[("Miei", &["Blu", "Arancio"])]),
        ),
        (
            "gruppi-separa-dopo.svg",
            coppie(&[("Freddi", &["Verde", "Cielo"])]),
        ),
        (
            "gruppi-modifica-dopo.svg",
            coppie(&[
                ("Caldi", &["Arancio", "Giallo"]),
                ("Mari", &["Verde", "Cielo", "R=18 G=52 B=86"]),
            ]),
        ),
        (
            "gruppi-tema-dopo.svg",
            coppie(&[("Tema", &["R=255 G=0 B=0", "R=0 G=255 B=0"])]),
        ),
    ];
    for (nome, gruppi_attesi) in attesi {
        let svg = banco(nome);
        let (d, aperto) = Disegno::apri_con(&ds, &svg).expect("si apre");
        assert_eq!(d.testo(), svg, "{nome}");
        assert!(
            vere(&aperto.losses).is_empty(),
            "{nome}: {:?}",
            vere(&aperto.losses)
        );
        assert_eq!(gruppi(&ds, &svg), gruppi_attesi, "{nome}");
    }
    let predefiniti = banco("campioni-predefiniti-dopo.svg");
    let nomi: Vec<String> = gruppi(&ds, &predefiniti).into_iter().map(|g| g.0).collect();
    assert_eq!(nomi, ["Grigi", "Brillanti"]);
}
