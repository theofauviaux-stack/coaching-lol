// Débrief exporté par le joueur : page HTML autonome, enregistrée à côté des vidéos sur son ordinateur.
// Elle s'ouvre dans n'importe quel navigateur, sans l'app ni le serveur.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dateFr = t => (t ? new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '');
const BEFORE_VIEW = 30; // la vidéo d'un moment démarre 30 s avant

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
  const msgs = arr => arr.map(c => `<div class="msg ${c.author === 'coach' ? 'coach' : 'joueur'}"><div class="who">${who(c)} <span>${esc(dateFr(c.at))}</span></div><div class="txt">${esc(c.text)}</div></div>`).join('');
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
    const from = c ? Math.max(0, Math.round(x.t / 1000 - c.start - BEFORE_VIEW)) : 0;
    const said = comments.filter(k => k.t === x.t);
    return `<section>
  <h2><span class="t">${mmss(x.t)}</span> ${title(x)}</h2>
  <p class="det">${detail(x)}</p>
  ${c ? `<video controls preload="metadata" src="${encodeURI(c.file)}#t=${from}"></video>
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
</body>
</html>
`;
}

module.exports = { buildDebrief, BEFORE_VIEW };
