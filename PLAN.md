# Piano: Rete dei dispositivi e replica del vault

Branch: piano/rete-e-replica (scritto per ora su `claude/beautiful-cori-jgniza`: si sposta su `piano/rete-e-replica` alla consegna, con l'OK)
Obiettivo: i vault di Fub restano uguali su tutti i dispositivi di chi li usa e delle persone invitate, senza un server, senza che una versione vecchia sovrascriva mai una nuova e senza chiedere di «scegliere una versione»; due persone possono scrivere insieme nello stesso documento vedendo i cursori, e quando serve uno sguardo umano Fub mostra il documento con le differenze evidenziate.
Perché: oggi la sincronizzazione esiste solo verso un server da ospitare (`fub-services`, protocollo `fub-sync/1`), confronta file interi e in caso di modifiche parallele crea copie di conflitto da sistemare a mano; il tablet rimasto scollegato per giorni deve poter scrivere senza che la sua versione vecchia cancelli quella nuova.
Fuori scope: Google Drive attraverso le sue API (richiede un'app Google registrata dal maintainer: si fa in un piano successivo; una cartella di Drive per desktop funziona già come «cartella condivisa»); un ponte pubblico di terzi; un ruolo «sola lettura» per gli invitati (tutti i membri di un vault scrivono); la sessione live del tablet (`fub-live`, ADR 0205) resta com'è, sulla sola rete locale; la sincronizzazione di versioni (`fub.versioning`), bozze, journal, stato delle viste e indici, che restano di ogni dispositivo; la rimozione della sincronizzazione via server attuale (`fub-sync/1`), che resta intatta; plugin WASM che usano la rete; condivisione con un link pubblico.
Assunzioni:
- A1 · Librerie: rete con `iroh` 1.4 (MIT OR Apache-2.0) usato **senza** alcun servizio dei suoi autori (preset `Minimal`, nessuna ricerca n0, ponte solo nostro); fusione con `loro` 1.17 (MIT). `iroh` con il server del ponte porta 94 crate nuovi nel `Cargo.lock`, tutti con licenze già ammesse da `deny.toml` (provato, vedi «Fondamenta»). Da confermare dall'utente.
- A2 · Ponte: di serie fanno da ponte soltanto i dispositivi dell'utente raggiungibili da internet (porta aperta in automatico sul router o IPv6). In più, fra le impostazioni avanzate, si può indicare un ponte personale (indirizzo e impronta di un ponte dell'utente, per esempio un Raspberry). Nessun ponte di terzi. L'opzione «ponte personale a mano» è da confermare (domanda dell'utente: cosa cambia fra 1 e 2).
- A3 · La sincronizzazione via server `fub-sync/1` resta com'è (risposta: «tenerle entrambe»). Un vault usa un solo sistema alla volta: la nuova replica rifiuta di partire su un vault con la sync `fub-sync/1` attiva e viceversa. In più il server di `fub-services` diventa anche un trasporto della nuova replica (T20), così chi ha un server ottiene la stessa fusione senza conflitti. Da confermare.
- A4 · Modalità per vault: «Solo i miei dispositivi» (rete diretta), «Cartella condivisa» (cassetta cifrata in una cartella qualsiasi: Drive per desktop, Syncthing, chiavetta), «Server» (T20); la cartella condivisa si può aggiungere alla rete diretta come canale e copia di sicurezza in più (risposta dell'utente).
- A5 · Formati: fondono per contenuto Markdown (con la scrittura insieme), testo semplice, disegni e annotazioni dei PDF, tele `.canvas`, struttura delle cartelle, impostazioni del vault; fogli di Excel e documenti di Word passano prima da un task di progetto ciascuno (T30, T33) e poi dall'implementazione (risposta: «tutto, fogli e Word compresi»). Finché un formato non ha la sua fusione vale la regola prudente: due modifiche parallele diventano due varianti affiancate con la vista delle differenze, mai una sovrascrittura.
- A6 · Apertura delle porte (UPnP / NAT-PMP / PCP) accesa di serie su desktop e spenta su telefono e tablet, con un interruttore; il ponte sul desktop è acceso di serie quando il dispositivo risulta raggiungibile.
- A7 · Il tempo reale funziona con l'app aperta. Su telefono e tablet la replica lavora solo in primo piano.
Ondate: T1 T2 T3 | T4 T5 T6 | T7 T8 T9 | T10 T11 T12 | T13 T14 T15 | T16 T17 T18 | T19 T20 T21 | T22 T23 T24 | T25 T26 T27 | T28 T29 T30 | T31 T32 T33 | T34 T35 T36 | T37 T38
File condivisi fra task della stessa ondata: soltanto righe di elenchi (`Cargo.lock`, `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/order.ts`, `apps/client/src/theme/scrittoio/anatomia.ts`, `crates/fub-replica/src/strategie/mod.rs`, `crates/fub-host/src/replica/adattatori/mod.rs`), che l'orchestratore unisce come conflitti banali (`DECISIONS.md`); nessun altro file è di due task paralleli.
Prototipo: `PLAN-ui/differenze.html` (vista delle differenze, avviso dopo la fusione, «da rivedere»), pubblicato il 2026-11-11, **in attesa di approvazione**; `PLAN-ui/dispositivi.html` (pagina Dispositivi e abbinamento) da fare in T22 prima di T25.

## Modifiche

nessuna

## Fondamenta (ricerca e prove)

Ciò che il piano dà per verificato, e dove.

**Il codice di oggi.**
- `crates/fub-services/src/sync/` (server, ~4.300 righe) e `crates/fub-host/src/remote/` (client, ~5.500 righe, `SyncBundle`, job `sync.pass`): vettori di versione per file intero, cifratura end-to-end, copie di conflitto, limite 7 MiB, montati in `crates/fub-host/src/mount.rs` con la feature `http-client`. Resta tutto (A3). I buoni schemi da riprendere: lavoro come job fuori dal lock, scritture con CAS (`write_document_bytes` con revisione attesa), conferma solo dopo stato durevole, controllo dei vault dentro Dropbox/Syncthing (`check_external_overlap` in `crates/fub-host/src/remote/bundle.rs`).
- `crates/fub-live/` (ADR 0205): abbinamento con QR e segreto monouso, TLS con impronta, canale verso la shell non autorevole. È solo rete locale per scelta: non si allarga.
- `DocumentSession` (`apps/client/src/state/document-session.ts`, ADR 0190 e 0199) possiede il testo e diffonde `TextOperation` validate alle superfici; un cambio che arriva da fuori entra con `Transaction.remote` e senza entrare nella cronologia locale; le finestre documento separate si scambiano già operazioni con trasformazione (`apps/client/src/state/document-bridge.ts`, `transformPair`). È la cucitura per la scrittura insieme.
- Il conflitto di oggi è il banner «mine/theirs» (`shell.doc.conflict.mine|theirs`, `apps/client/src/panels/document.ts`, `.conflict-banner`). Con la replica attiva una modifica arrivata da un altro dispositivo non deve mai produrlo.
- Gli eventi portano l'attore (`fub_abi::event::Actor::Plugin { id }`): ciò che scrive la replica si riconosce.
- I disegni hanno elementi con `id` unico e uno per riga (`docs/reference/scene-format.md`), letti in Rust da `fub-scene` (puro); i fogli hanno chiavi `SheetId + RowId + ColumnId` solo dentro la sessione della griglia (`docs/architecture/grid-surface.md`); i documenti Word passano dalla proiezione v4 (`docs/reference/rich-projection.md`).
- `fub-host` non ha runtime asincrono, per scelta; la rete in ingresso vive in un crate fuori dal nucleo composto da `fub-app` (precedente: `fub-live`). L'IPC è una lista chiusa (`crates/fub-app/tests/lean_ipc.rs`) con specchi generati e host finto.
- Su mobile il vault può stare in una cartella condivisa del sistema (`mobile-storage.json`, accesso con URI dell'albero su Android e bookmark su iOS): la replica scrive soltanto attraverso le porte dell'host, mai con `std::fs` sul vault.

**Prove fatte (codice usa-e-getta fuori dal repository, poi cancellato).**
- Rete (`iroh` 1.4.1 + `iroh-relay` 1.4.1 con feature `server`, provider `ring`): (1) due endpoint con `RelayMode::Disabled` si collegano con il solo indirizzo IP, senza alcun servizio n0; (2) una chiave estranea completa l'handshake ma viene chiusa prima di leggere qualunque flusso; (3) un ponte `iroh-relay` eseguito **nello stesso processo**, in HTTP semplice, con controllo d'accesso per chiave (`AccessControl`), collega due endpoint che non conoscono i rispettivi indirizzi, e subito dopo si apre anche un percorso diretto; (4) una chiave estranea viene respinta dal ponte. Licenze del grafo tutte ammesse; 94 crate nuovi rispetto al `Cargo.lock` di oggi; eseguibile di prova 21,9 MB.
- Dal sorgente di `iroh` 1.4.1: l'«hole punching» avviene **su una connessione già aperta** (ponte o indirizzo diretto raggiungibile), quindi due dispositivi entrambi dietro NAT senza un ponte non si collegano: da qui A2 e il messaggio d'errore. `Builder::empty()` parte senza ricerca e con ponte spento; `presets::Minimal` imposta solo il provider crittografico; i nomi dei server n0 compaiono solo nei preset `N0`. L'apertura delle porte è la feature `portmapper`. Il ponte accetta TLS manuale (`CertConfig::Manual`) o nessun TLS; il client accetta radici personalizzate (`CaTlsConfig`).
- Fusione (`loro` 1.17.1): (1) due riscritture offline della stessa frase **non si intrecciano** lettera per lettera (testo fuso: «giovedì alle 10venerdì mattina», due blocchi interi: è il caso «da rivedere»); (2) l'antenato comune si ricostruisce dai vettori di versione (`fork_at(vv_to_frontiers(...))`), quindi si può dire chi ha toccato cosa; (3) un file cambiato da un editor esterno entra come differenza (`LoroText::update`) e si fonde con una modifica remota parallela; (4) la storia occupa poco e c'è l'istantanea «shallow». Ci sono anche albero con spostamenti senza cicli (`LoroTree`), mappe, liste spostabili, cursori stabili, `awareness` per la presenza, `diff` fra versioni.
- Il CSS del prototipo (`/* → skin/differenze.css */`) passa da `themeCssViolations` con il vocabolario `theme-2` senza nessuna violazione.

**Regole che il piano fissa (valgono per tutti i task).**
- R1 · L'ordine delle modifiche lo decide la causalità (vettori di versione e antenato comune), **mai l'ora** dei dispositivi. L'ora serve solo a mostrare «quando» e all'euristica di «da rivedere».
- R2 · Nessuna modifica si perde in silenzio: una cancellazione parallela a una modifica perde (il file torna, con un avviso); due creazioni con lo stesso nome restano tutte e due (o si uniscono se uguali); un file che la replica sostituisce passa prima dal versioning; ciò che si toglie va nel cestino di Fub.
- R3 · La replica scrive il vault solo attraverso le porte dell'host (CAS sulla revisione); un documento aperto in una `DocumentSession` lo scrive solo la sessione, e la replica le passa le operazioni.
- R4 · Lo stato della replica si salva (fsync) **prima** di scrivere il file nel vault; si importa dal disco solo ciò che differisce da quanto la replica stessa materializzerebbe.
- R5 · Nessuna chiamata IPC per battuta: le operazioni locali partono in lotti (al più una ogni 50 ms per documento), la presenza al più dieci volte al secondo.
- R6 · Una chiave sconosciuta non scambia dati: la rete chiude la connessione dopo l'handshake se la chiave non è fra i fidati, il ponte rifiuta chi non è membro.
- R7 · Un dispositivo non genera mai una seconda storia indipendente di un file che esiste già nella rete: unendosi a un vault adotta i documenti remoti e importa le proprie differenze sopra di loro.

## Dal prototipo

| Pezzo | Destinazione | Task |
|---|---|---|
| blocco `/* → skin/differenze.css (nuovo) */` | `apps/client/src/theme/scrittoio/skin/differenze.css` (nuovo), registrato in `apps/client/src/theme/scrittoio/skin/order.ts` | T27 (testo, barra, «da rivedere», vuoto), T28 (disegno, allegati), T34 (foglio) |
| classi nuove `diff-*` (`diff-view`, `diff-bar`, `diff-bar-title`, `diff-bar-meta`, `diff-sources`, `diff-source`, `diff-dot`, `diff-count`, `diff-count-ins`, `diff-count-del`, `diff-nav`, `diff-nav-pos`, `diff-body`, `diff-ins`, `diff-del`, `diff-block`, `diff-tag`, `diff-change-actions`, `diff-review`, `diff-review-head`, `diff-review-options`, `diff-review-option`, `diff-review-who`, `diff-review-text`, `diff-review-actions`, `diff-split`, `diff-side`, `diff-side-head`, `diff-canvas-wrap`, `diff-canvas`, `diff-paper`, `diff-stroke-*`, `diff-legend`, `diff-swatch`, `diff-grid-wrap`, `diff-grid`, `diff-cell-*`, `diff-empty`) | `apps/client/src/theme/scrittoio/anatomia/differenze.ts` (nuovo) e l'indice `apps/client/src/theme/scrittoio/anatomia.ts` | T27, T28, T34 |
| controlli già esistenti riusati (`segmented`, `segmented-option`, `link-button`, `button.primary`, `sheet-notices`, `sheet-notice[data-tone]`, `markdown-rendered`) | nessuna: esistono | — |
| struttura della barra, del corpo, della scheda «da rivedere», dell'affiancata | `apps/client/src/panels/compare/` (nuovo) e `apps/client/src/editors/text/compare.ts` (nuovo) | T27 |
| tela del disegno con prima/insieme/dopo | `apps/client/src/editors/spatial/compare.ts` (nuovo) | T28 |
| tabella delle celle | `apps/client/src/editors/grid/compare.ts` (nuovo) | T34 |
| avviso dopo la fusione | `apps/client/src/state/sheet-notices.ts` (esiste) e `apps/client/src/state/replica/notices.ts` (nuovo) | T27 |
| testi `differenze.*` (le chiavi `data-i18n` del prototipo) | `apps/client/src/i18n/catalog.ts` | T27, T28, T34 |
| stati vuoto, errore, 700 px, chiaro/scuro, fuoco su «Successiva» | `apps/client/bench/scene.mjs` | T31 |

## T1 · ADR della rete dei dispositivi e della replica

Perché: due scelte costose (rete in ingresso da internet, CRDT come modello della sincronizzazione) vanno fissate con le loro ragioni prima del codice.
Tocca: `docs/decisions/0241-la-rete-dei-dispositivi.md` (nuovo), `docs/decisions/0242-la-replica-del-vault.md` (nuovo), `docs/decisions/README.md` (le righe di 0241–0244).
Non toccare: `docs/decisions/0205-sessione-live.md` (resta valida: `fub-live` non cambia), le pagine canoniche (le aggiornano i task che cambiano il comportamento).
Dipende da: nessuno
Cosa fare:
- Numeri: controlla su `origin/main` che 0241–0246 siano liberi (oggi l'ultimo è 0240); se no, prendi i successivi liberi e aggiorna i rimandi di questo piano nel resoconto.
- Segui `docs/decisions/template.md` e `docs/development/documentation-style.md`. Stato «proposta».
- 0241, la rete: crate `fub-rete` fuori dal nucleo come `fub-live` (nessuna dipendenza da `fub-abi`, `fub-kernel`, `fub-host`, Tauri), composto da `fub-app` sul runtime di Tauri; `iroh` con `presets::Minimal`, niente ricerca né ponti n0; identità del dispositivo = chiave ed25519 (seme di 32 byte in un file segreto della configurazione macchina, posseduto da `fub-host`), elenco dei fidati nella configurazione macchina; abbinamento con QR o codice monouso (128 bit, 5 minuti, come 0205); ricerca: faro privato sulla rete locale, indirizzi ricordati, passaparola firmato fra membri, scheda degli indirizzi nella cassetta; ponte = `iroh-relay` incorporato in un dispositivo dell'utente raggiungibile, accesso solo ai membri, più il ponte personale a mano (A2); apertura delle porte (A6); R6; perché è un'eccezione motivata alla regola «solo rete locale» di 0205 e perché non si allarga `fub-live`; i casi senza collegamento (due NAT senza ponte, UDP bloccato) e il loro messaggio; le prove della sezione «Fondamenta».
- 0242, la replica: un documento Loro per file, un documento `struttura` con `LoroTree` per cartelle e nomi, uno `revisioni` per «da rivedere», uno `membri`; strategie per formato (testo, elementi, mappa, opaco; fogli e Word con ADR propri); stato in `<config>/replica/vaults/<chiave>/` (chiave = SHA-256 della radice canonica, come `sync/vaults/`); id di replica (peer) casuale per dispositivo e vault, rigenerato se lo stato risulta copiato da un altro dispositivo; R1–R4, R7; materializzazione attraverso l'host; cancellazione contro modifica; nomi in collisione; esclusioni; trasporti: rete, cartella condivisa, server (`fub-services`, nuovo prefisso `/v1/replica/`); coesistenza con `fub-sync/1` (A3); cifratura dei segmenti con la chiave del vault ed epoche.
Casi limite: un numero di ADR già preso; un'affermazione dell'ADR che il codice di oggi smentisce (vale il codice: scrivilo).
Fatto quando: i due file esistono con contesto, decisione, conseguenze positive e negative, e citano le prove; `README.md` elenca 0241–0244.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · ADR della scrittura insieme e della vista delle differenze

Perché: il ponte nuovo dell'IPC, il lotto delle operazioni, la presenza e la superficie di confronto cambiano contratti della shell.
Tocca: `docs/decisions/0243-la-scrittura-insieme.md` (nuovo), `docs/decisions/0244-la-vista-delle-differenze.md` (nuovo).
Non toccare: `docs/decisions/README.md` (lo aggiorna T1), `docs/decisions/0190-sessioni-documento-e-undo.md`, `docs/decisions/0199-history-nativa-e-gate-di-overlap.md` (restano valide: 0243 le completa).
Dipende da: nessuno
Cosa fare:
- 0243: un documento aperto in un vault replicato ha un «collegamento live» posseduto dalla sua `DocumentSession`; le operazioni locali partono in lotti (R5) con `replica_live_invia`, quelle remote arrivano dal canale `rete_osserva` (l'ottavo ponte dell'IPC, dopo i sette di oggi) e la sessione le applica come un cambio con origine remota, diffuso a tutte le superfici, fuori dalla cronologia locale (0199 resta: il cancello degli overlap vale anche qui); la sessione resta l'unica a salvare quel file (R3); se un'operazione non torna (preimmagine diversa) la sessione chiede un'istantanea e si riallinea; la presenza (cursori e selezioni) in offset UTF-8 del testo della sessione, convertita in Rust in cursori stabili di Loro; chi chiude l'ultimo riquadro chiude il collegamento; il canale non è autorevole (come 0205): ciò che conta è lo stato della replica.
- 0244: la vista delle differenze è una famiglia di superfici `compare` del registro (`DocumentSurfaceRegistry`), montata come scelta della scheda (`Tab.override`) e quindi con il ciclo di vita e lo smontaggio del riquadro; dati tipizzati da `replica_confronta`; verde = arrivato, rosso barrato = tolto, il colore del dispositivo solo come pallino; ogni azione della vista («Togli», «Rimetti», «Tieni questa», «Tienile entrambe») è una nuova modifica, mai una riscrittura della storia; tre ingressi: l'avviso dopo la fusione, «da rivedere», il confronto con una versione del versioning.
Casi limite: come T1.
Fatto quando: i due file esistono e nominano i comandi IPC, il ponte e le superfici con i nomi usati in questo piano.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T3 · `fub-replica`: il crate, lo stato su disco e l'identità della replica

Perché: tutti i task del motore si appoggiano a un crate puro con uno stato su disco solido.
Tocca: `crates/fub-replica/` (nuovo: `Cargo.toml`, `src/lib.rs`, `src/stato.rs`, `src/identita.rs`, `src/limiti.rs`, `src/errore.rs`, e i moduli vuoti con il solo commento di testa `src/strategie/mod.rs`, `src/struttura.rs`, `src/nomi.rs`, `src/protocollo.rs`, `src/revisione.rs`, `src/cifratura.rs`, `src/cassetta.rs`, `src/blob.rs`, `src/confronto.rs`), `Cargo.toml` (membro e dipendenza `loro = "=1.17.1"` nel workspace), `Cargo.lock`, `crates/fub-abi/tests/dependency_invariant.rs`, `docs/architecture/overview.md` (il nodo nel diagramma), `docs/map/repo.md`.
Non toccare: `crates/fub-host/`, `crates/fub-services/`, `crates/fub-host/src/remote/`.
Dipende da: nessuno
Cosa fare:
- Crate puro: niente `fub-kernel`, `fub-host`, Tauri, `tokio`, rete, I/O sul vault. Può dipendere da `fub-abi` solo per tipi semplici se serve (meglio di no). Aggiungi in `dependency_invariant.rs` una prova come `the_live_session_stays_outside_the_core`: `fub-replica` non raggiunge `fub-kernel`, `fub-host`, `tokio`, `tauri*`.
- `stato.rs`: `StatoVault::apri(dir)` sulla cartella `<config>/replica/vaults/<chiave>/` che riceve già calcolata. File `replica.json` (schema 1, campi sconosciuti rifiutati, al più 64 KiB): `vault_id` (128 bit casuali, base32), `peer` (`u64` come stringa decimale), `dispositivo` (chiave pubblica esadecimale ricevuta dal chiamante), `creato_ms`, `modo` (`spenta|dispositivi|cartella|dispositivi+cartella|server`). Documenti Loro in `docs/<uuid>.loro` (istantanea) più `docs/<uuid>.log` (aggiornamenti accodati, compattati in istantanea oltre 1 MiB o 500 voci). Ogni scrittura: file temporaneo, fsync, rinomina, fsync della cartella. Uno schema futuro o un file illeggibile non si riscrive mai da vuoto: errore tipizzato.
- `identita.rs`: `IdReplica` nuovo da `ring::rand`; se `replica.json` nomina un `dispositivo` diverso da quello del chiamante, lo stato è stato copiato: si genera un peer nuovo (`set_peer_id`) e si scrive, senza toccare i documenti.
- `limiti.rs`: documento al più 64 MiB materializzato (come il kernel), aggiornamento al più 16 MiB per messaggio, al più 200.000 documenti per vault.
- `errore.rs`: `ErroreReplica` con varianti tipizzate (`SchemaFuturo`, `Illeggibile`, `Limite`, `Loro`, `Io`); mai `to_string()` come errore.
- Pagine: il nodo `fub-replica` in `docs/architecture/overview.md`, la riga in `docs/map/repo.md`.
Casi limite: cartella senza permessi di scrittura; `replica.json` troncato; disco pieno a metà istantanea (resta la precedente); due processi sulla stessa cartella (lock con file `lock` e `O_EXCL`, il secondo riceve `Occupato`); stato copiato da un altro dispositivo.
Fatto quando: `cargo test -p fub-replica` copre apertura nuova, riapertura, copia rilevata (peer cambia), schema futuro rifiutato senza riscrittura, interruzione simulata fra temporaneo e rinomina; `cargo test -p fub-abi --test dependency_invariant` verde con la prova nuova.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica; cargo test -p fub-abi --test dependency_invariant
Stato: [ ] da fare

## T4 · `fub-rete`: il crate, l'endpoint e il filtro delle chiavi

Perché: serve un endpoint che parli solo con i dispositivi fidati, senza servizi di terzi.
Tocca: `crates/fub-rete/` (nuovo: `Cargo.toml`, `src/lib.rs`, `src/endpoint.rs`, `src/fidati.rs`, `src/cornice.rs`, `src/errore.rs`, `tests/collegamento.rs`, e i moduli vuoti con commento di testa `src/abbinamento.rs`, `src/ricerca.rs`, `src/ponte.rs`, `src/diagnostica.rs`), `Cargo.toml` (membro; `iroh = { version = "=1.4.1", default-features = false, features = ["tls-ring"] }`), `Cargo.lock`, `crates/fub-abi/tests/dependency_invariant.rs`, `docs/architecture/overview.md`, `docs/map/repo.md`, `docs/reference/permissions-and-security.md` (sezione nuova «Rete dei dispositivi»).
Non toccare: `crates/fub-live/`, `crates/fub-app/`, `deny.toml` (le licenze sono già ammesse; se `cargo deny` rifiuta qualcosa, fermati e riporta).
Dipende da: T3 (stessi `Cargo.toml` e `Cargo.lock`)
Cosa fare:
- Il crate non legge né scrive file: riceve il seme della chiave (`[u8; 32]`) e un `Fidati` (insieme di chiavi pubbliche, aggiornabile con un `watch`) dal chiamante.
- `endpoint.rs`: `Rete::avvia(Config) -> Rete` con `Endpoint::builder(presets::Minimal)`, `secret_key(SecretKey::from_bytes(seme))`, `relay_mode(RelayMode::Disabled)` di partenza, ALPN `fub/rete/1` e `fub/rete/abbina/1`, nessuna `address_lookup` n0. `Config` ha già i campi che riempiranno T10 e T13 (`ricerca: Vec<...>`, `ponti: Vec<...>`, `porte: bool`), oggi vuoti.
- Filtro: un hook `after_handshake` (`EndpointHooks`) chiude con codice 1 e motivo `non-membro` ogni connessione `fub/rete/1` la cui chiave non è in `Fidati`, prima di accettare flussi (R6).
- `cornice.rs`: messaggi con prefisso di lunghezza (u32 big-endian), al più 16 MiB, su flussi bidirezionali; un messaggio più lungo chiude il flusso con un errore tipizzato.
- `tests/collegamento.rs` (come la prova): due endpoint su loopback si scambiano un messaggio; una terza chiave è respinta; un messaggio oltre il limite è rifiutato.
- `dependency_invariant.rs`: `fub-rete` non raggiunge `fub-abi`, `fub-kernel`, `fub-host`, `tauri*`.
- `cargo deny check` deve restare verde (se `cargo-deny` manca, dillo nel resoconto: è un `SALTA`).
Casi limite: seme non valido; porta occupata (si sceglie un'altra porta libera); fidati vuoti (nessuna connessione accettata); arresto con connessioni aperte (chiusura entro 3 s).
Fatto quando: `cargo test -p fub-rete` verde con i tre casi; `cargo test -p fub-abi --test dependency_invariant` verde.
Prova: scripts/check.sh --rapido; cargo test -p fub-rete; cargo deny check
Stato: [ ] da fare

## T5 · `fub-replica`: strategia testo, struttura delle cartelle e nomi

Perché: la fusione del testo e dell'albero dei file è il cuore della replica.
Tocca: `crates/fub-replica/src/strategie/mod.rs`, `crates/fub-replica/src/strategie/testo.rs` (nuovo), `crates/fub-replica/src/struttura.rs`, `crates/fub-replica/src/nomi.rs`, `crates/fub-replica/tests/testo.rs` (nuovo), `crates/fub-replica/tests/struttura.rs` (nuovo).
Non toccare: `crates/fub-replica/src/lib.rs` (i moduli esistono da T3), `src/protocollo.rs`.
Dipende da: T3
Cosa fare:
- `strategie/mod.rs`: trait `Strategia { fn id(&self) -> &'static str; fn importa(&self, doc: &LoroDoc, byte: &[u8]) -> Result<Importato, ErroreReplica>; fn materializza(&self, doc: &LoroDoc) -> Result<Vec<u8>, ErroreReplica>; fn unita(&self, base: &LoroDoc, lato: &LoroDoc) -> Vec<Unita>; }` e trait `Elementi` per gli adattatori dell'host (`dividi(byte) -> Result<Diviso>`, `unisci(&Diviso) -> Vec<u8>`), con `Diviso { testa: String, elementi: Vec<(String /*id*/, String /*sorgente*/)>, coda: String }`.
- `testo.rs`: un `LoroText` `corpo` con il testo a LF; la mappa `meta` tiene `fine_riga` (`lf|crlf`) e `bom`, scelti a maggioranza dell'ultima importazione. `importa` usa `LoroText::update` (differenza, mai sostituzione); `materializza` rimette CRLF e BOM. Un file non UTF-8 non è testo: errore `NonTesto` (lo prenderà la strategia opaca).
- `struttura.rs`: un `LoroTree` `albero`; ogni nodo ha `nome`, `tipo` (`file|cartella`), `uuid` (128 bit, per i file: il documento Loro). Operazioni: crea, rinomina, sposta, cancella (cancellazione = nodo nel cestino dell'albero, contenuto conservato). `percorsi(&self) -> Vec<(Uuid, PathBuf)>` calcola i percorsi con le regole dei nomi.
- `nomi.rs`: due nomi «uguali» se uguali dopo NFC e confronto senza maiuscole (vale su tutti i sistemi, per non creare su Linux ciò che su Windows o macOS collide); in collisione resta il nome al nodo con l'id Loro minore, l'altro diventa `Nome (Dispositivo).ext` con il nome del dispositivo che lo ha creato, poi `(2)`, `(3)`; nomi non validi su Windows (`<>:"/\|?*`, `CON`, `NUL`, spazio o punto finale) si materializzano con un nome sicuro su tutti i sistemi e il nome vero resta nell'albero; cartelle con lo stesso nome create in parallelo si uniscono (i figli finiscono nella stessa cartella).
- Cancellazione contro modifica (R2): un file cancellato su A e modificato in parallelo su B torna vivo; `struttura` espone `riprese()` per l'avviso.
Casi limite: rinomina in parallelo dello stesso file con due nomi diversi (vince il nodo per regola di Loro, la scelta è la stessa ovunque; l'altro nome non si perde: va in `revisioni` con T9); spostamento che creerebbe un ciclo (Loro lo impedisce: provalo); file vuoto; file da 64 MiB; testo con soli CR; nome lungo 255 byte con suffisso di collisione (si accorcia la base, mai l'estensione).
Fatto quando: test con due e tre repliche che si scambiano aggiornamenti in ordini diversi convergono allo stesso testo e agli stessi percorsi in tutti i casi sopra; la frase riscritta da due parti dà due blocchi interi; un CRLF entra e torna CRLF.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica
Stato: [ ] da fare

## T6 · `fub-replica`: il protocollo di scambio e la simulazione

Perché: lo stesso protocollo deve funzionare su rete, cartella e server, ed essere provato senza rete.
Tocca: `crates/fub-replica/src/protocollo.rs`, `crates/fub-replica/src/sim.rs` (nuovo, solo `#[cfg(any(test, feature = "sim"))]`), `crates/fub-replica/Cargo.toml` (`postcard` con `serde`, feature `sim`), `Cargo.lock`, `crates/fub-replica/tests/simulazione.rs` (nuovo), `docs/reference/replica-protocol.md` (nuovo).
Non toccare: `src/strategie/`, `src/struttura.rs` (di T5).
Dipende da: T3
Cosa fare:
- Messaggi (enum versionato, `postcard`): `Ciao { versione: 1, dispositivo, vault: Vec<VaultId> }`, `Sommario { vault, struttura: Digest, documenti: Vec<(Uuid, Digest)> }` (digest = SHA-256 del vettore di versione canonico), `Chiedi { vault, uuid, vv }`, `Aggiornamento { vault, uuid, byte }`, `Segui { vault, uuid }`, `Lascia { vault, uuid }`, `Presenza { vault, uuid, byte }`, `BlobChiedi`, `BlobPezzo` (forme definite, usate da T17), `Membri`, `Indirizzi` (usati da T10 e T16), `Errore { codice }`.
- Macchina a stati pura `Sessione` per un vault e un pari: riceve messaggi, produce messaggi; calcola cosa chiedere confrontando i sommari; non conosce trasporti né tempo (il tempo entra come argomento).
- `sim.rs` + `tests/simulazione.rs`: N repliche con trasporto in memoria e generatore deterministico con seme (come i test del kernel: niente `proptest`); il numero di casi viene da `FUB_FUZZ_CASI` (default 200); consegne duplicate, riordinate, ritardate, perse e partizioni; alla fine tutte le repliche convergono e nessun testo inserito sparisce se non cancellato esplicitamente.
- `docs/reference/replica-protocol.md`: messaggi, limiti, versioni, cosa succede a un messaggio sconosciuto (si chiude la sessione con `Errore { codice: versione }`).
Casi limite: messaggio troncato o con versione futura; vettore con 10.000 pari; aggiornamento che Loro rifiuta (errore tipizzato, la sessione continua per gli altri documenti); sommario di un vault non condiviso (ignorato).
Fatto quando: `cargo test -p fub-replica --test simulazione` verde con 200 casi e con `FUB_FUZZ_CASI=2000`; la pagina di riferimento esiste.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica
Stato: [ ] da fare

## T7 · `fub-rete`: l'abbinamento

Perché: un dispositivo nuovo entra nella rete con un QR o un codice, in sicurezza.
Tocca: `crates/fub-rete/src/abbinamento.rs`, `crates/fub-rete/tests/abbinamento.rs` (nuovo), `docs/reference/permissions-and-security.md` (sezione «Rete dei dispositivi»).
Non toccare: `crates/fub-live/src/pairing.rs` (si imita, non si importa: `fub-rete` non dipende da `fub-live`).
Dipende da: T4
Cosa fare:
- Codice: `fub://rete/abbina?i=<id endpoint>&k=<segreto 128 bit base64url stretto>&a=<indirizzi>&p=<ponte facoltativo>&n=<nome>`, con le regole di lettura stretta di `fub-live` (parametri sconosciuti o ripetuti rifiutati, al più 1024 byte). Lo stesso testo si mostra come QR (SVG, `qrcode` già nel workspace) e come codice da copiare.
- Il segreto è monouso e vale 5 minuti; il primo abbinamento valido lo consuma, uno sbagliato no.
- Flusso su ALPN `fub/rete/abbina/1`: chi entra si collega alla chiave scritta nel codice (quindi è certo di parlare con lei), manda `HMAC-SHA256(k, id_entrante ‖ id_ospite ‖ nonce)` e il proprio nome; l'ospite verifica, mostra il nome all'utente (callback del chiamante, che può rifiutare) e risponde con l'elenco dei membri e il segreto del faro (T10). Esito: `Abbinato { dispositivo, nome }` per entrambi; chi compone (T16) aggiorna i fidati.
- Invito di una persona: stesso flusso con un campo `vault` nel codice; l'esito porta il vault a cui è invitata.
Casi limite: segreto scaduto, già usato, sbagliato; ospite spento; nome con caratteri di controllo (rifiutato); due dispositivi che usano lo stesso codice insieme (il secondo riceve «già usato»); annullamento mentre aspetta.
Fatto quando: test su loopback per riuscita, scaduto, sbagliato, riusato, rifiutato dall'utente.
Prova: scripts/check.sh --rapido; cargo test -p fub-rete
Stato: [ ] da fare

## T8 · Host: il bundle della replica

Perché: la replica deve leggere e scrivere il vault come ogni altro componente, attraverso le porte e i job dell'host.
Tocca: `crates/fub-host/src/replica/` (nuovo: `mod.rs`, `bundle.rs`, `materializza.rs`, `importa.rs`, `adozione.rs`, `esclusioni.rs`, `identita.rs`, `fidati.rs`, `maniglia.rs`, `adattatori/mod.rs`, `adattatori/testo.rs`, `comandi.rs` e `viste.rs` vuoti con commento), `crates/fub-host/src/mount.rs` (il montaggio accanto a `SyncBundle`), `crates/fub-host/src/lib.rs`, `crates/fub-host/Cargo.toml`, `Cargo.lock`, `crates/fub-host/src/remote/bundle/pass.rs` (solo la guardia di coesistenza), `docs/architecture/replica-e-rete.md` (nuovo), `docs/reference/on-disk-layout.md`.
Non toccare: il resto di `crates/fub-host/src/remote/`; `crates/fub-kernel/`; il frontend.
Dipende da: T5, T6
Cosa fare:
- Plugin di core `fub.replica`; manifest con permesso `fub:network` come `networked_manifest` di `remote`. Montato quando c'è la configurazione macchina; senza: `MissingConfiguration` esplicito.
- `identita.rs`: il seme del dispositivo in `<config>/rete/dispositivo.key` con le regole di `crates/fub-host/src/secret_file.rs` (solo proprietario, file regolare, niente collegamenti), generato al primo uso; `<config>/rete/dispositivo.json` con chiave pubblica e nome. Funzioni per `fub-app`: `seme_dispositivo()`, `id_dispositivo()`.
- `fidati.rs`: `<config>/rete/fidati.json` schema 1 (dispositivi: id, nome, tipo `mio|persona`, aggiunto_ms; appartenenze: vault → id), scritto con rinomina atomica e revisione (CAS come `mobile-storage.json`).
- `maniglia.rs`: `ManigliaReplica` per vault aperto, thread-safe, metodi brevi e senza I/O di rete: `ricevi(messaggio)` (accoda e salva, R4), `in_uscita() -> Vec<Messaggio>`, `segui/lascia`, `stato()`, `fusioni() -> Vec<Fusione>` (per ogni documento cambiato da modifiche remote: uuid, percorso, dispositivo, aggiunte, tolte, voci aperte; è ciò che diventa l'avviso «Dal Tablet sono arrivati…» in T27). `fub-app` la ottiene da `Host` (accessore nuovo). Nessun lock del workspace attraverso una chiamata.
- `importa.rs`: alla notifica di eventi documento (modificato, creato, rinominato, cestinato, con attore diverso da `fub.replica`) e alla riapertura del vault (riallineamento), legge i byte con le porte, li confronta con `materializza(stato)` e con l'ultima impronta materializzata (R4), e solo se diversi importa con la strategia; job `fub.replica:importa`.
- `materializza.rs`: job `fub.replica:applica`; per ogni documento cambiato e **non** seguito da un collegamento live (R3): attende 1,5 s dall'ultimo cambio (al più 10 s), salva lo stato, scrive con `write_document_bytes` e la revisione attesa, registra l'impronta; crea, rinomina e cestina con `VaultStructure`; su `Conflict` reimporta il disco e riprova (al più 3 volte), mai sovrascrive.
- `adozione.rs` (R7): con un vault che ha già file e una rete che ha già il vault, prima scarica struttura e documenti remoti, poi per ogni percorso: byte uguali → collega; diversi → importa come differenza sopra il remoto; solo locale → crea; solo remoto → materializza. Finché il primo allineamento non è finito, la replica non pubblica le proprie modifiche.
- `esclusioni.rs`: di serie fuori `.fub/` tranne `settings.json` e `workspace.json` (che però aspettano T15), `.trash/`, file di sistema (`.DS_Store`, `Thumbs.db`, `desktop.ini`), file temporanei e di blocco (`*.tmp`, `*.swp`, `~$*`, `.~lock.*#`), copie di conflitto di altri programmi (`*.sync-conflict-*`); più l'elenco dell'impostazione `replica.escludi` (T11).
- `adattatori/mod.rs`: tabella formato → strategia; oggi `md`, `txt` e testo noto → `testo`; tutto il resto resta escluso finché T14, T15, T17 non lo coprono (mai trattato come testo).
- Coesistenza (A3): `run_pass_on` di `remote/bundle/pass.rs` rifiuta con `Conflict("replica attiva")` se `<config>/replica/vaults/<chiave>/replica.json` ha un `modo` diverso da `spenta`; la replica rifiuta di partire se lo stato `sync/vaults/<chiave>/` è legato a un endpoint e la sync non è in pausa.
- Pagine: `docs/architecture/replica-e-rete.md` (motore, porte, job, regole R1–R4 e R7), `on-disk-layout.md` (righe `replica/vaults/<chiave>/`, `rete/dispositivo.key`, `rete/dispositivo.json`, `rete/fidati.json`).
Casi limite: file cambiato da un editor esterno mentre la replica sta per scriverlo; crash fra salvataggio dello stato e scrittura del file, e fra scrittura e registrazione dell'impronta (riapertura senza duplicazioni: prova con fake host); vault su cartella condivisa del telefono (solo porte); file oltre 64 MiB (non replicato, segnalato in `stato()`); vault dentro una cartella di Drive per desktop o Syncthing con la modalità «dispositivi» (avviso forte: due sincronizzazioni sullo stesso vault; la cartella condivisa di T18 invece va bene perché vive altrove).
Fatto quando: test in `crates/fub-host` con due `Host` su vault temporanei collegati da un trasporto in memoria: una modifica su uno compare sull'altro; il caso tablet (B scollegato modifica una riga, A modifica un'altra riga, poi si ricollegano) dà entrambe le righe su tutti e due; adozione senza testo doppio; crash simulati senza duplicazioni; la sync `fub-sync/1` rifiuta con la replica attiva.
Prova: scripts/check.sh --rapido; cargo test -p fub-host replica
Stato: [ ] da fare

## T9 · `fub-replica`: «da rivedere»

Perché: quando due persone hanno riscritto la stessa cosa lontane l'una dall'altra, il testo è già fuso ma serve uno sguardo; Fub lo segnala senza bloccare.
Tocca: `crates/fub-replica/src/revisione.rs`, `crates/fub-replica/tests/revisione.rs` (nuovo).
Non toccare: `src/strategie/` (usa solo `Strategia::unita`), `src/protocollo.rs`.
Dipende da: T5
Cosa fare:
- Dopo ogni importazione di aggiornamenti remoti: antenato comune = minimo per pari dei due vettori (prova della sezione «Fondamenta»), `base = fork_at(...)`, lato locale = stato prima dell'importazione, lato remoto = `fork_at(vettore remoto)`. Le unità (`Strategia::unita`: righe per il testo, id per gli elementi, chiavi per le mappe, il file intero per l'opaco) cambiate in tutti e due i lati con esiti diversi sono candidate.
- Sono «da rivedere» solo se scritte lontane: le modifiche remote hanno l'ora registrata (`set_record_timestamp(true)`) più vecchia di 60 s rispetto all'arrivo, oppure i due dispositivi non erano collegati in quel momento. Un orologio sbagliato può produrre una voce in più, mai una perdita (R1).
- Le voci vivono nel documento replicato `revisioni` (così risolverne una su un dispositivo la chiude su tutti): id, uuid del documento, unità ancorata con cursori stabili, frontiere di base, locale e remota, dispositivi, stato (`aperta|risolta`).
- Risoluzioni come nuove modifiche: `TieniLocale`, `TieniRemoto` (riporta l'unità al testo di quel lato con `update` sul solo intervallo), `Entrambe` (le due versioni su due righe), `Dopo` (resta aperta).
Casi limite: unità cancellata da un lato e cambiata dall'altro (voce con la versione cambiata già rimessa, R2); dieci voci sullo stesso documento; voce il cui documento è stato cancellato poi ripreso; tre dispositivi che riscrivono la stessa riga.
Fatto quando: test con il caso della frase («giovedì alle 10» / «venerdì mattina»): una voce aperta, e ogni risoluzione dà il testo atteso su tutte le repliche; modifiche in tempo reale (ora vicina all'arrivo) non producono voci.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica
Stato: [ ] da fare

## T10 · `fub-rete`: trovare gli altri dispositivi e aprire le porte

Perché: i dispositivi devono trovarsi da soli in casa e fuori, senza servizi di terzi.
Tocca: `crates/fub-rete/src/ricerca.rs`, `crates/fub-rete/src/endpoint.rs`, `crates/fub-rete/Cargo.toml` (feature `portmapper` di `iroh`), `Cargo.lock`, `crates/fub-rete/tests/ricerca.rs` (nuovo).
Non toccare: `src/abbinamento.rs`, `src/ponte.rs`.
Dipende da: T7
Cosa fare:
- Faro privato sulla rete locale: datagramma UDP multicast (gruppo e porta fissati nel codice, solo interfacce con indirizzi privati) ogni 5 s con `HMAC(segreto del faro, id del dispositivo ‖ finestra di 60 s)` troncato a 16 byte e la porta: solo i membri lo riconoscono, un estraneo vede numeri che cambiano. Implementa il trait di ricerca di `iroh` (`AddressLookup`) che restituisce gli indirizzi trovati.
- Indirizzi ricordati e passaparola: una «scheda» per dispositivo (indirizzi, ponte, ora) firmata con la sua chiave; i membri collegati si passano le schede che hanno; vale la più recente per firma valida; il chiamante (T16) le salva e le ripassa all'avvio.
- Apertura delle porte (A6): `portmapper` acceso o spento da `Config::porte`.
- Nessun mDNS pubblico, nessun DNS n0, nessun pkarr.
Casi limite: più interfacce di rete; rete senza multicast (si va avanti con gli indirizzi ricordati); scheda con firma falsa o ora futura di un anno (rifiutata, R1 non serve: qui conta la firma, l'ora solo fra schede dello stesso dispositivo); router senza UPnP.
Fatto quando: test su loopback: due endpoint si trovano con il faro senza conoscere gli indirizzi; un faro con segreto diverso è ignorato; una scheda contraffatta è rifiutata.
Prova: scripts/check.sh --rapido; cargo test -p fub-rete
Stato: [ ] da fare

## T11 · Host: impostazioni, comandi e viste della replica

Perché: chi usa Fub deve poter accendere, mettere in pausa e capire lo stato della replica con le porte generiche.
Tocca: `crates/fub-host/src/settings.rs` (chiavi e testi del catalogo di core), `crates/fub-host/src/replica/comandi.rs`, `crates/fub-host/src/replica/viste.rs`, `crates/fub-host/src/replica/bundle.rs` (solo la registrazione di comandi e viste).
Non toccare: le chiavi `sync.*` esistenti; `crates/fub-app/`.
Dipende da: T8
Cosa fare:
- Impostazioni di macchina, gruppo «Sincronizzazione» (`C_GROUP_SYNC` esiste): `rete.nome_dispositivo` (testo; vuoto = nome del sistema), `rete.porte` (interruttore; acceso su desktop, spento su mobile), `rete.ponte` («Questo dispositivo fa da ponte», acceso su desktop), `rete.ponte_personale` (testo `url#impronta`, vuoto di serie; A2), `replica.allegati_max_mb` (intero, 256), `replica.escludi` (elenco). Nessuna è `program_writable`.
- Comandi (`list_commands`/`invoke_command`): `replica.attiva { modo }`, `replica.disattiva`, `replica.pausa`, `replica.riprendi`, `replica.rivedi.risolvi { voce, scelta }`. Il modo vive in `replica.json`, non nelle impostazioni (ogni dispositivo sceglie il suo; le impostazioni del vault invece si replicano).
- Viste (`list_views`/`render_view`): `replica.stato` (modo, ultimo allineamento, documenti in attesa, esclusi per dimensione, errori) e `replica.da_rivedere` (elenco delle voci aperte con «Rivedi» che apre il confronto: azione `replica.rivedi.apri { voce }` gestita dalla shell in T27).
- Testi italiani nel catalogo di core.
Casi limite: comando su vault senza configurazione macchina; `attiva` con la sync `fub-sync/1` attiva (errore tipizzato con la spiegazione); risoluzione di una voce già risolta altrove (`NotFound` gentile).
Fatto quando: test del bundle per ogni comando e per le due viste; i testi passano dal test del catalogo.
Prova: scripts/check.sh --rapido; cargo test -p fub-host replica
Stato: [ ] da fare

## T12 · `fub-replica`: cifratura e formato della cassetta

Perché: la cartella condivisa e il server vedono solo dati cifrati con la chiave del vault.
Tocca: `crates/fub-replica/src/cifratura.rs`, `crates/fub-replica/src/cassetta.rs`, `crates/fub-replica/Cargo.toml` (`ring`, già nel workspace), `Cargo.lock`, `crates/fub-replica/tests/cassetta.rs` (nuovo), `docs/reference/replica-protocol.md` (sezione cassetta).
Non toccare: `src/protocollo.rs` (si riusano i suoi messaggi dentro i segmenti).
Dipende da: T6
Cosa fare:
- Chiave del vault: 32 byte casuali con epoca (`u32`); passata fra membri solo sulla rete autenticata (T16) o avvolta con passphrase per il server (riusa lo schema PBKDF2 di `crates/fub-host/src/remote/mod.rs` come specifica, senza dipendere da lui). Nuova epoca quando un membro viene tolto.
- Segmento: `FUBR` + versione + epoca + nonce 12 byte + testo cifrato ChaCha20-Poly1305 (`ring::aead`) con AAD `fub-replica/1|vault|dispositivo|seq`; dentro, una sequenza di messaggi `Aggiornamento`/`Indirizzi`/`Membri`.
- Disposizione: `<cartella>/fub-replica/<vault_id>/<dispositivo>/<seq>.seg` (ogni dispositivo scrive **solo** la sua sottocartella, quindi chi sincronizza la cartella non trova mai lo stesso file cambiato da due parti), `.../<dispositivo>/letti.json` (fin dove ha letto gli altri, in chiaro: solo numeri), `.../<dispositivo>/istantanea-<n>.seg` (copia completa per backup e ripristino).
- Funzioni pure: `cifra_segmento`, `decifra_segmento`, `segmenti_da_leggere(letti, elenco)`, `segmenti_da_togliere(letti di tutti)` (si toglie solo ciò che tutti hanno letto, tenendo l'ultima istantanea).
Casi limite: segmento manomesso (rifiutato, gli altri vanno avanti); epoca vecchia dopo una rotazione; numerazione con buchi (un file non ancora arrivato dalla sincronizzazione della cartella: si aspetta, non si salta); due file con lo stesso `seq` (impossibile per costruzione: errore).
Fatto quando: test di andata e ritorno, manomissione, epoca, buchi e pulizia.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica
Stato: [ ] da fare

## T13 · `fub-rete`: il ponte e la diagnostica

Perché: due dispositivi dietro NAT si collegano solo attraverso un ponte; quando non si può, Fub deve dire perché.
Tocca: `crates/fub-rete/src/ponte.rs`, `crates/fub-rete/src/diagnostica.rs`, `crates/fub-rete/src/endpoint.rs`, `crates/fub-rete/Cargo.toml` (`iroh-relay = { version = "=1.4.1", default-features = false, features = ["server", "tls-ring"] }`), `Cargo.lock`, `crates/fub-rete/tests/ponte.rs` (nuovo), `docs/reference/permissions-and-security.md`.
Non toccare: `src/ricerca.rs`, `src/abbinamento.rs`.
Dipende da: T10
Cosa fare:
- Ponte incorporato: `iroh_relay::server::Server` con `RelayConfig::new(addr)` in HTTP (il traffico fra endpoint è già cifrato end-to-end), `access` = solo membri (`AccessControl` che legge `Fidati`), porta aperta con l'apertura delle porte quando `Config::porte`. Si avvia solo se `Config::ponte` e il dispositivo risulta raggiungibile; l'indirizzo del ponte entra nella scheda del dispositivo (T10).
- «Raggiungibile» vuol dire: l'apertura della porta sul router è riuscita e ha dato un indirizzo pubblico, oppure il dispositivo ha un indirizzo IPv6 globale, oppure un membro fuori dalla sua rete locale lo ha raggiunto direttamente; finché nessuna delle tre è vera il ponte non si annuncia.
- Endpoint: `RelayMode::Custom` con i ponti noti (dei membri e quello personale, A2), altrimenti `Disabled`.
- Ponte personale: `url#impronta`; se c'è l'impronta, TLS con radice fissata a quel certificato (`CaTlsConfig`), altrimenti solo HTTP.
- `diagnostica.rs`: per ogni membro, `Percorso` = `Diretto` | `Ponte { attraverso }` | `NonRaggiungibile { motivo }` con `motivo` tipizzato: `NessunPonte`, `UdpBloccato`, `Spento { visto_ms }`, `ChiaveRifiutata`, `VersioneDiversa`. È ciò che la shell traduce nei messaggi («Questa rete potrebbe bloccare le connessioni dirette: prova con un'altra rete o con i dati mobili. Le modifiche restano salvate e partono appena possibile.»).
Casi limite: ponte già in uso sulla porta; due ponti fra i membri (si usano entrambi, sceglie `iroh`); ponte personale irraggiungibile (diagnosi, nessun blocco); estraneo che prova il ponte (respinto, provato).
Fatto quando: test su loopback come la prova (collegamento solo via ponte, estraneo respinto) più la diagnosi `NessunPonte` con due endpoint senza indirizzi utili.
Prova: scripts/check.sh --rapido; cargo test -p fub-rete; cargo deny check
Stato: [ ] da fare

## T14 · Host: adattatori di disegni, annotazioni e tele

Perché: disegni e tele devono fondere elemento per elemento, così un tratto fatto sul tablet si aggiunge e non sostituisce.
Tocca: `crates/fub-replica/src/strategie/elementi.rs` (nuovo), `crates/fub-host/src/replica/adattatori/scena.rs` (nuovo), `crates/fub-host/src/replica/adattatori/canvas.rs` (nuovo), `crates/fub-host/src/replica/adattatori/mod.rs` (righe della tabella), test accanto.
Non toccare: `crates/fub-scene/` (si usa `fub_scene::read`, non si cambia), `crates/fub-format-canvas/` (si usa il suo modello).
Dipende da: T8
Cosa fare:
- `elementi.rs`: `LoroMovableList` `ordine` degli id, `LoroMap` `sorgenti` id → testo dell'elemento (ultimo scrittore secondo Loro, quindi deterministico ovunque), `testa` e `coda` come mappe. `importa` usa `Elementi::dividi` e calcola inserimenti, tolti, spostati e cambiati per id; `materializza` usa `Elementi::unisci` e poi rilegge il risultato: se non si legge, non scrive e segnala (mai un file rotto).
- `scena.rs`: `dividi` con `fub_scene::read` (voci con id e span; i byte fra le voci restano attaccati alla voce che li precede; i blocchi estranei sono elementi con id sintetico stabile = impronta del loro contenuto); `unisci` concatena. Vale per gli SVG dei disegni e per `.fubann`.
- `canvas.rs`: nodi e archi per `id`, i campi sconosciuti conservati; la scrittura nella forma che scrive `fub-format-canvas`.
- Cambiamento in parallelo dello stesso elemento: vince uno per regola di Loro, l'altro va in `revisioni` (T9) con l'unità = id.
Casi limite: disegno senza id su un elemento (id sintetico); elemento tolto da un lato e cambiato dall'altro (torna, R2); due tratti aggiunti nello stesso punto (tutti e due, ordine deterministico); SVG non di Fub (tutto un blocco estraneo: diventa opaco con T17).
Fatto quando: test con tre repliche: tratti aggiunti in parallelo ci sono tutti; il file risultante passa da `fub_scene::read` senza diagnostica nuova; il caso tablet sul disegno (tratto offline + tratti sul PC) dà tutti i tratti.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica; cargo test -p fub-host replica
Stato: [ ] da fare

## T15 · Frontmatter come mappa e impostazioni del vault

Perché: due valori diversi della stessa proprietà, fusi lettera per lettera, darebbero un valore senza senso (`stato: fattarevisione`).
Tocca: `crates/fub-replica/src/strategie/frontmatter.rs` (nuovo), `crates/fub-replica/src/strategie/mappa.rs` (nuovo), `crates/fub-host/src/replica/adattatori/markdown.rs` (nuovo), `crates/fub-host/src/replica/adattatori/impostazioni.rs` (nuovo), `crates/fub-host/src/replica/adattatori/mod.rs` (righe), `crates/fub-host/src/replica/esclusioni.rs` (togliere l'attesa su `settings.json` e `workspace.json`).
Non toccare: `crates/fub-format-markdown/` (non si chiama il provider: si divide il frontmatter con un lessico minimo).
Dipende da: T8
Cosa fare:
- Markdown: se il file comincia con `---\n` e c'è la chiusura, il frontmatter si divide in chiavi di primo livello (righe `chiave:` a colonna 0, con le righe rientrate che seguono); ogni chiave è un valore in una `LoroMap`, l'ordine in una `LoroMovableList`; il corpo resta `testo`. Se il blocco non si divide così (ancora, alias YAML, chiavi duplicate), tutto il file resta `testo`.
- `mappa.rs`: JSON a oggetti, chiave per chiave, ricorsivo sugli oggetti, gli array come valori interi.
- `.fub/settings.json` e `.fub/workspace.json` con `mappa`: le chiavi di livello macchina non sono lì (stanno nella configurazione macchina) e quindi non viaggiano.
- Stessa chiave cambiata in parallelo: un valore vince, l'altro in `revisioni`.
Casi limite: frontmatter vuoto; chiave tolta da un lato e cambiata dall'altro; JSON non valido scritto a mano (resta opaco, segnalato); ordine delle chiavi diverso fra due dispositivi.
Fatto quando: test della proprietà cambiata da due parti (una voce, nessun valore mescolato) e del corpo che fonde normalmente.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica; cargo test -p fub-host replica
Stato: [ ] da fare

## T16 · `fub-app`: il servizio della rete

Perché: è qui che rete e host si incontrano, sul runtime di Tauri, come per la sessione live.
Tocca: `crates/fub-app/src/rete.rs` (nuovo), `crates/fub-app/src/lib.rs` (solo avvio, `manage` e arresto, nessun comando IPC), `crates/fub-app/Cargo.toml`, `Cargo.lock`, `crates/fub-app/tests/rete.rs` (nuovo), `crates/fub-host/src/replica/maniglia.rs` (accessori che servono, senza cambiare le regole), `crates/fub-host/src/replica/fidati.rs` (anche `schede.json`), `docs/architecture/replica-e-rete.md`, `docs/architecture/overview.md`.
Non toccare: `crates/fub-app/src/live.rs`; la lista IPC (è T19).
Dipende da: T8, T12, T13
Cosa fare:
- Avvio quando almeno un vault aperto ha un modo con «dispositivi»; arresto all'uscita entro 3 s; riavvio quando cambiano `rete.*`.
- Collega `fub-rete` (seme e fidati da `fub-host`) con le `ManigliaReplica` dei vault aperti: per ogni membro collegato apre una `Sessione` del protocollo per ogni vault in comune, pompa messaggi in entrambe le direzioni, rispetta i limiti.
- Appartenenze: un dispositivo `mio` è membro di tutti i vault in modo «dispositivi»; una `persona` solo di quelli a cui è invitata. La chiave del vault (T12) passa solo a chi è membro, sulla rete.
- Esiti dell'abbinamento (T7) → `fidati.json` (via `fub-host`); togliere un dispositivo → nuova epoca della chiave dei vault in comune e messaggio `Membri` agli altri.
- Schede degli indirizzi: salvate in `<config>/rete/schede.json` (scritto da `fub-host`, `fidati.rs`) e ripassate all'avvio.
- Il servizio si costruisce e si prova senza Tauri, con un runtime `tokio` (come i test di `fub_live::host`); `lib.rs` lo mette soltanto sul runtime dell'app.
- Pagine: la parte rete in `replica-e-rete.md`, il nodo nel diagramma.
Casi limite: vault chiuso mentre arrivano aggiornamenti (si accodano nello stato e si applicano alla riapertura); due finestre sullo stesso vault; un membro con versione del protocollo diversa (diagnosi `VersioneDiversa`); dispositivo tolto mentre è collegato (connessione chiusa subito).
Fatto quando: test di integrazione in `crates/fub-app/tests/` (nuovo `rete.rs`) con due istanze del servizio su loopback e vault temporanei: modifica propagata, dispositivo tolto non riceve più nulla.
Prova: scripts/check.sh --rapido; cargo test -p fub-app --test rete
Stato: [ ] da fare

## T17 · Allegati e file senza fusione

Perché: immagini, PDF e gli altri file devono viaggiare interi, senza mai sovrascrivere una variante parallela.
Tocca: `crates/fub-replica/src/blob.rs`, `crates/fub-replica/src/strategie/opaco.rs` (nuovo), `crates/fub-host/src/replica/blob.rs` (nuovo), `crates/fub-host/src/replica/adattatori/mod.rs` (righe: ciò che non ha un adattatore diventa opaco), test.
Non toccare: `src/protocollo.rs` (i messaggi `BlobChiedi`/`BlobPezzo` esistono da T6).
Dipende da: T6, T8
Cosa fare:
- Contenuto indirizzato per SHA-256 in `<stato>/blob/<prefisso>/<impronta>`; il documento Loro tiene una `LoroMap` `testa` con impronta, dimensione e tipo, più `varianti` per le teste parallele.
- Trasferimento a pezzi da 256 KiB con ripresa; oltre `replica.allegati_max_mb` il file compare nell'albero ma si scarica solo su richiesta (stato «solo sul dispositivo X»).
- Due teste parallele: la vincente resta al suo nome, l'altra si materializza accanto come `Nome (Dispositivo).ext` e apre una voce in `revisioni` (R2).
- Documenti Word e fogli di Excel usano questa strategia finché T32 e T35 non li coprono.
Casi limite: file da 2 GB; trasferimento interrotto; impronta che non torna (scartato, richiesto di nuovo); spazio su disco finito (errore, nulla di parziale nel vault).
Fatto quando: test della variante parallela (due file, una voce) e della ripresa di un trasferimento interrotto.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica; cargo test -p fub-host replica
Stato: [ ] da fare

## T18 · La cartella condivisa

Perché: quando i dispositivi non sono mai accesi insieme, le modifiche aspettano cifrate in una cartella qualsiasi; la stessa cartella fa da copia di sicurezza.
Tocca: `crates/fub-host/src/replica/cassetta.rs` (nuovo), `crates/fub-host/src/replica/comandi.rs` (`replica.attiva` accetta `{ modo: "cartella" | "dispositivi+cartella", cartella }` e `replica.ripristina { cartella }`), test, `docs/architecture/replica-e-rete.md`, `docs/reference/on-disk-layout.md`.
Non toccare: `crates/fub-replica/src/cassetta.rs` (formato di T12).
Dipende da: T8, T12
Cosa fare:
- Job `fub.replica:cassetta` ogni 30 s e a ogni cambio: scrive i propri segmenti nuovi, legge quelli degli altri da `letti`, aggiorna `letti.json`, toglie i propri segmenti già letti da tutti; un'istantanea al giorno.
- La cartella si sceglie con la finestra di sistema della shell (T25) e si salva nello stato della replica; si accede con `std::fs` perché è fuori dal vault e la sceglie l'utente.
- La cartella non può stare dentro il vault (rifiuto); dentro una cartella di Drive per desktop, OneDrive, Dropbox o Syncthing va benissimo (è il caso d'uso).
- `replica.ripristina`: da un dispositivo nuovo, con la chiave del vault (passphrase o abbinamento), ricostruisce il vault da istantanea e segmenti in una cartella vuota.
Casi limite: cartella che sparisce (chiavetta tolta: errore in `replica.stato`, nessun danno); segmenti arrivati a metà dalla sincronizzazione di Drive (si aspetta); due dispositivi con lo stesso id (impossibile: T3); cartella piena.
Fatto quando: test con due host che si parlano **solo** attraverso una cartella temporanea: la modifica arriva; il ripristino in una cartella vuota ridà lo stesso vault.
Prova: scripts/check.sh --rapido; cargo test -p fub-host replica
Stato: [ ] da fare

## T19 · IPC della rete e della scrittura insieme

Perché: la shell deve abbinare dispositivi, vedere lo stato e scambiare le operazioni live.
Tocca: `crates/fub-app/src/lib.rs` (comandi), `crates/fub-app/src/rete.rs` (le funzioni che i comandi chiamano), `crates/fub-app/tests/lean_ipc.rs`, `crates/fub-app/tests/ts_mirror_app.rs` e la sua fixture, `crates/fub-app/permissions/default.toml`, `apps/client/src/host/contract.ts`, `apps/client/src/host/ipc.ts`, `apps/client/src/host/fake.ts`, `apps/client/src/host/fake-rete.test.ts` (nuovo), `docs/reference/ipc-contract.md`.
Non toccare: `apps/client/src/state/`; i comandi `live_*`.
Dipende da: T16
Cosa fare:
- Comandi (con `Why::AppSurface` in `lean_ipc.rs`): `rete_stato`, `rete_abbina_inizia`, `rete_abbina_unisciti { codice }`, `rete_abbina_annulla`, `rete_dispositivi`, `rete_dispositivo_dimentica { id }`, `rete_invita { vault }`, `replica_live_apri { vault, doc }` (→ testo e versione), `replica_live_invia { vault, doc, lotto }`, `replica_live_presenza { vault, doc, selezioni }`, `replica_live_chiudi { vault, doc }`, `rete_osserva` con un `tauri::ipc::Channel` (l'ottavo ponte, ADR 0243): stato della rete, operazioni remote per documento, presenza, voci nuove, fusioni avvenute.
- Tipi in specchio generato; `u64` come stringhe; errori come chiavi del catalogo; host finto completo (due «dispositivi» finti che si scambiano operazioni, per il banco).
Casi limite: `invia` su un documento non aperto (errore tipizzato); canale chiuso dalla finestra (il servizio smette di inviarle); lotto oltre 1 MiB (rifiutato); vault non replicato.
Fatto quando: `cargo test -p fub-app --test lean_ipc` e `--test ts_mirror_app` verdi; `npx vitest run src/host/fake-rete.test.ts` verde; `npm run typecheck` verde.
Prova: scripts/check.sh --rapido; UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app (solo per rigenerare, poi senza)
Stato: [ ] da fare

## T20 · Il server come trasporto della replica

Perché: chi ha già un server `fub-services` deve poterlo usare con la fusione nuova, senza perdere `fub-sync/1`.
Tocca: `crates/fub-services/src/replica/` (nuovo), `crates/fub-services/src/lib.rs`, `crates/fub-services/src/main/routes.rs`, `crates/fub-services/tests/replica.rs` (nuovo), `crates/fub-host/src/replica/server.rs` (nuovo), `crates/fub-host/src/replica/comandi.rs` (`modo: "server"`), `docs/architecture/replica-e-rete.md`.
Non toccare: `crates/fub-services/src/sync/` e le sue rotte (`fub-sync/1` resta identico, A3); `crates/fub-host/src/remote/`.
Dipende da: T12, T8
Cosa fare:
- Rotte `/v1/replica/<vault>/segmenti` (PUT di un segmento del proprio dispositivo, GET dell'elenco da un cursore, GET di un segmento), con l'autenticazione, le ACL e le quote esistenti (`auth`, `acl`, `schema`); il server conserva i segmenti cifrati come la cartella condivisa, senza mai la chiave.
- Client: job `fub.replica:server` con `HostNetwork::fetch` (sincrono, come `remote`), stesso ciclo della cartella (T18), endpoint `replica.server_url` (impostazione di macchina nuova in `settings.rs`, gruppo «Sincronizzazione»).
- Versione del protocollo annunciata in `GET /v1/hello` accanto a `fub-sync/1`.
Casi limite: server vecchio senza le rotte (errore chiaro «il server non conosce la replica»); quota piena; token scaduto.
Fatto quando: test del servizio e test dell'host contro il servizio su loopback, con due host che si allineano solo attraverso il server; i test di `fub-sync/1` restano verdi senza modifiche.
Prova: scripts/check.sh --rapido; cargo test -p fub-services; cargo test -p fub-host replica
Stato: [ ] da fare

## T21 · Telefono e tablet

Perché: il tablet è il caso di partenza; la rete deve funzionare su Android e iPad con i permessi del sistema.
Tocca: `crates/fub-app/mobile/AndroidManifest.snippet.xml`, `crates/fub-app/mobile/Info.plist.snippet.plist`, `crates/fub-app/mobile/FubTreePlugin.kt` o un plugin nativo nuovo accanto per il blocco multicast, `crates/fub-app/src/mobile.rs`, `docs/architecture/phone-frame.md` o la pagina mobile che descrive i permessi.
Non toccare: `.github/workflows/mobile.yml` (lo tocca l'orchestratore se serve); `crates/fub-app/src/rete.rs` (in questa ondata è di T19: i valori di serie di porte e ponte su mobile li dà già T11 nelle impostazioni, con `cfg(target_os)`).
Dipende da: T16
Cosa fare:
- Android: `CHANGE_WIFI_MULTICAST_STATE` e il blocco multicast mentre la replica è attiva in primo piano; rete solo in primo piano (A7).
- iOS: `NSLocalNetworkUsageDescription` con testo italiano e il servizio del faro; nessun lavoro in background.
- Apertura delle porte e ponte spenti di serie (A6).
- Verifica che `iroh` e `loro` compilino per `aarch64-linux-android` e `aarch64-apple-ios` (il CI Mobile costruisce l'APK e compila iOS).
Casi limite: permesso della rete locale negato su iOS (diagnosi chiara, la rete via ponte funziona lo stesso); app in background durante un trasferimento (riprende al ritorno).
Fatto quando: il job Mobile della CI è verde con i crate nuovi; il resoconto dice cosa non si è potuto provare su un dispositivo vero (resta all'utente).
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T22 · Prototipo della pagina Dispositivi (pianificatore)

Perché: è grafica nuova; per la regola dei prototipi va approvata prima del codice.
Tocca: `PLAN-ui/dispositivi.html` (nuovo), questo `PLAN.md` (tabella «Dal prototipo» e T25).
Non toccare: il codice del prodotto.
Dipende da: nessuno (lo fa il pianificatore quando l'utente approva il piano)
Cosa fare:
- Stati: nessun dispositivo; abbinamento con QR e codice e conto alla rovescia; «Tablet vuole unirsi: è lui?»; elenco con percorso (diretto, via ponte, non raggiungibile con il motivo di T13); vault replicati con il modo e «Invita una persona»; scelta della cartella condivisa; errore; chiaro e scuro; 700 px.
- Costruito dai token e dalle classi di `skin/settings.css`, `skin/controls.css`, come `PLAN-ui/differenze.html`; CSS passato da `themeCssViolations`.
Casi limite: nome di dispositivo lunghissimo; 30 dispositivi; abbinamento scaduto.
Fatto quando: l'utente l'ha approvato e la data è nell'intestazione.
Prova: nessuna (non è codice del prodotto)
Stato: [ ] da fare

## T23 · La scrittura insieme nella sessione

Perché: due persone scrivono nello stesso documento e vedono subito il testo dell'altra, senza conflitti.
Tocca: `apps/client/src/state/replica/live-link.ts` (nuovo), `apps/client/src/state/replica/live-link.test.ts` (nuovo), `apps/client/src/state/document-session.ts` (metodo `applyRemote` e aggancio del collegamento), `apps/client/src/state/document-controller.ts` (apre il collegamento all'apertura di un documento di un vault replicato, lo chiude con l'ultimo riquadro).
Non toccare: `apps/client/src/editors/text/engine.ts` (il percorso `syncDoc` remoto esiste già), `apps/client/src/state/document-bridge.ts`.
Dipende da: T19
Cosa fare:
- `LiveLink` posseduto dalla `DocumentSession` (teardown con il suo disposer, ADR 0193): all'apertura chiede `replica_live_apri`; se il testo ricevuto differisce dal buffer pulito, il buffer prende quello della replica (è la versione fusa); se il buffer è sporco, manda prima le proprie operazioni.
- Operazioni locali: ogni `TextOperation` accettata dalla sessione entra in un lotto che parte al più ogni 50 ms (R5) con `replica_live_invia`, in ordine, con numero di sequenza.
- Operazioni remote (dal canale di `rete_osserva`): `session.applyRemote(op)` le valida come un'operazione di superficie e le diffonde a **tutte** le superfici come cambio remoto (fuori dalla cronologia locale); se non tornano, chiede di nuovo il testo (`replica_live_apri`) e riallinea, come una sostituzione autorevole.
- Il documento resta sporco e la sessione salva come sempre (R3): la replica non scrive quel file.
- Con la replica attiva, un cambio sul disco con attore `fub.replica` non apre mai il banner del conflitto.
Casi limite: rete che cade a metà lotto (il lotto resta e riparte); finestra separata del documento (passa dal ponte delle finestre di oggi); sola lettura; cancellazione in attesa di conferma; documento rinominato da un altro dispositivo mentre è aperto; operazione remota che cade dentro la composizione IME in corso.
Fatto quando: test Vitest con l'host finto a due dispositivi: battute alternate convergono; un'operazione remota non entra nell'undo locale; nessun banner del conflitto; il lotto non supera una chiamata ogni 50 ms.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/state/replica/live-link.test.ts && npm run typecheck
Stato: [ ] da fare

## T24 · I dati del confronto

Perché: la vista delle differenze deve ricevere dati già pronti, uguali per desktop e mobile.
Tocca: `crates/fub-replica/src/confronto.rs`, `crates/fub-replica/tests/confronto.rs` (nuovo), `crates/fub-host/src/replica/comandi.rs` (comando `replica.modifica.annulla`), `crates/fub-app/src/lib.rs` (comando `replica_confronta`), `crates/fub-app/src/rete.rs`, `crates/fub-app/tests/lean_ipc.rs`, `crates/fub-app/tests/ts_mirror_app.rs` e la fixture, `crates/fub-app/permissions/default.toml`, `apps/client/src/host/contract.ts`, `apps/client/src/host/ipc.ts`, `apps/client/src/host/fake.ts`, `docs/reference/ipc-contract.md`.
Non toccare: `apps/client/src/state/`, `apps/client/src/editors/`.
Dipende da: T9, T19
Cosa fare:
- `replica_confronta { vault, doc, da, a }` con `Versione` = `attuale` | `frontiere { … }` | `revisione { voce, lato }` | `versioning { ts }` (uno snapshot di `fub.versioning`, letto con le porte).
- Risposta tipizzata per strategia: `testo { prima, dopo, segmenti: [{ da, a, tipo: ins|del|uguale, autore }] }`; `elementi { prima, dopo, elementi: [{ id, tipo: ins|del|mod|uguale, autore }] }`; `opaco { prima, dopo: { impronta, dimensione, tipo } }`; più `autori: [{ id, nome, colore: 1..6 }]` (colore stabile per dispositivo) e `voci` aperte su quel documento. Fogli e Word si aggiungono con T34 e T37.
- Autore di un segmento: il dispositivo i cui cambi lo hanno prodotto (dai pari di Loro, nome da `fidati.json`).
- Limite: testo oltre 4 MiB → risposta `troppo_grande`.
- Comando dell'host `replica.modifica.annulla { doc, da, a, segmento }`: riporta il solo intervallo di quel segmento al testo di `da` (per «Togli» e «Rimetti» della vista) con una modifica nuova; per gli elementi rimette o toglie l'elemento.
Casi limite: versioning senza quello snapshot; documento cancellato; voce già risolta; due autori nello stesso segmento (il più recente).
Fatto quando: test del confronto sul caso della frase e del disegno; specchi e lista IPC verdi.
Prova: scripts/check.sh --rapido; cargo test -p fub-replica; cargo test -p fub-app --test lean_ipc
Stato: [ ] da fare

## T25 · La pagina Dispositivi

Perché: chi usa Fub abbina i dispositivi, invita persone, sceglie il modo e capisce perché un dispositivo non si collega.
Tocca: `apps/client/src/panels/rete/` (nuovo), `apps/client/src/theme/scrittoio/skin/rete.css` (nuovo), `apps/client/src/theme/scrittoio/anatomia/rete.ts` (nuovo), `apps/client/src/theme/scrittoio/anatomia.ts`, `apps/client/src/theme/scrittoio/skin/order.ts`, `apps/client/src/i18n/catalog.ts`, il punto d'ingresso nelle impostazioni (`apps/client/src/panels/settings.ts`, gruppo «Sincronizzazione»).
Non toccare: `crates/`; `apps/client/src/host/` (i comandi esistono da T19).
Dipende da: T19, T11, T22
Cosa fare: come il prototipo `PLAN-ui/dispositivi.html` approvato (pezzi e destinazioni nella tabella «Dal prototipo», da completare in T22). Testi dei motivi di T13; scelta della cartella con `host/dialog.ts`; i comandi del vault con `invoke_command`; lo stato con la vista `replica.stato`.
Casi limite: quelli del prototipo; rete spenta dall'utente; nessuna configurazione macchina.
Fatto quando: la foto del banco, chiara e scura e a 700 px, corrisponde al prototipo; il banco a11y è verde; test Vitest dell'abbinamento con l'host finto.
Prova: scripts/check.sh --rapido; cd apps/client && npm run typecheck
Stato: [ ] da fare

## T26 · I cursori degli altri

Perché: nella scrittura insieme si vede dove sta scrivendo l'altra persona.
Tocca: `apps/client/src/editors/text/presence.ts` (nuovo), `apps/client/src/editors/text/presence.test.ts` (nuovo), `apps/client/src/editors/text/engine.ts` (capacità `presence` della superficie), `apps/client/src/state/replica/presence.ts` (nuovo), `apps/client/src/theme/scrittoio/skin/editors.css` (cursore e selezione remoti), `apps/client/src/theme/scrittoio/anatomia/editors.ts`.
Non toccare: `apps/client/src/state/document-session.ts`.
Dipende da: T23
Cosa fare:
- `presence.ts` (estensione CodeMirror, dentro il pacchetto del testo): decorazioni per cursore (sbarretta con etichetta del nome, che si nasconde dopo 3 s di immobilità) e selezione velata, colore `--doc-author-N` da `autori` (T24).
- Selezioni locali (`selections()` in offset UTF-8) inviate al più dieci volte al secondo con `replica_live_presenza`; quelle remote dal canale.
- Disegni: le selezioni remote evidenziano gli elementi (anello col colore del dispositivo) nella superficie spaziale, se la superficie dichiara la capacità; altrimenti nulla.
Casi limite: cursore remoto in un intervallo che le operazioni locali hanno appena tolto (si sposta col mapping); 6 persone (i colori si ripetono dopo 6); sola lettura (si vedono gli altri); modalità Lettura (nessun cursore).
Fatto quando: test della mappatura del cursore remoto attraverso battute locali; foto del banco con due cursori remoti, chiara e scura.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/text/presence.test.ts
Stato: [ ] da fare

## T27 · La vista delle differenze: guscio e testo

Perché: quando serve uno sguardo, Fub mostra il documento com'è con i punti cambiati evidenziati, non un terminale.
Tocca: `apps/client/src/panels/compare/` (nuovo: barra, navigazione, scheda «da rivedere», affiancata), `apps/client/src/editors/text/compare.ts` (nuovo), `apps/client/src/editors/text/compare.test.ts` (nuovo), `apps/client/src/editors/core/registry.ts` (famiglia `compare`), `apps/client/src/state/layout.ts` (solo se `Tab.override` ne ha bisogno), `apps/client/src/state/replica/notices.ts` (nuovo), `apps/client/src/state/sheet-notices.ts`, `apps/client/src/state/document-controller.ts` (comandi `shell.doc.compare.*`), `apps/client/src/theme/scrittoio/skin/differenze.css` (nuovo), `apps/client/src/theme/scrittoio/anatomia/differenze.ts` (nuovo), `apps/client/src/theme/scrittoio/anatomia.ts`, `apps/client/src/theme/scrittoio/skin/order.ts`, `apps/client/src/i18n/catalog.ts`, `docs/architecture/editor-surfaces.md`.
Non toccare: `apps/client/src/editors/spatial/` (T28), `crates/`.
Dipende da: T24, T2
Cosa fare:
- Dal prototipo: barra (`diff-bar`: titolo, intervallo, dispositivi filtrabili, conteggio, «Nel testo / Affiancate», precedente e successiva, «Fine»), corpo con il carattere della Lettura, verde per l'arrivato, rosso barrato per il tolto, blocchi interi con il filo sul margine, etichetta del dispositivo, azioni «Togli» e «Rimetti», scheda «da rivedere» con «Tieni questa», «Tienile entrambe», «Decido dopo».
- `editors/text/compare.ts`: un `TextEngine` in sola lettura con il profilo Markdown (resa Live) e decorazioni dai `segmenti`; il testo tolto è un widget barrato. CodeMirror resta nel pacchetto del testo.
- La famiglia `compare` nel registro, montata come scelta della scheda: «Fine» la toglie e rimonta la superficie naturale; teardown con il riquadro.
- Ingressi: avviso dopo una fusione (`sheet-notice` «Dal Tablet sono arrivati…» con «Vedi le differenze» e «Va bene»), azione `replica.rivedi.apri` della vista `replica.da_rivedere`, comando «Confronta con una versione…» che usa le versioni di `fub.versioning`.
- Le azioni chiamano `replica.rivedi.risolvi` (scheda «da rivedere») o `replica.modifica.annulla` («Togli», «Rimetti»), con `invoke_command`: sono modifiche nuove, mai riscritture della storia.
Dal prototipo: tutti i blocchi «testo», «barra», «da rivedere», «affiancata», «vuoto» ed «errore» di `PLAN-ui/differenze.html`.
Casi limite: nessuna differenza (stato vuoto); confronto troppo grande (messaggio); errore di lettura (avviso rosso con «Riprova» e «Apri la cronologia»); 500 modifiche (navigazione e conteggio); documento cambiato mentre la vista è aperta (si aggiorna); 700 px (affiancata diventa una colonna sotto 640 px); fuoco su «Successiva» con la tastiera; Invio e Spazio una volta ciascuno.
Fatto quando: la foto del banco degli stati «avviso», «unificata», «da rivedere», «affiancata», «vuoto», «errore», chiara e scura e a 700 px, corrisponde al prototipo; test Vitest della navigazione e delle azioni con l'host finto; banco a11y verde.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/text/compare.test.ts && npm run typecheck
Stato: [ ] da fare

## T28 · La vista delle differenze: disegni e allegati

Perché: il tratto arrivato dal tablet si vede col suo alone verde, quello tolto in rosso.
Tocca: `apps/client/src/editors/spatial/compare.ts` (nuovo), `apps/client/src/editors/spatial/compare.test.ts` (nuovo), `apps/client/src/editors/media/compare.ts` (nuovo), `apps/client/src/editors/core/registry.ts` (profili della famiglia `compare`), `apps/client/src/theme/scrittoio/skin/differenze.css` (blocchi disegno e allegati), `apps/client/src/theme/scrittoio/anatomia/differenze.ts`, `apps/client/src/i18n/catalog.ts`.
Non toccare: il motore delle operazioni della scena; `panels/compare/` salvo l'aggancio dei profili.
Dipende da: T27
Cosa fare:
- Disegno: la scena «dopo» con alone verde sugli elementi `ins`, l'ombra rossa tratteggiata dei `del`, «Prima / Insieme / Dopo», legenda; riusa il pittore della scena in sola lettura.
- Allegati (immagini, PDF): prima e dopo affiancati, con dimensione e data; una variante parallela si mostra con le due versioni e «Tieni questa» / «Tienile entrambe».
Dal prototipo: blocco «disegno».
Casi limite: disegno con 5.000 elementi; elemento spostato (mostrato come cambiato, non come tolto e aggiunto); PDF di 300 pagine (anteprima della prima pagina cambiata, non tutte).
Fatto quando: foto del banco dello stato «disegno», chiara e scura, corrisponde al prototipo; test del calcolo degli elementi da evidenziare.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/spatial/compare.test.ts
Stato: [ ] da fare

## T29 · La riga di comando

Perché: la cartella condivisa e il server devono potersi usare anche senza l'app aperta, come oggi `fub-cli sync`.
Tocca: `crates/fub-cli/src/replica.rs` (nuovo), `crates/fub-cli/src/cli/command.rs`, `crates/fub-cli/src/cli.rs`, `crates/fub-cli/src/main.rs`, test della CLI.
Non toccare: `crates/fub-cli/src/remote.rs` e il comando `sync` (restano).
Dipende da: T18, T20
Cosa fare: `fub-cli replica status|once|watch [--interval SEC]` per i modi «cartella» e «server» (la rete diretta vive solo nell'app), con lo stesso stile di uscita di `sync`; `fub-cli replica dispositivi` in sola lettura (`fidati.json`). Codici d'uscita come `remote.rs`.
Casi limite: modo «dispositivi» (spiega che serve l'app); app aperta sullo stesso vault (il lock di T3 risponde «occupato»); cartella mancante.
Fatto quando: test della CLI su un vault temporaneo con una cartella condivisa temporanea.
Prova: scripts/check.sh --rapido; cargo test -p fub-cli
Stato: [ ] da fare

## T30 · Progetto della fusione dei fogli di Excel

Perché: nei fogli le righe si inseriscono e le formule si riferiscono a indirizzi: serve un progetto prima del codice.
Tocca: `docs/decisions/0245-la-fusione-dei-fogli.md` (nuovo), `crates/fub-host/src/replica/adattatori/foglio_prova.rs` (nuovo, solo test), `docs/decisions/README.md` (una riga).
Non toccare: `vendor/gridcraft/` (le patch passano dalla procedura di `vendor/gridcraft/UPSTREAM.md`, non qui).
Dipende da: T8, T5
Cosa fare:
- Proposta da provare in `foglio_prova.rs` con il modello di GridCraft: id stabili di righe e colonne tenuti nel CRDT (`LoroMovableList` per foglio), celle in una `LoroMap` per `(riga, colonna)` con l'input (valore o formula) e lo stile come valori; formule tenute in forma relativa agli id (si converte da e verso A1 con il parser di GridCraft) così un inserimento parallelo di righe non le rompe; materializzazione con i comandi di GridCraft sui byte locali (le parti sconosciute del file passano intatte, come fa oggi il giornale v2, ADR 0219).
- Misure: cartella di 50.000 celle, tempo di importazione e di materializzazione, dimensione della storia.
- L'ADR dice cosa resta fuori (tabelle pivot, grafici: opachi dentro il file, ultimo scrittore con voce «da rivedere»).
Casi limite: righe inserite in parallelo nello stesso punto; formula che punta a una riga cancellata dall'altro (`#RIF!` come in Excel, con voce); fogli rinominati.
Fatto quando: l'ADR esiste con le misure; la prova passa i casi sopra.
Prova: scripts/check.sh --rapido; cargo test -p fub-host foglio_prova
Stato: [ ] da fare

## T31 · Banco della rete e del confronto

Perché: la grafica nuova va guardata in tutte e due le luci e alle misure strette, con le baseline prese dal runner.
Tocca: `apps/client/bench/scene.mjs`, le fixture dell'host finto per le scene, `apps/client/bench/a11y.mjs` (se servono voci), le baseline (generate dal runner Linux, mai a mano).
Non toccare: il codice delle superfici.
Dipende da: T25, T27, T28
Cosa fare: scene per la pagina Dispositivi (tutti gli stati del suo prototipo) e per la vista delle differenze (avviso, unificata, da rivedere, affiancata, disegno, vuoto, errore, fuoco su «Successiva»), chiare e scure, a piena larghezza e a 700 px; segui `.claude/skills/banco/SKILL.md`.
Casi limite: caratteri che arrivano tardi (il banco li aspetta); movimento ridotto.
Fatto quando: le scene esistono, il banco a11y è verde, le baseline sono prese dal runner e guardate.
Prova: scripts/check.sh --banchi
Stato: [ ] da fare

## T32 · I fogli: adattatore

Perché: due persone cambiano celle diverse dello stesso foglio e restano tutte e due.
Tocca: `crates/fub-replica/src/strategie/griglia.rs` (nuovo), `crates/fub-host/src/replica/adattatori/foglio.rs` (nuovo), `crates/fub-host/src/replica/adattatori/mod.rs` (righe: `xlsx`, `xlsm`, `xltx`, `xltm` non più opachi), test; `crates/fub-host/src/replica/adattatori/foglio_prova.rs` si toglie.
Non toccare: `vendor/gridcraft/`.
Dipende da: T30
Cosa fare: come deciso in 0245 (T30). Un foglio aperto nella superficie della griglia passa dal suo giornale: le celle cambiate su un altro dispositivo arrivano come un giornale cambiato altrove, con il comportamento già descritto in `docs/architecture/grid-surface.md` («Tieni la tua» / «Prendi quella nuova» solo per la bozza aperta nella stessa cella).
Casi limite: quelli di T30; foglio protetto; file oltre 16 MiB (opaco, come la regola dei fogli).
Fatto quando: test con tre repliche su una cartella reale del corpus; le parti sconosciute del file restano byte per byte.
Prova: scripts/check.sh --rapido; cargo test -p fub-host replica
Stato: [ ] da fare

## T33 · Progetto della fusione dei documenti di Word

Perché: la proiezione dei documenti di videoscrittura ha paragrafi, tratti, oggetti e revisioni tracciate: serve un progetto prima del codice.
Tocca: `docs/decisions/0246-la-fusione-dei-documenti.md` (nuovo), `crates/fub-host/src/replica/adattatori/documento_prova.rs` (nuovo, solo test), `docs/decisions/README.md` (una riga).
Non toccare: `vendor/wordcraft/`, `crates/fub-format-rich/src/projection.rs`.
Dipende da: T8
Cosa fare:
- Proposta da provare: blocchi della proiezione v4 in una `LoroMovableList` con id stabili (i `k` della proiezione dove ci sono, altrimenti nuovi), ogni paragrafo come `LoroText` con i segni (grassetto, stile, revisioni) come marcature di Loro, gli oggetti come valori opachi per chiave; materializzazione con `write_document` della proiezione (senza perdite silenziose, come oggi).
- Rapporto con le revisioni tracciate di Word: restano dati del documento (si replicano), non sono il meccanismo della fusione.
- Misure su documenti del corpus.
Casi limite: paragrafo diviso da un lato e cambiato dall'altro; tabella con celle cambiate in parallelo; commento risolto da una parte e risposto dall'altra.
Fatto quando: l'ADR esiste con le misure; la prova passa i casi sopra.
Prova: scripts/check.sh --rapido; cargo test -p fub-host documento_prova
Stato: [ ] da fare

## T34 · I fogli: confronto

Perché: anche nei fogli si vede cosa è cambiato, cella per cella.
Tocca: `apps/client/src/editors/grid/compare.ts` (nuovo), `apps/client/src/editors/grid/compare.test.ts` (nuovo), `apps/client/src/editors/core/registry.ts` (profilo), `apps/client/src/theme/scrittoio/skin/differenze.css` (blocco foglio), `apps/client/src/theme/scrittoio/anatomia/differenze.ts`, `apps/client/src/i18n/catalog.ts`, `crates/fub-replica/src/confronto.rs` (variante `griglia`), lo specchio IPC che ne segue.
Non toccare: `apps/client/src/editors/grid/engine.ts` salvo il riuso in sola lettura.
Dipende da: T32, T27
Cosa fare: dal prototipo, celle cambiate velate di verde con il valore di prima barrato sotto, righe nuove intere, tolte in rosso; per foglio e intervallo visibile, con le finestre del protocollo a byte.
Dal prototipo: blocco «foglio».
Casi limite: 10.000 celle cambiate (si mostrano per finestre); formula cambiata con lo stesso valore (si mostra la formula).
Fatto quando: foto del banco dello stato «foglio», chiara e scura, corrisponde al prototipo; test del calcolo delle celle.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/grid/compare.test.ts
Stato: [ ] da fare

## T35 · I documenti di Word: adattatore

Perché: due persone scrivono paragrafi diversi dello stesso documento Word e restano tutti e due.
Tocca: `crates/fub-replica/src/strategie/ricco.rs` (nuovo), `crates/fub-host/src/replica/adattatori/documento.rs` (nuovo), `crates/fub-host/src/replica/adattatori/mod.rs` (righe: `docx`, `odt`, `rtf` non più opachi; `doc` resta opaco), test; `documento_prova.rs` si toglie.
Non toccare: `vendor/wordcraft/`.
Dipende da: T33
Cosa fare: come deciso in 0246 (T33); un documento aperto nella superficie ricca passa dal collegamento live della sessione (T23) con il testo della proiezione.
Casi limite: quelli di T33; documento in sola lettura per protezione; ODT con revisioni (il codec le rifiuta: il documento resta opaco).
Fatto quando: test con tre repliche su documenti del corpus; nessuna perdita silenziosa (il test di andata e ritorno della proiezione resta verde).
Prova: scripts/check.sh --rapido; cargo test -p fub-host replica
Stato: [ ] da fare

## T36 · Robustezza

Perché: «non deve mai avere problemi» si prova con i casi peggiori, non con quelli felici.
Tocca: `crates/fub-replica/tests/simulazione.rs`, `crates/fub-replica/tests/fuzz_messaggi.rs` (nuovo), `crates/fub-host/tests/replica_crash.rs` (nuovo), `crates/fub-rete/tests/fuzz_codici.rs` (nuovo).
Non toccare: il codice di produzione, salvo correggere la causa di un rosso (con un test che la prova).
Dipende da: T14, T17, T18
Cosa fare:
- Simulazione estesa (con `FUB_FUZZ_CASI`): 3–5 dispositivi, partizioni lunghe, consegne via rete e via cartella insieme, orologi sbagliati di anni (R1), rinomine e cancellazioni incrociate, collisioni di nomi, adozione di una cartella con file già presenti, crash a ogni passo della materializzazione.
- Invarianti: convergenza; nessun testo, tratto, file o cella perso se non tolto esplicitamente; nessun file del vault rotto; nessuna voce «da rivedere» senza una differenza vera.
- Fuzz dei decodificatori: messaggi del protocollo, segmenti della cassetta, codici di abbinamento, aggiornamenti Loro malformati (nessun panico, errore tipizzato).
Casi limite: lo scopo del task.
Fatto quando: verde con `FUB_FUZZ_CASI=2000`; ogni rosso trovato ha la sua correzione e un test che lo riproduce.
Prova: scripts/check.sh --rapido; FUB_FUZZ_CASI=2000 cargo test -p fub-replica -p fub-rete
Stato: [ ] da fare

## T37 · I documenti di Word: confronto

Perché: anche nei documenti Word si vede cosa è cambiato, con i segni che Fub usa già per le revisioni.
Tocca: `apps/client/src/editors/rich/compare.ts` (nuovo), `apps/client/src/editors/rich/compare.test.ts` (nuovo), `apps/client/src/editors/core/registry.ts` (profilo), `crates/fub-replica/src/confronto.rs` (variante `ricco`), lo specchio IPC che ne segue.
Non toccare: `apps/client/src/editors/rich/engine.ts` salvo il riuso in sola lettura.
Dipende da: T35, T27
Cosa fare: la pagina del documento in sola lettura con le classi esistenti `rich-ins`, `rich-del` e `rich-autore-N` (`skin/editors.css`) per arrivato, tolto e dispositivo; stessa barra di T27.
Casi limite: documento con revisioni tracciate proprie (le sue restano distinguibili: le differenze della replica hanno anche il velo di `diff-ins`/`diff-del`); 200 pagine.
Fatto quando: foto del banco con un documento confrontato, chiara e scura; test del calcolo dei segni.
Prova: scripts/check.sh --rapido; cd apps/client && npx vitest run src/editors/rich/compare.test.ts
Stato: [ ] da fare

## T38 · Documentazione allineata

Perché: le pagine canoniche devono descrivere il presente, tutte insieme e coerenti.
Tocca: `docs/architecture/replica-e-rete.md`, `docs/architecture/overview.md`, `docs/architecture/components-and-boundaries.md`, `docs/reference/replica-protocol.md`, `docs/reference/on-disk-layout.md`, `docs/reference/permissions-and-security.md`, `docs/reference/ipc-contract.md`, `docs/map/repo.md`, `docs/map/dove-sta-x.md`, `docs/map/ownership.md`, `docs/product/vault-and-files.md` (togliere «Fub non sincronizza automaticamente il vault»), `docs/product/overview.md` (il confine della prima release), `docs/project/status.md` (issue #9), `CLAUDE.md` solo se una regola di lavoro cambia.
Non toccare: gli ADR accolti (si cambiano solo con un ADR nuovo).
Dipende da: tutti gli altri
Cosa fare: rileggi codice e pagine; ogni affermazione delle pagine deve corrispondere al codice; i rimandi fra pagine funzionano; gli ADR 0241–0246 passano a «accolta» se il codice li rispetta, altrimenti la differenza si scrive.
Casi limite: una pagina che descrive ancora un candidato come se esistesse.
Fatto quando: nessuna pagina canonica contraddice il codice; `scripts/check.sh` completo verde (i `SALTA` detti nel resoconto).
Prova: scripts/check.sh
Stato: [ ] da fare
