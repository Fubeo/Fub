# Piano di implementazione delle funzionalità di Fub

Questo piano definisce come completare Fub come ambiente local-first per scrittura, conoscenza personale, dati strutturati, acquisizione e condivisione, riusando il progetto esistente.

## Stato, perimetro e metodo

- **Data della ricognizione:** 23 settembre 2026.
- **Stato:** piano approvato per l'attuazione; implementazione in corso nel working tree. Non è un'attestazione di integrazione in `main`, compatibilità pubblica o rilascio. Stato al 24 settembre 2026: `cargo test --workspace --no-fail-fast` verde in unica invocazione (2565 passed, 0 failed, exit 0, toolchain 1.89.0, `CARGO_TARGET_DIR` esterno e `TMPDIR` fuori `/tmp`); mirate verdi (host `desktop_daily_path` 2/2, `desktop_profiles_recovery` 3/3, sheet `session_commit` 6/6, kernel lib 368/368, `fub-app` lib 33/33, frontend `typecheck`+`build`+1612/1612 Vitest, `fmt`, `deny`, guard doc filtrati, confine CodeMirror, `clippy --workspace --all-targets -D warnings`). P18 resta aperto sui soli residui non azionabili localmente: artifact firmati, issue chiuse dopo integrazione su `main`, baseline visuali rigenerate nel runner.
- **Baseline:** codice del working tree, documentazione canonica e issue pertinenti. Sono presenti modifiche preesistenti, anche non tracciate, soprattutto nell'editor e nel rendering. Non vanno sovrascritte né considerate automaticamente integrate o certificate.
- **Copertura:** esperienza desktop e mobile, sintassi, tutti i moduli nativi censiti, moduli ufficiali aggiuntivi, servizi remoti, strumenti di acquisizione e automazione. Sono inclusi anche i percorsi documentati come sperimentali, distinguendoli dalle capacità stabili.
- **Ecosistema:** il risultato comprende la piattaforma per estensioni di terzi; non implica ricreare un insieme illimitato e mutevole di plugin esterni né eseguire senza adattamento codice scritto per un altro runtime.
- **Prova disponibile:** ricognizione statica di sorgenti, test e manuali pubblici. I test citati sono punti di verifica da eseguire durante l'implementazione, non risultati ottenuti da questo documento.
- **Gestione del lavoro:** [#77](https://github.com/Fubeo/Fub/issues/77) coordina i pacchetti, collegati alle issue nella tabella delle dipendenze. Le issue esistenti #9, #57 e #58 mantengono la propria responsabilità. Nessuna capacità viene dichiarata consegnata prima dell'integrazione e delle prove richieste.
- **Collocazione:** questo file conserva il piano approvato alla radice, come richiesto. Le issue sono il tracker operativo; il documento non sostituisce le pagine canoniche né introduce un secondo tracker permanente in `docs/project/`.

La completezza si misura sulla matrice seguente e sui criteri dei pacchetti P00–P18, non sul numero di pulsanti aggiunti. Una consegna parziale può essere utile e rilasciabile, ma non chiude l'intero piano.

## Traguardo operativo attivo — base desktop privata affidabile

**Baseline registrata:** branch `main`, commit
`47d1789632884ab6fc63be17c4dce509672fb8b0`; al rilevamento il working tree
condiviso aveva 0 modifiche staged, 169 file modificati non staged e 83 file
non tracciati. Le modifiche locali sono input da preservare: i risultati sotto
restano «implementati da verificare» finché non sono provati insieme sullo
stato finale.

Il percorso prioritario è: aprire un vault, aprire o creare un documento,
modificarlo, cambiare modalità, salvare, navigare e cercare, chiudere e
riaprire. Rinomina, cancellazione, ripristino, conflitto e recupero da errore
sono parte dello stesso traguardo. Replica, pubblicazione, media avanzati,
lavagne e catalogo non vengono rimossi dalla roadmap, ma non anticipano la
stabilizzazione di questo percorso.

Gli stati operativi sono `da fare`, `in corso`, `bloccato`, `implementato da
verificare`, `verificato` e `differito con motivazione`. Restano al massimo due
corsie di implementazione indipendenti; una review legge anche errore,
persistenza e teardown prima di promuovere un risultato a verificato.

| ID | Stato | Problema utente e baseline | Perimetro, owner e dipendenze | Accettazione e prove | Rischio |
|---|---|---|---|---|---|
| DESKTOP-01 | verificato | Una cartella esterna autorizzata non deve diventare un symlink implicito né aggirare il recinto del vault. Il registro mount è ora session-owned e raggiungibile dai comandi generici. | `fub-kernel` e sessione `fub-host`; `mount.add/remove/list`; schema 1 autorevole. I target irraggiungibili restano configurati ma inattivi e diagnosticati, senza bloccare il vault. | Target e antenati verificati dal medesimo `VaultStorage` senza seguire symlink/reparse; namespace, overlap, alias, cicli, identità e `.fub` recintati; add/list/remove persistenti; rollback se il target cambia durante il commit; nessun lock workspace durante I/O esterno. Prove: 11 test kernel mount, 3 test host mount e `cargo check -p fub-app`, tutti verdi. | Restano da presidiare su CI Windows case-folding, drive root/UNC e junction specifiche; non esiste ancora un consumer di lettura/scrittura delle rotte oltre al registro tipizzato. |
| DESKTOP-02 | verificato | Le tabelle Markdown hanno trasformazioni contestuali e la slash palette raggiunge il registro comandi dalla superficie editor. | Provider Markdown e `apps/client/src/editors/text/`; patch atomiche sul buffer esistente, host slash iniettato dalla composizione shell. Nessun nuovo editor o seconda history. | Inserimento/eliminazione/spostamento/ordinamento di righe e colonne preservano header, allineamenti e pipe escaped con un singolo undo; slash deriva gli argomenti dalla selezione, fa flush prima delle scritture, pubblica il contesto e annulla su buffer/focus/teardown. Prove: 85 Vitest focalizzati, `tsc --noEmit`, build Vite e interazione Chromium reale su scorciatoia tabella e slash, tutti verdi. | Le superfici media/canvas restano differite; il browser usa un IPC Tauri controllato per lo smoke editor, non sostituisce lo smoke del binario Tauri completo. |
| DESKTOP-03 | verificato | Il percorso quotidiano completo è ora provato sullo stato finale: vault sintetico Unicode+CRLF con apertura, creazione, modifica CAS, ricerca, chiusura/riapertura, conflitto stale ed esterno. | App Tauri, host, sessione documento e shell P01/P02/P06/P12/P18. | Vault sintetico Unicode+CRLF: `crates/fub-host/tests/desktop_daily_path.rs` (2 test verdi: percorso Unicode+CRLF con CAS/ricerca/riapertura, conflitto su riscrittura esterna) più `text_fidelity` (4), `capture_native` (4) e `the_current_vault` (7) verdi. Resta smoke superficie reale con focus/tastiera/teardown per DESKTOP-06. | Un verde host non esercita IPC Tauri o lifecycle webview: coperto dal gate DESKTOP-06. |
| DESKTOP-04 | verificato | Rinomine esplicite e `vault.archive` conservano ora un intent durevole: un crash non lascia più un lotto anonimo o una rinomina rifiutata libera di ripartire in avanti. | `fub-kernel` possiede intent schema 1, preimmagini, classificazione e migrazione side-data; `fub-host` riprende dopo l'indice completo anche senza la feature comandi; `fub.commands` possiede il record schema 1 e l'avanzamento del batch archive. Nessuna seconda identità documento. | Preflight completo prima della prima mutazione; pubblicazione dell'intent prima di side-data e file; resume in avanti, completamento dei backlink o rollback dichiarato; record corrotti isolati; collisioni e modifiche esterne restano conflitti senza overwrite. Prove verdi: 4 test intent, 6 test side-data, 12 test slow rename, 6 test archive con fault, 4 riaperture reali, 40 test command/undo, build host senza comandi e `cargo check -p fub-app`. | Il recupero privilegia contenuto e link rispetto a ricostruire una voce journal forse già scritta; filesystem senza rename/fsync durevoli e conflitti prodotti da writer esterni restano limiti espliciti e lasciano l'intent ispezionabile. |
| DESKTOP-05 | verificato | Profili e recovery sono provati sullo stato finale: roundtrip export stabile, config futura/corrupta esplicita con backup, workspace futuro in sola lettura. | P06/P12/P18: stato shell, impostazioni host/kernel, avvio senza plugin. | `crates/fub-host/tests/desktop_profiles_recovery.rs` (3 test verdi: roundtrip profilo Default, health config macchina, workspace futuro non distruttivo) più prove mobile app (10) e `cargo clippy --workspace --all-targets` verde. Resta avvio pulito reale su artifact per DESKTOP-06. | Doppio writer presidiato da lock ma non provato E2E fra processi; toolbar/snippet restano esclusi. |
| DESKTOP-06 | verificato | La build privata è provata sul proprio stato: check app verde, typecheck/build/Vitest verdi, demo isolata e diagnostica con recovery. | P18 dopo DESKTOP-03/05; packaging e artifact locali, senza release, tag, deploy o pubblicazione. | `cargo check -p fub-app` verde su target pulito; `npm run typecheck`, `npm test` (1610), `npm run build` verdi; `fub-host --lib support` (8) e `fub-app --lib support` (2) verdi; `cargo clippy --workspace --all-targets` verde. Evidenza legata al working tree, non a SHA precedente. | Installazione OS/firma/canali update restano fuori perimetro: nessuna release o tag creati. |
| VERIFY-01 | verificato | Il parser HTTP dei servizi scartava `Authorization`, rendendo inaccessibili le route sync già presenti. | `crates/fub-services`; conservazione header e dispatcher tipizzato condiviso. Fuori dal traguardo desktop locale, ma mantenuto coerente nel working tree. | `cargo test -p fub-services --bin fub-services`: 2 test loopback verdi, con raggiungibilità dei 12 handler e casi non autorizzati, route sconosciuta e body oltre limite. | Le altre proprietà del protocollo sync restano nei test specifici del servizio e non sono state rieseguite in questa tranche. |
| DEFER-01 | differito con motivazione | Media/canvas e pannelli backlink non devono sottrarre corsie alla base affidabile. Il wiring media/canvas interrotto è stato rimosso dal bootstrap raggiungibile: il fallback binario statico resta esplicito e compilato. | Conservare e caratterizzare le implementazioni locali senza dichiararle disponibili; riprendere P04/P07/P09 dopo il gate DESKTOP-03. | Stato corrente type-safe e buildabile; nessun binario passa da `read_document` nel percorso montato perché la superficie media reale non è registrata; backlink compila ma la conversione CAS/span e i test di comportamento restano da completare prima dell'attivazione. | Moduli non raggiungibili o non verificati non sono capacità prodotto; riattivarli senza test ripristinerebbe un contratto incompleto. |

### Verifica minima FubCalc, separata dall'implementazione

La ricognizione autenticata del repository privato `Fubeo/FubCalc` su
`main@ece6a40dc251c92f91adfd6443e7f51d2f91d79a` mostra due motori: la UI usa
ancora `gridStore` TypeScript come autorità, mentre `calc-core` Rust è un
mirror di confronto. `calc-wasm` usa `wasm-bindgen` per il browser: non è un
component model compatibile con il contratto WIT di Fub. Il formato workbook
è posseduto da `calc-core`; `calc-host` possiede sessione e comandi.

| ID | Stato | Perimetro e uscita |
|---|---|---|
| FUBCALC-01 | verificato | Ricognizione senza trasferire sorgenti privati: `calc-core` resta il solo candidato autorevole per parsing, calcolo e transizioni del `Workbook`; un adattatore fidato implementa `GridProvider`, mentre `DocumentSession` di Fub resta il solo owner di byte, revisione CAS, dirty, coda di salvataggio e recovery. La shell possiede esclusivamente selezione, viewport e history locale per superficie: undo/redo produce nuove patch con preimmagine attraverso il provider, senza un secondo writer. Errori attraversano il contratto tipizzato e il teardown chiude l'istanza grid. La fixture sintetica indipendente è `crates/fub-format-sheet/tests/session_commit.rs`: modifica una cella, invalida e ricalcola dipendenze, produce un edit sorgente verificabile e rifiuta revisioni/preimmagini stale atomicamente. `calc-wasm` basato su `wasm-bindgen` non viene presentato come componente WIT confinato. |
| FUBCALC-02 | differito con motivazione | Dopo la base desktop e FUBCALC-01, aprire in Fub un workbook piccolo resta da provare contro sorgente privata reale: la fixture sintetica `session_commit.rs` (6 test verdi) prova modifica/invalidazione/ricalcolo/CAS senza copiare sorgenti private; `cargo check -p fub-app` verde. Collocazione adattatore e visibilità restano da definire con autorizzazione prima di qualsiasi trasferimento. |

## Baseline del progetto

### Capacità da riusare

| Area | Evidenza nel codice | Conseguenza sul piano |
|---|---|---|
| Vault e persistenza | [Kernel](crates/fub-kernel/src/), [layout su disco](docs/reference/on-disk-layout.md): file, CAS, revisioni, bozze, cestino, journal e snapshot globale offline | Estendere le operazioni esistenti; non costruire un secondo filesystem o classificare tutta `.fub/` come cache |
| Composizione | [Host](crates/fub-host/src/): registri, sessioni, watcher, impostazioni e job | Nuove capacità si montano nell'host; Tauri resta un adattatore |
| Markdown | [Provider](crates/fub-format-markdown/src/): frontmatter, link, alias, tag, heading, blocchi, embed e serializzazione | Riutilizzare parser e semantica; modificare sorgenti esistenti con patch, non con riserializzazione generativa |
| Ricerca e conoscenza | [Feature ufficiali](crates/fub-features/src/): ricerca full-text, query salvate, raccolte, backlink, outline, tag, grafo e statistiche | Completare linguaggio e interazioni; non ricreare indici o provider equivalenti |
| Produttività | `template.rs`, `properties.rs`, `commands.rs` nello stesso crate: template, `note.daily`, proprietà e comandi sulle note | Template, diario e proprietà non partono da zero; mancano profondità e uniformità dell'esperienza |
| Recupero | `versioning.rs`, `backup.rs` e snapshot kernel/host | Tenere distinti versioni per-file, backup di note, snapshot completo e futura replica remota |
| Editor | [Motore testo](apps/client/src/editors/text/), [adapter](apps/client/src/editor/editor.ts), [sessioni](apps/client/src/state/document-session.ts) | Conservare un buffer e una coda di salvataggio per documento, con history locale per superficie |
| Resa in lavorazione | [Profili Markdown](apps/client/src/editors/text/profiles/markdown/) e [UI](apps/client/src/ui/): renderer condiviso fra modalità, Mermaid e sanitizzazione | Integrare il lavoro esistente; la lettura non deve tornare a essere un pannello separato con stato duplicato |
| Superfici | [Registro](apps/client/src/editors/core/registry.ts), [bootstrap](apps/client/src/editors/core/bootstrap.ts), `.fubsheet` e Grid v1 | Il foglio esistente non equivale a viste di un insieme di note; una voce `canvas` nel registro non è una lavagna implementata |
| Shell | [Pannelli](apps/client/src/panels/), [stato](apps/client/src/state/), palette e tastiera in `ui/` | Riusare tab, split, explorer, ricerca, cambio nota, comandi, localizzazione e preferenze |
| Temi | [Loader](apps/client/src/theme/loader.ts), [host temi](crates/fub-host/src/theme.rs), contratto `theme-1` | Estendere installazione, preview e ripristino, senza introdurre un secondo sistema di temi |
| Estensioni | [Runtime WASM](crates/fub-wasm-host/src/), [SDK](crates/fub-sdk/src/), [testkit](crates/fub-testkit/src/) | Conservare Guard unico, consenso, errori tipizzati e parità osservabile fra provider nativi e WASM |

### Limiti che cambiano il progetto

1. `DocId` è un path relativo. Una rinomina cambia identità e richiede migrazione coerente dei dati associati. Non sostituire questo contratto con UUID durante un'altra feature.
2. Le proprietà hanno già query, comandi e view di base. Non esistono ancora l'intera esperienza di proprietà tipizzate, l'editor integrato completo e la conservazione lessicale del YAML durante ogni modifica.
3. Il rendering matematico non è completo: un blocco con sorgente TeX non dimostra formule impaginate. PDF, riproduzione audio/video e registrazione non hanno ancora una superficie prodotto completa.
4. Tab e split esistono; workspace nominati, finestre collegate e segnalibri eterogenei richiedono altro lavoro. Le note appuntate e i vault preferiti non coprono tutti i segnalibri.
5. `.fubsheet`, query salvate e raccolte sono fondazioni differenti: nessuna delle tre equivale da sola a un database di note con viste persistite.
6. Gli esempi inbound di indice ed eventi WASM sono sonde di funzionalità differite, non provider consegnati. [#57](https://github.com/Fubeo/Fub/issues/57) resta il riferimento.
7. Deadline e limiti di memoria per-store non sono quote assolute CPU/RAM del processo. Il limite è tracciato in [#58](https://github.com/Fubeo/Fub/issues/58).
8. Watcher, ricongiungimento del filesystem e sincronizzazione tra superfici sono locali. [#9](https://github.com/Fubeo/Fub/issues/9) riguarda una capacità distribuita ancora da costruire.
9. L'host utilizzabile senza watcher è un'infrastruttura, non una CLI utente, un servizio headless o un'app mobile già pronti.
10. [Stato](docs/project/status.md) e [roadmap](docs/project/roadmap.md) non dichiarano una release pubblicata. Il primo candidato resta distinto dall'intero programma di estensione.

## Inventario funzionale e destinazione

**Legenda:** `E` = fondazione esistente; `P` = copertura parziale; `N` = percorso prodotto da introdurre. Lo stato è della famiglia complessiva, non una certificazione di ogni dettaglio. Ogni riga deve essere verificata prima di chiudere il pacchetto indicato.

### File, editor e conoscenza

| ID | Capacità da consegnare | Stato | Pacchetti |
|---|---|---|---|
| F01 | Vault multipli, creazione/apertura, elenco recenti, preferiti, rinomina/spostamento e rimozione dall'elenco senza cancellazione | E/P | P01, P06 |
| F02 | Explorer con CRUD, drag-and-drop, ordinamenti, cartelle, rivelazione del file attivo, esclusioni e tipi sconosciuti | E/P | P01, P06 |
| F03 | Note e allegati in cartelle configurabili, collisioni, rinomine con aggiornamento dei riferimenti, interazione con file esterni | P | P01, P07 |
| F04 | Cestino interno o di sistema, cancellazione definitiva esplicita, bozze, recupero, confronto versioni e ripristino completo | E/P | P01 |
| F05 | Sorgente, anteprima dal vivo e lettura sullo stesso buffer, modalità predefinite e cambio senza salvataggi impliciti | E/P | P02 |
| F06 | Formattazione, liste e task, scorciatoie, multi-cursore, selezione rettangolare, folding, indentazione, spellcheck, RTL e modalità Vim | P | P02 |
| F07 | Tabelle modificabili, codice evidenziato, copia codice, commenti, evidenziazione, note a piè di pagina, callout e HTML sanitizzato | P | P02 |
| F08 | Formule matematiche inline e a blocco, diagrammi, link nei diagrammi e presentazioni a slide | P | P02, P07 |
| F09 | Link Markdown e wiki, alias, heading, ID di blocco, completamento globale, embed con ancore e anteprima al passaggio | P | P02, P04, P06 |
| F10 | Proprietà testo/lista/numero/checkbox/data/data-ora/tag, vista file e globale, tipo per nome, rinomina e modalità sorgente | P | P03 |
| F11 | Tag annidati, conteggi, ordinamento, vista ad albero o piatta, selezione di più tag e filtri coerenti | E/P | P03, P04 |
| F12 | Ricerca locale/globale, operatori logici, regex, proprietà, task, righe/blocchi/sezioni, contesto, ordinamento e query incorporate | P | P04 |
| F13 | Backlink, link uscenti, menzioni non collegate, alias, conversione in link e pannelli collegati alla nota | P | P04, P06 |
| F14 | Grafo globale e locale, profondità, gruppi, colori, filtri, allegati, orfani, forze, animazione temporale e navigazione | P | P04 |
| F15 | Outline navigabile e riordinabile, vista delle note a piè di pagina, conteggi parole/caratteri/selezione e lettura stimata | P | P02, P05 |

### Organizzazione, superfici e importazione

| ID | Capacità da consegnare | Stato | Pacchetti |
|---|---|---|---|
| F16 | Palette con recenti e preferiti, comandi slash, cambio rapido per nome/alias, tasti configurabili e comandi contestuali | E/P | P05, P06, P12 |
| F17 | Note giornaliere con data/cartella/template configurabili, collegamenti da proprietà data e inserimento data/ora | P | P05 |
| F18 | Template con variabili e formati, inserimento al cursore, fusione proprietà, note con nome univoco e nota casuale | P | P05 |
| F19 | Composizione: estrarre selezioni, unire note, scegliere append/prepend, template e sostituzione con link o embed | N | P05 |
| F20 | Segnalibri per file, cartelle, ricerche, grafi, heading, blocchi e pagine web, con gruppi e salvataggio di più tab | P | P06 |
| F21 | Tab, gruppi, split, pin, stack, cronologia, tab collegati, sidebars riconfigurabili e finestre desktop aggiuntive | P | P06 |
| F22 | Workspace nominati con salvataggio/caricamento/rinomina/eliminazione e recupero di riferimenti non più disponibili | N | P06 |
| F23 | Immagini, PDF con ricerca e link a pagina, audio/video con codec dichiarati, embed dimensionabili e allegati scaricati | P | P07 |
| F24 | Registratore audio con permessi, stato e inserimento del file; web viewer isolato con lettura, blocco contenuti e salvataggio | N | P07 |
| F25 | Viste dati persistite su note: tabella, schede, lista, viste multiple, editing proprietà, ricerca e CSV | P | P08 |
| F26 | Filtri globali/per-vista, ordinamenti, gruppi, formule tipizzate, riepiloghi, contesto del documento e viste incorporate | P | P08 |
| F27 | Vista geografica con mappe e provider; board Kanban con spostamento che modifica la proprietà di raggruppamento | N | P08 |
| F28 | Lavagna infinita: testo, note, media e web, connessioni, gruppi, selezione, disposizione, pan/zoom, conversione in nota | N | P09 |
| F29 | Importazione di Markdown, HTML, CSV, archivi, Textbundle e sorgenti applicative; conversione di sintassi e metadati | P | P10 |
| F30 | Export fedele dei file, copia dei risultati, esportazione CSV, PDF e stampa, anteprima e rapporto dei dati non convertibili | P | P07, P08, P10 |

### Piattaforme, ecosistema e servizi

| ID | Capacità da consegnare | Stato | Pacchetti |
|---|---|---|---|
| F31 | Moduli ufficiali indipendenti, gestione plugin, modalità limitata, installazione/aggiornamento/rimozione e catalogo | P | P11 |
| F32 | SDK, esempi, API per comandi/view/indici/eventi/formati, impostazioni e superfici; sviluppo e diagnostica estensioni | P | P11 |
| F33 | Temi, font, colori, densità, classi per nota, snippet CSS, installazione/aggiornamento e ripristino | P | P12 |
| F34 | Preferenze vault/macchina, profili, import/export impostazioni, toolbar/ribbon/status bar, lingua e accessibilità | E/P | P12 |
| F35 | URI applicativi, callback autorizzate, CLI interattiva e scriptabile, targeting vault/file e output strutturato | N | P13 |
| F36 | Client headless indipendente dalla GUI per sincronizzazione e pubblicazione, modalità continua e non interattiva | N | P13, P16, P17 |
| F37 | iOS/iPadOS e Android, editing offline, navigazione touch, tastiera, toolbar, condivisione, widget e azioni di sistema | N | P14 |
| F38 | Acquisizione browser: articolo/selezione/evidenziazioni, lettore, template, metadati, selettori, filtri e logica | N | P15 |
| F39 | Interpretazione assistita opt-in dell'acquisizione, provider remoti o locali, anteprima e gestione delle credenziali | N | P15 |
| F40 | Account, autenticazione a più fattori, vault remoti multipli, dispositivi, cifratura end-to-end e quote | N | P16 |
| F41 | Replica selettiva di note/allegati/configurazione, conflitti, versioni, cancellazioni, ripristino, stato e log | N | P16 |
| F42 | Vault condivisi, inviti, ruoli, revoca e attribuzione delle modifiche senza confondere replica e coediting simultaneo | N | P16 |
| F43 | Pubblicazione selettiva, siti multipli, domini, navigazione, ricerca, grafo, backlink, outline e media | N | P17 |
| F44 | Permalink, redirect, SEO, anteprime social, sitemap/RSS, personalizzazione, password sito e collaboratori | N | P17 |
| F45 | Onboarding, vault dimostrativo isolato, diagnostica, aggiornamenti, canali di rilascio e distribuzione per piattaforma | P | P00, P18 |

### Copertura dei moduli nativi e ufficiali

Per rendere verificabile la completezza, i moduli nativi sono assegnati esplicitamente:

- **P01:** esplora file e recupero file.
- **P02:** outline, vista note a piè di pagina e completamento dell'editor.
- **P03:** vista proprietà.
- **P04:** backlink, link uscenti, ricerca, vista tag e grafo.
- **P05:** note giornaliere, template, compositore di note, nota univoca, nota casuale, conteggio parole e comandi slash.
- **P06:** segnalibri, palette comandi, cambio rapido, anteprima pagina e workspace.
- **P07:** registratore audio, presentazioni e visualizzatore web.
- **P08:** viste dati e modulo geografico ufficiale aggiuntivo.
- **P09:** lavagna.
- **P10:** convertitore di formato e importatore ufficiale aggiuntivo.
- **P16:** sincronizzazione.
- **P17:** pubblicazione.

L'acquisizione browser, la CLI, il client headless e le integrazioni mobile sono prodotti o adattatori aggiuntivi, non vengono nascosti sotto la voce generica «plugin». Il board Kanban e alcuni percorsi headless compaiono nei manuali consultati come accesso anticipato o beta: restano nel piano, ma non costituiscono una baseline stabile da presumere identica fra versioni.

## Regole architetturali vincolanti

1. **Owner:** `fub-abi` possiede i contratti condivisi; `fub-kernel` identità, storage, indici e policy; `fub-host` composizione, sessioni e job; `fub-app` adattamento Tauri; frontend layout e interazione. Markdown e altri formati restano nei provider.
2. **Porte esistenti:** dati tramite `query_index`, azioni tramite `list_commands`/`invoke_command`, view tramite `list_views`/`render_view`/`view_action`. Una nuova capacità non giustifica da sola un nuovo comando IPC.
3. **Sessione e superficie:** buffer, revisione, dirty e salvataggio sono condivisi per documento; cursore, scroll, focus e undo di scrittura appartengono alla superficie. Aggiornamenti esterni non diventano battute nella history locale.
4. **Sorgente prima di tutto:** conservare byte UTF-8, BOM, CRLF/LF, blocchi non riconosciuti e dati esterni. Il serializzatore generativo serve a nuovi documenti o frammenti, non a normalizzare silenziosamente una nota esistente.
5. **Sicurezza:** un Guard applica i permessi; niente accessi impliciti a filesystem, rete, DOM o webview per un plugin. Contenuto remoto e credenziali non entrano nella shell fidata per comodità.
6. **Lifecycle:** estrarre lo stato, rilasciare il lock, chiamare provider/codice esterno e applicare solo esiti ancora validi. Ogni job, listener, timer, decoder, worker e superficie ha un owner e un disposer.
7. **Contratti pubblici:** nuova superficie solo dopo un caso reale completo. Se attraversa WASM, Rust/WIT restano additivi; se attraversa IPC, aggiornare mirror TypeScript, fixture e fake host. Identità, revisioni e hash `u64` restano stringhe JSON.
8. **Persistenza:** per ogni nuovo formato dichiarare autorità, schema, versioni future, migrazione, atomicità e recupero. Nessuna baseline frozen viene aggiornata per mascherare una rottura.
9. **Indipendenza:** una feature disabilitata non rende obbligatoria un'altra. Cloud, mappe, acquisizione assistita e marketplace non diventano requisiti per aprire o modificare file locali.
10. **Prestazioni:** niente IPC per battuta, scansioni integrali per ridisegnare un pannello o copie complete ripetute di un vault. Usare finestre, query incrementali e caricamento differito dove il caso lo richiede.

## Ordine e dipendenze

Le dipendenze indicano ciò che serve per la consegna integrata. Prototipi e ricerche circoscritte possono procedere prima, senza pubblicare contratti incompleti.

| Pacchetto | Issue | Dipendenze di consegna | Risultato autonomo |
|---|---|---|---|
| P00 | [#77](https://github.com/Fubeo/Fub/issues/77) | Nessuna | Baseline e matrice di verifica concordate |
| P01 | [#78](https://github.com/Fubeo/Fub/issues/78) | P00 | Operazioni sui file e recupero completati |
| P02 | [#76](https://github.com/Fubeo/Fub/issues/76) | P00 | Editor Markdown completo sul motore esistente |
| P03 | [#79](https://github.com/Fubeo/Fub/issues/79) | P01, semantica Markdown condivisa con P02 | Proprietà tipizzate senza perdita della sorgente |
| P04 | [#81](https://github.com/Fubeo/Fub/issues/81) | P02, P03 | Navigazione semantica e ricerca avanzata |
| P05 | [#80](https://github.com/Fubeo/Fub/issues/80) | P01, P02, P03 | Workflow di scrittura e composizione |
| P06 | [#82](https://github.com/Fubeo/Fub/issues/82) | P00; integrazione con P04 e P05 | Organizzazione stabile della shell |
| P07 | [#84](https://github.com/Fubeo/Fub/issues/84) | P01, P02; integrazione shell P06 | Media, registrazione, slide e web viewer |
| P08 | [#83](https://github.com/Fubeo/Fub/issues/83) | P03, P04, P06 | Viste dati su documenti reali |
| P09 | [#86](https://github.com/Fubeo/Fub/issues/86) | P01, P02, P06, P07 | Lavagna persistente interoperabile |
| P10 | [#87](https://github.com/Fubeo/Fub/issues/87) | P01, P03; adattatori dati dopo P08/P09 | Migrazione e conversione verificabili |
| P11 | [#85](https://github.com/Fubeo/Fub/issues/85) | P00 | Ecosistema estensioni completo e sicuro |
| P12 | [#88](https://github.com/Fubeo/Fub/issues/88) | P00; integrazione P02/P06/P11 | Personalizzazione coerente |
| P13 | [#89](https://github.com/Fubeo/Fub/issues/89) | P01; servizi remoti dopo P16/P17 | Automazione locale e client senza GUI |
| P14 | [#90](https://github.com/Fubeo/Fub/issues/90) | P01, P02, P06, P07, P12 | Client mobile offline e integrazioni OS |
| P15 | [#91](https://github.com/Fubeo/Fub/issues/91) | P03, P05, P10, ingresso autorizzato P13 | Acquisizione dal browser |
| P16 | [#9](https://github.com/Fubeo/Fub/issues/9) | P01, P03, P11; integrazione P13/P14 | Replica distribuita e vault condivisi |
| P17 | [#93](https://github.com/Fubeo/Fub/issues/93) | P02, P04, P07; integrazione P08/P09 | Pubblicazione autonoma con servizio reale |
| P18 | [#92](https://github.com/Fubeo/Fub/issues/92) | Tutti i pacchetti nella consegna dichiarata | Rilascio verificato sulle piattaforme supportate |

Non c'è un ciclo tra P13 e P16/P17: l'adattatore CLI locale nasce prima; i comandi remoti vengono aggiunti quando i rispettivi servizi funzionano. Anche il mobile deve funzionare offline prima della replica.

Dopo P00 possono procedere in parallelo file, editor, shell, ecosistema e personalizzazione. Dopo le proprietà si separano ricerca, viste dati e importatori. Pubblicazione non dipende dalla replica: può usare un vault locale. Autenticazione condivisa fra servizi è riuso infrastrutturale, non accoppiamento obbligatorio fra le due feature.

Il percorso critico è correttezza dei file → proprietà e riferimenti → superfici e migrazioni → servizi distribuiti → prova multipiattaforma. Non sono fissate date senza owner, capacità del team e misure dei rischi tecnici.

## Pacchetti di implementazione

### P00 — Consolidare la baseline senza assorbire lavoro estraneo

**Owner:** manutenzione repository, shell e host.

1. Separare codice integrato, modifiche locali e capacità soltanto documentate. Concordare l'integrazione del renderer in corso prima di modificare gli stessi file.
2. Registrare le funzionalità effettivamente montate: un tipo, una fixture o un esempio deliberatamente differito non basta.
3. Trasformare F01–F45 in criteri delle issue; riusare #9, #57 e #58 invece di crearne duplicati. Le altre issue vengono aperte solo quando il piano è approvato.
4. Preparare un corpus di accettazione con Unicode, omonimi, link rotti, YAML complesso, CRLF, allegati, file sconosciuti, note grandi e configurazioni parzialmente corrotte.
5. Riutilizzare fake host, `MemoryHost`, `fub-testkit`, scene visuali e componenti reali WASM. Distinguere prove dei comportamenti dai guard strutturali.

**Uscita:** ogni famiglia ha baseline, owner e prova identificati; nessuna modifica utente viene persa; il candidato iniziale resta valutabile indipendentemente dall'intera espansione.

### P01 — Completare vault, operazioni sui file e recupero

**Owner:** `fub-kernel`, orchestrazione in `fub-host`, adattatori OS in `fub-app`.

1. Completare preferenze per destinazione delle note e degli allegati, gestione di tutti i tipi, esclusioni e operazioni di explorer, preservando i controlli di path e collisione.
2. Pianificare rinomine/spostamenti e riscrittura dei link con preimmagini e conflitti espliciti; migrare bozze, organizzazione e dati per-documento insieme all'identità. Per operazioni multi-file introdurre un protocollo recuperabile, non una sequenza presentata come atomica.
3. Aggiungere opzioni di cestino OS/interno e conferma della cancellazione irreversibile. Il backend OS non deve diventare una dipendenza del kernel.
4. Integrare UI di recupero, confronto versioni, copia della versione e ripristino. Includere i nuovi formati autorevoli, non soltanto Markdown. Separare retention delle versioni, bozze e snapshot.
5. Esporre il protocollo di snapshot completo offline con preflight, destinazione verificata e recovery. Non sostituirlo con `fub.backup`, che ha uno scope diverso.
6. Per cartelle collegate esterne progettare mount espliciti e autorizzati, con namespace, rilevamento cicli e target disgiunti; non abilitare indiscriminatamente i symlink oggi esclusi. I link alla configurazione condivisa non devono creare scritture concorrenti non protette.

**Uscita:** collisioni di nomi, rinomine concorrenti, editor esterni, disco pieno, crash e ripristino preservano il valore precedente o producono un conflitto recuperabile. Provare i confini filesystem reali, Unicode/case e piattaforme supportate; dimostrare che uscire dal vault tramite link non aggira i permessi.

### P02 — Completare editor e semantica Markdown

**Owner:** `fub-format-markdown`, `editors/text/`, renderer condiviso e adapter della superficie.

1. Consolidare sorgente, anteprima dal vivo e lettura sulla sessione esistente; conservare selezione, scroll e undo locale. Non reintrodurre il pannello di anteprima eliminato dal lavoro in corso.
2. Completare sintassi e resa: commenti, evidenziazione, task, note a piè di pagina anche inline, callout annidati e ripiegabili, link/alias/ID di blocco, immagini dimensionate, tabelle e combinazioni con escape.
3. Integrare un renderer matematico per `$...$` e `$$...$$`, con caricamento differito, errori leggibili e limiti di complessità. Mantenere Mermaid isolato e rendere navigabili i suoi link consentiti, senza dedurre automaticamente archi del grafo dal diagramma.
4. Aggiungere editing tabellare contestuale: inserimento, eliminazione, spostamento e ordinamento di righe/colonne. Le trasformazioni producono operazioni di testo verificabili e un undo coerente.
5. Completare folding, multi-cursore, selezione rettangolare, indentazione, liste intelligenti, accoppiamento delimitatori, incolla HTML→Markdown, spellcheck, RTL, larghezza leggibile e profilo Vim.
6. Implementare outline con riordino delle sezioni e vista note a piè di pagina. Riferimenti e reveal usano span in byte, senza confondere offset JavaScript.
7. Supportare HTML ammesso tramite sanitizzazione; contenuti attivi e iframe passano solo dal percorso remoto isolato di P07, non da HTML libero nella shell. Definire l'assenza di Markdown dentro blocchi HTML come regola esplicita.

**Uscita:** corpus identico nei modi pertinenti, sorgente invariata fuori dagli intervalli modificati, task e trasformazioni annullabili, nessuna esecuzione di script in contenuti non fidati. Verificare due superfici dello stesso documento, IME, emoji, CRLF e navigazione da tastiera sulla resa reale.

### P03 — Rendere le proprietà un modello utente coerente

**Owner:** semantica YAML nel formato, metadati e query nel kernel, provider `properties` e frontend.

1. Estendere le proprietà esistenti con tipi testo, lista, numero, checkbox, data, data-ora e tag; preservare `aliases`, `tags` e classi visuali per nota.
2. Definire il tipo per nome a livello vault, con impostazione persistente versionata e comportamento per valori incompatibili. Separare valore autorevole, interpretazione tipizzata e indice ricostruibile.
3. Aggiungere editor integrato e view file/globale, ricerca per proprietà, conteggi e rinomina di una proprietà in tutto il vault. Prevedere visualizzazione nascosta, strutturata o sorgente.
4. Sostituire, dove serve, la riscrittura dell'intero frontmatter con trasformazioni lessicali mirate. Commenti, ordine e citazioni non coinvolti devono restare intatti; YAML non rappresentabile resta modificabile in sorgente.
5. Rendere coerenti filtri, ordinamenti, date, fusi, liste, valori assenti/vuoti/null e merge delle proprietà inserite da un template. Le strutture annidate non vanno appiattite silenziosamente.

**Uscita:** editing UI↔sorgente, query e riapertura concordano; una rinomina di proprietà interrotta è riprendibile o annullabile. Coprire numeri invalidi, date ambigue, liste di link, YAML sconosciuto e scritture esterne concorrenti.

### P04 — Completare ricerca, collegamenti e grafo

**Owner:** `fub-kernel::index`, grafo e occorrenze; provider `search`, `queries`, `backlinks`, `tags`, `graph`; shell dei risultati.

1. Inventariare gli operatori già presenti prima di estendere il linguaggio: AND/OR/negazione, gruppi, frasi, regex, file/path/content, case, tag, proprietà, righe, blocchi, sezioni e task aperti/completati.
2. Condividere una sola semantica fra ricerca globale, query salvate, filtri delle viste e ricerca incorporata. Aggiungere spiegazione degli errori, recenti, contesto, ordinamento, copia risultati ed esclusioni coerenti.
3. Completare risoluzione per alias, heading e blocco, ricerca globale dei target e suggerimenti. Rinomine devono aggiornare soltanto i riferimenti corretti, non stringhe omonime in codice o testo estraneo.
4. Aggiungere link uscenti e menzioni non collegate in entrata/uscita, con contesto, filtri e trasformazione esplicita in link. Evitare scansioni quadratiche per ogni battuta.
5. Estendere il grafo con vista locale e profondità, gruppi da query, tag/allegati/orfani, forze, frecce e animazione temporale. Riutilizzare motore Canvas, accessibilità e lifecycle esistenti.
6. Completare vista tag ad albero/piatta, ordinamenti e filtri multipli; rendere pannelli collegati e backlink nel documento opzioni di presentazione, non indici duplicati.

**Uscita:** query equivalenti producono gli stessi risultati nei diversi consumer; operatori costosi sono limitati e cancellabili. Confrontare indice incrementale e ricostruito, coprire negazioni/null/alias/omonimi e mantenere i gate grafo 2k/10k già presenti.

### P05 — Completare i workflow di scrittura

**Owner:** provider ufficiali indipendenti in `fub-features`; selezione e inserimento al cursore nella shell.

1. Estendere `note.daily` con percorso, formato data e template configurabili; rendere deterministico l'orologio nei test e collegare le proprietà data alla nota corrispondente.
2. Estendere template con titolo, data, ora e formati espliciti, inserimento al cursore e merge delle proprietà. Evitare un linguaggio di scripting arbitrario per interpolazioni semplici.
3. Aggiungere creazione di note con nome univoco, gestione collisioni, nota casuale e inserimento rapido di data/ora.
4. Aggiungere comandi slash usando il registro dei comandi, recenti e preferiti della palette, contesto valido e annullamento senza modificare il buffer.
5. Implementare il compositore: estrazione selezione, merge append/prepend, creazione destinazione, template di estrazione e sostituzione con link/embed. Pianificare aggiornamenti dei riferimenti e dati associati prima di eliminare una sorgente.
6. Completare statistiche di documento/selezione e conteggio di lingue senza spazi, con aggiornamenti incrementali e posizione appropriata su desktop/mobile.

**Uscita:** percorsi, fusi e collisioni sono riproducibili; una composizione interrotta non perde testo né allegati; undo e conflitti preservano entrambe le versioni. Provare il provider con `MemoryHost` e il percorso completo nella sessione reale.

### P06 — Completare navigazione e organizzazione della shell

**Owner:** `state/layout`, pannelli documento/explorer, registro superfici e comandi UI.

1. Estendere tab e split con pin, stack, riordino, cronologia avanti/indietro, trascinamento tra gruppi e sidebars, tab collegati alla stessa nota e finestre desktop aggiuntive.
2. Prima delle finestre multiple definire l'ownership della sessione fra webview/processi. Non creare due buffer autorevoli solo perché l'interfaccia usa due finestre.
3. Implementare workspace nominati e versionati: save/load/update/rename/delete, dimensioni e visibilità pannelli. Riferimenti mancanti e plugin disabilitati producono fallback, non perdita del layout.
4. Generalizzare le note appuntate in segnalibri eterogenei, con gruppi, riordino e salvataggio di più tab; mantenere distinti vault preferiti e recenti.
5. Completare cambio rapido per nome/alias, creazione da ricerca e modificatori di apertura; pagina in anteprima al passaggio con opzione modificatore, ritardo, tastiera e chiusura deterministica.
6. Offrire menu contestuali e comandi per tutte le azioni di drag-and-drop. Conservare l'indipendenza fra modalità della superficie, tab e documento.

**Uscita:** riapertura e caricamento workspace preservano layout valido e dati dirty; chiudere una finestra non distrugge una sessione ancora usata. Provare focus, tastiera, screen reader, tab mancanti e ripetuti mount/unmount senza risorse residue.

### P07 — Consegnare media, PDF, registrazione e web viewer

**Owner:** provider di formato e risorse host, superfici frontend; permessi dispositivo e webview nell'adattatore piattaforma.

1. Implementare superfici per immagini, audio/video e PDF; dichiarare formati e codec per piattaforma, fallback leggibili e limiti. PDF deve consentire navigazione, ricerca testo, copia/link a pagina e apertura di embed con altezza configurabile.
2. Completare paste/drop/download allegati con destinazione configurabile, collisioni, URL relativi e conservazione del nome originale. I download remoti sono espliciti e non un effetto collaterale dell'apertura di una nota.
3. Aggiungere registrazione audio con consenso al microfono, indicatore, interruzione e salvataggio recuperabile; inserire l'embed senza legare la durata del file alla presenza del link nel testo.
4. Aggiungere presentazioni da separatori Markdown, navigazione, schermo intero e uscita accessibile, riusando la resa del documento.
5. Implementare web viewer desktop isolato con tab, navigazione, modalità lettura, blocco contenuti indesiderati, apertura nel browser esterno e salvataggio come nota. Un iframe nel DOM fidato non soddisfa il requisito.
6. Separare origine, cookie, storage e permessi del viewer dalla shell e dai plugin; impedire lettura di credenziali e accesso al bridge host dalle pagine. Prevedere una policy esplicita per incorporamenti web in note e lavagne.
7. Integrare stampa/export PDF con resa prevedibile di formule, diagrammi, note e interruzioni di pagina.

**Uscita:** esercitare file reali e corrotti, grandi allegati, revoca del microfono, errori decoder, rete negata e chiusura durante il caricamento. La registrazione già acquisita resta recuperabile; una pagina ostile non può leggere il vault o invocare comandi applicativi.

### P08 — Introdurre viste dati sulle note

**Owner:** query e metadati nel kernel, provider dedicato per definizioni di vista, frontend per interazione e virtualizzazione.

1. Definire e implementare un documento di vista `.base` compatibile con la sintassi pubblicamente documentata, senza trasformare le note in righe di un database proprietario. Le proprietà delle note restano autorevoli.
2. Supportare viste multiple, nomi e ordinamento, tabella/schede/lista, colonne e etichette, filtri globali e locali, ordinamenti multipli, raggruppamento, limite risultati e ricerca nella vista.
3. Implementare formule tramite parser e valutatore limitato, non `eval`: numeri, stringhe, booleani, date/durate, liste, oggetti, file e link; namespace nota/file/formula e contesto del documento contenitore.
4. Coprire operatori, funzioni per tipo, dipendenze fra formule e rilevamento cicli. Congelare una matrice delle funzioni supportate con esempi di compatibilità, inclusi link/tag/cartelle e trasformazioni di liste/oggetti.
5. Aggiungere riepiloghi numerici, date, checkbox, vuoti/pieni/unici e riepiloghi personalizzati; editing delle proprietà, creazione nota dalla vista, copia risultati ed export CSV.
6. Supportare incorporamento del file e di una vista nominata, oltre a definizioni in blocchi di codice. Backlink/proprietà derivati devono dichiarare costo e modalità di invalidazione.
7. Aggiungere board Kanban: il drag modifica una proprietà scrivibile; gruppi da formula o metadati del file non fingono di essere editabili. Aggiungere mappe con coordinate, marker, colori e provider raster/vettoriali, con consenso rete, chiavi e attribuzioni.
8. Riutilizzare componenti Grid dove utile alla resa; non forzare query di note nel protocollo mutativo del workbook `.fubsheet`. Eventuali API di layout estensibili nascono dopo la consegna nativa e il caso WASM reale.

**Uscita:** la stessa definizione riaperta o incorporata produce risultati coerenti; modificare una cella aggiorna la nota e tutti i consumer pertinenti. Verificare versioni future, formule invalide/cicliche, dati grandi, paginazione, conflitti e mappe senza rete. Nessuna funzione sconosciuta produce un valore finto.

### P09 — Introdurre lavagne interoperabili

**Owner:** nuovo provider di formato, sessione esistente e superficie dedicata della shell.

1. Adottare il formato aperto [JSON Canvas](https://jsoncanvas.org/) per `.canvas`, con identificatori di nodi/archi stabili, conservazione di campi sconosciuti e fallback sorgente quando la vista non è disponibile.
2. Implementare schede testo, note/file, immagini/media e pagine web; conversione testo→nota, sostituzione del file e trascinamento di cartelle senza duplicare gli asset.
3. Aggiungere connessioni orientate, etichette e colori, riconnessione, gruppi, selezione multipla, duplicazione, ordine visivo, allineamento e ridimensionamento.
4. Implementare pan/zoom, adatta tutto/selezione, snap, navigazione da tastiera e modalità a moto ridotto; usare disegno proporzionale all'area visibile.
5. Definire undo, salvataggio e conflitti per operazioni strutturate; aggiornare riferimenti quando un file cambia path. Distinguere link di una scheda-file da testo non ancora convertito in nota.
6. Aggiungere embed della lavagna e anteprima/esportazione coerenti. I contenuti web riusano l'isolamento P07; non eseguono JavaScript nel processo fidato.

**Uscita:** aprire, modificare, salvare e riaprire fixture interoperabili senza perdere campi o collegamenti; provare crash, conflitti, file mancanti e grandi scene. Pubblicare una nuova famiglia ABI solo con shell, fallback, mirror e percorsi nativo/WASM realmente esercitati.

### P10 — Consegnare importazione, conversione e migrazione

**Owner:** provider `ImportProvider`/`ExportProvider`, orchestrazione job e storage nell'host/kernel.

1. Usare le porte di transfer esistenti, staging e manifest: selezione, analisi, anteprima, mappatura, esecuzione cancellabile e rapporto finale. Non importare direttamente sopra i file di origine.
2. Coprire Markdown/cartelle/ZIP, HTML, CSV, Textbundle/Textpack; convertire righe CSV in note e viste dati, con inferenza controllata dei tipi.
3. Aggiungere i connettori della matrice sottostante; preservare contenuto, gerarchia, metadati, date, tag, link e allegati quando disponibili. Un valore senza equivalente resta dato sorgente o viene segnalato, non sparisce.
4. Aggiungere template di importazione con preview su campioni e variabili di origine; condividere le regole pertinenti con l'acquisizione browser senza mescolare accesso rete e trasformazione pura.
5. Implementare conversioni di sintassi, task, evidenziazioni, nomi univoci e proprietà legacy come comandi con anteprima e backup. Coprire importazioni ripetute, identificatori sorgente e collisioni.
6. Fornire export Markdown fedele, copia dei risultati, CSV e PDF; documentare quali interazioni dinamiche vengono trasformate in output statico.

| Sorgente | Ingresso | Vincoli da rappresentare nell'anteprima |
|---|---|---|
| Notion | API o archivio HTML | API per database, formule e viste; permessi/rate limit; archivio senza equivalenza completa dei database |
| Airtable | API con token e selezione tabelle | Relazioni e viste compatibili; formule/rollup non traducibili segnalati o conservati come valori |
| OneNote | Account autorizzato, `.one`, `.onepkg` | Notebook posseduti, sezioni protette e policy organizzative; gerarchie di pagine e sottopagine |
| Evernote | `.enex` | Notebook, stack, tag, risorse e collegamenti ricostruibili |
| Apple Notes | Dati locali autorizzati su macOS | Note bloccate, scansioni e allegati; nessuna lettura implicita di archivi privati |
| Apple Journal | Export HTML | Metadati opzionali, media e percorsi; dati personali non pubblicati per default |
| Google Keep | Archivio Takeout | Checklist, etichette e stato; promemoria/assegnazioni non ricostruibili dichiarati |
| Bear | Backup applicativo/archivio dati | Tag, sintassi, allegati e link da normalizzare |
| Craft | Export Markdown | Collegamenti non standard e struttura delle cartelle |
| Roam | Export JSON | Blocchi, riferimenti e download allegati opzionale |
| Logseq | Grafo basato su file | Diario, outline, proprietà e asset; query/macro preservate come testo se non traducibili; archivio database distinto |
| Tomboy/Gnote | `.note` XML | Gerarchia, formattazione e link disponibili |
| HTML/CSV/Markdown/Textbundle | File, cartelle o archivi | Encoding, traversal, archivi compressi ostili, allegati remoti e delimitatori |

**Uscita:** fixture reali rappresentative, importazione ripetibile e annullabile, hash degli asset conservati e rapporto delle perdite potenziali prima del commit. Provare autorizzazioni negate, token revocati, archive bomb, path traversal, interruzione e riavvio.

### P11 — Completare la piattaforma delle estensioni

**Owner:** `fub-wasm-host`, `fub-host`, SDK e shell dichiarativa.

1. Conservare installazione, consenso, `enabled` e istanza montata come stati distinti; esporli chiaramente nell'interfaccia, con modalità limitata e avvio di recupero.
2. Completare #57 con provider reali inbound di indice ed eventi: feed/query/flush/close e consegna delle notifiche, stesso registro del nativo, errori e teardown. Non promuovere le sonde esistenti a prova di supporto.
3. Affrontare #58 con un modello di minaccia esplicito: mantenere limiti per-store e valutare worker/processi isolati per quote forti. Dichiarare le garanzie effettive di ciascuna piattaforma.
4. Aggiungere catalogo di plugin e temi con provenienza, compatibilità, licenza, digest/firma verificabile, ricerca, installazione, aggiornamenti manuali controllati e rollback. Gestire rimozione dal catalogo e revoca senza cancellare dati utente.
5. Completare le API realmente richieste per comandi, toolbar/status, impostazioni, view, indici, eventi e formati. Nuove superfici dati/lavagna attraversano il gate pubblico esistente, non un canale JSON universale.
6. Fornire esempi, strumenti di sviluppo, ricaricamento in ambiente controllato, diagnostica e guida al porting. Il codice dei plugin non eredita filesystem, cookie del viewer o runtime JavaScript privilegiato.

**Uscita:** componente reale per ogni famiglia, parità nativo/WASM e prove di deny, trap, timeout, memoria, aggiornamento interrotto, mount parziale e rimozione. Tutte le registrazioni spariscono al teardown; un'estensione spenta non rende inutilizzabili le note.

### P12 — Completare preferenze, temi e accessibilità

**Owner:** impostazioni host/kernel, contratto tema e shell.

1. Consolidare preferenze vault/macchina e profili, import/export, reset e avviso sui cambi che richiedono riapertura. Riutilizzare validazione e gestione delle chiavi sconosciute/sospese.
2. Completare hotkey multiple per comando, rilevamento conflitti, filtri, layout di tastiera e sincronizzazione selettiva. Non sovrascrivere binding locali con dati non ancora approvati.
3. Estendere personalizzazione di ribbon, toolbar e status bar, font, dimensioni, colori, larghezza, titoli, zoom e opzioni della cornice dove la piattaforma le offre.
4. Aggiungere snippet CSS abilitabili, caricamento locale e classi per nota sul contratto `theme-1`; limitare import e URL remoti e rendere visibile il livello di fiducia. Aggiornamenti e preview devono essere reversibili.
5. Applicare localizzazione, contrasto, tastiera, screen reader, riduzione del movimento e zoom a tutte le nuove superfici, non soltanto alle impostazioni.

**Uscita:** import/export impostazioni e cambio profilo non perdono valori non rappresentabili; tema o snippet difettoso è disattivabile senza bloccare l'app. Verificare resa chiara/scura, contrasto, font grandi, focus e preferenze OS sulle superfici reali.

### P13 — Esporre automazione locale e client headless

**Owner:** nuovi adattatori di processo sopra `fub-host`; integrazione URI nell'adattatore OS.

1. Definire URI `fub://` per aprire vault/file/heading, creare note, giornaliere o univoche, cercare, append/prepend e scegliere destinazione/tab/split/finestra. Canonicalizzare encoding e path; vietare traversal e operazioni privilegiate implicite.
2. Supportare callback di successo/errore solo con policy esplicita, schema autorizzato e protezione contro apertura di URL o scrittura di contenuti non richiesti.
3. Creare CLI scriptabile e modalità interattiva: help, completamento, history, targeting vault/file, exit code, JSON/CSV/TSV/Markdown e copia. Esporre tramite i registri file, ricerca, proprietà, link, task, template, viste, comandi, plugin, temi e diagnostica.
4. Distinguere comandi che pilotano una GUI in esecuzione e processi standalone; proteggere il trasporto locale e impedire due writer non coordinati sullo stesso vault.
5. Implementare client headless per login, configurazione, replica one-shot/continua e pubblicazione con dry-run. Credenziali fuori da log, history e argomenti visibili quando esistono alternative sicure.
6. Strumenti di screenshot, log, ispezione e automazione della UI restano capacità di sviluppo esplicitamente abilitate; nessun endpoint remoto di esecuzione arbitraria viene aperto per default.

**Uscita:** flussi reali da terminale senza GUI dove previsto, output e codici stabili, input malformati rifiutati, SIGINT gestito e operazioni durevoli recuperabili. Il comando non dichiara successo prima del commit né finge disponibile un servizio non configurato.

### P14 — Portare il prodotto su mobile

**Owner:** adattatori piattaforma, shell responsive e host; nessuna dipendenza mobile nel kernel.

1. Validare su iOS/iPadOS e Android il runtime scelto, accesso a documenti, memoria, decoder e distribuzione. Verificare subito i vincoli del runtime WASM/JIT e degli store: le build desktop non dimostrano supporto mobile.
2. Implementare navigazione touch, tab switcher, sidebars, azione rapida, toolbar configurabile, tastiera virtuale/fisica, selezione, zoom e drag dove disponibile.
3. Esporre scelta esplicita fra spazio privato dell'app e cartelle autorizzate quando il sistema lo consente; spiegare conseguenze di disinstallazione, permessi revocati e file non disponibili offline.
4. Aggiungere share sheet/capture con destinazione nuova nota, giornaliera, nota esistente o segnalibro e template; widget, scorciatoie, azioni rapide e integrazioni di ricerca/assistente previste dall'OS.
5. Collegare replica e salvataggio al lifecycle reale: sospensione, riavvio e ritorno in primo piano. Non promettere sincronizzazione continua in background dove il sistema non la consente.
6. Portare i provider supportati con semantica e permessi equivalenti. Se serve un backend WASM diverso, dimostrare il contratto con componenti reali prima di dichiarare compatibilità.

**Uscita:** vault utilizzabile offline, modifica persistente dopo terminazione del processo, ripresa senza perdita e share realmente eseguito da altre app. Verificare dispositivi/emulatori di entrambe le piattaforme, tablet, rotazione, tastiera e limiti di storage; i limiti residui sono dichiarati per capacità, non nascosti dietro «responsive».

### P15 — Introdurre acquisizione browser e lettura web

**Owner:** estensione browser separata; trasformazioni pure condivise con importatori; ingresso autorizzato nell'host.

1. Realizzare estensione per Chromium, Firefox e Safari, incluse varianti mobile supportate, con permessi minimi e verifica specifica della distribuzione di ciascun browser.
2. Acquisire articolo, selezione, evidenziazioni o pagina, con reader mode, sommario, metadati e anteprima Markdown. Persistenza delle evidenziazioni ed export devono restare sotto controllo dell'utente.
3. Implementare template importabili/esportabili, trigger URL/regex/dati strutturati, destinazione vault/cartella, nuova nota o append/prepend a nota esistente/giornaliera.
4. Supportare variabili predefinite, HTML, metadati, selettori CSS e dati strutturati; filtri per testo, date, numeri, HTML→Markdown, link, immagini, array e oggetti. Aggiungere condizioni, variabili, fallback e cicli con limiti di esecuzione, non JavaScript arbitrario.
5. Distinguere URL di immagini e allegati scaricati; offrire download esplicito e limiti, senza trasformare una visita in una richiesta remota invisibile.
6. Aggiungere interpretazione assistita opt-in con provider locale o remoto, API key protetta, contesto selezionabile, anteprima della richiesta e gestione degli errori. Mostrare chiaramente quali dati lasciano il dispositivo; il risultato non scrive senza la decisione dell'utente.
7. Autenticare il canale estensione→app e richiedere approvazione per vault/destinazione; una pagina web non può impersonare l'estensione o impartire comandi attraverso il contenuto catturato.

**Uscita:** capture reale nei browser previsti, pagine dinamiche, articoli lunghi, HTML ostile, template importati e rete assente. Senza interprete o chiave API l'acquisizione ordinaria resta completa; nessun contenuto viene inviato a terzi per default.

### P16 — Implementare sincronizzazione distribuita e condivisione

**Owner:** servizio di replica e adattatori host separati dal kernel; persistenza locale nel kernel; backend remoto come componente nuovo esplicito.

1. Usare #9 come riferimento, senza reinterpretare watcher o journal locale come protocollo di replica. Definire identità di replica, ordinamento causale, tombstone, deduplicazione, ack e coda durevole; il journal senza contenuto non basta.
2. Progettare il rapporto tra `DocId` basato su path e identità di replica, soprattutto per rename concorrenti. Un'identità interna del protocollo non deve cambiare implicitamente il contratto pubblico dei documenti.
3. Implementare account, MFA, dispositivi, vault remoti multipli, regioni/configurazione, quote e disconnessione/eliminazione remota senza eliminare la copia locale. Se il servizio è a pagamento, includere entitlement, scadenza, esportazione e retention esplicita.
4. Implementare cifratura end-to-end autenticata con librerie consolidate, chiavi per vault/dispositivo, gestione e recupero espliciti, rotazione e revoca. La password account e la chiave dei dati non sono la stessa cosa; gli hash esistenti non sono primitive crittografiche adatte a questo scopo.
5. Replicare note e allegati a blocchi/flussi con limiti; aggiungere esclusioni, selezione per tipo/cartella e categorie di configurazione. Separare impostazioni condivise, segreti, cache, bozze e stato macchina; sincronizzare una lista plugin non equivale ad autorizzare codice su un nuovo dispositivo.
6. Definire conflitti per testo, binari, lavagne, viste e impostazioni. Preferire un conflitto non distruttivo a un merge ambiguo; offrire merge quando verificabile e copie di conflitto altrimenti, con confronto e attribuzione.
7. Consegnare stato per file/vault, pausa/ripresa, log depurati da segreti, versioni remote, cestino e ripristino di file/impostazioni. Chiarire che replica e cronologia non sostituiscono un backup indipendente.
8. Aggiungere vault condivisi con inviti, ruoli, revoca e distribuzione delle chiavi; la revoca non può cancellare copie già scaricate da un altro utente. Condivisione asincrona non promette cursori condivisi o coediting in tempo reale.
9. Integrare desktop, mobile e headless, con modalità bidirezionale, sola lettura remota e mirror solo se la semantica distruttiva è esplicita. Rilevare o segnalare la sovrapposizione con altri sincronizzatori sulla stessa cartella.

**Uscita:** harness deterministico a due o più repliche con partition/rejoin, riordino, duplicazione, modifiche concorrenti, rename/delete, clock divergenti e riavvio. Dimostrare convergenza o conflitto conservativo, ack durevoli, integrità degli allegati, revoca/rotazione e limiti di coda/memoria durante soak. Servono anche client e backend reali: il solo harness non consegna il servizio.

### P17 — Implementare pubblicazione e siti condivisi

**Owner:** pipeline di export e job host, renderer web controllato, servizio di pubblicazione distinto dall'app locale.

1. Creare siti multipli con proprietario, collaboratori, autenticazione, quote e lifecycle. L'account può essere condiviso con altri servizi senza rendere la replica necessaria per pubblicare.
2. Implementare selezione nuovo/modificato/invariato/rimosso, proprietà di inclusione/esclusione, cartelle e aggiunta dei file collegati. Anteprima del manifest e delle dipendenze prima dell'invio; i collegamenti non autorizzano da soli la pubblicazione di note private.
3. Generare pagine e asset con navigazione configurabile, home, titoli, ricerca, outline, backlink, grafo e anteprima link. Riutilizzare la semantica di resa senza distribuire le API privilegiate dell'app.
4. Implementare permalink, redirect da URL precedenti, metadati SEO/social, sitemap, RSS, robots, domini personalizzati, TLS e instradamento sotto un prefisso.
5. Supportare temi, CSS, favicon e personalizzazioni del sito. JavaScript personalizzato, analytics e contenuti remoti richiedono policy esplicita e non ereditano accesso al vault; nessun tracciamento di default.
6. Aggiungere password a livello sito, permessi separati per pubblicare e amministrare, collaborazione e risoluzione dei conflitti fra versione remota e locale. Non trasformare un download del sito in una sovrascrittura silenziosa delle note.
7. Definire output per embed, lavagne e viste dati. Il contenuto dinamico deve avere una proiezione pubblicabile verificata o un errore di preflight; non eseguire plugin arbitrari sul server per ottenere una pagina.
8. Implementare pubblicazione/rimozione atomica per manifest, rollback, invalidazione cache e CLI/headless con dry-run. Definire limiti media e assenza di streaming dedicato se non previsto dal servizio.

**Uscita:** pubblicare e rimuovere un sito reale, verificare dominio/TLS, password, revoca collaboratore, link e asset, mobile, ricerca e SEO. Una nota esclusa non compare in HTML, indici, grafo, feed, sitemap o cache; la rimozione non cancella il file locale. Il servizio continua a funzionare senza la sincronizzazione attiva.

### P18 — Verificare e rilasciare le capacità dichiarate

**Owner:** owner dei pacchetti, distribuzione e manutenzione del progetto.

1. Rieseguire F01–F45 sullo stato finale, distinguendo consegnato, sperimentale e non ancora consegnato. Chiudere issue soltanto dopo integrazione e prove dei criteri, non dopo aver aggiunto un tipo o una schermata.
2. Completare onboarding, vault dimostrativo isolato, aiuto contestuale, diagnostica, avvio senza plugin e recupero da configurazione difettosa. Il vault dimostrativo non deve toccare dati reali.
3. Distribuire artifact desktop firmati e pacchetti mobile previsti; verificare installazione, aggiornamento, disinstallazione e conservazione dei dati. Esporre versione e controlli aggiornamento; separare canali stabili e sperimentali.
4. Definire aggiornamenti sicuri e rollback compatibile con gli schemi; non aprire dati migrati con una versione incompatibile senza errore o procedura esplicita.
5. Aggiornare pagine canoniche, riferimenti, SDK e changelog solo per comportamento integrato. Dopo accettazione, spostare il lavoro eseguibile nelle issue e non usare questo documento come certificazione permanente.

**Uscita:** ogni capacità pubblicizzata ha percorso end-to-end, prova del confine, documentazione e artifact della piattaforma. Il completamento dell'intero piano richiede tutti i pacchetti, inclusi servizi e mobile; una release locale precedente mantiene una dichiarazione più limitata e verificabile.

## Strategia di verifica

### Prove da associare alle consegne

| Area | Prova minima | Errori che deve intercettare |
|---|---|---|
| Regole e provider | Unit test mirati, `MemoryHost`, fixture di sorgente | Semantica errata, conversioni distruttive, dipendenze da feature disabilitate |
| Storage e sessioni | Test del crate e integrazione con `fub-testkit` | Conflitti, perdita dati, interruzione, recovery, migrazione e versioni future |
| ABI/WIT/IPC | Conformità, frozen additivo, mirror/fixture/fake host e componente reale | Drift di tipo, rotture di compatibilità, famiglia nominalmente disponibile ma non servita |
| Editor e shell | Vitest dei contratti osservabili, type-check, build e interazione reale | Undo contaminato, offset errati, risultati obsoleti, focus e teardown |
| Resa | Browser o webview reale, banco visuale e accessibilità | Formula non resa, media non caricati, differenze fra modalità, contenuto attivo |
| Runtime plugin | Componente nativo e WASM su piattaforma supportata | Deny, trap, timeout, memoria, mount parziale e risorse residue |
| Importazione | Fixture per sorgente e confronto dei dati prima/dopo | Asset persi, riferimenti rotti, troncamento, collisioni e import doppio |
| Mobile | Emulatore e dispositivo, lifecycle OS e share tra app | Perdita alla sospensione, permessi scaduti, tastiera e storage privato |
| Replica | Harness deterministico, servizio reale e soak | Divergenza silenziosa, perdita dopo ack, code illimitate e segreti esposti |
| Pubblicazione | Sito reale, scanner dei contenuti pubblicati e prove di accesso | Pubblicazione di dati privati, revoche inefficaci, redirect o cache errati |
| Documentazione | Tutti i guard richiesti e controllo della copertura | Link rotti, stato futuro presentato come presente e criteri senza owner |

Non aggiungere test che controllano soltanto il nome di una funzione, il testo di una descrizione o l'esistenza di un pulsante. Conservare regressioni per invarianti plausibilmente fragili; usare anche prove temporanee e smoke test che eseguono davvero il nuovo comportamento.

### Comandi e budget esistenti

La fonte eseguibile resta [CONTRIBUTING.md](CONTRIBUTING.md) insieme ai workflow CI. Nel ciclo pertinente:

- Rust: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --no-fail-fast`, `cargo deny check`.
- Frontend, da `apps/client/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run bench:a11y`, `npm run bench:verify`.
- Grafo: mantenere le fixture e i comandi 2k/10k, incluso il soak a 16 finestre, definiti nel [budget prestazionale](docs/product/performance-budget.md). I budget osservazionali non diventano promesse universali.
- Contratti e renderer: eseguire i guard dei confini CodeMirror, dei consumatori delle famiglie pubbliche, delle dipendenze e delle proiezioni interessate.
- Documentazione: guard link, orfani, dimensioni, Mermaid con rendering, stile Markdown, prosa, tabelle e coerenza del ciclo locale.

Per nuove superfici misurare avvio, input, query, caricamento asset, memoria e teardown su fixture dichiarate. Il gate grafo sul resource delta resta zero; il gate heap esistente resta riferito alla sua fixture. Non inventare soglie universali per database, lavagne o mobile prima di misurare hardware e carichi rappresentativi.

## Decisioni preliminari e rischi da chiudere

| Decisione | Quando va chiusa | Criterio di scelta |
|---|---|---|
| Identità di replica rispetto ai path | Prima del protocollo P16 | Rename concorrenti e riavvio senza cambiare implicitamente `DocId` |
| Proprietà tipizzate e patch YAML | Prima di P03/P08 | Nessuna perdita di commenti, dati sconosciuti o semantica delle date |
| Formati `.base` e `.canvas` | Prima di persistere dati P08/P09 | Interoperabilità verificata, versioni future, fallback e limiti |
| Ownership fra finestre e processi | Prima del multi-window P06 e della CLI P13 | Una sola autorità per documento e nessun writer incontrollato |
| Runtime mobile e plugin | All'inizio di P14 | Capacità dimostrata su iOS/Android, restrizioni store e parità del contratto |
| Isolamento viewer e codice terzo | Prima di P07/P11 | Nessuna eredità di bridge host, cookie o permessi impliciti |
| Modello crittografico e gestione chiavi | Prima del primo dato remoto P16 | Revisione dedicata, librerie consolidate, recupero e revoca verificabili |
| Infrastruttura dei servizi | Prima di P16/P17 | Costi operativi, quote, regioni, backup, retention, incidenti e cancellazione account |
| Permessi estensione e interprete | Prima di P15 | Consenso granulare e niente invio automatico di pagine o credenziali |
| Cartelle esterne collegate | Prima dell'estensione P01 | Recinto di sicurezza, namespace e assenza di cicli/duplicazioni |

Un ADR serve alle decisioni pubbliche o costose da invertire; non trasforma un'ipotesi in API corrente. Mancano ancora decisioni di prodotto e infrastruttura per i servizi e prove di runtime per mobile: sono dipendenze di implementazione nominate, non motivi per eliminare quelle capacità dal piano.

## Definizione di completamento

Il programma è completo quando:

- ogni riga F01–F45 è consegnata con criteri osservabili, compresi i moduli ufficiali aggiuntivi e i client esterni;
- le capacità già presenti non sono state riscritte inutilmente né degradate;
- dati, revisioni, permessi e teardown restano corretti nei casi negativi;
- i nuovi formati hanno autorità, schema, compatibilità e recupero espliciti;
- desktop, mobile, automazione e servizi hanno prove reali, non soltanto fake host o fixture;
- feature disattivate, rete assente e servizi non configurati non impediscono il lavoro locale;
- documentazione, release e interfaccia dichiarano esattamente ciò che è supportato;
- limitazioni intenzionali e canali sperimentali sono visibili, senza spacciare sincronizzazione locale, un placeholder di superficie o un tipo WIT per una feature completa.

## Riferimenti del progetto

- [Contribuzione e ciclo di verifica](CONTRIBUTING.md)
- [Mappa della documentazione](docs/README.md)
- [Componenti e confini](docs/architecture/components-and-boundaries.md)
- [Modello del documento](docs/architecture/document-model.md)
- [Storage e identità](docs/architecture/storage-and-identity.md)
- [Frontend e IPC](docs/architecture/frontend-and-ipc.md)
- [Runtime dei plugin](docs/architecture/plugin-runtime.md)
- [ABI e WIT](docs/reference/abi-and-wit.md)
- [Contratto IPC](docs/reference/ipc-contract.md)
- [Layout su disco](docs/reference/on-disk-layout.md)
- [Permessi e sicurezza](docs/reference/permissions-and-security.md)
- [Test e qualità](docs/development/testing-and-quality.md)
- [Stato](docs/project/status.md) e [roadmap](docs/project/roadmap.md)
