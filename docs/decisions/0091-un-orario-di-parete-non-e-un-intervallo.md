# 0091 — Un orario di parete non è un intervallo

**Voce**: [§22.4](../roadmap/22-cosa-sa-dire-un-abbonamento.md#224-un-orario-di-parete-non-è-un-intervallo) ·
**Seduta**: [22. Cosa sa dire un abbonamento](../roadmap/22-cosa-sa-dire-un-abbonamento.md) ·
**Strato**: contratto · **Priorità**: P1 ·
**Commit**: *(questo commit)*

---

`TimerSchedule` sapeva dire `every` e `after` — le due forme che si misurano in
**tempo trascorso** — e non sapeva dire «ogni giorno alle 9». Adesso lo dice,
con un terzo caso in coda al `variant`, e la parte che conta di questa decisione
non è il caso: è **dove è finita la regola di una sveglia che il contratto non
può calcolare da sé**.

**Additiva davvero, e il freeze non c'entra.** `timer-schedule` non compare in
`wit/frozen/0.1.0.wit`: è nato con la
[0069](0069-cosa-sa-dire-un-abbonamento.md) e non è mai stato pubblicato, quindi
non c'è nemmeno una linea di base da ritagliare come ha dovuto fare la
[0089](0089-da-cosa-e-partita-una-scrittura.md). Il caso nuovo è **in fondo** e
non «dove sta meglio», che è la regola che la
[0088](0088-cio-che-non-e-ancora-successo.md) ha imparato dal banco di
conformità: l'ordine dei casi *è* il discriminante dell'ABI. `nth_after` — la
sola firma pubblicata che questa voce poteva toccare — **non è stata toccata**.

---

## La misura che ha cambiato la voce prima di scriverla

La voce dava per scontato che il lavoro fosse aggiungere un caso. Non lo era, e
la ragione sta in una firma:

```rust
pub fn nth_after(&self, n: u64) -> Option<u64>
```

Restituisce **secondi dalla registrazione**. È una firma di forma «tempo
trascorso», e un orario di parete non la può implementare: quanti secondi
manchino alle nove non è una funzione di *quante volte ha già suonato*, è una
funzione di *che ore sono adesso* — un ingrediente che quella firma non riceve e
non può ricevere senza smettere di essere pura.

Le tre risposte possibili avevano tre prezzi diversi, e sono state misurate
invece che scelte:

1. **Cambiare `nth_after`.** Costo: una firma pubblicata cambia forma, quindi la
   parte additiva della voce smette di esserlo e il freeze di M4 entra in scena.
   Guadagno: nessuno — la funzione servirebbe due famiglie con un parametro che
   a una delle due non serve.
2. **Mettere la regola nell'host.** Costo: due host con due idee di quando siano
   le nove del prossimo lunedì, cioè esattamente ciò che la
   [0069](0069-cosa-sa-dire-un-abbonamento.md) aveva scritto di voler evitare
   mettendo `nth_after` nel contratto.
3. **Una seconda regola accanto alla prima**, che l'ora civile la *riceve*
   invece di leggerla. Costo: una funzione in più. È questa.

```rust
impl WallClock {
    pub fn next_after(&self, now: CivilTime) -> Option<CivilTime>;
    pub fn latest_upto(&self, now: CivilTime) -> Option<CivilTime>;
}
```

Sono pure come la sorella e stanno nel contratto per la stessa ragione. **Il
calendario finisce lì, il fuso no**: convertire un'ora civile nell'istante in
cui accade è di chi possiede l'orologio. Il contratto dice *quali* occorrenze
esistono, l'host dice *quando* accadono.

E `nth_after` risponde `None` a un orario di parete. Perché quel `None` non si
confonda con quello di un `after` che ha finito — due significati sullo stesso
valore sono il modo in cui una sveglia smette di suonare senza che nessuno abbia
scritto una riga sbagliata — accanto c'è la domanda fatta apposta,
`TimerSchedule::wall_clock()`.

**È la trappola che la voce nominava, e il criterio è quello della
[0090](0090-una-sequenza-e-una-modalita-che-scade.md):** un `Daily` dichiarato
nel `variant` che nessuno scheduler sa calcolare sarebbe la versione con
l'orologio della stessa bugia che la
[0077](0077-una-scorciatoia-e-una-chiave.md) rifiuta nel registro dei comandi.

---

## La quinta volta che una voce ferma non si esegue: si rimisura

Il metodo ha funzionato cinque volte di fila, e ogni volta ciò che era caduto
era un'altra cosa: la prima e la seconda aspettavano qualcosa che era
**caduto**, la terza chiedeva qualcosa che era stato **deciso di no** altrove,
la quarta aveva una premessa **mai stata vera**. Questa è la quarta variante di
nuovo, e su un punto che decideva metà della voce.

La §22.4 elencava tre candidati per il fuso e ne escludeva uno in anticipo: *il
locale della [0039](0039-il-locale-e-il-caso.md), che dice come si scrive
un'ora, non in che fuso si vive*. **Il `Locale` di questo repo dice tutte e
due**, e lo dice per iscritto nel suo modulo:

> **Non è un database dei fusi orari.** `Locale::utc_offset_minutes` è l'offset
> di *adesso* […] chi deve fare aritmetica su date passate o future usa
> `Locale::timezone`, che è il nome IANA, e si porta dietro le regole.

C'è di più: `locale.timezone` è già **un'impostazione**, con la scala di ripiego
delle altre — vault → macchina → default, e il default è la stringa vuota, che
per la convenzione di `AS_SYSTEM` vuol dire *chiedilo al sistema*. Cioè il primo
candidato della voce (il sistema) e il secondo (un'impostazione, §11.1) e il
terzo (il locale) **non erano tre risposte diverse**: erano tre strati della
stessa risposta, già montati, già ordinati. Aprire il modulo e leggere il campo
è costato due minuti e ha risparmiato una chiave di impostazione nuova — che
sarebbe stata la seconda con lo stesso significato, e la seconda si sarebbe
scoperta il giorno di tradurle.

---

## Da dove viene il fuso

**Tre strati, e il terzo è nuovo.**

| | chi decide | quando è il caso giusto |
|---|---|---|
| il sistema | il sistema operativo | il default, e resta il caso normale |
| `locale.timezone` | chi usa l'app | «vivo in Italia ma il portatile è configurato in inglese» |
| `wall-clock.zone` | chi **dichiara** la sveglia | «il digest delle 9 dell'ufficio di Roma» |

I primi due c'erano. Il terzo è la risposta alla domanda che la voce chiamava
per nome — *un vault sincronizzato fra due macchine in due paesi, che è il caso
normale, non quello di frontiera* — ed è una scelta di prodotto prima che di
architettura, quindi va argomentata.

**Il default è della macchina**, e non del vault. Una sveglia di parete esiste
per allinearsi all'umano che è seduto lì: «alle 9» quasi sempre vuol dire
«quando comincio a lavorare», e un portatile portato a Tokyo deve suonare alle 9
di Tokyo. È anche l'unica risposta coerente con ciò che già succede: ogni
macchina fa girare il proprio scheduler, quindi un backup dichiarato alle 3 gira
già due volte, una per macchina — il fuso del vault non avrebbe reso quel conto
diverso, avrebbe solo spostato l'ora.

**Ma il default puro tratta tutte le sveglie come se il loro significato fosse
"quando mi siedo", e alcune non lo sono.** Un digest legato a un ufficio, un
promemoria condiviso fra due persone in due paesi: quei casi hanno un
significato *ancorato a un posto*, e senza un campo non avevano come dirlo —
potevano solo sperare che tutti configurassero la stessa macchina.
`zone: option<string>` è quel campo, ed è un `option` per lo stesso motivo per
cui `DocChanges` lo era nella 0069: i due stati sono due significati, non un
valore e la sua assenza.

**Un nome che il database non conosce non fa suonare la sveglia**, e non ripiega
su UTC. Un ripiego silenzioso qui è peggio del silenzio: la dichiarazione
sarebbe onorata da un'altra sveglia, a un'altra ora, e chi l'ha scritta non
avrebbe modo di accorgersene.

---

## L'ora legale, e il campo che serviva a un'altra domanda

La voce chiedeva una regola sull'ora legale e suggeriva che fosse un campo: *un
promemoria vuole saltare, un backup vuole girare*. Guardata da vicino, la
domanda si è spezzata in due, e **nessuna delle due metà vuole un campo**.

**Il giorno in cui l'ora legale esce, le 2:30 esistono due volte.** Suona una
volta, e non perché qualcuno l'abbia scelto: perché **un'occorrenza è la sua
data civile e non il suo istante**. È l'invariante su cui è costruito tutto lo
scheduler di parete — al più una suonata per occorrenza, sempre — e le due 2:30
sono una sola data civile. Un campo qui sarebbe stato un modo di rendere
configurabile un difetto.

**Il giorno in cui entra, le 2:30 non esistono.** L'occorrenza si sposta in
avanti della durata del salto: la sveglia suona alle 3:30. È la disambiguazione
*compatible* di RFC 5545, cioè ciò che fa ogni calendario, e vuol dire che una
sveglia di parete **non perde mai un giorno**. Sta in una riga sola
(`Fuso::istante`), che è il posto giusto per una regola che altrimenti si
sarebbe sparsa.

Fin qui, zero campi. Ma la stessa domanda vista da vicino ne ha scoperta
un'altra, che la voce non faceva: **cosa fa una sveglia che è passata mentre
nessuno guardava?** La macchina dormiva, il pool era occupato, l'app era chiusa.
Sono tre facce di una cosa sola, e la risposta utile non è *si recupera?* ma
**fino a quanto tardi ha ancora senso**:

```rust
pub catch_up_seconds: u64,   // 0 = mai
```

Un intero invece di una bandiera, e la differenza si vede sul caso che una
bandiera sbaglia: un `catch_up: bool` acceso su una macchina riaccesa dopo due
giorni farebbe suonare due volte una sveglia quotidiana, oppure — se si
riducesse a una — suonerebbe per un'occorrenza vecchia di due giorni come se
fosse di adesso. Una finestra risponde bene a tutti e tre i casi con la stessa
riga: venti minuti di ritardo stanno dentro `3600`, due giorni non stanno dentro
niente di sensato, e le occorrenze saltate si **consumano** lo stesso — senza
quel pezzo resterebbero la «prossima passata» per sempre, e ogni giro le
riesaminerebbe.

**Un limite dichiarato**, e resta come casella: `catch_up_seconds` è onorato
dentro una sessione e attraverso il sonno della macchina, **non attraverso un
riavvio dell'app**. Lo scheduler non persiste dove è arrivato, quindi al primo
giro l'occorrenza passata si consuma in silenzio invece di essere recuperata — è
deliberato, perché altrimenti aprire Fub alle dieci farebbe suonare la sveglia
delle nove per il solo fatto di essere le dieci. Recuperare *davvero* attraverso
un riavvio vuole un posto dove scrivere l'ultima occorrenza onorata, ed è un
meccanismo suo.

---

## La forma del caso nuovo

```wit
variant timer-schedule {
    every(u64),
    after(u64),
    at-wall-clock(wall-clock),   // in coda
}

record wall-clock {
    hour: u8,
    minute: u8,
    days: list<weekday>,
    zone: option<string>,
    catch-up-seconds: u64,
}
```

Tre scelte che la voce lasciava a chi la prendeva.

**L'orario è in due interi e non in una stringa `"09:00"`.** Una stringa vuole
un parser al confine, e con lui un modo di fallire che non ha un posto dove
stare: un manifest si legge quando il componente si registra, e «l'orario non si
capisce» sarebbe diventato un errore di registrazione per un campo che poteva
semplicemente non essere sbagliabile. Due interi si controllano dove si leggono
— e un orario fuori scala **non suona** invece di rifiutare il componente che
l'ha scritto: `WallClock::valid()` è la domanda con cui chi implementa uno
scheduler sa perché.

**Un caso solo per «ogni giorno» e «il lunedì»**, con `days` vuoto a dire *ogni
giorno*. Un `daily` e un `weekly` separati sarebbero stati due casi del
`variant` con la stessa aritmetica dentro, distinti da un campo in più — e due
casi costano due discriminanti per sempre.

**Il giorno della settimana è quello del locale**, che c'era già. Un secondo
enum con gli stessi sette casi sarebbe stato due modi di dire lunedì, e il
secondo si sarebbe scoperto il giorno di tradurli.

---

## Le due sorgenti di tempo, e perché non si mescolano

Lo scheduler ([`fub-host/src/runner.rs`](../../crates/fub-host/src/runner.rs))
era costruito su un `Instant`, e il suo commento era già l'obiezione a questa
voce: *«l'ancora è un `Instant` e non un orario di sistema, ed è la ragione per
cui "ogni ora" vuol dire un'ora anche se qualcuno sposta l'orologio della
macchina»*. Quella proprietà è il **motivo per cui `every` e `after` sono
giusti**, e sarebbe stata da buttare se un orario di parete si fosse fatto
passare per un intervallo.

Le due convivono, in
[`fub-host/src/parete.rs`](../../crates/fub-host/src/parete.rs), e reggono cose
diverse:

- il tempo **trascorso** regge `every`/`after` — e regge **l'attesa di tutti**,
  perché aspettare è sempre «per quanto», mai «fino a quando»;
- il tempo **di parete** regge *quando accade* un'occorrenza di `at-wall-clock`.

Si toccano in un punto solo: *fra quanti secondi accade quell'ora civile*. Da lì
in poi si torna all'orologio monotono, e il campo `prossima` di un quadrante è
dello stesso tipo per tutte e tre le forme. Un orologio spostato allunga o
accorcia una singola attesa e poi si ricalcola — nessuna sveglia si perde e
nessuna si sdoppia, perché a decidere se una ha già suonato non è l'orologio ma
la sua data civile.

Un orario di parete si **ricalcola a ogni giro** invece di avanzare come un
contatore, ed è ciò che rende gratis il caso in cui l'utente sposta l'orologio o
cambia `locale.timezone` mentre l'app è viva: non c'è niente da invalidare,
perché non c'era niente di derivato da tenere.

**Un difetto vero, trovato scrivendo il modulo e non dopo.** La prima stesura
teneva una sola occorrenza per quadrante — *l'ultima considerata* — e con quella
sola una sveglia puntuale con `catch_up_seconds = 0` non suonava **mai**: ogni
suonata sarebbe stata un recupero, e la finestra era zero. Sono due domande che
si somigliano e non coincidono — *cosa ho già considerato* e *cosa sto
aspettando* — e adesso sono due campi, con il primo modo di meritare una suonata
che non passa dalla finestra: era l'occorrenza in calendario.

---

## Il database dei fusi: dieci crate, misurati

`Cargo.toml` non aveva né `chrono`, né `time`, né `jiff`, e la politica delle
dipendenze qui è scritta e severa — il paragrafo che giustifica `tracing` misura
in crate aggiunti e scrive *«senza di lui il conto torna: zero»*
([0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)), e a monte c'è la
[0001](0001-supply-chain-e-sbom.md) con il suo `deny.toml`.

**Misurato: `jiff` aggiunge dieci pacchetti al lockfile**, da 541 a 551 —
`jiff`, `jiff-core`, `jiff-static`, `jiff-tzdb`, `jiff-tzdb-platform`,
`portable-atomic`, `portable-atomic-util`, `defmt`, `defmt-macros`,
`defmt-parser`. Dieci volte il conto di `tracing`, e sta scritto in
`crates/fub-host/Cargo.toml` invece che nascosto. I tre `defmt` sono voci di
lock e non compilazione: vengono da un ramo `no_std` che qui non si accende.
`default-features = false` toglie `serde` — un `WallClock` si serializza da sé,
nel contratto, e nessun tipo di `jiff` attraversa il confine — e `logging`.

**L'alternativa a zero crate è stata guardata e scartata per iscritto.** Senza
un tzdb, «alle 9 a Roma» calcolato su una macchina in UTC è sbagliato di un'ora
per metà anno, e `locale.timezone` — che è un nome IANA, e c'era già —
smetterebbe di essere onorabile: il repo l'aveva già previsto, scrivendo *«chi
ha il database dei fusi legge il nome; chi non ce l'ha vede uno zero e sa che
sta guardando UTC, che è sbagliato in modo dichiarato»*. Quella frase descriveva
una resa accettabile per **formattare** una data; per **far scattare** una
sveglia non lo è, perché una data formattata male si vede e una sveglia che
suona un'ora dopo no.

La dipendenza entra in `fub-host` e **solo lì**. `fub-abi` resta senza
dipendenze di date, ed è la conseguenza diretta di dove è finita la regola:
l'aritmetica su ore civili non ha bisogno di sapere cosa sia l'ora legale.

Una nota di misura, perché è costata un giro: le feature del database sono
**due** e non una. `tzdb-bundle-platform` imbarca il database solo dove non c'è
— Windows — e su Linux `TimeZone::get("Europe/Rome")` fallisce senza
`tzdb-zoneinfo`. Lo hanno scoperto le prove di `parete.rs`, che è il motivo per
cui un modulo che parla col sistema operativo le ha.

---

## Cosa presidia cosa

Le prove sono divise come la decisione: **quali** occorrenze esistono è
contratto e si prova nel kernel, **quando** accadono è host e si prova
nell'host.

- [`crates/fub-kernel/tests/le_sveglie.rs`](../../crates/fub-kernel/tests/le_sveglie.rs) —
  che `nth_after` dica `None` e che ci sia una domanda per distinguerlo dal `None`
  di chi ha finito; l'aritmetica civile, compresi i tre punti in cui una scritta a
  mano si rompe (fine mese, fine anno, 29 febbraio); che un orario impossibile non
  suoni **e non rifiuti** il componente.
- [`crates/fub-host/src/parete.rs`](../../crates/fub-host/src/parete.rs) — nove
  prove sul tempo di parete: il fuso dichiarato che vince su quello della
  macchina, il fuso inventato che non ripiega su UTC, le 2:30 che non esistono e
  le 2:30 che esistono due volte, la finestra di recupero e la macchina spenta
  due giorni.
- [`crates/fub-host/src/runner.rs`](../../crates/fub-host/src/runner.rs) — che
  le due famiglie convivano nello stesso quadrante **senza mescolarsi**, e che
  una sveglia di parete nasca e muoia col manifest come ogni altra.
- [`crates/fub-abi/tests/wit_conformance.rs`](../../crates/fub-abi/tests/wit_conformance.rs) —
  che il caso nuovo sia in coda: l'ordine lo legge dall'enum Rust, quindi
  spostarlo diventa rosso da solo.

---

## Cosa resta

Una casella: **il recupero attraverso un riavvio dell'app**, che vuole un posto
dove persistere l'ultima occorrenza onorata. È scritta nel file della seduta.

E una cosa che non resta: con questa decisione la
[seduta 22](../roadmap/22-cosa-sa-dire-un-abbonamento.md) non ha più voci
aperte.
