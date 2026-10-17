//! **Lo stato per-documento di chi non è il kernel** (§13.2): chi lo migra al
//! rename, e chi lo raccoglie quando la nota non c'è più.
//!
//! Il banco guarda la cosa da dove si vede il difetto che la voce descrive: lo
//! spazio dati di un plugin **spento**. Un plugin acceso potrebbe migrarsi la
//! chiave da sé ascoltando `DocumentRenamed`, ed è ciò che il versioning e il
//! sidecar dell'organizzazione facevano; uno spento no, e nemmeno uno acceso
//! sente la rinomina fatta ad app chiusa. Se la migrazione funziona per chi non
//! è montato, funziona per tutti — e il contrario non è vero.
//!
//! La convenzione dei path è del contratto (`fub_abi::rules::doc_data`); qui
//! si prova la parte che richiede il disco e l'anagrafe del vault.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::settings::SettingValue;
use fub_abi::traits::PluginManifest;
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, Merge, Stat, VaultStorage};
use fub_kernel::{data_root, FormatRegistry, MachineSettings, Trust, Workspace};
use fub_testkit::restore_document;

/// Un provider che non legge niente: qui i documenti servono a esistere, non a
/// dire qualcosa.
struct NudoProvider;

impl FormatProvider for NudoProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("nudo", "Testo nudo (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

const OFF: &str = "plugin.spento";

fn vault() -> (tempfile::TempDir, Utf8PathBuf, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(NudoProvider))
        .expect("nessun conflitto");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex del vault vuoto");
    (dir, root, ws)
}

/// Scrive un blob nello spazio dati di un plugin **senza passare dal kernel**:
/// è il plugin spento, che non ha un host e non ne avrà uno.
fn write_data_item(root: &Utf8PathBuf, plugin: &str, rel: &str, content: &[u8]) {
    let path = data_root(root).join("plugins").join(plugin).join(rel);
    std::fs::create_dir_all(path.parent().expect("ha un genitore")).expect("cartelle");
    std::fs::write(path, content).expect("scrittura");
}

fn read_data_item(root: &Utf8PathBuf, plugin: &str, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(data_root(root).join("plugins").join(plugin).join(rel)).ok()
}

/// Dove sta lo stato `name` di una nota **mentre è nel cestino**: sotto
/// l'identità della voce, non sotto il suo vecchio path (FUB-003).
fn parked_rel(trashed: &DocId, name: &str) -> String {
    format!(
        "{}{}",
        doc_data::parked_space(trashed),
        doc_data::encode(name)
    )
}

fn notes(ws: &mut Workspace, id: &str, text: &str) -> DocId {
    let doc = DocId::new(id);
    ws.write_document(&doc, text, WriteBase::Dictated)
        .expect("scrittura");
    doc
}

#[test]
fn a_rename_carries_behind_the_state_for_document_also_of_who_and_off() {
    let (_g, root, mut ws) = vault();
    let old = notes(&mut ws, "Progetti/Ferrite.md", "corpo");

    let before = doc_data::path(&old, "annotazioni.json");
    write_data_item(&root, OFF, &before, br#"{"notes":"x"}"#);
    // E qualcosa che il plugin tiene per sé, fuori da `doc/`: non deve muoversi.
    write_data_item(&root, OFF, "indice.json", b"suo");

    ws.rename_document(&old, &DocId::new("Archivio/Ferrite.md"))
        .expect("rinomina");

    let after = doc_data::path(&DocId::new("Archivio/Ferrite.md"), "annotazioni.json");
    assert_eq!(
        read_data_item(&root, OFF, &after).as_deref(),
        Some(&br#"{"notes":"x"}"#[..]),
        "lo stato per-documento non ha seguito la rinomina"
    );
    assert!(
        read_data_item(&root, OFF, &before).is_none(),
        "la chiave vecchia è rimasta viva accanto alla nuova"
    );
    assert_eq!(
        read_data_item(&root, OFF, "indice.json").as_deref(),
        Some(&b"suo"[..]),
        "ciò che sta fuori da `doc/` è del plugin, e il kernel non lo tocca"
    );
    assert!(
        ws.doc_data_warnings().is_empty(),
        "una migrazione riuscita non ha niente da dire"
    );
}

/// **Un allegato rinominato da fuori porta dietro il suo stato** (difetto
/// 0184).
///
/// La rinomina di un allegato fatta **da dentro** lo porta con sé da sempre, e
/// la stessa rinomina fatta dal Finder no: il rilevatore riconosceva l'identità
/// solo di chi ha un modello, e per tutto il resto diceva «sparita e
/// ricomparsa» — due voci d'anagrafe scollegate, con annotazioni, pin e
/// miniatura fermi sotto la chiave vecchia, dove non li cerca più nessuno e
/// dove la prima raccolta li spazza.
///
/// Il banco guarda dallo stesso posto degli altri di questo file — un plugin
/// **spento** —, che qui pesa il doppio: un plugin acceso può ascoltare
/// `EntryChanged`, ma non c'è nessun evento che dica «quell'immagine e questa
/// sono la stessa», quindi ricostruirlo da fuori non è nemmeno possibile.
#[test]
fn a_attachment_renamed_from_outside_carries_behind_the_state_for_document() {
    let (_g, root, mut ws) = vault();
    // Un allegato è un file che nessun provider rivendica: qui i `.md` li
    // parsa `NudoProvider`, i `.png` nessuno.
    std::fs::write(root.join("foto.png"), b"\x89PNG").expect("scrittura");
    ws.reindex().expect("reindex");

    let old = DocId::new("foto.png");
    let before = doc_data::path(&old, "miniatura.bin");
    write_data_item(&root, OFF, &before, b"anteprima");

    // La rinomina la fa qualcun altro: i byte sono già al nome nuovo quando il
    // rilevatore ce lo dice.
    std::fs::create_dir_all(root.join("img")).expect("cartelle");
    std::fs::rename(root.join("foto.png"), root.join("img/foto.png")).expect("rinomina");
    assert!(ws
        .sync_renamed_path(&root.join("foto.png"), &root.join("img/foto.png"))
        .expect("sync"));

    let after = doc_data::path(&DocId::new("img/foto.png"), "miniatura.bin");
    assert_eq!(
        read_data_item(&root, OFF, &after).as_deref(),
        Some(&b"anteprima"[..]),
        "lo stato dell'allegato non ha seguito la rinomina: resta sotto la \
         chiave vecchia, che nessuno cerca più e che la prima raccolta spazza"
    );
    assert!(
        read_data_item(&root, OFF, &before).is_none(),
        "la chiave vecchia è rimasta viva accanto alla nuova"
    );
}

/// **La raccolta non tocca lo spazio di un allegato vivo.** Un `.png` non è un
/// documento, ma è una voce dell'anagrafe: se la raccolta guardasse solo i
/// documenti, ogni apertura cancellerebbe la storia e i dati di ogni allegato.
#[test]
fn the_collection_keeps_the_space_of_a_live_attachment() {
    let (_g, root, mut ws) = vault();
    std::fs::write(root.join("foto.png"), b"\x89PNG").expect("write");
    ws.reindex().expect("reindex");

    let live = doc_data::path(&DocId::new("foto.png"), "miniatura.bin");
    let gone = doc_data::path(&DocId::new("sparita.png"), "miniatura.bin");
    write_data_item(&root, OFF, &live, b"anteprima");
    write_data_item(&root, OFF, &gone, b"orfana");

    // L'apertura raccoglie: è `reindex` che la chiama.
    ws.reindex().expect("reindex");
    assert_eq!(
        read_data_item(&root, OFF, &live).as_deref(),
        Some(&b"anteprima"[..]),
        "the collection removed the per-document space of a live attachment"
    );
    assert!(
        read_data_item(&root, OFF, &gone).is_none(),
        "the space of an attachment that no longer exists was not collected"
    );
}

/// L'altra metà, che impedisce alla riparazione di diventare «ogni coppia di
/// path si migra»: se a destinazione c'è già un allegato **vivo**, la mossa non
/// è una rinomina — `mv foto.png logo.png` sovrascrive un file che era di
/// qualcun altro — e il suo stato non si tocca. Il prezzo è dichiarato dov'è
/// dichiarato per i documenti: la storia di chi è partito si spezza.
#[test]
fn a_attachment_that_lands_on_a_live_not_of_it_takes_the_state() {
    let (_g, root, mut ws) = vault();
    std::fs::write(root.join("foto.png"), b"\x89PNG").expect("scrittura");
    std::fs::write(root.join("logo.png"), b"\x89PNGlogo").expect("scrittura");
    ws.reindex().expect("reindex");

    let source_data = doc_data::path(&DocId::new("foto.png"), "miniatura.bin");
    let arrival = doc_data::path(&DocId::new("logo.png"), "miniatura.bin");
    write_data_item(&root, OFF, &source_data, b"quella-di-foto");
    write_data_item(&root, OFF, &arrival, b"quella-di-logo");

    std::fs::rename(root.join("foto.png"), root.join("logo.png")).expect("rinomina");
    let _ = ws.sync_renamed_path(&root.join("foto.png"), &root.join("logo.png"));

    assert_eq!(
        read_data_item(&root, OFF, &arrival).as_deref(),
        Some(&b"quella-di-logo"[..]),
        "lo stato di un allegato vivo è stato coperto da quello di chi gli è \
         atterrato addosso"
    );
}

#[test]
fn also_the_restore_on_a_other_path_and_a_rename() {
    // Il cestino restituisce una nota al vault; se il path d'origine è di nuovo
    // occupato, l'app ne sceglie un altro — e allora la chiave è cambiata. È il
    // caso che il §13.2 nominava come «rename a tutti gli effetti, anche se il
    // documento non era indicizzato».
    //
    // **Ma di chi sono i dati?** Prima questo banco controllava soltanto che
    // quelli della nota ripristinata la seguissero, e non guardava l'altra:
    // quella che nel frattempo aveva preso il path d'origine. Il difetto stava
    // lì (FUB-003) — la migrazione portava via tutto ciò che stava sotto il
    // path, quindi anche ciò che la nuova nota aveva scritto per sé.
    let (_g, root, mut ws) = vault();
    let original = notes(&mut ws, "Nota.md", "prima");
    let rel = doc_data::path(&original, "stato.bin");
    write_data_item(&root, OFF, &rel, b"conservami");

    let trashed = ws.delete_document(&original).expect("cestina");
    // Qualcun altro riprende il path, e scrive il suo stato.
    let usurper = notes(&mut ws, "Nota.md", "un'altra");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&usurper, "suo.bin"),
        b"non-toccarmi",
    );

    let returned =
        restore_document(&mut ws, &trashed, Some(DocId::new("Nota 1.md"))).expect("ripristino");
    assert_eq!(returned, DocId::new("Nota 1.md"));

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&returned, "stato.bin")).as_deref(),
        Some(&b"conservami"[..]),
        "il ripristino su un altro path non ha portato dietro i dati"
    );
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&usurper, "suo.bin")).as_deref(),
        Some(&b"non-toccarmi"[..]),
        "il ripristino ha portato via lo stato della nota che aveva preso il path"
    );
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&returned, "suo.bin")),
        None,
        "la nota ripristinata ha ricevuto lo stato di un'altra"
    );
}

/// Il difetto FUB-003 nella forma più semplice: **chi prende un path libero
/// non eredita ciò che la nota di prima ci aveva lasciato**, e quella di prima
/// lo ritrova intero al ripristino.
#[test]
fn the_note_that_takes_a_freed_path_starts_without_the_state_of_the_trashed_one() {
    let (_g, root, mut ws) = vault();
    let first = notes(&mut ws, "Nota.md", "prima");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&first, "stato.bin"),
        b"della-prima",
    );

    let trashed = ws.delete_document(&first).expect("cestina");

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&first, "stato.bin")),
        None,
        "una nota cestinata lascia il path libero, e lo stato sotto quel path \
         sarebbe di chi lo prende"
    );
    assert_eq!(
        read_data_item(&root, OFF, &parked_rel(&trashed, "stato.bin")).as_deref(),
        Some(&b"della-prima"[..]),
        "lo stato della nota cestinata sta sotto l'identità che ha nel cestino"
    );

    let second = notes(&mut ws, "Nota.md", "seconda");
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&second, "stato.bin")),
        None,
        "la nota nuova ha ereditato lo stato di quella cestinata"
    );

    // E il ripristino sul path d'origine, una volta libero, riporta lo stato.
    ws.delete_document(&second).expect("cestina la seconda");
    let returned = restore_document(&mut ws, &trashed, None).expect("ripristino");
    assert_eq!(returned, first);
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&returned, "stato.bin")).as_deref(),
        Some(&b"della-prima"[..]),
        "il ripristino sul path d'origine non ha riportato lo stato"
    );
    assert_eq!(
        read_data_item(&root, OFF, &parked_rel(&trashed, "stato.bin")),
        None,
        "lo stato è tornato sotto il path: non deve restare anche parcheggiato"
    );
}

/// Due note cestinate **dallo stesso path**, una dopo l'altra: ognuna ha il
/// suo stato e lo riavrà, nell'ordine che si vuole e dove si vuole.
#[test]
fn two_notes_trashed_from_the_same_path_each_get_back_their_own_state() {
    let (_g, root, mut ws) = vault();
    let first = notes(&mut ws, "Nota.md", "prima");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&first, "stato.bin"),
        b"della-prima",
    );
    let first_trash = ws.delete_document(&first).expect("cestina la prima");

    let second = notes(&mut ws, "Nota.md", "seconda");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&second, "stato.bin"),
        b"della-seconda",
    );
    let second_trash = ws.delete_document(&second).expect("cestina la seconda");

    let b = restore_document(&mut ws, &second_trash, Some(DocId::new("Seconda.md")))
        .expect("ripristino della seconda");
    let a = restore_document(&mut ws, &first_trash, Some(DocId::new("Prima.md")))
        .expect("ripristino della prima");

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&a, "stato.bin")).as_deref(),
        Some(&b"della-prima"[..])
    );
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&b, "stato.bin")).as_deref(),
        Some(&b"della-seconda"[..])
    );
}

/// Simula una voce **cestinata da una copia di Fub che non parcheggiava**: il
/// sidecar non dice che lo stato è stato portato via, e lo stato sta ancora
/// sotto il path d'origine.
fn as_trashed_by_an_older_fub(
    root: &Utf8PathBuf,
    trashed: &DocId,
    original: &DocId,
    rels: &[&str],
) {
    let name = trashed.as_str().rsplit('/').next().expect("un nome");
    let sidecar = data_root(root).join("trash").join(format!("{name}.json"));
    let mut json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&sidecar).expect("il sidecar")).expect("json");
    json.as_object_mut().expect("un oggetto").remove("parked");
    std::fs::write(&sidecar, serde_json::to_vec(&json).expect("json")).expect("riscrive");
    // Lo stato che una copia vecchia avrebbe lasciato sotto il path.
    for rel in rels {
        let bytes =
            read_data_item(root, OFF, &parked_rel(trashed, rel)).expect("lo stato parcheggiato");
        write_data_item(root, OFF, &doc_data::path(original, rel), &bytes);
    }
    let space = data_root(root)
        .join("plugins")
        .join(OFF)
        .join(doc_data::PARKED_SPACE);
    std::fs::remove_dir_all(space).expect("toglie il parcheggio");
}

/// Una voce di prima del parcheggio, con il path d'origine **libero**: lo
/// stato sta sotto il path e nessun altro può averlo scritto, quindi la
/// rinomina lo porta dietro com'è sempre stato.
#[test]
fn an_older_entry_with_its_path_still_free_keeps_following_the_rename() {
    let (_g, root, mut ws) = vault();
    let original = notes(&mut ws, "Nota.md", "prima");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&original, "stato.bin"),
        b"della-prima",
    );
    let trashed = ws.delete_document(&original).expect("cestina");
    as_trashed_by_an_older_fub(&root, &trashed, &original, &["stato.bin"]);

    let returned =
        restore_document(&mut ws, &trashed, Some(DocId::new("Altro.md"))).expect("ripristino");

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&returned, "stato.bin")).as_deref(),
        Some(&b"della-prima"[..]),
        "una voce di prima non ha più seguito il suo stato"
    );
}

/// Una voce di prima del parcheggio, con il path d'origine **occupato**: lo
/// stato sotto il path può essere di una nota o dell'altra, e non c'è modo di
/// saperlo. Non si indovina: resta dov'è, e lo si dice.
#[test]
fn an_older_entry_with_its_path_taken_does_not_guess_whose_state_it_is() {
    let (_g, root, mut ws) = vault();
    let original = notes(&mut ws, "Nota.md", "prima");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&original, "stato.bin"),
        b"incerto",
    );
    let trashed = ws.delete_document(&original).expect("cestina");
    as_trashed_by_an_older_fub(&root, &trashed, &original, &["stato.bin"]);
    let usurper = notes(&mut ws, "Nota.md", "un'altra");

    let returned =
        restore_document(&mut ws, &trashed, Some(DocId::new("Altro.md"))).expect("ripristino");

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&usurper, "stato.bin")).as_deref(),
        Some(&b"incerto"[..]),
        "lo stato di un path occupato è stato portato via a chi lo occupa"
    );
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&returned, "stato.bin")),
        None,
        "uno stato di cui non si sa il padrone è finito a una delle due"
    );
    assert!(
        ws.doc_data_warnings()
            .iter()
            .any(|warning| warning.contains("Nota.md")),
        "non si indovina, ma lo si dice: {:?}",
        ws.doc_data_warnings()
    );
}

/// La raccolta riguarda anche lo spazio parcheggiato: **toglie quello di una
/// voce che non è più nel cestino, e non tocca quello di chi c'è ancora.**
#[test]
fn the_collection_sweeps_the_parked_state_of_emptied_entries_and_only_those() {
    let (_g, root, mut ws) = vault();
    let kept = notes(&mut ws, "Resta.md", "resto");
    let gone = notes(&mut ws, "Va.md", "vado");
    write_data_item(&root, OFF, &doc_data::path(&kept, "x"), b"resta");
    write_data_item(&root, OFF, &doc_data::path(&gone, "x"), b"va");
    let kept_trash = ws.delete_document(&kept).expect("cestina");
    let gone_trash = ws.delete_document(&gone).expect("cestina");
    let parked = |trash: &DocId| read_data_item(&root, OFF, &parked_rel(trash, "x"));
    assert!(parked(&kept_trash).is_some() && parked(&gone_trash).is_some());

    // Una voce se ne va dal cestino senza che Fub se ne accorga (Obsidian, una
    // mano), l'altra resta: la raccolta all'apertura le distingue.
    std::fs::remove_file(root.join(gone_trash.as_str())).expect("toglie la voce");
    ws.reindex().expect("riapertura");

    assert_eq!(
        parked(&kept_trash).as_deref(),
        Some(&b"resta"[..]),
        "la raccolta ha tolto lo stato di una nota ancora nel cestino"
    );
    assert_eq!(
        parked(&gone_trash),
        None,
        "lo stato di una voce che non c'è più è rimasto a occupare spazio"
    );
}

/// L'organizzazione (icona, appuntata, posto nell'ordine) è stato per-documento
/// come l'altro, e ha lo stesso difetto: **la nota che prende il path libero non
/// ha l'icona né il pin di quella cestinata**, e quella cestinata li ritrova.
#[test]
fn the_organization_of_a_trashed_note_is_not_inherited_by_the_one_that_takes_its_path() {
    let (_g, _root, mut ws) = vault();
    let first = notes(&mut ws, "Nota.md", "prima");
    notes(&mut ws, "A.md", "a");
    notes(&mut ws, "Z.md", "z");
    ws.set_icon("Nota.md", Some("📌".into())).expect("icona");
    ws.set_pinned("Nota.md", true).expect("pin");
    ws.set_order("", vec!["A.md".into(), "Nota.md".into(), "Z.md".into()])
        .expect("ordine");
    let trashed = ws.delete_document(&first).expect("cestina");

    let org = ws.organization();
    assert!(
        !org.icons.contains_key("Nota.md") && !org.pinned.iter().any(|p| p == "Nota.md"),
        "una nota cestinata ha lasciato icona e pin sul path libero: {org:?}"
    );

    let second = notes(&mut ws, "Nota.md", "seconda");
    ws.set_icon("Nota.md", Some("🌱".into())).expect("icona");
    assert_eq!(second, first);

    let returned =
        restore_document(&mut ws, &trashed, Some(DocId::new("Nota 1.md"))).expect("ripristino");

    let org = ws.organization();
    assert_eq!(
        org.icons.get("Nota 1.md").map(String::as_str),
        Some("📌"),
        "la nota ripristinata ha perso la sua icona"
    );
    assert_eq!(
        org.pinned,
        ["Nota 1.md"],
        "la nota ripristinata non è più appuntata, o lo è chi non lo era"
    );
    assert_eq!(
        org.icons.get("Nota.md").map(String::as_str),
        Some("🌱"),
        "il ripristino ha portato via l'icona della nota che aveva preso il path"
    );
    assert_eq!(returned, DocId::new("Nota 1.md"));
}

/// Sul path d'origine, una volta libero, tornano anche il pin e il **posto
/// nell'ordine scelto a mano**.
#[test]
fn the_organization_comes_back_with_the_note_to_its_original_path() {
    let (_g, _root, mut ws) = vault();
    let note = notes(&mut ws, "Nota.md", "prima");
    notes(&mut ws, "A.md", "a");
    notes(&mut ws, "Z.md", "z");
    ws.set_icon("Nota.md", Some("📌".into())).expect("icona");
    ws.set_pinned("A.md", true).expect("pin");
    ws.set_pinned("Nota.md", true).expect("pin");
    ws.set_pinned("Z.md", true).expect("pin");
    ws.set_order("", vec!["A.md".into(), "Nota.md".into(), "Z.md".into()])
        .expect("ordine");
    let trashed = ws.delete_document(&note).expect("cestina");

    let returned = restore_document(&mut ws, &trashed, None).expect("ripristino");

    assert_eq!(returned, note);
    let org = ws.organization();
    assert_eq!(org.icons.get("Nota.md").map(String::as_str), Some("📌"));
    assert_eq!(
        org.pinned,
        ["A.md", "Nota.md", "Z.md"],
        "il posto fra i pin"
    );
    assert_eq!(
        org.order.get("").map(Vec::as_slice),
        Some(
            &[
                "A.md".to_string(),
                "Nota.md".to_string(),
                "Z.md".to_string()
            ][..]
        ),
        "il posto nell'ordine scelto a mano"
    );
}

/// **Sulla destinazione non si toglie niente** (difetto 0167, AUDIT-DATI-03).
///
/// Qui sulla destinazione c'è un file, che è il caso di un plugin che scrive
/// nel proprio spazio dati un nome che per caso è il componente codificato di
/// una nota: di quel file non si sa niente, e ciò di cui non si sa niente non
/// si cancella. Prima lo si toglieva senza guardare; poi la migrazione si
/// rifiutava e lasciava i dati della nota sotto l'id vecchio, dove la raccolta
/// successiva li spazzava. Adesso i dati seguono la nota, il file si sposta di
/// lato con i suoi byte, e l'avviso dice dove.
#[test]
fn a_destination_that_not_and_a_folder_not_is_removes() {
    let (_g, root, mut ws) = vault();
    let old = notes(&mut ws, "Vecchia.md", "corpo");
    let new = DocId::new("Nuova.md");

    let data_item = doc_data::path(&old, "annotazioni.json");
    write_data_item(&root, OFF, &data_item, b"le mie annotazioni");

    // Un file dove la migrazione vorrebbe atterrare: non è lo spazio di
    // nessuna nota, ed è di qualcuno.
    let obstacle = doc_data::space(&new);
    let obstacle = obstacle.trim_end_matches('/');
    let obstacle_path = data_root(&root).join("plugins").join(OFF).join(obstacle);
    write_data_item(&root, OFF, obstacle, b"non e' mio");

    ws.rename_document(&old, &new).expect("rinomina");

    let warnings = ws.doc_data_warnings();
    let obstacle_path = obstacle_path.as_str().replace('\\', "/");
    assert!(
        warnings.iter().any(|warning| warning
            .replace('\\', "/")
            .contains(&format!("{obstacle_path}~displaced"))),
        "lo spostamento di lato si dice, con il posto dove andarlo a guardare: \
         {warnings:?}"
    );
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&new, "annotazioni.json")).as_deref(),
        Some(&b"le mie annotazioni"[..]),
        "i dati della nota l'hanno seguita"
    );
    assert_eq!(
        read_data_item(&root, OFF, &format!("{obstacle}~displaced")).as_deref(),
        Some(&b"non e' mio"[..]),
        "sulla destinazione c'era un file, di cui non si sa niente, e la \
         migrazione l'ha tolto"
    );
    ws.collect_doc_data().expect("raccolta");
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&new, "annotazioni.json")).as_deref(),
        Some(&b"le mie annotazioni"[..]),
        "la raccolta ha tolto i dati di una nota viva"
    );
}

#[test]
fn the_collection_removes_only_that_that_no_one_notes_names_more() {
    let (_g, root, mut ws) = vault();
    let live = notes(&mut ws, "Viva.md", "ci sono");
    let trashed_doc = notes(&mut ws, "Cestinata.md", "vado nel cestino");
    let dead = DocId::new("Sparita.md");

    let data_item_live = doc_data::path(&live, "x");
    let data_item_trashed = doc_data::path(&trashed_doc, "x");
    let data_item_dead = doc_data::path(&dead, "x");
    for rel in [&data_item_live, &data_item_trashed, &data_item_dead] {
        write_data_item(&root, OFF, rel, b"dato");
    }
    write_data_item(&root, OFF, "suo.json", b"mio");

    let trash = ws.delete_document(&trashed_doc).expect("cestina");
    // Cestinandola la nota si è portata via il suo stato: sta sotto la voce.
    assert_eq!(read_data_item(&root, OFF, &data_item_trashed), None);
    let data_item_trashed = parked_rel(&trash, "x");
    // La raccolta gira all'apertura, ed è così che si riapre.
    ws.reindex().expect("riapertura");

    assert!(
        read_data_item(&root, OFF, &data_item_live).is_some(),
        "la raccolta ha tolto i dati di una nota che esiste"
    );
    assert!(
        read_data_item(&root, OFF, &data_item_trashed).is_some(),
        "una nota cestinata è recuperabile: ripristinarla senza i suoi dati \
         sarebbe una perdita silenziosa fatta da chi doveva impedirla"
    );
    assert!(
        read_data_item(&root, OFF, &data_item_dead).is_none(),
        "i dati di una nota che non esiste più sono rimasti a occupare spazio \
         sotto una chiave che nessuno visita"
    );
    assert_eq!(
        read_data_item(&root, OFF, "suo.json").as_deref(),
        Some(&b"mio"[..]),
        "fuori da `doc/` la raccolta non entra"
    );
}

/// **Un cestino che non si legge non è un cestino vuoto.** Una cartella
/// `.trash/` che il supporto non lascia elencare (un permesso tolto da
/// un'altra applicazione, un disco che comincia a fallire) veniva presa per un
/// cestino vuoto, e la raccolta toglieva gli spazi per-documento di ogni nota
/// cestinata, ancora recuperabile.
#[cfg(unix)]
#[test]
fn an_unreadable_trash_collects_nothing() {
    use std::os::unix::fs::PermissionsExt;

    let (_g, root, mut ws) = vault();
    let doc = notes(&mut ws, "Cestinata.md", "vado nel cestino");
    write_data_item(&root, OFF, &doc_data::path(&doc, "x"), b"dato");
    let rel = parked_rel(&ws.delete_document(&doc).expect("cestina"), "x");

    let trash = root.join(".trash");
    let set = |mode| {
        std::fs::set_permissions(&trash, std::fs::Permissions::from_mode(mode))
            .expect("permessi del cestino")
    };
    set(0o000);
    if ws.list_trash().is_ok() {
        // Chi gira da root legge comunque: il guasto non si riproduce.
        set(0o755);
        return;
    }

    let reopened = ws.reindex();
    set(0o755);
    reopened.expect("riapertura col cestino illeggibile");
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "la raccolta ha preso un cestino illeggibile per un cestino vuoto"
    );
}

/// Un supporto che, acceso l'interruttore, non sa dire se `.trash/` c'è: un
/// disco che comincia a fallire proprio lì.
struct TrashStatFails {
    inner: fub_kernel::storage::FsStorage,
    failing: AtomicBool,
}

impl VaultStorage for TrashStatFails {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.inner.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.inner.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        if self.failing.load(Ordering::Relaxed) && path.file_name() == Some(".trash") {
            return Err(std::io::Error::other("il disco non risponde"));
        }
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// **Un cestino di cui non si sa se c'è non è un cestino vuoto.** Il cestino
/// si guardava con un `exists`, che per una `stat` fallita risponde «no»: la
/// raccolta non vedeva più le note cestinate e ne toglieva gli spazi
/// per-documento, e l'elenco del cestino si mostrava vuoto.
#[test]
fn a_trash_that_cannot_be_stat_collects_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(NudoProvider))
        .expect("nessun conflitto");
    let storage = Arc::new(TrashStatFails {
        inner: fub_kernel::storage::FsStorage,
        failing: AtomicBool::new(false),
    });
    let mut ws = Workspace::on(
        &root,
        registry,
        storage.clone() as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex del vault vuoto");
    let doc = notes(&mut ws, "Cestinata.md", "vado nel cestino");
    write_data_item(&root, OFF, &doc_data::path(&doc, "x"), b"dato");
    let rel = parked_rel(&ws.delete_document(&doc).expect("cestina"), "x");

    storage.failing.store(true, Ordering::Relaxed);
    assert!(
        ws.list_trash().is_err(),
        "un cestino di cui non si sa niente si mostrava vuoto"
    );
    ws.reindex().expect("riapertura col cestino muto");
    storage.failing.store(false, Ordering::Relaxed);
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "la raccolta ha preso un cestino muto per un cestino vuoto"
    );
    assert_eq!(ws.list_trash().expect("il cestino torna").len(), 1);
}

/// Il sidecar dell'unica voce del cestino, e la nota cestinata da una
/// cartella che il nome da solo non ricorda.
///
/// Torna dove stava lo stato (sotto il path, da viva), dove sta adesso (sotto la
/// voce, da cestinata) e il sidecar.
fn trashed_in_a_folder(
    root: &Utf8PathBuf,
    ws: &mut Workspace,
) -> (String, String, std::path::PathBuf) {
    let doc = notes(ws, "Diario/Idea.md", "vado nel cestino");
    let rel = doc_data::path(&doc, "x");
    write_data_item(root, OFF, &rel, b"dato");
    let trashed = ws.delete_document(&doc).expect("cestina");
    let sidecars: Vec<_> = std::fs::read_dir(root.join(".fub/data/trash"))
        .expect("i sidecar del cestino")
        .map(|entry| entry.expect("voce").path())
        .collect();
    assert_eq!(sidecars.len(), 1, "{sidecars:?}");
    (
        rel,
        parked_rel(&trashed, "x"),
        sidecars.into_iter().next().unwrap(),
    )
}

/// **Un sidecar che non si legge non autorizza a indovinare.** Senza il
/// sidecar la voce del cestino degrada al nome nella radice — `Idea.md` — e
/// per mostrare una riga va bene; ma la raccolta ci contava per sapere quali
/// note sono ancora recuperabili, e toglieva i dati di `Diario/Idea.md`.
#[cfg(unix)]
#[test]
fn an_unreadable_trash_sidecar_collects_nothing() {
    use std::os::unix::fs::PermissionsExt;

    let (_g, root, mut ws) = vault();
    let (_, rel, sidecar) = trashed_in_a_folder(&root, &mut ws);
    let set = |mode| {
        std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(mode))
            .expect("permessi del sidecar")
    };
    set(0o000);
    if std::fs::read(&sidecar).is_ok() {
        // Chi gira da root legge comunque: il guasto non si riproduce.
        set(0o644);
        return;
    }

    let reopened = ws.reindex();
    set(0o644);
    reopened.expect("riapertura col sidecar illeggibile");
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "la raccolta ha indovinato l'origine di una nota cestinata"
    );
}

/// **Nemmeno il ripristino indovina.** Con il sidecar illeggibile la voce
/// risultava `Idea.md` nella radice, e il ripristino ce la rimetteva: la nota
/// usciva dal cestino fuori da `Diario/`, e i suoi dati — intestati a
/// `Diario/Idea.md`, che nessuna rinomina aveva spostato — restavano di una
/// nota che non c'era più, pronti per la raccolta. Un guasto del supporto
/// ferma l'elenco e il ripristino; tornato leggibile, la nota torna a casa.
#[cfg(unix)]
#[test]
fn an_unreadable_trash_sidecar_stops_the_restore() {
    use std::os::unix::fs::PermissionsExt;

    let (_g, root, mut ws) = vault();
    let (rel, _, sidecar) = trashed_in_a_folder(&root, &mut ws);
    let trashed = ws.list_trash().expect("il cestino")[0].id.clone();
    let set = |mode| {
        std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(mode))
            .expect("permessi del sidecar")
    };
    set(0o000);
    if std::fs::read(&sidecar).is_ok() {
        // Chi gira da root legge comunque: il guasto non si riproduce.
        set(0o644);
        return;
    }

    let listed = ws.list_trash();
    let restored = restore_document(&mut ws, &trashed, None);
    set(0o644);
    assert!(
        listed.is_err(),
        "l'elenco ha indovinato l'origine: {listed:?}"
    );
    assert!(
        restored.is_err(),
        "il ripristino ha indovinato l'origine: {restored:?}"
    );
    assert!(
        !root.join("Idea.md").exists(),
        "la nota è tornata in radice"
    );
    assert!(
        root.join(trashed.as_str()).exists(),
        "la nota è uscita dal cestino"
    );

    let returned = restore_document(&mut ws, &trashed, None).expect("ripristino");
    assert_eq!(returned, DocId::new("Diario/Idea.md"));
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "i dati non sono tornati con la nota"
    );
}

/// **Una nota esclusa dalle impostazioni non è sparita.** Aggiungere una
/// cartella a `files.excluded-folders` la toglie dall'albero e dagli indici, e
/// basta: toglierla di nuovo dall'elenco la rimette com'era. Ma la raccolta
/// guardava soltanto l'anagrafe, e alla riapertura cancellava lo spazio
/// per-documento di ogni nota della cartella — l'unica mossa della catena che
/// l'impostazione non sa disfare.
#[test]
fn an_excluded_folder_keeps_the_space_of_its_notes() {
    let (_g, root, mut ws) = vault();
    let doc = notes(&mut ws, "Archivio/Idea.md", "resto sul disco");
    let rel = doc_data::path(&doc, "x");
    write_data_item(&root, OFF, &rel, b"dato");

    // Le chiavi dell'esclusione le dichiara il montaggio dell'host; qui le
    // dichiara un manifest di core, come farebbe lui.
    ws.register_plugin(
        PluginManifest::core("fub.core", "Fub").configuring(fub_kernel::ignore::ignore_settings()),
        Trust::Core,
    )
    .expect("le impostazioni dell'esclusione");
    ws.set_setting(
        fub_kernel::ignore::EXCLUDED_FOLDERS,
        SettingValue::List(vec!["Archivio".into()]),
    )
    .expect("esclusione");
    ws.reindex().expect("riapertura con la cartella esclusa");
    assert!(
        !ws.documents().contains(&doc),
        "la cartella esclusa è ancora nel vault"
    );
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "la raccolta ha preso una nota esclusa per una nota sparita"
    );
}

/// Lo stesso per un sidecar scritto da una versione più nuova di Fub (un
/// vault sincronizzato fra due macchine): questa copia non sa leggerlo, e
/// non sapere non è sapere che la nota non c'è.
#[test]
fn a_trash_sidecar_from_a_newer_version_collects_nothing() {
    let (_g, root, mut ws) = vault();
    let (_, rel, sidecar) = trashed_in_a_folder(&root, &mut ws);
    let mut json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&sidecar).unwrap()).unwrap();
    json["v"] = serde_json::json!(99);
    std::fs::write(&sidecar, serde_json::to_vec(&json).unwrap()).unwrap();

    ws.reindex().expect("riapertura col sidecar più nuovo");
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "la raccolta ha preso un sidecar sconosciuto per un sidecar assente"
    );
}

/// Un supporto che non lascia scrivere i sidecar del cestino: la cartella
/// `.fub/data/trash/` in sola lettura, e il resto del vault scrivibile.
struct SidecarsRefused(fub_kernel::storage::FsStorage);

impl VaultStorage for SidecarsRefused {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.0.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        if path
            .parent()
            .is_some_and(|dir| dir.ends_with(".fub/data/trash"))
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "cartella dei sidecar in sola lettura",
            ));
        }
        self.0.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> std::io::Result<()> {
        self.0.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.0.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.0.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.0.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.0.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.0.remove_empty_dir(dir)
    }
}

fn vault_refusing_sidecars() -> (tempfile::TempDir, Utf8PathBuf, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(NudoProvider))
        .expect("nessun conflitto");
    let mut ws = Workspace::on(
        &root,
        registry,
        Arc::new(SidecarsRefused(fub_kernel::storage::FsStorage)) as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex del vault vuoto");
    (dir, root, ws)
}

/// **Per una nota di una cartella, il sidecar è parte della cancellazione.**
/// Il cestino è piatto: `Diario/Idea.md` ci entra come `Idea.md`, e la
/// cartella resta scritta soltanto nel sidecar. La cestinatura proseguiva
/// senza, con un avviso: il ripristino la rimetteva nella radice, e la
/// raccolta — convinta che la voce venisse da `Idea.md` — toglieva i dati di
/// `Diario/Idea.md` mentre la nota era ancora recuperabile.
#[test]
fn a_note_of_a_folder_is_not_trashed_without_its_sidecar() {
    let (_g, root, mut ws) = vault_refusing_sidecars();
    let doc = notes(&mut ws, "Diario/Idea.md", "vado nel cestino");
    let rel = doc_data::path(&doc, "x");
    write_data_item(&root, OFF, &rel, b"dato");

    let refused = ws.delete_document(&doc);

    let error = refused.expect_err("cestinata senza l'unica traccia della sua cartella");
    assert!(
        error.to_string().contains("sola lettura"),
        "il rifiuto dice perché: {error}"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("Diario/Idea.md"))
            .ok()
            .as_deref(),
        Some("vado nel cestino"),
        "la nota è rimasta dov'era"
    );
    assert!(ws.list_trash().expect("il cestino").is_empty());
    ws.reindex().expect("riapertura");
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "i dati della nota restano"
    );
}

/// Per una nota della radice il nome basta: senza sidecar la voce torna dove
/// il nome dice, che è il posto giusto. La cancellazione riesce, e i suoi dati
/// restano finché la voce sta nel cestino.
#[test]
fn a_note_of_the_root_is_trashed_even_without_its_sidecar() {
    let (_g, root, mut ws) = vault_refusing_sidecars();
    let doc = notes(&mut ws, "Idea.md", "vado nel cestino");
    let rel = doc_data::path(&doc, "x");
    write_data_item(&root, OFF, &rel, b"dato");

    let trashed = ws.delete_document(&doc).expect("cestina");

    let trash = ws.list_trash().expect("il cestino");
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].original, doc);
    ws.reindex().expect("riapertura");
    assert_eq!(
        read_data_item(&root, OFF, &parked_rel(&trashed, "x")).as_deref(),
        Some(&b"dato"[..]),
        "lo stato non c'è più sotto la voce che lo teneva"
    );
    // Senza sidecar la voce non dice che lo stato è stato messo al sicuro, e il
    // ripristino lo riporta lo stesso: lo spazio parcheggiato torna sempre.
    let returned = restore_document(&mut ws, &trashed, None).expect("ripristino");
    assert_eq!(returned, doc);
    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "il ripristino di una voce senza sidecar ha lasciato lo stato nel cestino"
    );
}

/// **Una voce senza sidecar non dice da quale cartella veniva, e la raccolta
/// non lo indovina.** È la voce cestinata da Obsidian, o quella il cui sidecar
/// si è perso dopo: il suo nome può essere di qualunque cartella del vault, e
/// i dati di ogni nota che si chiamava così restano finché la voce sta nel
/// cestino. Chi non ha niente a che fare con il cestino si raccoglie come
/// sempre.
#[test]
fn a_trash_entry_without_sidecar_keeps_the_data_of_every_namesake() {
    let (_g, root, mut ws) = vault();
    let (_, rel, sidecar) = trashed_in_a_folder(&root, &mut ws);
    std::fs::remove_file(&sidecar).expect("sidecar perso");
    let namesake = doc_data::path(&DocId::new("Archivio/Idea.md"), "x");
    let dead = doc_data::path(&DocId::new("Archivio/Morta.md"), "x");
    for other in [&namesake, &dead] {
        write_data_item(&root, OFF, other, b"altro");
    }

    ws.reindex().expect("riapertura con la voce senza sidecar");

    assert_eq!(
        read_data_item(&root, OFF, &rel).as_deref(),
        Some(&b"dato"[..]),
        "la raccolta ha indovinato la cartella di una nota cestinata"
    );
    assert!(
        read_data_item(&root, OFF, &namesake).is_some(),
        "nessuno sa dire quale dei due omonimi sia nel cestino"
    );
    assert!(
        read_data_item(&root, OFF, &dead).is_none(),
        "chi non ha niente a che fare con il cestino si raccoglie"
    );
}

#[test]
fn empty_the_trash_and_reopen_collects() {
    // Il seguito del test di sopra: finché la nota è recuperabile i dati
    // restano, e appena non lo è più se ne vanno. La cancellazione definitiva
    // **non** è quella che innesca la raccolta — è un giro sul disco a
    // vedersene accorto, ed è per questo che funziona anche se il cestino lo
    // svuota qualcun altro ad app chiusa.
    let (_g, root, mut ws) = vault();
    let doc = notes(&mut ws, "Effimera.md", "ciao");
    write_data_item(&root, OFF, &doc_data::path(&doc, "x"), b"dato");

    let rel = parked_rel(&ws.delete_document(&doc).expect("cestina"), "x");
    ws.reindex().expect("riapertura col cestino pieno");
    assert!(read_data_item(&root, OFF, &rel).is_some());

    ws.empty_trash().expect("svuota");
    ws.reindex().expect("riapertura col cestino vuoto");
    assert!(
        read_data_item(&root, OFF, &rel).is_none(),
        "cancellata per sempre la nota, i suoi dati sono rimasti"
    );
}

// ---------------------------------------------------------------------------
// FUB-003, il cestino del sistema e il nome riservato
// ---------------------------------------------------------------------------

/// Un cestino del sistema che sposta il file e basta.
struct MovesTo(Utf8PathBuf);

impl fub_kernel::os_trash::OsTrashBackend for MovesTo {
    fn move_file_to_os_trash(&self, source: &Utf8Path) -> std::io::Result<Utf8PathBuf> {
        std::fs::rename(source, &self.0)?;
        Ok(self.0.clone())
    }
}

fn send_to_the_system_trash(ws: &mut Workspace, doc: &DocId) {
    let external = tempfile::tempdir().expect("il cestino del sistema");
    let destination = Utf8PathBuf::from_path_buf(external.path().join("Nota.md")).expect("utf8");
    let completed = ws
        .prepare_document_deletion(doc)
        .expect("prepara")
        .invoke_os(&MovesTo(destination))
        .expect("la mossa");
    let committed = ws
        .commit_os_document_deletion(completed)
        .unwrap_or_else(|_| panic!("commit del fatto OS"));
    ws.finish_os_document_deletion(committed.invoke())
        .unwrap_or_else(|_| panic!("rimozione OS finalizzata"));
}

/// **Il cestino del sistema libera il path come quello del vault, e lo stato
/// non resta ad aspettare chi lo riprende** (FUB-003). Il percorso OS non
/// parcheggiava né dimenticava niente: la nota nuova allo stesso path
/// ereditava lo spazio per-documento dei plugin, l'icona e il pin.
#[test]
fn the_note_that_takes_the_path_of_one_sent_to_the_system_trash_starts_clean() {
    let (_g, root, mut ws) = vault();
    let first = notes(&mut ws, "Nota.md", "prima");
    write_data_item(
        &root,
        OFF,
        &doc_data::path(&first, "stato.bin"),
        b"della-prima",
    );
    ws.set_icon("Nota.md", Some("📌".into())).expect("icona");
    ws.set_pinned("Nota.md", true).expect("pin");

    send_to_the_system_trash(&mut ws, &first);

    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&first, "stato.bin")),
        None,
        "lo stato è rimasto sotto il path che la nota ha lasciato"
    );
    let org = ws.organization();
    assert!(
        !org.icons.contains_key("Nota.md") && !org.pinned.iter().any(|p| p == "Nota.md"),
        "icona e pin sono rimasti sul path libero: {org:?}"
    );

    let second = notes(&mut ws, "Nota.md", "seconda");
    assert_eq!(second, first);
    assert_eq!(
        read_data_item(&root, OFF, &doc_data::path(&second, "stato.bin")),
        None,
        "la nota nuova ha ereditato lo stato di quella mandata al cestino del sistema"
    );
    let org = ws.organization();
    assert!(
        !org.icons.contains_key("Nota.md") && !org.pinned.iter().any(|p| p == "Nota.md"),
        "la nota nuova ha ereditato icona o pin: {org:?}"
    );
}

/// Ciò che è passato di lato non resta per sempre: nessuna voce del cestino del
/// vault lo tiene, e la prima raccolta lo toglie.
#[test]
fn the_state_set_aside_for_the_system_trash_is_collected_at_the_next_pass() {
    let (_g, root, mut ws) = vault();
    let first = notes(&mut ws, "Nota.md", "prima");
    write_data_item(&root, OFF, &doc_data::path(&first, "stato.bin"), b"dato");
    send_to_the_system_trash(&mut ws, &first);

    let parked = data_root(&root)
        .join("plugins")
        .join(OFF)
        .join(doc_data::PARKED_SPACE);
    // Le cartelle di stato: accanto stanno i lucchetti (`.<nome>.lock`) del
    // supporto, che non sono stato di nessuno.
    let folders = || -> usize {
        std::fs::read_dir(&parked).map_or(0, |entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_dir())
                .count()
        })
    };
    assert_eq!(
        folders(),
        1,
        "lo stato è passato di lato, non è sparito di colpo"
    );

    ws.reindex().expect("il giro successivo");
    assert_eq!(
        folders(),
        0,
        "nessuna voce del cestino del vault tiene quello stato: va raccolto"
    );
}

const PLUGIN: &str = "test.plugin";

fn with_a_plugin(ws: &mut Workspace) {
    ws.register_plugin(PluginManifest::core(PLUGIN, PLUGIN), Trust::Core)
        .expect("registrato");
}

/// **`doc~trash` è del kernel**: dichiarato riservato, un plugin lo scriveva lo
/// stesso, e la raccolta lo tratta come stato parcheggiato di una voce.
#[test]
fn a_plugin_cannot_write_read_or_remove_the_reserved_parking() {
    use fub_abi::error::PluginError;
    let (_g, _root, mut ws) = vault();
    with_a_plugin(&mut ws);
    let inside = format!("{}/qualcosa/x.json", doc_data::PARKED_SPACE);
    let result = ws.with_host(PLUGIN, |host| {
        (
            host.data_write(&inside, b"mio"),
            host.data_read(&inside),
            host.data_remove(&inside),
            host.data_write(doc_data::PARKED_SPACE, b"mio"),
        )
    });
    for (what, outcome) in [
        ("scrive", result.0),
        ("legge", result.1.map(|_| ())),
        ("toglie", result.2),
        ("scrive il nome nudo", result.3),
    ] {
        assert!(
            matches!(outcome, Err(PluginError::PermissionDenied(_))),
            "un plugin che {what} sotto `doc~trash` non deve poterlo fare: {outcome:?}"
        );
    }

    // Un nome che gli somiglia soltanto è di tutti.
    let neighbour = ws.with_host(PLUGIN, |host| host.data_write("doc~trash2/x.json", b"mio"));
    assert!(neighbour.is_ok(), "{neighbour:?}");
}

/// Elencare la radice non mostra il parcheggio del kernel.
#[test]
fn listing_the_root_of_a_plugin_does_not_show_the_parking() {
    let (_g, root, mut ws) = vault();
    with_a_plugin(&mut ws);
    let trashed = DocId::new("Nota.md");
    write_data_item(
        &root,
        PLUGIN,
        &parked_rel(&trashed, "stato.bin"),
        b"parcheggiato",
    );
    write_data_item(&root, PLUGIN, "suo.json", b"{}");

    let listed = ws
        .with_host(PLUGIN, |host| host.data_list(""))
        .expect("l'elenco");
    assert_eq!(listed, ["suo.json"], "{listed:?}");
}
