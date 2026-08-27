// **L'host finto**: un vault in memoria che risponde a tutta la porta, e a cui
// si può chiedere cosa gli è stato chiesto.
//
// # Perché esiste, e cosa presidia
//
// I presidi di questa shell provano dei *moduli*: `rules/`, `state/`, i due
// pannelli che hanno una regola dentro. Nessuno prova il **cablaggio** — chi si
// monta prima di chi, quale porta attraversa un gesto, quale argomento ci
// arriva — e il cablaggio è precisamente ciò che la
// [decisione 0015](../../../docs/decisions/0190-sessioni-documento-e-undo.md)
// dichiara di non poter verificare: *«è anche il giro che ha spostato ogni
// ascoltatore di eventi, e questa è la classe di difetti che i test di questa
// shell non vedono»*. Quel verbale rimanda al §17.2, e questo file è la metà
// che rimandava.
//
// # Le tre regole che lo tengono onesto
//
// 1. **È un modulo intero, non un pezzo di modulo.** Il tipo di ritorno è
//    `typeof import("./ipc")`: se domani la shell si dà una porta nuova, questo
//    file non compila finché non la sa rispondere. È la sola forma che il
//    compilatore sappia tenere ferma — i mock scritti dentro un `vi.mock`
//    ({`api: { viewState, setViewState }`}) non li guarda nessuno, e un giorno
//    presidiano una porta che non esiste più.
// 2. **Non conosce nessuna feature.** È un vault e nient'altro: file, cestino,
//    revisioni, eventi. I comandi che sa eseguire sono i cinque di `COMANDI`,
//    che sono del contratto e non di una feature.
// 3. **Ciò che non sa fare LANCIA.** Una query che non riconosce, un comando
//    che non ha, una view che non ha dichiarato: eccezione, mai una risposta
//    vuota. Un host finto accomodante è il modo più rapido di scrivere un E2E
//    che passa mentre la shell chiede la cosa sbagliata — e siccome la
//    risposta vuota è indistinguibile da «non c'era niente», il presidio
//    resterebbe verde per sempre.
//
// # Cosa NON prova, e va detto qui perché nessuno lo deduca
//
// Un E2E contro questo file **non prova l'app**: prova la shell. Che il ponte
// Tauri serializzi davvero questi record, che la webview li disegni, e che il
// kernel faccia ciò che questo file finge, sono tre cose che restano fuori — le
// prime due non hanno oggi un presidio, la terza ce l'ha in `cargo test` ed è
// il posto giusto. Il mirror del contratto (`host/mirror.test.ts`) tiene ferma
// la forma dei record; questo file non ne è un secondo, e infatti le risposte
// che compone sono tipizzate dal contratto e non da sé.
import type {
  BundleInfo,
  CommandSpec,
  DraftInfo,
  IndexQuery,
  IndexResult,
  KernelEvent,
  KernelNotice,
  Organization,
  PluginError,
  QueryExpr,
  QueryPredicate,
  SettingEntry,
  SettingValue,
  SyntaxForm,
  UiNode,
  VaultEntry,
  VaultFolder,
  VaultInfo,
  ViewSpec,
} from "./contract";

/// Una chiamata arrivata alla porta: quale, e con cosa.
///
/// Il registro delle chiamate è metà del valore di questo file. «La nota si è
/// aperta» si vede anche guardando lo schermo; «si è aperta chiedendola con una
/// finestra da uno» no, e sono le due cose che il §14.4 ha deciso.
export interface Call {
  gate: string;
  args: unknown[];
}

/// Un documento del vault finto: il testo e la revisione che lo nomina.
interface Document {
  text: string;
  revision: string;
}

/// Una voce del cestino finto.
interface Trashed {
  original: string;
  text: string;
}

export interface Options {
  /// I file del vault: path → testo. Le cartelle si deducono dai path, come
  /// sul disco.
  file?: Record<string, string>;
  /// La radice da aprire all'avvio, o `null` per una finestra vuota.
  root?: string | null;
  /// L'avviso di sessione (§25.5) che il pull risponde, o `null` (default)
  /// per una sessione sana.
  sessionNotice?: KernelNotice | null;
  /// Le view che i provider dichiarano. Vuoto = nessun provider registrato,
  /// che è uno stato legittimo e non un vault a metà.
  view?: ViewSpec[];
  /// I comandi del registro **oltre** ai cinque strutturali.
  commands?: CommandSpec[];
  /// Le impostazioni risolte che il canale dati risponde.
  settings?: SettingEntry[];
  /// Le forme sintattiche effettive risposte dal montaggio finto.
  syntaxForms?: SyntaxForm[];
}

/// L'host finto e le maniglie per guidarlo.
export interface FakeHost {
  /// Ciò che si passa a `vi.mock("./host/ipc")`.
  module: typeof import("./ipc");
  /// I file, come stanno adesso: è ciò su cui si asserisce dopo un gesto.
  files(): Record<string, string>;
  /// Il cestino, dal più recente.
  trash(): { id: string; original: string }[];
  /// Le chiamate arrivate alla porta, in ordine.
  calls: Call[];
  /// Le chiamate a **quella** porta, in ordine.
  atGate(gate: string): Call[];
  /// Rinomina un file **senza che la shell l'abbia chiesto**: è il `mv` da
  /// terminale, l'altra applicazione, il sync. Il file si muove e l'evento
  /// arriva, che è l'ordine in cui le due cose succedono davvero.
  renameFromOutside(from: string, to: string): void;
  /// Tiene in volo ciò che una porta risponde, finché non si chiama ciò che
  /// torna.
  ///
  /// È il modo di **costruire** una corsa invece di aspettarla: un tempo non è
  /// un segnale, e due `setTimeout` che si sperano nell'ordine giusto sono un
  /// banco che passa verde su una macchina scarica. Con questo l'ordine di
  /// arrivo lo scrive il banco — è la stessa forma della finta scrittura di
  /// `state/saving.test.ts`, portata sul confine invece che sul modulo.
  throttle(gate: string): () => void;
  /// Fa rispondere **no** a una porta, finché non si chiama ciò che torna.
  ///
  /// L'altra faccia di [`throttle`](FakeHost.throttle): quella tiene in volo,
  /// questa rifiuta. Serve ai banchi che provano cosa succede **dopo** un
  /// guasto — un disco pieno, un permesso negato — che è il solo momento in cui
  /// si vede se una precondizione ignorata fa danno.
  ///
  /// Ciò che la porta avrebbe fatto **non lo fa**: una scrittura guasta non
  /// lascia i byte, o un banco che chiede «il disco rifiuta» leggerebbe il file
  /// nuovo e crederebbe di aver provato il contrario.
  fault(gate: string, reason?: string): () => void;

  /// Chiede di chiudere la finestra, e **aspetta** ciò che la shell fa prima.
  ///
  /// Alza se nessuno si è iscritto: una chiusura consegnata a nessuno non
  /// fallisce da sé, ed è esattamente il difetto che questo simula (0205).
  close(): Promise<void>;

  /// Manda un evento del kernel a chi si è iscritto, come farebbe il ponte.
  ///
  /// Restituisce `false` se **nessuno** era iscritto: è il caso che interessa
  /// di più, perché è ciò che succede quando un ascoltatore si monta dopo il
  /// router — e un evento consegnato a nessuno non fallisce da sé.
  emit(event: KernelEvent): boolean;
}

/// L'host finto, pronto a rispondere.
export function createFakeHost(options: Options = {}): FakeHost {
  const root = options.root === undefined ? "/vault" : options.root;
  const docs = new Map<string, Document>();
  const trash = new Map<string, Trashed>();
  const viewStates = new Map<string, unknown>();
  const calls: Call[] = [];
  const view = options.view ?? [];
  let listener: ((n: KernelNotice) => void) | null = null;
  let onClose: (() => Promise<void>) | null = null;
  let revision = 0;
  let trashedCount = 0;

  for (const [id, text] of Object.entries(options.file ?? {})) write(id, text);

  function write(id: string, text: string): string {
    revision += 1;
    const rev = `r${revision}`;
    docs.set(id, { text, revision: rev });
    return rev;
  }

  /// Registra la chiamata e restituisce ciò che la porta risponde.
  /// I freni accesi, per nome di porta: finché la promessa non si risolve, ciò
  /// che quella porta risponde resta in volo.
  const throttles = new Map<string, Promise<void>>();

  /// Le porte guaste, col motivo che rispondono.
  const faults = new Map<string, string>();

  function gate<T>(name: string, args: unknown[], result: T): T {
    calls.push({ gate: name, args });
    const fault = faults.get(name);
    if (fault !== undefined && result instanceof Promise) {
      // La risposta che questa porta avrebbe dato si butta, e si butta
      // **guardandola**: una promessa rifiutata che nessuno ascolta è un
      // avviso di runtime in mezzo all'output del banco.
      void (result as Promise<unknown>).catch(() => {});
      return Promise.reject(new Error(fault)) as T;
    }
    const throttle = throttles.get(name);
    // La chiamata è **già registrata**: un banco che aspetta «la scrittura è
    // partita» deve vederla partire anche mentre è frenata, o non avrebbe modo
    // di far cominciare la seconda.
    if (throttle && result instanceof Promise) return throttle.then(() => result) as T;
    return result;
  }

  function emit(event: KernelEvent): boolean {
    if (!listener) return false;
    listener({ event, origin: { actor: { kind: "user" }, batch: null } });
    return true;
  }

  /// Un documento è di tipo `document` se ha un'estensione che il vault
  /// dichiara: è la regola del §14.1, e vale anche qui perché la shell la
  /// legge dalla risposta e non dalla propria testa.
  function entryKind(id: string): VaultEntry["kind"] {
    return id.endsWith(".md") ? "document" : "asset";
  }

  function entry(id: string): VaultEntry {
    return {
      id,
      kind: entryKind(id),
      size: docs.get(id)?.text.length ?? 0,
      mtime: 0,
      fingerprint: null,
    };
  }

  function folderOf(id: string): string {
    const cut = id.lastIndexOf("/");
    return cut < 0 ? "" : id.slice(0, cut);
  }

  /// Impagina, e dice il totale **prima** della finestra: è ciò che `Paged`
  /// promette, e la differenza si vede solo con più righe della finestra.
  function paginate<T>(items: T[], page?: { offset: number; limit: number } | null) {
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? items.length;
    return { items: items.slice(offset, offset + limit), offset, total: items.length };
  }

  /// Il linguaggio delle query, per quel tanto che una shell ne parla.
  ///
  /// Le foglie che non riconosce **lanciano**: una ricerca che risponde vuoto
  /// perché il finto non sapeva leggerla somiglia troppo a una ricerca senza
  /// risultati.
  function matches(id: string, expr: QueryExpr): boolean {
    if (expr.any.length === 0) return true;
    return expr.any.some((clause) =>
      clause.all.every((lit) => lit.negated !== leaf(id, lit.predicate)),
    );
  }

  function leaf(id: string, p: QueryPredicate): boolean {
    const text = docs.get(id)?.text ?? "";
    switch (p.kind) {
      case "text": {
        const needle = p.text.toLowerCase();
        return id.toLowerCase().includes(needle) || text.toLowerCase().includes(needle);
      }
      case "docs":
        return p.docs.includes(id);
      case "folder":
        return p.descendants ? id.startsWith(`${p.path}/`) : folderOf(id) === p.path;
      case "tag":
        return text.includes(`#${p.name}`);
      default:
        throw new Error(`host fake: non so leggere il predicato ${p.kind}`);
    }
  }

  /// Le impostazioni **come stanno adesso**: una scrittura le cambia.
  ///
  /// Un finto che accettasse `setSetting` e poi rispondesse il valore di prima
  /// farebbe passare verde ogni gesto che scrive una configurazione — e la
  /// regola di questo file è l'opposta (ciò che non sa fare lancia).
  const settings: SettingEntry[] = (options.settings ?? []).map((e) => ({
    ...e,
    spec: { ...e.spec },
  }));
  const syntaxForms = (options.syntaxForms ?? []).map((form) => ({ ...form }));

  /// Scrive, e **lo dice**: il backend vero emette `setting_changed` da tutte e
  /// due le porte — dal `Workspace` con un vault aperto, dall'host senza
  /// (§16.3) — e chi ascolta è la tastiera, che rilegge gli accordi. Un finto
  /// che scrivesse in silenzio farebbe passare verde una shell che continua a
  /// rispondere alla combinazione vecchia.
  function writeSetting(key: string, value: SettingValue | null): void {
    const row = settings.find((e) => e.spec.key === key);
    if (!row) throw new Error(`host fake: nessuno ha dichiarato l'impostazione «${key}»`);
    row.value = value ?? row.spec.kind.default;
    row.source = value === null ? "default" : row.spec.scope;
    emit({ type: "setting_changed", key, scope: row.spec.scope });
  }

  function query(q: IndexQuery): IndexResult {
    switch (q.kind) {
      case "entries": {
        const within = q.within;
        let ids = [...docs.keys()].sort();
        if (q.of_kind) ids = ids.filter((id) => entryKind(id) === q.of_kind);
        if (within) {
          ids = within.descendants
            ? ids.filter((id) => within.path === "" || id.startsWith(`${within.path}/`))
            : ids.filter((id) => folderOf(id) === within.path);
        }
        return { kind: "entries", value: paginate(ids.map(entry), q.page) };
      }
      case "folders": {
        const under = q.under;
        const all = new Set<string>();
        for (const id of docs.keys()) {
          const parts = id.split("/").slice(0, -1);
          for (let i = 1; i <= parts.length; i += 1) all.add(parts.slice(0, i).join("/"));
        }
        let list = [...all].sort();
        if (under) {
          list = under.descendants
            ? list.filter((p) => under.path === "" || p.startsWith(`${under.path}/`))
            : list.filter((p) => folderOf(p) === under.path);
        }
        const folders: VaultFolder[] = list.map((path) => ({
          path,
          folders: list.filter((p) => folderOf(p) === path).length,
          entries: [...docs.keys()].filter((id) => folderOf(id) === path).length,
        }));
        return { kind: "folders", value: paginate(folders, q.page) };
      }
      case "documents": {
        const found = [...docs.keys()]
          .filter((id) => matches(id, q.matching))
          .sort()
          .map((doc) => ({ doc }));
        return { kind: "documents", value: paginate(found, q.page) };
      }
      case "vault_status":
        return {
          kind: "vault_status",
          value: {
            watching: true,
            sync_failures: 0,
            last_sync_error: null,
            indexing: "ready",
          },
        };
      case "settings":
        return { kind: "settings", value: settings.map((e) => ({ ...e })) };
      case "organization": {
        const org: Organization = { icons: {}, pinned: [], order: {}, spaces: [] };
        return { kind: "organization", value: org };
      }
      case "drafts": {
        const drafts: DraftInfo[] = [];
        return { kind: "drafts", value: paginate(drafts, q.page) };
      }
      case "jobs":
        return { kind: "jobs", value: [] };
      case "resolve": {
        const target = q.target;
        if (target.kind !== "wiki") return { kind: "resolved", value: null };
        // Un wikilink **senza pagina** (`[[#Sezione]]`, `[[#^blocco]]`) nomina
        // il documento che lo ospita: il finto lo risponde come il kernel, o
        // sarebbe un finto accomodante — e un finto accomodante fa passare un
        // e2e mentre la shell chiede la cosa sbagliata.
        const { page, heading, block } = target.value;
        if (page.trim() === "" && (heading !== null || block !== null)) {
          return { kind: "resolved", value: q.from ? { doc: q.from } : null };
        }
        const expected = `${page}.md`;
        const hit = [...docs.keys()].find((id) => id === expected || id.endsWith(`/${expected}`));
        return { kind: "resolved", value: hit ? { doc: hit } : null };
      }
      case "tags":
        return { kind: "tags", value: paginate([], q.page) };
      case "render_preview":
        return {
          kind: "render_preview",
          value: { html: docs.get(q.doc)?.text ?? "", parts: [] },
        };
      case "render_embed":
        return {
          kind: "render_embed",
          value: { doc_id: q.page, html: "", parts: [] },
        };
      case "syntax_forms":
        return { kind: "syntax_forms", value: syntaxForms.map((form) => ({ ...form })) };
      default:
        throw new Error(`host fake: non so rispondere alla query ${q.kind}`);
    }
  }

  /// I comandi strutturali, che sono del contratto (`COMMANDS`) e non di una
  /// feature: è la parte del registro che questa shell nomina per id, e
  /// quindi l'unica che un host finto debba saper eseguire. `search.open` è
  /// lì accanto per un motivo solo: è il comando di sola lettura che i banchi
  /// della palette usano per provare che un comando che non scrive non
  /// flussa — e un host finto che non lo sapesse eseguire lancerebbe al posto
  /// di rispondere.
  function command(id: string, args: Record<string, unknown> | null) {
    switch (id) {
      case "search.open":
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      case "note.create": {
        const name = typeof args?.name === "string" && args.name ? args.name : "Untitled";
        const doc = `${name}.md`;
        write(doc, "");
        emit({ type: "document_changed", id: doc });
        return { notify: null, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
      }
      case "note.rename": {
        const from = String(args?.doc);
        const to = String(args?.to);
        const before = docs.get(from);
        if (!before) throw new Error(`host fake: «${from}» non esiste`);
        docs.delete(from);
        docs.set(to, before);
        emit({ type: "document_renamed", from, to });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "note.trash": {
        const doc = String(args?.doc);
        const before = docs.get(doc);
        if (!before) throw new Error(`host fake: «${doc}» non esiste`);
        docs.delete(doc);
        trashedCount += 1;
        trash.set(`.trash/${trashedCount}-${doc}`, { original: doc, text: before.text });
        emit({ type: "document_removed", id: doc });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "trash.restore": {
        const trashEntry = String(args?.entry);
        const inside = trash.get(trashEntry);
        if (!inside) throw new Error(`host fake: «${trashEntry}» non è nel cestino`);
        trash.delete(trashEntry);
        write(inside.original, inside.text);
        emit({ type: "document_changed", id: inside.original });
        return {
          notify: null,
          effect: { kind: "navigate" as const, doc: inside.original },
          undo: null,
          partial: null,
        };
      }
      case "trash.empty":
        trash.clear();
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      default:
        throw new Error(`host fake: il command «${id}» non esiste`);
    }
  }

  const module: typeof import("./ipc") = {
    api: {
      initialVault: () => gate("initialVault", [], Promise.resolve(root)),
      sessionNotice: () =>
        gate("sessionNotice", [], Promise.resolve(options.sessionNotice ?? null)),
      openVault: (path) => {
        const info: VaultInfo = { root: path, extensions: ["md"], plugins: [], unread: [] };
        return gate("openVault", [path], Promise.resolve(info));
      },
      readDocument: (id) => {
        const doc = docs.get(id);
        if (!doc) return gate("readDocument", [id], Promise.reject(new Error(`«${id}» non c'è`)));
        return gate(
          "readDocument",
          [id],
          Promise.resolve({ text: doc.text, revision: doc.revision }),
        );
      },
      writeDocument: (id, source, base) => {
        // Il guasto si chiede **prima** di posare i byte: `write` gira mentre
        // si compone l'argomento di `gate`, quindi una porta guasta che ci
        // passasse dentro risponderebbe «no» avendo già scritto.
        const fault = faults.get("writeDocument");
        if (fault !== undefined) {
          return gate("writeDocument", [id, source, base], Promise.reject(new Error(fault)));
        }
        const before = docs.get(id);
        if (base.kind === "descends_from" && before && before.revision !== base.value) {
          const conflict: PluginError = {
            kind: "conflict",
            message: `conflict: «${id}» è changed sotto`,
          };
          return gate(
            "writeDocument",
            [id, source, base],
            Promise.reject(conflict),
          );
        }
        return gate("writeDocument", [id, source, base], Promise.resolve(write(id, source)));
      },
      // La rete di sicurezza del §15.2: il testo che non si è salvato. Il
      // finto non ha un crash buffer — registra e basta — perché ciò che i
      // banchi guardano è CHE la bozza parta, con quale testo e in che ordine
      // rispetto al salvataggio; la tenuta del disco è del kernel, e ha i
      // suoi banchi dall'altra parte.
      saveDraft: (id, text, base) => gate("saveDraft", [id, text, base], Promise.resolve()),
      discardDraft: (id) => gate("discardDraft", [id], Promise.resolve()),
      setActiveContext: (context) => gate("setActiveContext", [context], Promise.resolve([])),
      setSystemLocale: (locale) => gate("setSystemLocale", [locale], Promise.resolve(false)),
      listViews: () => gate("listViews", [], Promise.resolve(view)),
      renderView: (v, instance, params) => {
        const tree = viewTree(v);
        return gate("renderView", [v, instance, params], Promise.resolve(tree));
      },
      viewAction: (v, instance, params, action, payload, fields) => {
        calls.push({ gate: "viewAction", args: [v, instance, params, action, payload, fields] });
        if (v === TRASH_VIEW && action === "restore") {
          command("trash.restore", { entry: String(payload) });
          return Promise.resolve({ kind: "replace" as const, root: viewTree(v) });
        }
        throw new Error(`host fake: la view «${v}» non ha l'azione «${action}»`);
      },
      listCommands: () => gate("listCommands", [], Promise.resolve(options.commands ?? [])),
      invokeCommand: (commandId, args, mode) =>
        gate(
          "invokeCommand",
          [commandId, args, mode],
          Promise.resolve(command(commandId, args ?? null)),
        ),
      queryIndex: (q) => gate("queryIndex", [q], Promise.resolve(query(q))),
      cancelJob: (id) => gate("cancelJob", [id], Promise.resolve()),
      setIcon: (path, icon) => gate("setIcon", [path, icon], Promise.resolve()),
      setPinned: (id, pinned) => gate("setPinned", [id, pinned], Promise.resolve()),
      setSpace: (path, space) => gate("setSpace", [path, space], Promise.resolve()),
      setOrder: (folder, names) => gate("setOrder", [folder, names], Promise.resolve()),
      setSetting: (key, value) =>
        gate("setSetting", [key, value], Promise.resolve(writeSetting(key, value))),
      resetSetting: (key) =>
        gate("resetSetting", [key], Promise.resolve(writeSetting(key, null))),
      listBundles: () => gate("listBundles", [], Promise.resolve([] as BundleInfo[])),
      setPluginEnabled: (id, enabled) =>
        gate("setPluginEnabled", [id, enabled], Promise.resolve([])),
      knownVaults: () => gate("knownVaults", [], Promise.resolve([])),
      setVaultFavorite: (path, favorite) =>
        gate("setVaultFavorite", [path, favorite], Promise.resolve()),
      setVaultLook: (path, icon, name) =>
        gate("setVaultLook", [path, icon, name], Promise.resolve()),
      forgetVault: (path) => gate("forgetVault", [path], Promise.resolve()),
      pendingKeybindings: () => gate("pendingKeybindings", [], Promise.resolve({})),
      adoptKeybindings: () => gate("adoptKeybindings", [], Promise.resolve()),
      discardKeybindings: () => gate("discardKeybindings", [], Promise.resolve()),
      viewState: <T>(key: string) =>
        gate("viewState", [key], Promise.resolve((viewStates.get(key) ?? null) as T | null)),
      setViewState: (key, value) => {
        if (value === null || value === undefined) viewStates.delete(key);
        else viewStates.set(key, value);
        return gate("setViewState", [key, value], Promise.resolve());
      },
    },
    onKernelEvent: (handler) => {
      listener = handler;
      calls.push({ gate: "onKernelEvent", args: [] });
      return Promise.resolve(() => {
        listener = null;
      });
    },
    onClose: (before) => {
      onClose = before;
      calls.push({ gate: "allaChiusura", args: [] });
      return Promise.resolve(() => {
        onClose = null;
      });
    },
    window: {
      minimize: () => gate("finestra.minimizza", [], Promise.resolve()),
      toggleMaximize: () => gate("finestra.alternaMassimizza", [], Promise.resolve()),
      close: () => gate("finestra.chiudi", [], Promise.resolve()),
      isMaximized: () => gate("finestra.eMassimizzata", [], Promise.resolve(false)),
      onResize: (_cb) => gate("finestra.onCambio", [], Promise.resolve(() => {})),
    },
  };

  /// L'albero che una view del finto disegna. Solo il cestino ne ha uno: è la
  /// view su cui il §17.2 chiede il giro del ripristino, ed è l'unica che
  /// questa shell attraversi senza sapere cosa contiene.
  function viewTree(v: string): UiNode {
    if (v !== TRASH_VIEW) throw new Error(`host finto: la view «${v}» non è dichiarata`);
    return {
      node: "list",
      items: [...trash.entries()].map(([id, inside]) => ({
        node: "list_item" as const,
        title: inside.original,
        subtitle: null,
        action: { action: "restore", payload: id },
        selected: false,
      })),
    };
  }

  return {
    module,
    renameFromOutside: (from, to) => {
      const before = docs.get(from);
      if (!before) throw new Error(`host fake: «${from}» non esiste`);
      docs.delete(from);
      docs.set(to, before);
      emit({ type: "document_renamed", from, to });
    },
    files: () => Object.fromEntries([...docs].map(([id, d]) => [id, d.text])),
    trash: () => [...trash].map(([id, d]) => ({ id, original: d.original })),
    calls,
    atGate: (name) => calls.filter((c) => c.gate === name),
    close: async () => {
      if (!onClose) throw new Error("host finto: nessuno ascolta la chiusura della finestra");
      await onClose();
    },
    throttle: (name) => {
      let unlock!: () => void;
      throttles.set(
        name,
        new Promise<void>((resolve) => {
          unlock = resolve;
        }),
      );
      return () => {
        throttles.delete(name);
        unlock();
      };
    },
    fault: (name, reason) => {
      faults.set(name, reason ?? `host fake: «${name}» è guasta`);
      return () => {
        faults.delete(name);
      };
    },
    emit,
  };
}

/// L'id della view cestino del finto: la stessa che `fub-features` registra,
/// perché ciò che si prova è che la shell la monti senza saperne nulla.
export const TRASH_VIEW = "fub.trash";

/// Una `ViewSpec` minima: quel che serve perché la shell la monti.
///
/// La maschera dichiara i tre eventi che cambiano il vault, ed è la stessa che
/// dichiarerebbe una view vera: senza, la view si disegnerebbe una volta sola e
/// un e2e non distinguerebbe «la shell onora `refresh`» da «la shell ridisegna
/// tutto sempre».
export function testViewSpec(id: string, surface: ViewSpec["surface"]): ViewSpec {
  return {
    id,
    title: id,
    surface,
    refresh: {
      kinds: ["document_changed", "document_removed", "document_renamed"],
      topics: [],
      subjects: [],
      changes: [],
    },
    follows: [],
    params: [],
    icon: null,
    order: 0,
    open_by_default: true,
    preferred_size: null,
    closable: false,
  };
}
