#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════
# Three-eye sensor placement for a site boundary
# ───────────────────────────────────────────────────────────────────
# The policy every shipped site is measured against (odense.yaml,
# cph.yaml, esbjerg.yaml): every point inside the boundary is within
# 1000 m of at least three nodes. Until 2026-10-22 it was computed ad
# hoc each time and only described in the YAML comments; this is that
# description as code, first used for aarhus_harbour.yaml.
#
#   Greedy set cover over a 17 m sample grid inside the boundary.
#   Candidates on a 25 m grid, INSIDE THE BOUNDARY only: a bounding-box
#   grid once put four of six Odense nodes on land the airport does not
#   control.
#   500 m MINIMUM SEPARATION. Without it the solver stacks nodes 60 m
#   apart, which satisfies three eyes on paper and gives no baseline
#   for fusing a bearing. Enforced at 505 m so the platform's own
#   spherical distance (main.js haversineM) also reads 500 or more.
#   25 m INSIDE THE FENCE. A traced boundary can leave a sliver a few
#   metres wide where two edges run side by side; a node there is
#   technically inside and practically on the quay edge or in the water.
#
# Usage:
#   python3 scripts/three-eye-solver.py sites/aarhus_harbour.yaml
#   python3 scripts/three-eye-solver.py ring.json      ([[lon, lat], ...])
#
# Prints the nodes as [lat, lon] and the share of the site at 1, 2 and
# 3+ eyes. Needs numpy and matplotlib. Not part of the build.
# ═══════════════════════════════════════════════════════════════════
import json, math, re, sys
import numpy as np
from matplotlib.path import Path

RADIUS_M, NEED, SEPARATION_M, SAMPLE_M, CANDIDATE_M, EDGE_INSET_M = 1000.0, 3, 505.0, 17.0, 25.0, 25.0


def load_ring(path):
    text = open(path).read()
    if path.endswith('.json'):
        return json.loads(text)
    block = text.split('\nboundary:\n', 1)[1]
    ring = []
    for line in block.split('\n'):
        m = re.match(r'\s*-\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]', line)
        if not m:
            break
        ring.append([float(m.group(1)), float(m.group(2))])
    return ring


def solve(ring):
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = 111320.0
    c = math.cos(math.radians(lat0))
    poly_xy = np.array([[p[0] * k * c, p[1] * k] for p in ring])
    poly = Path(poly_xy)

    def grid(step):
        xs = np.arange(poly_xy[:, 0].min(), poly_xy[:, 0].max() + step, step)
        ys = np.arange(poly_xy[:, 1].min(), poly_xy[:, 1].max() + step, step)
        g = np.array([(x, y) for x in xs for y in ys])
        return g[poly.contains_points(g)]

    samples, cands = grid(SAMPLE_M), grid(CANDIDATE_M)
    # Distance from each candidate to the nearest boundary edge.
    a = poly_xy; b = np.roll(poly_xy, -1, axis=0); ab = b - a
    t = ((cands[:, None, :] - a[None]) * ab[None]).sum(2) / np.maximum((ab ** 2).sum(1), 1e-9)[None]
    t = np.clip(t, 0, 1)
    nearest = a[None] + t[..., None] * ab[None]
    edge_d = np.sqrt(((cands[:, None, :] - nearest) ** 2).sum(2)).min(1)
    cands = cands[edge_d >= EDGE_INSET_M]
    d2 = lambda a, b: ((b - a) ** 2).sum(1)
    cov = np.zeros(len(samples), int)
    chosen = []
    while True:
        need = np.clip(NEED - cov, 0, None)
        if need.sum() == 0:
            break
        allowed = np.ones(len(cands), bool)
        for i in chosen:
            allowed &= d2(cands[i], cands) >= SEPARATION_M ** 2
        best, gain = None, 0
        for i in np.where(allowed)[0]:
            g = (need[d2(cands[i], samples) <= RADIUS_M ** 2] > 0).sum()
            if g > gain:
                best, gain = i, g
        if best is None:
            break
        chosen.append(best)
        cov += d2(cands[best], samples) <= RADIUS_M ** 2
    nodes = [[round(cands[i][1] / k, 5), round(cands[i][0] / (k * c), 5)] for i in chosen]
    share = {n: round(100 * (cov >= n).mean(), 1) for n in (1, 2, 3)}
    return nodes, share, int(cov.min())


if __name__ == '__main__':
    nodes, share, worst = solve(load_ring(sys.argv[1]))
    print(f'{len(nodes)} nodes | 3+ eyes {share[3]}% | 2+ {share[2]}% | 1+ {share[1]}% | worst point {worst} eyes')
    print(json.dumps(nodes))
