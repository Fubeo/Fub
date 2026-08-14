# 0161 — La porta entra nel Trouble

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: la casella «Mancanza di
contesto in `Event::Trouble`» della [§17.3](../roadmap/17-presidi-che-restano.md)
**Commit**: *(questo commit)*

---

## La domanda

La [§17.3](../roadmap/17-presidi-che-restano.md) teneva una casella aperta:
*«l'evento omette la porta d'ingresso»*. La
[0105](0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) aveva codificato
le porte dei plugin nel **dato** `Gate` — tredici varianti — ma l'`Event::Trouble`
trasportava unicamente la stringa finale, già composta. La voce chiedeva il
campo porta per due usi: il centro notifiche che **raggruppa** anomalie simili
(«aggrega tre guasti dispersi causati dallo stesso plugin in un singolo
render») e il **conteggio** a livello di registro. Il rinvio era dichiarato: la
modifica impatta un tipo del **contratto**, e la §23.15 escludeva la priorità.

## La premessa, rimisurata

- **Il `Gate` è salito nel contratto, e il kernel lo riusa.** Viveva in
  `fub-kernel/src/safety.rs`; adesso sta in `crates/fub-abi/src/gate.rs`
  (tredici varianti, `Gate::ALL`), perché `Event::Trouble` lo nomina e il tipo
  di un evento è un tipo del contratto. Il kernel lo re-esporta da
  `safety.rs:92` (`pub use fub_abi::Gate`) e lo riusa nei suoi `match`
  esaustivi e nel banco `il_panico.rs`, che prova porta per porta che un
  panico arriva dove deve.
- **`Event::Trouble` aveva solo `severity`/`subject`/`error`; adesso ha
  `gate: Option<Gate>` in fondo** (`crates/fub-abi/src/event.rs:611-630`), col
  doc che lo dice per esteso: *«è in fondo al record come ogni campo nuovo, e
  chi lo legge per primo non deve saperlo: la 0105 diceva che il Gate non
  arriva nell'evento e restava una casella della seduta 17, e questa è la
  finestra che la chiude»*. La stessa forma è nel WIT: `record event-trouble {
  severity, subject, error, gate: option<gate> }` (`abi.wit:1337-1342`), con
  `gate` in fondo e `enum gate` accanto.
- **`report_trouble` prende `Option<Gate>`** (`workspace.rs:5838-5843`), e
  l'unico punto da cui il kernel emette un guasto lo passa a `emit_event`
  come tutto il resto.
- **I guasti che passano da una porta portano `Some(gate)`.** Le funzioni
  della rete — `calling`, `caught`, `reporting` (`safety.rs:113-136, 165`) —
  ricevono **sempre** un `Gate`, mai `None`: si entra da una porta o non si
  entra. Il caso in albero in cui il guasto da porta diventa un `Trouble` è la
  consegna a un `EventHandler`: `deliver_to_handlers` emette
  `Some(Gate::Event)` (`workspace.rs:6087`). Gli altri guasti da porta —
  comando, view, servizio, indice — tornano come `Err` al chiamante, che è la
  loro superficie.
- **I guasti del vault portano `None`.** Il flush (`workspace.rs:4825`), il
  watcher (`:3158`), il journal (`:2652`), il cestino (`:3402`), gli scartati
  all'apertura (`:2299`), le perdite dell'alimentazione (`:5865`), l'host
  (`host/kernel.rs:355`) e il versioning (`versioning.rs:1364, 1374, 1396,
  1538`): nessuno passa da una porta, e dire una porta sarebbe una bugia.
- **Il conteggio `porte-verso-un-terzo` punta a `gate.rs`.** In
  `.github/scripts/conteggi.mjs:88-98` la ragione lo dice: *«Dal 0161 l'enum
  vive in `fub-abi` perché `Event::Trouble` lo nomina, e il kernel lo
  re-esporta da `safety.rs`»* — e il comando conta i casi dal sorgente del
  contratto, non più dal kernel.

## La decisione

**Il `Gate` entra nel contratto, e il campo è additivo e opzionale, in fondo
all'evento.** `Event::Trouble` dice da quale porta è entrato il guasto quando
il guasto è entrato da una porta; `None` è il guasto del **vault**, non di una
porta plugin — un flush fallito, il watcher che smette, una versione non
salvata. La forma è quella che la voce chiedeva e che il rinvio aveva
rimandato: un campo in fondo a un record è additivo per
[`wit_additivity`](../architecture/wit-congelato.md), quindi non scade col
freeze, e chi lo legge per primo non deve saperlo.

Il lavoro portato è il fatto scritto dove ci si inciampa: il doc di
`Event::Trouble` e quello di `event-trouble` nel WIT dicono che il campo c'è
e che cosa significa `None`; il doc di `gate.rs` dice che l'enum vive nel
contratto perché l'evento lo nomina. Il conteggio `porte-verso-un-terzo` è
stato spostato sulla sorgente giusta — il contratto — nello stesso giro.

**Presidio: il conteggio, che adesso conta i casi dal contratto.** La 0105
aveva già registrato `porte-verso-un-terzo`; il conteggio continua a leggere
le varianti dal sorgente, e il sorgente è cambiato di casa. Nessun banco
nuovo: la forma del campo è presidiata dal test di conformità abi↔WIT, che
confronta i campi dei record in ordine.

## Le forme scartate

- **La stringa della porta** — scartata: è la forma che la voce stessa
  contestava. Un errore è un **dato** ([0041](0041-un-errore-e-testo-che-qualcuno-legge.md)),
  e la stringa è già nel `PluginError` che l'evento porta; il `Gate` è il dato
  da cui la frase si compone, e chi raggruppa vuole il dato, non la frase.
- **Il campo obbligatorio** — scartato: i `Trouble` senza porta esistono —
  flush, watcher, versioning — e un campo obbligatorio li costringerebbe a
  inventare una porta o a mentire. `None` è un significato, non un'assenza
  imbarazzante: è la classe del guasto che non passa da un componente di
  terzi.

## Cosa resta scoperto

- **Il centro notifiche che raggruppa per porta non esiste ancora.** È UI: la
  voce lo chiedeva come vantaggio del campo, e il campo c'è. Il raggruppamento
  — «tre guasti dispersi causati dallo stesso plugin in un singolo render» —
  è lavoro della shell, e adesso ha il dato su cui farlo.
- **Gli altri guasti da porta non diventano `Trouble`.** Un panico in un
  comando o in una view torna come `Err` al chiamante, non entra nel canale
  degli eventi: è la loro superficie, e la 0052 ha deciso che il `Trouble` è
  per chi ha una superficie e si abbona. Il campo copre il caso che la voce
  nominava — la consegna a un `EventHandler` — e non cambia gli altri.
