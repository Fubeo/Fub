# 0122 — Una sorgente non degrada: si rifiuta

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: il difetto
*«`Inline::Custom { .. } => {}` in `serialize.rs`: il gemello inline del
frontmatter perso»*, e con lui gli altri otto siti che stavano sotto la stessa
frase **Commit**: *(questo commit)*

---

## La domanda

`FormatProvider::render_html` e `FormatProvider::serialize` ricevono lo stesso
modello e incontrano lo stesso problema: un nodo che il provider non conosce —
un `Custom` prodotto da una `SyntaxRule` di cui non ha mai visto i delimitatori
([0017](0017-chi-disegna-cio-che-il-core-non-conosce.md), §3.1).

La 0017 ha risposto per la resa: **si degrada**, cioè si mostra ciò che si può —
il testo dentro uno `<span>` con la classe del kind. Il difetto segnalato
chiedeva di ripetere la stessa risposta nell'altro metodo, e la domanda vera è
se sia la stessa domanda.

Non lo è, e la differenza ha un nome: **cosa si sta scrivendo**.

- `render_html` scrive una **proiezione**. L'HTML è un derivato: si rigenera a
  ogni apertura, e perderci qualcosa costa una visualizzazione.
- `serialize` scrive **la sorgente**. Il byte che esce di lì è il file
  dell'utente. Perderci qualcosa costa il file.

Da cui la regola di questo verbale, che vale per ogni `FormatProvider` che
verrà: **una proiezione degrada, una sorgente si rifiuta.** Chi non sa scrivere
un nodo non è autorizzato né a inventarne i delimitatori né a buttarlo: torna un
`Err`, che è la stessa risposta che il ramo del frontmatter dava già da solo —
*ciò che non si sa scrivere risale*.

## Perché non un `attrs` verbatim messo dal kernel

La strada considerata per prima è stata renderlo **impossibile per
costruzione**: il kernel, che al momento dell'innesto ha in mano `open`, `close`
e il testo (`syntax.rs`, `split_text` e `fence_rule`), potrebbe timbrare negli
`attrs` la sorgente verbatim, come già timbra lo `span` — «lo riempie il kernel,
non la regola: una regola che potesse dichiarare il proprio span potrebbe
mentire sull'identità di un blocco». Con quel campo, scrivere sarebbe sempre
possibile e il ramo d'errore non avrebbe ragione di esistere.

È stata scartata, e la ragione è che **il modello si modifica**. `serialize`
esiste per generare — template, «crea nota», frammenti — e il giorno in cui
qualcuno costruisce o muta un modello a mano, una sorgente verbatim ferma nel
nodo verrebbe riscritta al posto del contenuto nuovo: una perdita **peggiore**
di quella riparata qui, perché silenziosa *e* plausibile. Il verbatim va bene
per `frontmatter-unparsed` proprio perché quel blocco è opaco per definizione e
nessuno lo modifica; non generalizza.

Resta quindi un `Err`, che è la cosa onesta: dice il kind, e chi ha chiesto la
scrittura decide.

## Quanti erano

Uno, secondo il difetto. **Nove**, misurati parsando il corpus dei costrutti e
riserializzandolo:

| # | sito | cosa perdeva |
|---|---|---|
| 1 | `Inline::Custom { .. } => {}` | tutto l'inline — *il sito dichiarato* |
| 2 | lo stesso ramo, kind senza `attrs.text` | tutto l'inline, senza nemmeno il testo |
| 3 | `Inline::Custom` `footnote-reference` senza `attrs.label` | il richiamo |
| 4-5 | `Block::Custom` generico con `blocks` vuoto: `math`, `diagram` | la formula, il diagramma |
| 6 | idem: `html` | **il blocco HTML dell'utente** |
| 7 | `anchor`, in **sette** varianti di `Block` | l'`^id` con cui le *altre note* puntano qui dentro |
| 8 | `Inline::Code` con un backtick dentro | il contenuto, riscritto in qualcos'altro |
| 9 | i figli di una voce d'elenco, senza rientro | l'annidamento, appiattito |

Sette su nove non hanno niente a che vedere con `Custom`, e il peggiore è il 7:
è l'unico che si vede da **fuori** del documento. Un `^abc123` è l'indirizzo di
`[[Nota#^abc123]]`; riscrivere il file senza toglie il bersaglio ai link degli
altri, e il documento non sembra cambiato.

Il 6 è quello che rende la cosa misurabile senza scomodare nessuna regola: il
provider markdown produce `custom_kind::HTML` da solo, con l'HTML negli `attrs`
e **zero figli** — e il ramo «scrivi i figli» scriveva zero byte. `parse.rs`
dice, di quel blocco, «prima spariva: nessun figlio → nessun blocco». Spariva di
nuovo tre file più in là.

## La premessa falsa, e perché sembrava vera

Il difetto diceva: *«l'utente apre una nota, l'app la risalva, un pezzo di testo
non c'è più»*. **Quel giro non esiste.** Nessun codice di produzione chiama
`FormatProvider::serialize`, e non per caso: lo vieta un presidio con un elenco
chiuso dei punti di chiamata (`crates/fub-abi/tests/serialize_non_riscrive.rs`),
che oggi ammette due `u64_string::serialize` di serde e il corpo del metodo nel
provider che lo implementa. Il danno descritto è **impedito da un altro
presidio**.

Sembrava vera perché il codice difettoso c'era davvero, e perché la strada
comoda — `read_model` → muta → `serialize` → `write_document` — è fatta di
quattro chiamate che esistono tutte e che compilano. La 0059 e quel presidio
hanno chiuso la strada; questo verbale ripara **il fondo della buca**, così che
il giorno in cui qualcuno aggiunge una riga all'allowlist con una ragione nuova
(un template, «crea nota») non ci trovi dentro nove modi di cancellare.

Vale la pena scriverlo perché è il secondo caso in cui *la gravità dichiarata di
un difetto era di un altro presidio*: la riparazione resta giusta, l'urgenza no.

## Chi se ne accorge se torna

Tre attori, scelti guardando quale vede quale caso.

- **Il compilatore**, per il campo che nessuno ha ancora scritto: i `match` di
  `serialize.rs` nominano ogni campo e non hanno più `..`. Aggiungere un campo a
  `Block::Paragraph` fa dire a rustc *«pattern does not mention field»* con file
  e riga. È l'attore giusto perché è così che `anchor` era nata persa — sette
  varianti la ignoravano e nessuno poteva dirlo, perché nessuna la nominava.
- **Il conto**, per il caso che nessuno ha elencato: il giro completo sul corpus
  (`sorgente → modello → sorgente → modello`) su tre proprietà che si rompono
  separatamente — il testo, la forma dell'albero, le ancore.
- **Il test**, per il comportamento: ciò che non si sa scrivere torna `Err` e
  **nomina il kind**.

Ogni presidio è stato visto rosso rimettendo il codice vecchio, uno per uno:
sette reversioni, sette rossi distinti, nessuno che passasse a vuoto.

## Il limite, dichiarato

L'ancora esplicita di un **heading** (`# Titolo ^testa`) non torna indietro
nemmeno adesso, ed è fuori dalla portata di questo file: nell'albero
`Block::Heading::anchor` porta lo **slug generato** dal testo, non l'id scritto,
e quell'id vive solo nella tabella piatta `anchors`. È una divergenza già
registrata con la sua riga in `il_corpus.rs` («l'ancora esplicita di un heading
non è raggiungibile dall'albero»), e si ripara **nel modello**. Il presidio
delle ancore guarda quindi quelle dell'albero, e lo dice.
