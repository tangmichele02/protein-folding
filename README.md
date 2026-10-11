# alphafold-explorer

Interactive explorer for AlphaFold-predicted protein structures: a pLDDT-colored 3D view,
a PAE heatmap, and a pLDDT sequence plot, all linked by hover and selection.

## Run

No build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
# → http://localhost:8000/#P69905
```

(Opening `index.html` directly also works in most browsers.) The URL hash is the
UniProt ID, so links like `#P04637` are shareable.

## Layout

| File | Role |
|---|---|
| `js/api.js` | AlphaFold DB API: metadata → structure + PAE URLs (never hardcoded versions) |
| `js/structure.js` | 3Dmol.js viewer: pLDDT cartoon (from the B-factor column), hover markers, selection |
| `js/pae.js` | PAE heatmap: canvas image (mean-pooled to ≤1000 px for large proteins) + SVG overlay |
| `js/plddt.js` | pLDDT line plot along the sequence |
| `js/app.js` | Loading, shared hover/selection state, linking |
| `js/theme.js` | Color tokens (read from CSS), pLDDT bands, tooltip helpers |

## Interactions

- Hover a PAE cell (i, j) → both residues marked in 3D with a dashed line between them, plus the sequence plot
- Drag a rectangle on the PAE → aligned (violet) and scored (pink) ranges highlighted everywhere
- Hover a residue in 3D or on the sequence plot → its row/column crosshair on the PAE
- Drag on the sequence plot → select a range · `Esc` clears

## Notes

- The prediction API also returns isoforms (e.g. `P38398-2`); the canonical entry is picked by exact accession match.
- Very large proteins (e.g. titin, Q8WZ42) aren't in AlphaFold DB; the API returns 404 and the app says so.
