"""Forme piccole del Marcuzzo dal disegno dell'utente: toglie i dettagli minuti
e ingrandisce ciò che deve restare leggibile (l'occhio aperto, la pupilla,
l'occhiolino, il becco). python3 logo-minima.py <in.svg> <out.svg> <misura: 24|16>"""
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

def scaled(p, cx, cy, k):
    return f'<g transform="translate({cx} {cy}) scale({k}) translate({-cx} {-cy})">{p}</g>'

out_paths = []
for i, p in enumerate(paths, 1):
    if i in drop:
        continue
    if i == 17:  # l'iride gialla
        k = 1.12 if size > 16 else 1.18
        p = scaled(p, 355.2, 453.7, k)
    elif i == 18:  # la pupilla
        k = 1.3 if size > 16 else 1.5
        p = scaled(p, 390.8, 438.1, k)
    elif i == 19:  # la luce nella pupilla, segue la pupilla
        p = scaled(p, 390.8, 438.1, 1.3)
    elif i == 13:  # l'occhiolino: un tratto più spesso dello stesso colore
        w = 26 if size > 16 else 44
        p = p.replace('stroke-width="1.5"', f'stroke-width="{w}"')
    elif i == 23:  # il becco
        k = 1.1 if size > 16 else 1.25
        p = scaled(p, 486, 598, k)
    out_paths.append('    ' + p)

head = t[: t.index('<g class="marcuzzo">') + len('<g class="marcuzzo">')]
res = head + '\n' + '\n'.join(out_paths) + '\n  </g>\n</svg>\n'
open(out, 'w').write(res)
print(out, len(res))
