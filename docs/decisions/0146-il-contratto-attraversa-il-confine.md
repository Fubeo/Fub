# 0146 — Il contratto attraversa il confine, e ci passa ogni volta

**Stato**: accolta **Data**: 2026-08-11 **Chiude**: §27.1 **Commit**: *(questo
commit)*

---

## La domanda

La [§27.1](../roadmap/27-tre-scommesse-che-nessuno-ha-provato.md) chiedeva:
**qualcuno ha mai provato ad attraversare il confine che questo contratto è
scritto per attraversare?** Il censimento diceva di no, e lo diceva bene: il
crate ospite non esiste, `wasmtime` compare in cinque file e in tutti e cinque è
la negazione, e le due suite che sembrano la prova non lo sono — `wit_conformance`
confronta due **testi**, `conformita` gira contro un doppio in-process. Tre reti
verificano che wasmtime non entri; **zero** verificavano che ciò che il contratto
dichiara ci passi.

## La decisione

**Il confine si attraversa generando e compilando l'intero mondo, e la prova è
un presidio, non uno spike.**

`tools/varco-wasm/` è il contratto di là. Il suo `build.rs` dà
`crates/fub-abi/wit/fub/abi.wit` in pasto a `wit-bindgen`, che ne genera i
binding guest di `plugin-world` — **con gli stub**, cioè con tutti gli export
implementati — e `src/lib.rs`, che non ha una riga scritta a mano, li include e
li fa compilare a `wasm32-unknown-unknown`. Se compila, il contratto attraversa
il confine. Se non compila, non lo attraversa, e lo si sa **prima** del freeze,
che è la sola volta in cui saperlo serve a qualcosa.

Lo chiama la CI per nome, nel lavoro degli invarianti del contratto, subito dopo
le tre righe che il contratto lo guardano come testo.

### Che cosa risulta, misurato oggi

Il mondo non è la metà che la voce contava: `plugin-world` importa **diciassette**
interfacce e ne esporta **undici**, per **settantacinque** funzioni — quaranta di
là, trentacinque di qua. (La voce ne contava diciassette e quaranta: è il solo
lato host.)

| | |
|---|---|
| il contratto | 4 037 righe di WIT, 43 interfacce dichiarate |
| il generato | 171 399 righe di Rust, 5,89 MB al netto del rientro |
| compilazione a `wasm32` | **nessun errore**; 1 m 08 s a freddo (compresi i 31 crate del generatore), 37,9 s in release |
| il modulo | 21 745 038 byte in debug, **275 073 byte in release** |

L'ultima riga è il numero che nessuno aveva: **un plugin che implementa il mondo
intero e non fa niente paga 275 KB di solo passaggio.** Il generato grezzo è
94,3 MB perché wit-bindgen rientra fino alla colonna 870 — è spazio bianco, e va
detto perché il primo che guarda il file si spaventa.

### Perché gli stub, e non i soli trait

Senza `stubs`, il generato dichiara gli undici trait degli export e una macro che
nessuno invoca: **il corpo delle funzioni di lifting resta dentro una macro non
espansa**, cioè non compilato. È verificato sui byte: senza stub il modulo
release è 49 KB, con gli stub 275 KB. La differenza è metà del confine — quella
che un plugin attraversa davvero — e un presidio che non la compila sarebbe verde
sapendo la metà.

### E l'arena non è un'ottimizzazione

La voce chiedeva anche «*se l'arena serve davvero o è un'ottimizzazione per un
problema che non c'è*». La risposta è caduta fuori dalla prova rossa: un
`record nodo { figli: list<nodo> }` — cioè un albero detto in modo diretto — non
**risolve** nemmeno, e il varco diventa rosso prima di arrivare al compilatore.
L'arena appiattita con indici `u32` non è una scelta di prestazioni: è l'unico
modo in cui in WIT si può dire un albero. Che i suoi soli clienti siano due test
dell'ABI resta vero, e adesso è un fatto diverso da come sembrava: non è una
soluzione in cerca di un problema, è la forma obbligata di ciò che passa.

## La premessa caduta, e perché sembrava vera

**La voce prezzava lo spike «qualche giorno, e un crate usa-e-getta». È costato
mezz'ora, e non è usa-e-getta.** Sembrava vera per una ragione seria: attraversare
un confine WASM evoca un *motore*, e un motore è wasmtime, un host, un caricatore,
M5. Ma il confine ha due metà e solo una delle due vuole un motore. Che il
contratto sia **costruibile** — che un plugin ci si possa scrivere contro — si
prova con un generatore e un compilatore, e il generatore è una libreria che si
chiama in-process, non un programma da installare. Che il passaggio sia **caro o
economico** vuole il motore, e quello resta di M5.

Da cui la seconda metà della premessa caduta: **la forma (a) come era scritta è la
forma sbagliata**. Portare di là *una feature sola, l'outline*, misura una feature
e marcisce: l'interfaccia numero ventinove non erediterebbe niente, e chi la
aggiunge rifarebbe lo spike o — molto più probabilmente — non lo rifarebbe. La
seconda prova della barra decide qui come ha deciso nella
[0145](0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md): il mondo
intero generato da `abi.wit` copre le ventotto interfacce **e quelle che verranno**,
senza che nessuno se ne ricordi.

## Cosa si è scartato, e chi pagava

- **(a) come proposta — una feature sola di là dal confine, per misurare.** Paga
  chi aggiunge l'interfaccia dopo: la misura è di quel giorno e di quella feature,
  e nessun presidio la tiene. Scartata nella sostanza *tenendone il fine*: la
  misura c'è, ed è più larga.
- **(b) congelare come si è, e provare dopo.** Paga chi manterrà il contratto: una
  correzione dopo il freeze è la major che la
  [0002](0002-additivita-del-contratto.md) è nata per rendere cara. Scartata
  perché la metà costruibilità costava mezz'ora, e non provarla per mezz'ora
  sarebbe stato il caso peggiore della 0002 — non uno sbaglio, ma una cosa che
  nessuno aveva guardato.
- **(c) restringere il freeze a ciò che è stato esercitato.** Paga chi scriverà i
  primi plugin, contro una superficie più piccola. La misura la rende senza
  oggetto per la parte che copre: il mondo **intero** è costruibile, non solo le
  famiglie che le dieci feature ufficiali usano, quindi non c'è niente da
  ritagliare per prudenza sulla forma. Resterebbe da ritagliare per prudenza sul
  *costo*, e su quello vale la nota qui sotto.
- **Il varco come `[dev-dependency]` di `fub-abi`, e il presidio in `cargo test`.**
  È dove il preambolo manderebbe una cosa che nasce nel codice Rust, ed è stata la
  prima forma scritta. Paga **chi lavora nel repo, a ogni giro di prova**: il
  generatore si porta trentun crate, e `fub-abi` è il crate da cui dipendono tutti
  gli altri — cioè il prezzo cadrebbe sul gesto che la 0145 ha appena reso più
  leggero, per un controllo che serve quando cambia il **WIT**, non quando cambia
  una riga del kernel. In più vuole `wasm32-unknown-unknown` installato, e
  `cargo test --workspace` non deve chiederlo a chi non ce l'ha. Da cui il crate
  fuori dal workspace (`exclude` nella radice) e la riga in CI.

## Cosa resta scoperto

**Nessuna casella.** Ciò che restava da decidere è deciso, e ciò che restava da
fare è fatto.

Un **buco dichiarato**, e va detto per intero perché non venga scambiato per una
svista: **il varco prova che il contratto è costruibile, non che il passaggio sia
economico.** Non c'è un motore, non c'è un host, nessun `Document` viene
serializzato davvero e nessuna latenza è misurata. Quella metà vuole
`fub-wasm-host`, che è di M5 e che la radice del `Cargo.toml` tiene commentato
apposta. Non è una casella perché non c'è lavoro già deciso da fare: c'è un crate
che nasce a M5, e il giorno che nasce il numero da mettere accanto ai 275 KB si
misura lì.

Il secondo, più piccolo: la prova rossa esibita è alla **generazione** (l'albero
ricorsivo), dove il varco si sovrappone a `wit_conformance`, che parsa lo stesso
file. Alla **compilazione** — la metà che solo il varco vede — non è stato trovato
un costrutto che risolva e non compili: un tipo chiamato come lo `Stub` che il
generatore inventa, e un'interfaccia chiamata `%crate`, passano tutti e due,
perché wit-bindgen li scherma. È una buona notizia sul generatore e una zona che
resta dichiarata: quel verso del presidio oggi è verde per fiducia, non per prova.

## Cosa questo verbale non tocca

Le regole d'oro delle firme (niente `async`, niente generici, niente closure)
restano come sono e non sono in discussione: erano scritte per un confine, e
adesso si sa che il confine le regge. La [0057](0057-la-dieta-dell-ipc.md) resta
la disciplina della superficie, e questa misura le dà un numero da citare quando
si vorrà aggiungere una porta. Le [0054](0054-il-banco-del-lato-provider.md) e
[0055](0055-il-banco-del-lato-host.md) continuano a dire il vero — nessuno dei
due banchi sta sul confine — e il varco non è un terzo banco: non esercita niente,
verifica che ci sia qualcosa da esercitare.
