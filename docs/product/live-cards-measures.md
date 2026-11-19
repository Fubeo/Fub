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
Playwright fissata), in Scrittura, con un carico medio da 1,3 a 3,6. Le due
serie «prima» e «dopo» sono state fatte una dietro l'altra, con lo stesso
stato della macchina: le cifre assolute di un altro giorno possono essere più
basse (la nota senza schede è scesa fino a 2 ms di cursore), il confronto
vale fra le colonne. Il budget della battuta è una mediana di 4 ms e un
novantesimo percentile di 8 ms
([il budget](performance-budget.md#la-battuta)).

| Nota | Schede | Battuta, mediana | Battuta, novantesimo | Cursore prima | Cursore dopo |
|---|---|---:|---:|---:|---:|
| 901 righe | nessuna | 4,8 (4,4–5,3) | 6,2 (5,7–6,6) | | 4,6 (4,2–4,7) |
| 966 righe | 20: 19 vive, 1 col file sparito | 4,4 (4,0–4,8) | 5,2 (4,8–9,3) | 10,0 (9,9–10,0) | 5,3 (5,2–5,5) |
| 1.031 righe | 40 vive | 3,0 (2,9–3,4) | 4,9 (4,3–5,2) | 13,5 (13,4–13,6) | 5,6 (5,6–6,1) |
| 1.096 righe | 60: 40 vive, 20 ferme | 3,3 (3,1–3,4) | 5,9 (4,5–6,5) | 17,0 (16,9–17,1) | 5,9 (5,9–6,0) |

La battuta è quella dopo la correzione: prima era la stessa, entro un
decimo di millisecondo (4,5, 3,0 e 3,4 di mediana).

- **La battuta resta nel budget** con venti e con quaranta schede vive: la
  mediana non sale sulla nota senza schede. Con sessanta il costo è quello di
  quaranta, perché le vive restano quaranta: il limite tiene.
- **Il cursore accanto alle schede costa quanto senza schede, più un
  millisecondo.** Spostare il cursore di 200 caratteri accanto alle schede
  (dentro e fuori dalle loro colonne) costava da 10 a 17 ms e cresceva con
  il numero di schede; ora costa da 5 a 6 ms, quasi uguale con venti e con
  sessanta.

### Perché il cursore costava

Non erano le schede a rimontarsi: uno spostamento del cursore che non tocca
una scheda non ne smonta né ne rimonta nessuna (lo prova
`live-cards.test.ts`). Quando il cursore va lontano, CodeMirror toglie e
aggiunge una riga in `.cm-content`, e Chromium ricalcolava lo stile dei
fratelli che seguono, schede vive comprese, con tutto il loro contenuto: le
celle, i bottoni, i titoli.

Lo faceva per i selettori di fratelli con a sinistra un composto **senza
nome**: `.settings-card > :not([hidden]) ~ *`, `:not(.cm-fub-callout-line) +
.cm-fub-callout-line`, ma anche `li + li` e `th + th`, perché Chromium non
sceglie per tipo chi ricalcolare. Bastava uno solo di questi, in qualunque
parte della pelle, perché ogni riga aggiunta in un documento ricalcolasse i
suoi fratelli. Togliendoli tutti in una pagina del banco, lo spostamento
lontano scendeva da 13–18 ms a 3–5,5 ms, quanto togliendo tutte le 102 regole
di fratelli della pelle.

Ora la pelle dice sempre chi è il fratello (`.x:not(.x + :where(.x))`,
`:nth-child(n + 2 of :not([hidden]))`, `input[type]:checked + …`), e
`apps/client/src/theme/fratelli.test.ts` fallisce se torna una forma senza
nome. L'unica eccezione è il rientro dei paragrafi nella stampa
(`.markdown-rendered > p + p`), che non ha una forma con un nome: misurato,
tenerlo non cambia il costo. Un `:has()` sullo stato di una casella
(`:has(> input:checked)`) non è la via d'uscita: costava 4 ms a ogni
spostamento del cursore anche nel Sorgente.

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
