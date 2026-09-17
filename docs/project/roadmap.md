# Roadmap

> **Stato aggiornato per:** tree `audit-close` al merge
> `2cc2e44c3f6dc619218354f6cc89fff2c1517cf2`, tree
> `e8b9e0c0445ca9cf98ce503d4e07402097f9da62`, 17 settembre 2026.

La roadmap descrive ordine e direzione. Le GitHub Issues restano il tracker
delle attività eseguibili. Un prossimo passo approvato può avere un TODO
operativo in `project/` quando l'issue non è sufficiente a conservare una
sequenza tecnica estesa.

```mermaid
flowchart LR
    NOW["Ora<br/>stabilizzazione e audit"] --> NEXT["Dopo<br/>release e temi"]
    NEXT --> LATER["Più avanti<br/>nuovi formati e servizi opt-in"]
```

## Vincolo di integrazione

La [governance corrente](status.md#governance-di-integrazione) mantiene in
vigore il piano audit di `fix/audit-integration`: prima di G15/GO non si
integra in `main`, neppure una PR M5 o documentale verde. I candidati vanno
riconciliati con il lavoro audit e certificati nuovamente dopo l'integrazione.
Questa roadmap stabilisce l'ordine del lavoro, non deroga ai gate audit.

## Ora

### M5 consegnata sulla linea audit

Il tree `2cc2e44c` contiene il percorso prodotto installato: inventario
persistente nella configurazione macchina, installazione da file scelto,
consenso per gli esatti byte, scelta `enabled`, startup filtrato su
`enabled && granted`, restart e rimozione da disabilitato. Collisioni di id,
digest alterati, file incompleti e cleanup sono errori espliciti; `.fub/plugins/`
resta storage autorevole, non una directory di eseguibili.

Sono consegnati i provider `ViewProvider`, `FormatProvider` e `GridProvider`
nei percorsi nativo/WASM coperti, con validazione UI non fidata, limiti,
fallback, ownership e teardown. #8 e #10 restano i tracker **OPEN** per la
chiusura formale e le evidenze audit; questa roadmap non li dichiara chiusi e
non trasferisce il risultato in `main`.

### Stabilizzare i dati

- ripristino atomico;
- backup e restore provati;
- nessuna perdita silenziosa su snapshot, schema o storage plugin.

Issue: [#5](https://github.com/Fubeo/Fub/issues/5) e
[#7](https://github.com/Fubeo/Fub/issues/7).

### Misurare la Graph View

- modularizzare senza cambiare il contratto dati;
- dimostrare determinismo, teardown, scala e durata.

Issue: [#6](https://github.com/Fubeo/Fub/issues/6) e
[#12](https://github.com/Fubeo/Fub/issues/12).

### Completare le evidenze visuali

Il passaggio del banco in CI non chiude la revisione delle baseline. Provenienza,
foglio di contatto, ripetibilità nello stesso ambiente, soglie e diagnosi del
drift restano in [#17](https://github.com/Fubeo/Fub/issues/17), tracker unico che
ha assorbito #16. Non rigenerare immagini per nascondere regressioni.

## Consegne sulla base audit corrente

La fase 10 di #11 è integrata nella base `fix/audit-integration` con
`2cc2e44c` e tree `e8b9e0c`. ABI/WIT, mirror TypeScript, provider nativo,
componente WASM, client shell a finestre/patch, fallback, ownership e teardown
sono presenti e certificati sulla PR #49. La consegna è reale su questa base,
ma le checkbox del TODO restano vincolate alla promozione in `main`.

- Tracker: [issue #11](https://github.com/Fubeo/Fub/issues/11).
- Piano operativo:
  [TODO — superfici di editing condivise](todo-superfici-di-editing-condivise.md).

## Dopo

### Contratto dei temi

Chiudere compatibilità, discovery, selezione, anteprima e guida per autori senza
pubblicare forme prive di consumatori.

Issue: [#13](https://github.com/Fubeo/Fub/issues/13).

### Prima release

Prima della release va decisa esplicitamente la classificazione di
[#9](https://github.com/Fubeo/Fub/issues/9): blocker da completare oppure
lavoro successivo con motivazione. La collocazione fra le direzioni future
non è, da sola, un'accettazione del rischio della sincronizzazione esistente.

- installazione verificata;
- changelog e versioni coerenti;
- WIT e schemi controllati;
- SBOM e audit;
- artifact per le piattaforme supportate;
- documentazione di avvio provata da una macchina pulita;
- matrice audit G14 e G15/GO sullo stesso candidato, prima del merge finale.

Versione, tag e distribuzione seguono le
[regole correnti](../development/versioning-and-releases.md), non una nuova
policy implicita introdotta dalla roadmap.

## Più avanti

Queste direzioni richiedono una proposta, un owner e un caso reale:

- formati ulteriori oltre al pilota delle superfici condivise;
- servizi di rete opt-in;
- sincronizzazione con garanzie esplicite;
- collaborazione;
- publishing;
- integrazioni AI;
- ecosistema di distribuzione dei plugin.

La prova di convergenza, disconnessioni e riavvio della sincronizzazione
esistente resta in [#9](https://github.com/Fubeo/Fub/issues/9): non è una
garanzia già consegnata.

Una direzione non autorizza a creare in anticipo tipi ABI, porte IPC o cartelle
di documentazione.

## Fuori ambito corrente

- database come sostituto obbligatorio dei file;
- marketplace senza formato di pacchetto e sicurezza completati;
- esecuzione di JavaScript di plugin nella webview;
- accesso WASI generale;
- superfici universali o contratti pubblici senza casi reali e misure;
- specifiche dettagliate di prodotti non approvati.

## Regola di passaggio

Un elemento entra nella documentazione di prodotto soltanto quando:

1. il comportamento è implementato;
2. il percorso principale è testato;
3. errori e limiti sono dichiarati;
4. il contratto stabile ha una fonte autorevole;
5. il lavoro residuo è tracciato in issue.
