# 13. L'identità di un documento, e ciò che gli sta attaccato

Una **seduta chiusa** (seduta di pianificazione completata) della [roadmap infrastrutturale](../todo.md) (piano d'azione tecnico). Esamina la stessa domanda a tre distanze: l'identità, gli elementi collegati, la sua storia.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Stato:** Chiusa.

Tre voci sono state decise insieme nel quinto giro (quinto ciclo di sviluppo).
Hanno una **dipendenza** diretta. La forma della seconda voce deriva dalla risposta della prima.

### Decisioni

- **Identità del documento:** **Il path, per sempre** ([0043](../decisions/0043-il-path-e-la-chiave.md)).
  - **Cos'è:** L'identità corrisponde al path (percorso nel file system).
  - **Perché:** Una seconda chiave ha un costo. Il motivo principale riguarda la stabilità dell'ID. Un ID stabile interno è una **proprietà** già supportata. Un ID esterno svanisce con la rinomina ad app chiusa.
  - **Contratto API:** Il contratto include una domanda sola: `IndexQuery::Resolve`.
  - **Beneficio:** L'API sostituisce l'ultimo comando IPC (comunicazione tra processi). Un plugin (modulo estensibile) ha le stesse capacità della shell (interfaccia utente) sul vault (archivio dei documenti).

- **Stato per-documento:** Ha **un posto dichiarato** ([0044](../decisions/0044-lo-stato-per-documento.md)).
  - **Cos'è:** Usa un prefisso in uno spazio dati esistente.
  - **Perché:** Il kernel (motore centrale) migra lo stato durante il rename (la rinomina). Il kernel lo raccoglie quando la nota esce dal vault e dal cestino.
  - **Relazione inversa:** Ogni cartella indica la nota corrispondente.
  - **Beneficio:** Questa associazione permette di eliminare i dati collegati alla rimozione definitiva di una nota.

- **Sistema di Undo:** Ha **due pile separate** ([0045](../decisions/0045-l-undo-ha-due-pile.md)).
  - **Cos'è:** Usa una pila per l'editor e una pila per il kernel. Il fuoco (elemento attivo dell'interfaccia) determina la pila in uso.
  - **Perché:** L'inverso di un'operazione strutturale impiega un **comando** esistente.
  - **Beneficio inatteso:** Annullare una rinomina ripristina automaticamente i wikilink riscritti dall'operazione.

### Bug risolti

- **Bug dell'undo:** Chiuso.
  - **Cos'è:** Dopo un cambio nota, Ctrl-Z incollava il contenuto della nota **precedente** nel documento aperto. Il salvataggio automatico persisteva l'errore.
  - **Soluzione:** Inserimento di un presidio (test automatizzato). Il test falliva intenzionalmente sul codice di prima. Questo verifica la validità del blocco.

### Elementi rimandati ad altre sedute

- **Durabilità:** Un undo permanente tra i riavvii del vault è un journal (registro cronologico). Questo punto appartiene al [§15.2](15-il-disco.md).
- **Funzione di Redo:** Manca di richieste dai clienti.
- **Interfaccia:** La superficie della shell per le informazioni dell'undo apparteneva al [§20.4](20-quando-qualcosa-va-storto.md). Il punto è chiuso in ([0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md)). Il posto per i messaggi esiste.
