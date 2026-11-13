# Il simulatore di Fub pre-alpha

Il prototipo del piano `piano/fub-pre-alpha` (vedi `PLAN.md`, «Dal
prototipo»). È una superficie, non un programma: niente IPC, niente
salvataggi, niente logica del prodotto. Si usa come il prodotto: ogni clic
porta dove porterebbe l'app, o dice perché lì non succede niente.

Ci sono 298 stati (S1–S298) e 18 scenari, nelle due luci, alle tre larghezze
(piena, 700 px, telefono) e nei tre livelli di movimento. Ogni stato dice da
dove viene:

- **cattura**: il DOM del client vero, fotografato dal banco col CSS di
  Scrittoio 2;
- **composta**: DOM vero spostato o ritoccato, per esempio un editor di una
  pagina dei piani nella cornice di Scrittoio 2;
- **nuova**: DOM scritto a mano in questo giro (`toppe/`).

Gli stati composti e nuovi aspettano il sì dell'utente: la pagina ha
l'elenco e la frase pronta.

## Che cosa c'è

- `simulatore.html`: la pagina. Si apre con un doppio clic, senza server.
  In alto si scelgono lo stato, lo scenario, la luce, la larghezza e il
  movimento; l'indirizzo ricorda tutto
  (`#stato=…&luce=…&larghezza=…&moto=…`, più `scenario=…&passo=…`). In testa
  c'è il CSS nuovo, un blocco
  `<style media="not all" data-destinazione="…" data-task="…">` per file di
  destinazione.
- `sim-dati-1.js`: le 632 catture compresse (316 schermi nelle due luci), le
  toppe, i temi e i caratteri. È la fonte del DOM catturato.
- `sim-stati.js`: gli stati, i gruppi, gli scenari, i pezzi e le pagine dei
  piani.
- `vista-sim.js`, `solo-simulatore.js`: il motore. Monta uno stato, risponde
  ai clic e ai tasti, fa i passi degli scenari e i gesti del telefono. Non
  va nel codice del prodotto.
- `piani/*.html`: le pagine approvate degli altri piani, tali e quali.
- `blocchi/*.css`: il CSS, un file per blocco; la prima riga dice il file di
  destinazione e il task.
- `toppe/*.html`: il DOM scritto a mano, un `<template data-toppa>` per
  pezzo, con la destinazione e il task in testa.
- `dal-prototipo.md`: le tabelle di «Dal prototipo», generate.
- `logo/`: Marcuzzo (D26), gli originali dell'utente, le quattro forme da
  copiare e i contrasti misurati della cartella; come si rifanno è in
  `logo/LEGGIMI.md`.
- `verde/`: le foto delle tinte di D25 per la pagina delle scelte.
- `script/`: ciò che rifà il simulatore, le sue prove e la pagina
  dell'artifact.

## Come si copia

Nella pagina, «I pezzi di questo stato» elenca ogni pezzo con il file di
destinazione, il task e se è nuovo, composto, cambiato o uguale; «Indica» lo
mostra sullo schermo, «DOM» dà il suo HTML. Il CSS si copia blocco per
blocco nel file che dice. Il JS «solo simulatore» non si copia.

La guida intera è in `PLAN.md`: «Dal prototipo» e «Come si implementa».

## Come si rifà

Dalla radice del repository, senza catturare di nuovo:

```bash
DATI=PLAN-ui/fub-pre-alpha node PLAN-ui/fub-pre-alpha/script/costruisci-sim.mjs PLAN-ui/fub-pre-alpha
```

Senza altri cambi riscrive gli stessi byte: lo si controlla prima di
committare. Dove cambiare che cosa è in `PLAN.md`, «Rifare il simulatore».

Gli script del browser vogliono un `apps/client` con `npm ci` fatto, in
`FUB_CLIENT` (di serie quello di questo repository). Di solito è il client
delle catture, che ha anche i caratteri.

- Provare che si usa come il prodotto: `node script/prova-sim.mjs <cartella
  del simulatore> <cartella delle foto>` (deve dire «errori: nessuno»).
- Confrontare i pixel con le catture: `node script/foto-sim.mjs <cartella
  del simulatore> <cartella delle foto>`. Vuole le catture (circa 560 MB),
  che non sono nel repository. Scrive `confronto.tsv`: una riga per stato,
  larghezza, luce e fonte, e sopra lo 0,5 % il perché, con quanto resta
  togliendo la zona che lo spiega (fra queste lo spazio che il DOM nuovo
  prende, misurato coi quadretti che si ritrovano spostati: `PLAN.md`, «I
  pixel contro la fonte»).
- Guardare ogni vista come la guarderebbe una persona (tagli, bersagli,
  contrasto, fuoco): `node script/sonda-viste.mjs <cartella del simulatore>
  <cartella>`. Scrive `viste.tsv` (un riscontro per riga), `gruppi.tsv` e
  `riassunto.json` (`PLAN.md`, «Il controllo di tutte le viste»); con
  `solo=id,id` guarda solo quegli stati.
- Catturare di nuovo: `script/finto/LEGGIMI.md` (il client delle catture, le
  sue toppe, `script/ricattura.mjs` e `script/ricattura-tutto.sh`). Il Vite
  delle catture usa la porta 1468.
- La pagina dell'artifact (le cinque parti, con il simulatore dentro):
  `node PLAN-ui/fub-pre-alpha/script/costruisci-hub.mjs PLAN.md PLAN-ui/fub-pre-alpha <cartella>`.

## Che cosa non fa

- Non salva e non parla con l'host: il testo che si scrive resta nello
  stato montato.
- L'affaccio dei cassetti col puntatore che sosta sul bordo non c'è: è un
  gesto nel tempo che una cattura non prende (`PLAN.md`, differenza 39).
- Il telefono è provvisorio (D1): le strisciate e il bordo che torna indietro
  non ci sono in `main`.
