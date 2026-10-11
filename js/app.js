// App controller: loading, shared hover/selection state, and linking between the three views.
(function (AFX) {
  const $ = id => document.getElementById(id);
  const DEFAULT_ID = 'P69905';

  const state = { entry: null, residues: [], byResi: new Map(), pae: null, hover: null, selection: null, token: 0 };
  let views = null;

  // Views are created on first load: 3Dmol needs a visible, sized container.
  function ensureViews() {
    if (views) return views;
    views = {
      structure: new AFX.StructureView($('viewer'), {
        onHover: (res, mouse) => setHover({ type: 'residue', i: res.resi }, mouse),
        onUnhover: () => setHover(null),
      }),
      pae: new AFX.PAEView($('pae'), {
        onHover: (h, e) => setHover(h, e),
        onUnhover: () => setHover(null),
        onSelect: sel => setSelection(sel),
      }),
      plddt: new AFX.PLDDTView($('plddt'), {
        onHover: (h, e) => setHover(h, e),
        onUnhover: () => setHover(null),
        onSelect: sel => setSelection(sel),
      }),
    };
    return views;
  }

  // ---------- Linked state ----------
  let frame = null, pending = null;
  function setHover(h, mouse) {
    pending = { h, mouse };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const { h, mouse } = pending;
      const same = JSON.stringify(h) === JSON.stringify(state.hover);
      state.hover = h;
      if (!same) {
        views.structure.setHover(h);
        views.pae.setHover(h);
        views.plddt.setHover(h);
      }
      if (h && mouse) AFX.showTooltip(tooltipFor(h), mouse.clientX ?? mouse.x, mouse.clientY ?? mouse.y);
      else AFX.hideTooltip();
    });
  }

  function tooltipFor(h) {
    const ri = state.byResi.get(h.i);
    if (h.type === 'residue') return ri ? AFX.residueTooltip(ri) : '';

    const rj = state.byResi.get(h.j);
    const pae = views.pae.value(h.i, h.j);
    const dist = views.structure.distance(h.i, h.j);
    const label = r => r ? `${AFX.aaShort(r.resn)}${r.resi}` : '?';
    const verdict = pae < 5 ? 'Relative position is reliable'
      : pae < 15 ? 'Relative position is roughly right'
      : 'Relative position is essentially unknown';
    return `
      <div class="tt-title">
        <span class="swatch" style="background:${AFX.color('sel-a')}"></span>${label(ri)}
        <span class="muted">→</span>
        <span class="swatch" style="background:${AFX.color('sel-b')}"></span>${label(rj)}
      </div>
      <div class="tt-row"><span>Expected error</span><b>${pae.toFixed(1)} Å</b></div>
      ${dist != null ? `<div class="tt-row"><span>Cα distance</span><b>${dist.toFixed(1)} Å</b></div>` : ''}
      ${ri && rj ? `<div class="tt-row"><span>pLDDT</span><b>${ri.plddt.toFixed(0)} / ${rj.plddt.toFixed(0)}</b></div>` : ''}
      <div class="tt-note">${verdict}. Aligned on ${label(ri)}, scoring ${label(rj)}.</div>`;
  }

  function setSelection(sel) {
    if (sel) {
      const order = ([s, t]) => [Math.min(s, t), Math.max(s, t)];
      sel = { a: order(sel.a), b: order(sel.b) };
    }
    state.selection = sel;
    views.structure.setSelection(sel);
    views.pae.setSelection(sel);
    views.plddt.setSelection(sel);
    renderSelectionChip();
  }

  function renderSelectionChip() {
    const chip = $('selection-chip');
    const sel = state.selection;
    chip.hidden = !sel;
    if (!sel) return;
    const range = ([s, t]) => s === t ? `${s}` : `${s}–${t}`;
    const sw = key => `<span class="swatch" style="background:${AFX.color(key)}"></span>`;
    const same = sel.a[0] === sel.b[0] && sel.a[1] === sel.b[1];
    chip.innerHTML = `
      <span class="legend-item">${sw('sel-a')}${range(sel.a)}</span>
      ${same ? '' : `<span class="legend-item">${sw('sel-b')}${range(sel.b)}</span>`}
      <button data-act="zoom">Zoom to</button><button data-act="clear">Clear</button>`;
  }

  $('selection-chip').addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act === 'zoom') views.structure.zoomToSelection();
    if (act === 'clear') { setSelection(null); views.structure.zoomToSelection(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.selection) setSelection(null);
  });

  // ---------- Status / summary ----------
  function showStatus(kind, title, detail = '') {
    const el = $('status');
    el.className = `status ${kind}`;
    el.innerHTML = kind === 'loading'
      ? `<div class="spinner"></div><div class="status-title">${title}</div><div>${detail}</div>`
      : `<div class="status-title">${title}</div><div>${detail}</div>`;
  }
  const clearStatus = () => { $('status').innerHTML = ''; };

  function renderSummary(entry, residues) {
    $('protein-name').textContent = entry.uniprotDescription || entry.uniprotAccession;
    const version = entry.latestVersion ? ` · model v${entry.latestVersion}` : '';
    $('protein-meta').innerHTML = [
      entry.gene && `<b>${entry.gene}</b>`,
      entry.organismScientificName && `<i>${entry.organismScientificName}</i>`,
      `<a href="https://www.uniprot.org/uniprotkb/${entry.uniprotAccession}" target="_blank" rel="noopener">UniProt ${entry.uniprotAccession} ↗</a>`,
      `<a href="https://alphafold.ebi.ac.uk/entry/${entry.uniprotAccession}" target="_blank" rel="noopener">AlphaFold DB ↗</a>${version}`,
    ].filter(Boolean).join(' · ');

    const n = residues.length;
    $('stat-length').textContent = n.toLocaleString();
    $('stat-plddt').textContent = d3.mean(residues, r => r.plddt).toFixed(1);

    const counts = AFX.PLDDT_BANDS.map(b => ({ b, k: residues.filter(r => AFX.plddtBand(r.plddt) === b).length }));
    const bar = $('stat-bar');
    bar.innerHTML = counts.filter(c => c.k > 0).map(({ b, k }) =>
      `<span style="flex:${k};background:var(--plddt-${b.key})" title="${b.label} (${b.range}): ${k} residues, ${(100 * k / n).toFixed(0)}%"></span>`).join('');
    bar.setAttribute('aria-label', counts.map(({ b, k }) => `${b.label}: ${k}`).join(', '));
    $('summary').hidden = false;
  }

  function renderPlddtLegend() {
    $('plddt-legend').innerHTML = AFX.PLDDT_BANDS.map(b =>
      `<span class="legend-item"><span class="swatch" style="background:var(--plddt-${b.key})"></span>${b.label} <span style="color:var(--text-3)">${b.range}</span></span>`).join('');
  }

  // ---------- Loading ----------
  async function load(raw) {
    const id = AFX.normalizeId(raw);
    $('search-input').value = id;
    document.querySelectorAll('.examples button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
    if (!id) return;
    if (!AFX.isAccession(id)) {
      return showStatus('error', `"${id}" doesn't look like a UniProt accession`,
        'UniProt IDs are 6 or 10 characters, like P69905 or A0A0B4J2F0.');
    }
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);

    const token = ++state.token;
    const stale = () => token !== state.token;
    AFX.hideTooltip();
    showStatus('loading', `Loading ${id}`, 'Fetching prediction metadata…');

    try {
      const entry = await AFX.fetchEntry(id);
      if (stale()) return;
      const len = entry.uniprotEnd || entry.sequence?.length || 0;
      showStatus('loading', entry.uniprotDescription || id,
        `Downloading structure and ${len ? `${len.toLocaleString()}×${len.toLocaleString()} ` : ''}error matrix…`);

      const [structure, pae] = await Promise.allSettled([AFX.fetchStructure(entry), AFX.fetchPAE(entry)]);
      if (stale()) return;
      if (structure.status === 'rejected') throw structure.reason;

      clearStatus();
      $('workspace').hidden = false;
      const v = ensureViews();
      state.entry = entry;
      state.hover = null;
      state.selection = null;
      renderSelectionChip();

      state.residues = v.structure.load(structure.value);
      state.byResi = new Map(state.residues.map(r => [r.resi, r]));
      renderSummary(entry, state.residues);
      v.plddt.load(state.residues);

      if (pae.status === 'fulfilled') {
        state.pae = pae.value;
        v.pae.load(pae.value);
        AFX.renderPAELegend($('pae-legend'), pae.value.max);
        const k = v.pae.binSize;
        $('pae-note').textContent = k > 1
          ? `${pae.value.n.toLocaleString()} residues · each pixel averages ${k}×${k} residue pairs`
          : '';
      } else {
        state.pae = null;
        v.pae.load(null);
        $('pae-legend').innerHTML = '';
        $('pae-note').textContent = pae.reason?.title || 'PAE unavailable';
      }
    } catch (err) {
      if (stale()) return;
      console.error(err);
      $('workspace').hidden = true;
      $('summary').hidden = true;
      showStatus('error', err.title || 'Something went wrong', err.detail || err.message);
    }
  }

  // ---------- Wiring ----------
  $('search').addEventListener('submit', e => { e.preventDefault(); load($('search-input').value); });
  document.querySelector('.examples').addEventListener('click', e => {
    if (e.target.dataset.id) load(e.target.dataset.id);
  });
  window.addEventListener('hashchange', () => load(location.hash.slice(1)));

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!views) return;
    views.structure.updateTheme();
    views.pae.updateTheme();
    views.plddt.updateTheme();
    if (state.pae) AFX.renderPAELegend($('pae-legend'), state.pae.max);
    renderSelectionChip();
  });

  renderPlddtLegend();
  load(location.hash.slice(1) || DEFAULT_ID);
})(window.AFX);
