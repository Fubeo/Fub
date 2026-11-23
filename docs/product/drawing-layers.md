# Disegni, pannello dei livelli

> **Per chi:** chi mette in ordine un disegno con molti oggetti, nei livelli e
> nei gruppi.
> **Risultato:** sapere come si dà un nome a un oggetto, come lo si cerca,
> come si spostano le righe fra i livelli e i gruppi e che cosa mostrano le
> miniature.

Nello spazio Completo l'albero degli oggetti del [disegno](drawing.md) diventa
il pannello dei livelli. Ogni riga ha la sua miniatura, il nome, l'occhio e il
lucchetto; i nomi si cambiano da qui, un filtro cerca fra le righe e le righe
si trascinano per mettere in ordine il disegno. L'ordine è quello che si
vede: in cima ciò che sta davanti, e il livello più alto. L'albero è in
`apps/client/src/editors/spatial/tools/objects.ts`, i nomi in
`apps/client/src/editors/spatial/tools/naming.ts` e lo spostamento in
`apps/client/src/editors/spatial/tools/place.ts`.

## Il livello corrente e i suoi comandi

Un livello del disegno è un gruppo figlio della radice con `fub:layer`, che
ne porta il nome. Nello spazio Completo la barra ha il pulsante «Livelli»: mostra
il livello in cui si disegna, quello corrente, col suo nome e, a parole, il suo
stato, «bloccato» o «nascosto». Il suo menu elenca i livelli dalla cima, e
sceglierne uno lo rende corrente; poi ha i comandi su quello corrente:

- **Nuovo livello** ne crea uno vuoto sopra quello corrente, che diventa lui,
  col primo nome libero fra «Livello 2», «Livello 3» e così via;
- **Rinomina…** chiede il nome, che non resta vuoto né fatto di soli spazi e
  ha al più 80 caratteri;
- **Nascondi** e **Mostra** scrivono e tolgono `display="none"`, che lo
  nasconde anche negli altri programmi; **Blocca** e **Sblocca** scrivono e
  tolgono `fub:locked="true"`. Gli oggetti di un livello nascosto o bloccato
  non si scelgono e non si cancellano, ed escono dalla selezione;
- **Sposta su** e **Sposta giù** lo portano sopra il livello che ha sopra, o
  sotto quello che ha sotto; ciò che sta alla radice fra i due resta dov'era;
- **Elimina** lo toglie con ciò che contiene, e diventa corrente il livello
  sotto, o quello sopra. L'unico livello e uno bloccato non si eliminano, e la
  voce spenta dice perché.

Penna, evidenziatore, forme, testi e immagini, incollate o dal vault, vanno nel
livello corrente. Se è nascosto o bloccato il gesto non scrive, e un annuncio
dice perché e che cosa fare. Scegliere oggetti tutti in un livello lo rende
corrente: la riga dell'albero degli oggetti mostra il nome («Note»), e
per chi legge a voce il nome dice «Livello «Note», corrente».

Il livello corrente è del disegno, non del riquadro: due riquadri sullo stesso
disegno disegnano nello stesso livello, e la scelta resta quando l'editor si
rimonta o il file si rilegge, finché il documento resta aperto. Se il livello
corrente se ne va (cancellato da un altro riquadro, dal testo, annullato) si
disegna nel livello più alto che si vede e non è bloccato; se torna, con
Annulla o Ripeti, torna corrente. Nel Completo, Oggetto › Disponi › **Sposta sul
livello corrente** porta gli oggetti scelti in cima a quel livello; un livello
corrente nascosto o bloccato non li riceve, e l'annuncio dice perché.

Nella barra «Disponi», **Sposta in un livello** porta gli oggetti scelti in cima
a un altro livello, nell'ordine in cui stavano, dove si vedevano e con lo stile
che ereditavano. Il menu spegne il livello che li ha già tutti e quelli nascosti
o bloccati; senza un altro livello dove portarli il pulsante non c'è.

Ogni comando è un passo di annulla, e annullarlo rende corrente il livello
che ha toccato, se c'è ancora. Nel Semplice il pulsante non c'è, e il
disegno va nel livello più alto che si vede e non è bloccato.

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
trasformazione che lo lascia dove si vedeva, come con «Sposta in un livello»,
e tiene lo stile che ereditava; un foglio di stile del disegno che lo
sceglierebbe diversamente non lo cambia ([Disegni, appunti](drawing-clipboard.md)).

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
  perché non si inverte;
- qualcosa che un foglio di stile del disegno farebbe vedere diverso, quando
  non si sa riscrivere com'era.

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

## Disegnare dietro

La modalità «Disegna dietro» mette il nuovo oggetto sotto il primo oggetto
scelto, nello stesso livello; senza scelta va in fondo al livello. «Disegna
normale» torna al modo di sempre, che mette il nuovo in cima. Il modo sta
nella sessione: cambiarlo non cambia il file, e riaprendo il disegno torna
normale. Il comando è `view.drawMode` (famiglia `vista`, K6 T11).

«Disegna dentro», che crea il nuovo oggetto dentro un tracciato, non c'è
ancora nel Completo: il file non ha ancora il gruppo di ritaglio che serve.
Chi lo chiede riceve la frase che lo dice, e il modo resta quello di prima.

## Nel Completo, la scheda Livelli

Nello spazio Completo il pannello sta anche nella scheda «Livelli»
dell'ispettore, ed è lo stesso albero, con le stesse righe, lo stesso filtro e
le stesse miniature. L'occhio, il lucchetto, il nome di un livello, «Nuovo
livello» ed «Elimina livello» passano dal motore di disegno del Completo
([Il Completo](../architecture/disegno-livelli.md)); il file cambia
negli stessi attributi di sempre, `display`, `fub:locked` e `fub:layer`, e
ognuno è un passo di annulla.

- **Un livello bloccato** non si rinomina e non si elimina: il doppio clic sul
  nome non apre il campo e l'editor dice di sbloccarlo. Il lucchetto e
  l'occhio restano attivi.
- **Un livello nuovo** nasce sopra tutti gli altri, col primo nome «Livello N»
  libero, e diventa quello in cui si disegna.
- **Lo spostamento delle righe** resta quello di questa pagina: il motore non
  ha ancora un comando per spostare, e un livello dentro sé stesso resta
  rifiutato come prima.
- **Se il motore non può**, perché non c'è o perché la sua famiglia non si è
  caricata, l'editor scrive da sé le stesse modifiche: il file è lo stesso.

Le scene del banco `disegno-fam-livelli`, `disegno-fam-livelli-stati`,
`disegno-fam-livelli-stati-800` e `disegno-fam-livelli-filtro` mostrano la
scheda con due livelli, con un livello rinominato, bloccato e uno nascosto, e
col filtro.

## Spazi e tasti

Nel Semplice l'albero non ha niente di questa pagina: le righe non hanno
miniatura e non si rinominano, non si cercano e non si spostano. Per chi monta l'editor con le sue
parti tutto viene con la parte «Livelli», come dice [Disegni,
spazio di lavoro e barra](drawing-custom.md). In un documento in sola lettura
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
