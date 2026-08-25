# Shell e frontend

La shell è il client desktop di Fub. Disegna l'interfaccia e traduce le azioni dell'utente in comandi del backend; non possiede le regole del vault.

## Confine con Tauri

Gli import di `@tauri-apps/*` sono concentrati negli adattatori sotto `frontend/src/host/`. Il resto del frontend usa funzioni del progetto e può essere testato con un host finto.

`fub-app` espone comandi ed eventi IPC, ma il composition root vive in `fub-host`. Questo impedisce alla logica di apertura, indicizzazione e montaggio dei provider di dipendere dalla webview.

## Stato della shell

La shell mantiene:

- pannelli e layout;
- documenti aperti e viste associate;
- selezione, cursore e scorrimento locali alla vista;
- stato di salvataggio e conflitti;
- lavori lunghi e notifiche;
- tema e preferenze dell'interfaccia.

Il contenuto di un documento deve avere una sola fonte autorevole nel frontend. Due pannelli sullo stesso documento non devono creare due copie indipendenti del testo.

## Eventi e vita dei componenti

Ascoltatori globali, richieste concorrenti e sottoscrizioni devono avere un proprietario capace di annullarli quando la vista viene distrutta o sostituita. I controlli in `.github/scripts/` impediscono l'aggiunta di listener globali o attese concorrenti fuori dalle astrazioni previste.

## Documentazione specifica

Le pagine operative del frontend sono in [`frontend/`](../frontend/README.md). Il piano sulle superfici di editing condivise è esplicitamente marcato come piano, non come comportamento già completato.