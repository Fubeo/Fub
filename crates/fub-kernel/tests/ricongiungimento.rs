//! **La rinomina che non ha visto nessuno** (§23.1), dal livello `Workspace`.
//!
//! Il path è la chiave e lo è per sempre (decisione 0043). Chi rinomina una nota
//! mentre Fub è aperto la fa seguire da tutto ciò che le sta attaccato — il
//! rilevatore accoppia i due path e si finisce in `migrate_identity`. Chi la
//! rinomina mentre Fub è **chiuso** non ha nessuno che accoppi, e alla
//! riapertura la bozza non salvata, lo spazio per-documento e le versioni
//! restano attaccati a un nome che non esiste più.
//!
//! Le proprietà sotto esame sono quattro, e nessuna si vede da dentro un modulo
//! perché tutte e quattro vogliono **due aperture** con un disco che cambia in
//! mezzo:
//!
//! 1. **Si riconosce dal contenuto.** Un documento sparito e uno comparso con la
//!    stessa impronta sono la stessa nota con un nome nuovo, e ciò che le stava
//!    attaccato la segue.
//! 2. **Uno a uno, o niente.** Una copia non è una rinomina, e con N spariti e N
//!    comparsi l'accoppiamento non è unico.
//! 3. **Nel dubbio non si accoppia e non si raccoglie.** Delle due mosse, quella
//!    irreversibile si sospende.
//! 4. **Una raccolta si fa su un'anagrafe completa, o non si fa.** È la regola
//!    che `finish_index` applicava già al suo vicino di tre righe sopra.

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::doc_data;
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Subscription, Workspace};

/// Il plugin di prova che tiene qualcosa attaccato a una nota. Non serve che sia
/// montato: la migrazione e la raccolta camminano il **disco**, apposta per
/// coprire chi è spento (decisione 0044).
const PLUGIN: &str = "test.appiccicoso";

/// Provider `.txt` minimo: qui il parse non è sotto esame.
struct TxtProvider;

impl FormatProvider for TxtProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("plain", "Testo semplice (test)", &["txt"])
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

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    fn write(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn rename(&self, from: &str, to: &str) {
        let dest = self.root.join(to);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::rename(self.root.join(from), dest).unwrap();
    }

    /// Un workspace montato e non ancora aperto.
    ///
    /// La pausa è la **regola *racily clean*** vista da qui: l'anagrafe non
    /// crede a ciò che ha una data non anteriore alla propria scrittura, e in un
    /// test i file nascono nello stesso millisecondo in cui il vault si apre.
    /// Senza, la tabella di ieri si rileggerebbe vuota — cioè non ci sarebbe
    /// nessuna impronta con cui accoppiare, e questi banchi passerebbero o no a
    /// seconda di dove cade il tick del millisecondo.
    fn montato(&self) -> Workspace {
        oltre_il_millisecondo();
        let mut registry = FormatRegistry::new();
        registry
            .register(Box::new(TxtProvider))
            .expect("nessun conflitto");
        Workspace::new(&self.root, registry)
    }

    /// Apre il vault da zero, come farebbe un riavvio dell'app.
    fn apri(&self) -> Workspace {
        let mut ws = self.montato();
        ws.reindex().expect("reindex");
        ws
    }

    /// La cartella dello spazio per-documento di `doc`, per il plugin di prova.
    fn spazio(&self, doc: &str) -> Utf8PathBuf {
        self.root
            .join(".fub/data/plugins")
            .join(PLUGIN)
            .join(doc_data::DOC_SPACE)
            .join(doc_data::encode(doc))
    }

    /// Ci mette dentro un byte, che è ciò che un plugin farebbe scrivendo
    /// un'annotazione: la cartella vuota non dimostrerebbe che il **contenuto**
    /// ha seguito la nota.
    fn attacca_dati(&self, doc: &str) {
        let dir = self.spazio(doc);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("annotazione"), format!("i dati di {doc}")).unwrap();
    }

    fn dati_di(&self, doc: &str) -> Option<String> {
        std::fs::read_to_string(self.spazio(doc).join("annotazione")).ok()
    }
}

/// Vedi [`Fixture::montato`].
fn oltre_il_millisecondo() {
    std::thread::sleep(std::time::Duration::from_millis(5));
}

fn eventi(rx: &Subscription) -> Vec<Notice> {
    let mut visti = Vec::new();
    while let Ok(n) = rx.try_recv() {
        visti.push(n);
    }
    visti
}

fn bozza_di(ws: &Workspace, doc: &str) -> Option<String> {
    ws.drafts()
        .drafts
        .into_iter()
        .find(|b| b.doc.as_str() == doc)
        .map(|b| b.text)
}

// --- 1. si riconosce dal contenuto -----------------------------------------

#[test]
fn una_rinomina_fatta_ad_app_chiusa_si_riconosce_dallimpronta() {
    let f = Fixture::new();
    f.write("nota.txt", "un contenuto che sta in una nota sola");
    let mut ws = f.apri();
    // Il buffer sporco: è l'unica copia di questo testo, e il caso peggiore
    // della voce.
    ws.save_draft(&DocId::new("nota.txt"), "e questo non l'ho salvato", None)
        .expect("bozza");
    ws.set_icon("nota.txt", Some("📌".into())).expect("icona");
    f.attacca_dati("nota.txt");
    drop(ws);

    // Il client di sync, o il Finder, mentre Fub è chiuso.
    f.rename("nota.txt", "Progetti/nota rinominata.txt");

    let ws = f.apri();
    assert_eq!(
        bozza_di(&ws, "Progetti/nota rinominata.txt").as_deref(),
        Some("e questo non l'ho salvato"),
        "la bozza ha seguito la nota"
    );
    assert!(
        bozza_di(&ws, "nota.txt").is_none(),
        "e non è rimasta anche sotto il nome vecchio"
    );
    assert_eq!(
        f.dati_di("Progetti/nota rinominata.txt").as_deref(),
        Some("i dati di nota.txt"),
        "e lo spazio per-documento di un plugin nemmeno montato"
    );
    assert!(
        f.dati_di("nota.txt").is_none(),
        "che si è spostato invece di essere copiato"
    );
    assert_eq!(
        ws.organization()
            .icons
            .get("Progetti/nota rinominata.txt")
            .map(String::as_str),
        Some("📌"),
        "e l'organizzazione del kernel, che passa dalla stessa funzione"
    );
}

#[test]
fn il_ricongiungimento_lo_dice_con_levento_della_rinomina() {
    // Chi tiene stato per-documento **fuori** dallo spazio dichiarato — il
    // versioning, che ha uno store suo perché deve sopravvivere alla
    // cancellazione — non ha altro modo di saperlo.
    let f = Fixture::new();
    f.write("a.txt", "il contenuto di a");
    drop(f.apri());
    f.rename("a.txt", "b.txt");

    let mut ws = f.montato();
    let rx = ws.bus().subscribe();
    ws.reindex().expect("reindex");
    let visti = eventi(&rx);
    assert!(
        visti.iter().any(|n| matches!(
            &n.event,
            Event::DocumentRenamed { from, to }
                if from.as_str() == "a.txt" && to.as_str() == "b.txt"
        )),
        "l'apertura ha annunciato la rinomina: {visti:?}"
    );
}

#[test]
fn una_nota_cancellata_resta_una_cancellazione() {
    // Il verso opposto, e serve a mostrare che il ricongiungimento non ha
    // spento la raccolta: sparita senza che comparisse niente di uguale, i suoi
    // dati se ne vanno come prima.
    let f = Fixture::new();
    f.write("a.txt", "il contenuto di a");
    f.write("b.txt", "il contenuto di b");
    drop(f.apri());
    f.attacca_dati("a.txt");
    std::fs::remove_file(f.root.join("a.txt")).unwrap();

    let _ws = f.apri();
    assert!(
        f.dati_di("a.txt").is_none(),
        "i dati di una nota che non c'è più si raccolgono"
    );
}

// --- 2. uno a uno, o niente ------------------------------------------------

#[test]
fn due_file_identici_senza_niente_di_sparito_sono_una_copia() {
    let f = Fixture::new();
    f.write("a.txt", "identici");
    let mut ws = f.apri();
    ws.save_draft(&DocId::new("a.txt"), "il mio testo", None)
        .expect("bozza");
    drop(ws);

    // Nessuno è sparito: `a.txt` c'è ancora, e `copia.txt` è una copia.
    f.write("copia.txt", "identici");

    let ws = f.apri();
    assert_eq!(
        bozza_di(&ws, "a.txt").as_deref(),
        Some("il mio testo"),
        "la bozza è rimasta dov'era"
    );
    assert!(
        bozza_di(&ws, "copia.txt").is_none(),
        "e non è stata consegnata alla copia"
    );
}

#[test]
fn un_file_vuoto_non_e_una_prova_di_identita() {
    // Due file vuoti hanno per forza la stessa impronta: la regola «uno a uno»
    // sarebbe soddisfatta e la conclusione falsa.
    let f = Fixture::new();
    f.write("vuota.txt", "");
    let mut ws = f.apri();
    ws.save_draft(&DocId::new("vuota.txt"), "quello che stavo scrivendo", None)
        .expect("bozza");
    drop(ws);

    std::fs::remove_file(f.root.join("vuota.txt")).unwrap();
    f.write("un'altra vuota.txt", "");

    let ws = f.apri();
    assert!(
        bozza_di(&ws, "un'altra vuota.txt").is_none(),
        "zero byte non accoppiano niente"
    );
    assert_eq!(
        bozza_di(&ws, "vuota.txt").as_deref(),
        Some("quello che stavo scrivendo"),
        "e la bozza resta orfana, che è il caso che `vault.repair` sa mostrare — \
         non cancellata"
    );
}

// --- 3. nel dubbio non si accoppia e non si raccoglie -----------------------

#[test]
fn n_spariti_e_n_comparsi_non_si_accoppiano_e_non_si_raccolgono() {
    let f = Fixture::new();
    f.write("a.txt", "due note con lo stesso identico testo");
    f.write("b.txt", "due note con lo stesso identico testo");
    let mut ws = f.apri();
    ws.save_draft(&DocId::new("a.txt"), "la bozza di a", None)
        .expect("bozza");
    f.attacca_dati("a.txt");
    f.attacca_dati("b.txt");
    drop(ws);

    // Due spariti, due comparsi, una sola impronta: l'accoppiamento non è unico.
    f.rename("a.txt", "c.txt");
    f.rename("b.txt", "d.txt");

    let ws = f.apri();
    assert!(
        bozza_di(&ws, "c.txt").is_none() && bozza_di(&ws, "d.txt").is_none(),
        "nel dubbio non si accoppia: la bozza di a non va a indovinare una casa"
    );
    assert_eq!(
        bozza_di(&ws, "a.txt").as_deref(),
        Some("la bozza di a"),
        "e resta dov'era"
    );
    assert_eq!(
        f.dati_di("a.txt").as_deref(),
        Some("i dati di a.txt"),
        "e nel dubbio non si **raccoglie**: cancellare è irreversibile, \
         aspettare costa qualche byte fermo"
    );
    assert!(f.dati_di("b.txt").is_some(), "vale per tutti e due");
}

#[test]
fn il_dubbio_sospende_anche_la_raccolta_a_comando() {
    // `vault.repair` raccoglie a vault aperto da un pezzo, cioè quando il dubbio
    // di quest'apertura non è più in vista di nessuno. Senza l'elenco tenuto dal
    // workspace, un clic cancellerebbe ciò che l'apertura aveva deciso di
    // risparmiare.
    let f = Fixture::new();
    f.write("a.txt", "stesso testo");
    f.write("b.txt", "stesso testo");
    drop(f.apri());
    f.attacca_dati("a.txt");
    f.rename("a.txt", "c.txt");
    f.rename("b.txt", "d.txt");

    let mut ws = f.montato();
    // I comandi di manutenzione stanno nel registro come tutti gli altri, e
    // vanno registrati come tutti gli altri.
    ws.register_plugin(
        fub_abi::traits::PluginManifest::core(
            fub_kernel::maintenance::MAINTENANCE_ID,
            "Manutenzione",
        )
        .speaking("it", fub_kernel::maintenance::catalog()),
        fub_kernel::Trust::Core,
    )
    .expect("dichiarato");
    ws.register_command_provider(
        fub_kernel::maintenance::MAINTENANCE_ID,
        Box::new(fub_kernel::maintenance::Maintenance),
    )
    .expect("registrato");
    ws.reindex().expect("reindex");
    ws.invoke_command(
        "vault.repair",
        serde_json::Value::Null,
        fub_abi::command::InvokeMode::Apply,
        fub_abi::Actor::User,
    )
    .expect("riparazione");
    assert!(
        f.dati_di("a.txt").is_some(),
        "la riparazione non tocca ciò che l'apertura ha messo in dubbio"
    );
}

// --- 4. una raccolta si fa su un'anagrafe completa --------------------------

#[test]
fn unindicizzazione_interrotta_non_raccoglie_niente() {
    // Ci si arriva premendo «annulla» sulla prima indicizzazione di un vault
    // grande, o chiudendo l'app mentre gira: le note ci sono tutte, e l'anagrafe
    // non le ha ancora guardate. Chi raccogliesse lì cancellerebbe dal disco lo
    // spazio per-documento di note che esistono — e quello non lo rifà nessuno.
    let f = Fixture::new();
    f.write("a.txt", "una nota che esiste eccome");
    f.attacca_dati("a.txt");

    let mut ws = f.montato();
    let work = ws.scan_vault().expect("scansione");
    // Nessuna fetta: si chiude subito, come farebbe la bandiera dell'annullamento.
    let apertura = ws.finish_index(work);
    assert!(apertura.interrotta, "l'apertura non è arrivata in fondo");
    assert_eq!(
        f.dati_di("a.txt").as_deref(),
        Some("i dati di a.txt"),
        "da un'anagrafe parziale «sparito» e «non ancora guardato» sono la \
         stessa cosa, e una delle due mosse è irreversibile"
    );
}
