import type { SyntaxForm } from "../../../../host/contract";

export interface MarkdownLinkDefinition {
  readonly href: string;
  readonly title?: string;
}

export interface MarkdownFootnote {
  readonly label: string;
  readonly number: number;
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  /** UTF-16 reference start → one-based occurrence, assigned before rendering. */
  readonly references: ReadonlyMap<number, number>;
}

/** Source positions in this module are UTF-16 offsets, never persisted byte spans. */
export interface MarkdownRenderContext {
  readonly source: string;
  readonly forms?: readonly SyntaxForm[];
  readonly references: ReadonlyMap<string, MarkdownLinkDefinition>;
  readonly footnotes: ReadonlyMap<string, MarkdownFootnote>;
}

export interface MarkdownBlock {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly source: string;
  /** Computed lazily: offscreen live blocks need no HTML or DOM allocation. */
  readonly html: string;
}

export interface MarkdownDocument {
  readonly blocks: readonly MarkdownBlock[];
  readonly anchors: ReadonlyMap<string, number>;
  /** Reference definitions that can affect otherwise unchanged blocks. */
  readonly dependencies: string;
  readonly html: string;
}

export interface MarkdownRenderActions {
  readonly toggleTask?: (sourceOffset: number) => void;
  readonly openSource?: (sourceOffset: number) => void;
  readonly navigateFragment?: (id: string) => boolean;
}

export type MountMarkdown = (
  container: HTMLElement,
  html: string,
  actions: MarkdownRenderActions,
) => () => void;
