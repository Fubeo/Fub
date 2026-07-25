// Wrapper tipizzati sui comandi/eventi IPC del backend Rust.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface VaultInfo {
  root: string;
  documents: string[];
  // Le estensioni che i provider registrati gestiscono (minuscole, senza
  // punto). Quale sia l'estensione di un documento lo sanno i FormatDescriptor
  // del backend: la UI non deve cablare ".md".
  extensions: string[];
  // Il versioning è acceso? Spento significa assente: niente cronologia in UI
  // e nessuna scrittura nel vault (D7).
  versioning: boolean;
}

// Una versione salvata (rispecchia fubmd_features::versioning::VersionRef).
export interface VersionRef {
  // Istante dello snapshot in millisecondi UNIX: è anche la sua identità.
  ts: number;
  hash: number;
  size: number;
}

export interface BacklinkRef {
  source: string;
  context: string | null;
}

// Albero di UI dichiarativa (rispecchia fubmd_abi::ui::UiNode).
export type UiNode =
  | { node: "stack"; dir: "row" | "column"; gap: number; children: UiNode[] }
  | { node: "text"; content: string }
  | { node: "heading"; level: number; content: string }
  | { node: "list"; items: UiNode[] }
  | { node: "list_item"; title: string; subtitle: string | null; action: string | null }
  | { node: "button"; label: string; intent: string; action: string }
  | { node: "html"; html: string }
  | { node: "web_view"; url: string; height: number };

// Aggiornamento restituito da un ViewProvider dopo un'azione
// (rispecchia fubmd_abi::ui::ViewUpdate). Il frontend lo interpreta: `replace`
// ridisegna la view, `navigate` apre un documento, `none` non fa nulla.
export type ViewUpdate =
  | { kind: "replace"; root: UiNode }
  | { kind: "none" }
  | { kind: "navigate"; doc_id: string }
  | { kind: "reveal"; doc_id: string; span: Span };

// Evento del kernel (rispecchia fubmd_abi::event::Event).
export type KernelEvent =
  | { type: "vault_opened"; root: string }
  | { type: "document_changed"; id: string }
  | { type: "document_removed"; id: string }
  | { type: "document_renamed"; from: string; to: string }
  | { type: "index_updated" }
  // Esito di un job in background (HostApi::spawn_job).
  | { type: "job_done"; id: number; job: string; result: unknown }
  // Coda eventi troncata: lo stato derivato dagli eventi va riconciliato.
  | { type: "overflow"; dropped: number }
  | { type: "custom"; topic: string; payload: unknown };

export interface EmbedContent {
  doc_id: string;
  html: string;
}

// Intervallo in byte (rispecchia fubmd_abi::model::Span).
export interface Span {
  start: number;
  end: number;
}

// Un risultato di ricerca (rispecchia fubmd_abi::traits::SearchHit).
// `snippet` è testo semplice, MAI markup: si inserisce come testo. Le porzioni
// da evidenziare sono `highlights`, intervalli in byte dentro `snippet`.
export interface SearchHit {
  doc: string;
  score: number;
  snippet: string;
  highlights: Span[];
}

// Una voce del cestino (rispecchia fubmd_kernel::vault::TrashEntry).
export interface TrashEntry {
  // Dove il file si trova ora, dentro `.trash/`.
  id: string;
  // Dove tornerebbe un ripristino.
  original: string;
  // Istante della cancellazione, in secondi UNIX.
  deleted_at: number;
  size: number;
}

// Metadati di organizzazione del vault (rispecchia fubmd_app::WorkspaceMeta):
// icone, note appuntate, ordinamenti per-cartella e spazio attivo. Vivono nel
// sidecar `.fubmd/workspace.json` dentro il vault, che il kernel ignora. Le
// chiavi sono path relativi al vault: DocId per le note, path senza slash
// finale per le cartelle ("" è la radice).
export interface WorkspaceMeta {
  icons: Record<string, string>;
  pinned: string[];
  order: Record<string, string[]>;
  // Cartelle registrate come "spazi" (striscia di icone), nel loro ordine.
  // Lo spazio SELEZIONATO è stato di vista per-macchina: localStorage.
  spaces: string[];
}

export const api = {
  initialVault: () => invoke<string | null>("initial_vault"),
  openVault: (path: string) => invoke<VaultInfo>("open_vault", { path }),
  listDocuments: () => invoke<string[]>("list_documents"),
  readDocument: (id: string) => invoke<string>("read_document", { id }),
  writeDocument: (id: string, source: string) =>
    invoke<void>("write_document", { id, source }),
  renameDocument: (from: string, to: string) =>
    invoke<void>("rename_document", { from, to }),
  createNote: (name?: string) => invoke<string>("create_note", { name: name ?? null }),
  deleteDocument: (id: string) => invoke<string>("delete_document", { id }),
  listTrash: () => invoke<TrashEntry[]>("list_trash"),
  // Il primo nome libero della famiglia «Nota», «Nota 1», … (D3). La
  // convenzione vive nel kernel: chiederla evita di averne due versioni.
  proposeFreeName: (id: string) => invoke<string>("propose_free_name", { id }),
  restoreFromTrash: (id: string, to?: string) =>
    invoke<string>("restore_from_trash", { id, to: to ?? null }),
  emptyTrash: () => invoke<number>("empty_trash"),
  renderPreview: (id: string) => invoke<string>("render_preview", { id }),
  renderEmbed: (page: string, heading: string | null) =>
    invoke<EmbedContent>("render_embed", { page, heading }),
  // View dichiarative (protocollo generico). La shell imposta il documento
  // attivo, chiede l'albero di una view e rimanda le azioni al provider, senza
  // sapere cosa la view faccia — è il percorso di un plugin.
  setActiveDocument: (id: string | null) =>
    invoke<void>("set_active_document", { id }),
  renderView: (view: string) => invoke<UiNode>("render_view", { view }),
  viewAction: (view: string, action: string, payload?: unknown) =>
    invoke<ViewUpdate>("view_action", { view, action, payload: payload ?? null }),
  search: (query: string, limit?: number) =>
    invoke<SearchHit[]>("search", { query, limit }),
  resolveLink: (page: string) => invoke<string | null>("resolve_link", { page }),
  listVersions: (id: string) => invoke<VersionRef[]>("list_versions", { id }),
  readVersion: (id: string, ts: number) => invoke<string>("read_version", { id, ts }),
  restoreVersion: (id: string, ts: number) => invoke<void>("restore_version", { id, ts }),
  readWorkspaceMeta: () => invoke<WorkspaceMeta>("read_workspace_meta"),
  writeWorkspaceMeta: (meta: WorkspaceMeta) =>
    invoke<void>("write_workspace_meta", { meta }),
};

export function onKernelEvent(
  handler: (e: KernelEvent) => void,
): Promise<UnlistenFn> {
  return listen<KernelEvent>("fubmd://event", (evt) => handler(evt.payload));
}
