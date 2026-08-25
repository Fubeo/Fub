# Mappa visuale

Questa è la vista concettuale, pensata per orientarsi. Il grafo completo delle dipendenze Rust è separato e viene verificato automaticamente in [`03-uml/03-componenti-e-dipendenze.md`](../03-uml/03-componenti-e-dipendenze.md).

```mermaid
flowchart LR
    UI[frontend<br>shell TypeScript] --> APP[fub-app<br>adattatore Tauri]
    APP --> HOST[fub-host<br>composizione]
    HOST --> KERNEL[fub-kernel<br>regole del vault]
    HOST --> FEATURES[fub-features<br>bundle ufficiali]
    HOST --> MARKDOWN[fub-format-markdown<br>provider]
    WASM[fub-wasm-host<br>runtime WASM] --> HOST
    FEATURES --> ABI[fub-abi<br>contratto]
    MARKDOWN --> ABI
    KERNEL --> ABI
    HOST --> ABI
    APP --> ABI
    SDK[fub-sdk<br>supporto provider] --> ABI
```

## Lettura della mappa

- le frecce indicano chi usa il livello successivo;
- `fub-abi` definisce il vocabolario comune;
- `fub-kernel` applica le regole, ma non decide il formato o la UI;
- `fub-host` è il punto in cui i pezzi vengono assemblati;
- la shell non accede direttamente a file o indici.

Per il dettaglio di ogni crate consulta [`riferimento/componenti.md`](../riferimento/componenti.md).