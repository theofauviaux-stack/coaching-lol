// Fenêtre cachée : filme une fenêtre (ou l'écran) et renvoie la vidéo (WebM).
// Échanges avec l'app : rec:start → « started » (la capture tourne) → « health » toutes les 0,5 s (image réduite :
// luminosité, différence avec l'image précédente, taille de la vidéo) → rec:stop → rec:done (vidéo, ou abandon).
const live = new Map(); // id → enregistrement en cours
const early = new Map(); // arrêts demandés avant le démarrage effectif
const SW = 64, SH = 36;

window.rec.onStart(async ({ id, sourceId, w, h, fps, bps }) => {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: w, maxHeight: h, maxFrameRate: fps } }
    });
    const track = stream.getVideoTracks()[0];
    // lecteur muet pour échantillonner l'image (64 × 36) : noire ? figée ?
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = stream;
    await Promise.race([v.play().catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, bitsPerSecond: bps });
    const job = { r, chunks: [], bytes: 0, discard: false, timer: null };
    live.set(id, job);
    const cv = document.createElement('canvas');
    cv.width = SW; cv.height = SH;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let prev = null;
    const sample = () => {
      const ev = { id, type: 'health', bytes: job.bytes };
      try {
        if (v.readyState >= 2 && v.videoWidth > 0) {
          cx.drawImage(v, 0, 0, SW, SH);
          const d = cx.getImageData(0, 0, SW, SH).data;
          const lum = new Uint8Array(SW * SH);
          let sum = 0, max = 0, diff = 0;
          for (let i = 0, j = 0; i < d.length; i += 4, j++) {
            const l = (d[i] * 2 + d[i + 1] * 5 + d[i + 2]) >> 3;
            lum[j] = l; sum += l;
            if (l > max) max = l;
            if (prev && Math.abs(l - prev[j]) > 2) diff++;
          }
          Object.assign(ev, { mean: Math.round(sum / lum.length), max, diff: prev ? diff : null });
          prev = lum;
        }
      } catch (e) { /* image illisible : pas de mesure */ }
      window.rec.event(ev);
    };
    r.ondataavailable = e => { if (e.data && e.data.size) { job.chunks.push(e.data); job.bytes += e.data.size; } };
    r.onstop = async () => {
      clearInterval(job.timer);
      stream.getTracks().forEach(t => t.stop());
      v.srcObject = null;
      live.delete(id);
      if (job.discard) { window.rec.done({ id, cancelled: true }); return; }
      try {
        const data = await new Blob(job.chunks, { type: mime }).arrayBuffer();
        window.rec.done({ id, data, bytes: data.byteLength, mime });
      } catch (e) { window.rec.done({ id, error: (e && e.message) || String(e) }); }
    };
    r.onerror = e => {
      clearInterval(job.timer);
      stream.getTracks().forEach(t => t.stop());
      live.delete(id);
      window.rec.done({ id, error: (e && e.error && e.error.message) || 'erreur de l\'enregistreur' });
    };
    r.onstart = () => {
      const s = track.getSettings ? track.getSettings() : {};
      window.rec.event({ id, type: 'started', width: s.width, height: s.height, frameRate: s.frameRate, mime, bps });
      job.timer = setInterval(sample, 500);
      if (early.has(id)) { job.discard = early.get(id); early.delete(id); r.stop(); }
    };
    r.start(1000);
  } catch (e) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    window.rec.done({ id, error: (e && e.message) || String(e) });
  }
});

window.rec.onStop(({ id, discard }) => {
  const job = live.get(id);
  if (!job) { early.set(id, !!discard); return; }
  job.discard = !!discard;
  if (job.r.state !== 'inactive') job.r.stop();
});
