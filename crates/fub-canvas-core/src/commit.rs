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
//! 2. la validazione del modello di dopo ([`Canvas::validate`]) e dei colori
//!    che Fub non conosce ([`CommitError::Invalid`]): un colore sconosciuto si
//!    scrive solo se la lavagna l'ha letto (vedi [`Core`]);
//! 3. il ritocco del sorgente ([`patch_source`]): un sorgente che il ritocco
//!    non sa leggere (una chiave doppia, anche sconosciuta, R3) è
//!    [`CommitError::Rejected`];
//! 4. la rilettura del testo di dopo ([`parse`]), che deve dare il modello di
//!    dopo come valore JSON (R9): altrimenti [`CommitError::Unstable`].
//!
//! Un commit di sole toppe `ink` su livelli che restano dove sono (un tratto
//! scritto, cancellato, cambiato) non rilegge la lavagna intera: ritocca e
//! rilegge solo la voce di `nodes` o il valore di `fub:ink` della radice che
//! cambia ([`SourceIndex`]), e il resto del sorgente e del modello resta
//! com'è. Il testo è quello dei passi 1–4, byte per byte, e così l'errore:
//! quando il ritocco di una parte sola non si può fare (un livello della
//! radice che nasce o sparisce, una toppa che non torna, un indice che non
//! torna) il commit fa i passi 1–4 su tutto. La parte riscritta si rilegge
//! con [`parse`] alla stessa profondità che ha nel file, quindi il modello è
//! quello che darebbe la rilettura intera.
//!
//! Un errore lascia [`Core`] com'era. [`Core::preview`] fa gli stessi passi
//! e dà lo stesso testo (o lo stesso errore) senza cambiare [`Core`]. I vettori di
//! `apps/client/src/__fixtures__/canvas-patches/` fissano gli stessi byte e
//! le stesse ragioni in Rust e in TypeScript
//! (`docs/reference/canvas-format.md` § «Parità»).

use std::collections::BTreeSet;

use serde_json::Value;
use thiserror::Error;

use crate::ink::{LayerRef, INK_KEY};
use crate::model::{Canvas, CanvasColor, CanvasError, CanvasNode, MAX_SOURCE_BYTES};
use crate::patch::{self, same_edge, same_map, same_node, same_value, CanvasPatch, PatchError};
use crate::read::parse;
use crate::source::{
    apply_splices, patch_board_ink, patch_node, patch_source, SourceError, SourceIndex, Splice,
};

/// Una lavagna aperta: il sorgente del file e il modello che se ne legge.
///
/// Il modello è sempre quello del sorgente: lo cambiano solo
/// [`Core::commit`] e [`Core::reset`], e un errore non lo tocca.
///
/// Un colore che Fub non conosce (`"rosso"`) si legge e si riscrive com'è.
/// Per scriverlo di nuovo la lavagna deve averlo letto: `unknown_colors` ne
/// tiene i testi, dal file aperto e da quelli ricaricati con [`Core::reset`].
/// Così un annulla riporta il colore che c'era, e una scheda che si copia lo
/// porta con sé; un colore inventato resta un errore `invalid`.
#[derive(Clone, Debug)]
pub struct Core {
    source: String,
    canvas: Canvas,
    unknown_colors: BTreeSet<String>,
    /// Dove stanno le schede e l'inchiostro della radice nel sorgente, per il
    /// commit di un tratto. Nasce al primo commit di sole toppe `ink` (una
    /// scansione, non una lettura), lo tiene al passo ogni commit di una
    /// parte sola, e ogni altro cambio lo butta.
    index: Option<SourceIndex>,
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
    /// Che cosa è cambiato nel modello: chi lo mostra può prendere solo
    /// quello invece del modello intero.
    pub changed: Changed,
}

/// Che cosa è cambiato nel modello con un commit.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Changed {
    /// Qualunque cosa: il modello si rilegge intero.
    #[default]
    Whole,
    /// Solo il livello `fub:ink` delle schede in queste posizioni di `nodes`
    /// (crescenti, senza doppioni) e, se `board`, quello della radice, che
    /// c'era e c'è ancora. Le schede non cambiano posto né numero, e le altre
    /// chiavi della radice restano com'erano.
    Ink { nodes: Vec<usize>, board: bool },
}

/// Una parte della lavagna che un commit di sole toppe `ink` riscrive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Part {
    /// La scheda in questa posizione di `nodes`.
    Node(usize),
    /// Il valore di `fub:ink` della radice.
    Board,
}

/// Una parte con la sua bozza.
#[derive(Clone, Copy)]
enum Drafted<'a> {
    Node(usize, &'a CanvasNode),
    Board(&'a Value),
}

/// Un commit fatto su una parte sola: i pezzi del sorgente (in ordine), il
/// sorgente di dopo e le parti del modello rilette.
struct Local {
    splices: Vec<Splice>,
    source: String,
    /// Le schede rilette, con la loro posizione in `nodes`, crescente.
    nodes: Vec<(usize, CanvasNode)>,
    /// Il valore di `fub:ink` della radice riletto.
    board: Option<Value>,
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
        let mut unknown_colors = BTreeSet::new();
        remember_unknown_colors(&mut unknown_colors, &canvas);
        Ok(Self {
            source,
            canvas,
            unknown_colors,
            index: None,
        })
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
        // I colori già letti restano scrivibili: un annulla dopo il
        // ricaricamento riporta lo stesso testo di prima.
        let mut next = Self::open(source)?;
        next.unknown_colors.append(&mut self.unknown_colors);
        // `next` non ha indice: il sorgente nuovo si scandisce al prossimo
        // tratto.
        *self = next;
        Ok(())
    }

    /// Applica le toppe: tutte o nessuna. Il sorgente nuovo è riletto e
    /// verificato prima di prendere il posto del vecchio; con un errore la
    /// lavagna resta com'era. Una lista vuota è un commit che non cambia
    /// nulla.
    pub fn commit(&mut self, patches: &[CanvasPatch]) -> Result<Committed, CommitError> {
        if ink_only(patches) && self.index.is_none() {
            self.index = SourceIndex::new(&self.source);
        }
        if let Some(local) = self.local(patches) {
            return Ok(self.take_local(local, patches));
        }
        let (source, reread) = self.written(patches)?;
        let edit = Edit::between(&self.source, &source);
        // Il modello che si tiene è quello del testo: uguale alla bozza come
        // valore JSON, e letto con le stesse regole di un file aperto.
        self.canvas = reread;
        self.source.clone_from(&source);
        self.index = None;
        Ok(Committed {
            source,
            inverse: patch::inverse(patches),
            edit,
            changed: Changed::Whole,
        })
    }

    /// Il sorgente che darebbe [`Core::commit`] con le stesse toppe, senza
    /// cambiare la lavagna: stessi passi, stesso testo, stesso errore. Serve
    /// alle bozze di recupero, che vogliono il testo intero di una modifica
    /// non ancora registrata.
    pub fn preview(&self, patches: &[CanvasPatch]) -> Result<String, CommitError> {
        if let Some(local) = self.local(patches) {
            return Ok(local.source);
        }
        self.written(patches).map(|(source, _)| source)
    }

    /// Prende il commit di una parte sola: il sorgente, le parti del modello
    /// rilette e l'indice al passo.
    fn take_local(&mut self, local: Local, patches: &[CanvasPatch]) -> Committed {
        let Local {
            splices,
            source,
            nodes,
            board,
        } = local;
        let edit = splice_edit(&self.source, &source, &splices);
        if let Some(index) = &mut self.index {
            // Dall'ultimo pezzo al primo: ognuno sposta solo ciò che gli sta
            // dopo, e quelli prima non si muovono.
            if !splices.iter().rev().all(|splice| index.replaced(splice)) {
                self.index = None;
            }
        }
        let positions = nodes.iter().map(|(at, _)| *at).collect();
        for (at, node) in nodes {
            if let Some(slot) = self.canvas.nodes.get_mut(at) {
                *slot = node;
            }
        }
        let board_changed = board.is_some();
        if let Some(value) = board {
            // La chiave c'era: `insert` la lascia al suo posto.
            self.canvas.extra.insert(INK_KEY.to_owned(), value);
        }
        self.source.clone_from(&source);
        Committed {
            source,
            inverse: patch::inverse(patches),
            edit,
            changed: Changed::Ink {
                nodes: positions,
                board: board_changed,
            },
        }
    }

    /// Il commit di sole toppe `ink` su una parte sola della lavagna, senza
    /// cambiarla; `None` se così non si può, e allora vale quello di tutto il
    /// testo ([`Core::written`]), che dà anche l'errore.
    ///
    /// - Le toppe si applicano a una copia delle sole schede che tengono i
    ///   livelli e del solo `fub:ink` della radice: una toppa `ink` legge e
    ///   scrive solo il livello di chi lo tiene, quindi la bozza di quelle
    ///   parti è quella di [`patch::draft`] su tutta la lavagna.
    /// - La validazione e i colori non servono: guardano campi che una toppa
    ///   `ink` non cambia.
    /// - Ogni parte riscritta si rilegge con [`parse`] in un involucro che la
    ///   tiene alla profondità che ha nel file (`{"nodes":[…]}` o
    ///   `{"fub:ink":…}`), e deve dare la bozza (R9).
    fn local(&self, patches: &[CanvasPatch]) -> Option<Local> {
        let index = self.index.as_ref()?;
        if !ink_only(patches) || index.node_count() != self.canvas.nodes.len() {
            return None;
        }
        let mut parts: Vec<Part> = Vec::new();
        for patch in patches {
            let CanvasPatch::Ink { layer, .. } = patch else {
                return None;
            };
            let part = match layer {
                LayerRef::Board => Part::Board,
                LayerRef::Node(id) => {
                    // Una scheda che non c'è: l'errore lo dà la bozza intera.
                    Part::Node(self.canvas.nodes.iter().position(|node| node.id == *id)?)
                }
            };
            if !parts.contains(&part) {
                parts.push(part);
            }
        }
        // Un livello della radice che nasce o sparisce cambia le chiavi
        // della radice: lo scrive il ritocco di tutto il testo.
        let board_before = self.canvas.extra.get(INK_KEY);
        if parts.contains(&Part::Board)
            && !(board_before.is_some() && index.board_ink_span().is_some())
        {
            return None;
        }
        let mut copy = Canvas::default();
        for part in &parts {
            match *part {
                Part::Node(at) => copy.nodes.push(self.canvas.nodes.get(at)?.clone()),
                Part::Board => {
                    copy.extra.insert(INK_KEY.to_owned(), board_before?.clone());
                }
            }
        }
        // Una toppa che non torna: l'errore, con le sue posizioni, lo dà la
        // bozza intera.
        let draft = patch::draft_owned(copy, patches).ok()?;

        // La bozza ha le schede nell'ordine delle parti.
        let mut pieces: Vec<(Drafted<'_>, Splice)> = Vec::with_capacity(parts.len());
        let mut drafted_nodes = draft.nodes.iter();
        for part in &parts {
            let (drafted, splice) = match *part {
                Part::Node(at) => {
                    let after = drafted_nodes.next()?;
                    let before = self.canvas.nodes.get(at)?;
                    let splice = patch_node(&self.source, index, at, before, after);
                    (Drafted::Node(at, after), splice)
                }
                Part::Board => {
                    let after = draft.extra.get(INK_KEY)?;
                    let splice = patch_board_ink(&self.source, index, board_before?, after);
                    (Drafted::Board(after), splice)
                }
            };
            pieces.push((drafted, splice.ok()??));
        }
        pieces.sort_by_key(|(_, splice)| splice.start);
        let grown: usize = pieces.iter().map(|(_, splice)| splice.text.len()).sum();
        let shrunk: usize = pieces
            .iter()
            .map(|(_, splice)| splice.end - splice.start)
            .sum();
        // Oltre il limite la rilettura intera fallisce: l'errore lo dà lei.
        if (self.source.len() + grown).saturating_sub(shrunk) > MAX_SOURCE_BYTES {
            return None;
        }

        let mut nodes = Vec::new();
        let mut board = None;
        for (drafted, splice) in &pieces {
            match *drafted {
                Drafted::Node(at, after) => {
                    let mut read = parse(&format!("{{\"nodes\":[{}]}}", splice.text)).ok()?;
                    let node = read.nodes.pop()?;
                    if !read.nodes.is_empty() || !read.extra.is_empty() || !same_node(&node, after)
                    {
                        return None;
                    }
                    nodes.push((at, node));
                }
                Drafted::Board(after) => {
                    let mut read = parse(&format!("{{\"{INK_KEY}\":{}}}", splice.text)).ok()?;
                    let value = read.extra.shift_remove(INK_KEY)?;
                    if !read.nodes.is_empty()
                        || !read.extra.is_empty()
                        || !same_value(&value, after)
                    {
                        return None;
                    }
                    board = Some(value);
                }
            }
        }
        nodes.sort_by_key(|(at, _)| *at);
        let splices: Vec<Splice> = pieces.into_iter().map(|(_, splice)| splice).collect();
        let source = apply_splices(&self.source, &splices)?;
        Some(Local {
            splices,
            source,
            nodes,
            board,
        })
    }

    /// I passi 1–4 del commit: il sorgente di dopo e il modello riletto da
    /// lui, senza toccare la lavagna.
    fn written(&self, patches: &[CanvasPatch]) -> Result<(String, Canvas), CommitError> {
        let draft = patch::draft(&self.canvas, patches)?;
        draft.validate().map_err(CommitError::Invalid)?;
        check_colors(&draft, &self.unknown_colors).map_err(CommitError::Invalid)?;
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

/// Una lista non vuota di sole toppe `ink`.
fn ink_only(patches: &[CanvasPatch]) -> bool {
    !patches.is_empty()
        && patches
            .iter()
            .all(|patch| matches!(patch, CanvasPatch::Ink { .. }))
}

/// Il tratto minimo da `before` ad `after`, che differiscono solo nei pezzi
/// `splices` (in ordine): lo stesso di [`Edit::between`]. Con un pezzo solo
/// si confrontano soltanto i suoi due testi, perché il resto è uguale per
/// forza; con più pezzi, o se il prefisso comune arriva alla fine di uno dei
/// due testi del pezzo (e il confronto potrebbe continuare oltre), si
/// confrontano i sorgenti interi.
fn splice_edit(before: &str, after: &str, splices: &[Splice]) -> Edit {
    let [splice] = splices else {
        return Edit::between(before, after);
    };
    let Some(old) = before.get(splice.start..splice.end) else {
        return Edit::between(before, after);
    };
    let new = splice.text.as_str();
    let common = old
        .bytes()
        .zip(new.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    if common == old.len().min(new.len()) {
        return Edit::between(before, after);
    }
    // Il prefisso comune dei sorgenti si ferma dentro il pezzo, e il suffisso
    // comune è il resto dopo il pezzo più quello dei due testi (il limite che
    // tiene il suffisso dopo il prefisso cresce della stessa misura). Il
    // pezzo comincia e finisce su un byte ASCII (un valore JSON), quindi i
    // confini di carattere sono gli stessi nei testi e nei sorgenti.
    let local = Edit::between(old, new);
    Edit {
        start: splice.start + local.start,
        end: splice.start + local.end,
        text: local.text,
    }
}

/// I colori di schede e archi, nell'ordine del modello.
fn colors(canvas: &Canvas) -> impl Iterator<Item = &CanvasColor> {
    let nodes = canvas.nodes.iter().filter_map(|node| node.color.as_ref());
    let edges = canvas.edges.iter().filter_map(|edge| edge.color.as_ref());
    nodes.chain(edges)
}

/// Ricorda i colori che Fub non conosce di `canvas`.
fn remember_unknown_colors(known: &mut BTreeSet<String>, canvas: &Canvas) {
    known.extend(
        colors(canvas)
            .filter(|color| !color.is_known())
            .map(|color| color.as_str().to_owned()),
    );
}

/// Un colore che Fub conosce si scrive sempre; uno che non conosce solo se la
/// lavagna l'ha letto. Un colore inventato è `invalid`, come prima di T47b.
fn check_colors(draft: &Canvas, read: &BTreeSet<String>) -> Result<(), CanvasError> {
    for color in colors(draft) {
        if !color.is_known() && !read.contains(color.as_str()) {
            return Err(CanvasError::Invalid(format!(
                "invalid canvas color {:?}",
                color.as_str()
            )));
        }
    }
    Ok(())
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

/// Il commit di una parte sola contro quello di tutto il testo, e il lavoro
/// che fa.
#[cfg(test)]
#[path = "commit_local_tests.rs"]
mod local_tests;

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
