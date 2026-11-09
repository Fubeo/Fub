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
//!   chiuso una sessione di documento, con la sua chiave di apertura. Le
//!   prove a vuoto delle revisioni che la chiave teneva si dimenticano, se
//!   nessun'altra chiave le tiene, e quando non resta aperta nessuna chiave in
//!   nessun vault si svuota la cache del motore dei documenti.
//!
//! Un documento ricco conta come aperto soltanto sotto una **chiave di
//! apertura** ([`OpenKey`]), che la shell sceglie, una per sessione di
//! documento: chi lo legge senza chiave (l'anteprima, la CLI, il server MCP,
//! la cattura, i lavori) fa una **lettura semplice**, che dà la stessa
//! proiezione e non lascia nessuna prova ricordata.
//!
//! Quali revisioni tiene ogni chiave lo sa [`OpenRich`], uno per vault: le
//! revisioni che l'host ha dato alla shell sotto quella chiave, leggendo o
//! salvando. La revisione è l'impronta dei byte, la stessa con cui il motore
//! ricorda la prova: per dimenticarla non si rilegge il disco.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::{Mutex, PoisonError};

use fub_abi::format::DocumentFormat;
use fub_abi::{DocId, PluginError, Revision, Text};
use fub_kernel::Workspace;

/// Quante revisioni tiene una chiave aperta: quella letta e gli ultimi
/// salvataggi. Le prove ricordate sono comunque poche (il budget del motore le
/// toglie da sé); le revisioni più vecchie di queste non hanno più una prova
/// da dimenticare.
const REVISIONS_PER_DOC: usize = 8;

/// Quante chiavi tiene aperte un vault. Oltre, si chiude quella usata meno di
/// recente, con le sue prove: una shell che dimentica di chiudere non fa
/// crescere la memoria senza fine.
pub(crate) const MAX_OPEN_KEYS: usize = 1024;

/// La chiave più lunga che la shell può scegliere.
const LONGEST_KEY: usize = 64;

/// L'estensione più lunga che si prova a scaldare: oltre, non è il nome di un
/// formato.
const LONGEST_EXTENSION: usize = 16;

/// La **chiave di apertura** di una sessione di documento della shell: da 1 a
/// 64 caratteri `[A-Za-z0-9_-]` (un UUID va bene). La sceglie la shell, una per
/// sessione, e la chiave segue la sessione, non il nome del documento.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct OpenKey(String);

impl OpenKey {
    /// La chiave, se ha la forma di una chiave; altrimenti `BadArgs`, prima
    /// di leggere il disco.
    pub fn parse(raw: &str) -> Result<OpenKey, PluginError> {
        let valid = !raw.is_empty()
            && raw.len() <= LONGEST_KEY
            && raw
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
        if valid {
            Ok(OpenKey(raw.to_string()))
        } else {
            Err(PluginError::BadArgs(Text::message(
                "host.open_key.malformed",
                Vec::new(),
            )))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for OpenKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Le revisioni che una chiave tiene, e quando l'ha usata l'ultima volta.
struct Held {
    revisions: VecDeque<Revision>,
    used: u64,
}

#[derive(Default)]
struct Keys {
    held: HashMap<OpenKey, Held>,
    /// Quante volte una chiave è stata usata: un contatore, per sapere quale
    /// è stata usata meno di recente.
    uses: u64,
}

/// Le chiavi di apertura della shell in un vault, con le revisioni dei byte
/// che ha ricevuto sotto ciascuna. Vive quanto la sessione del vault.
///
/// Il lucchetto copre soltanto la mappa: sotto, niente chiama altro codice.
#[derive(Default)]
pub(crate) struct OpenRich {
    keys: Mutex<Keys>,
}

impl OpenRich {
    fn keys(&self) -> std::sync::MutexGuard<'_, Keys> {
        self.keys.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// La shell ha ricevuto queste revisioni di un documento ricco sotto la
    /// chiave, leggendo o salvando: la chiave si apre, se non lo era. Oltre
    /// [`MAX_OPEN_KEYS`] chiavi si chiude quella usata meno di recente: dà le
    /// sue revisioni, da dimenticare.
    pub(crate) fn hold(&self, key: &OpenKey, revisions: &[Revision]) -> Vec<Revision> {
        let mut keys = self.keys();
        keys.uses += 1;
        let used = keys.uses;
        let held = keys.held.entry(key.clone()).or_insert_with(|| Held {
            revisions: VecDeque::new(),
            used,
        });
        held.used = used;
        for revision in revisions {
            remember(&mut held.revisions, revision);
        }
        if keys.held.len() <= MAX_OPEN_KEYS {
            return Vec::new();
        }
        let oldest = keys
            .held
            .iter()
            .filter(|(other, _)| *other != key)
            .min_by_key(|(_, held)| held.used)
            .map(|(oldest, _)| oldest.clone());
        let Some(oldest) = oldest else {
            return Vec::new();
        };
        tracing::warn!(
            key = %oldest,
            limit = MAX_OPEN_KEYS,
            "documenti aperti: troppe chiavi, si chiude quella usata meno di recente"
        );
        keys.held
            .remove(&oldest)
            .map(|held| Vec::from(held.revisions))
            .unwrap_or_default()
    }

    /// La shell ha chiuso la sessione della chiave: le sue revisioni, se era
    /// aperta.
    pub(crate) fn close(&self, key: &OpenKey) -> Option<Vec<Revision>> {
        self.keys()
            .held
            .remove(key)
            .map(|held| Vec::from(held.revisions))
    }

    /// Le revisioni che le chiavi ancora aperte tengono.
    #[cfg_attr(not(feature = "rich"), allow(dead_code))]
    pub(crate) fn revisions(&self) -> BTreeSet<Revision> {
        self.keys()
            .held
            .values()
            .flat_map(|held| held.revisions.iter().cloned())
            .collect()
    }

    /// Quante chiavi sono aperte.
    pub(crate) fn len(&self) -> usize {
        self.keys().held.len()
    }

    /// Nessuna chiave aperta.
    pub(crate) fn is_empty(&self) -> bool {
        self.keys().held.is_empty()
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

/// Dimentica le prove a vuoto delle revisioni lasciate che nessuna chiave
/// ancora aperta in questi registri tiene. Fuori da ogni lucchetto dell'host.
/// Dà i byte stimati liberati.
pub(crate) fn forget_proofs(left: &[Revision], registers: &[std::sync::Arc<OpenRich>]) -> u64 {
    if left.is_empty() {
        return 0;
    }
    #[cfg(feature = "rich")]
    {
        let still_open: BTreeSet<Revision> = registers
            .iter()
            .flat_map(|register| register.revisions())
            .collect();
        let motore = fub_format_rich::motore::MotoreDocumenti::processo();
        left.iter()
            .filter(|revision| !still_open.contains(revision))
            .map(|revision| motore.dimentica(revision))
            .sum()
    }
    #[cfg(not(feature = "rich"))]
    {
        let _ = registers;
        0
    }
}

/// Svuota la cache del motore dei documenti e restituisce al sistema la
/// memoria liberata: non resta aperta nessuna chiave. I dizionari del
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

    fn key(raw: &str) -> OpenKey {
        OpenKey::parse(raw).expect("a well-formed key")
    }

    #[test]
    fn una_chiave_ha_la_forma_di_una_chiave() {
        assert!(OpenKey::parse("a").is_ok());
        assert!(OpenKey::parse("6f1c2b9e-1d2a-4c3b-9a8e-0f1e2d3c4b5a").is_ok());
        assert!(OpenKey::parse("Sessione_7").is_ok());
        assert!(OpenKey::parse(&"x".repeat(LONGEST_KEY)).is_ok());
        for bad in ["", "a/b", "a.b", "a b", "è", "ключ", "a\0", "..", "a\n"] {
            assert!(
                matches!(OpenKey::parse(bad), Err(PluginError::BadArgs(_))),
                "{bad:?}"
            );
        }
        assert!(matches!(
            OpenKey::parse(&"x".repeat(LONGEST_KEY + 1)),
            Err(PluginError::BadArgs(_))
        ));
    }

    #[test]
    fn una_chiave_aperta_tiene_le_sue_ultime_revisioni() {
        let open = OpenRich::default();
        let sessione = key("s1");
        assert!(open.close(&sessione).is_none(), "una chiave mai aperta");
        for n in 0..10 {
            assert!(open
                .hold(&sessione, &[Revision::new(format!("r{n}"))])
                .is_empty());
        }
        open.hold(&sessione, &[Revision::new("r9"), Revision::new("s")]);
        let revisions = open.revisions();
        assert_eq!(revisions.len(), REVISIONS_PER_DOC);
        assert!(revisions.contains(&Revision::new("s")));
        assert!(!revisions.contains(&Revision::new("r0")));
        assert_eq!(
            open.close(&sessione).map(|r| r.len()),
            Some(REVISIONS_PER_DOC)
        );
        assert!(open.is_empty());
        assert!(open.close(&sessione).is_none());
    }

    #[test]
    fn oltre_il_tetto_si_chiude_la_chiave_usata_meno_di_recente() {
        let open = OpenRich::default();
        for n in 0..MAX_OPEN_KEYS {
            assert!(open
                .hold(&key(&format!("k{n}")), &[Revision::new(format!("r{n}"))])
                .is_empty());
        }
        // La prima torna in uso: la più vecchia diventa la seconda.
        open.hold(&key("k0"), &[Revision::new("r0")]);
        let closed = open.hold(&key("nuova"), &[Revision::new("nuova")]);
        assert_eq!(closed, vec![Revision::new("r1")]);
        assert_eq!(open.len(), MAX_OPEN_KEYS);
        assert!(open.close(&key("k1")).is_none());
        assert!(open.close(&key("k0")).is_some());
        assert_eq!(open.revisions().len(), MAX_OPEN_KEYS - 1);
    }
}
