# Marcuzzo, il logo di Fub

Il gufo che esce da una cartella, disegnato dall'utente (D26). PA T49 lo
porta nel codice dopo D28 (lo strumento e la licenza). Fino ad allora questi
file servono al piano e al simulatore, e non hanno ancora una licenza
scritta.

| File | Che cos'è | Dove va |
|---|---|---|
| `originali/marcuzzo-smeraldo.svg`, `-menta.svg`, `-kraft.svg` | i tre file dell'utente, come li ha caricati | `assets/logo/originali/`; Smeraldo è l'icona del sistema (scelta del pianificatore, si cambia) |
| `marcuzzo.svg` | la forma intera: classi `logo-*`, coordinate intere, il riquadro stretto attorno al disegno | le Informazioni (48 px), l'avvio (56 px), l'icona grande |
| `marcuzzo-24.svg` | la forma minima per 24 e 32 px: niente dettagli minuti; l'occhio, la pupilla, l'occhiolino e il becco restano quelli del disegno, senza ingrandimenti | il marchio della barra, le icone 24 e 32 |
| `marcuzzo-16.svg` | la forma minima per 16 px: in più via il riflesso dell'occhio e le strisce dei fogli sopra la testa | l'icona 16 |
| `marcuzzo-simbolico.svg` | un colore solo, un path pieno con la regola pari-dispari: le facce e l'iride sono buchi, un filo vuoto stacca la cartella davanti | il livello monocromo di Android, l'icona simbolica di Linux |
| `misure.json` | i colori della cartella e i loro contrasti per gli otto campioni della tinta e i tre temi d'esempio, nelle due luci e nei due contrasti | i valori attesi dai test di PA T49 |

## I colori

Il gufo ha colori fissi: sono gli attributi `fill` del disegno. La cartella
e i due fogli no: hanno le classi `logo-cartella`, `logo-cartella-retro`,
`logo-cartella-ombra`, `logo-foglio-1` e `logo-foglio-2`, e la pelle le
colora con i gettoni `--logo-*` della tinta o del tema. I `fill` delle forme
sono quelli di Smeraldo, il ripiego quando i gettoni mancano.

`logoColors()` della ricetta (in `script/finto/verde.patch`) fa i gettoni
dalla tinta. La scala viene dai file dell'utente: Smeraldo di giorno, Menta
di notte. La cartella e il retro reggono la soglia dei controlli (3, o 4,5
col contrasto alto) contro i due fondi dove sta il logo: `--bg` (la barra e
l'avvio) e `--bg-elev` (le Informazioni). D26 nel piano ha la tabella.

## Rifarle

Dalla cartella `PLAN-ui/fub-pre-alpha/script/`, con l'originale Smeraldo:

```bash
O=../logo/originali/marcuzzo-smeraldo.svg
python3 logo-forme.py "$O" ../logo/marcuzzo.svg /tmp/marcuzzo.inline.txt "brand-logo marcuzzo"
python3 logo-minima.py "$O" /tmp/min24.svg 24
python3 logo-forme.py /tmp/min24.svg ../logo/marcuzzo-24.svg /tmp/marcuzzo-24.inline.txt "brand-logo marcuzzo"
python3 logo-minima.py "$O" /tmp/min16.svg 16
python3 logo-forme.py /tmp/min16.svg ../logo/marcuzzo-16.svg /tmp/marcuzzo-16.inline.txt "brand-logo marcuzzo"
node logo-simbolico.mjs ../logo/marcuzzo-24.svg ../logo/marcuzzo-simbolico.svg
```

I `.inline.txt` sono la stessa forma senza `<title>`, pronta per andare in
linea (le toppe del finto la usano). Senza cambi, ogni comando riscrive gli
stessi byte. `logo-simbolico.mjs` disegna la maschera in una tela di
Chromium: prende Playwright dal client di `FUB_CLIENT`, come gli altri
script del browser (`script/client.mjs`).

I colori dei temi e le misure vengono dal client delle catture (la ricetta
di `verde.patch`):

```bash
node logo-temi.mjs <client> ../blocchi <cacheDir>
node logo-misure.mjs <client> ../blocchi <cacheDir> ../logo/misure.json
```
