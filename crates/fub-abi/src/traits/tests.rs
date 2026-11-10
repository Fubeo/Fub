//! Test del manifest dei plugin e dei suoi tipi.

use super::*;

/// **Un manifest di prima di K1 si legge come prima**: i campi nuovi
/// prendono i default, e nessun manifest di oggi cambia valore.
#[test]
fn a_manifest_without_the_component_fields_reads_with_defaults() {
    let old = r#"{"id":"acme.x","name":"X","version":"1.0.0","abi_version":"0.2.0",
            "permissions":{"granted":{}},"provides":["acme.x"],"requires":["fub.y"]}"#;
    let m: PluginManifest = serde_json::from_str(old).expect("old manifest reads");
    assert!(m.uses.is_empty());
    assert_eq!(m.kind, ComponentKind::Mode);
    assert_eq!(m.delivery, Delivery::Included);
    assert!(m.ui.is_empty());
    assert_eq!(m.group, None);
    let mut fresh = PluginManifest::new("acme.x", "X");
    fresh.version = "1.0.0".into();
    fresh.provides = vec!["acme.x".into()];
    fresh.requires = vec!["fub.y".into()];
    assert_eq!(m, fresh);
}

/// **Un manifest con tutti i campi di K1 fa il giro serde identico**, e i
/// nomi sul JSON sono `snake_case` come gli altri enum del contratto.
#[test]
fn a_manifest_with_every_component_field_round_trips() {
    for delivery in [
        Delivery::Included,
        Delivery::Edition {
            name: "studio".into(),
        },
        Delivery::Download {
            url: "https://example.org/x.wasm".into(),
            sha256: "ab".repeat(32),
            bytes: 4096,
        },
    ] {
        for kind in [
            ComponentKind::Mode,
            ComponentKind::Engine,
            ComponentKind::Service,
            ComponentKind::Data,
        ] {
            let mut m = PluginManifest::new("acme.x", "X").requiring(&["fub.y"]);
            m.uses = vec!["fub.spell".into(), "fub.y".into()];
            m.kind = kind;
            m.delivery = delivery.clone();
            m.ui = vec!["editors/rich".into()];
            m.group = Some("scrivere".into());
            let json = serde_json::to_string(&m).unwrap();
            let back: PluginManifest = serde_json::from_str(&json).unwrap();
            assert_eq!(back, m, "{json}");
        }
    }
    let json = serde_json::to_value(Delivery::Download {
        url: "u".into(),
        sha256: "s".into(),
        bytes: 1,
    })
    .unwrap();
    assert_eq!(
        json,
        serde_json::json!({"kind":"download","url":"u","sha256":"s","bytes":1})
    );
    assert_eq!(
        serde_json::to_value(ComponentKind::Engine).unwrap(),
        serde_json::json!("engine")
    );
}

/// **`ViewSurface::ALL` copre ogni superficie una volta sola.**
///
/// Stessa forma — e stessa aritmetica — del presidio dei discriminanti di
/// `Capability::ALL`: le varianti sono senza payload, quindi i discriminanti
/// sono contigui da zero, e pretendere che quelli di `ALL` siano
/// esattamente `0..len` vieta insieme i duplicati e i buchi.
///
/// Serve perché chi itera le superfici lo fa per **classificarle** — dove
/// la shell le ospita, dove il dogfooding arriva — e una superficie che
/// sparisse da qui sparirebbe da tutte quelle classificazioni restando
/// verde. È il modo in cui un elenco tenuto a memoria mente: non dicendo il
/// falso, ma tacendo una riga.
///
/// **L'aritmetica da sola non basta, e lo si è scoperto provandola rossa.**
/// Togliere una riga *in mezzo* è rosso, e un doppione è rosso; togliere
/// l'**ultima** e far tornare la lunghezza a nove no — `visti` diventa
/// `[0..8]` e `attesi` pure. Cioè restava scoperto proprio il caso che
/// capita davvero: aggiungo una variante in fondo all'enum e mi dimentico
/// `ALL`. Un conto sa dire se un elenco è coerente **con sé stesso**; non sa
/// quante varianti esistano fuori di lui. Quello lo sa solo il compilatore,
/// ed è il mestiere di `index_declared`.
fn index_declared(surface: ViewSurface) -> usize {
    // Esaustivo apposta e senza `_`: è tutto ciò che questa funzione fa. Una
    // variante nuova non compila finché non le si dà un posto qui, e a quel
    // punto `ALL` che non la contenesse sarebbe rosso di sotto.
    match surface {
        ViewSurface::LeftSidebar => 0,
        ViewSurface::RightSidebar => 1,
        ViewSurface::Bottom => 2,
        ViewSurface::Main => 3,
        ViewSurface::Modal => 4,
        ViewSurface::StatusBar => 5,
        ViewSurface::Ribbon => 6,
        ViewSurface::Menu => 7,
        ViewSurface::ContextMenu => 8,
        ViewSurface::SettingsTab => 9,
    }
}

#[test]
fn the_discriminants_cover_every_surface() {
    assert_eq!(
        ViewSurface::ALL.len(),
        index_declared(ViewSurface::SettingsTab) + 1,
        "`ViewSurface::ALL` è più corto dell'enum: c'è una variante che il \
             compilatore conosce e che l'elenco non nomina. È il caso che \
             l'aritmetica qui sotto non vede — togliere l'ultima riga e far \
             tornare la lunghezza — e che il §16.7 chiama *esaustivo a memoria*."
    );
    for &surface in &ViewSurface::ALL {
        assert_eq!(
            ViewSurface::ALL[index_declared(surface)],
            surface,
            "`{surface:?}` non sta nell'elenco al posto che il contratto le \
                 dà: `ALL` e la dichiarazione dell'enum si sono disallineati."
        );
    }

    let mut seen: Vec<u16> = ViewSurface::ALL.iter().map(|&s| s as u16).collect();
    seen.sort_unstable();
    let expected: Vec<u16> = (0..ViewSurface::ALL.len() as u16).collect();
    assert_eq!(
        seen, expected,
        "`ViewSurface::ALL` non copre una volta sola ogni superficie \
             dell'enum: o una riga è duplicata, o la superficie nuova non è \
             stata aggiunta e la lunghezza è stata fatta tornare con un \
             doppione."
    );
}

/// Il gemello di `index_declared` per i controlli di salute, e per la
/// stessa ragione: `HealthCheck::ALL` ha un chiamante che li vuole **tutti**,
/// e un controllo che sparisse da lì non renderebbe rosso niente — il
/// rapporto diagnostico resterebbe un array valido con una riga in meno.
fn place_of_the_check(check: HealthCheck) -> usize {
    match check {
        HealthCheck::BrokenLinks => 0,
        HealthCheck::OrphanDocuments => 1,
        HealthCheck::CollidingPaths => 2,
        HealthCheck::UnrecognizedDates => 3,
        HealthCheck::DeadEnds => 4,
        HealthCheck::UnusedAttachments => 5,
    }
}

#[test]
fn the_discriminants_cover_every_check_of_health() {
    assert_eq!(
        HealthCheck::ALL.len(),
        place_of_the_check(HealthCheck::UnusedAttachments) + 1,
        "`HealthCheck::ALL` è più corto dell'enum: c'è un controllo che il \
             compilatore conosce e che l'elenco non nomina, quindi il rapporto \
             diagnostico non lo eseguirà mai."
    );
    for &check in &HealthCheck::ALL {
        assert_eq!(
            HealthCheck::ALL[place_of_the_check(check)],
            check,
            "`{check:?}` non sta nell'elenco al posto che il contratto le dà."
        );
    }

    // I due `assert` qui sopra da soli hanno una zona cieca, misurata
    // costruendola: `ALL = [BrokenLinks, BrokenLinks, CollidingPaths]`
    // passa — la lunghezza torna, e il giro visita `BrokenLinks` due volte
    // trovandola al suo posto tutte e due le volte. È il modo in cui un
    // elenco si accorcia senza accorciarsi: si perde una riga e si fa
    // tornare il conto con un doppione. Lo prende l'aritmetica dei
    // discriminanti, che è la stessa di `Capability::ALL`.
    let mut seen: Vec<u16> = HealthCheck::ALL.iter().map(|&c| c as u16).collect();
    seen.sort_unstable();
    let expected: Vec<u16> = (0..HealthCheck::ALL.len() as u16).collect();
    assert_eq!(
        seen, expected,
        "`HealthCheck::ALL` non copre una volta sola ogni controllo \
             dell'enum: o una riga è duplicata, o il controllo nuovo non è \
             stato aggiunto e la lunghezza è stata fatta tornare con un \
             doppione."
    );
}

#[test]
fn the_abi_version_rule_accepts_only_canonical_complete_versions() {
    assert!(abi_compatible(ABI_VERSION), "l'host accetta sé stesso");
    assert!(
        abi_compatible("0.0.0"),
        "la minor inferiore è servibile: post-freeze si cresce per aggiunta"
    );
    assert!(
        abi_compatible("0.1.18446744073709551615"),
        "la patch massima è valida anche se non partecipa alla compatibilità"
    );
    assert!(
        !abi_compatible("18446744073709551615.0.0"),
        "una major valida ma diversa resta incompatibile"
    );

    for version in [
        " 0.1.2",
        "0.1.2 ",
        "0. 1.2",
        "0.1. 2",
        "00.1.2",
        "0.01.2",
        "0.1.02",
        "0.1",
        "0",
        "0.1.2.3",
        "0..2",
        "0.1.",
        "0.+1.2",
        "0.1.-2",
        "18446744073709551616.1.2",
        "0.18446744073709551616.2",
        "0.1.18446744073709551616",
    ] {
        assert!(
            !abi_compatible(version),
            "forma non canonica accettata: {version:?}"
        );
    }
    let (major, rest) = ABI_VERSION.split_once('.').expect("versione ABI completa");
    let (minor, _) = rest.split_once('.').expect("minor e patch ABI");
    let future_minor = minor.parse::<u64>().expect("minor numerica") + 1;
    assert!(
        !abi_compatible(&format!("{major}.{future_minor}.0")),
        "una minor superiore usa cose che l'host non ha"
    );
    assert!(!abi_compatible("1.0.0"), "una major diversa è un rifiuto");
    assert!(!abi_compatible("abc"));
}

#[test]
fn a_window_keeps_the_total_of_what_it_did_not_return() {
    let items: Vec<u32> = (0..10).collect();

    let all = Paged::window(items.clone(), None);
    assert_eq!(all.items.len(), 10, "senza finestra si restituisce tutto");
    assert_eq!((all.offset, all.total), (0, 10));

    let page = Paged::window(items.clone(), Some(Page::new(4, 3)));
    assert_eq!(page.items, vec![4, 5, 6]);
    assert_eq!(
        (page.offset, page.total),
        (4, 10),
        "`total` è il conteggio PRIMA della finestra: senza, chi disegna \
             non sa che esiste una pagina dopo"
    );

    let beyond = Paged::window(items.clone(), Some(Page::new(99, 5)));
    assert!(
        beyond.items.is_empty(),
        "oltre la fine è vuoto, non un errore"
    );
    assert_eq!(beyond.total, 10);

    let none = Paged::window(items, Some(Page::first(0)));
    assert!(
        none.items.is_empty(),
        "limite 0 è nessun elemento — «tutti» si chiede omettendo la Page"
    );
}

#[test]
fn a_job_id_crosses_the_json_boundary_as_a_string() {
    // u64 pieno: come `number` JS perderebbe i bit oltre 2^53.
    let id = JobId(u64::MAX);
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, format!("\"{}\"", u64::MAX));
    assert_eq!(serde_json::from_str::<JobId>(&json).unwrap(), id);
    // I client scritti prima della regola mandavano il numero nudo.
    assert_eq!(serde_json::from_str::<JobId>("7").unwrap(), JobId(7));
}
