//! Scaldare un motore prima della prima apertura, e lasciare andare le cache
//! dei documenti quando la shell li chiude.
//!
//! Due domande della shell, che non aspettano niente:
//!
//! - **scaldare** ([`crate::Host::warm_engine`]): il puntatore è su un file, o
//!   una cartella si è aperta. Se un vault aperto ha un provider attivo per
//!   quell'estensione, il motore che la apre si costruisce in sottofondo
//!   ([`fub_motori::Motori::scalda_per`]): un motore già acceso, o già in
//!   costruzione, non rifà niente.
//! - **documento chiuso** ([`crate::Host::document_closed`]): la shell ha
//!   chiuso l'ultima sessione di un documento ricco. Le prove a vuoto dei suoi
//!   byte si dimenticano, e quando non resta aperto nessun documento ricco in
//!   nessun vault si svuota la cache del motore dei documenti.
//!
//! Quali documenti ricchi sono aperti lo sa [`OpenRich`], uno per vault: le
//! revisioni che l'host ha dato alla shell leggendoli o salvandoli. La
//! revisione è l'impronta dei byte, la stessa chiave con cui il motore ricorda
//! la prova: per dimenticarla non si rilegge il disco.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Mutex, PoisonError};

use fub_abi::format::DocumentFormat;
use fub_abi::{DocId, Revision};
use fub_kernel::Workspace;

/// Quante revisioni di un documento aperto si tengono: quella letta e gli
/// ultimi salvataggi. Le prove ricordate sono comunque poche (il budget del
/// motore le toglie da sé); le revisioni più vecchie di queste non hanno più
/// una prova da dimenticare.
const REVISIONS_PER_DOC: usize = 8;

/// L'estensione più lunga che si prova a scaldare: oltre, non è il nome di un
/// formato.
const LONGEST_EXTENSION: usize = 16;

/// I documenti ricchi che la shell ha aperto in un vault, con le revisioni
/// dei byte che ha ricevuto. Vive quanto la sessione del vault.
///
/// Il lucchetto copre soltanto la mappa: sotto, niente chiama altro codice.
#[derive(Default)]
pub(crate) struct OpenRich {
    docs: Mutex<BTreeMap<DocId, VecDeque<Revision>>>,
}

impl OpenRich {
    fn docs(&self) -> std::sync::MutexGuard<'_, BTreeMap<DocId, VecDeque<Revision>>> {
        self.docs.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// La shell ha letto questo documento ricco a questa revisione.
    pub(crate) fn read(&self, id: &DocId, revision: &Revision) {
        let mut docs = self.docs();
        remember(docs.entry(id.clone()).or_default(), revision);
    }

    /// La shell ha salvato questo documento a questa revisione: conta solo se
    /// è aperto.
    pub(crate) fn saved(&self, id: &DocId, revision: &Revision) {
        if let Some(revisions) = self.docs().get_mut(id) {
            remember(revisions, revision);
        }
    }

    /// La shell ha chiuso il documento: le sue revisioni, se era aperto.
    pub(crate) fn close(&self, id: &DocId) -> Vec<Revision> {
        self.docs().remove(id).map(Vec::from).unwrap_or_default()
    }

    /// Le revisioni dei documenti ancora aperti.
    pub(crate) fn revisions(&self) -> BTreeSet<Revision> {
        self.docs().values().flatten().cloned().collect()
    }

    /// Nessun documento ricco aperto.
    pub(crate) fn is_empty(&self) -> bool {
        self.docs().is_empty()
    }
}

fn remember(revisions: &mut VecDeque<Revision>, revision: &Revision) {
    revisions.retain(|known| known != revision);
    revisions.push_back(revision.clone());
    while revisions.len() > REVISIONS_PER_DOC {
        revisions.pop_front();
    }
}

/// L'estensione come la manda la shell (`"docx"`, `".DOCX"`), se ha la forma
/// di un'estensione: lettere e cifre, senza punti né separatori.
pub(crate) fn extension(raw: &str) -> Option<String> {
    let bare = raw.strip_prefix('.').unwrap_or(raw);
    let valid = !bare.is_empty()
        && bare.len() <= LONGEST_EXTENSION
        && bare.bytes().all(|byte| byte.is_ascii_alphanumeric());
    valid.then(|| bare.to_ascii_lowercase())
}

/// Un documento con questa estensione ha un provider attivo in questo vault:
/// un formato registrato e, per una cartella di Excel, la superficie della
/// griglia del suo bundle, che si spegne con il plugin.
pub(crate) fn serves(workspace: &Workspace, extension: &str) -> bool {
    let probe = DocId::new(format!("fub-warm.{extension}"));
    let format: Option<DocumentFormat> = workspace.format_of(&probe);
    if format.is_none() {
        return false;
    }
    if !crate::workbook::is_workbook(format.as_ref()) {
        return true;
    }
    let Ok(surface) = crate::workbook::surface(&probe) else {
        return false;
    };
    workspace
        .grid_surfaces()
        .iter()
        .any(|spec| spec.id == surface)
}

/// Le prove a vuoto da dimenticare: le revisioni chiuse che nessun documento
/// ancora aperto ha. Fuori da ogni lucchetto dell'host.
pub(crate) fn forget_proofs(closed: &[Revision], still_open: &BTreeSet<Revision>) -> u64 {
    #[cfg(feature = "rich")]
    {
        let motore = fub_format_rich::motore::MotoreDocumenti::processo();
        closed
            .iter()
            .filter(|revision| !still_open.contains(revision))
            .map(|revision| motore.dimentica(revision))
            .sum()
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = (closed, still_open);
        0
    }
}

/// Svuota la cache del motore dei documenti e restituisce al sistema la
/// memoria liberata: non resta aperto nessun documento ricco. I dizionari del
/// correttore restano al budget finché un vault è aperto, come alla chiusura
/// di un vault che non è l'ultimo. Fuori da ogni lucchetto dell'host.
pub(crate) fn empty_document_caches() -> u64 {
    #[cfg(feature = "rich")]
    {
        use fub_motori::Voce as _;
        let freed = fub_format_rich::motore::MotoreDocumenti::processo().svuota();
        fub_motori::rilascia_al_sistema();
        freed
    }
    #[cfg(not(feature = "rich"))]
    {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_estensione_ha_la_forma_di_un_estensione() {
        assert_eq!(extension("docx").as_deref(), Some("docx"));
        assert_eq!(extension(".XLSX").as_deref(), Some("xlsx"));
        assert_eq!(extension(""), None);
        assert_eq!(extension("."), None);
        assert_eq!(extension("../x"), None);
        assert_eq!(extension("tar.gz"), None);
        assert_eq!(extension("a/b"), None);
        assert_eq!(extension(&"x".repeat(17)), None);
    }

    #[test]
    fn un_documento_aperto_tiene_le_sue_ultime_revisioni() {
        let open = OpenRich::default();
        let doc = DocId::new("Lettera.docx");
        open.saved(&doc, &Revision::new("prima"));
        assert!(open.is_empty(), "un salvataggio non apre un documento");
        for n in 0..10 {
            open.read(&doc, &Revision::new(format!("r{n}")));
        }
        open.read(&doc, &Revision::new("r9"));
        open.saved(&doc, &Revision::new("s"));
        let revisions = open.revisions();
        assert_eq!(revisions.len(), REVISIONS_PER_DOC);
        assert!(revisions.contains(&Revision::new("s")));
        assert!(!revisions.contains(&Revision::new("r0")));
        assert_eq!(open.close(&doc).len(), REVISIONS_PER_DOC);
        assert!(open.is_empty());
        assert!(open.close(&doc).is_empty());
    }
}
