# Componenti

## Crate del workspace

| Componente | Responsabilità | Non deve contenere |
|---|---|---|
| `fub-abi` | tipi, trait, errori, arene, contratto WIT e rappresentazioni condivise | Tauri, parser Markdown, runtime WASM, motori di indice |
| `fub-kernel` | regole del vault, mutazioni, registri, sessioni, capacità, bozze e stato persistente comune | UI, formato Markdown, Wasmtime |
| `fub-sdk` | adattatori e utilità per chi implementa provider | dipendenza normale dal kernel |
| `fub-testkit` | banco di prova lato host | dipendenze normali da librerie distribuite |
| `fub-format-markdown` | parsing e serializzazione del provider Markdown | regole della shell o accesso diretto a Tauri |
| `fub-features` | bundle ufficiali e loro viste, comandi e indici | dipendenza normale dal kernel |
| `fub-host` | composition root, vault aperti, watcher, bundle, lavori e ponte eventi | Tauri |
| `fub-wasm-host` | runtime Wasmtime e adattamento dei componenti | regole di dominio del kernel |
| `fub-app` | binario desktop e sottile confine IPC Tauri | logica di parsing, indice o composizione duplicata |

Il grafo completo è in [`03-uml/03-componenti-e-dipendenze.md`](../03-uml/03-componenti-e-dipendenze.md).

## Frontend

`frontend/src/` contiene shell, pannelli, editor, renderer del protocollo UI, tema e adattatori IPC. Soltanto gli adattatori sotto `frontend/src/host/` devono importare direttamente le API Tauri.

## Strumenti ed esempi

- `esempi/ping-wasm/`: componente WASM costruito dai test;
- `tools/varco-wasm/`: verifica che il world WIT generi binding guest compilabili;
- `.github/scripts/`: invarianti che non appartengono a un singolo crate.

## Fonte di verità

I nomi e le dipendenze effettive sono nei `Cargo.toml`. Un documento che li riassume deve essere aggiornato insieme al codice; il grafo del workspace è controllato automaticamente proprio per evitare divergenze.