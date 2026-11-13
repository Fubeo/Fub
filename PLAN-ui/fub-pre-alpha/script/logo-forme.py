"""Le forme del Marcuzzo da mettere in linea: classi `logo-*`, coordinate intere,
trasformazioni cotte nei punti, il riquadro stretto attorno al disegno, niente
tratti tranne quelli che disegnano (l'occhiolino delle forme minime).

python3 logo-forme.py <in.svg> <file.svg> <in-linea.txt> <classe dell'svg in linea>
"""
import re
import sys

src, out_file, out_inline, svg_class = sys.argv[1:5]
VIEWBOX = "29 30 968 968"
t = open(src).read()
body = t[t.index('<g class="marcuzzo">') + len('<g class="marcuzzo">'):]

NOMI = {"ombra-cartella": "cartella-ombra"}

def numero(v):
    r = round(v)
    return str(int(r))

def cuoci(d, tr):
    if tr is None:
        f = lambda x, y: (x, y)
    else:
        cx, cy, k = tr
        f = lambda x, y: (cx + k * (x - cx), cy + k * (y - cy))
    parti = re.findall(r'[MCLZ]|-?\d+(?:\.\d+)?', d)
    out = []
    nums = []
    def scarica():
        for i in range(0, len(nums), 2):
            x, y = f(nums[i], nums[i + 1])
            out.append(numero(x))
            out.append(numero(y))
        nums.clear()
    for p in parti:
        if p in 'MCLZ':
            scarica()
            out.append(p)
        else:
            nums.append(float(p))
    scarica()
    # compatto: lettera attaccata al numero, spazio tra numeri, niente spazio prima del meno
    s = ''
    prev = ''
    for tok in out:
        if tok in 'MCLZ':
            s += tok
        elif prev and prev not in 'MCLZ' and not tok.startswith('-'):
            s += ' ' + tok
        else:
            s += tok
        prev = tok
    return s

tr_stack = []
paths = []
for m in re.finditer(r'<g( transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)[^"]*")?>|</g>|<path ([^>]*)/>', body):
    if m.group(0) == '</g>':
        if tr_stack:
            tr_stack.pop()
        continue
    if m.group(0).startswith('<g'):
        tr_stack.append((float(m.group(2)), float(m.group(3)), float(m.group(4))) if m.group(1) else None)
        continue
    a = m.group(5)
    cls = re.search(r'class="([^"]*)"', a).group(1)
    cls = 'logo-' + NOMI.get(cls, cls)
    fill = re.search(r'fill="([^"]*)"', a).group(1)
    sw = re.search(r'stroke-width="([^"]*)"', a)
    tr = next((x for x in reversed(tr_stack) if x), None)
    d = cuoci(re.search(r' d="([^"]*)"', a).group(1), tr)
    extra = ''
    if sw and float(sw.group(1)) > 2:
        extra = f' stroke="{fill}" stroke-width="{numero(float(sw.group(1)))}" stroke-linejoin="round"'
    paths.append(f'<path class="{cls}" fill="{fill}"{extra} d="{d}"/>')

inline = f'<svg class="{svg_class}" viewBox="{VIEWBOX}" aria-hidden="true" focusable="false">' + ''.join(paths) + '</svg>'
open(out_inline, 'w').write(inline)
file = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + VIEWBOX + '">\n  <title>Marcuzzo</title>\n  '
        + '\n  '.join(paths) + '\n</svg>\n')
open(out_file, 'w').write(file)
print(out_file, len(file), 'in linea', len(inline), 'path', len(paths))
