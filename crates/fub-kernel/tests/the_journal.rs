//! Il **registro delle mutazioni** (§15.2): cosa ci finisce dentro, cosa no, e
//! cosa ci vuole perché quello che c'è basti a tornare indietro.
//!
//! Le proprietà sotto esame sono quattro, e nessuna si vede da dentro il modulo:
//!
//! 1. **ogni mutazione del kernel lascia una riga, e ognuna la propria.** Un
//!    ripristino dal cestino passa da `write_source` come una creazione, e senza
//!    presidio la sua riga direbbe «nota nuova» — cioè un inverso che cancella
//!    invece di ricestinare;
//! 2. **il registro sopravvive alla chiusura del vault.** È la sola cosa che lo
//!    distingue dalla pila della
//!    [0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md), che vive
//!    quanto il vault aperto ed è per questo che quella decisione dichiarava il
//!    §15.2;
//! 3. **il testo dell'utente non ci entra, da nessuna variante.** Non «da
//!    quelle che abbiamo guardato»: il presidio che lo diceva esercitava solo la
//!    riscrittura integrale, cioè l'unica che per costruzione non poteva
//!    portarlo, e restava verde mentre la modifica chirurgica ce lo metteva
//!    (§23.9, [0103](../../../docs/decisions/0103-un-registro-dice-cosa-e-successo.md));
//! 4. **una coda troncata non fa rifiutare il resto** (§15.7), **e costa la
//!    sola riga interrotta**: il record si delimita da sé, quindi chi appende
//!    dopo un'interruzione non si attacca in fondo a ciò che il crash ha
//!    lasciato — nemmeno se nessuno riapre il vault (difetti 0162 e 0163);
//! 5. **la finestra è dell'utente, e il registro si può svuotare.**
//!
//! Cosa questi test **non** presidiano, per la ragione di `la_durabilita.rs`:
//! che dopo un crash vero il registro sia intero. La coda troncata qui si
//! fabbrica tagliando il file, che è l'effetto osservabile del crash e non il
//! crash.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::model::DocId;
use fub_kernel::{JournalOp, Workspace};
use fub_testkit::Bench;

fn doc(id: &str) -> DocId {
    DocId::new(id)
}

/// Le operazioni del registro, nell'ordine in cui sono successe.
fn ops(ws: &Workspace) -> Vec<JournalOp> {
    ws.journal()
        .expect("journal")
        .records
        .into_iter()
        .map(|r| r.op)
        .collect()
}

#[test]
fn every_kernel_mutation_leaves_its_own_line() {
    let mut bench = Bench::new().mounts();
    bench
        .write_document(&doc("a.md"), "one", WriteBase::Dictated)
        .unwrap();
    bench
        .write_document(&doc("a.md"), "two", WriteBase::Dictated)
        .unwrap();
    let trashed = bench.delete_document(&doc("a.md")).unwrap();
    bench.restore_from_trash(&trashed, None).unwrap();
    bench.rename_document(&doc("a.md"), &doc("b.md")).unwrap();

    let ops = ops(&bench);
    assert!(
        matches!(ops[0], JournalOp::Created { .. }),
        "the first write is a note being born, not a rewrite: {ops:?}"
    );
    assert!(
        matches!(ops[1], JournalOp::Written { .. }),
        "the second is not: {ops:?}"
    );
    assert!(matches!(ops[2], JournalOp::Trashed { .. }), "{ops:?}");
    assert!(
        matches!(ops[3], JournalOp::Restored { .. }),
        "a restore passes through the same write as a creation and is **not** \
         a creation: its undo is re-trashing, not deleting — {ops:?}"
    );
    assert!(matches!(ops[4], JournalOp::Renamed { .. }), "{ops:?}");
    assert_eq!(ops.len(), 5, "and no extra line: {ops:?}");
}

/// **«C'era» lo dice il disco, non l'anagrafe** (difetto 0180).
///
/// L'anagrafe è una cache di ciò che si è indicizzato, e finché il vault lo
/// tocca solo il kernel «non lo conosco» e «non c'è» si assomigliano abbastanza
/// da poterli confondere. Da fuori no: un file che un'altra applicazione ha
/// appena creato — un `git checkout`, una sincronizzazione, un editor aperto
/// sulla stessa cartella — c'è sul disco, e in anagrafe non c'è finché il
/// rilevatore non passa. Chi salva sopra quel file in quella finestra scriveva
/// `Created`.
///
/// Il danno non è la parola sbagliata in una lista. Il registro è
/// **autorevole** (0067) e sopra quella variante c'è scritto che «l'inverso è
/// cestinarlo»: un `Created` falso è un annullamento che porta nel cestino un
/// file che non abbiamo creato noi, con dentro ciò che ci aveva messo qualcun
/// altro. Il fatto vero è `Written`, che di inverso non ne ha nessuno, ed è
/// esattamente la differenza fra «disfare» e «buttare via roba altrui».
///
/// L'impronta di partenza resta `None`, e va bene: quella l'anagrafe davvero
/// non ce l'ha, e la variante lo dichiara già («oppure `None` se non la si
/// sapeva»). Non sapere *da cosa* si è partiti è un'informazione mancante; dire
/// che il file non c'era è un'informazione **falsa**.
#[test]
fn writing_over_a_file_that_arrived_from_outside_is_not_a_creation() {
    let mut bench = Bench::new().mounts();

    // Un'altra applicazione posa un file nel vault. Il rilevatore non è ancora
    // passato: sul disco c'è, in anagrafe no.
    bench.write("other.md", "stuff that was already there");

    bench
        .write_document(&doc("other.md"), "my save", WriteBase::Dictated)
        .unwrap();

    let ops = ops(&bench);
    assert!(
        matches!(ops[0], JournalOp::Written { .. }),
        "that file was there, and calling it new gives the journal an undo that \
         trashes someone else's work: {ops:?}"
    );
}

/// Il rilevatore non scrive nel registro: quella mutazione non è nostra, e
/// dell'inverso di una scrittura che non abbiamo fatto non dispone nessuno.
#[test]
fn what_the_vault_suffers_from_outside_is_not_our_mutation() {
    let mut bench = Bench::new().mounts();
    bench
        .write_document(&doc("a.md"), "one", WriteBase::Dictated)
        .unwrap();
    let before = ops(&bench).len();

    bench.write("a.md", "changed by another app");
    let abs: Utf8PathBuf = bench.root().join("a.md");
    bench.sync_path(&abs).unwrap();

    assert_eq!(
        ops(&bench).len(),
        before,
        "a modification that arrived via the detector is not a journal line"
    );
}

/// La differenza con la pila della 0045, e l'unica ragione per cui questo file
/// esiste su disco invece che in memoria.
#[test]
fn the_journal_survives_vault_closure() {
    let dir = tempfile::tempdir().expect("temp directory");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");

    {
        let mut bench = Bench::on(&root).mounts();
        bench
            .write_document(&doc("a.md"), "one", WriteBase::Dictated)
            .unwrap();
        bench.rename_document(&doc("a.md"), &doc("b.md")).unwrap();
    }

    let bench = Bench::on(&root).mounts();
    let ops = ops(&bench);
    assert!(
        ops.iter()
            .any(|op| matches!(op, JournalOp::Renamed { from, to } if from.as_str() == "a.md" && to.as_str() == "b.md")),
        "what happened before closure is readable after: {ops:?}"
    );
}

/// Il lotto tiene insieme le proprie righe, ed è la materia prima del
/// tutto-o-niente che la [0011](../../../docs/decisions/0011-il-lotto.md) non
/// poteva promettere: senza questa chiave, un rollback di un'operazione dovrebbe
/// indovinare dove comincia e dove finisce.
#[test]
fn a_batch_holds_its_own_lines_together() {
    let mut bench = Bench::new().mounts();
    bench
        .write_document(&doc("outside.md"), "x", WriteBase::Dictated)
        .unwrap();
    bench.batch(|ws| {
        ws.write_document(&doc("a.md"), "a", WriteBase::Dictated)
            .unwrap();
        ws.write_document(&doc("b.md"), "b", WriteBase::Dictated)
            .unwrap();
    });

    let records = bench.journal().expect("journal").records;
    assert_eq!(records.len(), 3);
    assert!(
        records[0].batch_key().is_none(),
        "a mutation that stands alone has no batch"
    );
    let a = records[1].batch_key().expect("first in the batch");
    let b = records[2].batch_key().expect("second in the batch");
    assert_eq!(a, b, "and the two in the batch have the same key");
}

/// Di una modifica chirurgica il registro conserva **dove** e **quanto**, mai
/// **cosa**: l'impronta dice che lì cinque byte sono stati sostituiti da
/// quattro, e chi la legge non ha modo di sapere quali fossero.
#[test]
fn a_surgical_edit_leaves_a_footprint_not_the_bytes() {
    let mut bench = Bench::new().mounts();
    let id = doc("a.md");
    bench
        .write_document(&id, "the cat sleeps", WriteBase::Dictated)
        .unwrap();
    let base = bench.document_revision(&id).unwrap();
    bench
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![TextEdit::replace(fub_abi::model::Span::new(4, 7), "dog")],
            ),
        )
        .unwrap();
    assert_eq!(bench.read_source(&id).unwrap(), "the dog sleeps");

    let footprint = ops(&bench)
        .into_iter()
        .rev()
        .find_map(|op| match op {
            JournalOp::Edited { footprint, .. } => Some(footprint),
            _ => None,
        })
        .expect("the edit left its line");
    assert_eq!(footprint.len(), 1, "one footprint per applied edit");
    assert_eq!(
        footprint[0].span,
        fub_abi::model::Span::new(4, 7),
        "where, in the coordinates of the **new** text: \"dog\" is between 3 and 7"
    );
    assert_eq!(
        footprint[0].replaced,
        "cat".len(),
        "and how much was there in its place — the count, not the bytes"
    );
}

/// Le righe che non si annullano sono **le due che porterebbero testo**, e lo
/// **dichiarano** invece di scoprirsi tali a chi prova a disfarle.
///
/// La riscrittura integrale è quella che la 0045 aveva già tenuto fuori dalla
/// pila; la modifica chirurgica ci si è aggiunta con la 0103, che le ha tolto i
/// byte dell'utente. Il presidio è sull'*insieme* e non sulla singola, perché è
/// l'insieme a essere la regola: da un registro non torna indietro ciò che per
/// tornare indietro vuole il contenuto di ieri.
#[test]
fn what_yesterdays_text_would_like_is_not_undone() {
    let mut bench = Bench::new().mounts();
    let id = doc("a.md");
    bench
        .write_document(&id, "one", WriteBase::Dictated)
        .unwrap();
    bench
        .write_document(&id, "onetwo", WriteBase::Dictated)
        .unwrap();
    let base = bench.document_revision(&id).unwrap();
    bench
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![TextEdit::replace(fub_abi::model::Span::new(0, 3), "three")],
            ),
        )
        .unwrap();
    bench.rename_document(&id, &doc("b.md")).unwrap();

    let invertible: Vec<bool> = ops(&bench).iter().map(JournalOp::is_invertible).collect();
    assert_eq!(
        invertible,
        vec![true, false, false, true],
        "creation and rename have an undo; rewrite and edit do not"
    );
}

/// Un crash a metà aggiunta lascia una riga incompleta. La lettura la scarta e
/// **dice di averlo fatto**, invece di rifiutare il file: è il principio del
/// §15.7 applicato a un formato in coda.
#[test]
fn a_truncated_queue_is_pruned_without_making_the_rest_fail() {
    let dir = tempfile::tempdir().expect("temp directory");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
    {
        let mut bench = Bench::on(&root).mounts();
        bench
            .write_document(&doc("a.md"), "one", WriteBase::Dictated)
            .unwrap();
        bench
            .write_document(&doc("b.md"), "two", WriteBase::Dictated)
            .unwrap();
    }

    // Il crash: gli ultimi byte della riga non sono arrivati sul disco.
    let path = fub_kernel::journal_path(&root);
    let raw = std::fs::read(&path).expect("the journal exists");
    std::fs::write(&path, &raw[..raw.len() - 12]).expect("truncate");

    let mut bench = Bench::on(&root).mounts();
    let reading = bench.journal().expect("journal");
    assert_eq!(
        reading.records.len(),
        1,
        "everything before the broken line is read"
    );
    assert_eq!(reading.pruned, 1, "and the broken line is counted");

    // E il registro resta utilizzabile: la riga rotta è stata chiusa
    // all'apertura, quindi la prima aggiunta dopo non ci si attacca sopra.
    bench
        .write_document(&doc("c.md"), "three", WriteBase::Dictated)
        .unwrap();
    let after = bench.journal().expect("journal");
    assert_eq!(
        after.records.len(),
        2,
        "the new line reads beside the old one: {:?}",
        after.records
    );
    assert_eq!(after.pruned, 1, "and no second loss");
}

/// **Un'interruzione costa la riga interrotta, e non anche quella dopo — anche
/// se nessuno riapre il vault** (difetti 0162 e 0163).
///
/// # Cosa era falso
///
/// Che il costo fosse limitato dalla riparazione all'apertura. Lo era solo per
/// chi passava di lì: la coda si tronca quando un processo muore, e l'altro
/// processo che scrive sullo stesso vault — o questo stesso, dopo una `write`
/// arrivata a metà — non riapre niente, appende. La sua riga si attaccava in
/// fondo a quella rotta e diventavano una riga illeggibile sola: due record
/// persi per un'interruzione sola. E la riparazione stessa decideva su una
/// lettura fatta fuori dal lucchetto, quindi poteva mangiarsi allo stesso modo
/// la riga di chi appendeva nel frattempo.
///
/// Adesso il record si delimita da sé — `\n{…}\n` — e non c'è più niente da
/// riparare né da leggere prima di scrivere.
///
/// # Chi è stato rosso
///
/// Questo banco, con il solo terminatore in coda: zero record contro uno, cioè
/// la riga nuova mangiata dalla coda rotta.
#[test]
fn a_truncated_queue_does_not_steal_the_line_after_in_an_open_vault() {
    let dir = tempfile::tempdir().expect("temp directory");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
    let mut bench = Bench::on(&root).mounts();
    bench
        .write_document(&doc("a.md"), "one", WriteBase::Dictated)
        .unwrap();

    // Un record intero comincia dopo un a capo e finisce con un a capo: è ciò
    // che rende il prossimo indipendente da come è finito questo.
    let path = fub_kernel::journal_path(&root);
    let raw = std::fs::read(&path).expect("the journal exists");
    assert_eq!(
        raw.first(),
        Some(&b'\n'),
        "the record carries its own start"
    );
    assert_eq!(raw.last(), Some(&b'\n'), "and its own end");

    // Il crash di **un altro** che scrive sullo stesso registro: gli ultimi byte
    // non sono arrivati sul disco. Il vault qui resta aperto, quindi nessuna
    std::fs::write(&path, &raw[..raw.len() - 12]).expect("truncate");

    bench
        .write_document(&doc("b.md"), "two", WriteBase::Dictated)
        .unwrap();
    let reading = bench.journal().expect("journal");
    assert_eq!(
        reading.records.len(),
        1,
        "the line appended after the truncation is readable: {:?}",
        reading.records
    );
    assert_eq!(
        reading.pruned, 1,
        "and the interruption costs only the interrupted line"
    );
}

/// Il registro sta **direttamente** in `.fub/`, non sotto `.fub/data/`: la
/// profondità dichiara la classe ([0048](../../../docs/decisions/0048-una-radice-sola.md)),
/// e un registro di ciò che è successo non si rifà da niente.
///
/// Il presidio è sul path e non su una frase, perché la riga di `todo.md` che
/// apriva questa voce diceva `.fub/data/` — cioè la classe sbagliata scritta in
/// prosa, che nessuno avrebbe visto diventare rossa.
/// prosa, che nessuno avrebbe visto diventare rossa.
#[test]
fn the_journal_is_authoritative_and_the_path_says_so() {
    let bench = Bench::new().mounts();
    let path = fub_kernel::journal_path(bench.root());
    assert_eq!(path.parent(), Some(bench.root().join(".fub").as_path()));
    assert!(
        !path.starts_with(fub_kernel::data_root(bench.root())),
        "under the derivatives root it would be \"throw away and redo\""
    );
}

/// Il registro non contiene il testo dei documenti. È la scelta che tiene la sua
/// dimensione slegata da quella del vault: un file autorevole che nessuno può
/// buttare e che porta dentro una copia di ogni salvataggio è il vault scritto
/// una seconda volta accanto a sé stesso.
#[test]
fn the_journal_does_not_carry_the_document_inside() {
    let mut bench = Bench::new().mounts();
    let secret = "a phrase that lives only inside the note";
    let id = doc("a.md");
    // **Tutte e sei le varianti**, e non una sola. È la riga per cui questo
    // presidio esisteva e non presidiava: fino alla 0103 esercitava le sole
    // `write_document`, cioè `Created` e `Written`, che per costruzione portano
    // impronte — e restava verde mentre `Edited`, cinquanta righe più su in
    // questo stesso file, dimostrava di portarsi dentro i byte sostituiti.
    bench
        .write_document(&id, secret, WriteBase::Dictated)
        .unwrap();
    bench
        .write_document(
            &id,
            &format!("{secret} and then more"),
            WriteBase::Dictated,
        )
        .unwrap();
    let base = bench.document_revision(&id).unwrap();
    bench
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![TextEdit::replace(
                    fub_abi::model::Span::new(0, secret.len()),
                    "little",
                )],
            ),
        )
        .unwrap();
    bench.rename_document(&id, &doc("b.md")).unwrap();
    bench.delete_document(&doc("b.md")).unwrap();
    let trashed = ops(&bench)
        .into_iter()
        .rev()
        .find_map(|op| match op {
            JournalOp::Trashed { trash, .. } => Some(trash),
            _ => None,
        })
        .expect("the deletion left its line");
    bench.restore_from_trash(&trashed, None).unwrap();

    // Che ci siano davvero passate tutte: senza questa riga il presidio
    // tornerebbe a dire «le varianti che mi è capitato di produrre», che è
    // esattamente il difetto che aveva. Il `match` è **esaustivo e senza `_`**,
    // così una settima variante non si può aggiungere senza passare di qui a
    // dichiarare cosa porta.
    let mut seen = std::collections::BTreeSet::new();
    for op in ops(&bench) {
        seen.insert(match op {
            JournalOp::Created { .. } => "created",
            JournalOp::Written { .. } => "written",
            JournalOp::Edited { .. } => "edited",
            JournalOp::Trashed { .. } => "trashed",
            JournalOp::Restored { .. } => "restored",
            JournalOp::Renamed { .. } => "renamed",
        });
    }
    assert_eq!(
        seen.len(),
        6,
        "the bench must exercise every variant, not just the ones it can: {seen:?}"
    );

    let raw = std::fs::read_to_string(fub_kernel::journal_path(bench.root())).expect("the journal");
    assert!(
        !raw.contains(secret),
        "user text does not end up in the journal, from no variant: {raw}"
    );
    assert!(
        raw.contains(&Revision::of(secret).0),
        "what ends up is the footprint, which says *whether* it is still that and not what it was"
    );
}

/// Un supporto che **conta le letture del registro** e per il resto è quello in
/// memoria. È la cucitura di `la_radice_non_si_muove.rs` ristretta a una domanda
/// sola: quante volte `journal.jsonl` passa davanti al disco.
struct CountingStorage {
    inner: fub_kernel::MemStorage,
    reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl fub_kernel::VaultStorage for CountingStorage {
    fn read(&self, path: &camino::Utf8Path) -> std::io::Result<Vec<u8>> {
        if path.file_name() == Some("journal.jsonl") {
            self.reads
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        self.inner.read(path)
    }
    fn write(
        &self,
        path: &camino::Utf8Path,
        bytes: &[u8],
    ) -> std::io::Result<fub_kernel::storage::Stat> {
        self.inner.write(path, bytes)
    }
    /// Un aggiornamento **rilegge**, quindi conta come una lettura: la potatura
    /// passa di qui e non da `read`, e non contarla farebbe scendere il numero
    /// senza che nessuna lettura sia sparita.
    fn update(
        &self,
        path: &camino::Utf8Path,
        merge: fub_kernel::storage::Merge<'_>,
    ) -> std::io::Result<()> {
        if path.file_name() == Some("journal.jsonl") {
            self.reads
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        self.inner.update(path, merge)
    }
    fn append(&self, path: &camino::Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &camino::Utf8Path, to: &camino::Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(
        &self,
        from: &camino::Utf8Path,
        to: &camino::Utf8Path,
    ) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &camino::Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &camino::Utf8Path) -> std::io::Result<Vec<fub_kernel::DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &camino::Utf8Path) -> std::io::Result<fub_kernel::Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &camino::Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// **Aprire un workspace non legge il registro più di due volte.**
///
/// # Perché un tetto e non un'uguaglianza
///
/// Perché la lettura di adesso — una sola, quella di `prune(0)`, da quando il
/// record si delimita da sé e non c'è più una coda da chiudere all'apertura —
/// non è un numero da difendere: è il numero che c'è. Ciò
/// che va difeso è che non diventino quattro. Un'uguaglianza andrebbe rossa
/// anche a chi le fonde, cioè proprio a chi migliora la cosa che questo banco
/// presidia; un tetto va rosso solo a chi la peggiora.
///
/// # Il numero, e perché è piccolo
///
/// Sul registro di questo repo — 4,2 KB, ventuno righe — una lettura di troppo
/// costa qualche microsecondo. Al tetto del registro (`TETTO` = diecimila
/// record, 1,96 MB) ne costa 208, misurati caldi. Sono le cifre per cui la riga
/// che chiedeva di fondere le letture è stata chiusa come vera e trascurabile:
/// contro un'apertura a freddo di duemila note (896 ms) le due letture di
/// troppo dell'apertura valgono lo 0,05%. Questo banco non le toglie — tiene
/// ferma la taglia, che è l'unica cosa che potrebbe crescere in silenzio.
///
/// # Quello che questo banco non vede
///
/// La **terza** lettura, che il kernel da solo non fa: la fa
/// `Workspace::prunes_the_record` quando qualcuno dichiara
/// `journal.retention.days`, cioè a ogni apertura vera passata da `fub-host`.
/// Sta fuori da questo tetto perché ha un'altra causa — una chiave dichiarata,
/// non l'apertura — e metterla dentro renderebbe il numero dipendente da chi è
/// montato.
///
/// # Chi è stato rosso
///
/// Questo banco, con una terza `self.storage.read(&self.path)` messa a mano in
/// `Journal::open`: `3` contro un tetto di `2`.
/// `Journal::open`: `3` contro un tetto di `2`.
/// `Journal::open`: `3` contro un tetto di `2`.
#[test]
fn opening_a_vault_does_not_reread_the_journal_more_than_twice() {
    let reads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let inner = fub_kernel::MemStorage::new();
    let root = Utf8PathBuf::from("/vault");
    // Un registro che **c'è già** e finisce per intero: il caso in cui le
    // letture si contano davvero. Su un file che non c'è ognuna torna subito e
    // il banco sarebbe verde per la ragione sbagliata.
    fub_kernel::VaultStorage::write(
        &inner,
        &root.join(".fub/journal.jsonl"),
        b"{\"v\":1,\"at\":1,\"origin\":{\"actor\":{\"kind\":\"user\"}},\"writer\":\"aa\",\"op\":{\"op\":\"created\",\"doc\":\"one.md\",\"to\":\"r1\"}}\n",
    )
    .expect("the starting journal");
    let storage = std::sync::Arc::new(CountingStorage {
        inner,
        reads: std::sync::Arc::clone(&reads),
    });
    let ws = Workspace::on(
        &root,
        fub_kernel::FormatRegistry::new(),
        storage as std::sync::Arc<dyn fub_kernel::VaultStorage>,
        fub_kernel::MachineSettings::in_memory(),
    )
    .expect("the vault opens");
    let count = reads.load(std::sync::atomic::Ordering::Relaxed);
    assert!(
        count >= 1,
        "zero reads means the journal was never opened at all, and then the \
         ceiling here proves nothing"
    );
    assert!(
        count <= 2,
        "opening a vault read `journal.jsonl` {count} times: at the journal \
         ceiling every extra read is ~208 µs, and they grow silently"
    );
    // E il registro si legge ancora: un'apertura che avesse smesso di leggerlo
    // passerebbe il tetto a mani basse.
    assert_eq!(
        ws.journal().expect("journal").records.len(),
        1,
        "the starting line is still there"
    );
}

// ---------------------------------------------------------------------------
// Il conto sul sorgente: ciò che la potatura promette, e ciò che il supporto fa
// ---------------------------------------------------------------------------

/// Il corpo di una funzione preso dal testo del sorgente: dal blocco che la
/// contiene, alla firma, fino alla prima chiusura alla sua indentazione.
fn body<'a>(source: &'a str, block: &str, sig: &str) -> &'a str {
    let inside = source
        .split_once(block)
        .unwrap_or_else(|| panic!("block `{block}` no longer exists: the guard judges nothing"))
        .1;
    let body = inside
        .split_once(sig)
        .unwrap_or_else(|| panic!("signature `{sig}` no longer exists: the guard judges nothing"))
        .1;
    body
        .split_once("\n    }")
        .expect("a function closes at its indentation")
        .0
}

/// Il testo di un commento senza i `//` e senza gli a capo: così una frase si
/// cerca per quello che dice, e non per come `rustfmt` l'ha spezzata.
fn flat(code: &str) -> String {
    code
        .lines()
        .map(str::trim)
        .filter_map(|the| the.strip_prefix("//"))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// **Aprire il registro non ci scrive dentro** (difetto 0162).
///
/// # Perché un conto e non un banco
///
/// Perché la corsa che questo tiene fuori non si sa fabbricare — vorrebbe due
/// processi sullo stesso file, e in memoria `MemStorage` prende lo stesso mutex
/// per `append` e per `update`, quindi un banco sarebbe verde per la ragione
/// sbagliata (è la stessa ragione del conto qui sotto). Ciò che si può tenere
/// fermo è la forma: `Journal::open` **legge e pota**, e non aggiunge byte
/// decisi da una lettura fatta fuori dal lucchetto. La riparazione della coda
/// era esattamente quella forma, e il suo posto l'ha preso il delimitatore che
/// ogni record si porta davanti.
///
/// # Chi è stato rosso
///
/// Questo conto, con la `journal.ripara_la_coda();` di prima rimessa in
/// `Journal::open`.
#[test]
fn opening_the_journal_does_not_write_into_it() {
    const JOURNAL: &str = include_str!("../src/journal.rs");

    let opening = body(
        JOURNAL,
        "impl Journal {",
        "pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {",
    );
    let code: String = opening
        .lines()
        .map(str::trim)
        .filter(|the| !the.starts_with("//"))
        .collect::<Vec<_>>()
        .join(" ");
    for gesture in ["append", "repair"] {
        assert!(
            !code.contains(gesture),
            "`Journal::open` names \"{gesture}\": opening the journal does not \
             write into it, because what would be written would be decided by a \
             read made outside the lock — and between the two stands the line of \
             whoever appends (defect 0162). A record self-delimits: {code}"
        );
    }
}

/// **La potatura non promette un lucchetto che `append` non prende** (difetto
/// 0161).
///
/// # Cosa era falso
///
/// Il commento dentro `Journal::prune` diceva che l'`update` è «la differenza fra
/// potare e perdere», cioè che passare dal supporto invece che da un `read` +
/// `write` fatti fuori chiude la finestra in cui una riga appesa sparisce. Non
/// la chiude: il lucchetto di `FsStorage::update` tiene fuori chi *aggiorna*, e
/// `FsStorage::append` è `O_APPEND` senza lucchetto — glielo rifiuta la
/// [0067](../../../docs/decisions/0067-il-registro-di-cio-che-e-successo.md),
/// perché un lock per riga si pagherebbe a ogni salvataggio. La finestra è
/// stretta e dichiarata, non chiusa, e chi legge quel commento deve saperlo.
///
/// # Perché un conto e non un banco
///
/// Perché la cosa da tenere ferma è un **accordo fra due file**, e la corsa che
/// la rompe non si sa fabbricare: in memoria non esiste — `MemStorage` prende lo
/// stesso mutex per `append` e per `update`, quindi un banco su quel supporto
/// sarebbe verde per la ragione sbagliata — e su disco vorrebbe due processi.
/// Ciò che si può tenere fermo è l'accordo: se un giorno `append` prende il
/// lucchetto, il commento diventa troppo pessimista e va riscritto; se qualcuno
/// toglie dal commento la frase che dichiara la finestra, torna la promessa
/// falsa. Il conto guarda le due direzioni.
///
/// # Chi è stato rosso
///
/// Tutte e due le metà, verificate: la prima con un `exclusive_lock` messo a
/// mano in `FsStorage::append`, la seconda rimettendo il commento di prima.
/// mano in `FsStorage::append`, la seconda rimettendo il commento di prima.
/// mano in `FsStorage::append`, la seconda rimettendo il commento di prima.
#[test]
fn pruning_does_not_promise_a_lock_that_append_does_not_take() {
    const STORAGE: &str = include_str!("../src/storage.rs");
    const JOURNAL: &str = include_str!("../src/journal.rs");

    let appending = body(
        STORAGE,
        "impl VaultStorage for FsStorage {",
        "fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {",
    );
    assert!(
        !appending.contains("exclusive_lock"),
        "`FsStorage::append` has taken the lock: it is a decision (0067 refuses \
         it in words), and the comment of `Journal::prune`, which declares the \
         window open precisely because it does not take it, must be re-read \
         against this code instead of left there"
    );

    let pruning = flat(body(
        JOURNAL,
        "impl Journal {",
        "pub(crate) fn prune(&self, days: u64) {",
    ));
    for sentence in ["append", "non passa dal lucchetto", "0067"] {
        assert!(
            pruning.contains(sentence),
            "the comment of `Journal::prune` no longer names \"{sentence}\": without \
             it, it goes back to promising that `update` closes the window between \
             re-read and re-write — and `update` keeps out whoever updates, not \
             whoever appends: {pruning}"
        );
    }
}
