# 0227 — Le penne sono ricette del pennello, e la punta piatta è un pennello nuovo

- **Stato:** proposta
- **Data:** 2026-10-28
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Il disegno aveva un pennello solo, `pf1` coi valori di partenza, e tre
spessori. Chi scrive a mano si aspetta penne diverse (sfera, stilografica,
pennello, pennarello, matita, calligrafia, evidenziatore), come in OneNote,
Word e nei programmi di disegno. Un tratto tiene già i suoi campioni grezzi
(`fub:ink`, ADR 0204) e il pennello che lo ridisegna (`fub:brush`): una penna
nuova poteva essere un formato nuovo, un attributo nuovo o soltanto altri
numeri dello stesso pennello.

La calligrafia non si fa con `pf1`: il suo spessore dipende dalla direzione
del tratto, non dalla pressione. Serve un'altra geometria del contorno.

## Decisione

1. **Una penna è una ricetta di `pf1`.** Sfera, Stilografica, Pennello,
   Pennarello, Matita ed Evidenziatore sono `pf1` con altri numeri
   (`apps/client/src/ink/pens.ts`); le rastremazioni sono multipli della
   misura, così una penna più grossa resta la stessa penna.
2. **Il nome della penna è una chiave conservata.** Il pennello scrive
   `pen=<id>` dopo le chiavi note; `pf1` non la conosce e la tiene. Un file
   scritto con una penna si apre uguale dove le penne non ci sono.
3. **La punta piatta è il pennello `nib1`.** Una punta rettangolare, con
   larghezza e altezza, girata di un angolo fisso o come la penna quando la
   tavoletta ne dà l'azimut; il client ne disegna il contorno
   (`ink/nib1.ts`) e `fub-scene` legge il pennello allo stesso modo. La forma è in
   [`scene-format-pens.md`](../reference/scene-format-pens.md).
4. **Quanto copre e come si fonde li dice la penna.** L'evidenziatore è
   metà trasparente con la fusione Moltiplica (`fill-opacity`, e
   `mix-blend-mode` in `style`); un tratto senza penna resta com'era.
5. **Le penne salvate sono della macchina.** «Le mie penne» stanno nella
   chiave `draw.pens`, non nel disegno; il disegno porta soltanto la penna di
   ogni tratto.
6. **Nei documenti di Word** la penna diventa le proprietà del pennello che
   Word conosce (punta rettangolare per la Calligrafia e l'evidenziatore,
   `ignorePressure` per il Pennarello) e il suo nome resta in `fubPen`.

## Conseguenze

### Positive

- nessun formato nuovo per sei penne su sette, e i file vecchi non cambiano;
- un tratto si ripenna dai campioni, perché la penna è soltanto un pennello;
- il nome conservato fa tornare la penna giusta anche dopo un altro editor.

### Negative

- `nib1` è un algoritmo in più da tenere uguale in TypeScript e in Rust;
- un'applicazione che conosce `pf1` ma non `nib1` mostra la Calligrafia col
  suo ripiego, il `d` scritto, e non la ridisegna;
- Word non conosce la penna: un tratto toccato in Word perde `fubPen`.

## Alternative scartate

### Un attributo `fub:pen`

Più leggibile, ma un attributo nuovo nel formato della scena per un dato che
il pennello può già portare. La chiave conservata non chiede niente ai
lettori che già ci sono.

### La calligrafia con `pf1` e la pressione finta dalla direzione

Si avvicina, ma i capi restano tondi e lo spessore varia con la velocità: non
è una punta piatta.

## Verifica

- `apps/client/src/ink/pens.test.ts`, `ink/nib1.test.ts`, `ink/brush.test.ts`;
- `cargo test -p fub-scene` (lettura di `nib1` e della chiave `pen`);
- `cargo test -p fub-ink` (InkML: `ignorePressure` e `fubPen`) e
  `cargo test -p fub-format-rich --test roundtrip`.
