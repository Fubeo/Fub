# M5 — Runtime WASM per plugin di terzi

Torna a [../PIANO.md](../PIANO.md) · segue [M4](M4-wit-hardening.md).

## Obiettivo

Consegnare il requisito distintivo del progetto: **plugin di terzi in sandbox,
veloci quasi quanto le feature native**, che implementano gli **stessi trait** del
contratto. Il kernel non deve distinguere un provider nativo da uno WASM.

## Design

### `fubmd-wasm-host` (crate da abilitare)

Oggi commentato nel workspace (`Cargo.toml`) e assente da `crates/`. M5 lo crea:
- **Runtime:** wasmtime con **component model**; carica componenti `wasm32-wasip2`
  (compilati a parte con `cargo component`, vedi `plugins/README.md`).
- **Bindings:** generati dal `wit/fubmd/*.wit` congelato a [M4](M4-wit-hardening.md).
- **Invariante:** `fubmd-wasm-host` dipende da wasmtime; `fubmd-kernel`/`fubmd-abi`
  **no** (l'host vive al confine, il kernel resta agnostico — vedi
  [../PIANO.md](../PIANO.md)).

### Proxy dei trait (il "secondo backend")

Per ogni trait del contratto, un tipo proxy in `fubmd-wasm-host` che implementa il
trait Rust e **reinoltra** ogni chiamata al componente WASM attraverso i bindings:

- `MarkdownProvider` nativo : `FormatProvider` :: `WasmFormatProvider` : `FormatProvider`.
- Analoghi per `IndexProvider`, `ViewProvider`, `CommandProvider`, `EventHandler`.
- Il kernel riceve `Box<dyn Trait>` e li registra come qualsiasi provider nativo:
  **stessa firma, backend diverso** (il meccanismo "un trait, due backend" di
  [../architecture/traits.md](../architecture/traits.md)).

### Host function per `HostApi`

I metodi di `HostApi` (`read_document`, `write_document`, `emit`, `storage_get/set`)
sono esposti al componente come **host function** wasmtime:
- serializzano gli argomenti (tipi WIT), eseguono nel core, ritornano;
- **applicano le capability** (booleani + `vault_scope`) nell'unico punto di
  enforcement, identico ai plugin nativi
  (vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)).

### Sandbox e capability

- Memoria isolata dal component model; nessun accesso diretto a filesystem/rete.
- Rete negata salvo `network = true`; FS solo via `HostApi` (soggetto a
  booleani + `vault_scope`).
- Storage per-plugin namespaced e persistente (`.fubmd-data/plugins/<id>/`).
- **Disponibilità:** i trait sono sincroni e brevi → **epoch interruption**
  wasmtime con deadline severa per chiamata e limiti di memoria/fuel; un plugin
  lento o ostile viene interrotto (`PluginError::Internal`), mai lasciato
  congelare il kernel. Il lavoro lungo legittimo passa dai **job**: `run_job`
  gira su un'**istanza separata** del componente (il kernel non è mai in
  attesa), con deadline propria più lasca e le stesse capability del plugin
  (`network` compreso) — vedi
  [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md),
  "Lavoro lungo: i job".
- **UI:** il proxy applica `UiNode::validate_untrusted()` (già nel contratto,
  con test) a ogni albero restituito da `render_view`: `Html`/`WebView` sono
  riservati al codice fidato finché non esistono asset story e CSP per i plugin
  (da progettare qui a M5) — vedi
  [../architecture/ui-protocol.md](../architecture/ui-protocol.md).

### Plugin di esempio (`plugins/`)

Almeno un plugin di esempio reale in `wasm32-wasip2` (candidato: un
`CommandProvider` o un `ViewProvider` non banale), a dimostrare l'intero percorso:
build con `cargo component` → discovery/attivazione → uso in-app. Idealmente **lo
stesso** provider del plugin nativo di M4, ricompilato a WASM, per confrontare i due
backend a parità di logica.

## Trait/API coinvolti

- Tutti i trait del contratto, ora anche in versione **proxy WASM**.
- `HostApi` come set di host function.
- Nuovo crate `fubmd-wasm-host`; `fubmd-app` che monta l'host e carica i plugin.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| **Component model** (non core WASM) | Tipi ricchi via WIT, isolamento di memoria, world import/export pulito. |
| Proxy per-trait | Realizza "un trait, due backend"; il kernel non cambia. |
| Enforcement capability **nelle host function** | Unico punto, identico ai plugin nativi; niente sandbox bypassabile. |
| Riusare il provider di M4 come esempio WASM | Confronto diretto nativo↔WASM a logica costante. |

## Criteri di accettazione

- Un plugin `wasm32-wasip2` di esempio si carica, si attiva e funziona end-to-end;
  il kernel non ha codice speciale "per il WASM" oltre alla registrazione dei proxy.
- Le capability sono applicate: un plugin senza `network`/fuori `vault_scope` viene
  bloccato (`PermissionDenied`); crash/panic del plugin non abbattono il core.
- Overhead misurato del confine WASM entro un budget accettabile su un'operazione
  campione (documentato), mentre le **feature ufficiali restano native** (zero
  serializzazione).

## Piano di test

- **Unit/integrazione host:** round-trip dei tipi WIT attraverso il confine per ogni
  trait; host function con e senza permesso.
- **E2e:** carica il plugin di esempio, invoca il suo comando/rende la sua view,
  verifica l'effetto nel vault; test negativi sui permessi.
- **Isolamento:** un plugin che va in panic è contenuto; timeout/limiti di risorse
  (epoch interruption: un plugin con loop infinito viene interrotto entro la
  deadline); un `render_view` che restituisce `Html`/`WebView` viene rifiutato.
- **Parità:** stesso provider nativo (M4) vs WASM → stesso risultato osservabile.
- `cargo test --workspace` + `cargo clippy`; build del plugin via `cargo component`
  in CI ([../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Overhead di serializzazione** → accettato solo per i plugin di terzi; misurato e
  documentato; batch dove sensato.
- **Superficie host insufficiente** → già esercitata dal plugin nativo di M4 prima
  del freeze.
- **Sicurezza della sandbox** (rete, FS, risorse) → default negato, enforcement in un
  solo punto, test negativi espliciti.
- **Tooling `cargo component`/wasip2 in evoluzione** → pin delle versioni; build del
  plugin isolata dal workspace root (già previsto).
