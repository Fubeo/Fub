# 0002 — L'additività del contratto è una promessa senza presidio

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §4.10 (quinto giro) |
| **Commit** | `0a4ee40` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **Nessuno confronta il contratto con la versione precedente.**
      `abi_compatible` applica la regola a runtime (`abi/traits.rs`) e
      `wit_conformance.rs` verifica che Rust e WIT dicano la stessa cosa —
      **oggi**, fra di loro. Ma la promessa del freeze è un'altra: *post-M4 il
      contratto cresce solo per aggiunta*. Nessun test la controlla, e non c'è
      da nessuna parte una copia del contratto com'era.
- [x] **Il costo di scoprirlo tardi è asimmetrico**: una variante rimossa, un
      campo rinominato o un enum riordinato non rompono la build del repo —
      rompono i plugin di terzi, a valle, dopo il rilascio, e la regola
      `abi_compatible` li avrebbe accettati perché la minor è compatibile. Cioè
      la rete di sicurezza dice "sì" proprio nel caso che dovrebbe fermare.
- [x] Serve poco: uno **snapshot del WIT per ogni versione pubblicata** in
      `crates/fub-abi/wit/frozen/`, e un test che confronti il contratto attuale con l'ultimo
      snapshot rifiutando rimozioni, rinomine e cambi di forma (le aggiunte
      passano). Va messo **prima** del freeze, perché è il freeze a fissare la
      prima riga di base — e va con §16.4, che genererebbe da uno solo dei
      quattro posti ciò che questo test presidia in tutti e quattro.
      *(Il §16.4 è chiuso dalla
      [0053](0053-il-contratto-ha-una-sorgente.md), e questa previsione è
      **sbagliata**: i quattro posti non sono quattro grafie della stessa cosa —
      il WIT e il mirror TS sono proiezioni su due confini con due forme diverse
      — quindi non si genera nessuno dei quattro dagli altri. Il presidio di
      questa voce resta intatto, ed è deliberato: la sua sorgente è l'`abi.wit`
      scritto a mano, cioè il confronto fra due cose che nessuno ha derivato
      l'una dall'altra. È l'unico che protegge plugin di terzi già compilati.)*

**Fatto.** `crates/fub-abi/wit/frozen/0.1.0.wit` è la prima linea di base e
`crates/fub-abi/tests/wit_additivity.rs` il presidio: parsa il contratto
attuale e ogni snapshot, e verifica che il primo sappia ancora servire ognuno di
quelli **di cui `abi_compatible` direbbe di sì** (stessa major, minor non
superiore) — così la regola a runtime e il test guardano lo stesso insieme di
versioni, invece di due insiemi diversi. La forma di ciò che era pubblicato deve
essere intatta *e nella stessa posizione*; il nuovo può stare solo in coda. Un
tipo spostato da un'interfaccia a un'altra conta come rinomina. Regole complete e
ciclo di vita della cartella in `docs/architecture/wit-congelato.md`.

Tre proprietà che il test si autopresidia, perché è un presidio che si spegne da
solo se non ci si bada: **venti** rotture introdotte ad arte sul modello
parsato (tipo rimosso o spostato, campo rinominato/ritipato/riordinato/tolto/
inserito in mezzo, caso di variant rimosso o riordinato, payload cambiato, alias
ridiretto, funzione sparita, parametro in più, rinominato o ritipato, risultato
cambiato, package rinominato, import di world sparito) devono tutte farlo
diventare rosso;
**sette** aggiunte vere — fra cui proprio quelle che il §1 dovrà fare: una
superficie in più in `view-placement` (§2.2), una variante in più in
`index-query` ([decisione 0005](../decisions/0005-canale-dati-verso-le-view.md)), una capacità in più sull'`host-api` ([decisione 0013](../decisions/0013-elenco-delle-capacita.md)) — devono
passare; e `crates/fub-abi/wit/frozen/` vuota, o senza una base con la major corrente, è rossa,
perché zero snapshot significherebbe zero confronti e quindi verde.

Pre-freeze la superficie resta libera di evolvere: il test non lo impedisce, lo
rende **visibile** — una rottura deliberata si fa con un commit che tocca
`crates/fub-abi/wit/frozen/0.1.0.wit`, e in review si vede. Dopo M4 quel file non si tocca più.

*Sblocca:* 27.3 (version compatibility, deprecation policy), 20.1 (versioning
plugin), 20.2 (canali di aggiornamento) — e rende vera, non sperata, la promessa
su cui poggia l'intero §1.
