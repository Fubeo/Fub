# Brief for a coder

Fill this in and pass it as the coder's prompt. Copy the task's section from
`PLAN.md` whole; add nothing the coder doesn't need. Write it in Italian, like
the plan.

```text
Sei il coder del task {ID} del piano «{titolo del piano}».
Branch del piano: {branch}. Base: {sha}. La tua copia del repo parte da qui.

## Il task
{la sezione del task da PLAN.md, intera}

## Prototipo
{solo per un task grafico: PLAN-ui/{file}.html e la tabella «Dal prototipo»
del piano; altrimenti togli questa sezione}

## Decisioni che valgono per te
{solo le righe di DECISIONS.md pertinenti; altrimenti «nessuna»}

## Chiusura
scripts/check.sh --rapido --base {sha}
Poi il report nella forma di .claude/agents/coder.md.
```

Resuming a coder (with SendMessage to the same agent), only the news:

```text
Risposta alla tua domanda: {decisione}. Annotata in DECISIONS.md.
Riprendi da dove eri; la chiusura non cambia.
```
