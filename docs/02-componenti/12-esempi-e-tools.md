# Esempi WASM e strumenti

Le cartelle [`esempi/`](../../esempi) e [`tools/`](../../tools) restano fuori
dal workspace Rust principale. Richiedono target WebAssembly specifici e non
devono rallentare chi lavora soltanto sul backend nativo.

## Componenti di esempio

| Progetto | Cosa verifica |
|---|---|
| [`ping-wasm`](../../esempi/ping-wasm) | Percorso corretto: manifest, ciclo di vita, capacità dell'host, lettura del vault e provider di comandi. |
| [`ciclo-wasm`](../../esempi/ciclo-wasm) | Componente non collaborativo: risposta normale, ciclo infinito e crescita della memoria, usati per provare scadenza e limite dell'istanza. |
| [`eventi-wasm`](../../esempi/eventi-wasm) | Chiamate dal guest verso l'host durante un job: progresso, emissione di eventi e richiesta di un nuovo job. |
| [`modello-wasm`](../../esempi/modello-wasm) | Passaggio del `DocumentModel` attraverso la rappresentazione ad arena del WIT e rifiuto dei documenti troppo profondi. |

Questi progetti non sono plugin installabili dalla shell. I test li compilano,
li caricano esplicitamente con `fub-wasm-host` e verificano il comportamento su
un host controllato.

## Compilare un componente

I quattro esempi usano il component model e il target `wasm32-wasip2`:

```bash
rustup target add wasm32-wasip2
cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2
```

Il file prodotto per `ping-wasm` si trova sotto la directory `target`
dell'esempio, nel profilo scelto da Cargo.

I test principali compilano gli artefatti da soli:

```bash
cargo test -p fub-wasm-host --test the_first_component
cargo test -p fub-wasm-host --test commands_cross_the_boundary
```

Altri test di `fub-wasm-host` usano gli esempi dedicati a eventi, modello e
limiti.

## `tools/varco-wasm`

[`tools/varco-wasm/`](../../tools/varco-wasm) è un presidio statico del
contratto. Genera binding guest dal WIT e li compila per verificare che il
confine sia rappresentabile dal lato WebAssembly.

Non è un componente eseguito dal runtime e usa un target diverso:

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path tools/varco-wasm/Cargo.toml --target wasm32-unknown-unknown
```

`wasm32-unknown-unknown` produce il modulo usato dal presidio statico;
`wasm32-wasip2` produce invece i componenti caricati nei test del runtime. I due
comandi verificano proprietà diverse e non sono intercambiabili.

## Percorsi successivi

- [`../04-plugin/04-esempio-ping.md`](../04-plugin/04-esempio-ping.md): analisi dell'esempio minimo.
- [`../04-plugin/05-creare-un-plugin.md`](../04-plugin/05-creare-un-plugin.md): guida sperimentale per un nuovo componente.
- [`../06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md): struttura e versionamento del WIT.
- [`08-fub-wasm-host.md`](08-fub-wasm-host.md): runtime e limiti correnti.
