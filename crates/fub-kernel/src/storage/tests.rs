//! Test del supporto su disco e in memoria.

use super::*;
use std::sync::{Arc, Barrier};

/// La classe che si applica al processo, e root che non scavalca un file
/// senza nessun bit di scrittura (PA T59).
#[cfg(unix)]
#[test]
fn the_write_bit_is_the_one_of_the_class_that_applies() {
    // Proprietario: conta solo il suo bit.
    assert!(unix_writable(0o644, 1000, 100, 1000, 100, &[]));
    assert!(!unix_writable(0o444, 1000, 100, 1000, 100, &[]));
    assert!(!unix_writable(0o466, 1000, 100, 1000, 100, &[]));
    // Gruppo effettivo o supplementare.
    assert!(unix_writable(0o464, 1000, 100, 2000, 100, &[]));
    assert!(unix_writable(0o464, 1000, 100, 2000, 200, &[300, 100]));
    assert!(!unix_writable(0o646, 1000, 100, 2000, 100, &[]));
    // Gli altri: un `0644` di un altro utente non è nostro.
    assert!(!unix_writable(0o644, 1000, 100, 2000, 200, &[]));
    assert!(unix_writable(0o446, 1000, 100, 2000, 200, &[]));
    // Root: rifiuta solo ciò che nessuno può scrivere.
    assert!(!unix_writable(0o444, 1000, 100, 0, 0, &[]));
    assert!(unix_writable(0o644, 1000, 100, 0, 0, &[]));
    assert!(unix_writable(0o440 | 0o002, 1000, 100, 0, 0, &[]));
}

#[test]
fn bounded_reads_check_eof_before_seeking_or_allocating() {
    for rooted in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(temp.path()).unwrap();
        let storage: Box<dyn VaultStorage> = if rooted {
            Box::new(rooted::RootedFsStorage::open(root).unwrap())
        } else {
            Box::new(FsStorage)
        };
        let path = root.join("bytes.bin");
        storage.write(&path, b"0123456789").unwrap();
        assert!(storage.read_at(&path, u64::MAX, 1).unwrap().is_empty());
        assert_eq!(storage.read_at(&path, 8, usize::MAX).unwrap(), b"89");
    }
}

/// Un nome che non si scrive in UTF-8 non è una voce, sui due supporti su
/// disco: l'elenco salta lui e resta intero per gli altri, file e
/// cartelle. Darwin rifiuta un nome così prima di crearlo: il banco
/// gira dove il filesystem accetta byte grezzi.
#[cfg(target_os = "linux")]
#[test]
fn list_skips_a_name_not_in_utf8() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let temp = tempfile::tempdir().unwrap();
    let base = Utf8Path::from_path(temp.path()).unwrap();
    for which in ["fs", "rooted"] {
        let root = base.join(which);
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("a.md"), b"a").unwrap();
        std::fs::create_dir(root.join("b")).unwrap();
        let raw = root.as_std_path();
        std::fs::write(raw.join(OsStr::from_bytes(b"caff\xe8.md")), b"x").unwrap();
        std::fs::create_dir(raw.join(OsStr::from_bytes(b"cart\xe8"))).unwrap();
        let storage: Box<dyn VaultStorage> = match which {
            "fs" => Box::new(FsStorage),
            _ => Box::new(rooted::RootedFsStorage::open(&root).unwrap()),
        };
        let listed: Vec<Utf8PathBuf> = storage
            .list(&root)
            .unwrap_or_else(|and| panic!("{which}: {and}"))
            .into_iter()
            .map(|entry| entry.path)
            .collect();
        assert_eq!(listed, [root.join("a.md"), root.join("b")], "{which}");
    }
}

/// I tre supporti rispondono allo stesso modo: la cartella nasce con gli
/// antenati, e un nome occupato — da una cartella o da un file — è
/// `AlreadyExists` senza toccare ciò che c'era.
#[test]
fn create_dir_makes_ancestors_and_refuses_a_taken_name() {
    let temp = tempfile::tempdir().unwrap();
    let base = Utf8Path::from_path(temp.path()).unwrap();
    for which in ["fs", "rooted", "mem"] {
        let root = base.join(which);
        std::fs::create_dir(&root).unwrap();
        let storage: Box<dyn VaultStorage> = match which {
            "fs" => Box::new(FsStorage),
            "rooted" => Box::new(rooted::RootedFsStorage::open(&root).unwrap()),
            _ => Box::new(MemStorage::new()),
        };
        let dir = root.join("a/b");
        storage.create_dir(&dir).unwrap();
        assert_eq!(storage.stat(&dir).unwrap().kind, EntryKind::Dir, "{which}");
        assert_eq!(
            storage.stat(&root.join("a")).unwrap().kind,
            EntryKind::Dir,
            "{which}"
        );
        assert!(storage.list(&dir).unwrap().is_empty(), "{which}");
        assert_eq!(
            storage.create_dir(&dir).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists,
            "{which}"
        );
        let file = root.join("a/nota.md");
        storage.write(&file, b"testo").unwrap();
        assert_eq!(
            storage.create_dir(&file).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists,
            "{which}"
        );
        assert_eq!(storage.read(&file).unwrap(), b"testo", "{which}");
    }
}

/// Una cartella ha un'identità come un file: la radice di un mount la
/// chiede, e senza un mount su Windows non si registra.
#[test]
fn a_folder_has_an_identity_on_disk() {
    let temp = tempfile::tempdir().unwrap();
    let base = Utf8Path::from_path(temp.path()).unwrap();
    std::fs::create_dir(base.join("a")).unwrap();
    std::fs::create_dir(base.join("b")).unwrap();
    let rooted = rooted::RootedFsStorage::open(base).unwrap();
    for (which, storage) in [
        ("fs", &FsStorage as &dyn VaultStorage),
        ("rooted", &rooted as &dyn VaultStorage),
    ] {
        let a = storage
            .file_identity(&base.join("a"))
            .unwrap_or_else(|error| panic!("{which}: {error}"))
            .unwrap_or_else(|| panic!("{which}: nessuna identità"));
        let b = storage.file_identity(&base.join("b")).unwrap().unwrap();
        assert_ne!(a, b, "{which}");
        assert_eq!(
            storage.file_identity(&base.join("a")).unwrap(),
            Some(a),
            "{which}"
        );
        assert!(
            !storage.same_file(&base.join("a"), &base.join("b")),
            "{which}"
        );
    }
}

// Lo spazio per-documento di una nota è una cartella, e la migrazione lo
// sposta con `rename_no_replace`: ogni supporto deve saperlo fare, e
// rifiutare una destinazione presa senza toccare nessuna delle due. Su
// Windows il supporto radicato apriva la sorgente come file soltanto, e lo
// spazio restava a metà strada, dove la raccolta lo cancellava.
#[test]
fn rename_no_replace_moves_a_folder_and_refuses_a_taken_name() {
    let temp = tempfile::tempdir().unwrap();
    let base = Utf8Path::from_path(temp.path()).unwrap();
    for which in ["fs", "rooted", "mem"] {
        let root = base.join(which);
        std::fs::create_dir(&root).unwrap();
        let storage: Box<dyn VaultStorage> = match which {
            "fs" => Box::new(FsStorage),
            "rooted" => Box::new(rooted::RootedFsStorage::open(&root).unwrap()),
            _ => Box::new(MemStorage::new()),
        };
        let aside = root.join("doc/a.md.in-progress");
        let moved = root.join("doc/b.md");
        let taken = root.join("doc/c.md");
        storage.write(&aside.join("annotazione"), b"a").unwrap();
        storage.write(&taken.join("annotazione"), b"c").unwrap();

        storage
            .rename_no_replace(&aside, &moved)
            .unwrap_or_else(|error| panic!("{which}: {error}"));
        assert_eq!(
            storage.read(&moved.join("annotazione")).unwrap(),
            b"a",
            "{which}"
        );
        assert_eq!(
            storage.stat(&aside).unwrap_err().kind(),
            io::ErrorKind::NotFound,
            "{which}"
        );

        assert_eq!(
            storage
                .rename_no_replace(&moved, &taken)
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists,
            "{which}"
        );
        assert_eq!(
            storage.read(&moved.join("annotazione")).unwrap(),
            b"a",
            "{which}"
        );
        assert_eq!(
            storage.read(&taken.join("annotazione")).unwrap(),
            b"c",
            "{which}"
        );
    }
}

/// La data di una cartella **avanza** quando cambia ciò che le sta dentro.
///
/// Sta qui e non nel banco appaiato di `tests/il_supporto.rs` per la
/// ragione che rende utile un contatore: di là c'è un orologio vero, e due
/// scritture nello stesso millisecondo non si distinguono senza una
/// `sleep`. Il banco appaiato prova ciò che i due sanno promettere insieme
/// — una data c'è, e non torna indietro — questo prova il modello.
#[test]
fn the_data_of_a_folder_follows_that_that_there_is_inside() {
    let mem = MemStorage::new();
    let dir = Utf8Path::new("/vault/note");
    mem.write(&dir.join("a.md"), b"a").unwrap();
    let creation = mem.stat(dir).unwrap().mtime;
    assert_eq!(creation, 1, "una cartella nasce con una data");

    mem.write(&dir.join("b.md"), b"b").unwrap();
    let with_two = mem.stat(dir).unwrap().mtime;
    assert!(with_two > creation, "un file nuovo data la cartella");

    // Appendere a un file che c'è già non è una voce di directory in più.
    mem.append(&dir.join("b.md"), b"bb").unwrap();
    assert_eq!(
        mem.stat(dir).unwrap().mtime,
        with_two,
        "appendere non tocca la cartella"
    );

    // Togliere sì, e la data del file che trasloca non si muove con lui.
    let when_of_the_file = mem.stat(&dir.join("a.md")).unwrap().mtime;
    mem.rename(&dir.join("a.md"), Utf8Path::new("/vault/altrove/a.md"))
        .unwrap();
    assert!(mem.stat(dir).unwrap().mtime > with_two, "l'uscita data");
    assert_eq!(
        mem.stat(Utf8Path::new("/vault/altrove/a.md"))
            .unwrap()
            .mtime,
        when_of_the_file,
        "una rename non riscrive il file"
    );
}

fn a_rename_without_overwrite(storage: &dyn VaultStorage, root: &Utf8Path) {
    let from = root.join("sorgente.md");
    let to = root.join("destinazione.md");
    storage.write(&from, b"sorgente").unwrap();
    storage.write(&to, b"concorrente").unwrap();

    let error = storage
        .rename_no_replace(&from, &to)
        .expect_err("la destinazione occupata deve fermare la rinomina");

    assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(storage.read(&from).unwrap(), b"sorgente");
    assert_eq!(storage.read(&to).unwrap(), b"concorrente");
}

#[test]
fn the_rename_not_buries_who_occupies_the_destination_in_the_middle() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8Path::from_path(dir.path()).unwrap();
    a_rename_without_overwrite(&FsStorage, root);
    a_rename_without_overwrite(&MemStorage::new(), Utf8Path::new("/vault"));
}
#[test]
fn concurrent_filesystem_no_replace_moves_have_one_winner() {
    let temp = tempfile::tempdir().unwrap();
    let root = Utf8Path::from_path(temp.path()).unwrap();
    let from = root.join("source.txt");
    let to = root.join("destination.txt");
    let storage = Arc::new(FsStorage);
    storage.write(&from, b"source").unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let run = |storage: Arc<FsStorage>, barrier: Arc<Barrier>| {
        let from = from.clone();
        let to = to.clone();
        std::thread::spawn(move || {
            barrier.wait();
            storage.rename_no_replace(&from, &to)
        })
    };
    let left = run(Arc::clone(&storage), Arc::clone(&barrier));
    let right = run(Arc::clone(&storage), Arc::clone(&barrier));
    barrier.wait();
    let outcomes = [left.join().unwrap(), right.join().unwrap()];
    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    assert_eq!(storage.read(&to).unwrap(), b"source");
    assert!(!storage.exists(&from));
}

#[test]
fn concurrent_moves_of_one_source_to_different_destinations_have_one_winner() {
    for rooted in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(temp.path()).unwrap();
        let storage: Arc<dyn VaultStorage> = if rooted {
            Arc::new(rooted::RootedFsStorage::open(root).unwrap())
        } else {
            Arc::new(FsStorage)
        };
        let from = root.join("source.txt");
        storage.write(&from, b"source").unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let workers = [root.join("left.txt"), root.join("right.txt")].map(|to| {
            let storage = Arc::clone(&storage);
            let barrier = Arc::clone(&barrier);
            let from = from.clone();
            std::thread::spawn(move || {
                barrier.wait();
                (storage.rename_no_replace(&from, &to), to)
            })
        });
        barrier.wait();
        let outcomes = workers.map(|worker| worker.join().unwrap());
        assert_eq!(
            outcomes.iter().filter(|(result, _)| result.is_ok()).count(),
            1,
            "rooted={rooted}: {outcomes:?}"
        );
        for (result, path) in outcomes {
            if result.is_ok() {
                assert_eq!(storage.read(&path).unwrap(), b"source");
            } else {
                assert!(!storage.exists(&path));
            }
        }
        assert!(!storage.exists(&from));
    }
}

#[test]
fn the_same_name_guard_is_local_to_one_folder() {
    assert!(same_parent_resolution_name(
        Utf8Path::new("/vault/nota.md"),
        Utf8Path::new("/vault/Nota.md")
    ));
    assert!(!same_parent_resolution_name(
        Utf8Path::new("/vault/nota.md"),
        Utf8Path::new("/other/Nota.md")
    ));
    assert!(!same_parent_resolution_name(
        Utf8Path::new("/vault/nota.md"),
        Utf8Path::new("/vault/nota.txt")
    ));
}

/// Il temporaneo di una scrittura vive dentro il vault per una frazione di
/// secondo, e in quella frazione **non deve essere un documento**.
///
/// Il presidio è sull'incastro fra due moduli, non su una stringa: il nome
/// del temporaneo lo compone `storage.rs`, la regola che lo rende invisibile
/// è la politica di esclusione, e sono lontani abbastanza perché un giorno
/// qualcuno cambi il nome del temporaneo senza sapere che c'era una regola
/// da rispettare. Se succede, questo diventa rosso.
///
/// **E si interroga la politica più permissiva che un vault possa
/// dichiarare**, non la funzione pura: prima della §15.6 questo banco
/// chiedeva a `is_ignored_name`, e il `true` che riceveva arrivava dal ramo
/// «comincia per punto». Il giorno in cui un vault dichiara che i nascosti
/// sono documenti — cioè la voce stessa che lo ha riscritto — quel ramo si
/// spegne, il temporaneo diventa un documento per la scansione, e il banco
/// che avrebbe dovuto accorgersene resta verde.
#[test]
fn the_temporary_of_a_write_not_and_a_document() {
    let all = crate::ignore::IgnorePolicy::declaring(Vec::new(), true);
    for path in [
        "/vault/Nota.md",
        "/vault/note/Idea.md",
        "/vault/senza-punto",
    ] {
        let tmp = tmp_path(Utf8Path::new(path));
        let name = tmp.file_name().expect("il temporaneo ha un nome");
        assert!(
            all.excludes(name, crate::ignore::Kind::File),
            "{name}: la scansione lo vedrebbe come un documento nuovo"
        );
    }
}

/// L'altro verso della stessa regola: la forma si riconosce **intera**, e un
/// file dell'utente che comincia per punto non è un temporaneo di nessuno —
/// se lo fosse, un vault che mostra i nascosti continuerebbe a non mostrare
/// proprio i suoi.
#[test]
fn a_hidden_any_not_and_a_temporary() {
    for name in [
        ".gitignore",
        ".bozza.md",
        ".Nota.md.tmp",
        ".Nota.md.tmp12",
        ".Nota.md.tmp-3",
        ".Nota.md.tmpaaa-3",
        ".tmp12-3",
        "Nota.md.tmp12-3",
    ] {
        assert!(!is_write_temporary(name), "{name}");
    }
}

/// E sta **accanto** al file, perché una rename fra due filesystem non è una
/// rename.
#[test]
fn the_temporary_is_in_the_folder_of_destination() {
    let tmp = tmp_path(Utf8Path::new("/vault/note/Idea.md"));
    assert_eq!(tmp.parent(), Some(Utf8Path::new("/vault/note")));
}

/// Due scritture non si scrivono addosso sul temporaneo: se lo facessero,
/// ciò che la rename fa atterrare sarebbe metà dell'una e metà dell'altra —
/// il file troncato che l'atomicità esiste per non produrre, prodotto dalla
/// sua implementazione.
#[test]
fn two_writes_not_have_the_same_temporary() {
    let a = tmp_path(Utf8Path::new("/vault/Nota.md"));
    let b = tmp_path(Utf8Path::new("/vault/Nota.md"));
    assert_ne!(a, b);
}

/// Una cartella vera e il file da proteggere dentro. I banchi del lock
/// stanno qui e non nel banco appaiato perché `exclusive_lock_entro` è del
/// modulo: di là si vedrebbe solo `update_atomic`, che l'attesa non la sa
/// dire e quindi la farebbe durare quanto la pazienza di un utente.
fn folder() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let protected = root.join("settings.json");
    (dir, protected)
}

/// **La prima scrittura in un vault nuovo non perde quella dell'altro**
/// (difetto 0171).
///
/// La corsa vera dura microsecondi e non si presidia col cronometro: la si
/// mette dove sta, cioè **dentro** la finestra. La fusione, alla sua prima
/// chiamata, fa quello che farebbe l'altra installazione — crea la cartella
/// e posa il file — proprio fra il «non c'è niente» che abbiamo appena letto
/// e la scrittura che stiamo per fare. Da lì in poi non c'è più niente di
/// simulato: o il giro si rifà sotto lucchetto rileggendo ciò che l'altro ha
/// scritto, oppure lo si copre.
///
/// Che la fusione venga chiamata due volte è dentro il patto di
/// [`Fusione`], ed è per questo che il contatore serve a distinguere i due
/// giri e non a pretendere che ce ne sia uno solo.
#[test]
fn the_first_write_in_a_vault_new_not_loses_that_of_the_other() {
    let (_dir, within) = folder();
    // Il file sta sotto una cartella che **non c'è ancora**: è la prima
    // scrittura in un vault mai aperto, che è il solo caso senza lucchetto.
    let protected = within.parent().unwrap().join(".fub/settings.json");
    assert!(!protected.parent().unwrap().exists());

    let mut rounds = 0;
    let elsewhere = protected.clone();
    FsStorage
        .update(&protected, &mut |current| {
            rounds += 1;
            if rounds == 1 {
                std::fs::create_dir_all(elsewhere.parent().unwrap())?;
                std::fs::write(&elsewhere, b"tema=scuro\n")?;
            }
            let mut zone = current.map(<[u8]>::to_vec).unwrap_or_default();
            zone.extend_from_slice(b"lingua=it\n");
            Ok(Some(zone))
        })
        .expect("la scrittura riesce");

    let final_state = std::fs::read_to_string(&protected).expect("il file c'è");
    assert!(
        final_state.contains("tema=scuro"),
        "la riga dell'altra installazione è stata coperta da una scrittura \
             composta a partire da un file che, quando l'abbiamo letto, non \
             c'era ancora: {final_state:?}"
    );
    assert!(
        final_state.contains("lingua=it"),
        "e la nostra c'è: {final_state:?}"
    );
}

/// L'altra metà, che impedisce alla riparazione di diventare «si prende il
/// lucchetto comunque»: un aggiornamento che non trova niente da aggiornare
/// e decide di non scrivere **non fa nascere la cartella del vault**. Una
/// radice che l'apertura stessa ha fatto esistere vuota è la differenza fra
/// un vault che non c'è e un vault che c'è ed è vuoto.
#[test]
fn a_update_that_not_writes_not_does_birth_the_folder() {
    let (_dir, within) = folder();
    let protected = within.parent().unwrap().join(".fub/settings.json");

    FsStorage
        .update(&protected, &mut |current| {
            assert!(current.is_none(), "non c'era niente da leggere");
            Ok(None)
        })
        .expect("non scrivere non è un guasto");

    assert!(
        !protected.parent().unwrap().exists(),
        "la cartella del vault è nata da un aggiornamento che non ha \
             scritto niente: {protected}"
    );
}

/// Un lock libero **si prende**: l'attesa che questo modulo si è dato non
/// deve aver trasformato il lock in un ornamento.
#[test]
fn a_lock_free_is_takes() {
    let (_dir, protected) = folder();
    assert!(
        exclusive_lock_entro(&protected, std::time::Duration::from_millis(50)).is_some(),
        "un lock che nessuno tiene non è stato preso: chi salva \
             un'impostazione non è più solo mentre lo fa"
    );
}

/// Chi salva un'impostazione dietro un lock che **nessuno rilascia** ci
/// rinuncia e scrive lo stesso (difetto 0152).
///
/// Il banco tiene il lock e non lo lascia mai, che è il processo morto male
/// o la share di rete visti da dentro un solo processo. Il tentativo gira in
/// un thread a parte con un canale, perché il difetto che presidia non è un
/// esito sbagliato ma un esito che **non arriva**: senza il canale, un banco
/// che vede il difetto resterebbe appeso e il verde di tutti gli altri non
/// si vedrebbe mai. La soglia del canale è cinquanta volte l'attesa detta,
/// cioè non è una misura di quanto ci mette: è la riga che distingue
/// «rinuncia» da «per sempre».
#[test]
fn who_waits_a_lock_dead_not_waits_for_always() {
    let (_dir, protected) = folder();
    let wait_for = std::time::Duration::from_millis(100);
    let held = exclusive_lock_entro(&protected, wait_for).expect("il primo lock si prende");

    let (tx, rx) = std::sync::mpsc::channel();
    let p = protected.clone();
    std::thread::spawn(move || {
        let _ = tx.send(exclusive_lock_entro(&p, wait_for).is_some());
    });

    match rx.recv_timeout(wait_for * 50) {
        Ok(taken) => assert!(
            !taken,
            "il lock è stato dato a due insieme: la rinuncia si è mangiata \
                 anche l'esclusione"
        ),
        Err(_) => panic!(
            "chi salva un'impostazione aspetta per sempre un lock che \
                 nessuno rilascia: nessun esito, nessun errore e niente che \
                 dica che cosa sta aspettando"
        ),
    }
    drop(held);
}

/// Un lock tenuto **per un momento** si aspetta: la rinuncia è per chi non
/// rilascia mai, non per chiunque arrivi secondo.
///
/// È la metà che impedisce alla riparazione di diventare «al primo occupato
/// si scrive senza», cioè di togliere il lock fingendo di tenerlo. Il banco
/// conta i tentativi e non i millisecondi: il lock si libera dopo un tempo
/// più corto dell'attesa detta, quindi o il giro riprova o non lo prende.
#[test]
fn a_lock_held_for_a_momento_is_waits() {
    let (_dir, protected) = folder();
    let wait_for = std::time::Duration::from_secs(2);
    let held = exclusive_lock_entro(&protected, wait_for).expect("il primo lock si prende");

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(100));
        drop(held);
    });

    assert!(
        exclusive_lock_entro(&protected, wait_for).is_some(),
        "il lock non è stato aspettato: chi arriva mentre un altro sta \
             davvero salvando scrive senza, e il lock non protegge più niente"
    );
}
