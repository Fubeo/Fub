# Colori, colonne, persone e date

> **Per chi:** chi scrive nelle note Markdown e chi lavora sul loro editor.
> **Risultato:** sapere come si scrivono nel file e come si vedono i colori,
> i ripiegabili, le colonne, l'indice, le persone e le date di una nota.

## I colori

Come in Notion, il testo e il suo fondo hanno nove colori: `gray`, `brown`,
`orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`. Sul disco sono
HTML in riga con una classe chiusa, che Scrittura, Lettura e l'export
rendono e il sanitizzatore lascia passare da sola:

```html
<span class="fub-color-red">urgente</span>
<mark class="fub-bg-yellow">da ricordare</mark>
```

«Colore» li scrive dalla barra (`markdown.color.*` e `markdown.background.*`
in [`ipc-contract`](../reference/ipc-contract.md)), dal «/» e dal menu del
blocco: sulla selezione, o sul testo della riga dopo i segni del blocco. Un
testo già colorato cambia classe invece di prendere un tag in più;
«predefinito» toglie la classe, e con l'ultima il tag. Le tinte sono del tema,
in entrambe le luci, con un contrasto di almeno 4,5:1 sul foglio.

## I ripiegabili

Il ripiegabile di Notion è `<details>` con il suo `<summary>`. Le righe vuote
dopo il sommario e prima della chiusura tengono il contenuto Markdown:

```html
<details>
<summary>Ingredienti</summary>

- farina
- acqua

</details>
```

In Scrittura resta il sommario con la freccia davanti, e il contenuto
sta rientrato sotto; i tag e le due righe vuote non si vedono. La freccia apre
e chiude soltanto nella vista e non scrive niente. Un ripiegabile comincia
aperto se ha `open`, che «Aperto di norma» nel menu del blocco mette o toglie,
e un cursore che entra nel contenuto lo apre. Invio nel sommario non lo
spezza: il cursore va al contenuto, fra le sue righe vuote, che nascono se
mancano. La Lettura e l'export lo rendono
come `<details>` vero. Ogni altra forma, come un sommario con altri tag o un
`<details>` senza la sua chiusura, resta HTML; senza chiusura ha l'ondulato.

## Le colonne

Le colonne sono un callout `[!columns]` con un callout `[!column]` annidato
per colonna, da due a quattro, separati da una riga `>`:

```markdown
> [!columns]
> > [!column]
> > Pro
>
> > [!column]
> > Contro
```

Scrittura e Lettura le mettono in griglia, alla pari, e un foglio
largo meno di 700 px le mette una sotto l'altra. Col cursore dentro, Scrittura
le mostra una sotto l'altra con l'etichetta «Colonna 1», «Colonna 2»…, e il
testo si scrive lì. Le crea «Colonne» (`markdown.columns`) dalla barra o dal
«/», con un blocco per colonna delle righe selezionate; coi blocchi accesi anche
«Colonne» nel menu del blocco, che mette il blocco accanto al fratello che lo
segue (o la selezione di blocchi, una colonna per blocco), e il blocco
trascinato e lasciato sul bordo destro (o sinistro) di un altro, che gli va accanto o in
fondo alle sue colonne. Un callout `[!columns]` con un solo `[!column]`, più
di quattro o altro testo fra loro resta un callout. Gli altri programmi le
leggono come citazioni annidate, e l'export come callout annidati.

## L'indice

Un recinto `toc` diventa l'indice dei titoli della nota, ognuno un link al suo
titolo, rientrato di quanto il suo livello sta sotto il più alto elencato:

```toc
livelli: 2-3
```

`livelli: a-b` (o `levels: a-b`) tiene soltanto quei livelli; senza, ci sono
tutti. Nel file resta il recinto: l'indice segue i titoli da solo, in Scrittura,
in Lettura e nell'export. In Scrittura il clic su una voce
porta al titolo; il recinto si modifica dalla sua riga. «Indice»
(`markdown.toc`) lo inserisce dalla barra e dal «/». Gli altri programmi lo
mostrano come un blocco di codice.

## Le persone

Una persona è una nota della cartella `files.people-folder`, un'impostazione
del vault che parte da `Persone`; vuota, `@` resta testo. Scrivendo, in
Scrittura e in Sorgente, `@` all'inizio di una parola propone le persone il cui nome combacia,
cercate dall'indice, e scrive il link con il nome come testo:

```markdown
Ne parlo con [[Persone/Anna Bianchi|Anna Bianchi]].
```

Se nessuna si chiama così, «Nuova persona» scrive lo stesso link e crea la
nota nella cartella. Il link a una nota della cartella si mostra come una
pastiglia con la `@` davanti in Scrittura; in Lettura e negli altri programmi resta un
wikilink.

## Le date

`@` propone anche i giorni: il giorno stesso, «domani», «ieri», «venerdì»
(il prossimo), «prossimo venerdì» (nella settimana dopo, dal giorno di
`locale.first-day-of-week` o del sistema), «4 novembre», «nov 4», `2026-11-04`
e, con la regola del campo della data nelle proprietà (`saidDay`), «fra due
settimane» e «3/4»; in italiano e in inglese, e una parola a metà basta. Il
giorno diventa il link alla sua giornaliera (`daily.folder`, `daily.format`),
col giorno per esteso come testo:

```markdown
Consegna [[Daily/2026-11-04|4 novembre 2026]].
```

In un compito c'è anche la scadenza `📅 2026-11-04`. «Persona»
(`markdown.mention`) e «Data» (`markdown.date`) scrivono la `@` dal «/» e
dalla barra; «Nuova sottopagina» (`note.subpage`) sta nel «/» fra i comandi
del vault.

## Dove si trova

- `apps/client/src/editors/text/profiles/markdown/color.ts`: «Colore» e le
  classi dei nove colori;
- `apps/client/src/editors/text/profiles/markdown/details.ts`: la regola dei
  ripiegabili, gemella di `crates/fub-format-markdown/src/render.rs`;
- `apps/client/src/editors/text/profiles/markdown/blocks/columns.ts`: le
  colonne fatte coi blocchi;
- `apps/client/src/editors/text/profiles/markdown/toc.ts`: l'indice, gemello
  di `crates/fub-format-markdown/src/render.rs`;
- `apps/client/src/state/people.ts`: la cartella delle persone;
- `apps/client/src/editors/text/profiles/markdown/dates.ts` e
  `apps/client/src/state/dates.ts`: le date di `@` e la giornaliera, gemella
  di `crates/fub-features/src/template.rs`;
- `apps/client/src/editors/text/profiles/markdown/completions.ts`
  (`mentionSource`): ciò che `@` propone.
