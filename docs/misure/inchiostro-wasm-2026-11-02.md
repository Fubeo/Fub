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
  poi `cd apps/client && npm run bench:ink`, due giri.

## La macchina

- server-di-fub: AMD Ryzen 7 7730U, 16 nuclei logici, 15 GiB di memoria;
- Debian GNU/Linux 13, kernel 6.12.111;
- Node.js 22.23.3 (V8) sotto Vitest 5, ambiente `node`; Rust 1.95.0.

**La macchina era carica**: altri lavori compilavano e provavano il
workspace nello stesso momento. Il carico (`uptime`, media di un minuto):

| Giro | All'inizio | Alla fine |
|---|---|---|
| 1 | 17,87 | 14,13 |
| 2 | 14,13 | 20,16 |

I numeri servono a vedere il verso e l'ordine di grandezza, non un
decimale. La misura va rifatta a macchina scarica.

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

Nanosecondi per evento, mediana; fra parentesi il secondo giro.

| Scenario | TypeScript | WebAssembly | Tratto in una chiamata | Solo copie |
|---|---|---|---|---|
| mouse, senza coalescenti | 215 (251) | 1 023 (1 390) | 171 (177) | 150 (151) |
| penna 240 Hz, 4 coalescenti, 3 predetti | 2 908 (3 568) | 3 132 (3 834) | 587 (588) | 2 530 (2 837) |
| penna con stabilizzatore a media | 3 130 (3 880) | 5 570 (4 011) | 1 173 (1 183) | 3 168 (2 906) |

La prima chiamata:

| Passo | Giro 1 | Giro 2 |
|---|---|---|
| compilare il modulo | 3 529 µs | 6 166 µs |
| istanziarlo | 128 µs | 128 µs |
| primo tratto del mouse, a freddo | 9 923 µs | 12 174 µs |
| tratto del mouse, secondo → ultimo del riscaldamento | 5 449 → 1 659 µs | 6 536 → 3 427 µs |

Nello stesso `npm run bench:ink`, `pipeline.bench.ts` (ambiente
`happy-dom`) ha dato per il riduttore TypeScript 310 (246), 4 831 (8 891) e
3 523 (11 561) ns per evento: più alti e più sparsi di quelli dello stesso
riduttore nella colonna TypeScript qui sopra, che gira nello stesso processo
del WebAssembly. Il confronto si fa sulle colonne di `wasm.bench.ts`.

## La condizione del passo 12a

La condizione è «l'inchiostro in WebAssembly non è più lento di quello
TypeScript». Su questa macchina, carica, **non è vera**: nel percorso che
avrebbe la shell, un evento per chiamata, il WebAssembly è più lento in
tutti e tre gli scenari e in tutti e due i giri.

Il riduttore da solo, senza il confine, è più veloce della copia
TypeScript in tutti e tre gli scenari. La differenza la fanno le copie
dentro e fuori e le chiamate attraverso il confine.
