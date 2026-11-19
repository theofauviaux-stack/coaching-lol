// Fenêtre cachée : filme une fenêtre (ou l'écran) pendant `ms` millisecondes et renvoie la vidéo (WebM).
window.rec.onStart(async ({ id, sourceId, ms, w, h, fps, bps }) => {
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: w, maxHeight: h, maxFrameRate: fps } }
    });
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
    const chunks = [];
    r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const data = await new Blob(chunks, { type: mime }).arrayBuffer();
      window.rec.done({ id, data, bytes: data.byteLength });
    };
    r.start(1000);
    setTimeout(() => { if (r.state !== 'inactive') r.stop(); }, ms);
  } catch (e) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    window.rec.done({ id, error: (e && e.message) || String(e) });
  }
});
