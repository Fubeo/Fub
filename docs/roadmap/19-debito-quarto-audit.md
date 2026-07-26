# 19. Debito riportato dal quarto audit

Una **seduta** della [roadmap infrastrutturale](../todo.md): le voci ancora aperte dei quattro giri di audit, col loro milestone.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Voci ancora aperte, con il loro milestone.

**Cosa è rimasto, e cosa vuol dire.** Nessuna di queste quattro ha più un
contenuto proprio: sono quattro **rimandi**, e il lavoro sta nella seduta che le
ha assorbite. Questa seduta esiste perché i quattro giri di audit sono citati
per nome altrove nel repo e vale la pena poter rispondere «dove è finito quel
punto?»; il giorno in cui le sedute che le assorbono si chiudono, questa si
chiude con loro e non lascia niente indietro.

- [ ] **Mutex unico sul `Workspace`** → assorbito dal §8.3 (misurare prima).
- [ ] **UI di produzione = IPC bespoke** → assorbito da [decisione 0009](../decisions/0009-registro-dei-comandi.md), §2.1, §1.2, §16.6;
      il caso concreto resta la UI del versioning.
- [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3): rivalutare alla
      superficie plugin di M5 — con i nodi `Tree`/`Custom` del §2.1 la scelta
      cambia natura.
- [ ] **"Tre copie" custodite da un flag TS**: merge esplicito a M3 (§18.1).

**Due voci sono state tolte da qui, e per due ragioni diverse.**

Il **ponte byte↔UTF-16** era segnato `[~]`, «l'inversa resta». Non resta:
`charToByteIndex` sta in `frontend/src/rules/offsets.ts:50`, la usa l'editor
(`editor.ts:120-121`) ed è testata su accenti ed emoji in andata e ritorno. È la
[decisione 0007](../decisions/0007-contesto-di-sessione.md), che ne aveva bisogno
per far attraversare il confine alla selezione, ed è già spuntata nel
[§18.1](18-editor-e-tastiera.md#181-editor). Questa riga dichiarava aperto ciò
che l'indice, due schermate più in là, dichiara chiuso: la contraddizione era
**dentro il documento**, non fra il documento e il codice.

L'**orfana `.fubmd-data/index/`** era marcata «cosmetico», e non era una voce di
questa roadmap: il criterio in testa a [todo.md](../todo.md) è *quali pezzi di
infrastruttura mancano perché FEATURES.md si possa costruire*, e una cartella da
cancellare a mano su un vault di sviluppo non regge nessuna voce di FEATURES. Se
un giorno la migrazione dei dati derivati conterà davvero, la risposta è già
scritta due volte: il [§15.3](15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito)
(versione di schema → *butto e ricostruisco*) e il
[§15.4](15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
(la mappa di chi scrive dove, e con quale classe).

Le due tolte hanno una morale in comune, ed è quella del
[§16.7](16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione):
**un elenco tenuto a mano smette di essere vero senza diventare rosso.** Vale
per i presidi del repo, e vale per questo file.
