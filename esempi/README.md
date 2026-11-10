# `esempi/` — componenti WASM di prova

Sedici esempi, uno per cosa da dimostrare sul confine WASM. Sono **esclusi
dal workspace** (il `Cargo.toml` radice li elenca in `exclude`) perché sono
`cdylib` per `wasm32-wasip2`, non crate del workspace. Chi li compila sono i
test di `crates/fub-wasm-host`, che fanno `cargo build --target
wasm32-wasip2` da soli e montano il `.wasm` risultante nell'host.

## Gli esempi

- `ping-wasm` — il «ping» dall'altra parte del confine: gemello WASM del primo
  plugin, per provare «un trait, due backend».
- `ciclo-wasm` — il plugin che non collabora: job che non torna mai e job che
  alloca finché il limite non rifiuta.
- `modello-wasm` — il documento visto da dentro il confine: riceve il
  `document-model` come arena e risponde in JSON.
- `eventi-wasm` — il componente che parla per primo: eventi e job dal guest
  verso l'host dentro la chiamata.
- `stallo-wasm` — il deadlock: un job che tiene l'istanza del guest mentre
  chiede un turno di scrittura.
- `format-wasm` — un `FormatProvider` WASM d'esempio.
- `grid-wasm` — il protocollo a byte della famiglia `grid` su righe UTF-8.
- `view-wasm` — una view dichiarativa reale (`UiTree`/`ViewUpdate` dal WIT).
- `event-handler-wasm` — handler inbound: notifiche consegnate e diniego del
  `Guard` senza permesso.
- `index-provider-wasm` — indice inbound persistente con route propria e
  ciclo di vita completo.
- `legacy-format-0_1` — guest pinnato a `fub:abi@0.1.2`: prova la
  retrocompatibilità del formato.

## I nomi con «-prima-»

Significano «compilato contro la versione *prima* di un cambiamento del
contratto WIT», per provare che il confine non regredisce:

- `plugin-prima-del-caso`, `plugin-prima-della-funzione` — `fub:abi@0.2.0`
  prima dei nuovi caso/funzione (issue #289).
- `manifest-prima-di-k1` — manifest con 11 campi invece di 16, prima della
  #285 (ADR 0235).
- `cliente-prima`, `servizio-prima` — guest contro l'interfaccia importata
  «di prima»: si vede cosa succede quando l'host cresce.
