// Disease variants (precomputed by scripts/fetch_variants.py into data/variants/).
(function (AFX) {
  AFX.VARIANT_CLASSES = [
    { key: 'pathogenic', label: 'Pathogenic' },
    { key: 'benign', label: 'Benign' },
  ];

  // Returns null when no precomputed file exists for this protein (or when opened via file://).
  AFX.fetchVariants = async function (accession) {
    try {
      const res = await fetch(`data/variants/${accession}.json`);
      if (!res.ok) return null;
      const doc = await res.json();
      return { ...doc, byPos: groupByPosition(doc.variants) };
    } catch {
      return null;
    }
  };

  // One entry per residue: several different substitutions can hit the same position.
  function groupByPosition(variants) {
    const byPos = new Map();
    for (const v of variants) {
      let p = byPos.get(v.pos);
      if (!p) byPos.set(v.pos, p = { pos: v.pos, subs: [], pathogenic: 0, benign: 0 });
      p.subs.push(v);
      p[v.class]++;
    }
    return byPos;
  }

  // Positions to draw for a display mode, each with the class it's drawn as.
  // In "both" mode a residue with any pathogenic substitution is drawn as pathogenic.
  AFX.visibleVariantPositions = function (variants, mode) {
    if (!variants || mode === 'off') return [];
    const out = [];
    for (const p of variants.byPos.values()) {
      const show = mode === 'both' ? (p.pathogenic ? 'pathogenic' : 'benign')
        : p[mode] ? mode : null;
      if (show) out.push({ ...p, show, count: p[show] });
    }
    return out;
  };

  AFX.variantTooltipRows = function (p) {
    const MAX = 6;
    const rows = p.subs.slice(0, MAX).map(v => {
      const disease = v.diseases.find(d => !/hereditary cancer-predisposing/i.test(d)) || v.diseases[0] || '';
      return `
        <div class="tt-variant">
          <span class="variant-dot ${v.class}"></span>
          <b>${v.from}${v.pos}${v.to}</b>
          <span>${v.significance.join(', ')}</span>
          ${disease ? `<span class="tt-disease">${disease}</span>` : ''}
        </div>`;
    }).join('');
    const more = p.subs.length > MAX ? `<div class="tt-note">+ ${p.subs.length - MAX} more substitutions</div>` : '';
    return `<div class="tt-section">Known variants (ClinVar)</div>${rows}${more}`;
  };
})(window.AFX);
