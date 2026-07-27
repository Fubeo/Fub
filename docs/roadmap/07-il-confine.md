# 7. Il confine: quante volte si scrive la disciplina

Una **seduta** della [roadmap infrastrutturale](../todo.md): la disciplina del confine, vista da chi lo attraversa e da chi lo presta. La risposta è nella [decisione 0021](../decisions/0021-il-confine.md); qui non resta niente.

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
