# 0126 — Un bus che tace non lo scopre nessuno

**Stato**: accolta
**Data**: 2026-08-06
**Estende**: la [0120](0120-un-lucchetto-avvelenato-si-dice-una-volta.md) al
kernel, con la politica **opposta** e per la ragione che la 0120 aveva scritto
**Commit**: *(questo commit)*

---

## La domanda

La [0120](0120-un-lucchetto-avvelenato-si-dice-una-volta.md) ha deciso cosa fa
un lucchetto avvelenato in `fub-host` e `fub-app`: è irrecuperabile, si dice una
volta con `tracing::error!`, e da lì in poi ogni chiamata riceve un
`PluginError::Internal`. Ha anche dichiarato ciò che non aveva guardato: *«il
conto vede `fub-host` e `fub-app`, non gli altri crate»*.

`crates/fub-kernel/src/bus.rs` è uno di quelli, e scriveva
`self.subscribers.lock().unwrap()` in due posti. La domanda non è «tolgo gli
`unwrap`». È: **la politica della 0120 vale identica qui, o il kernel ha una
ragione per averne un'altra?**

## Perché la politica dell'host qui non si può applicare

`EventBus::emit` non rende niente a nessuno. `EventBus::subscribe` rende un
abbonamento e non un `Result`. Non c'è un `#[tauri::command]` a valle, non c'è
un `Vec<PluginError>` di chiusura, non c'è un canale d'errore da nessuna parte:
il bus è il posto in cui il kernel *dice le cose*, non quello in cui risponde.

Quindi «irrecuperabile, e da lì in poi rispondi di no» qui diventerebbe
**«irrecuperabile, e da lì in poi taci»**. Cosa vede l'utente: l'app smette di
consegnare eventi, la shell resta ferma sull'ultimo stato che aveva, i file sul
disco cambiano e lo schermo no. Nessun errore, nessun dialogo, nessuna riga
rossa in un pannello — perché non c'è nessuna chiamata che possa fallire.
*Chi lo scopre, e come?* Con la politica dell'host: **nessuno**. È la prova che
quella politica non si trapianta.

Col vecchio `.unwrap()` andava anche peggio, ed è utile dirlo perché è il
comportamento che stava in piedi fino a questo commit: il panico si propagava a
chi stava emettendo, cioè quasi sempre a chi teneva il prestito **esclusivo del
workspace** — e avvelenava quello. Un incidente dentro la consegna di un evento
si trasformava in un vault muto per tutta la 0120 a valle. Il difetto non era il
bus che moriva: era il bus che **portava con sé** ciò che sta sopra.

## La decisione

**Il bus si riprende, lo dice una volta nel log, e mette tutti gli abbonati in
debito di un notice.**

Le tre parti stanno insieme, e la prima è la meno ovvia.

**Perché `into_inner` qui non è mentire.** La 0120 aveva già scritto la regola
che rende questa cosa decidibile invece che una questione di gusto: *la politica
del veleno segue **cosa il lucchetto protegge**, non che specie di lucchetto è.*
Nell'host il lucchetto protegge un `Workspace`, cioè uno stato in cui una
mutazione fermata a metà lascia un documento in tabella e non nel grafo — e
ricuperarlo vuol dire far passare per buone delle risposte sbagliate. Qui il
lucchetto protegge un **elenco di destinatari indipendenti**: un
`Vec<Subscriber>` in cui ogni elemento è un capo di canale con i propri conti,
che non sa niente degli altri e non è mezzo-mutato dall'infortunio di un vicino.
E `Vec::retain` tiene il vettore valido anche se il predicato pania in mezzo (ha
una guardia di drop apposta): ciò che resta dopo il veleno è un elenco vero, non
un elenco a metà.

Ciò che si può davvero essere perso è **una consegna** — quella dell'abbonato su
cui il panico è avvenuto, e di quelli che venivano dopo di lui nel giro. E per
quella perdita, in questo file, il vocabolario c'era già.

**Perché tutti in debito, e non solo quelli che hanno perso qualcosa.** Chi si
riprende non sa a che punto dell'elenco il giro si è interrotto: non c'è modo di
distinguere chi aveva già ricevuto da chi no. Le due direzioni dell'errore non
sono simmetriche. Dire «hai perso un notice» a chi non ha perso niente costa una
riconciliazione inutile; non dirlo a chi ha perso vuol dire uno schermo che
resta indietro per sempre. Quindi si dice a tutti, e il conto che si usa è
`dropped`, cioè lo stesso da cui nasce l'[`Event::Overflow`] del tetto della
[0034](0034-il-freno-e-il-raggruppamento.md) — che la shell **già sa leggere** come
«riconcilia da zero». Nessun evento nuovo, nessuna variante nuova nel contratto:
il fatto nuovo aveva già la sua parola.

**Perché una volta per avvelenamento e non una per sempre.** Nell'host «una
volta» vale per sempre perché la custodia non torna più utilizzabile. Qui la
riparazione fa `Mutex::clear_poison`, quindi il bus torna sano: un secondo
panico è un **secondo incidente** e merita la sua riga. Il conto delle denunce è
del bus e non del processo — due vault aperti sono due elenchi, e sapere che uno
si è avvelenato non dice niente dell'altro. È la stessa scelta della 0120 vista
dall'altra parte.

## La porta

`mod roster` dentro `bus.rs`: il `Mutex<Vec<Subscriber>>` è **privato al
modulo**, e `Roster::with(|subs| …)` è l'unico modo di tenere l'elenco. `.lock()`
su un `Roster` non esiste, quindi non compila. È la forma del `mod intake` dello
stesso file e della `Custodia` della 0120.

`Custodia` non si è spostata, e la ragione va scritta perché è la prova che
comanda («il secondo chiamante la eredita gratis?»). `Custodia` vive in
`fub-host`; `fub-kernel` sta **sotto** e non può dipendere dall'host. Portarla
giù sarebbe stato possibile — ma non avrebbe fatto ereditare niente, perché
`Custodia` porta con sé la politica dell'host (`PluginError::Internal` a ogni
chiamata) che è **esattamente ciò che qui non vale**. Un tipo comune fra i due
crate avrebbe dovuto rendere la politica un parametro, cioè riaprire in ogni
sito la domanda che la 0120 aveva chiuso. La cosa che si eredita fra i due non è
il tipo: è la **regola** — un lucchetto sta dietro una porta, e la porta contiene
la risposta a «e se è avvelenato?». Due porte, due risposte, una regola sola. La
seduta 16 (i confini fra crate) resta come sta.

## La regola

**Una politica del veleno non si trapianta: si riderivano da cosa il lucchetto
protegge e da chi c'è ad ascoltare la risposta.** Dove non c'è nessuno a cui
rispondere, «rispondi di no» è «taci», e tacere non è una politica — è il difetto
con un nome più educato.

## Il rosso

Tre presidi, tre reversioni distinte, tutte viste rosse.

**Comportamento.** `un_bus_avvelenato_continua_a_consegnare_e_mette_tutti_in_debito`:
il veleno si produce come lo produce la vita — un thread che pania tenendo
l'elenco, con l'hook dei panici messo a tacere per la durata del misfatto, o un
panico voluto stamperebbe la sua traccia e farebbe sembrare rotto un banco
verde. Poi si emette, e si pretendono tre cose: il fatto nuovo **arriva**, arriva
anche un `Overflow`, e la denuncia vale uno anche dopo la seconda emissione.
Rimesso `self.subs.lock().unwrap()`: rosso, `FAILED` sul `PoisonError`. Qui il
rosso non è una morte del thread come nella 0120 — perché il panico avviene
nel thread del banco, che è esattamente il punto: nell'app avverrebbe nel thread
di chi emette, cioè in quello che tiene il workspace.

**Struttura, e serve perché il verde non basta.** Una porta rende una forma
inesprimibile solo per chi ci passa: niente impedisce di scrivere accanto un
secondo `Mutex` con la sua politica improvvisata, e il compilatore direbbe di sì
perché non c'è niente di illegale da dire. È la zona cieca misurata **addosso
alla 0120**, dove quattordici siti erano rimasti col codice vecchio a crate
verde. Quindi due conti sul sorgente di `bus.rs`, che tagliano via i due moduli
e i banchi e pretendono che fuori non compaia nessuna delle parole che
appartengono alle porte:
`il_lucchetto_dell_elenco_non_si_prende_da_fuori` (`Mutex`, `.lock()`,
`PoisonError`, `clear_poison`, `into_inner`) e
`i_conti_dell_abbonamento_non_si_toccano_da_fuori` (vedi sotto). Aggiunto un
`Arc<Mutex<u32>>` nudo a `EventBus`: rosso, con la parola colpevole nel
messaggio.

**Le zone cieche dei conti, dichiarate.** I banchi sono tagliati via apposta (un
canale di prova è roba loro, e ne usano uno per sincronizzare i thread). Un
lucchetto scritto in un **altro** file del kernel non lo vede nessuno: la porta è
di `bus.rs` e il conto apre `bus.rs`. E un terzo modulo aggiunto qui dentro non
verrebbe tagliato, quindi risulterebbe rosso — è il verso giusto in cui
sbagliare, perché costringe a dichiararlo invece di lasciarlo passare.

## L'altra metà del giro: il conto che aveva due padroni

Nello stesso file, e nello stesso giro, un secondo difetto della stessa famiglia
ma di forma diversa — due commit, non uno.

La [0118](0118-una-chiusura-non-cattura-cio-che-il-riconciliatore-aggiorna.md)
aveva chiuso il `Receiver` dentro `mod intake` perché **la sottrazione** del
conto degli arretrati stava in una funzione che i tre rami di ritiro dovevano
ricordarsi di chiamare, e due la dimenticavano. L'**aggiunta** era rimasta
fuori: `Subscriber::send` incrementava e poi mandava, e in errore decrementava —
la metà gemella dello stesso conto, in un posto dove un secondo modo di accodare
l'avrebbe potuta dimenticare esattamente come i due rami avevano dimenticato la
sottrazione. La forma è quella di `scriviContandoEco` lato shell: **un solo
posto possiede tutte e due le metà.**

Il modulo adesso possiede il canale intero e i suoi **due** conti: `abbonamento()`
fabbrica i due capi, `Outbox::put` è l'unico posto da cui un notice entra,
`Intake::take` l'unico da cui esce, e la funzione `debito` costruisce
l'`Overflow` una volta sola invece delle due copie che stavano una in `deliver` e
una in `Subscription::debt` — due frasi da tenere allineate a mano per dire la
stessa cosa.

## Cosa resta scoperto

- **Il conto della 0120 continua a non attraversare `fub-kernel`**, e questa
  decisione non lo estende: estenderlo vorrebbe dire un'allowlist lunga come
  l'elenco che dovrebbe restringere (misurati: `Mutex`/`RwLock` in dieci file
  del kernel, ognuno con una ragione sua). Ciò che questo commit copre è
  `bus.rs`, e i suoi conti sono lì dentro.
- **`JobBell` in `dispatcher.rs` scriveva `.expect("campanello avvelenato")`** e
  restava com'era. Non era una svista: là il `Mutex` serve una `Condvar` — che è
  definita su `MutexGuard` e su niente altro — e ciò che protegge è un `u64`
  monotòno, cioè niente da rendere incredibile. È la ragione `Condizione`
  dell'allowlist della 0120, e vale identica qui. Ma la frase non aveva una porta
  che la tenesse: era un `expect` con una frase, cioè esattamente la forma che la
  0120 ha chiamato «sembra una decisione presa, ed è solo una frase».
  *(I punti erano **sei** e non quattro — questa riga li aveva contati sui soli
  `.lock()`, e due stanno sull'esito della `Condvar`. Chiuso da
  `crates/fub-kernel/src/veleno.rs`, che porta la politica di questa decisione
  fuori da `bus.rs`: `Ricovero`, `RicoveroCondiviso` e `Condizione`, con il conto
  di `crates/fub-kernel/tests/il_veleno_del_kernel.rs` a tenere che una terza
  risposta non si improvvisi.)*
- **La riga di diagnosi va nel log e non nel canale del §20.2**, come nella
  0120: emettere un `Event::Trouble` da qui vorrebbe dire rientrare nel bus da
  dentro il bus.
