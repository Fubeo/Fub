# Plugin ed estensioni

> **Per chi:** chi vuole capire come Fub cresce senza modificare il kernel.
> **Risultato:** distinguere feature ufficiali, provider nativi e componenti WASM.

## Tre livelli

### Feature ufficiali

Vivono in `fub-features` e sono abilitate da feature Cargo indipendenti. Sono
codice fidato distribuito con l'app, ma entrano attraverso gli stessi trait e
registri usati dalle estensioni.

### Provider nativi

Sono oggetti Rust montati dall'host. Hanno accesso soltanto ai servizi forniti
dal contratto, ma condividono il processo e il livello di fiducia del binario.

### Componenti WASM

Sono componenti `wasm32-wasip2` caricati da `fub-wasm-host`. L'adattatore
implementa i trait Rust e reinoltra le chiamate attraverso il component model.

```mermaid
flowchart LR
    NATIVE["provider nativo"] --> TRAIT["trait di fub-abi"]
    WASM["componente WASM"] --> PROXY["proxy fub-wasm-host"]
    PROXY --> TRAIT
    TRAIT --> KERNEL["registri del kernel"]
```

Il kernel riceve il trait, non un enum `Native | Wasm`.

## Cosa può registrare un bundle

Il contratto comprende famiglie per:

- formato;
- comando;
- view;
- indice;
- eventi;
- import ed export;
- sintassi e renderer;
- servizi.

Un bundle dichiara manifest, versione ABI, fiducia, permessi e registrazioni.
L'host possiede mount, attivazione, disattivazione e smontaggio.

## Permessi

I permessi sono capability con namespace e, quando serve, parametri. Il kernel
applica la policy tramite un solo `Guard`.

Un componente WASM non riceve filesystem o rete direttamente. Le host function
inoltrano a un `HostApi` già protetto. Le famiglie non linkate rendono
impossibile il mount e vengono nominate nell'errore.

## Stato del runtime WASM

Funzionano:

- caricamento e istanziazione di un componente;
- manifest e lifecycle `Plugin`;
- `CommandProvider`;
- lettura del modello;
- eventi host;
- errori e permessi tipizzati;
- timeout a epoche;
- limite di memoria;
- teardown e parità col backend nativo nei casi coperti.

Non sono ancora completi:

- discovery e installazione da un percorso supportato;
- tutti i proxy dei provider;
- una view non banale;
- validazione della UI non fidata;
- guida end-to-end identica al percorso testato.

Vedi [`../project/m5-wasm-runtime.md`](../project/m5-wasm-runtime.md).

## Compatibilità

Il manifest dichiara la versione ABI. L'host accetta la stessa major e una minor
non superiore, perché il contratto congelato cresce soltanto per aggiunta.

Un plugin più nuovo dell'host viene rifiutato prima dell'attivazione. Una
versione non valida non viene interpretata per tentativi.

## Limiti per gli autori

- un componente non invia DOM, callback o estensioni CodeMirror;
- il lavoro breve deve rispettare la deadline;
- il lavoro lungo usa i job;
- una capability non concessa produce un errore, non accesso parziale;
- UI e payload ricorsivi hanno limiti di profondità;
- lo storage è namespaced per plugin;
- la disponibilità di una famiglia host va verificata prima di assumerla.

La procedura tecnica è in
[`../development/plugin-authoring.md`](../development/plugin-authoring.md).
