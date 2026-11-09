//! Ogni comando di GridCraft si raggiunge in Fub: è nel catalogo dei fogli,
//! con una scheda e un gruppo del menu e un modulo dei parametri, oppure
//! l'adattatore dice perché non lo serve (`docs/architecture/motori.md`).

use std::collections::BTreeSet;

use fub_format_xlsx::catalogo::{
    comandi, importa_da, perche_non_servito, specifica, specifiche, voci_non_servite, ADATTAMENTO,
    SCHEDE,
};
use fub_motori::{verifica_copertura, Mancanza, Scheda};

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
    let copertura = verifica_copertura(&specifiche(), &catalogo, SCHEDE, &perche_non_servito)
        .unwrap_or_else(|m| panic!("dei comandi si perdono:\n{}", elenco(&m)));
    println!("copertura dei fogli: {copertura}");
    assert!(copertura.importati > 0);
    assert_eq!(
        copertura.per_scheda.iter().map(|(_, n)| n).sum::<usize>(),
        copertura.importati
    );
}

#[test]
fn ogni_comando_ha_scheda_e_gruppo() {
    let catalogo = comandi().unwrap_or_else(|m| panic!("il catalogo non si fa:\n{}", elenco(&m)));
    let senza: Vec<String> = catalogo
        .iter()
        .filter(|c| {
            c.posto.scheda.is_empty() || c.posto.gruppo.is_empty() || !Scheda::ha(SCHEDE, c.posto)
        })
        .map(|c| format!("{} → {} › {}", c.id, c.posto.scheda, c.posto.gruppo))
        .collect();
    assert!(
        senza.is_empty(),
        "dei comandi non hanno una scheda e un gruppo del menu:\n{}",
        senza.join("\n")
    );
    // Ogni gruppo del menu ha almeno un comando.
    for scheda in SCHEDE {
        for gruppo in scheda.gruppi {
            assert!(
                catalogo
                    .iter()
                    .any(|c| c.posto.scheda == scheda.id && c.posto.gruppo == gruppo.id),
                "il gruppo «{} › {}» non ha comandi",
                scheda.id,
                gruppo.id
            );
        }
    }
}

#[test]
fn un_comando_nuovo_del_motore_senza_riga_si_nomina() {
    const PROVA: &str = "prova.nuovoSenzaRiga";
    gridcraft_engine::register_test_command(PROVA, |_, _| Ok(serde_json::Value::Null));
    let mut motore = specifiche();
    let nuovo = specifica(PROVA).expect("il comando di prova è iscritto");
    assert!(nuovo.menu.is_empty());
    motore.push(nuovo);
    let mancanze = importa_da(&motore).expect_err("un comando servito senza posto non entra");
    assert_eq!(mancanze, vec![Mancanza::SenzaPosto(PROVA.into())]);
    assert!(mancanze[0].to_string().contains(PROVA));
}

#[test]
fn un_comando_senza_posto_ne_perche_fa_fallire_la_copertura() {
    const PROVA: &str = "prova.senzaPosto";
    gridcraft_engine::register_test_command(PROVA, |_, _| Ok(serde_json::Value::Null));
    let mut motore = specifiche();
    motore.push(specifica(PROVA).expect("il comando di prova è iscritto"));
    let catalogo = comandi().expect("il catalogo si fa");
    let mancanze = verifica_copertura(&motore, &catalogo, SCHEDE, &perche_non_servito)
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
    let per_id: BTreeSet<&str> = ADATTAMENTO
        .posti_del_comando
        .iter()
        .map(|(id, _)| *id)
        .collect();
    // Una riga di un percorso serve se almeno un comando prende il posto da
    // lei, e non dalla riga del suo id.
    let usati: BTreeSet<Vec<String>> = catalogo
        .iter()
        .filter(|c| !per_id.contains(c.motore.as_str()))
        .map(|c| c.menu_motore.clone())
        .collect();
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
    // Una riga di un id nomina un comando del catalogo, una volta sola, e
    // dice qualcosa che il percorso non dice già.
    let mut doppi = BTreeSet::new();
    for (id, posto) in ADATTAMENTO.posti_del_comando {
        assert!(doppi.insert(*id), "la riga di «{id}» è due volte");
        let comando = catalogo
            .iter()
            .find(|c| c.motore == *id)
            .unwrap_or_else(|| {
                panic!("la riga di «{id}» nomina un comando che il catalogo non ha")
            });
        let dal_percorso = ADATTAMENTO
            .posti
            .iter()
            .find(|(percorso, _)| {
                percorso
                    .iter()
                    .copied()
                    .eq(comando.menu_motore.iter().map(String::as_str))
            })
            .map(|(_, posto)| *posto);
        assert_ne!(
            dal_percorso,
            Some(*posto),
            "la riga di «{id}» ripete il posto del suo percorso"
        );
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
    }
}
