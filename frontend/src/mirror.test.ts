import { describe, expect, it } from "vitest";
import type {
  BacklinkRef,
  EmbedContent,
  GraphData,
  KernelEvent,
  PaneMode,
  SearchHit,
  Selection,
  Span,
  TagCount,
  TrashEntry,
  UiNode,
  VaultInfo,
  VersionRef,
  ViewContext,
  ViewSpec,
  ViewUpdate,
  WorkspaceMeta,
} from "./api";
// Le fixture sono generate dai tipi Rust (serde) — vedi
// `crates/fubmd-features/tests/ts_mirror.rs` (tipi del contratto) e
// `crates/fubmd-app/tests/ts_mirror_app.rs` (tipi dell'app).
import samples from "./__fixtures__/mirror-samples.json";
import appSamples from "./__fixtures__/mirror-samples-app.json";

// L'altra metà del presidio dei mirror (la prima è `crates/fubmd-abi`… ehm,
// `crates/fubmd-features/tests/ts_mirror.rs`): la fixture è generata dai tipi
// Rust con serde; qui si verifica che il **mirror TS gestisca ogni
// discriminante** che Rust produce. Il meccanismo è doppio:
//
// - a compile-time, `assertNever` nel `default` obbliga lo `switch` a coprire
//   ogni caso del tipo TS: aggiungere una variante al mirror senza gestirla non
//   compila;
// - a runtime, un caso presente nella fixture (cioè in Rust) ma non nello
//   `switch` finisce nel `default` e fa lanciare `assertNever` → test rosso.
//
// Così un caso aggiunto in Rust e non rispecchiato in TS non può passare in
// silenzio, che è esattamente il buco che questo confine aveva.

const fixture = samples as unknown as Record<string, unknown[]>;
const appFixture = appSamples as unknown as Record<string, unknown[]>;

function assertNever(x: never): never {
  throw new Error(`discriminante non gestito nel mirror TS: ${JSON.stringify(x)}`);
}

function touchUiNode(n: UiNode): void {
  switch (n.node) {
    case "stack":
      n.children.forEach(touchUiNode);
      return;
    case "list":
      n.items.forEach(touchUiNode);
      return;
    case "text":
    case "heading":
    case "list_item":
    case "button":
    case "html":
    case "web_view":
      return;
    default:
      assertNever(n);
  }
}

function touchViewUpdate(u: ViewUpdate): void {
  switch (u.kind) {
    case "replace":
      touchUiNode(u.root);
      return;
    case "none":
    case "navigate":
    case "reveal":
    case "run_search":
    case "custom":
      return;
    default:
      assertNever(u);
  }
}

function touchEvent(e: KernelEvent): void {
  switch (e.type) {
    case "vault_opened":
    case "document_changed":
    case "document_removed":
    case "document_renamed":
    case "index_updated":
    case "job_done":
    case "overflow":
    case "custom":
      return;
    default:
      assertNever(e);
  }
}

/// L'insieme esatto delle chiavi di un record TS: `Record<keyof T, true>`
/// obbliga il literal ad avere **tutte e sole** le chiavi di `T`, così se il
/// tipo TS cambia senza aggiornare questa lista non compila.
function keysOf<T extends object>(spec: Record<keyof T, true>): string[] {
  return Object.keys(spec).sort();
}

const RECORD_KEYS: Record<string, string[]> = {
  Span: keysOf<Span>({ start: true, end: true }),
  VersionRef: keysOf<VersionRef>({ ts: true, hash: true, size: true }),
  SearchHit: keysOf<SearchHit>({ doc: true, score: true, snippet: true, highlights: true }),
  BacklinkRef: keysOf<BacklinkRef>({ source: true, context: true }),
  TrashEntry: keysOf<TrashEntry>({ id: true, original: true, deleted_at: true, size: true }),
  TagCount: keysOf<TagCount>({ name: true, count: true }),
  ViewSpec: keysOf<ViewSpec>({
    id: true,
    title: true,
    placement: true,
    refresh: true,
    follows: true,
  }),
  // Il contesto di sessione viaggia dalla shell al kernel: qui il mirror serve
  // due volte, perché un campo che il TS dimenticasse di mandare arriverebbe
  // `undefined` e serde lo rifiuterebbe a runtime, non in compilazione.
  ViewContext: keysOf<ViewContext>({ pane: true, doc: true, selection: true, mode: true }),
  Selection: keysOf<Selection>({ span: true, text: true }),
};

// I tipi che arrivano dall'APP (fixture gemella, `mirror-samples-app.json`).
const APP_RECORD_KEYS: Record<string, string[]> = {
  VaultInfo: keysOf<VaultInfo>({
    root: true,
    documents: true,
    extensions: true,
    versioning: true,
  }),
  EmbedContent: keysOf<EmbedContent>({ doc_id: true, html: true }),
  GraphData: keysOf<GraphData>({ nodes: true, edges: true }),
  WorkspaceMeta: keysOf<WorkspaceMeta>({
    icons: true,
    pinned: true,
    order: true,
    spaces: true,
  }),
};

describe("mirror TS↔Rust", () => {
  it("la fixture copre tutti i tipi mirrorati, e nessuno è vuoto", () => {
    for (const type of [
      "UiNode",
      "ViewUpdate",
      "KernelEvent",
      "Span",
      "VersionRef",
      "SearchHit",
      "BacklinkRef",
      "TrashEntry",
      "TagCount",
      "ViewSpec",
      "ViewContext",
      "Selection",
    ]) {
      expect(fixture[type], `manca il tipo ${type} nella fixture`).toBeTruthy();
      expect(fixture[type].length, `nessun campione per ${type}`).toBeGreaterThan(0);
    }
    for (const type of Object.keys(APP_RECORD_KEYS)) {
      expect(appFixture[type], `manca il tipo ${type} nella fixture dell'app`).toBeTruthy();
      expect(appFixture[type].length, `nessun campione per ${type}`).toBeGreaterThan(0);
    }
  });

  it("ogni UiNode prodotto da Rust è una variante gestita dal mirror", () => {
    for (const s of fixture.UiNode) touchUiNode(s as UiNode);
  });

  it("ogni ViewUpdate prodotto da Rust è una variante gestita dal mirror", () => {
    for (const s of fixture.ViewUpdate) touchViewUpdate(s as ViewUpdate);
  });

  it("ogni KernelEvent prodotto da Rust è una variante gestita dal mirror", () => {
    for (const s of fixture.KernelEvent) touchEvent(s as KernelEvent);
  });

  it("i record hanno esattamente le chiavi del tipo TS", () => {
    for (const [type, keys] of Object.entries(RECORD_KEYS)) {
      for (const sample of fixture[type]) {
        expect(Object.keys(sample as object).sort()).toEqual(keys);
      }
    }
    for (const [type, keys] of Object.entries(APP_RECORD_KEYS)) {
      for (const sample of appFixture[type]) {
        expect(Object.keys(sample as object).sort()).toEqual(keys);
      }
    }
  });

  it("ogni modalità prodotta da Rust è una modalità del mirror", () => {
    // Un `enum` non ha un discriminante da esaurire con uno switch: la prova è
    // che ogni valore che Rust serializza sia assegnabile al tipo TS, e che il
    // tipo TS non abbia valori in più (l'array qui sotto li elenca tutti).
    const tutte: PaneMode[] = ["source", "live_preview", "reading"];
    for (const c of fixture.ViewContext as ViewContext[]) {
      expect(tutte).toContain(c.mode);
    }
    // La regola dello span: `text` c'è sempre, `span` no (buffer sporco).
    const sporca = (fixture.ViewContext as ViewContext[]).find(
      (c) => c.selection !== null && c.selection.span === null,
    );
    expect(sporca, "manca il campione col buffer sporco").toBeTruthy();
    expect(typeof sporca!.selection!.text).toBe("string");
  });

  it("gli u64 identità/impronta attraversano l'IPC come stringhe", () => {
    // La regola di confine (fubmd_abi::ipc): oltre 2^53 un number JS perde
    // bit in silenzio. Il campione Rust usa u64::MAX apposta.
    for (const sample of fixture.VersionRef as VersionRef[]) {
      expect(typeof sample.hash).toBe("string");
      expect(typeof sample.ts).toBe("number");
    }
    for (const e of fixture.KernelEvent as KernelEvent[]) {
      if (e.type === "job_done") expect(typeof e.id).toBe("string");
    }
  });
});
