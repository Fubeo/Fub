# 0164 — Il secondo backend è vivo, e si monta una interfaccia alla volta

**Stato**: accolta **Data**: 2026-08-15 **Apre**: [M5](../milestones/M5-wasm-runtime.md)
**Commit**: *(questo commit)*

---

## La domanda

Il contratto è congelato dal 2026-08-14 (`fub:abi@0.1.1`), e fino a ieri nessuno
lo aveva **chiamato**. Le due prove che esistevano erano tutt'e due statiche:
`wit_conformance` legge il WIT e dice che è valido, `tools/varco-wasm` lo genera
e lo compila lato guest e dice che si lascia attraversare — la
[0146](0146-il-contratto-attraversa-il-confine.md) lo scriveva per esteso nel
proprio buco dichiarato, «*il varco prova che il contratto è costruibile, non che
il passaggio sia economico*», e rimandava a un crate che sarebbe nato a M5.

Quel crate adesso c'è, e questo verbale registra le scelte che lo hanno
fatto nascere. Non ne propone nessuna: sono tutte prese, tutte scritte, tutte
sotto un test.

## Il crate, e la sola riga che lo giustifica

**Nasce `crates/fub-wasm-host`: il secondo backend del contratto.** La ragione
per cui è un crate separato è una riga sola, ed è l'invariante del §16.1:
**wasmtime sta qui e in nessun altro posto del workspace.** La versione è
dichiarata in `[workspace.dependencies]` della radice, come tutte le altre,
perché una versione si scrive in un posto solo — ma la nomina **un crate solo**.
`fub-kernel` e `fub-abi` non la nominano: il kernel vede `dyn Trait` e non deve
sapere che di là dal confine c'è una macchina virtuale.

Il resto del manifest è conseguenza: `wasmtime = { version = "47",
default-features = false }` più le tre feature senza cui non c'è niente da fare —
`cranelift` per compilare, `runtime` per eseguire, `component-model` perché è la
lingua che il contratto parla. Restano fuori `cache`, `parallel-compilation`,
`wat`, `gc`, `threads`, `addr2line`, `demangle`, `debug-builtins`: un componente
di questo contratto non ne tocca nessuna, e ogni feature accesa è albero da
compilare a ogni giro di prova del repo. La dipendenza verso `fub-host` va in
questo verso e non nel suo contrario — `fub-host` non nomina questo crate —
perché la freccia girata farebbe finire wasmtime nell'albero di chi monta le
feature ufficiali, cioè precisamente ciò che l'invariante vieta. Chi vuole
tutt'e due li prende tutt'e due, ed è `fub-app`.

## I binding si generano dal WIT **vivo**

`bindgen!` legge `../fub-abi/wit/fub/abi.wit` e **non** la copia congelata in
`wit/frozen/0.1.1.wit`. La distinzione è la ragione per cui le due copie
esistono: la copia congelata è il **presidio** della baseline — nessuno la tocca,
e un `diff` dice se qualcuno l'ha fatto — mentre il file vivo è la **sorgente**.
Un host generato dalla copia sarebbe un host che non si accorge di una rottura
del vivo, cioè il presidio girato dalla parte sbagliata: verde mentre la cosa che
deve sorvegliare è già rotta.

## Un rifiuto è un valore, non un trap

**`trappable_imports` resta spento.** Una capacità che dice di no risponde
`plugin-error`, che è un **valore del contratto**, non un trap. La differenza non
è di stile: un trap abbatte l'istanza, e «non ti è concesso» non è una ragione
per abbattere niente. La conseguenza è provata, non argomentata: nel test del
cancello (§7.3) il componente riceve `PermissionDenied` e **l'istanza è ancora
viva** — il job torna con un errore che si legge, invece che con un'istanza
morta.

Da cui anche il verso opposto, in `componente.rs`: ogni trap che arriva davvero
diventa `PluginError::Internal` e non `PermissionDenied`, perché il rifiuto di
una capacità non passa mai da un trap, e quindi tutto ciò che trappa è un guasto
vero — memoria finita, un `unwrap` di là dal confine, un'istanza già morta.

## Una interfaccia alla volta, e la stessa scelta ai due capi

**Non si usa `PluginWorld::instantiate`.** Quella funzione pretenderebbe tutti
gli export del mondo, e `plugin-world` ne dichiara molti più di uno: `plugin`,
`format`, `syntax`, `renderer`, `command`, `view`, `index`, `event-handler`,
`service`, `importer`, `exporter`. Si istanzia e si risolvono le `GuestIndices`
**una interfaccia alla volta** — oggi solo `fub:abi/plugin` — ed è ciò che rende
possibile il «mezzo plugin» che il WIT stesso nomina, nel commento agli export di
`world plugin-world`: *«un plugin può implementarne uno senza implementare
l'altro — ed è esattamente ciò che "mezzo plugin" significa»*.

Dall'altro capo del confine, l'esempio fa la stessa scelta detta al contrario:
`esempi/ping-wasm` **dichiara un mondo suo** (`esempio:ping/ping` — due import,
un export) invece di implementare le interfacce del mondo intero, di cui tutte
tranne una sarebbero stub. Un ping che esporta una decina di stub per usarne uno
non è un esempio: è il rumore che nasconde l'esempio. Le due scelte sono la
stessa scelta, e stanno insieme: se l'host pretendesse il mondo, il componente
dovrebbe scriverlo.

## Si linka ciò che si implementa

**`add_to_linker` per interfaccia, non per world.** `aggiungi_al_linker` aggiunge
le famiglie che questo crate sa servire, una per una, e oggi sono **due**:
`host-env` (l'orologio, il locale, il caso, il fuoco) e `host-vault-read`
(leggere il vault). Sono quelle che il ping del primo plugin nativo attraversa,
cioè quelle su cui c'è una parità da provare.

La conseguenza è quella giusta: **una famiglia `host-*` importata e non servita è
un rifiuto al caricamento che la nomina** (`ErroreDiCaricamento::FamiglieNonServite`).
Nominarla è metà del messaggio — «manca una capacità» manda a cercare, «manca
`fub:abi/host-network`» manda a leggere il §20.3. L'alternativa era linkare tutto
con stub che rispondono `unserved`: darebbe un componente che si monta, gira, e
scopre a metà lavoro che una capacità non c'era. Lo stesso guasto, più tardi e
senza il nome.

**Il costo è dichiarato e non nascosto**: l'elenco `FAMIGLIE_SERVITE` è scritto a
mano accanto al linker, cioè due liste che devono restare allineate. Divergono in
un modo solo, e quel modo è un test che fallisce
(`una_famiglia_non_servita_si_fa_nominare`).

## Misurato al primo caricamento vero: il filtro è `host-`, non `fub:abi/`

Il filtro delle famiglie **non può essere** `fub:abi/`, e non è una previsione: è
ciò che è successo al primo caricamento di un componente vero. Un componente
importa anche le interfacce di **soli tipi** del contratto, quelle che servono a
*nominare* ciò che scambia e non hanno una sola funzione da linkare. Il ping ne
importava **otto**: `json`, `model`, `intl`, `text`, `errors`, `options`, `ui`,
`settings`. Contarle fra le famiglie non servite avrebbe rifiutato ogni
componente esistente, compreso quello che l'host serve per intero.

Da cui la costante `CONTRATTO = "fub:abi/host-"`: le famiglie di capacità del
§7.1 sono **tutte e sole** le `host-*`, e il prefisso è il modo più corto di
dirlo dove serve.

## WASI non è linkato

Ciò che non è `fub:abi/host-` riceve l'altro trattamento: un tappo che trappa
(`tappa_il_resto`). Il bersaglio di compilazione è
`wasm32-wasip2` — scelto perché produce un **componente**, che è ciò che wasmtime
istanzia, mentre `wasm32-unknown-unknown` produce un modulo core da convertire
poi con `wasm-tools component new`, cioè un attrezzo in più nella catena — e quel
bersaglio si porta dietro gli import d'ambiente (`wasi:cli`, `wasi:io`, …). Un
plugin di questo contratto non li chiama mai; chi li chiamasse trova un **trap**
invece di una porta aperta sul sistema operativo. È la sandbox nella sua forma
più corta: non una lista di divieti, una lista di permessi che finisce.

Il tappo è scritto qui e non preso dalla libreria, e anche questo è una misura,
non una preferenza: `Linker::define_unknown_imports_as_traps` di wasmtime,
davanti a un'istanza, non guarda se c'è già — la definisce comunque, e sulle due
famiglie appena linkate risponde «*map entry `fub:abi/host-env@0.1.1` defined
twice*». Quella funzione serve a chi non linka niente; qui il linker è per
interfaccia, e per interfaccia va anche il tappo. Nel farlo a mano si è visto il
secondo pezzo: un import può portare non solo funzioni ma **risorse** — è
`wasi:io/poll` con la sua `pollable` — e una risorsa non si tappa con un trap,
il tipo dev'esserci o l'istanziazione si ferma. Ne riceve uno vuoto: nessun
componente di questo contratto ne fabbrica una, perché le sole funzioni che
gliela restituirebbero sono già tappate.

## Il prestito dell'`HostApi`

Le due forme non combaciavano, e la giunzione è un modulo suo. Il contratto passa
`&mut dyn HostApi` **a ogni chiamata** (`run_job(&self, …, host: &mut dyn
HostApi)`): non c'è nessun momento in cui un plugin «ha» l'host: ce l'ha mentre
lo stanno chiamando, ed è deliberato, perché è ciò che permette al kernel di dare
a ogni chiamata un host incappucciato diversamente (§7.3). Wasmtime vuole il
contrario: lo stato sta nel `Store<T>`, che vive quanto l'istanza.

`crate::prestito` è la giunzione, e l'invariante è scritto per esteso accanto al
codice: lo `Store` tiene un puntatore all'host **valido solo dentro
`con_ospite`**, rimesso a posto da un `Drop` che gira anche se il corpo va in
panico. Fra i due istanti il riferimento originale è vivo per costruzione — è il
parametro della funzione che sta chiamando. Fuori da quella parentesi il campo è
`None`, e una host function che ci arrivasse lo stesso trova `None`: risponde
`internal` invece di leggere memoria altrui. L'`unsafe impl Send` è dichiarato
con la sua ragione, non subìto: un `*mut` non è `Send`, ma il solo momento in cui
il campo non è nullo è dentro `con_ospite`, che non attraversa nessun confine di
thread — mentre lo `Store`, che i thread li attraversa perché un job gira sul
pool, ci arriva sempre **vuoto**.

## L'enforcement non si sposta

**Le capacità continua ad applicarle il `Guard<H, P: Policy>` del kernel.** È il
punto unico dalla [0021](0021-il-confine.md) e resta l'unico: le host function di
`ospite.rs` ricevono un `&mut dyn HostApi` **già incappucciato** dalla politica
di quel plugin e si limitano a passargli la chiamata. Nessuna legge un permesso.
Un secondo punto in cui si decide chi può cosa sarebbe un secondo punto in cui
sbagliare, e il primo giorno in cui i due divergono non se ne accorge nessuno.

## La traduzione è scritta a mano, e la tiene il compilatore

Ogni tipo del contratto esiste in due copie: quella generata dal WIT e quella di
`fub-abi`. `src/traduzione.rs` è l'unico posto in cui si passa dall'una
all'altra, ed è **scritto a mano**. Non si generano dal WIT anche quelli di
`fub-abi` perché `fub-abi` è il contratto **anche per le feature native**, che
implementano gli stessi trait e non attraversano nessun confine: generare i loro
tipi da un WIT vorrebbe dire far dipendere il backend nativo dal modello dei
componenti, cioè l'invariante del §16.1 girata dalla parte sbagliata.

Il prezzo è due copie da tenere allineate, e chi le allinea non è la buona
volontà: è il compilatore, perché ogni conversione è una `match` **esaustiva**.
Il giorno che una delle due parti cresce di un caso, il modulo smette di
compilare e nomina la riga. La direzione sta nei nomi — `da_*` porta dal WIT al
Rust (ciò che il componente dice), `in_*` dal Rust al WIT (ciò che l'host gli
passa) — e un tipo che attraversa in un verso solo ha una funzione sola, che non
è una dimenticanza ma ciò che il contratto dice di lui.

## Le prove

Stanno in `crates/fub-wasm-host/tests/il_primo_componente.rs`, e la prima è un
**gemello**: stesso vault, stesso banco, stesso job, stesse asserzioni di
`crates/fub-host/tests/il_primo_plugin.rs`, con **una riga sola di differenza** —
là il bundle è una `struct` Rust, qui è un `.wasm`. Che tutto il resto non cambi
è ciò che il test prova: il §16.1 dice «un trait, due backend», e i due file
letti uno accanto all'altro sono quella frase in forma eseguibile. Il giro è
intero — montare, vedere il manifest **del componente** nell'inventario del §7.6,
far girare un job che legge il vault attraverso il confine, ricevere `UnknownJob`
col nome chiesto per un job che non esiste, smontare.

La seconda è il cancello del §7.3 davanti a un componente: **lo stesso** `.wasm`,
con un manifest che non dichiara `read-vault`, si monta lo stesso, e la sua prima
lettura riceve `PermissionDenied` — come valore, con il messaggio del kernel. La
terza è la famiglia non servita che si fa nominare, contro lo stesso ping
compilato verso un mondo che importa anche `fub:abi/host-network`. La quarta
pretende `Send + Sync` sul bundle, perché un job gira sul pool: se un giorno
smettesse, il test non compilerebbe.

Il componente lo compila il test, invocando `cargo` da sé invece di cercare un
artefatto che qualcun altro dovrebbe aver prodotto: un test che si salta da solo
quando il file non c'è è un test che un giorno non gira più e nessuno se ne
accorge. Se manca il bersaglio, il fallimento dice come installarlo. Da cui anche
`esempi/ping-wasm` nell'`exclude` della radice, accanto a `tools/varco-wasm` e
per la stessa ragione della [0146](0146-il-contratto-attraversa-il-confine.md):
`cargo test --workspace` non deve pretendere un bersaglio che il workspace non
ha.

L'esempio **non dipende da `fub-abi`**, ed è il punto: un plugin di terzi ha in
mano il WIT e nient'altro, e se l'esempio potesse chiamare il crate Rust del
contratto non proverebbe niente di ciò che deve provare.

## Le forme scartate

- **`PluginWorld::instantiate`, cioè il mondo intero.** Paga chi scrive un
  plugin: dovrebbe esportare ogni interfaccia del mondo per implementarne una.
  Uccide il «mezzo plugin» che il WIT dichiara, e lo uccide dal lato host, dove
  nessuno andrebbe a cercarlo.
- **`add_to_linker` del world, con stub che rispondono `unserved`.** Paga
  l'utente: il plugin si monta, gira, e si rompe a metà lavoro. Lo stesso guasto
  del rifiuto al caricamento, ma più tardi e senza il nome della famiglia che
  manca.
- **Filtrare gli import su `fub:abi/`.** Scartata da una misura, non da un
  ragionamento: le otto interfacce di soli tipi che il ping importa avrebbero
  fatto rifiutare ogni componente esistente.
- **`wasm32-unknown-unknown` più `wasm-tools component new`.** Un attrezzo in più
  nella catena, e il bersaglio che produce un componente esiste già.
- **Linkare WASI.** Aprirebbe una porta sul sistema operativo per un ambiente che
  nessun plugin di questo contratto chiama. Il trap costa niente e dice di più.
- **Generare dal WIT anche i tipi di `fub-abi`.** Farebbe dipendere il backend
  **nativo** dal modello dei componenti: l'invariante del §16.1 al contrario. Il
  prezzo scelto al suo posto — due copie e una `match` esaustiva — lo paga il
  compilatore, non il manutentore.
- **Un secondo punto di enforcement nelle host function.** Sarebbe stato comodo
  (il permesso si legge lì, dove si sa che cosa sta chiedendo il componente) ed è
  esattamente la cosa che la [0021](0021-il-confine.md) esiste per non avere.
- **Un modello vuoto invece di `unserved` per `read-model`.** Un modello vuoto è
  una risposta **sbagliata** a una domanda giusta: chi lo ricevesse concluderebbe
  che la nota non ha niente dentro.

## Cosa resta fuori

Dichiarato per intero, perché niente di questo elenco venga scambiato per una
svista.

- **Gli altri export del mondo.** Solo `fub:abi/plugin` attraversa: `command` —
  cioè `CommandProvider` — e tutte le altre interfacce esportate non ancora.
  Conseguenza visibile: il quarto passo del montaggio, `Bundle::register`, oggi
  non registra nulla e torna una lista vuota. È il prossimo passo di M5, ed è
  scritto nel codice come una scelta invece che come un `todo!` che qualcuno
  scopre in produzione.
- **`host-events`.** Non linkata: dall'interno di un componente non si chiamano
  `spawn_job`, `report_progress`, `emit`. Un componente parla quando gli si parla.
- **`read-model`.** Risponde `unserved` **col proprio perché**: `document-model` è
  l'albero più grande del contratto — blocchi, intestazioni, link, proprietà — e
  tradurlo è un passo suo, non una riga di questo.
- **L'interruzione a epoche e i limiti di memoria.** M5 li descrive («deadline
  severa per chiamata», fuel, limiti); oggi non ci sono. Un componente lento o
  ostile non viene ancora interrotto.
- **`UiNode::validate_untrusted`.** Il proxy non lo applica, perché nessun albero
  di UI attraversa ancora il confine — ma il giorno che `view` sarà fra gli
  export risolti, questa riga è il primo debito da saldare.
- **I prefissi di path del §7.1.** Il `vault_scope` non ritaglia ancora niente in
  questo backend: ciò che il `Guard` concede, lo concede intero.
- **Il numero accanto ai 275 KB.** La [0146](0146-il-contratto-attraversa-il-confine.md)
  aveva lasciato aperto il costo del **passaggio**, non della costruzione. Adesso
  esiste un host che esegue, quindi la misura si può fare — ma questo verbale non
  la porta, e dire un numero non misurato sarebbe peggio che non averlo.
