# 2026-11-02, Linux, l'inchiostro in TypeScript e in WebAssembly

Questa pagina conserva la misura del piano N3 (T17): il riduttore
dell'inchiostro (`Session`) nella copia TypeScript del client e la copia
Rust di `crates/fub-ink` compilata in WebAssembly, sugli stessi tratti.

> **Per chi:** chi decide se l'inchiostro può passare a WebAssembly (il passo
> 12a dei piani, la domanda D-4 di N3) e chi rifà la misura.
> **Risultato:** sapere, per ogni scenario, quanti nanosecondi per evento
> costa ognuna delle due copie, e quanto di quel costo è il confine.

È soltanto una misura: la shell non carica il modulo e la decisione 0204
resta com'è.

## Chi, cosa, quando

- commit di base `8bac8f92`, ramo `coder/n3-t17`, 2026-11-02;
- il modulo: `tools/ink-wasm-banco/`, un pacchetto fuori dal workspace che
  dipende soltanto da `crates/fub-ink` ed esporta un'interfaccia C scritta a
  mano (niente `wasm-bindgen`); profilo `release` con `opt-level = 3`, LTO,
  `panic = "abort"`, un'unità di compilazione: 68 949 byte, nessun import;
- il banco: `apps/client/src/ink/wasm.bench.ts`, lanciato da
  `npm run bench:ink` insieme a `pipeline.bench.ts`;
- comandi, dalla radice:
  `cargo build --manifest-path tools/ink-wasm-banco/Cargo.toml --release --target wasm32-unknown-unknown`,
  poi `cd apps/client && npm run bench:ink`, tre giri.

## La macchina

- server-di-fub: AMD Ryzen 7 7730U, 16 nuclei logici, 15 GiB di memoria;
- Debian GNU/Linux 13, kernel 6.12.111;
- Node.js 22.23.3 (V8) sotto Vitest 5, ambiente `node`; Rust 1.95.0.

Ogni giro è partito con il carico medio a un minuto sotto 2,5, a mezzo
minuto dal precedente; sulla macchina girano sempre alcuni servizi
(syncthing, un processo Java, Docker). Il carico (`/proc/loadavg`, media di
un minuto):

| Giro | Ora | All'inizio | Alla fine |
|---|---|---|---|
| 1 | 17:56 | 1,97 | 1,56 |
| 2 | 17:57 | 1,15 | 1,18 |
| 3 | 17:59 | 0,89 | 1,39 |

Un giro dello stesso giorno, alle 11:40 con la macchina carica (carico fra
14 e 20), dava numeri più alti (dal 20% in su, fino a 3,4 volte) e più
sparsi, con lo stesso verso per il mouse e per lo stabilizzatore; per la
penna, a macchina carica, il WebAssembly era più lento dell'8%.

## Come si misura

Gli scenari sono i tre del riduttore di `pipeline.bench.ts`, con gli stessi
dati: un tratto di 2 000 eventi su un cerchio lento, 4 ms fra un evento e
l'altro. Ogni iterazione apre una sessione nuova e fa tutto il tratto; si
gira per un secondo e mezzo almeno e si stampa la mediana, in nanosecondi
per evento.

- **TypeScript**: `Session` di `apps/client/src/ink/input/session.ts`.
- **WebAssembly**: il percorso che avrebbe la shell. Un evento, una
  chiamata: i campioni (15 numeri ciascuno) si copiano nella memoria del
  modulo, il riduttore gira, gli effetti si ricopiano fuori.
- **Tratto in una chiamata**: il riduttore da solo. Il tratto è già nella
  memoria del modulo e una chiamata lo fa tutto.
- **Solo copie**: il confine da solo. Gli stessi campioni dentro e fuori a
  ogni evento, senza riduttore.

La prima chiamata si conta a parte: compilare e istanziare il modulo, il
primo tratto a freddo, poi un secondo e mezzo di riscaldamento su tutti gli
scenari e per le due copie, che aspetta la compilazione ottimizzata del
motore. Le due copie danno lo stesso numero di effetti: il banco lo verifica.

Gli altri due gruppi di `pipeline.bench.ts` (l'adattatore del browser e
l'anteprima del contorno) non hanno una copia Rust in `crates/fub-ink`:
non c'è niente da confrontare.

## I numeri

Nanosecondi per evento, mediana dei tre giri; fra parentesi il più basso e
il più alto dei tre.

| Scenario | TypeScript | WebAssembly | Tratto in una chiamata | Solo copie |
|---|---|---|---|---|
| mouse, senza coalescenti | 140 (139–144) | 601 (595–613) | 144 (142–145) | 121 (118–126) |
| penna 240 Hz, 4 coalescenti, 3 predetti | 1 342 (1 341–1 362) | 1 348 (1 348–1 362) | 489 (489–490) | 1 155 (1 142–1 162) |
| penna con stabilizzatore a media | 1 401 (1 360–1 460) | 1 626 (1 587–1 665) | 798 (796–824) | 578 (575–584) |

Per la penna, «solo copie» ha due modi: la mediana sta intorno a 1 150 ns,
il minimo intorno a 565.

La prima chiamata:

| Passo | Giro 1 | Giro 2 | Giro 3 |
|---|---|---|---|
| compilare il modulo | 2 165 µs | 2 341 µs | 3 022 µs |
| istanziarlo | 80 µs | 92 µs | 101 µs |
| primo tratto del mouse, a freddo | 7 282 µs | 7 606 µs | 8 185 µs |
| tratto del mouse, secondo → ultimo del riscaldamento | 3 089 → 1 175 µs | 3 134 → 1 363 µs | 3 199 → 1 116 µs |

Nello stesso `npm run bench:ink`, `pipeline.bench.ts` (ambiente
`happy-dom`) ha dato per il riduttore TypeScript 135–139, 1 337–1 460 e
1 398–1 495 ns per evento: gli stessi numeri della colonna TypeScript qui
sopra, che gira nello stesso processo del WebAssembly. Il confronto si fa
sulle colonne di `wasm.bench.ts`.

## La condizione del passo 12a

La condizione è «l'inchiostro in WebAssembly non è più lento di quello
TypeScript». Su questa macchina, scarica, **non è vera per intero**: nel
percorso che avrebbe la shell, un evento per chiamata, il WebAssembly è
più lento col mouse (circa 4,3 volte) e con lo stabilizzatore (circa il
16%), in tutti e tre i giri; con la penna a 240 Hz le due copie sono pari
(la differenza sta sotto l'1%).

Il riduttore da solo, senza il confine, è pari alla copia TypeScript col
mouse e più veloce con la penna (circa 2,7 volte) e con lo stabilizzatore
(circa 1,8 volte). La differenza la fanno le copie dentro e fuori e le
chiamate attraverso il confine.
