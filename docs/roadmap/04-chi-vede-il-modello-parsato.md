# 4. Chi vede il modello parsato

Una **seduta** della [roadmap infrastrutturale](../todo.md): *chi vede la struttura di un documento?* La risposta è nella [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md); qui resta la coda shell.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Tre voci su quattro sono chiuse dalla
[decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md): il modello
**si chiede** (`HostApi::read_model`), di che formato è un documento si sa senza
aprirlo (`HostApi::format_of`), e verso la shell il modello **non** attraversa
l'IPC — `render_preview` resta la fast-path della lettura, e ciò che la shell
vuole *fare* col modello lo chiede come comando.

Resta la voce che pone la stessa domanda dal lato dell'editor, e che quella
decisione **sblocca senza risolvere**: il confine adesso è scritto — il
**buffer** è di Lezer, il **file** è del modello — ma le ~50 estensioni del
capitolo 5.2 continuano a nascere due volte finché la *dichiarazione* di una
sintassi non è condivisa fra i due lati. È shell, e va con il secondo livello
della §18.1, quindi sta nella
[§4.4 in coda alla seduta 18](18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi).
Il numero si trasferisce, non si rinomina.
