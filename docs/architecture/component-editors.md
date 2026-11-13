# Editor dei componenti

> **Domanda:** come la shell carica soltanto gli editor dei componenti accesi,
> e che cosa mostra per il file di un componente spento?
> **Fonti autorevoli:** `apps/client/src/editors/core/bootstrap.ts`,
> `apps/client/src/state/components.ts`, `crates/fub-host/src/componenti.rs`.
> **Decisioni:** [ADR 0234](../decisions/0234-il-modello-dei-componenti.md).

## I pezzi di interfaccia

Ogni riga di `components_map` porta i pezzi di interfaccia (`ui`) che il suo
componente accende. `COMPONENT_EDITORS` in
`apps/client/src/editors/core/bootstrap.ts` è la tabella sola che lega ogni
`ui` al codice del suo editor e alla sua registrazione; `editors/text` è del
nucleo e non c'è. `apps/client/src/editors/core/component-surfaces.ts` tiene le
costanti dei pezzi e `uisForFile`, l'estensione di un file con i pezzi che
servono per aprirlo dentro Fub.

Lo stato dei componenti del vault aperto sta in
`apps/client/src/state/components.ts`: la mappa dell'host, letta all'apertura
e riletta quando cambiano le chiavi `components.*`, i plugin spenti o la lingua.
La shell non ricalcola chi richiede chi: legge l'esito. `setComponentEditors`
registra i pezzi accesi e toglie gli altri. La registrazione di un componente
ha una `LazySurfaceFactory`: il registro conosce famiglia, profili e formati
dalla registrazione, e chiede il codice con `import()` solo quando un documento
lo apre (`load`, `isLoaded`). Il plugin di `apps/client/vite.config.ts` scrive
i chunk che ogni pagina carica all'avvio e ferma la build se fra questi c'è il
codice di un pezzo spegnibile (pdf.js, lavagna, disegni, documenti, fogli).

Un file il cui pezzo è spento si apre «solo come file»: la famiglia
`file-only` di `apps/client/src/state/document-controller.ts` non viene dal
registro e mostra nome, dimensione, «Accendi …» e «Apri con un'altra app».
Quando un componente si spegne con un suo file aperto, il riquadro prima salva
ciò che la sessione ha in sospeso, poi passa a «solo come file». Se il
salvataggio non riesce, l'editor resta registrato con l'errore della sessione
finché le modifiche non sono al sicuro. Quando il componente torna, il riquadro
si rimonta nel suo editor.

## Dove si trova

- `apps/client/src/editors/core/bootstrap.ts`
- `apps/client/src/editors/core/component-surfaces.ts`
- `apps/client/src/state/components.ts`
- `apps/client/src/state/document-controller.ts`
- `apps/client/src/panels/components-page.ts`
- `apps/client/vite.config.ts`
