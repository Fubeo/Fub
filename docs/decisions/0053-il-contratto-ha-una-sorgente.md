# 0053 — Il contratto ha una sorgente, e due confini che non hanno la stessa forma

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §16.4 + §16.5 (seduta 16) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) · [il presidio dell'additività](../architecture/wit-congelato.md)

---

Due voci in un verbale solo, e lo chiedeva la seduta stessa: *«la 16.5 non è una
voce autonoma: è la gamba TS della domanda che pone la 16.4. Decidere "da cosa si
genera il mirror" separatamente da "da cosa si generano WIT e arena" significa
decidere due volte la stessa cosa, e la seconda volta contro la prima.»*

La domanda era una: **da quale dei quattro posti — Rust, WIT, arena, mirror TS —
si generano gli altri tre.** La risposta è che la sorgente è **Rust**, e che
«gli altri tre» non esistono: i quattro posti non sono quattro grafie della
stessa cosa, e la voce lo dava per scontato. Sotto, misurato.

## La premessa del §16.4 è rovesciata, e si vede dal sorgente

Il §16.4 scartava i tipi Rust così: *«la sorgente autorevole del contratto non è
Rust: è il WIT, ed è già il repo a trattarlo così —
`wit_conformance.rs` parsa il WIT e ci confronta i tipi Rust, non il
contrario»*.

Il fatto è vero e la conclusione no, perché **la direzione del parse è opposta
alla direzione della verità**: si parsa ciò che si controlla, non ciò di cui ci
si fida. Il cappello di `wit_conformance.rs` lo dice in prima persona, sotto il
titolo *«Da dove vengono i tipi attesi»*:

> Non sono scritti a mano. `wit(&campo)` deduce la forma WIT **dal tipo Rust del
> campo destrutturato**: se `SearchHit::score` diventasse `f64`, l'attesa
> diventerebbe `f64` e il confronto col contratto (`f32`) fallirebbe.

E lo fa in tre modi, tutti ancorati a Rust: `WitType` sul campo destrutturato,
`WitFn` sul **cast del metodo di trait a puntatore a funzione**, e
`rust_enum_order`, che parsa il sorgente Rust con `syn` e il cui commento dice
alla lettera *«l'enum è la verità»*. Il WIT è l'**osservato**; l'atteso viene
da Rust. Il repo tratta come autorevole esattamente il posto che la voce
escludeva.

La conseguenza è che il **§16.5 aveva ragione sulla direzione** — generare dai
tipi Rust — e torto sullo strumento, per un motivo che nessuna delle due voci
nomina: `ts-rs` e `schemars` funzionano per `derive`, cioè sarebbero
**dipendenze normali del crate del contratto**. `fubmd-abi` ha un'allowlist
*chiusa ed enumerata* — quattro dipendenze — presidiata da
`dependency_invariant.rs`, ed è il firewall anti-lock-in del progetto. Erano gli
strumenti sbagliati per questo crate, non per questa direzione.

## Perché non «gli altri tre»: i quattro posti non sono quattro grafie

### Il WIT e il mirror TS sono due confini con due forme diverse

È il fatto che decide tutto, e si misura sulla fixture. `Event` attraversa
l'**IPC** come serde lo serializza — tag interno, `snake_case`, piatto:

```json
{"type": "trouble", "severity": "warning", "subject": "a.md", "error": {…}}
```

e attraversa il **WIT** come un `variant` del component model, con il payload in
un record a sé:

```wit
variant event { …, trouble(event-trouble) }
record event-trouble { severity: severity, subject: option<doc-id>, error: plugin-error }
```

Il record `event-trouble` **nel JSON non esiste affatto**. Lo stesso vale per
`index-result`, che di qua è `{"kind": …, "value": …}` (tag adiacente) e di là è
un `variant` nudo. Un generatore TypeScript che leggesse il WIT produrrebbe la
forma di un confine che il TypeScript non attraversa mai — e la sbaglierebbe in
silenzio, perché entrambe le forme sono JSON valido.

E il mirror è anche **più largo** del contratto: dei 99 tipi esportati da
`frontend/src/host/contract.ts`, **dodici** non hanno nessuna controparte WIT
(`VaultInfo`, `OpenVaults`, `Trust`, `Registration`, `RegistrationKind`,
`PluginInfo`, `VersionRef`, `RenderedDocument`, `RenderedPart`, `EmbedContent`,
`BundleInfo`, `KnownVault`) perché rispecchiano `fubmd-kernel` e `fubmd-app`,
che nel contratto non ci sono **per scelta**.

### Il WIT non è generabile come file, e il numero è metà

`crates/fubmd-abi/wit/fubmd/abi.wit` è **3386 righe, di cui 1683 di commento**:
il 49,7%. E non è una copia dei doc-comment Rust — è prosa di un altro registro,
per un altro lettore. Il `record span` del WIT spiega perché al confine gli
estremi sono `u64` e non `usize` e cosa succede su wasm32; il `Span` di Rust non
lo dice, e ha invece link intra-doc (`[rules::media::kind_of]`) che nel WIT non
significano niente. Chi legge il WIT a M5 scrive un guest e non ha i sorgenti
Rust davanti.

Generare l'`abi.wit` vuol dire buttare quella prosa, o trasferirla in Rust dove
ha un altro pubblico, o tenerla in un sidecar da interpolare — cioè un **quinto
posto**. Nessuna delle tre si prende in cambio di quattro dichiarazioni corte.

Il verso opposto è peggio: generare Rust dal WIT (`wit-bindgen`) sostituirebbe
17.150 righe di contratto — con `Event::names()`, `is_recoverable()`,
`EditReport::inverse()`, le conversioni di `arena`, le `rules` — con dei DTO
piatti più uno strato di conversione. E il WIT ha un sistema di tipi più povero:
`Paged<T>` è **un** tipo Rust e **nove** record WIT. Si tornerebbe indietro. Il
repo lo aveva già scritto, in [M4-wit-hardening.md](../milestones/M4-wit-hardening.md):
il test di conformità dà *«la proprietà che si voleva da `wit-bindgen` +
`From`/`Into`, senza generare codice»*.

### L'arena non è un quarto posto della stessa specie

`abi/src/arena.rs` sono 2008 righe con `ArenaError`, rilevamento dei cicli e
conversione controllata `u64→usize`: è il **codice Rust che implementa la scelta
di rappresentazione del WIT** per i tipi ricorsivi, non una quarta scrittura dei
tipi. Per un tipo non ricorsivo il suo costo è **zero** — né `Event::Trouble` né
`IndexLoss` l'hanno toccata. Contarla fra i quattro posti gonfia il conto con un
termine che la stragrande maggioranza dei tipi non paga.

## Il conto vero, ricontato

Il §16.4 si intitola *«Il contratto si scrive quattro volte a mano»*. «Quattro»
è **un'unità di conto e non un conteggio di file**: sono quattro *posti
concettuali*, e come tali il numero regge (con la correzione dell'arena qui
sopra). Il conteggio dei **punti di scrittura** è un'altra cosa, e nessuno
l'aveva fatto.

La variante additiva dell'ultimo commit — `Event::Trouble` più l'enum `Severity`
— ha toccato **otto file, sette a mano**, per circa **ventidue punti di
scrittura**:

| posto | punti | natura |
|---|---|---|
| Rust (`event.rs`, `lib.rs`) | 6 | la definizione — 3 obbligati dal compilatore |
| WIT (`abi.wit`) | 4 | la dichiarazione del confine WASM |
| arena | 0 | non ricorsivo |
| mirror TS (`contract.ts`) | 3 | la dichiarazione del confine IPC |
| **presidi** (`wit_conformance`, `ts_mirror`, `mirror.test`) | **~10** | **ripetono ciò che i primi quattro dicono già** |
| fixture | 0 | già generata |

**Il termine più grande non è nessuno dei quattro posti: sono i presidi.** Il
§16.4 dice *«il presidio verifica il costo, non lo riduce»*; la misura dice di
più — il presidio **è** il costo maggiore, ed è l'unico che non aggiunge nessuna
informazione.

E dentro il presidio la parte ridondante è **dimostrabilmente** tale, non per
opinione:

- **174 delle 203 voci** di `wit_type!` erano esattamente `kebab(NomeRust)`, e
  `fn kebab` stava nello stesso file. Le altre sono sedici scelte vere (un
  primitivo che si scrive diverso, il JSON opaco, le nove istanze di `Paged<T>`,
  l'unico aliasing deliberato `UiNode => ui-tree`) più tredici che al confine non
  compaiono affatto.
- **Tutte e 26** le chiamate a `enumeration_src` scrivevano a mano un elenco di
  casi che la funzione stessa **ricalcolava** con `rust_enum_order` per poi
  confrontarcelo. L'elenco a mano non era la verità: era una seconda occasione di
  sbagliare, che il test poi correggeva. Con i loro diciotto helper `*_name`
  (usati **una volta ciascuno**) facevano 376 righe.

## La decisione

> **La sorgente è Rust.** Il WIT e il mirror TS sono due **proiezioni** su due
> confini diversi, entrambe a valle di Rust, ed entrambe hanno già il loro
> proiettore scritto in repo: `serde` per il JSON dell'IPC, `WitType`/`WitFn`
> per il WIT. **Non si genera nessuno dei quattro posti dall'altro**: si genera
> ciò che finora li ripeteva, e la prima cosa da derivare è ciò che è già
> derivabile senza riscrivere serde.

Concretamente, tre pezzi.

**1. Un lettore solo del sorgente, due proiettori** (`tests/common/mod.rs`).
Legge una dichiarazione di enum con `syn` e ne restituisce i casi **nell'ordine
in cui sono scritti** — l'unica cosa che né il compilatore né serde
garantiscono, e che è il discriminante ABI. Sopra ci stanno `kebab` (→ WIT) e
`snake` (→ JSON di serde). Che siano **due** funzioni e non una è la forma
minima del fatto che regge tutta la decisione.

**2. Il primo posto generato** (`tests/ts_enums.rs` →
`frontend/src/host/enums.generated.ts`). Le union di stringhe di **tutti e soli**
gli `enum` senza payload del contratto — ventisei — emesse dai tipi Rust.
`contract.ts` le ri-esporta tenendo accanto la prosa, che è l'unica cosa di
quelle union che non si deriva da niente.

**3. Il presidio smette di ripetere.** `enumeration_src` diventa
`enumeration_from(nome_wit, (file, EnumRust))`: i casi si leggono dal sorgente
invece di riscriverli. E `wit_kebab!` affianca `wit_type!`: 174 tipi dichiarano
di attraversare il confine senza più dichiarare *come si scrivono di là*.

## Le decisioni prese, da NON ridiscutere senza motivo

### Gli enum **con** payload restano a mano, e non è un rinvio

La loro forma JSON dipende da `tag`/`content`/`rename_all`, dai campi, dai tipi
annidati e dalla regola degli `u64` come stringa (`fubmd_abi::ipc`): derivarla
vuol dire **riscrivere serde**, cioè avere una seconda implementazione della
serializzazione che può divergere da quella vera. Per quelli la risposta giusta
è quella che c'era già ed è un derivato anche lei: la fixture generata da serde
(`fubmd-features/tests/ts_mirror.rs`), che non descrive il formato — lo
*esegue*.

La riga di taglio, quindi, non è «enum sì, record no»: è **ciò che si deriva
senza reimplementare serde**.

### Il presidio non confronta un file con sé stesso

È l'obiezione da farsi, ed è la ragione per cui la generazione si è fermata
prima dell'`abi.wit`. Nel `wit_conformance` di adesso i due lati restano due:
l'atteso viene da Rust (come prima, e più di prima), il dichiarato viene dal
**WIT scritto a mano e parsato**. Non è cambiato cosa si confronta: è sparito
l'intermediario, cioè l'elenco a mano che stava fra i due e che il test
correggeva da sé.

E il presidio sa ancora fallire — provato, non asserito:

- `wit_conformance_actually_fails_on_drift` gira verde con le sue quattordici
  mutazioni, **compresa** *«casi di un enum riordinati (cambia il
  discriminante)»*, che è quella che la forma derivata avrebbe potuto perdere;
- `ts_enums.rs` ha il proprio `ogni_forma_di_divergenza_e_rossa` — gemello di
  `ogni_forma_di_rottura_e_rossa` di `wit_additivity` — con le quattro forme in
  cui il file generato può divergere: un caso in più, uno in meno, uno
  rinominato, **due riordinati**. L'ultima è quella che conta: non cambia
  nessuna stringa e sull'IPC non cambia niente, ma è il discriminante del WIT.

### `wit_additivity` non è toccata, ed è il presidio che conta di più

Il taglio è stato scelto anche per questo. `wit_additivity.rs` confronta
l'`abi.wit` con `wit/frozen/0.1.0.wit` **parsando** entrambi, non facendo diff di
testo: la formattazione e i commenti gli sono invisibili. Ma la sua sorgente —
l'`abi.wit` — resta scritta a mano, quindi la promessa pubblicata continua a
essere presidiata da un confronto fra due cose che nessuno ha derivato l'una
dall'altra. È l'unico presidio che protegge **plugin di terzi già compilati**, ed
è quello su cui non conviene risparmiare righe.

### La riga in più che il TypeScript ha guadagnato

`EventKind` è emesso, e `KernelEvent` no (è tagged). I due però devono dire lo
stesso insieme, e adesso lo dicono per costruzione: in `mirror.test.ts` c'è
un'asserzione di **tipo** che verifica `KernelEvent["type"] ≡ EventKind` nelle
due direzioni. Un `Event` nuovo in Rust fa crescere `EventKind` da solo — perché
l'elenco degli enum è una **regola** e non una lista — e da quel momento
`npx tsc --noEmit`, che gira in CI, non compila finché `KernelEvent` non porta il
caso. È l'esaustività chiesta dal
[§16.7](../roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
ottenuta senza nessun elenco scritto a mano.

### L'elenco dei tipi generati è una regola, non un elenco

`fieldless_enums()` scandisce `fubmd-abi/src/*.rs` e prende **tutti** gli `enum`
pubblici senza payload. Non c'è una lista da aggiornare: è il §16.7 applicato al
generatore stesso, che altrimenti sarebbe nato con il difetto che il §16.5
esisteva per curare. E se un enum senza payload non dichiara
`rename_all = "snake_case"`, il lettore **panica col nome del tipo** invece di
proiettarlo in `CamelCase` e lasciare che la shell sbagli un confronto di
stringhe mesi dopo.

## Il cliente vero, e la controprova

Una decisione «si genera da X» che non generi davvero uno dei posti sarebbe la
stessa promessa che il §16.4 rimprovera al §16.5. Il posto generato è il
**mirror TS** per la sua parte derivabile, e la controprova è stata fatta
aggiungendo un caso finto a `EventKind` e guardando il rosso spostarsi:

1. la sola dichiarazione Rust rende rosso `cargo test -p fubmd-abi --test
   ts_enums`, che **nomina il caso** (`+ "scatola_finta"`) — e nessuno aveva
   registrato niente da nessuna parte;
2. rigenerando (`UPDATE_MIRROR=1`) il rosso passa di là: `npx tsc --noEmit`
   fallisce su `_le_specie_di_evento_coincidono`, perché `KernelEvent` non porta
   il caso.

È lo stesso meccanico della fixture — *«nessuno dei due lati può cambiare da solo
restando verde»* — con una differenza che è il punto di tutta la voce: **il primo
rosso adesso è automatico.** Prima bisognava ricordarsi di aggiungere un
campione.

## Il costo, misurato

La prova chiesta dal piano — *aggiungere un tipo finto al contratto e contare
quante volte lo si scrive* — fatta su un `enum` senza payload
(`ProvaFinta { CasoUno, CasoDue }`), portato fino al verde e poi tolto:

| | prima | adesso |
|---|---|---|
| volte che si scrivono **i casi** | 4 (Rust, WIT, `enumeration_src` + helper `*_name`, `contract.ts`) | **2** (Rust, WIT) |
| righe da scrivere nel presidio | ~14 (voce di `wit_type!` + chiamata + helper) | **3**, nessuna delle quali nomina un caso |
| mirror TS | 1 union scritta a mano | **derivata** |

Le due volte che restano sono le due che non sono ripetizione: la definizione, e
la sua dichiarazione **nell'altra notazione, per l'altro confine**.

E il conto che è **salito**, perché va detto: le righe totali. Il presidio ha
perso 309 righe (`wit_conformance.rs`: 5498 → 5189) e il repo ne ha guadagnate
376 fra generatore e lettore condiviso, più 102 di file derivato. È il baratto
di ogni generatore, ed è giusto solo perché ciò che scende è il costo **per tipo
nuovo**, che si paga a ogni voce di FEATURES, mentre ciò che sale si è pagato una
volta.

## Cosa si è scartato, e perché

- **Generare `abi.wit` da Rust.** Il proiettore c'è già (`WitType`/`WitFn`
  *calcolano* il WIT atteso e poi lo buttano), quindi tecnicamente è a portata.
  Lo blocca la prosa: 1683 righe su 3386, senza sorgente Rust e con un altro
  lettore. Riprenderlo vorrebbe dire prima decidere dove vive quella prosa, ed è
  una decisione che nessuna voce chiede oggi.
- **Generare Rust dal WIT (`wit-bindgen`).** Vedi sopra: DTO piatti al posto di
  un contratto con del comportamento dentro, generici persi, e la scelta già
  presa e scritta a M4.
- **`ts-rs`/`schemars`** (la proposta del §16.5). Direzione giusta, strumento
  sbagliato: `derive` = dipendenza normale di `fubmd-abi`, contro
  `dependency_invariant.rs`. E nessuno dei due emette WIT, cioè lasciavano
  scoperto il posto che il §16.4 aveva aggiunto alla domanda.
- **Un quinto posto** (uno schema neutro da cui generare tutti e quattro). Il
  repo ha già scartato la forma equivalente per le regole: la
  [0020](0020-le-regole-in-un-posto-solo.md) ha scelto una **fixture generata**
  che tiene uguali due copie, non una terza sorgente da cui derivarle.
- **Un `build.rs`.** `dependency_invariant.rs` guarda solo le dipendenze
  *normali*, quindi passerebbe — ma metterebbe il generatore nel percorso di
  compilazione di chiunque usi il crate, per produrre un file che serve solo a
  questo repo. Sta in un test, dov'è già la fixture, per la stessa ragione.

## Cosa resta scoperto, dichiarato

- **Record e variant con payload del mirror TS** restano scritti a mano, ed è la
  decisione qui sopra: li presidia la fixture. Non è una casella residua — non
  c'è niente da fare, c'è una riga di taglio da rispettare.
- **La prosa dell'`abi.wit`** è il vincolo che tiene aperto il verso «genera il
  WIT». Se un giorno la si vorrà derivare, la domanda da porre prima è *dove vive
  la documentazione del confine*, non *quale strumento genera*.
- Il [§16.7](../roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
  resta aperto e questa decisione gli porta due prove: la scoperta per regola
  (`fieldless_enums`) e l'asserzione di tipo su `EventKind` sono due presidi
  **esaustivi per costruzione** in un posto che prima era un elenco. Ciò che il
  §16.7 chiede ancora — l'inventario dei provider ufficiali, le capacità del
  `TriesEverything` — non è toccato, e continua a passare per il banco del
  [§16.2](../roadmap/16-crate-sdk-banchi-di-prova.md#162-il-banco-di-prova-del-kernel-è-copiato-diciotto-volte).
