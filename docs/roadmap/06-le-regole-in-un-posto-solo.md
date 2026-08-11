# 6. Le regole in un posto solo

Questo file è una **seduta** (fase di lavoro) della
[roadmap infrastrutturale](../todo.md). La regola tecnica serve a tre
consumatori:
- provider (fornitori di dati)
- shell (interfaccia utente)
- M5 (un guest WASM, modulo eseguibile)

La risposta è nella
[decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md). Questo file
non contiene compiti residui.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

La [decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md) chiude due
voci su due contemporaneamente. L'azione congiunta era una condizione del
capitolo.

**Modifiche implementate:**
* Le regole risiedono in `fub-abi` per i provider.
* La cartella `frontend/src/rules/` include un presidio (sistema di validazione
  automatica). Il presidio vincola il codice frontend a `fub-abi`. Questo
  sostituisce i commenti dichiarativi.

Il lavoro pratico ha evidenziato due scoperte:

1. **Il criterio di astrazione.**
   * La regola applicata isola le risposte del contratto (interfaccia dati)
     indipendenti dal fornitore. L'elenco precedente dei quattro `mod` è
     superato.
   * Il nuovo criterio ha promosso `properties::finish` (la coda di ogni
     risposta a `Documents`).
   * Il §6.1 ometteva questa funzione. Essa contava già due chiamanti e portava
     il rischio di due implementazioni divergenti.

2. **L'ordinamento (domanda del §6.2).**
   * L'ordine di presentazione appartiene alla shell.
   * Il kernel (nucleo dell'applicazione) fornisce un ordine totale e oggettivo.
     Questo approccio garantisce la corretta paginazione.
   * Le spiegazioni risiedono all'inizio di `fub_abi::rules`. La soluzione
     adotta un approccio architetturale.

Il §6.2 presentava una **scadenza morbida** (limite temporale flessibile). Le
regole antecedenti mantengono l'architettura originale. Il capitolo 15 introduce
sei nuove regole. La scadenza è onorata: le sei regole del [§15](15-il-disco.md)
nasceranno dotate della propria fixture (ambiente di test dedicato).
