# 4. Chi vede il modello parsato

Questo file è una **seduta** (fase di pianificazione) della [roadmap infrastrutturale](../todo.md).
La seduta determina chi vede la struttura di un documento.
La [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md) contiene la risposta.
La coda shell (le attività residue dell'interfaccia) resta in questo documento.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) (a maggiore impatto) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La [decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md) chiude tre voci su quattro.

**Stato del modello (la struttura dati parsata):**
* **Richiesta:** Il modello si interroga con `HostApi::read_model`.
* **Formato:** Il formato del documento si identifica con `HostApi::format_of` prima dell'apertura.
* **Confine IPC:** Il modello si ferma prima dell'IPC (Inter-Process Communication). La shell chiede le operazioni al modello tramite comandi.
* **Ottimizzazione:** L'operazione `render_preview` offre la fast-path (la via di esecuzione rapida) per la lettura.

**Stato dell'editor (il componente di testo):**
Una voce pone la stessa domanda per l'editor.
La decisione sblocca questa voce e la mantiene da completare.
Il confine attuale distribuisce le responsabilità in questo modo:
* Il **buffer** (la memoria attiva del testo) appartiene a Lezer (il sistema di parsing incrementale).
* Il **file** (i dati su disco) appartiene al modello.

**Attività residue:**
Le ~50 estensioni del capitolo 5.2 si creano due volte.
La condivisione della *dichiarazione* di una sintassi fra i due lati unifica la creazione.
Questa voce appartiene alla shell.
La voce si integra con il secondo livello della §18.1.
L'attività si sposta nella [§4.4 in coda alla seduta 18](18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi).
Il numero si trasferisce e conserva il nome.
