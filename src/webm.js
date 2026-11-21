// Vidéos WebM de l'enregistreur (MediaRecorder) : elles n'ont ni durée ni index (« Cues »). Sans durée, la barre de
// lecture ne marche pas (durée « infinie ») ; sans index, chaque saut dans la vidéo oblige à tout lire depuis le début
// (lent quand la vidéo vient du serveur). makeSeekable réécrit le fichier, sans réencoder l'image :
//   en-tête EBML ; Segment (taille connue) { SeekHead, Info (+ Duration), Tracks, Cues, Clusters (tailles connues) }.
// Renvoie null si le fichier est déjà navigable ou si sa structure est inattendue (on le laisse alors tel quel).
const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7,
  TrackType: 0x83, DefaultDuration: 0x23e383, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0,
  Block: 0xa1, ReferenceBlock: 0xfb, Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7,
  CueClusterPosition: 0xf1, Void: 0xec, Tags: 0x1254c367, Chapters: 0x1043a770, Attachments: 0x1941a469
};
const TOP = new Set([ID.Cluster, ID.Cues, ID.Tags, ID.Chapters, ID.Attachments, ID.SeekHead, ID.Info, ID.Tracks]);

// ---- lecture
function readId(b, p) {
  const x = b[p];
  if (x === undefined) return null;
  const len = x >= 0x80 ? 1 : x >= 0x40 ? 2 : x >= 0x20 ? 3 : x >= 0x10 ? 4 : 0;
  if (!len || p + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}
function readSize(b, p) {
  const x = b[p];
  if (x === undefined || x === 0) return null;
  let len = 1;
  while (!(x & (0x80 >> (len - 1)))) len++;
  if (p + len > b.length) return null;
  let v = x & (0xff >> len), allOnes = v === (0xff >> len);
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  return { size: allOnes ? -1 : v, len }; // -1 : taille inconnue (écriture en direct)
}
function readEl(b, p, end) {
  const id = readId(b, p);
  if (!id) return null;
  const sz = readSize(b, p + id.len);
  if (!sz) return null;
  const data = p + id.len + sz.len;
  if (data > end) return null;
  return { id: id.id, start: p, data, size: sz.size, end: sz.size < 0 ? -1 : data + sz.size };
}
const readUint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
function children(b, from, to) {
  const out = [];
  for (let p = from; p < to;) {
    const e = readEl(b, p, to);
    if (!e || e.end < 0 || e.end > to) return null;
    out.push(e);
    p = e.end;
  }
  return out;
}

// ---- écriture
function idBytes(id) { const a = []; for (let v = id; v > 0; v = Math.floor(v / 256)) a.unshift(v & 0xff); return Buffer.from(a); }
function sizeBytes(n, len) {
  if (!len) { len = 1; while (n >= 2 ** (7 * len) - 1) len++; }
  const a = Buffer.alloc(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) { a[i] = v % 256; v = Math.floor(v / 256); }
  a[0] |= 0x80 >> (len - 1);
  return a;
}
const el = (id, data, len) => Buffer.concat([idBytes(id), sizeBytes(data.length, len), data]);
function uintBytes(v, len) {
  if (!len) { len = 1; while (v >= 2 ** (8 * len)) len++; }
  const a = Buffer.alloc(len);
  for (let i = len - 1; i >= 0; i--) { a[i] = v % 256; v = Math.floor(v / 256); }
  return a;
}
const uel = (id, v, len) => el(id, uintBytes(v, len));

function makeSeekable(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const head = readEl(b, 0, b.length);
  if (!head || head.id !== ID.EBML || head.end < 0) return null;
  const seg = readEl(b, head.end, b.length);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.size < 0 || seg.end > b.length ? b.length : seg.end;
  // éléments du Segment ; un Cluster de taille inconnue se termine au prochain élément de premier niveau
  const top = [];
  for (let p = seg.data; p < segEnd;) {
    const e = readEl(b, p, segEnd);
    if (!e) break; // fin tronquée : on s'arrête au dernier élément complet
    if (e.end < 0) {
      if (e.id !== ID.Cluster) return null;
      let q = e.data;
      while (q < segEnd) {
        const c = readEl(b, q, segEnd);
        if (!c || TOP.has(c.id) || c.end < 0 || c.end > segEnd) break;
        q = c.end;
      }
      e.end = q;
    } else if (e.end > segEnd) break;
    top.push(e);
    p = e.end;
  }
  const info = top.find(e => e.id === ID.Info);
  const tracks = top.find(e => e.id === ID.Tracks);
  const clusters = top.filter(e => e.id === ID.Cluster);
  if (!info || !tracks || !clusters.length) return null;
  if (top.some(e => e.id === ID.Cues)) return null; // déjà indexée
  const infoKids = children(b, info.data, info.end);
  if (!infoKids) return null;
  const hasDuration = infoKids.some(e => e.id === ID.Duration);
  const scaleEl = infoKids.find(e => e.id === ID.TimecodeScale);
  const scale = scaleEl ? readUint(b, scaleEl.data, scaleEl.size) : 1000000;
  // piste vidéo (pour l'index) ; à défaut la première
  let videoTrack = null, frameDur = 0;
  for (const t of (children(b, tracks.data, tracks.end) || []).filter(e => e.id === ID.TrackEntry)) {
    const k = children(b, t.data, t.end) || [];
    const num = k.find(e => e.id === ID.TrackNumber), type = k.find(e => e.id === ID.TrackType), dd = k.find(e => e.id === ID.DefaultDuration);
    const n = num ? readUint(b, num.data, num.size) : null;
    if (videoTrack === null || (type && readUint(b, type.data, type.size) === 1)) { videoTrack = n; if (dd) frameDur = readUint(b, dd.data, dd.size) / scale; }
  }
  if (videoTrack === null) return null;
  // clusters : début, images clés, dernière image
  let last = 0, prev = null, step = 0;
  const cues = [];
  const bodies = [];
  for (const c of clusters) {
    const kids = children(b, c.data, c.end);
    if (!kids) return null;
    const tc = kids.find(e => e.id === ID.Timecode);
    if (!tc) return null;
    const base = readUint(b, tc.data, tc.size);
    let cue = null;
    for (const k of kids) {
      let blk = null, key = false; // key : null = drapeau du SimpleBlock
      if (k.id === ID.SimpleBlock) { blk = k.data; key = null; } else if (k.id === ID.BlockGroup) {
        const g = children(b, k.data, k.end) || [];
        const inner = g.find(e => e.id === ID.Block);
        if (inner) { blk = inner.data; key = !g.some(e => e.id === ID.ReferenceBlock); } // image clé : sans référence
      }
      if (blk === null) continue;
      const tn = readSize(b, blk);
      if (!tn) return null;
      const rel = b.readInt16BE(blk + tn.len);
      const flags = b[blk + tn.len + 2];
      const t = base + rel;
      if (tn.size === videoTrack) {
        if (prev !== null && t > prev) step = t - prev;
        prev = t;
        if (cue === null && (key === null ? flags & 0x80 : key)) cue = t; // SimpleBlock : drapeau « image clé »
      }
      if (t > last) last = t;
    }
    bodies.push({ data: b.subarray(c.data, c.end), cue });
    if (cue !== null) cues.push({ time: cue, i: bodies.length - 1 });
  }
  if (hasDuration && cues.length === 0) return null;
  const duration = last + (step || frameDur || Math.round(33000000 / scale));
  // Info avec la durée (float 64 bits, en unités de TimecodeScale)
  const durBuf = Buffer.alloc(8);
  durBuf.writeDoubleBE(duration);
  const infoOut = el(ID.Info, Buffer.concat([...infoKids.filter(e => e.id !== ID.Duration).map(e => b.subarray(e.start, e.end)), el(ID.Duration, durBuf)]));
  const tracksOut = b.subarray(tracks.start, tracks.end);
  const others = top.filter(e => ![ID.Info, ID.Tracks, ID.Cluster, ID.SeekHead, ID.Void, ID.Cues].includes(e.id)).map(e => b.subarray(e.start, e.end));
  // positions sur 8 octets : les tailles ne dépendent pas des valeurs, on peut tout calculer d'avance
  const seekEntry = (id, pos) => el(ID.Seek, Buffer.concat([el(ID.SeekID, idBytes(id)), uel(ID.SeekPosition, pos, 8)]));
  const seekHead = pos => el(ID.SeekHead, Buffer.concat([seekEntry(ID.Info, pos.info), seekEntry(ID.Tracks, pos.tracks), seekEntry(ID.Cues, pos.cues)]));
  const cuesEl = offs => el(ID.Cues, Buffer.concat(cues.map(c => el(ID.CuePoint, Buffer.concat([uel(ID.CueTime, c.time),
    el(ID.CueTrackPositions, Buffer.concat([uel(ID.CueTrack, videoTrack), uel(ID.CueClusterPosition, offs[c.i], 8)]))])))));
  const clusterOut = bodies.map(x => Buffer.concat([idBytes(ID.Cluster), sizeBytes(x.data.length, 8)]));
  const shLen = seekHead({ info: 0, tracks: 0, cues: 0 }).length;
  const cuesLen = cuesEl(bodies.map(() => 0)).length;
  const pos = { info: shLen };
  pos.tracks = pos.info + infoOut.length;
  pos.cues = pos.tracks + tracksOut.length;
  let p = pos.cues + cuesLen + others.reduce((n, x) => n + x.length, 0);
  const offs = bodies.map((x, i) => { const o = p; p += clusterOut[i].length + x.data.length; return o; });
  const content = [seekHead(pos), infoOut, tracksOut, cuesEl(offs), ...others];
  bodies.forEach((x, i) => content.push(clusterOut[i], x.data));
  const total = content.reduce((n, x) => n + x.length, 0);
  return Buffer.concat([b.subarray(0, head.end), idBytes(ID.Segment), sizeBytes(total, 8), ...content]);
}

// Vidéo déjà navigable ? (durée dans les premiers octets)
function isSeekable(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const head = readEl(b, 0, b.length);
  if (!head || head.id !== ID.EBML || head.end < 0) return false;
  const seg = readEl(b, head.end, b.length);
  if (!seg || seg.id !== ID.Segment) return false;
  for (let p = seg.data, n = 0; p < b.length && n < 8; n++) {
    const e = readEl(b, p, b.length);
    if (!e || e.end < 0) return false;
    if (e.id === ID.Cluster) return false;
    if (e.id === ID.Info) {
      if (e.end > b.length) return false;
      const k = children(b, e.data, e.end);
      if (!k || !k.some(x => x.id === ID.Duration)) return false;
    }
    if (e.id === ID.Cues) return true;
    p = e.end;
  }
  return false;
}

// Description d'un fichier (tests, journal) : durée en secondes, index, images
function describe(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const head = readEl(b, 0, b.length);
  if (!head || head.id !== ID.EBML) return null;
  const seg = readEl(b, head.end, b.length);
  if (!seg || seg.id !== ID.Segment) return null;
  const out = { segmentSize: seg.size, duration: null, cues: [], clusters: [], blocks: [] };
  let scale = 1000000;
  const segEnd = seg.size < 0 ? b.length : Math.min(seg.end, b.length);
  for (let p = seg.data; p < segEnd;) {
    const e = readEl(b, p, segEnd);
    if (!e) break;
    if (e.id === ID.Cluster && e.end < 0) return Object.assign(out, { unknownCluster: true });
    if (e.id === ID.Info) for (const k of children(b, e.data, e.end) || []) {
      if (k.id === ID.TimecodeScale) scale = readUint(b, k.data, k.size);
      if (k.id === ID.Duration) out.duration = k.size === 8 ? b.readDoubleBE(k.data) : b.readFloatBE(k.data);
    }
    if (e.id === ID.Cues) for (const cp of children(b, e.data, e.end) || []) {
      const k = children(b, cp.data, cp.end) || [];
      const t = k.find(x => x.id === ID.CueTime), tp = k.find(x => x.id === ID.CueTrackPositions);
      const pos = tp && (children(b, tp.data, tp.end) || []).find(x => x.id === ID.CueClusterPosition);
      out.cues.push({ time: t ? readUint(b, t.data, t.size) * scale / 1e9 : null, pos: pos ? readUint(b, pos.data, pos.size) : null });
    }
    if (e.id === ID.Cluster) {
      out.clusters.push(e.start - seg.data);
      for (const k of children(b, e.data, e.end) || []) {
        if (k.id === ID.SimpleBlock) out.blocks.push(b.subarray(k.data, k.end));
        if (k.id === ID.BlockGroup) for (const g of children(b, k.data, k.end) || []) if (g.id === ID.Block) out.blocks.push(b.subarray(g.data, g.end));
      }
    }
    p = e.end;
  }
  if (out.duration !== null) out.duration = out.duration * scale / 1e9;
  return out;
}

module.exports = { makeSeekable, isSeekable, describe };
