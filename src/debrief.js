// Débrief exporté par le joueur : page HTML autonome, enregistrée à côté des vidéos sur son ordinateur.
// Elle s'ouvre dans n'importe quel navigateur, sans l'app ni le serveur.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dateFr = t => (t ? new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '');
const BEFORE_VIEW = 30; // la vidéo d'un moment démarre 30 s avant
const { videoAt } = require('./replay');
const attr = o => esc(JSON.stringify(o));
// Dans la page : « 6:10 » d'un message → la vidéo saute à ce moment ; « Voir le dessin » → image en pause et dessin par-dessus.
const SCRIPT = `(function () {
  function videoAt(c, g) {
    var s = (c.sync || []).filter(function (p) { return p && p.length === 2; });
    if (s.length >= 2) {
      var last = s[s.length - 1];
      if (g <= s[0][1]) return Math.max(0, s[0][0] - (s[0][1] - g));
      if (g >= last[1]) return Math.max(0, last[0] + (g - last[1]));
      var i = 1; while (s[i][1] < g) i++;
      return Math.max(0, s[i - 1][0] + (g - s[i - 1][1]) * (s[i][0] - s[i - 1][0]) / (s[i][1] - s[i - 1][1]));
    }
    return Math.max(0, (c.lead || 0) + (g - c.start));
  }
  function shape(sh, w, h) {
    var sw = Math.max(3, w / 150), X = function (x) { return (x * w).toFixed(1); }, Y = function (y) { return (y * h).toFixed(1); };
    if (sh.k === 'trait') return '<polyline points="' + sh.pts.map(function (q) { return X(q[0]) + ',' + Y(q[1]); }).join(' ') + '" fill="none" stroke="' + sh.c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
    var x1 = sh.p[0] * w, y1 = sh.p[1] * h, x2 = sh.p[2] * w, y2 = sh.p[3] * h;
    if (sh.k === 'cercle') return '<ellipse cx="' + (x1 + x2) / 2 + '" cy="' + (y1 + y2) / 2 + '" rx="' + Math.abs(x2 - x1) / 2 + '" ry="' + Math.abs(y2 - y1) / 2 + '" fill="none" stroke="' + sh.c + '" stroke-width="' + sw + '"/>';
    var a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(12, sw * 4);
    return '<g stroke="' + sh.c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/><polyline points="' + (x2 - L * Math.cos(a - .45)) + ',' + (y2 - L * Math.sin(a - .45)) + ' ' + x2 + ',' + y2 + ' ' + (x2 - L * Math.cos(a + .45)) + ',' + (y2 - L * Math.sin(a + .45)) + '"/></g>';
  }
  function clear() { Array.prototype.forEach.call(document.querySelectorAll('.ov'), function (o) { o.remove(); }); }
  function videos() { return Array.prototype.slice.call(document.querySelectorAll('video[data-c]')); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-t]'), d = e.target.closest('[data-d]');
    if (t) {
      e.preventDefault();
      var g = Number(t.dataset.t);
      var v = videos().filter(function (x) { var c = JSON.parse(x.dataset.c); return g >= c.start - 1 && g <= c.end + 1; })[0];
      if (!v) { alert('Pas de vidéo pour ' + t.textContent + '.'); return; }
      clear(); v.currentTime = Math.max(0, videoAt(JSON.parse(v.dataset.c), g) - 1); v.scrollIntoView({ behavior: 'smooth', block: 'center' }); v.play();
    }
    if (d) {
      var dr = JSON.parse(d.dataset.d);
      var v2 = videos().filter(function (x) { return JSON.parse(x.dataset.c).file === dr.file; })[0];
      if (!v2) { alert('La vidéo de ce dessin n\\'est pas dans ce dossier.'); return; }
      clear(); v2.pause();
      var show = function () {
        var w = dr.w || v2.videoWidth || 1600, h = dr.h || v2.videoHeight || 900;
        var o = document.createElement('div'); o.className = 'ov';
        o.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + dr.shapes.map(function (s) { return shape(s, w, h); }).join('') + '</svg>';
        v2.parentNode.appendChild(o);
        v2.addEventListener('play', clear, { once: true });
      };
      v2.addEventListener('seeked', show, { once: true });
      v2.currentTime = dr.v;
      v2.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
})();`;

function buildDebrief({ analysis: a, label, playerName, champName = x => x, files = [] }) {
  const m = a.moments || {};
  const ch = c => esc(champName(c) || c || '?');
  const title = x => esc(x.title).replace(/(tué par|Kill sur) (\w+)/, (s0, b, c) => b + ' ' + ch(c));
  const list = arr => (arr || []).map(ch).join(', ');
  const detail = x => {
    if (x.type === 'mort') {
      return [esc(x.zone), x.involved && x.involved.length ? 'Ennemis : ' + list(x.involved) : '', 'Alliés à côté : ' + (x.allies && x.allies.length ? list(x.allies) : 'aucun'),
        x.after && x.after.length ? 'Ensuite : ' + x.after.map(e => esc(e.what) + ' ' + e.s + ' s après').join(', ') : ''].filter(Boolean).join(' · ');
    }
    if (x.type === 'objectif') return (x.tags || []).includes('présent') ? 'Présent' : 'Absent' + (x.where ? ' (' + esc(x.where) + ')' : '');
    if (x.type === 'retour') return x.items && x.items.length ? esc(x.items.join(', ')) : '';
    if (x.type === 'niveau') return x.vs ? 'Vis-à-vis niveau 6 à ' + esc(x.vs) : '';
    return esc(x.zone || '');
  };
  const clipFor = x => (a.clips || []).find(c => files.includes(c.file) && x.t / 1000 >= c.start - 1 && x.t / 1000 <= c.end + 1);
  const who = c => (c.author === 'coach' ? 'Coach' : esc(playerName || 'Joueur'));
  const maxT = (m.duration || 3600) + 30;
  const linkTimes = html => html.replace(/(^|[^\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g, (all, pre, mm, ss) => { const t = Number(mm) * 60 + Number(ss); return t > maxT ? all : `${pre}<a href="#" class="tl" data-t="${t}">${mm}:${ss}</a>`; });
  const drawn = c => (c.drawing && files.includes(c.drawing.file) ? `<button class="dr" data-d="${attr(c.drawing)}">✎ Voir le dessin à ${mmss(c.drawing.g * 1000)}</button>` : '');
  const msgs = arr => arr.map(c => `<div class="msg ${c.author === 'coach' ? 'coach' : 'joueur'}"><div class="who">${who(c)} <span>${esc(dateFr(c.at))}</span></div>${c.text ? `<div class="txt">${linkTimes(esc(c.text))}</div>` : ''}${drawn(c)}</div>`).join('');
  const comments = a.comments || [];
  const general = (a.note ? [{ author: 'joueur', text: a.note, at: a.createdAt }] : []).concat(comments.filter(c => c.t === null || c.t === undefined));
  const moments = m.moments || [];
  // moments présentés avec leur vidéo : ceux qui ont des messages, plus un par extrait qui n'en a pas
  const talked = x => comments.some(c => c.t === x.t);
  const key = moments.filter((x, i) => {
    if (talked(x)) return true;
    const c = clipFor(x);
    return !!c && !moments.some((y, j) => clipFor(y) === c && (talked(y) || j < i));
  });
  const others = moments.filter(x => !key.includes(x));
  const me = (m.participants || []).find(p => p.id === m.me) || {};
  const opp = (m.participants || []).find(p => p.id === m.opp);
  const lane = (k, l) => {
    const x = m.lane && m.lane[k];
    if (!x || !x.me) return '';
    const d = x.opp ? x.me.gold - x.opp.gold : null;
    return `<div><span>À ${l} min</span><b>${x.me.cs} CS · ${x.me.gold.toLocaleString('fr-FR')} or</b>${d === null ? '' : `<em class="${d >= 0 ? 'ok' : 'ko'}">${d >= 0 ? '+' : ''}${d.toLocaleString('fr-FR')} or</em>`}</div>`;
  };
  const section = x => {
    const c = clipFor(x);
    const from = c ? Math.round(videoAt(c, x.t / 1000 - BEFORE_VIEW) * 10) / 10 : 0;
    const said = comments.filter(k => k.t === x.t);
    return `<section>
  <h2><span class="t">${mmss(x.t)}</span> ${title(x)}</h2>
  <p class="det">${detail(x)}</p>
  ${c ? `<div class="vw"><video controls preload="metadata" src="${encodeURI(c.file)}#t=${from}" data-c="${attr({ file: c.file, start: c.start, end: c.end, lead: c.lead || 0, sync: c.sync || null })}"></video></div>
  <p class="vid">Extrait ${mmss(c.start * 1000)} → ${mmss(c.end * 1000)} · la vidéo démarre ${BEFORE_VIEW} s avant le moment (fichier ${esc(c.file)})</p>` : ''}
  ${said.length ? msgs(said) : '<p class="none">Pas de message sur ce moment.</p>'}
</section>`;
  };
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analyse — ${esc(label)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1214; color: #e8ecef; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 22px 60px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  .meta { color: #9aa6ad; margin-bottom: 18px; }
  .sum { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 26px; }
  .sum div { background: #161b1f; border: 1px solid #262e34; border-radius: 10px; padding: 9px 13px; min-width: 150px; }
  .sum span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #8a959c; }
  .sum em { display: block; font-style: normal; font-size: 13px; } .ok { color: #c3ec7f; } .ko { color: #ff8a80; }
  section { background: #161b1f; border: 1px solid #262e34; border-radius: 12px; padding: 16px 18px; margin: 0 0 16px; }
  h2 { font-size: 17px; margin: 0 0 4px; } h2 .t { color: #c3ec7f; margin-right: 6px; }
  .det { color: #9aa6ad; font-size: 13.5px; margin: 0 0 10px; }
  video { width: 100%; border-radius: 9px; background: #000; display: block; }
  .vid { color: #7d888f; font-size: 12px; margin: 6px 0 12px; }
  .msg { border: 1px solid #262e34; background: rgba(255, 255, 255, .04); border-radius: 10px; padding: 8px 12px; margin: 8px 0; max-width: 88%; }
  .msg.coach { border-color: rgba(195, 236, 127, .35); background: rgba(195, 236, 127, .09); margin-left: auto; }
  .who { font-weight: 700; font-size: 12.5px; } .who span { font-weight: 400; color: #7d888f; margin-left: 4px; }
  .txt { white-space: pre-wrap; }
  .none { color: #7d888f; font-size: 13px; }
  ul.others { color: #9aa6ad; font-size: 13.5px; padding-left: 18px; } ul.others b { color: #c9d1d6; }
  footer { color: #6c767c; font-size: 12px; margin-top: 30px; }
  .vw { position: relative; } .ov { position: absolute; inset: 0; pointer-events: none; } .ov svg { width: 100%; height: 100%; display: block; }
  a.tl { color: #c3ec7f; font-weight: 700; } button.dr { margin-top: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(195, 236, 127, .35); background: rgba(195, 236, 127, .09); color: #c3ec7f; font: 600 12px inherit; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Analyse — ${esc(label)}</h1>
  <div class="meta">${esc(playerName || '')} · ${ch(me.champion)}${opp ? ' contre ' + ch(opp.champion) : ''} · ${m.win ? 'Victoire' : 'Défaite'}${m.kda ? ' · ' + esc(m.kda.join('/')) : ''}${m.duration ? ' · ' + mmss(m.duration * 1000) : ''}<br>
    Envoyée au coach le ${esc(dateFr(a.createdAt))}${a.closedAt ? ' · analyse terminée le ' + esc(dateFr(a.closedAt)) : ''}</div>
  <div class="sum">${lane('at10', 10)}${lane('at15', 15)}${m.vision ? `<div><span>Vision</span><b>${m.vision.placed} wards · ${m.vision.control} pink${m.vision.control > 1 ? 's' : ''}</b><em>${m.vision.killed} détruite${m.vision.killed > 1 ? 's' : ''}</em></div>` : ''}</div>
  <section>
    <h2>Discussion générale</h2>
    ${general.length ? msgs(general) : '<p class="none">Pas de message général.</p>'}
  </section>
  ${key.map(section).join('\n  ')}
  ${others.length ? `<section><h2>Autres moments de la partie</h2><ul class="others">${others.map(x => `<li><b>${mmss(x.t)}</b> ${title(x)}${detail(x) ? ' — ' + detail(x) : ''}</li>`).join('')}</ul></section>` : ''}
  ${files.length ? '' : '<p class="none">Les vidéos avaient déjà été effacées du serveur : ce débrief contient la discussion seulement.</p>'}
  <footer>Exporté depuis Coaching LoL. Les vidéos (${files.length}) sont dans ce même dossier : garde-les à côté de ce fichier.</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

module.exports = { buildDebrief, BEFORE_VIEW };
