# Contribuire a Fub

Fub ha un solo manutentore. Questo documento definisce il percorso locale, i confini architetturali e le condizioni minime per una modifica accettabile.

## Prima di iniziare

| Obiettivo | Documento |
|---|---|
| Capire il progetto | [docs/getting-started/overview.md](docs/getting-started/overview.md) |
| Individuare il componente | [docs/reference/crates.md](docs/reference/crates.md) |
| Modificare un contratto | [docs/reference/rust-contracts.md](docs/reference/rust-contracts.md) |
| Toccare la shell | [docs/architecture/ui-shell.md](docs/architecture/ui-shell.md) |
| Lavorare sui plugin | [docs/architecture/plugin-boundary.md](docs/architecture/plugin-boundary.md) |
| Capire una scelta passata | [docs/decisions/README.md](docs/decisions/README.md) |

## Ciclo locale

Esegui dalla radice della repository:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd frontend && npm run typecheck
cd frontend && npm test
cd frontend && npm run build
cd frontend && npm run bench:a11y
cd frontend && npm run bench:verify
node .github/scripts/check-listeners.mjs
node .github/scripts/check-races.mjs
node .github/scripts/check-npm-copies.mjs
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
node .github/scripts/check-cargo-versions.mjs
node .github/scripts/check-cargo-feature-default.mjs
node .github/scripts/check-crate-type.mjs
node .github/scripts/check-dev-profile.mjs
cargo build -p fub-features --no-default-features
cargo build -p fub-features --no-default-features --features outline
cargo build -p fub-host --no-default-features --features outline,notify-watcher
node .github/scripts/check-locale-loop.mjs
cargo deny check
```

### Le eccezioni al ciclo

Questi comandi sono eseguiti dalla CI ma richiedono target o ambienti aggiuntivi:

- `cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc` — richiede il target MSVC.
- `cargo build --manifest-path tools/varco-wasm/Cargo.toml --target wasm32-unknown-unknown` — verifica i binding guest del contratto.
- `cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2` — costruisce il componente di esempio.

Su Linux servono le dipendenze di sistema indicate in [docs/getting-started/install-and-run.md](docs/getting-started/install-and-run.md).

## Invarianti

- `fub-abi` e `fub-kernel` non dipendono da Tauri, Wasmtime o Comrak.
- `fub-host` non dipende da Tauri.
- Rust e WIT descrivono lo stesso contratto.
- Il contratto congelato cresce soltanto per aggiunta.
- Le feature ufficiali si possono disattivare senza trascinare moduli estranei.
- La shell usa i canali generici di query, comandi e view invece di IPC speciali.
- La documentazione non presenta una proposta come comportamento disponibile.

## Commit e pull request

Formato del commit:

```text
tipo(scope): frase in italiano
```

Tipi ammessi: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`, `ci`.

Ogni commit deve lasciare l'albero coerente. Una pull request descrive:

1. problema;
2. soluzione;
3. alternative scartate;
4. test eseguiti;
5. documenti e ADR aggiornati.

## Documentazione

- una pagina risponde a una domanda;
- una sola fonte autorevole per tema;
- niente redirect o archivi interni;
- i fatti derivabili dal codice sono generati o verificati;
- Mermaid deve restare leggibile in tema chiaro e scuro;
- il lavoro aperto vive nelle issue;
- una proposta architetturale aperta vive in `docs/rfcs/`.

Le regole complete sono in [docs/README.md](docs/README.md).

## Versionamento

Il workspace usa SemVer. Finché la major è `0`, una minor può contenere cambi incompatibili. Il contratto dei plugin e gli schemi su disco hanno versioni proprie perché fanno promesse diverse:

| Versione | Promessa |
|---|---|
| Workspace | A chi compila il prodotto |
| ABI/WIT | A plugin già compilati |
| Schema su disco | Ai file persistenti dell'utente |

Un cambio di schema autorevole richiede migrazione o rifiuto esplicito; un formato derivato può essere ricostruito. I dettagli implementativi sono in [docs/reference/on-disk-layout.md](docs/reference/on-disk-layout.md) e [docs/reference/wit-contract.md](docs/reference/wit-contract.md).
