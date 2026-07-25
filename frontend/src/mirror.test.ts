import { describe, expect, it } from "vitest";
import type { KernelEvent, Span, UiNode, VersionRef, ViewUpdate } from "./api";
// La fixture è generata dai tipi Rust (serde) —
// vedi `crates/fubmd-features/tests/ts_mirror.rs`.
import samples from "./__fixtures__/mirror-samples.json";

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
};

describe("mirror TS↔Rust", () => {
  it("la fixture copre tutti i tipi mirrorati, e nessuno è vuoto", () => {
    for (const type of ["UiNode", "ViewUpdate", "KernelEvent", "Span", "VersionRef"]) {
      expect(fixture[type], `manca il tipo ${type} nella fixture`).toBeTruthy();
      expect(fixture[type].length, `nessun campione per ${type}`).toBeGreaterThan(0);
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
  });
});
