'use strict';
// Schémas des exercices : petits dessins SVG lisibles, aux couleurs de l'app.
// Chaque exercice décrit son schéma avec des données ({ type: 'flow', ... }) ; ce fichier les dessine.
const Schemas = (() => {
  const W = 560;
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // découpe un texte en lignes d'au plus « max » caractères
  function wrap(text, max) {
    const out = []; let cur = '';
    for (const w of String(text).split(/\s+/)) {
      if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) out.push(cur);
    return out;
  }
  const t = (x, y, s, cls = '', anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(s)}</text>`;
  const block = (x, y, arr, cls = '', anchor = 'middle', lh = 15) => arr.map((l, i) => t(x, y + i * lh, l, cls, anchor)).join('');
  const defs = `<defs>${['m', 'ok', 'stop', 'info'].map(k => `<marker id="sch-${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ar-${k}"/></marker>`).join('')}</defs>`;
  const svg = (h, body, label) => `<svg class="sch" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${defs}${body}</svg>`;
  const arrow = (x1, y1, x2, y2, k = 'm', extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ln ln-${k}" marker-end="url(#sch-${k})" ${extra}/>`;
  const box = (x, y, w, h, k = '', rx = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="bx ${k}"/>`;

  // ------------------------------------------------------------- étapes en ligne, avec questions oui / non
  function flow({ nodes }) {
    const n = nodes.length, gap = 30, bw = (W - 20 - gap * (n - 1)) / n, bh = 62, y0 = 12;
    const hasNo = nodes.some(x => x.no);
    const yNo = y0 + bh + 42;
    let s = '';
    nodes.forEach((nd, i) => {
      const x = 10 + i * (bw + gap);
      const k = nd.k === 'q' ? 'q' : nd.k || '';
      s += box(x, y0, bw, bh, k);
      const ls = wrap(nd.t, Math.max(10, Math.floor(bw / 7.2)));
      s += block(x + bw / 2, y0 + bh / 2 - (ls.length - 1) * 7.5 + 4.5, ls, k === 'stop' || k === 'ok' ? 'b' : '');
      if (i < n - 1) {
        s += arrow(x + bw + 3, y0 + bh / 2, x + bw + gap - 3, y0 + bh / 2, nd.k === 'q' ? 'ok' : 'm');
        if (nd.k === 'q') s += t(x + bw + gap / 2, y0 + bh / 2 - 7, 'oui', 'f ok');
      }
      if (nd.no) {
        s += arrow(x + bw / 2, y0 + bh + 3, x + bw / 2, yNo - 3, 'stop');
        s += t(x + bw / 2 + 8, y0 + bh + 25, 'non', 'f red', 'start');
        const kk = nd.no.k || '';
        s += box(x, yNo, bw, bh, kk);
        const l2 = wrap(nd.no.t, Math.max(10, Math.floor(bw / 7.2)));
        s += block(x + bw / 2, yNo + bh / 2 - (l2.length - 1) * 7.5 + 4.5, l2);
      }
    });
    return svg(hasNo ? yNo + bh + 10 : y0 + bh + 12, s, nodes.map(x => x.t).join(' → '));
  }

  // ------------------------------------------------------------- séquences (rotation de sorts, tour, kiting…)
  function rows({ rows, plain }) {
    const lw = 128, rh = 50, ch = 32;
    let s = '', y0 = 0, extra = 0;
    rows.forEach((r, i) => {
      const y = 10 + i * rh + y0;
      const lab = wrap(r.label, 18);
      s += block(10, y + ch / 2 - (lab.length - 1) * 7 + 4, lab, 'b m', 'start', 14);
      let x = 10 + lw, yy = y;
      r.chips.forEach((c, j) => {
        const w = Math.max(44, String(c.t).length * 7.4 + 24);
        if (x + w > W - 8) { x = 10 + lw; yy += ch + 12; extra += ch + 12; }
        s += box(x, yy, w, ch, c.k || '', 16) + t(x + w / 2, yy + ch / 2 + 4.5, c.t, c.k === 'ok' || c.k === 'stop' ? 'b' : '');
        x += w;
        if (j < r.chips.length - 1) { if (plain) x += 8; else { s += arrow(x + 3, yy + ch / 2, x + 21, yy + ch / 2); x += 24; } }
      });
      y0 += extra; extra = 0;
    });
    return svg(10 + rows.length * rh + y0, s, rows.map(r => r.label + ' : ' + r.chips.map(c => c.t).join(', ')).join(' ; '));
  }

  // ------------------------------------------------------------- frise chronologique
  function timeline({ from, to, unit = 'min', segs = [], marks = [], ticks }) {
    const x0 = 22, x1 = W - 22, X = v => x0 + (v - from) / (to - from) * (x1 - x0);
    const fit = g => wrap(g.t, Math.max(6, Math.floor((X(g.b) - X(g.a) - 8) / 6.4)));
    const two = segs.some(g => fit(g).length > 1);
    const yb = marks.length ? 70 : 34, bh = two ? 42 : 30;
    let s = `<rect x="${x0}" y="${yb}" width="${x1 - x0}" height="${bh}" rx="8" class="bx"/>`;
    for (const g of segs) {
      const a = X(g.a), b = X(g.b);
      s += `<rect x="${a + 1}" y="${yb + 1}" width="${Math.max(2, b - a - 2)}" height="${bh - 2}" rx="7" class="bx ${g.k || ''}"/>`;
      const ls = fit(g).slice(0, 2);
      s += block((a + b) / 2, yb + bh / 2 + 4.5 - (ls.length - 1) * 6.5, ls, 'b sm', 'middle', 13);
    }
    (marks || []).forEach((m, i) => {
      const x = X(m.at), up = i % 2 ? 22 : 8;
      s += `<line x1="${x}" y1="${yb - 9}" x2="${x}" y2="${up + 14}" class="ln ln-${m.k || 'm'}"/>` + `<path d="M${x - 6} ${yb - 9}L${x + 6} ${yb - 9}L${x} ${yb - 1}Z" class="dot ${m.k || ''}"/>`;
      s += t(Math.min(Math.max(x, 60), W - 60), up + 8, m.t, 'sm b ' + (m.k === 'ok' ? 'ok' : m.k === 'stop' ? 'red' : ''));
    });
    const step = ticks || (to - from <= 12 ? 1 : 5);
    const yt = yb + bh + 18;
    for (let v = from; v <= to + 1e-9; v += step) s += t(X(v), yt, (Number.isInteger(v) ? v : v.toFixed(1)) + (v === to ? ' ' + unit : ''), 'f');
    return svg(yt + 8, s, segs.map(g => g.t).concat(marks.map(m => m.t)).join(', '));
  }

  // ------------------------------------------------------------- courbe de CS minute par minute
  function curve({ target, unit = 'CS', label = 'CS' }) {
    const x0 = 46, x1 = W - 20, y0 = 26, y1 = 176, top = Math.ceil(target * 1.12 / 10) * 10;
    const X = m => x0 + (m / 10) * (x1 - x0), Y = v => y1 - (v / top) * (y1 - y0);
    const at = m => Math.max(0, Math.round(target * (m - 1) / 9));
    let s = '';
    for (const v of [0, Math.round(top / 2), top]) s += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" class="grid"/>` + t(x0 - 8, Y(v) + 4, v, 'f', 'end');
    s += `<path d="M${X(1)} ${Y(0)} L${X(10)} ${Y(target)} L${X(10)} ${Y(0)} Z" class="area"/>`;
    s += `<line x1="${X(1)}" y1="${Y(0)}" x2="${X(10)}" y2="${Y(target)}" class="ln ln-ok dash"/>`;
    for (const m of [2, 4, 6, 8, 10]) {
      const v = at(m);
      s += `<circle cx="${X(m)}" cy="${Y(v)}" r="5.5" class="dot ok"/>` + t(X(m), Y(v) - 12, v + ' ' + unit, 'b ' + (m === 10 ? 'ok' : ''));
    }
    for (let m = 0; m <= 10; m++) s += t(X(m), y1 + 18, m + (m === 10 ? ' min' : ''), 'f');
    return svg(y1 + 28, s, `Repères de ${label} : ${[2, 4, 6, 8, 10].map(m => m + ' min ' + at(m)).join(', ')}`);
  }

  // ------------------------------------------------------------- la vague dans la lane (freeze, slow push, crash)
  function lane({ rows, labels = {} }) {
    const L = Object.assign({ ally: 'ta tour', enemy: 'sa tour', river: 'rivière' }, labels);
    const lx0 = 128, lx1 = W - 26, rh = 82;
    let s = '';
    rows.forEach((r, i) => {
      const y = 14 + i * rh, ly = y + 22;
      s += t(10, ly + 5, r.t, 'b ' + (r.k || ''), 'start');
      s += `<line x1="${lx0}" y1="${ly}" x2="${lx1}" y2="${ly}" class="lane"/>`;
      s += `<line x1="${(lx0 + lx1) / 2}" y1="${ly - 15}" x2="${(lx0 + lx1) / 2}" y2="${ly + 15}" class="river"/>`;
      s += `<rect x="${lx0 - 9}" y="${ly - 9}" width="18" height="18" rx="3" class="tw ally"/><rect x="${lx1 - 9}" y="${ly - 9}" width="18" height="18" rx="3" class="tw enemy"/>`;
      if (i === 0) s += t(lx0, ly - 15, L.ally, 'f') + t(lx1, ly - 15, L.enemy, 'f') + t((lx0 + lx1) / 2, ly - 19, L.river, 'f');
      const cx = lx0 + r.pos * (lx1 - lx0);
      for (let j = 0; j < r.ally; j++) s += `<circle cx="${cx - 6 - (j % 5) * 9}" cy="${ly - 4 + Math.floor(j / 5) * 9}" r="3.6" class="mn ally"/>`;
      for (let j = 0; j < r.enemy; j++) s += `<circle cx="${cx + 6 + (j % 5) * 9}" cy="${ly - 4 + Math.floor(j / 5) * 9}" r="3.6" class="mn enemy"/>`;
      if (r.push === 'right') s += arrow(cx + 12 + Math.min(5, r.enemy) * 9, ly, cx + 46 + Math.min(5, r.enemy) * 9, ly, 'ok');
      if (r.push === 'left') s += arrow(cx - 12 - Math.min(5, r.ally) * 9, ly, cx - 46 - Math.min(5, r.ally) * 9, ly, 'stop');
      s += block(lx0 - 9, ly + 30, wrap(r.note, 72), 'sm m', 'start', 14);
    });
    return svg(14 + rows.length * rh, s, rows.map(r => r.t + ' : ' + r.note).join(' ; '));
  }

  // ------------------------------------------------------------- carte de la Faille, simplifiée (coordonnées 0-100)
  const CAMPS = {
    // côté bleu (en bas à gauche)
    bBleu: [24, 48], bGromp: [13, 43], bLoups: [27, 59], bRouge: [53, 77], bKrugs: [58, 87], bRaptors: [47, 66],
    // côté rouge (en haut à droite)
    rBleu: [76, 52], rGromp: [87, 57], rLoups: [73, 41], rRouge: [47, 23], rKrugs: [42, 13], rRaptors: [53, 34],
    baron: [31, 29], drake: [69, 71], crabeTop: [28, 37], crabeBot: [72, 63]
  };
  function map({ markers = [], paths = [], zones = [] }) {
    const S = 270, ox = 10, oy = 10, P = (x, y) => [ox + x / 100 * S, oy + y / 100 * S];
    const pt = v => (typeof v === 'string' ? CAMPS[v] : v);
    let s = `<rect x="${ox}" y="${oy}" width="${S}" height="${S}" rx="14" class="mapbg"/>`;
    // rivière, voies, bases
    s += `<path d="M${P(4, 10)} L${P(10, 4)} L${P(96, 90)} L${P(90, 96)} Z" class="mapriver"/>`;
    s += `<path d="M${P(8, 92)} L${P(8, 8)} L${P(92, 8)} M${P(8, 92)} L${P(92, 92)} L${P(92, 8)} M${P(9, 91)} L${P(91, 9)}" class="maplane"/>`;
    s += `<circle cx="${P(8, 92)[0]}" cy="${P(8, 92)[1]}" r="15" class="base ally"/><circle cx="${P(92, 8)[0]}" cy="${P(92, 8)[1]}" r="15" class="base enemy"/>`;
    for (const k of Object.keys(CAMPS)) {
      if (/crabe/.test(k)) continue;
      const [x, y] = P(...CAMPS[k]);
      s += k === 'baron' || k === 'drake' ? `<circle cx="${x}" cy="${y}" r="7" class="obj"/>` : `<circle cx="${x}" cy="${y}" r="3.2" class="camp"/>`;
    }
    s += t(P(31, 29)[0], P(31, 29)[1] - 11, 'Nashor', 'f') + t(P(69, 71)[0], P(69, 71)[1] + 20, 'Drake', 'f');
    for (const z of zones) { const [x, y] = P(...pt(z.at)); s += `<circle cx="${x}" cy="${y}" r="${z.r / 100 * S}" class="zone ${z.k || ''}"/>`; }
    for (const p of paths) {
      const pts = p.pts.map(v => P(...pt(v)));
      s += `<polyline points="${pts.map(q => q.join(',')).join(' ')}" class="ln ln-${p.k || 'ok'} ${p.dash ? 'dash' : ''}" fill="none" marker-end="url(#sch-${p.k || 'ok'})"/>`;
    }
    markers.forEach((m, i) => {
      const [x, y] = P(...pt(m.at));
      s += `<circle cx="${x}" cy="${y}" r="9.5" class="mk ${m.k || 'ok'}"/>` + t(x, y + 4, m.n || i + 1, 'mkn');
    });
    // légende à droite
    let y = 22; const lx = ox + S + 22;
    markers.forEach((m, i) => {
      s += `<circle cx="${lx + 9}" cy="${y - 4}" r="9.5" class="mk ${m.k || 'ok'}"/>` + t(lx + 9, y, m.n || i + 1, 'mkn');
      const ls = wrap(m.t, 34);
      s += block(lx + 26, y, ls, '', 'start', 15);
      y += ls.length * 15 + 12;
    });
    return svg(Math.max(S + 20, y + 4), s, markers.map(m => m.t).join(' ; '));
  }

  // ------------------------------------------------------------- boucle (regard minimap…)
  function cycle({ steps }) {
    const n = steps.length, cx = W / 2, cy = 116, rx = 190, ry = 78, bw = 160, bh = 50;
    const pos = steps.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
    let s = '';
    pos.forEach(([x, y], i) => {
      const [nx, ny] = pos[(i + 1) % n];
      const dx = nx - x, dy = ny - y, L = Math.hypot(dx, dy);
      const sx = Math.min(bw / 2 / Math.abs(dx / L || 1e-9), bh / 2 / Math.abs(dy / L || 1e-9)) + 6;
      s += arrow(x + dx / L * sx, y + dy / L * sx, nx - dx / L * sx, ny - dy / L * sx, 'ok');
    });
    pos.forEach(([x, y], i) => {
      const st = steps[i];
      s += box(x - bw / 2, y - bh / 2, bw, bh, st.k || '');
      const ls = wrap(st.t, 22);
      s += block(x, y - (ls.length - 1) * 7 + 4.5, ls, st.k ? 'b' : '', 'middle', 14);
    });
    return svg(cy + ry + bh / 2 + 12, s, steps.map(x => x.t).join(' → '));
  }

  // ------------------------------------------------------------- esquive et visée
  function arena({ mode }) {
    let s = `<rect x="10" y="10" width="${W - 20}" height="220" rx="14" class="mapbg"/>`;
    if (mode === 'dodge') {
      s += arrow(470, 40, 300, 112, 'stop', 'stroke-width="5"') + t(478, 34, 'skillshot', 'f red', 'start');
      s += `<line x1="300" y1="112" x2="190" y2="158" class="ln ln-stop dash" opacity=".45"/>`;
      s += `<circle cx="280" cy="120" r="17" class="mk ok"/>` + t(280, 124, 'toi', 'mkn');
      s += arrow(268, 104, 230, 52, 'ok', 'stroke-width="3"') + t(214, 44, 'Pas de côté : sort de la trajectoire', 'b ok');
      s += arrow(268, 136, 222, 154, 'stop', 'opacity=".55"') + t(150, 186, 'Reculer dans l\'axe : touché quand même', 'sm red');
      s += t(W / 2, 220, 'Petits clics courts, perpendiculaires à la trajectoire', 'sm m');
    } else {
      s += `<circle cx="170" cy="78" r="15" class="mk stop"/>` + t(170, 82, 'lui', 'mkn');
      s += arrow(188, 78, 318, 78, 'stop', 'stroke-dasharray="5 5"') + `<circle cx="340" cy="78" r="15" class="ghost"/>` + t(340, 58, 'là où il sera', 'b');
      s += `<circle cx="270" cy="196" r="15" class="mk ok"/>` + t(270, 200, 'toi', 'mkn');
      s += arrow(281, 182, 334, 95, 'ok', 'stroke-width="3"') + t(360, 150, 'Vise devant lui', 'b ok', 'start');
      s += `<line x1="262" y1="182" x2="178" y2="94" class="ln ln-stop dash" opacity=".5"/>` + t(118, 150, 'Sur lui : trop tard', 'sm red');
    }
    return svg(240, s, mode === 'dodge' ? 'Esquive : pas de côté hors de la trajectoire' : 'Visée : anticiper le déplacement');
  }

  // ------------------------------------------------------------- fiche modèle à compléter
  function card({ title, lines: ls }) {
    let s = box(10, 10, W - 20, 44 + ls.length * 40, '', 14) + t(30, 38, title, 'b', 'start');
    ls.forEach((l, i) => {
      const y = 76 + i * 40;
      s += t(30, y, l, 'm', 'start') + `<line x1="${30 + l.length * 6.8 + 8}" y1="${y + 2}" x2="${W - 30}" y2="${y + 2}" class="ln dots"/>`;
    });
    return svg(64 + ls.length * 40, s, title + ' : ' + ls.join(' ; '));
  }

  const TYPES = { flow, rows, timeline, curve, lane, map, cycle, arena, card };
  // spec : schéma de l'exercice ; ctx : valeurs de la séance (ex. cible adaptée au rôle)
  function render(spec, ctx = {}) {
    if (!spec || !TYPES[spec.type]) return '';
    const sp = typeof spec.build === 'function' ? Object.assign({}, spec, spec.build(ctx)) : spec;
    try {
      return `<figure class="schema">${TYPES[sp.type](sp)}${sp.caption ? `<figcaption>${esc(sp.caption)}</figcaption>` : ''}</figure>`;
    } catch (e) {
      return '';
    }
  }
  return { render, wrap, CAMPS };
})();
