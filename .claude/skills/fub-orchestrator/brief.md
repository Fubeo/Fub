# Brief for a coder

Fill this in and pass it as the coder's prompt, in Italian.

- For a plan task, copy the task's section from `PLAN.md` whole.
- For a defect, give the defect's full entry: steps, photos, the version it
  was seen on.

Add nothing the coder doesn't need. Coder worktrees don't see
`CLAUDE_DEVICE.md`, so the machine block below always goes in the brief.

```text
Sei il coder del task {ID} «{titolo}».
Ramo: {ramo del coder}, partendo da {sha} (la punta di {ramo del gruppo}).
Porta del banco: {porta}. Non toccare gli altri worktree.

## Il task
{la sezione del task da PLAN.md, intera; oppure i difetti con le loro voci}

## Prototipo
{solo per un task grafico: PLAN-ui/{file}.html e la tabella «Dal prototipo»
del piano; altrimenti togli questa sezione}

## Decisioni che valgono per te
{solo le righe di DECISIONS.md pertinenti; altrimenti «nessuna»}

## La macchina
{il blocco «Coder brief» di CLAUDE_DEVICE.md: shell, coda dei controlli
pesanti, porte vietate, percorsi vietati, soglia del disco}

## Chiusura
scripts/check.sh --rapido --base {sha}, dalla coda e in background.
Poi il rapporto nella forma di .claude/agents/coder.md.
```

For a defect from a tester, add:

- **Reproduce first**, with a test that fails. A tester driving the app with
  WebDriver can mistake a WebDriver limit for a defect, such as modifier keys
  that never arrived or a simulated drag. If a defect doesn't reproduce with
  realistic input, the coder writes it down with the evidence and moves on.
- Tester vaults are read-only.

To resume a coder (`SendMessage` to the same agent), send only the news:

```text
Risposta alla tua domanda: {decisione}. Annotata in DECISIONS.md.
Riprendi da dove eri; la chiusura non cambia.
```
