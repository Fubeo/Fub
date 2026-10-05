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
| Evidenziatore | Standard | lo strumento (`H`) |
| Testo | Standard | lo strumento (`T`), e cambiare un testo che c'è: due tocchi, `F2`, «Modifica il testo» |
| Colori personalizzati | Standard | «Altro colore…» e il campione in più |
| Duplica, raggruppa, ordina, allinea e distribuisci | Standard | questi comandi della barra «Disponi», coi loro tasti |
| Livelli | Standard | il pulsante «Livelli» e «Sposta in un livello»; scegliere oggetti rende corrente il loro livello |
| Pagina e griglia | Standard | il pulsante «Pagina e griglia», `#` e `%` |
| Collegamenti alle note | Standard | «Collega a una nota…» (`Ctrl+K`) e «Togli il collegamento» (`Ctrl+Maiusc+K`) |
| Immagini dal vault | Standard | «Immagine dal vault…» (`Ctrl+I`) |
| Nodi, Bézier | Esperto | lo strumento (`N`, `B`) |
| Attributi | Esperto | «Attributi» (`Ctrl+Maiusc+X`) |
| Contorno: tratteggio, estremi e angoli | Esperto | «Contorno» |
| Trasforma: rotazione, scala e inclinazione | Esperto | «Trasforma…» (`Ctrl+Maiusc+M`) |
| Applica trasformazione | Esperto | «Applica trasformazione» |
| Oggetto in tracciato | Esperto | «Oggetto in tracciato» |
| Operazioni booleane | Esperto | «Operazioni booleane» |

Senza «Livelli» il disegno va nel livello più alto che si vede e non è
bloccato, come all'Essenziale. La barra «Disponi» compare quando, per la
selezione, ha almeno un comando delle parti scelte. Ci sono a ogni livello,
anche senza nessuna parte: la Selezione, le immagini incollate, l'albero degli
oggetti, aprire un collegamento con `Alt+Invio` o col suo segno, e «Apri come
sorgente».

## Quando una parte se ne va

Togliere una parte mentre la si usa fa ciò che fa tornare a un livello più
basso: chi aveva in mano il suo strumento riprende la penna, o il primo
strumento che c'è, o la Selezione; un tracciato di Bézier a metà si conclude
com'è; un colore a piacere torna al colore di partenza. Il disegno non cambia.

`?` elenca i tasti delle parti scelte, e **Mostra tutto** aggiunge in fondo
quelli delle parti che mancano, ciascuno col livello da cui viene e con una
frase che dice dove si aggiungono.

Un nome dell'elenco che l'editor non conosce, scritto da una versione più
nuova, resta dov'è e non conta: la versione che lo conosce lo ritrova.
