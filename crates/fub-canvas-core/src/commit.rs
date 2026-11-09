//! La lavagna aperta e il commit di una lista di toppe: dal sorgente di prima
//! al sorgente nuovo, riletto e verificato, con l'inversa per l'annulla; tutte
//! le toppe o nessuna.
//!
//! La tela lo usa compilato in WebAssembly (`crates/fub-canvas-wasm`).
//! [`Core`] tiene il sorgente e il modello che ne viene; [`Core::commit`] fa,
//! in quest'ordine:
//!
//! 1. la bozza delle toppe su una copia del modello ([`patch::draft`]): una
//!    toppa che non torna è [`CommitError::Stale`];
//! 2. la validazione del modello di dopo ([`Canvas::validate`]):
//!    [`CommitError::Invalid`];
//! 3. il ritocco del sorgente ([`patch_source`]): un sorgente che il ritocco
//!    non sa leggere (una chiave doppia, anche sconosciuta, R3) è
//!    [`CommitError::Rejected`];
//! 4. la rilettura del testo di dopo ([`parse`]), che deve dare il modello di
//!    dopo come valore JSON (R9): altrimenti [`CommitError::Unstable`].
//!
//! Un errore lascia [`Core`] com'era. [`Core::preview`] fa gli stessi passi
//! e dà lo stesso testo (o lo stesso errore) senza cambiare [`Core`]. I vettori di
//! `apps/client/src/__fixtures__/canvas-patches/` fissano gli stessi byte e
//! le stesse ragioni in Rust e in TypeScript
//! (`docs/reference/canvas-format.md` § «Parità»).

use thiserror::Error;

use crate::model::{Canvas, CanvasError};
use crate::patch::{self, same_edge, same_map, same_node, CanvasPatch, PatchError};
use crate::read::parse;
use crate::source::{patch_source, SourceError};

/// Una lavagna aperta: il sorgente del file e il modello che se ne legge.
///
/// Il modello è sempre quello del sorgente: lo cambiano solo
/// [`Core::commit`] e [`Core::reset`], e un errore non lo tocca.
#[derive(Clone, Debug)]
pub struct Core {
    source: String,
    canvas: Canvas,
}

/// Un commit riuscito.
#[derive(Clone, Debug, PartialEq)]
pub struct Committed {
    /// Il sorgente di dopo, quello che si scrive nel file.
    pub source: String,
    /// Le toppe che disfano il commit ([`patch::inverse`]): applicate al
    /// sorgente di dopo danno l'annulla.
    pub inverse: Vec<CanvasPatch>,
    /// Il tratto minimo cambiato, per i comandi.
    pub edit: Edit,
}

/// Il tratto minimo che porta il sorgente di prima a quello di dopo:
/// `prima[..start] + text + prima[end..]` è il sorgente di dopo.
///
/// `start` ed `end` sono byte UTF-8 del sorgente di prima e cadono sempre su
/// un confine di carattere: il tratto non taglia mai un carattere a metà.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Edit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

impl Edit {
    /// Il tratto da `before` ad `after`: il prefisso e il suffisso comuni più
    /// lunghi che non si sovrappongono, accorciati fino a un confine di
    /// carattere in tutti e due i testi.
    pub fn between(before: &str, after: &str) -> Self {
        let (old, new) = (before.as_bytes(), after.as_bytes());
        let mut prefix = old.iter().zip(new).take_while(|(a, b)| a == b).count();
        // Un prefisso comune che finisce a metà di un carattere in uno dei
        // due finisce a metà anche nell'altro (i byte sono uguali): si torna
        // all'inizio del carattere.
        while !(before.is_char_boundary(prefix) && after.is_char_boundary(prefix)) {
            prefix -= 1;
        }
        let room = old.len().min(new.len()) - prefix;
        let mut suffix = old
            .iter()
            .rev()
            .zip(new.iter().rev())
            .take(room)
            .take_while(|(a, b)| a == b)
            .count();
        while !(before.is_char_boundary(old.len() - suffix)
            && after.is_char_boundary(new.len() - suffix))
        {
            suffix -= 1;
        }
        let end = old.len() - suffix;
        Self {
            start: prefix,
            end,
            // I due confini sono di carattere: la fetta c'è sempre.
            text: after
                .get(prefix..new.len() - suffix)
                .unwrap_or_default()
                .to_owned(),
        }
    }

    /// Applica il tratto a `before`: `None` se i confini non ci stanno.
    pub fn apply(&self, before: &str) -> Option<String> {
        let head = before.get(..self.start)?;
        let tail = before.get(self.end..)?;
        Some(format!("{head}{}{tail}", self.text))
    }
}

/// Perché un commit non si fa. In ogni caso [`Core`] resta com'era.
#[derive(Debug, Error)]
pub enum CommitError {
    /// Una toppa non torna con il modello: l'immagine di prima è un'altra,
    /// una posizione è fuori, un arco punta a una scheda che non c'è, una
    /// scheda da togliere ha ancora archi, un ordine non è una permutazione.
    #[error(transparent)]
    Stale(#[from] PatchError),
    /// Il modello di dopo non è una lavagna valida ([`Canvas::validate`]).
    #[error("the canvas after the patches is not valid: {0}")]
    Invalid(#[source] CanvasError),
    /// Il ritocco rifiuta il sorgente (per esempio una chiave doppia,
    /// anche sconosciuta, a qualunque profondità).
    #[error("the canvas source cannot be patched: {0}")]
    Rejected(#[from] SourceError),
    /// Il testo di dopo, riletto, non dà il modello di dopo: `reread` è
    /// l'errore della rilettura, se non si legge affatto (per esempio oltre
    /// [`crate::model::MAX_SOURCE_BYTES`]).
    #[error("the canvas source written does not read back as the canvas after the patches")]
    Unstable { reread: Option<CanvasError> },
}

impl CommitError {
    /// La ragione in una parola, la stessa che dà il TypeScript
    /// (`canvasCommitOutcome` in `operation.ts`) e che portano i vettori:
    /// `stale`, `invalid`, `rejected` o `unstable`. Una toppa `ink` che
    /// porterebbe a un livello d'inchiostro che Fub non scrive è `invalid`
    /// anche se la ferma la bozza ([`PatchError::reason`]).
    pub fn reason(&self) -> &'static str {
        match self {
            Self::Stale(error) => error.reason(),
            Self::Invalid(_) => "invalid",
            Self::Rejected(_) => "rejected",
            Self::Unstable { .. } => "unstable",
        }
    }
}

impl Core {
    /// Apre una lavagna dal sorgente del file ([`parse`]).
    pub fn open(source: impl Into<String>) -> Result<Self, CanvasError> {
        let source = source.into();
        let canvas = parse(&source)?;
        Ok(Self { source, canvas })
    }

    /// Il modello della lavagna.
    pub fn canvas(&self) -> &Canvas {
        &self.canvas
    }

    /// Il sorgente della lavagna, byte per byte quello del file (BOM e
    /// terminatori compresi).
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Riapre la lavagna da un sorgente nuovo (il file è cambiato da fuori).
    /// Con un errore la lavagna resta com'era.
    pub fn reset(&mut self, source: impl Into<String>) -> Result<(), CanvasError> {
        *self = Self::open(source)?;
        Ok(())
    }

    /// Applica le toppe: tutte o nessuna. Il sorgente nuovo è riletto e
    /// verificato prima di prendere il posto del vecchio; con un errore la
    /// lavagna resta com'era. Una lista vuota è un commit che non cambia
    /// nulla.
    pub fn commit(&mut self, patches: &[CanvasPatch]) -> Result<Committed, CommitError> {
        let (source, reread) = self.written(patches)?;
        let edit = Edit::between(&self.source, &source);
        // Il modello che si tiene è quello del testo: uguale alla bozza come
        // valore JSON, e letto con le stesse regole di un file aperto.
        self.canvas = reread;
        self.source.clone_from(&source);
        Ok(Committed {
            source,
            inverse: patch::inverse(patches),
            edit,
        })
    }

    /// Il sorgente che darebbe [`Core::commit`] con le stesse toppe, senza
    /// cambiare la lavagna: stessi passi, stesso testo, stesso errore. Serve
    /// alle bozze di recupero, che vogliono il testo intero di una modifica
    /// non ancora registrata.
    pub fn preview(&self, patches: &[CanvasPatch]) -> Result<String, CommitError> {
        self.written(patches).map(|(source, _)| source)
    }

    /// I passi 1–4 del commit: il sorgente di dopo e il modello riletto da
    /// lui, senza toccare la lavagna.
    fn written(&self, patches: &[CanvasPatch]) -> Result<(String, Canvas), CommitError> {
        let draft = patch::draft(&self.canvas, patches)?;
        draft.validate().map_err(CommitError::Invalid)?;
        let source = patch_source(&self.source, &self.canvas, &draft)?;
        let reread = parse(&source).map_err(|error| CommitError::Unstable {
            reread: Some(error),
        })?;
        if !same_canvas(&reread, &draft) {
            return Err(CommitError::Unstable { reread: None });
        }
        Ok((source, reread))
    }
}

/// Due lavagne uguali come valori JSON (R9): le schede e gli archi nello
/// stesso ordine, ognuno uguale per valore, e gli stessi campi sconosciuti
/// della radice.
fn same_canvas(left: &Canvas, right: &Canvas) -> bool {
    left.nodes.len() == right.nodes.len()
        && left.edges.len() == right.edges.len()
        && left
            .nodes
            .iter()
            .zip(&right.nodes)
            .all(|(a, b)| same_node(a, b))
        && left
            .edges
            .iter()
            .zip(&right.edges)
            .all(|(a, b)| same_edge(a, b))
        && same_map(&left.extra, &right.extra)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_edit_is_the_minimal_span() {
        let edit = Edit::between("abcdef", "abXYef");
        assert_eq!(
            edit,
            Edit {
                start: 2,
                end: 4,
                text: "XY".into()
            }
        );
        assert_eq!(Edit::between("same", "same").text, "");
        assert_eq!(Edit::between("", "new").apply("").as_deref(), Some("new"));
    }

    #[test]
    fn a_repeated_run_does_not_overlap() {
        // Prefisso e suffisso comuni si contenderebbero la `a` di mezzo.
        let edit = Edit::between("aa", "aaa");
        assert_eq!(edit.apply("aa").as_deref(), Some("aaa"));
        assert!(edit.start <= edit.end);
    }
}
