# 0150 — Il piano è della superficie, e una superficie in più è additiva

**Stato**: accolta **Data**: 2026-08-12 **Chiude**: §26.4 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.4](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#264-il-livello-di-una-superficie-non-è-un-dato)
chiedeva chi sta sopra e chi prende il tasto quando due superfici sono aperte
insieme: un fatto **dichiarato**, un livello che ogni superficie porta con sé,
oppure la conseguenza di due cose scritte in due posti che non si parlano.

La metà shell della voce è già stata riparata (difetto 0149): l'ordine della
tastiera adesso è dichiarato — comanda **l'ultima trappola aperta**, e la pila
sta in `frontend/src/ui/a11y.ts` — e la regola che lega i piani a ciò che fanno
sta scritta accanto ai piani, in `frontend/src/theme/tokens.css`. Quello che
restava aperto è la sola domanda di contratto: la forma **(b)**, un campo
`layer` in fondo a `view-spec`, «così un terzo che porta una superficie propria
dichiara dove sta invece di scoprirlo».

## La premessa, rimisurata

Rimisurata a `85bd05d`.

- **Un terzo non porta una superficie.** `view-surface` ne nomina dieci
  (`crates/fub-abi/src/traits.rs`, `ViewSurface::ALL`), sono tutte della shell,
  e una view **ci si attacca**: `view-spec.surface` sceglie a quale. A dipingere
  è sempre la shell, e i sette piani sono suoi. La frase della voce — «un terzo
  che porta una superficie propria: un viewer PDF, un lightbox, uno slash menu»
  — descrive tre superfici che oggi il contratto **non ha**, e la loro mancanza
  non è un campo mancante: è un caso mancante nell'elenco.
- **L'ordine dei tasti non è più un numero che qualcuno sceglie.** Dopo la
  riparazione del 0149 la regola è «l'ultima aperta comanda», e sullo stesso
  piano l'ultima aperta è anche l'ultima dipinta. Il piano non è una preferenza:
  è ciò che quella regola presuppone.
- **La scadenza c'è ma non è la scadenza del freeze.** Un campo in fondo a un
  `record` è additivo per la regola del repo
  (`crates/fub-abi/tests/wit_additivity.rs`), e **lo è anche un caso in fondo a
  un `enum`**: la tabella dell'additività li mette sulla stessa riga. Quindi non
  solo la (b) non scade — non scade nemmeno la via alternativa, che è far
  crescere `view-surface`. Ciò che si irrigidisce dopo M4 è la **posizione** del
  campo, cioè una cosa cosmetica; e la [0002](0002-additivita-del-contratto.md)
  parla di additività, non di eleganza dell'ordine.

## La decisione

**Niente `layer` in `view-spec`. Il piano è della superficie, e volere un piano
diverso vuol dire volere una superficie diversa.**

La ragione decisiva è la seconda prova della barra, che qui è netta al
contrario: `layer` **non ha un primo chiamante** — nessun plugin di terzi esiste
prima di M5 — e il suo secondo chiamante sarebbe la shell, che la risposta ce
l'ha già e migliore. Peggio: la shell dovrebbe **ignorarlo** ogni volta che
contraddice la pila delle trappole, perché quella pila è ciò che impedisce di
scrivere alla cieca dentro qualcosa dipinto sotto. Un campo che va ignorato per
tenere l'invariante non è un campo: è un secondo ordine accanto al primo, cioè
esattamente la malattia che questa voce ha misurato e che il 0149 ha curato.

Resta l'obiezione che la voce muoveva alla forma (c) — *«due plugin che vogliono
due livelli diversi sulla stessa superficie non hanno modo di dirlo»* — e la
risposta è che quel desiderio, detto per intero, non è un livello: è una
superficie. Un lightbox non è «un `main` più in alto», è un'altra cosa, con
un'altra vita e altre regole sul fuoco. E la via per chiederla resta aperta per
sempre, perché aggiungere un caso in fondo a `view-surface` è una mossa additiva
come accodare un campo: la decisione di oggi non consuma nessuna occasione.

Il lavoro che la decisione porta con sé è una riga di prosa, e sta dove serve:
il doc di `ViewSurface` e quello di `enum view-surface` nel WIT dicono adesso
che il piano appartiene alla superficie, che fra due superfici che intrappolano
il fuoco comanda l'ultima aperta, e che un piano diverso si chiede aggiungendo
una superficie. Prima il contratto su questo taceva, e chi legge un
`option<string>` o un `enum` muto non ha modo di sapere che la domanda ha già
una risposta.

## Le forme scartate

- **(b) il campo `layer`** — per la prova del secondo chiamante, e per la
  contraddizione descritta sopra. Non è nemmeno «pagare presto per non pagare
  dopo»: dopo si può ancora, e la via che serve davvero (una superficie nuova) è
  additiva quanto lei.
- **(a) il livello come parametro della trappola** — è la forma shell, ed è
  stata **già fatta senza il parametro** dal 0149: l'ordine si deduce
  dall'apertura invece di farlo scegliere a ogni chiamante, che è la stessa
  ragione per cui la trappola sta in un posto solo.
- **(d) com'è oggi** — cade con la prosa: «com'è oggi» comprendeva un contratto
  che non dice niente, e adesso lo dice.

## Cosa resta scoperto

Zero caselle. Due cose misurate, e vanno scritte perché nessun presidio le dice.

- **I piani non hanno un banco.** `tokens.css` dichiara la lista e la regola in
  prosa; nessun test la legge. Il precedente per farlo è in casa e costa poco
  (`frontend/src/theme/contrast.test.ts` importa `tokens.css?raw` e pretende una
  proprietà sui token), ma un banco che pretende la regola come è scritta oggi
  sarebbe **rosso**, per la ragione qui sotto — e un presidio non si scrive
  rosso: si scrive dopo aver deciso quale delle due metà cambia.
- **Tre superfici che intrappolano il fuoco stanno sotto `--z-modal`.** La
  regola scritta in `tokens.css:101-106` dice che chi intrappola il fuoco sta su
  `--z-modal` e sotto di lei non ci va nessun'altra che lo intrappoli. Le
  trappole aperte oggi sono sette, e tre non sono lì: `#context-menu`
  (`--z-menu`, 50), `#icon-picker` (`--z-picker`, 60) e `#settings-panel`
  (`--z-dialog`, 80). Il pannello delle impostazioni è `inset: 48px 10%`, quindi
  la barra in alto e una striscia di barra laterale restano cliccabili mentre è
  aperto: un menu contestuale aperto da lì prende i tasti (è l'ultima trappola)
  e si dipinge **sotto** il pannello. È la stessa contraddizione che la voce
  misurava, con attori diversi da quelli che nominava. Non si ripara qui perché
  la riparazione ha una scelta dentro che non è di questo verbale: portare tutte
  le trappole su `--z-modal` mette il pannello delle impostazioni **sopra** il
  toast, e che il toast stia sopra il pannello è una cosa che il repo ha deciso
  apposta e ha scritto accanto a `--z-toast`.
