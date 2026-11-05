# Il simulatore di Fub pre-alpha

Il prototipo del piano `piano/fub-pre-alpha` (vedi `PLAN.md`, «Dal
prototipo»). È una superficie, non un programma: niente IPC, niente
salvataggi, niente logica del prodotto. Ogni schermata è il DOM e il CSS
del client vero, fotografati dal banco e uniti al CSS nuovo di Scrittoio 2.

## Che cosa c'è

- `simulatore.html`: la pagina. Si apre con un doppio clic, senza server.
  In alto si scelgono lo stato, la luce, la larghezza (piena, 700,
  telefono), il movimento e il fuoco. Lo stato sta nell'indirizzo
  (`#stato=…&luce=…&larghezza=…&moto=…`).
- `sim-dati.js`: le catture compresse (gzip e base64): il DOM e il CSS del
  client vero, uno per stato e per luce.
- `solo-simulatore.js`: i passaggi fra gli stati e i pezzi che si aprono
  sopra (il menu delle modalità, «/», il tasto destro, la tavolozza, il
  salvataggio, gli avvisi). Non va nel codice del prodotto.
- `piani/*.html`: le pagine approvate degli altri piani, tali e quali
  (griglia, disegno di K5, lavagna di N4 e di N6, comandi dei fogli, ricette
  di A1).
- `blocchi/*.css`: il CSS nuovo, un file per blocco. La prima riga di ogni
  file dice il file di destinazione e il task.
- `script/`: gli attrezzi che lo hanno costruito.

## Come si copia

Nella pagina, «I pezzi di questo stato» elenca ogni pezzo con il file di
destinazione e il task; «Indica» lo mostra sullo schermo, «DOM» copia il suo
HTML. Nel sorgente della pagina il CSS nuovo sta in blocchi
`<style media="not all" data-destinazione="…" data-posto="…" data-task="…">`,
uno per file di destinazione: si copia il blocco intero nel file che dice.
Il JS dei blocchi segnati «solo simulatore» non si copia.

La tabella completa, pezzo per pezzo, è in `PLAN.md`, «Dal prototipo».

## Come si rifà

Le catture (243 MB) non sono nel repository: stanno su `server-di-fub` in
`~/.cache/fub-prealpha/sim/catture/`. Senza di loro si possono rifare le
foto, non il simulatore.

- Costruire: `node script/costruisci-sim.mjs <cartella>`. Vuole le catture
  in `../catture/` e le pagine dei piani in `$PROTO`.
- Provare i gesti: `node script/prova-sim.mjs <cartella del simulatore>
  <cartella delle foto>` (deve dire «errori: nessuno»).
- Fotografare ogni stato, nelle due luci e alle tre larghezze:
  `node script/foto-sim.mjs <cartella del simulatore> <cartella delle foto>`;
  con le catture accanto, confronta ogni foto con quella del client.
- Gli script usano il Playwright di `apps/client/node_modules` e, per i
  pixel uguali al banco, `FONTCONFIG_FILE` di `CLAUDE_DEVICE.md`.
- Catturare di nuovo uno stato: `script/cattura.mjs` con i mod di
  `script/mods.mjs`, contro una copia del client sulla porta 1468 (mai
  1431, 1432, 1437 o 1438).

## Che cosa non fa

- Densità, contrasto e accento: il simulatore segna la scelta e lo dice, ma
  non ricompila i colori (domanda D12 del piano).
- Il telefono: Scrittoio 2 ne ha disegnati 11 stati; per gli altri il
  simulatore mostra il telefono più vicino e lo dice sotto lo schermo.
- Le pagine dei piani stanno fuori dalla cornice di Scrittoio 2 (domanda D4).
