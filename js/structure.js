// 3D structure view (3Dmol.js): pLDDT-colored cartoon, hover markers, range selection.
(function (AFX) {
  class StructureView {
    constructor(el, { onHover, onUnhover }) {
      this.el = el;
      this.viewer = $3Dmol.createViewer(el, { backgroundColor: AFX.color('surface'), antialias: true });
      this.residues = [];
      this.byResi = new Map();
      this.shapes = [];
      this.selection = null;
      this.variants = [];
      this.mouse = { x: 0, y: 0 };
      this.onHover = onHover;
      this.onUnhover = onUnhover;

      el.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
      el.addEventListener('mouseleave', () => this.onUnhover());
      new ResizeObserver(() => {
        if (!el.clientWidth) return;   // hidden (e.g. error state): don't render to a 0×0 canvas
        this.viewer.resize();
        this.viewer.render();
      }).observe(el);
    }

    load({ text, format }) {
      const v = this.viewer;
      v.clear();
      this.shapes = [];
      this.selection = null;
      this.variants = [];
      this.model = v.addModel(text, format);

      // pLDDT lives in the B-factor column; one value per residue, repeated on every atom.
      this.residues = this.model.selectedAtoms({ atom: 'CA' }).map(a => ({
        resi: a.resi, resn: a.resn, plddt: a.b, ca: { x: a.x, y: a.y, z: a.z },
      }));
      this.byResi = new Map(this.residues.map(r => [r.resi, r]));

      this.applyColors();
      v.setHoverDuration?.(16);
      v.setHoverable({}, true,
        atom => {
          const r = this.byResi.get(atom.resi);
          if (r) this.onHover(r, this.mouse);
        },
        () => this.onUnhover());
      v.zoomTo();
      v.render();
      return this.residues;
    }

    applyColors() {
      const sel = this.selection;
      const showVariants = this.variants.length > 0;
      let colorfunc;
      if (!sel) {
        // With variants on, wash the pLDDT ribbon toward the background so the spheres lead.
        const base = AFX.plddtColorFn();
        const surface = AFX.color('surface');
        // Washing toward a dark surface darkens, so dark mode needs a lighter touch.
        const mute = getComputedStyle(document.documentElement).colorScheme === 'dark' ? 0.3 : 0.55;
        const muted = new Map();
        const plddtColor = !showVariants ? base : v => {
          const c = base(v);
          if (!muted.has(c)) muted.set(c, d3.interpolateRgb(c, surface)(mute));
          return muted.get(c);
        };
        colorfunc = atom => plddtColor(atom.b);
      } else {
        const a = AFX.color('sel-a'), b = AFX.color('sel-b'), dim = AFX.color('dimmed');
        const inA = r => r >= sel.a[0] && r <= sel.a[1];
        const inB = r => r >= sel.b[0] && r <= sel.b[1];
        colorfunc = atom => inA(atom.resi) ? a : inB(atom.resi) ? b : dim;
      }
      this.viewer.setStyle({}, { cartoon: { colorfunc, arrows: true } });
      this.applyVariantStyle();
    }

    // Variant spheres sit on the side chain's first carbon (Cβ), which points the way the
    // side chain does: outward on surface residues, inward on buried ones. Glycine has no
    // side chain, so it uses the backbone Cα. Atom styles (not shapes) keep this fast and hoverable.
    applyVariantStyle() {
      if (!this.variants.length) return;
      const radius = n => (n >= 4 ? 1.7 : n >= 2 ? 1.35 : 1.05);
      const groups = new Map();
      for (const p of this.variants) {
        const r = this.byResi.get(p.pos);
        if (!r) continue;
        const key = `${p.show}|${radius(p.count)}|${r.resn === 'GLY' ? 'CA' : 'CB'}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p.pos);
      }
      for (const [key, resi] of groups) {
        const [cls, rad, atom] = key.split('|');
        this.viewer.addStyle({ resi, atom }, { sphere: { radius: +rad, color: AFX.color(`var-${cls}`) } });
      }
    }

    setVariants(positions) {
      this.variants = positions;
      this.applyColors();
      this.viewer.render();
    }

    setSelection(sel) {
      this.selection = sel;
      this.applyColors();
      this.viewer.render();
    }

    zoomToSelection() {
      if (!this.selection) return this.viewer.zoomTo({}, 600);
      const { a, b } = this.selection;
      this.viewer.zoomTo({ resi: [`${a[0]}-${a[1]}`, `${b[0]}-${b[1]}`] }, 600);
    }

    clearShapes() {
      for (const s of this.shapes) this.viewer.removeShape(s);
      this.shapes = [];
    }

    // hover: null | { type: 'residue', i } | { type: 'pair', i, j }  (i = aligned, j = scored)
    setHover(hover) {
      const v = this.viewer;
      this.clearShapes();
      if (hover) {
        const marker = AFX.color('marker');
        const ri = this.byResi.get(hover.i);
        if (hover.type === 'residue' && ri) {
          this.shapes.push(v.addSphere({ center: ri.ca, radius: 1.5, color: marker }));
          this.shapes.push(v.addSphere({ center: ri.ca, radius: 3.2, color: marker, opacity: 0.18 }));
        } else if (hover.type === 'pair') {
          const rj = this.byResi.get(hover.j);
          if (ri && rj) {
            this.shapes.push(v.addSphere({ center: ri.ca, radius: 1.6, color: AFX.color('sel-a') }));
            this.shapes.push(v.addSphere({ center: rj.ca, radius: 1.6, color: AFX.color('sel-b') }));
            if (hover.i !== hover.j) {
              this.shapes.push(v.addCylinder({
                start: ri.ca, end: rj.ca, radius: 0.22, color: marker,
                dashed: true, dashLength: 0.9, gapLength: 0.6, fromCap: 1, toCap: 1,
              }));
            }
          }
        }
      }
      v.render();
    }

    distance(i, j) {
      const a = this.byResi.get(i)?.ca, b = this.byResi.get(j)?.ca;
      if (!a || !b) return null;
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    updateTheme() {
      this.viewer.setBackgroundColor(AFX.color('surface'));
      if (this.model) this.applyColors();
      this.viewer.render();
    }
  }

  AFX.StructureView = StructureView;
})(window.AFX);
