# 13. L'identità di un documento, e ciò che gli sta attaccato

Una **seduta** della [roadmap infrastrutturale](../todo.md): la stessa domanda a tre distanze: l'identità, ciò che le sta attaccato, la sua storia.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiede di decidere §13.2 *insieme* a §13.1 e §11.3: «sono la
stessa domanda vista da tre distanze». Se l'identità resta il path, la migrazione
della chiave è per sempre un problema del kernel; con un id stabile diventa un
non-problema — e con essa cambiano il rename, i redirect, il cestino e ogni
spazio dati per-documento.

L'undo sta qui perché è la stessa domanda sul tempo invece che sullo spazio: chi
possiede la storia di un documento. La forma dell'inverso di una modifica c'è già
([decisione 0008](../decisions/0008-modifica-chirurgica.md)), il meccanismo sarà il
journal (15.2); manca chi la conserva, per quanto, e chi vince fra le due
pile.

### 13.1 Identità del documento — il path, e l'eventuale seconda chiave

*ex §1.10 · contratto · **P0** — ogni firma del contratto prende `DocId`: dopo il freeze la seconda strada è una major*

- [ ] **Mettere a verbale la scelta**: `DocId` è il path, ed è una decisione
      dichiarata (PIANO, "l'identità è il path"). Ma FEATURES chiede "UUID
      opzionale per nota" (2.2), "Stable note ID" e "Redirect da note rinominate"
      (7.1), "ID univoco nota" e Zettelkasten ID (8.3). Ogni firma del contratto
      prende `DocId`: o si dichiara che il path è **per sempre** la chiave e i
      redirect sono una feature sopra (tabella di alias persistente, come i
      tombstone del versioning), o si introduce ora un `DocRef` a due forme.
      Dopo il freeze la seconda strada è una major. La [decisione 0003](../decisions/0003-modello-del-documento.md) copre le ancore
      *dentro* il documento; questa è l'identità *del* documento.

### 13.2 Lo stato per-documento: ogni feature se lo migra da sé

*ex §2.24 · kernel · **P2** — la forma generale di cui l'11.3 è un caso concreto*

- [ ] **Il rename è già un rito che ognuno celebra per conto proprio**: il
      versioning migra la sua chiave sull'evento `DocumentRenamed`, il sidecar
      dell'organizzazione la migra in TypeScript (`main.ts:714`), e le prossime
      — annotazioni (13.3), task (10), commenti (4.3, 19.2), database (11),
      flashcard (21.2) — la migreranno una terza e una quarta volta, ognuna col
      proprio buco già annotato al §11.3 (il rename fatto ad app chiusa non lo
      vede nessuno).
- [ ] **E nessuno raccoglie**: cancellata una nota per sempre (svuota cestino),
      chi cancella i dati che la nominavano? Oggi il versioning tiene tombstone
      per scelta propria; per tutti gli altri lo spazio dati cresce con chiavi
      morte che nessun GC visita.
- [ ] **Manca la primitiva**: uno spazio dati **per-documento** namespaced per
      plugin, che il kernel migra sul rename e ripulisce sulla cancellazione
      definitiva, con la sua politica di raccolta. Il §11.3 chiede di assorbire
      *un* sidecar concreto; questa è la forma generale, e va decisa insieme al
      §13.1 (se l'identità resta il path, la migrazione della chiave è per
      sempre un problema del kernel; con un id stabile diventa un non-problema).

### 13.3 L'undo non ha un proprietario

*ex §1.17 · contratto · **P0** — senza la decisione, il lotto e `CommandOutcome` nascono privi del campo*

- [ ] **Oggi l'undo vive solo dentro CodeMirror**, su un **unico** `EditorView`
      costruito una volta (`editor.ts:81`, da `main.ts:132`) e riusato per tutte
      le note: `setDoc` sostituisce il documento con un `dispatch` di `changes`
      normali, che entrano nella history di `basicSetup` come qualunque
      modifica dell'utente. Non c'è un modello di undo, c'è l'undo di una
      libreria, e la libreria non sa che le note sono cambiate.
- [ ] **Il difetto che ne segue non aspetta questa decisione, ed è un bug della
      shell: va chiuso subito.** Dopo un cambio nota un Ctrl-Z riporta il
      contenuto della nota *precedente* — cioè scrive nel documento aperto il
      testo di un altro, e il salvataggio automatico lo persiste. Si chiude
      svuotando la history dentro `setDoc` (o marcando quel `dispatch` come non
      annullabile), in poche righe, senza nessuna delle decisioni di forma qui
      sotto. Tenerlo in ostaggio del freeze significa lasciare per mesi una
      perdita di dati a portata di scorciatoia; sta come lavoro di shell nel
      §18.1, e qui resta perché è il **sintomo** che ha fatto trovare la voce.
- [ ] **Nessuna mutazione del kernel è annullabile**: rename con riscrittura di
      N sorgenti (`workspace.rs`), ripristino di versione, e domani bulk
      fix, automazioni, import. FEATURES lo chiede in cinque punti: 4.2 (undo
      illimitato, cronologia per sessione), 3.3 (undo toast), 11.3 (undo
      database), 16.3 (undo delle automazioni), 17.3 (rollback dell'import).
- [ ] **Decidere i due livelli e chi vince dove**: undo del *testo* nell'editor
      (per-documento, e per-pane con la [decisione 0007](../decisions/0007-contesto-di-sessione.md)) e undo delle *operazioni* nel kernel
      (il journal del §15.2 come meccanismo, l'inverso dichiarato dal lotto della
      [decisione 0011](../decisions/0011-il-lotto.md)). È di forma: senza la decisione, `CommandOutcome` e il lotto
      nascono privi del campo con cui un'operazione dichiara di essere
      annullabile.
- [ ] La [decisione 0008](../decisions/0008-modifica-chirurgica.md) ha già dato la **forma dell'inverso** di una modifica al testo
      (`EditReport::inverse()` è una `EditRequest` come le altre, con per base la
      revisione appena prodotta): quello che manca è chi la conserva, per quanto,
      e chi vince fra le due pile.
