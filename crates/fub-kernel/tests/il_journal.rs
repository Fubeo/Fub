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
//! 3. **ciò che c'è basta a tornare indietro**, e non per affermazione: l'inverso
//!    che il registro conserva viene ripreso e **applicato**, e il documento
//!    torna com'era;
//! 4. **una coda troncata non fa rifiutare il resto** (§15.7).
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
    ws.journal().records.into_iter().map(|r| r.op).collect()
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

    let records = banco.journal().records;
    assert_eq!(records.len(), 3);
    assert!(
        records[0].batch_key().is_none(),
        "una mutazione che sta da sola non ha un lotto"
    );
    let a = records[1].batch_key().expect("la prima del lotto");
    let b = records[2].batch_key().expect("la seconda del lotto");
    assert_eq!(a, b, "e le due del lotto hanno la stessa chiave");
}

/// Ciò che il registro conserva **basta** a tornare indietro, e lo si prova
/// tornandoci: l'inverso si riprende dalla riga e si applica dal confine di
/// sempre, non da una scorciatoia.
#[test]
fn l_inverso_di_una_modifica_chirurgica_riporta_il_documento_com_era() {
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

    let inverse = banco
        .journal()
        .records
        .into_iter()
        .rev()
        .find_map(|r| match r.op {
            JournalOp::Edited { inverse, .. } => Some(inverse),
            _ => None,
        })
        .expect("il registro conserva l'inverso della modifica");
    banco.apply_edit(&id, inverse).unwrap();

    assert_eq!(
        banco.read_source(&id).unwrap(),
        "il gatto dorme",
        "l'inverso conservato dal registro riporta il documento com'era"
    );
}

/// L'unica variante senza inverso è quella che la 0045 aveva già tenuto fuori
/// dalla pila, e lo **dichiara** invece di scoprirsi tale a chi prova a
/// disfarla.
#[test]
fn il_salvataggio_integrale_e_la_sola_riga_che_non_si_annulla() {
    let mut banco = Banco::nuovo().monta();
    banco
        .write_document(&doc("a.md"), "uno", WriteBase::Dictated)
        .unwrap();
    banco
        .write_document(&doc("a.md"), "due", WriteBase::Dictated)
        .unwrap();
    banco.rename_document(&doc("a.md"), &doc("b.md")).unwrap();

    let invertibili: Vec<bool> = ops(&banco).iter().map(JournalOp::is_invertible).collect();
    assert_eq!(
        invertibili,
        vec![true, false, true],
        "creazione e rinomina hanno un inverso, la riscrittura integrale no"
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
    let lettura = banco.journal();
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
    let dopo = banco.journal();
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
    banco
        .write_document(&doc("a.md"), segreto, WriteBase::Dictated)
        .unwrap();
    banco
        .write_document(
            &doc("a.md"),
            &format!("{segreto} e poi dell'altro"),
            WriteBase::Dictated,
        )
        .unwrap();

    let raw = std::fs::read_to_string(fub_kernel::journal_path(banco.root())).expect("il registro");
    assert!(
        !raw.contains(segreto),
        "il contenuto non finisce nel registro: {raw}"
    );
    assert!(
        raw.contains(&Revision::of(segreto).0),
        "ciò che finisce è l'impronta, che dice *se* è ancora quello e non cosa era"
    );
}
