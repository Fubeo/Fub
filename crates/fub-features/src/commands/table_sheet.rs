//! «Trasforma in foglio» (E23): la tabella di una nota diventa un file `.xlsx`
//! accanto a lei, e al suo posto resta la scheda della parte di foglio che ne
//! porta i valori (`![[Conti.xlsx#Foglio1!A1:C5]]`).
//!
//! I valori li legge chi chiama, dalla tabella che ha davanti: «1.240,50 €» è
//! un numero nella lingua della nota, e quella lettura sta nel client
//! (`i18n/shown-number.ts`) insieme a ogni altra lettura dei numeri scritti a
//! mano. Qui arrivano già letti (`cells`), con l'aspetto che avevano; il
//! comando controlla che la tabella sia ancora lì com'era (`text` fra i byte
//! `at`), scrive il foglio con [`fub_format_xlsx::values`] e mette l'embed al
//! posto della tabella.
//!
//! # Due file, e un annullamento suo
//!
//! Il piano di più documenti ([`WritePlan`](fub_abi::command::WritePlan))
//! crea soltanto testo, e un foglio è un file binario: il foglio si scrive con
//! [`write_document_bytes`](fub_abi::traits::VaultWrite::write_document_bytes)
//! e la nota con una modifica, uno dopo l'altro. Se la nota non si scrive, il
//! foglio appena nato va nel cestino e niente è cambiato.
//!
//! Per la stessa ragione l'annullamento non è la coppia di passi del kernel
//! (una modifica di testo, un cestino): la guardia di una modifica rilegge il
//! documento come testo, e un foglio non lo è. È un passo solo, questo stesso
//! comando con `revert`, che controlla **prima** tutti e due i file: se il
//! foglio è cambiato dopo la trasformazione non tocca niente e lo dice; se la
//! nota è cambiata altrove ritrova l'embed e rimette la tabella lì.

use fub_abi::format::LinkInsert;
use fub_abi::model::LinkTarget;
use fub_abi::rules::folders;
use fub_abi::rules::path_policy::{self, Naming};
use fub_format_xlsx::values::{self, Currency, Filled, NumberLook, ValuesError, MAX_DECIMALS};

use super::move_block::{given_bytes, read};
use super::*;

pub(super) const E_SHEET_NO_CELLS: &str = "err.table_sheet.no_cells";
pub(super) const E_SHEET_NO_FORMAT: &str = "err.table_sheet.no_format";
pub(super) const E_SHEET_NOT_TABLE: &str = "err.table_sheet.not_table";
pub(super) const E_SHEET_CHANGED: &str = "err.table_sheet.changed";
pub(super) const E_SHEET_CELLS: &str = "err.table_sheet.cells";
pub(super) const E_SHEET_EMPTY: &str = "err.table_sheet.empty";
pub(super) const E_SHEET_TOO_LARGE: &str = "err.table_sheet.too_large";
pub(super) const E_SHEET_TOO_LONG: &str = "err.table_sheet.too_long";
pub(super) const E_SHEET_CELL: &str = "err.table_sheet.cell";
pub(super) const E_SHEET_WRITE: &str = "err.table_sheet.write";
pub(super) const E_SHEET_REVERT: &str = "err.table_sheet.revert";
pub(super) const E_UNDO_SHEET_CHANGED: &str = "err.table_sheet.undo_sheet_changed";
pub(super) const E_UNDO_SHEET_GONE: &str = "err.table_sheet.undo_sheet_gone";
pub(super) const E_UNDO_NOTE_CHANGED: &str = "err.table_sheet.undo_note_changed";
pub(super) const P_TABLE_SHEET: &str = "plan.table_sheet";
pub(super) const P_TABLE_SHEET_UNDO: &str = "plan.table_sheet_undo";
pub(super) const D_TABLE_SHEET: &str = "done.table_sheet";
pub(super) const D_TABLE_SHEET_UNDONE: &str = "done.table_sheet_undone";
pub(super) const U_TABLE_SHEET: &str = "undo.table_sheet";
/// Il nome del primo (e unico) foglio, nella lingua di chi trasforma.
pub(super) const N_FIRST_SHEET: &str = "note.table.sheet.first_sheet";
/// Il nome del file quando quello della nota non va bene per un file nuovo.
pub(super) const N_TABLE_FILE: &str = "note.table.sheet.file";

const A_SHEET: &str = "sheet";
const A_CELL: &str = "cell";
const A_ROWS: &str = "rows";
const A_COLUMNS: &str = "columns";

/// L'estensione del foglio che nasce.
const EXTENSION: &str = "xlsx";

/// Una cella come la scrive chi chiama: un testo (`""` è la cella vuota), un
/// numero col suo aspetto, o `null`.
#[derive(Deserialize)]
#[serde(untagged)]
enum CellArg {
    Text(String),
    Number(NumberArg),
}

/// Un numero letto da un testo scritto a mano, e com'era scritto.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NumberArg {
    number: f64,
    #[serde(default)]
    decimals: u8,
    #[serde(default)]
    grouped: bool,
    #[serde(default)]
    percent: bool,
    #[serde(default)]
    parens: bool,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    currency_after: bool,
    #[serde(default)]
    currency_spaced: bool,
}

/// La cella come la scriverà il foglio.
fn filled(cell: Option<CellArg>) -> Filled {
    match cell {
        None => Filled::Blank,
        Some(CellArg::Text(text)) if text.is_empty() => Filled::Blank,
        Some(CellArg::Text(text)) => Filled::Text(text),
        Some(CellArg::Number(n)) => Filled::Number {
            value: n.number,
            look: NumberLook {
                decimals: n.decimals.min(MAX_DECIMALS),
                grouped: n.grouped,
                percent: n.percent,
                parens: n.parens,
                currency: n.currency.filter(|s| !s.is_empty()).map(|symbol| Currency {
                    symbol,
                    after: n.currency_after,
                    spaced: n.currency_spaced,
                }),
            },
        },
    }
}

/// Ciò che l'annullamento deve sapere, scritto nel suo passo: i due file, le
/// loro revisioni dopo la trasformazione, dove sta l'embed e la tabella da
/// rimettere.
#[derive(Debug, Serialize, Deserialize)]
struct Revert {
    doc: DocId,
    sheet: DocId,
    sheet_revision: Revision,
    note_revision: Revision,
    at: [usize; 2],
    embed: String,
    table: String,
}

pub(super) fn note_table_sheet(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    if let Some(revert) = args.text("revert") {
        let revert: Revert = serde_json::from_str(revert)
            .map_err(|error| PluginError::BadArgs(one(E_NOT_JSON, A_REASON, &error.to_string())))?;
        return undo_sheet(revert, mode, host);
    }
    let context = host.active_context();
    let doc = crate::formats::document_with(&args, "doc", &*host, fub_abi::options::source::PROSE)?
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_OPEN_NOTES)))?;
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    // Dalla palette non c'è una tabella in mano: la porta il suo menu.
    let (Some(at), Some(expected), Some(cells)) =
        (args.numbers("at"), args.text(A_TEXT), args.text("cells"))
    else {
        return Err(PluginError::BadArgs(Text::key(E_SHEET_NO_CELLS)));
    };
    let rows: Vec<Vec<Option<CellArg>>> = serde_json::from_str(cells)
        .map_err(|error| PluginError::BadArgs(one(E_SHEET_CELLS, A_REASON, &error.to_string())))?;
    let rows: Vec<Vec<Filled>> = rows
        .into_iter()
        .map(|row| row.into_iter().map(filled).collect())
        .collect();

    let note = read(host, &doc)?;
    let (start, end) = given_bytes(&at)?;
    if note.source.get(start..end) != Some(expected) {
        return Err(PluginError::Conflict(one(
            E_SHEET_CHANGED,
            A_DOC,
            doc.page_name(),
        )));
    }
    let end = trimmed_end(&note.source, start, end);
    if start >= end || !is_table(&note.model.body, &note.source, start, end) {
        return Err(PluginError::BadArgs(Text::key(E_SHEET_NOT_TABLE)));
    }
    let table = note.source[start..end].to_string();

    let sheet = sheet_name(host, &doc)?;
    let file_name = sheet.as_str().rsplit('/').next().unwrap_or(sheet.as_str());
    let written = values::of_values(file_name, &label(host, N_FIRST_SHEET), &rows, true)
        .map_err(|error| values_error(&sheet, error))?;

    if mode.is_dry_run() {
        // L'embed col percorso intero: il foglio non c'è ancora, e la forma
        // più corta si sceglie quando c'è.
        let embed = embed_text(host, &doc, sheet.as_str(), &written.part)?;
        let edit = PlannedEdit {
            doc: doc.clone(),
            edit: EditRequest::new(
                note.revision,
                vec![TextEdit::replace(Span::new(start, end), embed)],
            ),
        };
        let mut plan =
            CommandPlan::of_edits(one(P_TABLE_SHEET, A_SHEET, sheet.as_str()), vec![edit]);
        plan.docs.insert(0, sheet);
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }

    // Prima il foglio, che non c'era: `None` lo scrive soltanto se il nome è
    // ancora libero.
    let sheet_revision = host.write_document_bytes(&sheet, &written.bytes, None)?;
    let embed = match embed_text(host, &doc, &reference(host, &sheet), &written.part) {
        Ok(embed) => embed,
        Err(error) => return Err(rolled_back(host, &sheet, &sheet_revision, error)),
    };
    let request = EditRequest::new(
        note.revision,
        vec![TextEdit::replace(Span::new(start, end), embed.clone())],
    );
    let report = match host.apply_edit(&doc, request) {
        Ok(report) => report,
        Err(error) => return Err(rolled_back(host, &sheet, &sheet_revision, error)),
    };
    let revert = Revert {
        doc: doc.clone(),
        sheet: sheet.clone(),
        sheet_revision,
        note_revision: report.revision,
        at: [start, start + embed.len()],
        embed,
        table,
    };
    let revert = serde_json::to_string(&revert)
        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
    let undo = Undo::by_command(
        one(U_TABLE_SHEET, A_SHEET, sheet.as_str()),
        NOTE_TABLE_SHEET,
        serde_json::json!({ "revert": revert }),
    );
    Ok(CommandOutcome::notify(one(D_TABLE_SHEET, A_SHEET, sheet.as_str())).undoable(undo))
}

/// L'annullamento: la tabella torna al posto dell'embed e il foglio va nel
/// cestino, tutte e due le cose o nessuna.
fn undo_sheet(
    revert: Revert,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    // Il foglio per primo: se qualcuno ci ha scritto, cestinarlo perderebbe
    // ciò che ha scritto, e la nota resta com'è.
    match host.document_revision(&revert.sheet) {
        Ok(revision) if revision == revert.sheet_revision => {}
        Ok(_) => {
            return Err(PluginError::Conflict(one(
                E_UNDO_SHEET_CHANGED,
                A_SHEET,
                revert.sheet.as_str(),
            )))
        }
        Err(PluginError::NotFound(_)) => {
            return Err(PluginError::Conflict(one(
                E_UNDO_SHEET_GONE,
                A_SHEET,
                revert.sheet.as_str(),
            )))
        }
        Err(error) => return Err(error),
    }
    let revision = host.document_revision(&revert.doc)?;
    let source = host.read_document(&revert.doc)?;
    let [start, end] = revert.at;
    let at = if revision == revert.note_revision
        && source.get(start..end) == Some(revert.embed.as_str())
    {
        Some(start)
    } else {
        // La nota è cambiata altrove: l'embed si ritrova se c'è una volta sola.
        let mut found = source.match_indices(revert.embed.as_str()).map(|(i, _)| i);
        match (found.next(), found.next()) {
            (Some(at), None) => Some(at),
            _ => None,
        }
    };
    let at = at.ok_or_else(|| {
        PluginError::Conflict(one(E_UNDO_NOTE_CHANGED, A_DOC, revert.doc.page_name()))
    })?;
    let edit = EditRequest::new(
        revision,
        vec![TextEdit::replace(
            Span::new(at, at + revert.embed.len()),
            revert.table.clone(),
        )],
    );
    if mode.is_dry_run() {
        let mut plan = CommandPlan::of_edits(
            one(P_TABLE_SHEET_UNDO, A_SHEET, revert.sheet.as_str()),
            vec![PlannedEdit {
                doc: revert.doc.clone(),
                edit,
            }],
        );
        plan.docs.insert(0, revert.sheet.clone());
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
    let entry = host.trash_document_if(&revert.sheet, &revert.sheet_revision)?;
    if let Err(error) = host.apply_edit(&revert.doc, edit) {
        // La nota non si è scritta: il foglio torna dov'era.
        if let Err(restore) = host.restore_document(&entry, Some(revert.sheet.clone())) {
            return Err(PluginError::Internal(Text::message(
                E_SHEET_REVERT,
                vec![
                    Arg::text(A_SHEET, revert.sheet.as_str()),
                    Arg::text(A_ENTRY, entry.as_str()),
                    Arg::text(A_REASON, restore.to_string()),
                ],
            )));
        }
        return Err(error);
    }
    Ok(CommandOutcome::notify(one(
        D_TABLE_SHEET_UNDONE,
        A_SHEET,
        revert.sheet.as_str(),
    )))
}

/// Il foglio appena scritto torna nel cestino, perché la nota non è cambiata:
/// l'errore che resta è quello della nota, e se anche il cestino fallisce lo
/// dice.
fn rolled_back(
    host: &mut dyn HostApi,
    sheet: &DocId,
    revision: &Revision,
    error: PluginError,
) -> PluginError {
    match host.trash_document_if(sheet, revision) {
        Ok(_) => error,
        Err(and) => PluginError::Internal(Text::message(
            E_SHEET_WRITE,
            vec![
                Arg::text(A_SHEET, sheet.as_str()),
                Arg::text(A_REASON, format!("{error}; {and}")),
            ],
        )),
    }
}

/// Il nome del foglio che nasce: quello della nota, con `.xlsx`, nella sua
/// cartella, e libero (`Conti 1.xlsx` se `Conti.xlsx` c'è già). Un nome di
/// nota che la regola dei nomi nuovi non ammette lascia il posto al nome di
/// riserva del catalogo, nella stessa cartella.
fn sheet_name(host: &dyn HostApi, doc: &DocId) -> Result<DocId, PluginError> {
    let folder = folders::parent(doc.as_str());
    let placed = |stem: &str| {
        let name = format!("{stem}.{EXTENSION}");
        if folder.is_empty() {
            name
        } else {
            format!("{folder}/{name}")
        }
    };
    let file = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    let wanted = Some(placed(stem))
        .filter(|name| !stem.trim().is_empty() && path_policy::check(name, Naming::New).is_ok())
        .unwrap_or_else(|| placed(&label(host, N_TABLE_FILE)));
    let sheet = host.free_name(&DocId::new(path_policy::normalized(&wanted)));
    let is_sheet = host
        .format_of(&sheet)
        .is_some_and(|format| format.descriptor.id == fub_format_xlsx::FORMAT_ID);
    if !is_sheet {
        return Err(PluginError::BadArgs(Text::key(E_SHEET_NO_FORMAT)));
    }
    Ok(sheet)
}

/// Come la nota nomina il foglio: il nome del file con l'estensione, se il
/// vault lo risolve proprio a lui, sennò il percorso intero. Mai il nome senza
/// estensione: accanto a `Conti.md` porterebbe alla nota.
fn reference(host: &dyn HostApi, sheet: &DocId) -> String {
    let path = sheet.as_str();
    let Some(file) = path.rsplit('/').next().filter(|file| *file != path) else {
        return path.to_string();
    };
    match host.query_index(IndexQuery::Resolve {
        target: LinkTarget::wiki(file),
        from: None,
    }) {
        Ok(IndexResult::Resolved(Some(found))) if found.doc == *sheet => file.to_string(),
        _ => path.to_string(),
    }
}

/// L'embed della parte di foglio, nella sintassi della nota.
fn embed_text(
    host: &dyn HostApi,
    doc: &DocId,
    page: &str,
    part: &str,
) -> Result<String, PluginError> {
    let link = LinkInsert {
        target: LinkTarget::Wiki {
            page: page.to_string(),
            heading: Some(part.to_string()),
            block: None,
        },
        label: None,
        embed: true,
    };
    crate::formats::link_text(host, doc, &link)
}

/// La fine di `start..end` senza gli a capo in coda.
fn trimmed_end(source: &str, start: usize, end: usize) -> usize {
    let bytes = source.as_bytes();
    let mut end = end.min(source.len());
    while end > start && matches!(bytes[end - 1], b'\n' | b'\r') {
        end -= 1;
    }
    end
}

/// I byte `start..end` (senza gli a capo in coda) sono una tabella intera
/// della nota, a qualunque profondità (dentro una citazione, un callout, una
/// voce di elenco)? Dentro una citazione i segni `>` delle righe dopo la
/// prima stanno nei byte della tabella, e l'embed che la sostituisce sta su
/// una riga sola, dopo il segno della prima.
fn is_table(blocks: &[Block], source: &str, start: usize, end: usize) -> bool {
    blocks.iter().any(|block| match block {
        Block::Table { span, .. } => {
            // Lo span finisce sull'ultima cella: la tabella arriva a fine riga.
            let line_end = source[span.end.min(source.len())..]
                .find('\n')
                .map_or(source.len(), |at| span.end + at);
            span.start == start && trimmed_end(source, span.start, line_end) == end
        }
        Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
            is_table(blocks, source, start, end)
        }
        Block::List { items, .. } => items
            .iter()
            .any(|item| is_table(&item.blocks, source, start, end)),
        _ => false,
    })
}

/// Una voce del catalogo nella lingua di chi usa Fub.
fn label(host: &dyn HostApi, key: &str) -> String {
    Strings::new(&catalog(), "it", &host.user_locale()).render(&Text::key(key))
}

/// Perché i valori non sono diventati un foglio, in una frase.
fn values_error(sheet: &DocId, error: ValuesError) -> PluginError {
    match error {
        ValuesError::Empty => PluginError::BadArgs(Text::key(E_SHEET_EMPTY)),
        ValuesError::TooLarge { rows, columns } => PluginError::BadArgs(Text::message(
            E_SHEET_TOO_LARGE,
            vec![
                Arg::int(A_ROWS, rows as i64),
                Arg::int(A_COLUMNS, columns as i64),
            ],
        )),
        ValuesError::TooLong { cell } => PluginError::BadArgs(one(E_SHEET_TOO_LONG, A_CELL, &cell)),
        ValuesError::NotFinite { cell } | ValuesError::Currency { cell } => {
            PluginError::BadArgs(one(E_SHEET_CELL, A_CELL, &cell))
        }
        other => PluginError::Internal(Text::message(
            E_SHEET_WRITE,
            vec![
                Arg::text(A_SHEET, sheet.as_str()),
                Arg::text(A_REASON, other.to_string()),
            ],
        )),
    }
}

/// Le stringhe di «Trasforma in foglio», in italiano.
pub(super) fn catalog_it(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with("note.table.sheet.title", "Trasforma in foglio")
        .with(
            "note.table.sheet.desc",
            "Mette la tabella in un foglio nuovo accanto alla nota, coi suoi \
             valori e i loro formati, e al suo posto lascia la scheda del \
             foglio. Un annullamento rimette la tabella e cestina il foglio.",
        )
        .with("note.table.sheet.doc.title", "Nota")
        .with("note.table.sheet.doc.desc", "Vuoto: la nota aperta.")
        .with("note.table.sheet.at.title", "Byte della tabella")
        .with(
            "note.table.sheet.at.desc",
            "Inizio e fine della tabella in byte.",
        )
        .with("note.table.sheet.text.title", "Testo della tabella")
        .with(
            "note.table.sheet.text.desc",
            "Il testo letto fra quei byte: se la nota è cambiata, non si \
             scrive niente.",
        )
        .with("note.table.sheet.cells.title", "Valori")
        .with(
            "note.table.sheet.cells.desc",
            "Le righe della tabella in JSON, già lette nella lingua della \
             nota: un testo, oppure un numero col suo aspetto.",
        )
        .with("note.table.sheet.revert.title", "Annullamento")
        .with(
            "note.table.sheet.revert.desc",
            "Lo scrive l'annullamento della trasformazione: non si compila a mano.",
        )
        .with(N_FIRST_SHEET, "Foglio1")
        .with(N_TABLE_FILE, "Tabella")
        .with(
            E_SHEET_NO_CELLS,
            "«Trasforma in foglio» parte da una tabella: aprilo dal menu della \
             tabella.",
        )
        .with(
            E_SHEET_NO_FORMAT,
            "Questo vault non apre i fogli di calcolo: accendi «Fogli» nelle \
             impostazioni, poi riprova.",
        )
        .with(
            E_SHEET_NOT_TABLE,
            "Quei byte non sono una tabella intera: riapri il menu della tabella \
             e riprova.",
        )
        .with(
            E_SHEET_CHANGED,
            "«{doc}» è cambiata e la tabella non è più lì: non si è scritto \
             niente. Riprova.",
        )
        .with(
            E_SHEET_CELLS,
            "I valori della tabella non si leggono: {reason}",
        )
        .with(
            E_SHEET_EMPTY,
            "La tabella è vuota: non c'è niente da mettere in un foglio.",
        )
        .with(
            E_SHEET_TOO_LARGE,
            "Righe: {rows}, colonne: {columns}. Sono più di quante un foglio ne \
             tenga.",
        )
        .with(
            E_SHEET_TOO_LONG,
            "Il testo della cella {cell} è più lungo di quanto una cella di un \
             foglio tenga (32.767 caratteri): accorcialo, poi riprova.",
        )
        .with(
            E_SHEET_CELL,
            "Il valore della cella {cell} non si scrive in un foglio: scrivilo \
             come testo, poi riprova.",
        )
        .with(
            E_SHEET_WRITE,
            "Il foglio «{sheet}» non si è potuto scrivere: {reason}",
        )
        .with(
            E_SHEET_REVERT,
            "La tabella non è tornata nella nota e il foglio «{sheet}» è rimasto \
             nel cestino ({entry}): ripristinalo da lì. Motivo: {reason}",
        )
        .with(
            E_UNDO_SHEET_CHANGED,
            "«{sheet}» è cambiato dopo la trasformazione: l'annullamento non \
             tocca niente, né il foglio né la nota.",
        )
        .with(
            E_UNDO_SHEET_GONE,
            "«{sheet}» non c'è più: l'annullamento non tocca niente, né il \
             foglio né la nota.",
        )
        .with(
            E_UNDO_NOTE_CHANGED,
            "In «{doc}» la scheda del foglio non c'è più o è cambiata: \
             l'annullamento non tocca niente, né il foglio né la nota.",
        )
        .with(P_TABLE_SHEET, "Trasforma la tabella nel foglio «{sheet}»")
        .with(
            P_TABLE_SHEET_UNDO,
            "Rimetti la tabella e cestina il foglio «{sheet}»",
        )
        .with(
            D_TABLE_SHEET,
            "La tabella ora sta nel foglio «{sheet}», accanto alla nota.",
        )
        .with(
            D_TABLE_SHEET_UNDONE,
            "La tabella è tornata nella nota e «{sheet}» è nel cestino.",
        )
        .with(U_TABLE_SHEET, "la tabella diventata «{sheet}»")
}

/// Le stringhe di «Trasforma in foglio», in inglese.
pub(super) fn catalog_en(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with("note.table.sheet.title", "Turn into a sheet")
        .with(
            "note.table.sheet.desc",
            "Puts the table in a new sheet next to the note, with its values \
             and their formats, and leaves the sheet card in its place. Undo \
             puts the table back and moves the sheet to the trash.",
        )
        .with("note.table.sheet.doc.title", "Note")
        .with("note.table.sheet.doc.desc", "Empty: the open note.")
        .with("note.table.sheet.at.title", "Table bytes")
        .with(
            "note.table.sheet.at.desc",
            "Start and end of the table in bytes.",
        )
        .with("note.table.sheet.text.title", "Table text")
        .with(
            "note.table.sheet.text.desc",
            "The text read between those bytes: if the note changed, nothing \
             is written.",
        )
        .with("note.table.sheet.cells.title", "Values")
        .with(
            "note.table.sheet.cells.desc",
            "The table rows in JSON, already read in the note's language: a \
             text, or a number with its look.",
        )
        .with("note.table.sheet.revert.title", "Undo")
        .with(
            "note.table.sheet.revert.desc",
            "Written by the undo of the change: not to be filled in by hand.",
        )
        .with(N_FIRST_SHEET, "Sheet1")
        .with(N_TABLE_FILE, "Table")
        .with(
            E_SHEET_NO_CELLS,
            "“Turn into a sheet” starts from a table: open it from the table menu.",
        )
        .with(
            E_SHEET_NO_FORMAT,
            "This vault does not open spreadsheets: turn on “Spreadsheets” in \
             the settings, then try again.",
        )
        .with(
            E_SHEET_NOT_TABLE,
            "Those bytes are not a whole table: open the table menu again and \
             try again.",
        )
        .with(
            E_SHEET_CHANGED,
            "“{doc}” changed and the table is no longer there: nothing was \
             written. Try again.",
        )
        .with(E_SHEET_CELLS, "The table values cannot be read: {reason}")
        .with(
            E_SHEET_EMPTY,
            "The table is empty: there is nothing to put in a sheet.",
        )
        .with(
            E_SHEET_TOO_LARGE,
            "Rows: {rows}, columns: {columns}. That is more than a sheet holds.",
        )
        .with(
            E_SHEET_TOO_LONG,
            "The text of cell {cell} is longer than a sheet cell holds (32,767 \
             characters): shorten it, then try again.",
        )
        .with(
            E_SHEET_CELL,
            "The value of cell {cell} cannot be written in a sheet: write it as \
             text, then try again.",
        )
        .with(
            E_SHEET_WRITE,
            "The sheet “{sheet}” could not be written: {reason}",
        )
        .with(
            E_SHEET_REVERT,
            "The table did not go back into the note and the sheet “{sheet}” \
             stayed in the trash ({entry}): restore it from there. Reason: \
             {reason}",
        )
        .with(
            E_UNDO_SHEET_CHANGED,
            "“{sheet}” changed after the change: undo touches nothing, neither \
             the sheet nor the note.",
        )
        .with(
            E_UNDO_SHEET_GONE,
            "“{sheet}” is gone: undo touches nothing, neither the sheet nor the \
             note.",
        )
        .with(
            E_UNDO_NOTE_CHANGED,
            "In “{doc}” the sheet card is gone or changed: undo touches nothing, \
             neither the sheet nor the note.",
        )
        .with(P_TABLE_SHEET, "Turn the table into the sheet “{sheet}”")
        .with(
            P_TABLE_SHEET_UNDO,
            "Put the table back and move the sheet “{sheet}” to the trash",
        )
        .with(
            D_TABLE_SHEET,
            "The table now lives in the sheet “{sheet}”, next to the note.",
        )
        .with(
            D_TABLE_SHEET_UNDONE,
            "The table is back in the note and “{sheet}” is in the trash.",
        )
        .with(U_TABLE_SHEET, "the table turned into “{sheet}”")
}
