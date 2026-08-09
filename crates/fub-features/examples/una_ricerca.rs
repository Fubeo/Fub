//! Il banco della §21.9: **dove** se ne vanno i millisecondi di una query.
//!
//! I due numeri che c'erano stavano a due ordini di grandezza di distanza —
//! 108 µs misurati a M2, ~23 ms misurati dal banco della
//! [0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md) sullo
//! stesso ordine di vault — e nessuno dei due era sbagliato. Questo banco esiste
//! per dire **quale lavoro** c'è nel secondo e non nel primo, e per dirlo per
//! fase invece che per totale: un totale non si sa dove tagliare.
//!
//! ```text
//! cargo run --release -p fub-features --example una_ricerca
//! ```
//!
//! Cinque fasi, e cinque domande diverse:
//!
//! 1. **Il totale, dal workspace** — la stessa chiamata che fa la contesa, così
//!    il numero di partenza è confrontabile e non citato.
//! 2. **Cosa muove il costo** — si varia una cosa alla volta: quante note
//!    combacia il termine, quanti risultati si chiedono, se ci sono estratti da
//!    generare. È qui che si vede se il costo è *per query* o *per risultato*.
//! 3. **Per fase, dentro tantivy** — sullo stesso indice su disco, riaperto a
//!    parte: conteggio, raccolta dei primi N, rilettura dei documenti STORED,
//!    costruzione del generatore, generazione degli estratti.
//! 4. **Il kernel quanto ci mette** — la differenza fra la porta del workspace
//!    e l'indice nudo, cioè quanto costa il giro che il numero di M2 non faceva.
//! 5. **Il giro per battuta** — la fase nata con la §21.5 (decisione 0083). Le
//!    altre quattro misurano una query che parte quando qualcuno *apre* una
//!    superficie; questa misura la query che parte a **ogni tasto**, che è il
//!    budget dell'autocompletamento dei wikilink e del quick switcher. La
//!    [0082](../../../docs/decisions/0082-una-porta-per-chi-cerca.md) ha scelto
//!    il prefisso contro la lista spinta *senza* misurarlo, dichiarando che
//!    andava misurato: qui si misura — una battuta alla volta, sul prefisso più
//!    corto (il caso peggiore: `n` apre un intervallo di dizionario enorme) fino
//!    alla parola intera.
//!
//! Il vault sintetico è quello del banco della contesa, riga per riga: 2000
//! note con sei sezioni l'una e un vocabolario ristretto. Non è un dettaglio
//! riusato per comodità — è la condizione perché i numeri di qui e quelli di là
//! parlino della stessa cosa.

use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::query::{QueryExpr, QueryPredicate, TextField, TextQuery};
use fub_abi::rules::snippet::SNIPPET_CHARS;
use fub_abi::traits::{EntryKind, Excerpts, IndexQuery, IndexResult, Page, PropertySelect};
use fub_features::search::{HEADING_BOOST, PAGE_NAME_BOOST};
use fub_features::{SearchIndex, SEARCH_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

use tantivy::collector::{Count, TopDocs};
use tantivy::query::{BooleanQuery, Occur, Query, TermQuery};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::snippet::SnippetGenerator;
use tantivy::{Index, TantivyDocument, Term};

const NOTES: usize = 2000;
/// Quante volte si ripete ogni misura. Poche, perché una query da millisecondi
/// non ha bisogno di migliaia di giri per uscire dal rumore.
const GIRI: usize = 30;
// Gli stessi pesi del provider — e adesso **non possono** divergere: sono le sue
// costanti, importate. Erano due copie con un commento che chiedeva a chi legge
// di tenerle allineate («se qui divergessero, la fase 3 misurerebbe una query
// che nessuno esegue»), e finché erano cablate era una promessa a basso rischio.
// Dalla §21.6 sono i **default** di quattro impostazioni, cioè un numero che
// qualcuno cambia: una copia sarebbe diventata la misura di una taratura che
// nessuno esegue.
//
// Il banco misura i default e non ciò che il vault di chi lo lancia ha
// configurato, ed è voluto: un banco che cambiasse numeri con le preferenze di
// chi lo esegue non sarebbe confrontabile con la volta prima.

/// Il vault della contesa, identico: sei sezioni, tre paragrafi l'una, e un
/// vocabolario ristretto — cioè il caso peggiore per un motore full-text,
/// perché ogni termine comune combacia con tutto.
fn semina(root: &Utf8Path) {
    let tag = ["rust", "cucina", "musica", "storia", "matematica"];
    for i in 0..NOTES {
        let mut b = format!("# Nota {i}\n\n#{} #{}\n\n", tag[i % 5], tag[(i * 7) % 5]);
        for s in 0..6 {
            b.push_str(&format!("## Sezione {s}\n\n"));
            for p in 0..3 {
                b.push_str(&format!(
                    "Un paragrafo {p} con parole ricorrenti come linguaggio, sistema, \
                     memoria, concorrenza e prestazione. Vedi [[Nota {}]] e [[Nota {}]].\n\n",
                    (i + 1) % NOTES,
                    (i + 13) % NOTES
                ));
            }
        }
        std::fs::write(root.join(format!("Nota {i}.md")), b).unwrap();
    }
    // Una nota sola porta un termine che non ha nessun altro: è il termine
    // **selettivo**, e serve a separare «costa perché combacia con tutto» da
    // «costa comunque».
    std::fs::write(
        root.join("Nota rara.md"),
        "# Nota rara\n\nUn termine ittiosauro che non compare da nessun'altra parte.\n",
    )
    .unwrap();
}

/// La mediana di `GIRI` esecuzioni di `f`, in millisecondi.
fn mediana(mut f: impl FnMut()) -> f64 {
    // Un giro a vuoto: la prima query scalda le cache di tantivy (dizionario
    // dei termini, mmap del segmento), e misurarla insieme alle altre
    // racconterebbe l'apertura invece della ricerca.
    f();
    let mut tempi: Vec<Duration> = Vec::with_capacity(GIRI);
    for _ in 0..GIRI {
        let t = Instant::now();
        f();
        tempi.push(t.elapsed());
    }
    tempi.sort();
    tempi[tempi.len() / 2].as_secs_f64() * 1000.0
}

fn documenti(matching: QueryExpr, page: Option<Page>) -> IndexQuery {
    IndexQuery::Documents {
        matching,
        sort: None,
        select: PropertySelect::None,
        page,
        excerpts: Excerpts::Attach,
    }
}

fn testo(q: &str) -> QueryExpr {
    QueryExpr::of(QueryPredicate::Text(TextQuery::terms(q)))
}

/// Quanti risultati ha reso una query — per stampare accanto al tempo *su
/// quanto* è stato speso, che è metà della risposta.
fn quanti(ws: &Workspace, q: IndexQuery) -> (usize, u32) {
    match ws.query_index(q) {
        Ok(IndexResult::Documents(paged)) => (paged.items.len(), paged.total),
        altro => panic!("risposta inattesa: {altro:?}"),
    }
}

fn riga(nome: &str, ms: f64, resi: usize, totale: u32) {
    println!("{nome:<46} {ms:>9.2} ms   {resi:>4} resi / {totale} combaciano");
}

fn main() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    eprintln!("semino {NOTES} note in {root} …");
    semina(&root);

    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&root, registry);
    ws.register_core_feature(SEARCH_ID, SEARCH_ID).unwrap();
    let data = ws.plugin_data_dir(SEARCH_ID).unwrap();
    // Lo stesso posto in cui il provider apre l'indice: `<spazio dati>/index`.
    let index_dir = data.join("index");
    ws.register_index_provider(SEARCH_ID, Box::new(SearchIndex::open(&data).unwrap()))
        .unwrap();
    let t = Instant::now();
    ws.reindex().unwrap();
    eprintln!("indice costruito da zero: {:?}\n", t.elapsed());

    // --- 1. il totale, dalla porta del workspace ---------------------------
    println!("== 1. la query del banco della contesa, dal workspace ==");
    let (resi, tot) = quanti(&ws, documenti(testo("concorrenza"), Some(Page::first(20))));
    let ms =
        mediana(|| drop(ws.query_index(documenti(testo("concorrenza"), Some(Page::first(20))))));
    riga("query_index Text(\"concorrenza\") page 20", ms, resi, tot);

    // --- 2. cosa muove il costo -------------------------------------------
    // Si varia una cosa alla volta. Se il costo è *per risultato*, la riga da
    // 1 e quella da 100 stanno su una retta e la pendenza È il costo di un
    // estratto; se è *per query*, restano appiccicate.
    println!("\n== 2. cosa muove il costo (una variabile alla volta) ==");
    for limit in [1u32, 5, 20, 50, 100] {
        let q = || documenti(testo("concorrenza"), Some(Page::first(limit)));
        let (resi, tot) = quanti(&ws, q());
        let ms = mediana(|| drop(ws.query_index(q())));
        riga(&format!("termine comune, page {limit}"), ms, resi, tot);
    }
    let q = || documenti(testo("ittiosauro"), Some(Page::first(20)));
    let (resi, tot) = quanti(&ws, q());
    let ms = mediana(|| drop(ws.query_index(q())));
    riga("termine selettivo (1 nota), page 20", ms, resi, tot);

    // Un predicato che non è testo: nessun estratto da generare, nessun
    // documento STORED da rileggere. È la stessa porta e lo stesso indice, e
    // quello che manca è esattamente il lavoro degli estratti.
    let q = || {
        documenti(
            QueryExpr::of(QueryPredicate::Tag {
                name: "rust".into(),
                descendants: false,
            }),
            Some(Page::first(20)),
        )
    };
    let (resi, tot) = quanti(&ws, q());
    let ms = mediana(|| drop(ws.query_index(q())));
    riga("tag:rust (nessun estratto), page 20", ms, resi, tot);

    // Solo il nome: stesso termine, ma i campi ristretti — combacia con
    // pochissimo e gli estratti restano da fare.
    let q = || {
        documenti(
            QueryExpr::of(QueryPredicate::Text(TextQuery {
                fields: vec![TextField::Name],
                ..TextQuery::terms("Nota 7")
            })),
            Some(Page::first(20)),
        )
    };
    let (resi, tot) = quanti(&ws, q());
    let ms = mediana(|| drop(ws.query_index(q())));
    riga("solo nome \"Nota 7\", page 20", ms, resi, tot);

    // Il **primo tempo** della domanda, nelle due forme: com'era prima della
    // §21.9 (senza finestra, con gli estratti — un estratto per ogni documento
    // che combacia) e com'è adesso (senza finestra e senza estratti, perché
    // quali righe resteranno non si sa ancora). La differenza fra queste due
    // righe È la decisione, misurata sulla stessa chiamata.
    println!("\n== 2b. il primo tempo del pianificatore, prima e adesso ==");
    for (nome, ex) in [
        ("com'era: page None + estratti", Excerpts::Attach),
        ("com'è:   page None senza estratti", Excerpts::Omit),
    ] {
        let q = || IndexQuery::Documents {
            matching: testo("concorrenza"),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: ex,
        };
        let (resi, tot) = quanti(&ws, q());
        let ms = mediana(|| drop(ws.query_index(q())));
        riga(nome, ms, resi, tot);
    }

    // --- 3. per fase, dentro tantivy ---------------------------------------
    // Lo stesso indice su disco, riaperto a parte: qui non si passa dal
    // provider, quindi ogni fase si può cronometrare da sola. La query è
    // ricostruita con gli stessi campi e gli stessi pesi del provider.
    println!("\n== 3. dove vanno i millisecondi, per fase ==");
    fasi(&index_dir, "concorrenza", 20);

    // --- 4. quanto ci mette il kernel --------------------------------------
    // La differenza fra la porta e l'indice nudo è il giro che il numero di M2
    // non faceva: pianificazione, routing, e la risposta ricomposta.
    println!("\n== 4. il giro del kernel ==");
    let (_, _) = quanti(&ws, documenti(testo("ittiosauro"), Some(Page::first(1))));
    let porta =
        mediana(|| drop(ws.query_index(documenti(testo("ittiosauro"), Some(Page::first(1))))));
    println!("query minima dalla porta del workspace      {porta:>9.3} ms");

    // --- 5. il giro per battuta (§21.5, decisione 0083) --------------------
    // Le fasi di sopra misurano una query che parte quando una superficie si
    // apre. Questa misura la query che parte a **ogni tasto**: il prefisso
    // dell'autocompletamento dei wikilink e del quick switcher.
    //
    // Si misura una battuta alla volta, dal prefisso di un carattere in su,
    // perché il costo di un prefisso non è piatto: `n` apre un intervallo di
    // dizionario grande quanto tutte le note che cominciano per n, `nota 1`
    // quasi niente. Il primo tasto è il caso peggiore, e un budget si prende
    // sul caso peggiore.
    //
    // Due configurazioni, che sono le due superfici:
    //
    // - **solo nome, senza estratti**: `TextField::Name` e `Excerpts::Omit`.
    //   Chi propone delle note mostra dei nomi, e un estratto per riga sarebbe
    //   il lavoro della §21.9 rifatto a ogni tasto;
    // - **ovunque, con estratti**: la casella del vault, per confronto — cioè
    //   cosa costerebbe far battere la ricerca piena a ogni tasto.
    println!("\n== 5. il giro per battuta (prefisso mentre si digita) ==");
    let per_battuta = |testo: &str, campi: Vec<TextField>, ex: Excerpts| {
        let q = || IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Text(TextQuery {
                fields: campi.clone(),
                ..TextQuery::terms(testo).while_typing()
            })),
            sort: None,
            select: PropertySelect::None,
            page: Some(Page::first(20)),
            excerpts: ex,
        };
        let (resi, tot) = quanti(&ws, q());
        let ms = mediana(|| drop(ws.query_index(q())));
        (ms, resi, tot)
    };
    let parola = "nota 1";
    for i in 1..=parola.len() {
        let prefisso = &parola[..i];
        let (ms, resi, tot) = per_battuta(prefisso, vec![TextField::Name], Excerpts::Omit);
        riga(
            &format!("solo nome, senza estratti: \"{prefisso}\""),
            ms,
            resi,
            tot,
        );
    }
    for i in 1..=parola.len() {
        let prefisso = &parola[..i];
        let (ms, resi, tot) = per_battuta(prefisso, Vec::new(), Excerpts::Attach);
        riga(
            &format!("ovunque, con estratti:     \"{prefisso}\""),
            ms,
            resi,
            tot,
        );
    }
    // Il termine di paragone, ed è ciò che il prefisso **sostituisce**:
    // l'elenco intero del vault, che è quello che l'autocompletamento dei
    // wikilink chiedeva a ogni apertura di `[[` (una volta sola, grazie al
    // `validFor` di CM6, e per questo era sostenibile). Il confronto onesto
    // non è «una query contro zero query»: è una query da N ms per battuta
    // contro *questa* più 2001 righe da trasportare sull'IPC e da ordinare
    // nella shell — e questa riga misura solo la prima metà, perché il
    // trasporto JSON e il `noteCompletions` su 2001 voci non sono in questo
    // processo.
    let elenco = || IndexQuery::Entries {
        of_kind: Some(EntryKind::Document),
        within: None,
        page: None,
    };
    let quante = match ws.query_index(elenco()) {
        Ok(IndexResult::Entries(paged)) => paged.items.len(),
        altro => panic!("risposta inattesa: {altro:?}"),
    };
    let ms = mediana(|| drop(ws.query_index(elenco())));
    riga(
        "l'elenco intero (com'era, per apertura)",
        ms,
        quante,
        quante as u32,
    );

    // E il termine dell'altro banco, digitato: un prefisso su un vocabolario
    // comune, cioè il caso in cui l'intervallo del dizionario è largo e il
    // numero di note che combaciano è tutto il vault.
    for prefisso in ["c", "co", "conc", "concorrenza"] {
        let (ms, resi, tot) = per_battuta(prefisso, vec![TextField::Name], Excerpts::Omit);
        riga(
            &format!("solo nome, termine comune: \"{prefisso}\""),
            ms,
            resi,
            tot,
        );
    }
}

/// Il conto per fase, sullo stesso indice ma senza il provider in mezzo.
fn fasi(dir: &Utf8Path, termine: &str, limit: usize) {
    let index = Index::open_in_dir(dir.as_std_path()).expect("indice su disco");
    let schema = index.schema();
    let campo = |nome: &str| schema.get_field(nome).expect(nome);
    let (body, page_name, headings, tags, doc_id) = (
        campo("body"),
        campo("page_name"),
        campo("headings"),
        campo("tags"),
        campo("doc_id"),
    );
    let reader = index.reader().expect("reader");

    // La stessa query del provider per un termine solo: un `Should` per campo,
    // con i pesi del provider, dentro un `Must`.
    let costruisci = || -> Box<dyn Query> {
        let per_campo: Vec<(Occur, Box<dyn Query>)> = [
            (page_name, PAGE_NAME_BOOST),
            (headings, HEADING_BOOST),
            (body, 1.0),
            (tags, 1.0),
        ]
        .into_iter()
        .map(|(f, boost)| {
            let q: Box<dyn Query> = Box::new(TermQuery::new(
                Term::from_field_text(f, termine),
                IndexRecordOption::WithFreqs,
            ));
            (
                Occur::Should,
                Box::new(tantivy::query::BoostQuery::new(q, boost)) as Box<dyn Query>,
            )
        })
        .collect();
        Box::new(BooleanQuery::new(vec![(
            Occur::Must,
            Box::new(BooleanQuery::new(per_campo)) as Box<dyn Query>,
        )]))
    };

    let query = costruisci();
    let searcher = reader.searcher();

    let ms_searcher = mediana(|| drop(reader.searcher()));
    let ms_costruzione = mediana(|| drop(costruisci()));
    let ms_count = mediana(|| {
        let _ = searcher.search(&*query, &Count).unwrap();
    });
    let collector = || TopDocs::with_limit(limit).and_offset(0).order_by_score();
    let ms_top = mediana(|| drop(searcher.search(&*query, &collector()).unwrap()));
    let top = searcher.search(&*query, &collector()).unwrap();

    let ms_gen = mediana(|| {
        let mut g = SnippetGenerator::create(&searcher, &*query, body).unwrap();
        g.set_max_num_chars(SNIPPET_CHARS);
        drop(g);
    });

    let ms_doc = mediana(|| {
        for (_, address) in &top {
            let d: TantivyDocument = searcher.doc(*address).unwrap();
            let _ = d.get_first(doc_id).and_then(|v| v.as_str()).map(str::len);
        }
    });

    let docs: Vec<TantivyDocument> = top.iter().map(|(_, a)| searcher.doc(*a).unwrap()).collect();
    let mut gen = SnippetGenerator::create(&searcher, &*query, body).unwrap();
    gen.set_max_num_chars(SNIPPET_CHARS);
    let ms_snip = mediana(|| {
        for d in &docs {
            let _ = gen.snippet_from_doc(d).fragment().len();
        }
    });

    println!("{:<46} {:>9}", "fase", "ms");
    for (nome, ms) in [
        ("searcher()", ms_searcher),
        ("costruzione della query", ms_costruzione),
        ("Count (quante combaciano)", ms_count),
        (&format!("TopDocs(limit {limit})"), ms_top),
        ("SnippetGenerator::create", ms_gen),
        (&format!("searcher.doc() × {limit} (STORED)"), ms_doc),
        (&format!("snippet_from_doc × {limit}"), ms_snip),
    ] {
        println!("{nome:<46} {ms:>9.3}");
    }
    println!(
        "{:<46} {:>9.3}",
        "somma delle fasi",
        ms_searcher + ms_costruzione + ms_count + ms_top + ms_gen + ms_doc + ms_snip
    );
}
