# 0151 — Il terzo registro si guarda anche senza farlo salire

**Stato**: accolta **Data**: 2026-08-12 **Chiude**: §26.2 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.2](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#262-cinque-registri-di-tastiera-e-il-presidio-ne-guarda-due)
chiedeva se un accordo montato **dentro l'editor** sia un accordo: se debba
stare in un registro che l'utente vede e che il presidio dei conflitti legge,
oppure se sia un dettaglio del componente che lo ospita.

La voce raccomandava la forma **(b) — solo il presidio — subito e da sola**,
perché è l'unica delle tre che si paga una volta e il suo valore è
proporzionale a quanti accordi nascono dopo di lei. È la forma che questo
verbale accoglie; la (a) resta dov'era, appesa alla
[§26.1](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha),
e per una ragione più forte dell'attesa.

## La premessa, rimisurata

Rimisurata a `50fb881`, dai dati e non dai file: le keymap sono state importate
in un banco e contate.

- **I numeri della voce reggono tutti e tre.** `basicSetup` dichiara **87**
  binding, `indentWithTab` è l'ottantottesimo, e su Linux (`b.linux ?? b.key`)
  restano **57** accordi distinti. `obsidianKeymap` ne porta **14**. Il totale
  che nessun registro conosce è **102**, che è il numero scritto nella voce.
- **Le collisioni sono tre, e sono quelle previste.** Confrontando le forme
  canoniche dei 102 con i 14 accordi dei due registri dichiarati:
  `mod-f` (`shell.doc.search` e `openSearchPanel`), `mod-shift-\`
  (`shell.pane.split.down` e `cursorMatchingBracket`), `mod-shift-l`
  (`shell.mode.live` e `selectSelectionMatches`). Non ce n'è una quarta.
- **`obsidianKeymap` non litiga con nessuno dei due registri dichiarati.** Le
  tre collisioni vengono tutte dal registro **4**, quello che questa app non
  scrive. Il registro 3 si sovrappone a `basicSetup` — `Mod-d`, `Mod-i`,
  `Mod-Enter`, `Alt-ArrowUp`, `Alt-ArrowDown`, più `Enter` e `Tab` nudi — ma lì
  la precedenza è dichiarata da CodeMirror stesso ed è l'ordine di montaggio.
- **La terza collisione non si trova cercandola alla lettera.** In
  `@codemirror/commands` è scritta `Shift-Mod-\` e non `Mod-Shift-\`: un `grep`
  dentro `node_modules` fa concludere che non esista. È la misura che ha
  deciso la forma del banco — confronta **forme canoniche**, non stringhe.
- **La collisione su `Mod-f` è viva davvero, e si vede.** Nessun binding di
  CodeMirror dichiara `stopPropagation`, quindi il tasto risale a `document`,
  dove `mountKeyboard` lo passa ad `avanza` senza guardare `e.target`: `Ctrl+F`
  dentro una nota apre il pannello di ricerca dell'editor **e** l'overlay della
  shell.

## La decisione

**(b), accolta** — con due scarti dalla lettera della forma, tutti e due
misurati.

**Primo: nessun file generato.** La voce scriveva «un mirror che emette
`obsidianKeymap` e `basicSetup` in una fixture», sul modello di
`shell_keys_mirror.rs` ([0056](0056-un-elenco-che-e-la-sorgente.md)). Ma la
ragione del mirror del registro 1 è che la sorgente sta in Rust e il banco in
TypeScript: c'è un confine da attraversare, e un file generato è il modo di
attraversarlo. Qui non c'è nessun confine — le keymap sono moduli TypeScript
che il banco importa nello stesso processo. Un file generato in mezzo
aggiungerebbe una cosa da rigenerare che può restare indietro, in cambio di
niente: è la seconda prova della barra letta al contrario, perché il secondo
chiamante di quel file non esiste. Il banco importa le sette keymap di
`basicSetup`, `indentWithTab` e `obsidianKeymap`, e le confronta.

**Secondo: un lucchetto, non uno zero.** Far entrare i 102 in `tutti()`
renderebbe rosso il presidio dei conflitti il giorno stesso — la voce lo dice —
e verde non tornerebbe finché **qualcuno non decide chi tiene `Ctrl+F`**, che è
la §26.1. Un presidio permanentemente rosso non è un presidio: è rumore che
insegna a ignorare il colore. Quindi si fa come col contrasto
(`frontend/src/theme/contrast.test.ts`): ciò che è fuori regola sta scritto
**per nome**, in `SCONTRI_NOTI`, con accanto chi litiga con chi, ed è rosso nei
**due** versi — una quarta collisione è rossa perché non è in elenco, una delle
tre che sparisce è rossa perché in elenco c'è rimasta. La porta da cui entra la
quarta collisione è chiusa, che è esattamente ciò che la forma (b) prometteva,
e le tre note restano note invece di diventare invisibili.

`obsidianKeymap` è **esportato** per questo, con la ragione scritta accanto e
sempre quella della 0056: un elenco che nessuno può leggere non si può
confrontare con gli altri.

Accanto al confronto sta la seconda metà della domanda della
[0090](0090-una-sequenza-e-una-modalita-che-scade.md), posta al terzo insieme:
nessun accordo dell'editor copre il **primo** accordo di una sequenza
dichiarata. Oggi nessun registro dichiara una sequenza e quella riga passa a
vuoto — ma non è vuota per costruzione: aggiungendo `"prova.sequenza": "Mod-k d"`
alla fixture del kernel diventa rossa, perché `toggleWikilink` tiene già
`Mod-k` e dentro la nota quella sequenza non partirebbe mai.

**Il solo punto in cui questo banco crede invece di misurare** è dichiarato
dov'è: `editor.ts` importa `basicSetup` dal pacchetto `codemirror`, che è
un'estensione opaca, e da un'estensione non si estrae un elenco di tasti.
`KEYMAP_EDITOR` lo **ricostruisce** dalle sette keymap che lo compongono. Se
quel pacchetto cambiasse composizione, l'elenco resterebbe indietro senza
dirlo, e sta scritto nel commento perché chi legge il verde sappia di che verde
si tratta.

## Le forme scartate

- **(a) Il registro 3 sale nel registro 1** — non è rimandata perché costa: è
  rimandata perché **ribalta** la [0009](0009-registro-dei-comandi.md), che ha
  già deciso il contrario con la sua ragione scritta (`0009:66-67`), *«ignora
  quelli senza modificatori perché ruberebbero una lettera a chi scrive»*.
  Quella ragione è **vera finché un accordo non ha un contesto**, ed è la §26.1
  a dargliene uno: `Tab` e `Enter` sono dichiarabili solo dentro un ambito. Chi
  prende la (a) prima di quella voce non riempie un vuoto — riapre una
  decisione, e lo fa senza avere lo strumento che la scioglierebbe. La (b) non
  la chiude in nessun modo: quando la §26.1 sarà decisa, i quattordici accordi
  saliranno trovando il banco che li aspetta.
- **(c) Un `KeymapProvider`** — un'interfaccia nuova, che
  `crates/fub-abi/tests/wit_additivity.rs` mette fra le mosse additive: **non
  scade col freeze**, quindi non c'è nessuna fretta che la giustifichi oggi. E
  il suo primo chiamante sarebbe la stessa domanda della (a) — «chi esegue» —
  a cui la [0077](0077-una-scorciatoia-e-una-chiave.md) ha già risposto una
  volta con un `run()` locale.
- **(d) Com'è oggi** — è la forma che la voce prezza in **137 comportamenti di
  tastiera su 151** su cui l'utente non ha voce in capitolo. Lasciarla intera
  vorrebbe dire lasciare aperta la porta della quarta collisione proprio mentre
  il corpus dei gesti sta per crescere, che è il momento in cui costa di più.
- **(b) alla lettera, coi 102 dentro `tutti()`** — scartata sopra: sarebbe un
  presidio rosso per un tempo indefinito, che è il modo più affidabile di
  insegnare a non guardarlo.

## Cosa resta scoperto

- **Le tre collisioni ci sono ancora**, e `Ctrl+F` dentro una nota continua ad
  aprire due ricerche. Questo verbale le **nomina**; a deciderle è la §26.1, che
  resta aperta.
- **Il registro 5 — i 35 confronti di tastiera nel DOM, in 8 file — non lo
  guarda nemmeno adesso nessuno.** Non è un'omissione di comodo: non è un
  elenco, sono rami dentro dei gestori, e non c'è niente da importare. Renderlo
  confrontabile è lavoro di un'altra specie, e non è né misurato né deciso qui.
- **La ricostruzione di `basicSetup`** è l'unica cosa che il banco crede, come
  scritto sopra: un aggiornamento del pacchetto che cambiasse la composizione
  passerebbe verde.
- **Il registro 3 e il registro 4 si sovrappongono su sette accordi** e nessuno
  li confronta fra loro: lì la precedenza è l'ordine di montaggio, che è una
  regola di CodeMirror e non di questa app, ed è restata fuori dalla domanda
  della voce.
