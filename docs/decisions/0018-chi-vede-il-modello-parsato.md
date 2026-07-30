# 0018 — Chi vede il modello parsato

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §4.1–§4.3 (seduta 4, *ex* §1.13, §1.28, §1.29) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/04-chi-vede-il-modello-parsato.md)

---

La domanda della seduta è una sola: **chi vede la struttura di un documento?**
La risposta di prima era *il kernel, e chi indicizza* — `render_preview`
restituiva HTML, `read_document` una sorgente, e l'unico verso in cui il
`DocumentModel` attraversava il contratto era
`IndexProvider::on_document_indexed`: **spinto**, a chi indicizza, quando lo
decideva il kernel. Chiederlo non si poteva, in nessuna direzione.

Le tre voci sono chiuse. Il **§4.4** (due parser per la stessa sintassi) resta
aperto, e questa decisione gli toglie il blocco e gli lascia il confine scritto:
la sua metà di implementazione è shell, e sta in M3.

## La risposta, in una frase

**Il modello si chiede, e ciò che si chiede è di un documento alla volta.** Due
capacità nuove sull'`HostApi`, accanto a `read_document` perché sono la stessa
specie di cosa — una lettura del vault:

- `read_model(id) -> Result<DocumentModel>` (§4.2) — la struttura, con gli
  `Span`. Rilegge e riparsa dal disco.
- `format_of(id) -> Option<DocumentFormat>` (§4.3) — di che formato è, e che
  sintassi capirebbe. Non tocca il disco: è una domanda sul **nome**.

E una risposta che è un **no** (§4.1): il modello non attraversa l'IPC verso il
webview. `render_preview` resta la fast-path della lettura — HTML più le parti
dichiarative della [decisione 0017](0017-chi-disegna-cio-che-il-core-non-conosce.md).

## Le decisioni prese, da NON ridiscutere senza motivo

- **Il verso che mancava è il *pull one-shot*, e non è quello che il primo giro
  credeva.** Chi sta dentro un `IndexProvider` era **già servito**: un indice dei
  task, le flashcard da blocchi, le citazioni, il chunking per l'embedding
  ricevono ogni modello mentre passa, derivano ciò che gli serve e lo persistono
  con `data_*`. Tagliato fuori era chi ha bisogno del modello di *questo*
  documento *adesso* e non era in ascolto quando è passato — un comando che
  spunta il task sotto il cursore, un `ExportProvider` su un documento solo, un
  linter su richiesta, un TOC generato al volo. Le sue due strade erano entrambe
  storte: riparsare con un parser proprio, o registrare un
  `IndexProvider`-**specchio** che tiene una copia dell'intero vault per
  rispondere a una domanda su una nota.
- **`read_model` riparsa dal disco a ogni chiamata, e lo dice nella firma.** Non
  è un dettaglio d'implementazione: un canale che serve una cache e uno che
  riparsa sono due promesse diverse, e la differenza si vede quando il chiamante
  cammina l'intero vault — cioè in ogni voce del capitolo 17. La cache del kernel
  tiene i soli **metadati** (identità, frontmatter, outline, link): il corpo non
  c'è, e promettere un modello servito dalla cache sarebbe promettere una cache
  che non esiste. Chi vuole i soli metadati non paga il disco e non passa di qui:
  `IndexQuery::Outline`, `Properties` e `Tags` rispondono dalla cache calda.
- **Il modello è quello del *file*.** Un buffer aperto e non salvato non lo
  conosce nessuno al di qua del confine: chi disegna un editor tiene il proprio
  testo, e la verità del vault è ciò che sta sul disco. È la stessa regola dello
  span della [decisione 0007](0007-contesto-di-sessione.md), vista dall'altro
  lato — e ha una conseguenza che vale più della regola, ed è il §4.1 qui sotto.
- **Le due capacità stanno nell'`HostApi` e non in `IndexQuery`.** Il canale
  delle query è quello di ciò che è **derivato**: aggregato sul vault (i tag, le
  faccette), o calcolato su una relazione che nessun documento contiene da solo
  (i backlink). Il documento *in sé* non è derivato da niente. Le due ragioni
  concrete: una `IndexQuery` ha un dispatch **per tentativi** fra i provider
  registrati, e una variante che il kernel serve sempre da sé sarebbe l'ottava su
  nove che a un provider non arriva mai — cioè farebbe crescere esattamente il
  difetto del §5.1; e `IndexResult` è l'enum su cui ogni indice fa `match`,
  quindi infilarci un `DocumentModel` intero vorrebbe dire farlo attraversare la
  firma di chi non lo ha chiesto. Il criterio non è «riguarda un documento» — è
  **chi lo sa già**.
- **L'elenco delle capacità era «chiuso», e queste due lo allargano — con il
  criterio della [0013](0013-elenco-delle-capacita.md), non contro.** Quella
  decisione non ha chiuso l'elenco per numero ma per **regola**: una capacità
  entra quando la chiede un cliente vero, non quando sembra utile. `free_name` la
  chiese l'import, `apply_edit` la modifica chirurgica; queste due le chiedono il
  percorso one-shot e la lista che non sa distinguere una nota da un allegato. Da
  22 metodi a 24, e i quattro host li implementano tutti — che è il costo che il
  §7.1 misura, e che questa seduta fa crescere di due invece di toglierlo.
- **I due nomi dicono i due costi, e la simmetria è stata scartata apposta.**
  `read_` è una lettura (disco, parse), `_of` è una domanda sul nome a cui
  risponde una mappa. Una coppia ordinata — `document_model` / `document_format`
  — avrebbe nascosto che una delle due si può fare tremila volte e l'altra no.
- **`format_of` non restituisce un `Result` e non chiede che il documento
  esista.** `None` significa **nessun provider lo rivendica**, ed è una risposta
  utile quanto le altre: è il modo con cui chi cammina una lista sa che quel nome
  non è roba sua, invece di provare a leggerlo e dedurlo dall'errore. Vale quindi
  anche per un documento che non esiste ancora — chi sta per creare
  `Diario/2026-07-26.md` può chiedere **prima** chi lo tratterà — e si può fare
  su una lista intera senza pagare un'apertura a testa.
- **Descrittore e capacità viaggiano insieme, in un tipo solo.**
  `DocumentFormat { descriptor, capabilities }`: chiederli separatamente vorrebbe
  dire poter ricevere il descrittore di un provider e le capacità di un altro,
  che è uno stato che nessuno sa gestire e che nessun chiamante ha chiesto.
- **Le capacità sono quelle *effettive*, non quelle del provider.** Sono le
  sintassi del provider **più** quelle che le `SyntaxRule` registrate gli
  innestano sopra (§3.1). Rispondere le sole capacità del provider sarebbe
  rispondere una verità di laboratorio — `==evidenziato==` non è del provider
  markdown e funziona lo stesso — e rimetterebbe in piedi le due categorie di
  estensioni che la [decisione 0017](0017-chi-disegna-cio-che-il-core-non-conosce.md)
  ha rifiutato: chi accende una sintassi non deve sapere da dove viene, e chi
  chiede cosa è acceso nemmeno. Sulla chiave condivisa vince il **provider**: se
  sa fare `fub:math` per conto suo, il suo dettaglio è più informativo del
  semplice «acceso» che una regola può dichiarare.
- **§4.1 — il modello *non* arriva al webview, e non è un rinvio.** Tre ragioni,
  in ordine di forza. (a) Il modello è quello del **file**, il webview lavora sul
  **buffer**: un modello spedito di là sarebbe vero solo a buffer pulito, cioè
  proprio quando serve meno — ciò che il capitolo 6.1 vuole è interazione
  *mentre* si scrive. (b) Un mirror TS dell'intero albero (otto varianti di
  blocco, gli inline, la tabella) è un costo che non si paga una volta: lo si
  paga a **ogni** voce del modello, per sempre, e oggi non ha un cliente —
  nessun modulo della shell parsa markdown a mano, e l'unico posto che lo fa è la
  live preview, che lavora sul buffer e ha già la sua grammatica dichiarata
  (§4.4). (c) `render_preview` con le parti dichiarative copre già ciò che
  serviva davvero al capitolo 6.1: mermaid e math sicuri passano di lì dalla
  0017, e lazy loading, lightbox e copy button sono lavoro sul DOM reso, non sul
  modello.
- **Ciò che la shell vuole *fare* col modello si chiede come comando.** È la
  forma che la [decisione 0013](0013-elenco-delle-capacita.md) ha già scelto per
  le operazioni strutturali, e vale anche qui: la shell dice «spunta il task in
  questa posizione», non «dammi il modello che il task me lo trovo io». Il
  vantaggio non è di gusto — il codice che conosce la sintassi dei task resta
  **uno**, in Rust, dove sta il parser.
- **Ciò che la shell vorrà *sapere* in coordinate del sorgente sarà
  un'opzione di rendering, non un secondo canale.** Scroll sync editor↔anteprima
  e rendering incrementale (6.1) hanno bisogno di sapere *da quale byte* viene un
  elemento reso: la forma decisa è che l'HTML porti quelle coordinate quando
  vengono chieste — una chiave di `RenderOptions`, che dalla 0017 è una mappa
  aperta — invece di un canale parallelo che porta il modello e lascia alla shell
  il compito di riallinearlo all'HTML. Non è costruita: non ha ancora clienti, e
  costruirla adesso vorrebbe dire scegliere il formato della mappa senza nessuno
  che la legga.

## Il dogfooding, che è dove si è scoperto se regge

**`note.task.toggle`** — il comando che spunta il task che sta sotto una
posizione ([`commands.rs`](../../crates/fub-features/src/commands.rs)). È il
gesto quotidiano del capitolo 10, ed è il primo cliente one-shot: chiede il
modello di *una* nota, legge lo `span` del marcatore e scrive **un carattere**.
Non fa nessuna delle due cose storte di prima — non riparsa e non tiene uno
specchio — e non conosce un solo carattere della sintassi dei task: quale sia il
byte da riscrivere glielo dice il modello, ed è per questo che funziona
identico su una voce indentata, dentro una citazione, o dopo un frontmatter che
sposta ogni offset.

Tre cose sono venute fuori solo scrivendolo:

- **Lo `span` del `TaskMarker` era già la decisione giusta**, presa nella
  [0003](0003-modello-del-documento.md): puntando al **simbolo** e non alla voce,
  spuntare è una patch di un byte. Se avesse puntato alla voce, questo comando
  avrebbe dovuto ritrovare le parentesi dentro il testo — cioè conoscere la
  sintassi, cioè essere il secondo parser che questa seduta esiste per non
  scrivere.
- **Il task più interno vince**, quando sono annidati: il criterio è la voce più
  stretta fra quelle che contengono la posizione. È l'unica risposta che
  corrisponde a ciò che vede chi guarda lo schermo.
- **`[ ]` ⇄ `[x]`, e ogni altro simbolo torna `[ ]`.** Non è la lettura binaria
  di `TaskMarker::checked()`, ed è deliberato: gli stati personalizzati (`[/]` in
  corso, `[-]` cancellato, `[>]` rimandato) sono una famiglia che il prodotto non
  ha ancora definito (10.1), e un toggle che li promuovesse a `[x]` deciderebbe
  al posto suo che «in corso» è più vicino a «fatto» che a «da fare».

A buffer sporco il comando **si rifiuta e lo dice**, invece di scrivere nel posto
sbagliato: è la regola dello span della 0007, e qui ha un secondo cliente che ne
dipende davvero.

## Cosa NON è stato fatto, e perché

- **Il §4.4 resta aperto**, con il blocco tolto e il confine scritto: il
  **buffer** è di Lezer, il **file** è del modello. Le due grammatiche restano, e
  non perché nessuno abbia deciso — perché sono su due oggetti diversi. Il
  moltiplicatore che il §4.4 denuncia (~50 estensioni scritte due volte) non si
  paga mandando il modello di là: si toglie rendendo condivisa la
  **dichiarazione**, visto che `SyntaxRuleSpec` porta già il trigger come dato e
  `format_of` dice adesso quali sintassi sono accese per quel documento. È shell,
  è P1, e va con la seconda metà del §18.1.
- **Nessuna capacità restituisce il formato di *una lista*.** `format_of` si
  chiede un id alla volta; camminare mille documenti sono mille chiamate. Non
  costa un'apertura a testa (è una mappa in memoria), ma la forma «dammi il
  formato di questi N» è la stessa domanda del §14.4 sul canale della lista, e va
  decisa lì insieme al resto — non con una capacità in più che duplichi la
  risposta.
- **`read_model` non ha un fratello che riceve una sorgente già in mano.** Chi ha
  il testo e vuole il modello (un editor che simula, un import) deve passare dal
  disco. È una capacità in più che non ha ancora chiesto nessuno, e ha una domanda
  aperta dentro — con quale `DocId` si parsa un testo che non è di nessun
  documento — che vale la pena rispondere quando ci sarà il cliente.
- **Il doppio in memoria non parsa.** `MemoryHost::read_model` risponde il
  modello **seminato**, e un documento che esiste ma di cui nessuno ha seminato
  il modello risponde come uno che non esiste. Un doppio che si portasse dentro un
  `FormatProvider` proverebbe le feature contro *quel* provider invece che contro
  il contratto — e chi prova una feature sul modello deve dire **quale** modello
  sta provando. Il parse vero sta nei test end-to-end col kernel.
- **`note.task.toggle` non dichiara nessuna scorciatoia**, e la ragione è una
  scoperta di questa seduta: `Mod-Enter` **c'è già**, e la tiene l'editor
  (`toggleCheckbox` in `editor-commands.ts`), che spunta le todo di tutte le
  righe selezionate nel **buffer** e a una voce di lista senza checkbox gliela
  aggiunge. Non è il duplicato di questo comando: è l'altro lato del confine che
  questa decisione traccia — quel gesto è *scrittura di testo* su un buffer che
  può essere sporco, questo è un'*operazione sul vault*. Darli allo stesso
  accordo vorrebbe dire che la combinazione fa due cose a seconda di chi vince la
  corsa. Quale dei due la meriti quando la palette e la tastiera avranno un
  arbitro solo è il §18.2, e non si decide da qui.

## Verifica

`cargo test --workspace`: **497 verdi** (erano 481), fra cui la conformità
abi↔WIT con i due metodi e il record nuovi, l'additività (questa seduta non
rompe niente: due funzioni in coda a `host-api` e un `record` nuovo sono
additivi, e la baseline congelata non è stata toccata), i cinque test
end-to-end del canale su markdown vero
([`parsed_model_e2e.rs`](../../crates/fub-format-markdown/tests/parsed_model_e2e.rs))
e i nove del comando. `npx tsc` pulito, **160 test vitest**.

Il test che conta di più è
[`dal_canale_esce_il_corpo_che_la_cache_non_ha`](../../crates/fub-format-markdown/tests/parsed_model_e2e.rs):
senza di lui gli altri proverebbero che il kernel restituisce ciò che gli è
stato dato. Il **corpo** è la ragione per cui questo canale esiste — outline,
frontmatter e link li serviva già `IndexQuery` dalla cache calda — e quel test è
l'unico posto in cui si vede che ciò che esce non è una proiezione ma il
documento parsato, con gli span veri del file.

**Non verificato visivamente nell'app Tauri**: niente di questa seduta tocca la
shell.
