//! Il catalogo dei comandi su un motore finto: `importa` e
//! `verifica_copertura` con i casi limite (`docs/architecture/motori.md`).

use fub_motori::{
    importa, verifica_copertura, Adattamento, Copertura, Delega, Effetto, Gruppo, Mancanza, Posto,
    Scheda, SpecMotore, Tipo,
};

fn spec(id: &str, menu: &[&str], parametri: &str) -> SpecMotore {
    SpecMotore {
        id: id.into(),
        etichetta: format!("Label of {id}"),
        menu: menu.iter().map(|voce| (*voce).to_owned()).collect(),
        parametri: parametri.into(),
        effetto: Effetto::Cambia,
    }
}

const fn posto(scheda: &'static str, gruppo: &'static str) -> Posto {
    Posto { scheda, gruppo }
}

const SCHEDE: &[Scheda] = &[
    Scheda {
        id: "home",
        solo: false,
        contesto: None,
        gruppi: &[
            Gruppo {
                id: "font",
                solo: false,
            },
            Gruppo {
                id: "cells",
                solo: false,
            },
            Gruppo {
                id: "selection",
                solo: true,
            },
        ],
    },
    Scheda {
        id: "pivot",
        solo: true,
        contesto: Some("pivot"),
        gruppi: &[Gruppo {
            id: "tables",
            solo: true,
        }],
    },
];

const POSTI: &[(&[&str], Posto)] = &[
    (&["Home", "Font"], posto("home", "font")),
    (&["Home"], posto("home", "cells")),
    (&["Pivot"], posto("pivot", "tables")),
];

const POSTI_DEL_COMANDO: &[(&str, Posto)] = &[
    ("sheet.next", posto("home", "selection")),
    ("page.margins", posto("home", "font")),
];

const NOMI: &[(&str, Tipo)] = &[("range", Tipo::Intervallo), ("header", Tipo::Testo)];

const ADATTAMENTO: Adattamento<'static> = Adattamento {
    schede: SCHEDE,
    posti: POSTI,
    posti_del_comando: POSTI_DEL_COMANDO,
    nomi: NOMI,
    nomi_del_comando: &[("table.format", &[("header", Tipo::SiNo)])],
};

fn motore() -> Vec<SpecMotore> {
    vec![
        spec("home.bold", &["Home", "Font"], "{range?, on?: bool}"),
        spec("home.clear", &["Home"], "{range?}"),
        SpecMotore {
            effetto: Effetto::Legge,
            ..spec("pivot.refresh", &["Pivot"], "")
        },
        SpecMotore {
            effetto: Effetto::Mostra,
            ..spec("sheet.next", &[], "")
        },
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
    assert_eq!(grassetto.posto, posto("home", "font"));
    assert_eq!(grassetto.effetto, Effetto::Cambia);
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
    // Il percorso dà scheda e gruppo; una scheda soltanto del menu.
    assert_eq!(catalogo[1].posto, posto("home", "cells"));
    assert_eq!(catalogo[2].posto, posto("pivot", "tables"));
    // Un comando senza menu nel motore ha la riga del suo id.
    assert_eq!(catalogo[3].posto, posto("home", "selection"));
    assert!(catalogo[3].menu_motore.is_empty());
    // La riga dell'id vale prima di quella del percorso.
    assert_eq!(catalogo[5].motore, "page.margins");
    assert_eq!(catalogo[5].posto, posto("home", "font"));
    // L'effetto è quello che l'adattatore ha deciso.
    assert_eq!(catalogo[2].effetto, Effetto::Legge);
    assert_eq!(catalogo[3].effetto, Effetto::Mostra);
    assert_eq!(
        [Effetto::Cambia, Effetto::Legge, Effetto::Mostra].map(Effetto::nome),
        ["cambia", "legge", "mostra"]
    );
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
    let copertura =
        verifica_copertura(&motore(), &catalogo(), SCHEDE, &non_servito).expect("copre");
    assert_eq!(
        copertura,
        Copertura {
            importati: 6,
            non_serviti: 1,
            per_scheda: vec![("home", 5), ("pivot", 1)],
        }
    );
    assert_eq!(
        copertura.to_string(),
        "6 comandi nel catalogo, 1 non serviti; per scheda: home 5, pivot 1"
    );
}

#[test]
fn un_comando_senza_posto_né_perché_non_si_raggiunge() {
    let mut motore = motore();
    motore.push(spec("prova.nuovo", &[], ""));
    assert_eq!(
        verifica_copertura(&motore, &catalogo(), SCHEDE, &non_servito),
        Err(vec![Mancanza::Irraggiungibile("prova.nuovo".into())])
    );
}

#[test]
fn il_perché_non_può_essere_vuoto_né_contraddire_il_catalogo() {
    let vuoto = |id: &str| (id == "file.open").then_some(" ");
    assert_eq!(
        verifica_copertura(&motore(), &catalogo(), SCHEDE, &vuoto),
        Err(vec![Mancanza::PercheVuoto("file.open".into())])
    );
    let tutti = |_: &str| Some("nessuno");
    let mancanze = verifica_copertura(&motore(), &catalogo(), SCHEDE, &tutti).unwrap_err();
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
        verifica_copertura(&motore(), &catalogo, SCHEDE, &non_servito),
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
        spec("a.b.c", &["Home"], ""),
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
    let mut senza = spec("home.x", &["Home"], "");
    senza.etichetta = " ".into();
    assert_eq!(
        importa("fogli", &[senza], &ADATTAMENTO).unwrap_err(),
        vec![Mancanza::EtichettaVuota("home.x".into())]
    );
    let mancanze = importa(
        "fogli",
        &[spec("home.y", &["Home"], "{author}")],
        &ADATTAMENTO,
    )
    .unwrap_err();
    assert!(
        matches!(&mancanze[..], [Mancanza::SchemaIlleggibile { id, errore }] if id == "home.y" && errore.vicino == "author"),
        "{mancanze:?}"
    );
}

#[test]
fn un_motore_senza_comandi() {
    assert_eq!(importa("fogli", &[], &ADATTAMENTO), Ok(Vec::new()));
    assert_eq!(
        verifica_copertura(&[], &[], &[], &non_servito),
        Ok(Copertura::default())
    );
    // Con un elenco di schede, un catalogo vuoto lascia vuoti tutti i gruppi.
    assert_eq!(
        verifica_copertura(&[], &[], SCHEDE, &non_servito)
            .unwrap_err()
            .len(),
        4
    );
}

#[test]
fn un_comando_senza_menu_e_senza_riga_non_ha_posto() {
    assert_eq!(
        importa("fogli", &[spec("sheet.prev", &[], "")], &ADATTAMENTO),
        Err(vec![Mancanza::SenzaPosto("sheet.prev".into())])
    );
}

#[test]
fn un_posto_fuori_dall_elenco_è_un_errore() {
    let adattamento = Adattamento {
        posti: &[(&["Home"], posto("home", "styles"))],
        posti_del_comando: &[("sheet.next", posto("draw", "pen"))],
        ..ADATTAMENTO
    };
    assert_eq!(
        importa(
            "fogli",
            &[
                spec("home.clear", &["Home"], ""),
                spec("sheet.next", &[], "")
            ],
            &adattamento
        ),
        Err(vec![
            Mancanza::PostoFuoriElenco {
                id: "home.clear".into(),
                scheda: "home".into(),
                gruppo: "styles".into(),
            },
            Mancanza::PostoFuoriElenco {
                id: "sheet.next".into(),
                scheda: "draw".into(),
                gruppo: "pen".into(),
            },
        ])
    );
    // Anche un catalogo fatto altrove si controlla contro l'elenco.
    let mut catalogo = catalogo();
    catalogo[0].posto = posto("home", "styles");
    let mancanze = verifica_copertura(&motore(), &catalogo, SCHEDE, &non_servito).unwrap_err();
    assert!(mancanze.contains(&Mancanza::PostoFuoriElenco {
        id: "home.bold".into(),
        scheda: "home".into(),
        gruppo: "styles".into(),
    }));
}

#[test]
fn un_gruppo_senza_comandi_è_un_errore() {
    let catalogo: Vec<_> = catalogo()
        .into_iter()
        .filter(|comando| comando.motore != "sheet.next")
        .collect();
    let motore: Vec<_> = motore()
        .into_iter()
        .filter(|spec| spec.id != "sheet.next")
        .collect();
    assert_eq!(
        verifica_copertura(&motore, &catalogo, SCHEDE, &non_servito),
        Err(vec![Mancanza::GruppoVuoto {
            scheda: "home".into(),
            gruppo: "selection".into(),
        }])
    );
}

#[test]
fn l_elenco_delle_schede_non_ha_doppi_né_schede_vuote() {
    const DOPPIE: &[Scheda] = &[
        Scheda {
            id: "home",
            solo: false,
            contesto: None,
            gruppi: &[
                Gruppo {
                    id: "font",
                    solo: false,
                },
                Gruppo {
                    id: "font",
                    solo: false,
                },
            ],
        },
        Scheda {
            id: "home",
            solo: false,
            contesto: None,
            gruppi: &[],
        },
    ];
    let adattamento = Adattamento {
        schede: DOPPIE,
        ..ADATTAMENTO
    };
    assert_eq!(
        importa("fogli", &[], &adattamento),
        Err(vec![
            Mancanza::GruppoDoppio {
                scheda: "home".into(),
                gruppo: "font".into(),
            },
            Mancanza::SchedaDoppia("home".into()),
            Mancanza::SchedaVuota("home".into()),
        ])
    );
}
