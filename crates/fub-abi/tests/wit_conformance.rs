//! Conformità abi ↔ WIT (vivo da M2, freeze a M4).
//!
//! Questo test rende **verificabile** la "regola d'oro": ogni tipo che attraversa
//! una firma di trait deve avere una controparte in `wit/fub/abi.wit`, con la
//! **stessa forma** — non solo con lo stesso nome. Quattro pressioni:
//!
//! 1. **Il WIT deve essere valido** — il file viene dato in pasto a `wit-parser`.
//!    Un contratto che non parsa è un test rosso, non un file di testo che
//!    "sembra giusto".
//! 2. **Drift lato Rust** → i match e i destructuring esaustivi qui sotto NON
//!    compilano se un enum guadagna una variante o un record un campo; e le
//!    firme delle funzioni sono **cast dei metodi dei trait a puntatore a
//!    funzione**, quindi non compilano se un parametro o un tipo di ritorno
//!    cambia.
//! 3. **Drift lato WIT, nelle due direzioni** — si confrontano gli **insiemi
//!    ordinati di nomi e i tipi** estratti dal parse: campi di record, casi di
//!    variant col tipo del payload, destinazioni degli alias, parametri e
//!    risultati di ogni funzione. Un tipo dichiarato nel contratto e mai
//!    rivendicato dall'abi fallisce ugualmente (contratto morto).
//! 4. **`host` è eliso** — nessuna funzione del WIT può avere un parametro
//!    `host`: le capacità sono importate dal world, non passate a mano. Le firme
//!    Rust invece ce l'hanno, e il test verifica che spariscano *esattamente lì*.
//!
//! # Da dove vengono i tipi attesi
//!
//! Non sono scritti a mano. `wit(&campo)` deduce la forma WIT **dal tipo Rust
//! del campo destrutturato** ([`WitType`]): se `SearchHit::score` diventasse
//! `f64`, l'attesa diventerebbe `f64` e il confronto col contratto (`f32`)
//! fallirebbe. Lo stesso per le funzioni: [`WitFn`] deriva parametri e risultato
//! dal tipo del puntatore a funzione, che a sua volta è vincolato al metodo del
//! trait dal cast. È il "non compila su divergenza" chiesto dal piano, ottenuto
//! senza generare codice.
//!
//! # Alberi ricorsivi
//!
//! I tipi che al confine viaggiano come **arena** (`block`, `inline`, `ui-node`,
//! `document-tree`, `ui-tree`, `span`) si confrontano con
//! [`fub_abi::arena`], che è la loro forma al confine *scritta in Rust* — e la
//! catena verso gli alberi nativi la tiene il compilatore, perché
//! `DocumentTree::flatten`/`rebuild` sono match esaustivi su entrambi i lati
//! (round-trip provato in `arena`). Prima esisteva solo la prosa nei commenti.
//!
//! `wit-parser` è una **dev-dependency**: l'invariante architetturale di
//! `fub-abi` riguarda le dipendenze normali, ed è protetta da
//! `tests/dependency_invariant.rs`.
//!
//! L'**ordine** dei casi è confrontato in tutte e due le direzioni e in tutte
//! le sedi: il WIT contro l'elenco del test (`diff`), e l'elenco del test
//! contro la **dichiarazione dell'enum Rust**, parsata dal sorgente con `syn`
//! (`variant_src`/`enumeration_src`). Il compilatore garantisce l'esaustività
//! dei match qui sotto, non l'ordine — e l'ordine dei casi è il discriminante
//! ABI: un riordino è rosso da entrambi i lati, non solo da quello WIT.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use wit_parser::{Resolve, Type, TypeDefKind, WorldItem, WorldKey};

use fub_abi::arena::{self, BlockRef, InlineRef, UiRef};
use fub_abi::command::{
    Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    CommandSurface, Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo,
    UndoStep, Undone,
};
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxForm, SyntaxMatch,
    SyntaxProduct, SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::edit::{AppliedEdit, EditReport, EditRequest, Revision, TextEdit, WriteBase};
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{
    Actor, BatchId, DocChange, DocChanges, Event, EventKind, EventMask, Notice, Origin, Severity,
    Subject,
};
use fub_abi::format::{
    DocumentFormat, DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider,
    LinkInsert, LinkRewrite, ParseContext, RenderOptions, RenderTarget, SourceKind,
};
use fub_abi::gate::Gate;
use fub_abi::grid::{
    GridApplyRequest, GridBorder, GridBorderStyle, GridBorders, GridCellKey, GridCellPatch,
    GridCellStyle, GridColumn, GridCommit, GridHorizontalAlign, GridInvalidation, GridRow,
    GridScript, GridSheet, GridSourceEdit, GridSurfaceSpec, GridUnderline, GridVerticalAlign,
    GridWindowRequest,
};
use fub_abi::grid_bytes::{
    GridBook, GridBytesCell, GridBytesProvider, GridBytesSession, GridBytesWindow, GridCalculation,
    GridCommand, GridCommandOutcome, GridCommandRequest, GridCommandState, GridComment,
    GridCommentReply, GridDataBar, GridDialog, GridIcon, GridJournal, GridLink, GridMedia,
    GridMerge, GridNotice, GridObject, GridObjectKind, GridObjectMissing, GridSelection, GridShape,
    GridShapeAlign, GridShapeAnchor, GridShapeKind, GridSheetView, GridTable, GridValue,
    GridViewMode,
};
use fub_abi::locale::{HourCycle, Locale, Weekday};
use fub_abi::model::{
    Anchor, ColumnAlign, DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget,
    PropertyDate, PropertyScalar, PropertyTime, PropertyValue, Span, Tag, TaskMarker,
};
use fub_abi::net::{HttpHeader, HttpMethod, HttpRequest, HttpResponse};
use fub_abi::options::OptionMap;
use fub_abi::organization::Organization;
use fub_abi::query::{
    DueBound, QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TaskStatus, TextField,
    TextMode, TextQuery, TextScope, TextTolerance,
};
use fub_abi::render::{EmbedContent, RenderedDocument, RenderedPart};
use fub_abi::session::{
    AnchoredSelection, AnchoredSelections, ContextKind, ContextMask, FloatingSelection,
    FloatingSelections, PaneId, PaneMode, SelectionSet, ViewContext,
};
use fub_abi::settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
use fub_abi::text::{Arg, ArgValue, Message, StringCatalog, Text};
use fub_abi::traits::{
    BacklinkRef, CommandProvider, ComponentKind, Delivery, DocPosition, DocumentMatch, DraftInfo,
    EntryKind, EventHandler, Excerpts, FolderScope, HealthCheck, HealthIssue, HostApi, IndexLoss,
    IndexProvider, IndexQuery, IndexResult, IndexingState, JobId, JobProgress, JobSpec, JobStatus,
    LinkDirection, NeighborRef, Page, Paged, Plugin, PluginManifest, PluginPermissions,
    PredicateKind, PropertyCount, PropertyEntry, PropertyFilter, PropertySelect, PropertySort,
    PropertyTest, QueryKind, QueryRoute, ReadApi, ResolvedRef, ServiceProvider, TagCount,
    TimerSchedule, TimerSpec, TrashEntry, VaultEntry, VaultFolder, VaultStatus, ViewInstance,
    ViewInterests, ViewProvider, ViewSpec, ViewSurface, WallClock, ABI_VERSION,
};
use fub_abi::transfer::{
    ArtifactContent, ArtifactHandle, ArtifactSink, ConflictPolicy, ExportArtifact, ExportProvider,
    ExportReport, ExportRequest, ExportSelection, ExportTarget, ImportMode, ImportOutcome,
    ImportProvider, ImportReport, ImportRequest, ImportSource, ImportedDocument, NoteLevel,
    SourceContent, SourceHandle, StreamedSource, TransferNote,
};
use fub_abi::ui::{
    ActionId, ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction,
    UiDrag, UiNode, UiOption, UiValue, ViewUpdate,
};

// CARGO_MANIFEST_DIR = crates/fub-abi ; il contratto è alla radice del repo.
const WIT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/wit/fub/abi.wit");

/// Segnaposto per il ricevitore (`&self`): non attraversa il confine.
const SELF: &str = "«self»";
/// Segnaposto per l'`HostApi`: nelle firme Rust c'è, nel WIT **non deve
/// esserci** — è importato dal world.
const HOST: &str = "«host»";
/// Segnaposto per l'[`ArtifactSink`]: stessa sorte dell'host, e per la stessa
/// ragione, ma con un'asimmetria che vale nominare invece di nascondere.
///
/// In Rust il sink **non sta sull'host** ed è un parametro di
/// `ExportProvider::export`: un export gira sotto prestito condiviso, e mettere
/// una scrittura dentro [`ReadApi`] la regalerebbe a chi disegna una view e a
/// chi interroga l'indice — cioè a tutti quelli per cui `ReadApi` esiste per
/// **non** averla. Al confine WASM quella distinzione non è esprimibile: ogni
/// capacità arriva dal world, quindi il sink diventa `host-transfer-write` e
/// sparisce dai parametri di `export` esattamente come l'host. È il prezzo del
/// confine, ed è per questo che si elide qui e sta scritto nel verbale della
/// decisione 0102.
const SINK: &str = "«sink»";

#[path = "wit_conformance/cases.rs"]
mod cases;
#[path = "wit_conformance/deduce.rs"]
mod deduce;
#[path = "wit_conformance/functions.rs"]
mod functions;
#[path = "wit_conformance/parsed.rs"]
mod parsed;
#[path = "wit_conformance/records_document.rs"]
mod records_document;
#[path = "wit_conformance/records_extensions.rs"]
mod records_extensions;
#[path = "wit_conformance/records_platform.rs"]
mod records_platform;
#[path = "wit_conformance/variants.rs"]
mod variants;
#[path = "wit_conformance/world.rs"]
mod world;

use cases::{
    actor_case, block_case, command_effect_case, delivery_case, event_case, export_selection_case,
    format_error_case, import_outcome_case, index_query_case, index_result_case, inline_case,
    link_target_case, paged_fields, plugin_error_case, predicate_kind_case, property_scalar_case,
    property_select_case, property_test_case, property_value_case, query_kind_case,
    query_predicate_case, query_route_case, setting_kind_case, setting_value_case, subject_case,
    ui_drag_case, ui_kind_case, ui_value_case, undo_step_case, view_update_case,
};
use deduce::{wit, wit_of, wit_tree, Host, HostRef, Sink, WitFn, WitType};
use parsed::{case, case_rec, case_ty, load, rust_enum_order, Case, Wit};

// ---------------------------------------------------------------------------
// Il confronto vero e proprio
// ---------------------------------------------------------------------------

/// Applica al WIT tutte le asserzioni derivate dall'abi. Separata dal test così
/// che `wit_conformance_actually_fails_on_drift` possa passarle un contratto
/// alterato ad arte e verificare che diventi rossa.
fn conform(source: &str) -> Result<(), String> {
    let mut contract = load(source);

    // Il numero del package è la stessa versione che i manifest dichiarano in
    // `abi-version` e che `abi_compatible` confronta: UNA fonte, `ABI_VERSION`.
    assert_eq!(
        contract.package,
        format!("fub:abi@{ABI_VERSION}"),
        "nome del package"
    );

    // La data d'esempio serve a due parti: un caso di variant e il record
    // `property-date`.
    let data = PropertyDate {
        year: 0,
        month: 1,
        day: 1,
        time: None,
    };
    variants::variants(&mut contract, data);
    records_document::records_document(&mut contract, data);
    records_extensions::records_extensions(&mut contract);
    records_platform::records_platform(&mut contract);
    functions::functions(&mut contract);
    world::world(&mut contract);

    contract.finish()
}

fn wit_source() -> String {
    std::fs::read_to_string(WIT_PATH)
        .unwrap_or_else(|and| panic!("impossibile leggere {WIT_PATH}: {and}"))
}

#[test]
fn abi_types_are_mirrored_in_wit() {
    if let Err(report) = conform(&wit_source()) {
        panic!("abi e wit/fub/abi.wit divergono:\n  - {report}");
    }
}

/// Il derivatore d'ordine legge davvero la dichiarazione Rust: se sa leggere
/// `Intent` (l'enum più piccolo), la stessa strada vale per tutti gli altri.
#[test]
fn the_expected_case_order_comes_from_the_rust_declaration() {
    assert_eq!(
        rust_enum_order("ui.rs", "Intent"),
        ["neutral", "primary", "danger"]
    );
    assert_eq!(
        rust_enum_order("ui.rs", "ViewUpdate")
            .first()
            .map(String::as_str),
        Some("replace")
    );
    assert_eq!(common::kebab("CodeBlock"), "code-block");
    assert_eq!(common::kebab("Url"), "url");
}

/// **Una lettura, due confini** (decisione 0053): lo stesso identificatore Rust
/// si scrive in due modi, e i due non si possono confondere perché non vanno
/// nello stesso posto.
///
/// `kebab` va nel WIT — il confine del component model, M5. `snake` va nel JSON
/// di serde, cioè nell'IPC che la webview attraversa **oggi**. Che siano due
/// funzioni e non una è la forma minima del fatto che regge tutta la decisione:
/// il WIT e il mirror TS non sono due grafie della stessa cosa, e nessuno dei
/// due si genera dall'altro.
#[test]
fn the_same_name_is_projected_in_two_different_ways() {
    for (rust, wit, json) in [
        ("DryRun", "dry-run", "dry_run"),
        ("LeftSidebar", "left-sidebar", "left_sidebar"),
        ("StaticSite", "static-site", "static_site"),
        // Un caso di una parola sola: le due proiezioni coincidono, e va bene —
        // ciò che non deve coincidere è la REGOLA, non ogni suo risultato.
        ("Overflow", "overflow", "overflow"),
        // E uno che non ha maiuscole interne pur avendo due "pezzi".
        ("H23", "h23", "h23"),
    ] {
        assert_eq!(common::kebab(rust), wit, "{rust} verso il WIT");
        assert_eq!(common::snake(rust), json, "{rust} verso il JSON di serde");
    }
}

/// La forma al confine è quella di `arena`, non quella nativa: questo test lo
/// mette per iscritto, perché è la divergenza deliberata più facile da
/// dimenticare (e la sola presidiata da conversioni con dei test propri).
#[test]
fn the_boundary_shape_of_a_span_is_wider_than_the_native_one() {
    assert_eq!(wit_of::<arena::Span>(), "span");
    assert_eq!(wit_of::<Span>(), "span", "lo stesso record, due viste");
    assert!(
        std::mem::size_of::<usize>() <= std::mem::size_of::<u64>(),
        "il nativo non può essere più largo del confine: `usize`→`u64` deve \
         restare la direzione che non fallisce mai"
    );
}

// ---------------------------------------------------------------------------
// Il test del test (criterio di accettazione di M4)
// ---------------------------------------------------------------------------

/// Un test di conformità che non sa fallire non è un test. Qui si introducono
/// divergenze ad arte — una per ciascuna cosa che il test dovrebbe vedere — e si
/// pretende il rosso.
#[test]
fn wit_conformance_actually_fails_on_drift() {
    let base = wit_source();

    let cases: &[(&str, String, &str)] = &[
        (
            "campo rinominato nel WIT",
            base.replace("slug: string,", "slugg: string,"),
            "slug",
        ),
        (
            "caso di variant rimosso dal WIT",
            base.replace("        thematic-break(block-thematic-break),\n", ""),
            "thematic-break",
        ),
        (
            "funzione rimossa da host-api",
            base.replace("    now-unix-millis: func() -> u64;", ""),
            "now-unix-millis",
        ),
        (
            "tipo in più nel WIT che l'abi non rivendica",
            base.replace(
                "interface errors {",
                "interface errors {\n    record contratto-morto { x: u32 }",
            ),
            "contratto-morto",
        ),
        (
            "alias con la larghezza sbagliata",
            base.replace("    type block-ref = u32;", "    type block-ref = u64;"),
            "block-ref",
        ),
        // --- da qui in poi: ciò che il confronto per soli nomi non vedeva
        (
            "tipo di un campo cambiato (la larghezza di un punteggio)",
            base.replace("        score: option<f32>,", "        score: option<f64>,"),
            "score",
        ),
        (
            "tipo di un campo cambiato in un record annidato",
            base.replace("        highlights: list<span>,", "        highlights: list<string>,"),
            "highlights",
        ),
        (
            "payload di un caso di variant cambiato",
            base.replace(
                "        thematic-break(block-thematic-break),",
                "        thematic-break(string),",
            ),
            "thematic-break",
        ),
        (
            "risultato di una funzione cambiato",
            base.replace("    now-unix-millis: func() -> u64;", "    now-unix-millis: func() -> u32;"),
            "now-unix-millis",
        ),
        (
            "tipo di un parametro cambiato",
            base.replace(
                "    write-document: func(id: doc-id, source: string,\n                         base: write-base) -> result<revision, plugin-error>;",
                "    write-document: func(id: doc-id, source: list<u8>,\n                         base: write-base) -> result<revision, plugin-error>;",
            ),
            "source",
        ),
        (
            "parametro rinominato",
            base.replace(
                "    query: func(query: index-query) -> result<index-result, plugin-error>;",
                "    query: func(q: index-query) -> result<index-result, plugin-error>;",
            ),
            "query",
        ),
        (
            "l'host NON è eliso: riappare come parametro",
            base.replace(
                "    reconcile: func(ids: list<doc-id>) -> list<index-loss>;",
                "    reconcile: func(host: string, ids: list<doc-id>) -> list<index-loss>;",
            ),
            "host",
        ),
        (
            "campi di un record riordinati (è un cambio di ABI)",
            base.replace(
                "    record span {\n        start: u64,\n        end: u64,\n    }",
                "    record span {\n        end: u64,\n        start: u64,\n    }",
            ),
            "ordine",
        ),
        (
            "casi di un enum riordinati (cambia il discriminante)",
            base.replace(
                "enum intent { neutral, primary, danger }",
                "enum intent { primary, neutral, danger }",
            ),
            "ordine",
        ),
    ];

    for (what, mutated, needle) in cases {
        assert_ne!(&base, mutated, "la mutazione «{what}» non ha toccato nulla");
        let report = conform(mutated).expect_err(&format!(
            "«{what}» non ha fatto fallire il test di conformità"
        ));
        assert!(
            report.contains(needle),
            "«{what}»: il report non nomina `{needle}`:\n{report}"
        );
    }
}

/// E un WIT che non parsa deve morire subito, non passare per verde.
#[test]
#[should_panic(expected = "non è un WIT valido")]
fn invalid_wit_is_not_silently_accepted() {
    // `list` senza escape: com'era il contratto prima del piano di aggiustamento.
    let broken = wit_source().replace("        %list(block-list),", "        list(block-list),");
    let _ = conform(&broken);
}
