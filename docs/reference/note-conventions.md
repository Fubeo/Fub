# Le convenzioni scritte nelle note

> **Ambito:** le forme che Fub legge e riscrive dentro il testo di una nota
> Markdown, oltre a CommonMark e alle estensioni di Obsidian: i commenti con
> la discussione e l'archivio dei risolti, i tipi di nota e il promemoria di
> un compito.
> **Fonti autorevoli:** `crates/fub-format-markdown/src/parse/comments.rs`,
> `crates/fub-abi/src/model.rs` (`custom_kind::COMMENT_RANGE`,
> `custom_kind::COMMENT_MESSAGE`), i casi «discussione» di
> `crates/fub-format-markdown/tests/corpus/mod.rs`;
> `crates/fub-features/src/note_types.rs` per i tipi di nota;
> `crates/fub-abi/src/rules/tasks.rs` (`task_reminder`) per il promemoria.

Una convenzione di questa pagina è testo semplice nel file: un'altra app la
mostra così com'è, e Fub la rilegge e la riscrive byte per byte. Nessuna
richiede un file accanto alla nota: i commenti stanno nel testo, il tipo in
un campo del frontmatter.

## I commenti con la discussione

Un commento su un passo della nota usa la forma di
[CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit): il passo
fra `{==` e `==}`, e subito dopo uno o più messaggi fra `{>>` e `<<}`. Un
messaggio senza passo davanti commenta il punto in cui sta.

```markdown
Il {==passo da rivedere==}{>>@Anna Bianchi 2026-11-08 17:40: troppo lungo<<}{>>@Bruno 2026-11-08 18:02: d'accordo<<} e il resto.

Un commento su un punto {>>2026-11-09: qui manca una fonte<<} della frase.
```

I messaggi uno dopo l'altro, senza niente in mezzo, sono una discussione: il
primo apre, gli altri rispondono.

### L'intestazione di un messaggio

Il messaggio comincia con chi l'ha scritto e quando, poi `: ` e il testo:

| Forma | Autore | Data |
|---|---|---|
| `@Anna Bianchi 2026-11-08 17:40: testo` | `Anna Bianchi` | `2026-11-08 17:40` |
| `@Anna Bianchi 2026-11-08: testo` | `Anna Bianchi` | `2026-11-08` |
| `@Anna: testo` | `Anna` | nessuna |
| `2026-11-08 17:40: testo` | nessuno | `2026-11-08 17:40` |
| `testo` | nessuno | nessuna |

L'autore va da `@` fino alla data o ai due punti; la data è `AAAA-MM-GG`, con
` HH:MM` se c'è. Un messaggio che non segue nessuna di queste forme (scritto
a mano, o da un'app che non conosce la convenzione) è tutto testo, senza
autore né data. Il file conserva i byte come sono: l'intestazione si legge,
non si normalizza.

### Le regole

- Il passo e i messaggi stanno nello stesso paragrafo, titolo, voce, citazione
  o cella. Il passo può andare a capo; un messaggio sta su una riga sola.
- `{==…==}` è un commento solo se lo segue `{>>`: da solo resta testo.
- Si chiude al primo `==}` e al primo `<<}`. Un `{==` dentro un passo aperto
  lo rompe, e il passo resta testo; dentro un messaggio `{>>`, `<<` e `>>`
  sono testo.
- I segni dentro codice in riga, formule o una nota in riga `^[…]` non aprono
  niente (nella nota restano testo della nota, byte per byte); `\{==` e
  `\{>>` sono i caratteri, non un commento. Il passo invece è testo della nota
  come ogni altro: link, tag, enfasi e formule restano suoi.
- Il testo di un messaggio non è testo della nota: non fa link né tag e non
  entra nel testo del blocco. In una cella di tabella una `|` del messaggio si
  scrive `\|`, come in tutta la cella.
- I commenti si leggono quando la sintassi `fub:comments` è accesa, la stessa
  dei commenti `%%…%%`.

### Dove si vedono

- **Ricerca**: `comment:parola` cerca nei messaggi, autore compreso;
  `content:` e la ricerca semplice non li vedono (il passo sì).
- **Resa**: il passo si legge come il resto del testo, i messaggi non si
  vedono. La resa di stampa li porta in un `<template class="comment-note">`
  inerte, che il browser non mostra.
- **Export HTML**: senza opzioni i messaggi non entrano nel file; con
  `{"comments": true}` ogni discussione diventa un rimando numerato dopo il
  passo e una nota in fondo alla pagina.
- **Pubblicazione**: il passo resta, i messaggi no.
- **Editor**: in Scrittura e in Lettura il passo ha il fondo del commento e
  segni e messaggi non si vedono; in Sorgente si vede tutto, colorato. Come si
  scrive, si cancella e si copia: [I commenti nel testo](../product/editor-comments.md).

### L'archivio dei risolti

«Risolvi» toglie i segni dal passo (il passo resta testo della nota) e
archivia la discussione in fondo alla nota, in commenti `%%…%%` di una riga:
la testa con la data della risoluzione e la citazione, poi un messaggio per
riga, com'era scritto.

```markdown
%%fub:risolto 2026-11-16 14:02: la conferma dei prestiti%%
%%> @Anna Bianchi 2026-11-08 17:40: Il Museo Rossi risponde entro venerdì.%%
%%> @Luca Ferri 2026-11-09 09:12: Confermato.%%
```

- Le righe dell'archivio stanno in un paragrafo solo in fondo alla nota,
  staccato dal testo da una riga vuota; una discussione risolta dopo si
  aggiunge in coda.
- Dentro una riga `%%` si scrive `%\%`, un `%` in fondo `%\`, e `{==`, `{>>`
  hanno la barra davanti: niente chiude il commento prima né apre un commento
  vivo. Un messaggio va su una riga sola: un a capo diventa uno spazio.
- Una riga `%%> …%%` senza una testa prima non è archivio: resta un commento
  `%%` come gli altri.
- Obsidian e la Lettura di Fub non mostrano i commenti `%%`, e l'export li
  toglie: l'archivio resta nel file, per chi lo vuole rileggere.

Le modifiche suggerite di CriticMarkup (`{++ ++}`, `{-- --}`, `{~~ ~> ~~}`)
non sono una convenzione di Fub: restano testo.

## I tipi di nota

Un tipo di nota (Libro, Persona, Riunione) è una nota Markdown nella cartella
dei tipi: `Tipi/` di partenza, l'impostazione del vault `files.types-folder`
(Impostazioni › File) la sposta, e vuota spegne i tipi. Il nome del file è il
nome del tipo; il frontmatter dice com'è fatto, il corpo è il modello del
testo delle note nuove, con le variabili `{{…}}` dei template.

```markdown
---
icon: book
properties:
  autore: testo
  letto: casella
  generi: elenco
featured: [autore]
folder: Biblioteca
---
# {{title}}

Note di lettura.
```

- `properties`: le proprietà del tipo, una per riga col tipo di proprietà
  (in italiano, `testo`, `numero`, `casella`, `data`, `data e ora`, `elenco`,
  `etichette`, `selezione`, `stato`, `url`, o con l'id del registro, `number`,
  `checkbox`, `date_time`); anche soltanto i nomi, `properties: [autore, anno]`.
  Una parola che Fub non conosce lascia la proprietà senza tipo.
- `featured`: le proprietà da tenere in vista; `icon`: l'icona del tipo, un'emoji
  o una figura (`book` o `fub:book`), letta come l'icona di una pagina;
  `folder`: dove nascono le note del tipo (un percorso del vault, senza `..`).
  Tutti i campi sono facoltativi.
- Il registro dei tipi di proprietà resta uno per vault: se il registro dice
  per una proprietà un tipo diverso da quello scritto nel tipo, vale il
  registro, e il pannello delle proprietà aperto sul tipo lo dice riga per
  riga.

Una nota dice il suo tipo con `tipo`, un link alla nota del tipo:

```markdown
---
tipo: "[[Tipi/Libro]]"
autore: Frank Herbert
letto: false
generi: []
---
```

- Fub scrive sempre il link col percorso nella cartella dei tipi
  (`[[Tipi/Libro]]`, `[[Tipi/Lavoro/Progetto]]`): è la forma che usano anche
  le relazioni verso un tipo (`Tipi/<Nome>`). Legge anche un link senza
  cartella o il nome in testo semplice (`tipo: Libro`), senza distinguere
  maiuscole e minuscole.
- Due tipi con lo stesso nome in sottocartelle diverse vanno nominati col
  percorso: il nome solo non sceglie, e la nota lo dice.
- «Nuova nota di un tipo» (`note.from_type`) scrive `tipo`, poi le proprietà
  del tipo vuote (`false` una casella, `[]` un elenco o le etichette, niente
  le altre), poi il modello; la nota nasce nella cartella chiesta, se no in
  quella del tipo, se no alla radice.
- «Cambia il tipo della nota» (`note.type.set`) riscrive `tipo` e aggiunge in
  fondo al frontmatter le proprietà del tipo che mancano. Non toglie niente,
  né le proprietà del tipo di prima né i valori scritti, e si annulla in un
  passo.
- Un tipo che non c'è, che è di più o che non si legge (frontmatter rotto, un
  campo della forma sbagliata) lascia la nota com'è: il pannello delle
  proprietà dice che cosa non va, e i due comandi non scrivono niente.
- Rinominare o spostare un tipo non aggiorna ancora i `tipo` delle note: i link
  del frontmatter non sono nel grafo dei link, e la nota dice che il tipo non
  c'è finché `tipo` non lo nomina di nuovo.

## Il promemoria di un compito

Accanto alla scadenza `📅` del plugin Tasks di Obsidian, un compito può
portare un promemoria: `⏰`, poi la data e, se si vuole, l'ora.

```markdown
- [ ] Chiamare Mario ⏰ 2026-11-13 09:30 📅 2026-11-14
- [ ] Pagare l'affitto ⏰ 2026-12-01
```

- La data è `AAAA-MM-GG` e deve esistere; l'ora è `HH:MM` dalle `00:00` alle
  `23:59`, separata dalla data da spazi. Senza ora suona alle **9:00**.
- Conta l'ultimo `⏰` del testo del compito. Una data o un'ora che non si
  leggono (`⏰ 2026-02-30`, `⏰ 2026-11-13 25:00`) fanno un promemoria che non
  suona.
- L'ora non ha fuso: è l'ora dell'orologio di chi legge la nota, quando la
  legge.
- È testo semplice, come la scadenza: il parser Markdown non lo tocca, Obsidian
  lo mostra così com'è, e Fub non riscrive mai la riga per suonarlo. La regola
  che lo legge è una sola, nel contratto (`task_reminder`), e cosa succede
  quando suona sta in [Compiti](../product/tasks-and-reminders.md#i-promemoria).
