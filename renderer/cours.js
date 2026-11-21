/* global Courses, Schemas, Exercises, Stats, icon */
'use strict';
// Page « Cours » : liste des parcours, leçons (texte, schémas, interactions), quiz, mise en pratique.
// Le contenu est dans courses.js. Les réponses aux interactions restent en mémoire pendant la session ;
// la progression (leçons vues, meilleur score au quiz, cases cochées, cours assignés) est enregistrée
// dans la fiche du joueur par window.api.courseProgress.
// Utilise les fonctions d'app.js (state, D, esc, render, player, isCoach, canEdit, toast, exerciseCard…),
// chargé avant lui : tout est appelé après le démarrage.
const Cours = (() => {
  const cw = {};      // état des interactions, par identifiant de bloc
  const timers = {};  // lectures automatiques (vagues) et chronos (décisions rapides)
  const PASS = 0.8;   // score du quiz pour valider un cours

  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const W = id => (cw[id] = cw[id] || {});
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  // mélange stable (même ordre à chaque affichage) : les bonnes réponses ne sont pas toujours au même endroit
  function shuffled(arr, seed) {
    const idx = arr.map((_, i) => i);
    let h = hash(seed);
    for (let i = idx.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
  }

  // ------------------------------------------------------------------ progression
  const playerView = () => D().session && D().session.role === 'joueur';
  const progOf = (p, cid) => ((p && p.courses) || {})[cid] || {};
  const stepKeys = c => c.lessons.map(l => l.id).concat(['quiz', 'pratique']);
  const passed = pr => !!(pr.quiz && pr.quiz.best >= PASS);
  function status(p, c) {
    const pr = progOf(p, c.id);
    const seen = stepKeys(c).filter(k => (pr.seen || []).includes(k)).length;
    return { pr, seen, total: stepKeys(c).length, done: passed(pr), started: seen > 0 || !!pr.quiz, assigned: !!pr.assigned };
  }
  async function save(cid, patch, coachAction) {
    const p = player();
    if (!p) return;
    if (!coachAction && !playerView()) return; // le coach qui parcourt un cours ne change pas la progression du joueur
    if (!window.api.courseProgress) return;
    const r = await window.api.courseProgress({ playerId: p.id, courseId: cid, patch });
    if (r && r.data) { state.data = r.data; if (coachAction) render(); else if (!isTyping()) { state.pending = false; render(); } }
    if (r && r.message && !r.ok) toast(r.message, 'err');
  }
  const wSaved = (cid, id) => (progOf(player(), cid).w || {})[id];

  // cours conseillés d'après les dernières parties (et le rôle)
  function advice(p) {
    const out = {};
    if (!p) return out;
    const gs = D().games.filter(g => g.playerId === p.id && !g.custom).sort((a, b) => b.date - a.date).slice(0, 20);
    if (gs.length < 3) return out;
    const avg = f => { const v = gs.map(f).filter(x => typeof x === 'number' && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const d15 = avg(g => g.deaths15), cs10 = avg(g => g.cs10), vis = avg(g => (g.duration ? g.vision / g.duration : null));
    if (d15 !== null && d15 > 2) { out.survie = `${String(d15.toFixed(1)).replace('.', ',')} morts avant 15 min en moyenne`; out.tracking = 'beaucoup de morts en début de partie'; }
    if (p.role !== 'Support' && p.role !== 'Jungle' && cs10 !== null && cs10 < 70) out.farm = `${Math.round(cs10)} CS à 10 min en moyenne`;
    if (p.role === 'Support') out.support = vis !== null && vis < 2 ? `${String(vis.toFixed(2)).replace('.', ',')} de vision par minute` : 'ton rôle';
    return out;
  }

  // ------------------------------------------------------------------ page
  function page() {
    stopTimersIfAway();
    const c = state.cours && Courses.byId(state.cours.id);
    return c ? courseView(c) : listView();
  }

  function listView() {
    const p = player();
    const coach = !playerView();
    const adv = advice(p);
    const pc = Courses.PARCOURS[0];
    const list = Courses.forParcours(pc.id);
    const sts = list.map(c => status(p, c));
    const done = sts.filter(s => s.done).length;
    const mins = list.reduce((a, c) => a + c.minutes, 0);
    const assigned = list.filter((c, i) => sts[i].assigned && !sts[i].done);
    const cards = list.map((c, i) => {
      const s = sts[i];
      const forRole = !p || !c.roles || c.roles.includes(p.role);
      const chips = [
        s.done ? `<span class="chip accent">${icon('check', 12)} Validé</span>` : s.started ? `<span class="chip blue">En cours · ${s.seen}/${s.total}</span>` : '<span class="chip">Nouveau</span>',
        s.assigned && !s.done ? `<span class="chip amber">${icon('send', 12)} ${coach ? 'Assigné' : 'Demandé par ton coach'}</span>` : '',
        adv[c.id] ? `<span class="chip violet" data-tip="${esc(adv[c.id])}">${icon('sparkles', 12)} Conseillé</span>` : '',
        !forRole ? `<span class="chip faint-chip">Rôle ${esc(c.roles.join(', '))}</span>` : ''
      ].join('');
      const pct = Math.round(100 * s.seen / s.total);
      return `<div class="cs-card ${s.done ? 'done' : ''} ${!forRole ? 'other' : ''}" data-action="c-open" data-id="${c.id}">
        <div class="cs-card-top"><div class="cs-tile">${icon(c.icon, 20)}<i>${c.n}</i></div>
          <div class="cs-card-t"><b>${esc(c.t)}</b><span>${c.lessons.length} leçons · ${c.minutes} min · ${esc(c.level)}</span></div></div>
        <p>${esc(c.summary)}</p>
        <div class="cs-chips">${chips}</div>
        <div class="cs-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
    const who = coach && p ? ` de ${esc(gameNameOf(p.riotId))}` : '';
    return `<div class="row"><h1>Cours</h1><span class="spacer"></span></div>
      <div class="sub">${coach ? `Les cours tirés de ton programme. Ouvre un cours pour le voir comme ${p ? esc(gameNameOf(p.riotId)) : 'le joueur'}, et assigne-le pour qu'il le retrouve en tête de liste.` : 'Des cours courts et interactifs, tirés du programme de ton coach. Chaque cours se termine par un quiz, des exercices et un objectif.'}</div>
      ${!coach && assigned.length ? `<div class="bk-alert cs-alert">${icon('send', 16)}<span><b>Ton coach t'a demandé ${assigned.length > 1 ? 'ces cours' : 'ce cours'} :</b> ${assigned.map(c => esc(c.t)).join(', ')}.</span><span class="spacer"></span><button class="btn primary" data-action="c-open" data-id="${assigned[0].id}">Commencer</button></div>` : ''}
      <div class="cs-parcours">
        <div class="cs-ptile">${icon('graduation', 22)}</div>
        <div class="cs-pt"><div class="tiny muted">PARCOURS 1</div><b>${esc(pc.t)}</b><span>${esc(pc.sub)}</span></div>
        <div class="cs-pstat"><b>${done}/${list.length}</b><span>cours validés${who}</span><div class="cs-bar"><i style="width:${Math.round(100 * done / list.length)}%"></i></div><span class="tiny faint">${list.length} cours · environ ${String(Math.round(mins / 6) / 10).replace('.', ',')} h</span></div>
      </div>
      <div class="cs-grid">${cards}</div>`;
  }

  function courseView(c) {
    const p = player();
    const coach = !playerView();
    const keys = stepKeys(c);
    const step = Math.min(Math.max(0, state.cours.step || 0), keys.length - 1);
    const st = status(p, c);
    const seenSet = new Set(st.pr.seen || []);
    const nav = keys.map((k, i) => {
      const l = c.lessons[i];
      const label = l ? l.t : k === 'quiz' ? 'Quiz' : 'Mise en pratique';
      const ico = l ? '' : k === 'quiz' ? icon('star', 14) : icon('target', 14);
      const ok = k === 'quiz' ? st.done : seenSet.has(k);
      return `<button class="cs-step ${i === step ? 'on' : ''} ${ok ? 'ok' : ''}" data-action="c-step" data-v="${i}"><span class="cs-num">${ok ? icon('check', 12) : l ? i + 1 : ico}</span><span>${esc(label)}</span></button>`;
    }).join('');
    const k = keys[step];
    let body;
    if (k === 'quiz') body = quizView(c);
    else if (k === 'pratique') body = practiceView(c);
    else {
      const l = c.lessons[step];
      body = `<div class="tiny muted cs-kicker">LEÇON ${step + 1} SUR ${c.lessons.length}</div><h2 class="cs-h">${esc(l.t)}</h2>${l.blocks.map(b => block(b, c)).join('')}`;
    }
    const prev = step > 0 ? `<button class="btn ghost" data-action="c-step" data-v="${step - 1}">${icon('chevron', 15, 'flip')} Précédent</button>` : '<span></span>';
    const nextLabel = step === keys.length - 2 ? 'Mise en pratique' : step === keys.length - 3 ? 'Passer au quiz' : 'Leçon suivante';
    const next = step < keys.length - 1 ? `<button class="btn primary" data-action="c-next" data-v="${step + 1}">${nextLabel} ${icon('chevron', 15)}</button>` : `<button class="btn" data-action="c-back">${icon('check', 15)} Terminer</button>`;
    const coachBar = coach && p ? `<div class="cs-coachbar">${icon('players', 15)}<span>Suivi de <b>${esc(gameNameOf(p.riotId))}</b> : ${st.seen}/${st.total} étapes${st.pr.quiz ? ` · quiz ${Math.round(st.pr.quiz.best * 100)} %` : ''}${st.done ? ' · validé' : ''}</span><span class="spacer"></span>
      ${canEdit() ? (st.assigned ? `<span class="chip amber">${icon('send', 12)} Assigné le ${dateFr(st.pr.assigned)}</span><button class="btn ghost" data-action="c-unassign" data-id="${c.id}">Retirer</button>` : `<button class="btn" data-action="c-assign" data-id="${c.id}">${icon('send', 14)} Assigner à ${esc(gameNameOf(p.riotId))}</button>`) : ''}</div>` : '';
    return `<div class="cs-top"><button class="btn ghost" data-action="c-back">${icon('chevron', 15, 'flip')} Tous les cours</button><span class="spacer"></span><span class="muted small">${c.minutes} min · ${esc(c.level)}</span></div>
      ${coachBar}
      <div class="cs-layout">
        <aside class="cs-side">
          <div class="cs-side-head"><div class="cs-tile">${icon(c.icon, 20)}<i>${c.n}</i></div><div><b>${esc(c.t)}</b><span>${st.seen}/${st.total} étapes</span></div></div>
          <div class="cs-bar"><i style="width:${Math.round(100 * st.seen / st.total)}%"></i></div>
          <div class="cs-steps">${nav}</div>
          <div class="cs-outcomes"><h3>Tu sauras</h3><ul>${c.outcomes.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>
          ${c.credit ? `<div class="cs-credit">${icon('info', 13)} ${esc(c.credit)}</div>` : ''}
          <div class="cs-sources"><h3>Sources</h3>${c.sources.map(s => s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : `<span>${esc(s.t)}</span>`).join('')}</div>
        </aside>
        <section class="cs-main">${body}<div class="cs-foot">${prev}${next}</div></section>
      </div>`;
  }

  // ------------------------------------------------------------------ blocs d'une leçon
  function block(b, c) {
    if (b.p) return `<p class="cs-p">${md(b.p)}</p>`;
    if (b.list) return `<ul class="cs-list">${b.list.map(x => `<li>${md(x)}</li>`).join('')}</ul>`;
    if (b.key) return `<div class="cs-key">${icon('star', 15)}<div><span class="cs-kt">À retenir</span><span>${md(b.key)}</span></div></div>`;
    if (b.warn) return `<div class="cs-key warn">${icon('alert', 15)}<div><span>${md(b.warn)}</span></div></div>`;
    if (b.schema) return Schemas.render(b.schema);
    const f = WIDGETS[b.w];
    return f ? `<div class="cs-w cs-w-${b.w}" id="w-${b.id}">${f(b, c)}</div>` : '';
  }
  const wHead = (ico, t) => `<div class="cs-wh">${icon(ico, 14)} ${esc(t)}</div>`;
  const fb = (ok, text) => `<div class="cs-fb ${ok ? 'ok' : 'ko'}">${icon(ok ? 'check' : 'alert', 14)}<span>${md(text)}</span></div>`;

  const WIDGETS = {
    // ---------------------------------------------------------------- simulateur de vague
    wave(b) {
      const mode = Courses.WAVES[b.mode];
      const s = W(b.id);
      const f = Math.min(s.f || 0, mode.frames.length - 1);
      const fr = mode.frames[f];
      const dots = mode.frames.map((_, i) => `<button class="cs-dot ${i === f ? 'on' : ''}" data-action="c-wave" data-w="${b.id}" data-v="${i}" aria-label="Étape ${i + 1}"></button>`).join('');
      return `${wHead('play', 'Simulation : ' + mode.t)}
        ${waveSvg(fr)}
        <div class="cs-wave-ctl"><button class="icon-btn" data-action="c-wave" data-w="${b.id}" data-v="${f - 1}" ${f === 0 ? 'disabled' : ''} aria-label="Étape précédente">${icon('chevron', 16, 'flip')}</button>
          <button class="btn ${s.play ? '' : 'primary'} sm" data-action="c-wave-play" data-w="${b.id}">${s.play ? 'Pause' : f === mode.frames.length - 1 ? 'Revoir' : 'Lecture'}</button>
          <button class="icon-btn" data-action="c-wave" data-w="${b.id}" data-v="${f + 1}" ${f === mode.frames.length - 1 ? 'disabled' : ''} aria-label="Étape suivante">${icon('chevron', 16)}</button>
          <span class="cs-dots">${dots}</span><span class="tiny faint">${f + 1}/${mode.frames.length}</span></div>
        <div class="cs-wave-note">${md(fr.note)}</div>`;
    },

    // ---------------------------------------------------------------- clic sur la carte
    map(b) {
      const s = W(b.id);
      const done = s.pick !== undefined;
      const letters = 'ABCDEF';
      const right = b.zones.findIndex(z => z.ok);
      const opts = b.zones.map((z, i) => {
        const cls = !done ? '' : z.ok ? 'ok' : i === s.pick ? 'ko' : 'dim';
        return `<button class="cs-opt ${cls}" data-action="c-map" data-w="${b.id}" data-v="${i}" ${done ? 'disabled' : ''}><span class="cs-letter">${letters[i]}</span>${esc(z.t)}</button>`;
      }).join('');
      const z = done ? b.zones[s.pick] : null;
      return `${wHead('target', 'Sur la carte')}<div class="cs-q">${md(b.q)}</div>
        <div class="cs-mapwrap">${mapSvg(b, s, right)}<div class="cs-mapopts">${opts}
          ${done ? fb(z.ok, z.fb) + (z.ok ? '' : `<div class="cs-fb ok">${icon('check', 14)}<span><b>${esc(b.zones[right].t)}</b> : ${md(b.zones[right].fb)}</span></div>`) + `<button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Recommencer</button>` : '<div class="tiny faint">Clique une zone sur la carte, ou une réponse.</div>'}</div></div>`;
    },

    // ---------------------------------------------------------------- question à choix
    choice(b) {
      const s = W(b.id);
      const done = s.pick !== undefined;
      const order = shuffled(b.opts, b.id);
      const right = b.opts.findIndex(o => o.ok);
      const opts = order.map(i => {
        const o = b.opts[i];
        const cls = !done ? '' : o.ok ? 'ok' : i === s.pick ? 'ko' : 'dim';
        return `<button class="cs-opt ${cls}" data-action="c-choice" data-w="${b.id}" data-v="${i}" ${done ? 'disabled' : ''}>${esc(o.t)}</button>`;
      }).join('');
      return `${wHead('chat', 'À toi de décider')}<div class="cs-q">${md(b.q)}</div><div class="cs-opts">${opts}</div>
        ${done ? fb(b.opts[s.pick].ok, b.opts[s.pick].fb) + (b.opts[s.pick].ok ? '' : fb(true, b.opts[right].fb)) + `<button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Recommencer</button>` : ''}`;
    },

    // ---------------------------------------------------------------- scénario en plusieurs étapes
    scenario(b) {
      const s = W(b.id);
      const ans = s.ans || [];
      const shown = Math.min(ans.length + 1, b.steps.length);
      const html = b.steps.slice(0, shown).map((st, k) => {
        const pick = ans[k];
        const done = pick !== undefined;
        const order = shuffled(st.opts, b.id + k);
        const opts = order.map(i => {
          const o = st.opts[i];
          const cls = !done ? '' : o.ok ? 'ok' : i === pick ? 'ko' : 'dim';
          return `<button class="cs-opt ${cls}" data-action="c-scen" data-w="${b.id}" data-k="${k}" data-v="${i}" ${done ? 'disabled' : ''}>${esc(o.t)}</button>`;
        }).join('');
        return `<div class="cs-sstep ${done ? 'done' : 'cur'}"><div class="cs-snum">${k + 1}</div><div class="cs-sbody"><div class="cs-q">${md(st.s)}</div><div class="cs-opts">${opts}</div>${done ? fb(st.opts[pick].ok, st.opts[pick].fb) : ''}</div></div>`;
      }).join('');
      const end = ans.length === b.steps.length;
      const good = ans.filter((p, k) => b.steps[k].opts[p].ok).length;
      return `${wHead('play', 'Scénario')}${html}${end ? `<div class="cs-score"><b>${good}/${b.steps.length}</b> bonnes décisions<span class="spacer"></span><button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Rejouer</button></div>` : ''}`;
    },

    // ---------------------------------------------------------------- associer chaque situation à une réponse
    match(b) {
      const s = W(b.id);
      const ans = s.ans || {};
      const rows = b.items.map((it, i) => {
        const pick = ans[i];
        const done = pick !== undefined;
        const btns = b.choices.map((ch, j) => {
          const cls = !done ? '' : j === it.a ? 'ok' : j === pick ? 'ko' : 'dim';
          return `<button class="cs-pill ${cls}" data-action="c-match" data-w="${b.id}" data-k="${i}" data-v="${j}" ${done ? 'disabled' : ''}>${esc(ch)}</button>`;
        }).join('');
        return `<div class="cs-mrow ${done ? (pick === it.a ? 'ok' : 'ko') : ''}"><div class="cs-ms">${md(it.s)}</div><div class="cs-mb">${btns}</div>${done ? `<div class="cs-mwhy">${icon(pick === it.a ? 'check' : 'alert', 13)} ${md(it.why)}</div>` : ''}</div>`;
      }).join('');
      const n = Object.keys(ans).length;
      const good = Object.entries(ans).filter(([i, v]) => b.items[i].a === v).length;
      return `${wHead('filter', 'À toi de trier')}<div class="cs-q">${md(b.q)}</div>${rows}
        ${n === b.items.length ? `<div class="cs-score"><b>${good}/${b.items.length}</b> bonnes réponses<span class="spacer"></span><button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Recommencer</button></div>` : `<div class="tiny faint">${n}/${b.items.length} situations</div>`}`;
    },

    // ---------------------------------------------------------------- décisions rapides chronométrées
    quick(b) {
      const s = W(b.id);
      const ans = s.ans || [];
      if (!s.on && !ans.length) return `${wHead('clock', 'Décisions rapides')}<div class="cs-q">${md(b.q)}</div><div class="muted small">${b.items.length} situations, ${b.secs} secondes chacune.</div><button class="btn primary" data-action="c-quick-go" data-w="${b.id}">${icon('play', 14)} Commencer</button>`;
      if (s.reveal) {
        const k = ans.length - 1, prev = b.items[k], a = ans[k];
        return `${wHead('clock', 'Décisions rapides · ' + (k + 1) + '/' + b.items.length)}<div class="cs-quick">${md(prev.s)}</div>${fb(a === prev.a, (a === null ? 'Trop tard. ' : '') + prev.why)}<button class="btn primary" data-action="c-quick-next" data-w="${b.id}">${k === b.items.length - 1 ? 'Voir le résultat' : 'Situation suivante'} ${icon('chevron', 14)}</button>`;
      }
      if (ans.length === b.items.length) {
        const good = ans.filter((a, i) => a === b.items[i].a).length;
        return `${wHead('clock', 'Décisions rapides')}<div class="cs-score"><b>${good}/${b.items.length}</b> bonnes décisions${good === b.items.length ? ' : parfait.' : ''}<span class="spacer"></span><button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Recommencer</button></div>
          <div class="cs-recap">${b.items.map((it, i) => `<div class="cs-mrow ${ans[i] === it.a ? 'ok' : 'ko'}"><div class="cs-ms">${md(it.s)}</div><div class="cs-mwhy">${icon(ans[i] === it.a ? 'check' : 'alert', 13)} ${ans[i] === null ? 'Trop tard. ' : ''}${md(it.why)}</div></div>`).join('')}</div>`;
      }
      const i = ans.length;
      const it = b.items[i];
      return `${wHead('clock', 'Décisions rapides · ' + (i + 1) + '/' + b.items.length)}<div class="cs-quick">${md(it.s)}</div>
        <div class="cs-timer" id="tm-${b.id}-${i}-${s.run || 0}"><i style="animation-duration:${b.secs}s"></i></div>
        <div class="cs-qbtns"><button class="btn big danger-o" data-action="c-quick" data-w="${b.id}" data-v="1">${esc(b.yes)}</button><button class="btn big" data-action="c-quick" data-w="${b.id}" data-v="0">${esc(b.no)}</button></div>`;
    },

    // ---------------------------------------------------------------- remettre dans l'ordre
    order(b) {
      const s = W(b.id);
      const seq = s.seq || [];
      const order = shuffled(b.items, b.id);
      const done = seq.length === b.items.length;
      const ok = done && seq.every((v, i) => v === i);
      const btns = order.map(i => {
        const pos = seq.indexOf(i);
        return `<button class="cs-opt ${pos >= 0 ? (done ? (pos === i ? 'ok' : 'ko') : 'picked') : ''}" data-action="c-order" data-w="${b.id}" data-v="${i}" ${pos >= 0 || done ? 'disabled' : ''}>${pos >= 0 ? `<span class="cs-letter">${pos + 1}</span>` : '<span class="cs-letter empty"></span>'}${esc(b.items[i])}</button>`;
      }).join('');
      return `${wHead('sync', 'Remets dans l\'ordre')}<div class="cs-q">${md(b.q)}</div><div class="cs-opts">${btns}</div>
        ${done ? fb(ok, ok ? 'Bon ordre. ' + b.fb : 'Le bon ordre : ' + b.items.map((x, i) => (i + 1) + '. ' + x).join(' → ') + '. ' + b.fb) + `<button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Recommencer</button>` : seq.length ? `<button class="btn ghost sm" data-action="c-reset" data-w="${b.id}">Effacer</button>` : '<div class="tiny faint">Clique les étapes dans l\'ordre.</div>'}`;
    },

    // ---------------------------------------------------------------- cases à cocher (enregistrées)
    check(b, c) {
      const sv = wSaved(c.id, b.id);
      const today = new Date().toISOString().slice(0, 10);
      const on = new Set(b.daily ? (sv && sv.day === today ? sv.v : []) : (sv || []));
      const n = on.size;
      return `${wHead('check', b.daily ? 'Check-list du jour' : 'Check-list')}<div class="cs-q">${md(b.q)}</div>
        ${b.items.map((x, i) => `<button class="cs-check ${on.has(i) ? 'on' : ''}" data-action="c-check" data-w="${b.id}" data-c="${c.id}" data-v="${i}" ${playerView() ? '' : 'disabled'}><span class="box">${on.has(i) ? icon('check', 12) : ''}</span>${esc(x)}</button>`).join('')}
        <div class="tiny ${n === b.items.length ? 'ok' : 'faint'}">${n}/${b.items.length}${n === b.items.length ? ' : tout est en place.' : ''}${playerView() ? '' : ' (cochées par le joueur)'}</div>`;
    },

    // ---------------------------------------------------------------- calculateur de CS
    cs(b) {
      const s = W(b.id);
      const v = s.v === undefined ? 55 : s.v;
      return `${wHead('wheat', 'Ton farm à 10 minutes')}<div class="cs-q">Combien de CS as-tu en général à 10 min ? Déplace le curseur.</div>
        <div class="cs-range"><input type="range" min="20" max="110" step="1" value="${v}" data-cin="cs" data-w="${b.id}" id="r-${b.id}"><b id="o-${b.id}v">${v} CS</b></div>
        <div id="o-${b.id}">${csOut(v)}</div>`;
    },

    // ---------------------------------------------------------------- win condition
    wincon(b, c) {
      const sv = wSaved(c.id, b.id) || {};
      const s = W(b.id);
      const v = Object.assign({ fort: 0, gagne: 0, evite: 0 }, sv, s.v || {});
      const sel = (k, list) => `<select data-cchange="wincon" data-w="${b.id}" data-c="${c.id}" data-k="${k}">${list.map((x, i) => `<option value="${i}" ${Number(v[k]) === i ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
      const text = winconText(v);
      return `${wHead('target', 'Écris ta win condition')}<div class="cs-wc">
        <label>Mon champion est fort ${sel('fort', WC.fort)}</label>
        <label>Il gagne la partie ${sel('gagne', WC.gagne)}</label>
        <label>Je dois éviter ${sel('evite', WC.evite)}</label></div>
        <div class="cs-wc-out">${icon('send', 14)}<span id="wc-${b.id}">${esc(text)}</span><button class="btn sm" data-action="c-copy" data-w="${b.id}">${icon('copy', 13)} Copier</button></div>
        <div class="tiny faint">Colle-la dans le chat de partie au chargement, ou note-la dans ton carnet.</div>`;
    },

    // ---------------------------------------------------------------- carte des morts du joueur
    deaths() {
      const p = player();
      const tr = p && p.trends;
      if (!tr || tr.games < 3) return `${wHead('skull', 'Ta carte des morts')}<div class="empty">Elle apparaîtra ici après 3 parties classées analysées par l'app.</div>`;
      const v = D().settings.ddVersion;
      const dots = tr.points.map(d => { const [l, t] = mapPct(d.x, d.y); return `<i class="tr-dot ${d.t < 15 * 60000 ? 'early' : ''}" style="left:${l}%;top:${t}%" data-tip="${esc(mmss(d.t) + ' · ' + d.zone)}"></i>`; }).join('');
      const z = tr.zones[0], w = tr.windows.slice().sort((a, b) => b.n - a.n)[0];
      return `${wHead('skull', 'Ta carte des morts · ' + tr.games + ' dernières parties')}
        <div class="cs-deaths"><div class="tr-map" ${v ? `style="background-image:url(https://ddragon.leagueoflegends.com/cdn/${v}/img/map/map11.png)"` : ''}>${dots}
          <div class="tr-legend"><span><i class="tr-dot early"></i> avant 15 min</span><span><i class="tr-dot"></i> après</span></div></div>
          <div class="cs-dside"><div class="cs-big"><b>${String(tr.perGame.toFixed(1)).replace('.', ',')}</b><span>morts par partie</span></div>
          ${z ? `<div class="cs-big"><b>${esc(z.label)}</b><span>zone où tu meurs le plus (${z.n} fois)</span></div>` : ''}
          ${w ? `<div class="cs-big"><b>${esc(w.label)}</b><span>moment où tu meurs le plus (${w.n} fois)</span></div>` : ''}
          ${tr.sentences.length ? `<ul class="tr-said">${tr.sentences.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></div>`;
    },

    // ---------------------------------------------------------------- ADC (cours support)
    adc(b) {
      const s = W(b.id);
      const prof = s.prof || 'all';
      const P = Courses.ADC_PROFILES;
      const chips = [['all', 'Tous']].concat(Object.keys(P).map(k => [k, P[k].t])).map(([k, t]) => `<button class="${prof === k ? 'on' : ''}" data-action="c-adc-prof" data-w="${b.id}" data-v="${k}">${esc(t)}</button>`).join('');
      const list = Courses.ADCS.filter(a => prof === 'all' || a.profile === prof);
      const grid = list.map(a => `<button class="cs-champ ${s.pick === a.name ? 'on' : ''}" data-action="c-adc" data-w="${b.id}" data-v="${esc(a.name)}">${img(a.name, 'cs-cimg') || `<span class="cs-cini">${esc(a.name.slice(0, 2))}</span>`}<span>${esc(a.name)}</span></button>`).join('');
      const a = Courses.ADCS.find(x => x.name === s.pick);
      const card = a ? `<div class="cs-adc">
          <div class="cs-adc-h">${img(a.name, 'cs-cimg big')}<div><b>${esc(a.name)}</b><div class="row" style="gap:6px;margin-top:4px"><span class="chip ${P[a.profile].k}">${esc(P[a.profile].t)}</span><span class="chip ${a.roam <= 1 ? 'accent' : a.roam === 2 ? 'amber' : 'red'}">${esc(Courses.ROAM_LABEL[a.roam])}</span></div></div></div>
          <h3>Ton plan de lane</h3><ul class="cs-list">${P[a.profile].plan.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <h3>Spécifique à ${esc(a.name)}</h3><p class="cs-p">${esc(a.note)}</p></div>` : '<div class="cs-adc empty">Choisis un ADC pour voir ton plan de lane.</div>';
      return `${wHead('players', 'Ton ADC')}<div class="chips" style="margin-bottom:10px">${chips}</div><div class="cs-adcwrap"><div class="cs-champs">${grid}</div>${card}</div>`;
    },

    // ---------------------------------------------------------------- roam ou pas (cours support)
    roam(b) {
      const s = W(b.id);
      const on = s.on || {};
      const rows = ROAM.map((r, i) => `<button class="cs-check ${on[i] ? 'on' : ''}" data-action="c-roam" data-w="${b.id}" data-v="${i}"><span class="box">${on[i] ? icon('check', 12) : ''}</span><span>${esc(r.t)}${r.need ? '' : ' <span class="faint">(un plus)</span>'}</span></button>`).join('');
      const miss = ROAM.filter((r, i) => r.need && !on[i]);
      const plus = ROAM.filter((r, i) => !r.need && on[i]).length;
      let v;
      if (miss.length) v = `<div class="cs-verdict ko">${icon('alert', 16)}<div><b>Reste en lane</b><span>Il manque : ${miss.map(r => esc(r.short)).join(', ')}.</span></div></div>`;
      else if (!plus) v = `<div class="cs-verdict mid">${icon('clock', 16)}<div><b>Roam possible, mais court</b><span>Ta lane tient, mais rien ne la protège d'un dive : fais vite et reviens.</span></div></div>`;
      else v = `<div class="cs-verdict ok">${icon('check', 16)}<div><b>Va roamer</b><span>Ta lane tient sans toi et ton roam mène à quelque chose.</span></div></div>`;
      return `${wHead('arrow', 'Roam ou pas ?')}<div class="cs-q">Coche ce qui est vrai maintenant :</div>${rows}${v}`;
    },

    // ---------------------------------------------------------------- note de 1 à N (enregistrée)
    scale(b, c) {
      const sv = wSaved(c.id, b.id);
      const v = W(b.id).v || sv || null;
      const btns = Array.from({ length: b.max }, (_, i) => i + 1).map(n => `<button class="cs-sc ${v === n ? 'on' : ''}" data-action="c-scale" data-w="${b.id}" data-c="${c.id}" data-v="${n}" ${playerView() ? '' : 'disabled'}>${n}</button>`).join('');
      return `${wHead('brain', 'Auto-évaluation')}<div class="cs-q">${md(b.q)}</div><div class="cs-scale">${btns}</div>${v ? `<div class="cs-fb ok">${icon('info', 14)}<span>${esc(b.tips[v - 1])}</span></div>` : ''}`;
    }
  };

  const ROAM = [
    { t: "Ta vague a crash sur leur tour, ou les 2 prochaines vagues sont sans canon", short: 'une vague qui couvre ton absence', need: true },
    { t: "Ton ADC peut nettoyer seul (premier objet, Statikk ou niveau 6 selon le champion)", short: 'un ADC capable de tenir seul', need: true },
    { t: "Ton roam mène à quelque chose : un kill, un objectif, une vision importante", short: 'un vrai but au roam', need: true },
    { t: "Le bot adverse n'a pas de gros contrôle (enchanteur ou mage)", short: '', need: false },
    { t: "Le jungler adverse est localisé loin du bot", short: '', need: false }
  ];
  const WC = {
    fort: ["en début de partie", "à partir du niveau 6", "avec 2 objets", "en fin de partie"],
    gagne: ["en gagnant sa lane, puis en roamant", "en poussant une side lane", "dans les combats d'équipe", "en protégeant notre carry", "en prenant les objectifs avec le jungler"],
    evite: ["de mourir avant mon moment fort", "les combats à 5 contre 5 avant 2 objets", "de laisser mes vagues se perdre", "de me faire attraper sans vision"]
  };
  const winconText = v => `Mon champion est fort ${WC.fort[v.fort]}. Il gagne la partie ${WC.gagne[v.gagne]}. Je dois éviter ${WC.evite[v.evite]}.`;
  function csOut(v) {
    const miss = 70 - v;
    const waves = Math.max(0, miss) / 6;
    return miss > 0
      ? `<div class="cs-fb ko">${icon('alert', 14)}<span>Il te manque <b>${miss} CS</b> pour l'objectif de 70, soit environ <b>${String(waves.toFixed(1)).replace('.', ',')} vague${waves >= 2 ? 's' : ''}</b> perdue${waves >= 2 ? 's' : ''} à 10 minutes.</span></div>`
      : `<div class="cs-fb ok">${icon('check', 14)}<span>Objectif de 70 atteint${v >= 80 ? ', et même le repère de practice tool (80)' : ''}. Vise maintenant <b>8 CS/min</b> sur toute la partie.</span></div>`;
  }

  // ------------------------------------------------------------------ dessins
  function waveSvg(fr) {
    const Wd = 560, x0 = 50, x1 = 510, ly = 62, mid = (x0 + x1) / 2;
    const mx = x0 + fr.pos * (x1 - x0);
    let s = `<rect x="6" y="6" width="${Wd - 12}" height="112" rx="12" class="wv-bg"/>`;
    s += `<line x1="${x0}" y1="${ly}" x2="${x1}" y2="${ly}" class="wv-lane"/>`;
    s += `<path d="M${mid - 16} 12 L${mid + 16} 112" class="wv-river"/><text x="${mid - 10}" y="24" class="wv-t f" text-anchor="end">rivière</text>`;
    if (fr.danger) s += `<rect x="${mx + 14}" y="${ly - 30}" width="${mid - mx - 14}" height="60" rx="8" class="wv-danger"/><text x="${(mx + mid) / 2 + 7}" y="${ly + 44}" class="wv-t red" text-anchor="middle">il doit venir jusqu'ici pour farmer</text>`;
    if (fr.free) s += `<rect x="${x0 + 18}" y="${ly - 22}" width="190" height="44" rx="10" class="wv-free"/><text x="${x0 + 113}" y="${ly + 5}" class="wv-t ok b" text-anchor="middle">Temps libre pour toi</text>`;
    s += `<g class="wv-tw ally"><rect x="${x0 - 13}" y="${ly - 13}" width="26" height="26" rx="5"/></g><text x="${x0}" y="${ly + 30}" class="wv-t" text-anchor="middle">ta tour</text>`;
    s += `<g class="wv-tw enemy ${fr.tower ? 'shoot' : ''}"><rect x="${x1 - 13}" y="${ly - 13}" width="26" height="26" rx="5"/></g><text x="${x1}" y="${ly + 30}" class="wv-t" text-anchor="middle">sa tour</text>`;
    // 14 emplacements par camp, toujours présents : les sbires glissent d'une étape à l'autre
    const slot = (j, side) => {
      const col = Math.floor(j / 2), row = j % 2;
      let x = side < 0 ? mx - 9 - col * 11 : mx + 9 + col * 11;
      x = Math.max(x0 + 18, Math.min(x1 - 18, x));
      return [x, ly - 6 + row * 12];
    };
    for (let j = 0; j < 14; j++) { const [x, y] = slot(j, -1); s += `<circle r="4.6" cx="0" cy="0" class="mn ally" style="transform:translate(${x}px,${y}px);opacity:${j < fr.ally ? 1 : 0}"/>`; }
    for (let j = 0; j < 14; j++) { const [x, y] = slot(j, 1); s += `<circle r="4.6" cx="0" cy="0" class="mn enemy" style="transform:translate(${x}px,${y}px);opacity:${j < fr.enemy ? 1 : 0}"/>`; }
    if (fr.push === 'right') { const a = Math.min(x1 - 30, mx + 20 + Math.ceil(fr.enemy / 2) * 11); s += `<line x1="${a}" y1="${ly - 26}" x2="${a + 34}" y2="${ly - 26}" class="ln ln-ok" marker-end="url(#sch-ok)"/>`; }
    if (fr.push === 'left') { const a = Math.max(x0 + 30, mx - 20 - Math.ceil(fr.ally / 2) * 11); s += `<line x1="${a}" y1="${ly - 26}" x2="${a - 34}" y2="${ly - 26}" class="ln ln-stop" marker-end="url(#sch-stop)"/>`; }
    s += `<g class="wv-key"><circle cx="24" cy="108" r="4" class="mn ally"/><text x="32" y="111" class="wv-t f">tes sbires</text><circle cx="104" cy="108" r="4" class="mn enemy"/><text x="112" y="111" class="wv-t f">les siens</text></g>`;
    return `<svg class="sch cs-wave" viewBox="0 0 ${Wd} 124" role="img" aria-label="${esc(fr.note)}">${MARKERS}${s}</svg>`;
  }
  const MARKERS = `<defs>${['ok', 'stop'].map(k => `<marker id="sch-${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ar-${k}"/></marker>`).join('')}</defs>`;

  function mapSvg(b, s, right) {
    const S = 300, o = 10, P = (x, y) => [o + x / 100 * S, o + y / 100 * S];
    const CAMPS = Schemas.CAMPS;
    const pt = v => (typeof v === 'string' ? CAMPS[v] : v);
    const done = s.pick !== undefined;
    let g = `<rect x="${o}" y="${o}" width="${S}" height="${S}" rx="14" class="mapbg"/>`;
    g += `<path d="M${P(4, 10)} L${P(10, 4)} L${P(96, 90)} L${P(90, 96)} Z" class="mapriver"/>`;
    g += `<path d="M${P(8, 92)} L${P(8, 8)} L${P(92, 8)} M${P(8, 92)} L${P(92, 92)} L${P(92, 8)} M${P(9, 91)} L${P(91, 9)}" class="maplane"/>`;
    g += `<circle cx="${P(8, 92)[0]}" cy="${P(8, 92)[1]}" r="16" class="base ally"/><circle cx="${P(92, 8)[0]}" cy="${P(92, 8)[1]}" r="16" class="base enemy"/>`;
    for (const k of Object.keys(CAMPS)) {
      if (/crabe/.test(k)) continue;
      const [x, y] = P(...CAMPS[k]);
      g += k === 'baron' || k === 'drake' ? `<circle cx="${x}" cy="${y}" r="7" class="obj"/>` : `<circle cx="${x}" cy="${y}" r="3.4" class="camp"/>`;
    }
    g += `<text x="${P(31, 29)[0]}" y="${P(31, 29)[1] - 11}" text-anchor="middle" class="f">Nashor</text><text x="${P(69, 71)[0]}" y="${P(69, 71)[1] + 20}" text-anchor="middle" class="f">Drake</text>`;
    g += `<text x="${P(8, 92)[0] + 20}" y="${P(8, 92)[1] - 8}" class="sm b info">ta base</text><text x="${P(92, 8)[0] - 20}" y="${P(92, 8)[1] + 16}" text-anchor="end" class="sm b red">base ennemie</text>`;
    const ctx = b.context || {};
    if (!b.showPathAfter || done) for (const pth of ctx.paths || []) g += `<polyline points="${pth.pts.map(v => P(...pt(v)).join(',')).join(' ')}" class="ln ln-${pth.k || 'ok'} ${pth.dash ? 'dash' : ''}" fill="none" marker-end="url(#sch-${pth.k || 'ok'})"/>`;
    for (const m of ctx.markers || []) { const [x, y] = P(...pt(m.at)); g += `<circle cx="${x}" cy="${y}" r="9" class="mk ${m.k || 'ok'}"/><text x="${x}" y="${y - 14}" text-anchor="middle" class="sm b ${m.k === 'stop' ? 'red' : ''}">${esc(m.t)}</text>`; }
    b.zones.forEach((z, i) => {
      const [x, y] = P(...pt(z.at)), r = z.r / 100 * S;
      const cls = !done ? '' : i === right ? 'ok' : i === s.pick ? 'ko' : 'dim';
      g += `<g class="cs-zone ${cls}" ${done ? '' : `data-action="c-map" data-w="${b.id}" data-v="${i}"`}><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + 4.5}" text-anchor="middle">${'ABCDEF'[i]}</text></g>`;
    });
    return `<svg class="sch cs-map" viewBox="0 0 ${S + 2 * o} ${S + 2 * o}" role="img" aria-label="Carte de la Faille">${MARKERS}${g}</svg>`;
  }

  // ------------------------------------------------------------------ quiz
  function quizView(c) {
    const q = state.cq && state.cq.id === c.id ? state.cq : (state.cq = { id: c.id, i: 0, ans: [] });
    const pr = progOf(player(), c.id);
    const best = pr.quiz ? Math.round(pr.quiz.best * 100) : null;
    const head = `<div class="tiny muted cs-kicker">QUIZ · ${c.quiz.length} QUESTIONS</div><h2 class="cs-h">Valide le cours</h2>`;
    if (q.i >= c.quiz.length) {
      const good = q.ans.filter((a, i) => a === c.quiz[i].a).length;
      const ratio = good / c.quiz.length;
      return `${head}<div class="cs-result ${ratio >= PASS ? 'ok' : ''}"><div class="cs-big"><b>${good}/${c.quiz.length}</b><span>${Math.round(ratio * 100)} %</span></div>
        <div>${ratio >= PASS ? `<b>Cours validé.</b> ${playerView() ? 'Ton coach le voit dans ton suivi.' : ''}` : `<b>Pas encore : il faut ${Math.round(PASS * 100)} %.</b> Relis les leçons des questions ratées, puis recommence.`}${best !== null ? `<div class="tiny faint">Meilleur score : ${best} %</div>` : ''}</div></div>
        <div class="cs-recap">${c.quiz.map((x, i) => `<div class="cs-mrow ${q.ans[i] === x.a ? 'ok' : 'ko'}"><div class="cs-ms">${esc(x.q)}</div><div class="cs-mwhy">${icon(q.ans[i] === x.a ? 'check' : 'alert', 13)} <b>${esc(x.opts[x.a])}</b> : ${esc(x.why)}</div></div>`).join('')}</div>
        <button class="btn" data-action="c-quiz-again">${icon('undo', 14)} Recommencer le quiz</button>`;
    }
    const x = c.quiz[q.i];
    const pick = q.ans[q.i];
    const done = pick !== undefined;
    const order = shuffled(x.opts, c.id + q.i);
    const opts = order.map(i => {
      const cls = !done ? '' : i === x.a ? 'ok' : i === pick ? 'ko' : 'dim';
      return `<button class="cs-opt ${cls}" data-action="c-quiz" data-v="${i}" ${done ? 'disabled' : ''}>${esc(x.opts[i])}</button>`;
    }).join('');
    const bar = c.quiz.map((_, i) => `<i class="${i < q.i ? (q.ans[i] === c.quiz[i].a ? 'ok' : 'ko') : i === q.i ? 'cur' : ''}"></i>`).join('');
    return `${head}<div class="cs-qbar">${bar}</div><div class="cs-w"><div class="tiny faint">Question ${q.i + 1} sur ${c.quiz.length}</div><div class="cs-q big">${esc(x.q)}</div><div class="cs-opts">${opts}</div>
      ${done ? fb(pick === x.a, (pick === x.a ? 'Exact. ' : 'Réponse : ' + x.opts[x.a] + '. ') + x.why) + `<button class="btn primary" data-action="c-quiz-next">${q.i === c.quiz.length - 1 ? 'Voir mon score' : 'Question suivante'} ${icon('chevron', 14)}</button>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ mise en pratique
  function practiceView(c) {
    const p = player();
    const pr = c.practice;
    const exs = pr.exercises.map(id => Exercises.byId(id)).filter(Boolean);
    const g = pr.goal;
    const has = p && (p.goals || []).some(x => x.status === 'actif' && x.kpi && x.kpi === g.kpi);
    const fmt = Stats.METRIC_FMT[g.kpi] || 'dec1';
    const tgt = g.target === null || g.target === undefined ? '' : ' ' + Stats.goalSens(g.kpi) + ' ' + Stats.fmt(g.target, fmt);
    let action;
    if (has) action = `<span class="chip accent">${icon('check', 12)} Déjà dans ${playerView() ? 'tes' : 'ses'} objectifs</span>`;
    else if (!playerView() && canEdit()) action = `<button class="btn primary" data-action="c-goal" data-id="${c.id}">${icon('plus', 14)} Ajouter à ses objectifs</button>`;
    else action = '<span class="muted small">Ton coach peut l\'ajouter à tes objectifs suivis.</span>';
    return `<div class="tiny muted cs-kicker">MISE EN PRATIQUE</div><h2 class="cs-h">Applique-le en partie</h2>
      <p class="cs-p">Un cours ne change rien tant qu'il ne passe pas dans tes parties. Fais ces exercices de la Banque cette semaine, avec un seul objectif à la fois.</p>
      <div class="cs-goal"><div class="cs-tile">${icon('target', 18)}</div><div class="t"><div class="tiny muted">OBJECTIF CONSEILLÉ</div><b>${esc(g.text)}</b><span>Mesuré automatiquement : ${esc(g.kpi)}${esc(tgt)}, sur tes parties classées.</span></div>${action}</div>
      <h3 class="exh">${icon('target', 15)} Exercices (${exs.length})</h3>
      ${exs.map(ex => exerciseCard(ex, { role: p && p.role, toggle: true, open: state.exOpen === ex.id })).join('')}`;
  }

  // ------------------------------------------------------------------ actions
  function stopTimersIfAway() {
    if (state.page === 'cours' && state.cours) return;
    for (const k of Object.keys(timers)) { clearInterval(timers[k]); clearTimeout(timers[k]); delete timers[k]; }
  }
  function goStep(c, i, markPrev) {
    const keys = stepKeys(c);
    const cur = keys[state.cours.step || 0];
    state.cours.step = Math.max(0, Math.min(keys.length - 1, i));
    const next = keys[state.cours.step];
    const add = [];
    if (markPrev && cur && cur !== 'quiz') add.push(cur);
    if (next === 'pratique') add.push('pratique');
    render();
    const pg = document.querySelector('#page'); if (pg) pg.scrollTop = 0;
    if (add.length) save(c.id, { seen: add });
  }
  function wavePlay(id, mode) {
    const s = W(id);
    clearInterval(timers[id]);
    if (s.play) { s.play = false; render(); return; }
    const n = Courses.WAVES[mode].frames.length;
    if ((s.f || 0) >= n - 1) s.f = 0;
    s.play = true;
    render();
    timers[id] = setInterval(() => {
      if (!document.getElementById('w-' + id)) { clearInterval(timers[id]); s.play = false; return; }
      s.f = (s.f || 0) + 1;
      if (s.f >= n - 1) { s.f = n - 1; s.play = false; clearInterval(timers[id]); }
      if (!isTyping()) render();
    }, 2300);
  }
  const findBlock = id => { for (const c of Courses.LIST) for (const l of c.lessons) for (const b of l.blocks) if (b.id === id) return b; return null; };

  function quickArm(id) {
    const b = findBlock(id), s = W(id);
    clearTimeout(timers[id]);
    s.run = (s.run || 0) + 1;
    const i = (s.ans || []).length;
    timers[id] = setTimeout(() => {
      if ((s.ans || []).length !== i || !document.getElementById('w-' + id)) return;
      s.ans = (s.ans || []).concat([null]); s.last = i; s.reveal = true; render();
    }, b.secs * 1000);
  }

  async function click(el) {
    const a = el.dataset.action;
    const id = el.dataset.w;
    const v = el.dataset.v;
    const c = state.cours && Courses.byId(state.cours.id);
    switch (a) {
      case 'c-open': state.cours = { id: el.dataset.id, step: 0 }; state.cq = null; render(); { const pg = document.querySelector('#page'); if (pg) pg.scrollTop = 0; } return true;
      case 'c-back': state.cours = null; render(); return true;
      case 'c-step': if (c) goStep(c, Number(v), false); return true;
      case 'c-next': if (c) goStep(c, Number(v), true); return true;
      case 'c-wave': { const b = findBlock(id); const n = Courses.WAVES[b.mode].frames.length; const s = W(id); clearInterval(timers[id]); s.play = false; s.f = Math.max(0, Math.min(n - 1, Number(v))); render(); return true; }
      case 'c-wave-play': wavePlay(id, findBlock(id).mode); return true;
      case 'c-map': case 'c-choice': { const s = W(id); if (s.pick === undefined) { s.pick = Number(v); render(); } return true; }
      case 'c-reset': { const s = W(id); for (const k of Object.keys(s)) delete s[k]; clearTimeout(timers[id]); clearInterval(timers[id]); render(); return true; }
      case 'c-scen': { const s = W(id); s.ans = s.ans || []; if (s.ans.length === Number(el.dataset.k)) { s.ans.push(Number(v)); render(); } return true; }
      case 'c-match': { const s = W(id); s.ans = s.ans || {}; if (s.ans[el.dataset.k] === undefined) { s.ans[el.dataset.k] = Number(v); render(); } return true; }
      case 'c-order': { const s = W(id); s.seq = s.seq || []; if (!s.seq.includes(Number(v))) { s.seq.push(Number(v)); render(); } return true; }
      case 'c-quick-go': { const s = W(id); s.on = true; s.ans = []; s.reveal = false; render(); quickArm(id); return true; }
      case 'c-quick': { const s = W(id); const b = findBlock(id); const i = (s.ans || []).length; if (i >= b.items.length || s.reveal) return true; clearTimeout(timers[id]); s.ans = (s.ans || []).concat([v === '1']); s.last = i; s.reveal = true; render(); return true; }
      case 'c-quick-next': { const s = W(id); const b = findBlock(id); s.reveal = false; render(); if ((s.ans || []).length < b.items.length) quickArm(id); return true; }
      case 'c-check': {
        const b = findBlock(id); const cid = el.dataset.c;
        const today = new Date().toISOString().slice(0, 10);
        const sv = wSaved(cid, id);
        const cur = new Set(b.daily ? (sv && sv.day === today ? sv.v : []) : (sv || []));
        const n = Number(v); if (cur.has(n)) cur.delete(n); else cur.add(n);
        const val = [...cur].sort((x, y) => x - y);
        await save(cid, { w: { [id]: b.daily ? { day: today, v: val } : val } });
        return true;
      }
      case 'c-scale': { W(id).v = Number(v); render(); await save(el.dataset.c, { w: { [id]: Number(v) } }); return true; }
      case 'c-roam': { const s = W(id); s.on = s.on || {}; s.on[v] = !s.on[v]; render(); return true; }
      case 'c-adc': W(id).pick = v; render(); return true;
      case 'c-adc-prof': W(id).prof = v; render(); return true;
      case 'c-copy': { const t = document.getElementById('wc-' + id); if (t) copyText(t.textContent, 'Win condition copiée.'); return true; }
      case 'c-quiz': {
        const q = state.cq; if (!q || !c) return true;
        if (q.ans[q.i] === undefined) { q.ans[q.i] = Number(v); render(); }
        return true;
      }
      case 'c-quiz-next': {
        const q = state.cq; if (!q || !c) return true;
        q.i++;
        render();
        if (q.i >= c.quiz.length) {
          const good = q.ans.filter((x, i) => x === c.quiz[i].a).length;
          await save(c.id, { quiz: good / c.quiz.length, seen: ['quiz'] });
        }
        return true;
      }
      case 'c-quiz-again': state.cq = { id: c.id, i: 0, ans: [] }; render(); return true;
      case 'c-assign': await save(el.dataset.id, { assigned: Date.now() }, true); toast('Cours assigné : le joueur le retrouve en tête de sa liste.'); return true;
      case 'c-unassign': await save(el.dataset.id, { assigned: null }, true); return true;
      case 'c-goal': {
        const cc = Courses.byId(el.dataset.id); const p = player(); if (!cc || !p) return true;
        const g = cc.practice.goal;
        const r = await window.api.addGoals({ playerId: p.id, goals: [{ text: g.text, kpi: g.kpi, target: g.target }], source: 'coach' });
        apply(r, 'Objectif ajouté au suivi de ' + gameNameOf(p.riotId) + '.');
        return true;
      }
    }
    return false;
  }
  // curseur et listes déroulantes (sans redessiner toute la page pendant qu'on glisse)
  function input(e) {
    const t = e.target;
    if (t.dataset && t.dataset.cin === 'cs') {
      const v = Number(t.value); W(t.dataset.w).v = v;
      const o = document.getElementById('o-' + t.dataset.w); if (o) o.innerHTML = csOut(v);
      const ov = document.getElementById('o-' + t.dataset.w + 'v'); if (ov) ov.textContent = v + ' CS';
      return true;
    }
    return false;
  }
  function change(e) {
    const t = e.target;
    if (t.dataset && t.dataset.cchange === 'wincon') {
      const s = W(t.dataset.w);
      const sv = wSaved(t.dataset.c, t.dataset.w) || {};
      s.v = Object.assign({ fort: 0, gagne: 0, evite: 0 }, sv, s.v || {}, { [t.dataset.k]: Number(t.value) });
      const out = document.getElementById('wc-' + t.dataset.w); if (out) out.textContent = winconText(s.v);
      save(t.dataset.c, { w: { [t.dataset.w]: s.v } });
      return true;
    }
    return false;
  }
  // badge du menu : cours demandés par le coach, pas encore validés
  function badge() {
    if (!playerView()) return 0;
    const p = player();
    return Courses.LIST.filter(c => { const s = status(p, c); return s.assigned && !s.done; }).length;
  }

  return { page, click, input, change, badge, status, advice };
})();
