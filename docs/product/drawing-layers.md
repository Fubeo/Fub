# Disegni, pannello dei livelli

> **Per chi:** chi mette in ordine un disegno con molti oggetti, nei livelli e
> nei gruppi.
> **Risultato:** sapere come si dà un nome a un oggetto, come lo si cerca,
> come si spostano le righe fra i livelli e i gruppi e che cosa mostrano le
> miniature.

Dal livello Standard l'albero degli oggetti del [disegno](drawing.md) diventa
il pannello dei livelli. Ogni riga ha la sua miniatura, il nome, l'occhio e il
lucchetto; i nomi si cambiano da qui, un filtro cerca fra le righe e le righe
si trascinano per mettere in ordine il disegno. L'ordine è quello che si
vede: in cima ciò che sta davanti, e il livello più alto. L'albero è in
`apps/client/src/editors/spatial/tools/objects.ts`, i nomi in
`apps/client/src/editors/spatial/tools/naming.ts` e lo spostamento in
`apps/client/src/editors/spatial/tools/place.ts`.

## I nomi

Il nome di un oggetto è il suo primo `title`, lo stesso nome con cui lo dice
uno screen reader: la riga lo mostra dopo il tipo, «Rettangolo «Tetto»,
Nero». Un livello ha il suo nome in `fub:layer`, come dice [Disegni](drawing.md).

`F2`, o un doppio clic sul nome, apre sulla riga il campo del nome: `Invio`
lo scrive, `Esc` lo lascia com'era, e uscire dal campo lo scrive anche lui. Un
doppio clic altrove sulla riga apre le proprietà, come `Invio`. Sul foglio lo
stesso campo si apre con `F2`, se l'oggetto scelto non è un testo, e con
«Rinomina» nel menu della selezione; l'albero, se era chiuso, si apre.

- **Un nome si scrive pulito.** Gli spazi si raccolgono e quelli ai bordi se
  ne vanno; un oggetto tiene al più 200 caratteri, un livello 80.
- **Un nome vuoto toglie quello di un oggetto**, e l'annuncio dice come si
  chiama adesso: «Nome tolto: ora è Rettangolo, Nero.». Un livello ha sempre
  un nome, e resta quello di prima.
- **Il `title` resta lui.** Cambia il suo testo: i suoi attributi restano, e
  gli altri `title`, per esempio in altre lingue, non si toccano. Un oggetto
  senza id ne riceve uno, e resta scelto.
- **Un passo di annulla** per ogni nome, «Annullato: Nome.».

Un oggetto bloccato, dentro qualcosa di bloccato o in un livello bloccato non
si rinomina, e l'editor dice perché e che cosa fare: «Il suo livello è
bloccato: sblocca il livello per cambiargli il nome.». Così un oggetto con
parti che il disegno non sa riscrivere, che resta com'è.

## Il filtro

In cima al pannello il campo «Cerca fra gli oggetti» e la scelta del tipo:
«Tutti i tipi», «Tratti», «Forme», «Testi», «Immagini», «Gruppi» e
«Collegamenti». Restano le righe che hanno tutte le parole cercate nel nome
con cui si dicono, cioè il nome dato, il tipo, i colori e lo stato, con le
maiuscole e gli accenti a parte, e sono del tipo scelto. Con loro restano,
aperti, i livelli e i gruppi che le contengono; un livello, un gruppo o un
collegamento trovato porta con sé ciò che contiene. Una riga di stato dice
quanti oggetti ha trovato: «3 oggetti trovati.», o «Nessun oggetto trovato.».

`Ctrl+F` o `⌘F` nell'albero porta al campo. `Freccia giù` o `Invio` tornano
alle righe; `Esc` svuota il campo e, vuoto, torna alle righe. In un albero di
più di 500 voci la ricerca aspetta che si smetta di scrivere. Il filtro non
cambia la selezione: `Maiusc` con le frecce la estende soltanto alle righe
trovate, e `Spazio` su un livello sceglie i suoi oggetti trovati.

## Spostare le righe

Una riga si trascina: sopra un'altra va davanti a lei, sotto va dietro, su un
livello o su un gruppo va dentro, davanti a ciò che contiene. Una linea
dell'accento dice dove andrà, rientrata quanto il contenitore che la
riceve; una riga che accoglie ha il bordo dell'accento. Sotto l'ultima riga di
un gruppo aperto, il puntatore più a sinistra porta fuori dal gruppo, un
rientro per volta. Fermarsi su un gruppo chiuso lo apre, e vicino ai bordi
l'elenco scorre. Dove la riga non può andare non c'è linea e il puntatore lo
dice; `Esc` lascia tutto com'era.

- **Col mouse e con la penna** il trascinamento comincia dopo pochi pixel.
- **Col dito** la riga si tiene premuta un momento, e si solleva: un dito
  che si muove subito scorre l'elenco, come sempre.
- **Dalla tastiera** `Alt` con `Freccia su` o `Freccia giù` porta la riga
  attiva di un passo, davanti o dietro: entra in un gruppo aperto che
  incontra, esce da quello che la contiene quando ne è al bordo e passa da
  un livello a quello accanto. Il passo conta anche le righe che il filtro
  non mostra, perché è un passo nel disegno. Al bordo lo si dice: «È già
  davanti a tutto.», «È già il primo livello.».

Una riga scelta porta con sé le altre righe scelte, nell'ordine in cui
stavano; una che non lo era prima si sceglie. Un livello va da solo, e soltanto
fra i livelli; un oggetto va dentro un livello, non fra un livello e l'altro.
Entrando in un gruppo o in un livello trasformato l'oggetto riceve la
trasformazione che lo lascia dove si vedeva, come con «Sposta in un livello».

Ogni spostamento è un passo di annulla, la selezione e la riga attiva lo
seguono, e ciò che ora lo contiene si apre. L'annuncio dice dove è arrivato,
contando i posti come le righe: «Rettangolo, Blu nel livello «Livello 1», al
posto 2 di 3 dal davanti.»; più oggetti dicono quanti sono e i loro posti, un
livello il suo nome e «ora è al posto 1 di 2 dall'alto». Lasciato dov'era, non
si scrive niente.

Le righe restano dove sono, e l'editor dice perché, se si sposta:

- un oggetto bloccato, dentro qualcosa di bloccato o in un livello bloccato;
- qualcosa dentro un livello o un gruppo bloccato;
- un collegamento dentro un altro collegamento;
- un gruppo dentro sé stesso;
- un livello insieme a degli oggetti, o un oggetto fra i livelli;
- qualcosa dentro un livello o un gruppo che la sua trasformazione schiaccia,
  perché non si inverte.

## Le miniature

La miniatura di un oggetto lo inquadra per intero; quella di un livello
inquadra la pagina, o senza pagina tutto il disegno, così le miniature dei
livelli si confrontano e si vede dove sta ciascuno. Una miniatura mostra
l'oggetto anche se è nascosto, perché lo si riconosca; ciò che è nascosto
dentro di lui resta nascosto. Lo sfondo è il bianco della carta.

Le miniature si disegnano dopo le righe, qualche riga per volta, soltanto per
quelle in vista: scorrere un disegno di 50 000 oggetti resta fluido. Una
miniatura resta finché non cambia ciò che mostra, e si rifà quando cambia
l'oggetto, ciò che lo contiene o la pagina.

- **Fino a 200 forme** la miniatura è viva, con le immagini del vault.
- **Fino a 5000** è un'immagine ferma, più leggera, e un'immagine del vault vi
  ha il segnaposto.
- **Oltre**, o per un oggetto che il disegno non sa leggere, la riga non ha
  miniatura e ne tiene il posto vuoto, perché i nomi restino in colonna.

## Livelli e tasti

All'Essenziale l'albero non ha niente di questa pagina: le righe non hanno
miniatura e non si rinominano, non si cercano e non si spostano. Nel
Personalizzato tutto viene con la parte «Livelli», come dice [Disegni,
livello Personalizzato](drawing-custom.md). In un documento in sola lettura
il filtro e le miniature ci sono, e le righe non si rinominano né si
spostano.

`?` elenca i tasti in «Oggetti»: `F2`, `Ctrl+F` e `Alt+↑` o `Alt+↓`. Su
macOS `⌘` vale per `Ctrl`.

L'albero resta un `role="tree"`, e le righe dicono quello che dicevano: la
miniatura è una decorazione, senza testo, e il nome dice a parole lo stato e
il tipo. Il campo del nome ha per nome «Nome di» e la riga. Mentre si
trascina, le righe che si spostano si attenuano e un'etichetta col nome, o
col loro numero, segue il puntatore; la linea non conta sul solo colore,
perché sta fra le righe. Col contrasto forzato la linea e il bordo prendono il
colore di sistema dell'evidenziazione, e le miniature hanno un bordo.
