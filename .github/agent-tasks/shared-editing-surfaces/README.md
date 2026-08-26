# Shared editing surfaces — agent execution pack

Questo albero contiene gli artefatti operativi per eseguire con agenti GPT-5.6 Luna le Fasi 0–3 di `docs/project/todo-superfici-di-editing-condivise.md`, tracker issue #11.

Non è documentazione architetturale canonica. È un pacchetto di esecuzione: i task descrivono lavoro ancora da fare e devono essere rimossi o archiviati fuori dalla documentazione canonica quando non servono più.

## Entry point

L'agente orchestratore deve leggere, nell'ordine:

1. `AGENTS.md`;
2. `CONTRIBUTING.md`;
3. `docs/project/todo-superfici-di-editing-condivise.md`;
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