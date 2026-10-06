# Formato della scena, poligoni e stelle

> **Ambito:** il poligono regolare e la stella, le forme sintetiche coi
> parametri di un disegno di FubDraw: grammatica di `fub:geom`, vertici, `d`,
> lettura e scrittura. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/parametric.ts`,
> `crates/fub-scene/src/parametric.rs` e i casi scritti a mano in
> `apps/client/src/__fixtures__/scene-shapes/cases.json`, che valgono per
> tutte e due le letture; il `d` lo calcola soltanto la superficie, come per
> la freccia.

Due forme sintetiche del [formato della scena](scene-format.md), §6: un
`path` con `fub:shape` e `fub:geom`, e il suo `d` calcolato dalla geometria.
Un altro programma vede un tracciato qualunque e lo disegna uguale; FubDraw
ne legge i parametri, e cambiare i lati, le punte o gli angoli riscrive `d`.
Le sezioni del formato si citano come «formato della scena, §N».

```xml
<path id="o00000022" fub:shape="polygon" fub:geom="1300 560 80 6 0 8" d="M1264.62 629.28 A8 8 0 0 1 1257.69 625.28 L1222.31 564 A8 8 0 0 1 1222.31 556 L1257.69 494.72 A8 8 0 0 1 1264.62 490.72 L1335.38 490.72 A8 8 0 0 1 1342.31 494.72 L1377.69 556 A8 8 0 0 1 1377.69 564 L1342.31 625.28 A8 8 0 0 1 1335.38 629.28 Z" fill="none" stroke="#0072b2" stroke-width="4"/>
<path id="o00000023" fub:shape="star" fub:geom="1100 820 70 5 0.382 0 0" d="M1100 750 L1115.72 798.37 L1166.57 798.37 L1125.43 828.26 L1141.14 876.63 L1100 846.74 L1058.86 876.63 L1074.57 828.26 L1033.43 798.37 L1084.28 798.37 Z" fill="#009e73"/>
```

## 1. Il poligono regolare

`fub:shape="polygon"`, e in `fub:geom` sei numeri SVG separati da spazi o
virgole, come in `points`: `cx cy r n a c`.

- **Centro:** `cx` e `cy`.
- **Raggio:** `r` > 0, il raggio del cerchio su cui stanno i vertici.
- **Lati:** `n`, un intero da 3 a 1000; anche `6.0` vale 6.
- **Rotazione:** `a`, in gradi in senso orario, come `rotate()`.
- **Angoli:** `c` ≥ 0, il raggio degli angoli arrotondati; 0 li lascia vivi.
- **Vertici:** il vertice k, da 0 a n − 1, sta all'angolo
  φₖ = 90° + 180°/n + 360°·k/n + a, contato dall'asse x verso l'asse y che
  scende, cioè in (cx + r·cos φₖ, cy + r·sin φₖ). A rotazione 0 il lato in
  basso è orizzontale: un triangolo ha la punta in alto, un quadrato e un
  esagono un lato in basso e uno in alto.

## 2. La stella

`fub:shape="star"`, e in `fub:geom` sette numeri: `cx cy r n k a c`.

- **Raggio e punte:** `r` > 0 è il raggio delle punte; `n`, le punte, un
  intero da 3 a 1000.
- **Rapporto:** `k`, con 0 < k ≤ 1, il rapporto fra il raggio dei vertici
  interni e quello delle punte. Con k = 1 la stella è un poligono di 2n lati;
  FubDraw propone 0,382, la stella a cinque punte i cui lati stanno in linea
  a due a due.
- **Rotazione e angoli:** `a` e `c` come nel poligono.
- **Vertici:** 2n, alternati, dalla punta 0. La punta j sta all'angolo
  270° + 360°·j/n + a col raggio r, e il vertice interno che la segue a
  180°/n più in là col raggio k·r. A rotazione 0 una punta va in alto.

## 3. Il `d`

- **Senza angoli arrotondati:** i vertici in ordine, chiusi:
  `M v0 L v1 … L vₘ Z`. Il verso è orario sullo schermo.
- **Con `c` > 0:** ogni vertice diventa un arco di cerchio tangente ai due
  lati che vi arrivano. Il punto di tangenza dista t = c / tan(α/2) dal
  vertice, con α l'angolo fra i due lati. I lati di queste forme sono lunghi
  tutti uguali, ℓ: se t supera ℓ/2, il raggio di quel vertice diventa
  (ℓ/2)·tan(α/2), e due archi vicini si toccano a metà lato.
- **Il tracciato** comincia dal punto di tangenza sul lato che arriva al
  vertice 0: `M t0 A ρ0 ρ0 0 0 s0 u0 L t1 A ρ1 ρ1 0 0 s1 u1 … Z`, con tᵢ e
  uᵢ i punti di tangenza prima e dopo il vertice i, e sᵢ 1 dove il tracciato
  gira in senso orario, 0 dove gira nell'altro, come nei vertici interni di
  una stella.
- **Restano un vertice** un vertice piatto (α = 180°), un raggio che scritto
  vale 0 e un arco i cui estremi scritti coincidono. Un `L` che scritto non
  si sposta non si scrive.
- **I numeri:** tutto si calcola dalla geometria com'è scritta e si scrive
  coi numeri del formato (§7, punto 3): chi rigenera `d` da `fub:geom`
  ottiene lo stesso testo.

Un quadrato di raggio 10 con gli angoli di raggio 2, `fub:geom="0 0 10 4 0 2"`:

```text
M-5.07 7.07 A2 2 0 0 1 -7.07 5.07 L-7.07 -5.07 A2 2 0 0 1 -5.07 -7.07 L5.07 -7.07 A2 2 0 0 1 7.07 -5.07 L7.07 5.07 A2 2 0 0 1 5.07 7.07 Z
```

## 4. Lettura e scrittura

- **Fuori grammatica:** un numero di valori diverso, un raggio che non è
  positivo, lati o punte che non sono un intero da 3 a 1000, un rapporto
  fuori da (0, 1] o un raggio degli angoli negativo. La forma è allora un
  tracciato normale (§6): la geometria si legge da `d` e gli attributi si
  conservano.
- **Nella scena letta** il ruolo è `ngon` per il poligono e `star` per la
  stella, con la geometria letta in `polygonal`; `polygon` resta il ruolo
  dell'elemento `polygon`.
- **Scrittura:** centro, raggio e raggio degli angoli con al più due
  decimali, il rapporto con quattro, lati e punte come interi. La rotazione
  va fra −180 escluso e 180, arrotondata prima di riportarla: 180,004 si
  scrive `180`.
- **Quando si riscrive `d`:** quando cambia `fub:geom`. Spostare, scalare e
  ruotare cambiano soltanto `transform`, come per gli altri oggetti, e
  trasformare la forma in tracciato toglie `fub:shape` e `fub:geom` e lascia
  il `d`.
- **Attributi:** come per un rettangolo, nessuno in più.
