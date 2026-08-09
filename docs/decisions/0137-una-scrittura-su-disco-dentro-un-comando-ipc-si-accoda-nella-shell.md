# 0137 — Una scrittura su disco dentro un comando IPC si accoda nella shell

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: la [§25.6](../roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#256-chi-paga-la-latenza-di-una-scrittura-fatta-dentro-un-comando-ipc)
— *«Chi paga la latenza di una scrittura fatta dentro un comando IPC»* — nella
forma **(a)** che la voce stessa raccomanda: *«(a); non (b); non (c) adesso»*.
Con lei i difetti misurati **0038** (vero, e riparato qui) e **0073** (falso, e
il verbale dice perché sembrava vero).
**Commit**: *(questo commit)*

---

**La regola che questo verbale fissa.** Una scrittura su disco dentro un comando
IPC **si accoda nella shell** — coalescendo per chiave, così due scritture della
stessa chiave accavallate diventano una scrittura sola con l'ultimo valore — e
**non** si rende `async` nel thread dell'IPC. Non è una scelta libera: la
[0133](0133-chi-ascolta-nomina-fino-a-quando.md) e `frontend/src/ui/corsa.ts`
hanno già deciso che quando il lavoro *deve arrivare* — «una scrittura su
disco, una mutazione del layout» — la risposta è **accodare**, e questa voce
applica quella decisione alla porta che tutte le scritture di stato
attraversano. Coalescere non è scartare: il lavoro che parte c'è e arriva, e
chi ha accodato sa quando è finito.

**Il numero.** **37** comandi registrati nel `generate_handler!` di
`crates/fub-app/src/lib.rs`, **0** `async`. Chi rifà il conto non usi un `grep`
grezzo di `#[tauri::command]`: dà **39**, ma due sono citazioni nei doc-comment
`//!` (righe 9 e 13 di `lib.rs`) — è la stessa trappola già misurata dalla
[decisione 0057](0057-la-dieta-dell-ipc.md). Il 38° comando che vorrà scrivere
su disco dentro l'IPC troverà scritto qui cosa può fare: accoda nella shell, e
la coda la eredita senza scegliere.

**La soglia.** La misura della voce, su filesystem vero: **2,561 ms** su un
file di **2,4 KB** con un vault, **5,036 ms** su **137 KB** con 20 vault e 80
cartelle. Dominato dall'`fsync`, non dalla fusione: il file cresce di 57× e il
tempo di 2×. Si **accetta il lucchetto di macchina** finché il file resta sotto
quella taglia — 5 ms su una chiamata che nessuno aspetta e che l'utente non
vede — e **quel giorno si riapre la (c)**: formato su disco + migrazione +
`SchemaVersion`, che è l'unica delle tre forme irreversibile.

**Cosa si scarta, e perché.** La **(b)** — `spawn_blocking`, o comandi `async` —
per la [0057](0057-la-dieta-dell-ipc.md): la superficie dei comandi è un elenco
chiuso e omogeneo tenuto tale per decisione, e una seconda convenzione di
chiamata la rompe. La prova che decide, *il secondo chiamante la eredita
gratis?*, dà **no**: il 38° comando non eredita niente, deve scegliere. La **(c)**
— un file per vault — risolve la cosa giusta al prezzo sbagliato finché la
misura è quella di sopra: costa all'utente, una volta, alla migrazione, e la
proprietà che `muta` dichiara nella propria prosa resterebbe vera solo per
vault.

**Le premesse cadute, col perché sembravano vere.**

1. **«Il valore vero della (a) è su `togliDappertutto`» è superato.** Misurato:
   `togliDappertutto` fa **1** `set_view_state`, non 5 — il valore era già stato
   incassato (il commit `62f1529`, che ha ridotto a una la scrittura di una
   cancellazione in cinque riquadri). La (a) resta giusta **per la regola** —
   la 0133 e `corsa.ts` — non per quel guadagno. Sembrava vera perché la voce
   è stata scritta prima che quella riparazione chiudesse.
2. **`0073` è falsa due volte.** «A ogni scroll» è falso: la shell non persiste
   nessuno scroll — `grep -rn "scrollTop" frontend/src` non trova niente. «Prende
   il lock esclusivo» è falso: `set_view_state` prende `ws.read()`, a
   `crates/fub-app/src/lib.rs:680`, con tre righe di commento sopra che dicono
   perché. E l'ancora `lib.rs:645` della riga è scaduta. Si chiude lo stesso:
   sembrava vera perché «scrive `view-state.json` in modo sincrono sul thread
   IPC» è letteralmente vero, e l'occhio ferma la prima metà della frase senza
   controllare le due amplificazioni.
3. **`0038` regge**, coi numeri di sopra: comandi sincroni, lock + I/O sul
   thread pool dell'IPC, e il lucchetto di macchina che la voce misura.
4. **La voce diceva «8 siti di chiamata» di `cambiato()`: sono 9** — `dividi`,
   `chiudiPane`, `fuocoSu`, `apriTabIn`, `chiudiTab`, `attivaTab`, `rinomina`,
   `togliDappertutto`, `impostaModalita` (righe 223, 237, 247, 277, 295, 321,
   337, 358, 366 di `frontend/src/state/layout.ts`). E le ancore
   `layout.ts:413,426,428` della voce sono scadute. Sembravano otto perché il
   censimento era stato fatto leggendo la prosa, e la prosa nominava i gesti
   «discreti» senza contare la riga di `apriTabIn`.
5. **«`scriviStato` ha due chiamanti» è falso: sono cinque, in tre moduli, con
   quattro chiavi** — `store.ts:175` (`expanded`), `store.ts:184`
   (`activeSpace`), `layout.ts:449` (`layout`), `recenti.ts:187` e `:198`
   (`history`). Sembrava vero perché i due di `store.ts` sono gli unici
   «nudi»: gli altri passano da `cambiato()` e da `metti_via()`. **È il fatto
   che ha deciso il posto della forma**: la coda sta in `frontend/src/ui/
   corsa.ts`, accanto a `Coda` — il posto che tutti i chiamanti attraversano —
   e non dentro `store.ts`, dove la risposta andrebbe ripetuta al prossimo
   sito.
6. **La voce citava come proprio «caso peggiore» un difetto ritrattato.** Il
   corpo della §25.6 nominava `set_setting_for_user` e `reset_setting_for_user`
   col prestito esclusivo come «il caso peggiore» e come difetto aperto, e la
   ritrattazione (`53972d4`) l'aveva già tolto come falso poche ore prima: quel
   prestito non è lì per la scrittura su disco, ma perché scrivere
   un'impostazione rifà i recinti, pota il registro ed emette. Sembrava vera
   perché era scritta nel corpo della voce, e questo verbale l'ha creduta e
   propagata in un documento nuovo. Il guasto a monte è il secondo strato, e
   vale più del primo: **la ritrattazione aveva ripulito la tabella senza
   toccare la voce che la citava** — una ritrattazione che non si propaga
   lascia in piedi la sua stessa smentita, ed è il motivo per cui l'errore è
   arrivato fino a qui. La lezione per chi scriverà il presidio dei numeri
   penzolanti: un difetto ritirato citato dentro un verbale si fa passare per
   chiuso, e un conto costruito sulla citazione nascerebbe cieco sul caso che
   deve prendere.

**Cosa resta scoperto.** Il «caso peggiore» che la voce nominava non lascia un
difetto aperto: la ritrattazione (`53972d4`) l'aveva già tolto come falso prima
che questa voce si chiudesse — il prestito esclusivo di `set_setting_for_user`
(`crates/fub-host/src/session.rs:1082` e `:1100`) non è lì per la scrittura su
disco, ma perché scrivere un'impostazione rifà i recinti, pota il registro ed
emette, e i quattro fratelli che prendono il condiviso non fanno niente di tutto
questo. Resta il fatto, non il difetto: chi legge quella porta vede un prestito
esclusivo che attraversa una scrittura su disco, e deve sapere che è stato
guardato e ritrattato, non dimenticato.
