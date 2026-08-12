# 27. Tre scommesse che nessuno ha ancora provato

Una **seduta** della [roadmap infrastrutturale](../todo.md): tre punti in cui il
repo ha già scelto — con la ragione scritta, i test intorno e le conseguenze
tirate fino in fondo — e in cui **la prova che la scelta regge non è ancora
stata fatta**. Non sono difetti: un difetto si misura, e queste si misurano solo
facendo la cosa. Sono scommesse, e il freeze le incassa.

**Le tre sono chiuse, e nessuna delle tre è finita come la voce la prezzava.**
La §27.1 è chiusa dalla
[0146](../decisions/0146-il-contratto-attraversa-il-confine.md): il confine si
attraversa, costa mezz'ora invece dei giorni previsti, e ne resta un presidio in
CI invece di un crate usa-e-getta. La §27.2 è chiusa dalla
[0147](../decisions/0147-il-contratto-osserva-dopo-e-non-si-interpone.md) sulla
forma che la voce stessa prezzava come «com'è oggi»: i tre clienti di un punto
di interposizione hanno già una casa, e nessuna di quelle case è una firma del
contratto. La §27.3 è chiusa dalla
[0148](../decisions/0148-un-prestito-lungo-non-si-vieta-si-dice.md), che toglie
alla forma più economica il pezzo di contratto che le era attribuito: un
prestito lungo non si vieta, perché non si interrompe — si dice, e lo dice la
porta.

Due delle tre erano **P0** per la scadenza del freeze, e la terza **P1** per la
stessa ragione. In tutte e tre la scadenza si è sciolta allo stesso modo: ciò
che il freeze incassa è quello che il contratto **dichiara**, e in nessuna delle
tre la cosa temuta era dichiarata lì. La lezione che la seduta lascia è la
prima, ripetuta tre volte: *si prova alla grana in cui il secondo chiamante
eredita la prova*.

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

*chiusa dalla [0148](../decisions/0148-un-prestito-lungo-non-si-vieta-si-dice.md) · strato **kernel** · **P1***

## Com'è finita, e cosa lascia

**La decisione è la forma (a), in una forma più stretta di come la voce la
prezzava: nessun costo per il contratto.** La voce chiedeva un tetto dichiarato
«e una riga di disciplina», e il tetto è la premessa caduta — un prestito
esclusivo **non si interrompe**: chi lo tiene ha `&mut` su ciò che sta dentro, e
strapparglielo darebbe esattamente lo stato a metà che la 0120 chiama
irrecuperabile. Un errore che nessuno può costruire è una frase, non una firma.
Resta la metà che vale, ed è quella che la voce chiamava «accorgersene e dirlo»:
la `Presa` che `Custodia::write` restituisce guarda l'orologio, e sopra un
quarto di secondo scrive quanto è durata e che cosa era fermo. La soglia non
separa il corretto dallo scorretto — niente si rompe a 249 ms —, e dall'altra
parte c'è il numero misurato che la voce citava: 0,12 ms per un salvataggio
sotto contesa, dove sotto `Mutex` erano 6,4 s. Fra i due c'è un fattore
duemila, e nessuna mutazione di casa ci arriva vicino per caso. Sta **nella
porta**, quindi i cinquantacinque siti che prendono il prestito esclusivo la
ereditano senza saperlo, e il cinquantaseiesimo pure.

**Il censimento rimisurato a `ae369de` regge, e un numero diceva una cosa che
non è.** I due prestiti si equivalgono ancora (55 contro 55, dove la voce
contava 54 e 53), `workspace.rs` è cresciuto a 7141 righe invece delle 6685 —
«la divisione ha estratto la proprietà e non la lunghezza» è più vero di quando
è stato scritto — e i metodi `&mut self` del contratto sono 25 come diceva. Ma
quei venticinque non sono venticinque porte di terzi: **quattordici** sono
capacità che implementa l'host e chiama il plugin, e la loro durata è lavoro del
kernel; **due** non sono metodi di confine; e solo **nove** girano davvero
dentro il prestito perché le implementa il plugin e le chiama l'host — i sei di
`IndexProvider`, `EventHandler::handle` e i due di `Plugin`. E i tre candidati
lenti che la voce nomina per nome — un LLM, un sync, un database — girano già
come **job**, dove `JobHost` prende e rilascia il prestito per capacità.

**La P1 cade, e non per stanchezza.** La scadenza stava nel fatto che la grana
sia «visibile a terzi» dopo il freeze: non lo è. In `abi.wit` e nel
`frozen/0.1.0.wit` la parola non compare, il `plugin-world` non dichiara né
lucchetti né ordini di acquisizione, e nessuna firma cambia se domani il
`Workspace` sta dietro cinque lucchetti. Quel che resta vero è più debole —
farlo dopo è più difficile, perché con più lucchetti nasce un ordine sbagliabile
— ed è una difficoltà di chi lo farà, non una major imposta a chi ha già scritto
un plugin.

**La (b) resta sul tavolo e non diventa lavoro.** Non perché costi: perché non
cura la malattia che la voce nomina. Un `EventHandler` che impiega tre secondi
li impiega anche dietro cinque lucchetti. Ciò che comprerebbe — due mutazioni
che non si toccano che smettono di mettersi in fila — è il seguito dello
[`0113`](../todo.md#i-difetti-misurati), non della paura di un plugin lento, e
oggi non passa la prova del secondo chiamante: il primo non esiste ancora.

**Zero caselle.** Il difetto `0113` resta aperto e cambia di posto: da «l'unico
caso misurato» a «il primo caso che la porta dirà da sola» — una `finish_index`
che passa il quarto di secondo adesso scrive la propria riga, e nessuno deve
andare a cercarla. Il consuntivo che questa voce lascia alla seduta è il gemello
di quello della §27.1: *una scommessa si prova alla grana in cui il secondo
chiamante eredita la prova* — e quando la prova non si può fare, si mette nella
porta il modo di accorgersi che il caso è arrivato.
