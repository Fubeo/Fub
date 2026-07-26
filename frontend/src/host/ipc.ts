// La cucitura verso il backend Rust: wrapper tipizzati sui comandi e sul canale
// eventi dell'IPC. I *tipi* stanno in `contract.ts`, qui c'è solo il transito.
//
// Questo modulo e `dialog.ts` sono gli unici della shell autorizzati a
// importare `@tauri-apps` (§1.3), e il test `no-tauri-outside-host.test.ts`
// lo verifica leggendo i sorgenti: un `import` di troppo altrove è rosso, non
// una svista che si scopre il giorno del port su PWA o mobile.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CommandOutcome,
  CommandSpec,
  EmbedContent,
  FieldValue,
  GraphData,
  InvokeMode,
  KernelNotice,
  RenderedDocument,
  SearchHit,
  TagCount,
  TrashEntry,
  UiNode,
  VaultInfo,
  VersionRef,
  ViewContext,
  ViewSpec,
  ViewUpdate,
  WorkspaceMeta,
} from "./contract";

export const api = {
  initialVault: () => invoke<string | null>("initial_vault"),
  openVault: (path: string) => invoke<VaultInfo>("open_vault", { path }),
  listDocuments: () => invoke<string[]>("list_documents"),
  readDocument: (id: string) => invoke<string>("read_document", { id }),
  writeDocument: (id: string, source: string) =>
    invoke<void>("write_document", { id, source }),
  // Crea, rinomina, cestina, ripristina e svuota NON hanno più un comando
  // Tauri: sono comandi del registro, e la shell li chiede con `invokeCommand`
  // (vedi `COMANDI` in `contract.ts`). Quelle due che restano restano perché
  // **leggono**: un `CommandOutcome` porta un messaggio e un effetto, non
  // dati, e ciò che risponde con dei dati passa dal canale di lettura.
  listTrash: () => invoke<TrashEntry[]>("list_trash"),
  // Il primo nome libero della famiglia «Nota», «Nota 1», … (D3). La
  // convenzione vive nel kernel: chiederla evita di averne due versioni.
  proposeFreeName: (id: string) => invoke<string>("propose_free_name", { id }),
  renderPreview: (id: string) => invoke<RenderedDocument>("render_preview", { id }),
  renderEmbed: (page: string, heading: string | null) =>
    invoke<EmbedContent>("render_embed", { page, heading }),
  // View dichiarative (protocollo generico). La shell pubblica il contesto del
  // pannello, chiede l'albero di una view e rimanda le azioni al provider,
  // senza sapere cosa la view faccia — è il percorso di un plugin.
  //
  // Restituisce gli id delle view da ridisegnare: quali seguano cosa lo sa il
  // kernel (`ViewSpec.follows`), non la shell. Senza questa risposta, l'unica
  // strada sarebbe ridisegnarle tutte a ogni movimento del cursore.
  setActiveContext: (context: ViewContext | null) =>
    invoke<string[]>("set_active_context", { context }),
  // Le view offerte dai provider registrati: la shell le monta per
  // `placement`, senza cablare gli id — una view di plugin compare da sola.
  listViews: () => invoke<ViewSpec[]>("list_views"),
  // L'istanza e i suoi parametri viaggiano accanto all'id della view (§2.3):
  // assenti = l'esemplare unico, quello che la shell monta da sé.
  renderView: (view: string, instance?: string, params?: unknown) =>
    invoke<UiNode>("render_view", { view, instance: instance ?? null, params: params ?? null }),
  // Le due metà di un'azione arrivano come due argomenti distinti, ed è ciò che
  // impedisce alla shell di riscrivere quella del provider (§2.7): `payload` è
  // suo, `fields` è ciò che l'utente ha compilato.
  viewAction: (
    view: string,
    instance: string | null,
    params: unknown,
    action: string,
    payload?: unknown,
    fields?: FieldValue[],
  ) =>
    invoke<ViewUpdate>("view_action", {
      view,
      instance,
      params: params ?? null,
      action,
      payload: payload ?? null,
      fields: fields ?? null,
    }),
  // Comandi (protocollo generico, gemello di listViews/viewAction). La palette
  // legge questo elenco e non cabla nessun id: un comando di plugin comparirà
  // da solo, coi suoi parametri e il suo raggio.
  listCommands: () => invoke<CommandSpec[]>("list_commands"),
  // `mode` assente = `apply`: è la scelta di questo confine, non del contratto
  // (dove un default non esiste apposta).
  invokeCommand: (command: string, args?: Record<string, unknown>, mode?: InvokeMode) =>
    invoke<CommandOutcome>("invoke_command", {
      command,
      args: args ?? null,
      mode: mode ?? null,
    }),
  search: (query: string, limit?: number) =>
    invoke<SearchHit[]>("search", { query, limit }),
  listTags: () => invoke<TagCount[]>("list_tags"),
  graphData: () => invoke<GraphData>("graph_data"),
  resolveLink: (page: string) => invoke<string | null>("resolve_link", { page }),
  listVersions: (id: string) => invoke<VersionRef[]>("list_versions", { id }),
  readVersion: (id: string, ts: number) => invoke<string>("read_version", { id, ts }),
  restoreVersion: (id: string, ts: number) => invoke<void>("restore_version", { id, ts }),
  readWorkspaceMeta: () => invoke<WorkspaceMeta>("read_workspace_meta"),
  writeWorkspaceMeta: (meta: WorkspaceMeta) =>
    invoke<void>("write_workspace_meta", { meta }),
};

/// Il canale eventi del kernel. Il ritorno è la disiscrizione.
///
/// Il tipo di ritorno è scritto `() => void` e non `UnlistenFn` di proposito:
/// è lo stesso tipo, ma nominarlo obbligherebbe chi lo riceve a importare
/// `@tauri-apps` per dichiararlo — e la regola del §1.3 vale anche per i tipi,
/// o il presidio diventa una formalità che si aggira con `import type`.
export function onKernelEvent(handler: (n: KernelNotice) => void): Promise<() => void> {
  return listen<KernelNotice>("fubmd://event", (evt) => handler(evt.payload));
}
