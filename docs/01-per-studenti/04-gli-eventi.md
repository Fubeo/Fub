# Gli Eventi: l'altoparlante della scuola

Per chi è: studenti delle superiori che vogliono capire come i diversi componenti di Fub si tengono aggiornati quando qualcosa cambia.

---

## L'analogia: la campanella o l'annuncio scolastico

A scuola, quando suona la campanella:
- La segreteria non va di persona in ogni singola classe ad avvisare ogni singolo studente.
- La campanella suona per tutti: ogni professore e ogni studente ascolta il segnale e compie la sua azione (chiudere il quaderno, cambiare aula, fare l'intervallo).

In Fub, il sistema di comunicazione si basa su questo stesso principio ed è chiamato **Event Bus** (il bus degli eventi, situato in [`crates/fub-kernel/src/bus.rs`](../../crates/fub-kernel/src/bus.rs)):

```mermaid
flowchart TD
    Azione["📝 Modifichi e salvi la nota 'Matematica.md'"] --> Kernel["🚀 Il Kernel emette l'evento: DocumentSaved"]
    Kernel --> Bus["📢 EventBus (L'altoparlante)"]
    Bus --> S1["🔍 Indice di Ricerca: aggiorna le parole memorizzate"]
    Bus --> S2["🕸️ Mappa del Grafo: ricalcola i collegamenti"]
    Bus --> S3["🖥️ Finestra Grafica: aggiorna l'anteprima sullo schermo"]
```

---

## Perché usare gli eventi?

1. **Disaccoppiamento**: chi salva il file non ha bisogno di conoscere tutti i pannelli e i plugin installati. Emette semplicemente l'annuncio: *"Il file X è stato salvato"*.
2. **Reattività immediata**: qualunque plugin interessato può mettersi in ascolto e reagire immediatamente senza dover continuamente controllare il disco.

---

## Se vuoi il dettaglio

- Guarda [`docs/03-uml/02-sequenza-tasto-pixel.md`](../03-uml/02-sequenza-tasto-pixel.md) per vedere come un evento attraversa tutto il sistema.
- Guarda [`crates/fub-abi/src/event.rs`](../../crates/fub-abi/src/event.rs) per l'elenco di tutti gli eventi previsti dal contratto.
