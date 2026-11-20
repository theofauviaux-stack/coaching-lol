// Généré par tools/icones.py depuis build/icon.svg : ne pas modifier à la main.
(function (root) {
  const SVG = "<defs><linearGradient id=\"fond\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#1d2429\"/><stop offset=\"1\" stop-color=\"#0f1214\"/></linearGradient></defs><rect width=\"100\" height=\"100\" rx=\"22\" fill=\"url(#fond)\"/><rect x=\".5\" y=\".5\" width=\"99\" height=\"99\" rx=\"21.5\" fill=\"none\" stroke=\"#2a3238\" stroke-width=\"1\"/><path d=\"M13 50C24 33 36 26 50 26s26 7 37 24C76 67 64 74 50 74S24 67 13 50Z\" fill=\"#c3ec7f\"/><circle cx=\"50\" cy=\"50\" r=\"17\" fill=\"#12160f\"/><circle cx=\"50\" cy=\"50\" r=\"8\" fill=\"#c3ec7f\"/><circle cx=\"56\" cy=\"44\" r=\"3.5\" fill=\"#ecefec\"/>";
  // ids propres à chaque taille (menu, écran du code) et stables d'un affichage à l'autre
  root.brandLogo = (size = 32, label = '') => {
    const k = 'lg' + size;
    const body = SVG.replace(/id="([^"]+)"/g, (m, id) => `id="${k}-${id}"`).replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${k}-${id})`);
    const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
    return `<svg class="brand-logo" width="${size}" height="${size}" viewBox="0 0 100 100" ${a11y}>${body}</svg>`;
  };
})(window);
