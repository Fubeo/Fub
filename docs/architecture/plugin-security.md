# Capability, sandbox e UI non fidata

> **Ambito:** che cosa può fare un componente di terzi e come viene confinato.
> Parte del [runtime dei plugin](plugin-runtime.md).
> **Fonte autorevole:** [permissions-and-security.md](../reference/permissions-and-security.md).

## Capability

Il runtime non replica la policy. Riceve un `HostApi` già incappucciato dal
`Guard` del kernel.

Le interfacce host vengono linkate una alla volta. Il runtime WASM serve tutte
le famiglie `host-*` di un plugin: ambiente, lettura, scrittura e struttura del
vault, dati, impostazioni, stato delle view, query, servizi, rete, comandi ed
eventi (`crates/fub-wasm-host/src/guest.rs`). Restano fuori `host-transfer-read`
e `host-transfer-write`, legate agli export `importer` ed `exporter` che il
runtime non collega. Se un componente importa una famiglia non servita, il
caricamento fallisce con `UnservedFamilies` e l'errore nomina la famiglia.

## Sandbox

Il component model isola la memoria. Il runtime corrente:

- non collega WASI, tranne `wasi:random/random` e `insecure-seed` (il seme
  delle `HashMap` della std dalla Rust 1.95), a ogni patch della 0.2: danno
  byte dal generatore crittografico del sistema (al massimo 64 KiB per
  richiesta) perché un guest che genera identità o chiavi non riceva valori
  prevedibili; ogni altro import WASI è collegato a una trap;
- non concede filesystem o rete diretti;
- impone un limite alla memoria lineare e agli elementi di ogni tabella, che
  l'host alloca per il componente;
- usa epoch interruption per la deadline;
- converte trap e timeout in `PluginError`;
- limita la profondità delle conversioni ricorsive;
- mantiene vivo l'host dopo il fallimento di un componente.

Il lavoro lungo passa dai job. Una chiamata di trait breve non è il posto per
una computazione senza limite.


## UI non fidata

Nel percorso `ViewProvider` WASM ogni albero di un provider non fidato
(`Trust::Community`) passa da `UiNode::validate_untrusted()` prima della shell.
La policy completa — che cosa un componente di terzi non può ottenere e quali
intenti sono privilegiati — è in
[permissions-and-security.md](../reference/permissions-and-security.md#ui-non-fidata).


## Limiti non promessi

- `IndexProvider` WASM ed `EventHandler` inbound non sono esposti finché una
  route reale o un componente reale non provano il caso (WASM-002, issue #57);
- deadline a epoche e limite di memoria confinano il guest, ma non sono una
  quota assoluta CPU/RAM dell'intero processo (WASM-003, issue #58);
- operazioni non esercitate dagli esempi e dai test di parità non sono
  promesse per inferenza.

Questi sono confini del prodotto corrente, non lavoro necessario a rendere
valida l'integrazione già avvenuta.
