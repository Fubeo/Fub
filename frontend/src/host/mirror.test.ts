import { describe, expect, it } from "vitest";
import { MAIN_PANE } from "./contract";
import type {
  BacklinkRef,
  CommandEffect,
  CommandOutcome,
  CommandScope,
  CommandSpec,
  DocumentMatch,
  EmbedContent,
  EventMask,
  IndexQuery,
  IndexResult,
  NeighborRef,
  OpenVaults,
  RenderedDocument,
  Actor,
  KernelEvent,
  KernelNotice,
  QueryExpr,
  PaneMode,
  Selection,
  Span,
  Subject,
  TagCount,
  VaultStatus,
  FieldValue,
  TrashEntry,
  UiAction,
  UiNode,
  ViewInstance,
  PluginInfo,
  VaultInfo,
  VersionRef,
  ViewContext,
  ViewSpec,
  ViewUpdate,
  WorkspaceMeta,
} from "./contract";
// Le fixture sono generate dai tipi Rust (serde) — vedi
// `crates/fubmd-features/tests/ts_mirror.rs` (tipi del contratto) e
// `crates/fubmd-app/tests/ts_mirror_app.rs` (tipi dell'app).
import samples from "../__fixtures__/mirror-samples.json";
import appSamples from "../__fixtures__/mirror-samples-app.json";

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
    case "section":
    case "tab":
      n.children.forEach(touchUiNode);
      return;
    case "tree_item":
      n.children.forEach(touchUiNode);
      return;
    case "table":
      n.rows.forEach(touchUiNode);
      return;
    case "row":
      n.cells.forEach(touchUiNode);
      return;
    case "tree":
      n.roots.forEach(touchUiNode);
      return;
    case "tabs":
      n.tabs.forEach(touchUiNode);
      return;
    case "form":
      n.children.forEach(touchUiNode);
      return;
    case "custom":
      n.fallback.forEach(touchUiNode);
      return;
    case "text":
    case "heading":
    case "list_item":
    case "button":
    case "html":
    case "web_view":
    case "badge":
    case "icon":
    case "progress":
    case "separator":
    case "empty_state":
    case "key_value":
    case "text_input":
    case "text_area":
    case "number":
    case "checkbox":
    case "select":
    case "radio":
    case "slider":
    case "date_picker":
    case "pending":
    case "failed":
      return;
    default:
      assertNever(n);
  }
}

/// Ogni specie di valore di campo dev'essere costruibile da questa parte: è la
/// metà del §2.7 che la shell **scrive**, e un tipo nuovo in Rust che qui non
/// arrivasse sarebbe un campo che il provider riceve vuoto.
function touchUiValue(v: FieldValue["value"]): void {
  switch (v.type) {
    case "text":
    case "number":
    case "bool":
    case "choices":
      return;
    default:
      assertNever(v);
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
    case "patch":
      touchUiNode(u.node);
      return;
    default:
      assertNever(u);
  }
}

function touchCommandEffect(e: CommandEffect): void {
  switch (e.kind) {
    case "done":
    case "navigate":
    case "reveal":
    case "run_search":
    case "plan":
    case "custom":
    case "open_view":
      return;
    default:
      assertNever(e);
  }
}

/// Ogni specie di parametro dev'essere disegnabile: un `param_kind` nuovo in
/// Rust deve arrivare qui come rosso, non come un campo che la palette non
/// mostra.
function touchParamKind(k: CommandSpec["params"][number]["kind"]): void {
  switch (k.kind) {
    case "text":
    case "number":
    case "bool":
    case "document":
    case "documents":
      return;
    case "choice":
      k.value.forEach((c) => c.title);
      return;
    default:
      assertNever(k);
  }
}

function touchReach(r: CommandScope["reach"]): void {
  switch (r) {
    case "session":
    case "document":
    case "documents":
    case "vault":
    case "settings":
      return;
    default:
      assertNever(r);
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
    case "batch_ended":
    case "view_invalidated":
    case "vault_closed":
      return;
    default:
      assertNever(e);
  }
}

function touchActor(a: Actor): void {
  switch (a.kind) {
    case "user":
    case "watcher":
    case "kernel":
    case "plugin":
      return;
    default:
      assertNever(a);
  }
}

/// Ogni domanda che il kernel sa fare ha un ramo di qua: la shell le
/// **costruisce**, e una variante aggiunta in Rust che qui non esistesse
/// resterebbe una domanda che la shell non può porre — cioè il §5.4 riaperto.
function touchIndexQuery(q: IndexQuery): void {
  switch (q.kind) {
    case "documents":
      touchQueryExpr(q.matching);
      return;
    case "backlinks":
    case "outline":
      return;
    case "tags":
      touchQueryExpr(q.matching);
      return;
    case "neighbors":
      touchQueryExpr(q.seeds);
      return;
    case "property_values":
      touchQueryExpr(q.matching);
      return;
    case "vault_health":
    case "custom":
    case "vault_status":
      return;
    default:
      assertNever(q);
  }
}

/// E ogni **foglia** del linguaggio: è il pezzo che un query builder dovrà
/// disegnare, e quello che un predicato nuovo in Rust deve far diventare rosso.
function touchQueryExpr(e: QueryExpr): void {
  for (const clause of e.any) {
    for (const literal of clause.all) {
      const p = literal.predicate;
      switch (p.kind) {
        case "text":
        case "property":
        case "tag":
        case "folder":
        case "linked":
        case "docs":
        case "custom":
          continue;
        default:
          assertNever(p);
      }
    }
  }
}

function touchIndexResult(r: IndexResult): void {
  switch (r.kind) {
    case "documents":
    case "backlinks":
    case "outline":
    case "tags":
    case "neighbors":
    case "property_values":
    case "vault_health":
    case "custom":
    case "vault_status":
      return;
    default:
      assertNever(r);
  }
}

function touchSubject(s: Subject): void {
  switch (s.kind) {
    case "document":
    case "folder":
      return;
    default:
      assertNever(s);
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
  NeighborRef: keysOf<NeighborRef>({ doc: true, via: true, depth: true }),
  BacklinkRef: keysOf<BacklinkRef>({ source: true, context: true }),
  TrashEntry: keysOf<TrashEntry>({ id: true, original: true, deleted_at: true, size: true }),
  TagCount: keysOf<TagCount>({ name: true, count: true }),
  VaultStatus: keysOf<VaultStatus>({
    watching: true,
    sync_failures: true,
    last_sync_error: true,
  }),
  ViewSpec: keysOf<ViewSpec>({
    id: true,
    title: true,
    surface: true,
    refresh: true,
    follows: true,
    params: true,
    icon: true,
    order: true,
    open_by_default: true,
    preferred_size: true,
    closable: true,
  }),
  // L'esemplare vivo che la shell manda a ogni render (§2.3): la costruisce
  // lei, quindi vale la stessa ragione del contesto di sessione — un campo
  // dimenticato di qua è un errore di serde a runtime.
  ViewInstance: keysOf<ViewInstance>({ view: true, instance: true, params: true }),
  UiAction: keysOf<UiAction>({ action: true, payload: true, fields: true }),
  // Il contesto di sessione viaggia dalla shell al kernel: qui il mirror serve
  // due volte, perché un campo che il TS dimenticasse di mandare arriverebbe
  // `undefined` e serde lo rifiuterebbe a runtime, non in compilazione.
  ViewContext: keysOf<ViewContext>({ pane: true, doc: true, selection: true, mode: true }),
  Selection: keysOf<Selection>({ span: true, text: true }),
  // I comandi: la palette disegna ciò che la spec dichiara, quindi un campo
  // nuovo in Rust non deve poter restare invisibile di qua.
  CommandSpec: keysOf<CommandSpec>({
    id: true,
    title: true,
    description: true,
    keybinding: true,
    params: true,
    scope: true,
  }),
  CommandOutcome: keysOf<CommandOutcome>({ notify: true, effect: true }),
};

/// I record con campi **facoltativi**, che serde omette quando non ci sono: il
/// controllo è che ogni chiave sia dichiarata dal tipo TS e che le obbligatorie
/// ci siano, non che ci siano tutte. Un campo aggiunto in Rust e non qui resta
/// comunque rosso — arriva nella fixture e non è fra le chiavi dichiarate.
const PARTIAL_RECORD_KEYS: Record<string, { all: string[]; required: string[] }> = {
  DocumentMatch: {
    all: keysOf<Required<DocumentMatch>>({
      doc: true,
      score: true,
      snippet: true,
      highlights: true,
      properties: true,
    }),
    required: ["doc"],
  },
};

// I tipi che arrivano dall'APP (fixture gemella, `mirror-samples-app.json`).
const APP_RECORD_KEYS: Record<string, string[]> = {
  VaultInfo: keysOf<VaultInfo>({
    root: true,
    documents: true,
    extensions: true,
    plugins: true,
  }),
  PluginInfo: keysOf<PluginInfo>({
    id: true,
    name: true,
    version: true,
    abi_version: true,
    trust: true,
    permissions: true,
    registrations: true,
  }),
  EmbedContent: keysOf<EmbedContent>({ doc_id: true, html: true, parts: true }),
  RenderedDocument: keysOf<RenderedDocument>({ html: true, parts: true }),
  OpenVaults: keysOf<OpenVaults>({ roots: true, current: true }),
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
      "KernelNotice",
      "Span",
      "VersionRef",
      "DocumentMatch",
      "NeighborRef",
      "IndexQuery",
      "IndexResult",
      "BacklinkRef",
      "TrashEntry",
      "TagCount",
      "ViewSpec",
      "ViewInstance",
      "UiAction",
      "ViewContext",
      "Selection",
      "CommandSpec",
      "CommandOutcome",
    ]) {
      expect(fixture[type], `manca il tipo ${type} nella fixture`).toBeTruthy();
      expect(fixture[type].length, `nessun campione per ${type}`).toBeGreaterThan(0);
    }
    for (const type of Object.keys(APP_RECORD_KEYS)) {
      expect(appFixture[type], `manca il tipo ${type} nella fixture dell'app`).toBeTruthy();
      expect(appFixture[type].length, `nessun campione per ${type}`).toBeGreaterThan(0);
    }
  });

  it("il pannello che la shell dichiara è quello che il kernel chiama MAIN_PANE", () => {
    // Le altre righe di questo file presidiano le **forme**; questa presidia un
    // **valore**, ed è l'unico del confine che la shell scriva da sé. Il kernel
    // confronta il `pane` di un contesto con quello di prima: uno diverso è, da
    // contratto, un cambio di pannello — cioè il ridisegno di tutto ciò che
    // segue il contesto. Due costanti scritte a mano ai due lati divergono in
    // silenzio, e il difetto si vedrebbe come «si ridisegna tutto a ogni
    // pubblicazione», che non porta a questa riga.
    //
    // La catena è: costante TS → fixture → costante Rust. Regge perché la
    // fixture è generata da `ViewContext::new(MAIN_PANE)` e non da una stringa
    // scritta a mano (crates/fubmd-features/tests/ts_mirror.rs); se là tornasse
    // un letterale, questo test resterebbe verde per il motivo sbagliato.
    const contesti = fixture.ViewContext as ViewContext[];
    expect(contesti.length, "nessun campione di ViewContext").toBeGreaterThan(0);
    for (const c of contesti) {
      expect(c.pane, "il pane della fixture non è il MAIN_PANE del mirror TS").toBe(MAIN_PANE);
    }
  });

  it("ogni domanda e ogni risposta del canale dati sono gestite dal mirror", () => {
    for (const q of fixture.IndexQuery) touchIndexQuery(q as IndexQuery);
    for (const r of fixture.IndexResult) touchIndexResult(r as IndexResult);
  });

  it("una riga di risposta senza pertinenza non porta i campi che non ha", () => {
    // I campi opzionali sono **omessi** da serde, non `null`: il mirror deve
    // reggere entrambe le forme, o la prima riga di una selezione senza testo
    // stamperebbe «undefined» a schermo.
    const nuda = fixture.DocumentMatch[0] as DocumentMatch;
    expect(nuda.score).toBeUndefined();
    expect(nuda.snippet).toBeUndefined();
    const piena = fixture.DocumentMatch[1] as DocumentMatch;
    expect(piena.score).toBeTypeOf("number");
    expect(piena.snippet).toBeTypeOf("string");
  });

  it("ogni UiNode prodotto da Rust è una variante gestita dal mirror", () => {
    for (const s of fixture.UiNode) touchUiNode(s as UiNode);
  });

  it("ogni ViewUpdate prodotto da Rust è una variante gestita dal mirror", () => {
    for (const s of fixture.ViewUpdate) touchViewUpdate(s as ViewUpdate);
  });

  it("ogni specie di valore di campo prodotta da Rust è gestita dal mirror", () => {
    const azioni = fixture.UiAction as UiAction[];
    for (const a of azioni) a.fields.forEach((f) => touchUiValue(f.value));
    // Il campione «tutte le specie» esiste apposta: senza, un `ui_value` nuovo
    // passerebbe di qui senza essere toccato da nessuno.
    const ricca = azioni.find((a) => a.fields.length > 1);
    expect(ricca, "manca il campione con un campo per specie").toBeTruthy();
    expect(ricca!.fields.map((f) => f.value.type)).toContain("choices");
  });

  it("la chiave viaggia accanto alla specie, non dentro", () => {
    // È la forma su cui poggia il riconciliatore (§2.8): `key` è un campo del
    // nodo, opzionale, e non un livello di annidamento in più.
    const conChiave = (fixture.UiNode as UiNode[]).filter((n) => n.key !== undefined);
    expect(conChiave.length, "manca un campione con la chiave").toBeGreaterThan(0);
    for (const n of conChiave) expect(typeof n.key).toBe("string");
  });

  it("ogni KernelEvent prodotto da Rust è una variante gestita dal mirror", () => {
    for (const s of fixture.KernelEvent) touchEvent(s as KernelEvent);
  });

  // La maschera di un abbonamento (§10.1) non ha una voce sua nella fixture:
  // viaggia dentro `ViewSpec.refresh`, ed è da lì che la si presidia. Le due
  // cose che possono divergere in silenzio sono un campo nuovo del record — la
  // shell lo ignorerebbe, cioè filtrerebbe meno di quanto il contratto promette
  // — e una specie nuova di soggetto, che `assertNever` ferma.
  it("la maschera di una view ha le chiavi del mirror, e ogni soggetto è gestito", () => {
    const maschere = (fixture.ViewSpec as ViewSpec[]).map((s) => s.refresh);
    expect(maschere.length).toBeGreaterThan(0);
    const chiavi = keysOf<EventMask>({ kinds: true, topics: true, subjects: true });
    for (const m of maschere) {
      expect(Object.keys(m).sort()).toEqual(chiavi);
      m.kinds.forEach((k) => expect(typeof k).toBe("string"));
      m.subjects.forEach(touchSubject);
    }
    // Il campione stretto esiste apposta: senza, `topics` e `subjects`
    // sarebbero liste vuote in ogni campione e nessuno avrebbe mai toccato la
    // parte che la decisione 0033 ha aggiunto.
    const stretta = maschere.find((m) => m.topics.length > 0);
    expect(stretta, "manca il campione con un prefisso di topic").toBeTruthy();
    expect(stretta!.subjects.map((s) => s.kind)).toEqual(["document", "folder"]);
  });

  // Ciò che il ponte Tauri consegna davvero non è un evento nudo ma un
  // `KernelNotice`: l'evento e la sua origine (decisione 0012). Un mirror che avesse
  // continuato a dichiarare la forma vecchia sarebbe rimasto verde in
  // compilazione e `e.type` sarebbe stato `undefined` a runtime.
  it("ogni attore prodotto da Rust è gestito, e il notice porta l'evento dentro", () => {
    const notices = fixture.KernelNotice as KernelNotice[];
    expect(notices.length).toBeGreaterThan(0);
    for (const n of notices) {
      touchActor(n.origin.actor);
      touchEvent(n.event);
      // `batch` è `string | null`: un u64 identità come `VersionRef.hash`,
      // e `null` — non assente — fuori da un lotto.
      expect(n.origin.batch === null || typeof n.origin.batch === "string").toBe(true);
    }
    expect(notices.some((n) => n.origin.batch === null), "manca il campione fuori da un lotto").toBe(
      true,
    );
    expect(
      notices.some((n) => n.origin.actor.kind === "plugin"),
      "manca il campione di un'origine di plugin",
    ).toBe(true);
  });

  it("ogni effetto e ogni specie di parametro prodotti da Rust sono gestiti dal mirror", () => {
    for (const s of fixture.CommandOutcome) touchCommandEffect((s as CommandOutcome).effect);
    for (const s of fixture.CommandSpec) {
      const spec = s as CommandSpec;
      spec.params.forEach((p) => touchParamKind(p.kind));
      touchReach(spec.scope.reach);
    }
    // Il campione «tutte le specie» esiste apposta: senza, un `param_kind`
    // nuovo passerebbe di qui senza essere toccato da nessuno.
    const ricco = (fixture.CommandSpec as CommandSpec[]).find((s) => s.params.length > 1);
    expect(ricco, "manca il campione con un parametro per specie").toBeTruthy();
    expect(ricco!.params.some((p) => p.kind.kind === "choice")).toBe(true);
  });

  it("i record hanno esattamente le chiavi del tipo TS", () => {
    for (const [type, keys] of Object.entries(RECORD_KEYS)) {
      for (const sample of fixture[type]) {
        expect(Object.keys(sample as object).sort()).toEqual(keys);
      }
    }
    for (const [type, { all, required }] of Object.entries(PARTIAL_RECORD_KEYS)) {
      for (const sample of fixture[type]) {
        const keys = Object.keys(sample as object);
        for (const key of keys) expect(all, `${type}.${key} non è nel mirror`).toContain(key);
        for (const key of required) expect(keys, `${type}.${key} manca`).toContain(key);
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
      if (e.type === "batch_ended") expect(typeof e.batch).toBe("string");
    }
  });
});
