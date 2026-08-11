# 10. Gli eventi: grana, freno, destinatari

Una **seduta (sessione di lavoro)** chiusa della [roadmap infrastrutturale](../todo.md). Esamina lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa.** L'analisi valuta tre voci dello stesso canale, viste a tre distanze. Lo studio pone la stessa domanda ai tre capi: *a chi interessa questo evento?*

| Ruolo | Destinatario | Elementi | Decisione |
| --- | --- | --- | --- |
| Iscrizione | Chi si **abbona** | Il prefisso di topic (argomento del messaggio) e il soggetto | [0033](../decisions/0033-la-grana-di-un-abbonamento.md) |
| Trasmissione | Chi **consegna** | Il tetto degli arretrati e il raggruppamento della raffica (serie rapida di messaggi) | [0034](../decisions/0034-il-freno-e-il-raggruppamento.md) |
| Visualizzazione | Chi **guarda** | Il centro notifiche e il centro attività (il punto con una persona fisica) | [0035](../decisions/0035-il-lavoro-lungo-si-racconta.md) |

### Integrazione del ponte

Queste tre componenti lavorano insieme. Il centro attività è il primo cliente reale del ponte (sistema di comunicazione). Il ponte necessitava di una politica propria.

* **Progresso:** Il canale più fitto del contratto trasmette il progresso di un job (attività in background). Il progresso entra nel sistema. Usa esclusivamente i meccanismi esistenti.
* **Identità:** Il nodo della [0034](../decisions/0034-il-freno-e-il-raggruppamento.md) era un job ignaro del proprio `JobId`. La soluzione analizza la funzione `emit` (emissione di eventi). Il progresso rimane un evento. La porta firma l'evento tramite l'entità proprietaria dell'identità.

### Errori e avvisi

La gestione degli errori appartiene a un'altra seduta (sessione). Gli errori nel backend generano una variante di evento per segnalare il problema.

* **Errore tipizzato:** L'evento contiene un errore tipizzato per fornire dettagli diagnostici. Il meccanismo risiede nel [§20.2](20-quando-qualcosa-va-storto.md) (con il §12.2 per il tipo).
* **Gestione avvisi:** I quattordici avvisi originariamente scritti in `console` raggiungono questo punto per visibilità. Il passaggio è documentato nel [§20.4](20-quando-qualcosa-va-storto.md). La decisione [0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md) risulta **chiusa**. Il sistema accoglie tutti e quattordici avvisi.
