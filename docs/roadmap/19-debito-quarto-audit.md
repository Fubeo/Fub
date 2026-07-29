# 19. Debito riportato dal quarto audit

Una **seduta** della [roadmap infrastrutturale](../todo.md): le voci ancora aperte dei quattro giri di audit, col loro milestone.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Voci ancora aperte, con il loro milestone.

**Cosa è rimasto, e cosa vuol dire.** Delle quattro, una è **chiusa** e **tre**
restano aperte; nessuna ha più un contenuto proprio, perché sono quattro
**rimandi** e il lavoro sta nella seduta che le ha assorbite. Per questo la
seduta non ha nessuna voce nell'[indice](../todo.md) e la sua colonna *Voci* è
vuota: le tre caselle si contano lì fra le **residue**, che è il posto che prima
non c'era — e finché non c'era, tre caselle non spuntate non entravano in nessun
totale da nessuna parte. Questa seduta esiste perché i quattro giri di audit sono citati
per nome altrove nel repo e vale la pena poter rispondere «dove è finito quel
punto?»; il giorno in cui le sedute che le assorbono si chiudono, questa si
chiude con loro e non lascia niente indietro.

- [x] ~~**Mutex unico sul `Workspace`**~~ → assorbito dal §8.3, e **chiuso**
      con la [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md).
      La [0022](../decisions/0022-il-kernel-a-pezzi.md) aveva tolto il motivo per
      cui il lock non *poteva* essere a grana fine — cinque proprietari invece di
      ventiquattro campi — e aveva lasciato il lock dov'era; la 0024 lo ha
      sostituito con un `RwLock`, misurando prima come la voce chiedeva. Il
      guadagno vero non era quello previsto: non le view che si ridisegnano
      insieme (pure, da 7 a 25 volte), ma il fatto che chi salva una nota **non
      viene più affamato** dai lettori — sotto il `Mutex` un salvataggio ha
      aspettato 6,4 secondi.
- [ ] **UI di produzione = IPC bespoke** → assorbito da [decisione 0009](../decisions/0009-registro-dei-comandi.md), [decisione 0016](../decisions/0016-cosa-e-una-view.md), §1.2 e §16.6;
      il caso concreto resta la UI del versioning.
- [ ] **Organizzazione sidebar chiusa ai plugin** (scelta O3): rivalutare alla
      superficie plugin di M5 — con i nodi `Tree`/`Custom`, che dalla
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) esistono, la scelta
      cambia natura.
- [ ] **"Tre copie" custodite da un flag TS**: merge esplicito a M3 (§18.1).

**Due voci sono state tolte da qui, e per due ragioni diverse.**

Il **ponte byte↔UTF-16** era segnato `[~]`, «l'inversa resta». Non resta:
`charToByteIndex` sta in `frontend/src/rules/offsets.ts`, la usa l'editor
(`editor/editor.ts`) ed è testata su accenti ed emoji in andata e ritorno. È la
[decisione 0007](../decisions/0007-contesto-di-sessione.md), che ne aveva bisogno
per far attraversare il confine alla selezione, ed è già spuntata nel
[§18.1](18-editor-e-tastiera.md#181-editor). Questa riga dichiarava aperto ciò
che l'indice, due schermate più in là, dichiara chiuso: la contraddizione era
**dentro il documento**, non fra il documento e il codice.

L'**orfana `index/` sotto la radice dei derivati** era marcata «cosmetico», e non era una voce di
questa roadmap: il criterio in testa a [todo.md](../todo.md) è *quali pezzi di
infrastruttura mancano perché FEATURES.md si possa costruire*, e una cartella da
cancellare a mano su un vault di sviluppo non regge nessuna voce di FEATURES. Se
un giorno la migrazione dei dati derivati conterà davvero, la risposta è già
scritta due volte: il [§15.3](15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito)
(versione di schema → *butto e ricostruisco*) e il
[§15.4](15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
(la mappa di chi scrive dove, e con quale classe — che dalla
[0048](../decisions/0048-una-radice-sola.md) è un documento vero,
[on-disk-layout.md](../architecture/on-disk-layout.md)).

Le due tolte hanno una morale in comune, ed è quella del
[decisione 0056](../decisions/0056-un-elenco-che-e-la-sorgente.md):
**un elenco tenuto a mano smette di essere vero senza diventare rosso.** Vale
per i presidi del repo, e vale per questo file.
