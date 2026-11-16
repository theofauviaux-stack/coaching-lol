// Graphiques SVG interactifs, sans dépendance.
// Chaque point porte data-tip (texte de l'infobulle) et data-game (pour ouvrir le détail de la partie).
(function (root) {
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let uid = 0;

  // points : [{ v, label, tip, id }]
  function lineChart({ points, height = 220, width = 720, target = null, fmt = v => v.toFixed(1), marker = null, markerLabel = '', color = '#c3ec7f', targetLabel = 'objectif', bounds = null }) {
    const pad = { l: 46, r: 16, t: 16, b: 28 };
    const vals = points.map(p => p.v).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const all = vals.slice();
    if (target !== null && target !== undefined) all.push(target);
    if (vals.length < 1) return '<div class="chart-empty">Pas encore assez de parties</div>';
    let min = Math.min(...all), max = Math.max(...all);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min; min -= span * 0.12; max += span * 0.12;
    if (bounds) { min = Math.max(bounds[0], min); max = Math.min(bounds[1], max); }
    const n = Math.max(points.length, 2);
    const x = i => pad.l + (i * (width - pad.l - pad.r)) / (n - 1);
    const y = v => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
    const id = 'g' + (++uid);
    let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3;
      svg += `<line class="grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
    }
    if (marker !== null && marker > 0 && marker < points.length) {
      svg += `<line class="marker" x1="${x(marker)}" x2="${x(marker)}" y1="${pad.t}" y2="${height - pad.b}"/>`;
      svg += `<text class="marker-t" x="${x(marker) + 6}" y="${pad.t + 10}">${esc(markerLabel)}</text>`;
    }
    if (target !== null && target !== undefined) {
      svg += `<line class="target" x1="${pad.l}" x2="${width - pad.r}" y1="${y(target)}" y2="${y(target)}"/>`;
      svg += `<text class="target-t" x="${width - pad.r}" y="${y(target) - 6}" text-anchor="end">${esc(targetLabel)} ${esc(fmt(target))}</text>`;
    }
    const pts = points.map((p, i) => (p.v === null || p.v === undefined || Number.isNaN(p.v) ? null : [x(i), y(p.v), p]));
    let line = '', area = '', pen = false, first = null, last = null;
    for (const q of pts) {
      if (!q) { pen = false; continue; }
      line += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' ';
      if (!first) first = q;
      last = q;
      pen = true;
    }
    if (first && last) {
      area = line + `L${last[0].toFixed(1)} ${height - pad.b} L${first[0].toFixed(1)} ${height - pad.b} Z`;
      svg += `<path d="${area}" fill="url(#${id})" stroke="none"/>`;
    }
    svg += `<path class="line" d="${line}" stroke="${color}"/>`;
    for (const q of pts) {
      if (!q) continue;
      const p = q[2];
      const cls = p.win === true ? 'win' : p.win === false ? 'loss' : '';
      svg += `<g class="pt ${cls}" data-tip="${esc(p.tip || '')}" ${p.id ? `data-game="${esc(p.id)}"` : ''}><circle class="hit" cx="${q[0]}" cy="${q[1]}" r="12"/><circle class="dot" cx="${q[0]}" cy="${q[1]}" r="3.6" fill="${color}"/></g>`;
    }
    const step = Math.ceil(points.length / 10) || 1;
    points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) svg += `<text class="axis" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(p.label || '')}</text>`; });
    return svg + '</svg>';
  }

  function sparkline(values, color = '#c3ec7f', w = 104, h = 26) {
    const v = values.filter(x => x !== null && x !== undefined && !Number.isNaN(x));
    if (v.length < 2) return '';
    let min = Math.min(...v), max = Math.max(...v); if (min === max) { min -= 1; max += 1; }
    const pts = v.map((val, i) => `${((i * (w - 4)) / (v.length - 1) + 2).toFixed(1)},${(h - 3 - ((val - min) / (max - min)) * (h - 6)).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  // Anneau de progression (taux de victoire, % d'objectif)
  function ring(ratio, size = 64, color = '#c3ec7f') {
    const r = (size - 8) / 2, c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, ratio || 0));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="6"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  }

  root.Charts = { lineChart, sparkline, ring };
})(window);
