// Shared namespace, color system, and small helpers.
// Plain scripts (no modules) so the page also works when opened via file://.
window.AFX = window.AFX || {};

(function (AFX) {
  const css = () => getComputedStyle(document.documentElement);

  AFX.color = function (name) {
    return css().getPropertyValue(`--${name}`).trim();
  };

  // pLDDT bands, highest first. Thresholds are AlphaFold's own.
  AFX.PLDDT_BANDS = [
    { key: 'vh', min: 90, label: 'Very high', range: '> 90' },
    { key: 'h',  min: 70, label: 'Confident', range: '70–90' },
    { key: 'l',  min: 50, label: 'Low',       range: '50–70' },
    { key: 'vl', min: 0,  label: 'Very low',  range: '< 50' },
  ];

  AFX.plddtBand = function (v) {
    return AFX.PLDDT_BANDS.find(b => v > b.min || b.min === 0);
  };

  AFX.plddtColor = function (v) {
    return AFX.color(`plddt-${AFX.plddtBand(v).key}`);
  };

  // Cached version for hot paths (3D colorfunc runs once per atom).
  AFX.plddtColorFn = function () {
    const c = Object.fromEntries(AFX.PLDDT_BANDS.map(b => [b.key, AFX.color(`plddt-${b.key}`)]));
    return v => c[AFX.plddtBand(v).key];
  };

  // PAE color lookup table: 0 Å → --pae-lo, max → --pae-hi, through --pae-mid.
  AFX.paeLUT = function (maxPae, steps = 256) {
    const scale = d3.scaleLinear()
      .domain([0, maxPae * 0.35, maxPae])
      .range([AFX.color('pae-lo'), AFX.color('pae-mid'), AFX.color('pae-hi')])
      .interpolate(d3.interpolateLab)
      .clamp(true);
    const lut = new Uint8ClampedArray(steps * 3);
    for (let s = 0; s < steps; s++) {
      const c = d3.rgb(scale((s / (steps - 1)) * maxPae));
      lut[s * 3] = c.r; lut[s * 3 + 1] = c.g; lut[s * 3 + 2] = c.b;
    }
    return { lut, steps, scale };
  };

  AFX.AA = {
    ALA: ['A', 'Alanine'], ARG: ['R', 'Arginine'], ASN: ['N', 'Asparagine'], ASP: ['D', 'Aspartate'],
    CYS: ['C', 'Cysteine'], GLN: ['Q', 'Glutamine'], GLU: ['E', 'Glutamate'], GLY: ['G', 'Glycine'],
    HIS: ['H', 'Histidine'], ILE: ['I', 'Isoleucine'], LEU: ['L', 'Leucine'], LYS: ['K', 'Lysine'],
    MET: ['M', 'Methionine'], PHE: ['F', 'Phenylalanine'], PRO: ['P', 'Proline'], SER: ['S', 'Serine'],
    THR: ['T', 'Threonine'], TRP: ['W', 'Tryptophan'], TYR: ['Y', 'Tyrosine'], VAL: ['V', 'Valine'],
  };
  AFX.aaName = resn => (AFX.AA[resn] || ['?', resn])[1];
  AFX.aaShort = resn => (resn ? resn[0] + resn.slice(1).toLowerCase() : '?');

  // ---- Tooltip ----
  const tip = () => document.getElementById('tooltip');

  AFX.showTooltip = function (html, clientX, clientY) {
    const el = tip();
    el.innerHTML = html;
    el.hidden = false;
    const pad = 14;
    const { width, height } = el.getBoundingClientRect();
    let x = clientX + pad, y = clientY + pad;
    if (x + width > window.innerWidth - 8) x = clientX - width - pad;
    if (y + height > window.innerHeight - 8) y = clientY - height - pad;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  };

  AFX.hideTooltip = function () { tip().hidden = true; };

  AFX.residueTooltip = function (res) {
    const band = AFX.plddtBand(res.plddt);
    return `
      <div class="tt-title"><span class="swatch" style="background:${AFX.plddtColor(res.plddt)}"></span>
        ${AFX.aaShort(res.resn)}${res.resi}</div>
      <div class="tt-row"><span>Amino acid</span><b>${AFX.aaName(res.resn)} (${(AFX.AA[res.resn] || ['?'])[0]})</b></div>
      <div class="tt-row"><span>pLDDT</span><b>${res.plddt.toFixed(1)} · ${band.label}</b></div>`;
  };
})(window.AFX);
