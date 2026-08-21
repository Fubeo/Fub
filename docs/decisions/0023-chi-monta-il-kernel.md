# 0023 — Chi monta il kernel: un crate `fub-host`, e l'app ridotta a colla

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §8.2 (seduta 8, *ex* §2.15) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/08-il-kernel-a-pezzi.md)

---

La 0022 aveva spezzato l'oggetto-dio in cinque proprietari e lasciato scritto
cosa quel lavoro consegnava all'8.2: «un pezzo riusabile che non sia *tutto*».
Restava però il fatto che il pezzo, riusabile o no, si montava dentro un
`#[tauri::command]` — quindi esisteva solo per chi aveva un webview.

La voce è chiusa. Nella seduta 8 resta l'**8.3**, che è P2 e la cui prima riga è
«misurare prima».

## La risposta, in una frase

**Il montaggio è un crate, `fub-host`, e non dipende da tauri; `fub-app` è ciò
che resta togliendolo.**

`crates/fub-app/src/lib.rs` passa da **809** righe a **419**, e quelle che
restano non si possono spiegare senza nominare Tauri: le firme
`#[tauri::command]`, il ponte verso `fub://event`, e `run()`.

| Modulo | Cosa possiede |
|---|---|
| [`mount`](../../crates/fub-host/src/mount.rs) | la tabella di montaggio: registro dei formati, le otto feature dichiarate, indice, versioning, view, comandi, sintassi, renderer |
| [`session`](../../crates/fub-host/src/session.rs) | `Host` e `VaultSession`: chi apre, chi chiude, chi tiene il vault, e la composizione delle due metà del versioning |
| [`watcher`](../../crates/fub-host/src/watcher.rs) | `VaultWatcher`/`WatcherFactory`, con `NotifyWatcher` e `NoWatcher` |
| [`records`](../../crates/fub-host/src/records.rs) | `VaultInfo`, `EmbedContent`, `WorkspaceMeta` e il sidecar `.fub/workspace.json` |
| [`settings`](../../crates/fub-host/src/settings.rs) | i due interruttori a variabile d'ambiente, finché il §11.1 non li assorbe |

## Le decisioni prese, da NON ridiscutere senza motivo

- **Il confine è «tauri», non «UI».** Ciò che resta nell'app non è "la parte
  grafica": è la parte che *non esiste senza un webview*. Il criterio è scritto
  in testa a `fub-app/src/lib.rs` — «se una riga di questo file può essere
  spiegata senza nominare Tauri, sta nel posto sbagliato» — ed è per questo che
  sono passati all'host anche pezzi che sembravano dell'app: il sidecar
  dell'organizzazione (è stato del **vault**, non del webview), i due
  interruttori a variabile d'ambiente (decidono *cosa si monta*), la validazione
  dei `DocId` in arrivo (il webview non è l'unico "fuori": la CLI riceve
  argomenti, l'API locale riceve path).
- **Il confine è un test, non una frase.**
  `whoever_mounts_does_not_depend_on_whoever_draws` in
  `crates/fub-abi/tests/dependency_invariant.rs` pretende che la chiusura delle
  dipendenze normali di `fub-host` non contenga `tauri`, `wry` né `webkit2gtk`.
  È la stessa maglia con cui il repo tiene onesto il dogfooding delle feature:
  senza di lei, «l'app è ridotta a colla Tauri» sarebbe vero solo nella frase
  che lo dice, e la prima dipendenza di comodo la smentirebbe in silenzio.
  Verificato che morde: aggiungendo `tauri` alle dipendenze normali dell'host il
  test diventa rosso ed elenca i nove crate che entrerebbero.
- **Tre porte verso l'host concreto, e non una.** Ciò che di un'app vera non può
  stare nel crate non è il montaggio: sono i tre punti in cui il montaggio tocca
  il mondo. Il rilevatore delle scritture altrui
  ([`WatcherFactory`](../../crates/fub-host/src/watcher.rs)), la destinazione
  degli eventi ([`EventSink`](../../crates/fub-host/src/session.rs)) e il
  momento in cui si apre (`Host::open`, che nessuno chiama da sé). Un client che
  non ha nessuna delle tre — un e2e headless — passa `NoWatcher`, nessun sink, e
  ottiene lo stesso vault.
- **Il watcher ha due implementazioni fin da subito.** `NotifyWatcher` dietro la
  cargo feature `notify-watcher` (accesa di default), `NoWatcher` sempre. Non è
  simmetria: un'astrazione con un solo cliente non è un'astrazione — la stessa
  ragione per cui il §15.1 chiede un `MemStorage` accanto a `FsStorage`. E la
  cargo feature non è un vezzo: il trait esiste **per** i posti dove `notify`
  non c'è (PWA 26.3, mobile 26.2), e una dipendenza obbligatoria sarebbe il
  `Cargo.toml` che smentisce il trait.
- **Il ponte eventi si accende dentro `open`, non dopo.** Prima era il chiamante
  ad abbonarsi al bus, e lo faceva dopo `reindex` e prima del watcher: una
  finestra stretta ma reale in cui un evento si perde, e una regola che ogni
  cliente nuovo avrebbe dovuto reindovinare. Adesso il momento lo conosce chi
  apre. **Deliberatamente dopo la scansione**: gli eventi che `reindex` emette
  sono il vault che si popola, non il vault che cambia, e la shell li leggerebbe
  come un temporale di modifiche. Il freno e il raggruppamento sono il §10.2, e
  questa voce non li anticipa — c'è un test che pretende che il sink resti vuoto
  fino alla prima scrittura vera.
- **`AppState` è sparito: lo stato gestito da Tauri *è* `Host`.** E l'host si
  registra al momento della costruzione, non nel `setup`, anche se il sink
  vorrebbe un `AppHandle` che a quel punto non esiste ancora. L'ordine di Tauri
  è costruzione → **finestre della configurazione** → `setup`
  (`tauri::app::setup`), quindi una `invoke` che arrivasse da una finestra già
  aperta troverebbe uno stato dichiarato nel `setup` ancora **non gestito** — e
  in Tauri quello è un panico, non un errore. La finestra si apre in
  microsecondi prima e il caso non si vedrebbe mai; ma è un percorso di panico
  in più sull'entry point dell'app, e non c'era prima. Il sink si registra
  quindi vuoto, con una `OnceLock<AppHandle>` che il `setup` riempie: nel
  frattempo un evento si perde invece di far cadere l'app, e nel frattempo non
  c'è nessun vault aperto che possa emetterne.

## Trovato per strada, e chiuso

- **Il montaggio intero non era provato da nessuno.** Le nove suite e2e delle
  feature aprono ognuna un workspace **proprio**, con il pezzo che serve a loro
  (è il §16.2, il banco copiato diciotto volte). Quindi provavano la ricerca,
  l'outline o il versioning — mai *l'insieme montato*: che tutte e otto le
  feature si dichiarino, che nessuna si contenda un nome con un'altra, che il
  giro delle view e quello dei comandi rispondano sullo stesso vault. Adesso c'è
  `crates/fub-host/tests/headless.rs`, sei test, e non poteva esistere prima:
  l'unico modo di esercitare quella tabella era avviare l'app.
- **`VaultInfo.extensions` non è `["md"]`.** È `["markdown", "md"]` — il
  provider dichiara due estensioni, e il primo test scritto contro il montaggio
  vero l'ha detto subito. Nessun bug: solo una cosa che nessun test aveva mai
  guardato.
- **Il debouncer era un `Box<dyn Any + Send>`.** Dietro il trait diventa un tipo
  con un metodo, `is_watching`, che oggi risponde per costruzione. Non è la §9.7
  — là la domanda è *cosa promette Fub dove il rilevamento non c'è* — ma è il
  posto dove quella risposta andrà a stare, e prima non c'era.

## Cosa NON è stato fatto, e perché

- **Il registry del §9.3 non c'è.** Il §8.2 lo elencava fra i contenuti del
  crate, insieme al runner dei job e allo storage del §15.1: sono **tre voci
  aperte**, non tre pezzi dimenticati. `mount` è una tabella cablata a mano, ed
  è esattamente la tabella che il §9.3 sostituirà con un registry che monta un
  bundle a partire dal suo manifest. Averla in un posto solo è la precondizione
  di quel lavoro, non il suo rimpiazzo — e la voce diceva «serve un crate», non
  «serve il §9.3 dentro un crate».
- **Gli errori restano `String`.** Tutto il confine risponde `Result<_, String>`
  come prima. Tipizzarli è il §12.2, che è P0 e aperto, e farlo qui a metà
  avrebbe voluto dire scrivere l'enum che quella voce dovrà poi rifare. Quello
  che questa voce **compra** al §12.2 è che adesso c'è un posto solo dove quella
  decisione atterra: prima sarebbe dovuta atterrare in ventidue comandi Tauri.
- **La sessione resta una sola.** `Host` tiene una `Option<VaultSession>`, come
  `AppState` prima di lui. Le sessioni multiple sono il §9.6; quando
  arriveranno, il posto dove mettere la mappa `vault_id -> VaultSession` è
  questo, e non ventidue comandi IPC.
- **`Host::close` non spegne niente.** Lascia cadere la sessione — il debouncer
  muore col suo `Drop` — e basta: nessun flush finale, nessun `deactivate`,
  nessun `close` sugli indici. È il §9.5, ed è aperto. Il metodo esiste perché
  quando quel lavoro si farà il posto è questo, e perché finora non c'era
  nemmeno un posto.
- **`fub-features` non è stato spostato dietro la nuova porta.** Le sue suite
  e2e continuano ad aprirsi il workspace da sé. Farle passare da `fub-host`
  sarebbe il §16.2 (il banco di prova condiviso), che è un'altra voce e ha un
  altro criterio.

## Verifica

- `cargo build --workspace` — pulita, zero warning. Anche
  `-p fub-host --no-default-features`, cioè il ramo senza `notify`.
- `cargo clippy --workspace --all-targets` — pulita, nelle due configurazioni di
  feature.
- `cargo test --workspace` — **54 suite, 0 fallimenti**. Erano 51 alla 0022: le
  tre nuove sono la lib di `fub-host`, i suoi doc-test e `tests/headless.rs`.
  **Nessun test preesistente è stato aggiunto, tolto o adattato** — compreso
  `ts_mirror_app.rs`, che continua a importare `VaultInfo`, `EmbedContent` e
  `WorkspaceMeta` da `fub_app_lib`: i tre tipi vivono nell'host e l'app li
  ri-esporta, perché il mirror sta dal lato che li serializza.
- Il presidio nuovo, provato al contrario: con `tauri` fra le dipendenze normali
  di `fub-host`, `whoever_mounts_does_not_depend_on_whoever_draws` fallisce.
- `cargo fmt --all` — pulita.
