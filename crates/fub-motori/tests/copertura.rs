//! Il catalogo dei comandi su un motore finto: `importa` e
//! `verifica_copertura` con i casi limite (`docs/architecture/motori.md`).

use fub_motori::{
    importa, verifica_copertura, Adattamento, Copertura, Delega, Mancanza, Posto, SpecMotore, Tipo,
};

fn spec(id: &str, menu: &[&str], parametri: &str) -> SpecMotore {
    SpecMotore {
        id: id.into(),
        etichetta: format!("Label of {id}"),
        menu: menu.iter().map(|voce| (*voce).to_owned()).collect(),
        parametri: parametri.into(),
    }
}

const POSTI: &[(&[&str], Posto)] = &[
    (
        &["Home", "Font"],
        Posto::Barra {
            scheda: "home",
            gruppo: Some("font"),
        },
    ),
    (
        &["Home"],
        Posto::Barra {
            scheda: "home",
            gruppo: None,
        },
    ),
    (&["Pivot"], Posto::Tavolozza),
];

const NOMI: &[(&str, Tipo)] = &[("range", Tipo::Intervallo), ("header", Tipo::Testo)];

const ADATTAMENTO: Adattamento<'static> = Adattamento {
    posti: POSTI,
    nomi: NOMI,
    nomi_del_comando: &[("table.format", &[("header", Tipo::SiNo)])],
};

fn motore() -> Vec<SpecMotore> {
    vec![
        spec("home.bold", &["Home", "Font"], "{range?, on?: bool}"),
        spec("home.clear", &["Home"], "{range?}"),
        spec("pivot.refresh", &["Pivot"], ""),
        spec("sheet.next", &[], ""),
        spec("table.format", &["Home"], "{range?, header?}"),
        spec("page.margins", &["Home"], "{header?}"),
        spec("file.open", &["File"], "{path}"),
    ]
}

fn non_servito(id: &str) -> Option<&'static str> {
    id.starts_with("file.")
        .then_some("aprire i file è della shell")
}

fn catalogo() -> Vec<fub_motori::ComandoFub> {
    let serviti: Vec<SpecMotore> = motore()
        .into_iter()
        .filter(|s| non_servito(&s.id).is_none())
        .collect();
    importa("fogli", &serviti, &ADATTAMENTO).expect("il catalogo si fa")
}

#[test]
fn un_comando_diventa_un_comando_di_fub() {
    let catalogo = catalogo();
    let grassetto = &catalogo[0];
    assert_eq!(grassetto.id, "fogli.home.bold");
    assert_eq!(grassetto.motore, "home.bold");
    assert_eq!(grassetto.titolo, "fogli.cmd.home.bold");
    assert_eq!(grassetto.etichetta, "Label of home.bold");
    assert_eq!(grassetto.menu_motore, ["Home", "Font"]);
    assert_eq!(
        grassetto.posto,
        Posto::Barra {
            scheda: "home",
            gruppo: Some("font")
        }
    );
    assert_eq!(grassetto.tasti, None);
    assert_eq!(grassetto.abilitato, Delega::Motore("home.bold".into()));
    assert_eq!(
        grassetto
            .parametri
            .campi
            .iter()
            .map(|c| (c.nome.as_str(), &c.tipo))
            .collect::<Vec<_>>(),
        [("range", &Tipo::Intervallo), ("on", &Tipo::SiNo)]
    );
    // Un percorso senza gruppo, la tavolozza per scelta e per menu vuoto.
    assert_eq!(
        catalogo[1].posto,
        Posto::Barra {
            scheda: "home",
            gruppo: None
        }
    );
    assert_eq!(catalogo[2].posto, Posto::Tavolozza);
    assert_eq!(catalogo[3].posto, Posto::Tavolozza);
    assert!(catalogo[3].menu_motore.is_empty());
    // Parametri vuoti: nessun campo.
    assert!(catalogo[2].parametri.campi.is_empty());
}

#[test]
fn un_nome_vuol_dire_cose_diverse_in_comandi_diversi() {
    let catalogo = catalogo();
    let tipo = |id: &str| {
        catalogo
            .iter()
            .find(|c| c.motore == id)
            .unwrap()
            .parametri
            .campi
            .last()
            .unwrap()
            .tipo
            .clone()
    };
    assert_eq!(tipo("table.format"), Tipo::SiNo);
    assert_eq!(tipo("page.margins"), Tipo::Testo);
}

#[test]
fn la_copertura_conta_i_comandi() {
    let copertura = verifica_copertura(&motore(), &catalogo(), &non_servito).expect("copre");
    assert_eq!(
        copertura,
        Copertura {
            importati: 6,
            non_serviti: 1,
            solo_tavolozza: 2,
            senza_menu: 1,
        }
    );
    assert_eq!(
        copertura.to_string(),
        "6 comandi nel catalogo, 1 non serviti; 2 soltanto nella tavolozza, di cui 1 senza menu nel motore"
    );
}

#[test]
fn un_comando_senza_posto_né_perché_non_si_raggiunge() {
    let mut motore = motore();
    motore.push(spec("prova.nuovo", &[], ""));
    assert_eq!(
        verifica_copertura(&motore, &catalogo(), &non_servito),
        Err(vec![Mancanza::Irraggiungibile("prova.nuovo".into())])
    );
}

#[test]
fn il_perché_non_può_essere_vuoto_né_contraddire_il_catalogo() {
    let vuoto = |id: &str| (id == "file.open").then_some(" ");
    assert_eq!(
        verifica_copertura(&motore(), &catalogo(), &vuoto),
        Err(vec![Mancanza::PercheVuoto("file.open".into())])
    );
    let tutti = |_: &str| Some("nessuno");
    let mancanze = verifica_copertura(&motore(), &catalogo(), &tutti).unwrap_err();
    assert_eq!(mancanze.len(), 6);
    assert!(mancanze.contains(&Mancanza::ServitoENonServito("home.bold".into())));
}

#[test]
fn il_catalogo_non_ha_comandi_che_il_motore_non_ha() {
    let mut catalogo = catalogo();
    let mut fantasma = catalogo[0].clone();
    fantasma.motore = "home.ghost".into();
    catalogo.push(fantasma);
    assert_eq!(
        verifica_copertura(&motore(), &catalogo, &non_servito),
        Err(vec![Mancanza::ImportatoSenzaMotore("home.ghost".into())])
    );
}

#[test]
fn un_percorso_che_la_tabella_non_conosce_è_un_errore() {
    let mancanze = importa("fogli", &motore(), &ADATTAMENTO).unwrap_err();
    assert_eq!(
        mancanze,
        vec![Mancanza::PostoSconosciuto {
            id: "file.open".into(),
            menu: vec!["File".into()],
        }]
    );
    // Il percorso si confronta per intero: un pezzo in più non vale.
    let sotto = [spec("home.fontName", &["Home", "Font", "Name"], "")];
    assert!(matches!(
        importa("fogli", &sotto, &ADATTAMENTO).unwrap_err()[..],
        [Mancanza::PostoSconosciuto { .. }]
    ));
}

#[test]
fn id_doppi_id_con_punti_e_id_non_validi() {
    let specifiche = [
        spec("a.b.c", &[], ""),
        spec("a.b.c", &["Home"], ""),
        spec("a..b", &[], ""),
        spec("a b", &[], ""),
        spec("", &[], ""),
    ];
    assert_eq!(
        importa("fogli", &specifiche, &ADATTAMENTO).unwrap_err(),
        vec![
            Mancanza::IdDoppio("a.b.c".into()),
            Mancanza::IdNonValido("a..b".into()),
            Mancanza::IdNonValido("a b".into()),
            Mancanza::IdNonValido(String::new()),
        ]
    );
    // Un id con più punti resta com'è dopo lo spazio.
    let uno = importa("fogli", &specifiche[..1], &ADATTAMENTO).unwrap();
    assert_eq!(uno[0].id, "fogli.a.b.c");
    assert_eq!(uno[0].titolo, "fogli.cmd.a.b.c");
}

#[test]
fn lo_spazio_le_etichette_e_gli_schemi() {
    assert_eq!(
        importa("Fo.gli", &motore(), &ADATTAMENTO).unwrap_err(),
        vec![Mancanza::SpazioNonValido("Fo.gli".into())]
    );
    let mut senza = spec("home.x", &[], "");
    senza.etichetta = " ".into();
    assert_eq!(
        importa("fogli", &[senza], &ADATTAMENTO).unwrap_err(),
        vec![Mancanza::EtichettaVuota("home.x".into())]
    );
    let mancanze = importa("fogli", &[spec("home.y", &[], "{author}")], &ADATTAMENTO).unwrap_err();
    assert!(
        matches!(&mancanze[..], [Mancanza::SchemaIlleggibile { id, errore }] if id == "home.y" && errore.vicino == "author"),
        "{mancanze:?}"
    );
}

#[test]
fn un_motore_senza_comandi() {
    assert_eq!(importa("fogli", &[], &ADATTAMENTO), Ok(Vec::new()));
    assert_eq!(
        verifica_copertura(&[], &[], &non_servito),
        Ok(Copertura::default())
    );
}
