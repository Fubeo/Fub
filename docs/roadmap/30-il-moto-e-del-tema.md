# 30. Il moto è del tema

Una **seduta** della [roadmap infrastrutturale](../todo.md). La seduta 29 ha
fatto dei tre strati un fascio sostituibile — struttura, foglio, pelle — e ha
collocato il moto al suo posto: il foglio porta «tipografia e moto», la pelle
porta «bordi, hover, effetti, keyframes — e le animazioni». Questa seduta non
apre un'altra strada: cerna le decisioni che quel collocamento chiede, e le
scrive come promesse vincolanti. Sette decisioni e nessuna voce aperta: la
roadmap le ha portate nel codice senza cambiare il confine deciso qui.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: dal collocamento del moto nella 29, che non è
una novità ma una conseguenza.** Un tema di terzi porta il proprio ritmo come già
porta i colori. Il cancello del moto ridotto esiste già ed è il pavimento del
§25.1: una regola di struttura che sotto `prefers-reduced-motion` azzera le
durate di transizione e animazione con `!important` su `*`
(`struttura.css:92-100`). La shell fa rispettare il moto ridotto, non la
cortesia dell'autore del tema.

**Il conto, prima delle decisioni** — e i numeri portano accanto il comando
che li rimisura, come la [seduta 28](28-centoventuno-eseguibili-per-provare-una-riga.md)
insegna:

- i due fogli dichiarano **80** token ciascuno
  (`grep -c '^  --' frontend/src/theme/serie/foglio-chiaro.css`), la struttura
  **8** (`grep -c '^  --' frontend/src/theme/struttura.css`), la pelle di serie
  **289** regole (`grep -c '{' frontend/src/theme/serie/pelle.css`);
- il moto vivo oggi sono **3** blocchi `transition` nella pelle — `button`
  (`pelle.css:73-75`), `.tab` (`pelle.css:481-484`), `.theme-switch button`
  (`pelle.css:1783-1786`) — tutti `--duration-fast` 120ms + `--ease`
  cubic-bezier(0.2,0.8,0.2,1);
- `--duration-med` 180ms è dichiarato identico nei due fogli
  (`foglio-chiaro.css:86`, `foglio-scuro.css:98`) e **mai consumato** da
  nessuna regola (`grep -rn 'var(--duration-med)' frontend/src/` non esce): è un
  token morto;
- la `.skip-link` ha un `transform` senza transition
  (`struttura.css:132-138`): salto istantaneo;
- ~14 superfici aprono e chiudono con `hidden` (`display: none !important`,
  `struttura.css:81-83`), con `.collapsed` (`pelle.css:1387-1389`) o con
  rimozione dal DOM (`palette.ts:268`, `quick-switcher.ts:82`): il CSS classico
  non transita `display`;
- il grafo è l'unico canvas: loop rAF self-scheduling che si spegne da solo
  quando quieto (`grafico.ts:182-185`, `grafico.ts:233-236`,
  `SOGLIA_ATTIVO` 0.02 a `grafico.ts:39`), camera a inseguimento esponenziale
  90ms (`camera.ts:44`, `camera.ts:102-116`), pulse 1.2Hz con fase da hash id
  (`pittore.ts:318-321`). Il loop **non consulta mai** `prefers-reduced-motion`;
- il cambio tema è a secco: `applica()` (`theme.ts:114-120`) monta il foglio a
  sostituzione poi scrive `data-theme`; il pittore ridipinge osservando
  `data-theme` (`pittore.ts:395-399`). Flash, non dissolvenza.

**Perché adesso.** Il collocamento del moto nella 29 è una decisione di
architettura che aspetta il proprio vocabolario. La scala delle durate è
oggi due soli valori — e uno è morto. Le ~14 superfici che si aprono e
chiudono non si animano perché `display: none` non si transita. E il grafo,
unica superficie con moto continuo, ignora il cancello che il resto della
shell già onora. Tre buchi, tre decisioni, e un vocabolario che li copre.

---

## Perché stanno insieme

In tutte e sette la domanda è una sola — **di chi è il moto** — vista da sette
lati: quale scala (§30.1), con quale meccanismo di montaggio (§30.2), come
cambia la luce (§30.3), quali gesti per quali superfici (§30.4), cosa fa il
grafo (§30.5), dove non si balla (§30.6), e cosa tiene insieme tutto (§30.7).
Il pavimento è lo stesso della 29: il caricatore sostituisce, non impila, e il
moto entra come parte del foglio o della pelle, mai come codice — chi vuole
animare con la logica sta scrivendo un plugin con la sua `WebView`, non un
tema (§29.6).

---

### 30.1 Il ritmo è del tema, e il vocabolario si allarga solo quando è consumato

*foglio · **P1***

La scala del moto vive nel foglio: un tema di terzi porta il proprio ritmo
come già porta i colori. Consequenza della 29, non novità. Il vocabolario dei
fogli passa da due durate e un easing a una scala dichiarata: tre durate
semantiche — attimo, entrata, camminata ≈ 120/180/280ms — e due easing
(uscita decisa, entrata morbida; la cubic-bezier(0.2,0.8,0.2,1) resta «la»
curva). I numeri esatti si decidono in implementazione con la stessa materia
dei gemelli chiaro/scuro, e i due fogli dichiarano vocabolario **identico**:
il presidio esistente — lo stesso blocco di token in entrambi — lo tiene
insieme.

Il token morto `--duration-med` è la lezione. Si allarga il vocabolario solo
con il consumatore in piedi nella stessa tappa. Il presidio nuovo si chiama
«vocabolario vivo»: ogni token di moto dichiarato in un foglio è consumato da
almeno una regola tra pelle e struttura, e un test fallisce altrimenti. Il
`grep -rn 'var(--duration-med)' frontend/src/` che oggi non esce è il banco
di questa promessa.

| Via | Forma | Scartata perché |
| --- | --- | --- |
| (a) moto come costanti nella pelle | il ritmo è della pelle di serie, un tema nudo eredita tempi che non ha scelto | il ritmo è del foglio, come i colori |

### 30.2 La shell dirige, il tema balla

*shell · **P1***

Il problema sono le ~14 superfici che aprono con `hidden` o rimozione DOM: il
CSS non transita `display`. Tre strade, una scelta.

| Via | Meccanismo | Scartata perché |
| --- | --- | --- |
| (a) `@starting-style` + `transition-behavior: allow-discrete` | solo CSS | supporto a macchia nei motori (WebKitGTK); una regola che a seconda del motore anima o no è jank silenzioso |
| (b) View Transitions API per i cambi di vista | potente | stessa a macchia di motori; rimandata ad arricchimento progressivo ([0175](../decisions/0175-la-transizione-nativa-e-un-arricchimento.md)), non base |
| (c) la shell smonta il `hidden` e appende una classe di coreografia | un modulo `ui/moto.ts` con due gesti — `entra(el)`/`esci(el)` — scrive una classe, aspetta la fine (`transitionend` con bound di sicurezza), poi toglie `hidden` o stacca dal DOM | **scelta**: è logica di shell come `intrappolaFuoco`, il tema non vede codice, vede classi |

Le classi sono il contratto shell→tema: la pelle di serie le consuma con
`transform` e `opacity`; una pelle di terzi le consuma come vuole. Mai
geometria — già promesso dal manifest della 29. L'invariante di interazione:
l'uscita mai blocca l'ingresso successivo. Se si riapre durante l'uscita,
l'elemento si riannoda — la classe si toglie, l'entrata riparte — e il bound
di sicurezza è la durata massima della scala. I `pointer-events` durante
l'uscita seguono lo stato logico: già chiuso = già non cliccabile.

Il cancello della 29.3 copre tutto gratis: le classi animano via
`transition`/`animation`, il kill azzera le durate, `transitionend` arriva
subito. Nessun ramo `if (prefersReduced)`. L'alternativa scartata — dodici
timer scritti a mano, uno per superficie — sono dodici modi di
desincronizzarsi.

- [x] **§30.8 Arricchimento progressivo View Transitions**: **chiusa** dalla
      [0175](../decisions/0175-la-transizione-nativa-e-un-arricchimento.md). La via (b) della
      §30.2 non è base, e non è scartata — è dopo. Rientra quando i motori
      convergono, e prima di allora vale il confine della (c): la shell
      dirige.

### 30.3 Il cambio di luce in dissolvenza

*foglio · **P1***

Oggi il foglio si sostituisce a secco: flash. Domani `applica()` monta il
foglio, poi appende alla radice una classe effimera — durata = la terza della
scala, ~280ms — che dà `transition` a colori e ombre dove servono (`bg`,
`text`, `border`, `box-shadow`: elenco chiuso), e la toglie a fine corsa. Un
solo foglio montato anche durante la transizione: il presidio «mai due strati»
guarda lo stato a riposo, che non cambia.

Il costo è O(superfici) per il tempo della transizione; il beneficio è che
ogni tema di terzi ha il cambio di luce coreografato senza scrivere nulla:
eredità dell'architettura. Il pittore già ridipinge su `data-theme`
(`pittore.ts:395-399`): la sincronia resta «foglio montato → `data-theme` →
canvas», e la dissolvenza è solo il sandwich CSS attorno.

| Via | Forma | Scartata perché |
| --- | --- | --- |
| doppiare il foglio vecchio sotto il nuovo e crossfade | due fogli in volo | viola «un solo foglio montato» al contrario: due in volo |

### 30.4 Le entrate delle superfici

*shell · **P1***

Asse condiviso per provenienza, non coreografia libera. Ciò che viene dal
basso sale (toast, statusbar flyout); ciò che è ancorato a un punto cresce da
lì (palette dal bottone, popover fisica); ciò che è sovrano entra in scala
dal centro (settings, views-modal: 0.97→1 + fade); i pannelli laterali
scivolano sul proprio asse (sidebar files/search, inspector tab crossfade); i
riquadri si sostituiscono in dissolvenza incrociata (`#panes` cambio vista).

Ogni gesto ha un'entrata e un'uscita, e l'uscita è la stessa curva al
contrario, più veloce: uscire è meno importante che entrare, e la durata è la
prima della scala. Il toast entra dal basso ed esce in dissolvenza verso il
basso; l'auto-dismiss resta `setTimeout` logico (`notify.ts:246-248`), il
distacco passa da `esci()`.

L'ordine di lavori — le tappe — è prima le quattro sovrane (palette,
quick-switcher, settings, views-modal), poi i pannelli, poi il chrome minore.
Il numero esatto di superfici toccate per tappa si decide in implementazione
col censimento vivo (`grep -c` sui punti `hidden`/`remove`).

### 30.5 Il grafo si presenta, e il canvas scopre il moto ridotto

*kernel · **P1***

Il grafo ha già la sua strada — rAF, fisica, camera — e non la cambia. Le
coreografie d'ingresso (nodi che si assestano con scaglio da hash — la fase
per-id esiste già per il pulse, `pittore.ts:318-321`; archi che si disegnano al
primo frame) entrano nel loop esistente come **stati**, non come secondo loop.

Il buco da chiudere: il loop non consulta `prefers-reduced-motion`. Sotto moto
ridotto il grafo resta funzionale (si assesta, si naviga) ma smette di
ornare: pulse e inerzia si spengono, la camera arriva a destinazione senza
inseguimento. Una lettura una volta sola all'avvio + cambio osservato — il
pattern `matchMedia` è già ascoltato da `theme.ts` per la luce scura, ed è
riusabile.

Il pavimento 60fps della scrittura vale qui per contrasto. Il grafo è l'unica
superficie che **può** permettersi moto continuo, perché è l'unica su canvas
separato con loop che si spegne da solo quando quieto (`SOGLIA_ATTIVO`,
`grafico.ts:39`). Dove si scrive non si balla (§30.6).

- [x] **§30.9 La lettura del moto ridotto nel loop del grafo**: **chiusa**
      dalla
      [0172](../decisions/0172-la-lettura-del-moto-ridotto-nel-grafo.md).
      `theme/reduced-motion.ts` è l'unico punto che nomina
      `prefers-reduced-motion`; i grafici si iscrivono, in moto ridotto camera
      e pulse arrivano secchi.

### 30.6 Dove non si balla

*shell · **P1***

L'editor e il testo non si animano mai: nessuna transizione dentro
`.cm-editor` e `.pane-editor`, nessun effetto su caret, selezione,
scorrimento. Il requisito d'intervista — «scrittura fluida a 60 fps anche con
file da 10.000+ parole» (`docs/personas/interview_2.md:134`) — è il pavimento:
il moto che costa frame nella zona di scrittura è un difetto, non uno stile.

Il micro-moto del chrome — dove il «fighissimo» vive a costo zero — è
ammesso: rail (levetto del pulsante attivo, sweep dell'accento in hover), tab
(sottolineatura che scivola, non che lampeggia), focus ring con **una**
pulsazione all'ingresso della trappola (aiuto, non decorazione: dice «il fuoco
è entrato qui»), hover dei file-row con elevazione d'ombra.

La regola del metro: ogni gesto nuovo deve poter essere raccontato in una
frase di **stato** — «è apparso», «ha sostituito», «è andato via», «sei qui».
Chi non ha frase, non entra.

### 30.7 I presidi

*presidi · **P1***

Quattro presidi tengono insieme tutto il moto della shell.

- **Cancello**: presidio statico su `struttura.css` (come la guardia
  `[hidden]` a `struttura.css:81-83`): sotto `reduce`, ogni durata a zero —
  già vero a `struttura.css:92-100`, il presidio lo congela.
- **Vocabolario vivo**: ogni token di moto dichiarato in un foglio è
  consumato da almeno una regola tra pelle e struttura — test sui gemelli +
  test di consumo. Il `--duration-med` morto non si ripete.
- **Mai due in volo**: l'esistente «un solo foglio montato» (29.1) + il nuovo
  invariante di riannodamento (riaprire durante l'uscita non accumula classi).
- **Frase di stato**: revisione — ogni animazione della pelle di serie è
  mappata a una frase della 30.6. L'elenco sta nel verbale di chiusura, non
  in questa seduta.

---

## Cosa non è questa seduta

- **Non è implementazione**: nessun file di codice cambia. È la seduta di
  ideazione che la roadmap userà per le tappe successive.
- **Non inventa una terza via al posto dell'architettura a strati**: tutto
  passa per foglio/pelle/struttura. Il moto è del tema, non della shell — e la
  shell lo dirige.
- **Non è il congelamento del vocabolario degli hook**: quello è la 29.2, e la
  sua scadenza è la fine di M3. Le classi che la §30.2 introduce sono
  candidate naturali di quel vocabolario: farle vivere prima del congelamento
  è il modo di non rompere i temi dopo. Qui si dichiara la scala del moto, non
  si congela il nome delle classi.