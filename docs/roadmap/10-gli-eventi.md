# 10. Gli eventi: grana, freno, destinatari

Una **seduta chiusa** della [roadmap infrastrutturale](../todo.md): lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Chiusa.** Tre voci sullo stesso canale, viste a tre distanze, e la stessa
domanda posta ai tre capi — *a chi interessa questo evento?*:

- a chi si **abbona** ([0033](../decisions/0033-la-grana-di-un-abbonamento.md)):
  il prefisso di topic e il soggetto;
- a chi **consegna** ([0034](../decisions/0034-il-freno-e-il-raggruppamento.md)):
  il tetto degli arretrati e il raggruppamento della raffica;
- a chi **guarda** ([0035](../decisions/0035-il-lavoro-lungo-si-racconta.md)): il
  centro notifiche e il centro attività, cioè l'unico punto della seduta in cui
  c'è una persona.

Le tre stavano insieme per una ragione che si è vista alla fine: il centro
attività è il primo cliente vero del ponte, e il ponte non aveva una politica
sua. Quando l'ha avuta, il canale più fitto che il contratto avrà — il progresso
di un job — è entrato senza chiedere una riga di meccanismo nuovo. E il nodo che
la 0034 aveva lasciato sciolto a metà — *un job non conosce il proprio `JobId`* —
si è sciolto guardando `emit`: il progresso resta un evento, e la porta da cui
passa lo firma chi l'identità ce l'ha.

Resta fuori, ed è di un'altra seduta: che ciò che va storto **nel backend** abbia
una variante di evento con dentro un errore tipizzato è il
[§20.2](20-quando-qualcosa-va-storto.md) (col §12.2 per il tipo), e che i
quattordici avvisi allora scritti in `console` arrivino fin qui era il
[§20.4](20-quando-qualcosa-va-storto.md), **chiuso** dalla
[0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md): ci sono
atterrati tutti e quattordici.
