# Baseline WIT congelate

`crates/fub-abi/wit/frozen/` contiene una copia per ogni versione pubblicata del contratto. Non è un archivio decorativo: è l'input del test di additività.

Dopo il freeze, una versione compatibile può aggiungere superficie ma non rimuovere, rinominare o cambiare ciò che un guest già compilato usa. Una rottura deliberata deve essere resa evidente modificando la baseline e la politica di versione nello stesso cambiamento.

La disciplina completa è in [`06-contratto/03-il-contratto-wit.md`](../06-contratto/03-il-contratto-wit.md), il significato dei numeri in [`versionamento.md`](../versionamento.md) e la milestone che ha chiuso il freeze in [`milestones/M4-wit-hardening.md`](../milestones/M4-wit-hardening.md).