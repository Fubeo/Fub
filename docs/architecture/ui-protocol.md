# Protocollo UI dichiarativo

Un provider non costruisce componenti della shell e non riceve il DOM. Restituisce una struttura serializzabile di `UiNode`; la shell decide come renderizzarla.

## Perché è dichiarativo

- il guest WASM non dipende dal framework del frontend;
- il tema e l'accessibilità restano sotto il controllo della shell;
- i nodi possono attraversare IPC e WIT;
- lo stesso provider può essere testato senza una finestra;
- la shell può rifiutare nodi o proprietà non supportati.

## Flusso

```text
azione utente
  → comando o view_action
  → provider
  → UiNode serializzabili
  → mirror IPC
  → renderer della shell
```

Le azioni della vista tornano al provider come messaggi dichiarati. Non contengono callback o riferimenti a oggetti del frontend.

## Responsabilità

Il provider decide il significato della vista e i dati che mostra. La shell decide focus, tastiera, resa, tema, ruoli accessibili e comportamento degli elementi standard.

Il dettaglio dei nodi e dell'IPC è in [`frontend/02-il-protocollo-ui-node.md`](../frontend/02-il-protocollo-ui-node.md) e [`frontend/03-comandi-eventi-ipc.md`](../frontend/03-comandi-eventi-ipc.md).