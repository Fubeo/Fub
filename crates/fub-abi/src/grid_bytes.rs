//! La versione 2 della famiglia `grid`: una sorgente **a byte** che resta
//! nella custodia dell'host, e una modifica che è un **giornale di celle**.
//!
//! Una cartella di Excel è a byte, e può essere grande: la shell apre una sessione per documento, legge le finestre che mostra e non
//! vede mai i byte. Il testo della `DocumentSession` è il [`GridJournal`]: le
//! celle cambiate rispetto ai byte sul disco, con l'input che hanno nel file e
//! quello nuovo. Salvare è dell'host: rilegge i byte, riapre il provider, gli
//! applica il giornale e scrive ciò che [`GridBytesProvider::bytes_to_write`] dà.
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
    GridSurfaceSpec, GridWindowRequest, GRID_FAMILY, MAX_GRID_PATCHES, MAX_GRID_PATCH_INPUT_BYTES,
    MAX_GRID_RESPONSE_BYTES, MAX_GRID_SESSION_COLUMNS, MAX_GRID_SESSION_ROWS,
    MAX_GRID_SESSION_SHEETS, MAX_GRID_WINDOW_CELLS, MAX_GRID_WINDOW_COLUMNS, MAX_GRID_WINDOW_ROWS,
};

/// La versione del protocollo `grid` a byte.
pub const GRID_BYTES_PROTOCOL_VERSION: u32 = 2;
/// La sorgente a byte più grande che l'host passa a un provider: quella di
/// un documento a byte.
pub const MAX_GRID_BYTES_SOURCE: usize = 256 * 1024 * 1024;
/// La versione della forma del giornale.
pub const GRID_JOURNAL_VERSION: u32 = 1;
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

/// Il giornale delle celle cambiate, in forma canonica.
///
/// Il testo vuoto è il giornale vuoto. Altrimenti è JSON chiuso:
/// `{"version":1,"cells":[{"sheet","row","column","before","after"}]}`, con
/// le voci in ordine di chiave (`sheet`, `row`, `column`, confrontate come
/// byte), nessuna chiave due volte e nessuna voce con `after` uguale a
/// `before`. Un testo che non è in questa forma non si legge: due testi
/// diversi non sono mai lo stesso giornale.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GridJournal {
    cells: BTreeMap<GridCellKey, (String, String)>,
}

impl GridJournal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    pub fn len(&self) -> usize {
        self.cells.len()
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
        if text.len() > MAX_GRID_JOURNAL_INPUT_BYTES + MAX_GRID_JOURNAL_ENTRIES * 512 {
            return Err(bad("grid journal exceeds byte limit"));
        }
        let wire: JournalWire =
            serde_json::from_str(text).map_err(|_| bad("grid journal is not valid JSON"))?;
        if wire.version != GRID_JOURNAL_VERSION {
            return Err(bad("grid journal has an unknown version"));
        }
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
        if journal.to_text() != text {
            return Err(bad("grid journal is not in canonical form"));
        }
        Ok(journal)
    }

    /// Il testo canonico.
    pub fn to_text(&self) -> String {
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
    /// scritto: per ogni cella, l'input che il disco ha adesso è il `before`,
    /// e quello che `self` vuole è l'`after`. Le voci salvate e non più toccate
    /// escono; una cella tornata al suo input durante il salvataggio entra,
    /// per riportarlo sul disco.
    pub fn rebase(&self, saved: &GridJournal) -> GridJournal {
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
        for sheet in &self.sheets {
            if !valid_id(&sheet.id) || sheet.name.is_empty() {
                return Err(bad("grid session has an empty identity"));
            }
            if sheet.row_count > MAX_GRID_SESSION_ROWS
                || sheet.column_count > MAX_GRID_SESSION_COLUMNS
            {
                return Err(bad("grid session axes exceed limits"));
            }
        }
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridBytesCell {
    pub key: GridCellKey,
    pub input: String,
    pub style: GridCellStyle,
    pub value: GridValue,
    pub display: String,
    pub lock: Option<String>,
    pub stale: bool,
    pub conflict: bool,
}

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
