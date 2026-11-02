//! La modalità a comandi di una sessione grid ([ADR 0219]): la facciata di
//! GridCraft sulla cartella, il sottoinsieme del suo catalogo che Fub serve,
//! la cronologia del documento e la misura della riscrittura.
//!
//! La facciata tiene una sola cartella, aperta come il file l'ha salvata
//! ([`DocState`] senza ricalcolo): il grafo delle dipendenze si costruisce al
//! primo comando, e un comando ricalcola ciò che la facciata ricalcola. Ogni
//! comando del giornale si dà sulla sua selezione; uno che non cambia la
//! cartella (una selezione, una ricerca) non entra nel giornale.
//!
//! Il `sheetId` di ogni foglio è il suo id nella sessione (`s` più il numero):
//! un foglio nuovo, o la copia di un altro, prende il primo numero che nessun
//! foglio ha avuto, e lo scrittore lo riscrive. I numeri dati restano dati
//! anche quando il foglio sparisce, finché un annulla non torna a prima, così
//! rifare il giornale dà gli stessi id.
//!
//! [ADR 0219]: ../../../docs/decisions/0219-la-cartella-si-modifica-con-i-comandi-di-gridcraft.md

use std::collections::BTreeSet;
use std::sync::Arc;

use fub_abi::{
    GridCommand, GridCommandState, GridDialog, GridSelection, PluginError,
    MAX_GRID_COMMAND_PARAMS_BYTES, MAX_GRID_COMMAND_REASON_BYTES, MAX_GRID_COMMAND_RESULT_BYTES,
};
use gridcraft_calc::recalc::Calc;
use gridcraft_core::CellRef;
use gridcraft_engine::{
    command_specs, find_command, DocState, EngineError, Selection, Session, UiRequest,
};
use gridcraft_model::{CfOperator, ErrorStyle, Sheet, Validation, ValidationKind, Workbook};
use gridcraft_xlsx::XlsxKind;
use serde_json::{json, Value as Json};

use crate::inventory::{differences, inventory};
use crate::package::Package;
use crate::{guarded, XlsxError};

/// Annulla e ripeti: del documento, non della facciata.
pub(crate) const UNDO: &str = "edit.undo";
pub(crate) const REDO: &str = "edit.redo";
/// Il comando con cui l'input di una cella entra nel giornale.
pub(crate) const SET_VALUES: &str = "range.setValues";
/// Copia, o sposta, un intervallo della cartella nella selezione in un passo
/// solo: `edit.copy` (o `edit.cut`) e `edit.pasteSpecial` della facciata,
/// senza appunti che restano. Rifatto dal giornale dà la stessa cartella, e
/// formule, formati e unioni seguono come in GridCraft.
pub(crate) const PASTE_FROM: &str = "fub.pasteFrom";
/// Il testo e la tabella HTML di un intervallo, per gli appunti di sistema:
/// legge soltanto.
pub(crate) const COPY_HTML: &str = "fub.copyHtml";
/// I comandi composti di Fub, fuori dal catalogo della facciata: id, se
/// cambia la cartella, parametri.
const COMPOSED: &[(&str, bool, &str)] = &[
    (
        PASTE_FROM,
        true,
        "{source: \"A1:B2\", sourceSheet?: \"s1\", at?: \"C3\", what?: all|formulas|values|formats|comments|validation|allExceptBorders|columnWidths|formulasAndNumberFormats|valuesAndNumberFormats, move?: bool}",
    ),
    (COPY_HTML, false, "{range?} → {range, text, html?}"),
];

/// I gruppi del catalogo che Fub non serve, ciascuno con il suo perché: file
/// e finestre sono della shell, gli script eseguono codice del documento, la
/// cronologia è del documento.
const NOT_SERVED_PREFIXES: &[(&str, &str)] = &[
    (
        "file.",
        "aprire, salvare, stampare e chiudere i file è della shell di Fub, non della cartella",
    ),
    (
        "automate.",
        "gli script eseguono codice scritto nel documento, e Fub non lo esegue",
    ),
    (
        "app.",
        "le impostazioni del programma sono della shell di Fub",
    ),
    ("window.", "le finestre sono della shell di Fub"),
    (
        "history.",
        "la cronologia delle versioni è del documento in Fub, non del motore",
    ),
];
/// I comandi che leggono o cambiano uno stato fuori dalla cartella (gli
/// appunti, il pennello, il dizionario, gli strumenti dell'interfaccia di
/// GridCraft) o che aprono un collegamento: rifare il giornale non li
/// ritroverebbe. Ciascuno con il suo perché.
const NOT_SERVED: &[(&str, &str)] = &[
    ("edit.copy", "gli appunti sono del sistema: la shell copia con fub.copyHtml"),
    ("edit.cut", "gli appunti sono del sistema: la shell taglia con fub.copyHtml e fub.pasteFrom"),
    ("edit.paste", "gli appunti sono del sistema: la shell incolla con fub.pasteFrom"),
    ("edit.pasteSpecial", "gli appunti sono del sistema: la shell incolla con fub.pasteFrom e la sua scelta di che cosa"),
    ("edit.clearClipboard", "gli appunti sono del sistema, non della cartella"),
    ("edit.formatPainter", "il pennello tiene un formato fra due clic, uno stato dell'interfaccia che il giornale non ritrova"),
    ("edit.beginEdit", "scrivere in una cella è della griglia della shell"),
    ("link.open", "aprire un collegamento esce dalla cartella: lo fa la shell"),
    ("home.addIns", "i componenti aggiuntivi del motore non esistono in Fub"),
    ("draw.pen", "la penna è uno strumento dell'interfaccia del motore"),
    ("draw.eraser", "la gomma è uno strumento dell'interfaccia del motore"),
    ("draw.lasso", "il lazo è uno strumento dell'interfaccia del motore"),
    ("review.addToDictionary", "il dizionario è della correzione di Fub, non della cartella"),
    ("review.showComments", "mostrare i commenti è della vista della shell"),
    ("review.showAllNotes", "mostrare le note è della vista della shell"),
    ("view.formulaBar", "la barra della formula è della shell"),
    ("view.ruler", "il righello è della vista della shell"),
    ("view.macros", "le macro eseguono codice scritto nel documento, e Fub non lo esegue"),
    ("view.newWindow", "le finestre sono della shell di Fub"),
    ("view.arrangeAll", "le finestre sono della shell di Fub"),
    ("view.hideWindow", "le finestre sono della shell di Fub"),
    ("view.unhideWindow", "le finestre sono della shell di Fub"),
    ("view.switchWindows", "le finestre sono della shell di Fub"),
    ("data.queriesConnections", "le query e le connessioni leggono dati fuori dalla cartella"),
];
/// I comandi dei gruppi esclusi che restano: le proprietà del documento sono
/// nella cartella, e l'anteprima di stampa e il PDF senza percorso leggono la
/// cartella com'è adesso senza cambiarla né scrivere sul disco.
const SERVED_ANYWAY: &[&str] = &["file.properties", "file.printPreview", "file.exportPdf"];
/// Gli stati di prima che si tengono: oltre, annullare rifà il giornale
/// dalla base.
const UNDO_SNAPSHOTS: usize = 100;

/// Se Fub serve il comando `id` della facciata.
pub(crate) fn served(id: &str) -> bool {
    if id == UNDO || id == REDO || COMPOSED.iter().any(|(composed, ..)| *composed == id) {
        return true;
    }
    if SERVED_ANYWAY.contains(&id) {
        return find_command(id).is_some();
    }
    why_not_served(id).is_none() && find_command(id).is_some()
}

/// Perché Fub non serve il comando `id` della facciata, se non lo serve per
/// scelta: `None` per i comandi serviti e per quelli che la facciata non ha.
pub(crate) fn why_not_served(id: &str) -> Option<&'static str> {
    if id == UNDO
        || id == REDO
        || COMPOSED.iter().any(|(composed, ..)| *composed == id)
        || SERVED_ANYWAY.contains(&id)
    {
        return None;
    }
    if let Some((_, why)) = NOT_SERVED.iter().find(|(not_served, _)| *not_served == id) {
        return Some(why);
    }
    NOT_SERVED_PREFIXES
        .iter()
        .find(|(prefix, _)| id.starts_with(prefix))
        .map(|(_, why)| *why)
}

/// Le voci dell'elenco dei non serviti, per il test che non restino voci
/// stantie: gli id esatti e i prefissi.
pub(crate) fn not_served_entries() -> (Vec<&'static str>, Vec<&'static str>) {
    (
        NOT_SERVED.iter().map(|(id, _)| *id).collect(),
        NOT_SERVED_PREFIXES
            .iter()
            .map(|(prefix, _)| *prefix)
            .collect(),
    )
}

/// Se `id` è un comando composto di Fub, fuori dal catalogo della facciata.
pub(crate) fn is_composed_command(id: &str) -> bool {
    COMPOSED.iter().any(|(composed, ..)| *composed == id)
}

/// Se il comando `id` può cambiare la cartella.
pub(crate) fn edits(id: &str) -> bool {
    if let Some((_, edits, _)) = COMPOSED.iter().find(|(composed, ..)| *composed == id) {
        return *edits;
    }
    find_command(id).is_some_and(|spec| spec.undoable)
}

/// La riscrittura della cartella con il codec, misurata sul file.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Rewrite {
    /// Non ancora misurata.
    Unknown,
    /// Il codec porta tutto ciò che il file ha.
    Kept,
    /// Il codec perderebbe qualcosa: il perché.
    Loses(String),
}

/// Il tipo del pacchetto: dice il tipo di contenuto della parte della
/// cartella.
pub(crate) fn kind_of(bytes: &[u8]) -> XlsxKind {
    let types = Package::open(bytes)
        .ok()
        .and_then(|mut package| package.read("[Content_Types].xml").ok().flatten())
        .map(|types| String::from_utf8_lossy(&types).into_owned())
        .unwrap_or_default();
    [
        XlsxKind::MacroWorkbook,
        XlsxKind::Template,
        XlsxKind::MacroTemplate,
    ]
    .into_iter()
    .find(|kind| types.contains(kind.main_content_type()))
    .unwrap_or(XlsxKind::Workbook)
}

/// Scrive la cartella con il codec.
pub(crate) fn write(workbook: &Workbook, kind: XlsxKind) -> Result<Vec<u8>, XlsxError> {
    guarded(|| {
        gridcraft_xlsx::write_xlsx_as(workbook, kind)
            .map_err(|error| XlsxError::Codec(error.to_string()))
    })
}

/// Le perdite di `after` rispetto a `before`: ciò che `before` conta più
/// volte di `after`. `None` quando un inventario non si fa.
fn losses(before: &[u8], after: &[u8]) -> Result<Vec<String>, String> {
    let before = inventory(before).map_err(|error| error.to_string())?;
    let after = inventory(after).map_err(|error| error.to_string())?;
    Ok(differences(&before, &after, |_| true)
        .into_iter()
        .filter(|difference| difference.after < difference.before)
        .map(|difference| difference.to_string())
        .collect())
}

fn loses(found: Vec<String>) -> Rewrite {
    let mut why = format!("rewriting the workbook would lose {} item(s)", found.len());
    if let Some(first) = found.first() {
        why.push_str(": ");
        why.push_str(first);
    }
    Rewrite::Loses(truncate(why, MAX_GRID_COMMAND_REASON_BYTES))
}

/// La prova a vuoto: la cartella `workbook`, letta da `bytes`, riscritta
/// senza modifiche.
pub(crate) fn measure(bytes: &[u8], workbook: &Workbook) -> Rewrite {
    let rewritten = match write(workbook, kind_of(bytes)) {
        Ok(rewritten) => rewritten,
        Err(error) => {
            return Rewrite::Loses(truncate(
                format!("the workbook cannot be rewritten: {error}"),
                MAX_GRID_COMMAND_REASON_BYTES,
            ))
        }
    };
    match losses(bytes, &rewritten) {
        Ok(found) if found.is_empty() => Rewrite::Kept,
        Ok(found) => loses(found),
        Err(error) => Rewrite::Loses(truncate(
            format!("the workbook cannot be measured: {error}"),
            MAX_GRID_COMMAND_REASON_BYTES,
        )),
    }
}

/// La misura sui byte nuovi: si rileggono, e riscriverli non perde niente.
pub(crate) fn verify(bytes: &[u8]) -> Result<(), String> {
    let read = crate::read(bytes).map_err(|error| error.to_string())?;
    let again = write(&read.workbook, kind_of(bytes)).map_err(|error| error.to_string())?;
    match losses(bytes, &again)? {
        found if found.is_empty() => Ok(()),
        found => match loses(found) {
            Rewrite::Loses(why) => Err(why),
            _ => unreachable!("loses gives a loss"),
        },
    }
}

fn truncate(mut text: String, limit: usize) -> String {
    if text.len() > limit {
        let mut end = limit;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}

fn engine_error(error: EngineError) -> PluginError {
    match error {
        EngineError::Internal(..) | EngineError::NoDocument => {
            PluginError::Internal(error.to_string().into())
        }
        _ => PluginError::BadArgs(error.to_string().into()),
    }
}

fn xlsx_error(error: XlsxError) -> PluginError {
    PluginError::Internal(error.to_string().into())
}

/// I parametri di un comando: un oggetto JSON, senza percorsi di file.
fn params_of(command: &GridCommand) -> Result<Json, PluginError> {
    let params: Json = serde_json::from_str(&command.params)
        .map_err(|_| PluginError::BadArgs("grid command parameters are not JSON".into()))?;
    let Json::Object(fields) = &params else {
        return Err(PluginError::BadArgs(
            "grid command parameters are not a JSON object".into(),
        ));
    };
    // La facciata legge e scrive file per percorso: Fub non le dà il disco.
    if fields.contains_key("path") {
        return Err(PluginError::BadArgs(
            "grid command parameters cannot name a file path".into(),
        ));
    }
    Ok(params)
}

/// Lo stato della facciata in un punto del giornale.
#[derive(Clone)]
struct Snapshot {
    workbook: Arc<Workbook>,
    selection: Selection,
    given: BTreeSet<u32>,
}

/// Ciò che un comando ha fatto.
pub(crate) struct Ran {
    /// La cartella è cambiata: il comando entra nel giornale.
    pub changed: bool,
    /// Il risultato, come testo di un oggetto JSON.
    pub result: Option<String>,
    pub dialog: Option<GridDialog>,
}

/// La facciata di una sessione.
pub(crate) struct Facade {
    session: Session,
    /// Il grafo delle dipendenze è costruito.
    ready: bool,
    /// I `sheetId` dati: quelli del file e quelli dei fogli nuovi.
    given: BTreeSet<u32>,
    /// Per ogni comando del giornale, lo stato di prima; `None` oltre
    /// [`UNDO_SNAPSHOTS`].
    undo: Vec<Option<Snapshot>>,
    /// I comandi annullati, con lo stato di dopo.
    redo: Vec<(GridCommand, Snapshot)>,
}

impl Facade {
    /// La facciata sulla cartella letta dal file, senza calcolare niente.
    pub fn new(base: &Workbook) -> Facade {
        let mut session = Session::new();
        // L'autore di una nota nuova: Fub non dà un nome dell'utente alla
        // facciata.
        session.prefs.user_name = String::new();
        let workbook = Arc::new(base.clone());
        let mut doc = DocState::from_saved(Workbook::new(), None, String::new());
        doc.selection = Selection::at(
            workbook
                .active()
                .map(|sheet| sheet.view_active)
                .unwrap_or_default(),
        );
        doc.saved = workbook.clone();
        doc.wb = workbook;
        doc.calc = Calc::new();
        // Gli script non si eseguono comunque: `automate.*` non si serve.
        doc.scripts_trusted = false;
        session.add_document(doc);
        let given = base
            .sheets
            .iter()
            .map(|sheet| sheet.file_id)
            .chain(
                base.preserved
                    .iter()
                    .flat_map(|preserved| preserved.sheets.iter().map(|sheet| sheet.sheet_id)),
            )
            .filter(|&id| id != 0)
            .collect();
        Facade {
            session,
            ready: false,
            given,
            undo: Vec::new(),
            redo: Vec::new(),
        }
    }

    fn doc(&self) -> &DocState {
        self.session.doc().expect("the facade holds one workbook")
    }

    fn doc_mut(&mut self) -> &mut DocState {
        self.session
            .doc_mut()
            .expect("the facade holds one workbook")
    }

    /// La cartella com'è adesso.
    pub fn workbook(&self) -> &Arc<Workbook> {
        &self.doc().wb
    }

    pub fn selection(&self) -> &Selection {
        &self.doc().selection
    }

    /// L'indice del foglio con l'id `id`.
    pub fn sheet_index(&self, id: &str) -> Option<usize> {
        let number: u32 = id.strip_prefix('s')?.parse().ok()?;
        if number == 0 || id != format!("s{number}") {
            return None;
        }
        self.workbook()
            .sheets
            .iter()
            .position(|sheet| sheet.file_id == number)
    }

    /// I comandi del giornale che si possono annullare e ripetere.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            workbook: self.doc().wb.clone(),
            selection: self.doc().selection.clone(),
            given: self.given.clone(),
        }
    }

    fn restore(&mut self, snapshot: Snapshot) {
        let ready = self.ready;
        let doc = self.doc_mut();
        let same = Arc::ptr_eq(&doc.wb, &snapshot.workbook);
        doc.wb = snapshot.workbook;
        doc.selection = snapshot.selection;
        if ready && !same {
            let Self { session, .. } = self;
            let doc = session.doc_mut().expect("the facade holds one workbook");
            doc.calc.rebuild(&doc.wb);
        }
        self.given = snapshot.given;
    }

    /// Porta la facciata sul foglio e sulla selezione del comando.
    fn select(&mut self, at: &GridSelection) -> Result<(), PluginError> {
        let sheet = self.sheet_index(&at.sheet).ok_or_else(|| {
            PluginError::Conflict(format!("grid sheet `{}` is gone", at.sheet).into())
        })?;
        let params = json!({
            "sheet": sheet,
            "range": at.selection,
            "active": at.active,
        });
        let outcome = self.session.execute("selection.set", params);
        self.session.journal.clear();
        outcome.map(|_| ()).map_err(engine_error)
    }

    /// Dà `command`. Un comando che non riesce lascia la facciata com'era.
    pub fn run(&mut self, command: &GridCommand) -> Result<Ran, PluginError> {
        if !served(&command.id) || command.id == UNDO || command.id == REDO {
            return Err(PluginError::BadArgs(
                format!("grid command `{}` is not served", command.id).into(),
            ));
        }
        let params = params_of(command)?;
        let previous = self.snapshot();
        let outcome = guarded(|| Ok(self.execute(command, params))).map_err(xlsx_error)?;
        let mut requests = self.session.take_ui_requests();
        let result = match outcome {
            Ok(result) => result,
            Err(error) => {
                self.restore(previous);
                return Err(error);
            }
        };
        let changed = !Arc::ptr_eq(&previous.workbook, &self.doc().wb)
            && !same_content(&previous.workbook, &self.doc().wb);
        if changed {
            self.give_sheet_ids(&previous.workbook);
            self.undo.push(Some(previous));
            let kept = self.undo.len().saturating_sub(UNDO_SNAPSHOTS);
            for old in &mut self.undo[..kept] {
                *old = None;
            }
            self.redo.clear();
        }
        self.fill_dialogs(&mut requests);
        Ok(Ran {
            changed,
            result: result_text(result, &requests),
            dialog: dialog_of(&requests),
        })
    }

    fn execute(&mut self, command: &GridCommand, params: Json) -> Result<Json, PluginError> {
        if !self.ready {
            let doc = self.doc_mut();
            doc.calc.rebuild(&doc.wb);
            self.ready = true;
        }
        self.select(&command.selection())?;
        let outcome = match command.id.as_str() {
            PASTE_FROM => self.paste_from(&params),
            COPY_HTML => self.session.execute(
                "edit.copy",
                json!({ "range": params.get("range"), "html": true }),
            ),
            _ => self.session.execute(&command.id, params),
        };
        // Gli appunti della facciata non si rifanno dal giornale: nessuno
        // resta dopo un comando.
        self.session.clipboard = None;
        self.session.journal.clear();
        // La cronologia è del giornale: quella della facciata terrebbe in
        // memoria una seconda copia di ogni stato.
        let doc = self.doc_mut();
        doc.undo.clear();
        doc.redo.clear();
        outcome.map_err(engine_error)
    }

    /// [`PASTE_FROM`] sulla selezione del comando: `edit.copy` (o
    /// `edit.cut` con `move`) di `source`, sul foglio `sourceSheet` o su
    /// quello del comando, poi `edit.pasteSpecial`.
    fn paste_from(&mut self, params: &Json) -> Result<Json, EngineError> {
        let bad = |why: &str| EngineError::Other(format!("{PASTE_FROM}: {why}"));
        let source = params
            .get("source")
            .and_then(Json::as_str)
            .ok_or_else(|| bad("`source` is required"))?;
        let sheet = match params.get("sourceSheet") {
            None | Some(Json::Null) => self.doc().wb.active_sheet,
            Some(id) => id
                .as_str()
                .and_then(|id| self.sheet_index(id))
                .ok_or_else(|| bad("`sourceSheet` names no sheet"))?,
        };
        let moving = match params.get("move") {
            None | Some(Json::Null) => false,
            Some(flag) => flag.as_bool().ok_or_else(|| bad("`move` is a bool"))?,
        };
        let what = match params.get("what") {
            None | Some(Json::Null) => "all",
            Some(what) => what.as_str().ok_or_else(|| bad("`what` is a string"))?,
        };
        if moving && what != "all" {
            return Err(bad("only `what: all` moves"));
        }
        let take = if moving { "edit.cut" } else { "edit.copy" };
        self.session
            .execute(take, json!({ "sheet": sheet, "range": source }))?;
        let mut paste = json!({ "what": what });
        if let Some(at) = params.get("at").filter(|at| !at.is_null()) {
            paste["at"] = at.clone();
        }
        self.session.execute("edit.pasteSpecial", paste)
    }

    /// Mette nella finestra chiesta ciò che mostra all'apertura e che la
    /// shell non sa leggere da sé: la regola di convalida della cella attiva,
    /// così OK senza cambiare niente la lascia com'è.
    fn fill_dialogs(&self, requests: &mut [UiRequest]) {
        for request in requests {
            let UiRequest::Dialog(id, params) = request else {
                continue;
            };
            if id != "dataValidation" {
                continue;
            }
            let doc = self.doc();
            let at = doc.selection.active;
            let rule = doc.wb.active().and_then(|sheet| {
                sheet
                    .validations
                    .iter()
                    .find(|rule| rule.ranges.iter().any(|range| range.contains(at)))
            });
            if let (Some(rule), Json::Object(object)) = (rule, params) {
                object.insert("rule".into(), validation_json(rule));
            }
        }
    }

    /// Dà un `sheetId` a ogni foglio che non ne ha uno suo: un foglio nuovo,
    /// o la copia di uno che c'era (la copia, non il foglio di prima).
    fn give_sheet_ids(&mut self, before: &Workbook) {
        let sheets = &self.doc().wb.sheets;
        let mut kept = BTreeSet::new();
        let mut needs = Vec::new();
        // Prima chi aveva già il suo id, poi gli altri nell'ordine.
        let keeps = |index: usize| {
            let sheet = &sheets[index];
            before
                .sheets
                .iter()
                .any(|old| old.file_id == sheet.file_id && Arc::ptr_eq(old, sheet))
        };
        for index in (0..sheets.len()).filter(|&index| keeps(index)) {
            kept.insert(sheets[index].file_id);
        }
        for (index, sheet) in sheets.iter().enumerate() {
            if keeps(index) {
                continue;
            }
            if sheet.file_id != 0 && kept.insert(sheet.file_id) {
                continue;
            }
            needs.push(index);
        }
        if needs.is_empty() {
            return;
        }
        let mut next = 1u32;
        let mut numbers = Vec::with_capacity(needs.len());
        for _ in &needs {
            while self.given.contains(&next) || kept.contains(&next) {
                next += 1;
            }
            self.given.insert(next);
            numbers.push(next);
        }
        let workbook = Arc::make_mut(&mut self.doc_mut().wb);
        for (index, number) in needs.into_iter().zip(numbers) {
            Arc::make_mut(&mut workbook.sheets[index]).file_id = number;
        }
    }

    /// Annulla l'ultimo comando di `journal`, che resta con gli altri. Senza
    /// lo stato di prima, rifà gli altri dalla `base`.
    pub fn undo(&mut self, base: &Workbook, journal: &[GridCommand]) -> Result<(), PluginError> {
        let Some((last, rest)) = journal.split_last() else {
            return Err(PluginError::BadArgs("nothing to undo".into()));
        };
        let after = self.snapshot();
        match self.undo.pop().flatten() {
            Some(before) => self.restore(before),
            None => {
                let redo = std::mem::take(&mut self.redo);
                let mut fresh = Facade::new(base);
                fresh.replay(rest)?;
                *self = fresh;
                self.redo = redo;
            }
        }
        self.redo.push((last.clone(), after));
        Ok(())
    }

    /// Ripete l'ultimo comando annullato, e lo dà per il giornale.
    pub fn redo(&mut self) -> Result<GridCommand, PluginError> {
        let (command, after) = self
            .redo
            .pop()
            .ok_or_else(|| PluginError::BadArgs("nothing to redo".into()))?;
        let before = self.snapshot();
        self.restore(after);
        self.undo.push(Some(before));
        Ok(command)
    }

    /// Rifà i comandi di un giornale. Ognuno deve cambiare la cartella come
    /// la prima volta.
    pub fn replay(&mut self, commands: &[GridCommand]) -> Result<(), PluginError> {
        for command in commands {
            let ran = self.run(command).map_err(|error| {
                PluginError::Conflict(
                    format!(
                        "grid journal command `{}` no longer applies: {error}",
                        command.id
                    )
                    .into(),
                )
            })?;
            if !ran.changed {
                return Err(PluginError::Conflict(
                    format!(
                        "grid journal command `{}` no longer changes the workbook",
                        command.id
                    )
                    .into(),
                ));
            }
        }
        Ok(())
    }

    /// Il catalogo sulla selezione `at`. `edits` spegne, con il suo perché,
    /// i comandi che cambiano la cartella tranne l'input delle celle, e
    /// `input` spegne anche quello; `undo` dice se il giornale ha un comando
    /// da annullare.
    pub fn catalog(
        &mut self,
        at: &GridSelection,
        edits: Option<&str>,
        input: Option<&str>,
        undo: bool,
    ) -> Vec<GridCommandState> {
        // Una selezione che il foglio non ha dà il catalogo su quella di
        // prima.
        let _ = self.select(at);
        let mut out = Vec::new();
        for spec in command_specs() {
            if !served(spec.id) {
                continue;
            }
            let blocked = match spec.id {
                SET_VALUES => input,
                _ if spec.undoable => edits,
                _ => None,
            };
            let (enabled, reason) = match (spec.id, blocked) {
                (UNDO, _) => (undo, (!undo).then(|| "nothing to undo".to_owned())),
                (REDO, _) => {
                    let redo = self.can_redo();
                    (redo, (!redo).then(|| "nothing to redo".to_owned()))
                }
                (_, Some(why)) => (false, Some(why.to_owned())),
                _ => {
                    let info = spec.info(&self.session);
                    (info.enabled, info.disabled_reason)
                }
            };
            let reason = (!enabled).then(|| {
                truncate(
                    reason.unwrap_or_else(|| "not available".to_owned()),
                    MAX_GRID_COMMAND_REASON_BYTES,
                )
            });
            out.push(GridCommandState {
                id: spec.id.to_owned(),
                enabled,
                reason,
            });
        }
        for (id, changes, _) in COMPOSED {
            let blocked = if *changes { edits } else { None };
            out.push(GridCommandState {
                id: (*id).to_owned(),
                enabled: blocked.is_none(),
                reason: blocked.map(|why| truncate(why.to_owned(), MAX_GRID_COMMAND_REASON_BYTES)),
            });
        }
        out
    }

    /// Il punto a cui [`Facade::rollback`] torna.
    pub fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            snapshot: self.snapshot(),
            undo: self.undo.len(),
            redo: self.redo.clone(),
        }
    }

    /// Torna al punto `checkpoint`, togliendo i comandi dati dopo.
    pub fn rollback(&mut self, checkpoint: Checkpoint) {
        self.restore(checkpoint.snapshot);
        self.undo.truncate(checkpoint.undo);
        self.redo = checkpoint.redo;
    }
}

/// Lo stato della facciata prima di un gruppo di comandi.
pub(crate) struct Checkpoint {
    snapshot: Snapshot,
    undo: usize,
    redo: Vec<(GridCommand, Snapshot)>,
}

/// Il comando con cui l'input `value` entra nella cella `cell`.
pub(crate) fn input_command(sheet: &str, cell: CellRef, value: Json) -> GridCommand {
    let at = cell.a1();
    GridCommand {
        id: SET_VALUES.to_owned(),
        params: json!({ "range": at, "values": [[value]] }).to_string(),
        sheet: sheet.to_owned(),
        selection: at.clone(),
        active: at,
    }
}

/// Le celle che un comando d'input scrive, con i loro valori, quando ha la
/// forma che gli dà [`input_command`]: un solo valore, su una cella del
/// foglio del comando.
pub(crate) fn input_cell(command: &GridCommand) -> Option<(CellRef, Json)> {
    if command.id != SET_VALUES {
        return None;
    }
    let Json::Object(mut fields) = serde_json::from_str(&command.params).ok()? else {
        return None;
    };
    if fields.len() != 2 {
        return None;
    }
    let range = fields.remove("range")?;
    let cell = CellRef::parse(range.as_str()?)
        .filter(|cell| Some(cell.a1().as_str()) == range.as_str())?;
    let Json::Array(mut rows) = fields.remove("values")? else {
        return None;
    };
    let Some(Json::Array(mut row)) = rows.pop().filter(|_| rows.is_empty()) else {
        return None;
    };
    let value = row.pop().filter(|_| row.is_empty())?;
    matches!(
        value,
        Json::Null | Json::Bool(_) | Json::Number(_) | Json::String(_)
    )
    .then_some((cell, value))
}

/// Due cartelle uguali per contenuto, a meno del foglio attivo (che è
/// della vista): un comando che rifà la cartella senza cambiarla non entra
/// nel giornale.
fn same_content(a: &Workbook, b: &Workbook) -> bool {
    a.sheets.len() == b.sheets.len()
        && a.sheets
            .iter()
            .zip(&b.sheets)
            .all(|(a, b)| Arc::ptr_eq(a, b) || a == b)
        && same_book(a, b)
}

/// Due cartelle uguali fuori dai fogli e dal foglio attivo.
pub(crate) fn same_book(a: &Workbook, b: &Workbook) -> bool {
    let Workbook {
        sheets: _,
        names,
        styles,
        theme,
        date_system,
        calc,
        show_objects,
        active_sheet: _,
        props,
        protected_structure,
        structure_password,
        custom_lists,
        cell_styles,
        phonetics,
        vba_project,
        csv_delimiter,
        preserved,
        source_dir,
        source_path,
    } = a;
    let same_preserved = match (preserved, &b.preserved) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b) || a == b,
        (a, b) => a.is_none() && b.is_none(),
    };
    *names == b.names
        && *styles == b.styles
        && *theme == b.theme
        && *date_system == b.date_system
        && *calc == b.calc
        && *show_objects == b.show_objects
        && *props == b.props
        && *protected_structure == b.protected_structure
        && *structure_password == b.structure_password
        && *custom_lists == b.custom_lists
        && *cell_styles == b.cell_styles
        && *phonetics == b.phonetics
        && *vba_project == b.vba_project
        && *csv_delimiter == b.csv_delimiter
        && *source_dir == b.source_dir
        && *source_path == b.source_path
        && same_preserved
}

/// Due fogli uguali fuori dalle celle (con i valori versati) e dalla vista
/// della selezione.
pub(crate) fn same_sheet_but_cells(a: &Sheet, b: &Sheet) -> bool {
    let Sheet {
        name,
        file_id,
        cells: _,
        cell_pictures,
        spill: _,
        spill_ranges: _,
        cols,
        rows,
        default_col_width,
        default_row_height,
        merges,
        freeze,
        tab_color,
        visibility,
        show_gridlines,
        show_headings,
        show_formulas,
        show_zeros,
        right_to_left,
        zoom,
        cond_formats,
        validations,
        tables,
        autofilter,
        comments,
        hyperlinks,
        charts,
        images,
        shapes,
        sparklines,
        slicers,
        pivots,
        protection,
        edit_ranges,
        print,
        view_active: _,
        view_top_left: _,
        view,
        preserved,
    } = a;
    let same_preserved = match (preserved, &b.preserved) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b) || a == b,
        (a, b) => a.is_none() && b.is_none(),
    };
    *name == b.name
        && *file_id == b.file_id
        && *cell_pictures == b.cell_pictures
        && *cols == b.cols
        && *rows == b.rows
        && *default_col_width == b.default_col_width
        && *default_row_height == b.default_row_height
        && *merges == b.merges
        && *freeze == b.freeze
        && *tab_color == b.tab_color
        && *visibility == b.visibility
        && *show_gridlines == b.show_gridlines
        && *show_headings == b.show_headings
        && *show_formulas == b.show_formulas
        && *show_zeros == b.show_zeros
        && *right_to_left == b.right_to_left
        && *zoom == b.zoom
        && *cond_formats == b.cond_formats
        && *validations == b.validations
        && *tables == b.tables
        && *autofilter == b.autofilter
        && *comments == b.comments
        && *hyperlinks == b.hyperlinks
        && *charts == b.charts
        && *images == b.images
        && *shapes == b.shapes
        && *sparklines == b.sparklines
        && *slicers == b.slicers
        && *pivots == b.pivots
        && *protection == b.protection
        && *edit_ranges == b.edit_ranges
        && *print == b.print
        && *view == b.view
        && same_preserved
}

/// Il risultato di un comando, come oggetto JSON: un risultato che non è un
/// oggetto sta sotto `value`, i messaggi della facciata sotto `messages`, e
/// uno troppo grande si dice con `tooLarge`.
fn result_text(result: Json, requests: &[UiRequest]) -> Option<String> {
    let messages: Vec<&String> = requests
        .iter()
        .filter_map(|request| match request {
            UiRequest::Message(message) => Some(message),
            _ => None,
        })
        .collect();
    let mut object = match result {
        Json::Null => serde_json::Map::new(),
        Json::Object(object) => object,
        other => {
            let mut object = serde_json::Map::new();
            object.insert("value".into(), other);
            object
        }
    };
    if !messages.is_empty() {
        object.insert("messages".into(), json!(messages));
    }
    if object.is_empty() {
        return None;
    }
    let text = Json::Object(object).to_string();
    if text.len() > MAX_GRID_COMMAND_RESULT_BYTES {
        return Some(json!({ "tooLarge": true }).to_string());
    }
    Some(text)
}

/// Una regola di convalida con i nomi dei parametri di `data.validation`.
fn validation_json(rule: &Validation) -> Json {
    let kind = match rule.kind {
        ValidationKind::Any => "any",
        ValidationKind::Whole => "whole",
        ValidationKind::Decimal => "decimal",
        ValidationKind::List => "list",
        ValidationKind::Date => "date",
        ValidationKind::Time => "time",
        ValidationKind::TextLength => "textLength",
        ValidationKind::Custom => "custom",
    };
    let operator = match rule.op {
        CfOperator::Between => "between",
        CfOperator::NotBetween => "notBetween",
        CfOperator::Equal => "equal",
        CfOperator::NotEqual => "notEqual",
        CfOperator::Greater => "greater",
        CfOperator::Less => "less",
        CfOperator::GreaterOrEqual => "greaterOrEqual",
        CfOperator::LessOrEqual => "lessOrEqual",
    };
    let style = match rule.error_style {
        ErrorStyle::Stop => "stop",
        ErrorStyle::Warning => "warning",
        ErrorStyle::Information => "information",
    };
    json!({
        "type": kind,
        "operator": operator,
        "formula1": rule.f1,
        "formula2": rule.f2,
        "ignoreBlank": rule.allow_blank,
        "dropdown": rule.in_cell_dropdown,
        "inputTitle": rule.input_title,
        "inputMessage": rule.input_message,
        "errorStyle": style,
        "errorTitle": rule.error_title,
        "errorMessage": rule.error_message,
    })
}

/// La prima finestra di dialogo che il comando chiede.
fn dialog_of(requests: &[UiRequest]) -> Option<GridDialog> {
    requests.iter().find_map(|request| match request {
        UiRequest::Dialog(id, params) => {
            let params = match params {
                Json::Object(_) => params.to_string(),
                Json::Null => "{}".to_owned(),
                other => json!({ "value": other }).to_string(),
            };
            let valid = !id.is_empty()
                && id.len() <= fub_abi::MAX_GRID_ID_BYTES
                && id.bytes().all(|byte| (0x21..=0x7e).contains(&byte));
            (valid && params.len() <= MAX_GRID_COMMAND_PARAMS_BYTES).then(|| GridDialog {
                id: id.clone(),
                params,
            })
        }
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il catalogo che Fub serve, con i parametri che la barra e le finestre
    /// danno: un aggiornamento di GridCraft che aggiunge un comando, ne toglie
    /// uno o ne cambia i parametri lo mostra nel diff di questo file, perché
    /// nessun comando nuovo arrivi alla shell senza che qualcuno lo guardi. Si
    /// rigenera con `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --lib
    /// catalogo_servito`.
    #[test]
    fn catalogo_servito() {
        let mut text = String::from(
            "# Il catalogo dei comandi di GridCraft che fub-format-xlsx serve:\n\
             # id, se cambia la cartella, parametri. Generato da\n\
             # `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --lib catalogo_servito`.\n",
        );
        for spec in command_specs().iter().filter(|spec| served(spec.id)) {
            let kind = if spec.undoable { "modifica" } else { "legge" };
            text.push_str(&format!("{}\t{kind}\t{}\n", spec.id, spec.params));
        }
        for (id, changes, params) in COMPOSED {
            let kind = if *changes { "modifica" } else { "legge" };
            text.push_str(&format!("{id}\t{kind}\t{params}\n"));
        }
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/catalogo-servito.tsv"
        );
        if std::env::var_os("UPDATE_MIRROR").is_some() {
            std::fs::write(path, &text).unwrap();
            return;
        }
        let saved = std::fs::read_to_string(path).unwrap_or_default();
        assert!(
            saved == text,
            "il catalogo servito è cambiato: guardalo e rigeneralo con \
             `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --lib catalogo_servito`"
        );
    }

    /// Un comando servito non tocca il disco: la facciata legge e scrive
    /// file soltanto attraverso un parametro `path`, che [`params_of`]
    /// rifiuta. Se un aggiornamento di GridCraft nomina un file con un'altra
    /// chiave, questo test lo dice prima che la chiave arrivi alla shell.
    #[test]
    fn nessun_comando_servito_nomina_un_file() {
        const FILE_KEYS: &[&str] = &[
            "file", "filename", "fileName", "dir", "folder", "url", "uri", "src",
        ];
        let key = |params: &str, name: &str| {
            params.match_indices(name).any(|(at, _)| {
                let before = params[..at].trim_end().chars().last();
                let after = params[at + name.len()..].chars().next();
                matches!(before, Some('{' | ',' | '|'))
                    && matches!(after, Some('?' | ':' | ',' | '}' | ' '))
            })
        };
        for spec in command_specs().iter().filter(|spec| served(spec.id)) {
            for name in FILE_KEYS {
                assert!(
                    !key(spec.params, name),
                    "`{}` names a file with `{name}`: {}",
                    spec.id,
                    spec.params
                );
            }
            if key(spec.params, "path") {
                let command = GridCommand {
                    id: spec.id.into(),
                    params: r#"{"path":"/etc/passwd"}"#.into(),
                    sheet: "s1".into(),
                    selection: "A1".into(),
                    active: "A1".into(),
                };
                assert!(
                    matches!(params_of(&command), Err(PluginError::BadArgs(_))),
                    "{}",
                    spec.id
                );
            }
        }
    }
}
