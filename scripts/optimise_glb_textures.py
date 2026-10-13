# Downscale a GLB's textures and rewrite it. Geometry and animations untouched.
import json, struct, sys, io
from PIL import Image

SRC = sys.argv[1]; DST = sys.argv[2]
# Target edge per map role. Base colour carries the livery and is the only
# one that needs resolution at this range; occlusion and specular are
# low-frequency and were costing 89 MB of GPU each at 4096.
TARGET = {'base': 2048, 'normal': 1024, 'occlusion': 512, 'specular': 512,
          'metallicRoughness': 512, 'emissive': 512, 'other': 1024}

raw = open(SRC,'rb').read()
jlen = struct.unpack('<I', raw[12:16])[0]
gltf = json.loads(raw[20:20+jlen])
boff = 20+jlen+8
blen = struct.unpack('<I', raw[20+jlen:24+jlen])[0]
bin_ = raw[boff:boff+blen]

# role per image index, read from the materials rather than assumed
role = {}
def mark(tex, r):
    if isinstance(tex, dict) and 'index' in tex:
        role[gltf['textures'][tex['index']]['source']] = r
for m in gltf.get('materials', []):
    pbr = m.get('pbrMetallicRoughness', {})
    mark(pbr.get('baseColorTexture'), 'base')
    mark(pbr.get('metallicRoughnessTexture'), 'metallicRoughness')
    mark(m.get('normalTexture'), 'normal')
    mark(m.get('occlusionTexture'), 'occlusion')
    mark(m.get('emissiveTexture'), 'emissive')
    spec = m.get('extensions', {}).get('KHR_materials_specular', {})
    mark(spec.get('specularTexture'), 'specular')
    mark(spec.get('specularColorTexture'), 'specular')

new_img = {}
gpu_before = gpu_after = 0
for i, im in enumerate(gltf.get('images', [])):
    bv = gltf['bufferViews'][im['bufferView']]
    o = bv.get('byteOffset', 0)
    data = bin_[o:o+bv['byteLength']]
    img = Image.open(io.BytesIO(data))
    w, h = img.size
    r = role.get(i, 'other')
    tgt = TARGET[r]
    gpu_before += w*h*4*1.333
    if max(w, h) > tgt:
        sc = tgt/max(w, h)
        img = img.resize((max(1,int(w*sc)), max(1,int(h*sc))), Image.LANCZOS)
    nw, nh = img.size
    gpu_after += nw*nh*4*1.333
    # JPEG where there is no meaningful alpha: shrinks the FILE too, which
    # is what the first-load stall is. Normal maps stay PNG, and so does
    # anything actually using its alpha channel.
    alpha = img.mode in ('RGBA','LA') and img.getchannel('A').getextrema()[0] < 255
    buf = io.BytesIO()
    if alpha or r == 'normal':
        img.save(buf, format='PNG', compress_level=9)
        mime = 'image/png'
    else:
        img.convert('RGB').save(buf, format='JPEG', quality=90, optimize=True)
        mime = 'image/jpeg'
    new_img[i] = buf.getvalue()
    im['mimeType'] = mime
    print(f"  image {i:2d} {r:17s} {w}x{h} -> {nw}x{nh}  "
          f"{bv['byteLength']/1e6:6.1f} MB -> {len(new_img[i])/1e6:5.2f} MB {mime.split('/')[1]}")

# rebuild the binary chunk, recomputing every bufferView offset
img_bv = {im['bufferView']: i for i, im in enumerate(gltf.get('images', []))}
out = bytearray()
for bi, bv in enumerate(gltf['bufferViews']):
    if bi in img_bv:
        data = new_img[img_bv[bi]]
    else:
        o = bv.get('byteOffset', 0)
        data = bin_[o:o+bv['byteLength']]
    while len(out) % 4: out.append(0)
    bv['byteOffset'] = len(out)
    bv['byteLength'] = len(data)
    out += data
while len(out) % 4: out.append(0)
gltf['buffers'][0]['byteLength'] = len(out)
gltf['buffers'][0].pop('uri', None)

js = json.dumps(gltf, separators=(',',':')).encode('utf8')
while len(js) % 4: js += b' '
glb = (b'glTF' + struct.pack('<II', 2, 12+8+len(js)+8+len(out))
       + struct.pack('<I', len(js)) + b'JSON' + js
       + struct.pack('<I', len(out)) + b'BIN\x00' + bytes(out))
open(DST,'wb').write(glb)
print(f"\n  file  {len(raw)/1e6:.1f} MB -> {len(glb)/1e6:.1f} MB")
print(f"  GPU   {gpu_before/1e6:.0f} MB -> {gpu_after/1e6:.0f} MB "
      f"({gpu_before/gpu_after:.1f}x less)")
