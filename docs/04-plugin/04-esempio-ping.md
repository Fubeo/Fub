# Walkthrough: Il plugin `ping-wasm`

## 1. L'Idea

L'esempio [`esempi/ping-wasm`](../../esempi/ping-wasm) implementa un plugin WebAssembly minimale con due compiti:
1. Rispondere a un'operazione di verifica ("ping") leggendo una nota (`Nota.md`) e contando i caratteri.
2. Registrare due comandi per la palette (`demo.ping:conta` e `demo.ping:esito-ricco`).

Questo plugin ha un corrispettivo nativo nel test [`crates/fub-host/tests/the_first_plugin.rs`](../../crates/fub-host/tests/the_first_plugin.rs): entrambi eseguono lo stesso compito, dimostrando che Fub tratta codice nativo e WebAssembly con le stesse identiche regole.

---

## 2. I Passi nel codice

### Passo A: Dichiarazione del Manifest
Il plugin dichiara il proprio identificativo (`demo.ping`), la versione del contratto ABI (`0.1.1`) e i permessi richiesti (`fub:read-vault`):

```rust
// Estratto da esempi/ping-wasm/src/lib.rs
fn manifest() -> PluginManifest {
    PluginManifest {
        id: "demo.ping".to_string(),
        name: "Demo Ping (WASM)".to_string(),
        version: "0.1.0".to_string(),
        abi_version: "0.1.1".to_string(),
        permissions: PluginPermissions {
            granted: vec![OptionEntry {
                key: "fub:read-vault".to_string(),
                value: "true".to_string(),
            }],
        },
        // ...
    }
}
```

### Passo B: Attivazione e orologio
Quando Fub attiva il plugin, viene invocata la funzione `activate()`, che memorizza il timestamp di avvio senza richiedere permessi speciali:

```rust
fn activate() -> Result<(), PluginError> {
    let adesso = fub::abi::host_env::now_unix_millis();
    unsafe { ACCESO = adesso; }
    Ok(())
}
```

### Passo C: Esecuzione del comando `conta`
Quando l'utente esegue il comando `demo.ping:conta`, il plugin usa l'interfaccia `HostApi` per leggere il file e restituire il conteggio:

```rust
fn conta() -> Result<CommandOutcome, PluginError> {
    let testo = crate::fub::abi::host_vault_read::read_document("Nota.md")?;
    let caratteri = testo.chars().count();
    Ok(CommandOutcome {
        notify: Some(Text::Literal(format!("{caratteri} caratteri"))),
        // ...
    })
}
```

---

## 3. Il Contratto WIT

Il plugin non include il codice Rust di Fub, ma compila a partire dalle definizioni di interfaccia scritte in WebAssembly Interface Types ([`crates/fub-abi/wit/fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit)).

Questo garantisce che:
1. Il binario `.wasm` sia leggero e indipendente dal compilatore Rust interno di Fub.
2. Il plugin possa essere scritto in futuro in qualunque altro linguaggio (come C, Go, Zig o TypeScript) che supporti WASI 0.2.

---

## Come compilarlo e provarlo

```bash
# Compilazione del plugin WASM
cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2
```

---

## Se vuoi il dettaglio

- Esplora il codice completo in [`esempi/ping-wasm/src/lib.rs`](../../esempi/ping-wasm/src/lib.rs).
- Guarda [`crates/fub-wasm-host/src/component.rs`](../../crates/fub-wasm-host/src/component.rs) per vedere come Fub carica questo file `.wasm`.
