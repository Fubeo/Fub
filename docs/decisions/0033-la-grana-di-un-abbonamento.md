# 0033 — La grana di un abbonamento: il topic, il soggetto, e i prefissi che non sono `starts_with`

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §10.1 (seduta 10) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/10-gli-eventi.md)

---

Una `EventMask` era una lista di specie — undici `EventKind` — e con quella sola
grana il contratto sapeva dire *cosa* è successo e non sapeva dire **a chi
interessa**. Ne seguivano due sprechi, e nessuno dei due lo paga chi lo causa:

- **Chi si abbona ai custom li riceve tutti.** L'abbonamento è a grana
  `EventKind::Custom`, quindi con i moduli di FubSuite che si parlano fra loro
  (21.2) ogni handler si sveglia per **ogni** custom di **ogni** plugin. Il
  prefisso di topic non c'era, ma la sua forma sì: la
  [0021](0021-il-confine.md) impone `ns:nome` all'host nel momento in cui
  l'evento passa, e mancava solo il match dall'altra parte.
- **Manca la grana del soggetto**, ed è la metà che andava inventata: nessuno
  può abbonarsi a «i cambiamenti di questa cartella» o «di questo documento»,
  quindi l'evento più caldo del contratto — `document-changed` — sveglia tutti,
  N feature × M documenti, a ogni scrittura.

La voce era **P0** per la sola ragione che rende P0 una voce di contratto: la
forma della maschera oggi costa un campo, dopo il freeze di M4 costa una
migrazione di versione.

## La risposta, in una frase

**Tre filtri in and — le specie, i prefissi di topic, i soggetti — dove ognuno
vuoto vuol dire *non filtro*; i prefissi si spezzano sui separatori del
contratto e non sui caratteri; e ciò che non nomina nessun documento passa
comunque, perché è ciò che non si può perdere.**

## Le decisioni prese, da NON ridiscutere senza motivo

### La forma

- **Un record a tre campi, non tre maschere e non un filtro per specie.**
  `EventMask { kinds, topics, subjects }`. Una maschera per specie
  (`document-changed` con i suoi soggetti, `custom` con i suoi topic) sarebbe
  stata più espressiva e avrebbe reso ogni lettura un `match`: chi la applica
  deve poter rispondere sì o no in tre confronti, perché lo fa per ogni handler
  a ogni evento. I tre assi sono **ortogonali** e stanno in and, che è la sola
  composizione che non chiede a chi si abbona di sapere in che ordine i filtri
  si applicano.
- **Vuoto vuol dire *non filtro*, e non «niente».** Una maschera scritta prima
  di questa decisione riceve esattamente ciò che riceveva; l'unico campo il cui
  vuoto significa «niente» è `kinds`, ed era già così. La regola opposta —
  «dichiara i topic o non ricevi custom» — avrebbe fatto sparire in silenzio
  degli abbonamenti già scritti, che è il modo peggiore di introdurre un filtro.
- **`event-mask` era un alias e adesso è un record: la linea di base è stata
  ritagliata.** Un `type x = …` che cambia destinazione non è additivo per
  nessuno, e `wit_additivity` lo ha detto con la frase che ha scritto per questo
  caso — *le due uscite oneste sono renderlo additivo, oppure, solo finché il
  freeze di M4 non è avvenuto, ritagliare la linea di base con un commit che
  tocca `crates/fub-abi/wit/frozen/` e lo dice*. È la seconda, ed è visibile: nello stesso
  commit c'è la riga in `crates/fub-abi/wit/frozen/0.1.0.wit`, col perché accanto. Dopo M4 la
  stessa mossa vorrà una versione nuova **accanto** a quella, non una riga
  cambiata dentro.

### I due prefissi

- **Il confronto è per segmento, non per caratteri.** `com.acme` è un prefisso
  di caratteri di `com.acmecorp:x` come `Progetti` lo è di
  `Progetti-vecchi/nota.md`: un filtro che li accettasse non toglierebbe il
  difetto che questa voce esiste per togliere — un abbonato che si sveglia per
  roba di qualcun altro — lo **cambierebbe di vittima**, e in un modo che nessun
  test scritto sui casi facili vedrebbe mai. Il carattere che segue il prefisso
  deve quindi essere un separatore: `:` o `.` per i nomi (sono i due della
  regola dei nomi, §7.4), `/` per i path.
- **Il prefisso di topic ha tre grane utili e non tre regole**: `com.acme`
  (tutti i plugin di acme), `com.acme.tasks` (quel plugin), `com.acme.tasks:board`
  (una famiglia di topic). Sono la stessa regola letta a tre profondità, e non
  c'è niente da dichiarare per scegliere quale.
- **Una cartella è un prefisso di path, e lo è per una ragione con una
  scadenza.** Nel kernel una cartella non è un cittadino: lo diventa col §14.3.
  La forma della maschera però non poteva aspettare quel giorno — è contratto,
  e il §14.3 non lo è — quindi `Subject::Folder` porta una `string` e il giorno
  che il §14.3 arriva **guadagna una variante**, che è additivo. Il contrario —
  aspettare — avrebbe voluto dire una migrazione di versione per un tipo.

### Il soggetto

- **Un rename è del soggetto di partenza *e* di quello d'arrivo.** È la
  decisione che una lettura plausibile sbaglierebbe: `Event::touched` esiste già
  e per un rename risponde *il path nuovo*, perché serve a riempire l'elenco di
  un lotto. Qui la domanda è un'altra — *questo evento riguarda la tua
  cartella?* — e una nota che se ne va riguarda la cartella da cui esce
  esattamente quanto quella in cui entra: senza, chi guardava quella cartella
  terrebbe lo stato di una nota che non ha più, per sempre e senza saperlo. Per
  questo `Event::names` è un metodo nuovo e non `touched` al plurale.
- **Un lotto arriva se ha toccato il soggetto, e arriva intero.** L'elenco
  `changed` **non si pota** sul soggetto di chi lo riceve: un lotto è
  un'operazione sola, e raccontarla più piccola di com'è farebbe credere a chi
  la legge di sapere cosa è successo. Un lotto che non ha toccato niente — la
  rimozione dal solo indice — non nomina nessun documento e quindi passa.
- **Ciò che non nomina nessun documento passa il filtro invece di non
  passarlo.** `overflow` («riconcilia da zero»), `vault-closed` («l'ultimo giro
  per rendere durevole ciò che hai in memoria») e `job-done` («l'esito che hai
  chiesto») non sono meno tuoi perché ti sei abbonato a una cartella. La regola
  opposta — filtrare via ciò che non nomina un soggetto — avrebbe fatto perdere
  **in silenzio** proprio i tre eventi che non si possono perdere, e li avrebbe
  fatti perdere a chi si è abbonato a poco, cioè a chi ha fatto la cosa giusta.

### Dove sta la regola

- **In `fub_abi::rules::events`, e non accanto al tipo.** È la regola con
  **due applicatori veri**: il kernel, che consegna a un `EventHandler`, e la
  **shell**, che decide da sé quando ridisegnare una view dichiarata
  (`ViewSpec.refresh` è una `EventMask`, e la shell la legge). Finché la shell
  applicava un `includes` sulle specie, la maschera poteva restringere quanto
  voleva e lei ridisegnava lo stesso: la promessa del contratto sarebbe stata
  vera nel kernel e falsa in finestra. Adesso la regola è una, la gemella
  TypeScript sta in `frontend/src/rules/mirrored.ts` e a tenerle uguali non è
  un commento ma la fixture generata di `rules_mirror.rs` (§6.2).
- **La shell dichiara maschere anche per i propri pannelli nativi.**
  `Panel.refresh` era una lista di specie ed è diventata una `EventMask`:
  tenerne due forme avrebbe voluto dire due strade per montare un pannello,
  che è esattamente ciò che la [0015](0015-la-forma-della-shell.md) ha chiuso.
  I nativi la scrivono con `refreshOn(...)`, che è `EventMask::of` detta di là.

## Trovato per strada

- **Il compilatore ha trovato tutti i chiamanti, ed erano trentaquattro.**
  `EventMask` era una tupla (`EventMask(vec![…])`) e adesso è un record: ogni
  costruzione ha smesso di compilare, e non è rimasto nessun punto in cui
  qualcuno costruisse la maschera vecchia credendo di costruire la nuova. È
  l'argomento a favore del newtype che si vede solo quando lo si cambia.
- **Il doc del WIT diceva ancora `"<plugin-id>/<nome>"`.** La
  [0021](0021-il-confine.md) aveva cambiato la convenzione dei topic in
  `ns:nome` e aveva aggiornato il doc Rust; quello WIT era rimasto indietro, e
  chi avesse letto il solo contratto avrebbe scritto un topic che l'host
  rifiuta. Corretto qui.
- **Il caso `com.acme.tasks.board:moved` non esiste, e la prova lo ha
  scoperto.** Un plugin nomina solo dentro il proprio id (§7.4), e la spezzatura
  è sul **primo** `:`: `com.acme.tasks` non può emettere sotto
  `com.acme.tasks.board`. Il `.` da presidiare sta quindi **dentro il nome** —
  `com.acme.tasks:board.moved` — e il test è stato riscritto su ciò che il
  contratto lascia davvero passare invece che su ciò che sembrava naturale
  scrivere.
- **`EventMask::all()` non copriva `view-invalidated` né `vault-closed` nel
  proprio test.** L'elenco dei campioni era scritto a mano, quindi «esaustivo a
  memoria» — è il §16.7 visto in miniatura: la maschera piena era giusta, il
  test che la verificava no, e nessuno dei due lo diceva. Aggiunti.
- **Il mirror TS aveva bisogno di un campione *stretto*.** Con la sola
  `ViewSpec` di prima, `topics` e `subjects` sarebbero stati due liste vuote in
  ogni campione: il presidio dei tipi sarebbe rimasto verde senza aver mai visto
  un soggetto. La fixture ne porta uno con tutte e due le specie, e il gemello
  vitest pretende che ci siano.

## Cosa NON è stato fatto, e perché

- **Nessun soggetto che non sia un documento o una cartella.** Niente tag,
  niente query, niente «le note che linkano questa». Un abbonamento non è una
  query: chi vuole quella potenza ha il canale dati
  ([0019](0019-il-canale-dati.md)), e metterla qui vorrebbe dire far girare un
  valutatore di query **dentro la consegna di ogni evento**, cioè spostare il
  costo dal risveglio al filtro. Le due varianti che ci sono coprono i casi che
  esistono; il `variant` cresce in coda il giorno che ne serve una terza.
- **Il soggetto non filtra i custom.** Un `Event::Custom` non nomina documenti,
  quindi passa qualunque soggetto sia dichiarato. Farlo filtrare vorrebbe dire
  leggere dentro il payload, che è di chi lo manda e non ha una forma promessa
  a nessuno.
- **La shell non ha una prova che il proprio host applichi la regola.** Il
  router degli eventi della shell si attacca a Tauri, e per provarlo servirebbe
  il banco che il §17.2 chiede. La *regola* è presidiata (fixture generata); che
  `panel-host.ts` la chiami è una riga che oggi legge una persona.
- **Il bus non ha una maschera.** Chi si abbona al bus prende tutto: il bus
  serve chi sta fuori dal giro sincrono — il ponte, un test — e il ponte ha la
  propria politica (§10.2). Una maschera lì sarebbe stata una seconda idea di
  chi riceve cosa, in un posto dove il destinatario è uno.
- **Nessuna maschera sui **provider** che non sono handler.** Un `IndexProvider`
  viene alimentato dal kernel, non abbonato: quella è la scrittura, non un
  evento, e il §20.1 si occupa del suo esito.

## Verifica

- `cargo build --workspace` e `cargo clippy --workspace --all-targets` — pulite,
  zero warning; anche `-p fub-host --no-default-features`.
- `cargo test --workspace` — **64 suite, 0 fallimenti**, due delle quali nuove e
  condivise con la [0034](0034-il-freno-e-il-raggruppamento.md):
  - `fub-kernel/tests/la_maschera.rs` — cinque prove **in coppia**: ognuna
    mostra la maschera stretta che non riceve *e* la stessa storia con la
    maschera larga che riceve. Una prova che mostrasse il solo silenzio non
    distinguerebbe un filtro che funziona da un handler mai chiamato;
  - le unità di `rules::events` e di `event.rs` — i prefissi coi casi che
    `starts_with` sbaglierebbe, il rename che esce dal soggetto, il lotto che
    interseca, ciò che non nomina nessun documento.
- **Provate al contrario, le tre righe che portano il peso:**
  - togliendo il filtro sul topic da `mask_wants`, l'handler stretto riceve
    anche i custom dell'altro plugin e `a_topic_prefix_wakes_up_who_declared_it`
    fallisce;
  - facendo nominare a un rename il solo path d'arrivo (cioè scrivendo `names`
    come `touched`), `a_note_leaving_the_folder_is_news_for_the_folder`
    fallisce — è la lettura plausibile, ed è la ragione per cui quel test esiste;
  - togliendo la guardia «chi non nomina passa»,
    `what_nobody_can_rediscover_reaches_everyone` fallisce: l'`overflow` e il
    `vault-closed` sparirebbero per chi si è abbonato a un documento solo.
  - e di là: sostituendo `topicMatches` con un `startsWith` nudo,
    `rules-mirror.test.ts` diventa rosso sul caso `com.acmecorp`. Le due
    implementazioni non possono divergere in silenzio.
- **Contratto:** `event-mask` da alias a record è una **rottura dichiarata**
  pre-freeze; `crates/fub-abi/wit/frozen/0.1.0.wit` è ritagliato nello stesso commit e dice
  perché. `wit_conformance` (che verifica anche l'ordine dei casi del `subject`
  contro la dichiarazione Rust) e `wit_additivity` sono verdi.
- **Mirror TS rigenerato** (`UPDATE_MIRROR=1` su `ts_mirror` e `rules_mirror`),
  e il gemello di là aggiornato: `cd frontend && npx vitest run` (11 file, 177
  test) e `npx tsc --noEmit` puliti.
- `cargo fmt --all` — pulita.
