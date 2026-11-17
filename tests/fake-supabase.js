// Faux serveur Supabase pour les tests : PostgreSQL (PGlite) avec le vrai schéma, et les appels
// « /rest/v1/rpc/<fonction> » comme PostgREST. Jamais utilisé par l'app installée.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SIG = {
  login: { p_code: 'text' }, get_data: { p_token: 'text' }, logout: { p_token: 'text' },
  coach_push: { p_key: 'text', p: 'jsonb' },
  book: { p_token: 'text', p_action: 'text', p_id: 'uuid', p_start: 'timestamptz' },
  bookings_mine: { p_token: 'text' }, coach_bookings: { p_key: 'text' },
  coach_book: { p_key: 'text', p_action: 'text', p_id: 'uuid', p_start: 'timestamptz', p_player: 'text' },
  report_save: { p_token: 'text', p_session: 'text', p: 'jsonb' }, reports_mine: { p_token: 'text' },
  coach_reports: { p_key: 'text' }, coach_report_save: { p_key: 'text', p_player: 'text', p_session: 'text', p: 'jsonb' }
};

async function startFake() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8'));
  let queue = Promise.resolve(); // une requête à la fois (PGlite n'a qu'une connexion)
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      queue = queue.then(async () => {
        const m = req.url.match(/^\/rest\/v1\/rpc\/(\w+)$/);
        const sig = m && SIG[m[1]];
        if (!sig || req.method !== 'POST') { res.writeHead(404); return res.end('{}'); }
        try {
          const args = JSON.parse(body || '{}');
          const keys = Object.keys(sig);
          const vals = keys.map(k => (args[k] === undefined || args[k] === null ? null : sig[k] === 'jsonb' ? JSON.stringify(args[k]) : args[k]));
          const q = `select public.${m[1]}(${keys.map((k, i) => `${k} := $${i + 1}::${sig[k]}`).join(', ')}) as r`;
          const r = (await db.query(q, vals)).rows[0].r;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r === undefined ? null : r));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: e.message }));
        }
      });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { db, url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}

module.exports = { startFake };
