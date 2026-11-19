# Esporta in PDF

Lo spazio «Esporta in PDF» mostra le pagine vere di una nota Markdown prima
di esportarle: come vanno a capo, dove cade ogni interruzione, che cosa sta
nella testata e nel piè di pagina. Vive in
[`apps/client/src/export/`](../../apps/client/src/export/); le pagine le
taglia l'impaginatore della stampa (`PrintPaginator` in
[`paginate/slices.ts`](../../apps/client/src/export/paginate/slices.ts)),
le regole del profilo sono quelle del core (`fub-markdown`, il `Profilo` di
stampa).

## Come si apre e come si chiude

- Dal menu «…» del riquadro di una nota, «Esporta in PDF…». Su una nota
  Markdown la voce prende il posto di «Stampa», che sta nella barra dello
  spazio; la lavagna tiene «Stampa».
- Dallo spazio comandi (Ctrl O), «Esporta in PDF…»
  (`shell.doc.export_pdf`), sulla nota del riquadro attivo.
- All'apertura la nota si salva; lo spazio copre il riquadro e la banda di
  stato, che restano inerti sotto.
- «Torna alla nota» o Esc chiude lo spazio e rimette il fuoco dove stava
  prima, se c'è ancora. Chiudere il riquadro chiude anche lo spazio.

## Che cosa c'è

- **La barra in alto**: «Torna alla nota», il nome della nota, lo zoom
  (−, percentuale, +), le tre viste (Una, Due, Tutte), il profilo, «Stampa…»
  ed «Esporta». Nella vista Tutte un clic su una pagina la apre in Una.
- **Le pagine** su un fondo neutro, nei colori del tema di stampa. Si
  riempiono solo le pagine vicine a quelle visibili: una nota lunga non
  costruisce tutte le copie insieme.
- **Le dieci sezioni** a destra: Tema, Colori, Caratteri, Pagina, Testata e
  piè di pagina, Frontespizio e indice, Contenuto, Diagrammi, Interruzioni di
  pagina, Uscita. La testa chiusa dice ciò che vale ora («A4 verticale»,
  «Titolo, Numero di pagina»). Le regolazioni di ogni sezione arrivano coi
  loro lavori; finché manca, la sezione aperta lo dice.
- **La banda** in basso: le pagine, il formato, i margini, i segnalibri e il
  tempo dell'impaginazione. Il numero di pagine si annuncia a voce solo
  quando cambia.

## Tema e Colori

I temi di stampa e i loro colori vivono in
[`export/themes.ts`](../../apps/client/src/export/themes.ts); le due
sezioni in [`export/sections/theme.ts`](../../apps/client/src/export/sections/theme.ts)
e [`export/sections/colors.ts`](../../apps/client/src/export/sections/colors.ts).

- **Otto temi**: Fub, Classico, Relazione, Rivista, Accademico, Quaderno,
  Essenziale, Notte. Ognuno porta gli undici colori, i caratteri dei titoli
  e del testo, il corpo, l'interlinea, la scala dei titoli e l'impostazione
  (colonne, giustificato, rientro o spazio fra i paragrafi, titoli centrati
  o numerati). Un tema che questa versione non conosce si legge come Fub.
- Passare su un tema lo mostra sulle pagine senza sceglierlo; uscendo
  tornano le pagine di prima. Un clic lo sceglie.
- **Undici colori**: carta, testo, titoli, accento, link, testo secondario,
  linee, evidenziato, riquadri, codice, intestazioni di tabella. Una riga
  aperta offre i tondi pronti, un selettore libero e il codice a mano
  (`#rgb` o `#rrggbb`, come il core). Un codice scritto male non entra: la
  riga lo dice e resta il colore di prima; Esc nel campo rimette il colore
  com'era. Passare su un colore contorna sulle pagine i punti che lo usano.
- **Il contrasto** del testo sulla carta si ricalcola a ogni colore e avvisa
  sotto 4,5 a 1; l'accento avvisa a parte sotto 3 a 1.
- Ciò che cambi tu resta cambiando tema: la riga dice «tuo» e torna al
  colore del tema da sola; «Togli le regolazioni tue» le toglie tutte.
- **Bianco e nero** fa grigio ogni colore e, con un filtro sulla pagina,
  anche ciò che i colori non raggiungono (un diagramma colorato,
  un'immagine). **Risparmia inchiostro** dà carta bianca e niente fondi
  pieni: un fondo uguale alla carta prende il filo delle linee.
- Un colore cambia solo variabili dell'aspetto e non rifà l'impaginazione;
  il tema la rifà solo se cambia le misure (caratteri, colonne). Le pagine
  si stampano coi colori del tema anche quando l'app è scura: il tema
  dell'app cambia solo la cornice dello spazio. Notte stampa davvero su
  carta scura, col codice e il testo colorato schiariti.

## Comportamenti

- Mentre si trascina un controllo il profilo cambia «dal vivo»: le pagine si
  rifanno, il pannello no, così il controllo non perde il fuoco.
- Se la nota cambia in un altro riquadro, lo spazio la risalva e rifà le
  pagine dopo una pausa breve (400 ms).
- «Stampa…» (o Ctrl P nello spazio) aspetta l'impaginazione finale e manda
  al sistema le stesse pagine che si vedono, con il formato della carta.
- «Esporta» scrive il PDF quando c'è lo scrittore del PDF; finché manca
  passa dalla stampa del sistema, e un avviso lo dice.
- Il menu del profilo offre per ora soltanto «Di serie» (A4, margini
  25/22/25/22 mm, titolo in alto a destra, «pagina n di m» in basso al
  centro).
- Sotto i 1040 px spariscono il nome della nota e il suggerimento della
  banda, e il pannello si stringe; sotto i 760 px (e sul telefono) il
  pannello va sotto le pagine, la barra tiene solo indietro, profilo,
  stampa ed esporta, la banda solo pagine e formato. Con il moto ridotto lo
  spazio entra senza animazione.
