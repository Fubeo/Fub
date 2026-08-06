# 24. Tre firme che il freeze rende definitive

Una **seduta** della [roadmap infrastrutturale](../todo.md): tre punti del contratto che oggi costano un campo e dopo il freeze di M4 costano una migrazione di versione.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Questa seduta non l'ha trovata un giro, e nemmeno una verifica sui verbali:
l'ha trovata un consuntivo.** `docs/issues.md` era un contenitore di
osservazioni scritte in un audit del 2026-07-31 e mai lavorate: novantadue
righe, di cui settantuno rimandavano a voci che non sono mai state committate —
il rimando cieco che [`numerazione.md`](numerazione.md) esiste per impedire,
arrivato dal lato che quella disciplina non copre. Rilette contro i sorgenti di
oggi, sedici erano già chiuse, una era falsa il giorno stesso, cinque non erano
difetti. Settanta reggevano.

**Sessantasette di quelle settanta non sono voci**, e stanno nell'elenco dei
[difetti misurati](../todo.md#i-difetti-misurati): nessuna chiede una decisione,
nessuna è il residuo di un verbale. Sono lavoro già deciso che qualcuno deve
ancora fare, e aprirle come voci vorrebbe dire chiedere a `todo.md` di rispondere
a una domanda che non è la sua.

**Tre lo sono, e sono qui per un criterio solo**: toccano una **firma**. È il
criterio che questo piano usa per le P0 fin dalla prima riga — *la forma scade
col freeze: oggi costa un campo, dopo costa una migrazione di versione* — e non
la loro importanza, che è modesta. Nessuna delle tre rompe niente adesso. Tutte e
tre diventano irreparabili senza una migrazione il giorno del freeze.

**Perché stanno insieme.** Sono la stessa domanda a tre distanze dal confine:
*ciò che il contratto dice, arriva a chi deve leggerlo?* La §24.1 è ciò che il
contratto **espone** e che non si vede da dove tutti guardano; la §24.2 è ciò che
il contratto **sa** e che la firma con cui lo si chiede non riesce a dire; la
§24.3 è ciò che il contratto **rifiuta**, senza dire a nessuno perché. Decise
separate darebbero tre rattoppi in tre file; decise insieme sono un criterio —
*una risposta a due valori per una domanda che ne ha tre non è una
semplificazione, è una perdita* — che la [0094](../decisions/0094-un-tetto-che-si-fa-sentire.md)
ha già preso una volta, su `random-bytes`, e che qui si ripresenta due volte su
tre.

---

### 24.1 Sette tipi del contratto non si vedono dalla radice del crate

*aperta · strato **contratto** · **P0***

`crates/fub-abi/src/lib.rs:103` dichiara di riesportare «i tipi più usati per un
import ergonomico dai crate consumatori». Sette tipi
primari definiti in `src/traits.rs` non ci sono: `DocPosition`, `ResolvedRef`,
`JobSpec`, `JobId`, `JobProgress`, `JobStatus`, `PluginPermissions`. Chi li usa
scrive `fub_abi::traits::JobId` mentre il suo vicino di riga scrive
`fub_abi::Paged`.

- [ ] **È una firma e non un'ergonomia.** Un `pub use` è la superficie pubblica
      del crate: aggiungerlo dopo il freeze è additivo e si può fare sempre — ma
      *nel frattempo* ogni consumatore ha scritto il path lungo, e il path lungo
      passa da `traits`, che è un modulo di implementazione. Il giorno in cui
      `traits.rs` si spezza — ed è la direzione in cui il crate si muove da
      quando la [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) ha dato
      al contratto una sorgente — quei path si rompono tutti, e si rompono per
      chi sta fuori.
- [ ] **La domanda vera non è quali sette mancano, è chi decide l'elenco.**
      Aggiungerli a mano è la risposta che l'ostacolo suggerisce, ed è la
      peggiore: il prossimo tipo nascerà fuori dall'elenco esattamente come questi
      sette. Un `pub use traits::*` è l'altro estremo e rinuncia a dire cosa è
      superficie. La terza forma — un presidio che confronta i tipi pubblici di
      `traits.rs` con il blocco di re-export e diventa rosso su chi manca — è la
      stessa forma che `check-prosa` ha per i numeri e `dieta_ipc` per i comandi,
      ed è l'unica che il secondo chiamante eredita gratis.

*Provenienza: `issues.md` 0011, misurata il 2026-07-31 e riverificata il
2026-08-06 (`crates/fub-abi/src/lib.rs:103-112`: nessuno dei sette c'è).*

---

### 24.2 `enabled()` risponde con un booleano a una domanda che ha tre risposte

*aperta · strato **contratto** · **P0***

La [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) ha
sostituito gli elenchi di booleani con `OptionMap` — `ns:nome` → valore JSON — e
ne ha scritto la regola: *presente = acceso, il valore è il dettaglio, un `false`
esplicito spegne*. La regola distingue tre stati. La firma che la legge ne
distingue due: `OptionMap::enabled(&self, key: &str) -> bool`
(`crates/fub-abi/src/options.rs:92`) torna `false` sia per la chiave assente sia
per la chiave presente e messa a `false`.

- [ ] **I due `false` non vogliono dire la stessa cosa, e chi legge non può
      saperlo.** «Questa sintassi il provider non la conosce» e «questa sintassi
      il provider la conosce ed è spenta in questo `ParseContext`» sono la
      differenza fra *non si può* e *non adesso*: la prima è una capacità che
      manca, la seconda un'impostazione. Chi disegna un pannello delle opzioni le
      deve mostrare in due modi; chi negozia un formato deve ripiegare solo sulla
      prima.
- [ ] **È esattamente la forma della [0094](../decisions/0094-un-tetto-che-si-fa-sentire.md),
      e quella è la strada da valutare per prima.** Là i significati di
      `random-bytes` erano tre e la firma ne diceva due, e la risposta non è stata
      un tipo nuovo: è stato dare al risultato la forma che il dominio aveva già.
      Qui la forma esiste già anche lei — `get()` torna un `Option<&Value>` e sa
      distinguere — e ciò che manca è che la firma comoda non butti via quello che
      la firma completa sa. Un `status(&self, key) -> OptionStatus` è una via; che
      `enabled` sparisca in favore di quella che non mente è l'altra, e va guardata
      prima, perché una funzione che risponde male è peggio di una che non c'è.

*Provenienza: `issues.md` 0013, misurata il 2026-07-31 e riverificata il
2026-08-06 (`crates/fub-abi/src/options.rs:92`: `enabled` c'è, `status` no).*

---

### 24.3 `Unsupported` è l'unico errore che non è testo che qualcuno legge

*aperta · strato **contratto** · **P0***

La [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) ha stabilito
che un errore è testo, e che il testo si localizza sulla via d'uscita col catalogo
di chi ha scritto la frase. `FormatError::Unsupported(String)`
(`crates/fub-abi/src/error.rs:60`) porta una `String` nuda: non un `Text` con la
sua chiave e i suoi argomenti, cioè non qualcosa che la
[0040](../decisions/0040-chi-localizza.md) sappia tradurre.

- [ ] **È la variante che un utente vede più spesso di tutte.** È la risposta
      che il contratto prescrive a un `FormatProvider` testuale che riceve un
      `DocumentSource::Bytes`, ed è quindi ciò che compare quando si apre un file
      col provider sbagliato — il caso normale in un vault che contiene anche
      allegati (§14.1), non un caso di frontiera. Un utente italiano legge una
      frase inglese scritta da chi ha implementato il provider.
- [ ] **La domanda che decide la forma: `Unsupported` di chi è?** Se è del
      *contratto*, la frase la scrive `fub-abi` e la chiave sta nel suo catalogo,
      e allora il campo giusto non è un `Text` libero ma i due dati che rendono la
      frase componibile — il formato che ha rifiutato e la specie di sorgente che
      ha ricevuto. Se è del *provider*, allora è un `Text` con il catalogo di chi
      lo emette, come ogni altro errore dopo la 0041. Sono due firme diverse, e
      sceglierne una dentro un'implementazione vorrebbe dire che nessuno la trova
      più.

*Provenienza: `issues.md` 0014, misurata il 2026-07-31 e riverificata il
2026-08-06 (`crates/fub-abi/src/error.rs:60`: `Unsupported(String)`).*
