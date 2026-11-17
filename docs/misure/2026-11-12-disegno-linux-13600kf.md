# 2026-11-12, Linux, il cancello del disegno sul motore

Questa pagina conserva le misure del cancello di K5 (T20): il cancello del
corpus, `bench:ink` prima e dopo il piano e le latenze del motore del disegno
contro i tetti di A8.

> **Per chi:** chi chiude K5 e chi rifà il cancello dopo un cambio del motore
> del disegno.
> **Risultato:** sapere se il corpus si modifica senza perdite visibili, se
> la penna è rimasta com'era e quanto costano anteprima, commit e reimport.

## Chi, cosa, quando

- ramo `piano/k5-disegno`, base `11eaaaf5e`; «prima» è `main` a `6249d976b`
  (la base del piano), in un worktree a parte; 2026-11-12, sera;
- misurato da un agente coder del piano, sulla macchina dell'utente lasciata
  libera;
- comandi, dalla radice: `node tools/disegno-cancello/cancello.mjs`;
  `cd apps/client && npm run bench:ink` nei due worktree;
  `FUB_DISEGNO_CANCELLO=DIR cargo test --release -p fub-disegno --test cancello -- --ignored --exact latenze`.

## La macchina

- `pc-debian-di-fub`: Intel Core i5-13600KF, 20 thread, 31 GiB di memoria;
- Debian GNU/Linux 13, kernel 6.12.113;
- Node.js 22.23.3 sotto Vitest 5.0.5; Rust 1.95.0, profilo `release` per le
  latenze;
- processi con `nice -n 19`; nessun altro lavoro di compilazione durante le
  misure.

## Il cancello del corpus

`node tools/disegno-cancello/cancello.mjs` esce con 0: 32 file su 32 passano.
Il giro, le soglie e le differenze ammesse sono in
[`tools/disegno-cancello/README.md`](../../tools/disegno-cancello/README.md).

| Che cosa | File |
|---|---|
| andata e ritorno con 0 pixel diversi | 23 (più `sposta2` su `resources`) |
| rettangolo con lo 0,000% fuori dalla zona | 29 |
| colore del tratto con lo 0,000% fuori dalla zona | 17 |
| adozione dei quattro SVG estranei senza pixel diversi | `chromium`, `foreign`, `inkscape`, mermaid ×2 (5) |
| in sola lettura, saltati | `doctype`, `illustrator` |
| nessun elemento mappato da spostare | i quattro A4, i due storyboard, `symbols` |
| nessun elemento con un id che il colore sappia colorare | 13 (tra cui i file di mermaid e di Chromium, `text`, `lesson`) |

Nessun testo dopo un gesto ha un codice `S…` della diagnosi in più. Le tre
righe ammesse sono due spostamenti rifiutati (un livello di Inkscape figlio
della radice, in `foreign` e `inkscape`: lo spostamento passa all'elemento
dopo) e il rettangolo in `symbols`, dove la copia del motore è vuota. I file
dell'oracolo: `symbols` non si disegna (`usvg` si ferma al tetto dei nodi),
e i suoi gesti si provano senza immagini.

## I caratteri

`caratteri.tsv`, con le facce di Fub date al motore:

| Testo | Facce usate |
|---|---|
| «Ciao» in `trebuchet ms`, `Verdana`, una famiglia inventata | Inter, di Fub |
| «Ελληνικά Кириллица» in Inter | Inter, di Fub, e Noto Sans dal sistema (`/usr/share/fonts/truetype/noto/`) |
| «漢字» in Inter | Droid Sans Fallback dal sistema |
| «🙂» in Inter | Noto Color Emoji dal sistema |

Una famiglia che Fub non ha ripiega su Inter, la stessa su ogni macchina; un
carattere che le facce di Fub non hanno lo disegna una faccia del sistema,
diversa da una macchina all'altra. Disegno e colpi su quei testi dipendono
dalla macchina.

## `bench:ink` prima e dopo

Sei giri per lato, alternati (tre con `main` prima, tre con il ramo prima),
carico a un minuto fra 0,89 e 1,97 all'inizio di ogni giro e al più 1,93 alla
fine. Il codice di `apps/client/src/ink/`, la configurazione del banco e il
lockfile sono gli stessi nei due lati; il banco WebAssembly salta nei due
(il modulo non è compilato). Mediana dei sei giri, fra parentesi il più
basso e il più alto; nell'ultima colonna il minimo assoluto, prima / dopo.

| Scenario | Prima (main) | Dopo (K5) | Differenza | Minimo |
|---|---|---|---|---|
| riduttore, mouse senza coalescenti (ns/evento) | 71 (64–98) | 80 (67–92) | +13,4% | 61 / 65 |
| riduttore, penna 240 Hz, 4 coalescenti, 3 predetti | 652 (641–753) | 668 (646–707) | +2,5% | 538 / 540 |
| riduttore, penna con stabilizzatore a media | 812 (787–836) | 825 (788–863) | +1,7% | 707 / 697 |
| adattatore, mouse | 1722 (1660–1767) | 1725 (1693–1745) | +0,2% | 1603 / 1634 |
| adattatore, penna, 4 coalescenti | 2582 (2502–2605) | 2554 (2521–2606) | −1,1% | 2417 / 2424 |
| contorno intero, 100 campioni (ns/anteprima) | 11594 (11332–11648) | 11538 (11370–11836) | −0,5% | 10602 / 10648 |
| contorno intero, 1000 campioni | 108512 (105571–122329) | 108092 (105547–111396) | −0,4% | 100843 / 101932 |
| contorno intero, 5000 campioni | 567000 (562200–656555) | 561910 (546427–669168) | −0,9% | 523458 / 520120 |
| contorno intero, 10000 campioni | 1391726 (1385782–1436463) | 1399564 (1387685–1439683) | +0,6% | 1092225 / 1101267 |
| `StrokePreview`, 100 campioni (ns/movimento) | 1523 (1504–1740) | 1528 (1517–1575) | +0,4% | 1435 / 1412 |
| `StrokePreview`, 1000 campioni | 5522 (5513–6043) | 5540 (5511–5575) | +0,3% | 4291 / 4329 |
| `StrokePreview`, 5000 campioni | 24448 (23814–24857) | 24343 (24133–25566) | −0,4% | 20529 / 20354 |
| `StrokePreview`, 9000 campioni | 47102 (46571–47599) | 47086 (46498–47414) | 0,0% | 36745 / 36934 |

Ogni intervallo del dopo si sovrappone a quello del prima: `bench:ink` è
dentro il rumore. Il +13% del mouse senza coalescenti sono 9 ns su 70, con
intervalli che si coprono quasi per intero; il codice misurato è lo stesso.

## Le latenze del motore (A8)

Tre giri, ognuno con 20 ripetizioni; carico a un minuto fra 0,68 e 0,73
prima e dopo ogni giro. I tempi sono quelli della chiamata al motore
(`Disegno::gesto`, `sincronizza` fino alla copia pronta), senza l'IPC, la
serializzazione e il disegno nel client. Il disegno di 1 MiB è generato dalla
prova: 1 048 598 byte, 11 733 elementi mappati in gruppi di rettangolo,
ellisse e linea; aprirlo costa 98–101 ms.

| Misura | Campioni per giro | p50 (ms), tre giri | p95 (ms), tre giri | Tetto di A8 |
|---|---|---|---|---|
| `concept-map`, anteprima di uno spostamento | 1220 | 0,059 / 0,059 / 0,059 | 0,067 / 0,116 / 0,117 | p95 ≤ 16: **sì** |
| `concept-map`, anteprima di un rettangolo | 1220 | 0,015 / 0,015 / 0,015 | 0,018 / 0,017 / 0,018 | p95 ≤ 16: **sì** |
| `concept-map`, commit di uno spostamento | 20 | 0,440 / 0,438 / 0,448 | 0,446 / 0,690 / 0,682 | ≤ 50: **sì** |
| `concept-map`, commit di un rettangolo | 20 | 0,384 / 0,375 / 0,383 | 0,398 / 0,392 / 0,390 | ≤ 50: **sì** |
| 1 MiB, anteprima di uno spostamento | 310 | 7,1 / 6,9 / 7,1 | 12,8 / 12,4 / 12,9 | (16 è il tetto su `concept-map`) |
| 1 MiB, commit di uno spostamento | 10 | 82,6 / 82,0 / 82,5 | 99,0 / 98,6 / 99,1 | ≤ 50: **no** |
| 1 MiB, reimport col testo intero | 20 | 91,7 / 91,6 / 92,2 | 96,9 / 94,4 / 94,5 | ≤ 150: **sì** |

I tetti di anteprima e reimport sono rispettati con margine. Il commit è
sotto il millisecondo su `concept-map` e intorno ai 100 ms al 95° percentile
sul disegno di 1 MiB: se il tetto di 50 ms vale anche lì, non è rispettato,
e il numero vero è questo.

## 2026-11-13, il commit sul disegno di 1 MiB (T34)

Stessa macchina, ramo `piano/k5-disegno` da `026b902ec`; tre giri della prova
`latenze` per lato, 10 commit per giro sul disegno di 1 MiB, `nice -n 19`,
carico a un minuto fra 1,55 e 1,71 prima e dopo ogni giro (un altro coder
aveva appena finito di compilare). «Prima» è `differenza.rs` di `026b902ec`
nello stesso albero, «dopo» il commit di T34.

Dove andavano i millisecondi (tempi a mano per fase con `Instant`, poi tolti;
`perf` non c'è): su 82 ms, 73 erano `proprieta_uguali` sul livello, che
scriveva in JSON tutto il sottoalbero (tutto il disegno) per poi togliere i
figli. Il resto: 3,6 ms gli eventi nella sessione del motore (il rilascio e
il commit di VectorCraft), 4 ms la Selezione che rilegge il colpo
(`hit_test` di VectorCraft, che guarda gli oggetti dall'alto: il primo
oggetto del disegno è il caso peggiore), 1,9 ms il resto della differenza
(i due indici dei posti, l'ordine dei fratelli), 0,2 ms il ritorno della
sessione alla copia. Ora `proprieta_uguali` scrive il nodo senza figli, e
il confronto di due oggetti prende per uguali i rami che il documento dopo
il gesto condivide con la copia (`Arc::ptr_eq`) invece di confrontarli
campo per campo. Le operazioni scritte non cambiano.

| Misura | p50 (ms), tre giri | p95 (ms), tre giri | Tetto di A8 |
|---|---|---|---|
| 1 MiB, commit di uno spostamento, prima | 81,4 / 81,2 / 81,7 | 99,1 / 99,3 / 99,2 | ≤ 50: **no** |
| 1 MiB, commit di uno spostamento, dopo | 9,1 / 9,2 / 9,2 | 9,3 / 9,9 / 9,4 | ≤ 50: **sì** |
| `concept-map`, commit di uno spostamento, prima | 0,44 / 0,45 / 0,44 | 0,45 / 0,68 / 0,45 | ≤ 50: sì |
| `concept-map`, commit di uno spostamento, dopo | 0,11 / 0,11 / 0,11 | 0,12 / 0,20 / 0,12 | ≤ 50: sì |

Anteprima (p95 12,3–12,5 ms) e reimport (p95 94,6–96,3 ms) restano quelli
della sezione sopra.

### Il confronto con `main`

Il client senza motore (`main` a `44940db8c`, in un worktree a parte, poi
tolto) fa lo stesso spostamento di (25, 25) del primo gruppo, sullo stesso
file generato allo stesso modo (1 048 598 byte), in un test Vitest
temporaneo: `moveOps` scrive le operazioni, `SceneEngine.apply` le applica al
testo e alla scena, l'indice degli oggetti si rifà (`PaintBuilder` e
`SceneIndexer`, come dopo ogni passo). Tre giri, 10 commit misurati per giro
dopo 3 di riscaldamento; senza il disegno nel DOM.

| Fase nel client di `main` | p50 (ms), tre giri | p95 (ms), tre giri |
|---|---|---|
| le operazioni (`moveOps`) | 0,04 / 0,04 / 0,04 | 0,08 / 0,08 / 0,08 |
| applicarle (`SceneEngine.apply`) | 1,9 / 1,9 / 1,8 | 2,7 / 2,3 / 2,0 |
| rifare l'indice | 15,6 / 16,4 / 15,7 | 17,0 / 17,7 / 16,1 |

Sul ramo il client applica le stesse operazioni e rifà lo stesso indice:
il motore prende il posto di `moveOps` e aggiunge circa 9 ms (più l'IPC) a un
commit che nel client costa circa 18 ms. Il tempo che cresce ancora col
disegno sta per due terzi in VectorCraft (gli eventi del commit e
`hit_test`, circa 7,5 ms), e per il resto negli indici dei posti della
differenza (circa 1,7 ms).
