# 0120 — Un lucchetto avvelenato si dice una volta

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: il difetto *«che il vault
avvelenato uccida l'applicazione è una scelta, e non è stata fatta»* di
[«I difetti da correggere»](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

Il runner dei job scriveva `.expect("workspace avvelenato")`. La colla Tauri
scriveva `.unwrap()` nudo. In tutti e due i casi un panico qualunque avvenuto
mentre qualcuno teneva il prestito esclusivo rendeva l'app **muta** a ogni
chiamata successiva, senza una riga che dicesse perché.

La domanda non è «bisogna paniare?». È che alla domanda *«cosa si fa quando
questo lucchetto è avvelenato?»* rispondevano posti diversi in modi diversi, e
**nessuna delle risposte stava scritta da nessuna parte**.

Il difetto lo aveva già descritto, senza ripararlo, il doc di
`crates/fub-kernel/src/safety.rs` — cioè il modulo della
[0032](0032-il-runner-dei-job.md): *«i `.write().unwrap()` di chi monta lo
traducono in un panico su ogni comando successivo, cioè in un vault
irraggiungibile fino al riavvio»*. La 0032 aveva comprato la metà che le
competeva (un provider che pania costa la chiamata, non il vault). Questa è
l'altra metà: cosa fa **chi monta** quando la rete non è bastata.

## Cosa è risultato vero, e cosa no

**Vero, e peggiore del previsto: le risposte non erano due, erano tre.** Il
censimento ha trovato anche `crates/fub-host/src/config.rs`, che scrive
`.unwrap_or_else(|e| e.into_inner())` — cioè **ricupera**, la risposta opposta
alle altre due. È il sito che ha reso la cosa decidibile invece che una
questione di gusto: là il lucchetto serializza due variabili d'ambiente dentro
un test, e un panico in quella sezione non lascia niente di storto perché non
c'è niente da lasciare. È rimasto dov'era, ed è la prova che **la politica non è
dei lucchetti: è di cosa il lucchetto protegge.**

**Vero: il censimento era più grande del campione.** La lista arrivata col
difetto nominava tre file e circa ventisei siti. I siti misurati che tengono un
lucchetto in `fub-host` e `fub-app` sono **settanta**, di cui **trentaquattro**
sul workspace condiviso (`session.rs` 10, `fub-app/src/lib.rs` 14, `watcher.rs`
4, `jobs.rs` 3, `runner.rs` 3) e gli altri su registro dei bundle, bandiere dei
job, sveglie, scarti dell'apertura, mappa delle sessioni, registro dei vault e
store delle versioni.

**Falso: che un `RwLock` sia «un `Mutex` con un permesso in più».** È la
premessa caduta a metà lavoro, e sembrava vera perché per anni è stata vera *in
uso*: la 0024 aveva sostituito l'uno con l'altro sul workspace senza che niente
protestasse. Non lo è nei bound. `Mutex<T>` è `Sync` per ogni `T: Send`, perché
presta a uno alla volta; `RwLock<T>` lo è solo per `T: Send + Sync`, perché
presta `&T` a più thread insieme. La mappa delle sessioni contiene un
`Box<dyn VaultWatcher>`, e appena è passata dietro la porta il compilatore ha
detto di no: quel rilevatore stava in una struttura condivisa contando su una
proprietà che **nessuno aveva scelto** — che il suo lucchetto non lo prestasse
mai a due lettori. Da qui `VaultWatcher: Send + Sync` (e il `Box<dyn Any + Send
+ Sync>` che tiene vivo il debouncer). Il guadagno che ne viene non era cercato:
  due IPC su due vault diversi non si serializzano più sul lucchetto delle
  sessioni.

**Falso: che il `Result` della porta bastasse a impedire il panico.** Vedi «Il
rosso», in fondo: è successo scrivendo questa decisione.

## La decisione

**Un lucchetto avvelenato è irrecuperabile, si dichiara una volta con un
messaggio, e da lì in poi risponde di no invece di paniare.**

Le due metà stanno insieme e nessuna delle due funziona da sola.

**Perché irrecuperabile e non `into_inner`.** Un `RwLock` si avvelena *solo* se
a paniare è chi tiene il prestito esclusivo — chi legge non lo avvelena, ed è
metà del regalo della [0024](0024-chi-legge-non-aspetta-chi-legge.md). Quindi
«avvelenato», qui, non vuol dire «qualcuno è morto lì vicino»: vuol dire **una
mutazione si è fermata a metà**. Un `Workspace` preso a quel punto ha un indice
alimentato per metà, un documento in tabella e non nel grafo, un lotto aperto
che nessuno chiuderà — e dalla
[0119](0119-il-piano-si-fa-in-lettura-e-si-applica-in-scrittura.md) anche un
piano applicato a metà. `into_inner` restituirebbe quello stato facendolo
passare per buono: chi cerca riceverebbe risposte **sbagliate** invece di
risposte **mancanti**, che è il modo peggiore di sopravvivere. Ricuperare qui
non è ricuperare — è mentire.

**Perché una volta e non a ogni chiamata.** «Irrecuperabile» non autorizza il
panico ripetuto: quello è ciò che l'`unwrap` faceva, e la seconda metà del
difetto è che nessuno diceva perché. La prima volta che una custodia risulta
avvelenata scrive **una** riga di `tracing::error!`; tutte le volte, prima
compresa, chi chiede riceve un `PluginError::Internal` che nomina cosa è morto,
dice che i file sul disco non sono toccati e dice di riavviare. Sull'IPC quello
è un errore discriminabile; sullo schermo è una frase.

## La porta

`fub_host::Custodia<T>` (`crates/fub-host/src/custodia.rs`). Un `Arc<RwLock<T>>`
con il lucchetto **privato al modulo**: `read`/`write` consegnano la guardia o
l'errore, `.lock()` su una `Custodia` non esiste e quindi non compila. È la
forma del `mod intake` di `fub-kernel/src/bus.rs` e della porta unica `ascolta`
della
[0118](0118-una-chiusura-non-cattura-cio-che-il-riconciliatore-aggiorna.md).

Che sia **generico** non è eleganza: è la prova che il secondo chiamante la
eredita gratis. Sette specie di dato ci sono passate dentro — workspace,
registro dei bundle, bandiere dei job, sveglie, apertura in corso, scarti, mappa
delle sessioni, registro dei vault, store delle versioni — e nessuna ha
ridiscusso niente. Il conto delle denunce è **della custodia** e non del
processo: due vault aperti sono due stati, e sapere che il primo è morto non
dice niente del secondo.

Il costo: `read`/`write` rendono un `Result`, quindi settanta siti hanno preso
un `?`. Dove la firma un canale ce l'aveva già, la risposta ci è entrata:

- `VaultSession::close` e `Host::close` rendono `Vec<PluginError>` — il veleno
  diventa uno degli errori di chiusura, che è il canale giusto e c'era;
- `JobRunner::stop` idem;
- ogni `#[tauri::command]` rende `Result<_, PluginError>` — un `?` e basta.

Dove non c'era, la risposta è stata scelta e sta scritta accanto alla riga:

- **il pool dei job si ferma** (`Shared::work`). Un thread di sfondo che
  trovasse il vault irrecuperabile e continuasse il giro girerebbe a vuoto per
  sempre; col vecchio `.expect` si portava via il thread in silenzio, e con lui
  ogni job successivo. Adesso esce e alza `stopping`, così escono anche gli
  altri e chi accoda riceve un rifiuto invece di aspettare per sempre.
- **il rilevatore smette di sincronizzare** (`ExternalSync`), e in `watch_died`
  i motivi si scrivono nel log **prima** del prestito: se il vault è avvelenato
  il canale degli eventi non c'è più, e la ragione per cui il rilevamento è
  morto resterebbe l'unica cosa che nessuno ha detto.
- **`Host::vaults`, `current`, `has_current_vault`, `VaultRegistry::list`**
  rispondono «non ne so»: sono elenchi di comodità senza canale d'errore, e la
  porta ha già scritto la sua riga.
- **le sei capacità di `JobHost` senza esito** (`free_name`, `format_of`,
  `now_unix_millis`, `user_locale`, `active_context`, `emit`) degradano al
  valore che il contratto già prevede per «non lo so» — e va bene perché quel
  job è **già finito**: il pool si è fermato al primo veleno, quindi nessuna di
  quelle risposte fa più da premessa a niente.

## La regola

**Prendere un lucchetto è una domanda che può rispondere di no, e la risposta la
dà una porta sola.** Chi non ha un canale per il no lo dichiara accanto alla
riga, non lo inventa sul posto.

E la regola che la rende decidibile: **la politica del veleno segue cosa il
lucchetto protegge, non che specie di lucchetto è.** Uno stato osservato dopo un
panico a metà mutazione non è credibile; un `bool` che dice «ho finito» e un
lucchetto che mette in fila due test non hanno niente da rendere incredibile.

## Il rosso

`crates/fub-host/tests/un_lucchetto_solo.rs`, sei casi in due parti, più sei
prove unitarie in `custodia.rs`. La forma strutturale e il comportamento
insieme, perché si rompono separatamente.

**Struttura.** `nessun_lucchetto_senza_politica` cammina i quindici sorgenti di
`fub-host/src` e `fub-app/src`, salta la prosa (la trappola di `dieta_ipc.rs`) e
pretende che ogni `Mutex`/`RwLock` nudo abbia una riga con la sua ragione;
l'allowlist si controlla in tutte e due le direzioni. Restano **tre** righe e
**due** ragioni: `Condizione` — `std::sync::Condvar` è definita su `MutexGuard`
e su niente altro, quindi la condizione «ha finito» tiene il suo `Mutex` — e
`SoloTest`, che è il sito di `config.rs`. Rimesso in giro un `RwLock` a mano in
`jobs.rs`: rosso, con file, riga e la riga colpevole stampata.
`ogni_file_e_guardato` confronta l'elenco con la cartella vera, perché un
presidio che legge un elenco sa quell'elenco.

**La zona cieca, e non è teorica: è successa addosso.** `Custodia::read` rende
un `Result`, e su un `Result` si scrive `.unwrap()`. La sostituzione automatica
su `crates/fub-app/src/lib.rs` non ha agganciato (indentazione diversa da quella
cercata), il crate ha continuato a compilare **verde** con quattordici
`.unwrap()` addosso alla porta nuova, `cargo clippy` non ha detto niente e
nessun errore del compilatore poteva dirlo — perché non c'era niente di
illegale: `Result::unwrap` è legittimo. La riparazione strutturale, da sola,
aveva lasciato in piedi il difetto nel file dove era stato misurato. Da lì il
secondo caso, `nessuno_srotola_la_risposta_della_porta`, che è un conto e non un
tipo perché il tipo qui non può: rimessi gli `unwrap` di prima in `fub-app` e in
`watcher.rs`, rosso.

**Comportamento.** Il veleno si produce come lo produce la vita — un thread che
pania tenendo il prestito esclusivo — con l'hook dei panici messo a tacere per
la durata del misfatto, o un panico voluto stamperebbe la sua traccia e farebbe
sembrare rotto un banco verde.

- `un_vault_avvelenato_risponde_di_no_a_ogni_chiamata`: dieci chiamate di fila,
  dieci errori che nominano l'irrecuperabilità, il disco intatto e il riavvio —
  e `denunce() == 1`. Rimessa la porta a paniare, il caso **non fallisce: aborta
  il thread del banco**, che è esattamente ciò che l'app faceva a ogni `invoke`.
- `chiudere_un_vault_avvelenato_lo_dice_invece_di_paniare`: la chiusura dice
  cosa non ha potuto chiudere e il vault esce comunque dalla mappa.
- `il_veleno_di_un_vault_non_tocca_l_altro`: i due vault si nominano e non si
  prendono per posizione — `vaults()` ordina per path, e un banco che si fidasse
  dell'ordine proverebbe una volta su due l'opposto di ciò che dice di provare
  (misurato: la prima stesura lo faceva).

## Cosa resta scoperto

- **Il conto vede `fub-host` e `fub-app`, non gli altri crate.** `fub-kernel`,
  `fub-features` e `fub-sdk` hanno lucchetti propri con `.unwrap()` propri: il
  difetto misurato era il confine host↔app, e allargare il conto oltre ciò che
  si è deciso vorrebbe dire un'allowlist lunga come l'elenco che dovrebbe
  restringere.
- **Un `.unwrap()` scritto su una `Custodia` in un crate futuro non lo vede
  nessuno.** Dentro i due crate lo vede il conto; fuori, niente.
- **Il taglio dei banchi presuppone che il `#[cfg(test)]` stia in fondo al
  file.** Se un giorno non lo fosse, il conto guarderebbe di meno e non di più.
- **La riga di diagnosi va nel log e non nel canale del §20.2.** Emettere un
  `Event::Trouble` vuol dire `Workspace::with_host`, cioè il prestito che in
  quel momento non si può avere. Ciò che l'utente vede sullo schermo è quindi
  l'errore dell'IPC, non un avviso del canale.
