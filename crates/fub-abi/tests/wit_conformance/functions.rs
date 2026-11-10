//! Il confronto, quinta parte: le firme complete delle funzioni, ricavate dai
//! metodi dei trait.

use super::*;

pub(super) fn functions(contract: &mut Wit) {
    // --- funzioni: firme complete, ricavate dai metodi dei trait
    //
    // Ogni riga fa due cose: il cast vincola la firma scritta a quella del
    // trait (se il trait cambia, non compila), e da quella firma si deducono i
    // tipi attesi nel WIT. `host` compare a sinistra e non a destra: è l'unica
    // verifica dell'elisione.

    contract.types_only("json");
    contract.types_only("options");
    contract.types_only("model");
    contract.types_only("ui");
    contract.types_only("jobs");
    contract.types_only("events");
    contract.types_only("errors");
    contract.types_only("session");
    contract.types_only("intl");
    contract.types_only("text");
    contract.types_only("edit");
    contract.types_only("net");
    contract.types_only("transfer");
    contract.types_only("settings");
    contract.types_only("organization");
    contract.types_only("grid");

    contract.method(
        "format",
        "descriptor",
        <dyn FormatProvider>::descriptor as fn(&'static dyn FormatProvider) -> FormatDescriptor,
        &[],
    );
    contract.method(
        "format",
        "capabilities",
        <dyn FormatProvider>::capabilities as fn(&'static dyn FormatProvider) -> FormatCapabilities,
        &[],
    );
    contract.method(
        "format",
        "parse",
        <dyn FormatProvider>::parse
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentSource,
                &'static ParseContext,
            ) -> Result<DocumentModel, FormatError>,
        &["source", "ctx"],
    );
    contract.method(
        "format",
        "render-html",
        <dyn FormatProvider>::render_html
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentModel,
                &'static RenderOptions,
            ) -> Result<String, FormatError>,
        &["model", "opts"],
    );
    contract.method(
        "format",
        "serialize",
        <dyn FormatProvider>::serialize
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentModel,
            ) -> Result<String, FormatError>,
        &["model"],
    );
    contract.method(
        "format-links",
        "rewrite-links",
        <dyn FormatProvider>::rewrite_links
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentSource,
                &'static ParseContext,
                &'static [LinkRewrite],
            ) -> Result<Option<Vec<TextEdit>>, FormatError>,
        &["source", "ctx", "rewrites"],
    );
    contract.method(
        "format-edits",
        "format-link",
        <dyn FormatProvider>::format_link
            as fn(
                &'static dyn FormatProvider,
                &'static ParseContext,
                &'static LinkInsert,
            ) -> Result<Option<String>, FormatError>,
        &["ctx", "link"],
    );
    contract.method(
        "format-edits",
        "set-task-state",
        <dyn FormatProvider>::set_task_state
            as fn(
                &'static dyn FormatProvider,
                &'static DocumentSource,
                &'static TaskMarker,
                bool,
            ) -> Result<Option<Vec<TextEdit>>, FormatError>,
        &["source", "marker", "done"],
    );

    contract.method(
        "grid-bytes",
        "surfaces",
        <dyn GridBytesProvider>::surfaces
            as fn(&'static dyn GridBytesProvider) -> Vec<GridSurfaceSpec>,
        &[],
    );
    contract.method(
        "grid-bytes",
        "open",
        <dyn GridBytesProvider>::open
            as fn(
                &'static mut dyn GridBytesProvider,
                &'static str,
                &'static [u8],
                Revision,
                &'static GridJournal,
            ) -> Result<GridBytesSession, PluginError>,
        &["surface", "source", "revision", "journal"],
    );
    contract.method(
        "grid-bytes",
        "window",
        <dyn GridBytesProvider>::window
            as fn(
                &'static mut dyn GridBytesProvider,
                &'static str,
                GridWindowRequest,
            ) -> Result<GridBytesWindow, PluginError>,
        &["instance", "request"],
    );
    contract.method(
        "grid-bytes",
        "apply",
        <dyn GridBytesProvider>::apply
            as fn(
                &'static mut dyn GridBytesProvider,
                &'static str,
                GridApplyRequest,
            ) -> Result<GridCommit, PluginError>,
        &["instance", "request"],
    );
    contract.method(
        "grid-bytes",
        "commands",
        <dyn GridBytesProvider>::commands
            as fn(
                &'static mut dyn GridBytesProvider,
                &'static str,
                GridSelection,
            ) -> Result<Vec<GridCommandState>, PluginError>,
        &["instance", "selection"],
    );
    contract.method(
        "grid-bytes",
        "command",
        <dyn GridBytesProvider>::command
            as fn(
                &'static mut dyn GridBytesProvider,
                &'static str,
                GridCommandRequest,
            ) -> Result<GridCommandOutcome, PluginError>,
        &["instance", "request"],
    );
    contract.method(
        "grid-bytes",
        "bytes-to-write",
        <dyn GridBytesProvider>::bytes_to_write
            as fn(
                &'static mut dyn GridBytesProvider,
                &'static str,
                Revision,
            ) -> Result<Vec<u8>, PluginError>,
        &["instance", "expected"],
    );
    contract.method(
        "grid-bytes",
        "close",
        <dyn GridBytesProvider>::close
            as fn(&'static mut dyn GridBytesProvider, &'static str) -> Result<(), PluginError>,
        &["instance"],
    );
    contract.method(
        "grid-bytes",
        "shutdown",
        <dyn GridBytesProvider>::shutdown
            as fn(&'static mut dyn GridBytesProvider) -> Result<(), PluginError>,
        &[],
    );

    contract.method(
        "syntax",
        "spec",
        <dyn SyntaxRule>::spec as fn(&'static dyn SyntaxRule) -> SyntaxRuleSpec,
        &[],
    );
    contract.method(
        "syntax",
        "apply",
        <dyn SyntaxRule>::apply
            as fn(
                &'static dyn SyntaxRule,
                &'static SyntaxMatch,
                &'static ParseContext,
            ) -> Result<Option<SyntaxProduct>, FormatError>,
        &["m", "ctx"],
    );

    contract.method(
        "renderer",
        "spec",
        <dyn CustomRenderer>::spec as fn(&'static dyn CustomRenderer) -> CustomRendererSpec,
        &[],
    );
    contract.method(
        "renderer",
        "render",
        <dyn CustomRenderer>::render
            as fn(
                &'static dyn CustomRenderer,
                &'static CustomBlock,
                &'static RenderOptions,
            ) -> Result<CustomRendering, FormatError>,
        &["block", "opts"],
    );

    contract.method(
        "command",
        "commands",
        <dyn CommandProvider>::commands as fn(&'static dyn CommandProvider) -> Vec<CommandSpec>,
        &[],
    );
    contract.method(
        "command",
        "invoke",
        <dyn CommandProvider>::invoke
            as fn(
                &'static dyn CommandProvider,
                &'static str,
                serde_json::Value,
                InvokeMode,
                Host,
            ) -> Result<CommandOutcome, PluginError>,
        &["command", "args", "mode"],
    );

    contract.method(
        "view",
        "views",
        <dyn ViewProvider>::views as fn(&'static dyn ViewProvider) -> Vec<ViewSpec>,
        &[],
    );
    contract.method(
        "view",
        "interests",
        <dyn ViewProvider>::interests
            as fn(&'static dyn ViewProvider, &'static ViewInstance) -> ViewInterests,
        &["instance"],
    );
    contract.method(
        "view",
        "render-view",
        <dyn ViewProvider>::render_view
            as fn(
                &'static dyn ViewProvider,
                &'static ViewInstance,
                HostRef,
            ) -> Result<UiNode, PluginError>,
        &["instance"],
    );
    contract.method(
        "view",
        "on-action",
        <dyn ViewProvider>::on_action
            as fn(
                &'static mut dyn ViewProvider,
                &'static ViewInstance,
                UiAction,
                Host,
            ) -> Result<ViewUpdate, PluginError>,
        &["instance", "action"],
    );

    contract.method(
        "index",
        "routes",
        <dyn IndexProvider>::routes as fn(&'static dyn IndexProvider) -> Vec<QueryRoute>,
        &[],
    );
    contract.method(
        "index",
        "activate",
        <dyn IndexProvider>::activate
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "on-documents-indexed",
        <dyn IndexProvider>::on_documents_indexed
            as fn(&'static mut dyn IndexProvider, &'static [DocumentModel]) -> Vec<IndexLoss>,
        &["docs"],
    );
    contract.method(
        "index",
        "on-documents-removed",
        <dyn IndexProvider>::on_documents_removed
            as fn(&'static mut dyn IndexProvider, &'static [DocId]) -> Vec<IndexLoss>,
        &["ids"],
    );
    contract.method(
        "index",
        "reconcile",
        <dyn IndexProvider>::reconcile
            as fn(&'static mut dyn IndexProvider, &'static [DocId]) -> Vec<IndexLoss>,
        &["ids"],
    );
    contract.method(
        "index",
        "up-to-date",
        <dyn IndexProvider>::up_to_date
            as fn(&'static dyn IndexProvider, &'static [VaultEntry]) -> Vec<DocId>,
        &["entries"],
    );
    contract.method(
        "index",
        "flush",
        <dyn IndexProvider>::flush
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "close",
        <dyn IndexProvider>::close
            as fn(&'static mut dyn IndexProvider, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "index",
        "query",
        <dyn IndexProvider>::query
            as fn(&'static dyn IndexProvider, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );

    contract.method(
        "host-vault-read",
        "read-document",
        <dyn HostApi>::read_document
            as fn(&'static dyn HostApi, &'static DocId) -> Result<String, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "read-document-bytes",
        <dyn HostApi>::read_document_bytes
            as fn(&'static dyn HostApi, &'static DocId) -> Result<Vec<u8>, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-write",
        "write-document",
        <dyn HostApi>::write_document
            as fn(Host, &'static DocId, &'static str, WriteBase) -> Result<Revision, PluginError>,
        &["id", "source", "base"],
    );
    contract.method(
        "host-vault-read",
        "document-revision",
        <dyn HostApi>::document_revision
            as fn(&'static dyn HostApi, &'static DocId) -> Result<Revision, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-write",
        "apply-edit",
        <dyn HostApi>::apply_edit
            as fn(Host, &'static DocId, EditRequest) -> Result<EditReport, PluginError>,
        &["id", "request"],
    );
    contract.method(
        "host-vault-read",
        "list-documents",
        <dyn HostApi>::list_documents
            as fn(&'static dyn HostApi, Option<Page>) -> Result<Paged<DocId>, PluginError>,
        &["page"],
    );
    contract.method(
        "host-vault-read",
        "free-name",
        <dyn HostApi>::free_name as fn(&'static dyn HostApi, &'static DocId) -> DocId,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "read-model",
        <dyn HostApi>::read_model
            as fn(&'static dyn HostApi, &'static DocId) -> Result<DocumentModel, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "format-of",
        <dyn HostApi>::format_of
            as fn(&'static dyn HostApi, &'static DocId) -> Option<DocumentFormat>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "format-link",
        <dyn HostApi>::format_link
            as fn(
                &'static dyn HostApi,
                &'static DocId,
                &'static LinkInsert,
            ) -> Result<Option<String>, PluginError>,
        &["doc", "link"],
    );
    contract.method(
        "host-vault-read",
        "task-state-edit",
        <dyn HostApi>::task_state_edit
            as fn(
                &'static dyn HostApi,
                &'static DocId,
                &'static TaskMarker,
                bool,
            ) -> Result<Option<EditRequest>, PluginError>,
        &["doc", "marker", "done"],
    );
    contract.method(
        "host-vault-structure",
        "create-document",
        <dyn HostApi>::create_document
            as fn(Host, &'static DocId, &'static str) -> Result<(), PluginError>,
        &["id", "source"],
    );
    contract.method(
        "host-vault-structure",
        "rename-document",
        <dyn HostApi>::rename_document
            as fn(Host, &'static DocId, &'static DocId) -> Result<(), PluginError>,
        &["from", "to"],
    );
    contract.method(
        "host-vault-structure",
        "trash-document",
        <dyn HostApi>::trash_document as fn(Host, &'static DocId) -> Result<DocId, PluginError>,
        &["id"],
    );
    contract.method(
        "host-vault-read",
        "list-trash",
        <dyn HostApi>::list_trash
            as fn(&'static dyn HostApi) -> Result<Vec<TrashEntry>, PluginError>,
        &[],
    );
    contract.method(
        "host-vault-structure",
        "restore-document",
        <dyn HostApi>::restore_document
            as fn(Host, &'static DocId, Option<DocId>) -> Result<DocId, PluginError>,
        &["entry", "to"],
    );
    contract.method(
        "host-vault-structure",
        "empty-trash",
        <dyn HostApi>::empty_trash as fn(Host) -> Result<u64, PluginError>,
        &[],
    );
    contract.method(
        "host-events",
        "emit",
        <dyn HostApi>::emit as fn(Host, Event),
        &["event"],
    );
    contract.method(
        "host-events",
        "spawn-job",
        <dyn HostApi>::spawn_job as fn(Host, JobSpec) -> Result<JobId, PluginError>,
        &["spec"],
    );
    contract.method(
        "host-events",
        "report-progress",
        <dyn HostApi>::report_progress as fn(Host, JobProgress),
        &["progress"],
    );
    contract.method(
        "host-data-read",
        "data-read",
        <dyn HostApi>::data_read
            as fn(&'static dyn HostApi, &'static str) -> Result<Option<Vec<u8>>, PluginError>,
        &["path"],
    );
    contract.method(
        "host-data-write",
        "data-write",
        <dyn HostApi>::data_write
            as fn(Host, &'static str, &'static [u8]) -> Result<(), PluginError>,
        &["path", "bytes"],
    );
    contract.method(
        "host-data-write",
        "data-remove",
        <dyn HostApi>::data_remove as fn(Host, &'static str) -> Result<(), PluginError>,
        &["path"],
    );
    contract.method(
        "host-data-read",
        "data-list",
        <dyn HostApi>::data_list
            as fn(&'static dyn HostApi, &'static str) -> Result<Vec<String>, PluginError>,
        &["prefix"],
    );
    contract.method(
        "host-data-read",
        "cache-read",
        <dyn HostApi>::cache_read
            as fn(&'static dyn HostApi, &'static str) -> Result<Option<Vec<u8>>, PluginError>,
        &["path"],
    );
    contract.method(
        "host-data-write",
        "cache-write",
        <dyn HostApi>::cache_write
            as fn(Host, &'static str, &'static [u8]) -> Result<(), PluginError>,
        &["path", "bytes"],
    );
    contract.method(
        "host-settings-read",
        "setting",
        <dyn HostApi>::setting
            as fn(&'static dyn HostApi, &'static str) -> Result<SettingValue, PluginError>,
        &["key"],
    );
    contract.method(
        "host-settings-write",
        "set-setting",
        <dyn HostApi>::set_setting
            as fn(Host, &'static str, SettingValue) -> Result<(), PluginError>,
        &["key", "value"],
    );
    contract.method(
        "host-settings-write",
        "reset-setting",
        <dyn HostApi>::reset_setting as fn(Host, &'static str) -> Result<(), PluginError>,
        &["key"],
    );
    contract.method(
        "host-view-state-read",
        "view-state",
        <dyn HostApi>::view_state
            as fn(
                &'static dyn HostApi,
                &'static str,
            ) -> Result<Option<serde_json::Value>, PluginError>,
        &["key"],
    );
    contract.method(
        "host-view-state-write",
        "set-view-state",
        <dyn HostApi>::set_view_state
            as fn(Host, &'static str, Option<serde_json::Value>) -> Result<(), PluginError>,
        &["key", "value"],
    );
    contract.method(
        "host-env",
        "now-unix-millis",
        <dyn HostApi>::now_unix_millis as fn(&'static dyn HostApi) -> u64,
        &[],
    );
    contract.method(
        "host-query",
        "query-index",
        <dyn HostApi>::query_index
            as fn(&'static dyn HostApi, IndexQuery) -> Result<IndexResult, PluginError>,
        &["query"],
    );
    contract.method(
        "host-env",
        "user-locale",
        <dyn HostApi>::user_locale as fn(&'static dyn HostApi) -> Locale,
        &[],
    );
    contract.method(
        "host-env",
        "random-bytes",
        <dyn HostApi>::random_bytes
            as fn(&'static dyn HostApi, u32) -> Result<Vec<u8>, PluginError>,
        &["n"],
    );
    contract.method(
        "host-env",
        "active-context",
        <dyn HostApi>::active_context as fn(&'static dyn HostApi) -> Option<ViewContext>,
        &[],
    );
    contract.method(
        "host-network",
        "fetch",
        <dyn HostApi>::fetch
            as fn(&'static dyn HostApi, HttpRequest) -> Result<HttpResponse, PluginError>,
        &["request"],
    );
    contract.method(
        "host-transfer-read",
        "read-source",
        <dyn HostApi>::read_source
            as fn(&'static dyn HostApi, SourceHandle, u64, u32) -> Result<Vec<u8>, PluginError>,
        &["handle", "offset", "len"],
    );
    contract.method(
        "host-transfer-write",
        "open-artifact",
        <dyn ArtifactSink>::open_artifact
            as fn(Sink, &'static str, &'static str) -> Result<ArtifactHandle, PluginError>,
        &["path", "media-type"],
    );
    contract.method(
        "host-transfer-write",
        "write-artifact",
        <dyn ArtifactSink>::write_artifact
            as fn(Sink, ArtifactHandle, &'static [u8]) -> Result<(), PluginError>,
        &["handle", "bytes"],
    );
    contract.method(
        "host-transfer-write",
        "close-artifact",
        <dyn ArtifactSink>::close_artifact
            as fn(Sink, ArtifactHandle) -> Result<ExportArtifact, PluginError>,
        &["handle"],
    );
    contract.method(
        "host-services",
        "call-service",
        <dyn HostApi>::call_service
            as fn(
                Host,
                &'static str,
                &'static str,
                serde_json::Value,
            ) -> Result<serde_json::Value, PluginError>,
        &["service", "method", "args"],
    );
    contract.method(
        "service",
        "call",
        <dyn ServiceProvider>::call
            as fn(
                &'static dyn ServiceProvider,
                &'static str,
                &'static str,
                serde_json::Value,
                Host,
            ) -> Result<serde_json::Value, PluginError>,
        &["service", "method", "args"],
    );

    contract.method(
        "host-commands",
        "run-command",
        <dyn HostApi>::run_command
            as fn(Host, &'static str, serde_json::Value) -> Result<CommandOutcome, PluginError>,
        &["command", "args"],
    );

    contract.method(
        "host-commands",
        "undo-last",
        <dyn HostApi>::undo_last as fn(Host) -> Result<Option<Undone>, PluginError>,
        &[],
    );

    contract.method(
        "event-handler",
        "subscribed",
        <dyn EventHandler>::subscribed as fn(&'static dyn EventHandler) -> EventMask,
        &[],
    );
    contract.method(
        "event-handler",
        "handle",
        <dyn EventHandler>::handle
            as fn(&'static mut dyn EventHandler, &'static Notice, Host) -> Result<(), PluginError>,
        &["notice"],
    );

    contract.method(
        "plugin",
        "manifest",
        <dyn Plugin>::manifest as fn(&'static dyn Plugin) -> PluginManifest,
        &[],
    );
    contract.method(
        "plugin",
        "activate",
        <dyn Plugin>::activate as fn(&'static mut dyn Plugin, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "plugin",
        "deactivate",
        <dyn Plugin>::deactivate as fn(&'static mut dyn Plugin, Host) -> Result<(), PluginError>,
        &[],
    );
    contract.method(
        "plugin",
        "run-job",
        <dyn Plugin>::run_job
            as fn(
                &'static dyn Plugin,
                &'static str,
                serde_json::Value,
                Host,
            ) -> Result<serde_json::Value, PluginError>,
        &["job", "payload"],
    );

    contract.method(
        "importer",
        "can-handle",
        <dyn ImportProvider>::can_handle
            as fn(&'static dyn ImportProvider, &'static ImportSource) -> bool,
        &["source"],
    );
    contract.method(
        "importer",
        "import",
        <dyn ImportProvider>::import
            as fn(
                &'static mut dyn ImportProvider,
                &'static ImportSource,
                &'static ImportRequest,
                Host,
            ) -> Result<ImportReport, PluginError>,
        &["source", "request"],
    );

    contract.method(
        "exporter",
        "targets",
        <dyn ExportProvider>::targets as fn(&'static dyn ExportProvider) -> Vec<ExportTarget>,
        &[],
    );
    contract.method(
        "exporter",
        "export",
        <dyn ExportProvider>::export
            as fn(
                &'static dyn ExportProvider,
                &'static ExportRequest,
                HostRef,
                Sink,
            ) -> Result<ExportReport, PluginError>,
        &["request"],
    );
}
