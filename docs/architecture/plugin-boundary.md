# Confine dei plugin: `Plugin`, `HostApi`, capability

Questo documento descrive il **confine di fiducia** tra il core e un plugin —
nativo (M4) o WASM (M5). Il principio: il kernel vede `dyn Trait` e non distingue
un backend dall'altro; la differenza è tutta nel *come* le chiamate attraversano
il confine e in *quali capacità* il core concede.

Torna a [../PIANO.md](../PIANO.md) · vedi [traits.md](traits.md).

## `HostApi`: l'unico varco

Un plugin non tocca mai il filesystem o il bus direttamente: passa da `HostApi`
(vedi firma in [traits.md](traits.md)). Questo dà **un solo punto** in cui
applicare i permessi.

- **Nativo (M4):** `HostApi` è un oggetto in-process che chiama direttamente il
  `Workspace`. Costo ≈ zero.
- **WASM (M5):** il plugin riceve un *proxy* di `HostApi`; ogni metodo è una **host
  function** wasmtime che serializza gli argomenti, attraversa il confine, esegue
  nel core e ritorna. La firma è identica: per questo la regola d'oro impone tipi
  serializzabili.

## Manifest e permessi (stato attuale)

```rust
pub struct PluginManifest { pub id, pub name, pub version, pub permissions: PluginPermissions }
pub struct PluginPermissions { pub read_vault: bool, pub write_vault: bool, pub network: bool }
```

## Modello capability: **ibrido** (deciso)

Il modello scelto è **grana grossa (booleani) + allowlist opzionale di path/glob**
per lo scope del vault. Non grana fine con prompt di consenso runtime (troppo costo
host/UI per il valore), non solo booleani (troppo poco per limitare *dove* un
plugin legge/scrive).

- **Concessione all'installazione:** i tre booleani (`read_vault`, `write_vault`,
  `network`) sono mostrati e accettati quando il plugin viene installato/attivato.
- **Scope opzionale del vault:** un plugin può dichiarare un'**allowlist di
  path/glob** (es. `Templates/**`, `Daily/**`); se presente, `HostApi.read_document`
  / `write_document` la applicano e negano (`PluginError::PermissionDenied`) tutto
  ciò che sta fuori. Se assente, valgono i booleani sull'intero vault.
- **Enforcement in un solo punto:** i controlli vivono nell'implementazione di
  `HostApi`, così valgono identici per plugin nativi e WASM.

Estensione prevista del manifest (da introdurre a M4, congelare in WIT):

```rust
pub struct PluginPermissions {
    pub read_vault: bool,
    pub write_vault: bool,
    pub network: bool,
    pub vault_scope: Vec<String>,   // glob; vuoto = intero vault (soggetto ai bool)
}
```

`PluginError` ha già la variante `PermissionDenied(String)` per veicolare i rifiuti
al frontend/all'IPC.

## Sandbox WASM (M5)

- **Runtime:** wasmtime, **component model**; plugin come componenti
  `wasm32-wasip2`, compilati a parte con `cargo component` (vedi `plugins/README.md`).
- **Isolamento di memoria:** dato dal component model; il plugin non vede la memoria
  del core, solo i dati che gli passano attraverso le host function.
- **Rete:** negata di default; concessa solo se `network = true`. WASI networking
  abilitato selettivamente.
- **Filesystem:** nessun accesso diretto; tutto passa da `read_document`/
  `write_document`, quindi soggetto a booleani + `vault_scope`.
- **Storage per-plugin:** `storage_get`/`storage_set` con namespace per plugin id,
  persistente (candidato: sotto `.fubmd-data/plugins/<id>/`).

## Percorso di attivazione

1. Il core legge il `PluginManifest` (nativo: dal codice; WASM: dai metadati del
   componente).
2. Mostra/richiede i permessi; costruisce un `HostApi` **con i permessi applicati**.
3. Chiama `Plugin::activate(host)`; il plugin registra i suoi provider
   (`Command`/`View`/`Index`/`EventHandler`) presso il registry del kernel.
4. Alla disattivazione, `Plugin::deactivate(host)` e deregistrazione.

Il **primo plugin nativo** (M4) esercita esattamente questo percorso senza WASM,
così M5 diventa "cambiare il backend delle host function", non "inventare il confine".

## Rischi

- **Superficie `HostApi` troppo stretta o troppo larga** — mitigato dal primo
  plugin nativo di M4 che la mette alla prova prima del freeze.
- **Costo di serializzazione al confine WASM** — accettato solo per i plugin di
  terzi; le feature ufficiali restano native (nessuna serializzazione).
- **Glob del `vault_scope`** — semantica (case, symlink, path traversal `..`) da
  fissare con test dedicati a M4.
