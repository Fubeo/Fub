# I diagrammi

> **Per chi:** chi scrive diagrammi Mermaid nelle note e chi lavora sul loro
> editor.
> **Risultato:** sapere come si vede un diagramma, che cosa offre il suo menu
> e che cosa scrive nel file.

La resa (sicurezza, limiti, stili, modelli) è in
[Editor e anteprima](editor-and-preview.md); qui ci sono i gesti.

## Come si vede

A riposo e al passaggio del puntatore c'è soltanto il disegno: niente barra,
pulsanti o bordo. Con **Armonia** il diagramma sta sulla pagina, senza fondo.
Gli stili con una carta loro (Acquerello, Aurora, Blueprint, Inchiostro) stanno
su una tavola dagli angoli morbidi, larga quanto la colonna, con la vignetta,
l'alone o la griglia dello stile. Il sorgente si vede sotto il disegno soltanto
quando il disegno manca: un errore di sintassi, un diagramma troppo grande.
Un clic sul disegno lo apre a schermo intero.

Il disegno non supera mai la sua misura naturale e, nella colonna stretta, non
scende sotto il 72%: oltre, la tavola scorre di lato. Finché scorre la tavola
entra nel giro del Tab, col suo anello del fuoco, e le frecce la fanno
scorrere; quando il disegno ci sta ne esce.

## La didascalia

Sotto il disegno, piccola e centrata, nei caratteri della nota, c'è la
didascalia: è il `title` del frontmatter Mermaid, che Mermaid non disegna più
dentro l'immagine. Si scrive lì: un clic, il testo, poi Invio o un clic fuori la
scrivono nel sorgente (una modifica, un passo d'annulla); Esc la rimette com'era.
Il titolo si aggiunge, si riscrive o si toglie nel frontmatter del recinto; un
frontmatter che resta vuoto se ne va; caratteri che YAML leggerebbe in un altro
modo (`:`, `#`, virgolette) vanno fra virgolette. Vuota non occupa spazio; col
sorgente aperto mostra il suo invito. Dalla tastiera il titolo si scrive nel
sorgente, nella riga `title:`: la didascalia non sta nel percorso di Tab, che
nell'editor è della nota.

## Il sorgente accanto

Col cursore nel recinto il sorgente resta nelle righe della nota, nella metà
sinistra, e il disegno sta accanto, nella destra, 14 px fra i due; sotto i 940
px di foglio uno sta sopra l'altro. Sul foglio largo il blocco si allarga come
le schede. Il disegno si rifà dopo 300 ms senza battute (mai a ogni tasto) ed
entra in 200 ms; se la sua altezza cambia, i blocchi sotto scivolano al loro
posto. **Fatto**, nella testata del recinto, o **Esc** chiudono il sorgente:
con i Blocchi accesi resta scelto il blocco del diagramma, senza il cursore va
sotto il recinto.

Quando il sorgente non si disegna, il disegno buono di prima resta, attenuato,
e una riga sotto il sorgente dice dove, in parole semplici: «Riga 12: questa
riga non è un nodo né un collegamento». La riga conta il recinto come è
scritto, frontmatter e commenti compresi; un errore senza riga dice soltanto
che cosa fare. Mai il messaggio grezzo di Mermaid.

## Il menu del tasto destro

Il tasto destro sul disegno apre il menu del diagramma al posto di quello della
nota (Maiusc + tasto destro lascia quello del sistema). È largo 316 px e ha, in
quest'ordine:

1. la testata: «Diagramma» e il `title` del frontmatter Mermaid, se c'è;
2. **Stile**: cinque miniature, ognuna nei colori del suo stile. Passarci
   sopra, o arrivarci con le frecce, mostra lo stile sul diagramma; uscire
   dalle miniature, o chiudere il menu senza scegliere, rimette quello di
   prima. Un clic lo sceglie e chiude il menu;
3. **Vale per**: «Questo» scrive `%% stile: <nome>` in cima al recinto, dopo
   l'eventuale frontmatter, o riscrive quello che c'è; «Tutti» cambia la
   preferenza `appearance.diagram-style` e toglie il commento da questo
   diagramma. Il menu parte da «Questo» se il diagramma ha già uno stile suo;
4. **Orientamento**, soltanto nei diagrammi di flusso: «Dall'alto» e «Da
   sinistra» riscrivono la sola parola della direzione (`TD`, `LR`) della
   riga `flowchart` o `graph`; `TB` vale come «Dall'alto»;
5. le azioni: **Modifica il sorgente** (porta il cursore nel recinto),
   **Ingrandisci** (a tutta finestra sul fondo dello stile: la rotella
   ingrandisce, si trascina per spostare, Esc o Spazio chiudono), **Copia come immagine** ed
   **Esporta…** (SVG copiato o salvato, PNG a risoluzione doppia).

Un nome sconosciuto in `%% stile:` non rompe niente: vale lo stile generale, e
il menu lo dice sotto le miniature. In sola lettura, e dove il sorgente non si
può riscrivere, «Questo» e l'orientamento non si scelgono; se il sorgente
chiede uno stile, il menu lo dice.

Dalla tastiera: Tab passa dalle miniature a «Vale per», a «Orientamento» e alle
azioni; ← → si muovono fra le miniature e fra le scelte, ↑ ↓ fra le azioni;
Invio o Spazio scelgono, Esc chiude.

## Il diagramma scelto come blocco

Con i Blocchi accesi, quando la selezione è il solo blocco del diagramma:

- **Invio** apre il sorgente, col cursore all'inizio del corpo (finché si
  scelgono blocchi il diagramma si vede disegnato, non nel suo sorgente);
- **Spazio** lo ingrandisce (e non scrive mai al posto del recinto);
- **Ctrl C** lo copia come immagine;
- il tasto **Menu** o **Maiusc F10** apre il suo menu.

## Copia come immagine

Negli appunti vanno insieme tre forme: l'immagine PNG, l'SVG (dove il sistema
lo accetta) e il sorgente come testo, nel suo recinto ```` ```mermaid ````;
il titolo sta nel sorgente, non nell'immagine.
Incollato in una chat arriva l'immagine; in una nota torna un diagramma. Dove
gli appunti non prendono immagini si copia soltanto il sorgente, e un avviso
lo dice.

## Il movimento

Cambiare stile sfuma i colori in 220 ms, dal disegno di prima al nuovo; la
tavola cambia carta nello stesso tempo. Col movimento ridotto il cambio è
immediato.

## I collegamenti

Il tracciato è lo stesso in tutti e cinque gli stili, nelle due luci; lo stile
ne cambia soltanto il colore.

- **Il tratto** è spesso 1,4 px (2 px con l'alto contrasto), con i capi e i
  gomiti tondi. Il tratteggio (`-.->`, e le risposte delle sequenze) va a
  passi di 4.
- **I gomiti** sono arrotondati: Mermaid traccia tratti dritti fra i punti che
  sceglie dagre e ne smussa gli angoli (curva `rounded`, raggio 5 px).
- **La punta** è sottile, con l'incavo, e si ferma a un soffio dal nodo
  (1,8 px dal bordo): è la punta del prototipo, messa al posto di quella piena
  di Mermaid nei flussi (all'inizio e alla fine) e nelle sequenze. Le punte
  che dicono qualcosa con la forma (classi, entità, stati, croci, cerchi)
  restano quelle di Mermaid.
- **Le etichette** sono nel colore attenuato dello stile, su un ritaglio pieno
  della carta con gli angoli di 5 px, che copre il tratto sotto la parola.
- **Le distanze** sono quelle del prototipo per un flusso dall'alto: 58 px fra
  un livello e l'altro, 34 fra due nodi vicini. Valgono anche per un flusso da
  sinistra, perché la configurazione di Mermaid non conosce l'orientamento.

Ciò che Mermaid 11 non permette, e che quindi il disegno non fa:

- un collegamento non è fatto solo di tratti verticali e orizzontali: dagre
  sceglie punti anche in diagonale, e il tratto li segue. Arriva al nodo
  dritto quando l'ultimo punto sta sopra il nodo (o, da sinistra, alla sua
  altezza), altrimenti di sbieco; da un rombo parte da un lato obliquo;
- l'etichetta sta nel punto che dagre le riserva, a metà fra due livelli,
  spesso su un gomito, non sul tratto più lungo;
- un ritorno (`D --> B`) torna indietro di fianco, ma rientra nel nodo di
  sbieco, non con un tratto dritto;
- il raggio dei gomiti è quello di Mermaid (5 px), non i 9 del prototipo, e
  le etichette hanno la grandezza del testo dei nodi: rimpicciolirle col CSS
  lascerebbe il ritaglio misurato sul testo grande.

Un tracciato solo ortogonale chiederebbe il motore di disposizione ELK
(`@mermaid-js/layout-elk`), che non è fra le dipendenze di Fub.

Le variabili e il CSS del tracciato sono in
`apps/client/src/ui/mermaid-drawing.ts` (`mermaidStyleConfig`, `themeCssFor`,
le punte in `decorateSvg`); lo spessore in
`apps/client/src/ui/mermaid-styles.ts` (`EDGE_STROKE`). Le scene del banco
`diagramma-07-tracciato-*` mostrano il flusso del prototipo in ogni stile,
dall'alto e da sinistra; `diagramma-08-tracciato-casi` un'etichetta lunga, un
tratteggio, un collegamento senza punta e una sequenza.

## Dove sta

- il disegno, la didascalia, la riga dell'errore, il menu come dati e le
  modifiche al sorgente: `apps/client/src/ui/mermaid.ts`;
- il menu: `apps/client/src/ui/diagram-menu.ts`;
- il commento `%% stile:` e il frontmatter:
  `apps/client/src/theme/diagram-style.ts`;
- il diagramma mentre lo si scrive (il disegno accanto, Esc) e i tasti del
  blocco: `apps/client/src/editors/text/profiles/markdown/diagram-live.ts`;
  «Fatto» nella testata: `code-block.ts`, accanto;
- la pelle: `apps/client/src/theme/scrittoio/skin/diagrams.css`.
