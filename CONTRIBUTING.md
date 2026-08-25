# Contribuire a Fub

Questo documento è la fonte autorevole per il ciclo locale, la forma dei
contributi e i controlli da eseguire. Le regole architetturali sono spiegate in
[`docs/architecture/`](docs/architecture/overview.md).

## Prerequisiti

- Rust 1.89;
- Node.js 22;
- npm e il lockfile committato;
- Tauri CLI v2 per avviare l'app desktop;
- dipendenze di sistema richieste da Tauri;
- `cargo-deny` soltanto per il controllo della supply chain;
- target `wasm32-wasip2` per i test completi del runtime WASM.

Usa `npm ci`, non sostituire npm con un altro package manager.

## Ciclo locale

Dalla radice:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
```

Dentro `frontend/`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run bench:a11y
npm run bench:verify
```

Per la documentazione:

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-doc-orphans.mjs
node .github/scripts/check-doc-size.mjs
node .github/scripts/check-mermaid.mjs --render
node .github/scripts/check-markdown-style.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
node .github/scripts/check-locale-loop.mjs
```

I comandi seguenti costituiscono il nucleo che deve rimanere presente in CI.

<!-- ci-required:start -->
```text
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run typecheck
npm test
npm run build
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-doc-orphans.mjs
node .github/scripts/check-doc-size.mjs
node .github/scripts/check-markdown-style.mjs
node .github/scripts/check-mermaid.mjs --render
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
node .github/scripts/check-locale-loop.mjs
```
<!-- ci-required:end -->

Alcuni job eseguono controlli aggiuntivi per target, feature, supply chain,
baseline visuali e invarianti del repository. La fonte eseguibile resta
[`.github/workflows/`](.github/workflows/).

## Scegliere il test corretto

| Modifica | Verifica minima aggiuntiva |
|---|---|
| Contratto Rust o WIT | conformità, additività, frozen WIT e mirror TypeScript |
| Kernel o storage | test del crate e integrazione con `fub-testkit` |
| Provider | test con `MemoryHost` e, se attraversa il core, integrazione reale |
| Frontend | Vitest vicino al modulo, type-check e build |
| Tema o resa | generazione, verifica, banco visuale e accessibilità |
| Runtime WASM | build dell'esempio, test di permessi, limiti e teardown |
| Documentazione | tutti i guard documentali |

Un test focalizzato aiuta durante lo sviluppo. Prima della PR, una modifica
trasversale deve eseguire il ciclo completo pertinente.

## Branch, commit e pull request

Lavora su un branch dedicato. Non inserire modifiche non collegate nella stessa
PR.

Formato del commit:

```text
tipo(scope): frase in italiano
```

Tipi consigliati: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `style`,
`ci`. La frase descrive il cambiamento, non l'elenco dei file.

La PR deve indicare:

- problema e risultato;
- confini o contratti toccati;
- test eseguiti;
- issue chiuse o collegate;
- migrazioni e compatibilità, quando esistono.

## Modificare il contratto

Prima di cambiare un tipo condiviso:

1. verifica che appartenga davvero a `fub-abi`;
2. aggiorna Rust, WIT e proiezioni necessarie;
3. preserva l'additività rispetto a `wit/frozen/`;
4. aggiorna i test di conformità;
5. descrivi la motivazione in un ADR se la scelta è costosa da invertire.

Non introdurre IPC dedicato quando un registro generico esprime già il caso.

## Modificare la documentazione

Segui
[`docs/development/documentation-style.md`](docs/development/documentation-style.md).

Una pagina canonica descrive il presente. Un lavoro aperto diventa una GitHub
Issue. Una decisione architetturale usa il template ADR. Non creare cartelle
`archive`, alias Markdown o verbali di implementazione.

## Baseline visuali

Le baseline canoniche sono Linux-specifiche. Non committare differenze
generate su un altro sistema operativo. Quando il cambiamento è intenzionale,
rigenera nell'ambiente del runner, esamina il foglio di contatto e spiega la
variazione nella PR.
