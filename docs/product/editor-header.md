# La testata della nota

> **Per chi:** chi scrive nelle note Markdown e chi lavora sulla loro testata.
> **Risultato:** sapere che cosa c'è in cima a una nota, come si scrivono il
> titolo e le proprietà, e dove sta nel codice.


In cima alla nota, in Scrittura e in Lettura, sta la stessa testata, in
quest'ordine: la copertina, l'icona, il titolo (il nome del file), le
proprietà in evidenza, «Altre N proprietà», «Aggiungi una proprietà» e la
[riga dei dati](editor-note-facts.md). Un filo la stacca dal testo. Che cosa
sono icona, copertina, titolo e menu «⋯» lo dice la
[pagina dei blocchi](editor-blocks.md#la-testata-della-pagina).

- **Il titolo** è il nome del file (della cartella, per `_index.md`). In
  Scrittura si scrive in riga: Invio o l'uscita dal campo rinominano il file
  coi link, Esc torna al nome di prima; una rinomina che non riesce (un nome
  preso, caratteri che il file system rifiuta) lo dice e il titolo torna. In
  sola lettura non si modifica.
- **Il primo H1.** Se la prima riga che si legge dopo il frontmatter (righe
  vuote e commenti `%%` o `<!-- -->` a parte) è un H1 che, a parte maiuscole,
  spazi, punteggiatura e formattazione, dice il nome (l'id di blocco `^x` e i
  commenti in riga non contano, i simboli come `+` sì: `# C++` non è la nota
  `C`), si ripiega nel titolo:
  in Scrittura e in Lettura non si vede, in Sorgente sì, e il file non cambia.
  Un H1 diverso, o non in cima, resta un titolo del testo. Una selezione che
  ci entra (una ricerca) lo rivede; ciò che si scrive prima di lui scende
  sotto, dove comincia il testo, e Backspace all'inizio del testo non lo
  unisce al titolo. Rinominare dal titolo, quello della testata o quello del
  foglio, riscrive anche l'H1 ripiegato col nome nuovo, nello stesso gesto e
  con un passo d'annullamento della nota, e solo nella nota rinominata (non
  nelle schede di una lavagna nello stesso riquadro); con un titolo che sposta
  il file (`Archivio/Nuova`) l'H1 prende il nome, `Nuova`. Se la rinomina non
  riesce l'H1 non cambia. Una rinomina che arriva da fuori non lo tocca: se l'H1 non dice più
  il nome torna un titolo del testo.
- **Le proprietà.** Senza un tipo, sono in evidenza le prime quattro voci del
  frontmatter, nell'ordine del file; le altre stanno dietro «Altre N
  proprietà», che si apre e si richiude e resta com'era finché l'editor è
  aperto. Le voci che la testata mostra a modo suo (`icon`, `cover`,
  `cover-y`, `cssclasses`) non sono righe, e nemmeno le etichette quando la
  riga dei dati le mostra; finché l'indice non risponde, `tags` è una riga
  come le altre. Una chiave scritta due volte è una riga sola, col valore
  dell'ultima, come la legge YAML. Il nome lungo si taglia e si legge intero
  al passaggio; il valore va a capo, senza il commento in coda. Un valore
  vuoto si legge «Vuoto».
- **Il tipo** di una riga lo dice la figura davanti al nome e decide come si
  legge e si scrive il valore. Vince il registro dei tipi del vault
  (`properties.types`, con `tags`, `aliases` e `cssclasses` convenzionali);
  senza dichiarazione il tipo si legge dal valore: casella (`true`/`false`
  nudi), numero, data (`aaaa-mm-gg` che esiste), data e ora, indirizzo,
  elenco, persone (un elenco di soli `[[link]]`), testo. Un valore che non
  torna col tipo dichiarato resta testo, sottolineato, e dice «Non è numero:
  resta testo»; non si riscrive niente per farlo tornare. Selezione e Stato si
  scrivono intanto come testo; un valore che è un'opzione del registro
  (`options`) si legge come la pastiglia del suo colore, col pallino per lo
  Stato, e uno fuori dalle opzioni resta testo. La data si legge per esteso nella lingua
  dell'interfaccia; le persone hanno il tondo delle iniziali, le voci di un
  elenco e le etichette sono pastiglie.
- **`editor.properties`** decide quanto se ne vede: `visible` (il default) le
  mostra come sopra, `hidden` le mette tutte dietro «Altre N», `source` lascia
  lo YAML sotto il titolo, senza righe. In Lettura vale lo stesso, all'apertura.
- **Scrivere.** In Scrittura il clic su un valore (o Invio col fuoco sopra)
  apre l'editor del suo tipo. Testo, numero e indirizzo si scrivono al posto
  del valore: Invio o l'uscita dal campo scrivono, Esc torna a prima; un
  numero si accetta anche all'italiana (`12,5`) e ciò che non è un numero non
  si scrive. La casella si spunta col clic. La data apre un riquadro con il
  campo «a parole», le scelte rapide (il giorno stesso, l'indomani, fra una
  settimana, il venerdì), il mese da scorrere con le frecce e Pagina su/giù,
  «Togli la data» e «Aggiungi l'ora». Il campo capisce le date con la regola
  di `@` («venerdì», «prossimo venerdì», «fra due settimane», «3 giorni fa»,
  «20 marzo», «3/4», `2026-03-20`, anche in inglese), più un'ora facoltativa
  («venerdì 18:30», «domani alle 9»): mentre si scrive il giorno capito si
  vede scelto nel mese, e Invio lo scrive. Nel file va sempre `AAAA-MM-GG`
  (con l'ora `AAAA-MM-GGTHH:MM`): le parole sono solo il modo di dirla. Un
  giorno e un mese senza anno sono i prossimi che vengono; un anno di due
  cifre è del 2000; in «3/4» l'ordine è quello della lingua (in inglese
  americano il mese prima). Ciò che non si capisce, o un giorno che non c'è
  («31/2»), resta scritto nel campo e il riquadro lo dice: il valore di prima
  non cambia. «Aggiungi l'ora» su una proprietà dichiarata Data la dichiara
  Data e ora nel registro (le date senza ora ci stanno ancora); dove il
  registro non si scrive l'ora non si offre. Elenco ed etichette aprono le voci con
  la «×» e un campo: Invio aggiunge (più voci separate da virgola), Backspace
  nel campo vuoto toglie l'ultima. Le persone aprono una ricerca fra le note
  (la cartella delle persone, se c'è): chi è scelto sta in cima, un clic o
  Invio mette o toglie, un nome che non si trova si aggiunge come link. Ogni
  modifica è una scrittura sola nel frontmatter della nota, con un passo
  d'annullamento suo; la voce tiene la sua chiave, la sua forma (in riga o una
  voce per riga) e le virgolette dove YAML le vuole (un testo come `1e3`,
  `yes` o `2026-03-20` resta un testo; la data del calendario resta una data,
  con l'ora, i secondi e il fuso che aveva). Aprire un editor e uscire senza
  cambiare niente non scrive. Se il valore cambia mentre l'editor è aperto (un
  altro riquadro, il file da fuori) non si scrive: l'editor resta con ciò che
  si scriveva e lo dice, e una seconda conferma (in Elenco e Persone anche
  «Scrivi la mia») scrive. Con ancore o alias nel frontmatter «Metti in
  evidenza» apre lo YAML invece di spostare righe. Una voce che un editor non saprebbe riscrivere senza
  perdere niente (un commento, una mappa, un testo su più righe) apre lo YAML
  sulla sua riga, come prima: la testata cede il posto alle righe del
  frontmatter finché il cursore ci sta.
- **Il menu della proprietà** si apre dal nome (o col menu contestuale, o
  Shift+F10, sul valore) e dice nome e tipo: «Rinomina» cambia la chiave in
  questa nota (un nome già preso lo dice); «Tipo» dichiara il tipo nel
  registro del vault, per tutte le note, col comando `property.type.set`;
  «Metti in evidenza» porta la voce fra le prime quattro, «Togli
  dall'evidenza» in fondo al frontmatter (con quattro voci o meno sono tutte
  in evidenza e il menu non lo offre); «Togli dalla nota» toglie la voce con
  le sue righe. «Aggiungi una proprietà» apre una riga vuota prima
  della chiusura (o crea il frontmatter); «Aggiungi una descrizione», fra gli
  strumenti al passaggio, scrive `description: ` e ci porta il cursore. Gli
  strumenti stanno in una riga sola, alta 28 px: quelli che non ci stanno si
  nascondono dalla fine e il menu «⋯», sempre l'ultimo, li offre in cima. In
  Lettura e in sola lettura le righe si leggono e basta, «Altre N» compreso,
  senza editor, menu, strumenti né «Aggiungi».
- **La copertina** è un'immagine del vault, un indirizzo o un colore
  (`cover: "#a3c4f3"`); è alta 112 px (110 al telefono) ed esce dalla colonna
  fino ai bordi della pagina. Al passaggio offre «Cambia copertina» e, per
  un'immagine, «Riposiziona»: l'immagine si trascina in su e in giù, o si
  sposta con ↑ ↓ (Shift per un passo fine, Home e Fine ai bordi); Invio o
  «Salva la posizione» scrivono `cover-y:` (da 0 a 100, 50 il centro), Esc o
  «Annulla» tornano dov'era, e il fuoco torna a «Riposiziona». Un'immagine che
  non si trova lascia il segnaposto col suo path.
- **La misura.** Il titolo è di 40 px su 46 in «Comoda» e 34 su 40 in
  «Compatta» (31 su 37 al telefono); la colonna dei nomi è larga 150 px (124
  con la finestra sotto i 940 px, 108 al telefono). La pagina ha 104 px di
  margine a sinistra, dove stanno «+» e la maniglia del blocco, e 96 a destra;
  con la finestra sotto i 940 px 64 e 48, sotto i 620 40 e 20; un foglio sotto
  i 560 px (due affiancati) ha 40 e 20 anche in una finestra larga, al
  telefono 18. I margini sono gli stessi in ogni modalità, così cambiarla non
  sposta il testo.
- **La tastiera.** ↓ dal titolo passa per i valori, «Altre N» e «Aggiungi una
  proprietà», e dall'ultimo arriva alla prima riga del testo; ↑ sulla prima
  riga del testo torna all'ultima voce della testata, e da lì su fino al
  titolo.
- **Un frontmatter che non si legge** (una riga di primo livello che non è una
  chiave, un valore che YAML non accetta, un blocco che non è una mappa) non
  diventa righe a metà: la testata lo dice, anche con `source`, e lo YAML
  resta sotto il titolo com'è scritto, in Scrittura e in Lettura. Icona,
  copertina, strumenti e «Aggiungi» tacciono: il modello lo conserva come
  testo, e la testata non ci scrive. Quando non si legge lo decidono le
  stesse regole nel client e nel modello, provate sugli stessi casi
  (`apps/client/src/__fixtures__/frontmatter-readability.json`).

La testata non scrive niente da sé: il file cambia solo per un gesto, con un
passo d'annullamento suo, e le righe `---` del frontmatter restano protette
dalle battute (anche l'a capo prima della chiusura). Un valore uguale a quello
scritto non si riscrive; una voce con un commento, un'ancora, un alias o un
testo a blocco non si riscrive, e il gesto apre lo YAML su di lei. Quando il
frontmatter cambia da un altro riquadro la testata si rifà sul posto: il
titolo che si sta scrivendo resta, e un riquadro aperto (l'icona, la
copertina) resta aperto finché non si chiude. In Lettura la testata resta in
cima anche quando la resa si rifà da sé (un embed arrivato). In sola lettura
si guarda soltanto. La densità «Compatta» la stringe con il resto del foglio.
Le scene `testata-*` e `mobile-testata` del banco la fotografano.

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/page/title.ts`: la regola
  del primo H1 (`sameTitle`, `firstHeading`, `retitled`) e chi tiene l'H1
  allineato al titolo (`keepTitle`, `retitleIn`); `blocks/page.ts` lo
  nasconde in Scrittura (`titleFold`) e lo riscrive con la rinomina
  (`retitleView`), `page/header.ts` lo segna in Lettura e
  `skin/document.css` lo nasconde; `shells/scrittoio/sheets/title-rename.ts`
  lo riscrive dopo la rinomina dal titolo del foglio;
- `apps/client/src/editors/text/profiles/markdown/page/properties/`: le
  righe delle proprietà (`row.ts`), il tipo di una riga e il registro
  (`kind.ts`), gli editor dei tipi (`editors.ts`), il menu della proprietà
  (`menu.ts`) e ciò che li lega alla nota (`values.ts`, `PropertyRowHost`);
  `markdown/properties.ts` legge e riscrive le voci del frontmatter
  (`setProperty`, `renamePropertyKey`, `moveEntryBefore`), `blocks/page.ts`
  le scrive con un passo d'annullamento e controlla l'impronta
  (`writePropertyChecked`), `surface.ts` legge il registro e cabla «Tipo» e la
  ricerca delle persone;
- `apps/client/bench/scene.mjs`: le scene `testata-*`, `mobile-testata` e
  `proprieta-*` (gli editor dei tipi).
