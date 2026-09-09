# Runtime dei plugin

> **Domanda:** come usa Fub gli stessi contratti per provider nativi e
> componenti WASM, applicando permessi e limiti in un solo punto?
> **Fonti autorevoli:** `crates/fub-abi/src/traits.rs`,
> `crates/fub-host/src/mount.rs`, `crates/fub-wasm-host/src/`.

## Modello

```mermaid
flowchart LR
    BUNDLE_N["bundle nativo"] --> REG["BundleRegistry"]
    COMPONENT["componente WASM"] --> ADAPTER["WasmBundle e proxy"]
    ADAPTER --> REG
    REG --> TRAITS["trait di fub-abi"]
    TRAITS --> KERNEL["registri del kernel"]
```

Un bundle fornisce manifest, fiducia, plugin e registrazioni. Il registry monta
le registrazioni e conserva l'ownership necessaria allo smontaggio.

## Provider nativo

Un provider nativo implementa il trait Rust direttamente. Il composition root
gli consegna un `HostApi` protetto dalla policy.

Essere nativo non significa poter ignorare il contratto: comandi, view ed eventi
devono comunque usare tipi ed errori condivisi.

## Provider WASM

`fub-wasm-host`:

1. carica il componente;
2. genera i binding dal WIT vivo;
3. traduce manifest e tipi;
4. implementa i trait Rust come proxy;
5. monta il bundle nella stessa porta del backend nativo.

```mermaid
sequenceDiagram
    participant GUEST as Guest WASM
    participant PROXY as fub-wasm-host
    participant GUARD as Guard HostApi
    participant CORE as Kernel

    CORE->>PROXY: trait call
    PROXY->>GUEST: export WIT
    GUEST->>PROXY: host function
    PROXY->>GUARD: richiesta tipizzata
    GUARD->>GUARD: capability e scope
    GUARD->>CORE: operazione concessa
    CORE-->>GUARD: esito
    GUARD-->>GUEST: valore o errore
```

## Discovery nativa

`discover` in `crates/fub-wasm-host/src/discovery.rs` legge una directory scelta
dall'host e restituisce i candidati `.wasm` in ordine deterministico. Mantiene
l'errore di ciascun file e non scambia una directory illeggibile per un elenco
vuoto. Non visita sottodirectory e non segue link simbolici.

Caricare non significa attivare. I manifest vengono letti senza un host del
vault; tutti i candidati ricevono `Trust::Community`. La compatibilità ABI e
la dichiarazione passano dal mount comune. Prima di ricordare un candidato,
il chiamante deve rifiutare id duplicati o già occupati: `remember` non è una
porta per sostituire implicitamente una feature esistente.

Il percorso è disponibile per gli host nativi e per il banco degli autori,
non come installer del desktop. Non interpreta `.fub/plugins/` come codice e
non persiste il consenso dell'utente. La procedura è in
[`../development/plugin-authoring.md`](../development/plugin-authoring.md).

## Capability

Il runtime non replica la policy. Riceve un `HostApi` già incappucciato dal
`Guard` del kernel.

Le interfacce host vengono linkate una alla volta. Se un componente importa una
famiglia non disponibile, l'istanza non viene montata e l'errore nomina la
famiglia.

## Sandbox

Il component model isola la memoria. Il runtime corrente:

- non collega WASI;
- non concede filesystem o rete diretti;
- impone un limite alla memoria lineare;
- usa epoch interruption per la deadline;
- converte trap e timeout in `PluginError`;
- limita la profondità delle conversioni ricorsive;
- mantiene vivo l'host dopo il fallimento di un componente.

Il lavoro lungo passa dai job. Una chiamata di trait breve non è il posto per
una computazione senza limite.

## Istanza e non rientranza

Plugin e provider dello stesso componente condividono lo stato della medesima
istanza. Un mutex rende esplicita la non rientranza richiesta dal component
model; non offre esecuzione concorrente dentro l'istanza.

Il collegamento temporaneo fra `WasmBundle::plugin` e `register` è debole:
se l'attivazione fallisce, il bundle noto non mantiene in vita lo store.
Il registry possiede il plugin attivo e rimuove dichiarazione e provider anche
se il guest fallisce durante la disattivazione. Un nuovo mount crea una nuova
istanza, non riattiva la memoria della precedente.

Le host function che accodano lavoro non lo eseguono immediatamente durante la
chiamata guest.

## UI non fidata

`UiNode` contiene forme riservate al codice fidato, come HTML o webview. Il
giorno in cui `ViewProvider` attraversa WASM, ogni albero deve passare da
`UiNode::validate_untrusted()` prima della shell.

Questa proprietà non è ancora esercitata end-to-end ed è tracciata in
[#10](https://github.com/Fubeo/Fub/issues/10).

## Stato di M5

| Capacità | Stato |
|---|---|
| lifecycle `Plugin` | presente |
| `CommandProvider` | presente |
| lettura modello | presente |
| eventi host | presente |
| timeout e memoria | presenti |
| capability negate | presenti |
| discovery da directory esplicita | presente per host nativi |
| `ViewProvider` | da completare |
| altri provider | da completare su casi reali |
| installazione e consenso nel desktop | da completare |
| UI non fidata | da completare |

Vedi [`../project/m5-wasm-runtime.md`](../project/m5-wasm-runtime.md).

## Invarianti

- Wasmtime resta in `fub-wasm-host`;
- il kernel non distingue il backend;
- un solo `Guard` applica la policy;
- nessuna famiglia host è concessa implicitamente;
- mount parziale e teardown incompleto sono errori;
- un componente incompatibile viene rifiutato prima dell'attivazione.
