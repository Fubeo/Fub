//! Test delle storie: fotografie, rinomine, traslochi, ricostruzione e
//! storie di prima delle impronte registrate.

use super::*;

#[test]
fn every_new_content_becomes_a_version() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();

    store
        .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
        .unwrap();
    host.advance(1_000);
    store
        .snapshot(&id("a.md"), ("seconda").as_bytes(), &mut host)
        .unwrap();

    let versions = store.list(&id("a.md"));
    assert_eq!(versions.len(), 2);
    // Dalla più recente: è l'ordine in cui si cerca ciò che si vuole
    // ripescare.
    assert_eq!(
        store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
        "seconda"
    );
    assert_eq!(
        store.read(&id("a.md"), versions[1].ts, &host).unwrap(),
        "prima"
    );
}

#[test]
fn the_line_diff_keeps_order_and_common_lines() {
    use Change::{Added, Removed, Same};
    assert_eq!(
        line_diff("a\nb\nc\n", "a\nx\nc\nd\n").unwrap(),
        vec![Same("a"), Removed("b"), Added("x"), Same("c"), Added("d")]
    );
    assert_eq!(line_diff("", "uno").unwrap(), vec![Added("uno")]);
    assert_eq!(line_diff("uno", "").unwrap(), vec![Removed("uno")]);
    // Una parte diversa troppo grande non si calcola: il pannello lo dice.
    let big_a = (0..3_000).map(|n| format!("a{n}\n")).collect::<String>();
    let big_b = (0..3_000).map(|n| format!("b{n}\n")).collect::<String>();
    assert!(line_diff(&big_a, &big_b).is_none());
}

#[test]
fn the_comparison_summarises_far_lines_and_says_what_it_leaves_out() {
    fn texts(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(content.to_string()),
            UiKind::Badge { label, .. } => out.push(label.to_string()),
            _ => {}
        }
        for child in node.children() {
            texts(child, out);
        }
    }
    let said = |node: UiNode| {
        let mut out = Vec::new();
        texts(&node, &mut out);
        out
    };
    let old = (0..20).map(|n| format!("r{n}\n")).collect::<String>();
    let new = old.replace("r10\n", "dieci\n");
    let lines = said(comparison(old.as_bytes(), new.as_bytes()));
    assert!(lines.contains(&"dieci".to_string()), "{lines:?}");
    assert!(lines.contains(&"r10".to_string()), "{lines:?}");
    assert!(lines.contains(&"  r8".to_string()), "context: {lines:?}");
    assert!(
        !lines.contains(&"  r0".to_string()),
        "far lines are summarised: {lines:?}"
    );
    assert_eq!(
        said(comparison(b"uguale", b"uguale")),
        vec![Text::key(DIFF_SAME).to_string()]
    );
    assert_eq!(
        said(comparison(b"a\r\nb", b"a\nb")),
        vec![Text::key(DIFF_ENDINGS).to_string()]
    );
    assert_eq!(
        said(comparison(&[0xff, 0xfe], b"testo")),
        vec![Text::key(DIFF_BINARY).to_string()]
    );
    let many = (0..1_000).map(|n| format!("n{n}\n")).collect::<String>();
    let lines = said(comparison(b"", many.as_bytes()));
    assert!(lines.len() < 2 * DIFF_MAX_LINES + 3, "{}", lines.len());
    assert!(
        lines.last().unwrap().contains("600"),
        "the rest is counted: {:?}",
        lines.last()
    );
}

#[test]
fn every_key_that_the_panel_writes_is_in_the_catalogs_of_the_languages() {
    // Il difetto: le righe dello storico dicevano «when» — la chiave nuda
    // — perché `Text::message` riceveva il nome dell'argomento come chiave
    // e il risolutore, senza template, ricade sulla chiave stessa. Il
    // sintomo a schermo: file di righe tutte uguali, senza date. Il
    // presidio è generico e non «la chiave when esiste»: ogni chiave che
    // l'albero del pannello scrive deve stare in **ogni** catalogo, così
    // la prossima chiave dimenticata rossa qui e non a schermo.
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
        .unwrap();
    host.advance(1_000);
    store
        .snapshot(&id("a.md"), ("seconda").as_bytes(), &mut host)
        .unwrap();
    host.set_active(Some("a.md"));

    let mut tree = tree(&host).unwrap();
    let mut keys = Vec::new();
    use fub_abi::text::{Localize, Text};
    tree.visit_texts(&mut |t| {
        if let Text::Message(m) = t {
            keys.push(m.key.clone());
        }
    });
    assert!(!keys.is_empty(), "l'albero deve portare messaggi");
    for catalog in catalog() {
        for key in &keys {
            assert!(
                catalog.entries.contains_key(key),
                "il catalogo {} non ha la chiave {key}",
                catalog.locale
            );
        }
    }
}

#[test]
fn a_clock_going_backwards_does_not_disorder_the_history() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();

    store
        .snapshot(&id("a.md"), ("prima").as_bytes(), &mut host)
        .unwrap();
    // L'orologio torna indietro fra due salvataggi (NTP, fuso, VM).
    host.backtrack(60_000);
    store
        .snapshot(&id("a.md"), ("seconda").as_bytes(), &mut host)
        .unwrap();

    let versions = store.list(&id("a.md"));
    assert_eq!(versions.len(), 2);
    // `versions` è dato persistito e deve restare ordinato per tempo:
    // su di esso ragionano "attuale" in `list` e la protezione della più
    // recente in `prune`.
    assert!(
        versions[0].ts > versions[1].ts,
        "la versione nuova deve avere ts maggiore anche a orologio arretrato: {versions:?}"
    );
    assert_eq!(
        store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
        "seconda",
        "l'«attuale» è l'ultima salvata, non l'ultima per orologio"
    );
}

#[test]
fn saving_the_same_text_again_is_not_a_new_version() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();

    assert!(store
        .snapshot(&id("a.md"), b"identica", &mut host)
        .unwrap()
        .is_some());
    assert!(
        store
            .snapshot(&id("a.md"), b"identica", &mut host)
            .unwrap()
            .is_none(),
        "il dedup per contenuto è ciò che rende sostenibile uno snapshot a ogni evento"
    );
    assert_eq!(store.list(&id("a.md")).len(), 1);
}

#[test]
fn a_rename_moves_the_history_with_the_notes() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("vecchia.md"), ("corpo").as_bytes(), &mut host)
        .unwrap();

    store
        .rename(&id("vecchia.md"), &id("nuova.md"), &mut host)
        .unwrap();

    assert!(store.list(&id("vecchia.md")).is_empty());
    let versions = store.list(&id("nuova.md"));
    assert_eq!(versions.len(), 1);
    assert_eq!(
        store.read(&id("nuova.md"), versions[0].ts, &host).unwrap(),
        "corpo"
    );
}

/// Due storie che si uniscono possono portare due fotografie dello stesso
/// millisecondo: succede tutte le volte che l'orologio non fa in tempo a
/// muoversi fra un'operazione e l'altra.
#[test]
fn two_photographs_of_the_same_instant_do_not_swallow_each_other() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    // Orologio fermo: due storie diverse, lo stesso identico istante.
    store
        .snapshot(&id("a.md"), ("la storia che arriva").as_bytes(), &mut host)
        .unwrap();
    store
        .snapshot(&id("b.md"), ("la storia che c'era").as_bytes(), &mut host)
        .unwrap();

    store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();

    let versions = store.list(&id("b.md"));
    assert_eq!(
        versions.len(),
        2,
        "contenuti diversi sono versioni diverse anche a parità di istante: {versions:?}"
    );
    let contents: Vec<String> = versions
        .iter()
        .map(|v| store.read(&id("b.md"), v.ts, &host).unwrap())
        .collect();
    assert!(contents.contains(&"la storia che arriva".to_string()));
    assert!(contents.contains(&"la storia che c'era".to_string()));
}

#[test]
fn a_relocation_reads_all_the_blob_first_of_rewrite_them() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();

    store
        .snapshot(&id("a.md"), ("a zero").as_bytes(), &mut host)
        .unwrap();
    store
        .snapshot(&id("b.md"), ("b zero").as_bytes(), &mut host)
        .unwrap();
    host.advance(1);
    store
        .snapshot(&id("a.md"), ("a uno").as_bytes(), &mut host)
        .unwrap();

    store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();

    let versions = store.list(&id("b.md"));
    assert_eq!(versions.len(), 3, "versioni: {versions:?}");
    let contents: Vec<String> = versions
        .iter()
        .map(|v| store.read(&id("b.md"), v.ts, &host).unwrap())
        .collect();
    for expected in ["a zero", "b zero", "a uno"] {
        assert!(
            contents.iter().any(|text| text == expected),
            "il blob {expected:?} è stato sovrascritto prima di essere letto: {contents:?}"
        );
    }
}

/// AUDIT-DATI-06: un'unione che fallisce a metà non tocca nessun contenuto
/// che l'indice di prima nomina ancora.
///
/// La fotografia di `b.md` a T slittava su T+1 e veniva scritta sul blob
/// T+1 di `a.md`, che la storia di `a.md` nominava ancora; poi slittavano
/// a catena anche le versioni di `a.md`. Un errore su una copia successiva
/// faceva fallire il rename lasciando l'indice di prima, ma quel blob era
/// già stato riscritto: `a.md` a T+1 leggeva il testo di `b.md`.
#[test]
fn a_merge_that_fails_halfway_leaves_every_indexed_content_intact() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("a zero").as_bytes(), &mut host)
        .unwrap();
    store
        .snapshot(&id("b.md"), ("b zero").as_bytes(), &mut host)
        .unwrap();
    host.advance(1);
    store
        .snapshot(&id("a.md"), ("a uno").as_bytes(), &mut host)
        .unwrap();
    host.advance(1);
    store
        .snapshot(&id("a.md"), ("a due").as_bytes(), &mut host)
        .unwrap();
    let history = |store: &VersionStore, doc: &str, host: &MemoryHost| -> Vec<String> {
        store
            .list(&id(doc))
            .iter()
            .rev()
            .map(|v| store.read(&id(doc), v.ts, host).unwrap())
            .collect()
    };
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    let fresh = fresh_dir(&id("b.md"), &host).unwrap();
    let t = store.list(&id("a.md")).last().unwrap().ts;
    // Le copie dopo le prime due cedono, in qualunque delle due cartelle
    // l'unione scelga di scriverle.
    for later in 2..8 {
        for folder in [&dir, &fresh] {
            host.denies_write(&blob(folder, &snapshot_name(t + later, "b.md")));
        }
    }

    let failed = store.rename(&id("a.md"), &id("b.md"), &mut host);

    assert!(failed.is_err(), "una copia negata non è un successo");
    assert_eq!(history(&store, "a.md", &host), ["a zero", "a uno", "a due"]);
    assert_eq!(history(&store, "b.md", &host), ["b zero"]);
    assert_eq!(
        host.data_list(&fresh).unwrap(),
        Vec::<String>::new(),
        "le copie già scritte non restano a fare da storia a nessuno"
    );
    let reopened = VersionStore::open(&mut host).unwrap();
    assert_eq!(
        history(&reopened, "a.md", &host),
        ["a zero", "a uno", "a due"]
    );
}

/// La stessa unione, quando riesce, tiene ogni contenuto e mette la storia
/// che arriva per ultima: l'«attuale» è la nota appena rinominata.
#[test]
fn a_merge_into_a_fresh_folder_keeps_every_version_in_order() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("a zero").as_bytes(), &mut host)
        .unwrap();
    store
        .snapshot(&id("b.md"), ("b zero").as_bytes(), &mut host)
        .unwrap();
    host.advance(1);
    store
        .snapshot(&id("a.md"), ("a uno").as_bytes(), &mut host)
        .unwrap();
    host.advance(1);
    store
        .snapshot(&id("a.md"), ("a due").as_bytes(), &mut host)
        .unwrap();
    let old_dirs: Vec<String> = ["a.md", "b.md"]
        .iter()
        .map(|doc| store.inner.lock().unwrap().docs[*doc].dir.clone())
        .collect();

    store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();

    let texts: Vec<String> = store
        .list(&id("b.md"))
        .iter()
        .rev()
        .map(|v| store.read(&id("b.md"), v.ts, &host).unwrap())
        .collect();
    assert_eq!(texts, ["a zero", "b zero", "a uno", "a due"]);
    for old in &old_dirs {
        assert_eq!(
            host.data_list(old).unwrap(),
            Vec::<String>::new(),
            "{old} resta indietro"
        );
    }
    let reopened = VersionStore::open(&mut host).unwrap();
    assert!(reopened.list(&id("a.md")).is_empty());
    assert_eq!(reopened.list(&id("b.md")).len(), 4);
}

/// Il nome di un blob porta l'estensione del documento: se il contenuto non
/// segue il path, l'indice resta a nominare un `<ts>.md` che `read` andrà a
/// cercare come `<ts>.txt`.
#[test]
fn a_rename_that_changes_the_extension_still_finds_the_old_contents() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("appunti.md"), ("il corpo").as_bytes(), &mut host)
        .unwrap();

    store
        .rename(&id("appunti.md"), &id("appunti.txt"), &mut host)
        .unwrap();

    let versions = store.list(&id("appunti.txt"));
    assert_eq!(versions.len(), 1);
    assert_eq!(
        store
            .read(&id("appunti.txt"), versions[0].ts, &host)
            .unwrap(),
        "il corpo"
    );
}

/// La storia che migra su un path che ne aveva già una: è il ripristino
/// sotto un nome nuovo, e il caso in cui le due metà dello store possono
/// contraddirsi.
#[test]
fn a_history_arriving_where_another_lived_brings_its_contents_along() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();

    // La prima vita di Nota.md, il cestino, e il path che viene rioccupato.
    store
        .snapshot(&id("Nota.md"), ("prima vita\n").as_bytes(), &mut host)
        .unwrap();
    host.advance(1);
    store.tombstone(&id("Nota.md"), &mut host).unwrap();
    host.advance(1);
    store
        .snapshot(&id("Nota.md"), ("usurpatrice\n").as_bytes(), &mut host)
        .unwrap();

    // Il ripristino è una scrittura normale (D8): sul nuovo path nasce
    // *prima* una storia sua — con una cartella sua — e solo dopo arriva il
    // `DocumentRenamed` che ci porta quella vecchia.
    host.advance(1);
    store
        .snapshot(&id("Nota 1.md"), ("prima vita\n").as_bytes(), &mut host)
        .unwrap();
    store
        .rename(&id("Nota.md"), &id("Nota 1.md"), &mut host)
        .unwrap();

    // L'indice nomina tre versioni: devono essere tre contenuti leggibili.
    // Un indice che nomina un contenuto inesistente è il modo in cui il
    // versioning fallisce in modo indistinguibile dal funzionare.
    let versions = store.list(&id("Nota 1.md"));
    assert_eq!(versions.len(), 3, "versioni: {versions:?}");
    let contents: Vec<String> = versions
        .iter()
        .map(|v| {
            store
                .read(&id("Nota 1.md"), v.ts, &host)
                .unwrap_or_else(|and| panic!("versione {}: {and}", v.ts))
        })
        .collect();
    assert!(contents.contains(&"prima vita\n".to_string()));
    assert!(contents.contains(&"usurpatrice\n".to_string()));
}

/// Dopo un'unione la cartella abbandonata non deve restare a dire di chi
/// era: `rebuild_from_store` si fida di `meta.json`, e due cartelle che
/// dichiarano lo stesso `doc_id` diventano una storia sola.
#[test]
fn the_abandoned_folder_does_not_as_back_as_a_second_history() {
    let mut host = MemoryHost::new();
    let expected;
    {
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("Nota.md"), ("prima vita\n").as_bytes(), &mut host)
            .unwrap();
        host.advance(1);
        store
            .snapshot(&id("Nota 1.md"), ("ripristinata\n").as_bytes(), &mut host)
            .unwrap();
        store
            .rename(&id("Nota.md"), &id("Nota 1.md"), &mut host)
            .unwrap();
        expected = store.list(&id("Nota 1.md"));
        assert_eq!(expected.len(), 2);
    }

    // L'indice si perde: si ricostruisce dallo store, che è la verità.
    host.data_write(INDEX_FILE, b"non sono json").unwrap();
    let store = VersionStore::open(&mut host).unwrap();

    assert_eq!(
        store.list(&id("Nota 1.md")).len(),
        expected.len(),
        "la storia unita deve sopravvivere intera alla ricostruzione"
    );
    for v in &expected {
        assert!(
            store.read(&id("Nota 1.md"), v.ts, &host).is_ok(),
            "versione {} irraggiungibile dopo la ricostruzione",
            v.ts
        );
    }
}

/// L'impronta registrata alla scrittura sopravvive alla perdita dell'indice:
/// un blob alterato nel frattempo non diventa "sano" perché lo si
/// ricalcola, e la lettura lo rifiuta.
#[test]
fn a_blob_altered_before_the_rebuild_is_still_refused() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), "originale".as_bytes(), &mut host)
        .unwrap();
    let version = store.list(&id("a.md"))[0];
    let path = blob(
        &store.inner.lock().unwrap().docs["a.md"].dir,
        &snapshot_name(version.ts, "a.md"),
    );

    // Il blob cambia sul disco, l'indice si perde.
    host.data_write(&path, "alterato!".as_bytes()).unwrap();
    host.data_remove(INDEX_FILE).unwrap();
    let store = VersionStore::open(&mut host).unwrap();

    assert_eq!(
        store.list(&id("a.md")),
        vec![version],
        "la ricostruzione ridà l'impronta registrata, non quella dei byte di adesso"
    );
    let refused = store.read(&id("a.md"), version.ts, &host);
    assert!(
        matches!(&refused, Err(PluginError::Internal(_))),
        "il contenuto alterato non si consegna: {refused:?}"
    );
}

/// Una cartella scritta prima che il `meta.json` registrasse le impronte
/// si ricostruisce ancora, ricalcolandole dai byte.
#[test]
fn a_folder_without_registered_fingerprints_is_still_rebuilt() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), "vecchio".as_bytes(), &mut host)
        .unwrap();
    let expected = store.list(&id("a.md"));
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();

    // Il `meta.json` di prima: solo `doc_id` e `deleted_at`.
    host.data_write(
        &blob(&dir, METADATA_FILE),
        br#"{"doc_id":"a.md","deleted_at":null}"#,
    )
    .unwrap();
    host.data_remove(INDEX_FILE).unwrap();
    let store = VersionStore::open(&mut host).unwrap();

    assert_eq!(store.list(&id("a.md")), expected);
    assert_eq!(
        store.read(&id("a.md"), expected[0].ts, &host).unwrap(),
        "vecchio"
    );
}

/// Porta una cartella allo stato di prima delle impronte registrate: il
/// `meta.json` di una volta (solo `doc_id` e `deleted_at`) e un indice
/// scritto da chi non conosceva `registered`.
fn make_legacy(host: &mut MemoryHost, dir: &str, doc: &str) {
    host.data_write(
        &blob(dir, METADATA_FILE),
        format!(r#"{{"doc_id":"{doc}","deleted_at":null}}"#).as_bytes(),
    )
    .unwrap();
    let mut index: serde_json::Value =
        serde_json::from_slice(&host.data_read(INDEX_FILE).unwrap().unwrap()).unwrap();
    index.as_object_mut().unwrap().remove("registered");
    host.data_write(INDEX_FILE, &serde_json::to_vec(&index).unwrap())
        .unwrap();
}

fn registered_versions(host: &MemoryHost, dir: &str) -> Vec<VersionRef> {
    let raw = host.data_read(&blob(dir, METADATA_FILE)).unwrap().unwrap();
    serde_json::from_slice::<Meta>(&raw).unwrap().versions
}

fn index_says_registered(host: &MemoryHost) -> bool {
    let index: serde_json::Value =
        serde_json::from_slice(&host.data_read(INDEX_FILE).unwrap().unwrap()).unwrap();
    index["registered"].as_bool().unwrap_or(false)
}

/// **Una storia di prima delle impronte le riceve alla prima apertura**
/// (FUB-004): finché l'indice c'è, le impronte che ricorda sono quelle della
/// scrittura, ed è l'ultima occasione di salvarle. Poi un blob alterato non
/// diventa "sano" quando l'indice va perso.
#[test]
fn opening_registers_the_fingerprints_a_legacy_history_never_had() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), "originale".as_bytes(), &mut host)
        .unwrap();
    let version = store.list(&id("a.md"))[0];
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    make_legacy(&mut host, &dir, "a.md");
    assert!(registered_versions(&host, &dir).is_empty());
    assert!(!index_says_registered(&host));

    let _store = VersionStore::open(&mut host).unwrap();
    assert_eq!(registered_versions(&host, &dir), vec![version]);
    assert!(index_says_registered(&host));

    // Il blob cambia sul disco e l'indice si perde: la ricostruzione ridà
    // l'impronta della scrittura, e la lettura rifiuta il contenuto.
    let path = blob(&dir, &snapshot_name(version.ts, "a.md"));
    host.data_write(&path, "alterato!".as_bytes()).unwrap();
    host.data_remove(INDEX_FILE).unwrap();
    let store = VersionStore::open(&mut host).unwrap();
    assert_eq!(store.list(&id("a.md")), vec![version]);
    let refused = store.read(&id("a.md"), version.ts, &host);
    assert!(
        matches!(&refused, Err(PluginError::Internal(_))),
        "il contenuto alterato non si consegna: {refused:?}"
    );
}

/// La registrazione si fa una volta: dopo, l'indice lo dice e `open` non
/// guarda più i `meta.json`.
#[test]
fn the_registration_of_fingerprints_happens_once() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), "originale".as_bytes(), &mut host)
        .unwrap();
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    make_legacy(&mut host, &dir, "a.md");
    let _ = VersionStore::open(&mut host).unwrap();
    assert!(index_says_registered(&host));

    // Se `open` guardasse ancora, riscriverebbe questo.
    host.data_write(
        &blob(&dir, METADATA_FILE),
        br#"{"doc_id":"a.md","deleted_at":null}"#,
    )
    .unwrap();
    let _ = VersionStore::open(&mut host).unwrap();
    assert!(
        registered_versions(&host, &dir).is_empty(),
        "la seconda apertura non ha rifatto la registrazione"
    );
}

/// Un indice ricostruito dai byte non registra le impronte che ha appena
/// ricalcolato: sarebbero un'autocertificazione scritta come se fosse della
/// scrittura.
#[test]
fn a_rebuilt_index_does_not_register_the_fingerprints_it_just_computed() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), "originale".as_bytes(), &mut host)
        .unwrap();
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    make_legacy(&mut host, &dir, "a.md");
    host.data_remove(INDEX_FILE).unwrap();

    let store = VersionStore::open(&mut host).unwrap();
    assert_eq!(
        store.list(&id("a.md")).len(),
        1,
        "la storia si ricostruisce"
    );
    assert!(
        registered_versions(&host, &dir).is_empty(),
        "le impronte ricalcolate non finiscono nel meta.json"
    );
    assert!(
        index_says_registered(&host),
        "e l'indice nuovo non rifà la registrazione alla prossima apertura"
    );
}

#[test]
fn a_deletion_leaves_a_tombstone_and_the_content_stays_readable() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
        .unwrap();

    store.tombstone(&id("a.md"), &mut host).unwrap();

    let versions = store.list(&id("a.md"));
    assert_eq!(versions.len(), 1, "cancellare non cancella la storia");
    assert_eq!(
        store.read(&id("a.md"), versions[0].ts, &host).unwrap(),
        "contenuto"
    );
    // E la nota che torna in vita non è più morta.
    host.advance(1_000);
    store
        .snapshot(&id("a.md"), ("risorta").as_bytes(), &mut host)
        .unwrap();
    let inner = store.inner.lock().unwrap();
    assert_eq!(inner.docs["a.md"].deleted_at, None);
}
