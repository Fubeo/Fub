# 0014 — La memoria del progetto sta in un file solo

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §4.13 (sesto giro) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[PIANO.md](../PIANO.md)

---

- [ ] **`todo.md` è a ~2900 righe e cresce di ~600 per giro d'audit**, e dentro
  ci sono mescolate due cose di natura diversa: l'elenco delle voci **aperte** e
  i **verbali** delle decisioni chiuse. I secondi sono l'asset più alto del repo
  — sono ciò che la [decisione 0003](../decisions/0003-modello-del-documento.md)
  chiama «il perché, che è ciò che fra sei mesi non si ricostruisce dal diff» —
  e sono archiviati nel posto in cui si va a cercare cosa resta da fare.
- [ ] **Al settimo giro non è più navigabile**, e il sintomo del disordine c'è
  già: `PIANO.md:138` linka `ORGANIZZAZIONE_VAULT.md`, che in `docs/` non
  esiste.
- [ ] **Da fare**: `docs/decisions/NNNN-<slug>.md`, un file per decisione chiusa
  (il verbale ci si sposta intero, con la data e il § di provenienza), e
  `todo.md` torna a essere l'elenco delle aperte con i link. Più un check dei
  link interni dei documenti in CI: dieci righe, e avrebbe già preso quello
  rotto.
- [ ] È la [decisione 0002](../decisions/0002-additivita-del-contratto.md)
  applicata alla documentazione invece che al contratto: una promessa senza
  presidio meccanico decade, e «il perché è scritto da qualche parte» è una
  promessa.

**Fatto.** I quattordici verbali delle decisioni chiuse stanno in
`docs/decisions/`, un file per decisione, numerazione progressiva e immutabile:
il numero è l'indirizzo stabile a cui si linka, e non si riusa nemmeno quando
una decisione viene superata — si scrive il verbale nuovo, non si riscrive il
vecchio. `todo.md` è tornato a essere ciò che il nome promette, l'elenco delle
voci aperte, e nel farlo ha cambiato asse: non più per **strato** (contratto,
kernel, shell, presidi) ma per **seduta**, cioè per gruppi di cose che conviene
decidere in una volta sola. L'ordine per strato serviva a chi cercava il
difetto; questo serve a chi deve chiuderlo, ed è l'unico uso che al file resta.

E le sedute sono uscite a loro volta: una per file, in `docs/roadmap/`, con
`todo.md` ridotto a **indice** — le sedute, le settantanove voci, gli allegati,
in duecento righe. Togliere i verbali non bastava: restavano milleottocento
righe di voci aperte in un file solo, cioè lo stesso difetto un giro più in là.
La misura di quando un documento va spezzato non è la lunghezza ma questa: se
per rispondere a «cosa devo fare adesso» bisogna scorrere ciò che non si sta
facendo, il file sta facendo due mestieri. Due regole che la riorganizzazione
lascia dietro di sé, e che vanno scritte perché sono esattamente ciò che a
rifarlo a mano si sbaglia. La prima: **un numero chiuso si ritira**, non si
riusa e non viene rimpiazzato da quello che segue — se la numerazione si
ricompattasse a ogni chiusura, ogni `§X.Y` nei commenti del codice diventerebbe
un rimando cieco, e la rinumerazione da rito straordinario diventerebbe
ordinario. La seconda: **l'indice non porta spunte**, e non è una dimenticanza —
una voce chiusa sparisce dall'indice invece di prendere una crocetta, così lo
stato non è una cosa che qualcuno dichiara ma una cosa che si vede. Una casella
spuntata è una promessa in più da mantenere; una riga che non c'è più l'ha tolta
chi ha spostato il verbale.

La numerazione vecchia però è citata ovunque — dentro i verbali per primi, che
non si toccano — quindi resta una **tabella di corrispondenza** fra vecchio e
nuovo: senza, ogni `§X.Y` scritto finora diventa un rimando cieco. E il **check
dei link interni** gira in CI, che è il punto vero: la
[decisione 0002](../decisions/0002-additivita-del-contratto.md) dice che una
promessa senza presidio meccanico decade, e spostare i file ne crea una nuova
ogni volta.
