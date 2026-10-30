# Disegni, stili

> **Per chi:** chi apre un disegno i cui titoli, note o riquadri seguono degli
> stili.
> **Risultato:** sapere che cos'è uno stile di testo e uno grafico, che cosa
> ne fa l'editor e che cosa succede agli stili negli appunti.

Un disegno può avere i suoi **stili**: aspetti con un nome, che gli oggetti
seguono. Uno **stile di testo** dice il carattere e il colore di un testo,
«Titolo del capitolo»; uno **stile grafico** dice l'aspetto di una forma,
«Riquadro di avviso». L'editor non crea più stili, non li applica e non li
cambia: la riga «Stile» del pannello delle proprietà e il suo menu se ne sono
andati col livello Standard (decisione 0231), e al loro posto il pannello ha
il menu «Stile» che cambia il corpo e il peso di un testo. Gli stili che un
file ha già restano fra le sue risorse, e chi li segue si vede col suo
aspetto. Le regole dei nomi sono in
`apps/client/src/editors/spatial/tools/styles.ts`.

## Che cosa dice uno stile

- **Uno stile di testo:** il carattere, la dimensione, il peso, il corsivo, il
  sottolineato e il barrato, la spaziatura delle lettere, l'interlinea e il
  colore del testo.
- **Uno stile grafico:** il riempimento; il contorno col suo spessore, il
  tratteggio, gli estremi e gli angoli; le punte delle linee; l'opacità, la
  fusione e gli effetti.

Uno stile dice soltanto ciò che scrive: un campo che non scrive, chi lo segue
lo tiene suo. L'opacità, la fusione e gli effetti di uno stile grafico li dice
sempre, come un oggetto: piena, normale e nessuno, se non ne scrive altri.

Ogni oggetto porta comunque scritto il suo aspetto: il file resta un SVG che
ogni programma apre e disegna allo stesso modo, e lo stile è un prototipo
invisibile fra le risorse ([formato della scena,
stili](../reference/scene-format-styles.md)). Un testo segue uno stile di
testo, anche quando è l'etichetta di una forma o di un connettore; una forma,
un tracciato, una linea, un connettore, un tratto a penna, un'immagine o un
gruppo seguono uno stile grafico, e ognuna delle loro parti ne prende ciò che
ha: una linea non riceve un riempimento, un'immagine soltanto l'opacità, la
fusione e gli effetti. Scegliendo un gruppo, lo stile grafico lo segue il
gruppo, e lo stile di testo i testi che ha dentro.

## Appunti e duplica

- **Duplicare** un oggetto fa seguire lo stesso stile alla copia.
- **Copiare** porta negli appunti gli stili che gli oggetti seguono, con le
  loro sfumature; gli altri restano fuori ([Disegni,
  appunti](drawing-clipboard.md)).
- **Incollare** nello stesso disegno lascia chi entra con lo stesso stile. In
  un altro disegno vale lo stile con lo stesso nome, con le maiuscole a parte,
  lo stesso tipo e lo stesso aspetto; altrimenti lo stile arriva, e se il suo
  nome è già preso nel suo tipo prende il primo libero, «Riquadro 2». Chi
  segue uno stile che non entra e che il disegno non ha smette di seguirlo, e
  tiene il suo aspetto.
- **«Incolla lo stile»** dà l'aspetto, non lo stile: chi lo riceve continua a
  seguire quello che seguiva, con le sue differenze.

Gli oggetti nuovi non seguono niente.

## Esportare e altri programmi

Uno stile non si disegna. L'SVG pulito lo toglie, con le sue sfumature e
`fub:style`, e il PNG, il JPEG e il PDF disegnano gli oggetti dai loro
attributi ([Disegni, esportare](drawing-export.md)). Un programma che non
conosce gli stili vede lo stesso disegno, e li conserva.
