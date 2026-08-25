# Creare un componente WASM sperimentale

> **Stato:** guida per contributori durante la milestone M5. Il runtime sa
> caricare e collaudare componenti compatibili, ma Fub non offre ancora un
> flusso utente per scoprire e installare automaticamente un `.wasm` dal vault.

Questa pagina spiega come preparare un componente che il banco di
`fub-wasm-host` può compilare, caricare e montare. Non descrive un sistema di
plugin già distribuito agli utenti.

## Prerequisiti

- Rust 1.89;
- il target `wasm32-wasip2`;
- una copia del contratto WIT corrente di Fub;
- familiarità con l'esempio [`ping-wasm`](04-esempio-ping.md).

```bash
rustup target add wasm32-wasip2
```

Durante M5 il riferimento canonico resta
[`crates/fub-abi/wit/fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit). Non
esiste ancora un pacchetto pubblico che sostituisca quel contratto nella catena
di distribuzione.

## Partire dall'esempio

La base più affidabile è la struttura di
[`esempi/ping-wasm/`](../../esempi/ping-wasm):

```text
mio-plugin-wasm/
├── Cargo.toml
├── src/
│   └── lib.rs
└── wit/
    └── mio-plugin.wit
```

Il manifest deve produrre una `cdylib` per il component model. La versione di
`wit-bindgen` va mantenuta allineata a quella usata dall'esempio verificato in
CI.

```toml
[package]
name = "mio-plugin-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.60"
```

Un componente di prova può vivere fuori dal workspace principale, come gli
esempi esistenti. In questo modo `cargo test --workspace` non richiede il target
WASM a chi lavora soltanto sui crate nativi.

## Dichiarare un mondo minimo

Non esportare il mondo generale del contratto quando il componente implementa
soltanto alcune interfacce. Dichiarare invece un mondo locale con ciò che viene
usato davvero.

Esempio per un plugin che espone comandi, legge documenti e usa l'orologio:

```wit
package esempio:mio-plugin@0.1.0;

world mio-plugin {
    import fub:abi/host-env@0.1.1;
    import fub:abi/host-vault-read@0.1.1;

    export fub:abi/plugin@0.1.1;
    export fub:abi/command@0.1.1;
}
```

La regola è semplice:

- ogni `import` è una capacità richiesta all'host;
- ogni `export` è un'interfaccia implementata dal componente;
- una famiglia non servita causa un rifiuto esplicito al caricamento;
- un'operazione protetta richiede anche il permesso corrispondente nel manifest.

## Generare i binding

`wit_bindgen::generate!` deve vedere sia il contratto di Fub sia il mondo locale.
I percorsi dipendono da dove si trova il progetto:

```rust
wit_bindgen::generate!({
    path: ["percorso/al/contratto/fub", "wit"],
    world: "esempio:mio-plugin/mio-plugin",
    generate_all,
});
```

Nel repository, [`ping-wasm/src/lib.rs`](../../esempi/ping-wasm/src/lib.rs)
mostra la forma compilata e verificata. È preferibile adattare quel codice
invece di ricopiare in questa guida una seconda implementazione completa che
potrebbe divergere.

## Implementare il contratto

Un componente utile al banco deve almeno:

1. esportare `fub:abi/plugin`;
2. restituire un manifest con identificativo, versione ABI e permessi;
3. implementare attivazione, disattivazione e gli eventuali job;
4. implementare ogni altra interfaccia esportata dal mondo locale;
5. mantenere comandi e risorse nel namespace dichiarato dal manifest.

Per un provider di comandi, il sorgente dell'esempio mostra anche specifiche,
parametri, convalida ed esiti annidati. Le forme del contratto non vanno
reinventate in JSON arbitrario: i binding generati sono il confine tipizzato.

## Compilare

Dalla directory che contiene il progetto:

```bash
cargo build --target wasm32-wasip2
```

Per un progetto mantenuto dentro questa repo, usare un comando esplicito dalla
radice:

```bash
cargo build --manifest-path percorso/al/Cargo.toml --target wasm32-wasip2
```

## Collegarlo al banco

Oggi la verifica richiede un test di integrazione che:

1. compili o individui l'artefatto prodotto;
2. lo carichi con `WasmBundle::from_file`;
3. scelga il livello di fiducia assegnato dall'host;
4. apra un vault di prova;
5. monti il bundle attraverso il registro;
6. interroghi il registro o invochi il comportamento esportato;
7. smonti il bundle e controlli il ciclo di chiusura.

Usare come riferimenti eseguibili:

- [`the_first_component.rs`](../../crates/fub-wasm-host/tests/the_first_component.rs) per caricamento, ciclo di vita, permessi e capacità;
- [`commands_cross_the_boundary.rs`](../../crates/fub-wasm-host/tests/commands_cross_the_boundary.rs) per un provider registrato e invocato attraverso il contratto comune;
- [`tests/common/mod.rs`](../../crates/fub-wasm-host/tests/common/mod.rs) per la compilazione riproducibile degli esempi.

```bash
cargo test -p fub-wasm-host --test the_first_component
cargo test -p fub-wasm-host --test commands_cross_the_boundary
```

## Installazione nell'app

Non copiare il componente in `.fub/plugins/` aspettandosi che Fub lo scopra. Il
percorso di installazione utente, l'inventario dei bundle esterni e la loro
attivazione automatica non sono ancora completi.

Finché M5 resta aperta, un componente nuovo entra nel progetto attraverso un
esempio e un test di integrazione. Diventerà un plugin installabile soltanto
quando scoperta, formato del bundle, provenienza, aggiornamento e disattivazione
saranno collegati alla shell e documentati come percorso stabile.

Lo stato corrente è in [`../PIANO.md`](../PIANO.md) e nella milestone
[`M5-wasm-runtime.md`](../milestones/M5-wasm-runtime.md).
