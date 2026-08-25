# Lavoro aperto

Questo file contiene soltanto ciò che richiede ancora una decisione o un
intervento. Le decisioni chiuse sono archiviate in
[`decisions/`](decisions/README.md); le sedute che le hanno originate sono in
[`roadmap/`](roadmap/README.md).

## Il criterio

- Una voce resta qui finché non viene chiusa, scartata o trasformata in un difetto misurato.
- Una decisione chiusa scompare dalla tabella e produce un ADR quando il suo perché deve restare stabile.
- Un residuo già deciso resta nella sezione “Differiti” fino al verificarsi del suo trigger.
- Un difetto entra nell'ultima sezione soltanto quando ha una riproduzione e un criterio di chiusura misurabile.

## Decisioni ancora aperte

Le voci aperte sono **cinque** [conta: voci-aperte].

| Voce | Decisione richiesta | Fonte | Priorità | Prossimo passo |
|---|---|---|---|---|
| **§29.2** | Il contratto del tema: data di congelamento del vocabolario | [Seduta 29](roadmap/29-chi-possiede-la-pelle.md) | P1 | Stabilire cosa deve essere stabile prima di accettare temi di terzi. |
| **§29.4** | La scelta del tema dalla shell | [Seduta 29](roadmap/29-chi-possiede-la-pelle.md) | P1 | Definire selezione, persistenza e fallback senza duplicare lo stato. |
| **§29.5** | La scheda, l'anteprima e la via di fuga | [Seduta 29](roadmap/29-chi-possiede-la-pelle.md) | P1 | Specificare anteprima sicura, annullamento e recupero da un tema illeggibile. |
| **§29.6** | Dove vive un tema e come entra | [Seduta 29](roadmap/29-chi-possiede-la-pelle.md) | P2 | Scegliere formato del bundle, provenienza e ciclo di installazione. |
| **§31.9** | La scheda Temi nella consegna agli autori | [Seduta 31](roadmap/31-da-dove-viene-cio-che-si-vede.md) | P1 | Definire quali metadati e strumenti deve ricevere chi crea un tema. |

## Lavoro differito con trigger

Queste voci non richiedono una nuova decisione adesso. La forma è già stata
scelta; l'implementazione parte soltanto quando compare il primo cliente reale.

| Fonte | Lavoro differito | Trigger per riaprirlo |
|---|---|---|
| §11.2 | Layout salvati con nome | Esiste un secondo layout reale da salvare e richiamare. |
| §14.1 | Voci derivate nell'anagrafe del vault | Una vista richiede una voce che non corrisponde a un elemento persistito. |
| §16.3 | Separare `fub-features` in bundle crate | Compare il primo import non documentale fra due moduli di funzionalità. |
| §3.3 | Apertura generica di una vista principale diversa dal grafo | Un secondo tipo di vista principale deve essere aperto dalla shell. |
| Seduta 19 | Organizzazione della sidebar con plugin installati | Un plugin di terzi aggiunge una superficie persistente alla sidebar. |
| §22.3 | Query incorporata dentro una nota e relativa invalidazione | Un caso d'uso richiede risultati vivi dentro il documento. |
| §23.7 | Parsing localizzato dei nomi dei mesi | Un secondo client richiede date in linguaggio naturale localizzato. |
| §2.9 | Rendering incrementale dell'anteprima | Il primo documento reale supera il costo accettabile del rendering completo. |
| §25.7 | Campo additivo `carichi` in `syntax-rule-spec` | Un tipo sintattico di terzi richiede un payload personalizzato. |

## I difetti misurati

I difetti misurati aperti sono **zero** [conta: difetti-aperti].

| ID | Difetto | Riproduzione | Criterio di chiusura |
|---|---|---|---|

Quando nasce un difetto, assegnargli un ID di quattro cifre e aggiungere una sola
riga. La cronologia delle correzioni appartiene al changelog, al commit o
all'ADR che ha cambiato una regola, non a questo file.
