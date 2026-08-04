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

use fub_abi::edit::Revision;
use fub_kernel::KernelError;
use fub_testkit::{doc, Banco, Montato};

fn vault() -> Montato {
    Banco::nuovo().monta()
}

/// La scrittura altrui che il watcher non ha visto: **prima** era coperta.
#[test]
fn una_scrittura_altrui_non_vista_non_viene_piu_coperta() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era").expect("prima scrittura");

    // Ciò che l'editor aveva in mano quando ha aperto il documento.
    let base = ws.document_revision(&id).expect("la revisione di allora");

    // Un altro programma riscrive il file. Il kernel non lo sa: nessun evento,
    // nessun `refresh_from_disk` — è esattamente la finestra in cui il watcher
    // non copre (`VaultStatus.watching`, decisione 0030).
    ws.scrivi("nota.md", "scritto da un'altra app");

    let err = ws
        .write_document_from(&id, "il mio buffer", Some(base))
        .expect_err("la base non combacia più");
    assert!(
        matches!(err, KernelError::Stale(_)),
        "atteso `Stale`, trovato {err:?}"
    );

    // E — la metà che conta davvero — **non è stato scritto niente**: il lavoro
    // dell'altro programma è ancora lì. Un errore restituito dopo aver scritto
    // sarebbe peggio del silenzio di prima, perché l'utente crederebbe di essere
    // stato protetto.
    assert_eq!(ws.leggi("nota.md"), "scritto da un'altra app");
}

/// La base che combacia passa, e il documento è quello nuovo.
#[test]
fn la_base_che_combacia_scrive() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era").expect("prima scrittura");
    let base = ws.document_revision(&id).expect("revisione");

    ws.write_document_from(&id, "com'è adesso", Some(base))
        .expect("nessuno ha scritto nel frattempo");
    assert_eq!(ws.leggi("nota.md"), "com'è adesso");
}

/// Senza base si scrive comunque: è l'importer, il template, il ripristino —
/// chi non sta correggendo un testo che ha letto ma lo sta **dettando**.
#[test]
fn senza_base_si_scrive_come_prima() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era").expect("prima scrittura");
    ws.scrivi("nota.md", "scritto da un'altra app");

    ws.write_document_from(&id, "dettato", None)
        .expect("una scrittura cieca resta possibile, e apposta");
    assert_eq!(ws.leggi("nota.md"), "dettato");
}

/// La revisione **prodotta** è la base valida della scrittura dopo.
///
/// È la proprietà che rende la guardia una catena invece di un controllo alla
/// prima battuta: senza, il secondo salvataggio nominerebbe una base ormai
/// vecchia e fallirebbe contro sé stesso — cioè l'editor non riuscirebbe più a
/// salvare due volte di fila.
#[test]
fn la_revisione_resa_incatena_la_scrittura_dopo() {
    let mut ws = vault();
    let id = doc("nota.md");
    let r1 = ws.write_document(&id, "uno").expect("prima");
    let r2 = ws
        .write_document_from(&id, "due", Some(r1))
        .expect("la base è quella che la prima ha prodotto");
    ws.write_document_from(&id, "tre", Some(r2))
        .expect("e così via, senza rileggere");
    assert_eq!(ws.leggi("nota.md"), "tre");
}

/// Una base su un documento che non c'è più è una base che non combacia.
///
/// Non è un errore di lettura da propagare: chi scrive credeva di riscrivere
/// qualcosa che nel frattempo è stato cestinato, e ha diritto alla stessa
/// risposta di chi lo trova cambiato — «non è più quello che pensavi».
#[test]
fn una_base_su_un_documento_sparito_e_un_conflitto() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era").expect("prima scrittura");
    let base = ws.document_revision(&id).expect("revisione");
    ws.delete_document(&id).expect("nel cestino");

    let err = ws
        .write_document_from(&id, "il mio buffer", Some(base))
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
fn la_guardia_non_si_fida_dell_anagrafe() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era").expect("prima scrittura");
    let vecchia = ws.document_revision(&id).expect("revisione");

    ws.scrivi("nota.md", "cambiato sotto");

    // L'anagrafe è ferma a prima — nessuno le ha detto niente — quindi una base
    // pari a quella che *l'anagrafe* tiene deve comunque essere rifiutata.
    let err = ws
        .write_document_from(&id, "il mio buffer", Some(vecchia))
        .expect_err("l'anagrafe direbbe di sì, il disco dice di no");
    assert!(matches!(err, KernelError::Stale(_)), "{err:?}");
}

/// Una revisione inventata non passa: è ciò che rende la firma una guardia
/// invece di un campo da riempire.
#[test]
fn una_base_inventata_non_passa() {
    let mut ws = vault();
    let id = doc("nota.md");
    ws.write_document(&id, "com'era").expect("prima scrittura");

    let err = ws
        .write_document_from(&id, "il mio buffer", Some(Revision::new("non-esiste")))
        .expect_err("una base che nessuno ha mai prodotto");
    assert!(matches!(err, KernelError::Stale(_)), "{err:?}");
    assert_eq!(ws.leggi("nota.md"), "com'era");
}
