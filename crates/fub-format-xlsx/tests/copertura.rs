//! Ogni comando di GridCraft si raggiunge in Fub: è nel catalogo dei fogli,
//! con un posto e un modulo dei parametri, oppure l'adattatore dice perché
//! non lo serve (`docs/architecture/motori.md`).

use std::collections::BTreeSet;

use fub_format_xlsx::catalogo::{
    comandi, perche_non_servito, specifica, specifiche, voci_non_servite, ADATTAMENTO,
};
use fub_motori::{verifica_copertura, Mancanza, Posto};

fn elenco(mancanze: &[Mancanza]) -> String {
    mancanze
        .iter()
        .map(|m| format!("  - {m}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn ogni_comando_del_motore_si_raggiunge() {
    let catalogo = comandi().unwrap_or_else(|m| panic!("il catalogo non si fa:\n{}", elenco(&m)));
    let copertura = verifica_copertura(&specifiche(), &catalogo, &perche_non_servito)
        .unwrap_or_else(|m| panic!("dei comandi si perdono:\n{}", elenco(&m)));
    println!("copertura dei fogli: {copertura}");
    assert!(copertura.importati > 0);
}

#[test]
fn un_comando_senza_posto_ne_perche_fa_fallire_la_copertura() {
    const PROVA: &str = "prova.senzaPosto";
    gridcraft_engine::register_test_command(PROVA, |_, _| Ok(serde_json::Value::Null));
    let mut motore = specifiche();
    motore.push(specifica(PROVA).expect("il comando di prova è iscritto"));
    let catalogo = comandi().expect("il catalogo si fa");
    let mancanze = verifica_copertura(&motore, &catalogo, &perche_non_servito)
        .expect_err("un comando che nessuno raggiunge fa fallire la copertura");
    assert_eq!(mancanze, vec![Mancanza::Irraggiungibile(PROVA.into())]);
}

#[test]
fn le_voci_dei_non_serviti_non_sono_stantie() {
    let ids: BTreeSet<String> = specifiche().into_iter().map(|spec| spec.id).collect();
    let (esatti, prefissi) = voci_non_servite();
    for id in esatti {
        assert!(
            ids.contains(id),
            "«{id}» è fra i non serviti ma GridCraft non lo ha più"
        );
        assert!(perche_non_servito(id).is_some_and(|p| !p.trim().is_empty()));
    }
    for prefisso in prefissi {
        assert!(
            ids.iter().any(|id| id.starts_with(prefisso)),
            "il prefisso «{prefisso}» fra i non serviti non tocca più nessun comando"
        );
    }
}

#[test]
fn ogni_riga_della_tabella_dei_posti_serve() {
    let catalogo = comandi().expect("il catalogo si fa");
    let usati: BTreeSet<Vec<String>> = catalogo.iter().map(|c| c.menu_motore.clone()).collect();
    for (percorso, _) in ADATTAMENTO.posti {
        let percorso: Vec<String> = percorso.iter().map(|p| (*p).to_owned()).collect();
        assert!(
            usati.contains(&percorso),
            "la riga {percorso:?} della tabella dei posti non serve a nessun comando"
        );
    }
    let mut doppi = BTreeSet::new();
    for (percorso, _) in ADATTAMENTO.posti {
        assert!(doppi.insert(*percorso), "la riga {percorso:?} è due volte");
    }
}

#[test]
fn ogni_comando_ha_id_titolo_e_delega_del_suo_spazio() {
    for comando in comandi().expect("il catalogo si fa") {
        assert_eq!(comando.id, format!("fogli.{}", comando.motore));
        assert_eq!(comando.titolo, format!("fogli.cmd.{}", comando.motore));
        assert_eq!(comando.tasti, None);
        assert_eq!(
            comando.abilitato,
            fub_motori::Delega::Motore(comando.motore.clone())
        );
        if comando.menu_motore.is_empty() {
            assert_eq!(comando.posto, Posto::Tavolozza, "{}", comando.id);
        }
    }
}
