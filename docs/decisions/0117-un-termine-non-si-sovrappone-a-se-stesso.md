# 0117 — Un termine non si sovrappone a se stesso

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: il difetto *«due occorrenze dello stesso termine possono sovrapporsi»* di [«I difetti da correggere»](../todo.md)
**Commit**: *(questo commit)*

---

## La domanda

`occurrences::locate` promette, nella sua intestazione, occorrenze «in ordine di
posizione e senza sovrapposizioni fra occorrenze uguali». La scansione di un
termine però riparte da `span.start + 1` e non da `span.end`, quindi `aa` dentro
`aaaa` produce tre span — `[0,2)`, `[1,3)`, `[2,4)` — e il `dedup` non ne toglie
nessuno, perché non sono *uguali*: sono sovrapposti. O si riparte dalla fine, o
si corregge la frase.

## La premessa che sembrava vera, e non lo era

Accanto al `from = next_boundary(source, span.start)` c'era la ragione, scritta
per esteso: *«due termini diversi possono cadere sullo stesso pezzo di testo
(`arch` dentro `architettura`), e saltare la coda ne perderebbe uno»*. È una
frase vera su una cosa vera — la sovrapposizione fra termini diversi è voluta, e
c'è un banco che la difende
(`un_prefisso_e_un_termine_intero_non_si_mangiano_a_vicenda`) — ed è **falsa
come giustificazione di quella riga**.

Il motivo è nella forma del ciclo, non nel testo: i termini si scandiscono uno
per uno, in un `for` esterno, e `from` **torna a zero a ogni termine**. Il punto
di ripartenza non è mai stato in grado di far perdere l'occorrenza di un altro
termine: `architettura` la trova la sua scansione, che comincia dall'inizio del
file, qualunque cosa abbia fatto la scansione di `arch`. Il riavvio da
`span.start` non comprava niente di ciò che il commento diceva di comprare —
comprava solo la sovrapposizione di un termine con se stesso.

Sembrava vera perché il banco che la nomina **passa**, e passa anche col
comportamento vecchio: è la prova che la frase indicava e non era la prova della
frase. Il che è la regola generale di cui questa è l'ennesima istanza: *un corpus
di prova può essere cieco a una passata che riconosce di troppo*. Il caso è stato
misurato nei due versi — rimessa la riga vecchia, il banco nuovo diventa rosso e
quello di `arch` resta verde; rimessa quella nuova, tutti e due verdi — ed è per
questo che i due banchi ora stanno **accanto** e si nominano a vicenda nel
doc-comment.

## La decisione: cambiare il comportamento, non la frase

Le strade erano due — riparare la scansione, o ammettere nell'intestazione che la
sovrapposizione è voluta. Decide **chi consuma gli span**, e i consumatori sono
due, tutti e due nella shell:

- `frontend/src/rules/risultati.ts:44` — ogni occorrenza oltre la prima diventa
  una **riga cliccabile** dell'elenco dei risultati, etichettata «occorrenza 2»,
  «occorrenza 3», …;
- `frontend/src/panels/doc-search.ts:158` e `frontend/src/panels/search.ts:165` —
  quel click porta il cursore a `span.start`.

Nessuno *evidenzia* con questi span (le evidenziazioni della riga sono gli
`highlights` dello snippet, che vengono da chi indicizza), ma il verso del danno
è lo stesso: cercare `--` in un righello di tabella `|-----|` offriva quattro
righe da premere per due posti a cui andare, e la seconda cadeva **dentro** la
prima. Un elenco di punti a cui saltare che ne conta più di quanti ce ne sono è
sbagliato quanto un'evidenziazione disegnata due volte; e il tetto di
`MAX_PER_DOC`, che è del documento, veniva consumato da quei doppioni a scapito
degli altri termini. La frase dell'intestazione, quindi, non andava indebolita:
andava **mantenuta**.

C'era anche un precedente in casa: `fub_features::commands::occurrences`
(`crates/fub-features/src/commands.rs:2007`), che serve `vault.replace`, riparte
da `end` e lo dice — «due edit non possono contendersi lo stesso punto». La
differenza fra i due casi non era mai stata una decisione: era un ciclo scritto
in un modo diverso.

## La regola

**Dentro un termine, le occorrenze non si sovrappongono; fra termini diversi, sì.**

Il confine è la scansione: ognuna riparte da `span.end` e ognuna comincia da
zero. La prima metà è ciò che rende l'elenco un elenco di *punti distinti*; la
seconda è ciò che tiene `arch` accanto ad `architettura` per chi li ha cercati
tutti e due. La sovrapposizione non è un incidente da tollerare né un difetto da
sopprimere: è la differenza fra «lo stesso testo trovato due volte» e «due testi
diversi trovati nello stesso posto».

`next_boundary` sparisce con la riga che serviva: `span.end` cade già su un
confine di carattere, perché è il prodotto di `prefix_len_ci`, che misura sui
caratteri del sorgente.

## Cosa resta scoperto

Niente in questa voce. Un centimetro più in là, e nominato soltanto: `wanted`
(`crates/fub-kernel/src/occurrences.rs:61`) deduplica i termini con un
`Vec::contains`, cioè con un confronto **sensibile al caso**, mentre `locate` lo
ignora — chi cerca `Rust rust` paga due scansioni identiche dello stesso
documento e ne riceve gli stessi span, che il `dedup` finale poi butta. Costa
solo lavoro, non verità, e per questo non è entrato qui.
