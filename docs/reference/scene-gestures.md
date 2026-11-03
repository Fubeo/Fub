# Vettori dei gesti

> **Ambito:** quali operazioni sulla scena nascono da un gesto degli strumenti
> di disegno: dove stanno i vettori, la loro forma, come si rigenerano e come
> il motore del disegno ne ammette le differenze. Versione 1.
> **Fonti autorevoli:** i file in `apps/client/src/__fixtures__/disegno-gesti/`,
> scritti da `apps/client/src/editors/spatial/tools/gesti-vettori.test.ts` con
> gli strumenti TypeScript in `apps/client/src/editors/spatial/tools/editor/`.

I vettori di prova delle [operazioni sulla scena](scene-operations.md) (§9)
dicono che cosa fa un'operazione; i vettori dei gesti dicono quali operazioni
nascono da un gesto. Ogni vettore è un file JSON in
`apps/client/src/__fixtures__/disegno-gesti/`, con il nome del vettore
(`controllo-coordinate.json`). A differenza dei vettori del §9 non sono
scritti a mano: li scrivono gli strumenti TypeScript del client, registrati
come sono, e sono il riferimento di ciò che un gesto deve fare. Il motore del
disegno li rigioca e deve rispondere le stesse `expect.ops`; il finto host del
client li usa come risposte.

```json
{ "name": "controllo-coordinate", "description": "…", "input": "<svg …>…</svg>",
  "gesture": { "tool": "rect", "layer": null, "selection": [], "zoom": 1,
    "snap": { "grid": null, "free": false },
    "style": { "stroke": "#000000", "width": 4, "fill": null },
    "events": [ { "kind": "down", "x": 10, "y": 10, "pressure": 0.5, "shift": false, "alt": false, "cmd": false }, … ] },
  "expect": { "ops": [ { "op": "add", "parent": "l1a2b3c4d", "pos": { "last": true }, "elem": { "tag": "rect", "attrs": { "id": "@1", … } } } ],
    "selection": ["@1"], "refused": null, "text": "<svg …>…</svg>" } }
```

- `input` è il testo SVG prima del gesto, a righe LF tranne nei vettori che
  provano proprio i CRLF (`rettangolo-crlf`, `sposta-crlf`).
- `gesture.tool` è `select`, `rect`, `ellipse`, `line` o `arrow`; `layer` è
  il livello scelto nel menu dei livelli (`null`: quello che l'editor sceglie
  da sé); `selection` gli oggetti selezionati prima del gesto; `zoom` la scala
  della vista (spostamento zero).
- `snap.grid` è il passo della griglia magnetica, `null` se è spenta;
  `snap.free` è Ctrl/⌘ tenuto per tutto il gesto, che scioglie la griglia, e
  si ripete nel `cmd` di ogni evento.
- `style` è lo stile con cui lo strumento disegna, letto dall'editor
  (`null` per `select`); `fill` è sempre `null`, perché gli strumenti di
  forma non riempiono.
- `events` sono in coordinate di scena: il test le converte in coordinate
  del client con la vista. `double_click` è nella forma ma nessun vettore lo
  usa: nessuno strumento del client ne fa qualcosa.
- `expect.ops` sono le operazioni del gesto, nell'ordine dell'editor, `null`
  se non ne nasce nessuna; `selection` è la selezione dopo; `text` il testo
  dopo.
- `expect.refused` è `null` se il gesto ha fatto ciò che doveva (anche una
  selezione cambiata senza operazioni); altrimenti dice perché non ha fatto
  niente: `empty` (un gesto che non tocca niente: sotto la misura minima, una
  selezione vuota trascinata, uno spostamento che torna al punto di
  partenza), `locked` (il livello è bloccato o non c'è un livello dove
  disegnare), `hidden` (il livello è nascosto), `unmapped` (un gesto che lo
  strumento non conosce: nessun vettore lo usa).
- Gli id nuovi si scrivono `@1`, `@2`… nell'ordine in cui compaiono, prima
  nelle operazioni, poi nel testo, poi nella selezione; gli id già nel file
  restano quelli.
- Le chiavi hanno l'ordine della forma qui sopra, l'indentazione è di due
  spazi e il file finisce con un LF.

Il test è `apps/client/src/editors/spatial/tools/gesti-vettori.test.ts`. Le
definizioni dei vettori (documento, gesto, descrizione) stanno nel test; i
file si rigenerano con

```sh
UPDATE_GESTI=1 npm --prefix apps/client test -- src/editors/spatial/tools/gesti-vettori.test.ts
```

che registra ogni gesto due volte (due registrazioni diverse sono un errore:
un vettore che non si rifà uguale non è un oracolo), riscrive i file e toglie
quelli senza definizione. Senza `UPDATE_GESTI` il test rigioca ogni gesto dal
solo file, due volte, e fallisce col nome del vettore se l'esito non è quello
del file o se il file non è quello che la definizione scrive. Rigenerare due
volte di fila lascia il diff di Git vuoto. Un vettore cambia solo quando cambia
uno strumento del client, e il cambio si rivede nel diff come un cambio di
comportamento.

**Differenze ammesse.** Il motore può fare una cosa diversa da un vettore solo
se la differenza è scritta: ogni gruppo di test del motore che rigioca i
vettori ha accanto un file `.tsv` (per esempio
`crates/fub-disegno/tests/gesti/forme.tsv`) con una riga per vettore,
`vettore<TAB>perché`. Una riga senza perché non vale; un vettore che non è
nel file deve dare le stesse `expect.ops`, con gli id nuovi canonici, i numeri
con tolleranza 1e-3 e le `transform` confrontate come matrici (1e-6). Il
vettore resta com'è: la differenza si scrive nel `.tsv`, non nel JSON.
