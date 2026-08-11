//! **Il lotto del watcher non tiene il vault mentre legge il disco.**
//!
//! È la regola della [0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)
//! applicata alla porta da cui il vault cambia da fuori: il lotto prendeva
//! `write()` e sotto quel lucchetto leggeva e parsava ogni file cambiato, quindi
//! chi legge — la ricerca, l'autocompletamento, il disegno dei pannelli —
//! aspettava la fine di un'I/O che non ha niente a che fare con lui.
//!
//! **Qui non si cronometra niente.** Un tempo su una macchina condivisa non è
//! un segnale, e la proprietà non è «più veloce»: è che *durante* quella
//! lettura il prestito condiviso si prende ancora. Il presidio la osserva
//! direttamente, e la sincronizzazione è un canale — un formato di prova che
//! blocca dentro `parse` finché il lettore non ha letto. Deterministico: o il
//! lettore entra, o il test resta appeso e libtest lo dice.
//!
//! Il modo di perdere la proprietà è una parola: `read()` riscritto in `write()`
//! nella fase 1 di `ExternalSync::batch` compila, passa ogni test funzionale e
//! non si vede in nessuna diff che non sia questa.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult, VaultEntry};
use fub_abi::{FormatProvider, Revision, WriteBase};
use fub_host::{Custodia, ExternalChange, ExternalSync};
use fub_kernel::{FormatRegistry, Workspace};

/// Il cancello che rende **osservabile** una lettura lenta senza dormire.
///
/// `dentro` dice al test che il parse è cominciato, `via` gli lascia decidere
/// quando finisce. Finché non sono armati il formato parsa come qualunque
/// altro: la scansione iniziale del vault passa di qui, e un cancello sempre
/// chiuso la bloccherebbe.
#[derive(Default)]
struct Cancello {
    dentro: Mutex<Option<Sender<()>>>,
    via: Mutex<Option<Receiver<()>>>,
}

impl Cancello {
    /// Arma il cancello per **una** lettura: restituisce l'estremo da cui il
    /// test sente che il parse è entrato, e quello con cui lo lascia uscire.
    fn arma(&self) -> (Receiver<()>, Sender<()>) {
        let (dentro_tx, dentro_rx) = channel();
        let (via_tx, via_rx) = channel();
        *self.dentro.lock().unwrap() = Some(dentro_tx);
        *self.via.lock().unwrap() = Some(via_rx);
        (dentro_rx, via_tx)
    }

    fn attraversa(&self) {
        let dentro = self.dentro.lock().unwrap().take();
        let via = self.via.lock().unwrap().take();
        if let (Some(dentro), Some(via)) = (dentro, via) {
            dentro.send(()).expect("il test aspetta il parse");
            via.recv().expect("il test lascia uscire il parse");
        }
    }
}

/// Un formato di testo nudo che, a cancello armato, si ferma dentro `parse`.
struct Lento(Arc<Cancello>);

impl FormatProvider for Lento {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("prova.lento", "Lento", &["md"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.0.attraversa();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }
    fn render_html(&self, m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

struct Banco {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    cancello: Arc<Cancello>,
    ws: Custodia<Workspace>,
}

fn banco() -> Banco {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("nota.md"), "prima\n").expect("semina");

    let cancello: Arc<Cancello> = Arc::default();
    let mut formati = FormatRegistry::new();
    formati
        .register(Box::new(Lento(cancello.clone())))
        .expect("nessun conflitto");
    let mut ws = Workspace::new(&root, formati).expect("l'apertura del vault riesce");
    // La scansione iniziale passa dal parse: il cancello è ancora aperto.
    ws.reindex().expect("scansione iniziale");

    Banco {
        _dir: dir,
        root,
        cancello,
        ws: Custodia::new("il vault di prova", ws),
    }
}

fn entry(ws: &Workspace, id: &DocId) -> VaultEntry {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .expect("il kernel serve l'anagrafe")
    else {
        panic!("attesa l'anagrafe");
    };
    page.items
        .into_iter()
        .find(|e| &e.id == id)
        .expect("la nota è in anagrafe")
}

/// **La proprietà.** Mentre il lotto legge e parsa un file cambiato, chi legge
/// entra nel workspace.
///
/// `try_read` e non `read`: un `read` che aspettasse renderebbe il test verde
/// anche col prestito esclusivo — aspetterebbe la fine del parse e poi
/// passerebbe. Ciò che si vuole sapere è se in *quel momento* il vault è
/// prendibile, e a quella domanda risponde solo la forma che non aspetta.
#[test]
fn chi_legge_entra_mentre_il_lotto_legge_il_disco() {
    let banco = banco();
    std::fs::write(banco.root.join("nota.md"), "dopo\n").expect("scrittura da fuori");

    let (dentro, via) = banco.cancello.arma();
    let lotto = {
        let (ws, path) = (banco.ws.clone(), banco.root.join("nota.md"));
        std::thread::spawn(move || {
            ExternalSync::new(ws).batch(&[ExternalChange::Touched(path)]);
        })
    };

    // Il parse è cominciato: da qui in poi il lotto sta facendo I/O.
    dentro.recv().expect("il lotto entra nel parse");
    let letto = banco.ws.try_read();
    assert!(
        letto.is_some(),
        "il workspace non si presta mentre il lotto legge il disco: la fase che \
         legge e parsa tiene il prestito esclusivo, e chi legge — la ricerca, il \
         disegno dei pannelli — aspetta un'I/O che non lo riguarda (0024)"
    );
    // E non è un prestito vuoto: da lì si legge davvero.
    assert!(letto
        .expect("il prestito condiviso c'è")
        .render_preview(&DocId::new("nota.md"))
        .is_ok());
    via.send(()).expect("il lotto può finire");
    lotto.join().expect("il lotto finisce");

    // E il lotto ha fatto il suo lavoro: il modello nuovo è dentro.
    assert_eq!(
        entry(&banco.ws.read().unwrap(), &DocId::new("nota.md")).fingerprint,
        Some(Revision::of("dopo\n")),
        "il lotto ha letto e parsato, ma non ha applicato niente"
    );
}

/// **Il piano dichiara cosa credeva di sapere, e chi applica lo verifica.**
///
/// È il prezzo della fase in più: fra il parse e l'applicazione il prestito
/// esclusivo passa di mano, e in mezzo può entrarci un salvataggio dell'utente.
/// Applicare il modello parsato *prima* di quella scrittura la cancellerebbe
/// dalla memoria del kernel — sul disco resterebbe, in anagrafe e negli indici
/// no, e nessuno se ne accorgerebbe fino alla riapertura.
#[test]
fn un_piano_invecchiato_non_cancella_chi_ha_scritto_in_mezzo() {
    let banco = banco();
    let id = DocId::new("nota.md");
    let path = banco.root.join("nota.md");
    std::fs::write(&path, "da fuori\n").expect("scrittura da fuori");

    let mut ws = banco.ws.write().unwrap();
    // Fase 1: il piano legge «da fuori».
    let piano = ws.plan_sync(&path);
    assert!(piano.is_some(), "c'era un documento da preparare");
    // In mezzo, l'utente salva.
    ws.write_document(&id, "dall'utente\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");
    // Fase 2: il piano è invecchiato e si butta.
    ws.sync_path_prepared(&path, piano)
        .expect("la sincronizzazione riesce lo stesso");

    assert_eq!(
        entry(&ws, &id).fingerprint,
        Some(Revision::of("dall'utente\n")),
        "un piano fatto prima del salvataggio è stato applicato dopo: la \
         scrittura dell'utente è sparita dalla memoria del kernel"
    );
}
