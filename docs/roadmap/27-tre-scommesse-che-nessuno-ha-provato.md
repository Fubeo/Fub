# 27. Tre scommesse che nessuno ha ancora provato

Una **seduta** della [roadmap infrastrutturale](../todo.md): tre punti in cui il
repo ha già scelto — con la ragione scritta, i test intorno e le conseguenze
tirate fino in fondo — e in cui **la prova che la scelta regge non è ancora
stata fatta**. Non sono difetti: un difetto si misura, e queste si misurano solo
facendo la cosa. Sono scommesse, e il freeze le incassa.

**Una delle tre è stata provata, e la prova è costata mezz'ora invece dei giorni
che la voce prezzava**: la §27.1 è chiusa dalla
[0146](../decisions/0146-il-contratto-attraversa-il-confine.md), che genera da
`abi.wit` i binding guest del mondo intero e li compila a `wasm32` — nessun
errore, e un modulo di 275 073 byte che è il pedaggio di un plugin che non fa
niente. Ne resta un presidio in CI, non un crate usa-e-getta, e la lezione per le
altre due: *si prova alla grana in cui il secondo chiamante eredita la prova*.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: da una riscrittura, non da una misura.** La
[25](25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) l'aveva trovata una
rilettura dei verbali, la [26](26-otto-gesti-che-nessuno-puo-dichiarare.md) una
misura fra due elenchi. Questa viene dal rifare da capo
[mappa-visuale.md](../architecture/mappa-visuale.md) (`69e25b0`): mettere per
iscritto, riquadro per riquadro, *cosa c'è dentro / perché è così / cosa costa*,
e trovarsi tre volte a scrivere un «costa» che **nessuno ha ancora pagato**.

La lente è la tredicesima del [criterio](../todo.md#il-criterio) e si scrive in
una domanda sola:

> Quale affermazione di questa architettura diventerà definitiva col freeze,
> **senza che niente nel repo l'abbia mai messa alla prova?**

Non è la domanda dei buchi dichiarati — quelli sono fatti che si sanno e si
scrivono. Non è la domanda dei difetti — quelli si misurano. È la domanda di
ciò che *sembra vero perché è coerente*, che è la specie di errore che nessun
presidio può vedere: tre reti verificavano che il contratto non dipenda da
wasmtime, e **zero** verificavano che quello che il contratto dichiara ci passi
attraverso. La quarta rete adesso c'è ed è la 0146, ma è nata da questa domanda —
non l'aveva chiesta nessun presidio.

**Che cosa questa seduta non è.** Non è un dubbio sulle scelte. Il contratto a
crate separato, l'osservazione degli eventi e il lucchetto di chi monta sono
tutte e tre decisioni buone, con verbale, e nessuna delle tre voci qui sotto
propone di disfarle. Propongono di **provarle prima che diventino irrevocabili**
— che è una cosa diversa, e più economica adesso di qualunque momento futuro.

**Quattro osservazioni della stessa lettura non sono diventate voci, e va
scritto perché nessuno le riapra.**

* **L'anagrafe riscritta intera** (46 MB su questo repo) è il difetto
  [`0112`](../todo.md#i-difetti-misurati), e la sua conseguenza sul prestito
  esclusivo è lo [`0113`](../todo.md#i-difetti-misurati). Sono misurati e non
  chiedono nessuna decisione.
* **La classe di un dato non dicibile nel contratto** è già la casella della
  [§15.4](15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe):
  l'implementazione additiva delle due radici. La forma è decisa, manca il
  codice.
* **Le regole gemelle senza fixture** sono il difetto
  [`0224`](../todo.md#i-difetti-misurati), che nomina l'unica coppia dichiarata
  gemella che nessun campione presidia.
* **Le sei superfici che nessuna feature esercita** non sono un buco taciuto:
  `crates/fub-features/tests/conformita.rs` pretende, per ogni superficie, o una
  feature o una ragione scritta. È il dogfooding che dichiara fin dove arriva, e
  fin lì funziona.

---

### 27.1 Il confine di M5 non è mai stato attraversato

*chiusa dalla [0146](../decisions/0146-il-contratto-attraversa-il-confine.md) · strato **contratto** · **P0***

## Com'è finita, e cosa lascia

**Il confine si attraversa, e attraversarlo non voleva un motore.** La voce
prezzava lo spike «qualche giorno, e un crate usa-e-getta», ed è la premessa
caduta: è costato mezz'ora, e ciò che ne resta non è un crate da buttare ma un
presidio in CI.

`tools/varco-wasm/` dà `crates/fub-abi/wit/fub/abi.wit` in pasto a `wit-bindgen`,
ne prende i binding guest di `plugin-world` **con gli export implementati**, e li
compila a `wasm32-unknown-unknown`. Il risultato, misurato il 2026-08-11:

| | |
|---|---|
| il mondo | 17 import + 11 export = **28 interfacce**, **75 funzioni** (40 di là, 35 di qua) |
| il generato | 171 399 righe di Rust, 5,89 MB al netto del rientro |
| la compilazione | **nessun errore**, 1 m 08 s a freddo, 37,9 s in release |
| il modulo | 21 745 038 byte in debug, **275 073 byte in release** |

L'ultimo è il numero che la voce cercava e che nessuno aveva: **un plugin che
implementa il mondo intero e non fa niente paga 275 KB di solo passaggio.** E il
mondo era più largo di come questa voce lo contava: diciassette interfacce e
quaranta funzioni erano il **solo lato host**.

**Due cose che la voce chiedeva e che il giro ha risposto per traverso.**

* *«se l'arena serve davvero o è un'ottimizzazione per un problema che non c'è»*:
  non è un'ottimizzazione. Un albero detto in modo diretto —
  `record nodo { figli: list<nodo> }` — non **risolve** nemmeno in WIT. L'arena
  appiattita con indici `u32` è l'unico modo in cui in WIT si può dire un albero,
  e che i suoi soli clienti siano due test dell'ABI adesso vuol dire una cosa
  diversa da come sembrava.
* *«se le venti regole d'oro erano le regole giuste»*: per la parte che si può
  sapere senza un motore, sì — il contratto si lascia generare e compilare per
  intero, e nessuno dei costrutti provati per farlo cadere (un tipo chiamato come
  lo `Stub` del generatore, un'interfaccia chiamata `%crate`) lo fa cadere.

**Cosa resta scoperto, e non è una casella.** Il varco prova che il contratto è
**costruibile**, non che il passaggio sia **economico**: non c'è un motore, nessun
`Document` viene serializzato davvero, nessuna latenza è misurata. Quella metà
vuole `fub-wasm-host`, che è di M5 e che la radice del `Cargo.toml` tiene
commentato apposta. Non è lavoro già deciso da fare: è un crate che nasce a M5, e
il giorno che nasce il numero da mettere accanto ai 275 KB si misura lì.

**Zero caselle**, e il consuntivo che la voce lascia alle altre due di questa
seduta: *una scommessa si prova alla grana in cui il secondo chiamante eredita la
prova*. Portare di là **una feature sola** avrebbe misurato una feature e sarebbe
marcito; generare **il mondo** copre le ventotto interfacce e quelle che verranno,
senza che nessuno se ne debba ricordare.

---

### 27.2 Un plugin può osservare dopo, non decidere prima

*chiusa dalla [0147](../decisions/0147-il-contratto-osserva-dopo-e-non-si-interpone.md) · strato **contratto** · **P0***

## Com'è finita, e cosa lascia

**La decisione è la forma (c): il punto di interposizione non entra nel
contratto.** La voce chiedeva se servisse una firma che potesse dire di no
prima che i byte atterrino, e la P0 era la ragione della 0002: dopo il freeze
non c'è una seconda occasione più economica. La premessa, rimisurata a
`8581cb0`, reggeva la diagnosi e non la cura: l'ordine di una scrittura è
parse, disco, ingestione, dispatch (`workspace.rs:2331`), l'unico trait che
vede passare una mutazione è `EventHandler` (dopo), e le undici interfacce
export del `plugin-world` sono tutte posteriori o parallele. Ma i tre clienti
che la voce elencava hanno già una casa decisa altrove: il sync è un servizio
del core (plugin-boundary, punto 3), la cifratura sta sotto `VaultStorage`,
che è già un `Arc<dyn VaultStorage>` sostituibile — la forma (b) è lo stato di
oggi — e la politica di vault («questa nota non esce da qui») non compare in
nessun piano del repo. La forma (a) — un trait di veto prima del freeze — paga
una firma per sempre e un giro in più a ogni scrittura per un primo chiamante
che non esiste: è la prova del secondo chiamante, ed è la scrittura stessa.

**Zero caselle.** Sync e supporto cifrato sono feature del core dei loro
milestone, non lavoro già deciso da questa voce. Il fatto — osservare dopo,
non decidere prima — resta scritto nel punto 3 di plugin-boundary, il posto
in cui uno inciampa mentre si chiede se può.

---

### 27.3 La grana del lucchetto è il vault, e chi muterà non sarà di casa

*aperta · strato **kernel** · **P1***

**1. La domanda.** Ogni chiamata a un provider che muta prende il prestito
**esclusivo sull'intero vault**. Regge oggi perché chi muta è codice di casa e
finisce in fretta. Regge anche quando chi muta è un plugin di terzi che non
abbiamo scritto noi?

**2. Che cosa si osserva oggi, misurato.** Censimento a `69e25b0`.

La `Custodia` (`crates/fub-host/src/custodia.rs:86`) ha quattro porte e
nient'altro, e la classificazione la fa il compilatore: da un prestito condiviso
non si chiama una funzione che vuole `&mut self`. Nel contratto i metodi che
vogliono `&mut self` sono **25**, e nel montaggio i due prestiti si equivalgono
per numero di siti: **54** `write()` contro **53** `read()` fra `fub-host` e
`fub-app`.

Il guadagno della scelta è misurato e non è in discussione: da 7 a 25 volte più
veloce sulle letture concorrenti, e chi salva non viene più affamato (6,4 s
sotto `Mutex`, 0,12 ms adesso).

Quello che non è mai stato misurato è il caso opposto, perché non esiste ancora
nessuno che lo produca: **una singola chiamata mutante lenta**. La regola
dichiarata dei job — *un prestito per chiamata, mai per la durata del job* —
limita per quanto si tiene il lucchetto **fra** le chiamate, non **dentro** una.
E i candidati a essere lenti dentro una chiamata sono già scritti per nome nel
piano: un LLM, un sync, un database.

C'è un precedente in casa che dice che la forma del problema è reale: lo
[`0113`](../todo.md#i-difetti-misurati) — il prestito esclusivo di
`finish_index` copre cinque fasi in fila, tre delle quali toccano il disco, e un
lettore concorrente aspetta la somma. Quello è codice di casa, misurato e
correggibile. Un provider di terzi non lo si corregge: gli si dà una grana.

E la grana giusta è **mezza già trovata**: il `Workspace` è stato diviso in
cinque proprietari (`docs`, `indexes`, `providers`, `dispatch`, `session`), e la
`mappa-visuale` scrive che è «la stessa linea lungo cui passa il lucchetto». La
divisione ha estratto la proprietà e non la lunghezza — `workspace.rs` resta
6685 righe — e i campi sono `pub(crate)`, cioè un raggruppamento e non un muro.

**Come si rimisura.**

```sh
grep -n "pub struct Custodia" -B 4 crates/fub-host/src/custodia.rs
grep -rc "\.write()" crates/fub-host/src crates/fub-app/src
grep -c "fn .*(&mut self" crates/fub-abi/src/traits.rs
wc -l crates/fub-kernel/src/workspace.rs
```

**3. Le forme, e chi paga.**

- [ ] **(a) Un tetto dichiarato, e un modo di dirlo.** Non cambiare la grana:
      dichiarare che una chiamata mutante di un provider ha un tempo massimo, e
      dare all'host un modo di **accorgersene e dirlo** invece di restare fermo
      in silenzio. Paga **il contratto**, poco: un errore in più e una riga di
      disciplina. È la forma più economica, e non risolve — rende visibile.
- [ ] **(b) La grana diventa il proprietario.** Portare il lucchetto sui cinque
      componenti invece che sul `Workspace`, finendo la divisione che è a metà.
      Paga **chi lo fa**: è il lavoro grosso, e va fatto **prima** che esistano
      plugin, perché dopo cambia l'ordine di acquisizione visibile a terzi. In
      cambio due mutazioni che non si toccano smettono di mettersi in fila.
- [ ] **(c) Com'è oggi.** Paga **chi usa l'app** il giorno in cui monta il primo
      plugin lento: l'interfaccia si ferma, e non c'è niente che gli dica
      perché. È la specie di guasto che somiglia a un'app rotta e non a un
      plugin lento.

**4. Che cosa il repo ha già deciso qui vicino.**

* La [0023](../decisions/0023-chi-monta-il-kernel.md): il lucchetto è di chi
  monta, e il kernel non sa di essere condiviso. Questa voce non tocca quella
  linea: chiede **di che dimensione** sia l'oggetto dietro il lucchetto.
* La [0120](../decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md): il
  veleno è irrecuperabile, si dice una volta, e il conto è della custodia e non
  del processo. Cambiare la grana vuol dire moltiplicare le custodie, quindi
  quella politica va riletta insieme alla forma (b).
* La [0032](../decisions/0032-il-runner-dei-job.md): il pool è per vault e non
  globale, e il parallelismo utile lo limita il lucchetto e non i core. È il
  ragionamento di cui questa voce è il seguito: se la grana cambia, cambia anche
  il numero che ha senso dare al pool.
* Il difetto [`0113`](../todo.md#i-difetti-misurati): l'unico caso già misurato
  di un prestito esclusivo troppo largo. Chiuderlo non chiude questa voce — è
  codice di casa — ma la misura di quel caso è il modo più economico di stimare
  il costo del caso di terzi.
