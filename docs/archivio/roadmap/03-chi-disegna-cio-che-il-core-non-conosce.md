# 3. Chi disegna gli elementi esterni al core (motore principale)

Una **seduta** (incontro di lavoro) della [roadmap infrastrutturale](../todo.md)
(piano tecnico) affronta una decisione sola. Questa decisione coinvolge tre
lati:
* La sintassi (regole del codice).
* Il blocco (struttura dei dati).
* Il renderer (disegnatore) nella shell (interfaccia utente).

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa dalla
[decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)**.
Resta aperta soltanto la metà implementativa della §3.3.

Il quarto giro definisce la §3.1, la §3.2 e la §3.3 come una decisione sola
vista da tre lati:
* Chi aggiunge la *sintassi*.
* Chi disegna il *blocco* risultante.
* Chi fa entrare un renderer di terzi (fornitore esterno) nella *shell*.

Questi aspetti richiedono un'azione congiunta. L'approccio frammentato rende due
terzi della risposta inutilizzabili.

Il `custom_kind` (tipo personalizzato) costituisce il perno strutturale.
Meccanismo d'azione:
* Un nome con namespace (spazio dei nomi) lo produce.
* Lo stesso nome lo disegna.
* Lo stesso nome arriva alla shell dentro `UiKind::Custom { ns }`.

La chiusura coinvolge anche queste sezioni:
* §3.4: le opzioni di parse (lettura e interpretazione).
* §3.5: i quattro tipi isolati prematuramente, riuniti in **un tipo solo** con
  namespace.
* §3.6: la sanitizzazione (pulizia dei dati) e il CSP (politiche di sicurezza)
  applicati in un punto solo.

Il verbale documenta gli elementi scartati e le aree scoperte.

La **decisione** per la §3.3 conferma la terza opzione: *solo prima parte e
tutto il resto dichiarativo*. La sua metà di esecuzione si sposta in coda alla
seduta 18. Questa operazione si posiziona accanto alla
[§1.2](18-editor-e-tastiera.md#12-smontare-il-monolite). La §1.2 garantisce il
suo sblocco. Il numero si trasferisce. Il numero conserva la propria identità.

L'implementazione ora è **chiusa**
([0079](../decisions/0079-il-grafo-esce-dall-overlay.md)). Caratteristiche della
soluzione:
* Il grafo (schema a nodi) è un `ViewProvider` (fornitore di vista) sull'area
  principale.
* Il ramo della shell legge `ns` e disegna il suo widget (componente grafico).

La 0017 descriveva questo ramo. Il documento posticipava la costruzione in
attesa di un cliente. Oggi il ramo ha il suo cliente. Rileggere la 0017 è utile.
Il testo ha posticipato la costruzione con successo. Il testo ha previsto
l'architettura esatta.
