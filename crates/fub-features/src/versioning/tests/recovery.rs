//! Test del recupero dopo un overflow di eventi, della prima apertura, dei
//! file binari e del tetto di dimensione.

use super::*;

#[test]
fn the_handler_is_subscribed_to_overflow() {
    // Se non lo fosse, tutto ciò che segue non verrebbe mai chiamato: la
    // riconciliazione esisterebbe e non servirebbe a niente.
    let handler = VersioningHandler::new(VersionStore {
        inner: Arc::new(Mutex::new(Inner {
            docs: BTreeMap::new(),
            batch: false,
            registered: true,
        })),
    });
    assert!(handler.subscribed().contains(EventKind::Overflow));
}

#[test]
fn an_overflow_turns_a_lost_removal_into_a_tombstone() {
    let mut host = MemoryHost::new().with_document("a.md", "contenuto");
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
        .unwrap();
    let mut handler = VersioningHandler::new(store.clone());

    // La nota sparisce e il `DocumentRemoved` va perso nel troncamento.
    host.forgets_document("a.md");
    assert!(
        !store.is_deleted(&id("a.md")),
        "senza riconciliazione lo store crede ancora che sia viva"
    );

    host.advance(5_000);
    handler
        .handle(&Notice::of(Event::Overflow { dropped: 7 }), &mut host)
        .unwrap();

    // Senza tombstone la vista "vault al tempo T" mentirebbe: direbbe che
    // quella nota c'era, e non c'era.
    assert!(store.is_deleted(&id("a.md")));
    assert_eq!(
        store.list(&id("a.md")).len(),
        1,
        "cancellare non cancella la storia"
    );
}

#[test]
fn an_overflow_never_moves_the_moment_of_death() {
    let mut host = MemoryHost::new().with_document("a.md", "contenuto");
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
        .unwrap();
    host.forgets_document("a.md");
    store.tombstone(&id("a.md"), &mut host).unwrap();
    let dead_to_the = store.inner.lock().unwrap().docs["a.md"].deleted_at;

    host.advance(10 * MS_DAY);
    let mut handler = VersioningHandler::new(store.clone());
    handler
        .handle(&Notice::of(Event::Overflow { dropped: 1 }), &mut host)
        .unwrap();

    // L'istante della morte è un fatto: una riconciliazione che ripassa
    // sulle stesse chiavi non deve riscriverlo, o "vault al tempo T"
    // risponderebbe diversamente a ogni overflow.
    assert_eq!(
        store.inner.lock().unwrap().docs["a.md"].deleted_at,
        dead_to_the
    );
}

#[test]
fn an_overflow_turns_a_lost_rename_into_a_new_history_plus_a_tombstone() {
    let mut host = MemoryHost::new().with_document("vecchia.md", "il corpo");
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("vecchia.md"), ("il corpo").as_bytes(), &mut host)
        .unwrap();
    let previous_ts = store.list(&id("vecchia.md"))[0].ts;
    let mut handler = VersioningHandler::new(store.clone());

    // Il rename avviene e il `DocumentRenamed` va perso: `rename` non viene
    // mai chiamato, quindi la storia NON migra.
    host.rename_of_hidden("vecchia.md", "nuova.md");
    host.advance(1_000);
    handler
        .handle(&Notice::of(Event::Overflow { dropped: 3 }), &mut host)
        .unwrap();

    // La cronologia si spezza — è il costo dell'evento perso, e non si prova
    // a indovinare i rename dal contenuto — ma niente mente sul presente:
    // il nuovo path ha una storia, il vecchio ha un tombstone, e il
    // contenuto di prima resta leggibile.
    assert!(store.is_deleted(&id("vecchia.md")));
    assert_eq!(
        store.read(&id("vecchia.md"), previous_ts, &host).unwrap(),
        "il corpo"
    );
    let new = store.list(&id("nuova.md"));
    assert_eq!(new.len(), 1, "sul nuovo path nasce una storia");
    assert_eq!(
        store.read(&id("nuova.md"), new[0].ts, &host).unwrap(),
        "il corpo"
    );
}

#[test]
fn an_overflow_recovers_the_snapshot_that_the_lost_event_would_have_taken() {
    let mut host = MemoryHost::new().with_document("a.md", "prima");
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
        .unwrap();
    let mut handler = VersioningHandler::new(store.clone());

    // Il contenuto cambia e il `DocumentChanged` va perso.
    host.write_document(&id("a.md"), "seconda", WriteBase::Dictated)
        .unwrap();
    host.advance(1_000);
    handler
        .handle(&Notice::of(Event::Overflow { dropped: 2 }), &mut host)
        .unwrap();

    let versions = store.list(&id("a.md"));
    assert_eq!(versions.len(), 2, "versioni: {versions:?}");
    assert_eq!(
        store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
        "seconda"
    );
    // E ripassare senza che nulla sia cambiato non gonfia la storia: il
    // dedup per contenuto è ciò che rende sostenibile una riconciliazione
    // che rilegge tutto.
    host.advance(1_000);
    handler
        .handle(&Notice::of(Event::Overflow { dropped: 2 }), &mut host)
        .unwrap();
    assert_eq!(store.list(&id("a.md")).len(), 2);
}

#[test]
fn opening_the_vault_photographs_what_has_no_history_yet() {
    let mut host = MemoryHost::new()
        .with_document("a.md", "com'era")
        .with_document("b.md", "anche questa");
    let store = VersionStore::open(&mut host).unwrap();
    // `b.md` una storia ce l'ha già: non deve guadagnare una versione
    // gemella solo perché il vault è stato riaperto.
    store
        .snapshot(&id("b.md"), ("anche questa").as_bytes(), &mut host)
        .unwrap();

    let handler = VersioningHandler::new(store.clone());
    handler.first_snapshot_of_the_vault(&mut host).unwrap();

    assert_eq!(store.list(&id("a.md")).len(), 1, "mai vista → fotografata");
    assert_eq!(
        store.list(&id("b.md")).len(),
        1,
        "già vista → lasciata stare"
    );
    let ts = store.list(&id("a.md"))[0].ts;
    assert_eq!(store.read(&id("a.md"), ts, &host).unwrap(), "com'era");
}

#[test]
fn the_first_write_photographs_the_original() {
    let mut host = MemoryHost::new().with_document("a.md", "com'era");
    let store = VersionStore::open(&mut host).unwrap();
    let mut handler = VersioningHandler::new(store.clone());

    // Il gancio gira prima della prima scrittura: l'originale entra in
    // storia, e la scrittura che segue aggiunge la sua versione.
    handler
        .photograph_before_write(&mut host, &id("a.md"))
        .unwrap();
    host.write_document(&id("a.md"), "adesso", WriteBase::Dictated)
        .unwrap();
    host.advance(1_000);
    // L'evento della scrittura lo consegna il kernel; qui lo si chiama a
    // mano, come fanno gli altri test di questo modulo.
    handler
        .handle(
            &Notice::of(Event::DocumentChanged {
                id: id("a.md"),
                changes: None,
            }),
            &mut host,
        )
        .unwrap();

    let versions = store.list(&id("a.md"));
    assert_eq!(versions.len(), 2, "versioni: {versions:?}");
    assert_eq!(
        store.read(&id("a.md"), versions[1].ts, &host).unwrap(),
        "com'era",
        "l'originale è in storia"
    );
    assert_eq!(
        store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
        "adesso"
    );

    // Il contenuto già fotografato viene deduplicato, non duplicato.
    handler
        .photograph_before_write(&mut host, &id("a.md"))
        .unwrap();
    host.write_document(&id("a.md"), "poi", WriteBase::Dictated)
        .unwrap();
    host.advance(1_000);
    handler
        .handle(
            &Notice::of(Event::DocumentChanged {
                id: id("a.md"),
                changes: None,
            }),
            &mut host,
        )
        .unwrap();
    assert_eq!(store.list(&id("a.md")).len(), 3);
}

#[test]
fn a_creation_is_not_photographed() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    let mut handler = VersioningHandler::new(store.clone());

    // La nota non esiste: la scrittura è una creazione, non c'è un
    // originale da salvare, e il gancio risponde `Ok` senza fotografare.
    handler
        .photograph_before_write(&mut host, &id("c.md"))
        .unwrap();
    host.write_document(&id("c.md"), "nuova", WriteBase::Dictated)
        .unwrap();
    host.advance(1_000);
    handler
        .handle(
            &Notice::of(Event::DocumentChanged {
                id: id("c.md"),
                changes: None,
            }),
            &mut host,
        )
        .unwrap();

    let versions = store.list(&id("c.md"));
    assert_eq!(versions.len(), 1, "versioni: {versions:?}");
    assert_eq!(
        store.read(&id("c.md"), versions[0].ts, &host).unwrap(),
        "nuova",
        "la prima versione è il testo nuovo"
    );
}

#[test]
fn binary_history_survives_rebuild_and_restores_exact_bytes() {
    let doc = id("image.png");
    let original = b"\x89PNG\r\n\x1a\n\0\xff";
    let edited = b"\x89PNG\r\n\x1a\n\xff\0";
    let mut host = MemoryHost::new();
    let base = host.write_document_bytes(&doc, original, None).unwrap();
    let store = VersionStore::open(&mut host).unwrap();
    let mut handler = VersioningHandler::new(store.clone());
    handler.photograph_before_write(&mut host, &doc).unwrap();
    host.write_document_bytes(&doc, edited, Some(base)).unwrap();
    host.advance(1_000);
    handler
        .handle(
            &Notice::of(Event::EntryChanged {
                id: doc.clone(),
                kind: EntryKind::Asset,
            }),
            &mut host,
        )
        .unwrap();
    let versions = store.list(&doc);
    assert_eq!(versions.len(), 2);
    let docs = read_index(&host).unwrap();
    let entry = &docs[doc.as_str()];
    assert_eq!(
        version_source_doc(entry, &doc, versions[0].ts, &host).unwrap(),
        edited
    );
    assert_eq!(
        version_source_doc(entry, &doc, versions[1].ts, &host).unwrap(),
        original
    );

    host.data_remove(INDEX_FILE).unwrap();
    host.denies_write(INDEX_FILE);
    let rebuilt = VersionStore::open(&mut host).unwrap();
    assert_eq!(rebuilt.list(&doc), versions);
    VersioningCommands::default()
        .invoke(
            VERSION_RESTORE,
            serde_json::json!({ DOC: doc.as_str(), TS: versions[1].ts }),
            InvokeMode::Apply,
            &mut host,
        )
        .unwrap();
    assert_eq!(
        fub_abi::traits::VaultRead::read_document_bytes(&host, &doc).unwrap(),
        original
    );
}

#[test]
fn a_corrupt_snapshot_cannot_be_read_or_restored() {
    let doc = id("a.md");
    let mut host = MemoryHost::new().with_document(doc.as_str(), "current!");
    let store = VersionStore::open(&mut host).unwrap();
    let version = store
        .snapshot(&doc, b"original", &mut host)
        .unwrap()
        .unwrap();
    let docs = load_index(&host).unwrap().docs;
    let path = blob(
        &docs[doc.as_str()].dir,
        &snapshot_name(version.ts, doc.as_str()),
    );
    host.data_write(&path, b"tampered").unwrap();

    assert!(matches!(
        store.read(&doc, version.ts, &host),
        Err(PluginError::Internal(_))
    ));
    assert!(matches!(
        VersioningCommands::default().invoke(
            VERSION_RESTORE,
            serde_json::json!({ DOC: doc.as_str(), TS: version.ts }),
            InvokeMode::Apply,
            &mut host,
        ),
        Err(PluginError::Internal(_))
    ));
    assert_eq!(
        fub_abi::traits::VaultRead::read_document(&host, &doc).unwrap(),
        "current!"
    );
}

#[test]
fn a_write_preserves_an_unobserved_external_preimage() {
    let doc = id("data.bin");
    let original = b"\0\xfforiginal";
    let external = b"\xfe\0external";
    let next = b"\x80\0saved";
    let mut host = MemoryHost::new();
    let base = host.write_document_bytes(&doc, original, None).unwrap();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&doc, original, &mut host).unwrap();
    let mut handler = VersioningHandler::new(store.clone());
    let base = host
        .write_document_bytes(&doc, external, Some(base))
        .unwrap();
    handler.photograph_before_write(&mut host, &doc).unwrap();
    host.write_document_bytes(&doc, next, Some(base)).unwrap();
    handler
        .handle(
            &Notice::of(Event::EntryChanged {
                id: doc.clone(),
                kind: EntryKind::Unknown,
            }),
            &mut host,
        )
        .unwrap();
    let versions = store.list(&doc);
    assert_eq!(versions.len(), 3);
    let docs = read_index(&host).unwrap();
    assert_eq!(
        version_source_doc(&docs[doc.as_str()], &doc, versions[1].ts, &host).unwrap(),
        external
    );
}

/// Oltre [`MAX_VERSION_BYTES`] non nasce una versione da nessuna delle
/// strade che fotografano: l'evento, il gancio, la passata dopo un
/// `Overflow`. Accanto, un allegato piccolo si fotografa come sempre.
#[test]
fn a_file_over_the_cap_is_neither_read_nor_copied() {
    let big = id("video.mp4");
    let small = id("foto.png");
    let over = vec![0u8; MAX_VERSION_BYTES as usize + 1];
    let mut host = MemoryHost::new();
    host.write_document_bytes(&big, &over, None).unwrap();
    host.write_document_bytes(&small, b"\x89PNG", None).unwrap();
    let store = VersionStore::open(&mut host).unwrap();
    let mut handler = VersioningHandler::new(store.clone());

    for doc in [&big, &small] {
        handler
            .handle(
                &Notice::of(Event::EntryChanged {
                    id: doc.clone(),
                    kind: EntryKind::Asset,
                }),
                &mut host,
            )
            .unwrap();
    }
    handler.photograph_before_write(&mut host, &big).unwrap();
    handler
        .handle(&Notice::of(Event::Overflow { dropped: 1 }), &mut host)
        .unwrap();

    assert_eq!(
        host.reads_on(big.as_str()),
        (0, 0),
        "oltre il tetto non si apre"
    );
    assert!(store.list(&big).is_empty());
    assert_eq!(store.list(&small).len(), 1);
    assert_eq!(store.snapshot(&big, &over, &mut host).unwrap(), None);
    let stored: usize = host
        .data_list("")
        .unwrap()
        .iter()
        .filter_map(|path| host.data_read(path).unwrap())
        .map(|bytes| bytes.len())
        .sum();
    assert!(stored < 1 << 20, "lo store tiene {stored} byte");
}

/// Il ripristino promette la fotografia di ciò che sostituisce: su una nota
/// cresciuta oltre il tetto non potrebbe mantenerla, quindi rifiuta e la
/// lascia com'è.
#[test]
fn a_restore_does_not_replace_what_it_cannot_photograph() {
    let doc = id("dati.csv");
    let mut host = MemoryHost::new();
    let base = host.write_document_bytes(&doc, b"a,b\n", None).unwrap();
    let store = VersionStore::open(&mut host).unwrap();
    let version = store.snapshot(&doc, b"a,b\n", &mut host).unwrap().unwrap();
    let grown = vec![b'x'; MAX_VERSION_BYTES as usize + 1];
    host.write_document_bytes(&doc, &grown, Some(base)).unwrap();

    let refused = VersioningCommands::default().invoke(
        VERSION_RESTORE,
        serde_json::json!({ DOC: doc.as_str(), TS: version.ts }),
        InvokeMode::Apply,
        &mut host,
    );
    assert!(
        matches!(refused, Err(PluginError::Unserved(_))),
        "{refused:?}"
    );
    assert!(
        fub_abi::traits::VaultRead::read_document_bytes(&host, &doc).unwrap() == grown,
        "la nota attuale resta com'era"
    );
}
