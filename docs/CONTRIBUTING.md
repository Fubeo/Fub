# Contribuire a Fub

Il progetto ha **un** manutentore. Questo documento dice cosa cambia per chi arriva da fuori. Spiega dove guardare prima di scrivere, quali regole sono inviolabili e come scoprire di aver rotto qualcosa **prima** che lo dica la CI.

Il registro è quello del resto di [`docs/`](README.md): non si ripete la prosa. Usa il link invece di copiare.

## Prima di scrivere una riga

| Voglio… | Leggo |
|---|---|
| capire l'idea architetturale e le decisioni | [PIANO.md](PIANO.md) |
| capire una parola che non conosco | [glossario.md](glossario.md) |
| vedere tutto in un colpo d'occhio | [architecture/mappa-visuale.md](architecture/mappa-visuale.md) |
| toccare un trait del contratto | [architecture/traits.md](architecture/traits.md) e [architecture/wit.md](architecture/wit.md) |
| aggiungere un pannello o una vista | [architecture/ui-protocol.md](architecture/ui-protocol.md) e [architecture/shell.md](architecture/shell.md) |
| sapere perché una cosa è così | [decisions/](decisions/README.md) |
| sapere cosa manca, e le priorità | [todo.md](todo.md) |

Le decisioni storiche hanno un verbale. Leggilo prima di riaprire una discussione.

## Le cinque invarianti che non si negoziano

Non sono raccomandazioni. Un presidio (un test automatico) le difende e diventa **rosso** se violato.

| Invariante | Perché | Chi la fa fallire |
|---|---|---|
| `fub-abi` e `fub-kernel` non conoscono `comrak`, `tauri`, `wasmtime`; `fub-host` non conosce `tauri` | Il core è agnostico al formato. Chi assembla deve potersi avviare senza interfaccia webview. | [`crates/fub-abi/tests/dependency_invariant.rs`](../crates/fub-abi/tests/dependency_invariant.rs) |
| `fub-abi` e `crates/fub-abi/wit/fub/abi.wit` si rispecchiano | Il contratto WIT è il confine per `M5`. Se divergono, il confine si spezza. | [`crates/fub-abi/tests/wit_conformance.rs`](../crates/fub-abi/tests/wit_conformance.rs) |
| il contratto cresce **solo per aggiunta** rispetto a `wit/frozen/` | Garantisce il freeze di `M4`. Senza presidio, la promessa decade in silenzio (vedi [architecture/wit-congelato.md](architecture/wit-congelato.md)). | [`crates/fub-abi/tests/wit_additivity.rs`](../crates/fub-abi/tests/wit_additivity.rs) |
| i link fra documenti e codice non marciscono | Un documento che cita `traits.rs` deve fallire se si sposta. | [`.github/scripts/check-doc-links.mjs`](../.github/scripts/check-doc-links.mjs) |
| il diagramma dei componenti dice le dipendenze che dicono i `Cargo.toml` | Un disegno non compilato mente. Un crate nuovo deve apparire nel diagramma. | [`il_diagramma_dice_le_dipendenze_vere`](../crates/fub-abi/tests/dependency_invariant.rs) |

Puoi rompere intenzionalmente la **terza** regola toccando `0.1.0.wit` in un commit esplicito. Il test lo evidenzierà in review.

La **sesta** regola ("tutta la prosa sta in `docs/`") si basa sulla review manuale. Non c'è uno script che distingua file legittimi da fuoriposto. Un file `README.md` legittimo non fallisce in CI.

## Il ciclo locale

```bash
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# frontend (dentro frontend/)
npx tsc --noEmit      # `vite build` traspila senza controllare i tipi
npm test
npm run build

# shell (dalla radice, come la CI)
node .github/scripts/check-ascoltatori.mjs
node .github/scripts/check-corse.mjs
node .github/scripts/check-npm-copie.mjs

# documenti
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prosa.mjs
node .github/scripts/check-tabelle.mjs

# invarianti
node .github/scripts/check-cargo-versioni.mjs
node .github/scripts/check-cargo-feature-default.mjs

# le feature ufficiali si spengono davvero (§16.3)
cargo build -p fub-features --no-default-features
cargo build -p fub-features --no-default-features --features outline
cargo build -p fub-host --no-default-features --features outline,notify-watcher

# presidio del ciclo stesso
node .github/scripts/check-ciclo-locale.mjs

# supply chain (serve `cargo install cargo-deny`)
cargo deny check
```

### Le eccezioni al ciclo

I comandi della CI elencati di seguito, con la ragione indicata dopo il `—`, non stanno nel ciclo locale:

- `cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc` — Serve il target `x86_64-pc-windows-msvc`.

La CI esegue questi comandi. Se passano in locale, passeranno in CI. I test girano su Linux, macOS e Windows. Qui falliscono di solito i path e lock file di `.fub/data/`. `check-ciclo-locale.mjs` fallisce se c'è un disallineamento fra CI e locale.

I fuzzer del §17.1 girano **dentro** `cargo test --workspace` con seme fisso. Alzare il conteggio serve a cercare bug a mano, non a presidiare:

```bash
FUB_FUZZ_CASI=5000000 cargo test --release -p fub-format-markdown \
  --test il_corpus -- nessuna_mutazione
FUB_FUZZ_TRASFERIMENTO=1000000 cargo test --release -p fub-format-markdown \
  --test transfer_e2e -- no_mutation_of
FUB_FUZZ_NOMI=100000 cargo test --release -p fub-format-markdown \
  --test transfer_e2e -- no_mutated_name
```

Queste non configurano Fub e vivono solo dentro `#[test]`. Delle variabili lette dall'app parla la [decisione 0036](decisions/0036-le-impostazioni-e-i-tre-stati.md).

## Cosa presidia la CI

**Sei** job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

| Job | Cosa presidia | Quando gira |
|---|---|---|
| `invarianti` | le prime **tre** invarianti | push e PR |
| `supply chain` | licenze e advisory secondo [`deny.toml`](../deny.toml), SBOM SPDX 2.3 | push, PR **e** settimanale |
| `fmt + clippy` | formattazione e lint (warning = errori) | push e PR |
| `build + test` | il workspace su Linux, Windows e macOS | push, PR **e** settimanale |
| `docs` | link interni e promessa del ciclo locale | push e PR |
| `frontend` | type-check, test e build della shell | push, PR **e** settimanale |

I job pesanti girano anche di lunedì per controllare le dipendenze e l'ambiente.

## I commit

Il manutentore lavora su `main`. I contributi esterni arrivano via pull request.

Formato: `tipo(scope,scope): frase`.

- **tipo**: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`.
- **scope**: il crate senza `fub-` (`abi`, `kernel`, `host`, `features`, `sdk`, `app`), più `wit`, `frontend`, `docs`, `ci`.
- **frase**: minuscola, in italiano, senza punto finale. Spiega **cosa cambia** e non quali file tocca.

Niente trailer `Signed-off-by` e `Co-Authored-By`. L'autore è chi firma il commit. Un commit lascia l'albero verde e funzionante. Se richiede **due** passaggi, è **un solo** commit.

Non c'è un `CODEOWNERS`. C'è **un solo** manutentore.

## Aggiungere un documento

[README.md](README.md) spiega dove metterlo.

- I nomi sono minuscoli e in italiano.
- I numeri (verbali, voci aperte) vivono in `todo.md` e [decisions/README.md](decisions/README.md).

## Chiudere una decisione

Un verbale nuovo prende il numero successivo libero. I verbali non si riscrivono e non si rinumerano. I dettagli sono in [decisions/README.md](decisions/README.md).

## Il resto

- Vulnerabilità: [SECURITY.md](SECURITY.md).
- Condotta: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Versioni: [versionamento.md](versionamento.md).
- Licenza: `MIT OR Apache-2.0` ([LICENSE-MIT](../LICENSE-MIT), [LICENSE-APACHE](../LICENSE-APACHE)).
