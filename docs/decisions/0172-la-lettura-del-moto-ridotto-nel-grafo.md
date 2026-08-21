# 0172 — La lettura del moto ridotto nel loop del grafo

**Stato**: accolta  **Data**: 2026-08-22  **Chiude**: [§30.9](../roadmap/30-il-moto-e-del-tema.md)
**Commit**: *(questo commit)*

---

## La domanda

Il grafo aveva un ciclo `requestAnimationFrame` che conosceva la quiete della
fisica e della camera, ma non la preferenza `prefers-reduced-motion`. Il pulse
dei nodi aperti, l'inerzia del pan e l'inseguimento esponenziale della camera
continuavano quindi anche quando il browser chiedeva di ridurre il moto.

## Un canale, letto una volta

`theme/reduced-motion.ts` è il solo punto che nomina la media query. Il canale
legge `matchMedia("(prefers-reduced-motion: reduce)")` una volta, conserva il
valore corrente e osserva l'evento `change`; i grafici si iscrivono e rimuovono
la propria sottoscrizione al montaggio e allo smontaggio. `main.ts` forza la
prima lettura prima dei pannelli, così il primo grafo nasce già nella modalità
corretta. Un cambio del sistema aggiorna tutti i grafici vivi senza duplicare
la lettura nel renderer o nella fisica.

## Il grafo funzionale senza ornamento

La `CameraState` riceve la modalità corrente. In moto ridotto zoom, pan, `fit` e
`centerOn` arrivano direttamente al bersaglio, azzerano la velocità residua e
non passano dal passo esponenziale; tornando alla modalità normale il vecchio
inseguimento e l'inerzia restano invariati. Il secondo fit di assestamento usa
lo stesso arrivo secco, mentre la soglia `ACTIVE_THRESHOLD` continua a spegnere
il ciclo quando la fisica è quieta.

Il pittore riceve la modalità nel `DrawState` e passa al calcolo del pulse un
solo cancello: in ridotto l'opacità pulsante è assente, in normale mantiene la
fase hashata e la frequenza già esistente. Il nodo resta disegnato, il grafo
resta interagibile e l'assestamento fisico non viene falsamente disabilitato.

## I presidi, e ciò che misurano

Il canale ha un test con `matchMedia` simulato: la query è consultata una volta,
il cambio da `true` a `false` è diffuso, la camera arriva secca e il pulse è
assente in ridotto; dopo il cambio il comportamento normale torna osservabile.
`graph/render/camera.test.ts` presidia anche pan e zoom nelle due modalità,
mentre `graph/render/painter.test.ts` presidia il cancello del pulse. Il comando
mirato
`./node_modules/.bin/vitest run src/graph/chart.test.ts src/graph/render/camera.test.ts src/graph/render/painter.test.ts src/theme/reduced-motion.test.ts`
passa: **4 file, 27 test** (conteggio dal riepilogo di Vitest).

Il controllo `./node_modules/.bin/tsc --noEmit` resta bloccato da errori
preesistenti in `src/ui/icons.test.ts` (`node:fs`, `node:path`, `node:url` e il
parametro `entry`), fuori dal fascicolo del grafo; nessun errore del nuovo
canale è emerso dal test TypeScript/Vitest mirato.

Il banco gira con moto ridotto: sì — `frontend/bench/stage.mjs` imposta
`reducedMotion: "reduce"`, e `frontend/bench/scene.mjs` fotografa la scena
`graph` (verificato con `grep -n 'reducedMotion:|id: "graph"' frontend/bench/stage.mjs frontend/bench/scene.mjs`). La baseline da rigenerare è: sì. Nessun
`bench:update` è stato lanciato in questa ondata.

## Le vie scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| leggere `matchMedia` in ogni grafo | query nel chart o nel pittore | duplica il canale, perde il requisito di una lettura e rende incoerente il cambio osservato |
| spegnere il rAF intero in ridotto | niente simulazione né assestamento | il grafo deve restare funzionale e il layout deve ancora raggiungere il suo stato stabile |
| usare CSS per il canvas | `animation: none` sulla superficie | fisica, camera e pulse sono numeri del renderer Canvas, non animazioni CSS |
| mantenere l'inseguimento ma con una costante diversa | smoothing più rapido | non è un arrivo secco e lascia inerzia residua sotto la preferenza ridotta |
