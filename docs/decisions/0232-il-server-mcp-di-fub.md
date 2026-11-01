# 0232 — Il server MCP di Fub sta in `fub-cli`, ed è scritto lì

- **Stato:** proposta
- **Data:** 2026-10-30
- **Ambito:** sicurezza
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Gli agenti usano le app Craft attraverso MCP. Per Fub serve lo stesso
ingresso: cercare, leggere, collegare, scrivere e invocare comandi. La CLI fa
già tutte queste chiamate sopra `fub_host::Host`, e se l'app desktop tiene il
vault le inoltra a lei col canale di controllo. Un agente però scrive mentre
una persona scrive: il server non deve permettere una scrittura che cancella
in silenzio una modifica fatta nel frattempo, e non deve dare all'agente più
vault di quanto gli si vuole dare.

## Decisione

1. Il server è un sottocomando, `fub-cli mcp`, sopra la stessa `Connection`
   degli altri comandi. Non c'è un secondo writer né una seconda porta
   dell'host.
2. Il protocollo è scritto in `fub-cli`: stdio, JSON-RPC 2.0, un messaggio
   per riga, sincrono. `fub-host` non ha un runtime asincrono, e la parte del
   protocollo che serve (inizializzazione, strumenti, risorse) è piccola.
3. Le radici sono gli stessi flag delle app Craft,
   `--automation-read-root` e `--automation-write-root`. Senza radici di
   scrittura il server è in sola lettura; senza radici di lettura legge il
   vault intero.
4. Via MCP non esiste `WriteBase::Dictated`: `fub_write` vuole la revisione
   letta, e una revisione superata torna come conflitto. `fub_invoke` parte
   in prova, ed esegue con `apply` soltanto un piano che sta sotto le radici
   di scrittura.

## Conseguenze

### Positive

- un agente vede le stesse regole, lo stesso `Guard` e gli stessi eventi di
  una persona, anche quando passa dall'app;
- nessuna dipendenza nuova: il server compila con quelle di `fub-cli`;
- le radici sono quelle che chi usa già le app Craft conosce.

### Negative

- il protocollo va tenuto allineato alla specifica a mano;
- il server tiene il vault aperto finché vive: con l'app chiusa, l'app che si
  apre dopo trova il vault occupato;
- un comando non dice sempre quali note tocca: senza piano si esegue soltanto
  se si scrive in tutto il vault.

## Alternative scartate

### Il crate `rmcp`

Plausibile, perché segue la specifica da sé. Scartato per ora: porta un
runtime asincrono in un crate che non ne ha, e il protocollo che serve è
piccolo. Si riconsidera se tenerlo aggiornato diventa un peso.

### Le radici come le intende PhotoCraft

In PhotoCraft una radice mancante nega l'accesso. Scartato per la lettura:
un vault di note si legge per collegarlo, e chi vuole restringere lo dice
con una radice. Per la scrittura vale la regola più stretta.

## Verifica

- `crates/fub-cli/tests/mcp.rs`: inizializzazione, elenco, ogni strumento,
  errori, conflitto di due scritture con la stessa base, rifiuto di ogni
  scrittura senza radice, radici di lettura, passaggio dall'app;
- `crates/fub-cli/src/mcp/access.rs`: le radici dentro, fuori e attorno al
  vault;
- [Server MCP](../reference/mcp-server.md).
