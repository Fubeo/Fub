# 6. Le regole in un posto solo

Una **seduta** della [roadmap infrastrutturale](../todo.md): la stessa regola serve a tre consumatori — provider, shell, e a M5 un guest WASM. La risposta è nella [decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md); qui non resta niente.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Due voci su due sono chiuse dalla
[decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md), e insieme,
che era la condizione che questo capitolo poneva: le regole sono salite in
`fubmd-abi` per i provider **e** la cartella `frontend/src/rules/` ha adesso il
presidio che le lega a quelle, invece di riscriverle e dichiararlo in un
commento.

Le due cose che la seduta chiedeva e che si sono viste solo facendole:

- **Il criterio non era l'elenco dei quattro `mod`.** È *se una risposta del
  contratto ha una parte che non dipende da chi la dà*, e applicandolo è salita
  anche `properties::finish` — la coda di ogni risposta a `Documents`, che il
  §6.1 non nominava e che aveva già due chiamanti e un commento a dire che due
  implementazioni sarebbero divergute.
- **La domanda del §6.2 sull'ordinamento aveva una risposta, e non era un
  presidio.** L'ordine di presentazione è della shell; il kernel espone un ordine
  totale e senza locale perché è ciò che tiene onesta la paginazione. Sta scritto
  in testa a `fubmd_abi::rules`, accanto alle regole.

Il §6.2 aveva anche una **scadenza morbida** — ogni regola che nasce prima di
lui nasce senza presidio, e il capitolo 15 da solo ne porta sei — ed è stata
onorata: le sei del [§15](15-il-disco.md) nasceranno con la loro fixture.
