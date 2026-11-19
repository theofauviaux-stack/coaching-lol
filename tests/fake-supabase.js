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
  coach_reports: { p_key: 'text' }, coach_report_save: { p_key: 'text', p_player: 'text', p_session: 'text', p: 'jsonb' },
  // analyses de parties et vidéos
  coach_moments_push: { p_key: 'text', p: 'jsonb' }, coach_analyses: { p_key: 'text' }, coach_analysis_get: { p_key: 'text', p_id: 'uuid' },
  coach_analysis_comment: { p_key: 'text', p_id: 'uuid', p_t: 'int', p_text: 'text' }, coach_analysis_close: { p_key: 'text', p_id: 'uuid' },
  coach_clips_purge: { p_key: 'text' }, coach_clips_gone: { p_key: 'text', p_id: 'uuid' },
  moments_get: { p_token: 'text', p_match: 'text' }, analysis_create: { p_token: 'text', p: 'jsonb' }, analysis_ready: { p_token: 'text', p_id: 'uuid' },
  analyses_mine: { p_token: 'text' }, analysis_get: { p_token: 'text', p_id: 'uuid' },
  analysis_comment: { p_token: 'text', p_id: 'uuid', p_t: 'int', p_text: 'text' }
};

// Tables du stockage de Supabase (déjà présentes dans un vrai projet), avec la sécurité par ligne activée
const STORAGE_SQL = `
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  alter table storage.buckets enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;`;

async function prepareDb(db, { twice = false } = {}) {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(STORAGE_SQL);
  for (const f of ['schema.sql', 'analyses.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
    await db.exec(sql);
    if (twice) await db.exec(sql); // relançable
  }
}

// Stockage : envoi, lecture publique et effacement comme l'API de Supabase, les règles étant évaluées
// par PostgreSQL avec le rôle anonyme (clé publique).
async function storageOp(db, files, op, bucket, name, body, type) {
  if (op === 'upload') {
    const b = (await db.query(`select * from storage.buckets where id = $1`, [bucket])).rows[0];
    if (!b) return [400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }];
    if (b.file_size_limit && body.length > Number(b.file_size_limit)) return [400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }];
    if (b.allowed_mime_types && !b.allowed_mime_types.includes(String(type || '').split(';')[0])) return [400, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + type + ' is not supported' }];
    if ((await db.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rows.length) return [400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }];
    try {
      await db.transaction(async tx => {
        await tx.query(`set local role anon`);
        await tx.query(`insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)`, [bucket, name, JSON.stringify({ size: body.length, mimetype: type })]);
      });
    } catch (e) {
      return [400, { statusCode: '403', error: 'Unauthorized', message: e.message }];
    }
    files.set(bucket + '/' + name, body);
    return [200, { Key: bucket + '/' + name }];
  }
  if (op === 'delete') {
    let rows = [];
    await db.transaction(async tx => {
      await tx.query(`set local role anon`);
      rows = (await tx.query(`delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [bucket, body])).rows;
    });
    for (const r of rows) files.delete(bucket + '/' + r.name);
    return [200, rows.map(r => ({ name: r.name, bucket_id: bucket }))];
  }
  return [404, {}];
}

async function startFake() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await prepareDb(db);
  const files = new Map(); // vidéos envoyées : « clips/<analyse>/<fichier> » → contenu
  const hits = { uploads: 0, downloads: 0, deletes: 0 };
  let queue = Promise.resolve(); // une requête à la fois (PGlite n'a qu'une connexion)
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => { chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body = raw.toString('utf8');
      queue = queue.then(async () => {
        let st = req.url.match(/^\/storage\/v1\/object\/public\/([\w-]+)\/(.+)$/);
        if (st && req.method === 'GET') {
          const b = (await db.query(`select public from storage.buckets where id = $1`, [st[1]])).rows[0];
          const f = b && b.public && files.get(st[1] + '/' + decodeURIComponent(st[2]));
          if (!f) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' })); }
          hits.downloads++;
          const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
          if (range) {
            const a = Number(range[1]), z = range[2] ? Math.min(Number(range[2]), f.length - 1) : f.length - 1;
            res.writeHead(206, { 'Content-Type': 'video/webm', 'Content-Length': z - a + 1, 'Content-Range': `bytes ${a}-${z}/${f.length}`, 'Accept-Ranges': 'bytes' });
            return res.end(f.subarray(a, z + 1));
          }
          res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': f.length, 'Accept-Ranges': 'bytes' });
          return res.end(f);
        }
        st = req.url.match(/^\/storage\/v1\/object\/([\w-]+)(?:\/(.+))?$/);
        if (st && (req.method === 'POST' || req.method === 'DELETE')) {
          if (!req.headers.apikey) { res.writeHead(400); return res.end(JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: 'apikey manquante' })); }
          const del = req.method === 'DELETE';
          if (!del) hits.uploads++; else hits.deletes++;
          const [code, out] = del
            ? await storageOp(db, files, 'delete', st[1], null, JSON.parse(body || '{}').prefixes || [])
            : await storageOp(db, files, 'upload', st[1], decodeURIComponent(st[2] || ''), raw, req.headers['content-type']);
          res.writeHead(code, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(out));
        }
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
  return { db, files, hits, url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}

module.exports = { startFake, prepareDb, storageOp };
