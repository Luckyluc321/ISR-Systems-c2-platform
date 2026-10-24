#!/usr/bin/env python3
# Usage: python3 scripts/pose_from_animation.py public/aircraft/a320_noskin.glb <seconds>
# Prints JSON: per rigid joint, the delta from bind pose to the model animation at that time.

# Delta from each rigid part's bind pose to the model's own animation at
# time T, computed from a320_noskin.glb alone: D = inv(G_rigid) * G_joint(T),
# where the rigid node carries the joint's bind global transform. Same
# step sampling and Fuselage pin as scripts/split_airliner_surfaces.py.
import json, struct, sys, re, math
SRC, T = sys.argv[1], float(sys.argv[2])
raw = open(SRC, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]; g = json.loads(raw[20:20 + jl])
blob = raw[20 + jl + 8:]
NC = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); n = NC[a['type']]; st = bv.get('byteStride', 4 * n)
    return [struct.unpack_from('<' + 'f' * n, blob, off + k * st) for k in range(a['count'])]
names = [n.get('name', '') for n in g['nodes']]
parent = {}
for i, n in enumerate(g['nodes']):
    for c in n.get('children', []): parent[c] = i
sampled = {}
an = g['animations'][0]
for ch in an['channels']:
    sm = an['samplers'][ch['sampler']]; ts = [x[0] for x in acc(sm['input'])]; vs = acc(sm['output'])
    k = 0
    while k + 1 < len(ts) and ts[k + 1] <= T: k += 1
    sampled.setdefault(ch['target']['node'], {})[ch['target']['path']] = vs[k]
def trs(t, r, s):
    x, y, z, w = r
    R = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
    return [[R[i][j]*s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0,0,0,1]]
PIN = re.compile(r'Fuselage_02$')
def local(i, animated=True):
    n = g['nodes'][i]
    c = {} if (not animated or PIN.search(names[i])) else sampled.get(i, {})
    if 'matrix' in n and not c:
        m = n['matrix']; return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
    return trs(list(c.get('translation', n.get('translation', [0,0,0]))), list(c.get('rotation', n.get('rotation', [0,0,0,1]))), list(c.get('scale', n.get('scale', [1,1,1]))))
def mm(A, B): return [[sum(A[i][k]*B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def glob(i, animated=True):
    M = local(i, animated)
    while i in parent: i = parent[i]; M = mm(local(i, animated), M)
    return M
def inv(M):
    import copy
    n = 4; A = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(M)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(A[r][c])); A[c], A[p] = A[p], A[c]
        pv = A[c][c]; A[c] = [v / pv for v in A[c]]
        for r in range(n):
            if r != c: f = A[r][c]; A[r] = [a - f * b for a, b in zip(A[r], A[c])]
    return [row[n:] for row in A]
def quat(M):
    s = [math.sqrt(sum(M[i][j]**2 for i in range(3))) or 1.0 for j in range(3)]
    R = [[M[i][j]/s[j] for j in range(3)] for i in range(3)]; tr = R[0][0]+R[1][1]+R[2][2]
    if tr > 0: S = math.sqrt(tr+1)*2; q = [(R[2][1]-R[1][2])/S, (R[0][2]-R[2][0])/S, (R[1][0]-R[0][1])/S, 0.25*S]
    elif R[0][0] > R[1][1] and R[0][0] > R[2][2]: S = math.sqrt(1+R[0][0]-R[1][1]-R[2][2])*2; q = [0.25*S, (R[0][1]+R[1][0])/S, (R[0][2]+R[2][0])/S, (R[2][1]-R[1][2])/S]
    elif R[1][1] > R[2][2]: S = math.sqrt(1+R[1][1]-R[0][0]-R[2][2])*2; q = [(R[0][1]+R[1][0])/S, 0.25*S, (R[1][2]+R[2][1])/S, (R[0][2]-R[2][0])/S]
    else: S = math.sqrt(1+R[2][2]-R[0][0]-R[1][1])*2; q = [(R[0][2]+R[2][0])/S, (R[1][2]+R[2][1])/S, 0.25*S, (R[1][0]-R[0][1])/S]
    nn = math.sqrt(sum(c*c for c in q)) or 1.0; q = [c/nn for c in q]
    return [-c for c in q] if q[3] < 0 else q
# rigid nodes: rigid_<joint>__<k>; group by joint
groups = {}
for i, nm in enumerate(names):
    m = re.match(r'rigid_(.+)__\d+$', nm)
    if m: groups.setdefault(m.group(1), []).append(i)
out = {}
for jn, idxs in groups.items():
    if jn not in names: continue
    ji = names.index(jn)
    D = mm(inv(glob(idxs[0], animated=False)), glob(ji))
    out[jn] = {'t': [D[i][3] for i in range(3)], 'r': quat(D), 's': [math.sqrt(sum(D[i][j]**2 for i in range(3))) for j in range(3)],
               'nodes': [names[i] for i in idxs]}
print(json.dumps(out))
