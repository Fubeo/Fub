//! La versione 2 della famiglia `grid`: una sorgente **a byte** che resta
//! nella custodia dell'host, e una modifica che è un **giornale**.
//!
//! Una cartella di Excel è a byte, e può essere grande: la shell apre una
//! sessione per documento, legge le finestre che mostra e non vede mai i byte.
//! Il testo della `DocumentSession` è il [`GridJournal`], in una di due forme:
//! le celle cambiate rispetto ai byte sul disco, con l'input che hanno nel file
//! e quello nuovo (versione 1, ADR 0216), oppure i comandi dati sui byte, in
//! ordine (versione 2, ADR 0219). Salvare è dell'host: rilegge i byte, riapre
//! il provider, gli applica il giornale e scrive ciò che
//! [`GridBytesProvider::bytes_to_write`] dà.
//!
//! Il giornale ha una sola forma canonica, e la regola vive qui; la shell ne
//! ha il mirror (`apps/client/src/state/grid-journal.ts`), legato da una
//! fixture comune.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::edit::{Revision, RevisionHasher};
use crate::error::PluginError;
use crate::grid::{
    GridApplyRequest, GridCellKey, GridCellStyle, GridColumn, GridCommit, GridRow, GridSheet,
    GridSurfaceSpec, GridWindowRequest, GRID_FAMILY, MAX_GRID_FONT_BYTES, MAX_GRID_PATCHES,
    MAX_GRID_PATCH_INPUT_BYTES, MAX_GRID_RESPONSE_BYTES, MAX_GRID_SESSION_COLUMNS,
    MAX_GRID_SESSION_ROWS, MAX_GRID_SESSION_SHEETS, MAX_GRID_WINDOW_CELLS, MAX_GRID_WINDOW_COLUMNS,
    MAX_GRID_WINDOW_ROWS,
};

/// La versione del protocollo `grid` a byte.
pub const GRID_BYTES_PROTOCOL_VERSION: u32 = 2;
/// La sorgente a byte più grande che l'host passa a un provider: quella di
/// un documento a byte.
pub const MAX_GRID_BYTES_SOURCE: usize = 256 * 1024 * 1024;
/// La versione della forma del giornale di celle.
pub const GRID_JOURNAL_VERSION: u32 = 1;
/// La versione della forma del giornale di comandi.
pub const GRID_COMMAND_JOURNAL_VERSION: u32 = 2;
/// I comandi di un giornale.
pub const MAX_GRID_JOURNAL_COMMANDS: usize = 16_384;
/// I parametri di un comando, come testo JSON.
pub const MAX_GRID_COMMAND_PARAMS_BYTES: usize = 64 * 1024;
/// La selezione di un comando, in riferimenti A1.
pub const MAX_GRID_SELECTION_BYTES: usize = 4 * 1024;
/// Il testo di un giornale di comandi.
pub const MAX_GRID_COMMAND_JOURNAL_BYTES: usize = 16 * 1024 * 1024;
/// I comandi del catalogo di una sessione.
pub const MAX_GRID_CATALOG_COMMANDS: usize = 1_024;
/// Il risultato di un comando, come testo JSON.
pub const MAX_GRID_COMMAND_RESULT_BYTES: usize = 1024 * 1024;
/// Il motivo per cui un comando è spento.
pub const MAX_GRID_COMMAND_REASON_BYTES: usize = 1024;
/// Le voci di un giornale: quante ne porta un'operazione.
pub const MAX_GRID_JOURNAL_ENTRIES: usize = MAX_GRID_PATCHES;
/// Gli input di un giornale, `before` e `after` insieme.
pub const MAX_GRID_JOURNAL_INPUT_BYTES: usize = MAX_GRID_PATCH_INPUT_BYTES;
/// Un id di foglio, riga o colonna nel giornale: ASCII stampabile, così
/// l'ordine delle chiavi è lo stesso in Rust e in JavaScript.
pub const MAX_GRID_ID_BYTES: usize = 64;
/// Gli avvisi di una sessione.
pub const MAX_GRID_NOTICES: usize = 64;

fn bad(message: &str) -> PluginError {
    PluginError::BadArgs(message.into())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_GRID_ID_BYTES
        && id.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

fn valid_key(key: &GridCellKey) -> bool {
    valid_id(&key.sheet) && valid_id(&key.row) && valid_id(&key.column)
}

/// Una voce del giornale come la scrive il testo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridJournalEntry {
    pub sheet: String,
    pub row: String,
    pub column: String,
    /// L'input che la cella ha nei byte su cui il giornale si applica.
    pub before: String,
    /// L'input nuovo.
    pub after: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JournalWire {
    version: u32,
    cells: Vec<GridJournalEntry>,
}

/// Un comando del giornale: l'id del comando del provider, i parametri come
/// testo di un oggetto JSON, e la selezione su cui è stato dato. La selezione
/// è il foglio (il suo id), gli intervalli in riferimenti A1 separati da
/// virgola e la cella attiva. Il giornale porta il testo dei parametri così
/// com'è: nessuno lo riscrive, e due lati che lo copiano danno gli stessi
/// byte.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GridCommand {
    pub id: String,
    pub params: String,
    pub sheet: String,
    pub selection: String,
    pub active: String,
}

fn valid_reference(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_GRID_SELECTION_BYTES
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b',' | b'$'))
}

impl GridCommand {
    /// La selezione su cui il comando è stato dato.
    pub fn selection(&self) -> GridSelection {
        GridSelection {
            sheet: self.sheet.clone(),
            selection: self.selection.clone(),
            active: self.active.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), PluginError> {
        if !valid_id(&self.id) {
            return Err(bad("grid command has an invalid id"));
        }
        self.selection().validate()?;
        if self.params.len() > MAX_GRID_COMMAND_PARAMS_BYTES {
            return Err(bad("grid command parameters exceed byte limit"));
        }
        if !json_object(&self.params, MAX_GRID_COMMAND_PARAMS_BYTES) {
            return Err(bad("grid command parameters are not a JSON object"));
        }
        Ok(())
    }
}

/// Dove sta la selezione: il foglio (il suo id), gli intervalli in
/// riferimenti A1 separati da virgola e la cella attiva.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSelection {
    pub sheet: String,
    pub selection: String,
    pub active: String,
}

impl GridSelection {
    pub fn validate(&self) -> Result<(), PluginError> {
        if !valid_id(&self.sheet) {
            return Err(bad("grid command has an invalid id"));
        }
        if !valid_reference(&self.selection)
            || !valid_reference(&self.active)
            || self.active.contains([':', ','])
        {
            return Err(bad("grid command has an invalid selection"));
        }
        Ok(())
    }
}

/// Un comando del catalogo di una sessione, con lo stato che ha sulla
/// selezione: spento, porta il perché nel testo del provider.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCommandState {
    pub id: String,
    pub enabled: bool,
    pub reason: Option<String>,
}

/// Il catalogo di una sessione: id unici, il perché soltanto per un comando
/// spento.
pub fn validate_grid_catalog(commands: &[GridCommandState]) -> Result<(), PluginError> {
    if commands.len() > MAX_GRID_CATALOG_COMMANDS {
        return Err(bad("grid catalog exceeds its limits"));
    }
    let mut seen = std::collections::BTreeSet::new();
    for command in commands {
        if !valid_id(&command.id) || !seen.insert(command.id.as_str()) {
            return Err(bad("grid catalog has an invalid or repeated id"));
        }
        let reason = command.reason.as_deref();
        if command.enabled && reason.is_some()
            || reason.is_some_and(|reason| reason.len() > MAX_GRID_COMMAND_REASON_BYTES)
        {
            return Err(bad("grid catalog has an invalid reason"));
        }
    }
    Ok(())
}

/// Un comando da dare alla sessione alla sua revisione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCommandRequest {
    pub revision: Revision,
    pub command: GridCommand,
}

impl GridCommandRequest {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.revision.0.is_empty() {
            return Err(bad("grid command has an empty revision"));
        }
        self.command.validate()
    }
}

/// Una finestra di dialogo che un comando chiede alla shell, con i parametri
/// come testo di un oggetto JSON: la shell la apre se la conosce, e la sua
/// risposta è un altro comando.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridDialog {
    pub id: String,
    pub params: String,
}

/// L'esito di un comando: il commit del giornale (vuoto se il comando non
/// cambia la cartella), i fogli dopo il comando, la selezione nuova, il
/// risultato come testo JSON, la finestra di dialogo chiesta e il catalogo
/// sulla selezione nuova.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridCommandOutcome {
    pub commit: GridCommit,
    pub sheets: Vec<GridSheet>,
    pub hidden: Vec<String>,
    pub selection: GridSelection,
    pub result: Option<String>,
    pub dialog: Option<GridDialog>,
    pub commands: Vec<GridCommandState>,
    pub book: GridBook,
}

fn json_object(text: &str, limit: usize) -> bool {
    text.len() <= limit
        && matches!(
            serde_json::from_str::<serde_json::Value>(text),
            Ok(serde_json::Value::Object(_))
        )
}

impl GridCommandOutcome {
    pub fn validate(&self) -> Result<(), PluginError> {
        self.commit.validate()?;
        self.selection.validate()?;
        validate_sheets(&self.sheets)?;
        let named = |id: &String| self.sheets.iter().any(|sheet| &sheet.id == id);
        if !named(&self.selection.sheet) || !self.hidden.iter().all(named) {
            return Err(bad("grid outcome names a sheet it does not have"));
        }
        if self
            .result
            .as_deref()
            .is_some_and(|result| !json_object(result, MAX_GRID_COMMAND_RESULT_BYTES))
        {
            return Err(bad(
                "grid command result is not a JSON object within limits",
            ));
        }
        if let Some(dialog) = &self.dialog {
            if !valid_id(&dialog.id) || !json_object(&dialog.params, MAX_GRID_COMMAND_PARAMS_BYTES)
            {
                return Err(bad("grid command dialog is invalid"));
            }
        }
        validate_grid_catalog(&self.commands)?;
        self.book.validate()?;
        let encoded = serde_json::to_vec(self)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if encoded.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(bad("grid outcome exceeds byte limit"));
        }
        Ok(())
    }
}

fn validate_sheets(sheets: &[GridSheet]) -> Result<(), PluginError> {
    if sheets.is_empty() || sheets.len() > MAX_GRID_SESSION_SHEETS {
        return Err(bad("grid session exceeds its limits"));
    }
    for sheet in sheets {
        if !valid_id(&sheet.id) || sheet.name.is_empty() {
            return Err(bad("grid session has an empty identity"));
        }
        if sheet.row_count > MAX_GRID_SESSION_ROWS || sheet.column_count > MAX_GRID_SESSION_COLUMNS
        {
            return Err(bad("grid session axes exceed limits"));
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CommandJournalWire {
    version: u32,
    commands: Vec<GridCommand>,
}

#[derive(Deserialize)]
struct VersionProbe {
    version: u32,
}

/// Come una voce sta rispetto all'input che la cella ha adesso.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridJournalMatch {
    /// La cella ha ancora l'input di prima: la voce si applica.
    Pending,
    /// La cella ha già l'input nuovo: non c'è niente da fare.
    Applied,
    /// La cella ha un terzo input: qualcun altro l'ha cambiata.
    Conflict,
}

/// Il giornale di una sessione a byte, in forma canonica.
///
/// Il testo vuoto è il giornale vuoto. Altrimenti è JSON chiuso, in una di
/// due forme, mai insieme:
///
/// - **di celle** (versione 1):
///   `{"version":1,"cells":[{"sheet","row","column","before","after"}]}`, con
///   le voci in ordine di chiave (`sheet`, `row`, `column`, confrontate come
///   byte), nessuna chiave due volte e nessuna voce con `after` uguale a
///   `before`;
/// - **di comandi** (versione 2):
///   `{"version":2,"commands":[{"id","params","sheet","selection","active"}]}`,
///   i comandi nell'ordine in cui si applicano, almeno uno.
///
/// Un testo che non è in una di queste forme non si legge: due testi diversi
/// non sono mai lo stesso giornale.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GridJournal {
    cells: BTreeMap<GridCellKey, (String, String)>,
    commands: Vec<GridCommand>,
}

impl GridJournal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty() && self.commands.is_empty()
    }

    /// Le voci di un giornale di celle, o i comandi di uno di comandi.
    pub fn len(&self) -> usize {
        self.cells.len() + self.commands.len()
    }

    /// I comandi, nell'ordine in cui si applicano: vuoto per un giornale di
    /// celle.
    pub fn commands(&self) -> &[GridCommand] {
        &self.commands
    }

    /// Aggiunge un comando in coda. Un giornale di celle non ne prende; oltre
    /// i limiti il giornale resta com'era.
    pub fn push_command(&mut self, command: GridCommand) -> Result<(), PluginError> {
        if !self.cells.is_empty() {
            return Err(bad("a cell journal does not take commands"));
        }
        command.validate()?;
        self.commands.push(command);
        if let Err(error) = self.validate() {
            self.commands.pop();
            return Err(error);
        }
        Ok(())
    }

    /// Toglie l'ultimo comando, e lo dà.
    pub fn pop_command(&mut self) -> Option<GridCommand> {
        self.commands.pop()
    }

    /// Le voci, in ordine di chiave: la cella, l'input di prima, quello nuovo.
    pub fn entries(&self) -> impl Iterator<Item = (&GridCellKey, &str, &str)> {
        self.cells
            .iter()
            .map(|(key, (before, after))| (key, before.as_str(), after.as_str()))
    }

    /// La voce di una cella.
    pub fn get(&self, key: &GridCellKey) -> Option<(&str, &str)> {
        self.cells
            .get(key)
            .map(|(before, after)| (before.as_str(), after.as_str()))
    }

    /// Legge un giornale, soltanto nella forma canonica.
    pub fn parse(text: &str) -> Result<Self, PluginError> {
        if text.is_empty() {
            return Ok(Self::new());
        }
        if text.len() > MAX_GRID_COMMAND_JOURNAL_BYTES {
            return Err(bad("grid journal exceeds byte limit"));
        }
        let probe: VersionProbe =
            serde_json::from_str(text).map_err(|_| bad("grid journal is not valid JSON"))?;
        let journal = match probe.version {
            GRID_JOURNAL_VERSION => Self::parse_cells(text)?,
            GRID_COMMAND_JOURNAL_VERSION => {
                let wire: CommandJournalWire = serde_json::from_str(text)
                    .map_err(|_| bad("grid journal is not valid JSON"))?;
                if wire.commands.is_empty() {
                    return Err(bad("grid journal is not in canonical form"));
                }
                let journal = Self {
                    cells: BTreeMap::new(),
                    commands: wire.commands,
                };
                journal.validate()?;
                journal
            }
            _ => return Err(bad("grid journal has an unknown version")),
        };
        if journal.to_text() != text {
            return Err(bad("grid journal is not in canonical form"));
        }
        Ok(journal)
    }

    fn parse_cells(text: &str) -> Result<Self, PluginError> {
        if text.len() > MAX_GRID_JOURNAL_INPUT_BYTES + MAX_GRID_JOURNAL_ENTRIES * 512 {
            return Err(bad("grid journal exceeds byte limit"));
        }
        let wire: JournalWire =
            serde_json::from_str(text).map_err(|_| bad("grid journal is not valid JSON"))?;
        let mut journal = Self::new();
        for entry in wire.cells {
            let key = GridCellKey {
                sheet: entry.sheet,
                row: entry.row,
                column: entry.column,
            };
            if journal
                .cells
                .insert(key, (entry.before, entry.after))
                .is_some()
            {
                return Err(bad("grid journal names a cell twice"));
            }
        }
        journal.validate()?;
        Ok(journal)
    }

    /// Il testo canonico.
    pub fn to_text(&self) -> String {
        if !self.commands.is_empty() {
            let wire = CommandJournalWire {
                version: GRID_COMMAND_JOURNAL_VERSION,
                commands: self.commands.clone(),
            };
            return serde_json::to_string(&wire).expect("a journal always serializes");
        }
        if self.cells.is_empty() {
            return String::new();
        }
        let wire = JournalWire {
            version: GRID_JOURNAL_VERSION,
            cells: self
                .cells
                .iter()
                .map(|(key, (before, after))| GridJournalEntry {
                    sheet: key.sheet.clone(),
                    row: key.row.clone(),
                    column: key.column.clone(),
                    before: before.clone(),
                    after: after.clone(),
                })
                .collect(),
        };
        serde_json::to_string(&wire).expect("a journal always serializes")
    }

    /// I limiti e la forma delle voci.
    pub fn validate(&self) -> Result<(), PluginError> {
        if !self.commands.is_empty() {
            if !self.cells.is_empty() {
                return Err(bad("grid journal mixes cells and commands"));
            }
            if self.commands.len() > MAX_GRID_JOURNAL_COMMANDS {
                return Err(bad("grid journal exceeds command limit"));
            }
            let mut bytes = 0usize;
            for command in &self.commands {
                command.validate()?;
                bytes = bytes.saturating_add(
                    command.id.len()
                        + command.params.len()
                        + command.sheet.len()
                        + command.selection.len()
                        + command.active.len(),
                );
            }
            // Il testo porta i parametri come stringhe JSON, con le virgolette
            // scritte due volte: il conto resta sotto il limite del testo.
            if bytes.saturating_mul(2) > MAX_GRID_COMMAND_JOURNAL_BYTES {
                return Err(bad("grid journal exceeds byte limit"));
            }
            return Ok(());
        }
        if self.cells.len() > MAX_GRID_JOURNAL_ENTRIES {
            return Err(bad("grid journal exceeds entry limit"));
        }
        let mut bytes = 0usize;
        for (key, (before, after)) in &self.cells {
            if !valid_key(key) {
                return Err(bad("grid journal has an invalid cell id"));
            }
            if before == after {
                return Err(bad("grid journal has an entry that changes nothing"));
            }
            bytes = bytes.saturating_add(before.len() + after.len());
        }
        if bytes > MAX_GRID_JOURNAL_INPUT_BYTES {
            return Err(bad("grid journal inputs exceed byte limit"));
        }
        Ok(())
    }

    /// Registra che `key` passa da `before` ad `after`. Una cella già nel
    /// giornale tiene il suo `before` e prende l'`after` nuovo; una cella che
    /// torna al suo input esce. Oltre i limiti il giornale resta com'era.
    pub fn record(
        &mut self,
        key: GridCellKey,
        before: String,
        after: String,
    ) -> Result<(), PluginError> {
        if !self.commands.is_empty() {
            return Err(bad("a command journal does not take cell entries"));
        }
        if !valid_key(&key) {
            return Err(bad("grid journal has an invalid cell id"));
        }
        let previous = self.cells.get(&key).cloned();
        let original = previous
            .as_ref()
            .map(|(original, _)| original.clone())
            .unwrap_or(before);
        if original == after {
            self.cells.remove(&key);
        } else {
            self.cells.insert(key.clone(), (original, after));
        }
        if let Err(error) = self.validate() {
            match previous {
                Some(previous) => self.cells.insert(key, previous),
                None => self.cells.remove(&key),
            };
            return Err(error);
        }
        Ok(())
    }

    /// Toglie la voce di `key`: la cella torna all'input che ha nei byte.
    /// Dice se c'era.
    pub fn forget(&mut self, key: &GridCellKey) -> bool {
        self.cells.remove(key).is_some()
    }

    /// Il giornale riportato sui byte che il salvataggio di `saved` ha
    /// scritto.
    ///
    /// Di celle: per ogni cella, l'input che il disco ha adesso è il
    /// `before`, e quello che `self` vuole è l'`after`. Le voci salvate e non
    /// più toccate escono; una cella tornata al suo input durante il
    /// salvataggio entra, per riportarlo sul disco.
    ///
    /// Di comandi: escono i comandi che `self` ha in comune con `saved`
    /// dall'inizio, e restano quelli dopo. I comandi salvati che `self` non
    /// ha più (annullati durante il salvataggio) restano nei byte: li conta
    /// [`GridJournal::reverted_by`].
    ///
    /// Un giornale di comandi nato da uno di celle (il provider converte le
    /// voci in comandi) resta com'è sopra il salvataggio di celle: le voci
    /// convertite rimettono input che i byte hanno già.
    pub fn rebase(&self, saved: &GridJournal) -> GridJournal {
        if !self.commands.is_empty() || !saved.commands.is_empty() {
            if saved.commands.is_empty() || self.commands.is_empty() && !self.cells.is_empty() {
                return self.clone();
            }
            let common = common_prefix(&self.commands, &saved.commands);
            return GridJournal {
                cells: BTreeMap::new(),
                commands: self.commands[common..].to_vec(),
            };
        }
        let mut out = GridJournal::new();
        let keys: std::collections::BTreeSet<&GridCellKey> =
            self.cells.keys().chain(saved.cells.keys()).collect();
        for key in keys {
            let wanted = match (self.cells.get(key), saved.cells.get(key)) {
                (Some((_, after)), _) => after,
                (None, Some((before, _))) => before,
                (None, None) => continue,
            };
            let disk = match (saved.cells.get(key), self.cells.get(key)) {
                (Some((_, after)), _) => after,
                (None, Some((before, _))) => before,
                (None, None) => continue,
            };
            if wanted != disk {
                out.cells
                    .insert(key.clone(), (disk.clone(), wanted.clone()));
            }
        }
        out
    }

    /// I comandi che il salvataggio di `saved` ha scritto e che `self` non ha
    /// più: [`GridJournal::rebase`] non li toglie dai byte.
    pub fn reverted_by(&self, saved: &GridJournal) -> usize {
        saved.commands.len() - common_prefix(&self.commands, &saved.commands)
    }
}

fn common_prefix(left: &[GridCommand], right: &[GridCommand]) -> usize {
    left.iter()
        .zip(right)
        .take_while(|(left, right)| left == right)
        .count()
}

/// Come una voce `before → after` sta rispetto all'input `current` della
/// cella.
pub fn grid_journal_match(before: &str, after: &str, current: &str) -> GridJournalMatch {
    if current == before {
        GridJournalMatch::Pending
    } else if current == after {
        GridJournalMatch::Applied
    } else {
        GridJournalMatch::Conflict
    }
}

/// La revisione di una sessione a byte: i byte e il giornale insieme. È
/// contenuto, come [`Revision::of`]: lo stesso giornale sugli stessi byte è la
/// stessa revisione.
pub fn grid_bytes_revision(source: &Revision, journal: &str) -> Revision {
    let mut hasher = RevisionHasher::new();
    hasher.update(source.0.as_bytes());
    hasher.update(b"\0");
    hasher.update(journal.as_bytes());
    hasher.finish()
}

/// Un avviso della sorgente, in un codice chiuso del provider: la shell
/// traduce quelli che conosce.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridNotice {
    pub code: String,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridBytesSession {
    pub instance: String,
    pub revision: Revision,
    pub sheets: Vec<GridSheet>,
    /// Il foglio che la sorgente apre per primo.
    pub active: String,
    /// I fogli che la sorgente nasconde: la shell non li mostra fra le
    /// schede finché l'utente non li chiede.
    pub hidden: Vec<String>,
    pub notices: Vec<GridNotice>,
    /// Le voci del giornale che i byte non confermano: la cella ha un terzo
    /// input, perché qualcun altro l'ha cambiata. La finestra mostra il
    /// valore del giornale e lo segna; il salvataggio scrive quello.
    pub conflicts: Vec<GridCellKey>,
    /// I comandi che la sessione serve, con lo stato sulla selezione
    /// iniziale (la cella `A1` del foglio attivo): vuoto per un provider che
    /// modifica soltanto con le patch.
    pub commands: Vec<GridCommandState>,
    pub book: GridBook,
}

impl GridBytesSession {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.instance.is_empty() || self.revision.0.is_empty() {
            return Err(bad("grid session has an empty identity"));
        }
        let named = |id: &String| self.sheets.iter().any(|sheet| &sheet.id == id);
        if !named(&self.active) || !self.hidden.iter().all(named) {
            return Err(bad("grid session names a sheet it does not have"));
        }
        if self.sheets.len() > MAX_GRID_SESSION_SHEETS
            || self.notices.len() > MAX_GRID_NOTICES
            || self.conflicts.len() > MAX_GRID_JOURNAL_ENTRIES
        {
            return Err(bad("grid session exceeds its limits"));
        }
        validate_sheets(&self.sheets)?;
        validate_grid_catalog(&self.commands)?;
        self.book.validate()?;
        if self.notices.iter().any(|notice| !valid_id(&notice.code)) {
            return Err(bad("grid notice has an invalid code"));
        }
        let encoded = serde_json::to_vec(self)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if encoded.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(bad("grid session exceeds byte limit"));
        }
        Ok(())
    }
}

/// Il valore di una cella della versione 2. Un errore porta il suo testo
/// (`#N/A`, `#DIV/0!`, …): ogni formato ha i suoi.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum GridValue {
    Blank,
    Number(f64),
    Text(String),
    Boolean(bool),
    Error(String),
}

/// Una cella della finestra. `display` è il valore già formattato dal
/// provider; `lock` è il perché la cella non si modifica, in un codice chiuso;
/// `stale` dice che il valore è quello del file e una cella da cui dipende è
/// cambiata; `conflict` che la cella è nel giornale e i byte hanno un terzo
/// input.
///
/// `style` è l'indice del suo aspetto negli `styles` della finestra. La
/// formattazione condizionale arriva già risolta: lo stile lì, la barra dei
/// dati e l'icona qui.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridBytesCell {
    pub key: GridCellKey,
    pub input: String,
    pub style: u32,
    pub value: GridValue,
    pub display: String,
    pub lock: Option<String>,
    pub stale: bool,
    pub conflict: bool,
    pub data_bar: Option<GridDataBar>,
    pub icon: Option<GridIcon>,
    pub comment: Option<GridComment>,
    pub link: Option<GridLink>,
}

/// La barra dei dati: la frazione della larghezza della cella, da 0 a 1.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridDataBar {
    pub fraction: f32,
    pub color: String,
    pub gradient: bool,
}

/// L'icona di una serie (`3Arrows`, `5Rating`), dal basso: 0 è la più bassa.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridIcon {
    pub set: String,
    pub index: u32,
}

/// Una nota, o un commento con le sue risposte.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridComment {
    pub author: String,
    pub text: String,
    pub threaded: bool,
    pub resolved: bool,
    pub replies: Vec<GridCommentReply>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCommentReply {
    pub author: String,
    pub text: String,
}

/// Un collegamento: un indirizzo, o un punto della cartella (`Foglio2!A1`).
/// `external` dice che porta fuori dalla cartella; la shell non lo segue da
/// sola.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridLink {
    pub target: String,
    pub tooltip: Option<String>,
    pub external: bool,
}

/// Un'unione di celle, a indici assoluti del foglio: la cella in alto a
/// sinistra e quante righe e colonne copre.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridMerge {
    pub row: u32,
    pub column: u32,
    pub rows: u32,
    pub columns: u32,
}

/// Come il foglio si guarda: le celle, le pagine, o le interruzioni di
/// pagina sopra le celle.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridViewMode {
    #[default]
    Normal,
    PageLayout,
    PageBreakPreview,
}

/// La vista del foglio come la salva il file, con ciò che la stampa ne
/// prende: le opzioni che la barra mostra accese o spente.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSheetView {
    pub frozen_rows: u32,
    pub frozen_columns: u32,
    pub gridlines: bool,
    pub headings: bool,
    /// In percento, da 10 a 400.
    pub zoom: u16,
    pub right_to_left: bool,
    pub mode: GridViewMode,
    /// Le celle mostrano le formule invece dei valori.
    pub formulas: bool,
    /// Il foglio è protetto.
    pub protected: bool,
    pub print_gridlines: bool,
    pub print_headings: bool,
}

impl Default for GridSheetView {
    fn default() -> Self {
        Self {
            frozen_rows: 0,
            frozen_columns: 0,
            gridlines: true,
            headings: true,
            zoom: 100,
            right_to_left: false,
            mode: GridViewMode::Normal,
            formulas: false,
            protected: false,
            print_gridlines: false,
            print_headings: false,
        }
    }
}

/// Una tabella del foglio, a indici assoluti: la cella in alto a sinistra,
/// quante righe e colonne copre (con l'intestazione e i totali), le opzioni
/// di stile e il nome dello stile (`TableStyleMedium2`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridTable {
    pub name: String,
    pub row: u32,
    pub column: u32,
    pub rows: u32,
    pub columns: u32,
    pub header_row: bool,
    pub totals_row: bool,
    pub banded_rows: bool,
    pub banded_columns: bool,
    pub first_column: bool,
    pub last_column: bool,
    pub filter_button: bool,
    pub style: String,
}

/// Quando la cartella si ricalcola.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridCalculation {
    #[default]
    Automatic,
    AutomaticExceptTables,
    Manual,
}

/// I colori del tema di una cartella, nell'ordine del file: sfondo 1, testo
/// 1, sfondo 2, testo 2, i sei colori principali, il collegamento e il
/// collegamento visitato.
pub const GRID_THEME_COLORS: usize = 12;
/// I nomi definiti che una sessione porta, al più.
pub const MAX_GRID_BOOK_NAMES: usize = 4_096;
/// La misura di un nome definito o di una tabella (Excel ne tiene 255).
pub const MAX_GRID_NAME_BYTES: usize = 255;
/// Le tabelle che una finestra porta, al più.
pub const MAX_GRID_WINDOW_TABLES: usize = 1_024;

/// Ciò che vale per la cartella intera: i colori del tema (`#RRGGBB`), i
/// nomi definiti, il modo del calcolo, se la struttura è protetta e il
/// carattere dello stile Normale, che lo stile di una cella tace. Lo danno la
/// sessione e l'esito di ogni comando.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridBook {
    pub theme_colors: Vec<String>,
    pub names: Vec<String>,
    pub calculation: GridCalculation,
    pub protected: bool,
    pub font: String,
    /// In punti.
    pub font_size: f32,
}

impl Default for GridBook {
    /// Il tema di Office.
    fn default() -> Self {
        Self {
            theme_colors: [
                "#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5",
                "#FFC000", "#5B9BD5", "#70AD47", "#0563C1", "#954F72",
            ]
            .map(str::to_owned)
            .to_vec(),
            names: Vec::new(),
            calculation: GridCalculation::Automatic,
            protected: false,
            font: "Calibri".to_owned(),
            font_size: 11.0,
        }
    }
}

fn hex_color(text: &str) -> bool {
    text.len() == 7
        && text.starts_with('#')
        && text[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl GridBook {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.theme_colors.len() != GRID_THEME_COLORS
            || !self.theme_colors.iter().all(|color| hex_color(color))
        {
            return Err(bad("grid book theme colors are malformed"));
        }
        if self.names.len() > MAX_GRID_BOOK_NAMES
            || self
                .names
                .iter()
                .any(|name| name.is_empty() || name.len() > MAX_GRID_NAME_BYTES)
        {
            return Err(bad("grid book names exceed their limits"));
        }
        if self.font.is_empty() || self.font.len() > MAX_GRID_FONT_BYTES {
            return Err(bad("grid book font name exceeds its limits"));
        }
        if !self.font_size.is_finite() || self.font_size <= 0.0 || self.font_size > 409.0 {
            return Err(bad("grid book font size is out of range"));
        }
        Ok(())
    }
}

/// Una finestra porta gli aspetti delle sue celle una volta sola, le unioni
/// che la toccano, anche quelle che cominciano fuori, e la vista del foglio.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridBytesWindow {
    pub revision: Revision,
    pub sheet: String,
    pub row_start: u32,
    pub column_start: u32,
    pub total_rows: u32,
    pub total_columns: u32,
    pub rows: Vec<GridRow>,
    pub columns: Vec<GridColumn>,
    pub cells: Vec<GridBytesCell>,
    pub styles: Vec<GridCellStyle>,
    pub merges: Vec<GridMerge>,
    pub view: GridSheetView,
    /// Le tabelle che toccano la finestra, anche quelle che cominciano fuori.
    pub tables: Vec<GridTable>,
}

impl GridBytesWindow {
    pub fn validate(&self) -> Result<(), PluginError> {
        if self.revision.0.is_empty()
            || self.sheet.is_empty()
            || self.total_rows > MAX_GRID_SESSION_ROWS
            || self.total_columns > MAX_GRID_SESSION_COLUMNS
            || self.rows.len() > MAX_GRID_WINDOW_ROWS as usize
            || self.columns.len() > MAX_GRID_WINDOW_COLUMNS as usize
            || self.cells.len() > MAX_GRID_WINDOW_CELLS
        {
            return Err(bad("grid response exceeds window limits"));
        }
        let row_end = self
            .row_start
            .checked_add(self.rows.len() as u32)
            .ok_or_else(|| bad("grid row range overflows"))?;
        let column_end = self
            .column_start
            .checked_add(self.columns.len() as u32)
            .ok_or_else(|| bad("grid column range overflows"))?;
        if row_end > self.total_rows || column_end > self.total_columns {
            return Err(bad("grid window lies outside its session axes"));
        }
        if self
            .cells
            .iter()
            .any(|cell| cell.lock.as_deref().is_some_and(|lock| !valid_id(lock)))
        {
            return Err(bad("grid cell has an invalid lock code"));
        }
        if self.styles.len() > self.cells.len().max(1) {
            return Err(bad("grid window has more styles than cells"));
        }
        for style in &self.styles {
            style.validate()?;
        }
        for cell in &self.cells {
            if cell.style as usize >= self.styles.len() {
                return Err(bad("grid cell names a style the window does not have"));
            }
            if cell
                .data_bar
                .as_ref()
                .is_some_and(|bar| !(0.0..=1.0).contains(&bar.fraction) || bar.color.is_empty())
                || cell.icon.as_ref().is_some_and(|icon| !valid_id(&icon.set))
                || cell
                    .link
                    .as_ref()
                    .is_some_and(|link| link.target.is_empty())
            {
                return Err(bad("grid cell has a malformed mark"));
            }
        }
        if self.merges.len() > MAX_GRID_WINDOW_CELLS {
            return Err(bad("grid window has too many merges"));
        }
        for merge in &self.merges {
            let bottom = merge.row.checked_add(merge.rows);
            let right = merge.column.checked_add(merge.columns);
            let (Some(bottom), Some(right)) = (bottom, right) else {
                return Err(bad("grid merge overflows"));
            };
            if merge.rows == 0
                || merge.columns == 0
                || (merge.rows == 1 && merge.columns == 1)
                || bottom > self.total_rows
                || right > self.total_columns
                || bottom <= self.row_start
                || merge.row >= row_end
                || right <= self.column_start
                || merge.column >= column_end
            {
                return Err(bad("grid merge lies outside the window"));
            }
        }
        if self.tables.len() > MAX_GRID_WINDOW_TABLES {
            return Err(bad("grid window has too many tables"));
        }
        for table in &self.tables {
            let bottom = table.row.checked_add(table.rows);
            let right = table.column.checked_add(table.columns);
            let (Some(bottom), Some(right)) = (bottom, right) else {
                return Err(bad("grid table overflows"));
            };
            if table.name.is_empty()
                || table.name.len() > MAX_GRID_NAME_BYTES
                || table.style.len() > MAX_GRID_NAME_BYTES
                || table.rows == 0
                || table.columns == 0
                || bottom > self.total_rows
                || right > self.total_columns
                || bottom <= self.row_start
                || table.row >= row_end
                || right <= self.column_start
                || table.column >= column_end
            {
                return Err(bad("grid table lies outside the window"));
            }
        }
        let view = &self.view;
        if view.frozen_rows > self.total_rows
            || view.frozen_columns > self.total_columns
            || !(10..=400).contains(&view.zoom)
        {
            return Err(bad("grid sheet view is outside its limits"));
        }
        let encoded = serde_json::to_vec(self)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        if encoded.len() > MAX_GRID_RESPONSE_BYTES {
            return Err(bad("grid response exceeds byte limit"));
        }
        Ok(())
    }
}

impl GridSurfaceSpec {
    /// Il binding di una superficie della versione 2.
    pub fn bytes(id: impl Into<String>, format: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            format: format.into(),
            family: GRID_FAMILY.to_owned(),
            protocol_version: GRID_BYTES_PROTOCOL_VERSION,
        }
    }
}

/// Provider di una superficie grid su una sorgente a byte.
///
/// `apply` riceve le patch di [`GridApplyRequest`], e il suo [`GridCommit`] porta
/// la modifica **del giornale**: `edit` è il diff fra il testo del giornale
/// prima e dopo, che la shell applica al buffer della `DocumentSession` come
/// ogni altro diff. `bytes_to_write` la chiama soltanto l'host, per salvare.
pub trait GridBytesProvider: Send + Sync {
    fn surfaces(&self) -> Vec<GridSurfaceSpec>;
    /// Apre `source` alla sua revisione e vi applica `journal`.
    fn open(
        &mut self,
        surface: &str,
        source: &[u8],
        revision: Revision,
        journal: &GridJournal,
    ) -> Result<GridBytesSession, PluginError>;
    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridBytesWindow, PluginError>;
    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError>;
    /// Il catalogo sulla selezione `selection`. Un provider che modifica
    /// soltanto con le patch lo dà vuoto.
    fn commands(
        &mut self,
        instance: &str,
        selection: GridSelection,
    ) -> Result<Vec<GridCommandState>, PluginError> {
        let _ = (instance, selection);
        Ok(Vec::new())
    }
    /// Dà un comando del catalogo alla revisione della richiesta. Il commit
    /// porta il diff del giornale, che da un giornale di celle diventa di
    /// comandi; un comando che non c'è, spento o con parametri che non
    /// tornano è `BadArgs`, e la sessione resta com'era.
    fn command(
        &mut self,
        instance: &str,
        request: GridCommandRequest,
    ) -> Result<GridCommandOutcome, PluginError> {
        let _ = instance;
        Err(PluginError::BadArgs(
            format!("grid command `{}` is not served", request.command.id).into(),
        ))
    }
    /// I byte della sessione alla revisione `expected`: quelli della sorgente
    /// con il giornale applicato. Una voce già applicata non cambia niente;
    /// una in conflitto scrive il suo input, perché l'host apre la sessione
    /// sui byte che l'utente ha visto. Una voce che i byte non possono
    /// ricevere (il foglio non c'è più, la cella è bloccata) è un errore, e
    /// niente si scrive.
    fn bytes_to_write(
        &mut self,
        instance: &str,
        expected: Revision,
    ) -> Result<Vec<u8>, PluginError>;
    fn close(&mut self, instance: &str) -> Result<(), PluginError>;
    /// Distrugge tutte le istanze prima che il corpo del plugin venga disattivato.
    fn shutdown(&mut self) -> Result<(), PluginError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{GridBorder, GridBorderStyle, GridBorders, GRID_STACKED_ROTATION};

    fn key(sheet: &str, row: &str, column: &str) -> GridCellKey {
        GridCellKey {
            sheet: sheet.into(),
            row: row.into(),
            column: column.into(),
        }
    }

    #[test]
    fn il_giornale_ha_una_sola_forma() {
        let mut journal = GridJournal::new();
        assert_eq!(journal.to_text(), "");
        journal
            .record(key("s1", "r2", "c0"), "".into(), "2".into())
            .unwrap();
        journal
            .record(key("s1", "r10", "c0"), "a".into(), "b".into())
            .unwrap();
        let text = journal.to_text();
        assert_eq!(
            text,
            r#"{"version":1,"cells":[{"sheet":"s1","row":"r10","column":"c0","before":"a","after":"b"},{"sheet":"s1","row":"r2","column":"c0","before":"","after":"2"}]}"#
        );
        assert_eq!(GridJournal::parse(&text).unwrap(), journal);
        assert_eq!(GridJournal::parse("").unwrap(), GridJournal::new());
        for wrong in [
            r#"{"version":1,"cells":[]}"#,
            r#"{"version":2,"cells":[{"sheet":"s","row":"r","column":"c","before":"a","after":"b"}]}"#,
            r#"{"cells":[{"sheet":"s","row":"r","column":"c","before":"a","after":"b"}],"version":1}"#,
            r#"{"version":1,"cells":[{"sheet":"s","row":"r","column":"c","before":"a","after":"a"}]}"#,
            r#"{"version":1,"cells":[{"sheet":"s","row":"r2","column":"c","before":"a","after":"b"},{"sheet":"s","row":"r1","column":"c","before":"a","after":"b"}]}"#,
            r#"{"version":1,"cells":[{"sheet":"s","row":"r","column":"c","before":"a","after":"b","x":1}]}"#,
            r#"{"version":1,"cells":[{"sheet":"s é","row":"r","column":"c","before":"a","after":"b"}]}"#,
            r#" {"version":1,"cells":[{"sheet":"s","row":"r","column":"c","before":"a","after":"b"}]}"#,
        ] {
            assert!(GridJournal::parse(wrong).is_err(), "{wrong}");
        }
    }

    #[test]
    fn due_modifiche_della_stessa_cella_sono_una_voce() {
        let mut journal = GridJournal::new();
        journal
            .record(key("s", "r", "c"), "1".into(), "2".into())
            .unwrap();
        journal
            .record(key("s", "r", "c"), "2".into(), "3".into())
            .unwrap();
        assert_eq!(journal.get(&key("s", "r", "c")), Some(("1", "3")));
        journal
            .record(key("s", "r", "c"), "3".into(), "1".into())
            .unwrap();
        assert!(journal.is_empty());
        assert!(journal
            .record(key("", "r", "c"), "1".into(), "2".into())
            .is_err());
    }

    #[test]
    fn oltre_il_limite_il_giornale_resta_com_era() {
        let mut journal = GridJournal::new();
        let big = "x".repeat(MAX_GRID_JOURNAL_INPUT_BYTES + 1);
        assert!(journal.record(key("s", "r", "c"), "".into(), big).is_err());
        assert!(journal.is_empty());
    }

    #[test]
    fn il_giornale_si_ribasa_sui_byte_salvati() {
        let a = key("s", "r1", "c");
        let b = key("s", "r2", "c");
        let c = key("s", "r3", "c");
        let mut saved = GridJournal::new();
        saved.record(a.clone(), "1".into(), "2".into()).unwrap();
        saved.record(b.clone(), "x".into(), "y".into()).unwrap();
        // Durante il salvataggio: `a` cambia ancora, `b` torna al suo input,
        // `c` entra.
        let mut now = saved.clone();
        now.record(a.clone(), "2".into(), "3".into()).unwrap();
        now.record(b.clone(), "y".into(), "x".into()).unwrap();
        now.record(c.clone(), "".into(), "z".into()).unwrap();
        let rebased = now.rebase(&saved);
        assert_eq!(rebased.get(&a), Some(("2", "3")));
        assert_eq!(rebased.get(&b), Some(("y", "x")));
        assert_eq!(rebased.get(&c), Some(("", "z")));
        assert!(saved.rebase(&saved).is_empty());
    }

    fn command(id: &str, params: &str) -> GridCommand {
        GridCommand {
            id: id.into(),
            params: params.into(),
            sheet: "s1".into(),
            selection: "A1:B2".into(),
            active: "A1".into(),
        }
    }

    #[test]
    fn il_giornale_di_comandi_ha_una_sola_forma() {
        let mut journal = GridJournal::new();
        journal.push_command(command("home.bold", "{}")).unwrap();
        journal
            .push_command(command("cell.set", r#"{"input":"=A2+1"}"#))
            .unwrap();
        let text = journal.to_text();
        assert_eq!(
            text,
            r#"{"version":2,"commands":[{"id":"home.bold","params":"{}","sheet":"s1","selection":"A1:B2","active":"A1"},{"id":"cell.set","params":"{\"input\":\"=A2+1\"}","sheet":"s1","selection":"A1:B2","active":"A1"}]}"#
        );
        assert_eq!(GridJournal::parse(&text).unwrap(), journal);
        assert_eq!(journal.len(), 2);
        assert_eq!(journal.commands()[1].id, "cell.set");
        for wrong in [
            r#"{"version":2,"commands":[]}"#,
            r#"{"version":3,"commands":[]}"#,
            r#"{"commands":[{"id":"a","params":"{}","sheet":"s","selection":"A1","active":"A1"}],"version":2}"#,
            r#"{"version":2,"commands":[{"id":"a","params":"[]","sheet":"s","selection":"A1","active":"A1"}]}"#,
            r#"{"version":2,"commands":[{"id":"a","params":"{}","sheet":"s","selection":"A1","active":"A1:B2"}]}"#,
            r#"{"version":2,"commands":[{"id":"a","params":"{}","sheet":"s","selection":"A 1","active":"A1"}]}"#,
            r#"{"version":2,"commands":[{"id":"a","params":"{}","sheet":"s","selection":"A1","active":"A1","x":1}]}"#,
            r#"{"version":2,"commands":[{"id":"a","params":"{}","sheet":"s","selection":"A1","active":"A1"}],"cells":[]}"#,
        ] {
            assert!(GridJournal::parse(wrong).is_err(), "{wrong}");
        }
        assert_eq!(journal.pop_command().unwrap().id, "cell.set");
        assert_eq!(journal.len(), 1);
    }

    #[test]
    fn celle_e_comandi_non_stanno_insieme() {
        let mut cells = GridJournal::new();
        cells
            .record(key("s", "r", "c"), "1".into(), "2".into())
            .unwrap();
        assert!(cells.push_command(command("home.bold", "{}")).is_err());
        assert_eq!(cells.len(), 1);
        let mut commands = GridJournal::new();
        commands.push_command(command("home.bold", "{}")).unwrap();
        assert!(commands
            .record(key("s", "r", "c"), "1".into(), "2".into())
            .is_err());
        assert_eq!(commands.len(), 1);
    }

    #[test]
    fn un_comando_oltre_i_limiti_non_entra() {
        let mut journal = GridJournal::new();
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_GRID_COMMAND_PARAMS_BYTES));
        assert!(journal.push_command(command("cell.set", &big)).is_err());
        assert!(journal.push_command(command("", "{}")).is_err());
        assert!(journal.push_command(command("cell.set", "nope")).is_err());
        assert!(journal.is_empty());
    }

    #[test]
    fn il_giornale_di_comandi_si_ribasa_sul_prefisso_salvato() {
        let mut saved = GridJournal::new();
        saved.push_command(command("home.bold", "{}")).unwrap();
        saved.push_command(command("home.italic", "{}")).unwrap();
        // Durante il salvataggio un comando si aggiunge.
        let mut now = saved.clone();
        now.push_command(command("home.underline", "{}")).unwrap();
        let rebased = now.rebase(&saved);
        assert_eq!(rebased.len(), 1);
        assert_eq!(rebased.commands()[0].id, "home.underline");
        assert_eq!(now.reverted_by(&saved), 0);
        assert!(saved.rebase(&saved).is_empty());
        // Durante il salvataggio l'ultimo comando si annulla: resta nei byte.
        let mut undone = saved.clone();
        undone.pop_command();
        assert!(undone.rebase(&saved).is_empty());
        assert_eq!(undone.reverted_by(&saved), 1);
        // Un giornale di comandi sopra un salvataggio di celle resta com'è.
        let mut cells = GridJournal::new();
        cells
            .record(key("s", "r", "c"), "1".into(), "2".into())
            .unwrap();
        assert_eq!(now.rebase(&cells), now);
        assert_eq!(cells.rebase(&saved), cells);
    }

    fn window() -> GridBytesWindow {
        GridBytesWindow {
            revision: Revision::of("r"),
            sheet: "s".into(),
            row_start: 10,
            column_start: 2,
            total_rows: 100,
            total_columns: 20,
            rows: (10..12)
                .map(|index| GridRow {
                    id: format!("r{index}"),
                    index,
                    height: None,
                    hidden: false,
                })
                .collect(),
            columns: (2..4)
                .map(|index| GridColumn {
                    id: format!("c{index}"),
                    index,
                    width: None,
                    hidden: false,
                })
                .collect(),
            cells: Vec::new(),
            styles: vec![GridCellStyle::default()],
            merges: Vec::new(),
            view: GridSheetView::default(),
            tables: Vec::new(),
        }
    }

    #[test]
    fn una_finestra_porta_le_unioni_che_la_toccano_e_nessun_altra() {
        let merge = |row, column, rows, columns| GridMerge {
            row,
            column,
            rows,
            columns,
        };
        let mut touching = window();
        // Comincia sopra e a sinistra della finestra, e ci arriva dentro.
        touching.merges = vec![merge(0, 0, 11, 3), merge(11, 3, 1, 5)];
        touching.validate().unwrap();
        for outside in [
            merge(0, 0, 10, 3),
            merge(12, 2, 2, 2),
            merge(10, 4, 1, 2),
            merge(10, 2, 1, 1),
            merge(10, 2, 0, 2),
            merge(99, 2, 2, 1),
            merge(u32::MAX, 2, 2, 1),
        ] {
            let mut window = window();
            window.merges = vec![outside];
            assert!(window.validate().is_err(), "{outside:?}");
        }
    }

    #[test]
    fn una_finestra_porta_le_tabelle_che_la_toccano_con_un_nome() {
        let table = |name: &str, row, column, rows, columns| GridTable {
            name: name.into(),
            row,
            column,
            rows,
            columns,
            header_row: true,
            totals_row: false,
            banded_rows: true,
            banded_columns: false,
            first_column: false,
            last_column: false,
            filter_button: true,
            style: "TableStyleMedium2".into(),
        };
        let mut touching = window();
        touching.tables = vec![table("Spese", 0, 0, 11, 3)];
        touching.validate().unwrap();
        for outside in [
            table("Spese", 0, 0, 10, 3),
            table("Spese", 12, 2, 2, 2),
            table("", 10, 2, 2, 2),
            table(&"x".repeat(MAX_GRID_NAME_BYTES + 1), 10, 2, 2, 2),
            table("Spese", 10, 2, 0, 2),
            table("Spese", 99, 2, 2, 1),
            table("Spese", u32::MAX, 2, 2, 1),
        ] {
            let mut window = window();
            window.tables = vec![outside.clone()];
            assert!(window.validate().is_err(), "{outside:?}");
        }
    }

    #[test]
    fn il_libro_porta_dodici_colori_del_tema_e_nomi_nei_limiti() {
        GridBook::default().validate().unwrap();
        let mut short = GridBook::default();
        short.theme_colors.pop();
        assert!(short.validate().is_err());
        let mut malformed = GridBook::default();
        malformed.theme_colors[0] = "#FFF".into();
        assert!(malformed.validate().is_err());
        let unnamed = GridBook {
            names: vec![String::new()],
            ..GridBook::default()
        };
        assert!(unnamed.validate().is_err());
        let many = GridBook {
            names: (0..=MAX_GRID_BOOK_NAMES).map(|n| format!("n{n}")).collect(),
            ..GridBook::default()
        };
        assert!(many.validate().is_err());
        for font in [String::new(), "x".repeat(MAX_GRID_FONT_BYTES + 1)] {
            assert!(GridBook {
                font,
                ..GridBook::default()
            }
            .validate()
            .is_err());
        }
        for font_size in [0.0, -1.0, 410.0, f32::NAN, f32::INFINITY] {
            assert!(GridBook {
                font_size,
                ..GridBook::default()
            }
            .validate()
            .is_err());
        }
    }

    #[test]
    fn lo_stile_e_la_vista_restano_nei_limiti() {
        let cell = |style: u32| GridBytesCell {
            key: key("s", "r10", "c2"),
            input: String::new(),
            style,
            value: GridValue::Blank,
            display: String::new(),
            lock: None,
            stale: false,
            conflict: false,
            data_bar: None,
            icon: None,
            comment: None,
            link: None,
        };
        let mut good = window();
        good.cells = vec![cell(0)];
        good.styles = vec![
            (GridCellStyle {
                font: Some("Aptos Narrow".into()),
                font_size: Some(10.5),
                rotation: GRID_STACKED_ROTATION,
                borders: GridBorders {
                    bottom: Some(GridBorder {
                        style: GridBorderStyle::Double,
                        color: Some("#1F4E79".into()),
                    }),
                    ..GridBorders::default()
                },
                ..GridCellStyle::default()
            }),
        ];
        good.validate().unwrap();
        let mut missing = window();
        missing.cells = vec![cell(1)];
        assert!(missing.validate().is_err());
        for style in [
            GridCellStyle {
                font_size: Some(f32::NAN),
                ..GridCellStyle::default()
            },
            GridCellStyle {
                font: Some(String::new()),
                ..GridCellStyle::default()
            },
            GridCellStyle {
                rotation: 91,
                ..GridCellStyle::default()
            },
            GridCellStyle {
                borders: GridBorders {
                    left: Some(GridBorder {
                        style: GridBorderStyle::Thin,
                        color: Some("#".repeat(33)),
                    }),
                    ..GridBorders::default()
                },
                ..GridCellStyle::default()
            },
        ] {
            let mut window = window();
            window.cells = vec![cell(0)];
            window.styles = vec![style];
            assert!(window.validate().is_err());
        }
        let mut bar = window();
        bar.cells = vec![GridBytesCell {
            data_bar: Some(GridDataBar {
                fraction: 1.5,
                color: "#638EC6".into(),
                gradient: true,
            }),
            ..cell(0)
        }];
        assert!(bar.validate().is_err());
        let mut view = window();
        view.view.zoom = 5;
        assert!(view.validate().is_err());
        view.view = GridSheetView {
            frozen_rows: 101,
            ..GridSheetView::default()
        };
        assert!(view.validate().is_err());
    }

    #[test]
    fn una_voce_si_confronta_con_la_cella() {
        assert_eq!(grid_journal_match("a", "b", "a"), GridJournalMatch::Pending);
        assert_eq!(grid_journal_match("a", "b", "b"), GridJournalMatch::Applied);
        assert_eq!(
            grid_journal_match("a", "b", "c"),
            GridJournalMatch::Conflict
        );
    }
}
