//! Nessun comando del motore del disegno si perde (piano K6, T5): la
//! versione del disegno di `ogni_comando_del_motore_si_raggiunge` di K3
//! (`crates/fub-format-xlsx/tests/copertura.rs`).
//!
//! Ogni `cmd!` del motore ha la sua riga nella mappa; ogni riga fatta ha un
//! posto, un'etichetta e uno schema che si legge; e ogni comando del motore
//! è nell'indice o ha il suo perché (`catalogo::non_servito`), che
//! `fub_motori::verifica_copertura` controlla. Oggi nessuna riga è fatta:
//! le prove con una mappa finta controllano che il controllo cada davvero.

#![cfg(feature = "completo")]

use std::collections::BTreeSet;

use fub_disegno::catalogo::{
    self, indice, mappa, posto_di, voci_di, FonteMappa, RigaMappa, Stato, Voce, SCHEDE,
};
use fub_motori::{verifica_copertura, Gruppo, Mancanza, Scheda, SpecMotore};

/// Le spec di K3 di tutti i comandi del motore: quella della riga, se c'è.
fn spec_del_motore() -> Vec<SpecMotore> {
    vectorcraft_engine::command_specs()
        .iter()
        .map(|c| match catalogo::riga(FonteMappa::Motore, c.id) {
            Some(r) => catalogo::spec(r),
            None => SpecMotore {
                id: c.id.to_string(),
                etichetta: c.label.to_string(),
                menu: c.menu.iter().map(|m| m.to_string()).collect(),
                parametri: String::new(),
                effetto: fub_motori::Effetto::Cambia,
            },
        })
        .collect()
}

/// Le schede ridotte ai gruppi che hanno un comando: K3 vuole che ogni
/// gruppo dell'elenco ne abbia uno, e il Completo riempie i suoi un task
/// alla volta.
fn schede_in_uso(voci: &[Voce]) -> Vec<Scheda> {
    let usati: BTreeSet<(&str, &str)> = voci
        .iter()
        .map(|v| (v.comando.posto.scheda, v.comando.posto.gruppo))
        .collect();
    SCHEDE
        .iter()
        .filter_map(|s| {
            let gruppi: Vec<Gruppo> = s
                .gruppi
                .iter()
                .filter(|g| usati.contains(&(s.id, g.id)))
                .copied()
                .collect();
            (!gruppi.is_empty()).then(|| Scheda {
                gruppi: Box::leak(gruppi.into_boxed_slice()),
                ..*s
            })
        })
        .collect()
}

/// La copertura delle voci del motore, col perché di ogni comando fuori.
fn copertura(
    voci: &[Voce],
    non_servito: &dyn Fn(&str) -> Option<&'static str>,
) -> Result<fub_motori::Copertura, Vec<Mancanza>> {
    let del_motore: Vec<Voce> = voci
        .iter()
        .filter(|v| v.fonte == FonteMappa::Motore)
        .cloned()
        .collect();
    let comandi: Vec<_> = del_motore.iter().map(|v| v.comando.clone()).collect();
    verifica_copertura(
        &spec_del_motore(),
        &comandi,
        &schede_in_uso(&del_motore),
        non_servito,
    )
}

/// Le righe fatte senza posto o senza etichetta.
fn senza_posto_o_etichetta(righe: &[RigaMappa]) -> Vec<String> {
    righe
        .iter()
        .filter(|r| r.stato == Stato::Fatto)
        .filter_map(|r| {
            if posto_di(&r.posto).is_none() {
                Some(format!(
                    "{} {}: il posto «{}» non c'è",
                    r.fonte.nome(),
                    r.id,
                    r.posto
                ))
            } else if r.etichetta.trim().is_empty() || r.etichetta_it.trim().is_empty() {
                Some(format!("{} {}: senza etichetta", r.fonte.nome(), r.id))
            } else {
                None
            }
        })
        .collect()
}

/// I comandi del motore che l'estrazione della mappa non legge: gli stili di
/// carattere e di paragrafo, che `cmd/textstyles.rs` costruisce con
/// `concat!` e non con `cmd!` (`tools/disegno-mappa/estrai.mjs` cerca solo
/// le invocazioni di `cmd!`). Senza riga, `famiglie` non li serve; la loro
/// riga, con la famiglia `testo`, la porta chi estende l'estrazione.
fn senza_riga_perche(id: &str) -> Option<&'static str> {
    let stile = ["charStyle.", "paraStyle."]
        .iter()
        .any(|p| id.starts_with(p));
    (stile && catalogo::riga(FonteMappa::Motore, id).is_none()).then_some(
        "costruito con concat! in cmd/textstyles.rs: l'estrazione della mappa non lo legge",
    )
}

/// Il perché di un comando fuori dall'indice: quello della sua riga, o
/// quello di un comando che la mappa non ha.
fn perche(id: &str) -> Option<&'static str> {
    catalogo::non_servito(id).or_else(|| senza_riga_perche(id))
}

#[test]
fn ogni_comando_del_motore_ha_la_sua_riga() {
    let mancano: Vec<&str> = vectorcraft_engine::command_specs()
        .iter()
        .map(|c| c.id)
        .filter(|id| catalogo::riga(FonteMappa::Motore, id).is_none())
        .filter(|id| senza_riga_perche(id).is_none())
        .collect();
    assert!(
        mancano.is_empty(),
        "comandi del motore senza riga: {mancano:?}"
    );
    // E nessuna riga del motore senza il suo comando, salvo quelle dietro una
    // feature del motore che Fub non accende (`sotto:<feature>`).
    let in_piu: Vec<&str> = mappa()
        .iter()
        .filter(|r| r.fonte == FonteMappa::Motore && r.sotto().is_none())
        .map(|r| r.id.as_str())
        .filter(|id| vectorcraft_engine::find_command(id).is_none())
        .collect();
    assert!(
        in_piu.is_empty(),
        "righe senza comando del motore: {in_piu:?}"
    );
}

#[test]
fn ogni_strumento_e_ogni_effetto_della_mappa_c_e_nel_motore() {
    let strumenti: Vec<&str> = mappa()
        .iter()
        .filter(|r| r.fonte == FonteMappa::Strumento)
        .map(|r| r.id.as_str())
        .filter(|id| vectorcraft_tools::catalog::tool_info(id).is_none())
        .collect();
    assert!(
        strumenti.is_empty(),
        "strumenti senza il motore: {strumenti:?}"
    );
    let del_motore = catalogo::effetti_del_motore();
    assert!(
        !del_motore.is_empty(),
        "il catalogo degli effetti non si legge"
    );
    let effetti: Vec<&str> = mappa()
        .iter()
        .filter(|r| r.fonte == FonteMappa::Effetto)
        .map(|r| r.id.as_str())
        .filter(|id| !del_motore.contains_key(*id))
        .collect();
    assert!(effetti.is_empty(), "effetti senza il motore: {effetti:?}");
}

#[test]
fn ogni_riga_fatta_ha_posto_ed_etichetta() {
    let errori = senza_posto_o_etichetta(mappa());
    assert!(errori.is_empty(), "{}", errori.join("\n"));
}

#[test]
fn ogni_comando_del_motore_e_nell_indice_o_ha_il_suo_perche() {
    let voci = indice().unwrap_or_else(|m| {
        panic!(
            "l'indice non si importa:\n{}",
            m.iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        )
    });
    match copertura(&voci, &perche) {
        Ok(c) => println!("{c}"),
        Err(m) => panic!(
            "{}",
            m.iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n")
        ),
    }
}

/// La mappa con alcune righe fatte.
fn con_fatte(quali: &[(FonteMappa, &str)]) -> Vec<RigaMappa> {
    let mut righe = mappa().to_vec();
    for (fonte, id) in quali {
        let r = righe
            .iter_mut()
            .find(|r| r.fonte == *fonte && r.id == *id)
            .unwrap_or_else(|| panic!("manca la riga {id}"));
        r.stato = Stato::Fatto;
    }
    righe
}

#[test]
fn una_riga_fatta_entra_nell_indice_con_posto_effetto_e_tasto() {
    let righe = con_fatte(&[
        (FonteMappa::Motore, "edit.colors.invert"),
        (FonteMappa::Motore, "edit.duplicate"),
        (FonteMappa::Strumento, "rectangle"),
        (FonteMappa::Effetto, "stylize.roundCorners"),
    ]);
    let fatte: Vec<&RigaMappa> = righe.iter().filter(|r| r.stato == Stato::Fatto).collect();
    let voci = voci_di(&fatte).expect("le righe fatte si importano");
    let gia_fatte = mappa().iter().filter(|r| r.stato == Stato::Fatto).count();
    assert_eq!(voci.len(), 4 + gia_fatte);
    let duplica = voci.iter().find(|v| v.id == "edit.duplicate").unwrap();
    assert_eq!(duplica.comando.id, "disegno.edit.duplicate");
    assert_eq!(duplica.comando.effetto, fub_motori::Effetto::Cambia);
    assert_eq!(
        duplica.tasto,
        vectorcraft_engine::find_command("edit.duplicate").and_then(|c| c.shortcut)
    );
    let rettangolo = voci.iter().find(|v| v.id == "rectangle").unwrap();
    assert_eq!(rettangolo.fonte, FonteMappa::Strumento);
    assert_eq!(rettangolo.tasto, Some("M"), "il tasto dello strumento");
    let angoli = voci
        .iter()
        .find(|v| v.id == "stylize.roundCorners")
        .unwrap();
    assert!(angoli.finestra, "Round Corners… ha una finestra");
    assert!(
        !angoli.comando.parametri.campi.is_empty(),
        "la finestra ha i suoi campi: {:?}",
        angoli.comando.parametri
    );
    // Le voci del motore fatte sono coperte, le altre hanno il perché.
    let non_servito = |id: &str| {
        let r = righe
            .iter()
            .find(|r| r.fonte == FonteMappa::Motore && r.id == id)?;
        (r.stato != Stato::Fatto).then_some("da fare")
    };
    let non_servito = |id: &str| non_servito(id).or_else(|| senza_riga_perche(id));
    copertura(&voci, &non_servito).expect("coperte");
    // Senza il perché, un comando fuori dall'indice cade.
    let errore = copertura(&voci, &|id| (id != "edit.clear").then_some("da fare"))
        .expect_err("edit.clear è fuori senza perché");
    assert!(
        errore
            .iter()
            .any(|m| matches!(m, Mancanza::Irraggiungibile(id) if id == "edit.clear")),
        "{errore:?}"
    );
}

#[test]
fn una_riga_fatta_senza_posto_cade() {
    let mut righe = con_fatte(&[(FonteMappa::Motore, "edit.colors.invert")]);
    let r = righe
        .iter_mut()
        .find(|r| r.id == "edit.colors.invert")
        .unwrap();
    r.posto = "da-nessuna-parte".into();
    let errori = senza_posto_o_etichetta(&righe);
    assert_eq!(errori.len(), 1, "{errori:?}");
    // E non si importa nemmeno.
    let fatte: Vec<&RigaMappa> = righe.iter().filter(|r| r.stato == Stato::Fatto).collect();
    assert!(voci_di(&fatte).is_err());
    // Senza etichetta italiana, anche.
    let mut righe = con_fatte(&[(FonteMappa::Motore, "edit.colors.invert")]);
    righe
        .iter_mut()
        .find(|r| r.id == "edit.colors.invert")
        .unwrap()
        .etichetta_it
        .clear();
    assert_eq!(senza_posto_o_etichetta(&righe).len(), 1);
}
