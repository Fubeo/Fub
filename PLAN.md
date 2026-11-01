# Piano: K2 · La pagina «Componenti» e i profili

Branch: piano/k2-pagina-componenti
Obiettivo: chi usa Fub sceglie che cosa tenere acceso da una pagina sola, con i
profili per cominciare; ciò che è spento non arriva nella WebView, e un file di
un componente spento si vede «solo come file», con «Accendi…».
Perché: K1 ha dato a Fub la mappa dei componenti, ma la vedono solo la CLI e
MCP; la pagina di oggi mostra un interruttore per bundle senza dire chi richiede
chi, e il client carica il codice di ogni editor anche quando non serve.
Fuori scope: i componenti che non hanno ancora codice (PDF completo, OCR, moduli
interattivi, disegno completo, foto, libreria foto, IA, caratteri, colore,
scheda grafica, RAW, sessione dal tablet, agenti come componente): ognuno arriva
con il suo codice; `fub-motori`, `Pigro<T>`, la preparazione in anticipo e
l'errore «comando di un componente spento» (K3); dati scaricabili ed edizioni
(K4); l'interruttore Semplice·Completo nelle modalità (arriva con la prima
modalità completa); la domanda del profilo sui vault che esistono già.
Assunzioni: vedi «Assunzioni» qui sotto (A1–A12), approvate il 2026-11-01.
Ondate: T1 | T2 | T2b | T3 T4 | T5
Prototipo: l'anteprima dal vivo in cima al piano «Fub a componenti»
(https://claude.ai/artifact/T2Ts14vEwWTNzHHs6NKP9w): gruppi, interruttori,
«Serve a…», «Non serve più», la finestra delle dipendenze, la ricerca, i
profili. Le foto di T3 la confrontano con la pagina vera.

## Fonti

- Piano «Fub a componenti», fase K2 (i coder non lo leggono: qui c'è tutto ciò
  che serve, tranne l'anteprima, che T3 guarda).
- ADR 0234 «Il modello dei componenti»: la regola di «acceso» sta una volta
  sola in `fub-componenti`; «lo stato nuovo arriva con la pagina Componenti».
- ADR 0235 «Un record pubblicato non cresce» (PR #288): K2 non tocca il WIT.
- Scritto su main @ fdaa759b (2026-11-01).

## Risposte dell'utente (2026-11-01)

- Q-1 · Primo avvio: la scelta del profilo compare **solo quando si crea un
  vault nuovo**, con «Studio» già scelto. I vault che esistono già restano come
  sono, senza domande.
- Q-2 · I profili che hanno bisogno di componenti non ancora scritti («Solo
  PDF», «Grafica», «Fotografia») si vedono **grigi, con «più avanti»**.
- Q-3 · In K2 diventano spegnibili **la lavagna e il lettore PDF**. Con «Solo
  note» un PDF o una lavagna si vede nell'albero «solo come file», con
  «Accendi PDF» o «Accendi Lavagna». I file non si toccano.
- Q-4 · **Sì a un dato nuovo** nelle impostazioni di ogni vault, che il form
  generico non disegna, e a **due comandi IPC nuovi**: uno legge la mappa con lo
  stato, uno applica le scelte. CLI, MCP e pagina usano la stessa regola.

- Piano approvato, con A4 così com'è: «Solo note» senza grafo né correttore;
  sincronizzazione, pubblicazione, aggiornamenti e disegni non li tocca nessun
  profilo tranne «Tutto» (senza un server configurato o un clic non fanno
  niente).
- D-1 · Sì alla CI, **dentro il job della WebView che c'è già**, non in un job
  nuovo. In più un controllo statico sulla build del client, su ogni PR:
  l'insieme dei chunk caricati all'avvio con «Solo note» non contiene pdfjs,
  `editors/canvas`, `drawing-*` né `editors/spatial` (T4, nel plugin di Vite).
- D-2 · La prova con persone si fa. Quando la pagina è pronta sulla PR in
  bozza, l'orchestratore prepara la build e un protocollo di una pagina con
  cinque compiti (accendere il PDF, spegnere la lavagna, tornare a «Solo note»,
  capire perché la penna non si spegne, aprire un PDF da «Solo note») e che
  cosa osservare. La fa l'utente, se può anche con una persona che non conosce
  Fub. **La PR non si segna pronta prima del suo resoconto.**
- D-3 · Per A2, `fub-host` dipende direttamente da `fub-componenti`: una
  freccia nuova `host --> componenti` nel diagramma di
  `docs/architecture/overview.md`, con `dependency_invariant` aggiornato.
  Nessuna dipendenza esterna nuova.
- D-4 · Con l'app aperta, CLI e MCP continuano a passare dall'app: il canale
  CLI↔app (`crates/fub-host/src/control.rs`, `crates/fub-cli/src/port.rs`)
  impara due richieste nuove, la mappa e «applica questa scelta».
- D-5 · Il formato dello stato dei componenti: **quattro chiavi del vault**,
  perché `SettingValue` non ha oggetti e il contratto dei plugin non si tocca:
  `components.off` (elenco: righe senza bundle spente, per esempio
  `["fub.lavagna"]`), `components.kept` (elenco: tenuti con «Tienili»),
  `components.waiting` (elenco: in attesa) e `components.profile` (testo: il
  profilo scelto, vuoto = personalizzato). Nel testo del piano
  «`components.*`» vuol dire queste quattro.

## Assunzioni

Dove il codice e il piano non dicono la stessa cosa vince il codice; la
differenza è scritta qui.

- A1 · **`plugins.disabled` resta la fonte per i bundle.** CLI, MCP, vault di
  oggi e `set_plugin_enabled` continuano a leggerla e scriverla. Il dato nuovo
  (Q-4) sono le chiavi `components.*` del vault (D-5), aggiunte a
  `SETTINGS_WITH_THEIR_OWN_GESTURE` (`crates/fub-host/src/shell.rs`, specchio
  `apps/client/src/ui/shell-ids.generated.ts`), non `program_writable` come
  `plugins.disabled` (`crates/fub-host/src/settings.rs:520-536`). Contiene solo
  ciò che `plugins.disabled` non sa dire: le righe senza bundle spente
  (lavagna, PDF), i componenti tenuti con «Tienili», quelli «in attesa» e il
  profilo scelto (vuoto = personalizzato). Un vault senza le chiavi vale come
  oggi: tutto acceso tranne `plugins.disabled`.
- A2 · **La logica passa nell'host.** Oggi accendi, spegni e perché stanno in
  `crates/fub-cli/src/componenti.rs`. Si spostano in `fub-host` (un modulo
  `componenti` con lettura dello stato, applicazione e prova senza `apply`),
  e CLI, MCP e IPC chiamano quello. Il risolutore resta `fub-componenti`.
- A3 · **Due righe nuove nella mappa** (`crates/fub-features/src/componenti.rs`):
  `fub.pdf` («PDF», gruppo `leggere`, richiede `fub.penna`, `ui`
  `editors/media`, senza bundle: è il profilo `media-pdf` del visore del
  client, pdfjs) e la lavagna, che diventa spegnibile davvero: con
  `fub.lavagna` spenta l'host non registra `CanvasProvider`
  (`crates/fub-host/src/mount.rs:327-331`) e il client non registra
  `CANVAS_MOUNT` (`apps/client/src/editors/core/bootstrap.ts:447`). Immagini,
  audio e video restano del nucleo.
- A4 · **I profili sono dati in `fub-features`** (`profili()`), sopra la mappa
  vera; il test controlla che ogni id esista nella mappa o sia nell'elenco
  «arriva con…» che rende il profilo «più avanti» (Q-2). I componenti della
  mappa del piano diventano questi id:
  - «Note» = `fub.markdown` e tutte le righe del gruppo `scrivere`, **tranne**
    `fub.graph` e `fub.proof`, che nel piano sono componenti a sé;
  - «Solo note» = Note;
  - «Studio» = Note, `fub.graph`, `fub.proof`, `fub.pdf`, `fub.lavagna`,
    `fub.rich`, `fub.xlsx` (la sessione dal tablet arriva più avanti; il
    profilo è completo lo stesso, perché il tablet non ha ancora codice);
  - «Tutto» = ogni riga che non è di supporto;
  - «Solo PDF» (PDF, PDF completo), «Grafica» (Note, Lavagna, Disegno
    completo, Foto), «Fotografia» (Note, Libreria foto, Foto): più avanti.
  - Le righe senza gruppo (`fub.updates`, `fub.publish`, `fub.sync`) e
    `fub.draw` («Disegni», gruppo `disegnare`): un profilo non le tocca,
    tranne «Tutto», che le accende. Restano come sono, da sole.
- A5 · **Il nucleo non cambia**: `fub.core`, `fub.maintenance`, `fub.markdown`
  (`NUCLEO`). «Note» non si spegne; «Solo PDF» senza Note aspetta che il nucleo
  si stringa, e anche per questo è «più avanti».
- A6 · **Che cosa vuol dire «vault nuovo»** (Q-1): il vault aperto da «Crea un
  vault nuovo…» (`onboarding-create`, `apps/client/src/desktop-shell.ts:547`)
  in una cartella senza file visibili e senza `components.*`. Aprire con
  «Apri vault…» non chiede mai il profilo.
- A7 · **I comandi IPC** (Q-4) seguono `docs/reference/ipc-contract.md` e i test
  di `crates/fub-app/tests/lean_ipc.rs`, `ipc_permissions.rs`,
  `ts_mirror_app.rs`. Nomi: `components_map(vault)` (righe con gruppo, tipo,
  richiede, usa, «perché», stato, profilo attivo, profili con «più avanti») e
  `components_apply(vault, azione, apply)` (accendi, spegni, spegni con
  dipendenti, togli, tieni, profilo). Senza `apply` è una prova che dice che
  cosa cambierebbe, come la CLI. Perché non le porte generiche
  (`query_index`, `invoke_command`): lo stato dei componenti non è
  `program_writable`, come `plugins.disabled`, perché un componente non deve
  poter spegnere gli altri; lo cambia solo la shell, come fa già
  `set_plugin_enabled`, che ha la sua porta dedicata.
- A8 · **«Spento non arriva nella WebView» si misura con un banco.** Oggi
  nessun banco elenca le risorse caricate e il plugin `bundle-size-budgets`
  (`apps/client/vite.config.ts:51-109`) non stampa l'insieme eager. T4 aggiunge
  allo scenario dell'avvio del banco WebView (`apps/client/bench/webview/run.mjs`)
  l'elenco dei chunk scaricati (`performance.getEntriesByType("resource")`) e il
  confronto fra «Solo note» e «Tutto».
- A9 · **Il tempo d'avvio** è S6 `coldStart` (`run.mjs:474-480`). La CI non lo
  lancia (`.github/workflows/ci.yml:610`) e `budgets.json` non ha una soglia
  `ci` per S6: in K2 la misura si fa su server-di-fub prima e dopo, con i
  numeri nella PR. Metterla nella CI è la domanda D-1.
- A10 · **La pagina tiene le sezioni di oggi** per i componenti installati e il
  catalogo (`renderInstalledComponent`, `renderCatalogSearch` in
  `apps/client/src/panels/settings.ts`): cambia la sezione «Inclusi in Fub»,
  che diventa la pagina dell'anteprima. I componenti installati non entrano
  nella mappa in K2.
- A11 · **Le parole** entrano nel lessico dei menu (`apps/client/src/i18n/lexicon.ts`,
  controllato da `src/ui/menu-budget.test.ts` e `src/shell.e2e.test.ts`) e nella
  pagina `docs/product/editor-menus.md`: Componente, Accendi, Spegni, Serve a,
  Non serve più, Togli, Tienili, Profilo, personalizzato, più avanti, solo come
  file. «Semplice» e «Completo» aspettano la prima modalità completa.
- A12 · **I menu leggono i componenti accesi** con lo stesso dato di
  `components_map`: barra laterale, «Nuovo» e «Apri» dell'esploratore
  (`apps/client/src/panels/explorer.ts`), menu dell'app (`ui/app-menu.ts`) e
  tasto destro. Le voci di un componente spento non si mostrano.

## Cancello di K2

| Fatto quando | Prova | Task |
|---|---|---|
| con «Solo note» nessun pezzo di PDF, lavagna, disegno o foto arriva alla WebView | banco WebView: l'elenco dei chunk scaricati all'avvio e dopo aver aperto una nota, con «Solo note», non contiene pdfjs, `editors/canvas`, `drawing-*` né `editors/spatial`; con «Tutto» sì quando si apre il file; elenco nella PR | T4 |
| tempo d'avvio uguale fra «Solo note» e «Tutto» | S6 `coldStart` su server-di-fub, «Solo note» e «Tutto», stesso build, numeri nella PR; la differenza dentro il rumore misurato fra due giri uguali | T4, fine |
| `bench:a11y` verde | `npm run bench:a11y` con la scena `settings-components` nuova e la scena della scelta del profilo | T3, T5 |
| tutto si fa da tastiera | test e2e: profilo, interruttore, finestra delle dipendenze, «Togli»/«Tienili», ricerca e la schermata del profilo, solo con la tastiera | T3, T5 |
| (da K1) accendere e poi spegnere torna allo stato di prima, anche per lavagna e PDF | test in `fub-host`: spegni e riaccendi lavagna e PDF, `plugins.disabled`, `components.*`, provider montati e superfici del client identici | T1, T4 |
| (da Q-1) i vault che esistono già non cambiano | test: un vault senza `components.*` monta gli stessi bundle e le stesse superfici di prima e non mostra la schermata del profilo | T1, T5 |

## Regole che valgono per ogni task

- Ogni punto del «Fatto quando» ha la sua prova: un test, una foto o una misura.
- Non scrivere numeri non misurati. Le misure si prendono nella WebView vera
  (il banco WebView gira su server-di-fub), non solo in Chromium.
- Un componente spento non costa niente: né memoria, né tempo all'avvio, né
  codice nella WebView. Ogni task che tocca un componente lo prova spento e
  acceso.
- I file del vault non si toccano: accendere e spegnere cambia solo che cosa è
  montato e che cosa la shell mostra.
- Testi nei cataloghi, in italiano, con la chiave in tutte le lingue; il gergo
  vietato di `apps/client/src/i18n/gergo.ts` resta fuori.
- Nessun nome né logo ArtCraft nell'interfaccia e nei testi.
- Mai il vault reale (`~/.cache/fub-live/vault-tutti/`): solo vault temporanei.

## T1 · Lo stato dei componenti nel vault

Perché: la pagina, la CLI e MCP devono leggere e cambiare lo stesso stato, e la
lavagna e il PDF devono potersi spegnere davvero.
Tocca: `crates/fub-host/src/` (un modulo `componenti.rs` nuovo, `settings.rs`,
`shell.rs`, `mount.rs`, `session.rs`), `crates/fub-host/Cargo.toml` (la
dipendenza da `fub-componenti`, D-3), `docs/architecture/overview.md` (la
freccia e la riga che la spiega), `crates/fub-abi/tests/dependency_invariant.rs`
se ha un elenco delle frecce, `Cargo.lock`, `crates/fub-host/tests/componenti.rs`,
`apps/client/src/ui/shell-ids.generated.ts` (solo rigenerato),
`crates/fub-features/src/componenti.rs` (righe `fub.pdf`, lavagna spegnibile,
`profili()`), `crates/fub-features/tests/componenti.rs`, i cataloghi di
`fub-features` e di `fub-host` per i nomi e le descrizioni nuove,
`crates/fub-cli/src/componenti.rs`, `crates/fub-cli/src/mcp.rs` e
`crates/fub-cli/src/port.rs` (chiamano l'host invece di fare da sé, D-4), i
loro test (`tests/componenti.rs`, `tests/mcp.rs`, `tests/through_app.rs`), `docs/reference/mcp-server.md` se una
risposta cambia.
Non toccare: `crates/fub-componenti/` (se serve un'operazione nuova, blocco),
`crates/fub-abi/`, il WIT, `crates/fub-app/`, `apps/client/` tranne il file
generato.
Dipende da: nessuno
Cosa fare:
- Le chiavi `components.*` come in A1 e D-5, ognuna con la sua `SettingSpec`
  nel gruppo «Componenti» ed esclusa dal form generico.
- Il modulo `componenti` dell'host: `Host::components(vault)` legge mappa,
  `plugins.disabled` e `components.*` e dà righe, stato e perché;
  `Host::apply_components(vault, azione, apply)` usa `fub-componenti`, scrive i
  bundle in `plugins.disabled` e il resto in `components.*`, e monta o
  smonta subito come `set_plugin_enabled`.
- Lavagna spenta: `CanvasProvider` non registrato, e il vault si rimonta come
  per un bundle. PDF spento: nell'host non cambia niente (pdfjs è del client),
  ma lo stato sta in `components.*` e la mappa lo dice.
- Profili in `fub-features` come in A4; applicare un profilo scrive il nome in
  `components.*`, toccare un interruttore lo azzera («personalizzato»).
- CLI e MCP chiamano l'host: le risposte di oggi non cambiano, tranne lavagna e
  PDF, che ora restano spenti anche dopo il comando.
Casi limite: vault senza `components.*` (come oggi); chiave con un id che
la mappa non ha (si ignora e si dice in `mancanti`); spegnere la penna con PDF e
lavagna accesi (`Richiesto`); «Tienili» su un componente di supporto (resta
acceso dopo la riapertura del vault); un profilo «più avanti» (rifiutato con un
errore che lo dice).
Fatto quando: test in `crates/fub-host/tests/componenti.rs`: lavagna spenta =
nessun provider `.canvas`, riaccesa = come prima; «Tienili» e «in attesa»
sopravvivono a chiusura e riapertura del vault; un vault senza la chiave monta
gli stessi bundle di prima; `crates/fub-cli/tests/componenti.rs` e
`tests/mcp.rs` verdi senza cambiare le attese, tranne lavagna e PDF; test dei
profili in `fub-features` (ogni id esiste o è «più avanti»; «Studio» accende
penna e motori).
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T2 · I due comandi IPC

Perché: la pagina del client deve leggere la mappa e applicare le scelte con la
regola dell'host, non con una copia in TypeScript.
Tocca: `crates/fub-app/src/lib.rs`, `crates/fub-app/permissions/default.toml`,
`crates/fub-app/tests/lean_ipc.rs`, `ipc_permissions.rs`, `ts_mirror_app.rs`,
`apps/client/src/__fixtures__/mirror-samples-app.json` (rigenerato),
`apps/client/src/host/ipc.ts`, `host/contract.ts`, `host/fake.ts`,
`host/mirror.test.ts`, `apps/client/bench/fake-ipc.ts`,
`docs/reference/ipc-contract.md`.
Non toccare: `crates/fub-host/` (se manca qualcosa, blocco), il resto del
client.
Dipende da: T1
Cosa fare:
- `components_map` e `components_apply` come in A7, registrati, concessi, con
  il loro `Why` in `lean_ipc.rs` e i tipi TS specchiati.
- I fake (test e banco) servono la mappa vera di un vault di prova, con un
  profilo «Studio» applicato, e applicano le azioni con le stesse risposte.
Casi limite: vault non aperto; azione su un id sconosciuto; `apply` assente.
Fatto quando: i test di conformità IPC verdi; `mirror.test.ts` confronta i
campioni nuovi; un test vitest chiama i due comandi sul fake e riceve
«Attivati anche…» e `Richiesto`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T2b · Nomi, descrizioni e scenario completo

Aggiunto dall'orchestratore (vedi DECISIONS.md): T2 mandava alla shell le
chiavi del catalogo e uno scenario del fake con pochi gesti.
Fatto: `components_map` risponde nome, descrizione ed etichetta nella lingua
del vault (ripiego sull'id), `gruppi` in ordine, `ui` per riga; lo scenario
registrato copre ogni gesto di T3 e «Solo note», con gli eventi dell'host; il
fake parte da uno stato scelto (`?componenti=solo-note` nel banco), applica
scelte «da fuori» e sa fallire.
Stato: [x] fatto

## T3 · La pagina «Componenti»

Perché: è il posto dove chi usa Fub sceglie, e deve dire sempre perché un
componente è acceso e che cosa succede prima che succeda.
Tocca: `apps/client/src/panels/settings.ts` (la sezione «Inclusi in Fub» e i
suoi helper; se diventa troppo lungo, un file nuovo
`apps/client/src/panels/components-page.ts`), i suoi test
(`settings.components.test.ts` o accanto), gli stili della pagina, i cataloghi
del client, `apps/client/src/i18n/lexicon.ts`, `docs/product/editor-menus.md`,
`apps/client/bench/scene.mjs` (la scena `settings-components`), le baseline
`apps/client/bench/baseline/settings-components-{light,dark}.png`, un test e2e
per la tastiera.
Non toccare: `host/ipc.ts`, `host/contract.ts`, i fake (sono di T2: se manca
qualcosa, blocco); le sezioni dei componenti installati e del catalogo.
Dipende da: T2
Cosa fare:
- La pagina dell'anteprima: la riga dei profili (i tre «più avanti» grigi, con
  il motivo al passaggio e al focus), i gruppi con il loro titolo, la ricerca,
  il gruppo «Di supporto» chiuso con «Mostra»; ogni riga con icona, nome,
  descrizione, «Serve a …» quando è aggiunta, e l'interruttore.
- Accendere: una riga di avviso «Attivati anche …: … non funziona senza».
- Spegnere un componente richiesto: la finestra che elenca chi lo richiede,
  con «Annulla» e «Spegni N componenti».
- Orfani: l'avviso «Non servono più a nessun componente: …» con «Togli» e
  «Tienili»; resta finché non si risponde, anche riaprendo la pagina.
- Profilo: si applica con un clic, e la prova senza `apply` dice prima che cosa
  si spegne; toccato un interruttore, la riga dice «personalizzato».
- Le parole nel lessico (A11).
Casi limite: profilo «più avanti» (non si applica, dice perché); ricerca senza
risultati; un componente del nucleo (nessun interruttore, «sempre acceso»);
errore del comando (l'interruttore torna com'era e l'errore si vede).
Fatto quando: test vitest per ogni gesto; foto chiara e scura della pagina
accanto all'anteprima nella PR; `bench:verify` con le baseline nuove;
`bench:a11y` verde; e2e: tutto il giro con la sola tastiera.
Prova: scripts/check.sh --rapido
Stato: [ ]

## T4 · Gli editor caricati solo se accesi

Perché: un componente spento non deve costare niente nella WebView, e un suo
file deve restare visibile e riapribile.
Tocca: `apps/client/src/editors/core/bootstrap.ts`, `editors/core/registry.ts`,
`state/document-controller.ts`, `panels/explorer.ts`, `ui/app-menu.ts`,
`desktop-shell.ts` (solo le voci «Nuovo» e «Importa» che dipendono da un
componente), `panels/document.ts` (il riquadro «solo come file» con
«Accendi …»), `apps/client/vite.config.ts`, i test accanto, i cataloghi del
client, `apps/client/bench/webview/run.mjs`, `apps/client/src/perf/` se serve
alla sonda.
Non toccare: `panels/settings.ts` (T3), `host/ipc.ts`, `host/contract.ts`, i
fake (T2), `.github/workflows/` (domanda D-1).
Dipende da: T2
Cosa fare:
- Ogni editor legato a un componente (`ui` della sua riga: `editors/rich`,
  `editors/grid`, `editors/canvas`, il PDF di `editors/media`, e i disegni di
  `editors/spatial` per `fub.draw`) si registra con un import dinamico, e
  solo se il componente è acceso. Le superfici del nucleo restano come sono.
- Un file di un componente spento si apre nel riquadro «solo come file»: nome,
  dimensione, «Accendi …» (che chiama `components_apply` e riapre il file) e
  «Apri con» se c'è già.
- I menu (A12) leggono i componenti accesi; accendere o spegnere li aggiorna
  senza ricaricare la pagina.
- Il banco WebView: con «Solo note» e con «Tutto», l'elenco dei chunk scaricati
  all'avvio e dopo aver aperto una nota; S6 `coldStart` per tutti e due.
- Il controllo statico (D-1): il plugin `bundle-size-budgets`
  (`apps/client/vite.config.ts`) calcola l'insieme dei chunk caricati
  all'avvio, lo scrive in un file del build (`dist/`, non nel repo) e dà errore
  se contiene pdfjs, `editors/canvas`, `drawing-*` o `editors/spatial`. Gira
  con `npm run build`, quindi su ogni PR. Il test lo rompe apposta una volta
  (un import statico di `editors/canvas`) e il messaggio nella PR.
Casi limite: spegnere il componente del file aperto (la scheda passa a «solo
come file» senza perdere modifiche non salvate: se ci sono, si chiede prima);
riaccendere con il file aperto; un PDF annotato con PDF spento.
Fatto quando: test vitest del registro (spento = nessun import); e2e: «Solo
note», apri un PDF e una lavagna, vedi «solo come file», «Accendi», il file si
apre; elenco dei chunk e S6 nella PR (cancello); `npm run build` rifiuta un import
statico di `editors/canvas` (rottura apposta, messaggio nel report).
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T5 · Il profilo al vault nuovo

Perché: chi comincia sceglie in un passo quanto Fub deve fare, senza conoscere
i componenti.
Tocca: `apps/client/src/ui/onboarding.ts` e il suo test, `desktop-shell.ts`
(solo il giro di «Crea un vault nuovo…»), `apps/client/index.html` se serve un
contenitore, i cataloghi del client, `apps/client/bench/scene.mjs` (una scena
per la schermata), le baseline nuove, un test e2e.
Non toccare: `panels/settings.ts` (T3), i file di T4, i fake (T2).
Dipende da: T3 (riusa la riga dei profili), T4
Cosa fare:
- Dopo «Crea un vault nuovo…» su un vault nuovo (A6): una schermata sola con i
  sei profili (tre «più avanti»), «Studio» già scelto e «Continua» come tasto
  principale; sotto, una riga: «Si cambia quando vuoi, da Impostazioni ›
  Componenti».
- «Continua» applica il profilo con `components_apply` e apre il vault.
- Chiudere o «Esc» = «Studio».
Casi limite: cartella non vuota scelta con «Crea» (nessuna domanda); errore
nell'applicare (il vault si apre come oggi e l'errore si vede).
Fatto quando: e2e: crea, scegli «Solo note» da tastiera, il vault ha solo Note;
crea e «Esc», il vault ha «Studio»; apri un vault esistente, nessuna
schermata; `bench:a11y` verde con la scena nuova; foto nella PR.
Prova: scripts/check.sh --rapido
Stato: [ ]

## Fine

- CI (D-1, lo fa l'orchestratore, non i coder): lo scenario nuovo del banco
  WebView entra nell'elenco `--only=` del job «la WebView vera»
  (`.github/workflows/ci.yml`, ~riga 610), con la sua soglia `ci` in
  `apps/client/bench/webview/budgets.json` se ne ha una. Nessun job nuovo.
- Prova con persone (D-2): build su server-di-fub, protocollo di una pagina
  con i cinque compiti e che cosa osservare, consegnato all'utente; la PR resta
  in bozza fino al suo resoconto, e ciò che emerge diventa un task o una riga
  in `DECISIONS.md`.

- Banco WebView S1–S3 prima e dopo, S6 «Solo note» contro «Tutto», l'elenco
  dei chunk: tutto nella PR, su server-di-fub.
- `scripts/check.sh` completo; ADR nuova se le chiavi `components.*` o i
  comandi IPC lo chiedono (da decidere in revisione); `DECISIONS.md`
  aggiornato; PLAN.md cancellato con l'ultimo commit.
