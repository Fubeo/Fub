# FubMD — mappa visuale

L'architettura **com'è oggi**, non come sarà: ogni riquadro pieno corrisponde a
codice che esiste nel repo, ogni riquadro tratteggiato è ancora soltanto un
documento. La differenza è segnata apposta — un diagramma che mette FubAI
accanto al kernel racconta un'app che non c'è.

```mermaid
flowchart TB
    %% ============================== STILI ==============================
    classDef contract fill:#4c1d95,stroke:#8b5cf6,stroke-width:2px,color:#fff
    classDef core     fill:#2d3748,stroke:#718096,stroke-width:2px,color:#fff
    classDef provider fill:#1a365d,stroke:#2b6cb0,stroke-width:2px,color:#fff
    classDef mount    fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    classDef glue     fill:#7c2d12,stroke:#ea580c,stroke-width:2px,color:#fff
    classDef banco    fill:#4a044e,stroke:#c026d3,stroke-width:2px,color:#fff
    classDef ui       fill:#374151,stroke:#9ca3af,stroke-width:2px,color:#fff
    classDef storage  fill:#276749,stroke:#38a169,stroke-width:2px,color:#fff
    classDef future   fill:#3f3f46,stroke:#a1a1aa,stroke-width:2px,color:#d4d4d8,stroke-dasharray: 6 4

    %% ============================== SHELL ==============================
    subgraph SHELL ["🖥️ frontend/ — Vite + TypeScript + CodeMirror 6"]
        Seam["host/<br>tipi rispecchiati, IPC, canale dati"]:::ui
        StateL["state/<br>store, router eventi, comandi"]:::ui
        UiPrim["ui/<br>renderer UiNode, panel-host, palette"]:::ui
        Panels["panels/<br>explorer, ricerca, graph, cestino, impostazioni, attività"]:::ui
        EditorL["editor/<br>live preview, completamenti, tema"]:::ui
    end

    %% =============================== APP ===============================
    subgraph APP ["🪟 fubmd-app — colla Tauri v2, e nient'altro"]
        Cmd["~40 comandi IPC<br>errori tipizzati, non frasi"]:::glue
        Bridge["ponte eventi<br>freno e raggruppamento"]:::glue
    end

    %% ============================ CONTRATTO ============================
    subgraph CONTRATTO ["📜 fubmd-abi — il contratto, definito una volta sola"]
        Traits["i trait di estensione<br>Format · View · Index · Command · EventHandler · Plugin"]:::contract
        HostApiN["HostApi<br>quattordici famiglie: l'unico varco"]:::contract
        QueryN["IndexQuery<br>un albero di predicati, non una stringa"]:::contract
        Model["modello comune<br>+ arena al confine"]:::contract
        UiN["UI dichiarativa<br>UiNode, Intent, eventi"]:::contract
        RulesN["rules/<br>path, id, tag, proprietà, salute"]:::contract
        Wit["fubmd-abi/wit/<br>lo stesso contratto in WIT<br>+ linea di base congelata"]:::contract
    end

    %% =============================== HOST ==============================
    subgraph HOSTC ["🔧 fubmd-host — chi monta. Non dipende da Tauri"]
        Mount["tabella di montaggio<br>un bundle per feature"]:::mount
        SessH["sessione del vault aperto<br>registro dei vault"]:::mount
        Runner["runner dei job<br>N thread, cancellazione a bandiera"]:::mount
        Doors["le tre porte verso l'host concreto<br>watcher · event sink · chi apre"]:::mount
    end

    %% ============================== KERNEL =============================
    subgraph KERNEL ["🚀 fubmd-kernel — il core, agnostico rispetto al formato"]
        WS["Workspace: i cinque proprietari<br>DocumentStore · Indexes · ProviderRegistry<br>Dispatcher · Session"]:::core
        Canale["canale dati<br>CoreIndex, RouteTable, pianificatore"]:::core
        Bus["EventBus<br>maschera col dove, lotti, origine"]:::core
        Regs["Format · Syntax · Renderer registry"]:::core
        Graph["LinkGraph<br>nome, alias, path, backlink"]:::core
        SettStore["SettingsStore<br>vault, poi macchina, poi default"]:::core
        Perms["registro plugin + guardia<br>dove i permessi si applicano"]:::core
        Altro["undo a due pile · stato di vista<br>stato per-documento · anagrafe · locale"]:::core
    end

    %% ============================ PROVIDER =============================
    subgraph PROVIDER ["🧩 I provider nativi — gli stessi trait dei plugin di domani"]
        Markdown["fubmd-format-markdown<br>comrak: il PRIMO FormatProvider"]:::provider
        Search["Ricerca<br>IndexProvider su tantivy"]:::provider
        Views["Backlink · Struttura · Tag · Statistiche<br>quattro ViewProvider"]:::provider
        Version["Versioning<br>EventHandler + snapshot per file"]:::provider
        Cmds["Comandi<br>ricerca, wikilink, sostituzione in blocco"]:::provider
        Blocks["Blocchi<br>diagrammi, formule, evidenziato"]:::provider
        Sdk["fubmd-sdk<br>scansione, id"]:::provider
    end

    %% ============================== DISCO ==============================
    subgraph DISCO ["💾 Disco — local-first, e nessun database"]
        Notes["file dell'utente<br>.md, frontmatter, wikilink, tag, allegati"]:::storage
        Conf[".fubmd/ — autorevole<br>settings.json, workspace.json"]:::storage
        Derived[".fubmd/data/ — derivato e buttabile<br>anagrafe, doc/, plugins/id/"]:::storage
        Trash[".trash/ + sidecar<br>da dove veniva ogni file"]:::storage
        MConf["config della macchina<br>settings.json, vaults.json, view-state.json"]:::storage
    end

    %% ============================= FUTURO ==============================
    subgraph FUTURO ["🕳️ Ancora da scrivere — nel repo non c'è una riga"]
        WasmHost["fubmd-wasm-host (M5)<br>plugin di terzi via wasmtime<br>stessi trait, per proxy"]:::future
        Suite["FubSuite<br>FubTasks · FubDB · FubCanvas · FubJournal<br>FubAI · FubPublish · FubSync"]:::future
        Est["servizi esterni opt-in<br>LLM, sync, pubblicazione"]:::future
    end

    %% ============================ CONNESSIONI ==========================
    Seam <==>|"invoke"| Cmd
    StateL <==>|"fubmd://event"| Bridge

    Cmd ==> SessH
    Bridge <==>|"event sink"| Doors

    SessH ==> WS
    Mount ==>|"registra i bundle"| WS
    Runner <==> WS
    Doors ==>|"scritture altrui"| Bus

    Regs <==>|"dyn FormatProvider"| Markdown
    Canale <==> Search
    WS <==> Views
    Bus <==> Version
    WS <==> Cmds
    Regs <==> Blocks

    Traits -.->|"una firma sola per il nativo e per il WASM"| Markdown
    HostApiN -.-> Perms
    QueryN -.-> Canale
    UiN -.-> UiPrim
    RulesN -.-> Canale

    WS ==>|"path in DocId"| Notes
    WS ==> Trash
    SettStore ==> Conf
    Search ==> Derived
    Version ==> Derived
    Altro ==> Derived
    SessH ==> MConf

    Traits -.-> WasmHost
    WasmHost -.->|"ospiterà"| Suite
    Suite -.-> Est
```

## Cosa dice questo disegno, in cinque righe

1. **L'asse portante è il contratto, non il markdown.** `fubmd-abi` non dipende
   da comrak, tauri, wasmtime o tokio, e l'invariante è verificata da un test.
   Il markdown è il *primo* provider, non il formato dell'app.
2. **Chi monta e chi disegna sono separati.** `fubmd-host` non dipende da
   `tauri` perché quel montaggio ha cinque clienti previsti — CLI, API locale,
   e2e headless, mobile, PWA — e finché stava dentro un `#[tauri::command]`
   nessuno di loro poteva riusarlo.
3. **Non c'è un database.** L'indice di ricerca è tantivy dentro
   `.fubmd/data/plugins/`, e tutto ciò che sta lì è derivato: cancellarlo costa
   una ricostruzione, mai un dato dell'utente. La verità è nei file.
4. **Le feature ufficiali sono già plugin.** Backlink, struttura, tag,
   statistiche, ricerca, comandi, versioning e blocchi implementano gli stessi
   trait che useranno i plugin di terzi, senza sandbox e senza serializzazione:
   il dogfooding è il modo in cui il contratto si scopre sbagliato prima di M5.
5. **Il tratteggio è onesto; la freccia «ospiterà» no.** Il runtime WASM e
   l'intera FubSuite sono documenti, non codice: la cartella `plugins/` non
   esiste ancora, e nascerà con il runtime che dovrà caricarli. Ma quella freccia
   dice **tutta** la Suite, e almeno un riquadro non ci sta: un sync deve
   decidere il merge *prima* che il file atterri, e il contratto permette di
   osservare dopo (`EventHandler`), non di interporsi. Il metro per gli altri —
   posizione rispetto al prestito, frequenza × payload, prima o dopo la
   scrittura — sta in
   [plugin-boundary.md](plugin-boundary.md#cosa-non-può-essere-solo-un-guest-e-il-metro-per-deciderlo).

## Il grafo delle dipendenze, e il test che lo legge

Il disegno qui sopra è disposto a mano: raggruppa per ruolo, e le frecce dicono
*chi parla con chi*. Sono due cose che nessuno può verificare — un riquadro
spostato non rompe niente. Questo secondo diagramma dice una cosa sola, e la
dice in un modo che si può controllare a macchina: **chi dichiara chi nel
proprio `Cargo.toml`**. Freccia piena = dipendenza normale, tratteggiata =
dipendenza di solo `[dev-dependencies]`.

```mermaid
flowchart TD
    %% @grafo-dipendenze
    %% Questo blocco è letto e confrontato con `cargo metadata` da
    %% crates/fubmd-abi/tests/dependency_invariant.rs. Il dialetto ammesso è
    %% ristretto apposta: dichiarazioni `id["nome-crate"]:::classe`, archi
    %% `a --> b` (dipendenza normale) e `a -.-> b` (solo dev). Una riga fuori
    %% dialetto fa fallire il test invece di essere ignorata in silenzio.
    classDef contract fill:#4c1d95,stroke:#8b5cf6,stroke-width:2px,color:#fff
    classDef core     fill:#2d3748,stroke:#718096,stroke-width:2px,color:#fff
    classDef provider fill:#1a365d,stroke:#2b6cb0,stroke-width:2px,color:#fff
    classDef mount    fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    classDef glue     fill:#7c2d12,stroke:#ea580c,stroke-width:2px,color:#fff
    classDef banco    fill:#4a044e,stroke:#c026d3,stroke-width:2px,color:#fff

    app["fubmd-app"]:::glue
    host["fubmd-host"]:::mount
    features["fubmd-features"]:::provider
    markdown["fubmd-format-markdown"]:::provider
    sdk["fubmd-sdk"]:::provider
    testkit["fubmd-testkit"]:::banco
    kernel["fubmd-kernel"]:::core
    abi["fubmd-abi"]:::contract

    app --> abi
    app --> features
    app --> host
    app --> kernel
    host --> abi
    host --> features
    host --> markdown
    host --> kernel
    features --> abi
    markdown --> abi
    markdown --> sdk
    kernel --> abi
    sdk --> abi
    testkit --> abi
    testkit --> kernel

    features -.-> kernel
    features -.-> markdown
    features -.-> sdk
    features -.-> testkit
    markdown -.-> kernel
    kernel -.-> testkit
    host -.-> testkit
```

| Riquadro | Manifest | Cosa dichiara |
|---|---|---|
| `fubmd-abi` | [Cargo.toml](../../crates/fubmd-abi/Cargo.toml) | il contratto: quattro dipendenze esterne e nessun crate del workspace |
| `fubmd-kernel` | [Cargo.toml](../../crates/fubmd-kernel/Cargo.toml) | il core: il contratto, più serde, serde_json, camino, thiserror |
| `fubmd-sdk` | [Cargo.toml](../../crates/fubmd-sdk/Cargo.toml) | il contratto, serde e regex: chi scrive un provider non prende il kernel |
| `fubmd-format-markdown` | [Cargo.toml](../../crates/fubmd-format-markdown/Cargo.toml) | contratto e SDK; comrak sta qui e da nessun'altra parte |
| `fubmd-features` | [Cargo.toml](../../crates/fubmd-features/Cargo.toml) | solo il contratto — il kernel è dev-only, ed è l'invariante del dogfooding |
| `fubmd-host` | [Cargo.toml](../../crates/fubmd-host/Cargo.toml) | i quattro a monte: è il composition root, e monta ciò che gli altri offrono |
| `fubmd-app` | [Cargo.toml](../../crates/fubmd-app/Cargo.toml) | abi, kernel, host, features; `tauri` entra solo qui |
| `fubmd-testkit` | [Cargo.toml](../../crates/fubmd-testkit/Cargo.toml) | contratto e **kernel**: è il banco di prova del lato host, e per questo non è mai dipendenza normale di nessuno |

Le frecce tratteggiate sono la parte che vale la pena guardare, perché sono un
confine e non una comodità: `fubmd-features` e `fubmd-format-markdown` usano
`fubmd-kernel` **solo nei test**. Le loro librerie girano con ciò che avrà un
plugin di terzi — il contratto e nient'altro — e quel «nient'altro» è verificato
da `official_features_do_not_depend_on_the_kernel`
([dependency_invariant.rs:317](../../crates/fubmd-abi/tests/dependency_invariant.rs)).
Se una feature prendesse la scorciatoia, il test diventerebbe rosso prima che
il diagramma diventasse falso.

E il diagramma stesso non può invecchiare in silenzio: `il_diagramma_dice_le_dipendenze_vere`
lo rilegge da questo file e lo confronta con `cargo metadata` **nei due versi**.
Un arco disegnato che non esiste è rosso; una dipendenza reale che il disegno
non mostra è rossa anche lei, ed è quella che conta — un diagramma incompleto
mente più di uno sbagliato, perché ha l'aria di essere completo. Vale anche per
un crate nuovo: nasce, e il diagramma che non lo nomina fallisce.

`fubmd-app` non compare in nessun altro riquadro come dipendenza: è una foglia,
e ci sta apposta. `fubmd-testkit` è la foglia opposta — **nessuna** freccia piena
esce verso di lui, e ci sta apposta anche quello: un banco di prova che entrasse
in una libreria si porterebbe dietro il kernel, ed è ciò che
`il_banco_di_prova_non_entra_in_nessuna_libreria` impedisce guardando *tutti* i
membri invece di un elenco.

`fubmd-sdk` ha un cliente solo fra le dipendenze piene, `fubmd-format-markdown`,
ed è il fatto da cui dipende un intero ragionamento: è quella freccia — non il
guest WASM di M5 — a rendere impossibile mettere il kernel nell'SDK
([0054](../decisions/0054-il-banco-del-lato-provider.md)). Fra le tratteggiate ha
anche `fubmd-features`, che da lì prende `MemoryHost`.

L'elenco a indentazione in [PIANO.md](../PIANO.md#struttura-dei-crate) sembra un
grafo ma non lo è: nomina anche `fubmd-wasm-host`, che non esiste. Quello è
l'elenco di destinazione; questo è la fotografia.

## Dove gira cosa

I due disegni sopra dicono com'è fatto il codice. Questo dice come si dispone
mentre l'app è accesa: **un processo**, un webview, e un gruppo di thread che
nasce a ogni vault aperto e muore quando quel vault si chiude.

```mermaid
flowchart TB
    classDef proc  fill:#7c2d12,stroke:#ea580c,stroke-width:2px,color:#fff
    classDef ui    fill:#374151,stroke:#9ca3af,stroke-width:2px,color:#fff
    classDef core  fill:#2d3748,stroke:#718096,stroke-width:2px,color:#fff
    classDef th    fill:#065f46,stroke:#10b981,stroke-width:2px,color:#fff
    classDef disk  fill:#276749,stroke:#38a169,stroke-width:2px,color:#fff

    subgraph PROC ["🪟 un processo — fubmd-app, Tauri v2"]
        direction TB
        subgraph WV ["webview"]
            Shell["frontend/<br>Vite + TS + CodeMirror 6"]:::ui
        end
        Main["thread principale<br>~40 comandi IPC"]:::proc

        subgraph S1 ["VaultSession — uno per vault aperto"]
            direction TB
            WSL["Arc&lt;RwLock&lt;Workspace&gt;&gt;<br>chi legge condivide, chi chiama un provider no"]:::core
            TB1["thread del ponte<br>recv + try_iter, raffica ≤ 128"]:::th
            TW["thread del rilevatore<br>notify, debounce 300 ms"]:::th
            TJ["fubmd-job-0 … fubmd-job-N<br>N = 2 di default"]:::th
        end
        S2["…un'altra VaultSession,<br>coi suoi thread e il suo lock"]:::core
    end

    subgraph DISCO ["💾 disco"]
        Vault["&lt;vault&gt;/ — i file dell'utente"]:::disk
        Root["&lt;vault&gt;/.fubmd/ — autorevole<br>e .fubmd/data/ — derivato"]:::disk
        Trash["&lt;vault&gt;/.trash/<br>condiviso con Obsidian"]:::disk
        MConf["config della macchina<br>fuori dal vault"]:::disk
    end

    Shell <==>|"invoke"| Main
    Main -->|"fubmd://event"| Shell
    Main --> WSL
    TB1 -->|"sink"| Main
    TW --> WSL
    TJ --> WSL
    WSL --> Vault
    WSL --> Root
    WSL --> Trash
    Main --> MConf
    Main --> S2
```

| Cosa | Quante ce ne sono | Dove |
|---|---|---|
| processi | **uno**: non c'è né un demone né un servizio | [fubmd-app/src/lib.rs](../../crates/fubmd-app/src/lib.rs) |
| webview | uno, e il core lo considera **privilegiato** — è la ragione per cui `UiNode::Html` è negato a chi non è fidato | [ui-protocol.md](ui-protocol.md) |
| `VaultSession` | una per vault aperto, in una mappa | [session.rs:184](../../crates/fubmd-host/src/session.rs) |
| thread del ponte | uno per vault; dorme su `recv()` e non consuma niente a vault fermo | [bridge.rs:69](../../crates/fubmd-host/src/bridge.rs) |
| thread del rilevatore | uno per vault, ed è **facoltativo**: dietro una cargo feature, altrimenti nessuno | [watcher.rs:74](../../crates/fubmd-host/src/watcher.rs) |
| thread dei job | **due** di default, per vault e non globali | [runner.rs:67](../../crates/fubmd-host/src/runner.rs) |
| database | **nessuno** | — |

Il lock è per vault, non per app: due vault aperti non si aspettano a vicenda. E
il pool dei job è per vault per la stessa ragione — un'indicizzazione lunga su un
archivio non deve rallentare le note di lavoro.

Cosa ciascuno di quei riquadri del disco contiene, con quale classe e quale
disciplina di scrittura, non si ridisegna qui: è una tabella, ed è in
[on-disk-layout.md](on-disk-layout.md).

## Il dettaglio, per riquadro

**📜 `fubmd-abi`** — modello di documento comune e la sua forma al confine
(alberi appiattiti, span a larghezza fissa: la conversione che il proxy WASM
erediterà); i trait di estensione; `HostApi` come somma di quattordici famiglie;
il linguaggio delle interrogazioni; i comandi con argomenti e raggio dichiarati,
e la simulazione come modo di invocarli; import ed export a byte e non a path;
l'edit come coppia span-testo sopra una revisione; il protocollo di UI
dichiarativa e gli eventi con chi ha chiesto e di che lotto fanno parte; il
locale; le impostazioni; e `rules/`, la parte di risposta che non dipende da chi
la dà — sta lì e non nel kernel perché chi serve una query può non avere il
kernel fra le mani. In `crates/fubmd-abi/wit/` lo stesso contratto una seconda volta, con una
linea di base congelata presidiata da un test di conformità.

**🚀 `fubmd-kernel`** — `Workspace` non è uno struct con ventiquattro campi
piatti: ne ha cinque, e il taglio passa fra *decidere* e *chiamare*. È anche la
linea lungo cui sta il `RwLock`: chi legge prende il prestito condiviso, chi
chiama un provider quello esclusivo. Il canale dati è la parte più recente: le
risposte del kernel sono **un provider registrato per primo**, non un ramo prima
del ciclo, e chi serve cosa è dichiarato al montaggio — un conflitto si vede
subito, e «nessuno la serve» è distinguibile da «chi la serve ha fallito».

**🧩 I provider** — otto bundle di feature montati da `fubmd-host` (ricerca,
versioning, quattro view, comandi, blocchi), più un nono intestato al core
stesso, che non registra nulla e serve solo a dargli un'identità nel registro.
E il provider markdown, che è il primo cliente del `FormatRegistry` e non un
caso speciale.

**🔧 `fubmd-host`** — il composition root. Le tre porte sono ciò che di un'app
vera *non* può stare lì dentro: chi vede le scritture altrui (`notify` debounced
dietro una cargo feature, oppure nessuno), dove finiscono gli eventi una volta
usciti (il webview, stdout, niente), e chi decide *quando* si apre — l'host non
apre da sé. Il runner dei job possiede i thread e costruisce un `HostApi` **per
chiamata**, perché il kernel non sa che esiste un lock.

**🪟 `fubmd-app`** — se una riga di questo crate si può spiegare senza nominare
Tauri, sta nel posto sbagliato.

**🖥️ `frontend/`** — `main.ts` compone e nient'altro. Un pannello dichiara chi
è, dove sta e cosa lo fa invecchiare; `panel-host` decide quando chiamarlo — una
view dichiarata dal backend e un pannello nativo, da lì in giù, non si
distinguono.

**💾 Il disco** — dentro il vault: i file dell'utente e **una** radice nostra,
`.fubmd/` ([0048](../decisions/0048-una-radice-sola.md)): in cima ciò che si
sincronizza (impostazioni del vault, organizzazione), sotto `data/` ciò che si
può buttare (anagrafe delle entry, stato per-documento sotto `doc/`, spazio dei
plugin con l'indice tantivy e gli snapshot del versioning). Fuori resta
`.trash/`, che è il cestino condiviso con Obsidian, col sidecar che ricorda la
provenienza. La mappa per esteso è
[on-disk-layout.md](on-disk-layout.md). Fuori dal vault, la config della macchina:
un solo bootstrap via `FUBMD_CONFIG_DIR`, o il modo portable accanto
all'eseguibile.

## Legenda dei colori

| Colore | Cosa |
|---|---|
| 🟣 viola | il contratto — `fubmd-abi` e il suo gemello WIT |
| ⚫ grigio scuro | il core agnostico — `fubmd-kernel` |
| 🔵 blu | i provider nativi — markdown, le otto feature, l'SDK |
| 🟢 verde scuro | chi monta — `fubmd-host` |
| 🟠 arancio | la colla Tauri — `fubmd-app` |
| ⚪ grigio | la shell — `frontend/` |
| 🟩 verde | il disco |
| ⬜ tratteggiato | non esiste ancora |
