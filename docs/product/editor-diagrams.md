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
   **Ingrandisci** (lo schermo intero, con lo zoom), **Copia come immagine** ed
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

- **Invio** apre il sorgente, col cursore all'inizio del corpo;
- **Spazio** lo ingrandisce (e non scrive mai al posto del recinto);
- **Ctrl C** lo copia come immagine;
- il tasto **Menu** o **Maiusc F10** apre il suo menu.

## Copia come immagine

Negli appunti vanno insieme tre forme: l'immagine PNG, l'SVG (dove il sistema
lo accetta) e il sorgente come testo, nel suo recinto ```` ```mermaid ````.
Incollato in una chat arriva l'immagine; in una nota torna un diagramma. Dove
gli appunti non prendono immagini si copia soltanto il sorgente, e un avviso
lo dice.

## Il movimento

Cambiare stile sfuma i colori in 220 ms, dal disegno di prima al nuovo; la
tavola cambia carta nello stesso tempo. Col movimento ridotto il cambio è
immediato.

## Dove sta

- il disegno, il menu come dati e le modifiche al sorgente:
  `apps/client/src/ui/mermaid.ts`;
- il menu: `apps/client/src/ui/diagram-menu.ts`;
- il commento `%% stile:` e il frontmatter:
  `apps/client/src/theme/diagram-style.ts`;
- il diagramma mentre lo si scrive e i tasti del blocco:
  `apps/client/src/editors/text/profiles/markdown/diagram-live.ts`;
- la pelle: `apps/client/src/theme/scrittoio/skin/diagrams.css`.
