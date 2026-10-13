#!/usr/bin/env python3
"""Lift a skinned model's rigid sub-assemblies out into plain nodes.

Why
---
Driving a skeleton JOINT costs: Cesium re-evaluates the skin. Measured on
this model, 4 joints (the airbrakes) was fine and 48 (the landing gear)
put the frame rate on the floor. A plain unskinned node is a matrix
multiply, which is why the Mi-24's rotors and the quadcopter's blades
spin every frame for free.

This model's gear and airbrakes are not really "skinned" at all. Every
one of the 51,140 vertices riding those 104 joints is weighted 1.000 to
exactly ONE joint, so each part is a rigid body wearing a skin it does
not need.

What it does
------------
For each matching joint:
  * new node, local matrix = that joint's BIND global transform,
    which is inverse(inverseBindMatrix)
  * new mesh, vertices premultiplied by inverseBindMatrix so they sit in
    the joint's own space, so node_matrix * vertex reproduces exactly
    where the part sits today
  * the part's triangles are removed from the skinned primitive

Then driving it is nodeTransformations on a plain node, and Cesium's
  node.matrix = originalMatrix * yourTransform
makes `yourTransform` the delta from bind to wherever you want it.

Triangles whose three corners do NOT share one joint are left behind in
the skinned mesh and reported, because splitting them would tear a seam.

Usage
-----
  python3 scripts/split_airliner_surfaces.py in.glb out.glb 'wheel|gear|brake'
"""
import json, struct, sys, re, math

SRC, DST, PATTERN = sys.argv[1], sys.argv[2], sys.argv[3]
# Animation time whose pose becomes the DELTA target, and the file the
# manifest is written to. A part can appear in several meshes with
# different materials, so one joint maps to SEVERAL nodes; the manifest
# is how the app knows to drive them together.
DELTA_T = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
MANIFEST = sys.argv[5] if len(sys.argv) > 5 else None

raw = open(SRC, 'rb').read()
jlen = struct.unpack('<I', raw[12:16])[0]
gltf = json.loads(raw[20:20 + jlen])
bin_off = 20 + jlen + 8
bin_len = struct.unpack('<I', raw[20 + jlen:24 + jlen])[0]
blob = bytearray(raw[bin_off:bin_off + bin_len])

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
      5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def acc_read(i):
    a = gltf['accessors'][i]
    fmt, sz = CT[a['componentType']]; nc = NC[a['type']]
    bv = gltf['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or sz * nc
    return [struct.unpack_from('<' + fmt * nc, blob, base + k * stride)
            for k in range(a['count'])]

def mat_mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]

def mat_inv(M):
    R = [[M[i][j] for j in range(3)] for i in range(3)]
    s = [math.sqrt(sum(R[i][j] ** 2 for i in range(3))) or 1.0 for j in range(3)]
    Rn = [[R[i][j] / s[j] for j in range(3)] for i in range(3)]
    Ri = [[Rn[j][i] / s[i] for j in range(3)] for i in range(3)]
    t = [M[i][3] for i in range(3)]
    ti = [-sum(Ri[i][j] * t[j] for j in range(3)) for i in range(3)]
    return [Ri[i] + [ti[i]] for i in range(3)] + [[0, 0, 0, 1]]

def xform_pt(M, p):
    return [sum(M[i][j] * p[j] for j in range(3)) + M[i][3] for i in range(3)]

def xform_dir(M, p):
    return [sum(M[i][j] * p[j] for j in range(3)) for i in range(3)]

names = [n.get('name', f'node{i}') for i, n in enumerate(gltf['nodes'])]
skin = gltf['skins'][0]
joints = skin['joints']
ibm_flat = acc_read(skin['inverseBindMatrices'])
# glTF matrices are COLUMN major
IBM = []
for m in ibm_flat:
    IBM.append([[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]])

pat = re.compile(PATTERN, re.I)
targets = [ji for ji, nd in enumerate(joints) if pat.search(names[nd])]
print(f"joints matching /{PATTERN}/: {len(targets)}")

def add_view(data, stride=None, target=None):
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob.extend(data)
    bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target: bv['target'] = target
    gltf['bufferViews'].append(bv)
    return len(gltf['bufferViews']) - 1

def add_acc(data, comp, typ, count, mins=None, maxs=None, target=None):
    bv = add_view(data, target=target)
    a = {'bufferView': bv, 'componentType': comp, 'count': count, 'type': typ}
    if mins: a['min'] = mins; a['max'] = maxs
    gltf['accessors'].append(a)
    return len(gltf['accessors']) - 1

new_nodes, mixed_total, moved_tris = [], 0, 0
part_nodes = {}

for mi, mesh in enumerate(gltf['meshes']):
    for pi, prim in enumerate(list(mesh['primitives'])):
        at = prim['attributes']
        if 'JOINTS_0' not in at or 'indices' not in prim:
            continue
        J = acc_read(at['JOINTS_0']); W = acc_read(at['WEIGHTS_0'])
        POS = acc_read(at['POSITION'])
        NRM = acc_read(at['NORMAL']) if 'NORMAL' in at else None
        UV = acc_read(at['TEXCOORD_0']) if 'TEXCOORD_0' in at else None
        idx = [i[0] for i in acc_read(prim['indices'])]

        def dom(v):
            best, bw = None, 0.0
            for jj, ww in zip(J[v], W[v]):
                if ww > bw: best, bw = jj, ww
            return best

        keep, by_joint = [], {}
        for t in range(0, len(idx), 3):
            tri = idx[t:t + 3]
            d = [dom(v) for v in tri]
            if d[0] in targets and d[0] == d[1] == d[2]:
                by_joint.setdefault(d[0], []).append(tri)
            else:
                if any(x in targets for x in d) and not (d[0] == d[1] == d[2]):
                    mixed_total += 1
                keep.extend(tri)

        for ji, tris in by_joint.items():
            vmap, verts = {}, []
            for tri in tris:
                for v in tri:
                    if v not in vmap:
                        vmap[v] = len(verts); verts.append(v)
            M = IBM[ji]
            P, N, T, I = bytearray(), bytearray(), bytearray(), bytearray()
            mn = [1e30] * 3; mx = [-1e30] * 3
            for v in verts:
                p = xform_pt(M, POS[v])
                for c in range(3):
                    mn[c] = min(mn[c], p[c]); mx[c] = max(mx[c], p[c])
                P += struct.pack('<fff', *p)
                if NRM:
                    n = xform_dir(M, NRM[v])
                    ln = math.sqrt(sum(c * c for c in n)) or 1.0
                    N += struct.pack('<fff', *[c / ln for c in n])
                if UV: T += struct.pack('<ff', *UV[v][:2])
            for tri in tris:
                for v in tri: I += struct.pack('<I', vmap[v])
            attrs = {'POSITION': add_acc(bytes(P), 5126, 'VEC3', len(verts), mn, mx,
                                        target=34962)}
            if NRM: attrs['NORMAL'] = add_acc(bytes(N), 5126, 'VEC3', len(verts), target=34962)
            if UV: attrs['TEXCOORD_0'] = add_acc(bytes(T), 5126, 'VEC2', len(verts), target=34962)
            np_ = {'attributes': attrs,
                   'indices': add_acc(bytes(I), 5125, 'SCALAR', len(tris) * 3, target=34963)}
            if 'material' in prim: np_['material'] = prim['material']
            gltf['meshes'].append({'name': f'rigid_{names[joints[ji]]}',
                                   'primitives': [np_]})
            G = mat_inv(M)   # bind global transform of the joint
            col = [G[0][0], G[1][0], G[2][0], 0, G[0][1], G[1][1], G[2][1], 0,
                   G[0][2], G[1][2], G[2][2], 0, G[0][3], G[1][3], G[2][3], 1]
            nname = f'rigid_{names[joints[ji]]}__{len(new_nodes)}'
            gltf['nodes'].append({'name': nname,
                                  'mesh': len(gltf['meshes']) - 1,
                                  'matrix': col})
            new_nodes.append(len(gltf['nodes']) - 1)
            part_nodes.setdefault(names[joints[ji]], []).append(nname)
            moved_tris += len(tris)

        # rewrite the skinned primitive without the extracted triangles
        if len(keep) != len(idx):
            I2 = bytearray()
            for v in keep: I2 += struct.pack('<I', v)
            prim['indices'] = add_acc(bytes(I2), 5125, 'SCALAR', len(keep), target=34963)

# ---- deltas: the joint's GLOBAL transform at DELTA_T, relative to bind.
# Cesium does node.matrix = originalMatrix * yourTransform, and the
# original matrix we just wrote IS the bind global, so the delta is
# inverse(bindGlobal) * globalAt(DELTA_T).
parent = {}
for i, n in enumerate(gltf['nodes']):
    for c in n.get('children', []):
        parent[c] = i

anim = gltf['animations'][0] if gltf.get('animations') else None
sampled = {}
if anim:
    for ch in anim['channels']:
        sm = anim['samplers'][ch['sampler']]
        ts = [x[0] for x in acc_read(sm['input'])]
        vs = acc_read(sm['output'])
        k = 0
        while k + 1 < len(ts) and ts[k + 1] <= DELTA_T:
            k += 1
        sampled.setdefault(ch['target']['node'], {})[ch['target']['path']] = vs[k]

def trs(t, r, s):
    x, y, z, w = r
    R = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
         [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
         [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
    return [[R[i][j]*s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0,0,0,1]]

# THE CLIP'S ROOT CARRIES THE AIRCRAFT'S OWN MOTION. Fuselage_02 has a
# translation channel running from +9.32 m at t=0 to 0 at t=21.875: that
# is the aeroplane descending, not a part moving. Every joint hangs off
# it, so sampling globals without pinning it put a 9.32 m translation
# into all 60 deltas and threw the gear clean off the airframe.
PIN = re.compile(r'Fuselage_02$')

def local_at(i):
    n = gltf['nodes'][i]
    c = {} if PIN.search(names[i]) else sampled.get(i, {})
    # A NODE MAY BE A MATRIX INSTEAD OF TRS, and in this file two of them
    # are: node 1 carries a 0.01 scale and node 5 carries 100. Ignoring
    # `matrix` dropped the 0.01 and left the 100, which is how the delta
    # came out with a scale of 100 and a metre of translation instead of
    # a hinge rotation. An animated node always uses TRS, so the matrix
    # only ever applies to the static chain above the skeleton.
    if 'matrix' in n and not c:
        m = n['matrix']
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
    return trs(list(c.get('translation', n.get('translation', [0,0,0]))),
               list(c.get('rotation', n.get('rotation', [0,0,0,1]))),
               list(c.get('scale', n.get('scale', [1,1,1]))))

def global_at(i):
    M = local_at(i)
    while i in parent:
        i = parent[i]
        M = mat_mul(local_at(i), M)
    return M

def quat_of(M):
    s = [math.sqrt(sum(M[i][j]**2 for i in range(3))) or 1.0 for j in range(3)]
    R = [[M[i][j]/s[j] for j in range(3)] for i in range(3)]
    tr = R[0][0]+R[1][1]+R[2][2]
    if tr > 0:
        S = math.sqrt(tr+1)*2
        q = [(R[2][1]-R[1][2])/S, (R[0][2]-R[2][0])/S, (R[1][0]-R[0][1])/S, 0.25*S]
    elif R[0][0] > R[1][1] and R[0][0] > R[2][2]:
        S = math.sqrt(1+R[0][0]-R[1][1]-R[2][2])*2
        q = [0.25*S, (R[0][1]+R[1][0])/S, (R[0][2]+R[2][0])/S, (R[2][1]-R[1][2])/S]
    elif R[1][1] > R[2][2]:
        S = math.sqrt(1+R[1][1]-R[0][0]-R[2][2])*2
        q = [(R[0][1]+R[1][0])/S, 0.25*S, (R[1][2]+R[2][1])/S, (R[0][2]-R[2][0])/S]
    else:
        S = math.sqrt(1+R[2][2]-R[0][0]-R[1][1])*2
        q = [(R[0][2]+R[2][0])/S, (R[1][2]+R[2][1])/S, 0.25*S, (R[1][0]-R[0][1])/S]
    n = math.sqrt(sum(c*c for c in q)) or 1.0
    q = [c/n for c in q]
    return [-c for c in q] if q[3] < 0 else q

if MANIFEST:
    rows = []
    for jn, nodelist in part_nodes.items():
        ji = next(k for k, nd in enumerate(joints) if names[nd] == jn)
        D = mat_mul(mat_inv(mat_inv(IBM[ji])), global_at(joints[ji]))
        t = [D[i][3] for i in range(3)]
        sc = [math.sqrt(sum(D[i][j]**2 for i in range(3))) for j in range(3)]
        rows.append((jn, nodelist, t, quat_of(D), sc))
    out = ["// GENERATED by scripts/split_airliner_surfaces.py. Do not edit.",
           "//",
           "// Rigid parts lifted out of the skin into plain nodes, and the",
           f"// delta from their bind pose to the animation at t={DELTA_T}s.",
           "// A part can live in several meshes with different materials, so",
           "// one joint drives SEVERAL nodes.",
           "export const RIGID_PARTS = ["]
    for jn, nl, t, q, sc in rows:
        out.append(f"  {{ joint: '{jn}', nodes: {json.dumps(nl)},")
        out.append(f"    t: [{t[0]:.5f}, {t[1]:.5f}, {t[2]:.5f}],"
                   f" r: [{q[0]:.6f}, {q[1]:.6f}, {q[2]:.6f}, {q[3]:.6f}],"
                   f" s: [{sc[0]:.5f}, {sc[1]:.5f}, {sc[2]:.5f}] }},")
    out.append("];")
    open(MANIFEST, 'w').write("\n".join(out) + "\n")
    print(f"manifest -> {MANIFEST} ({len(rows)} parts, {sum(len(r[1]) for r in rows)} nodes)")

gltf['scenes'][0]['nodes'].extend(new_nodes)
gltf['buffers'][0]['byteLength'] = len(blob)
gltf['buffers'][0].pop('uri', None)

js = json.dumps(gltf, separators=(',', ':')).encode('utf8')
while len(js) % 4: js += b' '
while len(blob) % 4: blob.append(0)
out = (b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(blob))
       + struct.pack('<I', len(js)) + b'JSON' + js
       + struct.pack('<I', len(blob)) + b'BIN\x00' + bytes(blob))
open(DST, 'wb').write(out)
print(f"extracted {len(new_nodes)} rigid nodes, {moved_tris} triangles")
print(f"triangles left behind because their corners spanned joints: {mixed_total}")
print(f"{len(raw)/1e6:.1f} MB -> {len(out)/1e6:.1f} MB")
