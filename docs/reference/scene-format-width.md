# Formato della scena, spessore variabile

> **Ambito:** il contorno a spessore variabile, la forma sintetica di una
> linea che si allarga e si stringe lungo il suo percorso: grammatica di
> `fub:geom`, profilo delle larghezze, `d`, attributi, lettura e scrittura.
> Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/varwidth.ts`,
> `crates/fub-scene/src/varwidth.rs` e i casi scritti a mano in
> `apps/client/src/__fixtures__/scene-width/cases.json`, che valgono per
> tutte e due le letture; il `d` lo calcola soltanto la superficie, in
> `apps/client/src/editors/spatial/tools/offset.ts`, come per la freccia.

Una forma sintetica del [formato della scena](scene-format.md), §6: un
`path` con `fub:shape="width"` e `fub:geom`, e il suo `d` calcolato dalla
geometria. Il `d` è il contorno già pieno, dipinto col riempimento: un altro
programma vede una forma piena e la disegna uguale, mentre FubDraw ne legge
la linea centrale e il profilo, e cambiarli riscrive `d`. Come si disegna è
in [Disegni, spessore variabile](../product/drawing-width.md). Le sezioni
del formato si citano come «formato della scena, §N».

```xml
<path id="o00000024" fub:shape="width" fub:geom="round round 0 1 1 0.4 8 6 1 0 0 M1200 960 L1300 960 L1360 1020" d="M1200 961 A1 1 0 0 1 1199 960 A1 1 0 0 1 1200 959 C1224.65 955.02 1249.29 952 1273.94 952 C1282.63 952 1291.31 952.09 1300 952.31 A7.69 7.69 0 0 1 1305.44 954.56 C1324.93 975.07 1343.44 996.56 1360 1020 C1338.12 1003.06 1317.57 984.79 1297.73 965.8 C1289.8 965.94 1281.87 966 1273.94 966 C1249.29 966 1224.65 963.87 1200 961 Z" fill="#cc79a7"/>
```

Una linea che parte larga 2, arriva a 14 a due quinti del percorso, 8 sopra
e 6 sotto, e finisce a punta dopo lo spigolo, con gli estremi e gli angoli
tondi.

## 1. La geometria

`fub:geom` ha quattro parti, in quest'ordine: `estremi angoli profilo linea`.

- **Estremi:** `butt`, `round` o `square`, come `stroke-linecap`, seguiti
  da almeno uno spazio XML. Contano soltanto per una linea aperta.
- **Angoli:** `miter`, `round` o `bevel`, come `stroke-linejoin`, seguiti
  da almeno uno spazio. Il limite degli spigoli vivi è 4, quello di SVG.
- **Profilo:** da dopo gli angoli fino alla prima `M` o `m`: numeri SVG
  separati da spazi o virgole, come in `points`, a terne `t s d` (§2).
- **Linea centrale:** dalla prima `M` o `m` alla fine, con la grammatica
  dell'attributo `d` di SVG: un sottotracciato solo, con una `M` o `m` in
  testa e nessun'altra, al più una `Z` o `z` e soltanto in fondo, e almeno
  un segmento che va da qualche parte. Un arco coi capi uguali non va da
  nessuna parte; una curva sì, se un suo punto di controllo si scosta.

Le parole sono minuscole e intere: `Round`, `miter0` o `round,round` sono
fuori grammatica.

## 2. Il profilo

Ogni terna `t s d` è un punto del profilo.

- **Dove:** `t` è la frazione della lunghezza della linea centrale, misurata
  lungo il percorso, da 0 all'inizio a 1 alla fine. Una linea chiusa conta
  anche il tratto della `Z`, e lì 0 e 1 si toccano.
- **Quanto:** `s` e `d`, non negativi, sono quanto il contorno si allarga a
  sinistra e a destra di chi percorre la linea sullo schermo, dove l'asse y
  scende: per una linea che va verso destra, la destra è sotto. La larghezza
  in quel punto è s + d.
- **Quanti:** da 2 a 1000 punti, con almeno una larghezza positiva. Il primo
  sta a 0, l'ultimo a 1, e le posizioni non tornano mai indietro.
- **Gli scalini:** due punti di fila con la stessa `t` sono uno scalino, e la
  larghezza vi salta dal primo al secondo. Mai tre di fila, e mai ai capi:
  il secondo punto non sta a 0, il penultimo non sta a 1.
- **Fra due punti** ogni lato segue l'interpolazione cubica monotona a
  tratti di Fritsch e Carlson, quella di `pchip`, calcolata da sola su ogni
  fila di punti fra due scalini. Nei punti in mezzo la pendenza è la media
  armonica pesata delle due secanti, coi pesi 2hₖ + hₖ₋₁ e hₖ + 2hₖ₋₁ dove h
  sono le distanze in `t`; è zero dove le secanti cambiano segno o una è
  zero. Ai capi la formula a tre punti, zero se va contro la prima secante e
  al più tre volte lei se le due secanti hanno segni diversi; con due punti
  soli, la secante. La larghezza cambia così senza spigoli e non esce mai dai
  valori dei due punti: un profilo che va a zero non diventa negativo, uno
  piatto resta piatto.

## 3. Il `d`

L'area che il contorno copre, come tracciato:

- **Lungo la linea** l'area fra i due lati: in ogni punto, la normale porta
  a `s` dalla parte sinistra e a `d` dalla destra.
- **Gli angoli** stanno dove due segmenti della linea si incontrano con
  versi diversi, dalla parte esterna della svolta, larghi quanto il più
  largo dei due segmenti da quella parte. Uno spigolo vivo arriva a
  h / cos(θ/2) dal vertice, con θ la svolta e h la larghezza esterna, se il
  rapporto non supera 4; altrimenti, e con `bevel`, il giunto è smussato.
  `round` è un arco di raggio h. Una svolta così piccola che i due lati si
  scostano al più di 0,005 unità non fa angolo.
- **Gli estremi** di una linea aperta stanno sul segmento fra i due lati,
  con mezza larghezza (s + d)/2: niente con `butt`, mezzo cerchio con
  `round`, mezzo quadrato con `square`. Un capo largo zero non ha estremo.
- **Il tracciato** è l'unione già fatta: anelli che non si incrociano, coi
  buchi nel verso contrario, che si dipingono uguali con `fill-rule`
  `nonzero` o `evenodd`. I lati curvi sono cubiche che si scostano dal lato
  vero di circa 0,005 unità al più.
- **I numeri:** tutto si calcola dalla geometria com'è scritta, e il `d` si
  scrive in forma canonica (§7, punto 4).

Chi non calcola il contorno usa `d` così com'è.

## 4. Attributi

- **Il colore** del contorno è il riempimento: `fill`, e `fill-opacity` per
  la sua trasparenza. FubDraw non scrive `stroke` né gli altri attributi del
  contorno, che è già l'area; uno scritto da altri si dipinge attorno a lei,
  come su ogni forma.
- **Il resto** come per un tracciato: `opacity`, `transform`, `display`, un
  `title` e un `desc` figli.

## 5. Lettura e scrittura

- **Fuori grammatica:** un `fub:geom` che non segue §1 e §2, come un profilo
  di terne incomplete, una larghezza negativa, un punto oltre 1 o una linea
  di due sottotracciati. La forma è allora un tracciato normale (§6): la
  geometria si legge da `d` e gli attributi si conservano.
- **Nella scena letta** il ruolo è `width`, con la geometria letta in
  `varwidth`: gli estremi, gli angoli, il profilo e la linea centrale com'è
  scritta. La lettura non confronta `d` con la geometria.
- **Scrittura:** le parti separate da uno spazio solo; le posizioni con al
  più quattro decimali, le larghezze con due, coi numeri del formato (§7,
  punto 3); la linea centrale in forma canonica. Un punto che arrotondato
  cade su un capo, o in mezzo a due con la sua stessa posizione, non si
  scrive.
- **Quando si riscrive `d`:** quando cambia `fub:geom`. Spostare, scalare e
  ruotare cambiano soltanto `transform`; applicare una trasformazione alla
  linea ne trasforma la linea centrale e moltiplica le larghezze per la
  radice del valore assoluto del determinante, e una trasformazione che
  specchia scambia i lati. Trasformare la forma in tracciato toglie
  `fub:shape` e `fub:geom` e lascia il `d`.
