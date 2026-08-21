# Guida Pratica: Creare un Plugin WebAssembly

Questa guida spiega passo dopo passo come scrivere, compilare e collaudare una nuova estensione WebAssembly per Fub.

---

## 1. Prerequisiti

1. **Rust** installato (versione ≥ 1.89).
2. Il target WebAssembly Component Model installato tramite `rustup`:
   ```bash
   rustup target add wasm32-wasip2
   ```

---

## 2. Creare il progetto

Crea una nuova cartella per il plugin fuori dal workspace principale (es. `mio-plugin/`):

```bash
cargo new --lib mio-plugin
cd mio-plugin
```

Nel file `Cargo.toml`, configura la libreria come `cdylib` e aggiungi `wit-bindgen`:

```toml
[package]
name = "mio-plugin"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.60"

[profile.release]
strip = true
opt-level = "s"
```

---

## 3. Definire il world WIT del plugin (`wit/mio-plugin.wit`)

Invece di esportare `fub:abi/plugin-world` (che costringerebbe ad implementare tutte le 11 interfacce del contratto), ogni plugin dichiara un proprio `world` locale contenente solo le interfacce esportate e importate effettivamente:

```wit
package mio-namespace:mio-plugin@0.1.0;

world mio-plugin {
    export fub:abi/plugin@0.1.1;
}
```

---

## 4. Scrivere il codice del plugin (`src/lib.rs`)

Nel file `src/lib.rs`, usa la macro `wit_bindgen::generate!` per generare i binding a partire dai file WIT, e implementa il trait `Guest`:

```rust
// Genera i tipi per il world definito nel plugin
wit_bindgen::generate!({
    path: ["percorso/verso/fub-abi/wit/fub", "wit"],
    world: "mio-plugin",
    generate_all,
});

use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;

struct MioPlugin;

impl Guest for MioPlugin {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "community.mio-plugin".to_string(),
            name: "Mio Plugin".to_string(),
            version: "0.1.0".to_string(),
            abi_version: "0.1.1".to_string(),
            permissions: PluginPermissions { granted: vec![] },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(_job: String, _payload: String) -> Result<String, PluginError> {
        Ok("ok".to_string())
    }
}

export!(MioPlugin);
```

---

## 5. Compilare il file `.wasm`

Esegui la compilazione specificando il target WebAssembly Component Model:

```bash
cargo build --target wasm32-wasip2 --release
```

Il file generato si troverà in:
`target/wasm32-wasip2/release/mio_plugin.wasm`

---

## 6. Installare e provare il plugin

1. Apri la cartella del tuo vault in Fub.
2. Posiziona il file `.wasm` compilato dentro `.fub/plugins/mio_plugin.wasm`.
3. Avvia Fub: il manifest del plugin verrà caricato e i comandi registrati appariranno nella palette.

---

## Se vuoi il dettaglio

- Guarda [`docs/04-plugin/04-esempio-ping.md`](./04-esempio-ping.md) per l'analisi del codice di riferimento di `ping-wasm`.
- Guarda [`docs/06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md) per tutte le interfacce disponibili nel file `abi.wit`.

