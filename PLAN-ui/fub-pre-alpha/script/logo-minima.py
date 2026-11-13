"""Forme piccole del Marcuzzo dal disegno dell'utente: tolgono i dettagli
minuti e non ingrandiscono niente. L'occhio, la pupilla, l'occhiolino e il
becco restano quelli del disegno (l'utente, 2026-11-07: «non mi piace l'icona
con l'occhio strizzato ingrandito»).
python3 logo-minima.py <in.svg> <out.svg> <misura: 24|16>"""
import re
import sys

src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
t = open(src).read()
paths = [m.group(0).strip() for m in re.finditer(r'<path [^>]*/>', t)]

# indici 1-based tra i path del disegno dell'utente
SHADOWS = {11, 12, 16}
HIGHLIGHT = {19}
BEAK_LIGHT = {24}
DOTS = {25, 26, 27, 28, 34}
FEET = {31, 32, 33, 35, 36, 37}
SLIVERS = {4, 8}  # le due strisce di foglio sopra la testa
drop = SHADOWS | BEAK_LIGHT | DOTS | FEET
if size <= 16:
    drop |= HIGHLIGHT | SLIVERS

out_paths = ['    ' + p for i, p in enumerate(paths, 1) if i not in drop]

head = t[: t.index('<g class="marcuzzo">') + len('<g class="marcuzzo">')]
res = head + '\n' + '\n'.join(out_paths) + '\n  </g>\n</svg>\n'
open(out, 'w').write(res)
print(out, len(res))
