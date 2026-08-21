# 1. La forma della shell — la precondizione di tutto il resto

Questa è una **seduta** (sessione di lavoro) della
[roadmap infrastrutturale](../todo.md). Definisce la posizione dei componenti
prima della crescita della superficie del progetto.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

La forma della shell (interfaccia utente principale) si posizionava per prima.
Tutte le altre fasi richiedono questa struttura. Tutte le altre fasi omettono
questa dichiarazione. La precedenza rigorosa del sesto giro è stata rispettata.
La regola stabilisce: **la forma della shell prima dei nodi (elementi) di
`UiNode`**. L'albero (struttura delle cartelle e dei file) era già definito.
L'albero era popolato all'arrivo della seduta 2. Le venticinque specie di nodo
nuove hanno trovato un file specifico di destinazione. Questo approccio
sostituisce un file `main.ts` da 1622 righe.

Le tre voci definiscono la posizione dei componenti:
- L'albero (voce 1.1).
- Il contenuto (voce 1.2).
- L'unico modulo autorizzato a comunicare con Tauri (framework desktop) (voce
  1.3).

Stato delle voci:
- La prima e la terza voce sono chiuse con la
  [decisione 0015](../decisions/0015-la-forma-della-shell.md).
- La mappa dell'albero si trova in
  [architecture/shell.md](../architecture/shell.md). Serve per consultare la
  struttura durante la scrittura di un file nuovo.

**Le decisioni sono completate.** Della seconda voce restano due punti di
esecuzione:
- La migrazione del cestino e della cronologia a `ViewProvider` (gestore delle
  viste).
- Lo sviluppo del modello di layout.

Questi elementi sono componenti della shell. Si trovano nel paragrafo
[§1.2 in coda alla seduta 18](18-editor-e-tastiera.md#12-smontare-il-monolite).
Verranno eseguiti in quella posizione. Verranno completati insieme alle altre
tre code delle sedute chiuse. Il numero mantiene il suo valore. Il numero si
trasferisce e conserva l'identificativo originale.

Il modello di layout sblocca il grafo (rappresentazione visiva dei collegamenti)
nell'area principale
([§3.3](18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell)).
È l'unico dei due punti che rappresenta una **feature** (funzionalità operativa,
in contrasto con un refactor strutturale) (FEATURES 3.3). La sua metà kernel
(logica di backend) richiede una decisione tramite `PaneId` (identificativo del
pannello).

Le sessioni multiple le precedevano e **sono attive**
([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)):
- L'host (processo principale) conserva una mappa dei vault (archivi dati)
  aperti.
- Ogni comando IPC (comunicazione tra processi) accetta un parametro `vault`
  opzionale.
- Il lavoro rimanente riguarda esclusivamente l'interfaccia utente.
