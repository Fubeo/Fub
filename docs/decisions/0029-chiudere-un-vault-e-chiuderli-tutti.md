# 0029 — Chiudere un vault, e chiuderli tutti: l'ultimo giro, il punto di consistenza, e la mappa che il backend non aveva

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §9.5 + §9.6 (seduta 9) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)

---

`flush_indexes` aveva **un solo chiamante in produzione**: il callback del file
watcher. Non `write_document`, non la chiusura del vault — che non esisteva — e
non la chiusura dell'app, che chiamava un `Host::close` il cui corpo intero era
*lascia cadere la sessione*. Da lì veniva una frase che il piano non ha mai
scritto e che il codice diceva lo stesso: **la durabilità di un indice dipendeva
da un componente opzionale**. Dove il watcher non c'è — un network share, una
cartella cloud, la CLI (27.1), un e2e headless (27.4), PWA (26.3), mobile (26.2)
— le scritture di un indice non diventavano durevoli mai, e il sintomo era solo
una riapertura lenta che reindicizzava tutto: nessuno se ne accorgeva finché non
contava.

La [0028](0028-come-un-componente-smette.md) aveva dato il mattone —
`Workspace::deactivate_plugin`, che chiude gli indici di *un* plugin — e non
l'aveva usato, perché «spegnere un plugin» e «chiudere il vault» sono due cose.
Questa è la seconda.

E sotto ce n'era una terza, che è lo stesso codice: `Host` teneva una
`Option<VaultSession>`, e aprire un vault **chiudeva** quello aperto. Il vault
"corrente" non era una comodità della shell, era un'assunzione del backend — e
ogni cosa che avrà due vault davanti (una finestra per vault, un confronto, un
import da un vault all'altro, la CLI che ne interroga uno mentre l'app ne tiene
un altro) sarebbe passata di lì a riscriverlo.

## La risposta, in una frase

**Chiudere è tre momenti in quest'ordine — `VaultClosed` mentre tutti sono
ancora vivi, un flush di tutti gli indici, e poi ogni plugin che smette in
ordine inverso di dichiarazione — e «chiuderne uno» e «chiuderli tutti» sono la
stessa funzione, perché `Host` tiene una mappa di sessioni e il "corrente" è
soltanto chi risponde a chi non ne nomina uno.**

## Le decisioni prese, da NON ridiscutere senza motivo

- **`VaultClosed` arriva prima che si spenga chiunque, e la coda si drena
  subito.** È l'ultimo giro sincrono in cui il vault è ancora quello di prima:
  chi lo riceve è ancora registrato, ha ancora l'`HostApi` e **può ancora
  scrivere**. Emetterlo dopo aver disattivato qualcuno sarebbe stato annunciare
  una chiusura a chi non c'è più — un evento che nessuno dei suoi destinatari
  può più usare non è un evento, è una riga di log. Il presidio è
  `chiudere_e_lultimo_giro_poi_il_flush_poi_chi_smette`, e la sua prima
  asserzione è esattamente questa: dopo `close()`, il documento che l'handler ha
  scritto **c'è**.
- **Ed è un evento, non una chiamata sul trait — perché gli `EventHandler` non
  hanno, e non avranno, un metodo di ciclo di vita.** È la simmetria della
  [0028](0028-come-un-componente-smette.md) presa sul serio: lì `close` è andata
  al **solo** `IndexProvider`, perché è l'unico che il kernel alimenta e l'unico
  che possiede uno stato derivato su disco. Il punto in cui un *bundle* libera
  ciò che possiede resta `Plugin::deactivate` (§9.3). Ma fra i due c'è un caso
  che nessuno dei due copre — un handler che tiene qualcosa in memoria e non è un
  indice — e per lui la risposta giusta non è una funzione nuova su ogni trait:
  è **sapere che sta per succedere**. Che poi è la regola della
  [0013](0013-elenco-delle-capacita.md), applicata al contrario: chi chiude non
  ha bisogno della risposta per proseguire e la chiusura non si annulla, quindi
  ciò che serve è un evento e non una capacità. Chi non fa in tempo ha perso solo
  ciò che non aveva reso durevole.
- **Il flush di tutti gli indici viene *prima* delle disattivazioni, e non
  dentro.** `deactivate_plugin` fa già `flush` e poi `close` sugli indici di chi
  spegne — ma li fa **un plugin alla volta**, e ciò che gli handler hanno appena
  scritto ricevendo `VaultClosed` dev'essere indicizzato da **tutti** prima che
  il primo indice si chiuda. Senza il flush in mezzo, il primo plugin
  dell'elenco chiuderebbe i propri indici mentre l'ultimo non ha ancora visto
  l'ultima scrittura. È il **punto di consistenza che non è il watcher** — la
  frase con cui il §9.5 chiedeva questa voce.
- **Ordine inverso di dichiarazione.** È l'ordine in cui si smontano le cose che
  si sono montate in ordine: chi è arrivato per ultimo può dipendere da chi
  c'era già (§7.5), mai il contrario. Fra vault **diversi** invece non c'è nessun
  ordine che conti, e il codice non finge che ci sia: due vault non si
  conoscono, non condividono provider e non condividono spazio dati.
- **Gli errori non fermano niente e tornano tutti insieme.** Una chiusura che si
  interrompesse al primo errore lascerebbe aperto tutto il resto, che è
  esattamente il caso per cui questa funzione esiste. È la stessa regola di
  `flush_indexes`, e chi ha un canale per dirlo li mostra: il comando IPC li
  restituisce come lista, e la chiusura dell'app li scrive (§20.2).
- **Chiudere due volte non è chiudere due volte.** `Workspace` ha un `closed:
  bool`, e la seconda chiamata rende una lista vuota senza emettere un secondo
  `VaultClosed`. **Non è un sesto proprietario** (§8.1): è lo stato del *tutto*,
  ed è l'unica cosa che nessuno dei cinque può sapere da sé — il disco non sa
  degli indici, gli indici non sanno dei provider. Serve a una cosa sola, e il
  presidio la nomina: `chiudere_due_volte_non_chiude_due_volte`.
- **L'indice del kernel non riceve `close`, e non è una dimenticanza.** Non
  persiste niente per conto proprio (la sua verità è il vault, e la ricostruisce
  all'apertura), non ha uno spazio dati, e soprattutto **non potrebbe
  riceverlo senza uscire da sé stesso**: l'host che gli si presterebbe è
  costruito sul workspace che lo contiene. La regola resta quella della 0028 —
  `close` esiste per chi possiede risorse esterne — e il `CoreIndex` non ne
  possiede.
- **La chiave delle sessioni è la forma *canonica* della radice.** Non è
  igiene: senza, `/vault` e `/vault/../vault` sarebbero due sessioni sullo
  stesso vault, e la seconda si fermerebbe — bloccando, per sempre, senza un
  errore — sul lock che l'indice della prima tiene sulla propria cartella.
  Tantivy quel lock lo aspetta *bloccando*, ed è il modo esatto in cui il bug
  che questa voce ha tolto si manifestava prima. Un path che non si
  canonicalizza è un errore **qui**, dove si può ancora dire quale.
- **Il watcher si lascia andare per primo.** Entra nel workspace da un thread
  suo: tenerlo vivo durante la chiusura vorrebbe dire poter ricevere una
  sincronizzazione e un `flush_indexes` *dopo* che gli indici sono stati chiusi
  — cioè scrivere in un vault che si sta chiudendo, che è la versione a due
  thread del problema che questa decisione risolve.
- **Il vault "corrente" è della shell, e ogni comando IPC accetta un `vault`
  opzionale.** Chi non ne nomina uno parla col corrente — che è ciò che la shell
  fa oggi, con una finestra sola — e chi ne ha due davanti lo nomina. Il
  corrente non è mai un'assunzione: `Host::with_session` è il **punto unico** in
  cui «quale vault» si risolve, e nessun chiamante deve saperlo. Chiudendo il
  corrente, corrente diventa un altro dei vault aperti, o nessuno se non ne
  restano.
- **Riaprire un vault già aperto non lo rimonta: lo rende corrente.** Prima la
  sessione veniva buttata e rifatta, con la scansione da ripagare, il lock
  dell'indice da riprendere e il prezzo dichiarato che se la seconda apertura
  falliva non si tornava alla prima. Succedeva riaprendo lo stesso vault dal
  dialogo, e in sviluppo a ogni ricarica della pagina.
- **Chiudere un vault che non è aperto è un errore, non un no-op.** Chi chiude
  nomina qualcosa che crede aperto: se non lo è, la sua idea del mondo è
  sbagliata e dirglielo costa una riga.
- **`RunEvent::Exit`, non `ExitRequested`.** Il secondo si può annullare, e
  chiudere gli indici di un vault che poi resta aperto sarebbe peggio che non
  chiuderli. Il fatto che il kernel non può sapere — *l'app sta chiudendo* — qui
  è certo, ed è l'ultimo momento in cui si può dire a qualcuno di chiudersi.

## Trovato per strada

- **Una prova che non provava niente.** La prima versione del presidio sulla
  chiave canonica riapriva il vault come `/vault/./` e si aspettava una sessione
  sola. Passava anche **togliendo la canonicalizzazione**, perché `Utf8PathBuf`
  si ordina per *componenti* e `.` non è una componente: le due chiavi erano già
  uguali per la `BTreeMap`, e il test misurava l'ordinamento di camino invece
  della decisione. È stata riscritta con un giro da `..` — componenti diverse
  davvero — e con un'asserzione che chiede la sessione **per nome** invece di
  riaprirla: quando la canonicalizzazione manca, adesso fallisce con il proprio
  messaggio invece di piantarsi sul lock di tantivy. Il modo di trovarla è stato
  provarla al contrario, che è il motivo per cui quella regola esiste.
- **`close_vault` chiude fuori dal lock delle sessioni.** La sessione si toglie
  dalla mappa tenendo il lock, e si chiude dopo averlo lasciato: chiudere chiama
  i provider, e un provider che durante la propria chiusura chiedesse un altro
  vault si troverebbe davanti sé stesso.
- **`run()` dell'app è diventata `.build(…).run(|app, event| …)`.** La forma
  breve — `.run(generate_context!())` — non ha nessun posto in cui infilare
  «l'app sta chiudendo». Non è un refactor: è che il gancio non esisteva, e
  senza gancio la chiusura del vault sarebbe rimasta una funzione senza
  chiamante come `deactivate_plugin` lo è stata fino a ieri.
- **`Host::is_watching` risponde `false` anche su un vault che non è aperto**, e
  adesso lo fa per un vault nominato e non solo per «la sessione». È la stessa
  risposta di prima, e resta quella per costruzione del §9.7: distingue
  `NoWatcher` da un debouncer *avviato*, non da uno vivo.

## Cosa NON è stato fatto, e perché

- **Il registro dei vault — recenti, preferiti, icone — si sposta al §11.1.** Era
  il secondo punto del §9.6, ed è l'unico che questa voce non chiude. Non per
  mancanza di tempo: perché è **configurazione globale**, e la configurazione
  globale non ha ancora un posto — oggi le impostazioni sono variabili
  d'ambiente. Deciderlo qui vorrebbe dire inventare un file di configurazione
  per un elenco di path, cioè decidere il §11.1 di sfuggita e con un solo
  cliente davanti. La voce è stata scritta nel
  [file della seduta 11](../roadmap/11-impostazioni-e-i-tre-stati.md).
- **Nessuno *aspetta* i job in volo, e la chiusura non li cancella.** In
  produzione non c'è ancora un runner (§9.3): `spawn_job` accoda e basta, e i
  job in coda di un plugin che si spegne ricevono già un esito dalla
  [0028](0028-come-un-componente-smette.md). Il giorno che il runner esisterà,
  «chi chiude aspetta chi?» è una domanda del §9.3 e va decisa **con** la
  cancellazione, non dopo: un pool che non nasce cancellabile si riscrive per
  diventarlo.
- **La shell non ha ancora una UI per più vault.** I tre comandi ci sono
  (`list_vaults`, `set_current_vault`, `close_vault`) e `main.ts` non ne chiama
  nessuno: la finestra resta una, e apre un vault alla volta. È voluto — questa
  voce è la **metà backend**, ed è quella che scadeva, perché è quella che ogni
  cliente futuro avrebbe dovuto riscrivere. La metà shell è il §1.2 col modello
  di layout e il `PaneId`.
- **Nessun marcatore di chiusura pulita sul disco.** La 0028 aveva nominato il
  caso — un `close` che scrive «chiuso bene», così che la riapertura distingua
  una chiusura da un processo morto — e resta possibile perché `close` ha
  l'host. Nessun provider oggi ne ha bisogno, e scriverlo senza un cliente vero
  vorrebbe dire decidere il formato di un file di stato senza sapere chi lo
  legge (§15.3, §15.4).
- **Il `VaultClosed` non ha un gemello asincrono, e non ci sarà.** Chi riceve
  l'evento scrive **dentro** l'ultimo giro sincrono o non scrive: un handler che
  volesse fare del lavoro lungo alla chiusura chiederebbe alla chiusura di
  aspettarlo, e una chiusura che aspetta è una chiusura che si pianta. Il
  contratto lo dice sul tipo, non in una nota.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fubmd-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita.
- `cargo test --workspace` — **57 suite, 0 fallimenti**, le stesse della
  [0028](0028-come-un-componente-smette.md): questa voce non aggiunge file di
  test, aggiunge prove dentro due suite che esistevano.
  - `fubmd-kernel/tests/disattivazione.rs` +2:
    `chiudere_e_lultimo_giro_poi_il_flush_poi_chi_smette` (l'handler scrive
    ricevendo `VaultClosed`, e le tre posizioni nel log di vita dell'indice —
    ultima indicizzazione, flush, chiusura — sono in quest'ordine) e
    `chiudere_due_volte_non_chiude_due_volte`.
  - `fubmd-host/tests/headless.rs` +2, e la terza riscritta:
    `due_vault_stanno_aperti_insieme_e_il_corrente_e_una_comodita`,
    `riaprire_lo_stesso_vault_non_lo_rimonta`, e
    `chiudere_un_vault_e_lultimo_giro_in_cui_e_ancora_aperto` — che è l'unica a
    guardare il **disco**: legge il `manifest.json` dell'indice di ricerca prima
    e dopo la chiusura, e la prima asserzione è che prima *non* contiene la nota
    appena scritta. Se quel punto di partenza cambiasse, il test proverebbe
    un'altra cosa, e lo dice.
  - `opening_a_second_vault_closes_the_first` è stata **sostituita**: provava
    una regola che questa decisione toglie.
- **Provate al contrario, tutte e due le righe che contano:**
  - spostando l'emissione di `VaultClosed` *dopo* il giro delle disattivazioni,
    `chiudere_e_lultimo_giro_poi_il_flush_poi_chi_smette` fallisce con il
    proprio messaggio — «chi riceve `VaultClosed` è ancora registrato e può
    ancora scrivere» — perché a quel punto l'handler non è più registrato;
  - riducendo `canonical` all'identità, `riaprire_lo_stesso_vault_non_lo_rimonta`
    fallisce con `Nessun vault aperto su /tmp/…/../…`, cioè lo stesso vault
    diventa due chiavi.
- **Contratto:** `Event::VaultClosed { root }` e `EventKind::VaultClosed` sono
  **additivi e in coda** al variant e all'enum (`wit/fubmd/abi.wit`), presidiati
  da `wit_conformance`; `EventMask::all()` li include. Il mirror TS è
  rigenerato (`UPDATE_MIRROR=1` su `fubmd-features` e `fubmd-app`), con il
  record nuovo `OpenVaults` fra i campioni dell'app.
- `cd frontend && npx vitest run` — 11 file, 173 test verdi; `npx tsc --noEmit`
  pulita.
- `cargo fmt --all` — pulita.
