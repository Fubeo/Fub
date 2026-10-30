# Blocchi

> **Per chi:** chi scrive nelle note Markdown e chi modifica la superficie dei
> Blocchi.
> **Risultato:** sapere cosa aggiunge la modalità Blocchi alla Live, come si
> spostano, si trasformano e si collegano i blocchi, e cosa finisce nel file.

## Che cos'è

**Blocchi** è una modalità della nota Markdown accanto a Sorgente, Live e
Lettura, e si sceglie anche come modalità dei riquadri nuovi
(`editor.default-mode` = `blocks`). Scrive come la Live con la rivelazione
`mai`: i segni Markdown non si vedono, nemmeno col cursore dentro. In più dà a
ogni blocco una maniglia, un menu, il trascinamento e una selezione di blocchi.
Il file resta Markdown puro: nessun blocco ha un id nascosto né un formato a
parte, e Sorgente mostra gli stessi byte.

Il codice della modalità è un pezzo a parte, caricato la prima volta che un
riquadro passa a Blocchi. Finché arriva, il riquadro scrive come la Live.

## I blocchi

Un blocco è un paragrafo, un titolo, una voce di elenco o di attività, una
citazione, un callout, un blocco di codice, un ripiegabile `<details>`, una
tabella, una riga orizzontale, un blocco HTML o di formula, il frontmatter o
una nota a piè di pagina. Una voce di elenco è un blocco a sé, con le sue
sottovoci come figli. Un `^id` scritto su una riga sua, sotto un blocco, fa
parte di quel blocco e si sposta con lui.

## Maniglie e menu

Al passaggio del puntatore, e sul blocco del cursore, a sinistra del blocco
compaiono il **«+»**, che aggiunge sotto un paragrafo vuoto (o una voce sorella
sotto una voce), e la **maniglia**. La maniglia ha il nome del blocco («Blocco:
Titolo 2, Elenco di attività») e apre un menu col clic o col tasto destro.
Aperto col mouse, nessuna voce ha l'anello del fuoco finché una freccia non
la sceglie; da tastiera il fuoco va subito alla prima voce. Il menu ha:

- **Trasforma in…**: paragrafo, titoli, elenchi, elenco di attività, citazione,
  riquadro, blocco di codice, ripiegabile. Il testo resta, cambiano soltanto i segni; un titolo che
  prende più righe le unisce con uno spazio, e le sottovoci restano blocchi
  sotto. Una tabella non si trasforma;
- **Duplica**, **Sposta su**, **Sposta giù** e, per ultimo, **Elimina il
  blocco**;
- **Copia il link al blocco**: scrive negli appunti `[[Nota#Titolo]]` per un
  titolo e `[[Nota#^id]]` per il resto. Se il blocco non ha un id, ne riceve uno
  di sei caratteri: in coda all'ultima riga per paragrafi, titoli e voci, su una
  riga sua per gli altri. Un id che c'è già si riusa.

La maniglia si trascina: una linea mostra dove il blocco cade, fra i fratelli
dello stesso livello; vicino ai bordi la nota scorre; Esc annulla. Le maniglie
stanno fuori dal testo e non sono fermate di Tab; con Vim acceso restano
cliccabili.

## La selezione di blocchi

Esc seleziona il blocco del cursore; Shift+↑/↓ allarga ai fratelli, ↑/↓
passano al blocco vicino, Canc e Backspace eliminano i blocchi con le loro righe
vuote, Mod+D duplica, Invio ed Esc tornano al testo. Copiare e tagliare
lavorano sul Markdown dei blocchi interi. La selezione è del riquadro: un altro
riquadro sulla stessa nota non la vede, e le modifiche che arrivano da lì non
diventano battute nella sua cronologia. Lo screen reader sente quanti blocchi
sono selezionati.

## Tasti

- Mod+Shift+↑/↓ sposta il blocco del cursore, o la selezione di blocchi, fra i
  fratelli; le voci numerate si rinumerano; un annulla torna indietro in un
  passo.
- Backspace all'inizio di un paragrafo lo unisce al testo del blocco sopra.
- Dentro un blocco di codice Tab e Shift+Tab rientrano il codice e Mod+A
  seleziona prima il codice, poi tutta la nota.
- Mod+Alt+0 fa un paragrafo, Mod+Alt+1…3 un titolo, 4 un'attività, 5 un
  elenco puntato, 6 uno numerato, 7 un ripiegabile, 8 un blocco di codice;
  valgono anche in Live.

Durante una composizione (IME) e con Vim fuori dal modo inserimento questi tasti
si fanno da parte: Esc resta di Vim.

## Gli id di blocco

Con la rivelazione `mai` un `^id` in coda a un blocco, o su una riga sua, non si
vede; con `elemento` e `riga` resta visibile e attenuato. In Sorgente si vede
sempre.

## La testata della pagina

In cima ai Blocchi stanno l'icona, la copertina e il titolo della pagina, con
le proprietà subito sotto. Sono righe del frontmatter, scritte come le altre
proprietà, e in Sorgente si vedono così:

```yaml
icon: 🧳
cover: ../Risorse/mare.png
cssclasses: [wide, sans]
```

- **Titolo.** È il nome del file; per la pagina di una cartella
  (`Viaggio/_index.md`, vedi [Esplora e cartelle](explorer-and-folders.md)) è il
  nome della cartella. Si scrive in riga: Invio o l'uscita dal campo rinominano
  il file, o la cartella, con i collegamenti; Esc torna al nome di prima. Un
  nome che non si può usare o che c'è già non rinomina niente e lo dice. ↑ sulla
  prima riga del testo porta al titolo, ↓ e Invio dal titolo al testo.
- **Icona.** Un'emoji, scelta cercandola per nome in italiano o in inglese.
  Si vede anche fuori dalla pagina, quando l'indice ha letto la nota salvata:
  nella sua riga dell'esplora (e in quella della cartella di cui è la pagina,
  se l'esplora non le ha dato un'icona sua), nella sua scheda e prima dei
  `[[wikilink]]` che la nominano in Live e in Blocchi. Due note omonime con
  icone diverse non la danno a `[[Nome]]`. Un valore che non è un testo breve,
  come il path di un'immagine messo da un'altra app, non si mostra.
- **Copertina.** Un'immagine del vault, con lo stesso path di un'immagine nel
  testo, o un indirizzo.
- **Nuova sottopagina.** Chiede il nome, dice se la pagina sta per diventare
  quella di una cartella, crea la nota con `note.subpage` e scrive `[[Nome]]`
  in una riga vuota o in un paragrafo dopo il blocco del cursore.
- **Il menu «⋯».** «Larghezza piena», «Testo piccolo» e il carattere (quello
  del tema, con grazie, senza grazie, monospaziato) scrivono `cssclasses`
  (`wide`, `small`, `serif`, `sans`, `mono`) e lasciano le altre classi della
  nota. Il tema le applica al riquadro quando l'indice ha letto la nota salvata.

In sola lettura la testata si guarda soltanto. Ogni modifica è un passo
d'annullamento suo.

## I colori

Come in Notion, il testo e il suo fondo hanno nove colori: `gray`, `brown`,
`orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`. Sul disco sono
HTML in riga con una classe chiusa, che la Lettura, la Live, i Blocchi e
l'export rendono e il sanitizzatore lascia passare da sola:

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

In Live e nei Blocchi resta il sommario con la freccia davanti, e il contenuto
sta rientrato sotto; i tag e le due righe vuote non si vedono. La freccia apre
e chiude soltanto nella vista e non scrive niente. Un ripiegabile comincia
aperto se ha `open`, che «Aperto di norma» nel menu del blocco mette o toglie,
e un cursore che entra nel contenuto lo apre. La Lettura e l'export lo rendono
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

La Lettura, la Live e i Blocchi le mettono in griglia, alla pari, e un foglio
largo meno di 700 px le mette una sotto l'altra. Col cursore dentro, la Live
le mostra una sotto l'altra con l'etichetta «Colonna 1», «Colonna 2»…, e il
testo si scrive lì. Le crea «Colonne» (`markdown.columns`) dalla barra o dal
«/», con un blocco per colonna delle righe selezionate; nei Blocchi anche
«Colonne» nel menu del blocco, che mette il blocco accanto al fratello che lo
segue (o la selezione di blocchi, una colonna per blocco), e il blocco
trascinato e lasciato sul bordo destro di un altro, che gli va accanto o in
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
tutti. Nel file resta il recinto: l'indice segue i titoli da solo, in Lettura,
in Live, nei Blocchi e nell'export. In Live e nei Blocchi il clic su una voce
porta al titolo; il recinto si modifica dalla sua riga. «Indice»
(`markdown.toc`) lo inserisce dalla barra e dal «/». Gli altri programmi lo
mostrano come un blocco di codice.

## Le persone

Una persona è una nota della cartella `files.people-folder`, un'impostazione
del vault che parte da `Persone`; vuota, `@` resta testo. In Live e nei
Blocchi `@` all'inizio di una parola propone le persone il cui nome combacia,
cercate dall'indice, e scrive il link con il nome come testo:

```markdown
Ne parlo con [[Persone/Anna Bianchi|Anna Bianchi]].
```

Se nessuna si chiama così, «Nuova persona» scrive lo stesso link e crea la
nota nella cartella. Il link a una nota della cartella si mostra come una
pastiglia con la `@` davanti; in Lettura e negli altri programmi resta un
wikilink.

## Le date

`@` propone anche i giorni: il giorno stesso, «domani», «ieri», un giorno della
settimana («venerdì», il prossimo con quel nome), «prossimo venerdì» (quello
della settimana dopo, che comincia dal giorno scelto in
`locale.first-day-of-week` o da quello del sistema), «4 novembre», «nov 4» e
`2026-11-04`, in italiano e in inglese. Una parola a metà basta. Il giorno
diventa il link alla sua giornaliera, nella cartella e col formato di
`daily.folder` e `daily.format`, con il giorno per esteso come testo:

```markdown
Consegna [[Daily/2026-11-04|4 novembre 2026]].
```

In un compito c'è anche la scadenza `📅 2026-11-04`. «Persona»
(`markdown.mention`) e «Data» (`markdown.date`) scrivono la `@` dal «/» e
dalla barra; «Nuova sottopagina» (`note.subpage`) sta nel «/» fra i comandi
del vault.

## I segnalibri web

Un indirizzo `http` o `https` scritto da solo in un paragrafo, fuori dal
cursore, si vede come una scheda con titolo, descrizione, sito e icona della
pagina; col cursore dentro torna l'indirizzo. Il file resta l'URL nudo, e in
Lettura e negli altri programmi è un link. La scheda si scarica **soltanto su
richiesta**: aprire una nota legge la cache e basta, e un indirizzo senza
scheda offre «Mostra l'anteprima». Il download è il comando `linkcard.fetch`
del bundle `fub.linkcard`, col permesso `fub:network` che si spegne nelle
Preferenze: la scheda in cache torna subito nell'effetto `custom` con `ns`
`fub.linkcard`, quella scaricata arriva col `job_done` del job
`linkcard.fetch`. Della pagina si leggono soltanto i metadati della testa, fino a
1 MiB; l'icona entra se è un'immagine raster entro 64 KiB, mai un SVG. Le
schede stanno nella cache del bundle, ricostruibile. «Segnalibro web»
(`markdown.linkcard`) apre dal «/» un paragrafo con `https://`.

## Dove si trova

- `apps/client/src/editors/text/profiles/markdown/blocks/`: modello, maniglie,
  selezione, spostamenti, trasformazioni, link;
- `apps/client/src/editors/text/profiles/markdown/block-id.ts`: gli id nascosti;
- `apps/client/src/editors/text/profiles/markdown/details.ts`: la regola dei
  ripiegabili, gemella di `crates/fub-format-markdown/src/render.rs`;
- `apps/client/src/editors/text/profiles/markdown/blocks/columns.ts`: le
  colonne fatte coi blocchi;
- `apps/client/src/editors/text/profiles/markdown/toc.ts`: l'indice, gemello
  di `crates/fub-format-markdown/src/render.rs`;
- `apps/client/src/state/page-rename.ts`: la rinomina dal titolo;
- `apps/client/src/state/page-icons.ts`: le icone fuori dalla pagina;
- `apps/client/src/state/people.ts`: la cartella delle persone;
- `apps/client/src/editors/text/profiles/markdown/dates.ts` e
  `apps/client/src/state/dates.ts`: le date di `@` e la giornaliera, gemella
  di `crates/fub-features/src/template.rs`;
- `apps/client/src/editors/text/profiles/markdown/link-card.ts` e
  `apps/client/src/state/link-cards.ts`: la scheda nella Live e le risposte di
  `crates/fub-host/src/link_card.rs`;
- `crates/fub-host/src/settings.rs`: la modalità dei riquadri nuovi.
