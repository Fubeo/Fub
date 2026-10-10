# Disegni, livello Personalizzato

> **Per chi:** chi vuole nella barra del disegno proprio le parti che usa.
> **Risultato:** sapere come si sceglie il livello Personalizzato, quali parti
> ha e che cosa porta ciascuna.

Il Personalizzato è il quarto livello d'interfaccia dell'editor dei
[disegni](drawing.md). L'Essenziale, lo Standard e l'Esperto sono gradini,
ognuno con tutto ciò che hanno quelli sotto; il Personalizzato ha soltanto le
parti che si scelgono, una per una, da tutti e tre. Una classe può avere la
penna, il testo e i livelli senza la gomma; chi disegna schemi, le forme, la
griglia e i collegamenti senza l'evidenziatore. Come gli altri filtra soltanto
ciò che si offre: un disegno si apre uguale a ogni livello, e cambiare le
parti non lo modifica.

## Sceglierlo

Nelle Impostazioni, nel gruppo «Disegni», «Livello d'interfaccia» ha anche
Personalizzato, e la riga «Parti del Personalizzato» ha una casella per
parte, nei gruppi dei livelli da cui vengono e nel loro ordine. Le parti sono
un'altra impostazione del vault, `draw.custom`: un elenco di nomi che vale per
chiunque apra il vault e che, come il livello, un plugin o una macro non
cambiano. Valgono soltanto col Personalizzato, e si possono preparare con un
altro livello scelto. Di partenza sono quelle dell'Essenziale, e «Azzera» le
riporta lì.

Ogni casella scrive subito, e i disegni aperti cambiano dal vivo, senza
riaprirli e senza perdere la selezione o la cronologia. Si possono togliere
tutte: resta la Selezione, che c'è a ogni livello, e ciò che è nel disegno si
sceglie, si sposta e si elimina. Dall'editor le parti non si cambiano, come il
livello.

## Che cosa porta una parte

Una parte porta i suoi pulsanti e i suoi tasti, e senza di lei non ci sono.
Ciascuna fa ciò che dice la sezione del suo livello, in [Disegni](drawing.md) o
in [Disegni, livello Esperto](drawing-expert.md).

| Parte | Livello | Che cosa porta |
| --- | --- | --- |
| Penna, Gomma, Rettangolo, Ellisse, Linea, Freccia | Essenziale | lo strumento, col suo tasto |
| Lazo | Standard | lo strumento (`Q`) |
| Tavola | Standard | lo strumento (`F`); il pulsante «Tavole» col suo elenco; `Alt+PagSu` e `Alt+PagGiù`; nel pannello delle proprietà la sezione «Tavola» ([Disegni, tavole](drawing-boards.md)) |
| Contagocce | Standard | lo strumento (`I`); `I` e `Maiusc+I` sulla riga attiva dell'albero degli oggetti ([Disegni, colori](drawing-colors.md#il-contagocce)) |
| Sfumatura | Standard | lo strumento (`G`); nel pannello delle proprietà la sezione «Sfumatura», con «Oltre i capi» ([Disegni, sfumature](drawing-gradients.md)) |
| Evidenziatore | Standard | lo strumento (`H`) |
| Poligono | Standard | lo strumento (`Y`), per poligoni e stelle; la sezione «Forma» delle proprietà e la maniglia degli angoli arrotondati |
| Connettore | Standard | lo strumento (`X`); nel pannello delle proprietà la sezione «Connettore»; «Collega le forme scelte» nella barra «Disponi», nel menu «Selezione avanzata» e col tasto destro ([Disegni, connettori](drawing-connectors.md)) |
| Testo | Standard | lo strumento (`T`), e cambiare un testo che c'è: due tocchi, `F2`, «Modifica il testo»; gli stessi gesti scrivono l'etichetta di una forma chiusa ([Disegni, etichette nelle forme](drawing-labels.md)) |
| Colori personalizzati | Standard | «Altro colore…» e l'anello del colore scelto |
| Colori del documento | Standard | nel pannello delle proprietà la sezione «Colori del documento», coi campioni, i colori usati e i recenti; disegnare con un campione ([Disegni, colori](drawing-colors.md)) |
| Stili del documento | Standard | nel pannello delle proprietà «Stile grafico» in «Aspetto» e «Stile di testo» in «Testo», col loro menu ([Disegni, stili](drawing-styles.md)) |
| Punte delle linee | Standard | nel pannello delle proprietà «Punta d’inizio» e «Punta di fine», in «Aspetto» ([Disegni, punte delle linee](drawing-tips.md)) |
| Campiture | Standard | nel pannello delle proprietà la sezione «Campitura» ([Disegni, campiture e motivi](drawing-patterns.md)) |
| Seleziona simili, isola i gruppi, blocca e nascondi | Standard | il menu «Selezione avanzata», anche col tasto destro e `Maiusc+F10`; il clic con `Ctrl` dentro i gruppi e i gruppi nell'albero; isolare un gruppo; bloccare e nascondere gli oggetti, coi segni dell'albero |
| Duplica, raggruppa, ordina, allinea e distribuisci | Standard | questi comandi della barra «Disponi», coi loro tasti, e il suo campo «Opacità» |
| Livelli | Standard | il pulsante «Livelli» e «Sposta in un livello»; scegliere oggetti rende corrente il loro livello; nell'albero i nomi, il filtro, le miniature e le righe da trascinare |
| Pagina e griglia | Standard | il pulsante «Pagina e griglia», `#` e `%` |
| Guide intelligenti | Standard | l'aggancio agli altri oggetti e alla pagina, la loro casella in «Pagina e griglia», e le misure con `Alt` |
| Righelli e guide | Standard | i righelli (`Maiusc+R`), le guide del documento (`\|`), «Guide…» e l'unità del documento |
| Forme dal tratto | Standard | il tratto a penna tenuto fermo che diventa una forma, la sua casella in «Pagina e griglia», e «Rendi forma» nella barra «Disponi» |
| Simmetria della penna | Standard | nel pannello delle proprietà, con la penna o l'evidenziatore e niente di scelto, la sezione «Simmetria»: gli assi, la radiale, il centro che si tira, le guide ([Disegni, ripetizioni e simmetria](drawing-repeats.md#la-penna-in-simmetria)); senza, ogni tratto è uno solo |
| Vista ruotata, gesti e menu radiale | Standard | girare la vista (`4`, `6`, `5`, `Ctrl+Maiusc` con la rotella, due dita) e il pulsante dell'angolo; i tocchi di due e tre dita; il menu radiale (clic destro, tasto della penna, `Maiusc+F10`); «Penna e dita…» in «Pagina e griglia» |
| Cronologia | Standard | il pulsante «Cronologia» e il suo pannello: i passi, i salti e i segni |
| Verifica dell'accessibilità | Standard | il pulsante «Accessibilità» e il suo pannello: i problemi con le correzioni e l'ordine di lettura; la descrizione chiesta a ogni immagine che entra |
| Collegamenti alle note | Standard | «Collega a una nota…» (`Ctrl+K`) e «Togli il collegamento» (`Ctrl+Maiusc+K`) |
| Immagini dal vault | Standard | «Immagine dal vault…» (`Ctrl+I`) |
| Ritaglia immagine | Standard | «Ritaglia…», con un'immagine scelta da sola, anche con due tocchi, e «Togli il ritaglio» ([Disegni, ritagli e maschere](drawing-masks.md)) |
| Forme | Standard | il pulsante «Forme» e il suo pannello: le raccolte di forme, la ricerca, e inserire con un clic, con `Invio` o `Spazio`, o trascinando ([Disegni, raccolte di forme](drawing-library.md)) |
| Copia e incolla lo stile | Standard | «Copia lo stile» (`Ctrl+Alt+C`) e «Incolla lo stile» (`Ctrl+Alt+V`) |
| Pannello delle proprietà | Standard | «Proprietà», il pannello accanto al foglio; senza, `Invio` apre le finestre «Posizione e misure» e «Proprietà del disegno» |
| Finestra «Esporta» | Standard | «Esporta…» apre la finestra con il disegno, la selezione o le tavole, i quattro formati, la misura e l'anteprima; senza, chiede soltanto PNG o PDF ([Disegni, esportare](drawing-export.md)) |
| Nodi, Costruttore di forme, Forbici, Spessore, Bézier | Esperto | lo strumento (`N`, `M`, `C`, `W`, `B`); lo Spessore anche i profili in «Contorno» |
| Attributi | Esperto | la loro sezione nelle proprietà, o senza il pannello «Attributi» (`Ctrl+Maiusc+X`) |
| Contorno: tratteggio, estremi e angoli | Esperto | «Contorno» |
| Trasforma: rotazione, scala e inclinazione | Esperto | «Trasforma…» (`Ctrl+Maiusc+M`) e la sua sezione nelle proprietà |
| Applica trasformazione | Esperto | «Applica trasformazione» |
| Tracciato: oggetti, contorni e inchiostro in tracciato, scostamento, semplifica, unisci | Esperto | il menu «Tracciato»: «Oggetto in tracciato», «Contorno in tracciato», «Inchiostro in tracciato», «Scostamento…», «Semplifica…» e «Unisci» (`Ctrl+J`) |
| Operazioni booleane | Esperto | «Operazioni booleane» |
| Ricalca immagine | Esperto | «Ricalca immagine…», con un'immagine scelta da sola |
| Maschere di ritaglio e d’opacità | Esperto | il menu «Maschera»: «Crea maschera di ritaglio» (`Ctrl+7`), «Crea maschera d’opacità» e «Rilascia maschera» (`Ctrl+Alt+7`) |
| Testo in area e su tracciato | Esperto | col Testo, trascinare per il riquadro di un testo in area; il menu «Testo su tracciato»; nelle proprietà «Tipo di testo» e «Larghezza del riquadro»; le maniglie della cornice di un testo in area ne cambiano la larghezza |
| Caratteri del vault | Esperto | le famiglie dei file di caratteri del vault nel menu «Carattere» delle proprietà e fra le scelte di `font-family` negli attributi ([Disegni, caratteri del vault](drawing-fonts.md)); un disegno che le usa le mostra comunque |
| Ombre, bagliori e sfocatura | Esperto | nelle proprietà la sezione «Effetti» ([Disegni, effetti e fusione](drawing-effects.md)) |
| Metodi di fusione | Esperto | nelle proprietà «Fusione» e «Isola la fusione», in «Aspetto» |
| Motivi del documento | Esperto | «Motivo dalla selezione», nella barra «Disponi», in «Selezione avanzata» e col tasto destro; nella sezione «Campitura» i motivi del documento, il loro nome ed «Elimina motivo» |
| Pagina di stampa del PDF | Esperto | nella finestra «Esporta», per il PDF, il gruppo «Pagina»: la carta, i margini, l'abbondanza e i segni ([Disegni, esportare](drawing-export.md#per-la-stampa)); senza, il PDF è grande quanto il disegno |
| Simboli | Esperto | «Crea simbolo» e «Scollega dal simbolo», nella barra «Disponi», in «Selezione avanzata» e col tasto destro; nelle proprietà la riga «Simbolo»; il pulsante «Simboli» e il suo pannello, coi simboli del disegno e le librerie del vault ([Disegni, simboli](drawing-symbols.md)); senza, le istanze si vedono e si scelgono come ogni oggetto, e il loro simbolo si modifica dove si isola un gruppo |
| Ripetizioni | Esperto | il menu «Ripeti», nella barra «Disponi», in «Selezione avanzata» e col tasto destro, con «Espandi la ripetizione»; nelle proprietà la sezione «Ripetizione» ([Disegni, ripetizioni e simmetria](drawing-repeats.md)); senza, le ripetizioni si vedono e si scelgono come ogni oggetto, si aprono dove si isola un gruppo e si separano come un gruppo |

Senza «Livelli» il disegno va nel livello più alto che si vede e non è
bloccato, come all'Essenziale. La barra «Disponi» compare quando, per la
selezione, ha almeno un comando delle parti scelte, e sta accanto alla
selezione; senza il pannello delle proprietà, la casella che la riporta in
cima al foglio è in «Pagina e griglia». Ci sono a ogni livello,
anche senza nessuna parte: la Selezione, copia, taglia e incolla, le immagini
incollate, l'albero degli oggetti, aprire un collegamento con `Alt+Invio` o
col suo segno, e «Apri come sorgente».

## Quando una parte se ne va

Togliere una parte mentre la si usa fa ciò che fa tornare a un livello più
basso: chi aveva in mano il suo strumento riprende la penna, o il primo
strumento che c'è, o la Selezione; chi sceglieva, col Lazo, coi Nodi, col
Costruttore di forme o con la Tavola, e chi aveva il Contagocce o la
Sfumatura, riprende la Selezione; un tracciato di Bézier a metà si conclude
com'è; un colore a piacere torna al colore di partenza, e uno che seguiva un
campione resta da solo; da un gruppo isolato si esce; la vista girata si
raddrizza; l'elenco delle tavole si chiude; il pannello delle forme si chiude;
la cronologia si chiude, e la si ritrova riaprendola. Il disegno non cambia.

`?` elenca i tasti delle parti scelte, e **Mostra tutto** aggiunge in fondo
quelli delle parti che mancano, ciascuno col livello da cui viene e con una
frase che dice dove si aggiungono.

Un nome dell'elenco che l'editor non conosce, scritto da una versione più
nuova, resta dov'è e non conta: la versione che lo conosce lo ritrova.
