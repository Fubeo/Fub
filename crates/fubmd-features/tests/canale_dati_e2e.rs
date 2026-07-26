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
use fubmd_abi::model::{DocId, PropertyValue};
use fubmd_abi::query::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextMode, TextQuery};
use fubmd_abi::traits::{
    DocumentMatch, IndexQuery, IndexResult, LinkDirection, Page, PropertyFilter, PropertySelect,
    PropertySort, PropertyTest,
};
use fubmd_abi::PluginError;
use fubmd_features::{SearchIndex, SEARCH_ID};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

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
) -> fubmd_abi::traits::Paged<DocumentMatch> {
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
    assert_eq!(a_chi, [Some(SEARCH_ID), Some(fubmd_kernel::CORE_ID)]);
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

/// La frase esatta è un modo della foglia, non delle virgolette dentro una
/// stringa che qualcun altro parsa.
#[test]
fn la_frase_esatta_e_un_modo_non_una_sintassi() {
    let (_g, ws) = vault();
    let frase = |t: &str| {
        clause(vec![lit(QueryPredicate::Text(TextQuery {
            text: t.to_string(),
            mode: TextMode::Phrase,
            fields: Vec::new(),
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
