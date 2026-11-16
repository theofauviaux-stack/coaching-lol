// Petits graphiques SVG (aucune dépendance).
(function (root) {
  function lineChart({ series, labels = [], height = 180, width = 460, target = null, fmt = v => v.toFixed(1), marker = null, markerLabel = 'session' }) {
    const pad = { l: 44, r: 12, t: 12, b: 26 };
    const all = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    if (target !== null && target !== undefined) all.push(target);
    if (!all.length) return '<div class="muted small" style="padding:40px 0;text-align:center">Pas encore assez de parties</div>';
    let min = Math.min(...all), max = Math.max(...all);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min; min -= span * 0.1; max += span * 0.1;
    const n = Math.max(...series.map(s => s.values.length), 2);
    const x = i => pad.l + (i * (width - pad.l - pad.r)) / (n - 1);
    const y = v => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none" style="display:block">`;
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3;
      svg += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#2a323c" stroke-width="1"/>`;
      svg += `<text x="${pad.l - 6}" y="${y(v) + 4}" fill="#A09B8C" font-size="10" text-anchor="end">${fmt(v)}</text>`;
    }
    if (marker !== null && marker >= 0) {
      svg += `<line x1="${x(marker)}" x2="${x(marker)}" y1="${pad.t}" y2="${height - pad.b}" stroke="#C8AA6E" stroke-dasharray="4 3"/>`;
      svg += `<text x="${x(marker) + 4}" y="${pad.t + 10}" fill="#C8AA6E" font-size="10">${markerLabel}</text>`;
    }
    if (target !== null && target !== undefined) {
      svg += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(target)}" y2="${y(target)}" stroke="#E84057" stroke-dasharray="5 4"/>`;
      svg += `<text x="${width - pad.r}" y="${y(target) - 4}" fill="#E84057" font-size="10" text-anchor="end">objectif ${fmt(target)}</text>`;
    }
    for (const s of series) {
      const pts = s.values.map((v, i) => (v === null || v === undefined || Number.isNaN(v) ? null : [x(i), y(v)]));
      let d = '', pen = false;
      for (const p of pts) { if (!p) { pen = false; continue; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; pen = true; }
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
      for (const p of pts) if (p) svg += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${s.color}"/>`;
    }
    const step = Math.ceil(labels.length / 8) || 1;
    labels.forEach((l, i) => { if (i % step === 0) svg += `<text x="${x(i)}" y="${height - 8}" fill="#A09B8C" font-size="9" text-anchor="middle">${l}</text>`; });
    return svg + '</svg>';
  }

  function sparkline(values, color = '#C8AA6E', w = 110, h = 26) {
    const v = values.filter(x => x !== null && x !== undefined && !Number.isNaN(x));
    if (v.length < 2) return '';
    let min = Math.min(...v), max = Math.max(...v); if (min === max) { min -= 1; max += 1; }
    const pts = v.map((val, i) => `${(i * (w - 4)) / (v.length - 1) + 2},${h - 2 - ((val - min) / (max - min)) * (h - 4)}`).join(' ');
    return `<svg width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
  }

  root.Charts = { lineChart, sparkline };
})(window);
