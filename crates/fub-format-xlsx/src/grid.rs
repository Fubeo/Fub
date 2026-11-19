//! La superficie della griglia su una cartella, con il protocollo `grid` a
//! byte ([`fub_abi::grid_bytes`]).
//!
//! Una sessione tiene i byte del file, il modello che ne legge GridCraft e il
//! giornale delle celle cambiate. Le finestre mostrano i valori del file, e
//! per una cella del giornale il valore nuovo; una formula che legge una cella
//! cambiata, direttamente o attraverso altre formule, mostra il valore che il
//! motore di GridCraft le ricalcola ([`crate::ricalcolo`]), e così una formula
//! che il file ha salvato senza valore. Una formula che il motore non sa
//! calcolare mostra il valore del file, segnato come **non aggiornato**.
//! Salvare è l'innesto ([`crate::graft`]): i byte del file con le celle del
//! giornale cambiate e i valori nuovi delle formule, e ogni altro byte
//! com'era.
//!
//! Dal primo comando della barra la sessione è **a comandi**
//! ([`crate::commands`], ADR 0219): il giornale porta i comandi, la facciata
//! di GridCraft li applica alla cartella del file, e le finestre mostrano la
//! cartella che ne esce. L'input delle celle diventa un comando anch'esso.
//! Salvare resta l'innesto finché i comandi scrivono soltanto valori che
//! l'innesto sa scrivere; altrimenti la cartella si riscrive con il codec,
//! se la riscrittura misurata non perde niente.
//!
//! Gli id sono stabili e senza stato: un foglio è `s` più il suo `sheetId`,
//! che non cambia quando il foglio cambia nome o posto; una riga è `r` più il
//! suo indice da 0, una colonna `c` più il suo. Il giornale sopravvive così a
//! una rilettura del file. Quando il file ha due fogli con lo stesso
//! `sheetId`, gli id sono `x` più la posizione, e nessuna cella si modifica.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use std::sync::Arc;

use fub_abi::{
    grid_bytes_revision, grid_journal_match, Arg, GridApplyRequest, GridBook, GridBytesCell,
    GridBytesProvider, GridBytesSession, GridBytesWindow, GridCalculation, GridCellKey,
    GridCellPatch, GridCellStyle, GridColumn, GridCommand, GridCommandOutcome, GridCommandRequest,
    GridCommandState, GridComment, GridCommentReply, GridCommit, GridDataBar, GridIcon,
    GridInvalidation, GridJournal, GridJournalMatch, GridLink, GridMerge, GridNotice, GridRow,
    GridSelection, GridSheet, GridSheetView, GridSourceEdit, GridSurfaceSpec, GridTable, GridValue,
    GridViewMode, GridWindowRequest, PluginError, Revision, Text, MAX_GRID_BOOK_NAMES,
    MAX_GRID_BYTES_SOURCE, MAX_GRID_FONT_BYTES, MAX_GRID_INVALIDATED_CELLS, MAX_GRID_NAME_BYTES,
    MAX_GRID_SELECTION_BYTES, MAX_GRID_SESSION_COLUMNS, MAX_GRID_SESSION_ROWS,
    MAX_GRID_WINDOW_TABLES,
};
use gridcraft_calc::recalc::{Calc, Key};
use gridcraft_core::{CellRef, RangeRef, Value as GcValue};
use gridcraft_engine::cf::CfCache;
use gridcraft_model::style::StyleId;
use gridcraft_model::{CalcMode, Sheet, SheetViewMode, Visibility, Workbook};
use gridcraft_numfmt::{format_value, NumberFormat};
use serde_json::{json, Value as Json};

use crate::commands::{self, Facade, Ran, Rewrite, Snapshot, REDO, UNDO};
use crate::cronologia::{self, Archivio, Cambio, Linea, Passo, Punto, Stato, RESTORE};
use crate::display::{self, NotShown, Warning};
use crate::graft::{graft_with_values, CellEdit, FormulaValue, GraftError};
use crate::input::{self, InputError, NewValue};
use crate::locks::SheetLocks;
use crate::motore::{Fogli, Presa};
use crate::objects;
use crate::package::Package;
use crate::ricalcolo::{self, Ricalcolo};
use crate::{guarded, sheet_xml, XlsxError, FORMAT_ID};

/// L'id della superficie.
pub const XLSX_GRID_SURFACE: &str = "fub.grid.xlsx";

/// Le righe vuote che la griglia mostra dopo l'ultima cella, per scriverci.
const ROW_MARGIN: u32 = 100;
/// Le colonne vuote dopo l'ultima.
const COLUMN_MARGIN: u32 = 10;
const MIN_ROWS: u32 = 100;
const MIN_COLUMNS: u32 = 26;
/// Le formule non aggiornate che una sessione conta una per una: oltre, lo
/// sono tutte.
const MAX_STALE: usize = 1_000_000;

/// Il codice di blocco di un foglio che l'innesto non tratta.
pub const SHEET_SHAPE_LOCK: &str = "sheet-shape";

fn bad(message: impl Into<String>) -> PluginError {
    PluginError::BadArgs(message.into().into())
}

/// Gli aspetti di una finestra, ciascuno una volta.
#[derive(Default)]
struct Styles {
    list: Vec<GridCellStyle>,
    known: HashMap<String, u32>,
}

impl Styles {
    fn index(&mut self, style: GridCellStyle) -> u32 {
        // Lo stile ha un `f32` e non è `Hash`: la chiave è la sua forma
        // serializzata, che è una sola.
        let key = serde_json::to_string(&style).expect("a grid style serializes");
        *self.known.entry(key).or_insert_with(|| {
            self.list.push(style);
            (self.list.len() - 1) as u32
        })
    }
}

fn stale_revision() -> PluginError {
    PluginError::Conflict("grid revision is stale".into())
}

fn xlsx_error(error: XlsxError) -> PluginError {
    match error {
        XlsxError::Encrypted => PluginError::PermissionDenied(error.to_string().into()),
        XlsxError::Crashed(_) => PluginError::Internal(error.to_string().into()),
        _ => bad(error.to_string()),
    }
}

/// Il rifiuto di una riscrittura che perderebbe qualcosa del file.
fn loses(why: String) -> PluginError {
    PluginError::PermissionDenied(Text::message(
        "xlsx.rewrite.loses",
        vec![Arg::text("why", why)],
    ))
}

fn graft_error(error: GraftError) -> PluginError {
    match error {
        GraftError::Locked { .. } => PluginError::PermissionDenied(error.to_string().into()),
        GraftError::Verify(_) | GraftError::Read(XlsxError::Crashed(_)) => {
            PluginError::Internal(error.to_string().into())
        }
        _ => bad(error.to_string()),
    }
}

/// Un foglio della sessione, come la griglia lo mostra.
#[derive(Clone)]
struct SheetInfo {
    id: String,
    rows: u32,
    columns: u32,
    /// Il foglio su cui righe e colonne sono state contate, in modalità a
    /// comandi.
    counted: Option<Arc<Sheet>>,
}

/// Un foglio del file, per l'innesto.
struct FileSheet {
    /// La parte del foglio, quando il pacchetto e il modello si corrispondono.
    part: Option<String>,
    /// I blocchi, letti alla prima finestra o modifica del foglio.
    shape: Option<Shape>,
}

enum Shape {
    Locks(Box<SheetLocks>),
    /// Il foglio ha una forma che l'innesto non tratta: nessuna cella si
    /// modifica.
    Unsupported,
}

/// Una voce del giornale, letta contro il file.
struct Entry {
    /// Il foglio e la cella; `None` quando la sessione non li ha.
    place: Option<(usize, CellRef)>,
    state: GridJournalMatch,
    value: NewValue,
}

/// Le dipendenze delle formule, lette alla prima modifica.
struct Deps {
    calc: Calc,
    /// Le formule che leggono celle scelte mentre calcolano (`INDIRECT`,
    /// `OFFSET`): possono dipendere da qualunque cella.
    dynamic: Vec<Key>,
}

/// Le formule non aggiornate.
#[derive(Clone, Default, PartialEq)]
enum Stale {
    #[default]
    None,
    Cells {
        keys: HashSet<Key>,
        /// Le aree versate dalle formule non aggiornate.
        areas: Vec<(usize, RangeRef)>,
    },
    All,
}

impl Stale {
    fn has(&self, sheet: usize, cell: CellRef) -> bool {
        match self {
            Stale::None => false,
            Stale::All => true,
            Stale::Cells { keys, areas } => {
                keys.contains(&(sheet, cell))
                    || areas
                        .iter()
                        .any(|(at, range)| *at == sheet && range.contains(cell))
            }
        }
    }
}

struct Instance {
    bytes: Vec<u8>,
    source: Revision,
    /// La cartella del file: l'innesto e i blocchi la leggono.
    workbook: Workbook,
    files: Vec<FileSheet>,
    sheets: Vec<SheetInfo>,
    ids: HashMap<String, usize>,
    /// I fogli come il file li dà, per tornare a un giornale di celle.
    base_sheets: Vec<SheetInfo>,
    /// Le celle si modificano: il pacchetto e il modello si corrispondono.
    editable: bool,
    notices: Vec<GridNotice>,
    /// Le formule su un riferimento circolare, salvate con `0`: la griglia le
    /// mostra con `#CIRC!` finché formula e valore restano quelli del file.
    circular: HashMap<Key, String>,
    journal: GridJournal,
    entries: BTreeMap<GridCellKey, Entry>,
    deps: Option<Deps>,
    /// Le formule senza valore salvato nel file.
    uncached: Vec<Key>,
    /// I valori che il motore dà alle formule senza valore salvato, quando
    /// il giornale è vuoto: la facciata parte dalla cartella con questi.
    base_values: HashMap<Key, GcValue>,
    /// Le formule non aggiornate quando il giornale è vuoto.
    base_stale: Stale,
    /// Le formule non aggiornate, nella modalità a celle.
    stale: Stale,
    /// I valori ricalcolati delle formule, nella modalità a celle.
    fresh: HashMap<Key, GcValue>,
    revision: Revision,
    /// Il giornale è di comandi: le finestre mostrano la cartella della
    /// facciata.
    commanding: bool,
    /// La facciata: dal primo catalogo o dal primo comando.
    facade: Option<Facade>,
    /// La riscrittura della cartella, misurata alla prima domanda.
    rewrite: Rewrite,
    /// La cronologia del documento ([`crate::cronologia`]).
    line: Linea,
    /// La presa sul motore dei fogli: conta l'istanza fra quelle aperte.
    /// Data dopo che l'istanza è nata: un'apertura fallita non conta.
    presa: Option<Presa>,
}

/// Il provider della griglia per le cartelle di Excel.
///
/// Il motore dei fogli ([`crate::motore`]) nasce alla prima apertura, non con
/// il provider; ogni istanza aperta lo tiene, e quando si chiude l'ultima le
/// sue cache si svuotano.
pub struct XlsxGridProvider {
    next_instance: u64,
    instances: HashMap<String, Instance>,
    fogli: Arc<Fogli>,
    /// Le cronologie pubblicate, per la sessione che si riapre dopo un
    /// salvataggio.
    archivio: Archivio,
}

impl Default for XlsxGridProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl XlsxGridProvider {
    /// Il provider sul motore dei fogli del processo. Il primo provider del
    /// processo iscrive il motore nel registro; nessuno lo costruisce.
    pub fn new() -> Self {
        Self::con_fogli(Fogli::processo())
    }

    /// Il provider su un motore dei fogli dato: per le prove, con servizi e
    /// budget loro.
    #[doc(hidden)]
    pub fn con_fogli(fogli: Arc<Fogli>) -> Self {
        Self {
            next_instance: 0,
            instances: HashMap::new(),
            fogli,
            archivio: Archivio::default(),
        }
    }

    fn instance(&mut self, instance: &str) -> Result<&mut Instance, PluginError> {
        instance_in(&mut self.instances, instance)
    }

    /// Pubblica la cronologia dell'istanza `id` se la sua revisione non è
    /// più `before`.
    fn publish(&mut self, id: &str, before: &Revision) {
        if let Some(instance) = self.instances.get(id) {
            if instance.revision != *before {
                self.archivio
                    .publish(instance.revision.clone(), instance.line.clone());
            }
        }
    }

    fn new_instance_id(&mut self) -> String {
        loop {
            self.next_instance = self.next_instance.wrapping_add(1);
            let instance = format!("xlsx-{}", self.next_instance);
            if !self.instances.contains_key(&instance) {
                return instance;
            }
        }
    }
}

impl GridBytesProvider for XlsxGridProvider {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        vec![GridSurfaceSpec::bytes(XLSX_GRID_SURFACE, FORMAT_ID)]
    }

    fn open(
        &mut self,
        surface: &str,
        source: &[u8],
        revision: Revision,
        journal: &GridJournal,
    ) -> Result<GridBytesSession, PluginError> {
        if surface != XLSX_GRID_SURFACE {
            return Err(PluginError::NotFound(
                format!("grid surface `{surface}`").into(),
            ));
        }
        if source.len() > MAX_GRID_BYTES_SOURCE {
            return Err(bad("grid source exceeds byte limit"));
        }
        if Revision::of_bytes(source) != revision {
            return Err(PluginError::Conflict(
                "grid source does not match its declared revision".into(),
            ));
        }
        journal.validate()?;
        // La prima apertura costruisce il motore.
        let motore = self
            .fogli
            .motore()
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        let read = crate::read(source).map_err(xlsx_error)?;
        let mut instance = Instance::new(source.to_vec(), revision.clone(), read)?;
        let (archivio, instances) = (&self.archivio, &self.instances);
        instance.set_journal_from(journal.clone(), &|id| {
            instances
                .values()
                .find_map(|open| open.line.find(id))
                .or_else(|| archivio.find(id))
        })?;
        // La cronologia di chi ha scritto questi byte, o questo giornale.
        instance.line = self
            .archivio
            .line_for(&instance.revision, &revision, journal.is_empty())
            .unwrap_or_else(|| Linea::new(journal.to_text()));
        let id = self.new_instance_id();
        let summary = instance.summary(&id)?;
        instance.presa = Some(self.fogli.prendi(motore));
        self.instances.insert(id, instance);
        Ok(summary)
    }

    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridBytesWindow, PluginError> {
        request.validate()?;
        let window = self.instance(instance)?.window(&request)?;
        window.validate()?;
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let before = self.instance(instance)?.revision.clone();
        let commit = self.instance(instance)?.apply(&request);
        self.publish(instance, &before);
        let commit = commit?;
        commit.validate()?;
        Ok(commit)
    }

    fn commands(
        &mut self,
        instance: &str,
        selection: GridSelection,
    ) -> Result<Vec<GridCommandState>, PluginError> {
        selection.validate()?;
        let instance = self.instance(instance)?;
        // Il catalogo spegne ciò che la riscrittura perderebbe: la misura si
        // fa alla prima domanda, non all'apertura.
        instance.measured();
        Ok(instance.catalog(&selection))
    }

    fn command(
        &mut self,
        instance: &str,
        request: GridCommandRequest,
    ) -> Result<GridCommandOutcome, PluginError> {
        request.validate()?;
        let id = instance;
        let instance = self.instance(id)?;
        let before = instance.revision.clone();
        let outcome = instance.command(&request);
        // Anche un comando fallito può aver usato le cache.
        if let Some(presa) = &instance.presa {
            presa.motore().dopo_il_comando(&request.command.id);
        }
        self.publish(id, &before);
        let outcome = outcome?;
        outcome.validate()?;
        Ok(outcome)
    }

    fn bytes_to_write(
        &mut self,
        instance: &str,
        expected: Revision,
    ) -> Result<Vec<u8>, PluginError> {
        let instance = instance_in(&mut self.instances, instance)?;
        let bytes = instance.bytes_to_write(&expected)?;
        // La sessione che si aprirà sui byte nuovi ritrova la cronologia.
        if bytes != instance.bytes {
            self.archivio
                .saved(Revision::of_bytes(&bytes), instance.revision.clone());
        }
        Ok(bytes)
    }

    /// Chiude l'istanza. Se era l'ultima aperta sul motore dei fogli, la sua
    /// presa svuota le cache e rende la memoria al sistema; in ogni caso il
    /// budget rispetta il tetto. Il provider non ha lucchetti suoi: l'istanza
    /// esce dall'elenco prima, e le cache si chiamano dopo.
    fn close(&mut self, instance: &str) -> Result<(), PluginError> {
        let closed = self
            .instances
            .remove(instance)
            .ok_or_else(|| PluginError::NotFound(format!("grid instance `{instance}`").into()))?;
        drop(closed);
        self.fogli.chiusa();
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        let closed = std::mem::take(&mut self.instances);
        let any = !closed.is_empty();
        drop(closed);
        if any {
            self.fogli.chiusa();
        }
        Ok(())
    }
}

fn instance_in<'a>(
    instances: &'a mut HashMap<String, Instance>,
    instance: &str,
) -> Result<&'a mut Instance, PluginError> {
    instances
        .get_mut(instance)
        .ok_or_else(|| PluginError::NotFound(format!("grid instance `{instance}`").into()))
}

/// Gli indici dei fogli per id.
fn ids_of(sheets: &[SheetInfo]) -> HashMap<String, usize> {
    sheets
        .iter()
        .enumerate()
        .map(|(index, sheet)| (sheet.id.clone(), index))
        .collect()
}

impl Instance {
    fn new(bytes: Vec<u8>, source: Revision, read: crate::Read) -> Result<Instance, PluginError> {
        let crate::Read { workbook, report } = read;
        let parts = Package::open(&bytes).ok().and_then(|mut package| {
            let workbook = package.workbook_part().ok()?;
            package.worksheets(&workbook).ok()
        });
        let parts = parts.filter(|parts| {
            let ids: HashSet<u32> = parts.iter().map(|sheet| sheet.sheet_id).collect();
            parts.len() == workbook.sheets.len() && ids.len() == parts.len() && !ids.contains(&0)
        });
        let editable = parts.is_some();
        let mut sheets = Vec::with_capacity(workbook.sheets.len());
        let mut files = Vec::with_capacity(workbook.sheets.len());
        for (index, sheet) in workbook.sheets.iter().enumerate() {
            let (id, part) = match &parts {
                Some(parts) => (
                    format!("s{}", parts[index].sheet_id),
                    Some(parts[index].part.clone()),
                ),
                None => (format!("x{index}"), None),
            };
            let (rows, columns) = extent(&workbook, sheet);
            sheets.push(SheetInfo {
                id,
                rows,
                columns,
                counted: None,
            });
            files.push(FileSheet { part, shape: None });
        }
        let ids = ids_of(&sheets);
        // Un errore nella ricerca lascia la cartella com'era: niente avviso.
        let circular =
            guarded(|| Ok(crate::circular::circular_formulas(&workbook))).unwrap_or_default();
        let mut notices = notices(&workbook, &report);
        let uncached = ricalcolo::senza_valore(&workbook);
        if !circular.is_empty() {
            notices.push(GridNotice {
                code: "circular".into(),
                count: u32::try_from(circular.len()).unwrap_or(u32::MAX),
            });
        }
        let revision = grid_bytes_revision(&source, "");
        let mut instance = Instance {
            bytes,
            source,
            workbook,
            files,
            base_sheets: sheets.clone(),
            sheets,
            ids,
            editable,
            notices,
            circular,
            journal: GridJournal::new(),
            entries: BTreeMap::new(),
            deps: None,
            uncached,
            base_values: HashMap::new(),
            base_stale: Stale::None,
            stale: Stale::None,
            fresh: HashMap::new(),
            revision,
            commanding: false,
            facade: None,
            rewrite: Rewrite::Unknown,
            line: Linea::new(String::new()),
            presa: None,
        };
        instance.calculate_base();
        Ok(instance)
    }

    /// Calcola le formule che il file ha salvato senza valore, e dice
    /// nell'avviso quante restano vuote. Un calcolo che non riesce lascia le
    /// celle vuote, come le dà il file: la cartella si apre lo stesso.
    fn calculate_base(&mut self) {
        if self.uncached.is_empty() {
            return;
        }
        if self.deps.is_none() {
            match deps(&self.workbook) {
                Ok(deps) => self.deps = Some(deps),
                Err(error) => {
                    tracing::warn!(%error, "xlsx: formule senza valore non calcolate");
                    return;
                }
            }
        }
        match self.recalculate(&BTreeMap::new()) {
            Ok((stale, fresh)) => {
                self.base_stale = stale;
                self.base_values = fresh;
            }
            Err(error) => {
                tracing::warn!(%error, "xlsx: formule senza valore non calcolate");
                return;
            }
        }
        let computed = self
            .uncached
            .iter()
            .filter(|key| self.base_values.contains_key(key))
            .count();
        let computed = u32::try_from(computed).unwrap_or(u32::MAX);
        for notice in &mut self.notices {
            if notice.code == "uncomputed" {
                notice.count = notice.count.saturating_sub(computed);
            }
        }
        self.notices
            .retain(|notice| notice.code != "uncomputed" || notice.count > 0);
    }

    /// Le formule toccate dalle voci `entries` del giornale e quelle senza
    /// valore salvato, ricalcolate: quelle che restano non aggiornate, e i
    /// valori delle altre. Le dipendenze sono già lette.
    fn recalculate(
        &mut self,
        entries: &BTreeMap<GridCellKey, Entry>,
    ) -> Result<(Stale, HashMap<Key, GcValue>), XlsxError> {
        let cambi: Vec<(Key, GcValue)> = entries
            .values()
            .filter(|entry| entry.state != GridJournalMatch::Applied)
            .filter_map(|entry| entry.place.map(|place| (place, new_value(&entry.value))))
            .collect();
        self.recalculate_with(&cambi)
    }

    /// [`Instance::recalculate`] con le celle `cambi` e i loro valori.
    fn recalculate_with(
        &mut self,
        cambi: &[(Key, GcValue)],
    ) -> Result<(Stale, HashMap<Key, GcValue>), XlsxError> {
        let Some(deps) = self.deps.as_ref() else {
            return Ok((Stale::None, HashMap::new()));
        };
        let edited: HashSet<Key> = cambi.iter().map(|(key, _)| *key).collect();
        let touched = stale(&self.workbook, deps, &edited, &self.uncached);
        let Stale::Cells { keys, areas } = touched else {
            return Ok((touched, HashMap::new()));
        };
        // Le formule il cui valore salvato l'innesto non riscrive. Una
        // cartella che non si modifica non salva niente: si mostra soltanto.
        let mut blocked = HashSet::new();
        if self.editable {
            for &(sheet, cell) in &keys {
                if self.holds_value(sheet, cell) {
                    blocked.insert((sheet, cell));
                }
            }
        }
        let deps = self.deps.as_ref().expect("read above");
        let Ricalcolo { valori, vecchie } = ricalcolo::ricalcola(
            &self.workbook,
            &deps.calc,
            &deps.dynamic,
            cambi,
            &self.uncached,
            &keys,
            &blocked,
        )?;
        let stale = if vecchie.is_empty() && areas.is_empty() {
            Stale::None
        } else {
            Stale::Cells {
                keys: vecchie,
                areas,
            }
        };
        Ok((stale, valori))
    }

    /// Se il valore salvato della cella non si riscrive: un blocco che lo
    /// tiene, o un foglio che l'innesto non tratta.
    fn holds_value(&mut self, sheet: usize, cell: CellRef) -> bool {
        self.shape(sheet);
        match self.files[sheet].shape.as_ref().expect("read above") {
            Shape::Unsupported => true,
            Shape::Locks(locks) => locks
                .at(&self.workbook.sheets[sheet], cell)
                .is_some_and(|lock| lock.holds_value()),
        }
    }

    /// Le formule tornano quelle del file: nessuna non aggiornata, nessun
    /// valore ricalcolato oltre a quelli delle formule senza valore.
    fn reset_calculation(&mut self) {
        self.stale = self.base_stale.clone();
        self.fresh = self.base_values.clone();
    }

    /// La cartella da cui parte la facciata: quella del file, con i valori
    /// calcolati delle formule che il file ha salvato senza valore.
    fn facade_base(&self) -> Workbook {
        let mut base = self.workbook.clone();
        for (&(sheet, cell), value) in &self.base_values {
            if let Some(stored) = base
                .sheet_mut(sheet)
                .and_then(|model| model.cells.get_mut(cell))
            {
                stored.value = value.clone();
            }
        }
        base
    }

    /// La cartella che la griglia mostra: quella del file, o quella della
    /// facciata in modalità a comandi.
    fn shown(&self) -> &Workbook {
        match (&self.facade, self.commanding) {
            (Some(facade), true) => facade.workbook(),
            _ => &self.workbook,
        }
    }

    fn facade(&mut self) -> &mut Facade {
        if self.facade.is_none() {
            self.facade = Some(Facade::new(&self.facade_base()));
        }
        self.facade.as_mut().expect("made above")
    }

    /// La riscrittura misurata.
    fn measured(&mut self) -> &Rewrite {
        if self.rewrite == Rewrite::Unknown {
            self.rewrite = commands::measure(&self.bytes, &self.workbook);
        }
        &self.rewrite
    }

    /// Il perché la cartella non prende comandi: i suoi fogli non hanno id
    /// stabili.
    fn blocked(&self) -> Option<&'static str> {
        (!self.editable).then_some("the workbook's sheets have no unique ids")
    }

    /// Il catalogo sulla selezione `at`.
    fn catalog(&mut self, at: &GridSelection) -> Vec<GridCommandState> {
        let blocked = self.blocked();
        let edits = blocked.map(str::to_owned).or_else(|| match &self.rewrite {
            Rewrite::Loses(why) => Some(why.clone()),
            _ => None,
        });
        let cursor = self.line.cursor();
        let undo = cursor.checked_sub(1).is_some_and(|to| self.can_travel(to));
        let redo = cursor + 1 < self.line.len() && self.can_travel(cursor + 1);
        let mut catalog = self
            .facade()
            .catalog(at, edits.as_deref(), blocked, undo, redo);
        // Senza id stabili dei fogli la facciata non si apre affatto.
        if let Some(why) = blocked {
            for command in &mut catalog {
                command.enabled = false;
                command.reason = Some(why.to_owned());
            }
        }
        catalog
    }

    /// La selezione della facciata, come la griglia la nomina.
    fn selection(&self) -> GridSelection {
        let shown = self.shown();
        let sheet = shown.active_sheet.min(self.sheets.len().saturating_sub(1));
        let (selection, active) = match (&self.facade, self.commanding) {
            (Some(facade), true) => (facade.selection().a1(), facade.selection().active.a1()),
            _ => ("A1".to_owned(), "A1".to_owned()),
        };
        // Una selezione di troppe aree non entra nel contratto: resta la
        // cella attiva.
        let selection = if selection.len() > MAX_GRID_SELECTION_BYTES {
            active.clone()
        } else {
            selection
        };
        GridSelection {
            sheet: self.sheets[sheet].id.clone(),
            selection,
            active,
        }
    }

    /// I fogli della cartella mostrata, contati di nuovo dove sono cambiati.
    fn count_sheets(&mut self) {
        let Some(facade) = self.facade.as_ref().filter(|_| self.commanding) else {
            return;
        };
        let shown = facade.workbook().clone();
        let mut old: HashMap<String, SheetInfo> = std::mem::take(&mut self.sheets)
            .into_iter()
            .map(|info| (info.id.clone(), info))
            .collect();
        self.sheets = shown
            .sheets
            .iter()
            .map(|sheet| {
                let id = format!("s{}", sheet.file_id);
                match old.remove(&id) {
                    Some(info)
                        if info
                            .counted
                            .as_ref()
                            .is_some_and(|counted| Arc::ptr_eq(counted, sheet)) =>
                    {
                        info
                    }
                    previous => {
                        let (rows, columns) = extent(&shown, sheet);
                        let (rows, columns) = previous.map_or((rows, columns), |info| {
                            (rows.max(info.rows), columns.max(info.columns))
                        });
                        SheetInfo {
                            id,
                            rows,
                            columns,
                            counted: Some(sheet.clone()),
                        }
                    }
                }
            })
            .collect();
        self.ids = ids_of(&self.sheets);
    }

    /// Rimette ai fogli le righe e le colonne di `before`. Il `GridCommit` di
    /// `apply` non porta i fogli, e la shell controlla ogni finestra sulla
    /// misura che conosce: una formula scritta sotto l'ultima riga usata, che
    /// in modalità a comandi farebbe crescere il margine, rendeva illeggibili
    /// le finestre (IMP-142). La misura cresce al primo comando dopo, che
    /// porta i fogli, o alla riapertura. `counted` resta quello di prima, così
    /// quel conteggio non salta il foglio cambiato.
    fn keep_counts(&mut self, before: Vec<SheetInfo>) {
        let mut before: HashMap<String, SheetInfo> = before
            .into_iter()
            .map(|info| (info.id.clone(), info))
            .collect();
        for info in &mut self.sheets {
            if let Some(old) = before.remove(&info.id) {
                *info = old;
            }
        }
    }

    /// L'indice nel file del foglio `id`.
    fn file_index(&self, id: &str) -> Option<usize> {
        if !self.editable {
            return self.ids.get(id).copied().filter(|_| !self.commanding);
        }
        self.workbook
            .sheets
            .iter()
            .position(|sheet| id.strip_prefix('s') == Some(sheet.file_id.to_string().as_str()))
    }

    /// Il foglio del file i cui blocchi valgono per il foglio mostrato
    /// `sheet`: in modalità a comandi soltanto quando il salvataggio sarà un
    /// innesto per forza.
    fn locks_of(&self, sheet: usize) -> Option<usize> {
        if !self.commanding {
            return Some(sheet);
        }
        match self.rewrite {
            Rewrite::Loses(_) => self.file_index(&self.sheets[sheet].id),
            _ => None,
        }
    }

    /// I fogli mostrati e quelli nascosti.
    fn sheet_list(&self) -> (Vec<GridSheet>, Vec<String>) {
        let shown = self.shown();
        let sheets = self
            .sheets
            .iter()
            .zip(&shown.sheets)
            .map(|(info, sheet)| GridSheet {
                id: info.id.clone(),
                name: sheet.name.clone(),
                row_count: info.rows,
                column_count: info.columns,
            })
            .collect();
        let hidden = self
            .sheets
            .iter()
            .zip(&shown.sheets)
            .filter(|(_, sheet)| sheet.visibility != Visibility::Visible)
            .map(|(info, _)| info.id.clone())
            .collect();
        (sheets, hidden)
    }

    fn summary(&mut self, instance: &str) -> Result<GridBytesSession, PluginError> {
        let (sheets, hidden) = self.sheet_list();
        let active = self.sheets[self
            .shown()
            .active_sheet
            .min(self.sheets.len().saturating_sub(1))]
        .id
        .clone();
        let commands = self.catalog(&GridSelection {
            sheet: active.clone(),
            selection: "A1".into(),
            active: "A1".into(),
        });
        let summary = GridBytesSession {
            instance: instance.to_owned(),
            revision: self.revision.clone(),
            sheets,
            active,
            hidden,
            notices: self.notices.clone(),
            conflicts: self
                .entries
                .iter()
                .filter(|(_, entry)| entry.state == GridJournalMatch::Conflict)
                .map(|(key, _)| key.clone())
                .collect(),
            commands,
            book: self.book(),
        };
        summary.validate()?;
        Ok(summary)
    }

    /// Ciò che vale per la cartella mostrata: il tema, i nomi che una formula
    /// può usare, il calcolo e la struttura protetta.
    fn book(&self) -> GridBook {
        let shown = self.shown();
        let normal = &shown.styles.get(StyleId::DEFAULT).font;
        let names: BTreeSet<&str> = shown
            .names
            .iter()
            .filter(|name| !name.hidden && !name.name.starts_with("_xlnm."))
            .map(|name| name.name.as_str())
            .filter(|name| !name.is_empty() && name.len() <= MAX_GRID_NAME_BYTES)
            .collect();
        GridBook {
            theme_colors: shown
                .theme
                .colors
                .iter()
                .map(|color| format!("#{:06X}", color & 0x00FF_FFFF))
                .collect(),
            names: names
                .into_iter()
                .take(MAX_GRID_BOOK_NAMES)
                .map(str::to_owned)
                .collect(),
            calculation: match shown.calc.mode {
                CalcMode::Automatic => GridCalculation::Automatic,
                CalcMode::AutomaticExceptTables => GridCalculation::AutomaticExceptTables,
                CalcMode::Manual => GridCalculation::Manual,
            },
            protected: shown.protected_structure,
            font: book_font(&normal.name),
            font_size: if normal.size.is_finite() && normal.size > 0.0 {
                normal.size.min(409.0)
            } else {
                GridBook::default().font_size
            },
        }
    }

    /// Il foglio e la cella di una chiave.
    fn place(&self, key: &GridCellKey) -> Option<(usize, CellRef)> {
        let sheet = *self.ids.get(&key.sheet)?;
        let row = index(&key.row, 'r', MAX_GRID_SESSION_ROWS)?;
        let column = index(&key.column, 'c', MAX_GRID_SESSION_COLUMNS)?;
        Some((sheet, CellRef::new(row, column)))
    }

    fn key(&self, sheet: usize, cell: CellRef) -> GridCellKey {
        GridCellKey {
            sheet: self.sheets[sheet].id.clone(),
            row: format!("r{}", cell.row),
            column: format!("c{}", cell.col),
        }
    }

    /// L'input che la cella ha nel file, o nella cartella della facciata in
    /// modalità a comandi.
    fn disk_input(&self, sheet: usize, cell: CellRef) -> String {
        let Some(stored) = self.shown().sheets[sheet].cell(cell) else {
            return String::new();
        };
        if stored.formula.is_some() {
            return stored.bar_text();
        }
        input::constant(&stored.value)
            .map(|value| input::input_of(&value))
            .unwrap_or_default()
    }

    /// Il giornale nuovo, con le voci lette contro il file e le formule non
    /// aggiornate.
    fn set_journal(&mut self, journal: GridJournal) -> Result<(), PluginError> {
        self.set_journal_from(journal, &|_| None)
    }

    /// [`Instance::set_journal`], con gli stati che [`RESTORE`] può chiamare.
    fn set_journal_from(
        &mut self,
        journal: GridJournal,
        find: &dyn Fn(&str) -> Option<Arc<Stato>>,
    ) -> Result<(), PluginError> {
        if !journal.commands().is_empty() {
            return self.replay(journal, find);
        }
        let mut entries = BTreeMap::new();
        for (key, before, after) in journal.entries() {
            let value = input::parse(after).map_err(|error| match error {
                InputError::Formula => bad("grid journal writes a formula"),
                InputError::TooLong => bad("grid journal text is too long"),
            })?;
            let place = self.place(key);
            let state = match place {
                Some((sheet, cell)) => {
                    grid_journal_match(before, after, &self.disk_input(sheet, cell))
                }
                None => GridJournalMatch::Conflict,
            };
            entries.insert(
                key.clone(),
                Entry {
                    place,
                    state,
                    value,
                },
            );
        }
        for entry in entries.values() {
            if let Some((sheet, cell)) = entry.place {
                let info = &mut self.sheets[sheet];
                info.rows = info.rows.max((cell.row + 1).min(MAX_GRID_SESSION_ROWS));
                info.columns = info
                    .columns
                    .max((cell.col + 1).min(MAX_GRID_SESSION_COLUMNS));
            }
        }
        let changed = entries
            .values()
            .any(|entry| entry.place.is_some() && entry.state != GridJournalMatch::Applied);
        if changed {
            if self.deps.is_none() {
                self.deps = Some(deps(&self.workbook).map_err(xlsx_error)?);
            }
            let (stale, fresh) = self.recalculate(&entries).map_err(xlsx_error)?;
            self.stale = stale;
            self.fresh = fresh;
        } else {
            self.reset_calculation();
        }
        self.revision = grid_bytes_revision(&self.source, &journal.to_text());
        self.journal = journal;
        self.entries = entries;
        Ok(())
    }

    /// Il giornale di comandi `journal`, rifatto sulla cartella del file. Un
    /// [`RESTORE`] in testa parte dallo stato che chiama.
    fn replay(
        &mut self,
        journal: GridJournal,
        find: &dyn Fn(&str) -> Option<Arc<Stato>>,
    ) -> Result<(), PluginError> {
        let mut facade = Facade::new(&self.facade_base());
        let mut rest = journal.commands();
        if let Some(first) = rest.first().filter(|command| command.id == RESTORE) {
            let stato = cronologia::restore_target(first)
                .and_then(|id| find(&id))
                .ok_or_else(cronologia::lost_state)?;
            facade.adopt(&stato.snapshot);
            rest = &rest[1..];
        }
        if rest.iter().any(|command| command.id == RESTORE) {
            return Err(PluginError::Conflict(
                format!("grid journal command `{RESTORE}` applies only first").into(),
            ));
        }
        facade.replay(rest)?;
        self.facade = Some(facade);
        self.commanding = true;
        self.entries.clear();
        self.reset_calculation();
        self.revision = grid_bytes_revision(&self.source, &journal.to_text());
        self.journal = journal;
        self.count_sheets();
        Ok(())
    }

    /// I blocchi di un foglio del file.
    fn shape(&mut self, sheet: usize) -> &Shape {
        if self.files[sheet].shape.is_none() {
            let shape = self.read_shape(sheet).unwrap_or(Shape::Unsupported);
            self.files[sheet].shape = Some(shape);
        }
        self.files[sheet].shape.as_ref().expect("set above")
    }

    fn read_shape(&self, sheet: usize) -> Option<Shape> {
        let part = self.files[sheet].part.as_ref()?;
        let xml = Package::open(&self.bytes).ok()?.read(part).ok()??;
        let layout = sheet_xml::scan(&xml, &BTreeSet::new()).ok()?;
        if !layout.facts.ordered {
            return Some(Shape::Unsupported);
        }
        Some(Shape::Locks(Box::new(SheetLocks::new(
            &self.workbook.sheets[sheet],
            &layout.facts,
            &self.workbook.styles,
        ))))
    }

    /// Il codice di blocco di una cella di un foglio del file.
    fn lock(&mut self, sheet: usize, cell: CellRef) -> Option<String> {
        if !self.editable {
            return Some(SHEET_SHAPE_LOCK.to_owned());
        }
        self.shape(sheet);
        match self.files[sheet].shape.as_ref().expect("read above") {
            Shape::Unsupported => Some(SHEET_SHAPE_LOCK.to_owned()),
            Shape::Locks(locks) => locks
                .at(&self.workbook.sheets[sheet], cell)
                .map(|lock| lock.code().to_owned()),
        }
    }

    fn window(&mut self, request: &GridWindowRequest) -> Result<GridBytesWindow, PluginError> {
        if request.revision != self.revision {
            return Err(stale_revision());
        }
        let sheet = *self.ids.get(&request.sheet).ok_or_else(|| {
            PluginError::NotFound(format!("grid sheet `{}`", request.sheet).into())
        })?;
        let (total_rows, total_columns) = (self.sheets[sheet].rows, self.sheets[sheet].columns);
        let row_end = request
            .row_start
            .saturating_add(request.row_count)
            .min(total_rows);
        let column_end = request
            .column_start
            .saturating_add(request.column_count)
            .min(total_columns);
        let row_start = request.row_start.min(row_end);
        let column_start = request.column_start.min(column_end);
        let range = (row_start < row_end && column_start < column_end).then(|| {
            RangeRef::new(
                CellRef::new(row_start, column_start),
                CellRef::new(row_end - 1, column_end - 1),
            )
        });
        let file = self.locks_of(sheet).filter(|_| self.editable);
        let area_locked: Vec<CellRef> = match (range, file) {
            (Some(range), Some(file)) => match self.shape(file) {
                Shape::Locks(locks) => locks.area_cells(range).collect(),
                Shape::Unsupported => Vec::new(),
            },
            _ => Vec::new(),
        };
        let shown = self.shown();
        let model = &shown.sheets[sheet];
        let rows = (row_start..row_end)
            .map(|index| {
                let line = model.rows.get(&index);
                GridRow {
                    id: format!("r{index}"),
                    index,
                    height: Some(line_size(
                        line.and_then(|line| line.size),
                        model.default_row_height,
                        20.0,
                    )),
                    hidden: line.is_some_and(|line| line.hidden),
                }
            })
            .collect();
        let columns = (column_start..column_end)
            .map(|index| {
                let line = model.cols.get(&index);
                GridColumn {
                    id: format!("c{index}"),
                    index,
                    width: Some(line_size(
                        line.and_then(|line| line.size),
                        model.default_col_width,
                        64.0,
                    )),
                    hidden: line.is_some_and(|line| line.hidden),
                }
            })
            .collect();

        let mut positions = BTreeSet::new();
        if let Some(range) = range {
            positions.extend(area_locked.iter().map(|at| (at.row, at.col)));
            positions.extend(
                model
                    .cells
                    .iter_range(range)
                    .map(|(at, _)| (at.row, at.col)),
            );
            positions.extend(
                model
                    .spill
                    .range(range.start..=range.end)
                    .map(|(at, _)| *at)
                    .filter(|at| range.contains(*at))
                    .map(|at| (at.row, at.col)),
            );
            positions.extend(
                self.entries
                    .values()
                    .filter_map(|entry| entry.place)
                    .filter(|(at, cell)| *at == sheet && range.contains(*cell))
                    .map(|(_, cell)| (cell.row, cell.col)),
            );
        }
        let mut cache = CfCache::new();
        let mut decorated = Vec::new();
        if let Some(range) = range {
            positions.extend(
                model
                    .comments
                    .keys()
                    .chain(model.hyperlinks.keys())
                    .filter(|at| range.contains(**at))
                    .map(|at| (at.row, at.col)),
            );
            // Una cella vuota in una tabella o sotto una formattazione
            // condizionale si vede soltanto se il suo aspetto dà qualcosa.
            let areas = model
                .tables
                .iter()
                .map(|table| table.range)
                .chain(
                    model
                        .cond_formats
                        .iter()
                        .flat_map(|cf| cf.ranges.iter().copied()),
                )
                .filter_map(|area| area.intersection(&range));
            let mut seen = HashSet::new();
            for area in areas {
                for at in area.iter() {
                    if !positions.contains(&(at.row, at.col)) && seen.insert((at.row, at.col)) {
                        let look = display::look(shown, sheet, model, at, &mut cache);
                        if display::visible(&look) {
                            decorated.push((at.row, at.col));
                        }
                    }
                }
            }
        }
        positions.extend(decorated);
        let merges = range.map_or_else(Vec::new, |range| {
            model
                .merges
                .iter()
                .filter(|merge| merge.intersection(&range).is_some())
                .filter(|merge| merge.start != merge.end)
                .map(|merge| GridMerge {
                    row: merge.start.row,
                    column: merge.start.col,
                    rows: merge.end.row - merge.start.row + 1,
                    columns: merge.end.col - merge.start.col + 1,
                })
                .filter(|merge| {
                    merge.row + merge.rows <= total_rows
                        && merge.column + merge.columns <= total_columns
                })
                .collect()
        });
        let (frozen_rows, frozen_columns) = model.freeze.unwrap_or((0, 0));
        let view = GridSheetView {
            frozen_rows: frozen_rows.min(total_rows),
            frozen_columns: frozen_columns.min(total_columns),
            gridlines: model.show_gridlines,
            headings: model.show_headings,
            zoom: model.zoom.clamp(10, 400),
            right_to_left: model.right_to_left,
            mode: match model.view {
                SheetViewMode::Normal => GridViewMode::Normal,
                SheetViewMode::PageLayout => GridViewMode::PageLayout,
                SheetViewMode::PageBreakPreview => GridViewMode::PageBreakPreview,
            },
            formulas: model.show_formulas,
            protected: model.is_protected(),
            print_gridlines: model.print.gridlines,
            print_headings: model.print.headings,
        };
        let tables = range.map_or_else(Vec::new, |range| {
            model
                .tables
                .iter()
                .filter(|table| table.range.intersection(&range).is_some())
                .filter(|table| !table.name.is_empty() && table.name.len() <= MAX_GRID_NAME_BYTES)
                .map(|table| GridTable {
                    name: table.name.clone(),
                    row: table.range.start.row,
                    column: table.range.start.col,
                    rows: table.range.end.row - table.range.start.row + 1,
                    columns: table.range.end.col - table.range.start.col + 1,
                    header_row: table.header_row,
                    totals_row: table.totals_row,
                    banded_rows: table.banded_rows,
                    banded_columns: table.banded_cols,
                    first_column: table.first_col,
                    last_column: table.last_col,
                    filter_button: table.filter_button,
                    style: if table.style.len() <= MAX_GRID_NAME_BYTES {
                        table.style.clone()
                    } else {
                        String::new()
                    },
                })
                .filter(|table| {
                    table.row + table.rows <= total_rows
                        && table.column + table.columns <= total_columns
                })
                .take(MAX_GRID_WINDOW_TABLES)
                .collect()
        });
        let known: HashSet<&str> = request.known_media.iter().map(String::as_str).collect();
        let objects = range.map_or_else(Vec::new, |range| {
            objects::objects(shown, sheet, range, (total_rows, total_columns), &known)
        });
        let mut styles = Styles::default();
        let mut cells = Vec::with_capacity(positions.len());
        for (row, col) in positions {
            cells.push(self.cell(sheet, CellRef::new(row, col), &mut cache, &mut styles));
        }
        Ok(GridBytesWindow {
            revision: self.revision.clone(),
            sheet: request.sheet.clone(),
            row_start,
            column_start,
            total_rows,
            total_columns,
            rows,
            columns,
            cells,
            styles: styles.list,
            merges,
            view,
            tables,
            objects,
        })
    }

    fn cell(
        &mut self,
        sheet: usize,
        at: CellRef,
        cache: &mut CfCache,
        styles: &mut Styles,
    ) -> GridBytesCell {
        let key = self.key(sheet, at);
        let lock = self.locks_of(sheet).and_then(|file| self.lock(file, at));
        let workbook = self.shown();
        let model = &workbook.sheets[sheet];
        let entry = self
            .entries
            .get(&key)
            .filter(|entry| entry.state != GridJournalMatch::Applied);
        let (input, value) = match entry {
            Some(entry) => (
                self.journal
                    .get(&key)
                    .map(|(_, after)| after.to_owned())
                    .unwrap_or_default(),
                new_value(&entry.value),
            ),
            None => {
                // Il valore ricalcolato di una formula, nella modalità a
                // celle; altrimenti quello della cartella mostrata.
                let fresh = (!self.commanding)
                    .then(|| self.fresh.get(&(sheet, at)).cloned())
                    .flatten();
                let value = fresh.unwrap_or_else(|| {
                    let value = model.value_ref(at).cloned().unwrap_or(GcValue::Empty);
                    circular_value(&self.circular, model, sheet, at).unwrap_or(value)
                });
                (self.disk_input(sheet, at), value)
            }
        };
        let look = display::look(workbook, sheet, model, at, cache);
        let formatted = format_value(
            &value,
            &NumberFormat::parse_cached(look.style.num_fmt.as_str()),
            workbook.date_system,
        );
        let style =
            display::cell_style(workbook, &look, &value, formatted.numeric, formatted.color);
        let cf = look.cf.as_ref();
        GridBytesCell {
            key,
            input,
            style: styles.index(style),
            value: grid_value(&value),
            display: if cf.is_some_and(|cf| cf.hide_value) {
                String::new()
            } else {
                formatted.text
            },
            lock,
            stale: entry.is_none() && self.stale.has(sheet, at),
            conflict: entry.is_some_and(|entry| entry.state == GridJournalMatch::Conflict),
            data_bar: cf
                .and_then(|cf| cf.bar)
                .map(|(fraction, [r, g, b], gradient)| GridDataBar {
                    fraction: if fraction.is_finite() {
                        fraction.clamp(0.0, 1.0)
                    } else {
                        0.0
                    },
                    color: format!("#{r:02X}{g:02X}{b:02X}"),
                    gradient,
                }),
            icon: cf
                .and_then(|cf| cf.icon.as_ref())
                .map(|(set, index)| GridIcon {
                    set: set.clone(),
                    index: u32::try_from(*index).unwrap_or(u32::MAX),
                }),
            comment: model.comments.get(&at).map(|comment| GridComment {
                author: comment.author.clone(),
                text: comment.text.clone(),
                threaded: comment.threaded,
                resolved: comment.resolved,
                replies: comment
                    .replies
                    .iter()
                    .map(|(author, text)| GridCommentReply {
                        author: author.clone(),
                        text: text.clone(),
                    })
                    .collect(),
            }),
            link: model
                .hyperlinks
                .get(&at)
                .filter(|link| !link.target.is_empty())
                .map(|link| GridLink {
                    target: link.target.clone(),
                    tooltip: link.tooltip.clone(),
                    external: link.external,
                }),
        }
    }

    /// Le patch della griglia: un passo della cronologia, con le celle che
    /// hanno cambiato input.
    fn apply(&mut self, request: &GridApplyRequest) -> Result<GridCommit, PluginError> {
        if request.revision != self.revision {
            return Err(stale_revision());
        }
        let mut seen = BTreeSet::new();
        let before: Vec<(GridCellKey, String)> = request
            .patches
            .iter()
            .filter(|patch| seen.insert(&patch.cell))
            .map(|patch| (patch.cell.clone(), self.shown_input(&patch.cell)))
            .collect();
        let commit = self.write(request)?;
        let changes: Vec<Cambio> = before
            .into_iter()
            .filter_map(|(cell, before)| {
                let after = self.shown_input(&cell);
                (after != before).then_some(Cambio {
                    cell,
                    before,
                    after,
                })
            })
            .collect();
        if !changes.is_empty() {
            self.record(Passo::Celle(changes.into()), None);
        }
        Ok(commit)
    }

    /// L'input che la griglia mostra nella cella `key`.
    fn shown_input(&self, key: &GridCellKey) -> String {
        if !self.commanding {
            if let Some((_, after)) = self.journal.get(key) {
                return after.to_owned();
            }
        }
        match self.place(key) {
            Some((sheet, cell)) if sheet < self.shown().sheets.len() => {
                self.disk_input(sheet, cell)
            }
            _ => String::new(),
        }
    }

    /// Scrive le patch, senza toccare la cronologia.
    fn write(&mut self, request: &GridApplyRequest) -> Result<GridCommit, PluginError> {
        if self.commanding || self.writes_formula(request) {
            return self.apply_commands(request);
        }
        let mut journal = self.journal.clone();
        let mut changed = Vec::new();
        for patch in &request.patches {
            let (sheet, cell) = self
                .place(&patch.cell)
                .filter(|(sheet, cell)| {
                    cell.row < self.sheets[*sheet].rows && cell.col < self.sheets[*sheet].columns
                })
                .ok_or_else(|| bad("grid patch names a cell the session does not have"))?;
            if let Some(lock) = self.lock(sheet, cell) {
                return Err(PluginError::PermissionDenied(
                    format!("grid cell is locked ({lock})").into(),
                ));
            }
            let shown = match journal.get(&patch.cell) {
                Some((_, after)) => after.to_owned(),
                None => self.disk_input(sheet, cell),
            };
            if patch.before.as_ref().is_some_and(|before| *before != shown) {
                return Err(PluginError::Conflict(
                    "grid patch preimage does not match".into(),
                ));
            }
            let disk = self.disk_input(sheet, cell);
            // Tornare all'input dei byte toglie la voce, anche quando è una
            // formula, che altrimenti non si scrive: è l'annulla di chi ha
            // scritto sopra una formula.
            if patch.after == disk {
                if journal.forget(&patch.cell) {
                    changed.push(patch.cell.clone());
                }
                continue;
            }
            let value = input::parse(&patch.after).map_err(|error| match error {
                InputError::Formula => bad("formulas cannot be written to a workbook"),
                InputError::TooLong => bad("grid cell text is too long"),
            })?;
            let after = input::input_of(&value);
            if after == shown {
                continue;
            }
            journal.record(patch.cell.clone(), disk, after)?;
            changed.push(patch.cell.clone());
        }
        let before_text = self.journal.to_text();
        let before_stale = self.stale.clone();
        let before_fresh = self.fresh.clone();
        self.set_journal(journal)?;
        let after_text = self.journal.to_text();
        let invalidation = self.invalidation(changed, &before_stale, &before_fresh);
        Ok(GridCommit {
            revision: self.revision.clone(),
            edit: text_diff(&before_text, &after_text),
            invalidation,
        })
    }

    /// Le celle da rileggere: quelle cambiate, le formule che hanno cambiato
    /// stato e quelle che hanno cambiato valore ricalcolato.
    fn invalidation(
        &self,
        changed: Vec<GridCellKey>,
        before: &Stale,
        before_fresh: &HashMap<Key, GcValue>,
    ) -> GridInvalidation {
        let mut cells: BTreeSet<GridCellKey> = changed.into_iter().collect();
        let recalculated = before_fresh
            .iter()
            .filter(|(key, value)| self.fresh.get(key) != Some(value))
            .map(|(key, _)| key)
            .chain(
                self.fresh
                    .keys()
                    .filter(|key| !before_fresh.contains_key(key)),
            );
        for &(sheet, cell) in recalculated {
            cells.insert(self.key(sheet, cell));
            if cells.len() > MAX_GRID_INVALIDATED_CELLS {
                return GridInvalidation::All;
            }
        }
        match (before, &self.stale) {
            (Stale::All, _) | (_, Stale::All) => return GridInvalidation::All,
            (Stale::Cells { areas: old, .. }, Stale::Cells { areas: new, .. }) if old != new => {
                return GridInvalidation::All;
            }
            _ => {}
        }
        let keys = |stale: &Stale| match stale {
            Stale::Cells { keys, areas } if areas.is_empty() => Some(keys.clone()),
            Stale::None => Some(HashSet::new()),
            _ => None,
        };
        let (Some(old), Some(new)) = (keys(before), keys(&self.stale)) else {
            return GridInvalidation::All;
        };
        for &(sheet, cell) in old.symmetric_difference(&new) {
            cells.insert(self.key(sheet, cell));
            if cells.len() > MAX_GRID_INVALIDATED_CELLS {
                return GridInvalidation::All;
            }
        }
        GridInvalidation::Cells(cells.into_iter().collect())
    }

    fn bytes_to_write(&mut self, expected: &Revision) -> Result<Vec<u8>, PluginError> {
        if *expected != self.revision {
            return Err(stale_revision());
        }
        if self.commanding {
            return self.write_commands();
        }
        let mut edits = Vec::new();
        for (key, entry) in &self.entries {
            if entry.state == GridJournalMatch::Applied {
                continue;
            }
            let (sheet, cell) = entry.place.ok_or_else(|| {
                PluginError::Conflict(format!("grid sheet `{}` is gone", key.sheet).into())
            })?;
            edits.push(CellEdit {
                sheet,
                cell,
                value: entry.value.clone(),
            });
        }
        if edits.is_empty() {
            return Ok(self.bytes.clone());
        }
        for edit in &edits {
            if let Some(lock) = self.lock(edit.sheet, edit.cell) {
                return Err(PluginError::PermissionDenied(
                    format!("grid cell is locked ({lock})").into(),
                ));
            }
        }
        self.graft(&edits)
    }

    /// L'innesto di `edits` nei byte del file. Il file si ricalcola
    /// all'apertura quando una formula legge una cella cambiata.
    fn graft(&mut self, edits: &[CellEdit]) -> Result<Vec<u8>, PluginError> {
        if self.deps.is_none() {
            self.deps = Some(deps(&self.workbook).map_err(xlsx_error)?);
        }
        let deps = self.deps.as_ref().expect("read above");
        let recalc = !deps.dynamic.is_empty()
            || edits.iter().any(|edit| {
                let mut out = Vec::new();
                deps.calc.graph.dependents(edit.sheet, edit.cell, &mut out);
                !out.is_empty()
            });
        // I valori ricalcolati: quelli che la griglia mostra nella modalità a
        // celle; nella modalità a comandi, quelli del ricalcolo delle costanti
        // che il salvataggio innesta, con la stessa regola.
        let fresh = if self.commanding {
            let cambi: Vec<(Key, GcValue)> = edits
                .iter()
                .map(|edit| ((edit.sheet, edit.cell), new_value(&edit.value)))
                .collect();
            self.recalculate_with(&cambi).map_err(xlsx_error)?.1
        } else {
            self.fresh.clone()
        };
        let edited: HashSet<Key> = edits.iter().map(|edit| (edit.sheet, edit.cell)).collect();
        let mut formulas: Vec<FormulaValue> = fresh
            .into_iter()
            .filter(|(key, value)| {
                !edited.contains(key)
                    && self.workbook.sheets[key.0]
                        .cell(key.1)
                        .is_some_and(|cell| cell.formula.is_some() && cell.value != *value)
            })
            .map(|((sheet, cell), value)| FormulaValue { sheet, cell, value })
            .collect();
        formulas.sort_by_key(|formula| (formula.sheet, formula.cell.row, formula.cell.col));
        // Un valore calcolato da Fub si salva, e chi ha un suo motore lo rifà
        // all'apertura.
        let recalc = recalc || !formulas.is_empty();
        graft_with_values(&self.bytes, &self.workbook, edits, &formulas, recalc)
            .map(|grafted| grafted.bytes)
            .map_err(graft_error)
    }

    /// Un comando della barra, o annulla e ripeti del documento.
    fn command(&mut self, request: &GridCommandRequest) -> Result<GridCommandOutcome, PluginError> {
        if request.revision != self.revision {
            return Err(stale_revision());
        }
        let command = &request.command;
        if command.id == commands::PART {
            return self.part(command);
        }
        let before = self.journal.to_text();
        let was = self.commanding;
        let (ran, selection, prior) = self.transaction(|this| {
            let (ran, prior) = match command.id.as_str() {
                UNDO => (this.undo()?, None),
                REDO => (this.redo()?, None),
                _ => {
                    this.enter()?;
                    let prior = this.facade().snapshot();
                    (this.give(command)?, Some(prior))
                }
            };
            // Un comando che non cambia la cartella non porta la sessione
            // nella modalità a comandi.
            let keep = was || ran.changed;
            Ok(((ran, this.selection(), prior), keep))
        })?;
        let after = self.journal.to_text();
        if before != after {
            if let Some(prior) = prior {
                self.record(Passo::Comandi, Some(prior));
            }
        }
        let (sheets, hidden) = self.sheet_list();
        let commands = self.catalog(&selection);
        Ok(GridCommandOutcome {
            commit: GridCommit {
                revision: self.revision.clone(),
                edit: text_diff(&before, &after),
                invalidation: if before == after {
                    GridInvalidation::Cells(Vec::new())
                } else {
                    GridInvalidation::All
                },
            },
            sheets,
            hidden,
            selection,
            result: ran.result,
            dialog: ran.dialog,
            commands,
            book: self.book(),
        })
    }

    /// [`commands::PART`]: dove sta la parte `part` della cartella mostrata
    /// ([`crate::parts`]), o le parti che ci sono. Legge soltanto: niente
    /// facciata nuova, niente modalità a comandi, il giornale com'è.
    fn part(&mut self, command: &GridCommand) -> Result<GridCommandOutcome, PluginError> {
        let params: Json = serde_json::from_str(&command.params)
            .map_err(|_| bad("grid command parameters are not JSON"))?;
        let text = match params.get("part") {
            None | Some(Json::Null) => "",
            Some(Json::String(text)) => text.as_str(),
            Some(_) => return Err(bad(format!("{}: `part` is not text", commands::PART))),
        };
        let result = crate::parts::answer(self.shown(), text, |index| {
            self.sheets.get(index).map(|info| info.id.clone())
        });
        let journal = self.journal.to_text();
        let selection = self.selection();
        let (sheets, hidden) = self.sheet_list();
        let commands = self.catalog(&selection);
        Ok(GridCommandOutcome {
            commit: GridCommit {
                revision: self.revision.clone(),
                edit: text_diff(&journal, &journal),
                invalidation: GridInvalidation::Cells(Vec::new()),
            },
            sheets,
            hidden,
            selection,
            result: Some(result.to_string()),
            dialog: None,
            commands,
            book: self.book(),
        })
    }

    /// Fa `work`; se fallisce, o se chiede di non tenere ciò che ha fatto, la
    /// sessione torna com'era.
    fn transaction<T>(
        &mut self,
        work: impl FnOnce(&mut Self) -> Result<(T, bool), PluginError>,
    ) -> Result<T, PluginError> {
        let journal = self.journal.clone();
        let revision = self.revision.clone();
        let commanding = self.commanding;
        let sheets = self.sheets.clone();
        let ids = self.ids.clone();
        let checkpoint = self.facade().checkpoint();
        let outcome = work(self);
        if let Ok((value, true)) = outcome {
            return Ok(value);
        }
        self.facade().rollback(checkpoint);
        self.sheets = sheets;
        self.ids = ids;
        self.revision = revision;
        if commanding {
            self.journal = journal;
        } else {
            self.commanding = false;
            self.set_journal(journal)?;
        }
        outcome.map(|(value, _)| value)
    }

    /// Porta la sessione nella modalità a comandi: ogni voce del giornale di
    /// celle diventa l'input della sua cella.
    fn enter(&mut self) -> Result<(), PluginError> {
        if self.commanding {
            return Ok(());
        }
        if let Some(why) = self.blocked() {
            return Err(bad(why));
        }
        let mut converted = Vec::new();
        for (key, entry) in &self.entries {
            if entry.state == GridJournalMatch::Applied {
                continue;
            }
            let (sheet, cell) = entry.place.ok_or_else(|| {
                PluginError::Conflict(format!("grid sheet `{}` is gone", key.sheet).into())
            })?;
            let value = self.input_json(sheet, cell, &entry.value);
            converted.push(commands::input_command(&key.sheet, cell, value));
        }
        let mut journal = GridJournal::new();
        for command in &converted {
            journal.push_command(command.clone())?;
        }
        self.facade().replay(&converted)?;
        self.commanding = true;
        self.entries.clear();
        self.reset_calculation();
        self.revision = grid_bytes_revision(&self.source, &journal.to_text());
        self.journal = journal;
        self.count_sheets();
        Ok(())
    }

    /// Dà un comando nella modalità a comandi, e lo mette nel giornale se
    /// cambia la cartella.
    fn give(&mut self, command: &GridCommand) -> Result<Ran, PluginError> {
        if !commands::served(&command.id) {
            return Err(bad(format!("grid command `{}` is not served", command.id)));
        }
        match commands::input_cell(command) {
            Some((cell, value)) => self.check_input(&command.sheet, cell, &value)?,
            None if commands::edits(&command.id) => {
                if let Rewrite::Loses(why) = self.measured() {
                    return Err(loses(why.clone()));
                }
            }
            None => {}
        }
        let ran = self.facade().run(command)?;
        if ran.changed {
            self.journal.push_command(command.clone())?;
            // Un comando che cambia ciò che l'innesto non scrive (uno stile
            // nato dall'input, un ricalcolo) chiede la riscrittura: si misura
            // adesso, e non al salvataggio.
            if self.rewrite != Rewrite::Kept && self.graft_edits().is_none() {
                if let Rewrite::Loses(why) = self.measured() {
                    return Err(loses(why.clone()));
                }
            }
            self.revision = grid_bytes_revision(&self.source, &self.journal.to_text());
            self.count_sheets();
        }
        Ok(ran)
    }

    /// Un passo nuovo nella cronologia, al giornale di adesso. `prior` è lo
    /// stato di prima, in modalità a comandi.
    fn record(&mut self, passo: Passo, prior: Option<Snapshot>) {
        if let Some(prior) = prior {
            let current = self.line.current_mut();
            if current.stato.is_none() {
                current.stato = Some(Stato::new(prior));
            }
        }
        let stato = self.state_now();
        self.line
            .push(Punto::new(self.journal.to_text(), stato, Some(passo)));
    }

    /// Lo stato della cartella mostrata, in modalità a comandi.
    fn state_now(&self) -> Option<Arc<Stato>> {
        match (&self.facade, self.commanding) {
            (Some(facade), true) => Some(Stato::new(facade.snapshot())),
            _ => None,
        }
    }

    /// Se la sessione sa arrivare al punto `to`, accanto a quello di adesso.
    fn can_travel(&self, to: usize) -> bool {
        let target = self.line.point(to);
        target.journal.is_some()
            || matches!(self.line.crossing(to), Some(Passo::Celle(_)))
            || target.stato.is_some()
                && self.blocked().is_none()
                && !matches!(self.rewrite, Rewrite::Loses(_))
    }

    /// Annulla l'ultimo passo della cronologia.
    fn undo(&mut self) -> Result<Ran, PluginError> {
        let to = self
            .line
            .cursor()
            .checked_sub(1)
            .filter(|&to| self.can_travel(to))
            .ok_or_else(|| bad("nothing to undo"))?;
        self.travel(to)
    }

    /// Ripete l'ultimo passo annullato.
    fn redo(&mut self) -> Result<Ran, PluginError> {
        let to = self.line.cursor() + 1;
        if to >= self.line.len() || !self.can_travel(to) {
            return Err(bad("nothing to redo"));
        }
        self.travel(to)
    }

    /// Porta il documento al punto `to` della cronologia, accanto a quello di
    /// adesso: con il giornale del punto, se lo si sa; se no riscrivendo le
    /// celle del passo, o con [`RESTORE`] verso lo stato del punto.
    fn travel(&mut self, to: usize) -> Result<Ran, PluginError> {
        let back = to < self.line.cursor();
        let target = self.line.point(to).clone();
        let passo = self.line.crossing(to).cloned();
        match (&target.journal, passo, &target.stato) {
            (Some(journal), _, stato) => self.go(journal, stato.as_deref())?,
            (None, Some(Passo::Celle(changes)), _) => self.rewrite_cells(&changes, back)?,
            (None, _, Some(stato)) => self.restore_to(stato)?,
            (None, _, None) => return Err(bad("the state of that step is no longer in memory")),
        }
        let stato = if target.stato.is_none() {
            self.state_now()
        } else {
            None
        };
        self.line.moved(to, self.journal.to_text(), stato);
        Ok(Ran {
            changed: true,
            result: None,
            dialog: None,
        })
    }

    /// Il giornale `journal` sui byte della sessione; `stato` è la cartella
    /// che dà, se è di comandi.
    fn go(&mut self, journal: &str, stato: Option<&Stato>) -> Result<(), PluginError> {
        let journal = GridJournal::parse(journal)?;
        if journal.commands().is_empty() {
            self.commanding = false;
            self.facade = None;
            self.sheets = self.base_sheets.clone();
            self.ids = ids_of(&self.sheets);
            return self.set_journal(journal);
        }
        let Some(stato) = stato else {
            return self.replay(journal, &|_| None);
        };
        self.facade().adopt(&stato.snapshot);
        self.enter_journal(journal);
        Ok(())
    }

    /// Le celle del passo `changes` riscritte all'indietro (`back`) o in
    /// avanti.
    fn rewrite_cells(&mut self, changes: &[Cambio], back: bool) -> Result<(), PluginError> {
        let patches = changes
            .iter()
            .map(|change| {
                let (from, to) = if back {
                    (&change.after, &change.before)
                } else {
                    (&change.before, &change.after)
                };
                GridCellPatch {
                    cell: change.cell.clone(),
                    before: Some(from.clone()),
                    after: to.clone(),
                }
            })
            .collect();
        // Una cella scritta oltre la fine dei byte salvati resta della
        // sessione.
        for change in changes {
            if let Some((sheet, cell)) = self.place(&change.cell) {
                let info = &mut self.sheets[sheet];
                info.rows = info.rows.max((cell.row + 1).min(MAX_GRID_SESSION_ROWS));
                info.columns = info
                    .columns
                    .max((cell.col + 1).min(MAX_GRID_SESSION_COLUMNS));
            }
        }
        self.write(&GridApplyRequest {
            revision: self.revision.clone(),
            patches,
        })
        .map(|_| ())
    }

    /// Il giornale che porta la cartella allo stato `stato`: [`RESTORE`].
    fn restore_to(&mut self, stato: &Arc<Stato>) -> Result<(), PluginError> {
        if let Some(why) = self.blocked() {
            return Err(bad(why));
        }
        if let Rewrite::Loses(why) = self.measured() {
            return Err(loses(why.clone()));
        }
        let mut journal = GridJournal::new();
        journal.push_command(stato.command())?;
        self.facade().adopt(&stato.snapshot);
        self.enter_journal(journal);
        Ok(())
    }

    /// La modalità a comandi con il giornale `journal`, che dà la cartella
    /// della facciata.
    fn enter_journal(&mut self, journal: GridJournal) {
        self.commanding = true;
        self.entries.clear();
        self.reset_calculation();
        self.revision = grid_bytes_revision(&self.source, &journal.to_text());
        self.journal = journal;
        self.count_sheets();
    }

    /// Se una patch scrive una formula nuova: entra soltanto come comando, e
    /// la sessione passa alla modalità a comandi. Tornare alla formula dei
    /// byte resta una voce che esce dal giornale di celle.
    fn writes_formula(&self, request: &GridApplyRequest) -> bool {
        self.blocked().is_none()
            && request.patches.iter().any(|patch| {
                patch.after.starts_with('=')
                    && self
                        .place(&patch.cell)
                        .is_some_and(|(sheet, cell)| self.disk_input(sheet, cell) != patch.after)
            })
    }

    /// Le patch in modalità a comandi: ognuna è l'input della sua cella.
    fn apply_commands(&mut self, request: &GridApplyRequest) -> Result<GridCommit, PluginError> {
        let before = self.journal.to_text();
        let counted = self.sheets.clone();
        self.transaction(|this| {
            this.enter()?;
            for patch in &request.patches {
                let (sheet, cell) = this
                    .place(&patch.cell)
                    .filter(|(sheet, cell)| {
                        cell.row < this.sheets[*sheet].rows
                            && cell.col < this.sheets[*sheet].columns
                    })
                    .ok_or_else(|| bad("grid patch names a cell the session does not have"))?;
                let shown = this.disk_input(sheet, cell);
                if patch.before.as_ref().is_some_and(|before| *before != shown) {
                    return Err(PluginError::Conflict(
                        "grid patch preimage does not match".into(),
                    ));
                }
                if patch.after == shown {
                    continue;
                }
                let value = this.input_value(sheet, cell, &patch.after)?;
                this.give(&commands::input_command(&patch.cell.sheet, cell, value))?;
            }
            Ok(((), true))
        })?;
        self.keep_counts(counted);
        let after = self.journal.to_text();
        Ok(GridCommit {
            revision: self.revision.clone(),
            edit: text_diff(&before, &after),
            invalidation: if before == after {
                GridInvalidation::Cells(Vec::new())
            } else {
                GridInvalidation::All
            },
        })
    }

    /// Il valore con cui l'input `input` entra nella cella: la regola di Fub
    /// per le costanti, e una formula com'è scritta.
    fn input_value(&self, sheet: usize, cell: CellRef, input: &str) -> Result<Json, PluginError> {
        if input.starts_with('=') {
            return Ok(Json::String(input.to_owned()));
        }
        let value = input::parse(input).map_err(|error| match error {
            InputError::Formula => bad("formulas start with `=`"),
            InputError::TooLong => bad("grid cell text is too long"),
        })?;
        Ok(self.input_json(sheet, cell, &value))
    }

    /// Un valore costante come la facciata lo legge senza indovinare: un
    /// testo tiene l'apostrofo, tranne dove la cella è in formato testo e lo
    /// terrebbe come carattere.
    fn input_json(&self, sheet: usize, cell: CellRef, value: &NewValue) -> Json {
        match value {
            NewValue::Blank => Json::Null,
            NewValue::Number(number) => json!(number),
            NewValue::Bool(flag) => json!(flag),
            NewValue::Error(error) => json!(error.as_str()),
            NewValue::Text(text) => {
                let shown = self.shown();
                let style = shown.sheets[sheet].style_id(cell);
                if shown.styles.get(style).num_fmt.as_str() == "@" {
                    json!(text)
                } else {
                    json!(format!("'{text}"))
                }
            }
        }
    }

    /// L'input di una cella che soltanto l'innesto può salvare, quando la
    /// riscrittura perderebbe qualcosa: niente formule, niente celle che
    /// l'innesto non scrive.
    fn check_input(&mut self, sheet: &str, cell: CellRef, value: &Json) -> Result<(), PluginError> {
        let formula = value.as_str().is_some_and(|text| text.starts_with('='));
        let lock = match self.file_index(sheet) {
            Some(file) => self.lock(file, cell),
            None => None,
        };
        if !formula && lock.is_none() {
            return Ok(());
        }
        if let Rewrite::Loses(why) = self.measured().clone() {
            if let Some(lock) = lock {
                return Err(PluginError::PermissionDenied(
                    format!("grid cell is locked ({lock})").into(),
                ));
            }
            return Err(bad(format!(
                "formulas cannot be written to this workbook: {why}"
            )));
        }
        Ok(())
    }

    /// Gli input da innestare, quando i comandi del giornale scrivono
    /// soltanto costanti in celle e nient'altro della cartella cambia oltre
    /// ai valori calcolati.
    fn graft_edits(&self) -> Option<Vec<CellEdit>> {
        let shown = self.shown();
        let base = &self.workbook;
        if shown.sheets.len() != base.sheets.len() || !commands::same_book(shown, base) {
            return None;
        }
        let mut touched: HashMap<usize, BTreeSet<(u32, u32)>> = HashMap::new();
        for command in self.journal.commands() {
            let (cell, _) = commands::input_cell(command)?;
            let index = self.file_index(&command.sheet)?;
            touched
                .entry(index)
                .or_default()
                .insert((cell.row, cell.col));
        }
        let empty = BTreeSet::new();
        let mut edits = Vec::new();
        for (index, (now, was)) in shown.sheets.iter().zip(&base.sheets).enumerate() {
            if now.file_id != was.file_id {
                return None;
            }
            if Arc::ptr_eq(now, was) {
                continue;
            }
            if !commands::same_sheet_but_cells(now, was) {
                return None;
            }
            let cells = touched.get(&index).unwrap_or(&empty);
            for (at, cell) in now.cells.iter() {
                if cells.contains(&(at.row, at.col)) {
                    if cell.formula.is_some() || cell.style != was.style_id(at) {
                        return None;
                    }
                    continue;
                }
                let old = was.cell(at)?;
                if old.formula != cell.formula
                    || old.style != cell.style
                    || cell.formula.is_none() && (old.value != cell.value || old.rich != cell.rich)
                {
                    return None;
                }
            }
            if was
                .cells
                .iter()
                .any(|(at, _)| now.cell(at).is_none() && !cells.contains(&(at.row, at.col)))
            {
                return None;
            }
            for &(row, col) in cells {
                let at = CellRef::new(row, col);
                let value = match now.cell(at) {
                    Some(cell) => input::constant(&cell.value)?,
                    None => NewValue::Blank,
                };
                let same = match was.cell(at) {
                    Some(old) => {
                        old.formula.is_none()
                            && input::constant(&old.value).as_ref() == Some(&value)
                    }
                    None => value == NewValue::Blank,
                };
                if !same {
                    edits.push(CellEdit {
                        sheet: index,
                        cell: at,
                        value,
                    });
                }
            }
        }
        Some(edits)
    }

    /// I byte della modalità a comandi: l'innesto quando basta, altrimenti la
    /// riscrittura, se la misura non perde niente.
    fn write_commands(&mut self) -> Result<Vec<u8>, PluginError> {
        if self.journal.is_empty() {
            return Ok(self.bytes.clone());
        }
        let mut locked = None;
        if let Some(edits) = self.graft_edits() {
            if edits.is_empty() {
                return Ok(self.bytes.clone());
            }
            locked = edits
                .iter()
                .find_map(|edit| self.lock(edit.sheet, edit.cell));
            if locked.is_none() {
                return self.graft(&edits);
            }
        }
        if let Rewrite::Loses(why) = self.measured().clone() {
            return Err(match locked {
                Some(lock) => {
                    PluginError::PermissionDenied(format!("grid cell is locked ({lock})").into())
                }
                None => loses(why),
            });
        }
        let bytes = commands::write(self.shown(), &self.bytes).map_err(xlsx_error)?;
        commands::verify(&bytes).map_err(loses)?;
        Ok(bytes)
    }
}

/// `r12` → 12, entro `limit`; niente zeri in testa.
/// Il nome del carattere Normale, o quello di serie se il file non ne dà
/// uno che il contratto porta.
fn book_font(name: &str) -> String {
    if name.is_empty() || name.len() > MAX_GRID_FONT_BYTES {
        GridBook::default().font
    } else {
        name.to_owned()
    }
}

fn index(id: &str, prefix: char, limit: u32) -> Option<u32> {
    let digits = id.strip_prefix(prefix)?;
    if digits.is_empty()
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
    {
        return None;
    }
    digits.parse::<u32>().ok().filter(|&value| value < limit)
}

/// Le righe e le colonne che un foglio mostra: fin dove arriva ciò che ha, e
/// un margine per scrivere.
fn extent(workbook: &Workbook, sheet: &Sheet) -> (u32, u32) {
    let (mut rows, mut columns) = (0u32, 0u32);
    for (at, cell, value) in display::entries(sheet) {
        if display::shows(workbook, sheet, at, cell, value) {
            rows = rows.max(at.row + 1);
            columns = columns.max(at.col + 1);
        }
    }
    (
        rows.saturating_add(ROW_MARGIN)
            .clamp(MIN_ROWS, MAX_GRID_SESSION_ROWS),
        columns
            .saturating_add(COLUMN_MARGIN)
            .clamp(MIN_COLUMNS, MAX_GRID_SESSION_COLUMNS),
    )
}

fn line_size(size: Option<f32>, default: f32, fallback: f32) -> f32 {
    [size.unwrap_or(default), default, fallback]
        .into_iter()
        .find(|size| size.is_finite() && *size > 0.0)
        .unwrap_or(fallback)
}

/// Gli avvisi della cartella, in codici chiusi.
fn notices(workbook: &Workbook, report: &gridcraft_xlsx::ReadReport) -> Vec<GridNotice> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut add = |code: &str| *counts.entry(code.to_owned()).or_default() += 1;
    if workbook.vba_project.is_some() {
        add("macros");
    }
    for warning in &report.warnings {
        match display::classify(warning) {
            Warning::Macros => {}
            Warning::ExternalLinks => add("external-links"),
            Warning::Incomplete => add("incomplete"),
        }
    }
    for part in NotShown::ALL {
        if workbook.sheets.iter().any(|sheet| part.present(sheet)) {
            add(&format!("not-shown-{}", part.id().replace('_', "-")));
        }
    }
    let uncomputed = workbook
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .filter(|(_, cell)| cell.formula.is_some() && cell.value.is_empty())
        .count();
    let mut out: Vec<GridNotice> = counts
        .into_iter()
        .map(|(code, count)| GridNotice { code, count })
        .collect();
    if uncomputed > 0 {
        out.push(GridNotice {
            code: "uncomputed".into(),
            count: u32::try_from(uncomputed).unwrap_or(u32::MAX),
        });
    }
    out
}

/// `#CIRC!` per una formula che il file ha salvato con `0` su un giro di
/// riferimenti, se la cella ha ancora quella formula e quel valore: una
/// formula riscritta, o ricalcolata dal motore, mostra il suo.
fn circular_value(
    circular: &HashMap<Key, String>,
    model: &Sheet,
    sheet: usize,
    at: CellRef,
) -> Option<GcValue> {
    let text = circular.get(&(sheet, at))?;
    let cell = model.cell(at)?;
    let same = cell
        .formula
        .as_ref()
        .is_some_and(|formula| &formula.text == text)
        && matches!(cell.value, GcValue::Number(n) if n == 0.0);
    same.then_some(GcValue::Error(gridcraft_core::CellError::Circ))
}

/// Le dipendenze delle formule della cartella.
fn deps(workbook: &Workbook) -> Result<Deps, XlsxError> {
    guarded(|| {
        let mut calc = Calc::new();
        calc.rebuild(workbook);
        let mut dynamic = Vec::new();
        for (index, sheet) in workbook.sheets.iter().enumerate() {
            for (at, cell) in sheet.cells.iter() {
                if let Some(expr) = cell.formula.as_ref().and_then(|formula| formula.expr()) {
                    if gridcraft_calc::eval::precedents(workbook, index, &expr).1 {
                        dynamic.push((index, at));
                    }
                }
            }
        }
        Ok(Deps { calc, dynamic })
    })
}

/// Le formule che leggono, direttamente o attraverso altre formule, una cella
/// `edited`; e le formule `uncached`, con quelle che le leggono.
fn stale(workbook: &Workbook, deps: &Deps, edited: &HashSet<Key>, uncached: &[Key]) -> Stale {
    let mut keys: HashSet<Key> = HashSet::new();
    let mut queue: Vec<Key> = edited.iter().copied().collect();
    for &key in uncached {
        if !edited.contains(&key) && keys.insert(key) {
            queue.push(key);
        }
    }
    // Una formula che legge celle scelte mentre calcola può leggere una cella
    // cambiata. All'apertura niente è cambiato: un valore di oggi o casuale
    // resta quello del file.
    if !edited.is_empty() {
        for &key in &deps.dynamic {
            if !edited.contains(&key) && keys.insert(key) {
                queue.push(key);
            }
        }
    }
    let mut areas = Vec::new();
    let mut out = Vec::new();
    while let Some((sheet, cell)) = queue.pop() {
        out.clear();
        deps.calc.graph.dependents(sheet, cell, &mut out);
        let model = &workbook.sheets[sheet];
        let spilled = model.spill_ranges.get(&cell).copied().or_else(|| {
            model
                .cell(cell)
                .and_then(|stored| stored.formula.as_ref())
                .and_then(|formula| formula.array)
        });
        if let Some(range) = spilled.filter(|_| !edited.contains(&(sheet, cell))) {
            areas.push((sheet, range));
            deps.calc.graph.dependents_of_range(sheet, range, &mut out);
        }
        for &key in &out {
            if !edited.contains(&key) && keys.insert(key) {
                if keys.len() > MAX_STALE {
                    return Stale::All;
                }
                queue.push(key);
            }
        }
    }
    if keys.is_empty() && areas.is_empty() {
        Stale::None
    } else {
        Stale::Cells { keys, areas }
    }
}

fn new_value(value: &NewValue) -> GcValue {
    match value {
        NewValue::Blank => GcValue::Empty,
        NewValue::Number(number) => GcValue::Number(*number),
        NewValue::Text(text) => GcValue::Text(text.as_str().into()),
        NewValue::Bool(flag) => GcValue::Bool(*flag),
        NewValue::Error(error) => GcValue::Error(*error),
    }
}

fn grid_value(value: &GcValue) -> GridValue {
    match value {
        GcValue::Empty => GridValue::Blank,
        GcValue::Number(number) => GridValue::Number(*number),
        GcValue::Text(text) => GridValue::Text(text.to_string()),
        GcValue::Bool(flag) => GridValue::Boolean(*flag),
        GcValue::Error(error) => GridValue::Error(error.as_str().to_owned()),
        GcValue::Array(array) => array.data.first().map_or(GridValue::Blank, grid_value),
    }
}

/// Il diff fra due testi: il prefisso e il suffisso comuni restano, su
/// confini di carattere.
fn text_diff(before: &str, after: &str) -> GridSourceEdit {
    let mut start = before
        .bytes()
        .zip(after.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    while !before.is_char_boundary(start) || !after.is_char_boundary(start) {
        start -= 1;
    }
    let room = before.len().min(after.len()) - start;
    let mut suffix = before
        .bytes()
        .rev()
        .zip(after.bytes().rev())
        .take(room)
        .take_while(|(a, b)| a == b)
        .count();
    while !before.is_char_boundary(before.len() - suffix)
        || !after.is_char_boundary(after.len() - suffix)
    {
        suffix -= 1;
    }
    GridSourceEdit {
        from: start as u64,
        to: (before.len() - suffix) as u64,
        deleted: before[start..before.len() - suffix].to_owned(),
        inserted: after[start..after.len() - suffix].to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_diff_tiene_i_caratteri_interi() {
        let edit = text_diff("aéb", "aèb");
        assert_eq!((edit.from, edit.to), (1, 3));
        assert_eq!((edit.deleted.as_str(), edit.inserted.as_str()), ("é", "è"));
        let edit = text_diff("", "abc");
        assert_eq!((edit.from, edit.to, edit.inserted.as_str()), (0, 0, "abc"));
        let edit = text_diff("aaa", "aa");
        assert_eq!((edit.from, edit.to, edit.deleted.as_str()), (2, 3, "a"));
    }

    #[test]
    fn gli_id_hanno_una_sola_forma() {
        assert_eq!(index("r0", 'r', 10), Some(0));
        assert_eq!(index("r9", 'r', 10), Some(9));
        for wrong in ["r10", "r01", "r", "c1", "r-1", "r+1", "r1 "] {
            assert_eq!(index(wrong, 'r', 10), None, "{wrong}");
        }
    }
}
