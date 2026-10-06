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
| Evidenziatore | Standard | lo strumento (`H`) |
| Poligono | Standard | lo strumento (`Y`), per poligoni e stelle; la sezione «Forma» delle proprietà e la maniglia degli angoli arrotondati |
| Testo | Standard | lo strumento (`T`), e cambiare un testo che c'è: due tocchi, `F2`, «Modifica il testo» |
| Colori personalizzati | Standard | «Altro colore…» e il campione in più |
| Seleziona simili, isola i gruppi, blocca e nascondi | Standard | il menu «Selezione avanzata», anche col tasto destro e `Maiusc+F10`; il clic con `Ctrl` dentro i gruppi e i gruppi nell'albero; isolare un gruppo; bloccare e nascondere gli oggetti, coi segni dell'albero |
| Duplica, raggruppa, ordina, allinea e distribuisci | Standard | questi comandi della barra «Disponi», coi loro tasti |
| Livelli | Standard | il pulsante «Livelli» e «Sposta in un livello»; scegliere oggetti rende corrente il loro livello; nell'albero i nomi, il filtro, le miniature e le righe da trascinare |
| Pagina e griglia | Standard | il pulsante «Pagina e griglia», `#` e `%` |
| Guide intelligenti | Standard | l'aggancio agli altri oggetti e alla pagina, la loro casella in «Pagina e griglia», e le misure con `Alt` |
| Righelli e guide | Standard | i righelli (`Maiusc+R`), le guide del documento (`\|`), «Guide…» e l'unità del documento |
| Forme dal tratto | Standard | il tratto a penna tenuto fermo che diventa una forma, la sua casella in «Pagina e griglia», e «Rendi forma» nella barra «Disponi» |
| Vista ruotata, gesti e menu radiale | Standard | girare la vista (`4`, `6`, `5`, `Ctrl+Maiusc` con la rotella, due dita) e il pulsante dell'angolo; i tocchi di due e tre dita; il menu radiale (clic destro, tasto della penna, `Maiusc+F10`); «Penna e dita…» in «Pagina e griglia» |
| Cronologia | Standard | il pulsante «Cronologia» e il suo pannello: i passi, i salti e i segni |
| Verifica dell'accessibilità | Standard | il pulsante «Accessibilità» e il suo pannello: i problemi con le correzioni e l'ordine di lettura; la descrizione chiesta a ogni immagine che entra |
| Collegamenti alle note | Standard | «Collega a una nota…» (`Ctrl+K`) e «Togli il collegamento» (`Ctrl+Maiusc+K`) |
| Immagini dal vault | Standard | «Immagine dal vault…» (`Ctrl+I`) |
| Copia e incolla lo stile | Standard | «Copia lo stile» (`Ctrl+Alt+C`) e «Incolla lo stile» (`Ctrl+Alt+V`) |
| Pannello delle proprietà | Standard | «Proprietà», il pannello accanto al foglio; senza, `Invio` apre le finestre «Posizione e misure» e «Proprietà del disegno» |
| Nodi, Costruttore di forme, Bézier | Esperto | lo strumento (`N`, `M`, `B`) |
| Attributi | Esperto | la loro sezione nelle proprietà, o senza il pannello «Attributi» (`Ctrl+Maiusc+X`) |
| Contorno: tratteggio, estremi e angoli | Esperto | «Contorno» |
| Trasforma: rotazione, scala e inclinazione | Esperto | «Trasforma…» (`Ctrl+Maiusc+M`) e la sua sezione nelle proprietà |
| Applica trasformazione | Esperto | «Applica trasformazione» |
| Oggetto in tracciato | Esperto | «Oggetto in tracciato» |
| Operazioni booleane | Esperto | «Operazioni booleane» |

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
strumento che c'è, o la Selezione; chi sceglieva, col Lazo, coi Nodi o col
Costruttore di forme, riprende la Selezione; un tracciato di Bézier a metà si
conclude com'è; un colore a piacere torna al colore di partenza; da un gruppo
isolato si esce; la vista girata si raddrizza; la cronologia si chiude, e la
si ritrova riaprendola.
Il disegno non cambia.

`?` elenca i tasti delle parti scelte, e **Mostra tutto** aggiunge in fondo
quelli delle parti che mancano, ciascuno col livello da cui viene e con una
frase che dice dove si aggiungono.

Un nome dell'elenco che l'editor non conosce, scritto da una versione più
nuova, resta dov'è e non conta: la versione che lo conosce lo ritrova.
