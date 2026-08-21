# 24. Tre firme che il freeze rende definitive

Una **seduta chiusa** (gruppo di lavori completati) della
[roadmap infrastrutturale](../todo.md). Un punto del contratto costa oggi un
campo. Dopo il freeze (congelamento) di M4 costa una migrazione di versione.
Tutte e **tre** le voci risultano chiuse. **Due** delle **tre** voci rimanevano
permanenti nel tempo:

*   §24.1 con la
    [0130](../decisions/0130-ogni-tipo-del-contratto-si-vede-dalla-radice.md):
    un `pub use` è additivo. I tipi invisibili dalla radice erano **sessantuno**
    invece di **sette**.
*   §24.2 con la
    [0131](../decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md): la
    `option-map` portava già tutti i **tre** stati. Il metodo Rust `enabled`
    serve per comodità. La firma risulta assente al confine WIT (WebAssembly
    Interface Type, interfaccia tra host e modulo plugin).
*   La §24.3 scadeva. La [0132](../decisions/0132-un-rifiuto-non-e-una-frase.md)
    ha dovuto **ritagliare la linea di base congelata**. Il tipo d'errore
    `format-error` appartiene alle funzioni esportate da un plugin di formato
    (modulo per formati di file). Ritiparne un caso produce sempre una rottura
    di compatibilità strutturale.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Un consuntivo (bilancio finale) ha trovato questa seduta.** I giri standard o
le verifiche sui verbali omettevano questo risultato. Il file `docs/issues.md`
conteneva osservazioni in sospeso da un audit del 2026-07-31:

*   **novantadue** righe totali.
*   **settantuno** righe rimandavano a voci assenti nei commit. Questo
    rappresenta il rimando cieco impedito dal file
    [`numerazione.md`](numerazione.md). La disciplina di quel file tralascia
    questo lato.

Rilettura contro i sorgenti attuali:
*   **sedici** righe risultavano già chiuse.
*   **una** riga risultava falsa dal primo giorno.
*   **cinque** righe descrivevano comportamenti corretti.
*   **settanta** righe rimanevano valide.

**Sessantasette** di quelle **settanta** rappresentano lavoro ordinario anziché
voci dedicate. Esse stanno nell'elenco dei
[difetti misurati](../todo.md#i-difetti-misurati). Tutte richiedono semplice
esecuzione. Tutte derivano da lavoro confermato. Esse necessitano di un
completamento pratico. Aprirle come voci forzerebbe `todo.md` a rispondere a
domande fuori dal suo perimetro.

**Tre** lo erano. Esse sono nate qui per un criterio solo: toccano una
**firma**. Questo piano usa il criterio per le P0 (priorità massima) dalla
**prima** riga. La forma scade col freeze. Oggi costa un campo. Dopo costa una
migrazione di versione. L'importanza intrinseca risulta modesta.

**Il giro di chiusura scopriva l'invalidità del criterio su due delle tre
voci.** La scoperta avveniva sul campo. La scadenza richiede la misura
dell'attraversamento del confine da parte della firma. Sulla §24.3 quella misura
ha dato **sì**. Essa risulta l'unica delle **tre**.

---

**Perché stanno insieme.** Le voci rappresentano la stessa domanda a **tre**
distanze dal confine: *ciò che il contratto dice, arriva a chi deve leggerlo?*

| Voce | Distanza | Problema |
|---|---|---|
| §24.1 | Ciò che il contratto **espone**. | L'esposizione rimaneva invisibile dal punto di vista comune. |
| §24.2 | Ciò che il contratto **sa**. | La firma limitava l'espressione della risposta. |
| §24.3 | Ciò che il contratto **rifiuta**. | Il rifiuto ometteva le motivazioni. |

Decisioni separate produrrebbero **tre** rattoppi in **tre** file. Decisioni
congiunte creano un criterio condiviso.

*Una risposta a **due** valori per una domanda che ne ha **tre** costituisce una
perdita di informazione.* La
[0094](../decisions/0094-un-tetto-che-si-fa-sentire.md) ha già applicato questo
criterio una volta su `random-bytes`. La
[0131](../decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md) lo ha
applicato una **seconda** volta. Il verso opposto vale assieme al primo. La
firma a **due** valori resta. **Sei** chiamanti su **sei** fanno la stessa cosa
nei **due** casi. La firma cambia per diventare una **proiezione** della
risposta intera.

---

## Com'è finita, e cosa lascia

**Due P0 su tre risultavano P0 per la ragione sbagliata.** Questo rappresenta il
consuntivo lasciato dalla seduta al piano. Il problema riguarda l'apertura delle
voci in generale, superando il caso specifico di **tre**. Le **tre** voci
derivano dal criterio dichiarato sull'impatto della firma. L'applicazione
avveniva per lettura. La lettura mostra l'esistenza di un simbolo e omette la
sua propagazione reale.

*   La §24.1 nominava una firma riparabile per aggiunta.
*   La §24.2 nominava una firma assente al confine.
*   La §24.3 nominava un caso di variant pubblicato (tipo enumerativo visibile
    all'esterno). Essa accende il presidio di sorveglianza della promessa
    (`wit_additivity`).

La regola risultante per la prossima P0 di firma: **«scade col freeze» è una
misura.** La misura è una sola. Il simbolo attraversa `crates/fub-abi/wit/`? La
riparazione tocca `wit/frozen/`? La sigla «P0» mostra l'allarme dello scrittore
fino al completamento della misura. Il calcolo dell'attesa richiede la misura
completata. Le **tre** volte d'esecuzione della misura hanno cambiato la
conclusione **due** volte su **tre**.

Il consuntivo possiede un valore aggiunto: **tutte e tre le voci sono valse il
giro per altre ragioni.** Ognuna delle **tre** ha rivelato la verità un
centimetro oltre il bersaglio iniziale:

*   **sessantuno** tipi invece di **sette**.
*   **due** funzioni leggevano la stessa mappa in **due** modi diversi.
*   Un banco di test della
    [0054](../decisions/0054-il-banco-del-lato-provider.md) citava una regola
    nel commento testandone la **metà** nel corpo.

Una voce errata sulla scadenza conserva la sua utilità sull'obiettivo da
indagare.