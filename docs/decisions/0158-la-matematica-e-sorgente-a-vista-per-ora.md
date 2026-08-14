# 0158 — La matematica è sorgente a vista, per ora

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: la resa TeX della voce
«Rendering ricco di callout / embed / math» di
[M3](../milestones/M3-editor-fidelity.md) **Commit**: *(questo commit)*

---

## La domanda

La voce «Rendering ricco di callout / embed / math» di M3 chiedeva la resa
ricca dei `custom_kind` noti — callout, math, tabelle — con «math via
KaTeX/MathML». La domanda, rimisurata: **che cosa si può rendere onestamente
oggi**, senza un motore TeX nel bundle, e che cosa resta scritto come casella
per il giorno in cui il motore ci sarà.

## La premessa, rimisurata

Rimisurata a `b333ab4`.

- **Il modello conosce la matematica come sorgente, non come resa.**
  `custom_kind::MATH` sta in `crates/fub-abi/src/model.rs:1046`, e il carico
  è `(MATH, Carico::Corpo("source"))` (`:1125-1130`): il modello porta il
  sorgente TeX, non una resa.
- **Il provider la emette come sorgente, già con un gancio.** `MathRenderer`
  in `crates/fub-features/src/blocks.rs` rende
  `<div class="math-block" data-tex=…>` con la sorgente escapata; `MathRule`
  produce `custom_kind::MATH` con `attrs: { source, display }`. Il registro
  avviene in `crates/fub-host/src/mount.rs:640-653`.
- **Il renderer markdown non ha un ramo math.** `crates/fub-format-markdown/src/render.rs`
  gestisce `Block::Custom` per CALLOUT e FRONTMATTER_UNPARSED; ogni altro
  `custom_kind` degrada genericamente. La resa ricca della matematica non è
  scritta da nessuna parte — né in-editor né in anteprima.
- **Nel bundle non c'è un motore TeX.** `frontend/package.json` non nomina
  KaTeX né MathJax né alcuna dipendenza math: la resa vera richiederebbe una
  dipendenza nuova, e una dipendenza è una decisione di supply chain
  ([0001](0001-supply-chain-e-sbom.md)).
- **La via è già stata indicata.** La [0017](0017-chi-disegna-cio-che-il-core-non-conosce.md)
  (§ `fub:math`) diceva: *«Senza un motore TeX nel bundle, ciò che si può fare
  onestamente è dare alla formula un blocco suo e conservare il sorgente in un
  `data-tex`: non è un segnaposto che finge, è la formula, non composta»*. E
  `frontend/src/style.css` (`.markdown-preview .math-block`, `:743-747`) lo
  dice a parole: *«La formula: c'è il blocco, non c'è il compositore — e si
  vede»*.
- **Le caselle di resa restano aperte.** `docs/features/06-rendering-preview-temi.md`
  tiene tre caselle math: «Rendering matematico KaTeX/MathJax», «Math inline»,
  «Math block».

## La decisione

**La matematica è sorgente a vista, per ora: il blocco c'è, il compositore
no, e si vede.** M3 chiude la resa TeX della voce con questa forma — il
`math-block` con `data-tex` che la 0017 aveva già indicato — e le tre caselle
di `06-rendering-preview-temi.md` restano aperte per il giorno in cui un motore
entrerà nel bundle. Non si introduce KaTeX né MathJax: una dipendenza nuova è
una decisione di supply chain, e la resa vera non è un requisito di M3 — la
fedeltà che M3 chiede è che la formula **si veda come formula**, non che venga
composta.

Il lavoro portato è il fatto scritto dove ci si inciampa: il doc di
`custom_kind::MATH` e quello di `MathRenderer` dicono che il modello porta il
sorgente e la resa lo conserva in `data-tex` — il gancio per il compositore
futuro, che non finge di comporre. `data-tex` è il punto in cui il motore di
un domani si innesta senza toccare il modello.

**Presidio: nessuno, e la ragione è la stessa della
[0153](0153-non-c-e-una-terza-pila.md).** Un banco che pretendesse «nessun
motore TeX nel bundle» diventerebbe rosso sulla mossa giusta — il giorno in cui
il motore entra — e un lucchetto che diventa rosso per la mossa giusta è peggio
di nessun lucchetto. La casella di `06-rendering-preview-temi.md` è il posto
che la decisione lascia aperto, e un posto nominato non è una promessa
dimenticata.

## Le forme scartate

- **KaTeX/MathJax nel bundle, oggi** — scartata: una dipendenza nuova è una
  decisione di supply chain ([0001](0001-supply-chain-e-sbom.md)), e la resa
  vera non è ciò che M3 chiede. La casella resta aperta, con il gancio già
  scritto.
- **Un ramo math duplicato in `render.rs`** — scartata: il renderer markdown
  non deve conoscere la resa di un `custom_kind` che non sa comporre; il
  `math-block` con `data-tex` è già la resa onesta, e un ramo che fingesse di
  comporre sarebbe un segnaposto che mente — la cosa che la 0017 ha escluso per
  nome.

## Cosa resta scoperto

- **La resa vera (KaTeX/MathML) resta una casella di
  `06-rendering-preview-temi.md`**: il giorno in cui un motore entrerà nel
  bundle, si innesta su `data-tex` senza toccare il modello. È una decisione di
  supply chain, non di resa.
- **Math inline resta una casella a parte**: il `math-block` è un blocco; la
  formula dentro una riga di testo non ha ancora una forma dichiarata nel
  modello.
- **`data-tex` è un gancio, non un contratto**: la sua forma non è congelata
  nel WIT, e il compositore futuro potrà leggerlo come vuole — o dichiarare
  una forma propria quando la resa vera lo richiederà.
