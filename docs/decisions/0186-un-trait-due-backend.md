# 0186 — Provider nativi e WASM implementano lo stesso trait

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** contratto
- **Sostituisce:** 0146, 0165
- **Sostituita da:** —

## Contesto

Un enum `Native | Wasm` nei registri diffonderebbe il backend in kernel,
feature e test. Un runtime separato con API proprie farebbe divergere
compatibilità, permessi ed errori.

## Decisione

`fub-wasm-host` traduce export WIT e host function in proxy che implementano i
trait Rust di `fub-abi`. `WasmBundle` entra nella stessa porta di mount dei
bundle nativi. Wasmtime resta confinato al crate adattatore. Il kernel conserva
oggetti trait e non conosce l'origine.

## Conseguenze

### Positive

- la parità è definita dal comportamento del trait;
- il kernel non dipende da Wasmtime;
- test e registri vengono riusati;

### Negative

- ogni provider attraversato richiede traduzione completa;
- alcune semantiche native devono essere rese esplicite nel WIT;
- il proxy deve gestire istanza, prestiti e non rientranza;

## Alternative scartate

### Registri separati

Raddoppiano dispatch, policy e test.

### WASM soltanto come comando generico

Impedisce formati, view, indici ed eventi come cittadini del contratto.

## Verifica

I test montano backend nativo e WASM e confrontano gli esiti osservabili.
Un guard di dipendenza confina Wasmtime a `fub-wasm-host`.
