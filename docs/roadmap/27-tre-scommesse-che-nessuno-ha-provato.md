# 27. Tre scommesse che nessuno ha ancora provato

Una **seduta** della [roadmap infrastrutturale](../todo.md): tre punti in cui il
repo ha già scelto — con la ragione scritta, i test intorno e le conseguenze
tirate fino in fondo — e in cui **la prova che la scelta regge non è ancora
stata fatta**. Non sono difetti: un difetto si misura, e queste si misurano solo
facendo la cosa. Sono scommesse, e il freeze le incassa.

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
presidio può vedere: tre reti verificano che il contratto non dipenda da
wasmtime, e **zero** verificano che quello che il contratto dichiara ci passi
attraverso.

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

*aperta · strato **contratto** · **P0***

**1. La domanda.** Il contratto è scritto per attraversare un confine WASM:
niente `async`, niente generici, niente closure, niente riferimenti alla memoria
del kernel, tutto serializzabile, chiamate brevi. **Qualcuno ha mai provato ad
attraversarlo?** E se il costo del passaggio si rivelasse diverso da quello
previsto, il freeze ci sarebbe già passato sopra?

**2. Che cosa si osserva oggi, misurato.** Censimento a `69e25b0`.

Il crate che dovrebbe ospitare il confine **non esiste**, ed è dichiarato tale
in due punti: `Cargo.toml:4` («*il WASM per i plugin di terzi arriva a M5
(fub-wasm-host, non ancora presente)*») e `Cargo.toml:16`, dove il membro è una
riga commentata. Nel repo la parola `wasmtime` compare in cinque file e in tutti
e cinque è la **negazione**: due invarianti di manifest (`fub-abi`,
`fub-kernel`) e le tre reti di `crates/fub-abi/tests/dependency_invariant.rs`.

Quindi le regole d'oro delle firme sono **presidiate al contrario**: il repo
verifica che wasmtime non entri, e niente verifica che ciò che il contratto
dichiara ci passi. Le due suite che potrebbero sembrare la prova non lo sono:

| Suite | Cosa prova davvero | Perché non è la prova |
|---|---|---|
| `crates/fub-abi/tests/wit_conformance.rs` | Rust e WIT dichiarano le stesse cose | Confronta due **testi**, non due lati di un confine |
| `crates/fub-features/tests/conformita.rs` | dieci feature girano contro `MemoryHost` | `MemoryHost` è in-process: nessun byte viene serializzato |

E la superficie da attraversare non è piccola: **diciassette** interfacce e
**quaranta** funzioni. La forma «al confine» è già stata progettata —
`crates/fub-abi/src/arena.rs`, 2008 righe di alberi appiattiti con indici `u32`
— e i suoi soli clienti oggi sono due test dell'ABI
(`superficie_della_radice.rs`, `wit_conformance.rs`). Cioè: **la soluzione al
problema del passaggio esiste, e il problema non è mai stato posto.**

Il WIT vivo è 4029 righe, quello congelato 3122: la distanza fra i due è
visibile per costruzione, ed è la misura di quanto resta da decidere prima che
la porta si chiuda.

**Come si rimisura.**

```sh
# tutti i comandi di questo blocco si danno dalla radice del repo
grep -rn "wasmtime" --include=Cargo.toml --include='*.rs' crates | wc -l
ls crates/ | grep wasm || echo "nessun crate wasm"
wc -l crates/fub-abi/wit/fub/abi.wit crates/fub-abi/wit/frozen/0.1.0.wit
grep -rln "arena::" crates/*/src crates/*/tests
```

**3. Le forme, e chi paga.**

- [ ] **(a) Uno spike prima del freeze: una feature sola, di là dal confine.**
      Si prende la più povera — l'outline, che è una `ViewProvider` e
      nient'altro — la si compila a `wasm32`, e la si fa girare contro un host
      di prova. Non per tenerla: per **misurare** il costo di serializzare un
      `Document` e la latenza di un ridisegno. Paga **chi lo scrive**: qualche
      giorno, e un crate usa-e-getta. In cambio si sa, con un numero, se le
      venti regole d'oro erano le regole giuste — e se l'arena serve davvero o
      è un'ottimizzazione per un problema che non c'è.
- [ ] **(b) Congelare come si è, e provare dopo.** Paga **chi manterrà il
      contratto**: se il costo del passaggio non torna, la correzione è una
      major, cioè la cosa che la
      [0002](../decisions/0002-additivita-del-contratto.md) è nata per rendere
      cara. E paga per una ragione ingrata: non perché la scelta fosse
      sbagliata, ma perché nessuno l'aveva provata quando provarla era gratis.
- [ ] **(c) Restringere il freeze a ciò che è stato esercitato.** Congelare le
      famiglie che le dieci feature ufficiali usano davvero, e lasciare
      esplicitamente *non congelato* il resto. Paga **chi scriverà i primi
      plugin**: contro una superficie più piccola e con meno garanzie. Onesto,
      e scomodo da comunicare.

**4. Che cosa il repo ha già deciso qui vicino.**

* La [0002](../decisions/0002-additivita-del-contratto.md): dopo il freeze si
  aggiunge, non si cambia. È ciò che rende questa voce **P0** e non P1 — non c'è
  una seconda occasione più tardi.
* La [0057](../decisions/0057-la-dieta-dell-ipc.md): la superficie IPC si tiene
  sotto dieta perché ogni porta in più è una cosa che un plugin non avrà. La
  disciplina è la stessa, applicata al varco.
* La [0054](../decisions/0054-il-banco-del-lato-provider.md) e la
  [0055](../decisions/0055-il-banco-del-lato-host.md): due banchi, uno per lato.
  Nessuno dei due sta **sul confine**, e il verbale del primo lo dice —
  `MemoryHost` è un doppio, e i test end-to-end col kernel vero sono la
  mitigazione. Contro un guest WASM non esiste né l'uno né l'altro.
* La [0064](../decisions/0064-il-supporto-sta-sotto.md): un fatto sulla forma
  del contratto che non si può chiudere si **scrive**. Questa voce applica la
  stessa regola a un fatto che non si può sapere.

---

### 27.2 Un plugin può osservare dopo, non decidere prima

*aperta · strato **contratto** · **P0***

**1. La domanda.** Il contratto ha undici trait di estensione. Tutti e undici
sono **posteriori** o **paralleli** alla scrittura: nessuno permette di
interporsi *fra* la decisione di scrivere e i byte che atterrano. Serve un punto
di interposizione — e se serve, questa è la specie di firma che dopo il freeze
non si aggiunge senza una major?

**2. Che cosa si osserva oggi, misurato.** Censimento a `69e25b0`.

L'unico trait che vede passare una mutazione è `EventHandler`
(`crates/fub-abi/src/traits.rs:3708`), e ha due metodi: `subscribed` e `handle`.
Il secondo torna un `Result` — che sembra un veto, e non lo è. Il chiamante è
`crates/fub-kernel/src/workspace.rs:5355`, e lì l'errore diventa un **guasto
registrato**:

```rust
fault = handler.handle(notice, &mut host).err();
```

Il commento accanto dice esattamente la semantica, e ha ragione a dirla:
*«l'errore di un handler non deve far fallire l'operazione che ha emesso
l'evento»*. Quando `handle` viene chiamato, il disco è già stato scritto —
l'ordine del corpo di una scrittura è dichiarato in
`crates/fub-kernel/src/workspace.rs:2287`: parse, disco, ingestione, dispatch.

Ne segue che **tre cose del piano non possono essere plugin**, e non per una
mancanza di capacità ma per una mancanza di *momento*:

| Chi | Cosa gli serve | Cosa il contratto offre |
|---|---|---|
| un sync | risolvere il merge **prima** che il file atterri | l'evento di ciò che è già atterrato |
| una politica di vault (*«questa nota non esce da qui»*) | negare una scrittura | un guasto dopo la scrittura |
| la cifratura | interporsi sotto il supporto | `VaultStorage`, che è del kernel e non del contratto |

Il terzo caso ha già lasciato una traccia visibile: l'indice tantivi passa **di
fianco** al supporto, gli si dà una cartella vera del filesystem, e la
`mappa-visuale` lo scrive come «segna fin dove arriverà il supporto cifrato».

I tre implementatori di `EventHandler` che esistono — il versioning, i pesi
della ricerca, la spia del banco — funzionano bene **proprio perché** sono
osservatori: nessuno dei tre ha mai avuto bisogno di dire di no.

**Come si rimisura.**

```sh
grep -n "pub trait EventHandler" -A 4 crates/fub-abi/src/traits.rs
grep -rn "handler.handle(" crates/fub-kernel/src
grep -rn "impl EventHandler for" crates/*/src
```

**3. Le forme, e chi paga.**

- [ ] **(a) Un trait nuovo, prima del freeze: chi può dire di no.** Una firma
      sola, sincrona, che riceve l'operazione proposta e risponde «passa» /
      «passa così» / «no, con questa ragione», e che gira **dentro** il prestito
      esclusivo prima della scrittura. Paga **il contratto** — una firma per
      sempre — e paga **chi scrive** — ogni scrittura passa da un giro in più,
      anche quando nessuno è registrato. In cambio il sync, le politiche e la
      cifratura diventano cittadini normali invece di casi speciali del kernel.
- [ ] **(b) Solo un punto di aggancio del supporto.** Non un veto: la
      possibilità di sostituire `VaultStorage`, che copre la cifratura e non
      copre il merge. Paga **chi vuole il sync**, che resta fuori. Più piccola,
      e risolve un terzo del problema.
- [ ] **(c) Com'è oggi.** Paga **il piano**: FubSync e ogni politica di vault
      restano codice del kernel o dell'host, cioè cose che un terzo non può
      scrivere — e la frase *«una feature ufficiale è ciò che scriverà un
      plugin»* smette di essere vera per una classe intera di feature. E il
      giorno che si aggiunge, si aggiunge dopo il freeze.

**4. Che cosa il repo ha già deciso qui vicino.**

* La [0127](../decisions/0127-la-mutazione-e-il-prodotto-della-scrittura.md): la
  mutazione **è** il prodotto della scrittura. È la ragione per cui l'evento non
  può che venire dopo — e quindi la ragione per cui il punto di interposizione,
  se ci sarà, non è un evento.
* La [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md) e il §20.3: un
  errore di handler non fa fallire l'operazione, **ma si dice**. Il
  ramo «non far fallire» è deciso; il ramo «poter impedire» non è mai stato
  posto.
* La [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md): una scrittura o
  c'è o non c'è. Un veto che arrivasse a metà romperebbe quella promessa —
  ragione in più perché il momento giusto sia *prima del disco*, non durante.
* La [0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md): la
  superficie di scrittura non vieta, semplicemente non dà gli strumenti. Questa
  voce chiede se fra quegli strumenti ne manchi uno.
* [plugin-boundary.md](../architecture/plugin-boundary.md): il metro per
  decidere cosa non può essere solo un guest nomina già *«agisce prima o dopo la
  scrittura»* come una delle tre misure. La voce è il seguito di quella riga.

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
