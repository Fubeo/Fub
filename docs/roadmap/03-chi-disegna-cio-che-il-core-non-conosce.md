# 3. Chi disegna ciò che il core non conosce

Una **seduta** della [roadmap infrastrutturale](../todo.md): una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa dalla [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)**,
tranne la metà implementativa della §3.3. Il quarto giro diceva che §3.1, §3.2 e
§3.3 erano una decisione sola vista da tre lati — chi aggiunge la *sintassi*, chi
disegna il *blocco* che ne esce, chi fa entrare un renderer di terzi nella
*shell* — e che andavano prese insieme o due terzi della risposta sarebbero stati
inutilizzabili. Il perno che le tiene insieme si è rivelato essere il
`custom_kind`: un nome con namespace lo produce, lo stesso nome lo disegna, lo
stesso nome arriva alla shell dentro `UiKind::Custom { ns }`.

Con loro sono chiuse la §3.4 (le opzioni di parse), la §3.5 (i quattro tipi
chiusi troppo presto, che sono diventati **un tipo solo** con namespace) e la
§3.6 (sanitizzazione e CSP in un punto solo). Il verbale dice cosa si è scartato
e cosa resta scoperto.

Della §3.3 la **decisione** è presa — è la terza opzione, *solo prima parte e
tutto il resto dichiarativo* — e resta la sua metà di esecuzione: il grafo è
ancora un pannello nativo. È shell, e aspetta il modello di layout, quindi sta
nella
[§3.3 in coda alla seduta 18](18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell),
accanto alla [§1.2](18-editor-e-tastiera.md#12-smontare-il-monolite) che gliela
sblocca. Il numero si trasferisce, non si rinomina.
