// pLDDT line plot along the sequence, segment-colored by confidence band.
(function (AFX) {
  const BASE = { top: 10, right: 16, bottom: 28, left: 40 };
  const LANE = 13;          // height per variant lane (8px ticks + 5px gap)

  class PLDDTView {
    constructor(container, { onHover, onUnhover, onSelect }) {
      this.container = container;
      this.onHover = onHover; this.onUnhover = onUnhover; this.onSelect = onSelect;
      this.svg = d3.select(container).append('svg');
      this.root = this.svg.append('g');
      this.gBands = this.root.append('g');
      this.gAxes = this.root.append('g');
      this.gSel = this.root.append('g');
      this.gLine = this.root.append('g');
      this.gRug = this.root.append('g');
      this.gHover = this.root.append('g');
      this.gBrush = this.root.append('g').attr('class', 'brush');
      this.brush = d3.brushX().on('end', e => this.brushEnd(e));
      this.svg
        .on('mousemove', e => this.mouseMove(e))
        .on('mouseleave', () => this.onUnhover());
      this.residues = [];
      this.variants = null; this.mode = 'off';
      this.m = BASE;
      new ResizeObserver(() => this.render()).observe(container);
    }

    load(residues) {
      this.residues = residues;
      this.byResi = new Map(residues.map(r => [r.resi, r]));
      this.hover = null; this.selection = null;
      this.render();
    }

    setVariants(variants, mode) {
      this.variants = variants; this.mode = mode;
      this.render();
    }

    lanes() {
      if (!this.variants || this.mode === 'off') return [];
      return AFX.VARIANT_CLASSES.filter(c => this.mode === 'both' || this.mode === c.key);
    }

    render() {
      if (!this.residues.length) return;
      const lanes = this.lanes();
      const M = this.m = lanes.length
        ? { ...BASE, top: BASE.top + lanes.length * LANE + 12, left: 76 }
        : BASE;
      const { width, height } = this.container.getBoundingClientRect();
      const w = width - M.left - M.right, h = height - M.top - M.bottom;
      if (w <= 0 || h <= 0) return;
      this.w = w; this.h = h;
      const first = this.residues[0].resi, last = this.residues[this.residues.length - 1].resi;
      this.x = d3.scaleLinear().domain([first - 0.5, last + 0.5]).range([0, w]);
      this.y = d3.scaleLinear().domain([0, 100]).range([h, 0]);
      this.root.attr('transform', `translate(${M.left},${M.top})`);

      // Confidence bands as faint backgrounds, so the line reads against the thresholds.
      const bands = [[90, 100, 'vh'], [70, 90, 'h'], [50, 70, 'l'], [0, 50, 'vl']];
      this.gBands.selectAll('*').remove();
      for (const [lo, hi, key] of bands) {
        this.gBands.append('rect').attr('x', 0).attr('width', w)
          .attr('y', this.y(hi)).attr('height', this.y(lo) - this.y(hi))
          .attr('fill', AFX.color(`plddt-${key}`)).attr('fill-opacity', 0.07);
      }
      for (const t of [50, 70, 90]) {
        this.gBands.append('line').attr('class', 'gridline').attr('x1', 0).attr('x2', w)
          .attr('y1', this.y(t)).attr('y2', this.y(t)).attr('stroke-dasharray', '2 3');
      }

      this.gAxes.selectAll('*').remove();
      this.gAxes.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(this.x).ticks(Math.max(4, Math.floor(w / 80))).tickFormat(d3.format('d')).tickSize(3));
      this.gAxes.append('g').attr('class', 'axis')
        .call(d3.axisLeft(this.y).tickValues([0, 50, 70, 90, 100]).tickSize(3))
        .call(g => g.select('.domain').remove());
      this.gAxes.append('text').attr('class', 'axis-title').attr('x', w).attr('y', h + 26)
        .attr('text-anchor', 'end').text('Residue');

      // Line, split into runs of the same band. Each run extends to the next run's first point so segments join.
      const color = AFX.plddtColorFn();
      const line = d3.line().x(r => this.x(r.resi)).y(r => this.y(r.plddt)).curve(d3.curveMonotoneX);
      const runs = [];
      let cur = null;
      for (const r of this.residues) {
        const c = color(r.plddt);
        if (cur && cur.c === c) { cur.pts.push(r); continue; }
        if (cur) cur.pts.push(r);
        cur = { c, pts: [r] };
        runs.push(cur);
      }
      this.gLine.selectAll('*').remove();
      this.gLine.selectAll('path').data(runs).join('path')
        .attr('d', d => line(d.pts)).attr('fill', 'none').attr('stroke', d => d.c)
        .attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');

      this.drawRug(lanes);

      this.brush.extent([[0, 0], [w, h]]);
      this.gBrush.call(this.brush);
      this.gBrush.select('.overlay').attr('cursor', 'crosshair');

      this.drawSelection();
      this.drawHover();
    }

    // One lane of ticks per visible class, above the plot. Every position with at least one
    // substitution of that class gets a tick, so mixed positions appear in both lanes.
    drawRug(lanes) {
      this.gRug.selectAll('*').remove();
      if (!lanes.length) return;
      const tickW = Math.max(1.5, this.x(2) - this.x(1) - 0.5);
      lanes.forEach((c, k) => {
        const y = -(lanes.length - k) * LANE - 12;
        const g = this.gRug.append('g').attr('transform', `translate(0,${y})`);
        g.append('text').attr('class', 'threshold-label').attr('x', -8).attr('y', 7)
          .attr('text-anchor', 'end').text(c.label);
        const pos = [...this.variants.byPos.values()].filter(p => p[c.key] > 0);
        g.selectAll('rect').data(pos).join('rect')
          .attr('x', p => this.x(p.pos) - tickW / 2).attr('width', tickW)
          .attr('y', 0).attr('height', 8).attr('rx', 0.5)
          .attr('fill', AFX.color(`var-${c.key}`));
      });
    }

    residueAt(px) {
      const r = Math.round(this.x.invert(px));
      const [lo, hi] = this.x.domain();
      return Math.max(Math.ceil(lo), Math.min(Math.floor(hi), r));
    }

    mouseMove(e) {
      if (!this.x) return;
      const [px, py] = d3.pointer(e, this.gBrush.node());
      if (px < 0 || px > this.w || py < -this.m.top || py > this.h) return this.onUnhover();
      const res = this.byResi.get(this.residueAt(px));
      if (res) this.onHover({ type: 'residue', i: res.resi }, e);
    }

    brushEnd(e) {
      if (!e.sourceEvent) return;
      if (!e.selection) return this.onSelect(null);
      const [x0, x1] = e.selection;
      const r0 = this.residueAt(x0), r1 = this.residueAt(x1);
      this.gBrush.call(this.brush.move, null);
      this.onSelect({ a: [r0, r1], b: [r0, r1] });
    }

    setSelection(sel) { this.selection = sel; this.drawSelection(); }
    setHover(h) { this.hover = h; this.drawHover(); }

    drawSelection() {
      this.gSel.selectAll('*').remove();
      const sel = this.selection;
      if (!sel || !this.x) return;
      const same = sel.a[0] === sel.b[0] && sel.a[1] === sel.b[1];
      const ranges = same ? [[sel.a, 'sel-a']] : [[sel.a, 'sel-a'], [sel.b, 'sel-b']];
      for (const [[s, t], key] of ranges) {
        this.gSel.append('rect')
          .attr('x', this.x(s - 0.5)).attr('width', this.x(t + 0.5) - this.x(s - 0.5))
          .attr('y', 0).attr('height', this.h)
          .attr('fill', AFX.color(key)).attr('fill-opacity', 0.14);
        this.gSel.append('rect')
          .attr('x', this.x(s - 0.5)).attr('width', this.x(t + 0.5) - this.x(s - 0.5))
          .attr('y', this.h - 3).attr('height', 3).attr('fill', AFX.color(key));
      }
    }

    drawHover() {
      this.gHover.selectAll('*').remove();
      const h = this.hover;
      if (!h || !this.x) return;
      const marks = h.type === 'pair'
        ? [[h.i, AFX.color('sel-a')], [h.j, AFX.color('sel-b')]]
        : [[h.i, AFX.color('text')]];
      for (const [resi, c] of marks) {
        const r = this.byResi.get(resi);
        if (!r) continue;
        const x = this.x(r.resi), y = this.y(r.plddt);
        this.gHover.append('line').attr('class', 'crosshair-soft').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', this.h);
        this.gHover.append('circle').attr('cx', x).attr('cy', y).attr('r', 4.5)
          .attr('fill', c).attr('stroke', AFX.color('surface')).attr('stroke-width', 2).style('pointer-events', 'none');
      }
    }

    updateTheme() { this.render(); }
  }

  AFX.PLDDTView = PLDDTView;
})(window.AFX);
