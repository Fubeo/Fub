//! Il banco di prova delle righe (piano K6, T5;
//! `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//!
//! Ogni riga «fatto» della mappa ha un caso in `tests/famiglie/<famiglia>.json`
//! (la forma è in `casi/mod.rs`), e ogni caso ha la sua riga. Ogni caso gira
//! con tutte le righe accese (`Filtro::Tutte`): un comando dà le operazioni,
//! la lettura o l'errore attesi; uno strumento fa il suo gesto; un effetto
//! si confronta a pixel col disegno del motore stesso, sia il `dopo` sia il
//! disegno con le operazioni di Fub applicate. Dopo ogni caso il
//! motore è tornato al disegno di partenza; il client applica le operazioni
//! in un passo, le annulla e controlla i testi byte per byte (`casi.test.ts`).
//!
//! I casi di `tests/casi-prova/` provano il banco: oggi nessuna riga è
//! fatta, e senza di loro il banco girerebbe a vuoto.

#![cfg(feature = "completo")]

mod casi;
mod common;

use casi::{
    cartella_famiglie, cartella_prova, controlla_righe, disegni_di_prova, esegui, leggi_cartella,
    leggi_file, ops_scritte, oracolo_dell_effetto, Atteso, Caso,
};
use fub_disegno::catalogo::{mappa, FonteMappa, Stato};
use serde_json::json;

/// I nomi dei file di casi delle famiglie, senza `.json`.
fn file_delle_famiglie() -> Vec<String> {
    let mut nomi: Vec<String> = std::fs::read_dir(cartella_famiglie())
        .expect("la cartella dei casi")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| p.file_stem()?.to_str().map(str::to_string))
        .collect();
    nomi.sort();
    nomi
}

fn casi_di_prova() -> Vec<Caso> {
    leggi_file(&cartella_prova().join("prova.json")).expect("i casi di prova si leggono")
}

fn caso_di_prova(id: &str) -> Caso {
    casi_di_prova()
        .into_iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("manca il caso di prova {id}"))
}

#[test]
fn ogni_caso_delle_famiglie_passa() {
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let disegni = disegni_di_prova();
    let errori: Vec<String> = casi
        .iter()
        .filter_map(|c| esegui(&disegni, c).err())
        .collect();
    assert!(errori.is_empty(), "{}", errori.join("\n"));
}

#[test]
fn ogni_riga_fatta_ha_un_caso_e_ogni_caso_una_riga() {
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let errori = controlla_righe(mappa(), &casi, &file_delle_famiglie());
    assert!(errori.is_empty(), "{}", errori.join("\n"));
    // Un file per famiglia, e niente altro.
    let mut attese: Vec<String> = fub_abi::DRAWING_FAMILIES
        .iter()
        .map(|f| f.to_string())
        .collect();
    attese.sort();
    assert_eq!(file_delle_famiglie(), attese);
}

#[test]
fn i_casi_di_prova_passano() {
    let disegni = disegni_di_prova();
    let casi = casi_di_prova();
    // Un comando, una lettura vuota, uno strumento e un effetto.
    for fonte in [
        FonteMappa::Motore,
        FonteMappa::Strumento,
        FonteMappa::Effetto,
    ] {
        assert!(
            casi.iter().any(|c| c.fonte == fonte),
            "manca un caso {fonte:?}"
        );
    }
    let errori: Vec<String> = casi
        .iter()
        .filter_map(|c| esegui(&disegni, c).err())
        .collect();
    assert!(errori.is_empty(), "{}", errori.join("\n"));
}

#[test]
fn operazioni_diverse_fanno_cadere_il_caso() {
    let disegni = disegni_di_prova();
    let mut caso = caso_di_prova("edit.colors.invert");
    caso.atteso = Atteso::Ops(json!([
        { "op": "set", "id": "oa1a1a1a1", "attrs": { "fill": "#000001" } }
    ]));
    let errore = esegui(&disegni, &caso).expect_err("le operazioni sono diverse");
    assert!(errore.contains("operazioni diverse"), "{errore}");
    // Un rifiuto al posto delle operazioni, o un altro rifiuto.
    caso.atteso = Atteso::Rifiuto("unsupported".into());
    assert!(esegui(&disegni, &caso).is_err());
    let mut vuoto = caso_di_prova("select.reselect");
    vuoto.atteso = Atteso::Rifiuto("unmapped".into());
    assert!(esegui(&disegni, &vuoto).is_err());
    vuoto.atteso = Atteso::Errore("bad_args".into());
    assert!(esegui(&disegni, &vuoto).is_err());
    // Una selezione diversa da quella attesa.
    vuoto.atteso = Atteso::Selezione(vec!["oa1a1a1a1".into()]);
    let errore = esegui(&disegni, &vuoto).expect_err("la selezione è diversa");
    assert!(errore.contains("selezione"), "{errore}");
}

#[test]
fn un_effetto_diverso_dal_motore_fa_cadere_il_caso() {
    let disegni = disegni_di_prova();
    let mut caso = caso_di_prova("stylize.roundCorners");
    // Il colore di un rettangolo cambiato: l'oracolo lo vede.
    caso.dopo = caso
        .dopo
        .map(|d| d.replace("fill=\"#000000\"", "fill=\"#00ff00\""));
    let errore = esegui(&disegni, &caso).expect_err("il disegno dopo è sbagliato");
    assert!(errore.contains("differiscono"), "{errore}");
    // Gli angoli dritti (il disegno di partenza come dopo): l'oracolo vede
    // anche i soli angoli.
    let mut dritti = caso_di_prova("stylize.roundCorners");
    dritti.dopo = Some(dritti.disegno.clone());
    let errore = esegui(&disegni, &dritti).expect_err("gli angoli non sono tondi");
    assert!(errore.contains("differiscono"), "{errore}");
    // Ciò che Fub scrive conta, non solo `dopo`: con le operazioni della
    // grafica semplice di prima (la geometria di partenza, senza l'effetto
    // applicato) il caso cade anche con il `dopo` giusto.
    let giusto = caso_di_prova("stylize.roundCorners");
    let ops = ops_scritte(&disegni, &giusto).expect("le operazioni di Fub");
    let mut testo = ops.to_string();
    for (id, espanso, semplice) in [
        (
            "oa1a1a1a1",
            "M100 115 C",
            "M100 100 L200 100 L200 150 L100 150 Z",
        ),
        (
            "ob2b2b2b2",
            "M220 115 C",
            "M220 100 L280 100 L280 150 L220 150 Z",
        ),
    ] {
        let attacco = format!("<path id=\\\"{id}\\\" d=\\\"");
        let da = testo
            .find(&attacco)
            .unwrap_or_else(|| panic!("il corpo di {id}: {testo}"))
            + attacco.len();
        let a = da + testo[da..].find("\\\"").expect("chiuso");
        assert!(testo[da..a].starts_with(espanso), "{}", &testo[da..a]);
        testo.replace_range(da..a, semplice);
    }
    let semplici: serde_json::Value = serde_json::from_str(&testo).expect("json");
    let dopo = giusto.dopo.clone().expect("il dopo");
    oracolo_dell_effetto(&giusto, &dopo, Some(&ops)).expect("le operazioni di Fub");
    let errore = oracolo_dell_effetto(&giusto, &dopo, Some(&semplici))
        .expect_err("la grafica semplice non è il disegno del motore");
    assert!(errore.contains("il disegno che Fub scrive"), "{errore}");
    // Un effetto con le operazioni attese vuole il disegno dopo.
    let mut senza = caso_di_prova("stylize.roundCorners");
    senza.dopo = None;
    senza.atteso = Atteso::Ops(json!([]));
    assert!(esegui(&disegni, &senza).is_err());
}

#[test]
fn una_voce_dell_interfaccia_vuole_la_sua_prova() {
    let disegni = disegni_di_prova();
    let mut caso = caso_di_prova("select.reselect");
    caso.fonte = FonteMappa::Interfaccia;
    caso.id = "view.zoomIn".into();
    caso.prova = None;
    assert!(esegui(&disegni, &caso).is_err());
    caso.prova = Some("apps/client/src/editors/spatial/completo/non-esiste.test.ts".into());
    assert!(esegui(&disegni, &caso).is_err());
    // Il file c'è ma non la nomina.
    caso.prova = Some("crates/fub-disegno/tests/casi-prova/prova/base.svg".into());
    assert!(esegui(&disegni, &caso).is_err());
    caso.id = "oa1a1a1a1".into();
    assert!(esegui(&disegni, &caso).is_ok());
}

#[test]
fn una_riga_fatta_senza_caso_e_un_caso_senza_riga_cadono() {
    let file = file_delle_famiglie();
    // Una riga da fare che diventa fatta, senza caso.
    let mut righe = mappa().to_vec();
    let quale = righe
        .iter()
        .position(|r| r.fonte == FonteMappa::Motore && r.id == "edit.colors.invert")
        .expect("la riga c'è");
    righe[quale].stato = Stato::Fatto;
    // I casi veri delle famiglie: le altre righe fatte li hanno.
    let veri = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let con = |caso: &Caso| {
        let mut tutti = veri.clone();
        tutti.push(caso.clone());
        tutti
    };
    let errori = controlla_righe(&righe, &veri, &file);
    assert_eq!(errori.len(), 1, "{errori:?}");
    assert!(errori[0].contains("edit.colors.invert"), "{errori:?}");
    // Col suo caso nel file della sua famiglia, non cade più.
    let mut caso = caso_di_prova("edit.colors.invert");
    caso.gruppo = righe[quale].famiglia.clone();
    assert!(controlla_righe(&righe, &con(&caso), &file).is_empty());
    // Nel file di un'altra famiglia, sì.
    caso.gruppo = "nucleo".into();
    assert_eq!(controlla_righe(&righe, &con(&caso), &file).len(), 1);
    // Un caso senza riga.
    caso.id = "edit.nonEsiste".into();
    let errori = controlla_righe(mappa(), &[caso], &file);
    assert!(
        errori.iter().any(|e| e.contains("non ha una riga")),
        "{errori:?}"
    );
    // Un file di famiglia che manca.
    let meno: Vec<String> = file.iter().filter(|f| *f != "nucleo").cloned().collect();
    let errori = controlla_righe(mappa(), &[], &meno);
    assert!(
        errori.iter().any(|e| e.contains("nucleo.json")),
        "{errori:?}"
    );
}
