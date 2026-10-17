# Materiale di terzi

Questo file raccoglie gli avvisi di copyright e i testi di licenza del codice
di terzi da cui Fub deriva. Le dipendenze dichiarate nei manifest
(`Cargo.toml`, `package.json`) non stanno qui: le governano `deny.toml` e lo
SBOM.

## Stabilizzatore del tratto

Derivato da codice di PhotoCraft, distribuito sotto `MIT OR Apache-2.0`; Fub
lo usa sotto la licenza MIT.

- Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors.
- File derivati in Fub: `crates/fub-ink/src/stabilizer.rs` e
  `apps/client/src/ink/input/stabilizer.ts`.

```text
MIT License

Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Anteprima incrementale del tratto

Derivata da perfect-freehand 1.2.3, distribuito sotto licenza MIT. Il
pacchetto è anche una dipendenza dichiarata del client; l'avviso sta qui perché
Fub ne ripete i due passi del contorno in forma incrementale.

- Copyright (c) 2021 Stephen Ruiz Ltd.
- File derivato in Fub: `apps/client/src/ink/pf1-live.ts`.

```text
MIT License

Copyright (c) 2021 Stephen Ruiz Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
