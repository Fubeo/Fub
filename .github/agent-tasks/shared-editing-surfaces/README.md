# Shared editing surfaces — agent execution pack

> **Archivio storico.** Questo pacchetto documenta l'esecuzione delle Fasi 0–3
> di #11; il programma è concluso e il TODO operativo è stato ritirato. Non
> usare questi task come backlog corrente.

Non è documentazione architetturale canonica. Le invarianti correnti vivono in
`docs/architecture/frontend-and-ipc.md`, `docs/product/editor-and-preview.md`
e nell'ADR 0201.

## Entry point

L'agente orchestratore deve leggere, nell'ordine:

1. `AGENTS.md`;
2. `CONTRIBUTING.md`;
3. `docs/architecture/frontend-and-ipc.md`;
4. `GLOBAL-RULES.md`;
5. `MANIFEST.md`;
6. `ORCHESTRATOR.md`.

Non deve leggere tutti i file `tasks/SURF-*.md` all'avvio. Deve aprire soltanto i task che sono `READY` secondo il DAG.

## Struttura

- `GLOBAL-RULES.md`: invarianti e divieti comuni alle Fasi 0–3;
- `MANIFEST.md`: DAG, ordine di integrazione, gruppi paralleli e hotspot;
- `ORCHESTRATOR.md`: protocollo dell'agente principale;
- `prompts/IMPLEMENTER.md`: template per il Luna implementatore;
- `prompts/VERIFIER.md`: template per il Luna verificatore indipendente;
- `tasks/SURF-xxx.md`: specifica atomica di ogni task;
- `CHECKPOINT-PHASE-4.md`: gate finale prima di iniziare la Fase 4.

## Autorità

In caso di conflitto valgono, in ordine:

1. istruzioni esplicite più recenti dell'utente;
2. `AGENTS.md` e `CONTRIBUTING.md`;
3. il TODO canonico;
4. `GLOBAL-RULES.md`;
5. il file del singolo SURF;
6. `MANIFEST.md` e gli altri artefatti di orchestrazione.

Un agente non deve reinterpretare un SURF per ampliare il proprio scope.