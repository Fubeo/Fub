//! Il canale dati con **due** indici veri: quello del kernel (metadati, tag,
//! grafo) e tantivy.
//!
//! È il banco che prima non si poteva montare, perché prima non c'era niente da
//! pianificare: la ricerca era una stringa in un linguaggio di terzi e le
//! proprietà erano un'altra variante, quindi «le note `tipo: progetto` che
//! parlano di rust» non era una domanda esprimibile — era due domande e
//! un'intersezione fatta a mano da chi disegna, cioè una cosa che un plugin non
//! poteva fare e la shell sì.
//!
//! Ogni test qui prova una delle tre metà della seduta 5 messe insieme: il
//! linguaggio (§5.3), il routing dichiarato (§5.2) e le risposte del kernel come
//! provider (§5.1).

use camino::Utf8PathBuf;
use fub_abi::model::{DocId, LinkTarget, PropertyValue};
use fub_abi::query::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextMode, TextQuery};
use fub_abi::traits::{
    DocumentMatch, IndexQuery, IndexResult, LinkDirection, Page, PropertyFilter, PropertySelect,
    PropertySort, PropertyTest,
};
use fub_abi::PluginError;
use fub_features::{SearchIndex, SEARCH_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

/// Un vault in cui testo e frontmatter dicono cose **diverse**: è l'unico modo
/// perché un join possa sbagliare in modo visibile.
fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    // Progetto, parla di rust.
    write(
        "Progetti/Ferrite.md",
        "---\ntipo: progetto\npriorita: 3\n---\n# Ferrite\n\nUn motore in rust. #lavoro\n",
    );
    // Progetto, NON parla di rust.
    write(
        "Progetti/Cucina.md",
        "---\ntipo: progetto\npriorita: 9\n---\nRicette e liste della spesa. #casa\n",
    );
    // Parla di rust ma NON è un progetto.
    write(
        "Appunti/Rust in breve.md",
        "---\ntipo: nota\n---\nAppunti sparsi su rust e i suoi bordi. #lavoro\n",
    );
    // Archiviata: parla di rust ed è un progetto, ma sta altrove.
    write(
        "Archivio/Vecchio.md",
        "---\ntipo: progetto\npriorita: 1\n---\nUn vecchio esperimento in rust. #lavoro/vecchio\n",
    );

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    ws.register_core_feature(SEARCH_ID, SEARCH_ID)
        .expect("dichiarato");
    let data = ws.plugin_data_dir(SEARCH_ID).expect("spazio dati");
    let index = SearchIndex::open(&data).expect("indice");
    ws.register_index_provider(SEARCH_ID, Box::new(index))
        .expect("registrazione e attivazione");
    ws.reindex().expect("reindex");
    (dir, ws)
}

fn lit(predicate: QueryPredicate) -> QueryLiteral {
    QueryLiteral {
        negated: false,
        predicate,
    }
}

fn not(predicate: QueryPredicate) -> QueryLiteral {
    QueryLiteral {
        negated: true,
        predicate,
    }
}

fn clause(all: Vec<QueryLiteral>) -> QueryExpr {
    QueryExpr {
        any: vec![QueryClause { all }],
    }
}

fn testo(q: &str) -> QueryPredicate {
    QueryPredicate::Text(TextQuery::terms(q))
}

fn proprieta(key: &str, test: PropertyTest) -> QueryPredicate {
    QueryPredicate::Property {
        filter: PropertyFilter {
            key: key.to_string(),
            test,
        },
    }
}

fn documenti(ws: &Workspace, matching: QueryExpr) -> Vec<DocumentMatch> {
    pagina(ws, matching, None, PropertySelect::None, None).items
}

fn ids(ws: &Workspace, matching: QueryExpr) -> Vec<String> {
    let mut ids: Vec<String> = documenti(ws, matching)
        .into_iter()
        .map(|d| d.doc.to_string())
        .collect();
    ids.sort();
    ids
}

fn pagina(
    ws: &Workspace,
    matching: QueryExpr,
    sort: Option<PropertySort>,
    select: PropertySelect,
    page: Option<Page>,
) -> fub_abi::traits::Paged<DocumentMatch> {
    match ws.query_index(IndexQuery::Documents {
        matching,
        sort,
        select,
        page,
    }) {
        Ok(IndexResult::Documents(page)) => page,
        other => panic!("attesi documenti, trovato {other:?}"),
    }
}

/// **Il test che conta di più.** Senza di lui gli altri provano due canali che
/// funzionano ognuno per conto suo — che è esattamente ciò che c'era prima.
///
/// La domanda ha due foglie di due proprietari: il testo lo sa solo tantivy (il
/// kernel non indicizza il corpo), il frontmatter lo sa solo il kernel. Nessuno
/// dei due può rispondere da solo, e la risposta non è né l'una né l'altra.
#[test]
fn le_note_di_un_tipo_che_parlano_di_qualcosa() {
    let (_g, ws) = vault();

    let join = clause(vec![
        lit(testo("rust")),
        lit(proprieta(
            "tipo",
            PropertyTest::Equals(PropertyValue::Text("progetto".into())),
        )),
    ]);
    assert_eq!(
        ids(&ws, join),
        ["Archivio/Vecchio.md", "Progetti/Ferrite.md"],
        "chi parla di rust E è un progetto: non la nota (che non è un progetto) \
         né Cucina (che non parla di rust)"
    );

    // Le due metà, da sole, dicono cose diverse: è la prova che l'intersezione
    // non è una delle due travestita.
    assert_eq!(
        ids(&ws, clause(vec![lit(testo("rust"))])),
        [
            "Appunti/Rust in breve.md",
            "Archivio/Vecchio.md",
            "Progetti/Ferrite.md"
        ]
    );
    assert_eq!(
        ids(
            &ws,
            clause(vec![lit(proprieta(
                "tipo",
                PropertyTest::Equals(PropertyValue::Text("progetto".into()))
            ))])
        ),
        [
            "Archivio/Vecchio.md",
            "Progetti/Cucina.md",
            "Progetti/Ferrite.md"
        ]
    );
}

/// La negazione attraversa il confine fra i due indici: «parla di rust ma non
/// sta in Archivio» è una clausola sola con un letterale negato, e il
/// complemento si prende sull'universo del vault.
#[test]
fn una_foglia_negata_toglie_da_ciò_che_laltro_ha_selezionato() {
    let (_g, ws) = vault();
    let q = clause(vec![
        lit(testo("rust")),
        not(QueryPredicate::Folder {
            path: "Archivio".into(),
            descendants: true,
        }),
    ]);
    assert_eq!(
        ids(&ws, q),
        ["Appunti/Rust in breve.md", "Progetti/Ferrite.md"]
    );
}

/// L'OR fra due clausole di proprietari diversi: nessun indice vede l'intera
/// domanda, e la risposta è l'unione delle due metà — senza ripetizioni, perché
/// una nota che soddisfa entrambe compare una volta sola.
#[test]
fn lunione_di_due_clausole_di_proprietari_diversi() {
    let (_g, ws) = vault();
    let q = QueryExpr {
        any: vec![
            QueryClause {
                all: vec![lit(testo("ricette"))],
            },
            QueryClause {
                all: vec![lit(proprieta("priorita", PropertyTest::Exists))],
            },
        ],
    };
    assert_eq!(
        ids(&ws, q),
        [
            "Archivio/Vecchio.md",
            "Progetti/Cucina.md",
            "Progetti/Ferrite.md"
        ],
        "Cucina soddisfa entrambe le clausole e compare una volta"
    );
}

/// Il **pushdown**: se una clausola è tutta di un motore, ci va intera invece
/// di essere ricomposta a mano. È ciò che tiene vero il filtro dentro tantivy
/// (decisione 0005) adesso che l'ambito è una foglia come le altre.
#[test]
fn una_clausola_tutta_di_un_motore_ci_va_intera() {
    let (_g, ws) = vault();
    let q = IndexQuery::Documents {
        matching: clause(vec![
            lit(testo("rust")),
            lit(QueryPredicate::Folder {
                path: "Progetti".into(),
                descendants: true,
            }),
        ]),
        sort: None,
        select: PropertySelect::None,
        page: None,
    };
    let plan = ws.query_plan(&q);
    let step = plan.steps.first().expect("un passo");
    assert!(
        step.pushed_down,
        "la clausola è andata giù intera: {plan:?}"
    );
    assert_eq!(step.evaluator.as_deref(), Some(SEARCH_ID));

    match ws.query_index(q) {
        Ok(IndexResult::Documents(page)) => {
            assert_eq!(page.items.len(), 1);
            assert_eq!(page.items[0].doc, DocId::new("Progetti/Ferrite.md"));
            assert_eq!(
                page.total, 1,
                "il totale viene dal motore, non da un ritaglio a valle"
            );
        }
        other => panic!("attesi documenti, trovato {other:?}"),
    }

    // E quando la clausola è mista, il pushdown non c'è e il piano lo dice: le
    // due foglie vanno ai due proprietari e il kernel ricompone.
    let mista = ws.query_plan(&IndexQuery::Documents {
        matching: clause(vec![
            lit(testo("rust")),
            lit(proprieta("tipo", PropertyTest::Exists)),
        ]),
        sort: None,
        select: PropertySelect::None,
        page: None,
    });
    assert!(mista.steps.iter().all(|s| !s.pushed_down));
    let a_chi: Vec<Option<&str>> = mista.steps.iter().map(|s| s.evaluator.as_deref()).collect();
    assert_eq!(a_chi, [Some(SEARCH_ID), Some(fub_kernel::CORE_ID)]);
}

/// La riga di una risposta porta ciò che le è stato chiesto, e l'ordine è
/// quello che si è chiesto: un elenco di risultati è una **collezione**, non
/// una lista di titoli, e le due cose erano due varianti separate.
#[test]
fn una_riga_porta_rilevanza_estratto_e_colonne_insieme() {
    let (_g, ws) = vault();
    let page = pagina(
        &ws,
        clause(vec![lit(testo("rust"))]),
        Some(PropertySort {
            key: "priorita".into(),
            descending: true,
        }),
        PropertySelect::keys(&["tipo", "priorita"]),
        None,
    );
    let righe: Vec<(String, Vec<String>)> = page
        .items
        .iter()
        .map(|d| {
            (
                d.doc.to_string(),
                d.properties.iter().map(|p| p.key.clone()).collect(),
            )
        })
        .collect();
    assert_eq!(
        righe,
        [
            (
                "Progetti/Ferrite.md".to_string(),
                vec!["priorita".to_string(), "tipo".to_string()]
            ),
            (
                "Archivio/Vecchio.md".to_string(),
                vec!["priorita".to_string(), "tipo".to_string()]
            ),
            // Chi non ha la chiave di ordinamento va in fondo, in entrambi i
            // versi: è la regola delle proprietà, e non cambia perché adesso a
            // ordinare è il pianificatore.
            (
                "Appunti/Rust in breve.md".to_string(),
                vec!["tipo".to_string()]
            ),
        ]
    );
    assert!(
        page.items[0].score.is_some(),
        "la rilevanza c'è: a selezionare è stato (anche) del testo"
    );
    assert!(page.items[0].snippet.is_some());
}

/// I tag di un **sottoinsieme**: le faccette che la decisione 0005 aveva
/// dichiarato fuori portata («servono un campo facet nel motore, e la decisione
/// di chi le calcola»). Con un linguaggio non servono: il sottoinsieme è una
/// query, e i tag li conta chi li ha in cache.
#[test]
fn i_tag_di_un_risultato_sono_le_sue_faccette() {
    let (_g, ws) = vault();

    let tutti = match ws.query_index(IndexQuery::Tags {
        matching: QueryExpr::all(),
        page: None,
    }) {
        Ok(IndexResult::Tags(t)) => t.items,
        other => panic!("attesi tag, trovato {other:?}"),
    };
    assert_eq!(
        tutti
            .iter()
            .map(|t| (t.name.as_str(), t.count))
            .collect::<Vec<_>>(),
        [("casa", 1), ("lavoro", 2), ("lavoro/vecchio", 1)]
    );

    // Le faccette di «chi parla di rust»: la domanda attraversa i due indici —
    // il sottoinsieme lo sceglie tantivy, i tag li conta il kernel.
    let faccette = match ws.query_index(IndexQuery::Tags {
        matching: clause(vec![lit(testo("rust"))]),
        page: None,
    }) {
        Ok(IndexResult::Tags(t)) => t.items,
        other => panic!("attesi tag, trovato {other:?}"),
    };
    assert_eq!(
        faccette
            .iter()
            .map(|t| (t.name.as_str(), t.count))
            .collect::<Vec<_>>(),
        [("lavoro", 2), ("lavoro/vecchio", 1)],
        "#casa non c'è: Cucina non parla di rust"
    );
}

/// Il grafo intero in **una** domanda, che è ciò che rende inutile un comando
/// bespoke sull'IPC (§5.4): semi = tutto il vault, un passo, verso uscente.
#[test]
fn il_grafo_intero_e_una_domanda_sola() {
    let (_g, ws) = vault();
    // Ferrite → Cucina, così c'è almeno un arco da trovare.
    ws.read_source(&DocId::new("Progetti/Ferrite.md"))
        .expect("la nota c'è");
    let mut ws = ws;
    ws.write_document(
        &DocId::new("Progetti/Ferrite.md"),
        "---\ntipo: progetto\npriorita: 3\n---\nUn motore in rust, vedi [[Cucina]]. #lavoro\n",
    )
    .expect("scrittura");

    let archi = match ws.query_index(IndexQuery::Neighbors {
        seeds: QueryExpr::all(),
        direction: LinkDirection::Outbound,
        depth: 1,
        page: None,
    }) {
        Ok(IndexResult::Neighbors(n)) => n.items,
        other => panic!("attesi vicini, trovato {other:?}"),
    };
    let disegnati: Vec<(String, String)> = archi
        .iter()
        .map(|n| (n.via.to_string(), n.doc.to_string()))
        .collect();
    assert_eq!(
        disegnati,
        [(
            "Progetti/Ferrite.md".to_string(),
            "Progetti/Cucina.md".to_string()
        )],
        "a un passo il `via` è il seme: ogni riga È un arco"
    );
}

/// Una domanda che nessuno serve non è una risposta vuota, ed è la diagnostica
/// che il routing dichiarato porta con sé (§5.2 + §12.2).
#[test]
fn ciò_che_nessuno_serve_lo_dice() {
    let (_g, ws) = vault();
    let r = ws.query_index(IndexQuery::Custom {
        ns: "plugin.che.non.ce".into(),
        query: serde_json::Value::Null,
    });
    assert!(matches!(r, Err(PluginError::Unserved(_))), "{r:?}");

    // E ciò che qualcuno serve ma che non trova niente resta una risposta.
    assert!(documenti(&ws, clause(vec![lit(testo("brontosauro"))])).is_empty());
}

/// «Ogni documento» detto con una clausola vuota **in mezzo ad altre** resta
/// ogni documento, anche per chi non saprebbe valutare le foglie che le stanno
/// accanto.
///
/// È la forma che un query builder produce da solo: un gruppo di righe ancora
/// vuoto accanto a uno riempito. L'espressione è tutta per l'identità dell'OR,
/// ma le sue foglie hanno proprietari diversi — e il pianificatore consegnava
/// al destinatario l'albero originale invece di quello risolto, così l'indice
/// del kernel riceveva una foglia di testo e rispondeva `Unserved` a una
/// domanda la cui risposta è tutto. Si vedeva su `PropertyValues` e
/// `Neighbors`; `Tags` si salvava per una guardia propria e `Documents` perché
/// il routing manda la foglia al suo proprietario.
#[test]
fn una_clausola_vuota_accanto_a_una_foglia_altrui_resta_ogni_documento() {
    let (_g, ws) = vault();
    let tutto_e_una_foglia_altrui = QueryExpr {
        any: vec![
            QueryClause { all: vec![] },
            QueryClause {
                all: vec![lit(testo("rust"))],
            },
        ],
    };
    assert!(
        tutto_e_una_foglia_altrui.is_everything(),
        "una clausola vuota in OR è l'identità: l'espressione seleziona tutto"
    );

    let valori = ws.query_index(IndexQuery::PropertyValues {
        key: "tipo".into(),
        matching: tutto_e_una_foglia_altrui.clone(),
        page: None,
    });
    let risposta = valori.expect("le faccette di tutto");
    let IndexResult::PropertyValues(valori) = risposta else {
        panic!("il canale ha risposto fuori tema");
    };
    assert_eq!(
        valori.total, 2,
        "`tipo` vale progetto o nota su tutto il vault"
    );

    let vicini = ws.query_index(IndexQuery::Neighbors {
        seeds: tutto_e_una_foglia_altrui.clone(),
        direction: LinkDirection::Outbound,
        depth: 1,
        page: None,
    });
    assert!(vicini.is_ok(), "i vicini di tutto: {vicini:?}");

    // Le altre due passavano già, e devono continuare a passare per la stessa
    // ragione delle prime due e non per la propria.
    let tag = ws.query_index(IndexQuery::Tags {
        matching: tutto_e_una_foglia_altrui.clone(),
        page: None,
    });
    assert!(tag.is_ok(), "i tag di tutto: {tag:?}");
    assert_eq!(
        ids(&ws, tutto_e_una_foglia_altrui).len(),
        4,
        "e i documenti sono il vault intero, non i soli che parlano di rust"
    );
}

/// La frase esatta è un modo della foglia, non delle virgolette dentro una
/// stringa che qualcun altro parsa.
#[test]
fn la_frase_esatta_e_un_modo_non_una_sintassi() {
    let (_g, ws) = vault();
    let frase = |t: &str| {
        clause(vec![lit(QueryPredicate::Text(TextQuery {
            mode: TextMode::Phrase,
            ..TextQuery::terms(t)
        }))])
    };
    assert_eq!(ids(&ws, frase("motore in rust")), ["Progetti/Ferrite.md"]);
    assert!(
        ids(&ws, frase("rust motore")).is_empty(),
        "la sequenza conta: due termini in ordine diverso non sono la frase"
    );
    // Gli stessi due termini, come termini, la trovano lo stesso.
    assert_eq!(
        ids(&ws, clause(vec![lit(testo("rust motore"))])),
        ["Progetti/Ferrite.md"]
    );
}

/// Un vault di note **indistinguibili per la ricerca**: stesso testo, quindi
/// stesso punteggio. È l'unico modo per vedere chi rompe la parità, e i nomi
/// sono scelti perché l'ordine di scrittura non sia già quello di `DocId`.
fn vault_a_pari_merito() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    for rel in ["z.md", "m.md", "a.md", "q.md", "b.md"] {
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(rel), "parola uguale per tutti\n").unwrap();
    }

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    ws.register_core_feature(SEARCH_ID, SEARCH_ID)
        .expect("dichiarato");
    let data = ws.plugin_data_dir(SEARCH_ID).expect("spazio dati");
    let index = SearchIndex::open(&data).expect("indice");
    ws.register_index_provider(SEARCH_ID, Box::new(index))
        .expect("registrazione e attivazione");
    ws.reindex().expect("reindex");
    (dir, ws)
}

/// A pari rilevanza l'ordine è quello del **contratto**, anche quando a
/// rispondere è un indice che il kernel non ha scritto.
///
/// `properties::finish` rompe la parità per `DocId` (decisione 0020), e non è
/// estetica: è ciò che rende l'ordine **totale e stabile**, cioè ciò che tiene
/// onesta la paginazione. Un indice di terzi ha il suo ordine interno — tantivy
/// rompe la parità per indirizzo di segmento, che cambia quando i segmenti si
/// fondono — e se la sua risposta arrivasse alla shell senza passare dalla coda
/// del contratto, due pagine della stessa domanda potrebbero ripetere e saltare
/// righe.
#[test]
fn a_pari_rilevanza_ordina_il_contratto_non_il_motore() {
    let (_g, ws) = vault_a_pari_merito();
    let query = || clause(vec![lit(testo("parola"))]);

    let tutti = pagina(&ws, query(), None, PropertySelect::None, None);
    let ordine: Vec<String> = tutti.items.iter().map(|d| d.doc.to_string()).collect();
    assert_eq!(
        ordine,
        ["a.md", "b.md", "m.md", "q.md", "z.md"],
        "a pari punteggio la parità si rompe per DocId, non per l'ordine interno del motore"
    );

    // E la conseguenza che conta: la finestra scorre senza ripetere né saltare.
    let mut sfogliato: Vec<String> = Vec::new();
    for offset in [0u32, 2, 4] {
        let p = pagina(
            &ws,
            query(),
            None,
            PropertySelect::None,
            Some(Page { offset, limit: 2 }),
        );
        assert_eq!(p.total, 5, "il totale non dipende dalla finestra");
        sfogliato.extend(p.items.iter().map(|d| d.doc.to_string()));
    }
    assert_eq!(
        sfogliato, ordine,
        "sfogliare la stessa domanda deve dare la stessa risposta, in pezzi"
    );
}

/// E quando i punteggi **non** sono pari, comanda la rilevanza.
///
/// Il gemello del test qui sopra, e serve a dire che la coda del contratto non
/// ha appiattito tutto sull'ordine dei `DocId`: chi ha cercato si aspetta i
/// risultati migliori in cima, e la parità è solo ciò che si rompe *dopo*.
#[test]
fn senza_chiave_di_ordinamento_comanda_la_rilevanza() {
    let (_g, ws) = vault();
    let items = pagina(
        &ws,
        clause(vec![lit(testo("rust"))]),
        None,
        PropertySelect::None,
        None,
    )
    .items;

    let punteggi: Vec<f32> = items.iter().map(|d| d.score.expect("rilevanza")).collect();
    assert!(
        punteggi.len() >= 3,
        "il vault ne ha tre che parlano di rust"
    );
    assert!(
        punteggi.windows(2).all(|w| w[0] >= w[1]),
        "i risultati scendono per rilevanza: {punteggi:?}"
    );
    // Senza questo l'asserzione sopra sarebbe vera anche a punteggi tutti
    // uguali, cioè non proverebbe niente.
    assert!(
        punteggi.first() > punteggi.last(),
        "e i punteggi sono davvero diversi: {punteggi:?}"
    );
}

/// **Cosa nomina questo riferimento** (§13.1): le tre specie di bersaglio
/// passano dal canale dati, e la risposta è la stessa per la shell e per un
/// provider.
///
/// Prima questa domanda usciva solo per `resolve_link`, un comando IPC scritto
/// apposta: la sola risposta sul vault che la shell sapeva chiedere e un plugin
/// no. Il presidio guarda proprio quella simmetria — la strada è
/// `query_index`, che è ciò che una feature ha e nient'altro.
#[test]
fn cosa_nomina_un_riferimento_lo_dice_il_canale_dati() {
    let (_g, ws) = vault();
    let risolve = |target: LinkTarget, from: Option<&str>| -> Option<String> {
        match ws
            .query_index(IndexQuery::Resolve {
                target,
                from: from.map(DocId::new),
            })
            .expect("il kernel serve `resolve`")
        {
            IndexResult::Resolved(found) => found.map(|r| r.doc.0),
            other => panic!("risposta fuori tema: {}", other.kind_name()),
        }
    };

    // Wiki: il nome nudo, regola Obsidian.
    assert_eq!(
        risolve(LinkTarget::wiki("Ferrite"), None).as_deref(),
        Some("Progetti/Ferrite.md")
    );
    // E `from` per un wikilink non cambia niente: la regola non guarda da dove
    // si sta scrivendo.
    assert_eq!(
        risolve(LinkTarget::wiki("Ferrite"), Some("Archivio/Vecchio.md")).as_deref(),
        Some("Progetti/Ferrite.md")
    );

    // Path: relativo alla cartella di chi lo ospita…
    assert_eq!(
        risolve(
            LinkTarget::Path("Cucina.md".into()),
            Some("Progetti/Ferrite.md")
        )
        .as_deref(),
        Some("Progetti/Cucina.md")
    );
    // …e senza un ospite, relativo alla radice. Sono due risposte **diverse**
    // per la stessa stringa, ed è la ragione per cui `from` sta nella domanda
    // invece che essere indovinato.
    assert_eq!(risolve(LinkTarget::Path("Cucina.md".into()), None), None);
    assert_eq!(
        risolve(LinkTarget::Path("Progetti/Cucina.md".into()), None).as_deref(),
        Some("Progetti/Cucina.md")
    );

    // Il mondo esterno non è nel vault, e dirlo è una risposta: chi passa qui
    // l'esito di `classify` senza filtrarlo prima riceve `None`, non un errore.
    assert_eq!(
        risolve(LinkTarget::Url("https://example.org".into()), None),
        None
    );

    // Un nome che non nomina niente è `None` e non un errore: è il caso da cui
    // nascono «crea la nota che manca» e il redirect.
    assert_eq!(risolve(LinkTarget::wiki("Inesistente"), None), None);
}

// ---------------------------------------------------------------------------
// Le coordinate: dove sta un risultato, dove punta un riferimento (0049)
// ---------------------------------------------------------------------------

/// Un vault fatto per le **posizioni**: una parola che compare più volte nella
/// stessa nota, un heading, un'ancora di blocco, e una nota che li nomina.
fn vault_con_punti() -> (tempfile::TempDir, Workspace, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    write(
        "Note/Doppia.md",
        "# Il gatto\n\nIl gatto dorme sul divano.\n\nPoi il Gatto si sveglia. ^risveglio\n",
    );
    write(
        "Note/Rimando.md",
        "Vedi [[Doppia#^risveglio]] e [[Doppia#Il gatto]].\n",
    );

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    ws.register_core_feature(SEARCH_ID, SEARCH_ID)
        .expect("dichiarato");
    let data = ws.plugin_data_dir(SEARCH_ID).expect("spazio dati");
    let index = SearchIndex::open(&data).expect("indice");
    ws.register_index_provider(SEARCH_ID, Box::new(index))
        .expect("registrazione e attivazione");
    ws.reindex().expect("reindex");
    (dir, ws, root)
}

/// La §21.3: un risultato sa dire **a che punto** del documento sta, e la
/// seconda occorrenza ha lo span della seconda.
///
/// Prima di questa firma il pannello poteva aprire la nota e basta: gli
/// `highlights` sono offset dentro l'estratto, e fra l'estratto e il file non
/// c'è nessuna coordinata. Qui si verifica la cosa che quella distanza rendeva
/// inesprimibile — non difficile: **inesprimibile**.
#[test]
fn un_risultato_sa_dire_a_che_punto_del_documento_sta() {
    let (_g, ws, root) = vault_con_punti();
    let source = std::fs::read_to_string(root.join("Note/Doppia.md")).expect("il sorgente");

    let hits = documenti(&ws, clause(vec![lit(testo("gatto"))]));
    let doppia = hits
        .iter()
        .find(|m| m.doc.as_str() == "Note/Doppia.md")
        .expect("la nota che parla di gatti");

    // Tre occorrenze: l'heading e i due paragrafi. Non è il conto a essere il
    // punto — è che siano **più di una**, che è la forma che «un estratto per
    // documento» non poteva portare.
    assert!(
        doppia.occurrences.len() >= 3,
        "una nota può portare N punti a cui saltare, non uno: {:?}",
        doppia.occurrences
    );
    // Gli span sono byte del SORGENTE, non dello snippet: si tagliano sul file
    // e devono cadere sulla parola cercata, maiuscola compresa.
    for punto in &doppia.occurrences {
        let trovato = &source[punto.span.start..punto.span.end];
        assert_eq!(
            trovato.to_lowercase(),
            "gatto",
            "lo span cade sul termine, nel sorgente"
        );
    }
    // In ordine di posizione, e la seconda è davvero la seconda.
    let spans: Vec<usize> = doppia.occurrences.iter().map(|p| p.span.start).collect();
    let mut ordinati = spans.clone();
    ordinati.sort_unstable();
    assert_eq!(spans, ordinati, "in ordine di posizione");
    assert_eq!(
        doppia.occurrences[1].span.start,
        source.match_indices("gatto").nth(1).expect("la seconda").0,
        "il secondo risultato porta alla SECONDA occorrenza"
    );

    // E ognuna dice **di quando**: uno span invecchia appena il documento
    // cambia sotto, e la revisione è quella del sorgente su cui è stato
    // misurato — non una presa altrove.
    let revisione = fub_abi::edit::Revision::of(&source);
    for punto in &doppia.occurrences {
        assert_eq!(
            punto.revision, revisione,
            "la posizione porta la sua revisione"
        );
    }
}

/// Le occorrenze si calcolano solo per chi ha cercato del **testo**: una
/// selezione che non ha niente da localizzare non paga nessuna lettura.
#[test]
fn una_selezione_senza_testo_non_porta_coordinate() {
    let (_g, ws, _root) = vault_con_punti();
    let hits = documenti(
        &ws,
        clause(vec![lit(QueryPredicate::Folder {
            path: "Note".into(),
            descendants: false,
        })]),
    );
    assert!(!hits.is_empty(), "la cartella c'è");
    for hit in &hits {
        assert!(
            hit.occurrences.is_empty(),
            "`occurrences` vuoto = nessuno le ha calcolate, ed è il caso di chi \
             non ha cercato niente da localizzare"
        );
    }
}

/// La §21.10: `[[Nota#^blocco]]` e `[[Nota#Sezione]]` sanno dire **dove
/// dentro**, e un punto che non c'è più non impedisce di aprire.
#[test]
fn un_riferimento_a_un_punto_sa_dire_dove_punta() {
    let (_g, ws, root) = vault_con_punti();
    let source = std::fs::read_to_string(root.join("Note/Doppia.md")).expect("il sorgente");

    let risolve = |target: LinkTarget| match ws
        .query_index(IndexQuery::Resolve { target, from: None })
        .expect("il kernel serve `resolve`")
    {
        IndexResult::Resolved(found) => found,
        other => panic!("risposta fuori tema: {}", other.kind_name()),
    };

    // Il blocco: l'ancora è la chiave, e lo span è quello del blocco che la
    // porta. Il parser la produce dalla 0003 e nessuno la leggeva.
    let blocco = risolve(LinkTarget::Wiki {
        page: "Doppia".into(),
        heading: None,
        block: Some("risveglio".into()),
    })
    .expect("la nota c'è");
    assert_eq!(blocco.doc.as_str(), "Note/Doppia.md");
    let punto = blocco.at.expect("e il punto dentro");
    assert_eq!(punto.anchor.as_deref(), Some("risveglio"));
    assert!(
        source[punto.span.start..punto.span.end].contains("si sveglia"),
        "lo span è quello del blocco ancorato, nel sorgente"
    );

    // L'heading: altro spazio di nomi, stessa risposta.
    let sezione = risolve(LinkTarget::Wiki {
        page: "Doppia".into(),
        heading: Some("Il gatto".into()),
        block: None,
    })
    .expect("la nota c'è");
    let punto = sezione.at.expect("e il punto dentro");
    assert_eq!(
        punto.anchor.as_deref(),
        Some("il-gatto"),
        "lo slug dell'heading"
    );
    assert_eq!(punto.span.start, 0, "l'heading apre il documento");

    // Un riferimento che nomina la nota e basta non si inventa un punto.
    assert_eq!(risolve(LinkTarget::wiki("Doppia")).expect("c'è").at, None);

    // E un punto che non c'è (o non c'è più) lascia la risposta al documento:
    // si apre in cima, che è più di quel che si faceva prima e meno di una
    // bugia.
    let sparito = risolve(LinkTarget::Wiki {
        page: "Doppia".into(),
        block: Some("mai-esistito".into()),
        heading: None,
    })
    .expect("la nota c'è lo stesso");
    assert_eq!(sparito.doc.as_str(), "Note/Doppia.md");
    assert_eq!(sparito.at, None);
}
