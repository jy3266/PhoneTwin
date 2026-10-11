package studio.junoh.phonetwin;

/**
 * Two-point floor alignment between the scan and the real room.
 *
 * Twin-local frame L (= the ARCore origin anchor's local frame): origin at floor point A,
 * Y up, -Z pointing horizontally from A toward B, X to the right. Metres.
 * Scan frame S: the loader's Y-up frame. Matrices are 4x4 column-major (OpenGL order).
 */
final class Alignment {
    private Alignment() {}

    static float horizontal(float[] a, float[] b) { return (float)Math.hypot(b[0]-a[0], b[2]-a[2]); }

    /** Matrix taking scan-frame points to twin-local L, with uniform scale s (scan units → metres). */
    static float[] scanToLocal(float[] a, float[] b, float s) {
        float d = horizontal(a, b);
        if (d < 1e-4f) throw new IllegalArgumentException("A and B coincide");
        float fx = (b[0]-a[0])/d, fz = (b[2]-a[2])/d;   // forward (toward B) in S
        float rx = -fz, rz = fx;                         // right = forward x up
        float[] m = new float[16];
        m[0] = s*rx;  m[4] = 0; m[8]  = s*rz;  m[12] = -s*(rx*a[0] + rz*a[2]);
        m[1] = 0;     m[5] = s; m[9]  = 0;     m[13] = -s*a[1];
        m[2] = -s*fx; m[6] = 0; m[10] = -s*fz; m[14] = s*(fx*a[0] + fz*a[2]);
        m[15] = 1;
        return m;
    }

    /** Yaw quaternion (x,y,z,w) about +Y whose -Z axis points along the horizontal direction (fx, fz). */
    static float[] yawFacing(float fx, float fz) {
        float yaw = (float)Math.atan2(-fx, -fz);
        return new float[]{0, (float)Math.sin(yaw/2), 0, (float)Math.cos(yaw/2)};
    }

    static float[] apply(float[] m, float x, float y, float z) {
        return new float[]{m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]};
    }
}
