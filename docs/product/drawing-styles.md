# Disegni, stili

> **Per chi:** chi vuole che i titoli, le note o i riquadri di un disegno si
> somiglino, e li cambia tutti insieme.
> **Risultato:** sapere che cos'è uno stile di testo e uno grafico, come si
> usa la riga «Stile» del pannello delle proprietà, che cosa fanno i comandi
> del suo menu e che cosa succede agli stili negli appunti.

Dal livello Standard un disegno ha i suoi **stili**: aspetti con un nome,
che gli oggetti seguono. Uno **stile di testo** dice il carattere e il colore
di un testo, «Titolo del capitolo»; uno **stile grafico** dice l'aspetto di
una forma, «Riquadro di avviso». Cambiare uno stile cambia in un passo gli
oggetti che lo seguono, e un oggetto può avere le sue differenze. Gli stili
stanno nel [pannello delle proprietà](drawing-properties.md), in una riga
«Stile» in testa ad «Aspetto» e in testa a «Testo». Le operazioni sono in
`apps/client/src/editors/spatial/tools/styles.ts`, le righe in `fields.ts` e
`properties.ts`.

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

## La riga «Stile»

«Stile grafico» sta in testa ad «Aspetto», «Stile di testo» in testa a
«Testo», quando la selezione ne può seguire uno. La riga è un pulsante col
suo menu, come quelli delle punte, e mostra un'anteprima e il nome:

- **lo stile** che gli oggetti scelti seguono tutti, «Riquadro»;
- **«Riquadro, modificato»** se qualcuno ne ha una differenza;
- **«Misto»** se seguono stili diversi, o non tutti lo stesso;
- **«Nessuno»** se nessuno ne segue uno.

**Le differenze.** Un campo in cui un oggetto scelto è diverso dallo stile ha
un punto accanto al nome, e chi usa un lettore di schermo sente «Diverso
dallo stile «Riquadro»» col campo. Sotto la riga «Stile» una nota li nomina,
«Diverso dallo stile: spessore e tratteggio.». Il file non segna le
differenze: si trovano confrontando l'aspetto dell'oggetto con quello dello
stile, campo per campo, così che un tratteggio del menu che resta lo stesso
su un altro spessore non è una differenza, ma lo spessore sì.

## Il menu

In cima, gli stili del documento di quel tipo, nell'ordine del file. Ognuno ha
un'anteprima al posto dell'icona, «Aa» nel suo carattere e nel suo colore o
un quadratino col suo riempimento e il suo contorno, e dice quanti oggetti lo
seguono, «Lo seguono 3 oggetti». Quello della selezione è segnato. Nel menu
dello stile di testo seguono gli **stili di serie**, Titolo, Sottotitolo,
Titoletto, Testo e Didascalia ([Disegni, tipografia](drawing-typography.md#il-pannello)),
quelli che il documento non ha già con lo stesso nome: sceglierne uno lo
aggiunge al documento col suo corpo e il suo peso, e il resto dal testo
scelto, e lo dà alla selezione.

Poi i comandi, ognuno un passo di annulla col suo nome:

- **«Nuovo stile dalla selezione…»** chiede il nome e fa lo stile
  dall'aspetto del primo oggetto scelto, intero, anche nei campi che
  l'oggetto non scrive; tutti gli oggetti scelti lo seguono e ne prendono
  l'aspetto. Una sfumatura dell'oggetto diventa una copia dello stile.
  «Nuovo stile».
- **«Aggiorna lo stile dalla selezione»** ridefinisce lo stile dall'aspetto
  del primo oggetto scelto. Chi lo segue prende soltanto i campi cambiati, e
  soltanto se aveva il valore di prima: le differenze degli altri restano.
  «Stile aggiornato».
- **«Torna allo stile»** ridà lo stile intero agli oggetti scelti e toglie le
  loro differenze. «Ritorno allo stile».
- **«Scollega dallo stile»** fa smettere di seguirlo agli oggetti scelti, che
  tengono il loro aspetto. «Scollegamento dallo stile».
- **«Rinomina lo stile…»** gli dà un altro nome. «Nome di uno stile».
- **«Elimina lo stile»** lo toglie dal documento, con le sue sfumature; chi
  lo seguiva tiene il suo aspetto. «Stile eliminato».

Scegliere uno stile lo dà agli oggetti scelti, intero: «Stile applicato».
Le differenze se ne vanno, ma le parole di un testo che hanno il loro peso o
il loro colore, una parola in grassetto, li tengono.

Aggiornare, tornare, rinominare ed eliminare lavorano sullo stile che gli
oggetti scelti seguono tutti. Un comando che adesso non serve resta nel menu,
sbiadito, e dice perché: «La selezione segue stili diversi.», «La selezione
non segue uno stile.», «Lo stile è già come la selezione.», «La selezione è
già come lo stile.». Per rinominare o eliminare uno stile che nessuno segue,
lo si dà prima a un oggetto.

**A parole.** Ogni comando dice che cosa ha fatto: «Stile «Riquadro»
applicato a 3 oggetti.», «Stile «Riquadro» aggiornato: lo seguono 4 oggetti.
1 ha delle differenze, che restano.», «Stile «Riquadro» eliminato: 2 oggetti
che lo seguivano tengono il loro aspetto.».

## Il nome

«Nuovo stile dalla selezione…» e «Rinomina lo stile…» aprono un modulo sotto
la riga, come quello dei campioni: il nome proposto è «Stile grafico 1» o
«Stile di testo 1», col primo numero libero, o quello di adesso. `Invio`
conferma, `Esc` chiude e torna al pulsante. Un nome vuoto, già preso o che si
legge come un colore si dice accanto al campo, e il modulo resta.

I nomi si scrivono puliti, come quelli dei campioni: gli spazi raccolti, al
più 200 caratteri, e mai un colore. Due stili dello stesso tipo non hanno lo
stesso nome, con le maiuscole a parte; uno stile di testo e uno grafico
possono chiamarsi uguali.

## Chi non si cambia

Un oggetto bloccato, o in un gruppo o in un livello bloccato, resta com'è
quando si applica, si aggiorna, si torna o si scollega, e l'annuncio dice
quanti sono. Eliminare uno stile toglie il legame anche a un oggetto
bloccato, perché il suo aspetto non cambia; ma se chi lo segue sta in un
gruppo o in un livello bloccato, lo stile non si elimina finché non lo si
sblocca. Un blocco estraneo non segue stili.

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

Gli oggetti nuovi non seguono niente: lo stile si sceglie dopo.

## Esportare e altri programmi

Uno stile non si disegna. L'SVG pulito lo toglie, con le sue sfumature e
`fub:style`, e il PNG, il JPEG e il PDF disegnano gli oggetti dai loro
attributi ([Disegni, esportare](drawing-export.md)). Un programma che non
conosce gli stili vede lo stesso disegno, e li conserva.

## Livelli e parti

Gli stili sono la parte «Stili del documento» del
[Personalizzato](drawing-custom.md), dallo Standard; stanno nel pannello
delle proprietà, e si vedono con lui. Con loro lo stile di serie del testo
sta nel menu dello stile di testo; senza, all'Essenziale o nel
Personalizzato, torna il menu «Stile» che cambia soltanto il corpo e il
peso, e gli stili restano nel disegno: chi li segue si vede col suo aspetto.
In un documento in sola lettura la riga mostra lo stile, ma il pulsante non
cambia niente.
