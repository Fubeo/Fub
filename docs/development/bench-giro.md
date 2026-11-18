# Il giro della pre-alpha

Questa pagina dice che cosa fa `npm run bench:giro`, come si lancia e che
cosa non prova. Gli altri banchi sono in [Test e qualità](testing-and-quality.md#banchi).

> **Per chi:** chi lancia il giro, ne legge il referto o gli aggiunge un compito.
> **Risultato:** sa lanciarlo, leggere dove si è fermato e che cosa resta da
> provare a mano.

Il giro fa sul banco, di fila e sulla stessa pagina, i compiti che una persona fa
nella pre-alpha: la shell vera col finto host e il vault del banco, gesti con la
tastiera e col puntatore, il moto ridotto e la lingua italiana del palco
(`bench/stage.mjs`). Ogni compito controlla il risultato nel DOM o nel finto host (per
esempio il Markdown che arriva a `writeDocument`, non solo l'assenza di errori) e lascia una foto.

```bash
cd apps/client
npm run bench:giro -- --out=$TMPDIR/giro              # a 1280×800
npm run bench:giro -- --out=$TMPDIR/giro --telefono   # mobile.html a 390×844
npm run bench:giro -- --solo=avvio --luce=light       # un gruppo, nella luce giorno
```

Il corridore è `bench/giro.mjs`; i gruppi, in ordine, sono in `bench/giro/elenco.mjs`, uno per file
accanto che dice in testa che cosa prova. `avvio`: dal primo avvio senza vault all'albero, alla scrittura
in Live e alle quattro modalità. `scrivere` (non al telefono): «/» e maniglia, tasto destro, palette, due
riquadri, rinomina coi link, ricerca e «In entrata»; ricarica con `?formatbar=1&slash=1`, senza cui il
finto non dà i comandi di formato. `editor` (non al telefono): una frase in un Word, formula e «Ordina» in
un Excel, un rettangolo in un SVG, una ricerca in un PDF; `giro=editor` (`bench/giro-fixture.ts`) dà il
PDF e un foglio che serve solo quei comandi. `lavagna` (non al telefono, `?lavagna=1`): schede, un filo,
la penna (`pointerType: "pen"`, con la pressione) e la Gomma, visti nel `.canvas`. `guasti` (non al
telefono): conflitti, errori, cestino, tastiera. `scrittura` (non al telefono): quarantadue compiti
dell'editor, dal «/» alla Base, alla sbirciata e all'inglese, elencati in
[Il giro della scrittura](giro-della-scrittura.md) coi saltati e il perché. Al primo compito che fallisce il giro si ferma, dice
quale e perché, fotografa (`…-errore.png`) ed esce con 1. Foto e referto (`giro.json`) in `--out` (di
serie `bench/.output/giro/`), porta da `FUB_BENCH_PORT` o `--port`.

Che cosa **non** prova: i pixel (senza baseline, si guardano: `bench:verify`), il motore vero
(risponde il finto host; i suoi «Struttura» e «Collegamenti» sono uguali per ogni nota, la sua
rinomina riscrive solo i wikilink, i valori del foglio sono a mano), il sistema operativo (finestre,
dialoghi, WebView e installer, al giro a mano; il selettore dà il vault del banco).
