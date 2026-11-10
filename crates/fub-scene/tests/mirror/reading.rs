//! I test sulle fixture committate: ognuna si scrive, si rilegge e dice
//! ciò che deve.

use super::*;

#[test]
fn sparse_is_a_complete_drawing() {
    let scene = fixture("sparse", &sparse());
    assert!(scene.editable());
    let summary = &scene.summary;
    assert_eq!(summary.layers, ["Livello 1", "Appunti"]);
    assert_eq!(
        (
            summary.counts.strokes,
            summary.counts.shapes,
            summary.counts.foreign
        ),
        (5, 12, 1)
    );
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    use fub_scene::Code::*;
    // L'immagine del vault nel gruppo non ha descrizione: S012. Il verde e il
    // rosa della tavolozza, ciascuno su due forme, si distinguono soltanto
    // per la tinta: S017 per ognuno.
    assert_eq!(codes, [S002, S004, S009, S010, S012, S017, S017]);
    assert_eq!(scene.index.links.len(), 1);
    assert_eq!(scene.index.embeds.len(), 1);
    // La riga coi pezzi si legge intera.
    let Some(Item::Element(text)) = scene
        .items
        .iter()
        .find(|item| matches!(item, Item::Element(e) if e.role == Role::Text))
    else {
        panic!("manca il testo")
    };
    assert_eq!(
        text.lines.as_deref(),
        Some(
            [
                "Evaporazione".to_owned(),
                "& condensa".to_owned(),
                "in pioggia".to_owned()
            ]
            .as_slice()
        )
    );
}

#[test]
fn foreign_has_one_case_per_rule() {
    let scene = fixture("foreign", &foreign());
    assert!(!scene.editable());
    assert!(scene.summary.foreign);
    let editable: Vec<_> = scene
        .items
        .iter()
        .filter_map(|item| match item {
            Item::Element(element) => Some((element.path.clone(), element.role)),
            _ => None,
        })
        .collect();
    assert!(editable.contains(&(vec![4, 1], Role::Path)));
    assert!(editable.contains(&(vec![4, 5], Role::Rect)));
    assert!(editable.contains(&(vec![5, 2], Role::Text)));
    assert!(editable.contains(&(vec![5, 4], Role::Link)));
    // Un'immagine remota resta modificabile; una spezzata dopo il blocco
    // pure.
    assert!(editable.contains(&(vec![6], Role::Image)));
    assert!(editable.contains(&(vec![12], Role::Polyline)));
    // I pezzi fuori da §4, dopo il collegamento: estranei tutti e cinque.
    for at in 5..10 {
        assert!(
            !editable.iter().any(|(path, _)| path.starts_with(&[5, at])),
            "{at}"
        );
    }
    // Prologo, blocchi ed epilogo: dieci blocchi estranei.
    assert_eq!(scene.summary.counts.foreign, 10);
    let s005 = scene
        .diagnostics
        .iter()
        .filter(|d| d.code == fub_scene::Code::S005)
        .count();
    assert_eq!(s005, 4);
}

#[test]
fn resources_are_read_with_their_users() {
    let scene = fixture("resources", &resources());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    assert_eq!(element(&[1]).map(|e| e.role), Some(Role::Defs));
    // Le otto risorse modificabili, la nona estranea.
    for at in 0..8 {
        assert_eq!(
            element(&[1, at]).map(|e| e.role),
            Some(Role::Resource),
            "{at}"
        );
    }
    assert!(element(&[1, 8]).is_none());
    assert_eq!(
        element(&[1, 1]).and_then(|e| e.title.as_deref()),
        Some("Sole")
    );
    use fub_scene::Lifecycle::*;
    assert_eq!(element(&[1, 0]).and_then(|e| e.lifecycle), Some(Private));
    assert_eq!(element(&[1, 3]).and_then(|e| e.lifecycle), Some(Shared));
    // Chi usa una risorsa modificabile è modificabile; i tre estranei no.
    for at in 0..7 {
        assert!(element(&[3, at]).is_some(), "{at}");
    }
    for at in 7..10 {
        assert!(element(&[3, at]).is_none(), "{at}");
    }
    // Le risorse non sono oggetti: non si contano fra le forme, e il loro
    // contenuto non entra nelle voci.
    assert_eq!(
        (
            scene.summary.counts.shapes,
            scene.summary.counts.texts,
            scene.summary.counts.images
        ),
        (5, 2, 1)
    );
    assert!(scene.items.iter().all(|item| match item {
        Item::Element(element) => element.path.len() < 3 || element.path[0] != 1,
        _ => true,
    }));
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    use fub_scene::Code::*;
    // Due blocchi estranei, nella `defs` e nel livello; il giallo sul verde
    // dentro il filtro tace, il riferimento rotto no.
    assert_eq!(codes, [S002, S002, S014]);
    let broken = scene.diagnostics.iter().find(|d| d.code == S014).unwrap();
    assert_eq!(broken.detail.as_deref(), Some("fill #r0000000z"));
}

#[test]
fn swatches_are_read_with_their_names_and_colors() {
    let scene = fixture("swatches", &swatches());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    let swatch = |at: usize| {
        let item = element(&[1, at]).unwrap();
        assert_eq!(item.role, Role::Resource, "{at}");
        (item.lifecycle, item.swatch.clone())
    };
    let named = |name: &str, color: &str| {
        (
            Some(Lifecycle::Swatch),
            Some(Swatch {
                name: name.to_owned(),
                color: color.to_owned(),
            }),
        )
    };
    assert_eq!(swatch(0), named("Blu mare", "#0072b2"));
    assert_eq!(swatch(1), named("Vermiglio", "#d55e00"));
    assert_eq!(swatch(2), named("Verde & bosco", "#008000"));
    // Le sfumature che non hanno la forma di un campione sono risorse senza
    // ciclo di vita.
    for at in 3..10 {
        assert_eq!(swatch(at), (None, None), "{at}");
    }
    assert_eq!(
        element(&[1, 10]).and_then(|e| e.lifecycle),
        Some(Lifecycle::Shared)
    );
    // Un motivo col suo nome è un campione; senza nome non ha ciclo di vita.
    let motif = element(&[1, 12]).unwrap();
    assert_eq!(
        (motif.lifecycle, motif.swatch.clone(), motif.motif.clone()),
        (
            Some(Lifecycle::Swatch),
            None,
            Some(Motif {
                name: "Pois".to_owned()
            })
        )
    );
    for at in 13..15 {
        let item = element(&[1, at]).unwrap();
        assert_eq!((item.lifecycle, item.motif.clone()), (None, None), "{at}");
    }
    // Chi usa un campione è modificabile, anche la linea senza altezza.
    for at in 0..5 {
        assert!(element(&[3, at]).is_some(), "{at}");
    }
    // S009 legge il colore del campione: il blu sotto il nero, e il giallo
    // del testo anche col ripiego nero rimasto indietro.
    let contrasts: Vec<_> = scene
        .diagnostics
        .iter()
        .map(|d| (d.code, d.detail.as_deref()))
        .collect();
    assert_eq!(
        contrasts,
        [
            (fub_scene::Code::S009, Some("4.04")),
            (fub_scene::Code::S009, Some("1.32"))
        ]
    );
}

#[test]
fn text_is_read_in_a_frame_and_along_a_path() {
    let scene = fixture("text", &text());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    // Le due risorse `path` e il titolo dell'arco; il terzo tracciato è
    // estraneo.
    assert_eq!(element(&[1, 0]).map(|e| e.role), Some(Role::Resource));
    assert_eq!(element(&[1, 1]).map(|e| e.role), Some(Role::Resource));
    assert!(element(&[1, 2]).is_none());
    let area = element(&[3, 0]).unwrap();
    assert_eq!(area.wrap, Some(240.0));
    assert_eq!(area.lines.as_ref().map(Vec::len), Some(6));
    let unread = element(&[3, 1]).unwrap();
    assert_eq!(unread.wrap, None);
    let along = element(&[3, 2]).unwrap();
    assert_eq!(along.text_path.as_deref(), Some("r00000001"));
    assert_eq!(
        along.lines.as_deref(),
        Some(["Sopra la collina".to_owned()].as_slice())
    );
    assert_eq!(
        element(&[3, 3]).and_then(|e| e.text_path.as_deref()),
        Some("r00000002")
    );
    assert!(element(&[3, 4]).is_none());
    assert!(element(&[3, 5]).is_none());
    assert_eq!(scene.summary.counts.texts, 4);
    // L'indice unisce senza spazio le righe spezzate dentro una parola, solo
    // in una cornice che si legge.
    let texts: Vec<_> = scene.index.texts.iter().map(|p| p.text.as_str()).collect();
    assert!(texts.contains(
        &"L'acqua del mare sale in cielo e torna giù: precipitevolissimevolmente. \u{a0} Fine."
    ));
    assert!(texts.contains(&"Due righe"));
    assert!(texts.contains(&"Sopra la collina"));
    // L'indice legge anche gli estranei.
    assert!(texts.contains(&"Storto"));
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    use fub_scene::Code::*;
    // Il tracciato estraneo nella `defs` e i due testi estranei.
    assert_eq!(codes, [S002, S002]);
}

#[test]
fn boards_are_read_with_their_papers() {
    let scene = fixture("boards", &boards());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    // Le cinque tavole, dopo il titolo e le sei carte.
    for at in 7..12 {
        assert_eq!(element(&[at]).map(|e| e.role), Some(Role::Board), "{at}");
    }
    for at in 12..17 {
        assert!(element(&[at]).is_none(), "{at}");
    }
    assert!(element(&[17, 0]).is_none());
    let second = element(&[8]).unwrap();
    assert_eq!(second.board_box, Some([700.0, 0.0, 600.0, 400.0]));
    assert_eq!(second.title.as_deref(), Some("  Due\n  tavole "));
    assert!(!second.locked && !second.hidden);
    assert_eq!(
        element(&[1]).and_then(|e| e.board.as_deref()),
        Some("b00000001")
    );
    assert_eq!(
        element(&[6]).map(|e| (e.role, e.board.is_none())),
        Some((Role::Paper, true))
    );
    assert_eq!(
        scene.summary.boards,
        [
            "Copertina",
            "Due tavole",
            "b00000003",
            "Storia",
            "Copertina"
        ]
    );
    let sections: Vec<_> = scene.index.boards.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(sections, scene.summary.boards);
    assert_eq!(scene.index.boards[0].span, element(&[7]).unwrap().span);
    // Le tavole e le carte non sono oggetti.
    assert_eq!(scene.summary.counts.shapes, 1);
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    use fub_scene::Code::*;
    assert_eq!(codes, [S002, S002, S015, S015, S015, S015, S016, S016]);
    let details: Vec<_> = scene
        .diagnostics
        .iter()
        .filter_map(|d| d.detail.as_deref())
        .collect();
    assert_eq!(
        details,
        [
            "c00000002 second",
            "c00000003 board",
            "c00000004 geometry",
            "free",
            "Storia",
            "Copertina"
        ]
    );
}

#[test]
fn legend_finds_the_colors_told_apart_only_by_hue() {
    let scene = fixture("legend", &legend());
    assert!(scene.editable());
    // Il verde chiaro (un campione e un colore in chiaro), il blu chiaro e il
    // blu al 50% sulla carta #f0f0f0: tre codici, ognuno col compagno che
    // contrasta di meno. Il resto non conta, e il rosa e l'arancio non
    // compaiono.
    let found: Vec<_> = scene
        .diagnostics
        .iter()
        .map(|d| (d.code, d.detail.as_deref()))
        .collect();
    use fub_scene::Code::S017;
    assert_eq!(
        found,
        [
            (S017, Some("#b2df8a #a6cee3 1.10")),
            (S017, Some("#a6cee3 #b2df8a 1.10")),
            (S017, Some("#88b4d2 #a6cee3 1.32")),
        ]
    );
}

#[test]
fn connectors_are_read_with_their_ends() {
    let scene = fixture("connectors", &connectors());
    assert!(scene.editable());
    let element = |id: &str| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.id.as_deref() == Some(id) => Some(element),
            _ => None,
        })
    };
    let end = |id: &str, anchor| {
        Some(ConnectorEnd {
            id: id.to_owned(),
            anchor,
        })
    };
    let elbow = element("o00000004").unwrap();
    assert_eq!(elbow.role, Role::Connector);
    let facts = elbow.connector.as_ref().unwrap();
    assert_eq!(facts.geom.kind, ConnectorKind::Elbow);
    assert_eq!(facts.geom.points.len(), 4);
    assert_eq!(facts.from, end("o00000001", Anchor::Top));
    assert_eq!(facts.to, end("o00000002", Anchor::Auto));
    let curve = element("o00000005").unwrap().connector.as_ref().unwrap();
    assert_eq!(curve.geom.kind, ConnectorKind::Curved);
    assert_eq!(curve.to, end("o00000002", Anchor::Left));
    // Un capo senza `fub:to` è libero.
    let free = element("o00000006").unwrap().connector.as_ref().unwrap();
    assert_eq!(free.geom.kind, ConnectorKind::Straight);
    assert_eq!(free.from, end("o00000003", Anchor::Bottom));
    assert_eq!(free.to, None);
    // Un aggancio che non si legge lascia il capo libero, e l'altro resta.
    let loose = element("o00000007").unwrap();
    assert_eq!(loose.role, Role::Connector);
    let loose = loose.connector.as_ref().unwrap();
    assert_eq!(loose.from, None);
    assert_eq!(loose.to, end("o00000003", Anchor::Left));
    // Un `fub:geom` fuori grammatica lascia un tracciato.
    let path = element("o00000009").unwrap();
    assert_eq!((path.role, path.connector.is_none()), (Role::Path, true));
    // L'etichetta dice dove sta; una che non si legge non dice niente.
    let place = element("o00000008").unwrap().along.as_ref().unwrap();
    assert_eq!(place.id, "o00000004");
    assert_eq!((place.t, place.offset), (0.5, 6.0));
    let outside = element("o0000000a").unwrap();
    assert_eq!((outside.role, outside.along.is_none()), (Role::Text, true));
    // L'etichetta di una forma porta l'id; una che non si legge no.
    let label = element("o0000000d").unwrap();
    assert_eq!(label.inside.as_deref(), Some("o0000000c"));
    assert_eq!(label.wrap, Some(115.28));
    let outside = element("o0000000e").unwrap();
    assert_eq!((outside.role, outside.inside.is_none()), (Role::Text, true));
    // Quattro connettori e un tracciato, tre rettangoli e un'ellisse: nove
    // forme.
    assert_eq!(scene.summary.counts.shapes, 9);
    assert_eq!(scene.summary.counts.texts, 4);
    // Nessuna diagnostica: gli agganci non sono riferimenti di cui il formato
    // controlli l'id, e il marcatore c'è.
    use fub_scene::Code::S001;
    let codes: Vec<_> = scene
        .diagnostics
        .iter()
        .map(|d| d.code)
        .filter(|code| *code != S001)
        .collect();
    assert_eq!(codes, []);
}

#[test]
fn styles_are_read_with_their_followers() {
    let scene = fixture("styles", &styles());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    let style = |at: usize| {
        let item = element(&[1, at]).unwrap();
        assert_eq!(item.role, Role::Resource, "{at}");
        (item.lifecycle, item.style.clone())
    };
    let named = |name: &str, kind| {
        (
            Some(Lifecycle::Style),
            Some(StyleFacts {
                name: name.to_owned(),
                kind,
            }),
        )
    };
    assert_eq!(style(1), named("Titolo del capitolo", StyleKind::Text));
    assert_eq!(style(2), named("Nota", StyleKind::Text));
    assert_eq!(style(5), named("Riquadro", StyleKind::Graphic));
    assert_eq!(style(6), named("Avviso", StyleKind::Graphic));
    // Le risorse dello stile restano le loro.
    assert_eq!(style(3), (Some(Lifecycle::Private), None));
    assert_eq!(style(4), (Some(Lifecycle::Shared), None));
    // Ciò che si dice stile senza esserlo è estraneo.
    for at in 7..15 {
        assert!(element(&[1, at]).is_none(), "{at}");
    }
    let follows = |path: &[usize]| element(path).unwrap().follows.clone();
    assert_eq!(follows(&[3, 0]).as_deref(), Some("r00000001"));
    assert_eq!(follows(&[3, 1]).as_deref(), Some("r00000002"));
    assert_eq!(follows(&[3, 2]).as_deref(), Some("r00000004"));
    assert_eq!(follows(&[3, 3]).as_deref(), Some("r00000004"));
    assert_eq!(follows(&[3, 3, 0]), None);
    // Un collegamento e un livello non seguono stili.
    assert_eq!(follows(&[3, 9]), None);
    assert_eq!(follows(&[4]), None);
    use fub_scene::Code::{S002, S018};
    let found: Vec<_> = scene
        .diagnostics
        .iter()
        .map(|d| (d.code, d.detail.as_deref()))
        .collect();
    assert_eq!(
        found,
        [
            (S002, None),
            (S018, Some("r00000004")),
            (S018, Some("r00000001")),
            (S018, Some("r0000000z")),
            (S018, Some("r00000005")),
            (S018, Some("r00000008")),
        ]
    );
    // Gli stili non si contano fra i testi e le forme.
    assert_eq!(scene.summary.counts.texts, 3);
}

#[test]
fn symbols_are_read_with_their_instances() {
    let scene = fixture("symbols", &symbols());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    let role = |path: &[usize]| element(path).map(|e| e.role);
    // I simboli e la sfumatura scritta dopo il primo.
    assert_eq!(role(&[1, 0]), Some(Role::Symbol));
    assert_eq!(role(&[1, 1]), Some(Role::Resource));
    assert_eq!(role(&[1, 2]), Some(Role::Symbol));
    assert_eq!(role(&[1, 8]), Some(Role::Symbol));
    // Il contenuto di un simbolo si classifica come quello di un gruppo.
    assert_eq!(role(&[1, 0, 0]), Some(Role::Title));
    assert_eq!(role(&[1, 0, 1]), Some(Role::Circle));
    assert_eq!(role(&[1, 0, 3]), Some(Role::Text));
    assert_eq!(role(&[1, 2, 2]), Some(Role::Instance));
    assert_eq!(role(&[1, 2, 3]), None);
    assert_eq!(role(&[1, 8, 0]), Some(Role::Circle));
    assert_eq!(role(&[1, 8, 1]), None);
    assert_eq!(
        element(&[1, 0]).and_then(|e| e.title.as_deref()),
        Some("Lampadina")
    );
    assert_eq!(
        element(&[1, 2]).and_then(|e| e.source.as_deref()),
        Some("Simboli/Impianti.svg#r00000004 0123456789abcdef")
    );
    assert_eq!(element(&[1, 0]).and_then(|e| e.source.as_deref()), None);
    // Chi contiene sé stesso e chi ha un attributo che non va è estraneo.
    for at in 3..8 {
        assert!(element(&[1, at]).is_none(), "{at}");
    }
    // Le istanze, col loro simbolo.
    let symbol = |path: &[usize]| element(path).and_then(|e| e.symbol.as_deref());
    assert_eq!(symbol(&[3, 0]), Some("r00000001"));
    assert_eq!(symbol(&[3, 1]), Some("r00000003"));
    assert_eq!(symbol(&[1, 2, 2]), Some("r00000001"));
    assert_eq!(symbol(&[3, 3, 0]), Some("r00000001"));
    assert_eq!(symbol(&[3, 4]), Some("r0000000a"));
    assert_eq!(
        element(&[3, 1]).and_then(|e| e.title.as_deref()),
        Some("Quadro principale")
    );
    for at in 5..13 {
        assert!(element(&[3, at]).is_none(), "{at}");
    }
    // Il contenuto dei simboli si conta una volta; le istanze no.
    let counts = &scene.summary.counts;
    assert_eq!((counts.shapes, counts.texts), (4, 2));
    // Il riquadro viene dalle istanze visibili: la lampadina in (200, 150),
    // il quadro ruotato, che contiene una lampadina, e il cerchio in
    // (600, 400). L'istanza nascosta e il contenuto dei simboli nelle loro
    // coordinate non contano.
    let bbox = scene.summary.bbox.as_ref().unwrap();
    assert_eq!(
        (bbox.x, bbox.y, bbox.width, bbox.height),
        (180.0, 100.0, 425.0, 305.0)
    );
    use fub_scene::Code::{S002, S013, S014};
    let found: Vec<_> = scene
        .diagnostics
        .iter()
        .map(|d| (d.code, d.detail.as_deref()))
        .collect();
    // Niente S009: il testo bianco della lampadina sta nel simbolo, quello
    // sopra l'istanza ha un fondo che non si sa.
    assert_eq!(
        found,
        [
            (S002, None),
            (S002, None),
            (S002, None),
            (S002, None),
            (S013, Some("6.00")),
            (S014, Some("href #r0000000z")),
        ]
    );
}

#[test]
fn repeats_are_read_with_their_copies() {
    let scene = fixture("repeats", &repeats());
    assert!(scene.editable());
    let element = |path: &[usize]| {
        scene.items.iter().find_map(|item| match item {
            Item::Element(element) if element.path == path => Some(element),
            _ => None,
        })
    };
    let role = |path: &[usize]| element(path).map(|e| e.role);
    let original = |path: &[usize]| element(path).and_then(|e| e.original.as_deref());
    // Nel simbolo, la ripetizione dei punti.
    assert_eq!(role(&[1, 0, 2]), Some(Role::Group));
    assert_eq!(role(&[1, 0, 2, 1]), Some(Role::Copy));
    // Il fiore: l'istanza è l'originale, le cinque copie la ruotano.
    assert_eq!(
        element(&[3, 0]).and_then(|e| e.repeat.clone()),
        Some(Repeat::Radial {
            count: 6,
            center: [200.0, 200.0]
        })
    );
    assert_eq!(role(&[3, 0, 1]), Some(Role::Instance));
    for at in 2..7 {
        assert_eq!(role(&[3, 0, at]), Some(Role::Copy), "{at}");
        assert_eq!(original(&[3, 0, at]), Some("o00000011"), "{at}");
    }
    // La griglia, con la copia che ha un titolo.
    assert_eq!(role(&[3, 1, 2]), Some(Role::Copy));
    assert_eq!(
        element(&[3, 1, 2]).and_then(|e| e.title.as_deref()),
        Some("Terza")
    );
    // Lo specchio, col gruppo per originale e la ripetizione dentro.
    assert_eq!(role(&[3, 2, 0]), Some(Role::Group));
    assert_eq!(role(&[3, 2, 0, 1, 1]), Some(Role::Copy));
    assert_eq!(original(&[3, 2, 1]), Some("o00000031"));
    // Gli esempi di ciò che non è una ripetizione o una copia.
    assert_eq!(element(&[3, 4]).and_then(|e| e.repeat.clone()), None);
    assert!(element(&[3, 4, 1]).is_none());
    assert!(element(&[3, 5, 1]).is_none());
    assert!(element(&[3, 5, 2]).is_none());
    assert_eq!(role(&[4]), Some(Role::Layer));
    assert_eq!(element(&[4]).and_then(|e| e.repeat.clone()), None);
    assert!(element(&[4, 1]).is_none());
    // Le copie non si contano, ma il riquadro le comprende: a sinistra i
    // petali ruotati, a destra l'ultima colonna della griglia.
    let counts = &scene.summary.counts;
    assert_eq!((counts.shapes, counts.texts), (8, 1));
    let bbox = scene.summary.bbox.as_ref().unwrap();
    assert_eq!(
        (bbox.x, bbox.y, bbox.width, bbox.height),
        (152.69, 80.0, 457.31, 500.0)
    );
    // Niente S009: il testo bianco sta sopra la copia riflessa.
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    use fub_scene::Code::S002;
    assert_eq!(codes, [S002, S002, S002]);
}

#[test]
fn crlf_bom_moves_utf16_away_from_bytes() {
    let source = crlf_bom();
    let scene = fixture("crlf-bom", &source);
    assert!(scene.bom);
    assert_eq!(scene.line_ending, fub_scene::LineEnding::Crlf);
    assert!(scene.editable());
    let Some(Item::Element(text)) = scene
        .items
        .iter()
        .find(|item| matches!(item, Item::Element(e) if e.role == Role::Text))
    else {
        panic!("manca il testo")
    };
    assert_ne!(text.span.bytes, text.span.utf16);
    assert_eq!(
        text.lines.as_deref(),
        Some(["Perché sì 😀".to_owned(), "𝄞 e ♪".to_owned()].as_slice())
    );
}

#[test]
fn doctype_is_read_only() {
    let scene = fixture("doctype", &doctype());
    assert_eq!(scene.read_only, [fub_scene::ReadOnly::Doctype]);
    assert_eq!(scene.status, fub_scene::Status::Fubdraw);
    // Il titolo con un'entità è estraneo, ma l'indice lo legge.
    assert_eq!(
        scene.index.title.as_ref().map(|t| t.text.as_str()),
        Some("Giardino d'inverno")
    );
}
