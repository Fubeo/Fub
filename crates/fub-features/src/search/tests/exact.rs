//! Maiuscole esatte ed espressioni regolari: i candidati dall'indice, la
//! verifica sul testo memorizzato (`exact`).

use super::*;
use crate::search::exact::FULL_SCAN;
use fub_abi::query::TextField;

fn exact_query(q: TextQuery) -> TextQuery {
    TextQuery {
        case_sensitive: true,
        ..q
    }
}

fn exact(q: &str) -> QueryExpr {
    clause(vec![lit(QueryPredicate::Text(exact_query(
        TextQuery::terms(q),
    )))])
}

fn regex(pattern: &str, fields: Vec<TextField>) -> QueryExpr {
    clause(vec![lit(QueryPredicate::Regex {
        pattern: pattern.into(),
        fields,
    })])
}

fn ids(hits: &Paged<DocumentMatch>) -> Vec<String> {
    hits.items.iter().map(|m| m.doc.to_string()).collect()
}

fn outcome(idx: &SearchIndex, matching: QueryExpr) -> Result<IndexResult, PluginError> {
    idx.query(IndexQuery::Documents {
        matching,
        sort: None,
        select: PropertySelect::None,
        page: None,
        excerpts: Excerpts::Attach,
    })
}

fn refused_with(idx: &SearchIndex, matching: QueryExpr) -> String {
    match outcome(idx, matching) {
        Err(PluginError::BadArgs(text)) => format!("{text:?}"),
        other => panic!("atteso un rifiuto, trovato {other:?}"),
    }
}

/// Più note di quante la scansione intera ne rilegga, e una parola rara.
fn large_vault(idx: &mut SearchIndex) {
    let mut docs: Vec<DocumentModel> = (0..MAX_SCAN_DOCS as usize + 100)
        .map(|n| {
            doc(
                &format!("n/{n}.md"),
                &format!("Nota numero {n} senza niente"),
            )
        })
        .collect();
    docs.push(doc("a.md", "appunti su Rust e sul suo compilatore"));
    docs.push(doc("b.md", "appunti su rust, scritto minuscolo"));
    docs.push(tagged("c.md", "una nota con un tag", &["Progetto/Casa"]));
    let _ = idx.on_documents_indexed(&docs);
}

/// Il difetto: con più di 2048 note le maiuscole esatte rifiutavano qualunque
/// domanda. Adesso i candidati li dà l'indice, e la parola si trova.
#[test]
fn exact_case_finds_a_word_beyond_the_scan_limit() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    large_vault(&mut idx);

    assert_eq!(ids(&page_of(&idx, exact("Rust"), None)), ["a.md"]);
    assert_eq!(ids(&page_of(&idx, exact("rust"), None)), ["b.md"]);
    assert_eq!(ids(&page_of(&idx, exact("appunti Rust"), None)), ["a.md"]);
    let tags = clause(vec![lit(QueryPredicate::Text(exact_query(TextQuery {
        fields: vec![TextField::Tags],
        ..TextQuery::terms("casa")
    })))]);
    assert_eq!(ids(&page_of(&idx, tags, None)), ["c.md"]);
}

/// Una regex con una parola obbligatoria restringe allo stesso modo; senza,
/// resta il tetto, detto con un messaggio della ricerca.
#[test]
fn a_regex_with_a_required_word_works_beyond_the_scan_limit() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    large_vault(&mut idx);

    let hits = page_of(
        &idx,
        regex(r"^appunti su Rust\s", vec![TextField::Body]),
        None,
    );
    assert_eq!(ids(&hits), ["a.md"]);
    let hits = page_of(&idx, regex(r"progetto/c", vec![TextField::Tags]), None);
    assert_eq!(ids(&hits), ["c.md"], "i tag canonici, dal dizionario");
    assert!(refused_with(&idx, regex(r"(?i)rust", vec![])).contains(SCAN_TOO_MANY));
}

/// Troppi candidati: la domanda si rifiuta per intero, mai una pagina a metà.
#[test]
fn too_many_candidates_refuse_the_question_with_a_typed_message() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    large_vault(&mut idx);

    assert!(refused_with(&idx, exact("Nota")).contains(SCAN_TOO_MANY));
    // Una parte senza token interi non restringe: qui nessuna lo fa.
    assert!(refused_with(&idx, exact("\u{301}")).contains(SCAN_TOO_MANY));
    // Quella che restringe basta.
    assert!(page_of(&idx, exact("Rust \u{301}"), None).items.is_empty());
}

/// Il prefisso nativo non ha il tetto di 50 termini che tantivy gli dà di
/// serie: la regex di prima non ne aveva.
#[test]
fn a_prefix_expands_to_every_term() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let docs: Vec<DocumentModel> = (0..80)
        .map(|n| doc(&format!("{n}.md"), &format!("parola{n} qui")))
        .collect();
    let _ = idx.on_documents_indexed(&docs);
    assert_eq!(page_of(&idx, partial_text("parol"), None).items.len(), 80);
    assert_eq!(page_of(&idx, partial_text("parola7"), None).items.len(), 11);
}

/// Le lettere cerchiate sono lettere anche per le maiuscole esatte, come lo
/// sono per l'indice: «Ⓐfoo» non contiene la parola `foo`.
#[test]
fn circled_letters_stay_inside_their_word() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(&[doc("a.md", "xⒶfoo e niente")]);
    assert!(page_of(&idx, exact("foo"), None).items.is_empty());
    assert!(page_of(&idx, text("foo"), None).items.is_empty());
    assert_eq!(ids(&page_of(&idx, exact("xⒶfoo"), None)), ["a.md"]);
}

/// Il corpus dell'equivalenza: le forme in cui indice e testo potrebbero non
/// capirsi (maiuscole, accenti combinanti, lettere cerchiate, parole da 40 byte
/// in su, CJK senza spazi, sigma finale, punteggiatura, emoji, tag, alias,
/// titoli di sezione).
fn corpus() -> Vec<DocumentModel> {
    let mut docs = vec![
        doc(
            "a.md",
            "Il progetto Rust usa cargo. RUST maiuscolo e Rust-Analyzer.",
        ),
        doc("b.md", "rust minuscolo e Rustacean, rUST storto"),
        doc("c.md", "caffe\u{301} al bar, CAFFÈ e Caffè"),
        doc("d.md", "xⒶfoo e ⓑbar, foo da solo"),
        doc(
            "e.md",
            "Supercalifragilistichespiralidosoextralunghissimo e Super",
        ),
        doc("f.md", "東京タワーは東京の観光名所でとても高いです 東京"),
        doc("g.md", "ΟΔΟΣ e ΣΟΦΙΑ, Ἰστορία; İstanbul"),
        doc("h.md", "C++ e C# e .NET, e-mail, foo_bar, foo-bar, 3.14"),
        doc("i.md", "Mappa 🗺 del tesoro 👨‍👩‍👧"),
        tagged("j.md", "niente da vedere", &["Progetto/Casa", "rust-lang"]),
        doc("m.md", "TASK aperta\nTASK\tchiusa\nultima riga"),
        doc("Rust.md", "il nome dice tutto"),
    ];
    let mut alias = doc("k.md", "cucina");
    alias
        .frontmatter
        .0
        .insert("aliases".into(), serde_json::json!(["Mario Rossi"]));
    docs.push(alias);
    let mut heading = doc("l.md", "Concorrenza in Rust\n\ntesto");
    heading.outline = vec![fub_abi::model::Heading {
        level: 1,
        text: "Concorrenza in Rust".into(),
        slug: "concorrenza-in-rust".into(),
        span: Span::new(0, 19),
        explicit_anchor: None,
    }];
    docs.push(heading);
    docs
}

/// Sui vault piccoli i candidati non cambiano niente: stessi risultati, stesso
/// ordine, stessi punteggi, stessi estratti ed evidenziazioni della scansione
/// intera, per ogni forma della domanda.
#[test]
fn candidates_give_what_the_full_scan_gives() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(&corpus());

    let terms = [
        "Rust",
        "rust",
        "RUST",
        "Rust cargo",
        "Rustacean",
        "Rusta",
        "rUST",
        "Analyzer",
        "Rust-Analyzer",
        "Caffè",
        "caffe\u{301}",
        "caffe",
        "CAFFÈ",
        "Ⓐfoo",
        "xⒶfoo",
        "foo",
        "bar",
        "ⓑbar",
        "Supercalifragilistichespiralidosoextralunghissimo",
        "Super",
        "東京",
        "東京タワーは東京の観光名所でとても高いです",
        "ΟΔΟΣ",
        "ΣΟΦΙΑ",
        "Ἰστορία",
        "İstanbul",
        "C",
        "NET",
        "foo_bar",
        "e-mail",
        "3.14",
        "🗺",
        "Mappa 🗺",
        "Casa",
        "casa",
        "progetto",
        "lang",
        "rust-lang",
        "Mario",
        "Concorrenza",
        "TASK",
        "\u{301}",
        " , ",
    ];
    let phrases = [
        "Rust usa",
        "progetto Rust",
        "C++",
        ".NET,",
        "Mappa 🗺",
        "TASK aperta",
        "e-mail",
        "progetto/casa",
        "東京タワー",
        "Mario Rossi",
        "in Rust",
    ];
    let typing = [
        "Rus",
        "Rust carg",
        "Super",
        "Supercalifragilistic",
        "東京",
        "Caff",
        "caffe",
        "Ⓐf",
        "TAS",
    ];
    let field_sets = [
        vec![],
        vec![TextField::Body],
        vec![TextField::Name],
        vec![TextField::Tags],
        vec![TextField::Heading],
        vec![TextField::Name, TextField::Tags],
    ];
    let mut questions: Vec<QueryExpr> = Vec::new();
    for fields in &field_sets {
        let with = |q: TextQuery| {
            clause(vec![lit(QueryPredicate::Text(exact_query(TextQuery {
                fields: fields.clone(),
                ..q
            })))])
        };
        for q in terms {
            questions.push(with(TextQuery::terms(q)));
        }
        for q in phrases {
            questions.push(with(TextQuery {
                mode: TextMode::Phrase,
                ..TextQuery::terms(q)
            }));
        }
        for q in typing {
            questions.push(with(TextQuery::terms(q).while_typing()));
            questions.push(with(TextQuery {
                mode: TextMode::Phrase,
                ..TextQuery::terms(q).while_typing()
            }));
        }
    }
    let patterns = [
        r"TASK\s+aperta",
        r"Rust",
        r"(?i)rust",
        r"R.st",
        r"Supercalifragilistichespiralidosoextralunghissimo",
        r"\bRust\b",
        r"foo|Rust",
        r"Rust-Analyzer",
        r"usa cargo\.",
        r"東京",
        r"#?progetto",
        r"^TASK",
        r"progetto/",
        r"lang$",
        r"[A-Z]{4}",
        r"Ⓐfoo",
        r"x?Ⓐfoo",
        r"(Rust)+ usa",
        r"caffe\u{301}",
        r"Mario Rossi",
        r"^TASK\s+aperta$",
        r"^TASK[ \t]+chiusa",
        r"Il progetto Rust usa",
        r"usa cargo\. RUST",
        r"\sRust\s",
        r"[ ,]foo[ ,]",
        r"^Concorrenza in Rust$",
        r"\s東京$",
        r"^東京タワーは東京の観光名所でとても高いです\s",
        r"\sSupercalifragilistichespiralidosoextralunghissimo\s",
        r"^Supercalifragilistichespiralidosoextralunghissimo\s",
        r"\sxⒶfoo\s",
        r"[²,]\s?foo",
    ];
    for fields in &field_sets {
        for pattern in patterns {
            questions.push(regex(pattern, fields.clone()));
        }
    }
    // Lo stesso, in AND con un filtro e in OR con un'altra foglia: la forma
    // del risultato deve restare quella anche dentro un albero.
    questions.push(clause(vec![
        lit(QueryPredicate::Text(exact_query(TextQuery::terms("Rust")))),
        lit(QueryPredicate::Text(TextQuery::terms("cargo"))),
    ]));
    questions.push(QueryExpr {
        any: vec![
            QueryClause {
                all: vec![lit(QueryPredicate::Text(exact_query(TextQuery::terms(
                    "TASK",
                ))))],
            },
            QueryClause {
                all: vec![lit(QueryPredicate::Text(TextQuery::terms("Caffè")))],
            },
        ],
    });

    let mut found = 0;
    for question in questions {
        let new = format!("{:?}", outcome(&idx, question.clone()));
        FULL_SCAN.with(|it| it.set(true));
        let old = format!("{:?}", outcome(&idx, question.clone()));
        FULL_SCAN.with(|it| it.set(false));
        assert_eq!(new, old, "domanda: {question:?}");
        found += usize::from(new.contains("DocumentMatch"));
    }
    // L'equivalenza fra due risposte vuote non proverebbe niente.
    assert!(found > 150, "domande con dei risultati: {found}");
}

/// Prima e dopo su un vault sintetico: si esegue a mano, in release.
///
/// `cargo test -p fub-features --release --lib -- --ignored exact_case_timing --nocapture`
#[test]
#[ignore = "micro-bench: si esegue a mano, in release"]
fn exact_case_timing_on_ten_thousand_notes() {
    use std::time::{Duration, Instant};
    const WORDS: [&str; 10] = [
        "kernel",
        "vault",
        "grafo",
        "indice",
        "nota",
        "ricerca",
        "documento",
        "formato",
        "plugin",
        "contratto",
    ];
    let build = |notes: usize| {
        let (guard, path) = tmp();
        let (mut idx, host) = fresh(&path);
        let docs: Vec<DocumentModel> = (0..notes)
            .map(|n| {
                let mut body: Vec<&str> = (0..150).map(|j| WORDS[(n * 7 + j * 3) % 10]).collect();
                // Una nota su cento ha `Rust`, una su dieci `Kernel`.
                if n % 100 == 0 {
                    body.push("Rust");
                }
                if n % 10 == 0 {
                    body.push("Kernel");
                }
                doc(&format!("d{}/nota-{n}.md", n % 40), &body.join(" "))
            })
            .collect();
        let _ = idx.on_documents_indexed(&docs);
        let _ = page_of(&idx, text("kernel"), Some(Page::first(20)));
        (guard, host, idx)
    };
    let best = |idx: &SearchIndex, q: QueryExpr| -> (Duration, String) {
        let mut best = Duration::MAX;
        let mut what = String::new();
        for _ in 0..5 {
            let start = Instant::now();
            let got = outcome(idx, q.clone());
            best = best.min(start.elapsed());
            what = match got {
                Ok(IndexResult::Documents(hits)) => format!("{} note", hits.total),
                other => format!("{other:?}"),
            };
        }
        (best, what)
    };

    let (_g, _h, large) = build(10_000);
    for q in ["Rust", "Kernel", "Rust Kernel"] {
        let (after, found) = best(&large, exact(q));
        FULL_SCAN.with(|it| it.set(true));
        let (before, refused) = best(&large, exact(q));
        FULL_SCAN.with(|it| it.set(false));
        println!("10 000 note, «{q}»: dopo {after:?} ({found}); prima {before:?} ({refused})");
    }
    let (after, found) = best(&large, regex(r"\sRust\s", vec![TextField::Body]));
    println!("10 000 note, regex «\\sRust\\s»: {after:?} ({found})");
    // Il costo di prima quando rispondeva: la scansione intera al tetto.
    let (_g2, _h2, small) = build(MAX_SCAN_DOCS as usize);
    for q in ["Rust", "Kernel"] {
        FULL_SCAN.with(|it| it.set(true));
        let (before, found) = best(&small, exact(q));
        FULL_SCAN.with(|it| it.set(false));
        let (after, _) = best(&small, exact(q));
        println!("2048 note, «{q}»: scansione intera {before:?} ({found}); candidati {after:?}");
    }
}
