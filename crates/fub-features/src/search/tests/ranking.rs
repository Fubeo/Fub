//! Test di ricerca, pesi, tag, manifest e impronte.

use super::*;

#[test]
fn finds_by_body_and_reports_highlights() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "a.md",
        "il gatto dorme sul tappeto",
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("b.md", "il cane abbaia forte")));

    let hits = search(&idx, "gatto");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].doc, DocId::new("a.md"));
    // Lo snippet è testo puro e gli highlight cadono sul termine cercato.
    assert!(!hits[0].snippet.as_deref().unwrap_or_default().contains('<'));
    let h = hits[0].highlights.first().expect("un highlight");
    let snippet = hits[0].snippet.as_deref().expect("un match di testo");
    assert_eq!(&snippet[h.start..h.end], "gatto");
}

#[test]
fn page_name_outranks_body() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "nota/Rust.md",
        "appunti sparsi di programmazione",
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "altro.md",
        "rust rust rust rust rust rust",
    )));

    let hits = search(&idx, "rust");
    assert_eq!(hits.len(), 2);
    assert_eq!(
        hits[0].doc,
        DocId::new("nota/Rust.md"),
        "the title weighs more"
    );
}
/// Gli alias del frontmatter si trovano dal nome (P04): stanno dentro
/// `page_name` col tokenizer `default`, senza campo nuovo né bump.
#[test]
fn page_name_finds_by_frontmatter_alias() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let mut m = doc("people/Rossi.md", "appunti di cucina");
    m.frontmatter
        .0
        .insert("aliases".into(), serde_json::json!(["Mario"]));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&m));

    // Nei campi di default (nome compreso) l'alias trova la nota.
    let hits = search(&idx, "Mario");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].doc, DocId::new("people/Rossi.md"));
    // E il solo campo nome basta: l'alias è lì dentro, non altrove.
    let only_name = clause(vec![lit(QueryPredicate::Text(TextQuery {
        fields: vec![TextField::Name],
        ..TextQuery::terms("Mario")
    }))]);
    assert_eq!(page_of(&idx, only_name, None).items.len(), 1);
    // Il corpo non c'entra: senza alias la stessa nota non si trova.
    let body_only = clause(vec![lit(QueryPredicate::Text(TextQuery {
        fields: vec![TextField::Body],
        ..TextQuery::terms("Mario")
    }))]);
    assert!(page_of(&idx, body_only, None).items.is_empty());
}

/// Un alias aggiunto a testo invariato reindicizza la nota: l'impronta
/// copre gli alias, altrimenti il salto di `on_documents_indexed`
/// crederebbe la nota immutata e la ricerca per nome resterebbe sorda.
#[test]
fn adding_an_alias_reindexes_the_document() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("n.md", "corpo stabile")));
    assert!(search(&idx, "Mario").is_empty());

    let mut m = doc("n.md", "corpo stabile");
    m.frontmatter
        .0
        .insert("aliases".into(), serde_json::json!(["Mario"]));
    assert_ne!(
        fingerprint(&doc("n.md", "corpo stabile")),
        fingerprint(&m),
        "stesso testo, alias diverso: impronte diverse"
    );
    let _ = idx.on_documents_indexed(std::slice::from_ref(&m));
    assert_eq!(search(&idx, "Mario").len(), 1);
}

// -----------------------------------------------------------------------
// I pesi dei campi sono un'impostazione (§21.6)
// -----------------------------------------------------------------------

/// Un host che dichiara le quattro chiavi come le dichiara il montaggio, e
/// dà a una di esse il valore che il test vuole provare.
fn host_with_weight(key: &str, value: f64) -> MemoryHost {
    let mut host = MemoryHost::new();
    for spec in settings() {
        host = if spec.key == key {
            host.with_value(spec, SettingValue::Number(value))
        } else {
            host.with_setting(spec)
        };
    }
    host
}

/// I due documenti di `page_name_outranks_body`: uno vince per il titolo,
/// l'altro per la ripetizione nel corpo. È la coppia giusta per provare un
/// peso, perché l'esito dipende **solo** da quello.
fn title_against_body(idx: &mut SearchIndex) {
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "nota/Rust.md",
        "appunti sparsi di programmazione",
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "altro.md",
        "rust rust rust rust rust rust",
    )));
}

#[test]
fn the_weights_arrive_from_settings() {
    let (_g, path) = tmp();
    // Il titolo azzerato: la nota *intitolata* Rust non ha più il vantaggio
    // che le dava il default, e passa dietro a chi ripete il termine nel
    // corpo. È l'esatto rovescio di `page_name_outranks_body`, e i due test
    // insieme dicono che quella riga non è più una legge del motore.
    let mut host = host_with_weight(BOOST_NAME_KEY, 0.0);
    let mut idx = open(&path, &mut host);
    assert_eq!(idx.weights().name, 0.0, "letto in `activate`");
    title_against_body(&mut idx);

    let hits = search(&idx, "rust");
    assert_eq!(hits.len(), 2, "zero non esclude: la nota si trova ancora");
    assert_eq!(
        hits[0].doc,
        DocId::new("altro.md"),
        "col peso del titolo a zero vince chi ripete nel corpo"
    );
}

#[test]
fn a_key_never_written_equals_the_its_default() {
    let (_g, path) = tmp();
    // Nessuna dichiarazione affatto: è il caso di un host che di
    // impostazioni non sa niente, e la ricerca deve partire lo stesso. Un
    // motore che si rifiutasse di pesare perché un numero non si legge
    // sarebbe un vault senza ricerca per una chiave assente.
    let (idx, _host) = fresh(&path);
    assert_eq!(idx.weights(), FieldWeights::default());
}

#[test]
fn the_weights_are_updated_at_vault_open() {
    let (_g, path) = tmp();
    let mut host = host_with_weight(BOOST_NAME_KEY, PAGE_NAME_BOOST as f64);
    let mut idx = open(&path, &mut host);
    title_against_body(&mut idx);
    assert_eq!(
        search(&idx, "rust")[0].doc,
        DocId::new("nota/Rust.md"),
        "col default vince il titolo"
    );

    // Qualcuno muove lo slider. L'evento **non porta il valore** — per
    // progetto chi reagisce rilegge — quindi il valore va cambiato
    // nell'host, e poi si annuncia.
    let mut handler = idx.settings_handler();
    host.set_setting(BOOST_NAME_KEY, SettingValue::Number(0.0))
        .expect("scrittura");
    handler
        .handle(
            &Notice::of(Event::SettingChanged {
                key: BOOST_NAME_KEY.into(),
                scope: SettingScope::Vault,
            }),
            &mut host,
        )
        .expect("rilettura");

    assert_eq!(idx.weights().name, 0.0, "il provider ha visto il cambio");
    assert_eq!(
        search(&idx, "rust")[0].doc,
        DocId::new("altro.md"),
        "e l'ordine è cambiato senza riaprire il vault"
    );
}

#[test]
fn a_key_that_not_and_a_weight_not_does_reread() {
    let (_g, path) = tmp();
    let mut host = host_with_weight(BOOST_NAME_KEY, PAGE_NAME_BOOST as f64);
    let idx = open(&path, &mut host);
    let mut handler = idx.settings_handler();

    // Il tema cambia mille volte in una sessione, e la ricerca non deve
    // rileggere quattro chiavi ogni volta. Il presidio guarda l'effetto e
    // non il numero di letture — che sarebbe un dettaglio interno — ma il
    // ramo che protegge è quello del prefisso.
    host.set_setting(BOOST_NAME_KEY, SettingValue::Number(0.0))
        .expect("scrittura");
    handler
        .handle(
            &Notice::of(Event::SettingChanged {
                key: "appearance.theme".into(),
                scope: SettingScope::Vault,
            }),
            &mut host,
        )
        .expect("nessuna rilettura");
    assert_eq!(
        idx.weights().name,
        PAGE_NAME_BOOST,
        "un'altra chiave non trascina i pesi con sé"
    );
}

#[test]
fn the_schema_declares_the_default_that_the_engine_uses() {
    // La duplicazione che questa voce ha tolto: prima i pesi erano costanti
    // cablate, e il banco ne teneva una copia con un commento che chiedeva
    // di non farle divergere. Adesso i default dello schema **sono** quelle
    // costanti, e se qualcuno ne cambiasse una sola questo test è il posto
    // in cui lo scopre.
    let d = FieldWeights::default();
    for (key, expected) in [
        (BOOST_NAME_KEY, d.name),
        (BOOST_HEADING_KEY, d.heading),
        (BOOST_BODY_KEY, d.body),
        (BOOST_TAGS_KEY, d.tags),
    ] {
        let spec = settings()
            .into_iter()
            .find(|s| s.key == key)
            .unwrap_or_else(|| panic!("`{key}` non è dichiarata"));
        let SettingKind::Number { default, min, max } = spec.kind else {
            panic!("`{key}` non è un numero");
        };
        assert_eq!(default as f32, expected, "`{key}`");
        assert_eq!(min, Some(BOOST_MIN));
        assert_eq!(max, Some(BOOST_MAX));
        assert!(
            spec.program_writable,
            "`{key}` è un profilo di vault scrivibile da un comando"
        );
    }
}

#[test]
fn conjunction_by_default() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "rust asincrono")));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("b.md", "rust sincrono")));

    assert_eq!(search(&idx, "rust asincrono").len(), 1);
}

#[test]
fn finds_by_tag_as_an_exact_term() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
        "a.md",
        "niente di rilevante nel corpo",
        &["progetto/fub"],
    )));

    let hits = page_of(&idx, tag("progetto/fub", false), None).items;
    assert_eq!(hits.len(), 1);
    // Selezionata da un fatto e non da una pertinenza: niente rilevanza,
    // niente estratto, niente highlight. Prima un `tags:` nella stringa
    // produceva un punteggio, ed era il punteggio di una domanda che non
    // era una ricerca.
    assert!(hits[0].highlights.is_empty());
    assert!(hits[0].score.is_none());
    assert!(hits[0].snippet.is_none());
}

#[test]
fn a_tag_is_a_key_not_prose() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
        "nested.md",
        "",
        &["progetto/rust"],
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("plain.md", "", &["rust"])));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
        "adiacenti.md",
        "",
        &["area", "lavoro"],
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged(
        "composto.md",
        "",
        &["area/lavoro"],
    )));

    // Un tag è un termine esatto: senza `descendants`, quello annidato non
    // c'entra.
    let hits = page_of(&idx, tag("rust", false), None).items;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].doc, DocId::new("plain.md"));

    // Con `descendants`, invece, la gerarchia c'è tutta — ed è la stessa
    // regola che applica il kernel sui suoi conteggi.
    let mut ids: Vec<String> = page_of(&idx, tag("rust", true), None)
        .items
        .into_iter()
        .map(|h| h.doc.to_string())
        .collect();
    ids.sort();
    assert_eq!(
        ids,
        ["plain.md"],
        "`rust` non è antenato di `progetto/rust`"
    );
    let mut ids: Vec<String> = page_of(&idx, tag("progetto", true), None)
        .items
        .into_iter()
        .map(|h| h.doc.to_string())
        .collect();
    ids.sort();
    assert_eq!(ids, ["nested.md"]);

    // E `area/lavoro` non è una phrase query: `#area #lavoro` adiacenti non
    // sono `#area/lavoro`.
    let hits = page_of(&idx, tag("area/lavoro", false), None).items;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].doc, DocId::new("composto.md"));
}

#[test]
fn tags_are_case_insensitive_but_exact() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("a.md", "", &["Rust"])));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&tagged("b.md", "", &["rust"])));

    // `#Rust` e `#rust` sono lo stesso tag (chiave canonica), qualunque
    // sia il case della query: il click dal pannello (che mostra la
    // grafia originale) trova le stesse note del conteggio.
    for q in ["rust", "Rust", "RUST"] {
        assert_eq!(page_of(&idx, tag(q, false), None).items.len(), 2, "tag {q}");
    }
}

#[test]
fn update_replaces_previous_content() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "vecchio contenuto")));
    assert_eq!(search(&idx, "vecchio").len(), 1);

    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "nuovo contenuto")));
    assert_eq!(search(&idx, "vecchio").len(), 0, "niente duplicati");
    assert_eq!(search(&idx, "nuovo").len(), 1);
    assert_eq!(idx.len(), 1);
}

#[test]
fn removal_deletes_from_index() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "effimero")));
    let _ = idx.on_documents_removed(std::slice::from_ref(&DocId::new("a.md")));
    assert_eq!(search(&idx, "effimero").len(), 0);
    assert!(idx.is_empty());
}

#[test]
fn reconcile_drops_what_the_vault_no_longer_has() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("vivo.md", "presente")));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("morto.md", "sparito")));

    let _ = idx.reconcile(&[DocId::new("vivo.md")]);

    assert_eq!(search(&idx, "presente").len(), 1);
    assert_eq!(search(&idx, "sparito").len(), 0);
}

#[test]
fn the_fingerprints_live_in_the_plugin_storage() {
    // Il dogfooding della firma: ciò che questo indice deve *ritrovare* alla
    // riapertura passa da `data_*`, cioè dall'unico storage durevole che
    // avrà anche un provider di terzi. Non da `std::fs`.
    let (_g, path) = tmp();
    let (mut idx, mut host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
    idx.flush(&mut host).unwrap();

    let manifest = manifest_of(&host);
    assert_eq!(manifest.schema_version, SCHEMA_VERSION);
    assert!(manifest.docs.contains_key("a.md"));
    assert!(
        !path.join(MANIFEST).exists(),
        "the manifest must no longer live next to tantivy's files"
    );
}

#[test]
fn reopening_skips_unchanged_documents() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
        idx.flush(&mut host).unwrap();
    }

    let mut idx = open(&path, &mut host);
    assert_eq!(idx.len(), 1, "fingerprints survive the reopen");
    // Ripassare lo stesso contenuto non produce scritture: è ciò che rende
    // rapida la riapertura di un vault non toccato.
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
    assert!(
        !idx.dirty.load(Ordering::Relaxed),
        "an unchanged document doesn't dirty the index"
    );
    // E nemmeno il manifest si riscrive: non c'è niente di nuovo da dire.
    let before = manifest_of(&host).opstamp;
    idx.flush(&mut host).unwrap();
    assert_eq!(manifest_of(&host).opstamp, before);
    assert_eq!(search(&idx, "stabile").len(), 1);
}

#[test]
fn reopening_reindexes_when_the_manifest_is_of_another_epoch() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
        idx.flush(&mut host).unwrap();
    }
    // Simula il crash fra commit e manifest: l'opstamp non torna.
    let mut m = manifest_of(&host);
    m.opstamp += 1;
    put_manifest(&mut host, &m);

    let mut idx = open(&path, &mut host);
    assert_eq!(idx.len(), 0, "fingerprints from another epoch: not trusted");
    // Il documento si reindicizza, e non si duplica: delete+add.
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto stabile")));
    assert_eq!(search(&idx, "stabile").len(), 1);
}

#[test]
fn the_schema_not_changes_without_that_the_number_rises() {
    let (schema, _) = build_schema();
    assert_eq!(
        schema_fingerprint(&schema),
        FINGERPRINT_OF_THE_SCHEMA,
        "the tantivy schema has changed and SCHEMA_VERSION is still {SCHEMA_VERSION}. \
             Anyone who reopens a vault indexed by a previous version would find not a \
             rebuild but an incoherent index, which is the damage that number exists to \
             prevent. Bump SCHEMA_VERSION, add the history line to its comment, and \
             rewrite the new fingerprint here."
    );
}

#[test]
fn a_bumped_schema_throws_the_fingerprints_away() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
        idx.flush(&mut host).unwrap();
    }
    let mut m = manifest_of(&host);
    m.schema_version = SCHEMA_VERSION.next();
    put_manifest(&mut host, &m);

    let idx = open(&path, &mut host);
    assert_eq!(idx.len(), 0);
}
