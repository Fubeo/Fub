# Le convenzioni scritte nelle note

> **Ambito:** le forme che Fub legge e riscrive dentro il testo di una nota
> Markdown, oltre a CommonMark e alle estensioni di Obsidian: i commenti con
> la discussione.
> **Fonti autorevoli:** `crates/fub-format-markdown/src/parse/comments.rs`,
> `crates/fub-abi/src/model.rs` (`custom_kind::COMMENT_RANGE`,
> `custom_kind::COMMENT_MESSAGE`), i casi «discussione» di
> `crates/fub-format-markdown/tests/corpus/mod.rs`.

Una convenzione di questa pagina è testo semplice nel file: un'altra app la
mostra così com'è, e Fub la rilegge e la riscrive byte per byte. Nessuna
richiede un file accanto alla nota né un campo del frontmatter.

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

Le modifiche suggerite di CriticMarkup (`{++ ++}`, `{-- --}`, `{~~ ~> ~~}`)
non sono una convenzione di Fub: restano testo.
