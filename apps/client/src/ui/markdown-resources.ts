import type { EmbedContent, RenderedDocument } from "../host/contract";
import { renderEmbed, renderPreview } from "../host/query";
import { errorText } from "../host/errors";
import { operationFromText, type TextEdit } from "../editors/core/text-operation";
import { byteToNormalizedCharIndices, normalizeLineBreaks } from "../rules/offsets";
import {
  documentSessions,
  type DocumentSession,
  type DocumentSessionCollection,
} from "../state/document-session";
import { registerDocumentCache } from "../state/document-caches";
import { t } from "../i18n/strings";
import { openLifetime } from "./lifetime";
import { notify } from "./notify";
import { Race } from "./race";
import { sanitizeFragment } from "./sanitize";

export type MarkdownResourceChange = "native" | "embeds";

export interface NativeMarkdownContent {
  /** Each surface owns its nodes; sanitized markup is never serialized and parsed again. */
  createFragment(): DocumentFragment;
  readonly parts: Readonly<RenderedDocument["parts"]>;
}

/** One lease per surface; all surfaces of a document share host artifacts. */
export interface MarkdownResources {
  readonly documentId: string;
  match(from: number, to: number): NativeMarkdownContent | undefined;
  embed(page: string, heading: string | null, block: string | null): Promise<EmbedContent>;
  subscribe(listener: (change: MarkdownResourceChange) => void): () => void;
  invalidate(): void;
  release(): void;
}

interface NativeSegment {
  readonly from: number;
  readonly to: number;
  readonly rendered: NativeMarkdownContent;
}

interface NativeSnapshot {
  readonly documentId: string;
  readonly source: string;
  readonly segments: ReadonlyMap<number, NativeSegment>;
}

interface EmbeddedRequest {
  readonly result: Promise<EmbedContent>;
  documentId?: string;
  failed: boolean;
}

function nativeSnapshot(documentId: string, original: string, rendered: RenderedDocument): NativeSnapshot {
  if (!rendered.html.includes("data-fub-renderer")) {
    return { documentId, source: "", segments: new Map() };
  }
  const fragment = sanitizeFragment(rendered.html);
  const roots: Array<{ element: Element; from: number; to: number }> = [];
  for (const element of fragment.querySelectorAll("[data-fub-renderer]")) {
    if (element.parentElement?.closest("[data-fub-renderer]")) continue;
    const start = element.getAttribute("data-fub-source-start");
    const end = element.getAttribute("data-fub-source-end");
    if (!start || !end || !/^\d+$/.test(start) || !/^\d+$/.test(end)) continue;
    const from = Number(start);
    const to = Number(end);
    if (Number.isSafeInteger(from) && Number.isSafeInteger(to) && from < to) {
      roots.push({ element, from, to });
    }
  }
  const offsets = byteToNormalizedCharIndices(original, roots.flatMap(({ from, to }) => [from, to]));
  const parts = new Map(rendered.parts.map((part) => [part.slot, part]));
  const segments = new Map<number, NativeSegment>();
  for (let index = 0; index < roots.length; index += 1) {
    const { element } = roots[index];
    const from = offsets[index * 2];
    const to = offsets[index * 2 + 1];
    if (from >= to) continue;
    // Local edit coordinates belong to the shell, never to provider markup.
    for (const child of element.querySelectorAll("[data-md-from], [data-md-to], [data-md-task]")) {
      child.removeAttribute("data-md-from");
      child.removeAttribute("data-md-to");
      child.removeAttribute("data-md-task");
    }
    const ownParts = Array.from(element.querySelectorAll("[data-ui-slot]"))
      .map((slot) => parts.get(Number(slot.getAttribute("data-ui-slot"))))
      .filter((part) => part !== undefined);
    const content = document.createDocumentFragment();
    while (element.firstChild) content.appendChild(element.firstChild);
    segments.set(from, {
      from,
      to,
      rendered: {
        createFragment: () => content.cloneNode(true) as DocumentFragment,
        parts: ownParts,
      },
    });
  }
  return { documentId, source: normalizeLineBreaks(original), segments };
}

class SharedMarkdownResources {
  references = 0;
  readonly #life = openLifetime();
  readonly #race = new Race();
  readonly #listeners = new Set<(change: MarkdownResourceChange) => void>();
  readonly #embeds = new Map<string, EmbeddedRequest>();
  #native: NativeSnapshot | undefined;
  #requested: { documentId: string; revision: string } | undefined;
  #scheduled = false;
  #invalidated = false;
  #raw = "";
  #normalized = "";
  #mappedSource: string | undefined;
  #edit: TextEdit | undefined;

  constructor(readonly session: DocumentSession, sessions: DocumentSessionCollection) {
    this.#life.add(sessions.subscribe((event) => {
      if (event.kind === "deletion-changed" && event.id === session.id) {
        if (event.pending) {
          this.#race.cancel();
          this.#requested = undefined;
        } else {
          this.#schedule();
        }
        return;
      }
      if (event.kind !== "changed" && event.kind !== "saved") return;
      if (event.id === session.id) {
        if (this.#native && this.#native.documentId !== session.id) {
          this.#native = undefined;
          this.#mappedSource = undefined;
          this.#publish("native");
        }
        if (session.dirty) {
          this.#race.cancel();
          this.#requested = undefined;
        } else {
          this.#schedule();
        }
      }
      if (event.kind === "saved" || !sessions.isDirty(event.id)) {
        this.invalidateDocument(event.id);
      }
    }));
  }

  invalidateDocument(documentId: string): void {
    let removed = false;
    for (const [key, request] of this.#embeds) {
      if (request.documentId === undefined || request.documentId === documentId || request.failed) {
        this.#embeds.delete(key);
        removed = true;
      }
    }
    if (removed) this.#publish("embeds");
  }

  subscribe(listener: (change: MarkdownResourceChange) => void): () => void {
    this.#listeners.add(listener);
    this.#schedule();
    return () => { this.#listeners.delete(listener); };
  }

  #schedule(): void {
    if (this.#scheduled || this.#life.closed || !this.#listeners.size) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.#life.closed || !this.#listeners.size || this.session.dirty) return;
      const snapshot = this.session.snapshot();
      if (snapshot.lifecycle !== "open" || snapshot.pendingDeletion || snapshot.base.kind !== "descends_from") return;
      const revision = snapshot.base.value;
      if (this.#requested?.revision === revision && this.#requested.documentId === snapshot.id) return;
      this.#requested = { documentId: snapshot.id, revision };
      void this.#race.last(async (expected) => {
        const rendered = await expected(renderPreview(snapshot.id));
        const current = this.session.snapshot();
        if (current.lifecycle !== "open" || current.dirty || current.pendingDeletion || current.id !== snapshot.id
          || current.base.kind !== "descends_from" || current.base.value !== revision
          || current.text !== snapshot.text) return;
        this.#native = nativeSnapshot(snapshot.id, snapshot.text, rendered);
        this.#mappedSource = undefined;
        this.#publish("native");
      }).catch((error: unknown) => {
        if (this.#requested?.documentId === snapshot.id && this.#requested.revision === revision) {
          this.#requested = undefined;
        }
        if (!this.#life.closed) notify(t("preview.embed_failed", { reason: errorText(error) }), "guasto");
      });
    });
  }

  match(from: number, to: number): NativeMarkdownContent | undefined {
    const snapshot = this.#native;
    if (!snapshot?.segments.size || snapshot.documentId !== this.session.id
      || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to) {
      return undefined;
    }
    const raw = this.session.text();
    if (raw !== this.#raw) {
      this.#raw = raw;
      this.#normalized = normalizeLineBreaks(raw);
    }
    if (this.#mappedSource !== this.#normalized) {
      this.#mappedSource = this.#normalized;
      this.#edit = operationFromText(snapshot.source, this.#normalized).edits[0];
    }
    const edit = this.#edit;
    if (edit) {
      if (to <= edit.from) {
        // An unchanged prefix keeps its coordinates.
      } else if (from >= edit.from + edit.inserted.length) {
        const delta = edit.inserted.length - edit.deleted.length;
        from -= delta;
        to -= delta;
      } else {
        return undefined;
      }
    }
    const segment = snapshot.segments.get(from);
    if (!segment || segment.to < to) return undefined;
    if (segment.to !== to && !/^[ \t\r\n]*$/.test(snapshot.source.slice(to, segment.to))) return undefined;
    if (edit && segment.to > edit.from && segment.from < edit.to) return undefined;
    return segment.rendered;
  }

  embed(page: string, heading: string | null, block: string | null): Promise<EmbedContent> {
    const key = JSON.stringify([page, heading, block]);
    const cached = this.#embeds.get(key);
    if (cached) return cached.result;
    const request: EmbeddedRequest = {
      failed: false,
      result: renderEmbed(page, heading, block).then((content) => {
        request.documentId = content.doc_id;
        return content;
      }).catch((error: unknown) => {
        request.failed = true;
        throw error;
      }),
    };
    this.#embeds.set(key, request);
    return request.result;
  }

  invalidate(): void {
    if (this.#invalidated || this.#life.closed) return;
    this.#invalidated = true;
    queueMicrotask(() => { this.#invalidated = false; });
    this.#race.cancel();
    this.#requested = undefined;
    this.#native = undefined;
    this.#mappedSource = undefined;
    this.#embeds.clear();
    this.#publish("embeds");
    this.#schedule();
  }

  #publish(change: MarkdownResourceChange): void {
    for (const listener of [...this.#listeners]) listener(change);
  }

  close(): void {
    this.#race.cancel();
    this.#life.close();
    this.#listeners.clear();
    this.#embeds.clear();
    this.#native = undefined;
  }
}

const resources = new WeakMap<DocumentSession, SharedMarkdownResources>();
const activeResources = new Set<SharedMarkdownResources>();
/** Listed among the document caches only while a resource is alive. */
let unregisterCache: (() => void) | undefined;

/** Invalidates transclusions even when the changed document has no open surface. */
function invalidateMarkdownResourceDocument(documentId: string): void {
  for (const resource of activeResources) resource.invalidateDocument(documentId);
}

/** Rebuilds the owner artifact after its path changes, then invalidates dependants. */
function renameMarkdownResourceDocument(from: string, to: string): void {
  for (const resource of activeResources) {
    if (resource.session.id === to) resource.invalidate();
    else resource.invalidateDocument(from);
  }
}

export function acquireMarkdownResources(
  documentId: string,
  sessions: DocumentSessionCollection = documentSessions,
): MarkdownResources | undefined {
  const session = sessions.get(documentId);
  if (!session) return undefined;
  let shared = resources.get(session);
  if (!shared) {
    shared = new SharedMarkdownResources(session, sessions);
    resources.set(session, shared);
    activeResources.add(shared);
    unregisterCache ??= registerDocumentCache({
      invalidate: invalidateMarkdownResourceDocument,
      rename: renameMarkdownResourceDocument,
    });
  }
  const retained = shared;
  retained.references += 1;
  let released = false;
  return {
    get documentId() { return retained.session.id; },
    match: (from, to) => retained.match(from, to),
    embed: (page, heading, block) => retained.embed(page, heading, block),
    subscribe: (listener) => retained.subscribe(listener),
    invalidate: () => retained.invalidate(),
    release() {
      if (released) return;
      released = true;
      retained.references -= 1;
      if (!retained.references) {
        retained.close();
        resources.delete(session);
        activeResources.delete(retained);
        if (!activeResources.size) {
          unregisterCache?.();
          unregisterCache = undefined;
        }
      }
    },
  };
}
