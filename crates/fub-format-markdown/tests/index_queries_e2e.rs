//! Il canale dati della decisione 0005 su un vault vero: grafo, proprietà, faccette,
//! salute, finestre.
//!
//! Sta qui e non fra i test del kernel perché serve markdown *vero* — è dal
//! frontmatter e dai link di note scritte a mano che queste query prendono le
//! risposte, e un provider finto proverebbe solo che il kernel sa interrogare
//! sé stesso. Il giro è quello che farà una view (anche in WASM): una
//! `IndexQuery`, una `IndexResult`, nessuna scorciatoia sul `Workspace`.

use camino::Utf8PathBuf;
use fub_abi::model::{DocId, PropertyValue};
use fub_abi::query::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate};
use fub_abi::traits::PluginManifest;
use fub_abi::traits::{
    Excerpts, HealthCheck, IndexQuery, IndexResult, LinkDirection, Page, PropertyFilter,
    PropertySelect, PropertySort, PropertyTest,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Trust, Workspace};

/// Un vault a quattro note:
///
/// - `Progetti/Alpha.md` → `Beta` e un wikilink che non risolve;
/// - `Progetti/Beta.md` → `Alpha`;
/// - `Archivio/Gamma.md` → `Beta`;
/// - `Diario.md` → nessuno, e nessuno la nomina (orfana), con un'immagine.
fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    write(
        "Progetti/Alpha.md",
        "---\ntipo: progetto\nstato: attivo\npriorita: 2\n---\n\
         # Alpha\n\nVedi [[Beta]] e [[Nota che non c'è]]. #lavoro\n",
    );
    write(
        "Progetti/Beta.md",
        "---\ntipo: progetto\nstato: chiuso\npriorita: 10\n---\n\
         Rimanda ad [[Alpha]]. #lavoro\n",
    );
    write(
        "Archivio/Gamma.md",
        "---\ntipo: nota\nstato: attivo\n---\nCita [[Beta]]. #archivio\n",
    );
    // Il `[[#^oggi]]` è un riferimento **dentro** questa nota, e sta qui perché
    // il controllo di salute lo giudicava senza sapere cos'era: un wikilink
    // senza pagina non risolve a nessuna nota, quindi risultava rotto — con la
    // stringa vuota come destinazione da correggere.
    //
    // È un riferimento a **blocco** e non a heading (`[[#Oggi]]`) per una
    // ragione che non è di questa voce: il `#Oggi` dentro le parentesi finisce
    // anche nello scanner dei tag, e la nota si ritrova un tag `Oggi` che
    // nessuno ha scritto. È la divergenza già dichiarata dalla
    // [0060](../../../docs/decisions/0060-il-modello-dice-il-vero-sui-byte.md)
    // e ripetuta dalla 0115 — *«il modello inventa un tag dentro
    // `[[#Sezione]]`»* — e non si chiude di straforo dentro un presidio che
    // guarda un'altra cosa.
    write(
        "Diario.md",
        "---\ntipo: nota\n---\nNessuno mi nomina. ![foto](img/foto.png)\n\n\
         Oggi è andata così. ^oggi\n\nE [[#^oggi]] rimanda quassù.\n",
    );
    // Il PNG esiste **davvero**, e da qui in poi la differenza si vede (§14.1):
    // prima il kernel non sapeva che gli allegati esistessero e il controllo di
    // salute taceva su tutti, quindi questo file poteva anche non esserci.
    // Adesso l'anagrafe lo vede, e il silenzio su questo link è una risposta —
    // «c'è» — invece di un'astensione.
    write("img/foto.png", "\u{89}PNG\r\n\u{1a}\n");

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex");
    (dir, ws)
}

fn query(ws: &Workspace, q: IndexQuery) -> IndexResult {
    ws.query_index(q).expect("il kernel serve questa query")
}

// --- grafo -----------------------------------------------------------------

#[test]
fn the_graph_answers_through_the_contract() {
    let (_g, ws) = vault();

    let IndexResult::Neighbors(out) = query(
        &ws,
        IndexQuery::Neighbors {
            seeds: QueryExpr::docs(vec![DocId::new("Progetti/Beta.md")]),
            direction: LinkDirection::Inbound,
            depth: 1,
            page: None,
        },
    ) else {
        panic!("attesi vicini");
    };
    let sources: Vec<String> = out.items.iter().map(|n| n.doc.to_string()).collect();
    assert_eq!(
        sources,
        ["Archivio/Gamma.md", "Progetti/Alpha.md"],
        "entranti = chi la nomina"
    );
    assert_eq!(out.total, 2);

    // Due passi in avanti da Gamma: Beta (1) e Alpha (2), col `via` che
    // ricostruisce gli archi — è ciò che disegna un grafo locale.
    let IndexResult::Neighbors(walk) = query(
        &ws,
        IndexQuery::Neighbors {
            seeds: QueryExpr::docs(vec![DocId::new("Archivio/Gamma.md")]),
            direction: LinkDirection::Outbound,
            depth: 2,
            page: None,
        },
    ) else {
        panic!("attesi vicini");
    };
    let edges: Vec<(String, String, u8)> = walk
        .items
        .iter()
        .map(|n| (n.via.to_string(), n.doc.to_string(), n.depth))
        .collect();
    assert_eq!(
        edges,
        [
            (
                "Archivio/Gamma.md".to_string(),
                "Progetti/Beta.md".to_string(),
                1
            ),
            (
                "Progetti/Beta.md".to_string(),
                "Progetti/Alpha.md".to_string(),
                2
            ),
        ]
    );
}

// --- proprietà -------------------------------------------------------------

fn filter(key: &str, test: PropertyTest) -> PropertyFilter {
    PropertyFilter {
        key: key.to_string(),
        test,
    }
}

/// I filtri di prima, che erano una lista in AND, sono adesso i **letterali di
/// una clausola**: la stessa domanda, in un linguaggio che sa dire anche l'OR e
/// la negazione.
fn all_of(filters: Vec<PropertyFilter>) -> QueryExpr {
    QueryExpr {
        any: vec![QueryClause {
            all: filters
                .into_iter()
                .map(|f| QueryLiteral {
                    negated: false,
                    predicate: QueryPredicate::Property { filter: f },
                })
                .collect(),
        }],
    }
}

fn rows(ws: &Workspace, q: IndexQuery) -> (Vec<String>, u32) {
    let IndexResult::Documents(page) = query(ws, q) else {
        panic!("attesi documenti");
    };
    (
        page.items.iter().map(|r| r.doc.to_string()).collect(),
        page.total,
    )
}

#[test]
fn documents_filter_sort_and_select_like_a_collection_would() {
    let (_g, ws) = vault();

    let (ids, total) = rows(
        &ws,
        IndexQuery::Documents {
            matching: all_of(vec![filter(
                "tipo",
                PropertyTest::Equals(PropertyValue::Text("progetto".into())),
            )]),
            sort: Some(PropertySort {
                key: "priorita".to_string(),
                descending: true,
            }),
            select: PropertySelect::keys(&["stato"]),
            page: None,
            excerpts: Excerpts::Attach,
        },
    );
    assert_eq!(
        ids,
        ["Progetti/Beta.md", "Progetti/Alpha.md"],
        "priorità decrescente: 10 prima di 2"
    );
    assert_eq!(total, 2);

    // `select` è la lista delle colonne: la riga porta quella, non tutto il
    // frontmatter.
    let IndexResult::Documents(page) = query(
        &ws,
        IndexQuery::Documents {
            matching: all_of(vec![filter(
                "tipo",
                PropertyTest::Equals(PropertyValue::Text("progetto".into())),
            )]),
            sort: None,
            select: PropertySelect::keys(&["stato"]),
            page: None,
            excerpts: Excerpts::Attach,
        },
    ) else {
        panic!("attesi documenti");
    };
    let keys: Vec<&str> = page.items[0]
        .properties
        .iter()
        .map(|p| p.key.as_str())
        .collect();
    assert_eq!(keys, ["stato"]);
}

#[test]
fn a_page_of_documents_is_a_window_over_a_stable_order() {
    let (_g, ws) = vault();
    let all = IndexQuery::Documents {
        matching: QueryExpr::all(),
        sort: None,
        select: PropertySelect::None,
        page: None,
        excerpts: Excerpts::Attach,
    };
    let (everything, total) = rows(&ws, all);
    assert_eq!(total, 4);

    let mut walked = Vec::new();
    for offset in [0, 2] {
        let (ids, page_total) = rows(
            &ws,
            IndexQuery::Documents {
                matching: QueryExpr::all(),
                sort: None,
                select: PropertySelect::None,
                page: Some(Page::new(offset, 2)),
                excerpts: Excerpts::Attach,
            },
        );
        assert_eq!(page_total, 4, "il totale è del vault, non della pagina");
        walked.extend(ids);
    }
    assert_eq!(
        walked, everything,
        "due pagine da due ricompongono l'elenco, senza salti né ripetizioni"
    );
}

#[test]
fn property_values_are_the_facets_of_a_field() {
    let (_g, ws) = vault();
    let IndexResult::PropertyValues(page) = query(
        &ws,
        IndexQuery::PropertyValues {
            key: "tipo".to_string(),
            matching: QueryExpr::all(),
            page: None,
        },
    ) else {
        panic!("attese faccette");
    };
    let facets: Vec<(String, u32)> = page
        .items
        .iter()
        .map(|f| match &f.value {
            PropertyValue::Text(t) => (t.clone(), f.count),
            other => panic!("valore inatteso: {other:?}"),
        })
        .collect();
    assert_eq!(
        facets,
        [("nota".to_string(), 2), ("progetto".to_string(), 2)]
    );

    // Le faccette si contano sul sottoinsieme filtrato: fra le note `attivo`
    // c'è un progetto e una nota.
    let IndexResult::PropertyValues(page) = query(
        &ws,
        IndexQuery::PropertyValues {
            key: "tipo".to_string(),
            matching: all_of(vec![filter(
                "stato",
                PropertyTest::Equals(PropertyValue::Text("attivo".into())),
            )]),
            page: None,
        },
    ) else {
        panic!("attese faccette");
    };
    assert_eq!(page.items.len(), 2);
    assert!(page.items.iter().all(|f| f.count == 1));
}

// --- salute del vault ------------------------------------------------------

#[test]
fn the_health_of_the_vault_is_a_query_like_the_others() {
    let (_g, ws) = vault();

    let IndexResult::VaultHealth(broken) = query(
        &ws,
        IndexQuery::VaultHealth {
            check: HealthCheck::BrokenLinks,
            page: None,
        },
    ) else {
        panic!("atteso un rapporto");
    };
    let reported: Vec<(String, Option<String>)> = broken
        .items
        .iter()
        .map(|i| (i.doc.to_string(), i.detail.clone()))
        .collect();
    assert_eq!(
        reported,
        [(
            "Progetti/Alpha.md".to_string(),
            Some("Nota che non c'è".to_string())
        )],
        "solo il wikilink che non risolve; l'immagine di Diario.md non è un link rotto (§14.1), \
         e nemmeno il `[[#Oggi]]` della stessa nota: un wikilink senza pagina nomina chi lo \
         ospita, e chi lo ospita c'è per costruzione"
    );
    let issue = &broken.items[0];
    let span = issue.span.expect("un link rotto ha un punto nel sorgente");
    let source = ws
        .read_source(&DocId::new("Progetti/Alpha.md"))
        .expect("lettura");
    assert_eq!(
        &source[span.start..span.end],
        "[[Nota che non c'è]]",
        "lo span punta al link, non al documento"
    );

    let IndexResult::VaultHealth(orphans) = query(
        &ws,
        IndexQuery::VaultHealth {
            check: HealthCheck::OrphanDocuments,
            page: None,
        },
    ) else {
        panic!("atteso un rapporto");
    };
    let ids: Vec<String> = orphans.items.iter().map(|i| i.doc.to_string()).collect();
    assert_eq!(
        ids,
        ["Archivio/Gamma.md", "Diario.md"],
        "orfana = nessuno la nomina; Gamma linka ma non è linkata"
    );
}

// --- le vecchie query, con la finestra ------------------------------------

#[test]
fn backlinks_and_tags_keep_their_answer_and_gain_a_window() {
    let (_g, ws) = vault();

    let IndexResult::Backlinks(page) = query(
        &ws,
        IndexQuery::Backlinks {
            target: DocId::new("Progetti/Beta.md"),
            page: Some(Page::first(1)),
        },
    ) else {
        panic!("attesi backlink");
    };
    assert_eq!(page.items.len(), 1, "una pagina da uno");
    assert_eq!(page.total, 2, "ma i backlink sono due");

    let IndexResult::Tags(tags) = query(
        &ws,
        IndexQuery::Tags {
            matching: QueryExpr::all(),
            page: None,
        },
    ) else {
        panic!("attesi tag");
    };
    let names: Vec<(&str, u32)> = tags
        .items
        .iter()
        .map(|t| (t.name.as_str(), t.count))
        .collect();
    assert_eq!(names, [("archivio", 1), ("lavoro", 2)]);
}

// --- il formato delle date, dichiarato dal vault (§8.2) ---------------------

/// Un vault di sole scadenze — una nota per riga, col valore di `scadenza`
/// scritto **come lo scriverebbe chi possiede il vault** — e la chiave
/// `properties.date-format` dichiarata come la dichiara il core.
fn vault_di_scadenze(note: &[(&str, &str)]) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    std::fs::create_dir_all(&root).unwrap();
    for (nome, scadenza) in note {
        std::fs::write(
            root.join(nome),
            format!("---\nscadenza: {scadenza}\n---\nCome l'ha scritta chi l'ha scritta.\n"),
        )
        .unwrap();
    }

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.register_plugin(
        PluginManifest::core("fub.core", "Core")
            .configuring(fub_kernel::properties::properties_settings()),
        Trust::Core,
    )
    .expect("dichiarata");
    ws.reindex().expect("reindex");
    (dir, ws)
}

/// Lo stesso giorno scritto nei due modi in cui lo si trova in un vault vero.
fn vault_con_date() -> (tempfile::TempDir, Workspace) {
    vault_di_scadenze(&[("Iso.md", "2026-07-05"), ("Vecchia.md", "5/7/2026")])
}

/// L'utente dichiara com'è scritto il **suo** vault.
fn dichiara(ws: &mut Workspace, ordine: &str) {
    ws.set_setting(
        fub_kernel::properties::DATE_FORMAT,
        fub_abi::settings::SettingValue::Text(ordine.into()),
    )
    .expect("scritta");
}

fn scadenze_dopo(ws: &Workspace) -> Vec<String> {
    let IndexResult::Documents(page) = query(
        ws,
        IndexQuery::Documents {
            matching: all_of(vec![PropertyFilter {
                key: "scadenza".into(),
                test: PropertyTest::GreaterThan(PropertyValue::Date(
                    fub_abi::model::PropertyDate {
                        year: 2026,
                        month: 1,
                        day: 1,
                        time: None,
                    },
                )),
            }]),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        },
    ) else {
        panic!("attesi documenti");
    };
    page.items.iter().map(|r| r.doc.to_string()).collect()
}

/// **Il giro intero**: l'impostazione che l'utente scrive arriva fino al parser
/// del frontmatter, e il controllo di salute smette di chiedere ciò che gli è
/// stato risposto.
///
/// Non è un dettaglio di plumbing: fra l'impostazione e il parser ci sono un
/// crate senza accesso alle impostazioni (`fub-abi`), un indice che le legge a
/// ogni domanda e quattro funzioni di regola. Un banco che provasse solo il
/// parser passerebbe verde con l'impostazione scollegata.
#[test]
fn il_formato_dichiarato_arriva_fino_al_filtro_e_zittisce_il_controllo() {
    let (_g, mut ws) = vault_con_date();

    assert_eq!(
        scadenze_dopo(&ws),
        ["Iso.md"],
        "senza dichiarazione `5/7/2026` è un testo, e il filtro non la trova"
    );
    let IndexResult::VaultHealth(page) = query(
        &ws,
        IndexQuery::VaultHealth {
            check: HealthCheck::UnrecognizedDates,
            page: None,
        },
    ) else {
        panic!("atteso un rapporto");
    };
    assert_eq!(
        page.items
            .iter()
            .map(|i| (i.doc.to_string(), i.detail.clone()))
            .collect::<Vec<_>>(),
        [(
            "Vecchia.md".to_string(),
            Some("scadenza: 5/7/2026".to_string())
        )],
        "e chi non trova ha il diritto di sapere perché"
    );

    dichiara(&mut ws, "dmy");

    assert_eq!(
        scadenze_dopo(&ws),
        ["Iso.md", "Vecchia.md"],
        "l'indice rilegge la dichiarazione a ogni domanda: senza reindicizzare, \
         e senza toccare un file"
    );
    let IndexResult::VaultHealth(page) = query(
        &ws,
        IndexQuery::VaultHealth {
            check: HealthCheck::UnrecognizedDates,
            page: None,
        },
    ) else {
        panic!("atteso un rapporto");
    };
    assert!(
        page.items.is_empty(),
        "una data dichiarata è una data: il controllo non ripete una domanda \
         a cui è stato risposto"
    );
}

/// Le faccette di `scadenza`: il valore e quante note lo portano.
fn faccette_di_scadenza(ws: &Workspace) -> Vec<(PropertyValue, u32)> {
    let IndexResult::PropertyValues(page) = query(
        ws,
        IndexQuery::PropertyValues {
            key: "scadenza".to_string(),
            matching: QueryExpr::all(),
            page: None,
        },
    ) else {
        panic!("attese faccette");
    };
    page.items
        .iter()
        .map(|f| (f.value.clone(), f.count))
        .collect()
}

/// **Il primo dei due danni che la dichiarazione esiste per togliere**: senza
/// di essa lo stesso giorno scritto in due modi fa *una faccetta per ogni
/// scrittura*, che è ciò che il doc di `HealthCheck::UnrecognizedDates`
/// promette di non far succedere a chi ha dichiarato.
///
/// Il filtro e il controllo di salute avevano già il loro banco; il
/// raggruppamento no, e ci si arriva da una rotta sua
/// (`IndexQuery::PropertyValues`), non dalla coda dei documenti.
#[test]
fn lo_stesso_giorno_scritto_in_due_modi_e_una_faccetta_sola() {
    let (_g, mut ws) = vault_con_date();

    assert_eq!(
        faccette_di_scadenza(&ws),
        [
            (
                PropertyValue::Date(fub_abi::model::PropertyDate {
                    year: 2026,
                    month: 7,
                    day: 5,
                    time: None,
                }),
                1
            ),
            (PropertyValue::Text("5/7/2026".to_string()), 1),
        ],
        "senza dichiarazione il cinque luglio è due faccette: una data e un \
         testo che le somiglia"
    );

    dichiara(&mut ws, "dmy");

    assert_eq!(
        faccette_di_scadenza(&ws),
        [(
            PropertyValue::Date(fub_abi::model::PropertyDate {
                year: 2026,
                month: 7,
                day: 5,
                time: None,
            }),
            2
        )],
        "dichiarato l'ordine, le due scritture sono lo stesso giorno: una \
         faccetta sola, che conta due note — e il valore è una **data**, \
         perché è quello che finisce nel pannello e nel raggruppamento"
    );
}

/// **Il secondo danno**: l'ordinamento. Due scadenze si ordinano per
/// **istante**, non per come sono scritte — e questo è il vault *misto*
/// (due scritture dichiarate e una ISO) su cui la 0108 aveva misurato che il
/// comparatore non è nemmeno un ordine.
///
/// I tre valori sono scelti perché l'ordine per stringa **contraddice** quello
/// per istante: `1/1/2026` viene prima di `2/1/2020` fra i testi e dopo fra i
/// giorni. E si guarda anche il verso discendente, perché un comparatore
/// incoerente non è il rovescio di sé stesso: è lì che la permutazione «che
/// nessuno ha deciso» si vede.
#[test]
fn due_scadenze_si_ordinano_per_istante_e_non_per_stringa() {
    let (_g, mut ws) = vault_di_scadenze(&[
        ("Duemilaventi.md", "2/1/2020"),
        ("Gennaio.md", "1/1/2026"),
        ("Giugno.md", "2026-06-30"),
    ]);
    let per_scadenza = |ws: &Workspace, descending: bool| -> Vec<String> {
        rows(
            ws,
            IndexQuery::Documents {
                matching: all_of(vec![filter("scadenza", PropertyTest::Exists)]),
                sort: Some(PropertySort {
                    key: "scadenza".to_string(),
                    descending,
                }),
                select: PropertySelect::None,
                page: None,
                excerpts: Excerpts::Omit,
            },
        )
        .0
    };

    dichiara(&mut ws, "dmy");

    assert_eq!(
        per_scadenza(&ws, false),
        ["Duemilaventi.md", "Gennaio.md", "Giugno.md"],
        "due gennaio 2020, primo gennaio 2026, trenta giugno 2026: l'ordine \
         dei giorni. Per stringa `1/1/2026` verrebbe per primo"
    );
    assert_eq!(
        per_scadenza(&ws, true),
        ["Giugno.md", "Gennaio.md", "Duemilaventi.md"],
        "e il verso discendente è il rovescio, che è ciò che un ordine è: con \
         un comparatore che rende `Equal` fra specie diverse i due versi non \
         si rovesciano, e la risposta è una permutazione che nessuno ha deciso"
    );
}
