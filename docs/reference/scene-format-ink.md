# Formato della scena, inchiostro del tratto

> **Ambito:** gli attributi `fub:ink`, `fub:brush` e `fub:at` di un tratto a
> mano libera. Parte del [formato della scena](scene-format.md), §5. Le sezioni
> del formato si citano come «formato della scena, §N».
> **Fonti autorevoli:** `crates/fub-scene/` e `apps/client/src/ink/`.

## `fub:ink`

```text
ink      = version SP scale SP channels 1*(SP sample)
version  = "1"
scale    = "s" ("10" / "100")
channels = "c" "xy" *ALPHA  ; ogni lettera al massimo una volta
sample   = int *("," int)      ; un valore per canale, nell'ordine di channels
int      = ["-"] 1*DIGIT
```

- **Campioni:** il primo campione è assoluto; ogni campione successivo è la
  differenza dal precedente, canale per canale.
- **`x`, `y`:** coordinate locali dell'elemento, prima del suo `transform`,
  moltiplicate per la scala e arrotondate. Con `s100` l'errore è al massimo
  0,005 unità.
- **Arrotondamento:** ogni valore si quantizza con `floor(v × scala + 0,5)`,
  la stessa regola in Rust e in TypeScript; i delta si calcolano sui valori già
  quantizzati.
- **`p`:** pressione × 255, arrotondata. Se manca (mouse, tocco), il pennello
  simula la pressione e `fub:brush` contiene `sim=1`.
- **`t`:** millisecondi dal primo campione, che vale 0.
- **`a`, `z`:** altitudine (0–90°) e azimut (0–359°, in senso orario
  dall'asse x della scena) della penna, se il dispositivo li dà; sempre insieme.
- **Canali sconosciuti:** una lettera diversa da `p`, `t`, `a` e `z`. Il
  tratto resta valido e si conserva, ma non si può ridisegnare (S010).
- **Interi:** ogni valore, assoluto o differenza, sta entro 2⁵³ − 1 in valore
  assoluto, l'ultimo intero che JavaScript rappresenta esatto. Chi scrive non
  registra un campione che lo supera; chi legge un valore più grande produce
  S004. `t` può ripetersi o tornare indietro: non entra nel contorno.
- **Inchiostro non valido:** un `fub:ink` che non rispetta la grammatica o i
  limiti produce S004, e così un `path` con `fub:tool="pen"` o `"highlighter"` a
  cui manca `fub:ink` o `fub:brush`. Il tratto resta un elemento modificabile ma
  non si ridisegna: si sposta, si trasforma, si ricolora e si elimina, e `d` si
  usa così com'è. Il documento resta modificabile.
- **Limiti:** al massimo 10 000 campioni e 512 KiB per `fub:ink`. Chi scrive
  divide il tratto al primo dei due limiti; l'ultimo campione del primo tratto
  è il primo del secondo. `d` non ha un limite proprio: lo limita la
  dimensione del file (§11).
- **Tocchi:** un tocco della penna si registra con due campioni, l'appoggio e
  il rilascio, perché con un solo campione `getStroke` disegna un trattino
  obliquo invece di un punto. Un tratto di un solo campione resta valido.

## `fub:brush`

`pf1` seguito da coppie `chiave=valore` separate da spazi:

- `size`: spessore in unità;
- `thinning` (−1…1), `smoothing` (0…1), `streamline` (0…1);
- `taperStart`, `taperEnd`: assottigliamento in unità, 0 = nessuno;
- `capStart`, `capEnd` (0 o 1);
- `sim` (0 o 1): pressione simulata.

`pf1` indica l'algoritmo `getStroke` di `perfect-freehand` 1.x, fissato alla
1.2.3, con queste opzioni e `last: true` per i tratti conclusi. La pressione
passata a `getStroke` è `p / 255`.

- **Valori:** i numeri seguono la grammatica di §4 (`1.` non è un numero) e si
  scrivono senza arrotondare, nella forma più corta che si rilegge identica.
  Una chiave nota assente prende il valore predefinito di `getStroke`:
  `size=16`, `thinning=0.5`, `smoothing=0.5`, `streamline=0.5`,
  `taperStart=0`, `taperEnd=0`, `capStart=1`, `capEnd=1`, `sim=1`.
- **Chiavi sconosciute:** si tengono in ordine, anche ripetute, e si ignorano.
- **Pennello non valido:** un `fub:brush` che non comincia con `pf1` o `nib1`,
  una chiave nota ripetuta o con un valore fuori dall'intervallo producono
  S004 come l'inchiostro non valido: il tratto non si ridisegna.
- **Campioni:** `d` si calcola dai campioni quantizzati, cioè dagli interi di
  `fub:ink` divisi per la scala, mai dai valori del dispositivo. Così chi
  ricalcola `d` dal file ottiene la stessa stringa di chi l'ha scritto.
- **Contorno:** i vertici di `getStroke` si arrotondano ai centesimi con la
  regola di §7, e due vertici consecutivi uguali contano una volta. Il
  percorso comincia con `M` sul punto medio fra l'ultimo vertice e il primo,
  prosegue con `Q` vertice e punto medio successivo per ogni vertice, e si
  chiude con `Z`. I punti medi si calcolano sugli interi arrotondati, con
  `floor((a + b + 1) / 2)`. Sotto i tre vertici distinti `d` è vuoto.
- **Riempimento:** il contorno di un tratto breve si sovrappone a sé stesso,
  quindi si riempie con la regola `nonzero`, quella predefinita di SVG.
- **Motori diversi:** le funzioni di `Math` possono differire nell'ultima
  cifra binaria fra motori JavaScript: `d` lo ricalcola chi possiede il
  documento, e nessuno confronta i `d` calcolati da motori diversi.

Chi non conosce l'algoritmo usa `d` così com'è. `d` si riscrive solo quando
cambiano `fub:ink` o `fub:brush`: spostare, scalare o ruotare tocca `transform`.

## `fub:at`

Istante d'inizio del tratto in ISO 8601 UTC con i millisecondi. È facoltativo:
si scrive per default e si può disattivare. Serve a riprodurre l'ordine e il
ritmo della scrittura. Un tratto scritto su un altro dispositivo porta l'ora
dell'orologio di chi possiede il documento, corretta con lo scarto stimato.
