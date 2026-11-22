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
    // Una riga da fare (di T22, lontana) che diventa fatta, senza caso.
    let mut righe = mappa().to_vec();
    let quale = righe
        .iter()
        .position(|r| r.fonte == FonteMappa::Motore && r.id == "assets.export")
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
    assert!(errori[0].contains("assets.export"), "{errori:?}");
    // Col suo caso nel file della sua famiglia, non cade più.
    // Il caso di prova di un'altra riga, preso in prestito: conta l'id.
    let mut caso = caso_di_prova("edit.colors.invert");
    caso.id = "assets.export".into();
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

/// Sblocca tutto del motore sblocca anche il foglio di Fub e lo sceglie con
/// gli altri: il foglio resta bloccato nel file (nessun `set` su di lui) e
/// fuori dalla selezione di Fub, che ha solo gli oggetti sbloccati.
#[test]
fn sblocca_tutto_non_tocca_il_foglio() {
    let disegni = disegni_di_prova();
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let caso = casi
        .iter()
        .find(|c| c.id == "object.unlockAll")
        .expect("il caso di Sblocca tutto");
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(esito.selection, ["oa1a1a1a1", "of6f6f6f6"]);
    assert!(!esito.ops.unwrap_or_default().contains("fub-paper"));
}

/// Gli elementi fuori da ogni livello stanno nel livello del motore che fa da
/// radice (T15, giro 3): quel livello non ha un elemento nel file, e il
/// nome, l'occhio e il cestino non lo toccano; il file resta com'è.
#[test]
fn il_livello_implicito_non_si_rinomina_ne_si_elimina() {
    let disegni = disegni_di_prova();
    let casi = leggi_file(&cartella_famiglie().join("livelli.json")).expect("i casi si leggono");
    let estraneo = &casi
        .iter()
        .find(|c| c.id == "layer.delete" && c.disegno.contains("id=\"r1\""))
        .expect("il caso sull'SVG con elementi fuori dai livelli")
        .disegno;
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, estraneo).expect("si apre");
    let comando = |disegno: &fub_disegno::motore::Disegno, id: &str, valore: serde_json::Value| {
        fub_abi::DrawingCommandRequest {
            revision: disegno.revisione(),
            id: format!("disegno.{id}"),
            selection: vec![],
            value: valore,
            preview: false,
        }
    };
    let letto = disegno
        .comando(comando(&disegno, "document.inspect", json!({})))
        .expect("si legge");
    let lettura = letto.reading.expect("una lettura");
    let livelli = lettura["layers"].as_array().expect("i livelli del motore");
    // Un solo livello in cima: la radice, che contiene gli elementi sciolti
    // e il livello di Fub (che nel motore si chiama col suo id).
    assert_eq!(livelli.len(), 1, "{lettura}");
    let radice = livelli[0]["id"].clone();
    let figli: Vec<&str> = livelli[0]["children"]
        .as_array()
        .expect("i figli della radice")
        .iter()
        .filter_map(|f| f["name"].as_str())
        .collect();
    assert_eq!(figli, ["c1", "l1a2b3c4d", "r1"]);
    for (id, valore) in [
        (
            "layer.setProps",
            json!({ "ids": [radice], "name": "Altro" }),
        ),
        (
            "layer.setProps",
            json!({ "ids": [radice], "visible": false }),
        ),
        ("layer.setProps", json!({ "ids": [radice], "locked": true })),
        ("layer.delete", json!({ "ids": [radice] })),
    ] {
        let esito = disegno
            .comando(comando(&disegno, id, valore.clone()))
            .expect("senza errore");
        assert_eq!(
            esito.refused,
            Some(fub_abi::DrawingRefusal::Unmapped),
            "{id} {valore}"
        );
        assert!(esito.ops.is_none(), "{id} {valore}");
    }
}

/// Un livello letto dal file: il nome, se è bloccato o nascosto, e gli id dei
/// suoi figli diretti, in ordine.
type LivelloLetto = (String, bool, bool, Vec<Option<String>>);

fn livelli_del_file(testo: &str) -> Vec<LivelloLetto> {
    let elementi = common::applica::elementi(testo).expect("il file si legge");
    elementi
        .iter()
        .filter_map(|l| {
            let info = l.layer.as_ref()?;
            let figli = elementi
                .iter()
                .filter(|e| e.path.len() == l.path.len() + 1 && e.path.starts_with(&l.path))
                .map(|e| e.id.clone())
                .collect();
            Some((info.name.clone(), info.locked, info.hidden, figli))
        })
        .collect()
}

/// I livelli rinominati, nuovi, nascosti o bloccati si rileggono come il
/// motore li ha lasciati (T15, giro 3): le operazioni di Fub, applicate al
/// file, danno gli stessi livelli del `dopo` del caso, nello stesso ordine e
/// con gli stessi figli; il file scritto si riapre senza parti nuove che
/// restano com'erano, e nessun elemento di prima manca.
#[test]
fn i_livelli_scritti_si_rileggono_uguali() {
    let disegni = disegni_di_prova();
    let casi = leggi_file(&cartella_famiglie().join("livelli.json")).expect("i casi si leggono");
    let mut provati = 0;
    for caso in casi.iter().filter(|c| {
        matches!(c.id.as_str(), "layer.new" | "layer.setProps")
            && matches!(c.atteso, Atteso::Ops(_))
    }) {
        let nome = caso.nome();
        let ops = ops_scritte(&disegni, caso).unwrap_or_else(|e| panic!("{e}"));
        let scritto = common::applica::applica(&caso.disegno, &ops)
            .unwrap_or_else(|e| panic!("{nome}: le operazioni non si applicano: {e}"));
        let dopo = caso
            .dopo
            .as_deref()
            .expect("un caso con operazioni ha il dopo");
        // L'id del livello nuovo è nuovo a ogni giro: si confronta il resto.
        assert_eq!(livelli_del_file(&scritto), livelli_del_file(dopo), "{nome}");
        let ids = |testo: &str| -> Vec<String> {
            common::applica::elementi(testo)
                .expect("il file si legge")
                .into_iter()
                .filter_map(|e| e.id)
                .collect()
        };
        let ids_scritti = ids(&scritto);
        for id in ids(&caso.disegno) {
            assert!(ids_scritti.contains(&id), "{nome}: {id} si è perso");
        }
        let (_, aperto_prima) = common::apri(&caso.disegno);
        let (_, aperto) = fub_disegno::motore::Disegno::apri_con(&disegni, &scritto)
            .unwrap_or_else(|e| panic!("{nome}: il file scritto non si riapre: {e}"));
        assert_eq!(aperto.losses, aperto_prima.losses, "{nome}");
        assert_eq!(aperto.unmapped, aperto_prima.unmapped, "{nome}");
        provati += 1;
    }
    assert!(
        provati >= 6,
        "solo {provati} casi dei livelli con operazioni"
    );
}

/// Un testo entra nell'Elaborazione tracciati col contorno delle sue lettere
/// quando il motore ha i caratteri (T12, giro 5): Unione del quadrato
/// oa1a1a1a1 e di «Ciao» in Inter toglie i due oggetti e scrive un tracciato
/// solo, il quadrato più le lettere. Senza caratteri lo stesso caso di
/// `tracciati.json` è `unmapped`: il testo sparirebbe senza entrare.
#[test]
fn l_elaborazione_usa_le_lettere_di_un_testo() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let casi = leggi_cartella(&cartella_famiglie()).expect("i casi si leggono");
    let caso = casi
        .iter()
        .find(|c| c.id == "object.pathfinder.unite" && c.selezione == ["oa1a1a1a1", "od4d4d4d4"])
        .expect("il caso di Unione col testo");
    let (mut disegno, _) =
        fub_disegno::motore::Disegno::apri_con(&disegni, &caso.disegno).expect("si apre");
    let esito = casi::esegui_sul_disegno(&mut disegno, caso)
        .expect("si esegue")
        .expect("senza errore");
    assert_eq!(esito.refused, None, "il testo con Inter entra");
    let ops: serde_json::Value =
        serde_json::from_str(&esito.ops.expect("le operazioni")).expect("json");
    let ops = ops[0]["ops"].as_array().expect("un passo solo").clone();
    let tolti: Vec<&str> = ops
        .iter()
        .filter(|o| o["op"] == "remove")
        .filter_map(|o| o["target"].as_str())
        .collect();
    assert_eq!(tolti.len(), 2, "{ops:?}");
    assert!(tolti.contains(&"oa1a1a1a1") && tolti.contains(&"od4d4d4d4"));
    let aggiunti: Vec<&serde_json::Value> = ops.iter().filter(|o| o["op"] == "add").collect();
    assert_eq!(aggiunti.len(), 1, "{ops:?}");
    let d = aggiunti[0]["elem"]["attrs"]["d"]
        .as_str()
        .expect("un tracciato");
    // Il quadrato e le lettere: C, i (asta e punto), a, o (con i buchi).
    assert!(d.matches('M').count() >= 6, "solo il quadrato? {d}");
}
