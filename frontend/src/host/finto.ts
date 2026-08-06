// **L'host finto**: un vault in memoria che risponde a tutta la porta, e a cui
// si può chiedere cosa gli è stato chiesto.
//
// # Perché esiste, e cosa presidia
//
// I presidi di questa shell provano dei *moduli*: `rules/`, `state/`, i due
// pannelli che hanno una regola dentro. Nessuno prova il **cablaggio** — chi si
// monta prima di chi, quale porta attraversa un gesto, quale argomento ci
// arriva — e il cablaggio è precisamente ciò che la
// [decisione 0015](../../../docs/decisions/0015-la-forma-della-shell.md)
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
  QueryExpr,
  QueryPredicate,
  SettingEntry,
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
export interface Chiamata {
  porta: string;
  args: unknown[];
}

/// Un documento del vault finto: il testo e la revisione che lo nomina.
interface Documento {
  testo: string;
  revisione: string;
}

/// Una voce del cestino finto.
interface Cestinata {
  originale: string;
  testo: string;
}

export interface Opzioni {
  /// I file del vault: path → testo. Le cartelle si deducono dai path, come
  /// sul disco.
  file?: Record<string, string>;
  /// Il vault da aprire all'avvio, o `null` per una finestra vuota.
  radice?: string | null;
  /// Le view che i provider dichiarano. Vuoto = nessun provider registrato,
  /// che è uno stato legittimo e non un vault a metà.
  view?: ViewSpec[];
  /// I comandi del registro **oltre** ai cinque strutturali.
  comandi?: CommandSpec[];
  /// Le impostazioni risolte che il canale dati risponde.
  impostazioni?: SettingEntry[];
}

/// L'host finto e le maniglie per guidarlo.
export interface HostFinto {
  /// Ciò che si passa a `vi.mock("./host/ipc")`.
  modulo: typeof import("./ipc");
  /// I file, come stanno adesso: è ciò su cui si asserisce dopo un gesto.
  file(): Record<string, string>;
  /// Il cestino, dal più recente.
  cestino(): { id: string; originale: string }[];
  /// Le chiamate arrivate alla porta, in ordine.
  chiamate: Chiamata[];
  /// Le chiamate a **quella** porta, in ordine.
  aPorta(porta: string): Chiamata[];
  /// Rinomina un file **senza che la shell l'abbia chiesto**: è il `mv` da
  /// terminale, l'altra applicazione, il sync. Il file si muove e l'evento
  /// arriva, che è l'ordine in cui le due cose succedono davvero.
  rinominaDaFuori(da: string, a: string): void;
  /// Manda un evento del kernel a chi si è iscritto, come farebbe il ponte.
  ///
  /// Restituisce `false` se **nessuno** era iscritto: è il caso che interessa
  /// di più, perché è ciò che succede quando un ascoltatore si monta dopo il
  /// router — e un evento consegnato a nessuno non fallisce da sé.
  emetti(evento: KernelEvent): boolean;
}

/// Il vault finto, pronto a rispondere.
export function creaHostFinto(opzioni: Opzioni = {}): HostFinto {
  const radice = opzioni.radice === undefined ? "/vault" : opzioni.radice;
  const docs = new Map<string, Documento>();
  const cestino = new Map<string, Cestinata>();
  const statoDiVista = new Map<string, unknown>();
  const chiamate: Chiamata[] = [];
  const view = opzioni.view ?? [];
  let ascoltatore: ((n: KernelNotice) => void) | null = null;
  let revisione = 0;
  let cestinate = 0;

  for (const [id, testo] of Object.entries(opzioni.file ?? {})) scrivi(id, testo);

  function scrivi(id: string, testo: string): string {
    revisione += 1;
    const rev = `r${revisione}`;
    docs.set(id, { testo, revisione: rev });
    return rev;
  }

  /// Registra la chiamata e restituisce ciò che la porta risponde.
  function porta<T>(nome: string, args: unknown[], esito: T): T {
    chiamate.push({ porta: nome, args });
    return esito;
  }

  function emetti(evento: KernelEvent): boolean {
    if (!ascoltatore) return false;
    ascoltatore({ event: evento, origin: { actor: { kind: "user" }, batch: null } });
    return true;
  }

  /// Un documento è di specie `document` se ha un'estensione che il vault
  /// dichiara: è la regola del §14.1, e vale anche qui perché la shell la
  /// legge dalla risposta e non dalla propria testa.
  function specie(id: string): VaultEntry["kind"] {
    return id.endsWith(".md") ? "document" : "asset";
  }

  function voce(id: string): VaultEntry {
    return {
      id,
      kind: specie(id),
      size: docs.get(id)?.testo.length ?? 0,
      mtime: 0,
      fingerprint: null,
    };
  }

  function cartellaDi(id: string): string {
    const taglio = id.lastIndexOf("/");
    return taglio < 0 ? "" : id.slice(0, taglio);
  }

  /// Impagina, e dice il totale **prima** della finestra: è ciò che `Paged`
  /// promette, e la differenza si vede solo con più righe della finestra.
  function pagina<T>(items: T[], page?: { offset: number; limit: number } | null) {
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? items.length;
    return { items: items.slice(offset, offset + limit), offset, total: items.length };
  }

  /// Il linguaggio delle query, per quel tanto che una shell ne parla.
  ///
  /// Le foglie che non riconosce **lanciano**: una ricerca che risponde vuoto
  /// perché il finto non sapeva leggerla somiglia troppo a una ricerca senza
  /// risultati.
  function combacia(id: string, expr: QueryExpr): boolean {
    if (expr.any.length === 0) return true;
    return expr.any.some((clausola) =>
      clausola.all.every((lit) => lit.negated !== foglia(id, lit.predicate)),
    );
  }

  function foglia(id: string, p: QueryPredicate): boolean {
    const testo = docs.get(id)?.testo ?? "";
    switch (p.kind) {
      case "text": {
        const ago = p.text.toLowerCase();
        return id.toLowerCase().includes(ago) || testo.toLowerCase().includes(ago);
      }
      case "docs":
        return p.docs.includes(id);
      case "folder":
        return p.descendants ? id.startsWith(`${p.path}/`) : cartellaDi(id) === p.path;
      case "tag":
        return testo.includes(`#${p.name}`);
      default:
        throw new Error(`host finto: non so leggere il predicato ${p.kind}`);
    }
  }

  function query(q: IndexQuery): IndexResult {
    switch (q.kind) {
      case "entries": {
        const dentro = q.within;
        let ids = [...docs.keys()].sort();
        if (q.of_kind) ids = ids.filter((id) => specie(id) === q.of_kind);
        if (dentro) {
          ids = dentro.descendants
            ? ids.filter((id) => dentro.path === "" || id.startsWith(`${dentro.path}/`))
            : ids.filter((id) => cartellaDi(id) === dentro.path);
        }
        return { kind: "entries", value: pagina(ids.map(voce), q.page) };
      }
      case "folders": {
        const sotto = q.under;
        const tutte = new Set<string>();
        for (const id of docs.keys()) {
          const parti = id.split("/").slice(0, -1);
          for (let i = 1; i <= parti.length; i += 1) tutte.add(parti.slice(0, i).join("/"));
        }
        let elenco = [...tutte].sort();
        if (sotto) {
          elenco = sotto.descendants
            ? elenco.filter((p) => sotto.path === "" || p.startsWith(`${sotto.path}/`))
            : elenco.filter((p) => cartellaDi(p) === sotto.path);
        }
        const cartelle: VaultFolder[] = elenco.map((path) => ({
          path,
          folders: elenco.filter((p) => cartellaDi(p) === path).length,
          entries: [...docs.keys()].filter((id) => cartellaDi(id) === path).length,
        }));
        return { kind: "folders", value: pagina(cartelle, q.page) };
      }
      case "documents": {
        const trovati = [...docs.keys()]
          .filter((id) => combacia(id, q.matching))
          .sort()
          .map((doc) => ({ doc }));
        return { kind: "documents", value: pagina(trovati, q.page) };
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
        return { kind: "settings", value: opzioni.impostazioni ?? [] };
      case "organization": {
        const org: Organization = { icons: {}, pinned: [], order: {}, spaces: [] };
        return { kind: "organization", value: org };
      }
      case "drafts": {
        const bozze: DraftInfo[] = [];
        return { kind: "drafts", value: pagina(bozze, q.page) };
      }
      case "jobs":
        return { kind: "jobs", value: [] };
      case "resolve": {
        const target = q.target;
        if (target.kind !== "wiki") return { kind: "resolved", value: null };
        const atteso = `${target.value.page}.md`;
        const trovato = [...docs.keys()].find((id) => id === atteso || id.endsWith(`/${atteso}`));
        return { kind: "resolved", value: trovato ? { doc: trovato } : null };
      }
      case "tags":
        return { kind: "tags", value: pagina([], q.page) };
      default:
        throw new Error(`host finto: non so rispondere alla query ${q.kind}`);
    }
  }

  /// I cinque comandi strutturali, che sono del contratto (`COMANDI`) e non di
  /// una feature: è la parte del registro che questa shell nomina per id, e
  /// quindi la sola che un host finto debba saper eseguire.
  function comando(id: string, args: Record<string, unknown> | null) {
    switch (id) {
      case "note.create": {
        const nome = typeof args?.name === "string" && args.name ? args.name : "Senza titolo";
        const doc = `${nome}.md`;
        scrivi(doc, "");
        emetti({ type: "document_changed", id: doc });
        return { notify: null, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
      }
      case "note.rename": {
        const da = String(args?.doc);
        const a = String(args?.to);
        const prima = docs.get(da);
        if (!prima) throw new Error(`host finto: «${da}» non esiste`);
        docs.delete(da);
        docs.set(a, prima);
        emetti({ type: "document_renamed", from: da, to: a });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "note.trash": {
        const doc = String(args?.doc);
        const prima = docs.get(doc);
        if (!prima) throw new Error(`host finto: «${doc}» non esiste`);
        docs.delete(doc);
        cestinate += 1;
        cestino.set(`.trash/${cestinate}-${doc}`, { originale: doc, testo: prima.testo });
        emetti({ type: "document_removed", id: doc });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "trash.restore": {
        const voceCestino = String(args?.entry);
        const dentro = cestino.get(voceCestino);
        if (!dentro) throw new Error(`host finto: «${voceCestino}» non è nel cestino`);
        cestino.delete(voceCestino);
        scrivi(dentro.originale, dentro.testo);
        emetti({ type: "document_changed", id: dentro.originale });
        return {
          notify: null,
          effect: { kind: "navigate" as const, doc: dentro.originale },
          undo: null,
          partial: null,
        };
      }
      case "trash.empty":
        cestino.clear();
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      default:
        throw new Error(`host finto: il comando «${id}» non esiste`);
    }
  }

  const modulo: typeof import("./ipc") = {
    api: {
      initialVault: () => porta("initialVault", [], Promise.resolve(radice)),
      openVault: (path) => {
        const info: VaultInfo = { root: path, extensions: ["md"], plugins: [], unread: [] };
        return porta("openVault", [path], Promise.resolve(info));
      },
      readDocument: (id) => {
        const doc = docs.get(id);
        if (!doc) return porta("readDocument", [id], Promise.reject(new Error(`«${id}» non c'è`)));
        return porta(
          "readDocument",
          [id],
          Promise.resolve({ text: doc.testo, revision: doc.revisione }),
        );
      },
      writeDocument: (id, source, base) => {
        const prima = docs.get(id);
        if (base.kind === "descends_from" && prima && prima.revisione !== base.value) {
          return porta(
            "writeDocument",
            [id, source, base],
            Promise.reject(new Error(`conflict: «${id}» è cambiato sotto`)),
          );
        }
        return porta("writeDocument", [id, source, base], Promise.resolve(scrivi(id, source)));
      },
      saveDraft: (id, text, base) => porta("saveDraft", [id, text, base], Promise.resolve()),
      discardDraft: (id) => porta("discardDraft", [id], Promise.resolve()),
      renderPreview: (id) =>
        porta("renderPreview", [id], Promise.resolve({ html: docs.get(id)?.testo ?? "", parts: [] })),
      renderEmbed: (page, heading) =>
        porta("renderEmbed", [page, heading], Promise.resolve({ doc_id: page, html: "", parts: [] })),
      setActiveContext: (context) => porta("setActiveContext", [context], Promise.resolve([])),
      setSystemLocale: (locale) => porta("setSystemLocale", [locale], Promise.resolve(false)),
      listViews: () => porta("listViews", [], Promise.resolve(view)),
      renderView: (v, instance, params) => {
        const albero = alberoDellaView(v);
        return porta("renderView", [v, instance, params], Promise.resolve(albero));
      },
      viewAction: (v, instance, params, action, payload, fields) => {
        chiamate.push({ porta: "viewAction", args: [v, instance, params, action, payload, fields] });
        if (v === CESTINO_VIEW && action === "restore") {
          comando("trash.restore", { entry: String(payload) });
          return Promise.resolve({ kind: "replace" as const, root: alberoDellaView(v) });
        }
        throw new Error(`host finto: la view «${v}» non ha l'azione «${action}»`);
      },
      listCommands: () => porta("listCommands", [], Promise.resolve(opzioni.comandi ?? [])),
      invokeCommand: (command, args, mode) =>
        porta(
          "invokeCommand",
          [command, args, mode],
          Promise.resolve(comando(command, args ?? null)),
        ),
      queryIndex: (q) => porta("queryIndex", [q], Promise.resolve(query(q))),
      cancelJob: (id) => porta("cancelJob", [id], Promise.resolve()),
      setIcon: (path, icon) => porta("setIcon", [path, icon], Promise.resolve()),
      setPinned: (id, pinned) => porta("setPinned", [id, pinned], Promise.resolve()),
      setSpace: (path, space) => porta("setSpace", [path, space], Promise.resolve()),
      setOrder: (folder, names) => porta("setOrder", [folder, names], Promise.resolve()),
      setSetting: (key, value) => porta("setSetting", [key, value], Promise.resolve()),
      resetSetting: (key) => porta("resetSetting", [key], Promise.resolve()),
      listBundles: () => porta("listBundles", [], Promise.resolve([] as BundleInfo[])),
      setPluginEnabled: (id, enabled) =>
        porta("setPluginEnabled", [id, enabled], Promise.resolve([])),
      knownVaults: () => porta("knownVaults", [], Promise.resolve([])),
      setVaultFavorite: (path, favorite) =>
        porta("setVaultFavorite", [path, favorite], Promise.resolve()),
      setVaultLook: (path, icon, name) =>
        porta("setVaultLook", [path, icon, name], Promise.resolve()),
      forgetVault: (path) => porta("forgetVault", [path], Promise.resolve()),
      pendingKeybindings: () => porta("pendingKeybindings", [], Promise.resolve({})),
      adoptKeybindings: () => porta("adoptKeybindings", [], Promise.resolve()),
      discardKeybindings: () => porta("discardKeybindings", [], Promise.resolve()),
      viewState: <T>(key: string) =>
        porta("viewState", [key], Promise.resolve((statoDiVista.get(key) ?? null) as T | null)),
      setViewState: (key, value) => {
        if (value === null || value === undefined) statoDiVista.delete(key);
        else statoDiVista.set(key, value);
        return porta("setViewState", [key, value], Promise.resolve());
      },
    },
    onKernelEvent: (handler) => {
      ascoltatore = handler;
      chiamate.push({ porta: "onKernelEvent", args: [] });
      return Promise.resolve(() => {
        ascoltatore = null;
      });
    },
  };

  /// L'albero che una view del finto disegna. Solo il cestino ne ha uno: è la
  /// view su cui il §17.2 chiede il giro del ripristino, ed è l'unica che
  /// questa shell attraversi senza sapere cosa contiene.
  function alberoDellaView(v: string): UiNode {
    if (v !== CESTINO_VIEW) throw new Error(`host finto: la view «${v}» non è dichiarata`);
    return {
      node: "list",
      items: [...cestino.entries()].map(([id, dentro]) => ({
        node: "list_item" as const,
        title: dentro.originale,
        subtitle: null,
        action: { action: "restore", payload: id },
        selected: false,
      })),
    };
  }

  return {
    modulo,
    rinominaDaFuori: (da, a) => {
      const prima = docs.get(da);
      if (!prima) throw new Error(`host finto: «${da}» non esiste`);
      docs.delete(da);
      docs.set(a, prima);
      emetti({ type: "document_renamed", from: da, to: a });
    },
    file: () => Object.fromEntries([...docs].map(([id, d]) => [id, d.testo])),
    cestino: () => [...cestino].map(([id, d]) => ({ id, originale: d.originale })),
    chiamate,
    aPorta: (nome) => chiamate.filter((c) => c.porta === nome),
    emetti,
  };
}

/// L'id della view cestino del finto: la stessa che `fub-features` registra,
/// perché ciò che si prova è che la shell la monti senza saperne nulla.
export const CESTINO_VIEW = "fub.trash";

/// Una `ViewSpec` minima: quel che serve perché la shell la monti.
///
/// La maschera dichiara i tre eventi che cambiano il vault, ed è la stessa che
/// dichiarerebbe una view vera: senza, la view si disegnerebbe una volta sola e
/// un e2e non distinguerebbe «la shell onora `refresh`» da «la shell ridisegna
/// tutto sempre».
export function specDiProva(id: string, surface: ViewSpec["surface"]): ViewSpec {
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
