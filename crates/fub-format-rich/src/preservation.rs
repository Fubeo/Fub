//! Il controllo di Fub che nessun contenuto di un `.docx` si perda, posseduto da
//! Fub e indipendente dal motore che sorveglia.
//!
//! Il controllo misura i byte con [`crate::inventory`] in due momenti:
//!
//! - **all'apertura**, sui byte del file e su quelli di una prova a vuoto del
//!   codec (scrivere il documento letto senza modificarlo): un blocco del
//!   corpo che il codec perderebbe da solo resta chiuso, e ciò che perderebbe
//!   fuori dal corpo vieta la scrittura intera, perché l'innesto
//!   ([`crate::graft`]) tiene l'uno e l'altro com'erano nel file. Si apre in
//!   sola lettura ([`ReadOnly::Codec`](crate::ReadOnly::Codec)) soltanto un
//!   pacchetto che non si misura blocco per blocco;
//! - **a ogni salvataggio**, sui byte nuovi e su quelli della prova a vuoto
//!   della base. La prova all'apertura dimostra che il codec conserva il
//!   documento *così com'è*; una modifica cambia il modello, e il codec ha rami
//!   che dipendono dal modello (un budget sugli oggetti incorporati, parti
//!   proprie o condivise, relazioni tolte). Ciò che l'utente non ha toccato
//!   deve uscire identico: ogni blocco del corpo che il modello voluto ha uguale
//!   alla base, con le note e le caselle che mostra, e ogni classe di parti il
//!   cui dato nel modello non è cambiato. Ciò che l'utente ha toccato lo
//!   verifica la rilettura del modello ([`crate::fidelity::reads_back`]), a
//!   meno di ciò che il modello non dice: quello lo verifica il flusso.
//!
//! L'inventario conta; il flusso ([`crate::flow`]) dice dove. In entrambi i
//! momenti ogni blocco si confronta anche come flusso: all'apertura la prova
//! a vuoto porta il flusso di ogni blocco del file, al salvataggio un blocco
//! non toccato porta quello del file, e nei blocchi toccati resta ciò che la
//! proiezione non porta ([`crate::flow::keeps`]).
//!
//! In più, al salvataggio: nessuna parte da copiare compare in più copie di
//! quante ne chiedano il modello voluto o la base, e nessun riferimento a una
//! relazione resta senza la sua relazione.
//!
//! L'inventario conta anche i valori, in forma canonica, e il testo di ogni
//! paragrafo: un valore cambiato non passa come uno sparito. Le
//! normalizzazioni dichiarate in [`crate::inventory`] sono i soli segni che
//! non si contano, ciascuna con la sua ragione ([`normalizations`]).
//!
//! La prova a vuoto accettata all'apertura si ricorda per l'impronta dei byte
//! del file (`remember`, `remembered`): il writer è deterministico, e il
//! salvataggio dopo un'apertura degli stessi byte non rifà la prova.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use wordcraft_doc::{Block, Document, Part, PartKind};

use crate::fidelity::{each_paragraph, shown};
use crate::flow::{self, Token};
use crate::inventory::{
    self, equal_differences, inventory, open_differences, Counts, Difference, Inventory,
    InventoryError, Key, DOCUMENT,
};
use crate::parallel;

/// Perché un controllo non passa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Finding {
    /// Il pacchetto non si inventaria: si fallisce chiusi.
    Unreadable(InventoryError),
    /// Il codec perderebbe o aggiungerebbe queste chiavi.
    Differences(Vec<Difference>),
    /// Il corpo non si legge come flusso con i blocchi del modello, o un
    /// blocco perde nel flusso ciò che l'inventario non vede: un segno
    /// spostato, una proprietà passata a un altro carattere.
    Flow(String),
}

fn findings(differences: Vec<Difference>) -> Result<(), Finding> {
    match differences.is_empty() {
        true => Ok(()),
        false => Err(Finding::Differences(differences)),
    }
}

/// La prova a vuoto di un file che la regola all'apertura ha accettato: il suo
/// inventario, che ogni salvataggio sulla stessa base confronta con i byte
/// nuovi, il flusso dei blocchi del file, che ogni salvataggio deve portare,
/// e ciò che la prova a vuoto non porta.
#[derive(Debug)]
pub(crate) struct Baseline {
    /// L'inventario del file: un innesto si misura contro di lui.
    original: Inventory,
    dry: Inventory,
    file: Vec<Vec<Token>>,
    /// I blocchi del corpo che la prova a vuoto non porta interi: restano i
    /// byte del file, e un salvataggio che li tocca non si fa.
    pub locked: BTreeSet<usize>,
    /// La prova a vuoto porta tutto il pacchetto: un salvataggio può
    /// riscriverlo intero. Altrimenti si scrive soltanto per innesto.
    pub whole: bool,
}

impl Baseline {
    /// Quanto la prova pesa in memoria, in voci: i segni del flusso del file e
    /// le chiavi dei due inventari. Un documento grande ne ha milioni.
    pub(crate) fn weight(&self) -> usize {
        let tokens: usize = self.file.iter().map(Vec::len).sum();
        tokens + self.original.entries() + self.dry.entries()
    }
}

/// La regola all'apertura, sui byte del file e su quelli della prova a vuoto
/// del documento letto, che ha `blocks` blocchi nel corpo. Oltre
/// all'inventario, la prova a vuoto porta il flusso di ogni blocco
/// ([`flow::carries`]): un segno o una proprietà spostati lasciano gli stessi
/// conteggi.
///
/// La regola giudica ogni blocco da sé: un blocco che la prova a vuoto
/// perderebbe resta chiuso ([`Baseline::locked`]), perché l'innesto lo tiene
/// com'è nel file. Ciò che si perderebbe fuori dal corpo vieta soltanto la
/// scrittura intera ([`Baseline::whole`]). Fallisce soltanto un pacchetto che
/// non si misura blocco per blocco.
pub(crate) fn check_open(original: &[u8], dry: &[u8], blocks: usize) -> Result<Baseline, Finding> {
    // Le quattro misure non si parlano: insieme.
    let ((o_inventory, d_inventory), (file, written)) = parallel::join(
        || parallel::join(|| inventory(original), || inventory(dry)),
        || parallel::join(|| body_flow(original, blocks), || body_flow(dry, blocks)),
    );
    let o_inventory = o_inventory.map_err(Finding::Unreadable)?;
    let d_inventory = d_inventory.map_err(Finding::Unreadable)?;
    let file = file?.scan.blocks;
    let written = written?.scan.blocks;
    let Some(losses) = inventory::open_losses(&o_inventory, &d_inventory) else {
        return Err(Finding::Differences(open_differences(
            &o_inventory,
            &d_inventory,
        )));
    };
    let locked: BTreeSet<usize> = file
        .iter()
        .zip(&written)
        .zip(&losses.blocks)
        .enumerate()
        .filter(|(_, ((before, after), lost))| {
            !lost.is_empty() || flow::carries(before, after).is_err()
        })
        .map(|(at, _)| at)
        .collect();
    let whole = losses.outside.is_empty() && locked.is_empty();
    Ok(Baseline {
        original: o_inventory,
        dry: d_inventory,
        file,
        locked,
        whole,
    })
}

/// I blocchi chiusi della base ritrovati nel documento voluto: nell'ordine,
/// ciascuno al primo dei blocchi che la proiezione segna chiusi (`marked`,
/// indici del voluto) che gli è uguale. Un blocco copiato porta il segno
/// anche nella copia: la prima uguale tiene i byte del file, e le altre sono
/// blocchi nuovi. Uguale vuol dire come per
/// l'allineamento, con le storie che il blocco mostra ([`same_block`]). Dà il
/// primo blocco chiuso che il voluto ha tolto o cambiato.
pub(crate) fn anchors(
    locked: &BTreeSet<usize>,
    marked: &[usize],
    base: &Document,
    wanted: &Document,
) -> Result<Vec<(usize, usize)>, usize> {
    let mut marked = marked.iter().copied();
    locked
        .iter()
        .map(|&b| {
            marked
                .find(|&w| same_block(base, &base.body[b], wanted, &wanted.body[w]))
                .map(|w| (b, w))
                .ok_or(b)
        })
        .collect()
}

/// Il pacchetto con il flusso del corpo, i cui blocchi devono essere i
/// `blocks` del modello.
fn body_flow(bytes: &[u8], blocks: usize) -> Result<flow::Main, Finding> {
    let main = flow::main_of(bytes, &inventory::LIMITS)
        .map_err(|error| Finding::Flow(error.to_string()))?;
    if main.scan.blocks.len() != blocks {
        return Err(Finding::Flow(format!(
            "body blocks: {blocks} in the model, {} in the flow",
            main.scan.blocks.len()
        )));
    }
    Ok(main)
}

/// La regola sul flusso al salvataggio, fra i blocchi del file e quelli
/// scritti, con le coppie dei blocchi non toccati: un blocco non toccato
/// porta tutto il suo flusso, e ogni tratto toccato fra due blocchi non
/// toccati tiene ciò che la proiezione non porta ([`flow::keeps`]).
fn check_flow(
    file: &[Vec<Token>],
    written: &[Vec<Token>],
    pairs: &[(usize, usize)],
) -> Result<(), String> {
    let mut from = (0usize, 0usize);
    let ends = pairs
        .iter()
        .copied()
        .chain(std::iter::once((file.len(), written.len())));
    for (b, w) in ends {
        if b > from.0 {
            let before: Vec<Token> = file[from.0..b].iter().flatten().cloned().collect();
            let after: Vec<Token> = written[from.1..w].iter().flatten().cloned().collect();
            flow::keeps(&before, &after).map_err(|why| format!("blocks {}..{b}: {why}", from.0))?;
        }
        if b < file.len() {
            flow::carries(&file[b], &written[w]).map_err(|why| format!("block {b}: {why}"))?;
        }
        from = (b + 1, w + 1);
    }
    Ok(())
}

/// I byte che il codec ha scritto per `wanted`, letti come flusso: le unità
/// da innestare, e il flusso che il salvataggio controlla.
pub(crate) fn written(new: &[u8], wanted: &Document) -> Result<flow::Main, Finding> {
    body_flow(new, wanted.body.len())
}

/// La regola della scrittura intera. `baseline` è la prova a vuoto di
/// `base`, `new` sono i byte che il codec ha scritto per `wanted`, letti come
/// flusso in `written`, `pairs` i blocchi che l'utente non ha toccato
/// ([`untouched_blocks`]). Una base che si scrive soltanto per innesto
/// ([`Baseline::whole`]) non si riscrive intera: lo dice il chiamante, prima.
pub(crate) fn check_save(
    baseline: &Baseline,
    new: &[u8],
    written: &flow::Main,
    base: &Document,
    wanted: &Document,
    pairs: &[(usize, usize)],
) -> Result<(), Finding> {
    let inventoried = inventory(new).map_err(Finding::Unreadable)?;
    findings(save_differences(
        &baseline.dry,
        &inventoried,
        base,
        wanted,
        pairs,
    ))?;
    check_flow(&baseline.file, &written.scan.blocks, pairs).map_err(Finding::Flow)
}

/// La regola su un innesto ([`crate::graft`]): la stessa del salvataggio,
/// con il file (l'inventario che `baseline` ne tiene) al posto della prova a
/// vuoto, perché ciò che l'innesto non tocca sono i byte del file.
pub(crate) fn check_graft(
    baseline: &Baseline,
    grafted: &[u8],
    base: &Document,
    wanted: &Document,
    pairs: &[(usize, usize)],
) -> Result<(), Finding> {
    let (after, written) = parallel::join(
        || inventory(grafted),
        || body_flow(grafted, wanted.body.len()),
    );
    let before = &baseline.original;
    let after = after.map_err(Finding::Unreadable)?;
    // La radice dichiara ignorabili gli spazi dei nomi che le unità scritte
    // usano: un'aggiunta lì è dell'innesto.
    let ignorable = format!(
        "{DOCUMENT}: {{{}}}document @{{{}}}Ignorable=",
        inventory::NS_W,
        inventory::NS_MC
    );
    let differences = save_differences(before, &after, base, wanted, pairs)
        .into_iter()
        .filter(|d| !(d.after > d.before && d.key.starts_with(&ignorable)))
        .collect();
    findings(differences)?;
    let written = written?;
    check_flow(&baseline.file, &written.scan.blocks, pairs).map_err(Finding::Flow)
}

/// Se un salvataggio con queste coppie cambia soltanto il corpo del documento
/// principale e le sue relazioni: allora si può innestare.
pub(crate) fn body_only(base: &Document, wanted: &Document, pairs: &[(usize, usize)]) -> bool {
    touched_regions(base, wanted, pairs)
        .into_iter()
        .all(|region| region == "document→")
}

/// Quante prove a vuoto si ricordano.
const REMEMBERED: usize = 8;

/// Quanto pesano al più, in voci ([`Baseline::weight`]), le prove che si
/// ricordano oltre all'ultima: circa 350 MB. Un documento da centomila
/// paragrafi ne pesa da solo più di quattro milioni; l'ultima prova si
/// ricorda comunque, perché è quella che il salvataggio cerca.
const REMEMBERED_WEIGHT: usize = 4_000_000;

/// Le ultime prove a vuoto accettate, per impronta dei byte del file. Il
/// writer è deterministico (lo prova il banco del corpus), quindi gli stessi
/// byte danno la stessa prova: l'impronta fa da revisione, e una base cambiata
/// ha un'impronta nuova. Il salvataggio, che di solito segue l'apertura degli
/// stessi byte, non riscrive né reinventaria la base.
static BASELINES: Mutex<VecDeque<(String, Arc<Baseline>)>> = Mutex::new(VecDeque::new());

/// La chiave con cui una base si ricorda.
pub(crate) fn key(bytes: &[u8]) -> String {
    inventory::sha256(bytes)
}

/// La prova a vuoto accettata per questi byte, se si ricorda.
pub(crate) fn remembered(key: &str) -> Option<Arc<Baseline>> {
    let baselines = BASELINES.lock().ok()?;
    baselines
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, baseline)| Arc::clone(baseline))
}

/// Ricorda la prova a vuoto accettata per questi byte.
pub(crate) fn remember(key: String, baseline: Arc<Baseline>) {
    let Ok(mut baselines) = BASELINES.lock() else {
        return;
    };
    baselines.retain(|(k, _)| *k != key);
    baselines.push_back((key, baseline));
    let weights: Vec<usize> = baselines.iter().map(|(_, b)| b.weight()).collect();
    baselines.drain(..forgotten(&weights));
}

/// Quante prove, dalle più vecchie, si dimenticano, dati i pesi dalla più
/// vecchia all'ultima: al più [`REMEMBERED`], e quelle prima dell'ultima
/// entro [`REMEMBERED_WEIGHT`].
fn forgotten(weights: &[usize]) -> usize {
    let Some((_, older)) = weights.split_last() else {
        return 0;
    };
    let mut weight: usize = older.iter().sum();
    let mut out = 0;
    while out < older.len() && (weights.len() - out > REMEMBERED || weight > REMEMBERED_WEIGHT) {
        weight -= older[out];
        out += 1;
    }
    out
}

/// Le differenze fra la base `dry` (la prova a vuoto, o il file per un
/// innesto) e i byte nuovi `new`, per il salvataggio di `wanted` su `base`.
fn save_differences(
    dry: &Inventory,
    new: &Inventory,
    base: &Document,
    wanted: &Document,
    pairs: &[(usize, usize)],
) -> Vec<Difference> {
    let mut out = Vec::new();

    // I blocchi del corpo che l'utente non ha toccato: uguali uno a uno.
    let aligned = dry.body.len() == base.body.len() && new.body.len() == wanted.body.len();
    if aligned {
        for (b, w) in pairs {
            out.extend(equal_differences(
                &dry.body[*b],
                &new.body[*w],
                &format!("block {b}: "),
            ));
        }
    } else {
        out.push(Difference {
            key: format!(
                "body blocks: {} in the model, {} written",
                wanted.body.len(),
                new.body.len()
            ),
            before: dry.body.len() as u64,
            after: new.body.len() as u64,
        });
    }

    // Le classi di parti fuori dal corpo il cui dato non è cambiato.
    let touched = touched_regions(base, wanted, pairs);
    let (dry_rest, new_rest) = (dry.outside_body(), new.outside_body());
    let regions: BTreeSet<String> = dry_rest
        .keys()
        .chain(new_rest.keys())
        .filter_map(region)
        .collect();
    for name in regions {
        if touched.contains(name.as_str()) {
            continue;
        }
        out.extend(equal_differences(
            &of_region(&dry_rest, &name),
            &of_region(&new_rest, &name),
            "",
        ));
    }

    // Le parti copiate: non più copie di quante ne chiedano il modello voluto
    // o la base.
    let wanted_blobs = blobs(wanted);
    for (key, after) in &new.all {
        let Key::Part { sha256, .. } = key else {
            continue;
        };
        let before = dry.all.get(key).copied().unwrap_or(0);
        let asked = wanted_blobs.get(sha256.as_str()).copied().unwrap_or(0);
        if *after > before.max(asked) {
            out.push(Difference {
                key: key.to_string(),
                before,
                after: *after,
            });
        }
    }

    for dangling in new.dangling.difference(&dry.dangling) {
        out.push(Difference {
            key: format!("dangling reference {dangling}"),
            before: 0,
            after: 1,
        });
    }
    out
}

/// La regione di una chiave fuori dal corpo: la classe della parte, o la
/// classe della sorgente con `→` per le sue relazioni. Le parti copiate hanno
/// una regola loro.
fn region(key: &Key) -> Option<String> {
    match key {
        Key::Part { .. } => None,
        Key::Relationship { source, .. } => Some(format!("{source}→")),
        key => Some(key.class().to_string()),
    }
}

fn of_region(counts: &Counts, name: &str) -> Counts {
    counts
        .iter()
        .filter(|(key, _)| region(key).as_deref() == Some(name))
        .map(|(key, n)| (key.clone(), *n))
        .collect()
}

/// Quante volte ogni contenuto di byte compare fra le immagini e le parti
/// conservate del modello, per impronta.
fn blobs(document: &Document) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    for bytes in document.media.values().chain(document.passthrough.values()) {
        *out.entry(inventory::sha256(bytes)).or_default() += 1;
    }
    out
}

/// Le storie di un genere, come multinsieme dei loro contenuti.
fn stories(document: &Document, kind: PartKind) -> Vec<&Part> {
    let mut out: Vec<&Part> = document.parts.values().filter(|p| p.kind == kind).collect();
    out.sort_by_key(|part| format!("{part:?}"));
    out
}

/// Le regioni fuori dal corpo che il salvataggio può cambiare, perché il dato
/// che le scrive è cambiato nel modello. Ogni regione che non è qui deve
/// uscire identica alla prova a vuoto della base.
fn touched_regions(
    base: &Document,
    wanted: &Document,
    pairs: &[(usize, usize)],
) -> BTreeSet<&'static str> {
    let mut out = BTreeSet::new();
    let changed = |kind: PartKind| stories(base, kind) != stories(wanted, kind);
    let kept: BTreeSet<usize> = pairs.iter().map(|(_, w)| *w).collect();
    let body = pairs.len() != base.body.len() || kept.len() != wanted.body.len();
    // Una sezione chiusa da un paragrafo toccato, nella base o nel voluto.
    let kept_base: BTreeSet<usize> = pairs.iter().map(|(b, _)| *b).collect();
    let sections = |document: &Document, kept: &BTreeSet<usize>| {
        document.body.iter().enumerate().any(|(at, block)| {
            !kept.contains(&at)
                && block
                    .as_para()
                    .is_some_and(|paragraph| paragraph.section.is_some())
        })
    };
    let section = base.last_section != wanted.last_section
        || sections(base, &kept_base)
        || sections(wanted, &kept);
    if base.last_section != wanted.last_section {
        out.insert(DOCUMENT);
    }
    if body || section {
        // Le relazioni del documento principale seguono i blocchi.
        out.insert("document→");
    }
    if changed(PartKind::Header) || changed(PartKind::Footer) || section {
        out.extend(["header", "footer", "header→", "footer→"]);
    }
    let footnotes =
        changed(PartKind::Footnote) || base.footnote_separators != wanted.footnote_separators;
    if footnotes {
        out.extend(["footnotes", "footnotes→"]);
    }
    let endnotes =
        changed(PartKind::Endnote) || base.endnote_separators != wanted.endnote_separators;
    if endnotes {
        out.extend(["endnotes", "endnotes→"]);
    }
    if changed(PartKind::Comment) || base.comments != wanted.comments {
        out.extend([
            "comments",
            "comments→",
            "commentsextended",
            "commentsids",
            "commentsextensible",
            "people",
        ]);
    }
    if base.styles != wanted.styles {
        out.insert("styles");
    }
    if base.numbering != wanted.numbering {
        out.insert("numbering");
    }
    // Le impostazioni nominano i separatori delle note (`w:footnotePr`).
    if base.settings != wanted.settings || footnotes || endnotes {
        out.insert("settings");
    }
    if base.core != wanted.core {
        out.insert("core-properties");
    }
    if base.custom_props != wanted.custom_props {
        out.insert("custom-properties");
    }
    out
}

/// Le storie che un blocco mostra, anche attraverso le caselle di testo dentro
/// le caselle di testo.
fn shown_stories(document: &Document, block: &Block) -> Vec<u32> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut todo = Vec::new();
    each_paragraph(block, &mut |paragraph| todo.extend(shown(paragraph)));
    while let Some(id) = todo.pop() {
        if !seen.insert(id) {
            continue;
        }
        out.push(id);
        if let Some(part) = document.parts.get(&id) {
            for block in &part.blocks {
                each_paragraph(block, &mut |paragraph| todo.extend(shown(paragraph)));
            }
        }
    }
    out
}

/// Lo stesso blocco nei due modelli, con le stesse storie che mostra.
fn same_block(base: &Document, b: &Block, wanted: &Document, w: &Block) -> bool {
    // Il voluto riprende di solito il blocco della base, nello stesso `Arc`.
    if !std::ptr::eq(b, w) && b != w {
        return false;
    }
    shown_stories(base, b)
        .into_iter()
        .all(|id| base.parts.get(&id) == wanted.parts.get(&id))
}

/// Un blocco come elemento da allineare: uguale a un altro se è lo stesso
/// blocco con le stesse storie ([`same_block`]), con un'impronta del testo.
struct Aligned<'a> {
    document: &'a Document,
    block: &'a Arc<Block>,
    hash: u64,
}

impl PartialEq for Aligned<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.hash == other.hash
            && same_block(self.document, self.block, other.document, other.block)
    }
}

impl Eq for Aligned<'_> {}

impl std::hash::Hash for Aligned<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.hash.hash(state);
    }
}

fn aligned(document: &Document) -> Vec<Aligned<'_>> {
    use std::hash::{Hash, Hasher};
    document
        .body
        .iter()
        .map(|block| {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            each_paragraph(block, &mut |paragraph| paragraph.text.hash(&mut hasher));
            Aligned {
                document,
                block,
                hash: hasher.finish(),
            }
        })
        .collect()
}

/// Le coppie (blocco della base, blocco voluto) che l'utente non ha toccato,
/// nell'ordine: una sottosequenza comune ([`crate::diff::common`]), lineare
/// nella memoria anche sui documenti grandi. Le coppie `anchors` (i blocchi
/// chiusi, [`anchors`]) ci sono di sicuro, e il resto si allinea fra l'una e
/// l'altra.
pub(crate) fn untouched_blocks(
    base: &Document,
    wanted: &Document,
    anchors: &[(usize, usize)],
) -> Vec<(usize, usize)> {
    let (b, w) = (aligned(base), aligned(wanted));
    let mut out = Vec::new();
    let mut from = (0usize, 0usize);
    let ends = anchors
        .iter()
        .copied()
        .chain(std::iter::once((b.len(), w.len())));
    for (to_b, to_w) in ends {
        let between = crate::diff::common(&b[from.0..to_b], &w[from.1..to_w]);
        out.extend(between.into_iter().map(|(x, y)| (x + from.0, y + from.1)));
        if to_b < b.len() {
            out.push((to_b, to_w));
        }
        from = (to_b + 1, to_w + 1);
    }
    out
}

/// Il resoconto di misura di un `.docx`: ciò che una prova a vuoto del codec
/// cambierebbe, chiave per chiave, e le normalizzazioni dichiarate che ha
/// applicato. Serve a progettare la garanzia e a scegliere le normalizzazioni
/// sui file del corpus; non decide niente.
pub fn report(bytes: &[u8]) -> Result<String, crate::RichError> {
    use std::fmt::Write;
    let document = crate::Codec::Docx.read(bytes)?;
    let dry = crate::Codec::Docx.write(&document)?;
    let unreadable = |error: InventoryError| crate::RichError::Codec(format!("inventory: {error}"));
    let original = inventory(bytes).map_err(unreadable)?;
    let written = inventory(&dry).map_err(unreadable)?;
    let mut out = String::new();
    let differences = open_differences(&original, &written);
    let _ = writeln!(out, "differenze all'apertura: {}", differences.len());
    for difference in &differences {
        let _ = writeln!(out, "  {difference}");
    }
    match check_open(bytes, &dry, document.body.len()) {
        Ok(baseline) => {
            let _ = writeln!(
                out,
                "blocchi chiusi: {:?}; scrittura intera: {}",
                baseline.locked, baseline.whole
            );
        }
        Err(finding) => {
            let _ = writeln!(out, "non si misura blocco per blocco: {finding:?}");
        }
    }
    for normalization in inventory::NORMALIZATIONS {
        let count = |inventory: &Inventory| {
            inventory
                .normalized
                .get(normalization.what)
                .copied()
                .unwrap_or(0)
        };
        let (before, after) = (count(&original), count(&written));
        if before + after > 0 {
            let _ = writeln!(
                out,
                "normalizzazione «{}»: {before} nel file, {after} nella prova a vuoto",
                normalization.what
            );
        }
    }
    Ok(out)
}

/// Le normalizzazioni dichiarate, con la ragione di ciascuna.
pub fn normalizations() -> impl Iterator<Item = (&'static str, &'static str)> {
    inventory::NORMALIZATIONS.iter().map(|n| (n.what, n.why))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};

    use crate::Codec;

    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
    const CT: &str = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    const ROOT: &str = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    const IMAGE: &str = r#"<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="a.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n uno";

    fn entries(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        (0..z.len())
            .map(|i| {
                let mut f = z.by_index(i).unwrap();
                let mut out = Vec::new();
                f.read_to_end(&mut out).unwrap();
                (f.name().unwrap().to_string(), out)
            })
            .collect()
    }

    fn zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zw.start_file(name.as_str(), zip::write::SimpleFileOptions::default())
                .unwrap();
            zw.write_all(bytes).unwrap();
        }
        zw.finish().unwrap().into_inner()
    }

    /// I byte con una parte riscritta da `f` e queste voci in più.
    fn rewrite(
        bytes: &[u8],
        name: &str,
        f: impl Fn(&str) -> String,
        extra: &[(&str, &[u8])],
    ) -> Vec<u8> {
        let mut all = entries(bytes);
        let entry = all.iter_mut().find(|(n, _)| n == name).expect("parte");
        entry.1 = f(std::str::from_utf8(&entry.1).unwrap()).into_bytes();
        all.extend(extra.iter().map(|(n, b)| (n.to_string(), b.to_vec())));
        zip(&all)
    }

    /// Un documento con un paragrafo che porta `w:permStart`, una foto e un
    /// paragrafo da modificare; la base, il voluto con l'ultimo paragrafo
    /// cambiato, la prova a vuoto della base e i byte del voluto.
    fn scene() -> (Document, Document, Vec<u8>, Vec<u8>) {
        let (base, wanted, _, dry, new) = scene_with_file();
        (base, wanted, dry, new)
    }

    fn scene_with_file() -> (Document, Document, Vec<u8>, Vec<u8>, Vec<u8>) {
        let document = format!(
            r#"<w:document {W}><w:body><w:p><w:permStart w:id="7" w:edGrp="everyone"/><w:r><w:t>Primo</w:t></w:r><w:permEnd w:id="7"/></w:p>{IMAGE}<w:p><w:r><w:t>Ultimo</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#
        );
        let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>"#;
        let file = zip(&[
            ("[Content_Types].xml".into(), CT.as_bytes().to_vec()),
            ("_rels/.rels".into(), ROOT.as_bytes().to_vec()),
            ("word/document.xml".into(), document.into_bytes()),
            (
                "word/_rels/document.xml.rels".into(),
                rels.as_bytes().to_vec(),
            ),
            ("word/media/a.png".into(), PNG.to_vec()),
        ]);
        let base = Codec::Docx.read(&file).unwrap();
        let dry = Codec::Docx.write(&base).unwrap();
        assert_eq!(
            check_open(&file, &dry, base.body.len()).map(|_| ()),
            Ok(()),
            "la scena deve aprirsi modificabile"
        );
        let mut wanted = base.clone();
        let last = wanted.body.len() - 1;
        let Some(Block::Para(paragraph)) = wanted.body.get_mut(last).map(std::sync::Arc::make_mut)
        else {
            panic!("l'ultimo blocco non è un paragrafo")
        };
        paragraph.text.push_str(" cambiato");
        let new = Codec::Docx.write(&wanted).unwrap();
        (base, wanted, file, dry, new)
    }

    fn save(
        baseline: &Baseline,
        new: &[u8],
        base: &Document,
        wanted: &Document,
    ) -> Result<(), Finding> {
        let written = written(new, wanted)?;
        let pairs = untouched_blocks(base, wanted, &[]);
        check_save(baseline, new, &written, base, wanted, &pairs)
    }

    /// La base accettata di un file che è la prova a vuoto della scena, con i
    /// suoi tre blocchi.
    fn baseline(dry: &[u8]) -> Baseline {
        check_open(dry, dry, 3).expect("la prova a vuoto si accetta")
    }

    #[test]
    fn i_byte_del_codec_passano() {
        let (base, wanted, dry, new) = scene();
        assert_eq!(save(&baseline(&dry), &new, &base, &wanted), Ok(()));
    }

    /// Un elemento che il modello non possiede, sparito da un blocco che
    /// l'utente non ha toccato.
    #[test]
    fn un_elemento_in_meno_in_un_blocco_non_toccato_non_passa() {
        let (base, wanted, dry, new) = scene();
        let new = rewrite(
            &new,
            "word/document.xml",
            |xml| {
                let start = xml.find("<w:permStart").expect("permStart scritto");
                let end = start + xml[start..].find("/>").unwrap() + 2;
                format!("{}{}", &xml[..start], &xml[end..])
            },
            &[],
        );
        let Err(Finding::Differences(found)) = save(&baseline(&dry), &new, &base, &wanted) else {
            panic!("la perdita è passata")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.contains("block 0") && d.key.contains("permStart")),
            "{found:?}"
        );
    }

    /// La relazione della foto che punta a una parte con altri byte.
    #[test]
    fn una_relazione_verso_la_parte_sbagliata_vieta_la_scrittura_intera() {
        let (_, _, dry, _) = scene();
        let image = entries(&dry)
            .into_iter()
            .find(|(_, b)| b == PNG)
            .map(|(n, _)| n.trim_start_matches("word/").to_string())
            .expect("foto scritta");
        let wrong = rewrite(
            &dry,
            "word/_rels/document.xml.rels",
            |xml| xml.replace(&image, "media/altra.png"),
            &[("word/media/altra.png", b"\x89PNG\r\n\x1a\n due")],
        );
        let baseline = check_open(&dry, &wrong, 3).expect("si misura");
        assert!(!baseline.whole, "la relazione sbagliata è passata");
        let losses = inventory::open_losses(&inventory(&dry).unwrap(), &inventory(&wrong).unwrap());
        let found = losses.expect("gli stessi blocchi").outside;
        assert!(
            found.iter().any(|d| d.key.contains("relationship")),
            "{found:?}"
        );
    }

    /// La stessa foto copiata due volte, sotto due nomi raggiunti da due
    /// relazioni: il modello ne chiede una.
    #[test]
    fn una_parte_copiata_duplicata_non_passa() {
        let (base, wanted, dry, new) = scene();
        let new = rewrite(
            &new,
            "word/_rels/document.xml.rels",
            |xml| {
                xml.replace(
                    "</Relationships>",
                    r#"<Relationship Id="rIdCopia" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/copia.png"/></Relationships>"#,
                )
            },
            &[("word/media/copia.png", PNG)],
        );
        let Err(Finding::Differences(found)) = save(&baseline(&dry), &new, &base, &wanted) else {
            panic!("la copia doppia è passata")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.starts_with("part ") && d.after == 2),
            "{found:?}"
        );
    }

    /// Un valore cambiato con gli stessi conteggi (`foo="A"` che diventa
    /// `foo="B"`): all'apertura e in un blocco non toccato.
    #[test]
    fn un_valore_cambiato_chiude_il_blocco_e_non_passa_al_salvataggio() {
        let (base, wanted, file, dry, new) = scene_with_file();
        let other = |xml: &str| xml.replace(r#"w:edGrp="everyone""#, r#"w:edGrp="editors""#);
        let changed = rewrite(&dry, "word/document.xml", other, &[]);
        let opened = check_open(&file, &changed, 3).expect("si misura");
        assert_eq!(opened.locked, BTreeSet::from([0]), "all'apertura");
        assert!(!opened.whole);
        let losses =
            inventory::open_losses(&inventory(&file).unwrap(), &inventory(&changed).unwrap());
        let found = &losses.expect("gli stessi blocchi").blocks[0];
        assert!(
            found
                .iter()
                .any(|d| d.key.contains("block 0") && d.key.contains(r#"edGrp="everyone""#)),
            "{found:?}"
        );
        let new = rewrite(&new, "word/document.xml", other, &[]);
        let Err(Finding::Differences(found)) = save(&baseline(&dry), &new, &base, &wanted) else {
            panic!("il valore cambiato è passato al salvataggio")
        };
        assert!(found.iter().any(|d| d.key.contains("block 0")), "{found:?}");
    }

    /// Il testo di un paragrafo che l'utente non ha toccato.
    #[test]
    fn il_testo_di_un_blocco_non_toccato_non_cambia() {
        let (base, wanted, dry, new) = scene();
        let new = rewrite(
            &new,
            "word/document.xml",
            |xml| xml.replace(">Primo<", ">Prima<"),
            &[],
        );
        let Err(Finding::Differences(found)) = save(&baseline(&dry), &new, &base, &wanted) else {
            panic!("il testo cambiato è passato")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.contains("block 0") && d.key.contains("text of")),
            "{found:?}"
        );
    }

    /// Il segno del primo paragrafo, spostato dopo il suo testo: gli stessi
    /// conteggi, un altro posto. Non passa né all'apertura né in un blocco
    /// non toccato.
    #[test]
    fn un_segno_spostato_nel_paragrafo_chiude_il_blocco_e_non_passa_al_salvataggio() {
        let (base, wanted, file, dry, new) = scene_with_file();
        let moved = |xml: &str| {
            let start = xml.find("<w:permStart").expect("permStart scritto");
            let end = start + xml[start..].find("/>").unwrap() + 2;
            let mark = &xml[start..end];
            let rest = format!("{}{}", &xml[..start], &xml[end..]);
            let after = rest.find("</w:r>").unwrap() + "</w:r>".len();
            format!("{}{mark}{}", &rest[..after], &rest[after..])
        };
        let changed = rewrite(&dry, "word/document.xml", moved, &[]);
        let opened = check_open(&file, &changed, 3).expect("si misura");
        assert_eq!(opened.locked, BTreeSet::from([0]), "all'apertura");
        assert_eq!(
            inventory::open_losses(&inventory(&file).unwrap(), &inventory(&changed).unwrap())
                .map(|losses| losses.blocks[0].len()),
            Some(0),
            "gli stessi conteggi: lo dice soltanto il flusso"
        );
        let new = rewrite(&new, "word/document.xml", moved, &[]);
        let Err(Finding::Flow(why)) = save(&baseline(&dry), &new, &base, &wanted) else {
            panic!("il segno spostato è passato al salvataggio")
        };
        assert!(why.starts_with("block 0"), "{why}");
    }

    /// Nel paragrafo che l'utente ha cambiato, ciò che la proiezione non
    /// porta resta: la lingua dell'Asia orientale sparita dal suo testo non
    /// passa, il testo nuovo sì.
    #[test]
    fn nel_paragrafo_toccato_resta_ciò_che_la_proiezione_non_porta() {
        let (base, wanted, dry, new) = scene();
        let lang = r#"<w:rPr><w:lang w:eastAsia="ja-JP"/></w:rPr>"#;
        let with_lang = |xml: &str| {
            let at = xml
                .rmatch_indices("<w:t")
                .find(|(at, _)| matches!(xml.as_bytes()[at + 4], b'>' | b' '))
                .expect("ultimo testo")
                .0;
            format!("{}{lang}{}", &xml[..at], &xml[at..])
        };
        // Il file ha la lingua sul testo dell'ultimo paragrafo; i byte nuovi
        // di quel paragrafo, cambiato, non l'hanno.
        let file = rewrite(&dry, "word/document.xml", with_lang, &[]);
        let accepted = check_open(&file, &file, 3).expect("il file si accetta");
        let Err(Finding::Flow(why)) = save(&accepted, &new, &base, &wanted) else {
            panic!("la lingua persa è passata")
        };
        assert!(
            why.starts_with("blocks 2..3") && why.contains("w:lang"),
            "{why}"
        );
        let kept = rewrite(&new, "word/document.xml", with_lang, &[]);
        assert_eq!(save(&accepted, &kept, &base, &wanted), Ok(()));
    }

    /// La prova a vuoto accettata si ricorda per l'impronta dei byte: altri
    /// byte non la trovano.
    #[test]
    fn la_prova_a_vuoto_si_ricorda_per_contenuto() {
        let (_, _, file, dry, _) = scene_with_file();
        let accepted = Arc::new(check_open(&file, &dry, 3).unwrap());
        remember(key(&file), Arc::clone(&accepted));
        let found = remembered(&key(&file)).expect("ricordata");
        assert!(Arc::ptr_eq(&found, &accepted));
        let mut other = file.clone();
        other.push(0);
        assert!(remembered(&key(&other)).is_none());
    }

    /// Si ricordano al più otto prove, e quelle prima dell'ultima entro un
    /// peso: l'ultima resta anche se da sola pesa di più.
    #[test]
    fn le_prove_ricordate_hanno_un_numero_e_un_peso() {
        assert_eq!(forgotten(&[]), 0);
        assert_eq!(forgotten(&[1; REMEMBERED]), 0);
        assert_eq!(forgotten(&[1; REMEMBERED + 1]), 1);
        assert_eq!(forgotten(&[1, 2 * REMEMBERED_WEIGHT]), 0);
        assert_eq!(forgotten(&[REMEMBERED_WEIGHT, 1, 1]), 1);
        assert_eq!(forgotten(&[REMEMBERED_WEIGHT - 2, 1, 1]), 0);
        assert_eq!(forgotten(&[3, REMEMBERED_WEIGHT, 1]), 1);
        assert_eq!(forgotten(&[1, 2 * REMEMBERED_WEIGHT, 1]), 2);
    }

    /// Un content control di blocco: i suoi paragrafi sono blocchi uno per uno,
    /// come nel modello.
    #[test]
    fn i_blocchi_dentro_un_content_control_si_contano_uno_per_uno() {
        let document = format!(
            r#"<w:document {W}><w:body><w:p/><w:sdt><w:sdtPr><w:id w:val="3"/></w:sdtPr><w:sdtContent><w:p/><w:p/></w:sdtContent><w:sdtEndPr/></w:sdt><w:sectPr/></w:body></w:document>"#
        );
        let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;
        let file = zip(&[
            ("[Content_Types].xml".into(), CT.as_bytes().to_vec()),
            ("_rels/.rels".into(), ROOT.as_bytes().to_vec()),
            ("word/document.xml".into(), document.into_bytes()),
            (
                "word/_rels/document.xml.rels".into(),
                rels.as_bytes().to_vec(),
            ),
        ]);
        let found = inventory(&file).unwrap();
        assert_eq!(found.body.len(), 3);
        let sdt = Key::Element {
            class: DOCUMENT.into(),
            ns: "http://schemas.openxmlformats.org/wordprocessingml/2006/main".into(),
            name: "sdtPr".into(),
        };
        assert_eq!(
            found.body[1].get(&sdt),
            Some(&1),
            "l'involucro va con il primo blocco"
        );
        assert_eq!(found.body[2].get(&sdt), None);
    }

    /// Oltre il vecchio tetto di 4096 blocchi i blocchi non toccati si
    /// allineano lo stesso, anche con molte modifiche sparse e con i
    /// paragrafi spostati, e un paragrafo uguale ma ricopiato vale come
    /// uguale.
    #[test]
    fn i_blocchi_non_toccati_si_allineano_anche_nei_documenti_grandi() {
        let para = |text: &str| {
            let mut paragraph = wordcraft_doc::Paragraph::new();
            paragraph.text = text.to_string();
            wordcraft_doc::para_block(paragraph)
        };
        let mut base = Document::new();
        base.body = (0..10_000)
            .map(|i| para(&format!("paragrafo {}", i % 97)))
            .collect();
        let mut wanted = base.clone();
        // Ogni millesimo blocco cambia, uno sparisce, uno è una copia nuova.
        for at in (500..10_000).step_by(1000) {
            wanted.body[at] = para("cambiato");
        }
        wanted.body.remove(7_777);
        wanted.body[42] = para("paragrafo 42");
        let pairs = untouched_blocks(&base, &wanted, &[]);
        assert_eq!(pairs.len(), 10_000 - 10 - 1);
        assert!(pairs.windows(2).all(|w| w[0].0 < w[1].0 && w[0].1 < w[1].1));
        assert!(pairs.iter().all(|(b, w)| base.body[*b] == wanted.body[*w]));
        assert!(pairs.contains(&(42, 42)));
        assert!(pairs.contains(&(9_999, 9_998)));
    }

    fn body(texts: &[&str]) -> Document {
        let mut document = Document::new();
        document.body = texts
            .iter()
            .map(|text| {
                let mut paragraph = wordcraft_doc::Paragraph::new();
                paragraph.text = text.to_string();
                wordcraft_doc::para_block(paragraph)
            })
            .collect();
        document
    }

    /// Due paragrafi uguali, il secondo chiuso: l'utente toglie il primo. Il
    /// segno della proiezione dice quale resta, e l'allineamento lo tiene.
    #[test]
    fn un_blocco_chiuso_si_ritrova_dove_la_proiezione_lo_segna() {
        let base = body(&["uguale", "uguale", "fine"]);
        let wanted = body(&["uguale", "fine"]);
        let locked = BTreeSet::from([1]);
        let anchors = anchors(&locked, &[0], &base, &wanted);
        assert_eq!(anchors, Ok(vec![(1, 0)]));
        assert_eq!(
            untouched_blocks(&base, &wanted, &anchors.unwrap()),
            vec![(1, 0), (2, 1)]
        );
    }

    /// Un blocco chiuso tolto, cambiato o senza il segno non si ritrova; una
    /// copia segnata si salta.
    #[test]
    fn un_blocco_chiuso_tolto_o_cambiato_si_dice() {
        let base = body(&["chiuso", "libero"]);
        let locked = BTreeSet::from([0]);
        let removed = body(&["libero"]);
        assert_eq!(anchors(&locked, &[], &base, &removed), Err(0));
        let changed = body(&["chiuso!", "libero"]);
        assert_eq!(anchors(&locked, &[0], &base, &changed), Err(0));
        assert_eq!(anchors(&locked, &[], &base, &base), Err(0));
        let copied = body(&["libero", "chiuso", "libero", "chiuso"]);
        assert_eq!(anchors(&locked, &[1, 3], &base, &copied), Ok(vec![(0, 1)]));
        let pairs = untouched_blocks(&base, &copied, &[(0, 1)]);
        assert_eq!(pairs, vec![(0, 1), (1, 2)]);
        // Due blocchi chiusi scambiati non si ritrovano in ordine: la
        // superficie non lascia fare lo scambio, e il formato lo dice.
        let both = body(&["uno", "due"]);
        let swapped = body(&["due", "uno"]);
        let locked = BTreeSet::from([0, 1]);
        assert!(anchors(&locked, &[0, 1], &both, &swapped).is_err());
    }
}
