#!/usr/bin/env python3
"""
Project a world point into a skraafoto frame.

This is the piece that makes photographic buildings possible, and it is
the opposite of what the reconstruction pipeline was doing. Rather than
inferring shape from the photographs, it takes shape as given and works
out which pixels of which photograph belong to a given surface.

That is how every textured European city model is built. The vendor
behind Helsinki, Berlin and Hamburg states the order plainly: geometry
comes from footprints and lidar, texture comes from the obliques, and
"any lack of geometric detail ... is then hardly noticeable in the
result".

Five frames per location is far too few to reconstruct a building. It is
ample to photograph one, because a face only needs ONE good view, and
skraafoto gives a nadir plus one oblique per cardinal direction.

Denmark publishes the full camera model per frame, so none of this has
to be estimated:

    exterior    pers:perspective_center, pers:omega / phi / kappa,
                and a 3x3 rotation matrix
    interior    focal length, principal point offset, pixel spacing,
                sensor array dimensions

Everything is EPSG:25832 horizontally and DVR90 (EPSG:5799) vertically.
Camera height and ground height are in the same vertical datum, so the
geoid does not enter here at all. It only matters later, when the result
is placed in Cesium.

CONVENTION, verified rather than assumed. A nadir frame carries a
near-identity rotation matrix, which fixes R as the rotation from object
space into camera axes, and the standard collinearity equations follow:

    [u v w]^T = R . (P - C)
    x = -f . u / w
    y = -f . v / w

with w negative for anything below the aircraft.
"""

import json
import math
from pathlib import Path


class Frame:
    """One photograph, with everything needed to project into it."""

    def __init__(self, pose):
        self.id = pose["id"]
        self.direction = pose.get("direction")
        self.C = tuple(pose["perspective_center"])
        self.R = list(pose["rotation_matrix"])
        self.gsd = pose.get("gsd")
        io = pose["interior"]
        self.f = float(io["focal_length_mm"])
        self.ppo = tuple(io.get("principal_point_offset_mm") or (0.0, 0.0))
        self.px = tuple(io["pixel_spacing_mm"])
        self.size = tuple(int(v) for v in io["sensor_array_dimensions_px"])

    # ── geometry ────────────────────────────────────────────────────
    def camera_frame(self, P):
        """World point to camera axes."""
        dx = P[0] - self.C[0]
        dy = P[1] - self.C[1]
        dz = P[2] - self.C[2]
        R = self.R
        return (R[0]*dx + R[1]*dy + R[2]*dz,
                R[3]*dx + R[4]*dy + R[5]*dz,
                R[6]*dx + R[7]*dy + R[8]*dz)

    def project(self, P):
        """World point (E, N, Z) to pixel (col, row), or None if behind.

        Returns pixel coordinates even when they fall outside the sensor,
        so a caller can tell "just off the edge" from "pointing the wrong
        way". Use `sees` for the bounded test.
        """
        u, v, w = self.camera_frame(P)
        if w >= -1e-6:          # at or behind the lens plane
            return None
        x_mm = -self.f * u / w + self.ppo[0]
        y_mm = -self.f * v / w + self.ppo[1]
        col = x_mm / self.px[0] + self.size[0] / 2.0
        # Image rows run down, photogrammetric y runs up.
        row = self.size[1] / 2.0 - y_mm / self.px[1]
        return (col, row)

    def sees(self, P, margin=0):
        q = self.project(P)
        if q is None:
            return False
        c, r = q
        return (margin <= c < self.size[0] - margin
                and margin <= r < self.size[1] - margin)

    def view_vector(self, P):
        """Unit vector from the surface point towards the camera."""
        d = (self.C[0] - P[0], self.C[1] - P[1], self.C[2] - P[2])
        n = math.sqrt(sum(c * c for c in d)) or 1.0
        return (d[0] / n, d[1] / n, d[2] / n)

    def incidence(self, P, normal):
        """Cosine of the angle between a face normal and the view.

        1.0 is looking straight at the face, 0.0 is edge on, negative is
        looking at its back. This is what decides which frame textures a
        given wall: the south-facing wall wants the frame shot from the
        south, and nothing else will do.
        """
        d = self.view_vector(P)
        return sum(a * b for a, b in zip(d, normal))


def load_frames(poses_path):
    doc = json.loads(Path(poses_path).read_text())
    return [Frame(p) for p in doc["images"] if p.get("perspective_center")]


# ── self-test ───────────────────────────────────────────────────────
def _selftest(poses_path, ground_z=94.6):
    frames = load_frames(poses_path)
    print(f"{len(frames)} frames")
    nadir = [f for f in frames if f.direction == "nadir"]
    if not nadir:
        print("no nadir frame to test with")
        return
    f = nadir[0]

    # Where the OPTICAL AXIS meets the ground must land at the principal
    # point. Not the point directly beneath the aircraft: even a nadir
    # frame is tilted a tenth of a degree, which at 2 km is 5 m on the
    # ground and 55 px on the sensor. Testing against the point below the
    # camera reports that as a 57 px error and reads like a broken
    # convention.
    #
    # The camera looks along -z in its own frame, so the axis in object
    # space is R^T applied to (0, 0, -1), which is the negated third ROW
    # of R. Taking the third column instead is the easy slip and reports
    # a 115 px error that looks like a broken convention.
    R = f.R
    axis = (-R[6], -R[7], -R[8])
    t = (ground_z - f.C[2]) / axis[2]
    P = (f.C[0] + t * axis[0], f.C[1] + t * axis[1], ground_z)
    col, row = f.project(P)
    want_col = f.size[0] / 2.0 + f.ppo[0] / f.px[0]
    want_row = f.size[1] / 2.0 - f.ppo[1] / f.px[1]
    print(f"\noptical axis of {f.id}")
    print(f"  projected  {col:10.2f} {row:10.2f}")
    print(f"  expected   {want_col:10.2f} {want_row:10.2f}")
    err = math.hypot(col - want_col, row - want_row)
    print(f"  error      {err:.3f} px  {'OK' if err < 1.0 else 'WRONG CONVENTION'}")

    # Scale: one ground-sample-distance east of the SAME point must
    # land one pixel over.
    c2, _ = f.project((P[0] + (f.gsd or 0.1), P[1], ground_z))
    print(f"\n  one ground-sample-distance east moves {c2 - col:.3f} px "
          f"(expect about 1.0)")


if __name__ == "__main__":
    import sys
    _selftest(sys.argv[1] if len(sys.argv) > 1
              else "work/bt-terminal/poses.json")
