# 19. Debito riportato dal quarto audit

Questa è una **seduta** della [roadmap infrastrutturale](../todo.md). L'elenco mostra le voci aperte dei quattro giri di audit con il loro milestone.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Stato attuale**

Questo documento traccia la destinazione dei punti sollevati durante i quattro giri di audit. Il file risponde alla domanda sulla ricollocazione di ogni segnalazione.

Delle quattro voci originali:
*   **Due** voci sono **chiuse**.
*   **Due** voci restano aperte.

Le quattro voci fungono esclusivamente da **rimandi**. Il lavoro effettivo si svolge nelle sedute di destinazione. La chiusura delle sedute assorbenti determinerà la chiusura definitiva di questa seduta.

La seduta presenta queste caratteristiche:
*   Manca dall'[indice](../todo.md) principale.
*   La colonna *Voci* risulta vuota.
*   Le due caselle aperte rientrano tra le voci **residue**. La categoria delle voci **residue** dà un posto ai numeri altrimenti omessi dai conteggi. Prima della sua creazione, due caselle aperte restavano invisibili nei totali.

**Voci aperte e chiuse**

*   [x] ~~**Mutex unico sul `Workspace`**~~ → Assorbito dal §8.3 e **chiuso** con la [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md).
    *   **Contesto:** La [0022](../decisions/0022-il-kernel-a-pezzi.md) ha frazionato la proprietà in cinque referenti (sostituendo i ventiquattro campi iniziali). Il blocco necessitava di una modifica proporzionata.
    *   **Soluzione:** La decisione 0024 ha misurato le prestazioni. Ha sostituito il blocco con un `RwLock` (blocco a lettura condivisa e scrittura esclusiva).
    *   **Risultato principale:** Il salvataggio di una nota ottiene subito la priorità. In passato un salvataggio bloccato dal `Mutex` (blocco di esclusione reciproca) sul `Workspace` (spazio di lavoro centrale) ha atteso fino a 6,4 secondi.
    *   **Risultato secondario:** Le view (viste dell'interfaccia) ridisegnate simultaneamente incrementano le prestazioni (da 7 a 25 volte).
*   [ ] **UI di produzione = IPC bespoke** → Assorbito da [decisione 0009](../decisions/0009-registro-dei-comandi.md), [decisione 0016](../decisions/0016-cosa-e-una-view.md), §1.2 e §16.6.
    *   **Dettaglio:** La UI (interfaccia utente) del versioning impiega attualmente logiche IPC (comunicazione inter-processo) bespoke (su misura).
*   [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3)
    *   **Dettaglio:** La superficie per i plugin (moduli di estensione) introdotta con il milestone M5 richiede una rivalutazione di questa impostazione.
    *   **Contesto:** La [decisione 0016](../decisions/0016-cosa-e-una-view.md) introduce i nodi `Tree`/`Custom`. Questa introduzione modifica le premesse iniziali della scelta.
*   [x] ~~**"Tre copie" custodite da un flag TS**: merge esplicito a M3 (§18.1).~~ → **Chiuso** con la [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md).
    *   **Stato:** Il problema vanta una risoluzione inaspettata. Le tre copie mantengono la loro indipendenza.
    *   **Flag TypeScript:** Il flag TS denominato `dirty` mantiene il proprio ruolo. Segnala in modo esclusivo la presenza di dati in sospeso.
    *   **Nuova validazione:** Il controllo della correttezza spetta esclusivamente al kernel (motore centrale). Il kernel confronta i dati con il disco ed emette il messaggio `Conflict`. Il kernel blocca sistematicamente i tentativi della shell (interfaccia di base) di ingannare il sistema.
    *   **Motivazione:** Sollevare una delle tre copie dall'obbligo di verità assoluta assicura i vantaggi di un merge (fusione) esplicito. Questa scelta produce un notevole risparmio di tempo.

**Due voci rimosse**

Abbiamo eliminato le restanti voci per due ragioni distinte:

1.  **Ponte byte↔UTF-16** (segnato come `[~]`, «l'inversa resta»)
    *   **Stato reale:** La funzione risulta attiva e completa. `charToByteIndex` risiede nel file `frontend/src/rules/offsets.ts`. L'editor testuale (`editor/editor.ts`) sfrutta correntemente questo strumento. I test automatici coprono accenti ed emoji in andata e ritorno.
    *   **Contesto originario:** La [decisione 0007](../decisions/0007-contesto-di-sessione.md) richiede questa logica per spingere la selezione testuale oltre i limiti dell'editor. L'implementazione appare già spuntata nel [§18.1](18-editor-e-tastiera.md#181-editor).
    *   **Motivo della rimozione:** L'indice (posto due schermate più avanti) segnalava questo task come chiuso. L'incoerenza risiedeva esclusivamente all'interno del presente documento.
2.  **Orfana `index/` sotto la radice dei derivati** (marcata «cosmetico»)
    *   **Fuori contesto:** Questo elemento risiedeva fuori dal perimetro della roadmap. Il file [todo.md](../todo.md) traccia esclusivamente i blocchi infrastrutturali essenziali a completare le voci di FEATURES.md. La cancellazione manuale di una cartella all'interno di un vault (archivio di progetto) di sviluppo risulta ininfluente per gli obiettivi di FEATURES.
    *   **Soluzione standard:** La risposta sui dati derivati si trova già scritta due volte:
        *   [§15.3](15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito): L'aggiornamento della versione di schema forza la distruzione e la successiva ricostruzione dei dati derivati.
        *   [§15.4](15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe): Le scritture su disco seguono una rigorosa mappa formale. Con l'adozione della decisione [0048](../decisions/0048-una-radice-sola.md), questa mappa corrisponde al documento [on-disk-layout.md](../architecture/on-disk-layout.md).

**Morale**

Le due voci eliminate condividono un insegnamento fondamentale stabilito dalla [decisione 0056](../decisions/0056-un-elenco-che-e-la-sorgente.md):
**Un elenco compilato a mano diventa obsoleto in modo invisibile, conservando un'apparenza di correttezza.** Questa regola vale per i controlli del repo (repository del codice sorgente) ed è parimenti valida per il presente file.
