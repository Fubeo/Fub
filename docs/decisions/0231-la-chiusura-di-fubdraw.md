# 0231 — La chiusura di FubDraw

- **Stato:** proposta
- **Data:** 2026-10-30
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

L'editor dei disegni è cresciuto fino a un programma di grafica alla
Illustrator: tre livelli pronti (Essenziale, Standard, Esperto), un livello
Personalizzato, e dietro di loro lazo, nodi, booleane, simboli, tavole,
presentazione, ricalco delle immagini e molto altro. Fub è uno spazio per
scrivere e studiare: di un disegno servono l'inchiostro, le forme di base e la
sessione dal tablet. Il resto lo fanno meglio le app Craft, che Fub apre con
«Apri in VectorCraft». Non c'è ancora una release pubblicata: nessun utente
dipende dalle funzioni che si tolgono.

Le scelte che restano valide: la scena SVG modificata con operazioni testuali
([0203](0203-superfici-spaziali.md)), l'inchiostro come componente di sistema
([0204](0204-nucleo-inchiostro.md)), la sessione live come servizio dell'app
([0205](0205-sessione-live.md)).

## Decisione

1. **Restano**:
   - il nucleo dell'inchiostro, `fub-ink` e `apps/client/src/ink`: penne,
     evidenziatore, gomma precisa, palmo, curva della pressione, stabilizzatore;
   - gli strumenti Selezione, Mano, Lente, Penna, Evidenziatore, Gomma,
     Rettangolo, Ellisse, Linea e Freccia;
   - le forme dal tratto (il riconoscimento serve a chi studia);
   - colori, punte delle linee, selezione (simili, blocca, nascondi),
     «Disponi», livelli del disegno, pagina e griglia, collegamenti alle note,
     immagini dal vault, proprietà, copia e incolla dello stile, cronologia,
     verifica dell'accessibilità, vista ruotata coi gesti e menu radiale;
   - l'export in PNG, JPEG, SVG e PDF;
   - la lettura delle scene (`fub-scene`) e il provider SVG: i disegni
     esistenti si aprono, si cercano e si incorporano;
   - la sessione dal tablet (`fub-live`).
2. **Vanno**, con codice, test, stringhe e pagine:
   - tutto il livello Esperto: Nodi, Costruttore di forme, Forbici e Coltello,
     Spessore variabile, penna di Bézier e curvatura, attributi, contorno,
     trasforma e applica, tracciato (scostamento, semplifica, unisci),
     booleane, ricalco delle immagini e il suo worker, maschere, testo in area
     e su tracciato, caratteri del vault, effetti, fusione, motivi, pagina di
     stampa, simboli, ripetizioni, «Rendi modificabile»;
   - dello Standard: Lazo, Tavola, Contagocce, Sfumatura, Connettore, Poligono
     e Testo; colori e stili del documento, campiture, guide, righelli e
     misure, simmetria della penna, ritagli, raccolta di forme, presentazione;
   - l'export in Excalidraw e draw.io;
   - il concetto di livello: il livello Personalizzato, le sue preferenze e il
     registro per livelli. Gli strumenti diventano un elenco solo.
3. **Il profilo `pdf`** (annotazioni dei PDF, `.fubann`) va più tardi, quando
   l'inchiostro sopra le schede PDF della lavagna e PdfCraft lo sostituiscono.
   Fino ad allora tiene i suoi strumenti. I `.fubann` esistenti si
   leggeranno e si convertiranno nell'inchiostro di una lavagna; non se ne
   creano di nuovi.
4. **Compatibilità**: un disegno esistente si apre come anteprima e come
   sorgente. Ciò che l'editor non sa più modificare (un simbolo, una
   sfumatura, un testo su tracciato) si vede e resta identico, byte per byte:
   lo conserva `fub-scene`. Per modificarlo c'è «Apri in VectorCraft».
5. La rimozione avviene **per gruppi, una PR per gruppo**, coi test verdi a ogni
   passo. La lista di lavoro la dà `tools/fubdraw-inventory.mjs`: i moduli del
   client che nessun ingresso raggiunge più.

## Conseguenze

### Positive

- meno codice da tenere vivo: un editor che si capisce in un pomeriggio;
- blocchi del client più piccoli, lontani dai budget di Vite;
- un elenco di strumenti che la lavagna, le note e i documenti condividono.

### Negative

- chi voleva un programma di grafica dentro Fub deve aprire un'app Craft;
- i disegni con simboli, sfumature o testo su tracciato non si modificano più
  in Fub: si vedono e si conservano.
- un vault lasciato all'Essenziale si riapre in Completo: `draw.level` e
  `draw.custom` restano nel suo file, ma nessuno li legge più, e lo spazio
  Semplice si sceglie di nuovo con `draw.workspace`.

## Alternative scartate

### Tenere i livelli, togliendo soltanto l'Esperto

Plausibile, perché lo Standard era il livello di partenza. Scartata: lo Standard
porta da solo tavole, presentazione, connettori e guide, cioè ancora un
programma di grafica, e il concetto di livello resta da spiegare e da provare.

### Spostare l'editor in un plugin

Plausibile, perché un plugin si spegne. Scartata: il codice resterebbe da
mantenere, e VectorCraft fa già quel lavoro meglio.

## Verifica

- `apps/client/src/editors/spatial/tools/registry.ts` elenca soltanto gli
  strumenti che restano, e i test del registro lo provano;
- i test di lettura di `fub-scene` e del provider SVG aprono i disegni del
  corpus e li riscrivono identici quando non cambiano;
- `node tools/fubdraw-inventory.mjs --orfani` non elenca moduli.
