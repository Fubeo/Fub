//! **Una fetta dell'apertura si prepara in lettura e si applica in scrittura**
//! ([decisione 0119](../../../docs/decisions/0119-il-piano-si-fa-in-lettura-e-si-applica-in-scrittura.md),
//! secondo sito).
//!
//! Che il prestito condiviso si prenda ancora *durante* la lettura è una
//! proprietà dei thread, e sta di là (`fub-host`, `runner.rs`). Qui c'è il
//! prezzo di quella forma, che è del kernel e si mette in scena senza thread:
//! fra la fase che legge e quella che muta il prestito esclusivo passa di mano,
//! e un'apertura dura secondi — il vault è utilizzabile da quando la scansione è
//! finita, quindi in mezzo ci sta comodo un salvataggio dell'utente.
//!
//! Applicare lì il modello parsato *prima* di quella scrittura la cancellerebbe
//! dalla memoria del kernel: sul disco resta, in anagrafe e negli indici no, e
//! non se ne accorge nessuno fino alla riapertura. È lo stesso difetto che la
//! 0119 ha trovato sul lotto del watcher, dove i file cambiati sono quattro;
//! qui sono quattromila, e la finestra dura tutta l'apertura.
//!
//! La corsa **non si aspetta, si costruisce**: le tre chiamate sono in fila in
//! un test solo, e il salvataggio sta fra la prima e la terza. Niente `sleep`,
//! niente thread, nessun istante da indovinare.

use std::sync::{Arc, Mutex};

use fub_abi::error::{FormatError, PluginError};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute, VaultEntry,
};
use fub_abi::{FormatProvider, Revision, WriteBase};
use fub_testkit::{Bench, Mounted};

/// Un formato di testo nudo: il modello è il sorgente, così ciò che l'indice
/// riceve si legge a occhio.
struct Nudo;

impl FormatProvider for Nudo {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("prova.nudo", "Nudo", &["md"])
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
    fn render_html(&self, m: &DocumentModel, _or: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

/// Un indice che annota **quale testo** gli è arrivato, e in che ordine.
///
/// L'anagrafe da sola non basterebbe a questo presidio: dice quale impronta il
/// kernel attribuisce al file, non quale contenuto la ricerca ha in pancia. Le
/// due cose si perdono insieme, ma è la seconda che l'utente vede — cerca una
/// parola che ha appena scritto e non la trova.
#[derive(Clone, Default)]
struct SpyIndex {
    texts: Arc<Mutex<Vec<String>>>,
}

impl IndexProvider for SpyIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn up_to_date(&self, _entries: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut texts = self.texts.lock().unwrap();
        for doc in docs {
            texts.push(doc.text.clone());
        }
        Vec::new()
    }
    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::BadArgs("la spia non risponde".into()))
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

/// Un vault montato ma **non ancora aperto**: l'apertura da guardare è la
/// prima, e il banco altrimenti l'ha già fatta.
fn bench_from_open() -> (Mounted, SpyIndex) {
    let probe = SpyIndex::default();
    let mut bench = Bench::new()
        .with_format(Box::new(Nudo))
        .with_plugin("test.spia")
        .without_scan()
        .mounts();
    bench
        .register_index_provider("test.spia".to_string(), Box::new(probe.clone()))
        .expect("l'indice si registra");
    (bench, probe)
}

fn entry(ws: &fub_kernel::Workspace, id: &DocId) -> VaultEntry {
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
        .find(|and| &and.id == id)
        .expect("la nota è in anagrafe")
}

/// **Il piano dichiara cosa credeva di sapere, e chi applica lo verifica.**
#[test]
fn an_aged_plan_does_not_delete_saved_entries_during_opening() {
    let (mut bench, probe) = bench_from_open();
    let id = DocId::new("nota.md");
    bench.write("nota.md", "dal disco\n");

    let mut work = bench.scan_vault().expect("la scansione riesce");
    // Fase 1, sotto prestito condiviso: la fetta legge «dal disco».
    let plan = bench.plan_batch(&mut work);
    // In mezzo, l'utente salva la stessa nota: il vault è utilizzabile da
    // quando la scansione è finita, quindi questo è un gesto normale e non una
    // patologia.
    bench
        .write_document(&id, "dall'utente\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");
    // Fase 2, sotto prestito esclusivo: il piano è invecchiato e si butta.
    bench.index_batch_prepared(plan);

    assert_eq!(
        entry(&bench, &id).fingerprint,
        Some(Revision::of("dall'utente\n")),
        "un piano fatto prima del salvataggio è stato applicato dopo: la \
         scrittura dell'utente è sparita dall'anagrafe"
    );
    let texts = probe.texts.lock().unwrap().clone();
    assert_eq!(
        texts.last().map(String::as_str),
        Some("dall'utente\n"),
        "l'ultimo testo arrivato all'indice è quello letto dal disco *prima* \
         del salvataggio: chi cerca una parola appena scritta non la trova, e \
         niente lo dice fino alla riapertura ({texts:?})"
    );
}

/// **Un documento che nessuno ha toccato passa dal piano come sempre**: il
/// confronto delle impronte è un cancello, non un freno.
///
/// Sta accanto al presidio di sopra perché è la sua metà che si rompe in
/// silenzio: un confronto scritto al contrario — o un'impronta letta dopo
/// invece che prima — butterebbe *ogni* documento della fetta, e il vault si
/// aprirebbe con la ricerca vuota senza che un solo test funzionale se ne
/// accorga.
#[test]
fn without_no_one_in_middle_the_slice_enters_whole() {
    let (mut bench, probe) = bench_from_open();
    for n in 0..3 {
        bench.write(&format!("Nota{n}.md"), &format!("corpo {n}\n"));
    }

    let mut work = bench.scan_vault().expect("la scansione riesce");
    let plan = bench.plan_batch(&mut work);
    bench.index_batch_prepared(plan);

    let mut texts = probe.texts.lock().unwrap().clone();
    texts.sort();
    assert_eq!(
        texts,
        ["corpo 0\n", "corpo 1\n", "corpo 2\n"],
        "la fetta non è entrata intera: il confronto delle impronte ha buttato \
         documenti che nessuno aveva toccato"
    );
    assert_eq!(
        entry(&bench, &DocId::new("Nota1.md")).fingerprint,
        Some(Revision::of("corpo 1\n")),
        "l'impronta imparata leggendo non è tornata in anagrafe"
    );
}
