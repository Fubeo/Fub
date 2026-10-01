import type { Extension } from "@codemirror/state";
import { createMarkdownProfile } from "./markdown/profile";
import { mountMarkdown } from "./markdown/mount";
import { createPlainTextProfile } from "./plain-text";
import { SVG_PROFILE, svgLanguage } from "./svg";

/// What a text profile needs from a window that mounts it on a bare engine.
export interface TextProfileHooks {
  readonly documentId: string;
  openWikilink(page: string, heading: string | null, block: string | null): void;
  openPath(path: string, from?: string): void;
  searchTag(tag: string): void;
}

/// The extensions of a registered text profile, by the id the surface registry
/// resolved for a document (`markdown`, `svg`, `plain-text`), for a window that mounts
/// a bare `TextEngine` without the shell around it: no completions from the
/// vault, no slash palette, and every link handed back to the caller.
/// `null` for an id the text family does not own.
export function textProfileExtensions(
  profile: string,
  hooks: TextProfileHooks,
): (() => Extension) | null {
  if (profile === "plain-text") {
    const plain = createPlainTextProfile();
    return () => plain.extensions();
  }
  // La finestra staccata scrive il sorgente: l'anteprima resta del riquadro.
  if (profile === SVG_PROFILE) return () => svgLanguage();
  if (profile !== "markdown") return null;
  const markdown = createMarkdownProfile({
    callbacks: {
      openWikilink: (page, heading, block) => hooks.openWikilink(page, heading, block),
      searchTag: (tag) => hooks.searchTag(tag),
      mountRendered: (container, html, actions) => mountMarkdown(container, html, {
        ...actions,
        documentId: hooks.documentId,
        openWikilink: (page, heading, block) => hooks.openWikilink(page, heading ?? null, block ?? null),
        openPath: (path, from) => hooks.openPath(path, from),
        searchTag: (tag) => hooks.searchTag(tag),
      }),
    },
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  return () => markdown.extensions();
}
