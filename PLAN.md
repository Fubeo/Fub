# Piano: K1 · Il modello dei componenti

Branch: piano/k1-componenti
Obiettivo: Fub sa di quali componenti è fatto, chi richiede chi e perché ognuno
è acceso; lo dicono `fub-cli componenti` e il server MCP. Per chi usa l'app non
cambia niente.
Perché: K2 (la pagina «Componenti», i profili, gli editor caricati solo se
accesi) e K3 (i motori) leggono tutti la stessa mappa: deve esistere una volta
sola, pura, provata su mappe casuali.
Fuori scope: la pagina «Componenti» nuova, il profilo al primo avvio, gli
import dinamici degli editor e le parole nel client (K2); `fub-motori`,
`Pigro<T>`, i costruttori dei motori (`.motore(...)`) e i comandi dei motori
(K3); le righe di componenti che nel codice non esistono ancora (PDF, OCR, foto,
libreria, disegno completo, motore vettoriale, caratteri, colore, scheda
grafica, RAW, tablet, agenti): ognuna arriva con il suo codice; i dati
scaricabili e le edizioni (K4); l'errore «comando di un componente spento» che
nomina il componente (arriva con i comandi dei motori, K3); il piano K2.
Assunzioni: vedi «Assunzioni» qui sotto (A1–A10), approvate il 2026-11-01.
Ondate: T1 T2 | T3 | T4
Prototipo: nessuno (K1 non cambia l'interfaccia)

## Modifiche

- 2026-11-01 · Tocca di T3 col percorso esatto (`mount.rs`, due punti); prova
  di T2 limitata a `-p fub-componenti -p fub-abi`; misura di main del banco
  WebView prima dei coder · richiesta dell'utente con l'OK · T2, T3, fine.

## Fonti

- Piano «Fub a componenti», fase K1:
  https://claude.ai/artifact/T2Ts14vEwWTNzHHs6NKP9w (i coder non lo leggono:
  qui sotto c'è tutto ciò che serve).
- Scritto su main @ 2608cda; controllato su main @ d235d3f6 (2026-11-01).
- Le PR #261–#269 (N13, N1, N2, K0) sono già tutte in main: #269 unita il
  2026-11-01 alle 01:05 UTC con lo stack intero, le altre chiuse perché
  contenute, #264 unita il 31/10. Nessuna PR aperta: nessun task aspetta una PR.

## Assunzioni

Dove il codice e il piano non dicono la stessa cosa vince il codice; la
differenza è scritta qui.

- A1 · **Niente proptest.** Il repo non lo usa (`crates/fub-kernel/Cargo.toml`:
  «niente proptest: il generatore di sequenze è un xorshift deterministico
  dentro il test»). Le «proprietà su 10.000 mappe casuali» usano lo stesso
  xorshift con seme fisso, stampato nel messaggio quando un caso fallisce.
- A2 · **Il WIT cresce in coda a 0.2.0, senza cambiare versione.**
  `ABI_VERSION = "0.2.0"` (`crates/fub-abi/src/traits.rs:4154`); in
  `crates/fub-abi/wit/frozen/` ci sono solo `0.1.0.wit` e `0.1.1.wit`, quindi
  0.2.0 non è congelata e un campo in fondo a `record plugin-manifest` è
  un'aggiunta (`docs/reference/abi-and-wit.md`, «Compatibilità»).
  `abi_compatible` (riga 4706) non cambia. `frozen/` non si tocca.
- A3 · **Nomi Rust in inglese in `fub-abi`**, come il resto del contratto:
  `uses`, `kind: ComponentKind { Mode, Engine, Service, Data }`,
  `delivery: Delivery { Included, Edition { name }, Download { url, sha256,
  bytes } }`, `ui`, `group`. Il crate nuovo resta `fub-componenti` con i nomi
  del piano (`Mappa`, `Stato`, `Effetto`, `accendi`, `spegni`, `perche`).
- A4 · **Righe solo per ciò che ha codice oggi.** La mappa completa del piano
  (31 componenti, sotto in T2) entra come dato di prova in `fub-componenti`:
  prova regole e profili senza dichiarare componenti vuoti («chi richiede
  qualcosa che manca non si dichiara affatto»). Un requisito verso un
  componente che non esiste ancora si omette e si scrive in un commento.
- A5 · **Gli id.** Un componente che è già un bundle tiene l'id del bundle
  (`set_plugin_enabled` lavora su quello): «note» = `fub.markdown`, «grafo» =
  `fub.graph`, «correttore» = `fub.proof`, «documenti» = `fub.rich`, «fogli» =
  `fub.xlsx`. I componenti nuovi senza bundle: `fub.lavagna`, `fub.penna`,
  `fub.motore-documenti`, `fub.motore-fogli`, `fub.dizionari`.
- A6 · **Il nucleo** è ciò che l'host monta sempre (`crates/fub-host/src/mount.rs`
  ~471): `fub.core`, `fub.maintenance`, `fub.markdown`. Quindi in K1 «Note» non
  si spegne (il profilo «Solo PDF» senza note sarà possibile solo dopo). Oggi
  `set_plugin_enabled` (`crates/fub-host/src/session.rs:2547`) rifiuta solo
  `fub.core` (`CORE_ID`, `crates/fub-host/src/settings.rs:110`).
- A7 · **Lo stato resta `plugins.disabled`** (risposta Q-a): nessuna
  chiave nuova, perché ogni `SettingSpec` del gruppo «Componenti» si vede nelle
  Impostazioni (`SettingSpec` non ha un campo «nascosto»), e il cancello vuole
  nessun cambiamento visibile. Scelti = i componenti non di supporto che non
  stanno in `plugins.disabled`; i componenti di supporto sono accesi se qualcuno
  li richiede; «in attesa» resta vuoto fra un comando e l'altro.
- A8 · **Il binario è `fub-cli`**, non `fub`: il comando è
  `fub-cli componenti …`.
- A9 · **Strumenti MCP con i nomi di oggi** (`fub_search`, `fub_invoke`, …):
  `fub_components`, `fub_components_why`, `fub_components_enable`,
  `fub_components_disable`. Le regole sono quelle di ADR 0232: senza `apply` è
  una prova; senza `--automation-write-root` il server è in sola lettura, quindi
  accendere e spegnere sono rifiutati.
- A10 · **I nomi dei componenti stanno in un catalogo** di `fub-features`
  (`component.<nome>.name`, una voce per ogni lingua che hanno gli altri
  cataloghi: oggi `it` e `en`), presidiato da `tests/catalogs.rs`.

## Risposte dell'utente (2026-11-01)

- Q-a · Lo stato resta `plugins.disabled`, senza chiavi nuove (A7).
- Q-b · Componenti per vault: sì; sul disco vale per la macchina, acceso vale
  per il vault.
- Q-c · Nomi delle modalità: un nome per tipo di file e l'interruttore
  Semplice·Completo; in K1 solo le chiavi `component.*.name`.

## Cancello di K1

Ogni punto ha la sua prova nella PR.

| Fatto quando | Prova | Task |
|---|---|---|
| nessun attivo con un requisito spento su 10.000 mappe casuali | test `nessun_attivo_con_un_requisito_spento` in `crates/fub-componenti/tests/proprieta.rs`, seme stampato | T2 |
| accendere e poi spegnere torna allo stato di prima | test `accendi_poi_spegni_torna_a_prima` (10.000 mappe, orfani compresi) in T2; test CLI su un vault temporaneo: `spegni` poi `accendi` lascia `plugins.disabled` e i bundle montati identici (T4) | T2, T4 |
| ogni feature Cargo ha la sua riga e viceversa | `crates/fub-features/tests/cargo_features.rs` esteso alle righe nuove; inoltro in `fub-host` controllato | T3 |
| nessun cambiamento visibile per chi usa Fub | `crates/fub-host/tests/official_views.rs` e i test di montaggio invariati; test nuovo: un host di default monta gli stessi bundle di prima; `bench:verify` sulla PR pronta; banco WebView S1–S3 su questa macchina prima/dopo, numeri nella PR | T3, fine |

## Regole che valgono per ogni task

- Ogni punto del «Fatto quando» ha la sua prova: un test, una foto o una misura.
- Non scrivere numeri non misurati. Le misure si prendono nella WebView vera
  (il banco WebView gira su questa macchina), non solo in Chromium.
- Un componente spento non costa niente: né memoria, né tempo all'avvio, né
  codice. Ogni task che tocca un componente lo prova spento e acceso.
- Testi nei cataloghi, in italiano, con la chiave in tutte le lingue.
- Le parole: Componente, Richiede, Usa se c'è, Scelto, Serve a…, Non serve più,
  Di supporto, Accendi, Spegni, Togli, Tienili, Profilo («personalizzato»).
- Nessun nome né logo ArtCraft nell'interfaccia e nei testi.
- I file del vault non si toccano: accendere e spegnere cambia solo che cosa è
  montato.
- Mai il vault reale (`~/.cache/fub-live/vault-tutti/`): solo vault temporanei.

## T1 · Il manifest cresce per aggiunta

Perché: K2 e K3 leggono dal manifest che cosa un componente usa, di che tipo è,
come arriva e quali pezzi del client carica; i plugin di terzi lo dichiarano
come gli ufficiali.
Tocca: `crates/fub-abi/src/traits.rs`, `crates/fub-abi/wit/fub/abi.wit`,
`crates/fub-abi/tests/wit_conformance.rs`, `crates/fub-wasm-host/src/compat.rs`
(e `installed.rs` per la validazione), ogni costruzione letterale di
`PluginManifest { … }` o di `plugin-manifest` nel repo (oggi 33 file in
`crates/`; cercare anche in `tools/` e negli esempi WASM che `fub-wasm-host`
compila), `docs/reference/abi-and-wit.md` (una riga sui campi nuovi).
Autorizzati dopo il blocco del coder (2026-11-01): `crates/fub-abi/src/lib.rs`
(i due tipi nel `pub use`) e `apps/client/src/host/enums.generated.ts`, solo
rigenerato con `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums`.
Non toccare: `crates/fub-abi/wit/frozen/`, `ABI_VERSION`, `abi_compatible`,
`crates/fub-features/src/inventory.rs`, il client.
Dipende da: nessuno
Cosa fare:
- In `PluginManifest` aggiungere **in fondo**, tutti con `#[serde(default)]`:
  - `uses: Vec<String>` — «usa se c'è»: come `requires`, ma se manca il
    componente si monta lo stesso;
  - `kind: ComponentKind` — `Mode` (default), `Engine`, `Service`, `Data`;
  - `delivery: Delivery` — `Included` (default), `Edition { name: String }`,
    `Download { url: String, sha256: String, bytes: u64 }` (ADR 0233: il
    livello 3 sono le edizioni; nessuna libreria a runtime);
  - `ui: Vec<String>` — i pezzi del client (chunk Vite, percorsi sotto
    `apps/client/src/`, es. `editors/rich`) che il componente carica;
  - `group: Option<String>` — il gruppo della pagina (`scrivere`, `leggere`,
    `pensare`, `disegnare`, `foto`, `ufficio`, `altro`, `supporto`).
- Serde come gli altri enum del contratto (`snake_case`); un manifest JSON
  senza i campi nuovi si legge come prima (test).
- Nel WIT: gli stessi campi in coda a `record plugin-manifest`, con
  `enum component-kind` e `variant delivery` (e il record che serve a
  `download`) come tipi nuovi; `wit_conformance.rs` li confronta.
  `wit_additivity.rs` deve restare verde **senza** toccare `frozen/`.
- `fub-wasm-host`: la conversione WIT → Rust porta i campi nuovi; la
  validazione del manifest installato rifiuta `uses` con id vuoti o doppi come
  già fa con `timers`.
- Ogni letterale esistente prende i default: nessun manifest di oggi cambia
  valore.
Casi limite: manifest JSON vecchio senza i campi; `uses` che ripete un
`requires` (si accetta, ma `requires` vince); `Download` con `bytes = 0` o
sha256 non esadecimale di 64 caratteri (rifiutato dalla validazione di
`fub-wasm-host`); un componente WASM compilato prima del cambio (gli esempi si
ricompilano: devono passare).
Fatto quando: `cargo test -p fub-abi` verde con `wit_conformance` e
`wit_additivity`; test nuovo: un manifest JSON senza i campi nuovi si legge con
i default, e uno con tutti i campi fa il giro serde identico; `cargo test -p
fub-wasm-host` verde con gli esempi ricompilati; nessun file in `frozen/`
cambiato (`git diff --stat` nella PR).
Prova: scripts/check.sh --rapido
Stato: [~] in corso · coder · base 90c48297

## T2 · Il risolutore `fub-componenti`

Perché: «acceso», «richiesto da», «non serve più» devono avere una sola
definizione, pura, che host, CLI, MCP e test usano allo stesso modo.
Tocca: `crates/fub-componenti/` (nuovo: `Cargo.toml`, `src/lib.rs`,
`tests/proprieta.rs`, `tests/mappa_del_piano.rs`), `Cargo.toml` della radice
(`members` e `[workspace.dependencies]`), `Cargo.lock`,
`docs/architecture/overview.md` (il diagramma dei crate: lo controlla
`crates/fub-abi/tests/dependency_invariant.rs`), e se serve
`.github/scripts/membri-del-workspace.mjs`.
Non toccare: `fub-abi`, `fub-features`, `fub-host`, `fub-cli`.
Dipende da: nessuno
Cosa fare:
- Crate puro: niente I/O, niente dipendenze (al più `serde` del workspace per
  serializzare `Stato` ed `Effetto`). Non dipende da `fub-abi`: una riga è
  `Componente { id, requires, uses, gruppo: Option<String>, provides }`.
- `Mappa::nuova(righe, nucleo) -> Result<Mappa, ErroreMappa>`: un requisito si
  risolve per id o per `provides`; errori: id doppio, requisito che nessuno
  offre, ciclo nei `requires` (trovato qui, quindi a build time nei test di chi
  costruisce la mappa), nucleo che nomina un id sconosciuto.
- `Stato { scelti: BTreeSet<Id>, in_attesa: BTreeSet<Id> }`.
- `Mappa::attivi(&Stato) -> BTreeSet<Id>`: il nucleo, più la chiusura dei
  `requires` a partire da `scelti ∪ in_attesa`. Un id sconosciuto non accende
  niente. `uses` non accende niente.
- `accendi(&Stato, id) -> Result<(Stato, Effetto), Errore>`: toglie `id` da
  `in_attesa`, lo mette in `scelti`; `Effetto.accesi_anche` = i nuovi attivi
  diversi da `id` (per la frase «Attivati anche Penna e Motore dei PDF: PDF non
  funziona senza»).
- `spegni(&Stato, id) -> Result<(Stato, Effetto), Errore>`: se qualcuno di
  attivo richiede `id` (a catena) non spegne e torna
  `Errore::Richiesto { da: Vec<Id> }` («Spegnere la Penna? Serve a …»);
  `spegni_con_dipendenti(&Stato, id)` spegne `id` e tutti quelli
  (`Effetto.spenti_anche`). Dopo lo spegnimento, `Effetto.orfani` = attivi
  prima, non attivi ora, non spenti esplicitamente, non scelti: vanno in
  `in_attesa` e **restano accesi** finché non si risponde.
- `togli(&Stato, orfani)` li toglie da `in_attesa` (si spengono);
  `tieni(&Stato, orfani)` li sposta in `scelti`.
- `perche(&Stato, id) -> Perche`: scelto, oppure richiesto da (elenco degli
  attivi che lo richiedono, diretti), oppure in attesa, oppure spento;
  `Effetto.mancanti: Vec<(Id, Id)>` dice chi richiede un id che la mappa non ha.
- `applica_profilo(&Stato, &Profilo) -> (Stato, Effetto)`: `scelti` = i
  componenti del profilo; un profilo con un id sconosciuto lo segnala in
  `mancanti` e applica il resto.
- Il nucleo non si spegne: `spegni` di un id del nucleo → `Errore::Nucleo`.
- `tests/proprieta.rs`, xorshift deterministico (A1), 10.000 mappe casuali
  acicliche (fino a 40 componenti, requires/uses casuali, qualche id del
  nucleo) e stati casuali:
  1. `nessun_attivo_con_un_requisito_spento`;
  2. `accendi_poi_spegni_torna_a_prima`: da uno stato con `id` spento,
     `accendi` poi `spegni_con_dipendenti` poi `togli(orfani)` torna allo
     stato di partenza, `in_attesa` compreso;
  3. `un_ciclo_e_un_errore_della_mappa` (mappe con un ciclo iniettato);
  4. `il_nucleo_non_si_spegne`.
- `tests/mappa_del_piano.rs`: la mappa e i profili del piano come dato
  (sotto); controlla che si costruisca, che ogni profilo accenda i requisiti
  attesi (es. «Solo PDF» accende `motore-pdf`, `penna`, `caratteri`) e le
  frasi d'esempio: spegnere `penna` con `pdf` e `tablet` accesi →
  `Richiesto { da: [pdf, tablet] }`; spegnere `lavagna` lascia
  `motore-vettoriale` in `in_attesa` se nessun altro lo richiede.
Dato di prova (la mappa del piano; r = richiede, u = usa se c'è):
- scrivere: `note`; `grafo` r note; `correttore` r note, dizionari
- leggere: `pdf` r motore-pdf, penna · u ocr; `pdf-completo` r pdf, caratteri ·
  u pdf-script; `ocr` r motore-pdf (scaricabile, processo a parte);
  `pdf-script` r pdf-completo (processo a parte)
- pensare: `lavagna` r penna, motore-vettoriale · u pdf, fogli, documenti
- disegnare: `disegno` r motore-vettoriale, penna; `disegno-completo` r
  disegno, caratteri, colore
- foto: `foto` r motore-foto, colore, gpu · u penna, raw; `libreria-foto` r
  motore-libreria, colore, gpu, raw · u ia-foto; `ia-foto` r libreria-foto
  (scaricabile)
- ufficio: `documenti` r motore-documenti, caratteri · u penna, dizionari;
  `fogli` r motore-fogli · u penna
- altro: `agenti`; `tablet` r penna
- supporto: `penna`, `motore-pdf`, `motore-vettoriale` r caratteri,
  `motore-foto` r caratteri, `motore-libreria`, `motore-documenti`,
  `motore-fogli`, `caratteri`, `colore`, `gpu`, `raw`, `dizionari`
  (scaricabile)
- Profili: `note` [note]; `pdf` [pdf, pdf-completo]; `studio` (consigliato)
  [note, grafo, correttore, pdf, lavagna, documenti, fogli, tablet];
  `grafica` [note, lavagna, disegno-completo, foto]; `fotografia` [note,
  libreria-foto, foto]; `tutto` = ogni componente non di supporto. Il profilo
  diventa «personalizzato» appena si accende o spegne qualcosa a mano (lo
  tiene chi chiama: qui basta che `applica_profilo` e `accendi` siano
  distinguibili).
Casi limite: mappa vuota; stato con id sconosciuti; accendere un già scelto
(nessun effetto); spegnere uno già spento (nessun effetto, nessun errore);
orfani a catena (un orfano che teneva acceso un altro); un componente che
richiede sé stesso (ciclo); `uses` verso un id che non esiste (permesso).
Fatto quando: i quattro test di proprietà e `mappa_del_piano.rs` verdi; ogni
test di proprietà fallisce se si rompe apposta la regola che prova (scriverlo
nella PR: quale riga si è cambiata e che cosa ha stampato); `cargo tree -p
fub-componenti -e normal` mostra al più `serde`; `dependency_invariant` verde
col diagramma aggiornato.
Prova: scripts/check.sh --rapido --base <sha> -p fub-componenti -p fub-abi
(`fub-abi` per `dependency_invariant`; senza `-p` la riga nuova nel
`Cargo.toml` della radice fa controllare tutto il workspace mentre T1 fa lo
stesso. Il controllo completo lo fa l'orchestratore dopo aver unito T2.)
Stato: [~] in corso · coder · base 90c48297

## T3 · L'inventario diventa la mappa

Perché: la mappa vera di Fub deve uscire dal codice che c'è, ed essere la
stessa cosa che decide che cosa si compila e che cosa si monta.
Tocca: `crates/fub-features/src/inventory.rs`,
`crates/fub-features/src/componenti.rs` (nuovo), `crates/fub-features/src/lib.rs`,
`crates/fub-features/Cargo.toml`, `crates/fub-features/tests/cargo_features.rs`,
`crates/fub-features/tests/componenti.rs` (nuovo), `crates/fub-host/Cargo.toml`
(solo `[features]` e la dipendenza da `fub-componenti` se serve),
`crates/fub-host/src/lib.rs` (una riga: `pub use fub_features::componenti`),
`crates/fub-host/tests/componenti.rs` (nuovo), `crates/fub-host/src/mount.rs`
solo in due punti: `struct CoreBundle` e i suoi builder (`providing`,
`requiring`, righe ~60–130, se ne aggiungono per `uses`, `kind`, `group`, `ui`)
e il ciclo delle feature ufficiali (`for feature in
fub_features::every_official_feature()`, righe ~405–430), dove il manifest di
ogni bundle ufficiale si costruisce dalla sua riga; `Cargo.lock`.
Non toccare: il resto di `crates/fub-host/src/mount.rs` (quali bundle si
montano e in che ordine non cambia), `crates/fub-host/src/session.rs`, `crates/fub-host/src/settings.rs`, `fub-abi`, `fub-cli`, il client.
Dipende da: T1, T2
Cosa fare:
- In `fub-features`, `componenti.rs`: `pub fn righe() -> Vec<Riga>` e
  `pub fn mappa() -> fub_componenti::Mappa`, con `NUCLEO = [fub.core,
  fub.maintenance, fub.markdown]`. Una `Riga` ha id, chiave del nome, gruppo,
  `kind`, `delivery` (tutte `Included` in K1), `provides`, `requires`, `uses`,
  `ui`, `cargo_feature: Option<&'static str>`, `bundle: bool`. Un builder come
  nel piano va bene: `Riga::modalita(id, "component.x.name").group(…)
  .requires(&[…]).uses(&[…]).ui(&[…]).cargo_feature(…)`. Ogni riga dietro il
  suo `#[cfg(feature = …)]`, come `OFFICIALS`.
- Le righe (A5):
  - una per ognuna delle 19 feature ufficiali di oggi (`search`, `versioning`,
    `backlinks`, `outline`, `tags`, `properties`, `template`, `queries`,
    `dashboard`, `backup`, `trash`, `stats`, `graph`, `commands`, `blocks`,
    `base`, `formatting`, `proof`, `draw`), id = id del bundle, feature Cargo =
    nome del modulo come oggi, `requires` = i `requires` di oggi; gruppo
    `scrivere` (tutte richiedono anche `fub.markdown`), tranne `fub.draw`
    gruppo `disegnare`; `kind` `Service` per `search`, `versioning`,
    `commands`, `properties`, `draw`, `Mode` per le altre; `fub.graph` è
    «grafo», `fub.proof` è «correttore» e richiede anche `fub.dizionari`;
  - `fub.markdown` «Note», gruppo `scrivere`, nel nucleo, `ui
    ["editors/text"]`, senza feature Cargo (oggi è sempre compilato);
  - `fub.rich` «Documenti», `ufficio`, requires `fub.motore-documenti`, uses
    `fub.penna`, `fub.dizionari`, `ui ["editors/rich"]`, feature `rich`;
  - `fub.xlsx` «Fogli», `ufficio`, requires `fub.motore-fogli`, uses
    `fub.penna`, `ui ["editors/grid"]`, feature `xlsx`;
  - `fub.lavagna` «Lavagna», `pensare`, requires `fub.penna`, uses `fub.rich`,
    `fub.xlsx`, `ui ["editors/canvas"]`, senza feature Cargo (oggi sempre
    compilata; il motore vettoriale non esiste ancora: commento);
  - di supporto (`kind` `Engine` o `Service`): `fub.penna`, `fub.dizionari`
    senza feature Cargo; `fub.motore-documenti` feature `engine-documents`,
    `fub.motore-fogli` feature `engine-sheets`;
  - ogni altro bundle che un `Host` di default monta e che non è un tema
    (`fub.linkcard`, `fub.importers`, `fub.updates`, `fub.publish`, `fub.sync`
    e i loro `.commands` se li monta l'host): una riga ciascuno, gruppo
    `altro` (`fub.linkcard` e `fub.importers` in `scrivere`), `kind`
    `Service`. **Nessun bundle va nel gruppo `supporto`**: un bundle di
    supporto si spegnerebbe quando nessuno lo richiede, ed è un cambiamento
    visibile.
- Le feature Cargo nuove di `fub-features` (`rich`, `xlsx`,
  `engine-documents`, `engine-sheets`) sono marcatori senza dipendenze, nel
  `default`; `fub-host` le inoltra: `rich = ["dep:fub-format-rich",
  "fub-features/rich", "fub-features/engine-documents"]`, lo stesso per `xlsx`
  con `engine-sheets`. Spento `rich` in `fub-host`, spariscono le due righe e il
  codice.
- `cargo_features.rs`: ogni riga con `cargo_feature` ha la sua feature in
  `[features]` e nel `default`, ogni feature ha almeno una riga (o è nel
  piccolo elenco di feature che non sono componenti, con il perché scritto),
  e le righe senza feature Cargo sono esattamente `fub.markdown`,
  `fub.lavagna`, `fub.penna`, `fub.dizionari` (il test le elenca: una riga in
  più senza feature è rossa). Controllare anche che `fub-host` inoltri ogni
  feature-componente di `fub-features` (oggi nessuno lo controlla: vedi il
  commento in testa al file).
- Il manifest di ogni bundle ufficiale porta `uses`, `kind`, `group`, `ui`
  della sua riga; test: manifest e riga dicono lo stesso (anche `provides` e
  `requires`).
- Il catalogo `component.<nome>.name` (it, en) per ogni riga, con i nomi del
  piano: Note, Grafo, Correttore, Documenti, Fogli, Lavagna, Penna, Dizionari,
  Motore dei documenti, Motore dei fogli; per le feature delle note il nome
  che hanno già. Presidiato da `tests/catalogs.rs`.
- `fub-features/tests/componenti.rs`: `mappa()` si costruisce (niente cicli,
  niente requisiti senza nessuno che li offra); ogni voce di `ui` è una
  cartella che esiste sotto `apps/client/src/`.
- `fub-host/tests/componenti.rs`: un `Host` di default su un vault temporaneo
  monta esattamente i bundle di prima (elenco scritto nel test, preso da main
  prima del cambio); ogni bundle montato che non è un tema è una riga di
  `mappa()` o sta nel nucleo; con `plugins.disabled = ["fub.graph"]` è
  spento solo il grafo, come oggi.
Casi limite: `fub-host` compilato con `--no-default-features`; `rich` spento e
`xlsx` acceso; una riga che richiede un bundle spento da Cargo (la mappa non si
costruisce: errore chiaro nel test, non un panic a runtime); un tema montato
(non è un componente).
Fatto quando: `cargo test -p fub-features` e `cargo test -p fub-host --test
componenti` verdi; `cargo test -p fub-host --no-default-features --test
componenti` verde e `cargo tree -p fub-host --no-default-features -e normal`
non contiene `fub-format-rich` né `fub-format-xlsx` (spento non costa codice:
l'output nella PR); `official_views.rs` invariato e verde.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T4 · `fub-cli componenti` e gli stessi comandi via MCP

Perché: un agente deve vedere e cambiare i componenti come la persona, con le
stesse parole e le stesse regole.
Tocca: `crates/fub-cli/src/cli.rs`, `crates/fub-cli/src/componenti.rs` (nuovo),
`crates/fub-cli/src/main.rs` (l'instradamento), `crates/fub-cli/src/mcp/tools.rs`,
`crates/fub-cli/src/mcp.rs` (solo `INSTRUCTIONS`), `crates/fub-cli/tests/componenti.rs`
(nuovo), `crates/fub-cli/tests/mcp.rs`, `crates/fub-cli/tests/cli_contract.rs` se
elenca i comandi, `docs/reference/mcp-server.md`.
Non toccare: `fub-host` (si usano le chiamate che `HostPort` ha già:
`bundles`, `query_index(IndexQuery::Settings)`, `set_plugin_enabled`),
`fub-features`, `fub-componenti`, il comando `plugin` di oggi (resta com'è).
Dipende da: T3
Cosa fare:
- Lo stato si legge da `plugins.disabled` (A7): scelti = righe non di supporto
  non in `plugins.disabled`; si scrive solo con `set_plugin_enabled` sui
  bundle. Le righe che non sono bundle cambiano solo che cosa la CLI dice (in
  K1 nient'altro le legge).
- `fub-cli componenti`: una riga per componente, colonne acceso/spento,
  scelto/serve, id, nome dal catalogo, «← chi lo richiede»; `--format json`
  come gli altri comandi (busta `envelope_ok`, `offset`, `limit`).
- `fub-cli componenti perche <id>`: «penna è attiva perché la richiedono: pdf,
  tablet» (con gli id reali); scelto: «… è attivo perché l'hai scelto»; nucleo:
  «… fa parte del nucleo: non si spegne».
- `fub-cli componenti accendi <id>`: accende e dice «Attivati anche …: <nome>
  non funziona senza».
- `fub-cli componenti spegni <id>`: se altri lo richiedono non spegne ed
  elenca chi («Serve a …»), con `--anche-questi` spegne tutti; altrimenti
  «<id> spento.»; se restano orfani: «Non servono più a nessuno: …» con
  `--togli` (li spegne nello stesso comando) o `--tieni`. Come per `plugin`:
  `confirm_write` senza `--yes`, `--dry-run` mostra l'effetto e non cambia
  niente.
- Errori: id sconosciuto («nessun componente si chiama …»), nucleo («… fa
  parte del nucleo: non si spegne»).
- MCP (A9): `fub_components` (elenco), `fub_components_why {id}`,
  `fub_components_enable {id, apply}`, `fub_components_disable {id, apply,
  also_dependents, orphans: "remove"|"keep"}`. Senza `apply` torna l'effetto
  e non cambia niente; senza radici di scrittura `enable`/`disable` con
  `apply` sono rifiutati come gli altri strumenti che scrivono.
  Documentarli in `docs/reference/mcp-server.md`.
- Testi in italiano, con le parole del lessico (Componente, Richiede, Serve a…,
  Non serve più, Togli, Tienili, Accendi, Spegni); i nomi dal catalogo.
Casi limite: vault aperto dall'app (passa da `HostPort`: test in
`through_app.rs` se c'è già il banco); spegnere un componente già spento;
accendere il nucleo; `plugins.disabled` con id che non esistono più (ignorati,
non cancellati); `--dry-run` insieme a `--togli`.
Fatto quando: `tests/componenti.rs` su un vault temporaneo: elenco; `perche`;
`spegni fub.graph` poi `accendi fub.graph` lascia `plugins.disabled` e i
bundle montati identici a prima (cancello, punto 2); `spegni fub.properties`
rifiuta e nomina almeno `fub.template` (che la richiede), con `--anche-questi` spegne
entrambe; `spegni fub.markdown` rifiuta. `tests/mcp.rs`: i quattro strumenti
in `tools/list`; senza `apply` niente cambia; senza radici di scrittura il
rifiuto. Ogni test prova il componente acceso e spento.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## Alla fine (orchestratore)

- `scripts/check.sh` completo.
- Banco WebView S1–S3 sul branch, su questa macchina, quando nessuna
  compilazione è in corso (carico sotto 0,8 alla partenza), con lo stesso
  comando; confronto con la misura di main qui sotto, numeri nella PR. Devono
  restare dentro i budget `ci`.
- Misura di main (d235d3f6), 2026-11-01 04:55, server-di-fub (Debian 13,
  WebKitGTK 2.54 sotto Xvfb, rendering software), nessun coder e nessuna
  compilazione in corso, carico 0,78 alla partenza; `xvfb-run -a -s "-screen 0
  1280x800x24" npm run bench:webview -- --only=S1,S2,S3
  --native-driver=/usr/bin/WebKitWebDriver`, dopo `npm run build` e `cargo build
  --release --locked -p fub-app --features tauri/custom-protocol`:
  S1.keyToPaint.p95 128 ms (soglia 330, 100 campioni) · S2.noteSwitch.p95
  445 ms (soglia 780, 20) · S3.frameGap.p95 181 ms (soglia 360, 124) ·
  S3.frameGap.max 789 ms (soglia 1600, 124).
- ADR nuova: «Il modello dei componenti» (primo numero libero: 0234, perché
  0228–0233 sono usate e 0230 è tenuta per PdfCraft).
- Il registro di `DECISIONS.md` con ciò che si è deciso strada facendo.
