# Disegni, spazio di lavoro e barra

> **Per chi:** chi vuole l'editor del disegno a misura di come disegna.
> **Risultato:** sapere che cosa offrono gli spazi Completo e Semplice, come
> si sceglie quali strumenti stanno nella colonna, e che cosa porta ogni parte.

L'editor dei [disegni](drawing.md) ha due spazi di lavoro. **Completo**, quello
di partenza, offre tutto: ogni strumento, ogni comando, ogni pannello; gli
strumenti rari stanno nelle tendine della colonna e tutto si trova con la
ricerca dei comandi (`Ctrl+/`). **Semplice** è per disegnare a mano o col dito:
nella colonna, con caselle grandi da 44 px, la Selezione, la Mano, lo Zoom, la
Penna, l'Evidenziatore, la Gomma, il Rettangolo, l'Ellisse, la Linea e la
Freccia; poi i colori, i gesti delle dita, le immagini, il
pannello delle proprietà, dove sta anche il titolo, ed «Esporta». In fondo alla colonna il pulsante **Completo** riporta tutto con un
clic. Nelle annotazioni di un PDF il Semplice ha gli strumenti di partenza
delle annotazioni. Lo spazio filtra soltanto ciò che si offre: un disegno si
apre uguale nei due, e cambiare spazio non lo modifica.

## Sceglierlo

Dal menu ≡ «Disegno», **Spazio di lavoro** ha Completo e Semplice. Si sceglie
anche nelle Impostazioni, nel gruppo «Disegni», con «Spazio di lavoro». È
un'impostazione del vault, `draw.workspace`, che vale per chiunque lo apra e
che un plugin o una macro non cambiano. Cambia dal vivo, anche nei disegni
aperti, senza riaprirli e senza perdere la selezione o la cronologia; chi
monta l'editor lo sceglie con `workspace` e `setWorkspace`
(`apps/client/src/editors/spatial/tools/editor.ts`).

In una finestra larga al più 700 px, o in un riquadro largo al più 480, la
colonna va sotto il foglio, in una riga che scorre di lato; col dito, a ogni
larghezza, le caselle sono da 44 px.

## Personalizza la barra

Dal menu ≡, **Personalizza la barra…** apre l'elenco degli strumenti offerti,
uno per riga, prima quelli della colonna nel loro ordine e poi gli altri. La
casella mette o toglie uno strumento; le frecce ↑ e ↓, o il trascinamento,
cambiano il posto. La Selezione non si toglie. La colonna cambia mentre si
sceglie; **Salva** la tiene, **Annulla** la rimette com'era, **Ripristina**
torna a quella di serie. Uno strumento tolto dalla colonna resta col suo tasto
e nella ricerca dei comandi.

La colonna è un'altra impostazione del vault, `draw.toolbar`: l'elenco degli
strumenti nel loro ordine, vuoto per quella di serie, e «Azzera» la riporta lì.
Nelle Impostazioni ha una casella per strumento; l'ordine si sceglie
nell'editor, e le Impostazioni lo conservano.

## Dalle versioni precedenti

Prima degli spazi l'editor aveva quattro livelli d'interfaccia, Essenziale,
Standard, Esperto e Personalizzato, in `draw.level`, e le parti del
Personalizzato in `draw.custom`. I livelli se ne sono andati (decisione 0231),
e con loro le due impostazioni: un vault che le ha le tiene nel suo file, ma
nessuno le legge né le scrive più. Senza `draw.workspace` scelto l'editor
parte da Completo, qualunque livello ci fosse prima.

## Che cosa porta una parte

Una parte porta i suoi pulsanti e i suoi tasti. Completo le ha tutte; il
Semplice ha gli stessi strumenti, i colori personalizzati, la vista ruotata
coi gesti, le immagini dal vault, il pannello delle proprietà e la finestra
«Esporta». Ciascuna fa ciò che dice la sua sezione in [Disegni](drawing.md).
Le parti dell'Esperto e quelle dello Standard che non sono rimaste se ne sono
andate (decisione 0231): Lazo, Tavola, Contagocce, Sfumatura, Poligono,
Connettore, Testo, i colori e gli stili del documento, le campiture, le guide
intelligenti, i righelli e le guide, la simmetria della penna, presentare, il
ritaglio e le raccolte di forme.

| Parte | Spazio | Che cosa porta |
| --- | --- | --- |
| Penna, Evidenziatore, Gomma, Rettangolo, Ellisse, Linea, Freccia | Semplice | lo strumento, col suo tasto (l'Evidenziatore con `Maiusc+P`) |
| Colori personalizzati | Semplice | «Altro colore…» e l'anello del colore scelto |
| Vista ruotata, gesti e menu radiale | Semplice | girare la vista (`4`, `6`, `5`, `Ctrl+Maiusc` con la rotella, due dita) e il pulsante dell'angolo; i tocchi di due e tre dita; il menu radiale (clic destro, tasto della penna, `Maiusc+F10`); «Penna e dita…» in «Pagina e griglia» |
| Immagini dal vault | Semplice | «Immagine dal vault…» (`Ctrl+I`) |
| Pannello delle proprietà | Semplice | «Proprietà», il pannello accanto al foglio |
| Finestra «Esporta» | Semplice | «Esporta…» apre la finestra con il disegno, la selezione o le tavole, i sei formati, la misura e l'anteprima ([Disegni, esportare](drawing-export.md)) |
| Punte delle linee | Completo | nel pannello delle proprietà «Punta d’inizio» e «Punta di fine», in «Aspetto» ([Disegni, punte delle linee](drawing-tips.md)) |
| Seleziona simili, isola i gruppi, blocca e nascondi | Completo | il menu «Selezione avanzata», anche col tasto destro e `Maiusc+F10`; il clic con `Ctrl` dentro i gruppi e i gruppi nell'albero; isolare un gruppo; bloccare e nascondere gli oggetti, coi segni dell'albero |
| Duplica, raggruppa, ordina, allinea e distribuisci | Completo | questi comandi della barra «Disponi», coi loro tasti, e il suo campo «Opacità» |
| Livelli | Completo | il pulsante «Livelli» e «Sposta in un livello»; scegliere oggetti rende corrente il loro livello; nell'albero i nomi, il filtro, le miniature e le righe da trascinare |
| Pagina e griglia | Completo | la griglia, `#` e `%`, nel pulsante «Pagina e griglia» |
| Forme dal tratto | Completo | il tratto a penna tenuto fermo che diventa una forma, la sua casella in «Pagina e griglia», e «Rendi forma» nella barra «Disponi» |
| Cronologia | Completo | il pulsante «Cronologia» e il suo pannello: i passi, i salti e i segni |
| Verifica dell'accessibilità | Completo | il pulsante «Accessibilità» e il suo pannello: i problemi con le correzioni e l'ordine di lettura; la descrizione chiesta a ogni immagine che entra |
| Collegamenti alle note | Completo | «Collega a una nota…» (`Ctrl+K`) e «Togli il collegamento» (`Ctrl+Maiusc+K`) |
| Copia e incolla lo stile | Completo | «Copia lo stile» (`Ctrl+Alt+C`) e «Incolla lo stile» (`Ctrl+Alt+V`) |

Senza «Livelli», nel Semplice, il disegno va nel livello più alto che si vede
e non è bloccato. La barra «Disponi» compare quando, per la selezione, ha
almeno un comando, e sta accanto alla selezione; la casella che la riporta in
cima al foglio è in «Pagina e griglia». Ci sono nei due spazi: la Selezione,
copia, taglia e incolla, le immagini incollate, l'albero degli oggetti, aprire
un collegamento con `Alt+Invio` o col suo segno, e «Apri come sorgente».

## Quando una parte se ne va

Passare al Semplice mentre si usa una parte che non ha la chiude: da un
gruppo isolato si esce, la cronologia e la verifica dell'accessibilità si
chiudono. Il disegno non cambia.

`?` elenca i tasti delle parti offerte, e nel Semplice **Mostra tutto**
aggiunge in fondo quelli di Completo, con una frase che dice dove si sceglie.

Uno strumento di `draw.toolbar` che l'editor non conosce, scritto da una
versione più nuova o tolto come il Testo, resta dov'è e non conta: la versione
che lo conosce lo ritrova.
