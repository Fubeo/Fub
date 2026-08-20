//! **Una scrittura intera può dire da cosa è partita** (§18.1), e se il file non
//! è più quello il kernel risponde `Stale` senza toccare niente.
//!
//! Fino a questa voce la guardia era privilegio di `apply_edit` — la revisione
//! nella firma e `Conflict` invece della sovrascrittura silenziosa
//! ([decisione 0008](../../../docs/decisions/0008-modifica-chirurgica.md)) — cioè
//! valeva per i *provider* e non per l'editor. `write_document` non portava
//! niente, quindi il salvataggio dell'editor **copriva** una scrittura altrui che
//! il watcher non aveva visto, e nessuna delle due metà del sistema se ne
//! accorgeva.
//!
//! Il caso da cui tutto discende è il primo di questo file, e si scrive solo
//! perché il banco sa fare una cosa che l'app non sa fare apposta: mettere del
//! testo sul disco **alle spalle del kernel**, che è quel che fa un altro
//! programma — o Obsidian — mentre Fub guarda altrove.

use fub_abi::edit::{Revision, WriteBase};
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_kernel::KernelError;
use fub_testkit::{doc, Bench, Mounted};

fn vault() -> Mounted {
    Bench::new().mounts()
}

/// La scrittura altrui che il watcher non ha visto: **prima** era coperta.
#[test]
fn a_write_foreign_not_view_not_becomes_more_covered() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");

    // Ciò che l'editor aveva in mano quando ha aperto il documento.
    let base = ws.document_revision(&id).expect("la revisione di allora");

    // Un altro programma riscrive il file. Il kernel non lo sa: nessun evento,
    // nessun `refresh_from_disk` — è esattamente la finestra in cui il watcher
    // non copre (`VaultStatus.watching`, decisione 0030).
    ws.write("nota.md", "scritto da un'altra app");

    let err = ws
        .write_document(&id, "il mio buffer", WriteBase::DescendsFrom(base))
        .expect_err("la base non combacia più");
    assert!(
        matches!(err, KernelError::Stale(_)),
        "atteso `Stale`, trovato {err:?}"
    );

    // E — la metà che conta davvero — **non è stato scritto niente**: il lavoro
    // dell'altro programma è ancora lì. Un errore restituito dopo aver scritto
    // sarebbe peggio del silenzio di prima, perché l'utente crederebbe di essere
    // stato protetto.
    assert_eq!(ws.read("nota.md"), "scritto da un'altra app");
}

/// La base che combacia passa, e il documento è quello nuovo.
#[test]
fn the_base_that_matches_writes() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");
    let base = ws.document_revision(&id).expect("revisione");

    ws.write_document(&id, "com'è adesso", WriteBase::DescendsFrom(base))
        .expect("nessuno ha scritto nel frattempo");
    assert_eq!(ws.read("nota.md"), "com'è adesso");
}

/// Senza base si scrive comunque: è l'importer, il template, il ripristino —
/// chi non sta correggendo un testo che ha letto ma lo sta **dettando**.
#[test]
fn without_base_is_writes_as_first() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");
    ws.write("nota.md", "scritto da un'altra app");

    ws.write_document(&id, "dettato", WriteBase::Dictated)
        .expect("una scrittura cieca resta possibile, e apposta");
    assert_eq!(ws.read("nota.md"), "dettato");
}

/// La revisione **prodotta** è la base valida della scrittura dopo.
///
/// È la proprietà che rende la guardia una catena invece di un controllo alla
/// prima battuta: senza, il secondo salvataggio nominerebbe una base ormai
/// vecchia e fallirebbe contro sé stesso — cioè l'editor non riuscirebbe più a
/// salvare due volte di fila.
#[test]
fn the_revision_resa_chains_the_write_after() {
    let mut ws = vault();
    let id = doc("nota.md");
    let r1 = ws
        .write_document(&id, "uno", WriteBase::Dictated)
        .expect("prima");
    let r2 = ws
        .write_document(&id, "due", WriteBase::DescendsFrom(r1))
        .expect("la base è quella che la prima ha prodotto");
    ws.write_document(&id, "tre", WriteBase::DescendsFrom(r2))
        .expect("e così via, senza rileggere");
    assert_eq!(ws.read("nota.md"), "tre");
}

/// Una base su un documento che non c'è più è una base che non combacia.
///
/// Non è un errore di lettura da propagare: chi scrive credeva di riscrivere
/// qualcosa che nel frattempo è stato cestinato, e ha diritto alla stessa
/// risposta di chi lo trova cambiato — «non è più quello che pensavi».
#[test]
fn a_base_on_a_document_vanished_and_a_conflict() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");
    let base = ws.document_revision(&id).expect("revisione");
    ws.delete_document(&id).expect("nel cestino");

    let err = ws
        .write_document(&id, "il mio buffer", WriteBase::DescendsFrom(base))
        .expect_err("il documento non c'è più");
    assert!(
        matches!(err, KernelError::Stale(_)),
        "atteso `Stale`, trovato {err:?}"
    );
}

/// Il confronto è col **disco** e non con l'anagrafe.
///
/// È la stessa ragione per cui `document_revision` rilegge: la verità di un
/// documento è il file, e una guardia che si fidasse di una cache direbbe di sì
/// proprio nel caso in cui la cache è indietro — che è il solo caso che deve
/// prendere. Qui l'anagrafe tiene ancora l'impronta di «com'era», e la guardia
/// deve accorgersene lo stesso.
#[test]
fn the_guard_does_not_trust_the_registry() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");
    let old = ws.document_revision(&id).expect("revisione");

    ws.write("nota.md", "cambiato sotto");

    // L'anagrafe è ferma a prima — nessuno le ha detto niente — quindi una base
    // pari a quella che *l'anagrafe* tiene deve comunque essere rifiutata.
    let err = ws
        .write_document(&id, "il mio buffer", WriteBase::DescendsFrom(old))
        .expect_err("l'anagrafe direbbe di sì, il disco dice di no");
    assert!(matches!(err, KernelError::Stale(_)), "{err:?}");
}

/// Una revisione inventata non passa: è ciò che rende la firma una guardia
/// invece di un campo da riempire.
#[test]
fn a_base_invented_not_passes() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");

    let err = ws
        .write_document(
            &id,
            "il mio buffer",
            WriteBase::DescendsFrom(Revision::new("non-esiste")),
        )
        .expect_err("una base che nessuno ha mai prodotto");
    assert!(matches!(err, KernelError::Stale(_)), "{err:?}");
    assert_eq!(ws.read("nota.md"), "com'era");
}

// --- e adesso: dichiarare invece di omettere (decisione 0092) ---------------

/// **Il caso che la voce nominava e nessuno aveva messo in scena**: un vault che
/// il rilevatore non copre, e le due risposte che adesso sono due frasi diverse.
///
/// Messo accanto alla
/// [0030](../../../docs/decisions/0030-il-rilevamento-si-puo-chiedere.md): con
/// `watching: false` — share di rete, cloud drive, vault sincronizzato — il
/// watcher non vede la modifica esterna. Finché la base era un `Option` col
/// default `None`, la guardia era **opt-in proprio dove il rilevamento non
/// c'è**: nessuno dei due meccanismi copriva, e il lavoro di qualcun altro
/// spariva in silenzio.
///
/// Questo banco *è* quel vault — non monta nessun watcher, e `VaultStatus` lo
/// dichiara — quindi ciò che si prova qui è la cosa vera e non una sua imitazione.
#[test]
fn where_the_reader_does_not_cover_the_guard_and_the_single_network() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");
    let base = ws.document_revision(&id).expect("la revisione di allora");

    // La premessa, dichiarata dal kernel stesso e non assunta da noi.
    let state = match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s,
        other => panic!("il canale dati ha risposto fuori tema: {other:?}"),
    };
    assert!(
        !state.watching,
        "questo test vale solo se nessuno sta guardando: è il caso della 0030"
    );

    // Qualcun altro scrive — un altro programma, Obsidian, la sincronizzazione
    // che deposita la versione di un'altra macchina.
    ws.write("nota.md", "il lavoro di qualcun altro");

    // Chi discende da un testo che ha letto **non può più** coprirlo per
    // distrazione: non c'è un modo più corto di scrivere che salti la guardia,
    // perché la firma non ne ha uno.
    let err = ws
        .write_document(&id, "il mio buffer", WriteBase::DescendsFrom(base))
        .expect_err("il file non è più quello");
    assert!(matches!(err, KernelError::Stale(_)), "{err:?}");
    assert_eq!(
        ws.read("nota.md"),
        "il lavoro di qualcun altro",
        "la guardia non serve a niente se restituisce un errore dopo aver scritto"
    );

    // E coprirlo resta possibile — deve restarlo — ma adesso è una **frase**:
    // `Dictated` sta scritto nel sorgente di chi lo fa, e chi legge il diff lo
    // vede. Prima la stessa scelta era un argomento che non c'era.
    ws.write_document(&id, "il mio buffer", WriteBase::Dictated)
        .expect("una scrittura dettata copre, ed è ciò che le si chiede");
    assert_eq!(ws.read("nota.md"), "il mio buffer");
}

/// I due casi non sono lo stesso caso con un valore in meno: la stessa
/// scrittura, sullo stesso documento cambiato sotto, dà due esiti opposti — e la
/// differenza è **soltanto** quale dei due si è nominato.
#[test]
fn the_two_cases_are_two_responses_and_not_a_and_the_its_absence() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "uno", WriteBase::Dictated)
        .expect("prima");
    let base = ws.document_revision(&id).expect("revisione");
    ws.write("nota.md", "due, da fuori");

    assert!(ws
        .write_document(&id, "tre", WriteBase::DescendsFrom(base))
        .is_err());
    assert!(ws.write_document(&id, "tre", WriteBase::Dictated).is_ok());
}
