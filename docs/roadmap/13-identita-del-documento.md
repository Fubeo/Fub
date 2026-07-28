# 13. L'identità di un documento, e ciò che gli sta attaccato

Una **seduta chiusa** della [roadmap infrastrutturale](../todo.md): la stessa domanda a tre distanze — l'identità, ciò che le sta attaccato, la sua storia.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa.** Tre voci che il quinto giro chiedeva di decidere insieme, e che
insieme sono state decise — con la particolarità che qui il legame non era una
somiglianza ma una **dipendenza**: la seconda esiste nella forma che ha *perché*
la prima ha risposto come ha risposto.

- L'identità è **il path, per sempre**
  ([0043](../decisions/0043-il-path-e-la-chiave.md)), e la ragione non è che una
  seconda chiave costi troppo: è che un id stabile o vive dentro il file — e
  allora è una **proprietà**, già esprimibile oggi — o vive fuori, e allora non
  sopravvive alla rinomina fatta ad app chiusa, che è l'unica cosa per cui
  esisterebbe. Della voce è entrata nel contratto una domanda sola, ed è quella
  che rende scrivibile il redirect che la decisione rimanda a una feature:
  `IndexQuery::Resolve`, che toglie di mezzo l'ultimo comando IPC con cui la
  shell sapeva qualcosa sul vault che un plugin non poteva chiedere.
- Lo stato per-documento ha **un posto dichiarato**
  ([0044](../decisions/0044-lo-stato-per-documento.md)), e non una porta nuova:
  un prefisso dentro lo spazio dati che c'era già, che il kernel migra al rename
  e raccoglie quando la nota non è più né nel vault né nel cestino. La metà che
  regge il peso è l'**inverso** — di ogni cartella si sa quale nota nomina — e
  senza di essa la domanda «cancellata una nota per sempre, chi cancella i dati
  che la nominavano?» non aveva risposta.
- L'undo ha **due pile che non si fondono**
  ([0045](../decisions/0045-l-undo-ha-due-pile.md)): il testo nell'editor, le
  operazioni nel kernel, e a decidere quale risponde è il fuoco e non la
  cronologia. L'inverso di un'operazione strutturale non è un vocabolario nuovo:
  è un **comando**, perché le operazioni un nome ce l'hanno già — e da lì viene
  il guadagno che nessuno aveva previsto, cioè che annullare una rinomina
  riporti indietro anche i wikilink che la rinomina aveva riscritto.

E il bug che la voce dell'undo aveva nominato come «da chiudere subito» è chiuso:
dopo un cambio nota, un Ctrl-Z riportava il contenuto della nota **precedente**
dentro il documento aperto, e il salvataggio automatico lo persisteva. Il
presidio che lo tiene chiuso è stato verificato rosso sul codice di prima, che è
l'unico modo di sapere che non passa a vuoto.

Resta fuori, e sono di altre sedute: la **durabilità** di quella pila — un undo
che sopravviva alla chiusura del vault è un journal e non una pila, ed è il
[§15.2](15-il-disco.md); il **redo**, che nessun cliente ha chiesto; e la
superficie in cui la shell mostrerebbe cosa si annullerebbe, che sta col
[§20.4](20-quando-qualcosa-va-storto.md). Il posto dove atterreranno adesso c'è.
