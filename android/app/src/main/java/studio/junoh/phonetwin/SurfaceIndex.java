package studio.junoh.phonetwin;

import java.util.Arrays;

/**
 * Voxel index over the scan for "how far is the hand from the nearest scanned surface".
 * Each occupied cell keeps the centroid of its points, which lies on the surface,
 * so the distance error is roughly a few mm up to half a cell. Pure Java.
 */
final class SurfaceIndex {
    private static final int BITS = 14, LIMIT = (1 << BITS) - 1;
    final float cell;
    private final float minX, minY, minZ;
    private final long[] keys;     // sorted cell keys
    private final float[] centre;  // centroid per key, xyz

    private SurfaceIndex(float cell, float minX, float minY, float minZ, long[] keys, float[] centre) {
        this.cell = cell; this.minX = minX; this.minY = minY; this.minZ = minZ; this.keys = keys; this.centre = centre;
    }

    int cells() { return keys.length; }

    private static long key(int x, int y, int z) { return ((long)x << (2*BITS)) | ((long)y << BITS) | z; }

    static SurfaceIndex build(float[] xyz, int n, float cell, float[] min, float[] max) {
        if (n >= (1 << 20)) throw new IllegalArgumentException("too many points");
        float extent = Math.max(max[0]-min[0], Math.max(max[1]-min[1], max[2]-min[2]));
        cell = Math.max(cell, extent / (LIMIT - 2));
        long[] packed = new long[n];
        for (int i = 0; i < n; i++) {
            int x = (int)((xyz[i*3]-min[0])/cell), y = (int)((xyz[i*3+1]-min[1])/cell), z = (int)((xyz[i*3+2]-min[2])/cell);
            packed[i] = (key(x, y, z) << 20) | i;
        }
        Arrays.sort(packed);
        long[] keys = new long[n]; float[] centre = new float[n*3]; int m = 0;
        for (int s = 0; s < n; ) {
            long k = packed[s] >>> 20; int e = s; double sx = 0, sy = 0, sz = 0;
            while (e < n && (packed[e] >>> 20) == k) { int i = (int)(packed[e] & 0xFFFFF); sx += xyz[i*3]; sy += xyz[i*3+1]; sz += xyz[i*3+2]; e++; }
            int c = e - s; keys[m] = k; centre[m*3] = (float)(sx/c); centre[m*3+1] = (float)(sy/c); centre[m*3+2] = (float)(sz/c); m++; s = e;
        }
        return new SurfaceIndex(cell, min[0], min[1], min[2], Arrays.copyOf(keys, m), Arrays.copyOf(centre, m*3));
    }

    /**
     * Nearest surface distance from (px,py,pz) in scan units, searched up to maxR.
     * Cells whose centroid is below floorY + floorMargin are ignored when skipFloor is set.
     * Returns +Infinity if nothing is within maxR; out receives the nearest surface point.
     */
    float nearest(float px, float py, float pz, float maxR, boolean skipFloor, float floorY, float floorMargin, float[] out) {
        int cx = (int)Math.floor((px-minX)/cell), cy = (int)Math.floor((py-minY)/cell), cz = (int)Math.floor((pz-minZ)/cell);
        int r = (int)Math.ceil(maxR/cell);
        float best2 = maxR*maxR; boolean found = false;
        float floorTop = floorY + floorMargin;
        for (int dx = -r; dx <= r; dx++) {
            int x = cx+dx; if (x < 0 || x > LIMIT) continue;
            float bx = Math.max(Math.abs(dx)-1, 0)*cell;
            for (int dy = -r; dy <= r; dy++) {
                int y = cy+dy; if (y < 0 || y > LIMIT) continue;
                float by = Math.max(Math.abs(dy)-1, 0)*cell;
                if (bx*bx+by*by >= best2) continue;
                for (int dz = -r; dz <= r; dz++) {
                    int z = cz+dz; if (z < 0 || z > LIMIT) continue;
                    float bz = Math.max(Math.abs(dz)-1, 0)*cell;
                    if (bx*bx+by*by+bz*bz >= best2) continue;
                    int i = Arrays.binarySearch(keys, key(x, y, z));
                    if (i < 0) continue;
                    float qx = centre[i*3], qy = centre[i*3+1], qz = centre[i*3+2];
                    if (skipFloor && qy < floorTop) continue;
                    float d2 = (qx-px)*(qx-px)+(qy-py)*(qy-py)+(qz-pz)*(qz-pz);
                    if (d2 < best2) { best2 = d2; found = true; out[0] = qx; out[1] = qy; out[2] = qz; }
                }
            }
        }
        return found ? (float)Math.sqrt(best2) : Float.POSITIVE_INFINITY;
    }

    /**
     * Marches along the unit ray from tMin to maxT (scan units) and returns the distance to the first occupied
     * cell, or +Infinity. out receives that cell's surface centroid.
     */
    float raycast(float ox, float oy, float oz, float dx, float dy, float dz, float tMin, float maxT, float[] out) {
        float step = cell*.5f; long last = -1;
        for (float t = tMin; t <= maxT; t += step) {
            float x = ox + dx*t, y = oy + dy*t, z = oz + dz*t;
            int cx = (int)Math.floor((x-minX)/cell), cy = (int)Math.floor((y-minY)/cell), cz = (int)Math.floor((z-minZ)/cell);
            if (cx < 0 || cy < 0 || cz < 0 || cx > LIMIT || cy > LIMIT || cz > LIMIT) continue;
            long k = key(cx, cy, cz); if (k == last) continue; last = k;
            int i = Arrays.binarySearch(keys, k);
            if (i >= 0) { out[0] = centre[i*3]; out[1] = centre[i*3+1]; out[2] = centre[i*3+2]; return t; }
        }
        return Float.POSITIVE_INFINITY;
    }
}
