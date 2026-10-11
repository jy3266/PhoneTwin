package studio.junoh.phonetwin;

/**
 * Pure helpers between the CPU camera image (sensor orientation), the upright image fed to the detector,
 * and 3D rays in the scan frame. Rotation is clockwise degrees (0/90/180/270) that makes the image upright.
 */
final class CameraGeometry {
    private CameraGeometry() {}

    static int rotatedWidth(int rot, int w, int h) { return rot == 90 || rot == 270 ? h : w; }

    /** Upright-image coordinate (continuous pixels) back to the sensor image. */
    static float[] toSensor(float xr, float yr, int rot, int w, int h) {
        switch (rot) {
            case 90: return new float[]{yr, h - xr};
            case 180: return new float[]{w - xr, h - yr};
            case 270: return new float[]{w - yr, xr};
            default: return new float[]{xr, yr};
        }
    }

    /** YUV_420_888 planes -> upright ARGB pixels (rotated by rot). */
    static int[] yuvToArgb(byte[] y, byte[] u, byte[] v, int w, int h, int yRow, int yPix, int uvRow, int uvPix, int rot) {
        int rw = rotatedWidth(rot, w, h); int[] out = new int[w*h];
        for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) {
            int Y = y[j*yRow + i*yPix] & 0xff, k = (j >> 1)*uvRow + (i >> 1)*uvPix;
            int U = (u[k] & 0xff) - 128, V = (v[k] & 0xff) - 128;
            int r = clamp(Y + 1.402f*V), g = clamp(Y - .344f*U - .714f*V), b = clamp(Y + 1.772f*U);
            int x, yy;
            switch (rot) {
                case 90: x = h-1-j; yy = i; break;
                case 180: x = w-1-i; yy = h-1-j; break;
                case 270: x = j; yy = w-1-i; break;
                default: x = i; yy = j;
            }
            out[yy*rw + x] = 0xff000000 | (r << 16) | (g << 8) | b;
        }
        return out;
    }
    private static int clamp(float v) { return v < 0 ? 0 : v > 255 ? 255 : (int)v; }

    /**
     * Ray through sensor pixel (u,v) for a camera with image intrinsics fx,fy,cx,cy. camToS maps the ARCore
     * camera pose frame (+X right, +Y up, -Z forward, relative to the sensor image) to the scan frame
     * (column-major, may include scale). Returns {ox,oy,oz, dx,dy,dz} with a unit direction.
     */
    static float[] ray(float u, float v, float fx, float fy, float cx, float cy, float[] m) {
        float lx = (u - cx)/fx, ly = (cy - v)/fy, lz = -1;
        float dx = m[0]*lx + m[4]*ly + m[8]*lz, dy = m[1]*lx + m[5]*ly + m[9]*lz, dz = m[2]*lx + m[6]*ly + m[10]*lz;
        float len = (float)Math.sqrt(dx*dx + dy*dy + dz*dz);
        return new float[]{m[12], m[13], m[14], dx/len, dy/len, dz/len};
    }
}
