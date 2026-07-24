# Piano di aggiustamento (audit architetturale 2026-07-24)

Torna a [PIANO.md](PIANO.md). Esito dell'audit codice↔documenti: architettura
solida, stratificazione rispettata quasi ovunque; le voci qui sotto sono ciò che
va corretto **prima che diventi costoso** (il confine è il freeze del contratto
a [M4](milestones/M4-wit-hardening.md)), più il debito minore emerso strada
facendo. In ordine di urgenza.

**Stato: i punti 1–5 sono chiusi** (2026-07-24). Restano solo le voci del debito
già dichiarato, in fondo, che hanno un milestone loro.

## 1. Contratto WIT: la ricorsione non è esprimibile — decidere ORA ✅

Il rischio grosso: `wit/fubmd/abi.wit` oggi **non compila** (`wasm-tools
validate` lo rifiuta) e la causa profonda non è cosmetica — WIT non ammette
tipi ricorsivi, e `Block`, `Inline`, `UiNode` lo sono. La tabella di
esprimibilità in [architecture/traits.md](architecture/traits.md) dà per buona
la ricorsione via `list<ui-node>`: è una proposta aperta del component model,
non una feature. Contaminazione transitiva: `DocumentModel.body` rende
inesprimibili le firme di `FormatProvider` e `on_document_indexed`;
`ViewUpdate::Replace` e `render_view` idem. Scoprirlo a M5, a contratto
congelato, sarebbe un breaking change; deciso ora è un pomeriggio, e i tipi
Rust nativi **non si toccano** (la conversione vive nel proxy WASM).

- [x] Decidere la rappresentazione al confine per gli alberi ricorsivi:
      **ARENA** (`list<nodo>` piatta + indici `u32`). Scartata la stringa JSON:
      avrebbe fatto sparire dal contratto proprio la parte che il contratto
      esiste per fissare — il modello di documento — e reso invisibile ogni
      divergenza al test di conformità. Decisione e confronto registrati in
      [architecture/traits.md](architecture/traits.md), "Alberi ricorsivi al
      confine".
- [x] Riscritti in `wit/fubmd/abi.wit`: `inline-ref`/`block-ref`/`ui-ref`
      (`u32`), `document-tree { blocks, inlines, roots }`,
      `ui-tree { nodes, root }`, e a cascata `document-model.body`,
      `view-update.replace`, `render-view`.
- [x] Keyword WIT: `%list` (in `block` e `ui-node`), `%result`
      (`event-job-done`), `%from` (`event-document-renamed`). Deciso l'escape
      nel WIT e **non** la rinomina dei campi Rust: è grammatica di un altro
      linguaggio, non un problema del modello.
- [x] Tabella di esprimibilità corretta (le righe `UiNode`/`Block`/`Inline`
      affermavano il falso) e ampliata con le larghezze e le keyword.
- [x] Criterio di chiusura: il WIT **parsa** — lo verifica il test di
      conformità, che lo dà in pasto a `wit-parser` a ogni `cargo test`.

## 2. Test di conformità abi↔WIT: oggi dà falsa sicurezza ✅

`crates/fubmd-abi/tests/wit_conformance.rs` è verde su un WIT sintatticamente
invalido: `assert_present` fa substring matching (`wit.contains(name)`), quindi
`tag`/`text`/`custom`/`query` sono coperti "gratis" da altri identificatori, e
i tipi dei campi non sono verificati affatto. Il lato Rust (match esaustivi che
non compilano su una variante nuova) è buono e va tenuto.

- [x] Il WIT viene **parsato** (`wit-parser` come dev-dependency di
      `fubmd-abi`): un WIT invalido è un test rosso.
- [x] Confronto su **insiemi di nomi dichiarati** estratti dal parse — tipi,
      casi di variant/enum, campi di record, funzioni per interfaccia — al posto
      del substring matching.
- [x] Direzione WIT→abi: un tipo, un caso, un campo o una funzione dichiarati
      nel contratto e mai rivendicati dall'abi fanno fallire il test (contratto
      morto).
- [x] Test del test: cinque divergenze introdotte ad arte (campo rinominato,
      caso rimosso, funzione sparita, tipo di troppo, alias con la larghezza
      sbagliata) devono farlo diventare rosso, più un WIT invalido che deve
      morire subito.
- [ ] (Estensione, resta a M4) confrontare i **tipi** dei campi di record e le
      firme complete delle funzioni. Oggi si confrontano i tipi dei soli alias,
      dove il tipo *è* l'informazione (indici dell'arena `u32`, span `u64`,
      `job-id` `u64`).

## 3. Invariante di dipendenze: vera ma non protetta ✅

Oggi `fubmd-abi`/`fubmd-kernel` sono puliti anche transitivamente (verificato
con `cargo tree`), ma il PIANO dichiara l'invariante "verificata coi test" e il
test **non esiste**: solo commenti nei Cargo.toml. Un `cargo add tantivy -p
fubmd-kernel` passerebbe inosservato.

- [x] `crates/fubmd-abi/tests/dependency_invariant.rs`: interroga
      `cargo metadata` e applica due reti di maglia diversa — **denylist
      transitiva** sulle famiglie proibite (per prefisso: `tauri-build` e
      `tokio-util` non passano) e **allowlist delle dipendenze dirette** dei due
      crate. La prima intercetta il contrabbando, la seconda il gesto; e un
      `cargo update` che cambia un crate di supporto lontano non rompe la build
      per niente.
- [x] CI multi-OS: [.github/workflows/ci.yml](../.github/workflows/ci.yml) —
      matrice ubuntu/windows/macos su toolchain pinnata all'MSRV, più un job
      rapido di sole invarianti (conformità WIT + dipendenze), fmt/clippy e
      type-check del frontend. Senza CI ogni invariante "verificata dai test"
      vale solo sulla macchina di chi ricorda di lanciarli.

## 4. `HostApi` troppo stretta per il versioning: chiudere il buco nel contratto ✅

Il dogfooding ha fatto il suo mestiere e ha trovato il buco: il lato *handler*
del versioning è un `EventHandler` puro, ma `VersionStore` scrive
`.fubmd-data/versions/` con `std::fs` diretto e usa `fubmd_kernel::time` — un
plugin WASM con l'`HostApi` attuale non potrebbe (lo `storage_get/set`
in-memory non basta per uno store di snapshot). Va chiuso **nel contratto**
prima del freeze M4, non aggirato.

- [x] Deciso: **storage persistente per-plugin a blob**, non API filesystem
      scoped — `data_read/write/remove/list`, namespace
      `.fubmd-data/plugins/<id>/` imposto dall'host. Con i blob il plugin non ha
      mai in mano un path del filesystem: il recinto è una proprietà della
      firma, non una convenzione da rispettare. Registrato in
      [architecture/plugin-boundary.md](architecture/plugin-boundary.md),
      "Storage", con la tabella volatile-vs-persistente.
- [x] `now_unix_millis` nel contratto: `VersionStore` non dipende più da
      `fubmd_kernel::time` (né `fubmd-features` da `camino` per questa via).
      Guadagno collaterale: le fasce di ritenzione ora si provano avanzando un
      orologio finto invece di piantare timestamp nelle strutture interne.
- [x] Aggiunta anche `list_documents`: senza, `read_document` serve solo per gli
      id che arrivano dagli eventi, e la "prima fotografia" non poteva vivere
      dentro la feature. È il minimo perché un plugin possa reagire a
      `vault-opened` guardandosi intorno.
- [x] `VersionStore` migrato: scrive e legge **solo** via `HostApi`. È la prova
      che la firma regge un caso reale. Anche l'app passa di lì
      (`Workspace::with_host`): niente canale privilegiato che un plugin non
      avrebbe.
- [x] La policy "prima fotografia all'apertura del vault" è dentro la feature
      (`VersioningHandler` su `Event::VaultOpened`), non più in
      `fubmd-app::open_vault`. È esattamente ciò che farebbe `Plugin::activate`.
- [x] `Workspace::register_event_handler(id, handler)`: l'identità del plugin la
      assegna chi registra, mai il plugin — uno che si sceglie il recinto da sé
      non è dentro a un recinto. Il recinto è verificato in
      `crates/fubmd-kernel/tests/plugin_data.rs`.

> **Conseguenza sui vault esistenti:** lo store delle versioni si è spostato da
> `.fubmd-data/versions/` a `.fubmd-data/plugins/fubmd.versioning/`. Non c'è
> migrazione automatica: un vault già usato riparte con la storia vuota (la
> vecchia cartella resta lì, leggibile a mano). Accettabile ora, prima di
> qualunque distribuzione; da qui in avanti un cambio di layout richiede una
> migrazione.

## 5. Minori ✅

- [x] `Span`: deciso **`usize` in Rust, `u64` nel WIT**, con la conversione
      documentata e a carico del proxy. Obbligare il kernel a `u64` metterebbe
      un `as usize` su ogni slice per compiacere un confine che il kernel non
      attraversa. Registrato in `abi/src/model.rs` e in
      [architecture/traits.md](architecture/traits.md), "Larghezze e keyword".
- [x] `frontend/src/main.ts`: `pageName` non cabla più `\.md$` — le estensioni
      gestite arrivano dal backend (`VaultInfo.extensions`, dai
      `FormatDescriptor` dei provider registrati). Un'estensione che nessun
      provider gestisce resta nel nome, perché non è un'estensione.
- [x] `freeName` è sparito dal frontend: la convenzione `Nota 1, Nota 2, …` vive
      in `Workspace::free_name` (che ora usa anche `create_note`) ed è esposta
      dal comando IPC `propose_free_name`. Una sola implementazione.
- [x] Riferimenti al cancellato `docs/CRUD_E_VAULT.md` aggiornati ovunque
      (`vault.rs`, `time.rs`, `PIANO.md`, `data-model.md`, `M2-search-graph.md`)
      — erano sei, non uno.

## Debito già dichiarato (non è emerso nulla di nuovo: resta in agenda)

Voci confermate dall'audit, già nei documenti con il loro milestone; elencate
qui solo perché il piano sia completo.

- [ ] **Cache metadata/body da sdoppiare** (M2, [milestone](milestones/M2-search-graph.md)):
      l'audit conferma che è confinata — `Workspace::model()` non ha chiamanti
      esterni, il body dei documenti chiusi serve solo a
      `render_preview`/`render_embed`, ~5-6 siti in `workspace.rs`, zero
      impatto su abi/features. Non sta marcendo, ma va fatta col resto di M2.
- [ ] **Mutex unico sul `Workspace`** (accettato nel PIANO): misurare prima di
      agire; eventuale split lettura/scrittura a M2/M3.
- [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3 di
      [ORGANIZZAZIONE_VAULT.md](ORGANIZZAZIONE_VAULT.md), consapevole): se gli
      "spazi smart" o criteri di ordinamento estensibili diventeranno un
      desiderio, il costo sarà riscrivere, non estendere — rivalutare quando si
      progetta la superficie plugin di M5.
- [ ] **`SearchIndex` scrive ancora con `std::fs`.** Non è una svista: le firme
      di `IndexProvider` non portano un `HostApi` (`on_document_indexed` riceve
      il `DocumentModel` e basta). Un indice di terzi a M5 avrà lo stesso
      problema che aveva il versioning, e la soluzione è la stessa — decidere a
      M4, insieme al freeze, se `IndexProvider` debba ricevere l'host.
