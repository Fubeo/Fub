# 7. Il confine: quante volte si scrive la disciplina

Questo documento rappresenta una **seduta** della [roadmap infrastrutturale](../todo.md). Analizza la disciplina del confine. Chi attraversa il confine e chi lo presta condividono la medesima vista. La [decisione 0021](../decisions/0021-il-confine.md) fornisce la risposta. In fondo rimane una sola casella.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La [decisione 0021](../decisions/0021-il-confine.md) chiude sei voci su sei contemporaneamente. Questo capitolo richiedeva questa condizione. Il §7.1 e il §7.2 affrontano la stessa domanda da due lati. Il primo lato è l'attraversamento del confine. Il secondo lato è il prestito del confine. Il §7.3 moltiplica le casistiche.

La seduta evidenzia quattro aspetti pratici emersi durante lo sviluppo:

*   **Le due strade del §7.1 sono complementari.** La seduta proponeva una scelta esclusiva. Le opzioni prevedevano `Guard<H, P>` nel kernel (nucleo del sistema) o la scomposizione in sotto-trait (interfacce). Nella pratica risultano due metà necessarie:
    *   Il wrapper (tipo contenitore) elimina la impl (implementazione) gemella per i divieti.
    *   La scomposizione rimuove le condizioni impossibili. Elimina i dodici `unreachable!()` nel percorso di lettura. Tali condizioni indicavano vincoli reali ignorati dal sistema dei tipi.
    L'adozione di una sola soluzione obbliga a scrivere l'altra metà a mano.
*   **La scomposizione WIT offre un vantaggio assente in Rust.** Al confine WIT (WebAssembly Interface Type), un `world` (ambiente di esecuzione) privo di `host-vault-write` impedisce strutturalmente la scrittura. La funzione risulta assente a runtime. Questo argomento giustifica l'applicazione della scomposizione in quel contesto. L'implementazione avviene prima del freeze (blocco delle modifiche). Il blocco impedisce futuri spostamenti di funzioni tra le interfacce.
*   **Le copie della disciplina di consegna sono quattro.** Precedentemente risultavano tre. La quarta risiede in `import`. Riporta il commento «stessa disciplina di `view_action`». Questo commento dichiara apertamente la duplicazione.
*   **Cinque capacità del contratto richiedono un meccanismo di rifiuto.** Le funzioni `emit`, `free_name`, `format_of`, `now_unix_millis` e `active_context` omettono un `Result` (tipo Rust per gli errori). Una politica restrittiva restituisce semplicemente una risposta nulla. Questa scoperta arricchisce la [decisione 0013](../decisions/0013-elenco-delle-capacita.md). Ogni nuova capacità deve fornire un esito. Questa regola si applica alle operazioni infallibili. Garantisce la possibilità di negarle strutturalmente.

Il §7.4 rappresenta la voce **più datata** del piano. Riguarda le componenti già pubblicate. Il costo dell'intervento risulta nullo. L'assenza di id (identificatori) di terze parti azzera l'impatto. Solo in questo momento il costo rimane pari a zero.

## La casella rimasta

*Questo task appartiene allo strato kernel. Rappresenta lavoro operativo. Il criterio esiste già. Il bloccante risulta risolto.*

- [ ] **Le allowlist dei permessi filtrano in un solo caso.** 
    *   Le capacità `read_vault` e `write_vault` ricevono un **parametro**. Il parametro comprende un elenco di prefissi di path (percorsi). La [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) definisce questa struttura.
    *   La politica attuale valuta esclusivamente la presenza della chiave. Un plugin (estensione) con `read-vault` limitato a `Progetti/` accede all'intero vault (archivio documenti).
    *   La [0021](../decisions/0021-il-confine.md) relega questo problema nella sezione «cosa resta fuori». Segnala il bloccante §15.5 («la politica dei path in un modulo solo»).
    *   La [0058](../decisions/0058-un-nome-che-nasce.md) rimuove il bloccante. Il modulo `fub_abi::rules::path` fornisce l'unica definizione di prefisso. Il sistema mantiene natura additiva dentro `Granted`. 

    **Applicazioni aggiuntive:**
    *   **Contesto vista:** La [0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) estende l'applicazione a `fub:read-session` e `fub:read-selection`. Possiedono un path da confrontare: `ViewContext.doc`.
    *   **Risposte aggregate:** Il tipo `Query` ignora il filtro per costruzione. Una risposta aggregata omette il path. 
    *   **Bozze:** La [0096](../decisions/0096-una-bozza-non-e-una-nota.md) aggiunge `fub:read-drafts`. Gli elementi possiedono un path (`DraftInfo.doc`). Il filtro agisce voce per voce. Scarta le bozze omesse dall'allowlist (lista delle eccezioni consentite).

    **Criterio di distinzione:** **si filtra ciò che nomina un documento, si esclude dal filtro ciò che aggrega documenti.**

    **Evoluzione della casella:**
    Il perimetro della casella risulta ridotto. La [0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) introduce `fub:network`. Rappresenta il **primo parametro di permesso letto nel repo (repository)**. Un plugin che dichiara `["api.acme.com"]` raggiunge esclusivamente quell'host. La dichiarazione iniziale della casella perde validità generale. L'intervento riguarda i **prefissi di path** di `read-vault`/`write-vault` e le tre eccezioni sopraelencate. L'implementazione anticipata della rete segue una priorità legittima. Là il divario possedeva natura differente. La distinzione riguarda chi legge la promessa:
    1.  **Recinto bucato:** Un `read-vault` ristretto che accede all'intero vault costituisce una vulnerabilità tecnica.
    2.  **Falsa promessa:** Un manifest (file di configurazione) dichiara un host. L'utente lo accetta. L'app (applicazione) raggiunge un host differente. Questa azione costituisce una menzogna esplicita dell'app.

    **Separazione dei filtri:**
    I due filtri richiedono implementazioni indipendenti. La soluzione futura deve rispettare questo vincolo. La funzione `Policy::denies_host` valuta strettamente l'host. Rifiuta un bersaglio generico. La logica di valutazione differisce:
    *   **Path:** Il sistema valuta il prefisso dentro una radice dell'utente.
    *   **Host:** Il sistema valuta il nome in uno spazio pubblico. Permettere ad `acme.com` di coprire `evil-acme.com` compromette domini terzi.
    Una funzione condivisa unificherebbe due semantiche distinte. La decisione 0021 segnalava questo esatto rischio nel bloccante. Lo sviluppatore incaricato scriverà una **seconda** funzione. L'estensione della prima funzione è proibita.

    **Tracciamento:**
    La casella è rimasta bloccata per trentadue verbali dopo la risoluzione del suo indirizzo. Questo motivo la rende **contata** in [todo.md](../todo.md). Mantiene visibilità oltre il singolo verbale. I conteggi visibili attraggono l'attenzione. La [§16.7](16-crate-sdk-banchi-di-prova.md) applica la stessa diagnosi agli elenchi. La visibilità garantisce l'esecuzione.
