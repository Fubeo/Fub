# L'esempio `ping-wasm`

> **Stato:** esempio di integrazione della milestone M5. Non è ancora un plugin
> che l'utente può installare copiando un file dentro il vault.

[`esempi/ping-wasm/`](../../esempi/ping-wasm) è il componente più piccolo che
attraversa davvero il runtime Wasmtime di Fub. Serve a provare il contratto e il
backend WASM, non a simulare il futuro sistema di distribuzione.

## Cosa dimostra

| Parte | Prova eseguibile |
|---|---|
| Ciclo di vita | Il componente viene caricato, attivato, montato, interrogato, smontato e disattivato. |
| Permessi | La lettura del vault riesce soltanto quando il manifest dichiara `fub:read-vault`. |
| Capacità dell'host | Il componente usa l'orologio e legge `Nota.md` attraverso le interfacce WIT collegate dall'host. |
| Comandi | Le specifiche e gli esiti del provider di comandi attraversano il confine e arrivano nel registro comune. |
| Errori | Errori del contratto, permessi negati e famiglie non servite restano esiti leggibili invece di diventare risposte plausibili. |
| Parità | Il kernel vede gli stessi trait usati dai provider nativi; la differenza resta nell'adattatore del runtime. |

## Struttura dell'esempio

| Percorso | Ruolo |
|---|---|
| [`Cargo.toml`](../../esempi/ping-wasm/Cargo.toml) | Dichiara una libreria `cdylib`, il target component model e la dipendenza da `wit-bindgen`. |
| [`wit/ping.wit`](../../esempi/ping-wasm/wit/ping.wit) | Definisce un mondo locale con le sole importazioni ed esportazioni usate dall'esempio. |
| [`src/lib.rs`](../../esempi/ping-wasm/src/lib.rs) | Implementa il manifest, il ciclo di vita, i job e il provider di comandi. |

Il componente non dipende dal crate Rust `fub-abi`. Compila contro il contratto
WIT, come farebbe codice prodotto da un'altra toolchain compatibile con il
component model.

Il mondo principale è volutamente piccolo:

```wit
package esempio:ping@0.1.0;

world ping {
    import fub:abi/host-env@0.1.1;
    import fub:abi/host-vault-read@0.1.1;

    export fub:abi/plugin@0.1.1;
    export fub:abi/command@0.1.1;
}
```

Un componente dichiara soltanto le famiglie che usa. L'host risolve ogni
interfaccia esportata e rifiuta al caricamento una famiglia importata che non sa
servire.

## Compilazione

Dalla radice del repository:

```bash
rustup target add wasm32-wasip2
cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2
```

`wasm32-wasip2` produce un componente. Il target `wasm32-unknown-unknown`
produrrebbe invece un modulo core e richiederebbe un passaggio di conversione
che questo esempio evita.

## Verifica reale

I test compilano il componente da soli, lo caricano con `WasmBundle::from_file`
e lo montano su un host headless:

```bash
cargo test -p fub-wasm-host --test the_first_component
cargo test -p fub-wasm-host --test commands_cross_the_boundary
```

- [`the_first_component.rs`](../../crates/fub-wasm-host/tests/the_first_component.rs) verifica ciclo di vita, permessi, job, dati e famiglie non servite.
- [`commands_cross_the_boundary.rs`](../../crates/fub-wasm-host/tests/commands_cross_the_boundary.rs) verifica registrazione, convalida, invocazione ed esiti dei comandi.

## Cosa non dimostra

L'esempio non prova ancora:

- scoperta automatica dei componenti da una cartella del vault;
- installazione, aggiornamento o disinstallazione dalla shell;
- un formato pubblico e stabile per distribuire bundle di terzi;
- adattatori WASM completi per ogni famiglia di provider del contratto.

Queste parti appartengono al lavoro residuo di
[`M5-wasm-runtime.md`](../milestones/M5-wasm-runtime.md). La guida per creare un
nuovo esperimento compatibile è in
[`05-creare-un-plugin.md`](05-creare-un-plugin.md).
