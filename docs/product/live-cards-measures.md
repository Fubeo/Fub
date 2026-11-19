# Le schede vive: quante, quanto pesano, in Obsidian

> **Per chi:** chi mette molte schede vive in una nota, o apre le stesse note
> anche in Obsidian.
> **Risultato:** sapere quante schede restano vive insieme, quanto costano a
> chi scrive e che cosa Obsidian mostra di ogni specie.

Le schede sono quelle delle [schede vive](live-cards.md): il PDF, il foglio,
il documento, il disegno, la zona lavagna, il file Craft.

## Quante schede vive

Vive insieme ce ne sono **al più quaranta**, quante ne tiene la lavagna
(`MAX_LIVE_CARDS` in `editors/core/cards/contract.ts`): le più vicine al
centro della Scrittura, e quella attiva sempre. Le altre schede montate sono
immagini ferme; quelle lontane dalla vista non sono neanche montate, perché
CodeMirror disegna soltanto la parte della nota vicina allo sguardo. In una
finestra di 800 px, con le schede più fitte (quattro colonne alte 120 px),
ne sono montate quaranta; in una finestra alta 1.800 px ne sono montate
sessanta, e restano vive quaranta: venti sono ferme.

## Quanto pesano sulla battuta

Lo misura `node bench/interaction.mjs --only=battuta`, sulla nota di
cinquanta sezioni con le schede a metà in righe di quattro colonne, le
specie in giro, e il cursore subito sotto le schede (`typingCardsNote` di
`bench/live-fixture.ts`). Il banco controlla quante schede sono montate,
vive, ferme e mancanti prima di scrivere, e si ferma se non sono quelle
attese.

Le cifre sono millisecondi: la mediana di cinque giri del banco, e fra
parentesi il giro più basso e il più alto. Misurate il 19 novembre 2026 su
pc-debian-di-fub (Intel Core i5-13600KF, Debian 13, Chromium della revisione
Playwright fissata), in Scrittura, con un carico medio da 6 a 18 (la
macchina faceva anche altri lavori). Il budget della battuta è una mediana
di 4 ms e un novantesimo percentile di 8 ms
([il budget](performance-budget.md#la-battuta)).

| Nota | Schede | Battuta, mediana | Battuta, novantesimo | Cursore, mediana |
|---|---|---:|---:|---:|
| 901 righe | nessuna | 3,0 (2,4–3,3) | 4,4 (3,7–4,8) | 2,2 (1,9–2,6) |
| 966 righe | 20: 19 vive, 1 col file sparito | 3,7 (3,0–3,9) | 6,9 (4,6–7,2) | 10,6 (10,3–11,4) |
| 1.031 righe | 40 vive | 3,2 (2,9–4,4) | 6,0 (5,5–8,1) | 14,9 (14,4–32,5) |
| 1.096 righe | 60: 40 vive, 20 ferme | 3,6 (3,4–4,3) | 6,5 (5,6–8,2) | 18,0 (17,4–18,9) |

- **La battuta resta nel budget** con venti e con quaranta schede vive: la
  mediana sale di meno di un millisecondo sulla nota senza schede. Con
  sessanta il costo è quello di quaranta, perché le vive restano quaranta:
  il limite tiene.
- **Lo spostamento del cursore no.** Spostare il cursore di 200 caratteri
  accanto alle schede (dentro e fuori dalle loro colonne) costa da 10 a
  18 ms, contro i 2 ms della nota senza schede, e cresce con il numero di
  schede: con quaranta o più supera i 16 ms di un fotogramma a 60 Hz. Il
  cursore non ha un budget suo, ma un gesto oltre il fotogramma si sente.

## In Obsidian

Il file Markdown resta quello di Obsidian: gli embed si scrivono come li
scrive lui. Che cosa Obsidian mostra di ogni specie lo dice una prova, non
una promessa: il vault di prova `tests/fixtures/prova-obsidian-schede/` ha
la nota `Schede vive.md`, con ogni specie e i file che nomina (uno manca
apposta), e nel suo
[`README.md`](../../tests/fixtures/prova-obsidian-schede/README.md) i passi
e che cosa guardare per ogni specie.

**Esito: da provare.** La prova con Obsidian non è ancora stata fatta: per
ogni specie l'esito (incorporata nella nota, link o errore) si scrive qui
quando c'è. Una specie che Obsidian non incorpora resta un link nel file, e
in Fub è comunque una scheda.
