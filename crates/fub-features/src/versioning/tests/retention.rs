//! Test di ritenzione, svuotamento, potatura, resurrezioni e ricostruzione
//! dell'indice dallo store.

use super::*;

#[test]
fn retention_thins_out_the_past_but_never_the_present() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();

    // Una vita di salvataggi, con l'orologio che avanza fra l'uno e
    // l'altro: due nella stessa ora, poi un mese di distanza, poi un anno.
    for (n, salto) in [
        0,
        60_000,       // stessa ora
        27 * MS_DAY,  // un mese dopo
        MS_HOUR,      // stesso giorno
        335 * MS_DAY, // un anno dopo la prima
        3 * MS_DAY,   // e infine "adesso"
    ]
    .into_iter()
    .enumerate()
    {
        host.advance(salto);
        store
            .snapshot(&id("a.md"), format!("versione {n}").as_bytes(), &mut host)
            .unwrap();
    }

    let now = host.now_unix_millis();
    let kept = store.list(&id("a.md"));
    let eta: Vec<u64> = kept.iter().map(|v| now.saturating_sub(v.ts)).collect();
    assert!(
        eta[0] < MS_HOUR,
        "la più recente resta sempre, anche se il resto è stato potato: {eta:?}"
    );
    assert!(
        eta.iter().all(|and| *and < BAND_DAILY),
        "oltre l'ultima fascia non si conserva: {eta:?}"
    );
    assert!(
        kept.len() < 6,
        "le fasce devono aver assottigliato qualcosa: {eta:?}"
    );
    // E i contenuti potati non restano a occupare spazio nello store: la
    // cartella del documento contiene il suo `meta.json` e **solo** gli
    // snapshot che l'indice nomina, nessuno di più.
    for v in &kept {
        assert!(
            store.read(&id("a.md"), v.ts, &host).is_ok(),
            "una versione tenuta deve essere leggibile"
        );
    }
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    let mut remaining = host.data_list(&dir).unwrap();
    remaining.sort();
    let mut expected: Vec<String> = kept
        .iter()
        .map(|v| blob(&dir, &snapshot_name(v.ts, "a.md")))
        .chain(std::iter::once(blob(&dir, METADATA_FILE)))
        .collect();
    expected.sort();
    assert_eq!(remaining, expected, "un blob potato è rimasto nello store");
}

/// Un banco con le due regolazioni della ritenzione scritte dall'utente.
fn tuned(interval_minutes: f64, retention_days: f64) -> MemoryHost {
    let specs = settings();
    MemoryHost::new()
        .with_value(
            specs[0].clone(),
            fub_abi::settings::SettingValue::Number(interval_minutes),
        )
        .with_value(
            specs[1].clone(),
            fub_abi::settings::SettingValue::Number(retention_days),
        )
}

/// Cinque salvataggi in dodici minuti, uno al minuto o quasi.
fn twelve_minutes(store: &VersionStore, host: &mut MemoryHost) {
    for (n, salto) in [0, 60_000, 60_000, 9 * 60_000, 60_000]
        .into_iter()
        .enumerate()
    {
        host.advance(salto);
        store
            .snapshot(&id("a.md"), format!("versione {n}").as_bytes(), host)
            .unwrap();
    }
}

#[test]
fn without_an_interval_the_first_day_keeps_every_version() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    twelve_minutes(&store, &mut host);
    assert_eq!(store.list(&id("a.md")).len(), 5);
}

#[test]
fn an_interval_keeps_one_version_per_slot_and_always_the_latest() {
    let mut host = tuned(10.0, 90.0);
    let store = VersionStore::open(&mut host).unwrap();
    twelve_minutes(&store, &mut host);

    let kept = store.list(&id("a.md"));
    assert!(
        kept.len() < 5,
        "l'intervallo deve aver assottigliato: {kept:?}"
    );
    assert_eq!(
        store.read(&id("a.md"), kept[0].ts, &host).unwrap(),
        "versione 4",
        "l'ultima resta sempre"
    );
    let slots: Vec<u64> = kept[1..].iter().map(|v| v.ts / (10 * MS_MINUTE)).collect();
    let mut unique = slots.clone();
    unique.dedup();
    assert_eq!(
        slots, unique,
        "due versioni nello stesso intervallo: {kept:?}"
    );
}

#[test]
fn the_retention_sets_the_horizon_and_zero_keeps_everything() {
    let mut host = tuned(0.0, 2.0);
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"vecchia", &mut host).unwrap();
    host.advance(3 * MS_DAY);
    store.snapshot(&id("a.md"), b"nuova", &mut host).unwrap();
    assert_eq!(
        store.list(&id("a.md")).len(),
        1,
        "oltre i due giorni non si tiene"
    );

    let mut host = tuned(0.0, 0.0);
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"vecchia", &mut host).unwrap();
    host.advance(400 * MS_DAY);
    store.snapshot(&id("a.md"), b"nuova", &mut host).unwrap();
    assert_eq!(store.list(&id("a.md")).len(), 2, "0 vuol dire per sempre");
}

#[test]
fn clearing_empties_every_history_and_leaves_no_content_behind() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"uno", &mut host).unwrap();
    host.advance(1_000);
    store.snapshot(&id("a.md"), b"due", &mut host).unwrap();
    store.snapshot(&id("b/c.md"), b"tre", &mut host).unwrap();
    store.tombstone(&id("b/c.md"), &mut host).unwrap();
    // Un orfano che nessun indice nomina: lo svuotamento toglie anche lui.
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    host.data_write(&blob(&dir, "7.md"), b"orfano").unwrap();
    assert_eq!(store.census(), (2, 3));

    assert_eq!(store.clear(&mut host).unwrap(), (2, 3));
    assert_eq!(store.census(), (0, 0));
    assert!(store.list(&id("a.md")).is_empty());
    assert!(!store.is_deleted(&id("b/c.md")));
    assert_eq!(host.data_list("").unwrap(), vec![INDEX_FILE.to_string()]);

    // Riaperto dal disco, lo store è vuoto; e il salvataggio dopo
    // ricomincia una storia nuova.
    let store = VersionStore::open(&mut host).unwrap();
    assert!(store.documents().is_empty());
    store.snapshot(&id("a.md"), b"dopo", &mut host).unwrap();
    assert_eq!(store.list(&id("a.md")).len(), 1);
}

#[test]
fn a_clear_whose_index_cannot_be_written_rebuilds_from_what_is_left() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"uno", &mut host).unwrap();
    host.denies_write(INDEX_FILE);
    assert!(
        store.clear(&mut host).is_err(),
        "un indice negato non è un successo"
    );
    // L'indice non c'è: chi riapre ricostruisce dalle cartelle che dicono
    // ancora di chi sono, cioè da nessuna. Nessuna storia mescolata, nessun
    // indice che nomina un contenuto sparito.
    assert!(host.data_list("").unwrap().is_empty());
    let store = VersionStore::open(&mut host).unwrap();
    assert!(store.documents().is_empty());
}

#[test]
fn the_clear_command_needs_the_store_plans_first_and_cannot_be_undone() {
    let bare = VersioningCommands::default();
    assert!(
        bare.commands().iter().all(|c| c.id != VERSION_CLEAR),
        "senza lo store lo svuotamento non si offre"
    );

    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"uno", &mut host).unwrap();
    let commands = VersioningCommands::over(store.clone());
    let spec = commands
        .commands()
        .into_iter()
        .find(|c| c.id == VERSION_CLEAR)
        .expect("con lo store c'è");
    assert!(spec.scope.writes && !spec.scope.reversible);

    let plan = commands
        .invoke(
            VERSION_CLEAR,
            serde_json::json!({}),
            InvokeMode::DryRun,
            &mut host,
        )
        .unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)));
    assert_eq!(store.census(), (1, 1), "il piano non cancella niente");

    let done = commands
        .invoke(
            VERSION_CLEAR,
            serde_json::json!({}),
            InvokeMode::Apply,
            &mut host,
        )
        .unwrap();
    assert!(done.undo.is_none());
    assert_eq!(store.census(), (0, 0));
}

/// La potatura giudicata sul ramo che conta: decide di buttare qualcosa e
/// la scrittura dell'indice non riesce.
///
/// Ciò che non deve succedere è che sul disco resti un indice che nomina
/// versioni già cancellate — `read` fallirebbe su ognuna, e il versioning
/// sembrerebbe intero mentre non lo è. La direzione innocua dell'errore è
/// l'opposta: il blob che avanza costa spazio e basta.
#[test]
fn a_prune_that_cannot_write_the_index_leaves_every_named_version_readable() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    // Due salvataggi nella stessa ora e poi due giorni di silenzio: al
    // prossimo salvataggio i primi due finiscono nella fascia oraria, dove
    // ne sopravvive uno solo — cioè la potatura ha qualcosa da buttare.
    for (n, salto) in [0, 60_000].into_iter().enumerate() {
        host.advance(salto);
        store
            .snapshot(&id("a.md"), format!("versione {n}").as_bytes(), &mut host)
            .unwrap();
    }
    let before = store.list(&id("a.md")).len();
    assert_eq!(before, 2);

    // Il disco si rifiuta proprio sull'indice, e proprio sul salvataggio
    // che pota.
    host.denies_write(INDEX_FILE);
    host.advance(2 * MS_DAY);
    let result = store.snapshot(&id("a.md"), ("l'ultima").as_bytes(), &mut host);
    assert!(result.is_err(), "una scrittura negata non è un successo");
    assert!(
        store.list(&id("a.md")).len() < before + 1,
        "il banco non prova niente se la potatura non ha buttato nulla"
    );

    // Si riapre dall'indice che è rimasto sul disco: qualunque versione
    // dica di avere, deve poterla leggere.
    let store = VersionStore::open(&mut host).unwrap();
    let versions = store.list(&id("a.md"));
    assert!(!versions.is_empty(), "l'indice sul disco non è vuoto");
    for v in &versions {
        assert!(
            store.read(&id("a.md"), v.ts, &host).is_ok(),
            "l'indice nomina la versione {} e il contenuto non c'è più",
            v.ts
        );
    }
}

/// Porta una nota cestinata fino all'orlo della resurrezione, poi nega al
/// disco **una** delle due scritture dell'anagrafe e chiede il salvataggio
/// che la riporterebbe in vita col contenuto identico (il ramo del dedup,
/// dove non c'è nessun blob da scrivere e l'unica cosa che cambia è il
/// tombstone). Rende ciò che memoria e disco dicono, in quest'ordine.
fn resurrection_denied(rejects: impl Fn(&MemoryHost, &str)) -> (bool, bool) {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
        .unwrap();
    store.tombstone(&id("a.md"), &mut host).unwrap();
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();

    rejects(&host, &dir);
    host.advance(1_000);
    assert!(
        store.snapshot(&id("a.md"), b"identico", &mut host).is_err(),
        "una scrittura negata non è un successo"
    );

    let in_memory = store.is_deleted(&id("a.md"));
    let on_the_disk = VersionStore::open(&mut host)
        .unwrap()
        .is_deleted(&id("a.md"));
    (in_memory, on_the_disk)
}

/// La forma «muta lo stato, poi persisti col `?`» — quella che [`Inner::apply`]
/// toglie di mezzo — giudicata sul campo che l'utente vede: il tombstone.
///
/// Ciò che non deve succedere è che la nota torni viva **solo in memoria**:
/// l'app la mostrerebbe ripristinata, il disco continuerebbe a dirla
/// cestinata, e al riavvio sarebbe di nuovo nel cestino senza che nessuno
/// abbia detto perché. Vale per tutte e due le scritture dell'anagrafe —
/// il `meta.json` della cartella e l'indice — perché a fallire può essere
/// l'una o l'altra.
#[test]
fn a_resurrection_the_disk_refuses_leaves_the_notes_dead_in_memory_too() {
    for (who, rejects) in [
        (
            "meta.json",
            &(|host: &MemoryHost, dir: &str| host.denies_write(&blob(dir, METADATA_FILE)))
                as &dyn Fn(&MemoryHost, &str),
        ),
        ("l'indice", &|host: &MemoryHost, _: &str| {
            host.denies_write(INDEX_FILE)
        }),
    ] {
        let (in_memory, on_the_disk) = resurrection_denied(rejects);
        assert!(
            in_memory,
            "{who} ha detto di no e la memoria è andata avanti da sola: \
                 mostra viva una nota che al riavvio è di nuovo cestinata"
        );
        assert_eq!(
            in_memory, on_the_disk,
            "{who} ha detto di no e memoria e disco raccontano due storie diverse"
        );
    }
}

/// L'altro verso: un presidio che guarda solo il ramo d'errore è cieco a
/// una riparazione che impedisce anche alla resurrezione riuscita di
/// arrivare sul disco.
#[test]
fn a_resurrection_the_disk_accepts_is_alive_in_memory_and_on_disk() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
        .unwrap();
    store.tombstone(&id("a.md"), &mut host).unwrap();

    host.advance(1_000);
    store
        .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
        .unwrap();

    assert!(!store.is_deleted(&id("a.md")), "la nota è tornata viva");
    // Riaperto, e non da zero: uno store che sul disco non ha trovato
    // niente direbbe «non cancellata» anche di una nota che non conosce,
    // e il banco passerebbe a vuoto.
    let reopened = VersionStore::open(&mut host).unwrap();
    assert_eq!(
        reopened.list(&id("a.md")).len(),
        1,
        "il disco non sa niente di questa nota: la domanda sul tombstone non vuol dire nulla"
    );
    assert!(
        !reopened.is_deleted(&id("a.md")),
        "viva in memoria e cestinata sul disco: al riavvio risorge il cestino"
    );
}

/// La stessa forma sull'altro verso del tombstone: chi lo posa lo eredita
/// gratis, senza nessun ramo d'errore da ricordarsi di scrivere.
#[test]
fn a_tombstone_the_disk_refuses_leaves_the_notes_alive_in_memory_too() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
        .unwrap();

    host.denies_write(INDEX_FILE);
    host.advance(1_000);
    assert!(store.tombstone(&id("a.md"), &mut host).is_err());

    assert!(
        !store.is_deleted(&id("a.md")),
        "la memoria l'ha già sepolta e il disco no: il cestino si svuota al riavvio"
    );
    assert!(!VersionStore::open(&mut host)
        .unwrap()
        .is_deleted(&id("a.md")));
}

/// E un salvataggio che non arriva sul disco non lascia in memoria un
/// documento che il disco non ha mai visto: la cartella si sceglie
/// leggendo, si registra scrivendo.
#[test]
fn a_snapshot_the_disk_refuses_does_not_invent_a_document() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    host.denies_write(INDEX_FILE);

    assert!(store
        .snapshot(&id("a.md"), b"contenuto", &mut host)
        .is_err());
    assert!(
        store.documents().is_empty(),
        "l'anagrafe nomina un documento che sul disco non esiste"
    );
}

#[test]
fn the_index_is_rebuilt_from_the_store_never_the_other_way_round() {
    let mut host = MemoryHost::new();
    let ts;
    {
        let store = VersionStore::open(&mut host).unwrap();
        store
            .snapshot(&id("nota/Idea.md"), ("il contenuto").as_bytes(), &mut host)
            .unwrap();
        store.tombstone(&id("nota/Idea.md"), &mut host).unwrap();
        ts = store.list(&id("nota/Idea.md"))[0].ts;
    }
    // L'indice si corrompe: è stato derivato, non è la verità.
    host.data_write(INDEX_FILE, b"non sono json").unwrap();

    let store = VersionStore::open(&mut host).unwrap();
    let versions = store.list(&id("nota/Idea.md"));
    assert_eq!(versions.len(), 1, "le versioni si ritrovano dallo store");
    assert_eq!(versions[0].ts, ts);
    assert_eq!(
        store.read(&id("nota/Idea.md"), ts, &host).unwrap(),
        "il contenuto"
    );
    // Anche il tombstone sopravvive: vive nella cartella, non nell'indice.
    let inner = store.inner.lock().unwrap();
    assert!(inner.docs["nota/Idea.md"].deleted_at.is_some());
}

/// Una cartella il cui `meta.json` non si legge **non** è una cartella
/// libera.
///
/// Il caso non ha bisogno di una collisione di impronte: dopo un rename la
/// chiave migra e la cartella resta col nome dell'impronta vecchia, quindi
/// basta che una nota rinasca con quel path per trovarsela davanti. Se
/// l'anagrafe della cartella è illeggibile e la si dà via, la prima
/// `write_metadata` ci scrive sopra un altro `doc_id`, e alla prima
/// ricostruzione gli snapshot di `b.md` diventano versioni di `a.md`.
#[test]
fn a_folder_whose_metadata_cannot_be_read_is_not_given_to_another_document() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("la storia di a\n").as_bytes(), &mut host)
        .unwrap();
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();
    assert_eq!(
        store.inner.lock().unwrap().docs["b.md"].dir,
        dir,
        "il banco non prova niente se la cartella si è mossa col rename"
    );
    let ts_of_b = store.list(&id("b.md"))[0].ts;

    // L'anagrafe della cartella si corrompe: un troncamento, un disco
    // pieno a metà scrittura.
    host.data_write(&blob(&dir, METADATA_FILE), b"non sono json")
        .unwrap();

    // E una nota nuova nasce col path che quella cartella porta impresso
    // nel nome.
    host.advance(1_000);
    store
        .snapshot(
            &id("a.md"),
            ("una nota tutta nuova\n").as_bytes(),
            &mut host,
        )
        .unwrap();

    assert_ne!(
        store.inner.lock().unwrap().docs["a.md"].dir,
        dir,
        "la cartella di b.md è stata data ad a.md, e il suo meta.json \
             sovrascritto: la storia di b.md è diventata storia di a.md"
    );
    assert_eq!(
        store.read(&id("b.md"), ts_of_b, &host).unwrap(),
        "la storia di a\n",
        "la storia di b.md è ancora dov'era"
    );
}

/// Il rename che unisce due storie, con l'indice che dice di no proprio in
/// mezzo: sul disco deve restare **una** rivendicazione per documento.
///
/// La rivendicazione vecchia se ne andava dopo l'indice, con gli avanzi, e
/// quella era la finestra: due cartelle che dicono `Nota.md`, e
/// `rebuild_from_store` — un `BTreeMap` per `doc_id` — ne teneva quella che
/// capitava per ultima. Qui capitava la cartella *senza* l'unione, quindi
/// si perdevano due versioni su due.
#[test]
fn a_rename_the_index_refuses_leaves_one_claim_for_document() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(
            &id("vecchia.md"),
            ("storia che arriva\n").as_bytes(),
            &mut host,
        )
        .unwrap();
    host.advance(1_000);
    store
        .snapshot(&id("Nota.md"), ("storia che c'era\n").as_bytes(), &mut host)
        .unwrap();

    host.advance(1_000);
    host.denies_write(INDEX_FILE);
    assert!(
        store
            .rename(&id("vecchia.md"), &id("Nota.md"), &mut host)
            .is_err(),
        "una scrittura negata non è un successo"
    );

    let claimants: Vec<String> = host
        .data_list("")
        .unwrap()
        .into_iter()
        .filter(|p| p.ends_with(METADATA_FILE))
        .filter(|p| {
            let raw = host.data_read(p).unwrap().unwrap();
            serde_json::from_slice::<Meta>(&raw).is_ok_and(|m| m.doc_id == "Nota.md")
        })
        .collect();
    assert_eq!(
        claimants.len(),
        1,
        "due cartelle dicono di essere Nota.md: {claimants:?}"
    );

    // E l'indice si perde davvero: è la sola strada per cui una
    // rivendicazione doppia si vede, ed è quella per cui esiste.
    host.data_remove(INDEX_FILE).unwrap();
    let store = VersionStore::open(&mut host).unwrap();
    let versions = store.list(&id("Nota.md"));
    assert_eq!(
        versions.len(),
        2,
        "la ricostruzione ha perso una storia: {versions:?}"
    );
    for v in &versions {
        assert!(
            store.read(&id("Nota.md"), v.ts, &host).is_ok(),
            "l'indice ricostruito nomina la versione {} e il contenuto non c'è",
            v.ts
        );
    }
}

/// Il verso che l'audit aveva letto al contrario, e che va tenuto fermo.
///
/// Fra `write_metadata` riuscita e `write_index` fallita il `meta.json` resta
/// **avanti** all'indice, e sembra una bugia sul disco. Non lo è: il disco
/// è l'autorità e l'indice il derivato, e il meta è avanti *verso il vero* —
/// la nota che risorge è viva davvero, quella che prende il tombstone è
/// morta davvero. La ricostruzione che «risuscita la nota» non sta
/// sbagliando: sta recuperando. Chi «riparasse» questo verso — riscrivendo
/// il meta all'indietro dopo un indice fallito, o invertendo l'ordine —
/// metterebbe il derivato davanti alla verità.
///
/// Questo banco **non è mai stato rosso**, ed è il punto: tiene ferma la
/// metà che l'audit aveva dichiarato guasta e che guasta non era.
#[test]
fn a_metadata_the_index_did_not_follow_is_ahead_of_the_index_never_behind() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("identico").as_bytes(), &mut host)
        .unwrap();
    store.tombstone(&id("a.md"), &mut host).unwrap();

    host.denies_write(INDEX_FILE);
    host.advance(1_000);
    assert!(
        store.snapshot(&id("a.md"), b"identico", &mut host).is_err(),
        "una scrittura negata non è un successo"
    );
    // Indice e memoria restano indietro **insieme**: è la proprietà che
    // `apply` garantisce, e che gli altri banchi già misurano.
    assert!(store.is_deleted(&id("a.md")));

    // Ma il disco no. Persa l'anagrafe derivata, resta quella vera.
    host.data_remove(INDEX_FILE).unwrap();
    assert!(
        !VersionStore::open(&mut host)
            .unwrap()
            .is_deleted(&id("a.md")),
        "il meta è tornato indietro insieme all'indice: la verità sul disco \
             adesso segue il suo derivato"
    );
}

#[test]
fn asking_for_a_version_that_never_existed_says_so() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store
        .snapshot(&id("a.md"), ("contenuto").as_bytes(), &mut host)
        .unwrap();

    assert!(matches!(
        store.read(&id("a.md"), 1, &host),
        Err(PluginError::BadArgs(_))
    ));
    assert!(matches!(
        store.read(&id("mai-vista.md"), 1, &host),
        Err(PluginError::BadArgs(_))
    ));
}
