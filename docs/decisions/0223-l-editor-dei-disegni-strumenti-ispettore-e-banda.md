# 0223 — L'editor dei disegni: strumenti a sinistra, proprietà nell'ispettore, fatti nella banda

- **Stato:** proposta
- **Data:** 2026-10-27
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

L'editor dei disegni ha un motore da programma di grafica (scena canonica,
operazioni, guide con misure, campi con calcoli, connettori, tavole, simboli,
sessione su tavoletta), ma la sua forma era quella di un prototipo: tre righe
di icone della stessa misura, una tavolozza di forme colorate nella seconda
riga, il titolo su una riga intera, le proprietà in una colonna dentro il
foglio, nessun menu col tasto destro, tasti fuori dagli usi della grafica
(`A` freccia, `H` evidenziatore) e livelli (Essenziale, Standard, Esperto)
che nascondevano funzioni. L'ispettore dello Scrittoio mostrava la struttura
di un testo e la banda di stato contava le parole.

La forma di [ADR 0203](0203-superfici-spaziali.md) resta valida per la
sorgente e per le operazioni: questa decisione riguarda soltanto dove e come
l'editor si mostra.

## Decisione

Il motore resta, l'impianto si rifà. Gli `installX(ctx)` di
`tools/editor/` restano la logica; cambia il posto di ogni pezzo.

1. **Un posto per ogni cosa**, come in Illustrator, Affinity, Figma e
   Inkscape: strumenti in una colonna a sinistra con tendine
   (`kit/tool-rail.ts`), opzioni dello strumento e della selezione in una
   riga in alto (`kit/options-bar.ts`), proprietà e livelli nell'ispettore
   dello Scrittoio, fatti nella banda di stato, azioni sul tasto destro.
2. **Cromature ospiti.** L'editor fa i pezzi e non sa dove stanno: chi lo
   monta sceglie una cromatura (`tools/editor/chrome/hosts.ts`).
   `inlineChrome` mette tutto nella radice, per i test e per chi monta
   l'editor altrove; `inspectorChrome` dà allo Scrittoio cinque schede
   (Design, Livelli, Risorse, Cronologia, Accessibilità) con `panels`.
3. **La superficie dichiara i suoi porti**: `panels`, `status` senza i
   conteggi del testo, `contextMenu` come dati e `zone(step)` per F6 fra
   tela, colonna e barra in alto. Non nasce nessuna porta IPC.
4. **Un catalogo dei comandi** (`tools/editor/chrome/commands.ts`) da cui
   leggono la ricerca `Ctrl+/`, il menu ≡, il menu col tasto destro e il
   radiale. Ogni funzione del registro è raggiungibile da un comando o da una
   sezione dell'ispettore.
5. **Tutto raggiungibile, due spazi di lavoro.** Completo, il predefinito,
   offre tutto; Semplice offre le parti per disegnare a mano o col dito, con
   caselle da 44 px. La progressività sta nel posto (colonna, tendina,
   ispettore, ricerca), non in livelli. «Personalizza la barra…» sceglie la
   colonna. Le impostazioni `draw.workspace` e `draw.toolbar` sono nuove e
   additive; `draw.level` e `draw.custom` restano dichiarate, si leggono una
   volta per dedurre le nuove e non si cancellano.
6. **Tasti standard della grafica** dove i programmi concordano: `H` mano,
   `Z` zoom, `A` nodi (`N` resta), `Maiusc+P` evidenziatore, `Maiusc+L`
   freccia, `Spazio` tenuto = mano e battuto = premi del cursore da
   tastiera, `Maiusc+F10` menu contestuale. Un tasto dello Scrittoio non si
   prende senza dichiararlo.
7. **Colori senza forme.** Davanti c'è un pozzo col colore e il suo nome,
   che apre il selettore del kit; gli otto colori Okabe–Ito sono i
   «Consigliati» del selettore. Il nome soddisfa WCAG 1.4.1, non la forma.

Restano fermi la carta bianca nei due temi, gli spessori 2/4/8, il cursore da
tastiera e il percorso Tab fra gli oggetti.

## Conseguenze

### Positive

- la tela resta al disegno, e le proprietà non ne rubano metà;
- chi viene da un altro programma di grafica trova strumenti, tasti e menu
  dove se li aspetta;
- un comando nuovo entra una volta nel catalogo e compare nella ricerca, nei
  menu e nel radiale;
- la cromatura ospite lascia montare l'editor dentro un'altra superficie
  senza rifarne i pezzi.

### Negative

- chi usava `A` per la freccia, `H` per l'evidenziatore o `Maiusc+F10` per il
  radiale deve cambiare abitudine; la finestra dei tasti dice che cosa è
  cambiato;
- i test dell'editor seguono i posti nuovi, e i pannelli hanno due case
  (in linea e nell'ispettore);
- le impostazioni vecchie restano nel vault accanto alle nuove.

## Alternative scartate

### A. Tenere le righe in alto e ridisegnarne le icone

Costava poco. Ma le opzioni dello strumento restavano senza posto, e la
gerarchia fra strumenti, opzioni e azioni non nasceva da un'icona più bella.

### B. Tenere i livelli e renderli più chiari

I livelli rispondevano a «quanto mostrare», non a «dove sta». Chi cercava un
comando non sapeva a che livello stava, e la ricerca doveva mentire o
nascondere.

### C. Le proprietà in un pannello del disegno, fuori dall'ispettore

Un editor con un suo ispettore avrebbe avuto due colonne di destra nello
Scrittoio, e la regola dei pannelli sarebbe valsa per tutti tranne uno.

## Verifica

- `apps/client/src/editors/spatial/tools/registry.test.ts`: tasti unici,
  spazi, parti del Semplice;
- `apps/client/src/editors/spatial/tools/editor.test.ts`: colonna,
  tendine, catalogo dei comandi, menu, ricerca, spazi e personalizzazione,
  con `inlineChrome`, e il confronto coi tasti dello Scrittoio;
- `apps/client/src/editors/spatial/surface.test.ts`: `panels`, `status`,
  `contextMenu` e `zone`;
- `apps/client/src/kit/tool-rail.test.ts`, `options-bar.test.ts`,
  `number-field.test.ts`, `font-picker.test.ts` e i test di `kit/color/`;
- `apps/client/src/editors/spatial/preferences.test.ts` e
  `draw-settings-mirror.test.ts`, con `cargo test -p fub-features`: le
  impostazioni nuove e la lettura delle vecchie;
- `npm run bench:a11y`: ruoli, nomi e fuoco della colonna e delle tendine.
