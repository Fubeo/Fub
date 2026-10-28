# Formato della scena, penne e punta piatta

> **Ambito:** le penne con un nome di un tratto a mano libera e il pennello
> `nib1`, la punta piatta. Versione 1.
> **Fonti autorevoli:** `apps/client/src/ink/brush.ts` (grammatica),
> `ink/nib1.ts` (contorno), `ink/pens.ts` (le ricette) e
> `crates/fub-scene/src/brush.rs`, che legge allo stesso modo.

Una parte del [formato della scena](scene-format.md), §5. Le sezioni del
formato si citano come «formato della scena, §N».

## 1. La penna di un tratto

Un tratto scritto con una penna porta il suo nome in `fub:brush` come chiave
sconosciuta, `pen=<id>`, dopo le chiavi note:

```xml
<path fub:tool="pen" fub:brush="pf1 size=3 thinning=0.6 smoothing=0.6 streamline=0.45 taperStart=6 taperEnd=24 capStart=1 capEnd=1 sim=0 pen=fountain" … />
```

- **Le penne:** `ballpoint`, `fountain`, `brush`, `marker`, `pencil` e
  `highlighter` sono ricette di `pf1`; `calligraphy` è `nib1`. Un id che non
  si conosce resta nel file e il tratto si disegna col suo pennello.
- **Che cosa decide:** la penna non cambia `d`, che dipende soltanto dalle
  chiavi note. Dice quanto copre il tratto e come si fonde: `marker` scrive
  `fill-opacity="0.92"`, `pencil` `0.8`, `highlighter` `0.5` con
  `style="mix-blend-mode: multiply"`, che non ingrigisce il nero sotto.
- **Senza penna:** un tratto di prima delle penne prende l'aspetto dello
  strumento: pieno con la penna, l'evidenziatore come `highlighter`.
- **Compatibilità:** chi conosce soltanto `pf1` tiene `pen=<id>` e ridisegna
  le sei penne `pf1` uguali; un tratto `nib1` per lui è S004, e `d` si usa
  così com'è (formato della scena, §5).

## 2. `nib1`, la punta piatta

`nib1` seguito da coppie `chiave=valore`, con la grammatica, i numeri, le
chiavi sconosciute e gli errori di `pf1` (formato della scena, §5):

| Chiave | Intervallo | Predefinito | Che cosa |
|---|---|---|---|
| `size` | > 0 | 12 | larghezza della punta, in unità |
| `tip` | ≥ 0 | 1 | spessore della punta: il tratto non è mai più sottile |
| `angle` | −180…180 | 35 | angolo della punta, in gradi |
| `fixation` | 0…1 | 0.9 | quanto la punta tiene l'angolo invece di girare col tratto |
| `thinning` | 0…1 | 0.3 | quanto la pressione stringe la larghezza |
| `tilt` | 0 o 1 | 1 | l'angolo viene dall'azimut del campione, più 90° |
| `smoothing` | 0…1 | 0.6 | levigatura della direzione |
| `streamline` | 0…1 | 0.5 | quanto il tratto insegue la penna in ritardo |
| `sim` | 0 o 1 | 0 | pressione ignorata |

Il contorno è il nastro che la punta lascia passando sui campioni
quantizzati, in unità:

1. **Inseguimento:** q₀ = p₀, qᵢ = qᵢ₋₁ + (pᵢ − qᵢ₋₁)·(1 − 0,9·streamline);
   un tratto concluso finisce sull'ultimo campione; due punti uguali
   consecutivi contano una volta.
2. **Direzione:** l'angolo di qᵢ₊₁ − qᵢ₋₁ (agli estremi il vicino che c'è),
   levigato con sᵢ = sᵢ₋₁ + (dᵢ − sᵢ₋₁)·(1 − 0,9·smoothing) sull'angolo
   srotolato.
3. **Angolo della punta:** `angle`, o `z + 90` se `tilt=1` e il campione ha
   l'azimut, più (1 − fixation)·sᵢ.
4. **Larghezza:** size·(1 − thinning·(1 − p/255)), con la pressione 1 se
   `sim=1` o se il tratto non ha `p`; mai meno di `tip`.
5. **Nastro:** a ogni punto la punta è un segmento lungo la larghezza,
   girato dell'angolo, spostato di `tip / 2` di traverso alla direzione dal
   lato della punta. Il contorno è il lato sinistro in avanti e il destro
   all'indietro.

Un tratto di un solo punto è la punta ferma: un rettangolo largo la punta e
spesso `tip`. `d` si scrive dai vertici con le regole del contorno di `pf1`
(formato della scena, §5): centesimi, punti medi, `Q` e `Z`.
