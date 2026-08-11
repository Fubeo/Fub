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
//! 4. **una coda troncata non fa rifiutare il resto** (§15.7);
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
use fub_testkit::Banco;

fn doc(id: &str) -> DocId {
    DocId::new(id)
}

/// Le operazioni del registro, nell'ordine in cui sono successe.
fn ops(ws: &Workspace) -> Vec<JournalOp> {
    ws.journal()
        .expect("registro")
        .records
        .into_iter()
        .map(|r| r.op)
        .collect()
}

#[test]
fn ogni_mutazione_del_kernel_lascia_la_propria_riga() {
    let mut banco = Banco::nuovo().monta();
    banco
        .write_document(&doc("a.md"), "uno", WriteBase::Dictated)
        .unwrap();
    banco
        .write_document(&doc("a.md"), "due", WriteBase::Dictated)
        .unwrap();
    let cestinata = banco.delete_document(&doc("a.md")).unwrap();
    banco.restore_from_trash(&cestinata, None).unwrap();
    banco.rename_document(&doc("a.md"), &doc("b.md")).unwrap();

    let ops = ops(&banco);
    assert!(
        matches!(ops[0], JournalOp::Created { .. }),
        "la prima scrittura è una nota che nasce, non una riscrittura: {ops:?}"
    );
    assert!(
        matches!(ops[1], JournalOp::Written { .. }),
        "la seconda no: {ops:?}"
    );
    assert!(matches!(ops[2], JournalOp::Trashed { .. }), "{ops:?}");
    assert!(
        matches!(ops[3], JournalOp::Restored { .. }),
        "un ripristino passa dalla stessa scrittura di una creazione e **non** è \
         una creazione: il suo inverso è ricestinare, non cancellare — {ops:?}"
    );
    assert!(matches!(ops[4], JournalOp::Renamed { .. }), "{ops:?}");
    assert_eq!(ops.len(), 5, "e nessuna riga in più: {ops:?}");
}

/// Il rilevatore non scrive nel registro: quella mutazione non è nostra, e
/// dell'inverso di una scrittura che non abbiamo fatto non dispone nessuno.
#[test]
fn cio_che_il_vault_subisce_da_fuori_non_e_una_nostra_mutazione() {
    let mut banco = Banco::nuovo().monta();
    banco
        .write_document(&doc("a.md"), "uno", WriteBase::Dictated)
        .unwrap();
    let prima = ops(&banco).len();

    banco.scrivi("a.md", "cambiata da un'altra app");
    let abs: Utf8PathBuf = banco.root().join("a.md");
    banco.sync_path(&abs).unwrap();

    assert_eq!(
        ops(&banco).len(),
        prima,
        "una modifica arrivata dal rilevatore non è una riga del registro"
    );
}

/// La differenza con la pila della 0045, e l'unica ragione per cui questo file
/// esiste su disco invece che in memoria.
#[test]
fn il_registro_sopravvive_alla_chiusura_del_vault() {
    let dir = tempfile::tempdir().expect("cartella temporanea");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");

    {
        let mut banco = Banco::su(&root).monta();
        banco
            .write_document(&doc("a.md"), "uno", WriteBase::Dictated)
            .unwrap();
        banco.rename_document(&doc("a.md"), &doc("b.md")).unwrap();
    }

    let banco = Banco::su(&root).monta();
    let ops = ops(&banco);
    assert!(
        ops.iter()
            .any(|op| matches!(op, JournalOp::Renamed { from, to } if from.as_str() == "a.md" && to.as_str() == "b.md")),
        "ciò che è successo prima della chiusura si rilegge dopo: {ops:?}"
    );
}

/// Il lotto tiene insieme le proprie righe, ed è la materia prima del
/// tutto-o-niente che la [0011](../../../docs/decisions/0011-il-lotto.md) non
/// poteva promettere: senza questa chiave, un rollback di un'operazione dovrebbe
/// indovinare dove comincia e dove finisce.
#[test]
fn un_lotto_tiene_insieme_le_proprie_righe() {
    let mut banco = Banco::nuovo().monta();
    banco
        .write_document(&doc("fuori.md"), "x", WriteBase::Dictated)
        .unwrap();
    banco.batch(|ws| {
        ws.write_document(&doc("a.md"), "a", WriteBase::Dictated)
            .unwrap();
        ws.write_document(&doc("b.md"), "b", WriteBase::Dictated)
            .unwrap();
    });

    let records = banco.journal().expect("registro").records;
    assert_eq!(records.len(), 3);
    assert!(
        records[0].batch_key().is_none(),
        "una mutazione che sta da sola non ha un lotto"
    );
    let a = records[1].batch_key().expect("la prima del lotto");
    let b = records[2].batch_key().expect("la seconda del lotto");
    assert_eq!(a, b, "e le due del lotto hanno la stessa chiave");
}

/// Di una modifica chirurgica il registro conserva **dove** e **quanto**, mai
/// **cosa**: l'impronta dice che lì cinque byte sono stati sostituiti da
/// quattro, e chi la legge non ha modo di sapere quali fossero.
#[test]
fn di_una_modifica_chirurgica_resta_l_impronta_e_non_i_byte() {
    let mut banco = Banco::nuovo().monta();
    let id = doc("a.md");
    banco
        .write_document(&id, "il gatto dorme", WriteBase::Dictated)
        .unwrap();
    let base = banco.document_revision(&id).unwrap();
    banco
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![TextEdit::replace(fub_abi::model::Span::new(3, 8), "cane")],
            ),
        )
        .unwrap();
    assert_eq!(banco.read_source(&id).unwrap(), "il cane dorme");

    let footprint = ops(&banco)
        .into_iter()
        .rev()
        .find_map(|op| match op {
            JournalOp::Edited { footprint, .. } => Some(footprint),
            _ => None,
        })
        .expect("la modifica ha lasciato la sua riga");
    assert_eq!(footprint.len(), 1, "un'impronta per edit applicato");
    assert_eq!(
        footprint[0].span,
        fub_abi::model::Span::new(3, 7),
        "dove, nelle coordinate del testo **nuovo**: «cane» sta fra 3 e 7"
    );
    assert_eq!(
        footprint[0].replaced,
        "gatto".len(),
        "e quanto c'era al suo posto — il conto, non i byte"
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
fn non_si_annulla_ciò_che_vorrebbe_il_testo_di_ieri() {
    let mut banco = Banco::nuovo().monta();
    let id = doc("a.md");
    banco
        .write_document(&id, "uno", WriteBase::Dictated)
        .unwrap();
    banco
        .write_document(&id, "unodue", WriteBase::Dictated)
        .unwrap();
    let base = banco.document_revision(&id).unwrap();
    banco
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![TextEdit::replace(fub_abi::model::Span::new(0, 3), "tre")],
            ),
        )
        .unwrap();
    banco.rename_document(&id, &doc("b.md")).unwrap();

    let invertibili: Vec<bool> = ops(&banco).iter().map(JournalOp::is_invertible).collect();
    assert_eq!(
        invertibili,
        vec![true, false, false, true],
        "creazione e rinomina hanno un inverso; riscrittura e modifica no"
    );
}

/// Un crash a metà aggiunta lascia una riga incompleta. La lettura la scarta e
/// **dice di averlo fatto**, invece di rifiutare il file: è il principio del
/// §15.7 applicato a un formato in coda.
#[test]
fn una_coda_troncata_si_scarta_senza_far_rifiutare_il_resto() {
    let dir = tempfile::tempdir().expect("cartella temporanea");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
    {
        let mut banco = Banco::su(&root).monta();
        banco
            .write_document(&doc("a.md"), "uno", WriteBase::Dictated)
            .unwrap();
        banco
            .write_document(&doc("b.md"), "due", WriteBase::Dictated)
            .unwrap();
    }

    // Il crash: gli ultimi byte della riga non sono arrivati sul disco.
    let path = fub_kernel::journal_path(&root);
    let raw = std::fs::read(&path).expect("il registro c'è");
    std::fs::write(&path, &raw[..raw.len() - 12]).expect("tronca");

    let mut banco = Banco::su(&root).monta();
    let lettura = banco.journal().expect("registro");
    assert_eq!(
        lettura.records.len(),
        1,
        "ciò che precede la riga rotta si legge tutto"
    );
    assert_eq!(lettura.scartate, 1, "e la riga rotta si conta");

    // E il registro resta utilizzabile: la riga rotta è stata chiusa
    // all'apertura, quindi la prima aggiunta dopo non ci si attacca sopra.
    banco
        .write_document(&doc("c.md"), "tre", WriteBase::Dictated)
        .unwrap();
    let dopo = banco.journal().expect("registro");
    assert_eq!(
        dopo.records.len(),
        2,
        "la riga nuova si legge accanto a quella vecchia: {:?}",
        dopo.records
    );
    assert_eq!(dopo.scartate, 1, "e non se ne perde una seconda");
}

/// Il registro sta **direttamente** in `.fub/`, non sotto `.fub/data/`: la
/// profondità dichiara la classe ([0048](../../../docs/decisions/0048-una-radice-sola.md)),
/// e un registro di ciò che è successo non si rifà da niente.
///
/// Il presidio è sul path e non su una frase, perché la riga di `todo.md` che
/// apriva questa voce diceva `.fub/data/` — cioè la classe sbagliata scritta in
/// prosa, che nessuno avrebbe visto diventare rossa.
#[test]
fn il_registro_e_autorevole_e_il_path_lo_dice() {
    let banco = Banco::nuovo().monta();
    let path = fub_kernel::journal_path(banco.root());
    assert_eq!(path.parent(), Some(banco.root().join(".fub").as_path()));
    assert!(
        !path.starts_with(fub_kernel::data_root(banco.root())),
        "sotto la radice dei derivati sarebbe «si butta e si rifà»"
    );
}

/// Il registro non contiene il testo dei documenti. È la scelta che tiene la sua
/// dimensione slegata da quella del vault: un file autorevole che nessuno può
/// buttare e che porta dentro una copia di ogni salvataggio è il vault scritto
/// una seconda volta accanto a sé stesso.
#[test]
fn il_registro_non_porta_dentro_il_documento() {
    let mut banco = Banco::nuovo().monta();
    let segreto = "una frase che sta soltanto dentro la nota";
    let id = doc("a.md");
    // **Tutte e sei le varianti**, e non una sola. È la riga per cui questo
    // presidio esisteva e non presidiava: fino alla 0103 esercitava le sole
    // `write_document`, cioè `Created` e `Written`, che per costruzione portano
    // impronte — e restava verde mentre `Edited`, cinquanta righe più su in
    // questo stesso file, dimostrava di portarsi dentro i byte sostituiti.
    banco
        .write_document(&id, segreto, WriteBase::Dictated)
        .unwrap();
    banco
        .write_document(
            &id,
            &format!("{segreto} e poi dell'altro"),
            WriteBase::Dictated,
        )
        .unwrap();
    let base = banco.document_revision(&id).unwrap();
    banco
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![TextEdit::replace(
                    fub_abi::model::Span::new(0, segreto.len()),
                    "poco",
                )],
            ),
        )
        .unwrap();
    banco.rename_document(&id, &doc("b.md")).unwrap();
    banco.delete_document(&doc("b.md")).unwrap();
    let cestinata = ops(&banco)
        .into_iter()
        .rev()
        .find_map(|op| match op {
            JournalOp::Trashed { trash, .. } => Some(trash),
            _ => None,
        })
        .expect("la cancellazione ha lasciato la sua riga");
    banco.restore_from_trash(&cestinata, None).unwrap();

    // Che ci siano davvero passate tutte: senza questa riga il presidio
    // tornerebbe a dire «le varianti che mi è capitato di produrre», che è
    // esattamente il difetto che aveva. Il `match` è **esaustivo e senza `_`**,
    // così una settima variante non si può aggiungere senza passare di qui a
    // dichiarare cosa porta.
    let mut viste = std::collections::BTreeSet::new();
    for op in ops(&banco) {
        viste.insert(match op {
            JournalOp::Created { .. } => "created",
            JournalOp::Written { .. } => "written",
            JournalOp::Edited { .. } => "edited",
            JournalOp::Trashed { .. } => "trashed",
            JournalOp::Restored { .. } => "restored",
            JournalOp::Renamed { .. } => "renamed",
        });
    }
    assert_eq!(
        viste.len(),
        6,
        "il banco deve esercitare ogni variante, non quelle che gli riescono: {viste:?}"
    );

    let raw = std::fs::read_to_string(fub_kernel::journal_path(banco.root())).expect("il registro");
    assert!(
        !raw.contains(segreto),
        "il testo dell'utente non finisce nel registro, da nessuna variante: {raw}"
    );
    assert!(
        raw.contains(&Revision::of(segreto).0),
        "ciò che finisce è l'impronta, che dice *se* è ancora quello e non cosa era"
    );
}

/// Un supporto che **conta le letture del registro** e per il resto è quello in
/// memoria. È la cucitura di `la_radice_non_si_muove.rs` ristretta a una domanda
/// sola: quante volte `journal.jsonl` passa davanti al disco.
struct SupportoCheConta {
    inner: fub_kernel::MemStorage,
    letture: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl fub_kernel::VaultStorage for SupportoCheConta {
    fn read(&self, path: &camino::Utf8Path) -> std::io::Result<Vec<u8>> {
        if path.file_name() == Some("journal.jsonl") {
            self.letture
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        self.inner.read(path)
    }
    fn write(&self, path: &camino::Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.write(path, bytes)
    }
    /// Un aggiornamento **rilegge**, quindi conta come una lettura: la potatura
    /// passa di qui e non da `read`, e non contarla farebbe scendere il numero
    /// senza che nessuna lettura sia sparita.
    fn update(
        &self,
        path: &camino::Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        if path.file_name() == Some("journal.jsonl") {
            self.letture
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &camino::Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &camino::Utf8Path, to: &camino::Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
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
/// Perché le due letture di adesso — `ripara_la_coda`, che guarda l'ultimo byte,
/// e `pota(0)`, che deve rileggere perché la prima può averci appeso un
/// terminatore — non sono un numero da difendere: sono il numero che c'è. Ciò
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
/// `Workspace::pota_il_registro` quando qualcuno dichiara
/// `journal.retention.days`, cioè a ogni apertura vera passata da `fub-host`.
/// Sta fuori da questo tetto perché ha un'altra causa — una chiave dichiarata,
/// non l'apertura — e metterla dentro renderebbe il numero dipendente da chi è
/// montato.
///
/// # Chi è stato rosso
///
/// Questo banco, con una terza `self.storage.read(&self.path)` messa a mano in
/// `Journal::open`: `3` contro un tetto di `2`.
#[test]
fn aprire_un_vault_non_rilegge_il_registro_piu_di_due_volte() {
    let letture = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let inner = fub_kernel::MemStorage::new();
    let root = Utf8PathBuf::from("/vault");
    // Un registro che **c'è già** e finisce per intero: il caso in cui le
    // letture si contano davvero. Su un file che non c'è ognuna torna subito e
    // il banco sarebbe verde per la ragione sbagliata.
    fub_kernel::VaultStorage::write(
        &inner,
        &root.join(".fub/journal.jsonl"),
        b"{\"v\":1,\"at\":1,\"origin\":{\"actor\":{\"kind\":\"user\"}},\"writer\":\"aa\",\"op\":{\"op\":\"created\",\"doc\":\"una.md\",\"to\":\"r1\"}}\n",
    )
    .expect("il registro di partenza");
    let storage = std::sync::Arc::new(SupportoCheConta {
        inner,
        letture: std::sync::Arc::clone(&letture),
    });
    let ws = Workspace::on(
        &root,
        fub_kernel::FormatRegistry::new(),
        storage as std::sync::Arc<dyn fub_kernel::VaultStorage>,
        fub_kernel::MachineSettings::in_memory(),
    );
    let quante = letture.load(std::sync::atomic::Ordering::Relaxed);
    assert!(
        quante >= 1,
        "zero letture vuol dire che il registro non è stato aperto affatto, \
         e allora il tetto qui sotto non dimostra niente"
    );
    assert!(
        quante <= 2,
        "aprire un vault ha letto {quante} volte `journal.jsonl`: al tetto del \
         registro ogni lettura di troppo è ~208 µs, e crescono in silenzio"
    );
    // E il registro si legge ancora: un'apertura che avesse smesso di leggerlo
    // passerebbe il tetto a mani basse.
    assert_eq!(
        ws.journal().expect("registro").records.len(),
        1,
        "la riga di partenza c'è ancora"
    );
}

// ---------------------------------------------------------------------------
// Il conto sul sorgente: ciò che la potatura promette, e ciò che il supporto fa
// ---------------------------------------------------------------------------

/// Il corpo di una funzione preso dal testo del sorgente: dal blocco che la
/// contiene, alla firma, fino alla prima chiusura alla sua indentazione.
fn corpo<'a>(sorgente: &'a str, blocco: &str, firma: &str) -> &'a str {
    let dentro = sorgente
        .split_once(blocco)
        .unwrap_or_else(|| panic!("il blocco `{blocco}` non c'è più: il conto non giudica niente"))
        .1;
    let corpo = dentro
        .split_once(firma)
        .unwrap_or_else(|| panic!("la firma `{firma}` non c'è più: il conto non giudica niente"))
        .1;
    corpo
        .split_once("\n    }")
        .expect("una funzione si chiude alla sua indentazione")
        .0
}

/// Il testo di un commento senza i `//` e senza gli a capo: così una frase si
/// cerca per quello che dice, e non per come `rustfmt` l'ha spezzata.
fn disteso(codice: &str) -> String {
    codice
        .lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix("//"))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// **La potatura non promette un lucchetto che `append` non prende** (difetto
/// 0161).
///
/// # Cosa era falso
///
/// Il commento dentro `Journal::pota` diceva che l'`update` è «la differenza fra
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
/// Tutte e due le metà, verificate: la prima con un `lock_esclusivo` messo a
/// mano in `FsStorage::append`, la seconda rimettendo il commento di prima.
#[test]
fn la_potatura_non_promette_un_lucchetto_che_append_non_prende() {
    const STORAGE: &str = include_str!("../src/storage.rs");
    const JOURNAL: &str = include_str!("../src/journal.rs");

    let aggiunta = corpo(
        STORAGE,
        "impl VaultStorage for FsStorage {",
        "fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {",
    );
    assert!(
        !aggiunta.contains("lock_esclusivo"),
        "`FsStorage::append` ha preso il lucchetto: è una decisione (0067 lo \
         rifiuta a verbale), e il commento di `Journal::pota`, che dichiara la \
         finestra aperta proprio perché non lo prende, va riletto contro questo \
         codice invece che lasciato lì"
    );

    let potatura = disteso(corpo(
        JOURNAL,
        "impl Journal {",
        "pub(crate) fn pota(&self, giorni: u64) {",
    ));
    for frase in ["append", "non passa dal lucchetto", "0067"] {
        assert!(
            potatura.contains(frase),
            "il commento di `Journal::pota` non nomina più «{frase}»: senza, \
             torna a promettere che l'`update` chiude la finestra fra la \
             rilettura e la riscrittura — e l'`update` tiene fuori chi aggiorna, \
             non chi appende: {potatura}"
        );
    }
}
