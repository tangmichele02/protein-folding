// PAE heatmap: canvas image (downsampled for large proteins) + SVG overlay for axes,
// crosshairs, selection, and brushing. Hover stays residue-exact even when the image is binned.
(function (AFX) {
  const MAX_PIXELS = 1000;                  // image resolution cap per side
  const M = { top: 4, right: 4, bottom: 40, left: 46 };

  class PAEView {
    constructor(container, { onHover, onUnhover, onSelect }) {
      this.container = container;
      this.canvas = container.querySelector('canvas');
      this.svg = d3.select(container.querySelector('svg'));
      this.onHover = onHover; this.onUnhover = onUnhover; this.onSelect = onSelect;
      this.pae = null;
      this.hover = null;
      this.selection = null;

      this.gAxes = this.svg.append('g');
      this.gSel = this.svg.append('g');
      this.gCross = this.svg.append('g');
      this.gBrush = this.svg.append('g').attr('class', 'brush');

      this.brush = d3.brush()
        .on('end', e => this.brushEnd(e));

      this.svg
        .on('mousemove', e => this.mouseMove(e))
        .on('mouseleave', () => this.onUnhover());

      new ResizeObserver(() => this.layout()).observe(container);
    }

    load(pae) {
      this.pae = pae;
      this.hover = null;
      this.selection = null;
      if (!pae) {
        this.canvas.width = this.canvas.height = 0;
        [this.gAxes, this.gSel, this.gCross].forEach(g => g.selectAll('*').remove());
        return;
      }
      this.renderImage();
      this.layout();
    }

    // Mean-pool the N×N matrix into an M×M image (M ≤ MAX_PIXELS) and colorize via a LUT.
    renderImage() {
      const { n, data, max } = this.pae;
      const k = Math.ceil(n / MAX_PIXELS);
      const m = Math.ceil(n / k);
      this.binSize = k;
      const { lut, steps } = AFX.paeLUT(max);
      this.canvas.width = m; this.canvas.height = m;
      const ctx = this.canvas.getContext('2d');
      const img = ctx.createImageData(m, m);
      const px = img.data;

      for (let bi = 0; bi < m; bi++) {
        const i0 = bi * k, i1 = Math.min(n, i0 + k);
        for (let bj = 0; bj < m; bj++) {
          const j0 = bj * k, j1 = Math.min(n, j0 + k);
          let sum = 0, cnt = 0;
          for (let i = i0; i < i1; i++) {
            const row = i * n;
            for (let j = j0; j < j1; j++) { sum += data[row + j]; cnt++; }
          }
          const s = Math.min(steps - 1, Math.round((sum / cnt / max) * (steps - 1))) * 3;
          const o = (bi * m + bj) * 4;
          px[o] = lut[s]; px[o + 1] = lut[s + 1]; px[o + 2] = lut[s + 2]; px[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      // Pixelated scaling keeps cells crisp for small proteins; smooth when binned.
      this.canvas.style.imageRendering = k === 1 ? 'pixelated' : 'auto';
    }

    layout() {
      if (!this.pae) return;
      const { width, height } = this.container.getBoundingClientRect();
      const s = Math.max(50, Math.floor(Math.min(width - M.left - M.right, height - M.top - M.bottom)));
      this.size = s;
      const n = this.pae.n;
      // Residue r occupies [r, r+1) in scale space.
      this.x = d3.scaleLinear().domain([1, n + 1]).range([0, s]);
      this.y = d3.scaleLinear().domain([1, n + 1]).range([0, s]);

      Object.assign(this.canvas.style, { left: `${M.left}px`, top: `${M.top}px`, width: `${s}px`, height: `${s}px` });
      const t = `translate(${M.left},${M.top})`;
      [this.gAxes, this.gSel, this.gCross, this.gBrush].forEach(g => g.attr('transform', t));

      const ticks = this.x.ticks(Math.max(3, Math.floor(s / 70))).filter(v => v >= 1 && v <= n);
      const mid = v => v + 0.5;
      this.gAxes.selectAll('*').remove();
      this.gAxes.append('g').attr('class', 'axis').attr('transform', `translate(0,${s + 4})`)
        .call(d3.axisBottom(d3.scaleLinear().domain(this.x.domain()).range(this.x.range()))
          .tickValues(ticks.map(mid)).tickFormat(v => Math.floor(v)).tickSize(3))
        .call(g => g.select('.domain').remove());
      this.gAxes.append('g').attr('class', 'axis').attr('transform', 'translate(-4,0)')
        .call(d3.axisLeft(this.y).tickValues(ticks.map(mid)).tickFormat(v => Math.floor(v)).tickSize(3))
        .call(g => g.select('.domain').remove());
      this.gAxes.append('text').attr('class', 'axis-title')
        .attr('x', s / 2).attr('y', s + 34).attr('text-anchor', 'middle').text('Scored residue');
      this.gAxes.append('text').attr('class', 'axis-title')
        .attr('transform', `translate(${-36},${s / 2}) rotate(-90)`).attr('text-anchor', 'middle').text('Aligned residue');

      this.brush.extent([[0, 0], [s, s]]);
      this.gBrush.call(this.brush);
      this.gBrush.select('.overlay').attr('cursor', 'crosshair');

      this.drawSelection();
      this.drawHover();
    }

    residueAt(px, py) {
      const n = this.pae.n;
      const clamp = v => Math.max(1, Math.min(n, v));
      return { j: clamp(Math.floor(this.x.invert(px))), i: clamp(Math.floor(this.y.invert(py))) };
    }

    value(i, j) { return this.pae.data[(i - 1) * this.pae.n + (j - 1)]; }

    mouseMove(e) {
      if (!this.pae) return;
      const [px, py] = d3.pointer(e, this.gBrush.node());
      if (px < 0 || py < 0 || px > this.size || py > this.size) return this.onUnhover();
      const { i, j } = this.residueAt(px, py);
      this.onHover({ type: 'pair', i, j }, e);
    }

    brushEnd(e) {
      if (!e.sourceEvent) return;                 // ignore our own programmatic clear
      if (!e.selection) return this.onSelect(null);  // plain click clears
      const [[x0, y0], [x1, y1]] = e.selection;
      const a = this.residueAt(x0, y0), b = this.residueAt(x1 - 0.01, y1 - 0.01);
      this.gBrush.call(this.brush.move, null);
      this.onSelect({ a: [a.i, b.i], b: [a.j, b.j] });
    }

    setSelection(sel) { this.selection = sel; this.drawSelection(); }
    setHover(h) { this.hover = h; this.drawHover(); }

    drawSelection() {
      this.gSel.selectAll('*').remove();
      const sel = this.selection;
      if (!sel || !this.x) return;
      this.gSel.append('rect').attr('class', 'sel-rect')
        .attr('x', this.x(sel.b[0])).attr('width', this.x(sel.b[1] + 1) - this.x(sel.b[0]))
        .attr('y', this.y(sel.a[0])).attr('height', this.y(sel.a[1] + 1) - this.y(sel.a[0]));
    }

    drawHover() {
      this.gCross.selectAll('*').remove();
      const h = this.hover;
      if (!h || !this.x) return;
      const s = this.size;
      const cx = r => this.x(r + 0.5), cy = r => this.y(r + 0.5);
      if (h.type === 'pair') {
        this.gCross.append('line').attr('class', 'crosshair-soft').attr('x1', 0).attr('x2', s).attr('y1', cy(h.i)).attr('y2', cy(h.i));
        this.gCross.append('line').attr('class', 'crosshair-soft').attr('y1', 0).attr('y2', s).attr('x1', cx(h.j)).attr('x2', cx(h.j));
        const w = Math.max(6, this.x(2) - this.x(1));
        // Two-tone marker so it reads on both dark (confident) and light (uncertain) cells.
        for (const [stroke, width] of [['#000', 3.5], ['#fff', 1.5]]) {
          this.gCross.append('rect').attr('fill', 'none').attr('stroke', stroke).attr('stroke-width', width)
            .attr('x', cx(h.j) - w / 2).attr('y', cy(h.i) - w / 2).attr('width', w).attr('height', w).attr('rx', 1.5)
            .style('pointer-events', 'none');
        }
      } else {
        // A single residue's row (aligned on it) and column (scoring it).
        this.gCross.append('line').attr('class', 'crosshair-soft').attr('x1', 0).attr('x2', s).attr('y1', cy(h.i)).attr('y2', cy(h.i));
        this.gCross.append('line').attr('class', 'crosshair-soft').attr('y1', 0).attr('y2', s).attr('x1', cx(h.i)).attr('x2', cx(h.i));
      }
    }

    updateTheme() { if (this.pae) this.renderImage(); }
  }

  AFX.PAEView = PAEView;

  AFX.renderPAELegend = function (el, max) {
    const { scale } = AFX.paeLUT(max);
    const stops = d3.range(0, 1.0001, 0.1).map(t => `${scale(t * max)} ${t * 100}%`).join(',');
    const ticks = [0, 10, 20, 30].filter(v => v <= max + 0.5);
    el.innerHTML = `
      <div class="gradient-legend">
        <span>Expected error</span>
        <div>
          <div class="ramp" style="background:linear-gradient(90deg,${stops})"></div>
          <div class="ticks" style="position:relative;height:13px">
            ${ticks.map(v => `<span style="position:absolute;left:${(v / max) * 100}%;transform:translateX(-${v === 0 ? 0 : 50}%)">${v}</span>`).join('')}
          </div>
        </div>
        <span>Å</span>
      </div>`;
  };
})(window.AFX);
