//! La Scrivania (E17): una vista dell'area principale fatta di riquadri —
//! appuntate, recenti, compiti di oggi, una Base scelta, il mese — che si
//! tolgono, si rimettono e si ordinano.
//!
//! # Chi possiede che cosa
//!
//! - **L'ordine e i riquadri tolti** sono un'impostazione del vault
//!   ([`DESK_TILES_KEY`]): l'elenco dei riquadri mostrati, nell'ordine. Un
//!   riquadro che non c'è è tolto; un id che questa versione non conosce si
//!   ignora, e un doppione conta una volta sola. La Base scelta è
//!   [`DESK_BASE_KEY`], il path del suo file.
//! - **Il disegno di un riquadro** è un `UiNode` di oggi: il titolo, la riga
//!   di comandi, il contenuto. La riga di comandi è un `Custom` del ns
//!   [`DESK_TILE_NS`]: una shell che lo conosce ci disegna la maniglia da
//!   trascinare, i tasti Ctrl Maiusc ↑↓ e «Togli»; una che non lo conosce
//!   disegna il ripiego, tre bottoni con le stesse azioni. Il payload porta
//!   **un'azione già pronta per ogni posto** in cui il riquadro può andare
//!   (`moves`), così la shell non scrive niente in un payload: sceglie quale
//!   azione premere.
//! - **I dati** passano dal canale di tutti: l'organizzazione (le appuntate),
//!   l'anagrafe (le recenti, le Basi), l'indice (i compiti che scadono oggi),
//!   il modello di quelle note. Una Base si disegna col `Custom` che la shell
//!   sa già disegnare in una nota (`fub:base`).
//!
//! La vista non scrive niente fuori dalle sue due impostazioni. Si ridisegna
//! all'apertura, a ogni evento dell'indice e quando cambia un'impostazione:
//! mai per battuta.

use fub_abi::error::PluginError;
use fub_abi::locale::{civil_from_days, days_from_civil, days_in_month};
use fub_abi::model::{Block, DocumentModel};
use fub_abi::query::{DueBound, QueryExpr, QueryPredicate};
use fub_abi::rules::tasks::{iso_day, task_due, task_text};
use fub_abi::settings::{SettingKind, SettingSpec, SettingValue};
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{
    EntryKind, Excerpts, HostApi, IndexQuery, IndexResult, Page, PropertySelect, ReadApi,
    ViewInstance, ViewSpec, ViewSurface,
};
use fub_abi::ui::{
    ActionRef, Align, Intent, TableColumn, UiAction, UiKind, UiNode, UiOption, UiValue, ViewUpdate,
};
use fub_abi::DocId;
use serde_json::json;

/// Id della `ViewSpec` della Scrivania.
pub const DESK_VIEW: &str = "desk";
/// Il ns della riga di comandi di un riquadro: la maniglia, i tasti, «Togli».
pub const DESK_TILE_NS: &str = "fub:desk-tile";
/// I riquadri mostrati, nell'ordine (vault).
pub const DESK_TILES_KEY: &str = "desk.tiles";
/// Il path della Base del riquadro «Base» (vault); vuoto = nessuna.
pub const DESK_BASE_KEY: &str = "desk.base";
/// Il ns con cui la shell disegna una Base incorporata.
const BASE_NS: &str = "fub:base";
/// Il comando che apre (o crea) la giornaliera di un giorno: di `template`.
const NOTE_DAILY: &str = "note.daily";

/// Quante righe mostra un elenco: le altre si contano.
pub const DESK_ROWS: usize = 8;
/// Quante note con un compito di oggi si leggono: leggere un modello costa, e
/// la vista si ridisegna a ogni salvataggio.
pub const DESK_TASK_NOTES: u32 = 20;
/// Quante Basi offre la scelta.
pub const DESK_BASE_CHOICES: usize = 200;

const DAY_MS: i64 = 86_400_000;

// --- i gesti ----------------------------------------------------------------

const A_MOVE: &str = "desk.move";
const A_HIDE: &str = "desk.hide";
const A_SHOW: &str = "desk.show";
const A_OPEN: &str = "desk.open";
const A_DAY: &str = "desk.day";
const A_BASE: &str = "desk.base";
const F_BASE: &str = "base";
const P_TILE: &str = "tile";
const P_TO: &str = "to";
const P_DOC: &str = "doc";
const P_DATE: &str = "date";

// --- le stringhe --------------------------------------------------------------

pub(super) const S_TITLE: &str = "desk.title";
const S_EMPTY: &str = "desk.empty";
const S_EMPTY_DETAIL: &str = "desk.empty.detail";
const S_HIDDEN: &str = "desk.hidden";
const S_UP: &str = "desk.up";
const S_DOWN: &str = "desk.down";
const S_HIDE: &str = "desk.hide";
const S_MORE: &str = "desk.more";
const S_PINNED_NONE: &str = "desk.pinned.none";
const S_PINNED_NONE_DETAIL: &str = "desk.pinned.none.detail";
const S_RECENT_NONE: &str = "desk.recent.none";
const S_TASKS_NONE: &str = "desk.tasks.none";
const S_TASKS_UNSERVED: &str = "desk.tasks.unserved";
const S_TASKS_FAILED: &str = "desk.tasks.failed";
const S_TILE_FAILED: &str = "desk.tile.failed";
const S_TASKS_UNREAD: &str = "desk.tasks.unread";
const S_BASE_CHOOSE: &str = "desk.base.choose";
const S_BASE_UNSET: &str = "desk.base.unset";
const S_BASE_NONE: &str = "desk.base.none";
const S_BASE_NONE_DETAIL: &str = "desk.base.none.detail";
const S_BASE_MISSING: &str = "desk.base.missing";
const S_BASE_MISSING_DETAIL: &str = "desk.base.missing.detail";
const S_BASE_NO_FILES: &str = "desk.base.no_files";
const S_BASE_NO_FILES_DETAIL: &str = "desk.base.no_files.detail";
const S_BASE_OPEN: &str = "desk.base.open";
const S_SETTINGS_GROUP: &str = "desk.settings.group";
const S_TILES_SETTING: &str = "desk.settings.tiles";
const S_TILES_SETTING_DESC: &str = "desk.settings.tiles.desc";
const S_BASE_SETTING: &str = "desk.settings.base";
const S_BASE_SETTING_DESC: &str = "desk.settings.base.desc";

/// Un riquadro della Scrivania. L'ordine di dichiarazione è quello di chi non
/// ha mai toccato niente.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tile {
    Pinned,
    Recent,
    Tasks,
    Base,
    Month,
}

impl Tile {
    pub const ALL: [Tile; 5] = [
        Tile::Pinned,
        Tile::Recent,
        Tile::Tasks,
        Tile::Base,
        Tile::Month,
    ];

    /// L'id scritto nell'impostazione: non cambia mai.
    pub fn id(self) -> &'static str {
        match self {
            Tile::Pinned => "pinned",
            Tile::Recent => "recent",
            Tile::Tasks => "tasks",
            Tile::Base => "base",
            Tile::Month => "month",
        }
    }

    pub fn from_id(id: &str) -> Option<Tile> {
        Tile::ALL.into_iter().find(|tile| tile.id() == id)
    }

    fn title(self) -> Text {
        Text::key(format!("desk.tile.{}", self.id()))
    }
}

/// La dichiarazione: nell'area principale, senza parametri, quindi si apre
/// dalla palette, dal menu Vista e dalla barra.
pub(super) fn spec() -> ViewSpec {
    ViewSpec::new(DESK_VIEW, Text::key(S_TITLE), ViewSurface::Main).with_icon("dashboard")
}

/// Le due impostazioni della Scrivania, del vault e scrivibili dalla vista.
pub fn settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            DESK_TILES_KEY,
            Text::key(S_TILES_SETTING),
            SettingKind::List {
                default: Tile::ALL.iter().map(|tile| tile.id().to_string()).collect(),
            },
        )
        .describing(Text::key(S_TILES_SETTING_DESC))
        .grouped(Text::key(S_SETTINGS_GROUP))
        .program_writable(),
        SettingSpec::new(
            DESK_BASE_KEY,
            Text::key(S_BASE_SETTING),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(S_BASE_SETTING_DESC))
        .grouped(Text::key(S_SETTINGS_GROUP))
        .program_writable(),
    ]
}

/// Le stringhe della Scrivania, da unire al catalogo del componente.
pub(super) fn strings(language: &str) -> Vec<(&'static str, &'static str)> {
    let it = language == "it";
    let pick = |it_text: &'static str, en_text: &'static str| if it { it_text } else { en_text };
    let mut out = vec![
        (S_TITLE, pick("Scrivania", "Desk")),
        ("desk.tile.pinned", pick("Appuntate", "Pinned")),
        ("desk.tile.recent", pick("Recenti", "Recent")),
        ("desk.tile.tasks", pick("Compiti di oggi", "Today's tasks")),
        ("desk.tile.base", pick("Base", "Base")),
        ("desk.tile.month", pick("Il mese", "This month")),
        (S_EMPTY, pick("La Scrivania è vuota", "The desk is empty")),
        (
            S_EMPTY_DETAIL,
            pick(
                "Rimetti un riquadro con i bottoni qui sotto.",
                "Bring a tile back with the buttons below.",
            ),
        ),
        (S_HIDDEN, pick("Rimetti:", "Bring back:")),
        (S_UP, pick("Sposta su", "Move up")),
        (S_DOWN, pick("Sposta giù", "Move down")),
        (S_HIDE, pick("Togli", "Remove")),
        (S_MORE, pick("e altre {count}", "and {count} more")),
        (S_PINNED_NONE, pick("Nessuna nota appuntata", "No pinned notes")),
        (
            S_PINNED_NONE_DETAIL,
            pick(
                "Le note che appunti compaiono qui.",
                "The notes you pin show up here.",
            ),
        ),
        (S_RECENT_NONE, pick("Nessuna nota nel vault", "No notes in the vault")),
        (S_TASKS_NONE, pick("Nessun compito per oggi", "No tasks for today")),
        (
            S_TASKS_UNSERVED,
            pick(
                "I compiti si leggono con la ricerca, che in questo vault è spenta.",
                "Tasks are read through search, which is off in this vault.",
            ),
        ),
        (
            S_TILE_FAILED,
            pick(
                "Questo riquadro non si legge adesso. Si riprova al prossimo cambiamento del vault.",
                "This tile can't be read right now. It is read again at the next change in the vault.",
            ),
        ),
        (
            S_TASKS_FAILED,
            pick(
                "I compiti di oggi non si leggono adesso. Si riprova al prossimo cambiamento del vault.",
                "Today's tasks can't be read right now. They are read again at the next change in the vault.",
            ),
        ),
        (
            S_TASKS_UNREAD,
            pick(
                "Altre {count} note hanno compiti per oggi.",
                "{count} more notes have tasks for today.",
            ),
        ),
        (S_BASE_CHOOSE, pick("Base da mostrare", "Base to show")),
        (S_BASE_UNSET, pick("Nessuna", "None")),
        (S_BASE_NONE, pick("Nessuna Base scelta", "No Base chosen")),
        (
            S_BASE_NONE_DETAIL,
            pick(
                "Scegli qui sotto quale Base mostrare.",
                "Choose below which Base to show.",
            ),
        ),
        (S_BASE_MISSING, pick("La Base scelta non c'è più", "The chosen Base is gone")),
        (
            S_BASE_MISSING_DETAIL,
            pick(
                "«{name}» è stata spostata o cancellata. Scegline un'altra qui sotto.",
                "“{name}” was moved or deleted. Choose another one below.",
            ),
        ),
        (S_BASE_NO_FILES, pick("Nel vault non c'è nessuna Base", "There is no Base in the vault")),
        (
            S_BASE_NO_FILES_DETAIL,
            pick(
                "Crea una Base: comparirà qui da scegliere.",
                "Create a Base: it will show up here to choose.",
            ),
        ),
        (S_BASE_OPEN, pick("Apri la Base", "Open the Base")),
        (S_SETTINGS_GROUP, pick("Scrivania", "Desk")),
        (S_TILES_SETTING, pick("Riquadri della Scrivania", "Desk tiles")),
        (
            S_TILES_SETTING_DESC,
            pick(
                "I riquadri mostrati, nell'ordine: pinned, recent, tasks, base, month.",
                "The tiles shown, in order: pinned, recent, tasks, base, month.",
            ),
        ),
        (S_BASE_SETTING, pick("Base della Scrivania", "Desk Base")),
        (
            S_BASE_SETTING_DESC,
            pick(
                "Il percorso del file .base mostrato nel riquadro «Base».",
                "The path of the .base file shown in the “Base” tile.",
            ),
        ),
    ];
    // Il mese col suo anno: la frase intera per lingua, perché l'ordine delle
    // due parti non è lo stesso dappertutto.
    let months_it = [
        "Gennaio {year}",
        "Febbraio {year}",
        "Marzo {year}",
        "Aprile {year}",
        "Maggio {year}",
        "Giugno {year}",
        "Luglio {year}",
        "Agosto {year}",
        "Settembre {year}",
        "Ottobre {year}",
        "Novembre {year}",
        "Dicembre {year}",
    ];
    let months_en = [
        "January {year}",
        "February {year}",
        "March {year}",
        "April {year}",
        "May {year}",
        "June {year}",
        "July {year}",
        "August {year}",
        "September {year}",
        "October {year}",
        "November {year}",
        "December {year}",
    ];
    let weekdays_it = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    let weekdays_en = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (i, key) in MONTH_KEYS.iter().enumerate() {
        out.push((key, if it { months_it[i] } else { months_en[i] }));
    }
    for (i, key) in WEEKDAY_KEYS.iter().enumerate() {
        out.push((key, if it { weekdays_it[i] } else { weekdays_en[i] }));
    }
    out
}

const MONTH_KEYS: [&str; 12] = [
    "desk.month.1",
    "desk.month.2",
    "desk.month.3",
    "desk.month.4",
    "desk.month.5",
    "desk.month.6",
    "desk.month.7",
    "desk.month.8",
    "desk.month.9",
    "desk.month.10",
    "desk.month.11",
    "desk.month.12",
];
/// Lunedì = 1, come la settimana ISO.
const WEEKDAY_KEYS: [&str; 7] = [
    "desk.weekday.1",
    "desk.weekday.2",
    "desk.weekday.3",
    "desk.weekday.4",
    "desk.weekday.5",
    "desk.weekday.6",
    "desk.weekday.7",
];

// ---------------------------------------------------------------------------
// L'ordine
// ---------------------------------------------------------------------------

/// I riquadri mostrati, nell'ordine dell'impostazione: gli id sconosciuti
/// fuori, i doppioni una volta sola.
pub fn shown_tiles(host: &dyn ReadApi) -> Result<Vec<Tile>, PluginError> {
    let ids = match host.setting(DESK_TILES_KEY) {
        Ok(SettingValue::List(ids)) => ids,
        // Chiave non dichiarata (un host senza le impostazioni della
        // Scrivania) o di un altro tipo: valgono tutti i riquadri, in ordine.
        _ => return Ok(Tile::ALL.to_vec()),
    };
    Ok(tiles_of(&ids))
}

fn tiles_of(ids: &[String]) -> Vec<Tile> {
    let mut out: Vec<Tile> = Vec::new();
    for tile in ids.iter().filter_map(|id| Tile::from_id(id)) {
        if !out.contains(&tile) {
            out.push(tile);
        }
    }
    out
}

/// L'ordine dopo aver portato `tile` al posto `to` (contato nell'ordine di
/// prima, tagliato agli estremi). Un riquadro tolto non si sposta.
pub fn moved(tiles: &[Tile], tile: Tile, to: usize) -> Vec<Tile> {
    let mut out = tiles.to_vec();
    let Some(from) = out.iter().position(|t| *t == tile) else {
        return out;
    };
    let item = out.remove(from);
    out.insert(to.min(out.len()), item);
    out
}

fn write_tiles(host: &mut dyn HostApi, tiles: &[Tile]) -> Result<(), PluginError> {
    host.set_setting(
        DESK_TILES_KEY,
        SettingValue::List(tiles.iter().map(|tile| tile.id().to_string()).collect()),
    )
}

// ---------------------------------------------------------------------------
// Il disegno
// ---------------------------------------------------------------------------

/// La Scrivania intera.
pub(super) fn render(instance: &ViewInstance, host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let tiles = shown_tiles(host)?;
    let today = today(host);
    let mut children = Vec::new();
    if tiles.is_empty() {
        children.push(UiNode::keyed(
            "desk-empty",
            UiKind::EmptyState {
                title: Text::key(S_EMPTY),
                detail: Some(Text::key(S_EMPTY_DETAIL)),
                action: None,
            },
        ));
    } else {
        let count = tiles.len();
        let frames = tiles
            .iter()
            .enumerate()
            .map(|(at, tile)| {
                // Un riquadro che non si legge lo dice dentro di sé: gli altri
                // si vedono lo stesso, e lui si può spostare o togliere.
                let body = tile_body(*tile, host, today)
                    .unwrap_or_else(|_| vec![UiNode::text(Text::key(S_TILE_FAILED))]);
                frame(instance, *tile, at, count, body)
            })
            .collect::<Vec<_>>();
        children.push(UiNode::keyed(
            "desk-board",
            UiKind::Stack {
                dir: fub_abi::ui::Axis::Row,
                gap: 12,
                children: frames,
            },
        ));
    }
    let hidden: Vec<Tile> = Tile::ALL
        .into_iter()
        .filter(|tile| !tiles.contains(tile))
        .collect();
    if !hidden.is_empty() {
        let mut row = vec![UiNode::text(Text::key(S_HIDDEN))];
        row.extend(hidden.into_iter().map(|tile| {
            UiNode::button(
                tile.title(),
                Intent::Neutral,
                ActionRef::with(A_SHOW, json!({ P_TILE: tile.id() })),
            )
            .with_key(format!("desk-show:{}", tile.id()))
        }));
        children.push(UiNode::keyed(
            "desk-hidden",
            UiKind::Stack {
                dir: fub_abi::ui::Axis::Row,
                gap: 6,
                children: row,
            },
        ));
    }
    Ok(UiNode::column(12, children))
}

/// Un riquadro: la testata (titolo e comandi) e il contenuto. La chiave
/// `desk:<id>` è la stessa che il payload dei comandi nomina (`frame`): è
/// l'elemento che la shell tratta come riquadro.
fn frame(
    instance: &ViewInstance,
    tile: Tile,
    at: usize,
    count: usize,
    body: Vec<UiNode>,
) -> UiNode {
    let key = format!("desk:{}", tile.id());
    let moves: Vec<ActionRef> = (0..count)
        .map(|to| ActionRef::with(A_MOVE, json!({ P_TILE: tile.id(), P_TO: to })))
        .collect();
    let hide = ActionRef::with(A_HIDE, json!({ P_TILE: tile.id() }));
    let mut fallback = Vec::new();
    if at > 0 {
        fallback.push(UiNode::button(
            Text::key(S_UP),
            Intent::Neutral,
            moves[at - 1].clone(),
        ));
    }
    if at + 1 < count {
        fallback.push(UiNode::button(
            Text::key(S_DOWN),
            Intent::Neutral,
            moves[at + 1].clone(),
        ));
    }
    fallback.push(UiNode::button(
        Text::key(S_HIDE),
        Intent::Neutral,
        hide.clone(),
    ));
    let commands = UiNode::keyed(
        format!("{key}:commands"),
        UiKind::Custom {
            ns: DESK_TILE_NS.into(),
            payload: json!({
                "desk": instance.instance,
                "frame": key,
                "tile": tile.id(),
                "at": at,
                "moves": moves,
                "hide": hide,
            }),
            fallback,
        },
    );
    let head = UiNode::keyed(
        format!("{key}:head"),
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Row,
            gap: 8,
            children: vec![UiNode::heading(3, tile.title()), commands],
        },
    );
    let mut children = vec![head];
    children.extend(body);
    UiNode::keyed(
        key,
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Column,
            gap: 6,
            children,
        },
    )
}

fn tile_body(tile: Tile, host: &dyn ReadApi, today: i64) -> Result<Vec<UiNode>, PluginError> {
    match tile {
        Tile::Pinned => pinned(host),
        Tile::Recent => recent(host),
        Tile::Tasks => Ok(tasks(host, today)),
        Tile::Base => base(host),
        Tile::Month => Ok(month(host, today)),
    }
}

/// Il giorno di chi guarda, in giorni dall'epoca.
fn today(host: &dyn ReadApi) -> i64 {
    host.user_locale()
        .to_civil_millis(host.now_unix_millis())
        .div_euclid(DAY_MS)
}

fn open(doc: &DocId) -> Option<ActionRef> {
    Some(ActionRef::with(A_OPEN, json!({ P_DOC: doc.as_str() })))
}

/// La cartella di una nota, come sottotitolo; niente alla radice.
fn folder(doc: &DocId) -> Option<Text> {
    let path = doc.as_str();
    path.rfind('/')
        .map(|slash| Text::from(path[..slash].to_string()))
}

fn note_row(doc: &DocId, subtitle: Option<Text>, key: String) -> UiNode {
    UiNode::list_item(Text::from(doc.page_name().to_string()), subtitle, open(doc))
        .with_key(key)
        .dragging_document(doc.clone())
}

/// Le righe, al più [`DESK_ROWS`], e la riga che conta le altre.
fn rows(items: Vec<UiNode>, total: usize) -> Vec<UiNode> {
    let shown = items.len();
    let mut out = vec![UiNode::list(items)];
    if total > shown {
        out.push(UiNode::text(Text::message(
            S_MORE,
            vec![count(total - shown)],
        )));
    }
    out
}

fn count(n: usize) -> Arg {
    Arg::int("count", i64::try_from(n).unwrap_or(i64::MAX))
}

fn empty(title: &str, detail: Option<Text>) -> UiNode {
    UiNode::new(UiKind::EmptyState {
        title: Text::key(title),
        detail,
        action: None,
    })
}

// --- Appuntate ----------------------------------------------------------------

fn pinned(host: &dyn ReadApi) -> Result<Vec<UiNode>, PluginError> {
    let organization = match host.query_index(IndexQuery::Organization)? {
        IndexResult::Organization(organization) => organization,
        other => return super::unexpected_result("organization", other),
    };
    if organization.pinned.is_empty() {
        return Ok(vec![empty(
            S_PINNED_NONE,
            Some(Text::key(S_PINNED_NONE_DETAIL)),
        )]);
    }
    let total = organization.pinned.len();
    let items = organization
        .pinned
        .iter()
        .take(DESK_ROWS)
        .map(|path| {
            let doc = DocId::new(path.clone());
            note_row(&doc, folder(&doc), format!("pinned:{path}"))
        })
        .collect();
    Ok(rows(items, total))
}

// --- Recenti ------------------------------------------------------------------

fn recent(host: &dyn ReadApi) -> Result<Vec<UiNode>, PluginError> {
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: Some(EntryKind::Document),
        within: None,
        page: None,
    })? {
        IndexResult::Entries(entries) => entries,
        other => return super::unexpected_result("entries", other),
    };
    if entries.items.is_empty() {
        return Ok(vec![empty(S_RECENT_NONE, None)]);
    }
    let mut items = entries.items;
    // Il più recente in cima; a parità, il path decide, così l'ordine non
    // salta da un ridisegno all'altro.
    items.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| a.id.cmp(&b.id)));
    let locale = host.user_locale();
    let rows_shown = items
        .iter()
        .take(DESK_ROWS)
        .map(|entry| {
            note_row(
                &entry.id,
                Some(Text::from(locale.format_timestamp(entry.mtime))),
                format!("recent:{}", entry.id.as_str()),
            )
        })
        .collect();
    // Le recenti non si contano: «e altre 3.000» non direbbe niente.
    Ok(vec![UiNode::list(rows_shown)])
}

// --- Compiti di oggi --------------------------------------------------------------

/// Un compito aperto che scade oggi.
#[derive(Debug, PartialEq, Eq)]
pub struct DueTask {
    pub doc: DocId,
    pub at: usize,
    pub text: String,
}

/// I compiti aperti di un modello che scadono il giorno `day` (giorni
/// dall'epoca), ovunque nell'albero: liste annidate, citazioni, blocchi
/// custom. La scadenza la legge la regola del contratto ([`task_due`]).
pub fn due_on(model: &DocumentModel, doc: &DocId, day: i64) -> Vec<DueTask> {
    let mut found = Vec::new();
    let mut pending: Vec<&Block> = model.body.iter().rev().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items.iter().rev() {
                    pending.extend(item.blocks.iter().rev());
                }
                for item in items {
                    let Some(marker) = item.task else { continue };
                    if marker.checked() {
                        continue;
                    }
                    let text = task_text(&item.blocks);
                    let Some(due) = task_due(&text) else { continue };
                    if due.day != Some(day) {
                        continue;
                    }
                    // Il testo senza la scadenza: il riquadro dice già il giorno.
                    let before = text[..due.from].trim_end();
                    let after = text[due.to..].trim_start();
                    let label = match (before.is_empty(), after.is_empty()) {
                        (_, true) => before.to_string(),
                        (true, false) => after.to_string(),
                        (false, false) => format!("{before} {after}"),
                    };
                    found.push(DueTask {
                        doc: doc.clone(),
                        at: marker.span.start,
                        text: label,
                    });
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                pending.extend(blocks.iter().rev())
            }
            _ => {}
        }
    }
    found.sort_by_key(|task| task.at);
    found
}

fn tasks(host: &dyn ReadApi, today: i64) -> Vec<UiNode> {
    let bound = DueBound {
        date: iso_day(today),
        inclusive: true,
    };
    let answer = host.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::TaskDue {
            min: Some(bound.clone()),
            max: Some(bound),
        }),
        sort: None,
        select: PropertySelect::None,
        page: Some(Page {
            offset: 0,
            limit: DESK_TASK_NOTES,
        }),
        excerpts: Excerpts::Omit,
    });
    let notes = match answer.and_then(IndexResult::documents) {
        Ok(notes) => notes,
        // La scadenza la valuta l'indice di ricerca: spento lui, il riquadro
        // lo dice, e gli altri funzionano.
        Err(PluginError::Unserved(_)) => return vec![UiNode::text(Text::key(S_TASKS_UNSERVED))],
        Err(_) => return vec![UiNode::text(Text::key(S_TASKS_FAILED))],
    };
    let mut found = Vec::new();
    for hit in &notes.items {
        // Una nota cestinata fra la domanda e la lettura non ha compiti.
        if let Ok(model) = host.read_model(&hit.doc) {
            found.extend(due_on(&model, &hit.doc, today));
        }
    }
    found.sort_by(|a, b| a.doc.cmp(&b.doc).then(a.at.cmp(&b.at)));
    if found.is_empty() && notes.total == 0 {
        return vec![empty(S_TASKS_NONE, None)];
    }
    let total = found.len();
    let items = found
        .iter()
        .take(DESK_ROWS)
        .map(|task| {
            UiNode::list_item(
                Text::from(task.text.clone()),
                Some(Text::from(task.doc.page_name().to_string())),
                open(&task.doc),
            )
            .with_key(format!("task:{}#{}", task.doc.as_str(), task.at))
        })
        .collect();
    let mut out = if total == 0 {
        vec![empty(S_TASKS_NONE, None)]
    } else {
        rows(items, total)
    };
    let unread = (notes.total as usize).saturating_sub(notes.items.len());
    if unread > 0 {
        out.push(UiNode::text(Text::message(
            S_TASKS_UNREAD,
            vec![count(unread)],
        )));
    }
    out
}

// --- Base -------------------------------------------------------------------------

fn base(host: &dyn ReadApi) -> Result<Vec<UiNode>, PluginError> {
    let chosen = match host.setting(DESK_BASE_KEY) {
        Ok(SettingValue::Text(path)) => path.trim().to_string(),
        // Chiave non dichiarata: nessuna Base scelta.
        _ => String::new(),
    };
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: None,
    })? {
        IndexResult::Entries(entries) => entries,
        other => return super::unexpected_result("entries", other),
    };
    let mut bases: Vec<DocId> = entries
        .items
        .into_iter()
        .map(|entry| entry.id)
        .filter(|id| is_base(host, id))
        .collect();
    bases.sort();
    let exists = !chosen.is_empty() && bases.iter().any(|id| id.as_str() == chosen);
    let mut out = Vec::new();
    if exists {
        let doc = DocId::new(chosen.clone());
        out.push(UiNode::keyed(
            format!("base:{chosen}"),
            UiKind::Custom {
                ns: BASE_NS.into(),
                payload: json!({ "base": chosen }),
                fallback: vec![UiNode::list_item(
                    Text::from(doc.page_name().to_string()),
                    Some(Text::key(S_BASE_OPEN)),
                    open(&doc),
                )],
            },
        ));
    } else if bases.is_empty() {
        out.push(empty(
            S_BASE_NO_FILES,
            Some(Text::key(S_BASE_NO_FILES_DETAIL)),
        ));
        return Ok(out);
    } else if chosen.is_empty() {
        out.push(empty(S_BASE_NONE, Some(Text::key(S_BASE_NONE_DETAIL))));
    } else {
        let name = DocId::new(chosen.clone()).page_name().to_string();
        out.push(empty(
            S_BASE_MISSING,
            Some(Text::message(
                S_BASE_MISSING_DETAIL,
                vec![Arg::text("name", name)],
            )),
        ));
    }
    // In testa «Nessuna»: senza, una tendina senza scelta mostrerebbe la
    // prima Base come se fosse quella scelta, e sceglierla non direbbe niente.
    let mut options = vec![UiOption::new("", Text::key(S_BASE_UNSET))];
    options.extend(
        bases
            .iter()
            .take(DESK_BASE_CHOICES)
            .map(|id| UiOption::new(id.as_str(), Text::from(id.as_str().to_string()))),
    );
    // La Base scelta resta fra le scelte anche oltre il tetto.
    if exists && !options.iter().any(|option| option.value == chosen) {
        options.push(UiOption::new(chosen.as_str(), Text::from(chosen.clone())));
    }
    let value = vec![if exists { chosen } else { String::new() }];
    out.push(
        UiNode::new(UiKind::Select {
            field: F_BASE.into(),
            label: Some(Text::key(S_BASE_CHOOSE)),
            value,
            options,
            multiple: false,
            action: Some(ActionRef::new(A_BASE)),
        })
        .with_key("base-choice"),
    );
    Ok(out)
}

/// L'id del formato Base (`fub_format_base::model::BASE_FORMAT_ID`, che qui
/// non si importa: la Scrivania non dipende dalla feature `base`).
const BASE_FORMAT: &str = "base";

/// Una Base è ciò che il formato Base rivendica: lo decide il registro dei
/// formati sul nome, come per i comandi della Base, e non una regola sua.
/// Senza il formato Base nel vault, nessun file è una Base.
fn is_base(host: &dyn ReadApi, id: &DocId) -> bool {
    host.format_of(id)
        .is_some_and(|format| format.descriptor.id == BASE_FORMAT)
}

// --- Il mese --------------------------------------------------------------------

/// Il mese di oggi: le settimane cominciano dal primo giorno del locale, oggi
/// è in evidenza, e un giorno apre (o crea) la sua giornaliera con
/// `note.daily`, la stessa strada del calendario.
fn month(host: &dyn ReadApi, today: i64) -> Vec<UiNode> {
    let (year, month, _) = civil_from_days(today);
    let first = days_from_civil(year, month, 1);
    let length = days_in_month(year, month) as i64;
    let start = i64::from(host.user_locale().first_day_of_week.iso());
    let offset = (iso_weekday(first) - start).rem_euclid(7);
    let weeks = (offset + length + 6) / 7;
    let columns = (0..7)
        .map(|d| {
            let iso = ((start - 1 + d) % 7) as usize;
            let mut column = TableColumn::new(Text::key(WEEKDAY_KEYS[iso]));
            column.align = Align::Center;
            column
        })
        .collect();
    let rows = (0..weeks)
        .map(|week| {
            let from = first - offset + 7 * week;
            let cells = (0..7)
                .map(|d| {
                    let day = from + d;
                    let (_, m, n) = civil_from_days(day);
                    if m != month {
                        return UiNode::text(Text::from(String::new()));
                    }
                    let intent = if day == today {
                        Intent::Primary
                    } else {
                        Intent::Neutral
                    };
                    let date = iso_day(day);
                    UiNode::button(
                        Text::from(n.to_string()),
                        intent,
                        ActionRef::with(A_DAY, json!({ P_DATE: date })),
                    )
                    .with_key(date)
                })
                .collect();
            UiNode::keyed(
                format!("week-{from}"),
                UiKind::Row {
                    cells,
                    action: None,
                },
            )
        })
        .collect();
    vec![
        UiNode::text(Text::message(
            MONTH_KEYS[(month - 1) as usize],
            vec![Arg::text("year", year.to_string())],
        )),
        UiNode::keyed(
            format!("month-{year}-{month}"),
            UiKind::Table { columns, rows },
        ),
    ]
}

/// Il giorno della settimana ISO (lunedì = 1) di un giorno dall'epoca, che era
/// un giovedì.
fn iso_weekday(day: i64) -> i64 {
    (day + 3).rem_euclid(7) + 1
}

// ---------------------------------------------------------------------------
// I gesti
// ---------------------------------------------------------------------------

/// Un gesto della Scrivania. Cambiare l'ordine, togliere, rimettere e scegliere
/// la Base scrivono l'impostazione e ridisegnano; aprire porta alla nota; un
/// giorno del mese passa da `note.daily`.
pub(super) fn action(
    instance: &ViewInstance,
    action: UiAction,
    host: &mut dyn HostApi,
) -> Result<ViewUpdate, PluginError> {
    let tile = action
        .payload
        .get(P_TILE)
        .and_then(|v| v.as_str())
        .and_then(Tile::from_id);
    match action.action.0.as_str() {
        A_MOVE => {
            let (Some(tile), Some(to)) = (tile, action.payload.get(P_TO).and_then(|v| v.as_u64()))
            else {
                return Ok(ViewUpdate::None);
            };
            let tiles = shown_tiles(host)?;
            let next = moved(&tiles, tile, usize::try_from(to).unwrap_or(usize::MAX));
            if next != tiles {
                write_tiles(host, &next)?;
            }
        }
        A_HIDE => {
            let Some(tile) = tile else {
                return Ok(ViewUpdate::None);
            };
            let mut tiles = shown_tiles(host)?;
            tiles.retain(|t| *t != tile);
            write_tiles(host, &tiles)?;
        }
        A_SHOW => {
            let Some(tile) = tile else {
                return Ok(ViewUpdate::None);
            };
            let mut tiles = shown_tiles(host)?;
            if !tiles.contains(&tile) {
                tiles.push(tile);
                write_tiles(host, &tiles)?;
            }
        }
        A_BASE => {
            let chosen = action
                .fields
                .iter()
                .find(|f| f.field == F_BASE)
                .and_then(|f| match &f.value {
                    UiValue::Text(path) => Some(path.clone()),
                    UiValue::Choices(paths) => paths.first().cloned(),
                    _ => None,
                });
            let Some(chosen) = chosen else {
                return Ok(ViewUpdate::None);
            };
            host.set_setting(DESK_BASE_KEY, SettingValue::Text(chosen))?;
        }
        A_OPEN => {
            return Ok(match action.payload.get(P_DOC).and_then(|v| v.as_str()) {
                Some(doc) => ViewUpdate::Navigate {
                    doc_id: doc.to_string(),
                },
                None => ViewUpdate::None,
            });
        }
        A_DAY => {
            let Some(date) = action.payload.get(P_DATE).and_then(|v| v.as_str()) else {
                return Ok(ViewUpdate::None);
            };
            let outcome = host.run_command(NOTE_DAILY, json!({ P_DATE: date }))?;
            if let fub_abi::command::CommandEffect::Navigate { doc } = outcome.effect {
                return Ok(ViewUpdate::Navigate {
                    doc_id: doc.as_str().to_string(),
                });
            }
        }
        _ => return Ok(ViewUpdate::None),
    }
    Ok(ViewUpdate::Replace {
        root: render(instance, host)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moved_porta_un_riquadro_al_suo_posto() {
        let all = Tile::ALL.to_vec();
        assert_eq!(
            moved(&all, Tile::Month, 0),
            [
                Tile::Month,
                Tile::Pinned,
                Tile::Recent,
                Tile::Tasks,
                Tile::Base
            ]
        );
        assert_eq!(
            moved(&all, Tile::Pinned, 1),
            [
                Tile::Recent,
                Tile::Pinned,
                Tile::Tasks,
                Tile::Base,
                Tile::Month
            ]
        );
        assert_eq!(
            moved(&all, Tile::Pinned, usize::MAX).last(),
            Some(&Tile::Pinned)
        );
        // Un riquadro tolto non rientra spostandolo.
        let some = vec![Tile::Recent, Tile::Base];
        assert_eq!(moved(&some, Tile::Month, 0), some);
    }

    #[test]
    fn tiles_of_ignora_sconosciuti_e_doppioni() {
        let ids: Vec<String> = ["base", "x", "base", "pinned"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(tiles_of(&ids), [Tile::Base, Tile::Pinned]);
    }
}
