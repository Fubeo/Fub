# 0008 — Modificare un pezzo di documento — la primitiva che non c'è

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.16 (terzo giro) |
| **Commit** | `903c663` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **La primitiva c'è**: `HostApi::apply_edit(id, EditRequest)` con
      `EditRequest { base: Revision, edits: Vec<TextEdit> }` e
      `TextEdit { span, text }` (`abi/edit.rs`, interface `edit` nel WIT).
      Accanto, `HostApi::document_revision(id)`: la base la si **chiede**,
      perché la revisione è opaca e derivarla è affare dell'host.
- [x] **La firma dice su cosa si applica**, e non come campo opzionale: senza
      base non si scrive. Chi arriva secondo riceve `PluginError::Conflict` —
      caso nuovo del contratto, additivo — rilegge e ricalcola, invece di
      cancellare il lavoro di chi ha scritto per primo.
- [x] **Un cliente vero nello stesso giro**: la riscrittura dei wikilink su
      rename. `link_rewrite_plan` calcolava già gli span dei link e poi ne
      ricomponeva la sorgente intera; ora produce un `EditRequest` per sorgente
      e `rename_document` lo applica. Il guadagno è visibile in un test: se un
      handler scrive in una delle sorgenti del piano mentre il piano è in corso,
      la sua riga **resta** e il rename nomina la sorgente che non ha potuto
      riscrivere, invece di sovrascriverla in silenzio.
- [x] **L'inverso di un edit è un edit**: `EditReport { revision, applied }`
      torna nelle coordinate del testo nuovo e porta ciò che era stato
      sostituito, quindi `inverse()` è una `EditRequest` come le altre — con per
      base la revisione appena prodotta.

*Sblocca:* 4.3, 7.2 (bulk fix), 8.2, 10.1, 11.3, 16.1 (cursor placement), 19.2,
22.2; ed è la primitiva su cui poggiano la [decisione 0011](../decisions/0011-il-lotto.md) (il lotto è una lista di edit) e il
§13.3 (l'undo).

**Fatto, con quattro decisioni e un debito dichiarato.**

*La base non è opzionale.* Poteva esserlo — un `Option<Revision>` con `None` =
«applica e basta» avrebbe fatto contenti i chiamanti che il documento l'hanno
appena letto. Ma la corsa che questa voce descrive è **invisibile**: chi
sovrascrive il lavoro di un altro non se ne accorge, e un campo che si può
omettere lo si omette proprio nel caso lungo (l'automazione che calcola per un
minuto), che è l'unico in cui serve. Il prezzo dichiarato: una chiamata in più
(`document_revision`) per chi vuole scrivere in fondo a una nota senza averla
letta.

*La revisione è un'impronta del contenuto, ed è opaca.* Opaca perché di essa è
contratto **solo l'uguaglianza**: un host che la derivasse da un digest o da
`mtime+size` sarebbe conforme uguale, e per questo un provider la chiede invece
di calcolarla (`Revision::of` esiste, ma è come la deriva *questo* host — sta
nell'abi perché kernel e doppi dei test ne abbiano una sola implementazione).
Impronta e non contatore perché la domanda vera è "*è ancora quel testo?*", non
"*quante volte è stato scritto?*": chi digita una lettera e la cancella riporta
il documento a com'era, e un edit calcolato allora è ancora valido. Il caso non
è teorico — è la stessa proprietà per cui il piano di rename, calcolato sul
sorgente al path vecchio, si applica al path nuovo: un rename sposta il file, non
lo cambia.

*Gli edit sono un insieme in coordinate della base.* Non una sequenza di passi:
chi li calcola non deve tenere il conto di quanto il testo si sposta per via
degli altri — li elenca in qualunque ordine, l'host ordina e applica in un colpo
solo. Ciò che non sta in piedi (fuori dal sorgente, **a metà di un carattere**,
sovrapposti, due nello stesso punto) è `BadArgs`, mai un documento modificato a
metà: un taglio dentro un UTF-8 non produce un documento sbagliato, produce byte
che non sono testo e una nota che non si riapre.

*Il conflitto è un errore, non un campo del rapporto.* La stessa ragione del
`dirty: bool` scartato alla [decisione 0007](../decisions/0007-contesto-di-sessione.md): un `applied: false` dentro un esito riuscito si
dimentica di leggere. Ed è un caso a sé di `PluginError` e non un `BadArgs`
perché è l'unico errore del confine che **non è una colpa di chi chiama** — gli
argomenti erano giusti quando li ha calcolati, e la risposta giusta è
ricalcolare, non correggere. Chi non li distingue riprova all'infinito una
richiesta malformata, o rinuncia a una che sarebbe riuscita.

*Resta fuori, dichiarato:* il **lotto su più documenti** ([decisione 0011](../decisions/0011-il-lotto.md) — una richiesta
nomina un documento solo, e N documenti restano N scritture con N eventi: il
rename ne è la prova, e il lotto sarà una lista di edit *sopra* questa firma);
la **proprietà dell'undo** (§13.3 — qui c'è la forma dell'inverso, non chi la
usa); l'**edit sull'evento** ([decisione 0012](../decisions/0012-origine-degli-eventi.md)), e con esso il costo che questa voce
descriveva dal lato della shell: finché `DocumentChanged` dice *che* un
documento è cambiato e non *come*, l'editor che lo ha aperto deve ricaricarlo
intero (`reloadIfClean`) e il cursore salta lo stesso — la primitiva non basta
da sola, serve che il kernel racconti la modifica; la **superficie IPC**, perché
i clienti di shell che ci sarebbero (spuntare un task, correggere un link
dall'anteprima) chiedono al modello lo stato di spunta ([decisione 0003](../decisions/0003-modello-del-documento.md)) e alla UI dei
campi di input con un payload vero (§2.1/§2.8), e nessuno dei due c'è; la
**fusione** di due edit concorrenti (18.1): qui il conflitto si dichiara, non si
risolve.
