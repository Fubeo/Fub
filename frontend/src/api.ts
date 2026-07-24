// Wrapper tipizzati sui comandi/eventi IPC del backend Rust.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface VaultInfo {
  root: string;
  documents: string[];
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

// Evento del kernel (rispecchia fubmd_abi::event::Event).
export type KernelEvent =
  | { type: "vault_opened"; root: string }
  | { type: "document_changed"; id: string }
  | { type: "document_removed"; id: string }
  | { type: "document_renamed"; from: string; to: string }
  | { type: "index_updated" }
  | { type: "custom"; topic: string; payload: unknown };

export interface EmbedContent {
  doc_id: string;
  html: string;
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
  renderPreview: (id: string) => invoke<string>("render_preview", { id }),
  renderEmbed: (page: string, heading: string | null) =>
    invoke<EmbedContent>("render_embed", { page, heading }),
  backlinksView: (id: string) => invoke<UiNode>("backlinks_view", { id }),
  resolveLink: (page: string) => invoke<string | null>("resolve_link", { page }),
};

export function onKernelEvent(
  handler: (e: KernelEvent) => void,
): Promise<UnlistenFn> {
  return listen<KernelEvent>("fubmd://event", (evt) => handler(evt.payload));
}
