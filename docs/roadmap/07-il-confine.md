# 7. Il confine: quante volte si scrive la disciplina

Una **seduta** della [roadmap infrastrutturale](../todo.md): la disciplina del confine, vista da chi lo attraversa e da chi lo presta. La risposta è nella [decisione 0021](../decisions/0021-il-confine.md); resta una casella, in fondo.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Sei voci su sei sono chiuse dalla
[decisione 0021](../decisions/0021-il-confine.md), e insieme, che era la
condizione che questo capitolo poneva: il §7.1 e il §7.2 erano «la stessa
domanda vista una volta dal lato di chi il confine lo attraversa e una da chi lo
presta», e il §7.3 le moltiplicava.

Le quattro cose che la seduta chiedeva e che si sono viste solo facendole:

- **Le due strade del §7.1 non erano alternative.** La seduta le poneva come una
  scelta — il `Guard<H, P>` nel kernel *oppure* la scomposizione in sotto-trait
  — e sono due metà: il wrapper toglie la impl gemella che serve a dire di no,
  la scomposizione toglie i **rifiuti che non sono nemmeno rifiuti** (i dodici
  `unreachable!()` del percorso di lettura, che dicevano il vero e non erano un
  tipo). Con una sola delle due, l'altra metà restava scritta a mano.
- **Al confine WIT la scomposizione compra una cosa che in Rust non si vede.**
  Un `world` che non importa `host-vault-write` non rifiuta la scrittura a
  runtime: non ha la funzione. È l'argomento che ha deciso di farla anche là — e
  quindi di farla adesso, perché dopo il freeze una funzione non si sposta più
  da un'interfaccia all'altra.
- **Le copie della disciplina di consegna erano quattro, non tre.** La quarta
  era in `import`, con sopra un commento che diceva «stessa disciplina di
  `view_action`»: la dichiarazione della duplicazione al posto del suo presidio.
- **Cinque capacità del contratto non sanno dire di no.** `emit`, `free_name`,
  `format_of`, `now_unix_millis`, `active_context` non hanno un `Result`, quindi
  una politica che le nega può solo dare la risposta nulla. È la lezione che
  questa seduta lascia alla [decisione 0013](../decisions/0013-elenco-delle-capacita.md):
  una capacità nuova dovrebbe portare un esito **anche quando "non può
  fallire"**, perché non potendo fallire non può nemmeno essere negata.

Il §7.4 era la voce **più datata** del piano — l'unica che non riguardava ciò
che avremmo scritto ma ciò che avremmo già pubblicato — e il suo costo è stato
quello previsto: nessuno, perché nessun id di terzi esiste ancora. È il solo
momento in cui poteva costare così.

## La casella rimasta

*strato kernel — è lavoro, non una decisione: il criterio è già scritto e il bloccante è caduto*

- [ ] **Le allowlist dei permessi non filtrano.** `read_vault` e `write_vault`
      hanno un **parametro** — un elenco di prefissi di path, la forma che la
      [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) ha
      dato a un permesso — e la politica di oggi legge la sola presenza della
      chiave: un plugin con `read-vault` ristretto a `Progetti/` legge tutto il
      vault. La [0021](../decisions/0021-il-confine.md) lo dichiara nel suo
      «cosa resta fuori» e ne nomina il bloccante — il §15.5, «la politica dei
      path in un modulo solo», *per non nascere con due idee di cosa sia un
      prefisso*. Quel bloccante è caduto con la
      [0058](../decisions/0058-un-nome-che-nasce.md): `fub_abi::rules::path` è
      il posto, e un prefisso ha una definizione sola. Resta additivo dentro
      `Granted`, e resta una casella e non una voce perché la decisione — *dove
      si applica, e con quale nozione di prefisso* — è già presa in tutte e due
      le sue metà. La
      [0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) ci aggiunge
      un posto in cui applicarlo che non era in conto: `fub:read-session` e
      `fub:read-selection` **un path da confrontare ce l'hanno**, ed è
      `ViewContext.doc`. È la differenza con `Query`, che il prefisso non lo può
      onorare per costruzione — una risposta aggregata non ha un path — e vale
      saperla il giorno che si scrive il filtro, perché i due casi si somigliano
      e si comportano in modo opposto.

      Che sia rimasta ferma per trentadue verbali dopo che il suo indirizzo era
      stato onorato è la ragione per cui adesso è **contata** in
      [todo.md](../todo.md) invece di vivere solo dentro un verbale: una casella
      che nessun totale nomina non la cerca nessuno, ed è la stessa diagnosi che
      la [§16.7](16-crate-sdk-banchi-di-prova.md) fa agli elenchi — *chi lo
      legge, lo trova?*
