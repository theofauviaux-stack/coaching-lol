#!/usr/bin/env python3
"""Fabrique les icônes de l'app à partir de build/icon.svg (viewBox 0 0 100 100, tuile arrondie).

  python3 tools/icones.py

Écrit :
  build/icon.icns  Mac (grille Apple : tuile 824 px centrée dans 1024, ombre douce)
  build/icon.ico   Windows (16 à 256 px, tuile pleine)
  build/icon.png   1024 px (Linux et secours)
  renderer/logo.js le même logo pour l'intérieur de l'app (menu, écran du code)
Demande rsvg-convert et Pillow (outil de développement, pas utilisé par l'app).
"""
import io, os, struct, subprocess, sys, tempfile
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')
SVG = os.path.join(BUILD, 'icon.svg')

def render(size, svg=SVG):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'r.png')
        subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), svg, '-o', out], check=True)
        return Image.open(out).convert('RGBA').copy()

def mac_icon(size):
    """Tuile à 80,5 % (824/1024) avec une ombre portée légère, comme les icônes Mac."""
    tile = round(size * 824 / 1024)
    off = (size - tile) // 2
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    art = render(tile)
    if size >= 64:
        alpha = art.split()[3]
        shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        sh = Image.new('RGBA', art.size, (0, 0, 0, 90))
        sh.putalpha(alpha.point(lambda a: a * 90 // 255))
        shadow.paste(sh, (off, off + round(size * 10 / 1024)), sh)
        shadow = shadow.filter(ImageFilter.GaussianBlur(size * 14 / 1024))
        canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(art, (off, off))
    return canvas

def png_bytes(im):
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()

def write_icns(path):
    # types PNG : ic11 16@2x(32), ic12 32@2x(64), ic07 128, ic13 128@2x(256), ic08 256,
    # ic14 256@2x(512), ic09 512, ic10 512@2x(1024)
    entries = [('ic11', 32), ('ic12', 64), ('ic07', 128), ('ic13', 256), ('ic08', 256),
               ('ic14', 512), ('ic09', 512), ('ic10', 1024)]
    cache, body = {}, b''
    for kind, size in entries:
        if size not in cache:
            cache[size] = png_bytes(mac_icon(size))
        data = cache[size]
        body += kind.encode() + struct.pack('>I', len(data) + 8) + data
    with open(path, 'wb') as f:
        f.write(b'icns' + struct.pack('>I', len(body) + 8) + body)

def dib_bytes(im):
    """Image BMP 32 bits (BGRA, de bas en haut) + masque, format classique des ICO."""
    w, h = im.size
    head = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = im.tobytes('raw', 'BGRA')
    rows = [px[y * w * 4:(y + 1) * w * 4] for y in range(h)]
    mask_row = ((w + 31) // 32) * 4
    return head + b''.join(reversed(rows)) + b'\0' * (mask_row * h)

def write_logo_js(path):
    """Le SVG pour l'interface : un seul dessin pour l'icône de l'app et le logo du menu."""
    import json, re
    src = open(SVG, encoding='utf-8').read()
    inner = re.search(r'<svg[^>]*>(.*)</svg>', src, re.S).group(1).strip()
    js = (
        "// Généré par tools/icones.py depuis build/icon.svg : ne pas modifier à la main.\n"
        "(function (root) {\n"
        "  const SVG = " + json.dumps(inner, ensure_ascii=False) + ";\n"
        "  let n = 0;\n"
        "  // ids uniques : plusieurs logos peuvent être affichés en même temps\n"
        "  root.brandLogo = (size = 32, label = '') => {\n"
        "    const k = 'lg' + (++n);\n"
        "    const body = SVG.replace(/id=\"([^\"]+)\"/g, (m, id) => `id=\"${k}-${id}\"`).replace(/url\\(#([^)]+)\\)/g, (m, id) => `url(#${k}-${id})`);\n"
        "    const a11y = label ? `role=\"img\" aria-label=\"${label}\"` : 'aria-hidden=\"true\"';\n"
        "    return `<svg class=\"brand-logo\" width=\"${size}\" height=\"${size}\" viewBox=\"0 0 100 100\" ${a11y}>${body}</svg>`;\n"
        "  };\n"
        "})(window);\n")
    open(path, 'w', encoding='utf-8').write(js)

def write_ico(path):
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [render(s) for s in sizes]
    # chaque taille rendue directement depuis le SVG (net en petit) ;
    # BMP sous 256 px (accepté par l'installateur NSIS), PNG pour 256 px
    head = struct.pack('<HHH', 0, 1, len(imgs))
    offset = 6 + 16 * len(imgs)
    dirs, blobs = b'', b''
    for s, im in zip(sizes, imgs):
        data = png_bytes(im) if s >= 256 else dib_bytes(im)
        dirs += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    with open(path, 'wb') as f:
        f.write(head + dirs + blobs)

if __name__ == '__main__':
    if not os.path.exists(SVG):
        sys.exit('build/icon.svg manquant')
    write_icns(os.path.join(BUILD, 'icon.icns'))
    write_ico(os.path.join(BUILD, 'icon.ico'))
    mac_icon(1024).save(os.path.join(BUILD, 'icon.png'))
    write_logo_js(os.path.join(ROOT, 'renderer', 'logo.js'))
    print('icônes écrites dans build/')
