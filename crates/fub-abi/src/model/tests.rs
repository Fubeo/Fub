//! Test del modello del documento.

use super::*;

/// I `const` dichiarati dentro `pub mod custom_kind`, letti dal sorgente.
///
/// Il salto della prosa è la metà che conta: questo modulo *racconta* i
/// kind nei doc comment, e un estrattore che contasse anche quelli
/// presidierebbe se stesso. Si prendono le sole righe che **sono** una
/// dichiarazione — `pub const NOME: &str = "…";` — e solo dentro il
/// modulo, che comincia alla riga che lo apre.
fn kind_declared() -> Vec<(String, String)> {
    let src = include_str!("../model.rs");
    let within = src
        .split_once("pub mod custom_kind {")
        .expect("the `custom_kind` module is not found in source")
        .1;
    let mut out = Vec::new();
    for row in within.lines() {
        let row = row.trim();
        let Some(rest) = row.strip_prefix("pub const ") else {
            continue;
        };
        // Un `pub const` di **un altro tipo** non è un kind: `PAYLOADS` è la
        // tabella che risponde su di loro, e sta nello stesso modulo. Il
        // salto guarda il tipo scritto, non il nome, così un kind non può
        // sfuggire al conto chiamandosi in un modo invece che in un altro;
        // e se un giorno l'estrattore smettesse di riconoscere la forma,
        // il conto `>= 12` qui sotto è il rosso che se ne accorge.
        let Some((name, value)) = rest.split_once(": &str = ") else {
            continue;
        };
        let value = value
            .trim_end_matches(';')
            .trim_matches('"')
            .trim_matches('\\');
        out.push((name.to_string(), value.to_string()));
    }
    out
}

/// **Ogni `custom_kind` del core dichiara cosa porta, e viceversa.**
///
/// È il presidio del difetto 0095: *dove* stiano i byte di un `Custom` era
/// scritto in tre posti che nessuno teneva allineati — la prosa qui sopra,
/// tre stringhe a campione in `render.rs`, una catena di `if` in
/// `serialize.rs`. Adesso il posto è [`custom_kind::PAYLOADS`], e questo
/// conto è ciò che impedisce al quarto kind di nascere senza una risposta:
/// il compilatore un `const` in più non lo vede, e chi lo aggiunge non ha
/// nessuna ragione di aprire `render.rs`.
///
/// Il conto è nei **due versi** apposta, come l'allowlist di
/// `dependency_invariant.rs`: una riga di `PAYLOADS` che non nomina nessun
/// `const` è un kind rinominato di cui è rimasta l'ombra, e sarebbe una
/// tabella che risponde a un nome che non esiste più.
#[test]
fn every_kind_declares_what_carries() {
    let declared = kind_declared();
    assert!(
        declared.len() >= 12,
        "the extractor read {} declarations: too few to be the reader\n\
             this count believes it has",
        declared.len()
    );

    let without_load: Vec<&str> = declared
        .iter()
        .filter(|(_, v)| custom_kind::payload(v).is_none())
        .map(|(n, _)| n.as_str())
        .collect();
    assert!(
        without_load.is_empty(),
        "{without_load:?} are core `custom_kind`s and do not say where they keep\n\
             their bytes. Add them to `custom_kind::PAYLOADS`: `Children` if the\n\
             content is in children, `Source(key)` if `attrs` already carry the\n\
             source, `Body(key)` if they carry the body of a syntax without its\n\
             delimiter. Without that line the kind renders empty and does not\n\
             serialize, and there is nothing red anywhere."
    );

    let values: Vec<&str> = declared.iter().map(|(_, v)| v.as_str()).collect();
    let fantasmi: Vec<&str> = custom_kind::PAYLOADS
        .iter()
        .map(|(k, _)| *k)
        .filter(|k| !values.contains(k))
        .collect();
    assert!(
        fantasmi.is_empty(),
        "{fantasmi:?} are in `PAYLOADS` and are not `const`s of `custom_kind`:\n\
             it is the shadow of a renamed or removed kind. Remove the line, or the\n\
             table answers a name that no longer exists."
    );
}

/// L'estrattore deve leggere ciò che dice di leggere: le dichiarazioni sì,
/// la prosa che le nomina no.
#[test]
fn the_extractor_of_the_kind_skips_the_prose() {
    let read = kind_declared();
    assert!(read.iter().any(|(n, v)| n == "HTML" && v == "html"));
    assert!(read
        .iter()
        .any(|(n, v)| n == "FRONTMATTER_UNPARSED" && v == "frontmatter-unparsed"));
    // `PAYLOADS` è un `pub const` dello stesso modulo, ed è la tabella, non
    // un kind: l'estrattore lo salta perché il suo tipo non è `&str`.
    assert!(
        !read.iter().any(|(n, _)| n == "PAYLOADS"),
        "the extractor mistook the table for a kind"
    );
    // Il doc di `PAYLOADS` nomina `Source`, `Body` e `Children`, e il doc di
    // `payload` nomina `SyntaxRuleSpec::produces`: nessuno dei quattro è un
    // kind, e nessuno dei quattro deve comparire.
    for name in ["Source", "Body", "Children", "produces"] {
        assert!(
            !read.iter().any(|(n, v)| n == name || v == name),
            "the extractor picked up `{name}` from prose"
        );
    }
}

#[test]
fn docid_page_name_strips_dir_and_ext() {
    assert_eq!(DocId::new("note.md").page_name(), "note");
    assert_eq!(DocId::new("a/b/Nota Lunga.md").page_name(), "Nota Lunga");
    assert_eq!(DocId::new("senza-ext").page_name(), "senza-ext");
}

/// La regola che distingue "risorsa del vault" da "mondo esterno", con i
/// casi su cui un `contains("://")` sbagliava: `mailto:` non ha `//`, e un
/// path di Windows ha i due punti al secondo carattere senza essere un URI.
#[test]
fn classify_tells_a_vault_resource_from_the_outside_world() {
    for external in [
        "https://example.invalid/a",
        "http://x",
        "mailto:a@b.it",
        "tel:+39012",
        "obsidian://open?vault=v",
        "//cdn.example.invalid/a.png",
        "data:image/png;base64,AAAA",
    ] {
        assert_eq!(
            LinkTarget::classify(external),
            LinkTarget::Url(external.to_string()),
            "`{external}` is external"
        );
    }
    for internal in [
        "note/other.md",
        "../attachments/photo.png",
        "/from-root.md",
        "note with spaces.md",
        "C:\\photo\\a.png",
        "#fragment-only",
        "a:b",
    ] {
        assert_eq!(
            LinkTarget::classify(internal),
            LinkTarget::Path(internal.to_string()),
            "`{internal}` belongs to the vault"
        );
    }
}

#[test]
fn wikilink_inner_splits_page_heading_block_and_alias() {
    assert_eq!(
        parse_wikilink_inner("Nota#Sezione^blk|Testo"),
        ParsedWikilink {
            target: LinkTarget::Wiki {
                page: "Nota".into(),
                heading: Some("Sezione".into()),
                block: Some("blk".into()),
            },
            alias: Some("Testo".into()),
        }
    );
    assert_eq!(
        parse_wikilink_inner("Nota").target,
        LinkTarget::wiki("Nota")
    );
    // Un heading vuoto non è un heading: `Nota#^blk` ha un `#` che serve al
    // `^`, e `Nota#` non nomina niente.
    assert_eq!(
        parse_wikilink_inner("Nota#^blk").target,
        LinkTarget::Wiki {
            page: "Nota".into(),
            heading: None,
            block: Some("blk".into()),
        }
    );
    assert_eq!(
        parse_wikilink_inner("Nota#").target,
        LinkTarget::wiki("Nota")
    );
}

/// **Il giro fra i due versi della stessa regola.**
///
/// `wiki_inner` scrive ciò che `parse_wikilink_inner` legge, e la prova che
/// conta è che il giro sia l'identità: una coppia scrittore/lettore può
/// restare d'accordo con sé stessa scrivendo un dialetto che nessun altro
/// legge, ed è esattamente com'era — il serializer markdown scriveva
/// `page^b`, il lettore lo riaccettava perché è indulgente, e Obsidian ci
/// leggeva una pagina di nome `page^b`.
#[test]
fn what_a_wikilink_writes_is_what_a_wikilink_reads() {
    let targets = [
        LinkTarget::wiki("Nota"),
        LinkTarget::Wiki {
            page: "Nota".into(),
            heading: Some("Sezione".into()),
            block: None,
        },
        // Il caso che divergeva: blocco **senza** heading.
        LinkTarget::Wiki {
            page: "Nota".into(),
            heading: None,
            block: Some("blk".into()),
        },
        LinkTarget::Wiki {
            page: "Nota".into(),
            heading: Some("Sezione".into()),
            block: Some("blk".into()),
        },
        // I due che nominano il documento che li ospita (`names_host`).
        LinkTarget::Wiki {
            page: String::new(),
            heading: Some("Sezione".into()),
            block: None,
        },
        LinkTarget::Wiki {
            page: String::new(),
            heading: None,
            block: Some("blk".into()),
        },
    ];
    for t in &targets {
        let inner = t.wiki_inner().expect("a Wiki has an interior");
        assert_eq!(
            &parse_wikilink_inner(&inner).target,
            t,
            "`{inner}` does not re-read as the target that wrote it"
        );
    }
    assert_eq!(
        LinkTarget::Wiki {
            page: "Nota".into(),
            heading: None,
            block: Some("blk".into()),
        }
        .wiki_inner()
        .as_deref(),
        Some("Nota#^blk"),
        "the `#` is not optional because the heading is missing: it is what\n\
             makes that `^` an anchor `^`"
    );
    // L'altro verso: ciò che il lettore accetta per indulgenza torna
    // **canonico** quando lo si riscrive, invece di restare un dialetto.
    assert_eq!(
        parse_wikilink_inner("Nota^blk")
            .target
            .wiki_inner()
            .as_deref(),
        Some("Nota#^blk")
    );
    // E i bersagli che non sono wikilink non hanno un interno da scrivere.
    assert_eq!(
        LinkTarget::Url("https://x.invalid/".into()).wiki_inner(),
        None
    );
    assert_eq!(LinkTarget::Path("a/b.md".into()).wiki_inner(), None);
}

#[test]
fn an_anchor_is_a_key_and_a_heading_slug_is_generated() {
    assert_eq!(canonical_anchor("  Blocco-1 "), "blocco-1");
    assert!(valid_anchor("abc123") && valid_anchor("a-b_c"));
    // Ciò che NON è un'ancora: senza questo, `2^10 = 1024` ne creerebbe una.
    assert!(!valid_anchor("") && !valid_anchor("10 = 1024") && !valid_anchor("a.b"));

    assert_eq!(heading_slug("Ciao Mondo!"), "ciao-mondo");
    assert_eq!(heading_slug("Sezione   con  spazi"), "sezione-con-spazi");
    assert_eq!(heading_slug("A/B & C"), "ab-c");
}

/// Due titoli omonimi non possono portare lo stesso id, e un documento che
/// omonimi non ne ha non deve cambiare **nemmeno un** id: un link già
/// scritto dall'utente punta a uno slug, e riscriverlo sarebbe una
/// regressione silenziosa su ogni nota del vault.
#[test]
fn two_headings_with_the_same_text_cannot_share_an_id() {
    assert_eq!(
        heading_slugs(["Note", "Altro", "Note", "Note"]),
        ["note", "altro", "note-1", "note-2"],
        "the first keeps the pure form, the rest are numbered"
    );
    // Il verso che protegge chi non ha duplicati: identità con la regola
    // pura, titolo per titolo.
    let only = ["Titolo Uno", "Sotto Sezione", "A/B & C", ""];
    assert_eq!(
        heading_slugs(only),
        only.iter().map(|t| heading_slug(t)).collect::<Vec<_>>()
    );
    // Il numero è la prima forma LIBERA, non un contatore per testo: se
    // `note-1` esiste già come titolo suo, il secondo `Note` lo salta
    // invece di rubarglielo.
    assert_eq!(
        heading_slugs(["Note", "Note 1", "Note"]),
        ["note", "note-1", "note-2"]
    );
    // Chi arriva dopo non scaccia chi c'era: se `note-1` se l'è già preso
    // il secondo omonimo, il titolo che si chiama davvero «Note 1» prende
    // la prima forma libera invece del suo id.
    assert_eq!(
        heading_slugs(["Note", "Note", "Note 1"]),
        ["note", "note-1", "note-1-1"]
    );
    // Anche la base vuota (titolo di sola punteggiatura) si disambigua, e
    // resta una forma che `heading_slug` sa produrre — cioè scrivibile in
    // un link.
    assert_eq!(heading_slugs(["...", "???"]), ["", "1"]);
    assert_eq!(heading_slug("1"), "1");
}

/// La gemella che legge: chi cerca un frammento trova esattamente il
/// titolo che quella lista ha nominato, secondo per secondo.
#[test]
fn a_fragment_finds_the_heading_the_allocator_named() {
    let outline: Vec<Heading> = ["Note", "Ciao, Mondo!", "Note"]
        .iter()
        .zip(heading_slugs(["Note", "Ciao, Mondo!", "Note"]))
        .map(|(text, slug)| Heading {
            level: 2,
            text: (*text).to_string(),
            slug,
            span: Span::EMPTY,
            explicit_anchor: None,
        })
        .collect();
    let find = |q: &str| outline.iter().position(|h| heading_matches(q, h));
    assert_eq!(find("Note"), Some(0));
    // La seconda sezione omonima è raggiungibile, e prima non lo era da
    // nessuna sintassi.
    assert_eq!(find("Note 1"), Some(2));
    assert_eq!(find("note-1"), Some(2));
    // Il titolo com'è scritto, punteggiatura compresa, resta una strada.
    assert_eq!(find("Ciao, Mondo!"), Some(1));
    assert_eq!(find("ciao-mondo"), Some(1));
    assert_eq!(find("Sezione che non c'è"), None);
}

/// **Il difetto 0093 era falso sulla conseguenza, e questo lo tiene fermo.**
///
/// Diceva: «`heading_slug` non normalizza in NFC, quindi `# Café` scritto da
/// macOS e lo stesso link digitato altrove danno due slug diversi **e i link
/// si rompono**». La prima metà era vera — era il difetto 0140, che
/// riguardava quattro regole e non una, ed è chiuso: [`heading_slug`] compone
/// col resto (`rules::composition::composed`). La seconda no, e resta la
/// riga che questo banco difende: [`heading_matches`] è una **disgiunzione**,
/// e anche quando il primo ramo taceva il secondo passava da
/// `resolution_key`, che la NFC la faceva. La risoluzione teneva **nei due
/// versi**; ciò che si rompeva era l'`id=` HTML, che di rami ne ha uno solo.
///
/// Senza questo banco qualcuno «riparerebbe» di nuovo la metà che non è
/// rotta, e la strada che salva la risoluzione anche a slug divergenti non
/// sarebbe provata da nessuna parte — perciò il titolo su cui si prova qui è
/// uno che i due rami vedono **diverso**.
#[test]
fn nfd_and_nfc_is_meet_on_the_text_and_not_on_the_slug() {
    let nfc = "Café";
    let nfd = "Cafe\u{301}";
    assert_ne!(
        nfc, nfd,
        "le due forme sono byte diversi, o non si prova niente"
    );

    // Lo slug non diverge più: è la chiusura del 0140, e la coppia completa
    // sta in `crates/fub-abi/tests/una_sola_forma_normalizzata.rs`.
    assert_eq!(heading_slug(nfc), "café");
    assert_eq!(heading_slug(nfd), "café");

    // Il ramo del **testo**, provato da solo. Ci vuole un titolo il cui slug
    // non sia la forma pura, e in un documento vero è il secondo omonimo:
    // `## Café` due volte dà `café` e `café-1`, e chi scrive `[[Nota#Café]]`
    // nomina il testo, non lo slug che gli è toccato.
    let second = |text: &str| Heading {
        level: 2,
        text: text.to_string(),
        slug: format!("{}-1", heading_slug(text)),
        span: Span::EMPTY,
        explicit_anchor: None,
    };
    let written_nfd = second(nfd);
    assert_ne!(
        heading_slug(nfc),
        written_nfd.slug,
        "il primo ramo non deve poter rispondere, o il secondo non è provato"
    );
    assert!(
        heading_matches(nfc, &written_nfd),
        "NFC does not find the NFD title"
    );

    let written_nfc = second(nfc);
    assert!(
        heading_matches(nfd, &written_nfc),
        "NFD does not find the NFC title"
    );
}

#[test]
fn a_task_marker_carries_the_symbol_not_just_a_flag() {
    let m = |symbol| TaskMarker {
        symbol,
        span: Span::EMPTY,
    };
    assert!(m(Some('x')).checked() && m(Some('X')).checked());
    // Gli stati personalizzati (10.1) NON sono "fatto", ma restano leggibili.
    assert!(!m(None).checked() && !m(Some('/')).checked() && !m(Some('-')).checked());
    assert_eq!(m(Some('/')).symbol, Some('/'));
}

#[test]
fn property_registry_round_trips_and_rejects_unknown_schemas() {
    let registry: PropertyTypes = serde_json::from_value(serde_json::json!({
        "version": 1,
        "types": {
            "a": "text", "b": "list", "c": "number", "d": "checkbox",
            "e": "date", "f": "date_time", "g": "tags"
        }
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(&registry).unwrap(),
        serde_json::json!({
            "version": 1,
            "types": {
                "a": "text", "b": "list", "c": "number", "d": "checkbox",
                "e": "date", "f": "date_time", "g": "tags"
            }
        })
    );
    assert_eq!(
        serde_json::to_value(PropertyTypes::default()).unwrap(),
        serde_json::json!({"version": 1, "types": {}})
    );
    assert!(serde_json::from_value::<PropertyTypes>(
        serde_json::json!({"version": 2, "types": {"a": "text"}})
    )
    .is_err());
    assert!(serde_json::from_value::<PropertyTypes>(
        serde_json::json!({"version": 1, "types": {"a": "dateTime"}})
    )
    .is_err());
    assert_eq!(registry.resolve("tags"), Some(PropertyType::Tags));
    assert_eq!(registry.resolve("alias"), Some(PropertyType::List));
}

#[test]
fn declared_types_interpret_without_rewriting_incompatible_source() {
    let source = serde_json::json!({
        "title": "[[Note]]", "list": ["[[Note]]", [1], {"a": 1}, null],
        "number": "10.5", "bad_number": "twelve", "infinite": "NaN",
        "checkbox": "false", "bad_checkbox": "yes",
        "date": "05/07/2026", "date_with_time": "2026-07-05T12:30",
        "date_time": "2026-07-05T12:30Z", "time_without_time": "2026-07-05",
        "tags": "Rust", "bad_tags": ["ok", 5, ["nested"]],
        "aliases": "Other", "alias": ["One", "Two"],
        "cssclasses": "highlight", "cssclass": ["wide"],
        "empty": null, "nested": {"original": ["kept"]}, "scalar_list": "not a list"
    });
    let mut types = PropertyTypes::default();
    for (key, kind) in [
        ("title", PropertyType::Text),
        ("list", PropertyType::List),
        ("number", PropertyType::Number),
        ("bad_number", PropertyType::Number),
        ("infinite", PropertyType::Number),
        ("checkbox", PropertyType::Checkbox),
        ("bad_checkbox", PropertyType::Checkbox),
        ("date", PropertyType::Date),
        ("date_with_time", PropertyType::Date),
        ("date_time", PropertyType::DateTime),
        ("time_without_time", PropertyType::DateTime),
        ("tags", PropertyType::Tags),
        ("bad_tags", PropertyType::Tags),
        ("empty", PropertyType::Number),
        ("nested", PropertyType::Text),
        ("scalar_list", PropertyType::List),
    ] {
        types.types.insert(key.into(), kind);
    }
    let fm = Frontmatter(source.as_object().unwrap().clone());
    let dmy = DateFormats::declaring(DateOrder::Dmy);
    let get = |key| fm.property_with_types(key, &dmy, &types).unwrap();
    assert_eq!(get("title"), PropertyValue::Text("[[Note]]".into()));
    assert_eq!(get("number"), PropertyValue::Number(10.5));
    assert_eq!(get("checkbox"), PropertyValue::Bool(false));
    for key in [
        "bad_number",
        "infinite",
        "bad_checkbox",
        "date_with_time",
        "time_without_time",
        "nested",
    ] {
        assert_eq!(
            get(key),
            PropertyValue::Unknown(source[key].clone()),
            "{key}"
        );
    }
    assert_eq!(get("empty"), PropertyValue::Empty);
    assert_eq!(
        get("date"),
        PropertyValue::Date(PropertyDate {
            year: 2026,
            month: 7,
            day: 5,
            time: None
        })
    );
    assert!(matches!(
        get("date_time"),
        PropertyValue::Date(PropertyDate {
            time: Some(PropertyTime {
                offset_minutes: Some(0),
                ..
            }),
            ..
        })
    ));
    assert_eq!(
        get("list"),
        PropertyValue::List(vec![
            PropertyScalar::Link(LinkTarget::wiki("Note")),
            PropertyScalar::Unknown(serde_json::json!([1])),
            PropertyScalar::Unknown(serde_json::json!({"a": 1})),
            PropertyScalar::Empty,
        ])
    );
    assert_eq!(
        get("scalar_list"),
        PropertyValue::List(vec![PropertyScalar::Text("not a list".into())])
    );
    assert_eq!(
        get("tags"),
        PropertyValue::List(vec![PropertyScalar::Text("Rust".into())])
    );
    assert_eq!(
        get("bad_tags"),
        PropertyValue::List(vec![
            PropertyScalar::Text("ok".into()),
            PropertyScalar::Unknown(serde_json::json!(5)),
            PropertyScalar::Unknown(serde_json::json!(["nested"])),
        ])
    );
    for (key, names) in [
        ("aliases", vec!["Other"]),
        ("alias", vec!["One", "Two"]),
        ("cssclasses", vec!["highlight"]),
        ("cssclass", vec!["wide"]),
    ] {
        assert_eq!(
            get(key),
            PropertyValue::List(
                names
                    .into_iter()
                    .map(|name| PropertyScalar::Text(name.into()))
                    .collect()
            )
        );
    }
    assert_eq!(fm.get("number"), Some(&serde_json::json!("10.5")));
    assert_eq!(
        fm.properties_with_types(&dmy, &types).len(),
        source.as_object().unwrap().len()
    );
    assert_eq!(
        fm.property("title", &dmy),
        Some(PropertyValue::Link(LinkTarget::wiki("Note")))
    );
}

#[test]
fn dates_require_real_calendar_days_in_both_syntaxes() {
    let dmy = DateFormats::declaring(DateOrder::Dmy);
    for (text, formats) in [
        ("2026-02-29", &DateFormats::ISO),
        ("2026-02-31", &DateFormats::ISO),
        ("2024-04-31", &DateFormats::ISO),
        ("29/02/2026", &dmy),
        ("31/04/2024", &dmy),
    ] {
        assert_eq!(
            PropertyValue::normalize(&serde_json::json!(text), formats),
            PropertyValue::Text(text.into())
        );
    }
    for (text, formats) in [
        ("2024-02-29", &DateFormats::ISO),
        ("29/02/2024", &dmy),
        ("2000-02-29", &DateFormats::ISO),
    ] {
        assert!(matches!(
            PropertyValue::normalize(&serde_json::json!(text), formats),
            PropertyValue::Date(_)
        ));
    }
    assert_eq!(
        PropertyValue::normalize(&serde_json::json!("1900-02-29"), &DateFormats::ISO),
        PropertyValue::Text("1900-02-29".into())
    );
}

#[test]
fn properties_are_normalized_by_shape_not_by_guessing() {
    let fm = Frontmatter(
        serde_json::json!({
            "titolo": "Una nota",
            "rating": 4,
            "pubblicata": true,
            "scadenza": "2026-07-25",
            "creata": "2026-07-25T10:30:00+02:00",
            "vuota": null,
            "tag": ["a", "b"],
            "autore": "[[Mario Rossi]]",
            "sito": "https://esempio.it",
            "annidata": { "a": 1 },
        })
        .as_object()
        .unwrap()
        .clone(),
    );
    assert_eq!(
        fm.property("titolo", &DateFormats::ISO),
        Some(PropertyValue::Text("Una nota".into()))
    );
    assert_eq!(
        fm.property("rating", &DateFormats::ISO),
        Some(PropertyValue::Number(4.0))
    );
    assert_eq!(
        fm.property("pubblicata", &DateFormats::ISO),
        Some(PropertyValue::Bool(true))
    );
    assert_eq!(
        fm.property("scadenza", &DateFormats::ISO),
        Some(PropertyValue::Date(PropertyDate {
            year: 2026,
            month: 7,
            day: 25,
            time: None
        }))
    );
    assert_eq!(
        fm.property("creata", &DateFormats::ISO),
        Some(PropertyValue::Date(PropertyDate {
            year: 2026,
            month: 7,
            day: 25,
            time: Some(PropertyTime {
                hour: 10,
                minute: 30,
                second: 0,
                offset_minutes: Some(120)
            }),
        }))
    );
    assert_eq!(
        fm.property("vuota", &DateFormats::ISO),
        Some(PropertyValue::Empty)
    );
    assert_eq!(
        fm.property("tag", &DateFormats::ISO),
        Some(PropertyValue::List(vec![
            PropertyScalar::Text("a".into()),
            PropertyScalar::Text("b".into())
        ]))
    );
    // La lista di liste non è rappresentabile al confine e non si perde:
    // resta JSON dentro la voce.
    assert!(matches!(
        PropertyValue::normalize(&serde_json::json!([["a"], "b"]), &DateFormats::ISO),
        PropertyValue::List(v) if matches!(v[0], PropertyScalar::Unknown(_))
    ));
    // La relazione (8.2) è l'unica stringa che cambia specie...
    assert_eq!(
        fm.property("autore", &DateFormats::ISO),
        Some(PropertyValue::Link(LinkTarget::wiki("Mario Rossi")))
    );
    // ...un URL no: distinguerlo sarebbe indovinare, e `Text` non perde nulla.
    assert_eq!(
        fm.property("sito", &DateFormats::ISO),
        Some(PropertyValue::Text("https://esempio.it".into()))
    );
    assert!(matches!(
        fm.property("annidata", &DateFormats::ISO),
        Some(PropertyValue::Unknown(_))
    ));
    // Chiave assente ≠ chiave senza valore.
    assert_eq!(fm.property("mai-scritta", &DateFormats::ISO), None);
    assert_eq!(fm.properties(&DateFormats::ISO).len(), 10);
}

/// Il parser di date dice di **no** più spesso di quanto dica di sì: ogni
/// falso positivo qui è una stringa dell'utente trasformata in data.
#[test]
fn only_iso_8601_is_a_date() {
    let date = |s: &str| match PropertyValue::normalize(&serde_json::json!(s), &DateFormats::ISO) {
        PropertyValue::Date(d) => Some(d),
        _ => None,
    };
    assert!(date("2026-07-25").is_some());
    assert!(date("2026-07-25 10:30").is_some());
    assert!(
        date("2026-07-25T10:30:00Z")
            .unwrap()
            .time
            .unwrap()
            .offset_minutes
            == Some(0)
    );
    assert!(
        date("2026-07-25T10:30:00.123-05:30")
            .unwrap()
            .time
            .unwrap()
            .offset_minutes
            == Some(-330)
    );
    for not_data in [
        "2026-7-5",
        "26-07-25",
        "2026/07/25",
        "2026-13-01",
        "2026-07-32",
        "2026-07-25X10:30",
        "2026-07-25T25:00",
        "domani",
        "1-2-3",
        "2026-07-25 e poi",
    ] {
        assert!(date(not_data).is_none(), "`{not_data}` is not a date");
    }
}

/// Una dichiarazione **aggiunge** una lettura, non ne cambia nessuna: ciò
/// che era una data ISO resta quella data, ciò che era testo può diventare
/// una data, e niente si muove al contrario.
#[test]
fn a_declared_format_only_adds_readings() {
    let dmy = DateFormats::declaring(DateOrder::Dmy);
    let read = |s: &str, f: &DateFormats| match PropertyValue::normalize(&serde_json::json!(s), f) {
        PropertyValue::Date(d) => Some((d.year, d.month, d.day)),
        _ => None,
    };
    // L'ISO si legge sempre e per primo, dichiarazione o no.
    assert_eq!(read("2026-07-25", &dmy), Some((2026, 7, 25)));
    assert_eq!(read("2026-07-25", &DateFormats::ISO), Some((2026, 7, 25)));
    // Senza dichiarazione niente cambia rispetto a ieri.
    assert_eq!(read("05/07/2026", &DateFormats::ISO), None);
    assert_eq!(read("2026-7-5", &DateFormats::ISO), None);
    // Con la dichiarazione, e **solo** nell'ordine dichiarato.
    assert_eq!(read("05/07/2026", &dmy), Some((2026, 7, 5)));
    assert_eq!(read("5-7-2026", &dmy), Some((2026, 7, 5)));
    assert_eq!(read("5.7.2026", &dmy), Some((2026, 7, 5)));
    assert_eq!(
        read("2026-7-5", &DateFormats::declaring(DateOrder::Ymd)),
        Some((2026, 7, 5))
    );
    // La stessa stringa, due dichiarazioni, due giorni: è precisamente ciò
    // che nessun parser può dedurre e che solo il vault può dire.
    assert_eq!(
        read("07/05/2026", &DateFormats::declaring(DateOrder::Mdy)),
        Some((2026, 7, 5))
    );
    assert_eq!(read("07/05/2026", &dmy), Some((2026, 5, 7)));
}

/// Un formato dichiarato non è un parser tollerante: l'insieme si allarga
/// di poco e per una ragione dichiarata, e tutto il resto continua a dire
/// di no.
#[test]
fn declaring_a_format_is_not_a_tolerant_parser() {
    let each = |s: &str| {
        DateOrder::ALL.into_iter().any(|or| {
            let f = DateFormats::declaring(or);
            matches!(
                PropertyValue::normalize(&serde_json::json!(s), &f),
                PropertyValue::Date(_)
            )
        })
    };
    for not_data in [
        // L'anno a due cifre chiederebbe di indovinare il secolo.
        "05/07/26",
        // Un codice prodotto: è il caso del foglio di calcolo, e resta testo.
        "1-2-3",
        "12-3456-78",
        // Separatori mescolati: due scritture in una non sono una scrittura.
        "05/07-2026",
        // Campi che non sono un giorno né un mese.
        "45/07/2026",
        "00/00/2026",
        // Un campo più largo del suo posto: `007` non è un mese scritto
        // storto, è un'altra cosa. Questo caso è nato dalla verifica del
        // rosso — togliendo il limite di larghezza non diventava rosso
        // niente, perché sul mese e sul giorno ci pensava già `u8` e
        // sull'anno il vincolo delle quattro cifre.
        "5/007/2026",
        // Cifre non ASCII, testo attaccato, e la data con la coda.
        "٠٥/٠٧/٢٠٢٦",
        "05/07/2026 e poi",
        "2026-07-05T10:30 fine",
        "domani",
        "",
    ] {
        assert!(!each(not_data), "`{not_data}` is not a date");
    }
}

/// Il rilevatore è lo stesso parser con tutti gli ordini insieme, e dice di
/// sì esattamente a ciò su cui varrebbe la pena chiedere.
#[test]
fn what_looks_like_a_date_is_what_a_declaration_would_read() {
    for sembra in ["05/07/2026", "2026-7-5", "5.7.2026", " 12/12/2026 "] {
        assert!(DateFormats::looks_like_a_date(sembra), "`{sembra}`");
    }
    for not_seems in ["1-2-3", "domani", "05/07/26", "v1.2.3", "capitolo 3"] {
        assert!(!DateFormats::looks_like_a_date(not_seems), "`{not_seems}`");
    }
}

/// La parola che l'utente sceglie nell'impostazione e quella che serde
/// scrive sono la **stessa tabella**: due copie sarebbero due modi di
/// nominare lo stesso ordine, e il secondo lo leggerebbe solo metà del
/// codice.
#[test]
fn the_word_of_the_setting_is_the_word_of_the_wire() {
    for order in DateOrder::ALL {
        let json = serde_json::to_string(&order).expect("an enum without payload");
        assert_eq!(json, format!("\"{}\"", order.as_key()));
        assert_eq!(DateOrder::from_key(order.as_key()), Some(order));
    }
    assert_eq!(DateOrder::from_key("dd/mm/yyyy"), None);
}

#[test]
fn frontmatter_aliases_accepts_string_or_list() {
    let mut m = serde_json::Map::new();
    m.insert("aliases".into(), serde_json::json!(["A", "B"]));
    assert_eq!(Frontmatter(m).aliases(), vec!["A", "B"]);

    let mut m2 = serde_json::Map::new();
    m2.insert("alias".into(), serde_json::json!("Solo"));
    assert_eq!(Frontmatter(m2).aliases(), vec!["Solo"]);
}

/// Ogni variante di questi enum deve saper attraversare il JSON: l'IPC
/// verso la shell è JSON, e un tipo del contratto che non ci passa non
/// arriva a nessuna view. Col tag *interno* — la forma di `Block` e
/// `Event`, che hanno solo varianti a struct — le varianti che portano uno
/// scalare fallivano a runtime, in silenzio fino al primo cliente vero: le
/// proprietà del frontmatter, che il canale dati della decisione 0005 mette sul filo.
#[test]
fn every_variant_survives_the_json_boundary() {
    fn round_trip<T>(what: &str, value: T)
    where
        T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug,
    {
        let json = serde_json::to_string(&value)
            .unwrap_or_else(|and| panic!("{what} does not serialize: {and}"));
        let back: T = serde_json::from_str(&json)
            .unwrap_or_else(|and| panic!("{what} does not re-read from `{json}`: {and}"));
        assert_eq!(back, value, "{what}: the round-trip changes the value");
    }

    let span = Span::new(0, 1);
    let date = PropertyDate {
        year: 2026,
        month: 7,
        day: 26,
        time: Some(PropertyTime {
            hour: 12,
            minute: 0,
            second: 0,
            offset_minutes: Some(120),
        }),
    };

    for t in [
        LinkTarget::wiki("Pagina"),
        LinkTarget::Url("https://example.invalid".into()),
        LinkTarget::Path("note/a.md".into()),
    ] {
        round_trip("LinkTarget", t);
    }

    for s in [
        PropertyScalar::Empty,
        PropertyScalar::Text("t".into()),
        PropertyScalar::Number(1.5),
        PropertyScalar::Bool(true),
        PropertyScalar::Date(date),
        PropertyScalar::Link(LinkTarget::wiki("P")),
        PropertyScalar::Unknown(serde_json::json!({"a": 1})),
    ] {
        round_trip("PropertyScalar", s);
    }

    for v in [
        PropertyValue::Empty,
        PropertyValue::Text("t".into()),
        PropertyValue::Number(1.5),
        PropertyValue::Bool(true),
        PropertyValue::Date(date),
        PropertyValue::Link(LinkTarget::wiki("P")),
        PropertyValue::List(vec![PropertyScalar::Text("a".into())]),
        PropertyValue::Unknown(serde_json::json!({"a": 1})),
    ] {
        round_trip("PropertyValue", v);
    }

    for the in [
        Inline::Text("t".into()),
        Inline::Emph(vec![Inline::Text("e".into())]),
        Inline::Strong(vec![]),
        Inline::Code("c".into()),
        Inline::Link {
            target: LinkTarget::wiki("P"),
            label: None,
            embed: false,
            span,
        },
        Inline::TagRef {
            name: "t".into(),
            span,
        },
        Inline::Custom {
            custom_kind: "k".into(),
            attrs: serde_json::Value::Null,
            span,
        },
        Inline::Superscript(vec![Inline::Text("s".into())]),
        Inline::Strikethrough(vec![Inline::Text("d".into())]),
        Inline::HardBreak,
        Inline::SoftBreak,
        Inline::Subscript(vec![Inline::Text("p".into())]),
    ] {
        round_trip("Inline", the);
    }
}

/// Un modello con questi blocchi, uno per span, e un frontmatter se `present`.
fn with_blocks(present: bool, blocks: &[(Option<&str>, usize)]) -> DocumentModel {
    let mut model = DocumentModel::empty(DocId::new("n.md"));
    model.frontmatter_present = present;
    model.body = blocks
        .iter()
        .map(|&(kind, start)| match kind {
            Some(kind) => Block::Custom {
                custom_kind: kind.to_string(),
                attrs: serde_json::Value::Null,
                blocks: Vec::new(),
                anchor: None,
                span: Span::new(start, start + 1),
            },
            None => Block::Paragraph {
                inlines: Vec::new(),
                anchor: None,
                span: Span::new(start, start + 1),
            },
        })
        .collect();
    model
}

/// **Il corpo comincia dopo il frontmatter, anche quando il provider non
/// l'ha saputo leggere**, alla riga del primo blocco se il rientro è suo.
#[test]
fn the_body_starts_after_any_frontmatter() {
    let unparsed = Some(custom_kind::FRONTMATTER_UNPARSED);
    let fm = "---\nt: T\n---\n";
    let text = format!("{fm}\n    codice\n");
    let code = text.find("codice").unwrap();
    let row = fm.len() + 1;
    assert_eq!(
        with_blocks(true, &[(None, code)]).body_start(&text),
        Ok(Some(row))
    );
    assert_eq!(
        with_blocks(false, &[(unparsed, 0), (None, code)]).body_start(&text),
        Ok(Some(row))
    );
    assert_eq!(with_blocks(true, &[]).body_start(fm), Ok(Some(fm.len())));
    assert_eq!(
        with_blocks(false, &[(unparsed, 0)]).body_start(fm),
        Ok(Some(fm.len()))
    );
    // Il rientro può essere di tabulazioni, la riga finire con un CR.
    let tabbed = format!("{fm}\r\t x");
    assert_eq!(
        with_blocks(true, &[(None, tabbed.len() - 1)]).body_start(&tabbed),
        Ok(Some(row))
    );
    // Prima del blocco c'è altro che spazi: si entra al blocco.
    let quoted = format!("{fm}> x");
    assert_eq!(
        with_blocks(true, &[(None, fm.len() + 2)]).body_start(&quoted),
        Ok(Some(fm.len() + 2))
    );
    // Senza frontmatter non c'è niente da saltare, nemmeno un blocco qualunque.
    assert_eq!(with_blocks(false, &[(None, 4)]).body_start(&text), Ok(None));
    assert_eq!(
        with_blocks(false, &[(Some(custom_kind::MATH), 0), (None, code)]).body_start(&text),
        Ok(None)
    );
    // Un modello che non viene da quel testo.
    assert_eq!(
        with_blocks(true, &[(None, 99)]).body_start(fm),
        Err(Span::new(99, 100))
    );
}
