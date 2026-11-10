//! Test di ambito e finestra (decisione 0005), di due ricerche insieme e
//! della tolleranza.

use super::*;

// --- ambito e finestra (decisione 0005) ------------------------------------------

#[test]
fn a_folder_scope_takes_the_descendants_too() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("radice.md", "gatto")));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("Progetti/alpha.md", "gatto")));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("Progetti/sub/beta.md", "gatto")));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("Altro/gamma.md", "gatto")));

    let in_folder = |folder: &str| {
        let matching = clause(vec![
            lit(QueryPredicate::Text(TextQuery::terms("gatto"))),
            lit(QueryPredicate::Folder {
                path: folder.to_string(),
                descendants: true,
            }),
        ]);
        let mut ids: Vec<String> = page_of(&idx, matching, None)
            .items
            .into_iter()
            .map(|h| h.doc.to_string())
            .collect();
        ids.sort();
        ids
    };

    assert_eq!(
        in_folder("Progetti"),
        ["Progetti/alpha.md", "Progetti/sub/beta.md"],
        "una cartella prende anche le sue discendenti"
    );
    assert_eq!(in_folder("Progetti/sub"), ["Progetti/sub/beta.md"]);
    assert_eq!(
        in_folder("").len(),
        4,
        "la radice è l'intero vault, non le sole note di primo livello"
    );
}

#[test]
fn scoping_by_tag_is_an_and_with_the_query() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("a.md", "gatto", &["Casa"])));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("b.md", "gatto", &["lavoro"])));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("c.md", "cane", &["casa"])));

    // Grafia diversa dal canonico: il predicato la normalizza come fa il
    // pannello dei tag, o "cerca fra le note #Casa" non troverebbe #casa.
    let matching = clause(vec![
        lit(QueryPredicate::Text(TextQuery::terms("gatto"))),
        lit(QueryPredicate::Tag {
            name: "Casa".to_string(),
            descendants: false,
        }),
    ]);
    let hits = page_of(&idx, matching, None);
    assert_eq!(hits.total, 1);
    assert_eq!(hits.items[0].doc, DocId::new("a.md"));
}

#[test]
fn the_window_moves_over_the_matches_and_the_total_stays_the_total() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    for the in 0..5 {
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
            &format!("nota{the}.md"),
            "gatto",
        )));
    }

    let first = page_of(&idx, text("gatto"), Some(Page::new(0, 2)));
    assert_eq!(first.items.len(), 2);
    assert_eq!(
        (first.offset, first.total),
        (0, 5),
        "il totale è quello dei match, non della pagina"
    );

    let second = page_of(&idx, text("gatto"), Some(Page::new(2, 2)));
    assert_eq!(second.items.len(), 2);
    assert_eq!(second.total, 5);
    let overlap = first
        .items
        .iter()
        .any(|h| second.items.iter().any(|s| s.doc == h.doc));
    assert!(!overlap, "due pagine consecutive non si sovrappongono");

    let beyond = page_of(&idx, text("gatto"), Some(Page::new(99, 2)));
    assert!(beyond.items.is_empty(), "oltre la fine è vuoto");
    assert_eq!(beyond.total, 5, "e il totale resta");

    let all = page_of(&idx, text("gatto"), None);
    assert_eq!(all.items.len(), 5, "senza finestra si prende tutto");
}

#[test]
fn moving_a_notes_reindexes_it_even_with_the_same_content() {
    // L'impronta include il path: da quando l'indice porta la cartella,
    // due note con lo stesso testo in cartelle diverse NON sono la stessa
    // cosa indicizzata.
    let a = doc("Progetti/nota.md", "identico");
    let b = doc("Archivio/nota.md", "identico");
    assert_ne!(fingerprint(&a), fingerprint(&b));
}

/// Ciò che ha già una fonte di verità nel kernel non si duplica qui. Prima
/// questo indice doveva **dirlo** con un `BadArgs` per ogni famiglia,
/// perché era così che il dispatch scopriva chi servisse cosa; adesso le
/// rotte sono dichiarate e questa domanda non gli arriva. La risposta resta
/// per chi lo chiamasse fuori dal kernel, e dice la cosa giusta: non che la
/// domanda è malposta, ma che non la serve lui.
#[test]
fn backlinks_are_not_served_here() {
    let (_g, path) = tmp();
    let (idx, _host) = fresh(&path);
    assert!(
        !idx.routes()
            .contains(&QueryRoute::Query(fub_abi::traits::QueryKind::Backlinks)),
        "e soprattutto non li rivendica"
    );
    let r = idx.query(IndexQuery::Backlinks {
        target: DocId::new("a.md"),
        page: None,
    });
    assert!(matches!(r, Err(PluginError::Unserved(_))));
}

// --- la quarta proprietà: due ricerche insieme (§8.4) ----------------------------

/// Quante ricerche fa ogni thread in una corsa. Abbastanza da coprire il
/// costo di far partire i thread, abbastanza poche da non pesare sulla suite.
const SEARCHES: usize = 20;

/// Un vault abbastanza grande che una query costi più del lock che si sta
/// misurando: sotto questa taglia la corsa racconterebbe il costo di
/// `thread::spawn`, non quello della ricerca.
fn full_index(path: &Utf8Path) -> (SearchIndex, MemoryHost) {
    let (mut idx, mut host) = fresh(path);
    for the in 0..200 {
        let mut body = String::new();
        for s in 0..6 {
            body.push_str(&format!(
                "## Sezione {s}\n\nUn paragrafo con parole ricorrenti come \
                     linguaggio, sistema, memoria, concorrenza e prestazione.\n\n"
            ));
        }
        let _ =
            idx.on_documents_indexed(std::slice::from_ref(&doc(&format!("Nota {the}.md"), &body)));
    }
    // Committato **prima** di misurare: con scritture in sospeso la prima
    // query prenderebbe il lock del writer per davvero, e la corsa
    // misurerebbe quello.
    idx.flush(&mut host).expect("flush");
    assert!(!idx.dirty.load(Ordering::Relaxed));
    (idx, host)
}

/// Quanto ci mettono `thread` thread a fare [`RICERCHE`] ricerche a testa.
///
/// Con `in_fila` le si serializza da fuori: è il termine di paragone, ed è
/// **il comportamento di prima** — un lock attorno all'intera `query`. Sta
/// nello stesso binario e nella stessa corsa, come il banco della 0024, così
/// non serve un ramo git per sapere cosa si sta guadagnando.
fn run(idx: &SearchIndex, thread: usize, in_queue: Option<&Mutex<()>>) -> f64 {
    let start = std::time::Instant::now();
    std::thread::scope(|s| {
        for _ in 0..thread {
            s.spawn(move || {
                for _ in 0..SEARCHES {
                    let _fila = in_queue.map(|m| m.lock().expect("mutex"));
                    let hits = page_of(idx, text("concorrenza"), Some(Page::first(10)));
                    assert_eq!(hits.total, 200, "la ricerca deve trovare tutto il vault");
                }
            });
        }
    });
    start.elapsed().as_secs_f64()
}

/// **La proprietà che dà il nome alla §8.4**: due ricerche possono essere in
/// volo insieme dentro questo indice.
///
/// Non si misura contando chi è *dentro* `query` — con un `Mutex` interno ci
/// starebbero in due lo stesso, uno dei quali fermo ad aspettare, e il test
/// passerebbe proprio nel caso che deve bocciare. Si misura invece il tempo,
/// contro un termine di paragone che sta nella stessa corsa: le stesse
/// ricerche serializzate da un lock esterno. Se l'indice ha un lock suo, le
/// due colonne coincidono e questo test è rosso — che è esattamente ciò che
/// succedeva prima della §8.4.
///
/// La soglia è larga (un quarto di tempo risparmiato) perché il numero da
/// difendere non è «quanto va veloce» ma «scala o no»: col lock interno il
/// rapporto è 1,0, senza è vicino al numero di core. In mezzo non c'è niente
/// che una macchina lenta possa produrre per caso.
///
/// Una macchina **occupata** è un'altra cosa da una lenta, e può darlo un
/// falso rosso: le due colonne stanno nella stessa corsa ma non nello stesso
/// istante, quindi un vicino di banco che si prende i core durante la
/// seconda peggiora solo quella. Il modo di distinguerlo è rilanciarlo da
/// solo (`cargo test -p fub-features --lib due_ricerche -- --ignored`): un
/// rosso che resta è un lock tornato dentro l'indice, uno che sparisce era il
/// carico. La soglia non va spostata per farlo tacere.
///
/// # Perché è `ignore`, e cosa lo rimetterà in CI
///
/// Qui sopra c'era scritto che «fra 0,4 e 0,95 non c'è niente che una
/// macchina lenta possa produrre per caso», e **la CI l'ha smentito**: su
/// ubuntu il rapporto è venuto 0,97 e su windows 0,89, con la suite verde in
/// locale. La ragione non è che quei runner siano lenti — è che ogni colonna
/// misura **una trentina di millisecondi**, e a quella scala il tempo se lo
/// mangiano lo spawn dei thread e lo scheduling, che non scalano con i core.
/// Il rapporto misurato non è più la proprietà: è il rumore.
///
/// Quindi il test resta — la proprietà è vera e vale un presidio — ma si
/// lancia a mano, dove la macchina è nota. Rimetterlo a ogni push vuol dire
/// dargli un carico che domini l'overhead e un banco che non condivida i
/// core con nessuno: è la **§17.1**, che chiede esattamente «benchmark su
/// vault sintetici grandi in CI, con soglie», ed è aperta. Questo è il suo
/// primo abitante.
#[ignore = "misura un tempo, e in CI condivisa il tempo non è un segnale (§17.1)"]
#[test]
fn two_searches_are_in_the_index_together() {
    let n = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(4);
    if n < 2 {
        eprintln!("un core solo: la sovrapposizione non è misurabile, e il test lo dice");
        return;
    }

    let (_g, path) = tmp();
    let (idx, _host) = full_index(&path);

    // Un giro a vuoto: la prima ricerca paga la cache dei segmenti, e
    // pagarla dentro una delle due colonne la falserebbe.
    run(&idx, n, None);
    let in_queue = Mutex::new(());
    let seriale = run(&idx, n, Some(&in_queue));
    let together = run(&idx, n, None);

    assert!(
        together < seriale * 0.75,
        "{n} thread hanno impiegato {together:.3}s insieme contro {seriale:.3}s \
             in fila: la ricerca non scala, cioè c'è di nuovo un lock dentro \
             l'indice. È la §8.4, e il prestito condiviso del workspace non lo \
             attraversa."
    );
}

/// La chiusura (§9.2, decisione 0028) **lascia andare la cartella**: il
/// writer torna a tantivy, i suoi thread di merge finiscono, e il lock
/// esclusivo sull'indice non c'è più.
///
/// È la ragione per cui `close` esiste ed è obbligatoria. Il primo indice
/// qui sotto è **ancora vivo** quando il secondo si apre: senza la chiusura
/// il secondo aspetterebbe il lock del primo — non un errore, un'attesa
/// senza fine, che è esattamente ciò che succedeva riaprendo lo stesso vault
/// prima che la sessione precedente cadesse.
#[test]
fn a_index_closed_leaves_the_folder_a_who_arrives_after() {
    let (_g, path) = tmp();
    let (mut first, mut host) = fresh(&path);
    let _ = first.on_documents_indexed(std::slice::from_ref(&doc("a.md", "ciao")));
    first.close(&mut host).expect("chiusura");

    let second = SearchIndex::open_dir(&path);
    assert!(
        second.is_ok(),
        "la cartella è libera mentre il primo indice è ancora in vita: {:?}",
        second.err()
    );
    // E richiudere non è un errore: è un no-op, come cancellare un blob che
    // non c'è.
    first.close(&mut host).expect("chiudere due volte");
}

#[test]
fn head_of_truncates_on_char_boundaries() {
    assert_eq!(head_of("breve", 10), "breve");
    let s = head_of("però caffè città perché così", 10);
    assert!(s.ends_with('…'));
    assert!(s.chars().count() <= 12);
}

/// La §21.2: `arch` trova *architettura* prima che la parola sia finita, e
/// **solo** l'ultimo termine è un prefisso.
#[test]
fn latest_term_incomplete_and_a_prefix_and_the_other_no() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "a.md",
        "note di architettura del kernel",
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "b.md",
        "un archivio di vecchie note",
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "c.md",
        "il kernel e le sue parti",
    )));

    // Senza il prefisso, `arch` non è una parola di nessuno dei tre.
    assert!(
        page_of(&idx, text("arch"), None).items.is_empty(),
        "l'esattezza resta il default: `arch` da solo non trova niente"
    );
    // Con il prefisso, li trova entrambi — ed è la stessa stringa.
    let mut ids: Vec<String> = page_of(&idx, partial_text("arch"), None)
        .items
        .into_iter()
        .map(|m| m.doc.0)
        .collect();
    ids.sort();
    assert_eq!(ids, vec!["a.md".to_string(), "b.md".to_string()]);

    // Due termini: l'ultimo è il prefisso, il primo no. `kernel arch` deve
    // trovare la nota che ha kernel E qualcosa che comincia per arch, e non
    // quella che ha solo kernel.
    let ids: Vec<String> = page_of(&idx, partial_text("kernel arch"), None)
        .items
        .into_iter()
        .map(|m| m.doc.0)
        .collect();
    assert_eq!(ids, vec!["a.md".to_string()]);

    // E il termine che **non** è l'ultimo resta intero: `arch kernel` non
    // deve trovare `archivio`, perché lì il prefisso non è più suo.
    let ids: Vec<String> = page_of(&idx, partial_text("arch kernel"), None)
        .items
        .into_iter()
        .map(|m| m.doc.0)
        .collect();
    assert!(
        ids.is_empty(),
        "solo l'ultimo termine è incompleto: {ids:?}"
    );
}

/// La §21.1: un heading pesa più del corpo, e `TextField::Heading` cerca
/// **solo** lì.
#[test]
fn a_heading_weighs_more_of_the_body_and_and_a_field_a_if() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    // La stessa parola: in un heading di una nota, nel corpo dell'altra.
    let mut with_section = doc("sezione.md", "Concorrenza\n\nqualche riga qui");
    with_section.outline = vec![fub_abi::model::Heading {
        level: 2,
        text: "Concorrenza".into(),
        slug: "concorrenza".into(),
        span: Span::new(0, 14),
        explicit_anchor: None,
    }];
    let _ = idx.on_documents_indexed(std::slice::from_ref(&with_section));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "citata.md",
        "un accenno alla concorrenza e poi si passa oltre",
    )));

    // Chi le ha dedicato una sezione viene prima: il termine conta due
    // volte, e la seconda con il boost.
    let hits = search(&idx, "concorrenza");
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].doc, DocId::new("sezione.md"));

    // E il campo è a sé: cercando **solo** negli heading resta una sola.
    let only_heading = clause(vec![lit(QueryPredicate::Text(TextQuery {
        fields: vec![TextField::Heading],
        ..TextQuery::terms("concorrenza")
    }))]);
    let ids: Vec<String> = page_of(&idx, only_heading, None)
        .items
        .into_iter()
        .map(|m| m.doc.0)
        .collect();
    assert_eq!(ids, vec!["sezione.md".to_string()]);
}

/// La tolleranza è **dicibile** e non ancora onorata, e il verso del
/// silenzio è quello sicuro: chiedere `typos` non allarga niente.
#[test]
fn ask_the_tolerance_not_makes_tolerant_of_hidden() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "note di architettura")));

    let with_typo = clause(vec![lit(QueryPredicate::Text(TextQuery {
        tolerance: TextTolerance::Typos,
        ..TextQuery::terms("architettra")
    }))]);
    assert!(
        page_of(&idx, with_typo, None).items.is_empty(),
        "`typos` è dicibile: chi non lo onora risponde come per `exact`, e \
             restringere è il verso innocuo dello sbaglio"
    );
}
