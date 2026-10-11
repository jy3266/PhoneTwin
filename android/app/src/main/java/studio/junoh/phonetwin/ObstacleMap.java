package studio.junoh.phonetwin;

/**
 * Top-down obstacle map for the walking test. Every scan point between "just above the floor" and
 * "head height" is projected onto a 2D grid (x,z). A column with enough points is an obstacle: a wall,
 * furniture, an object. Walking distance questions are then cheap 2D lookups. Pure Java, scan units.
 */
final class ObstacleMap {
    final float cell, minX, minZ, floorY;
    final int w, h;
    private final boolean[] occ;
    private final int occupiedCount;

    private ObstacleMap(float cell, float minX, float minZ, int w, int h, boolean[] occ, int count, float floorY) {
        this.cell = cell; this.minX = minX; this.minZ = minZ; this.w = w; this.h = h; this.occ = occ; occupiedCount = count; this.floorY = floorY;
    }

    int occupiedCells() { return occupiedCount; }

    /**
     * floorY: floor height. Points with y in [floorY+lo, floorY+hi] count; a column needs minCount of them.
     * All lengths in scan units.
     */
    static ObstacleMap build(float[] xyz, int n, float[] min, float[] max, float floorY, float lo, float hi, float cell, int minCount) {
        float ex = max[0]-min[0], ez = max[2]-min[2];
        cell = Math.max(cell, (float)Math.sqrt(Math.max(ex*ez, 1e-6f)/4e6));          // at most ~4M cells
        int w = Math.max(1, (int)(ex/cell) + 1), h = Math.max(1, (int)(ez/cell) + 1);
        short[] count = new short[w*h];
        float y0 = floorY + lo, y1 = floorY + hi;
        for (int i = 0; i < n; i++) {
            float y = xyz[i*3+1]; if (y < y0 || y > y1) continue;
            int x = (int)((xyz[i*3]-min[0])/cell), z = (int)((xyz[i*3+2]-min[2])/cell);
            if (x < 0 || z < 0 || x >= w || z >= h) continue;
            int k = z*w + x; if (count[k] < Short.MAX_VALUE) count[k]++;
        }
        boolean[] occ = new boolean[w*h]; int c = 0;
        for (int k = 0; k < occ.length; k++) if (count[k] >= minCount) { occ[k] = true; c++; }
        return new ObstacleMap(cell, min[0], min[2], w, h, occ, c, floorY);
    }

    private boolean at(int x, int z) { return x >= 0 && z >= 0 && x < w && z < h && occ[z*w + x]; }

    /** Horizontal distance to the nearest obstacle column (cell edge), searched up to maxR; out = its centre (x,z). */
    float nearest(float px, float pz, float maxR, float[] out) {
        int cx = (int)Math.floor((px-minX)/cell), cz = (int)Math.floor((pz-minZ)/cell), r = (int)Math.ceil(maxR/cell) + 1;
        float best = Float.POSITIVE_INFINITY;
        for (int dz = -r; dz <= r; dz++) for (int dx = -r; dx <= r; dx++) {
            if (!at(cx+dx, cz+dz)) continue;
            float qx = minX + (cx+dx+.5f)*cell, qz = minZ + (cz+dz+.5f)*cell;
            float d = Math.max(0, (float)Math.hypot(qx-px, qz-pz) - cell*.5f);
            if (d < best) { best = d; if (out != null) { out[0] = qx; out[1] = qz; } }
        }
        return best <= maxR ? best : Float.POSITIVE_INFINITY;
    }

    /**
     * Distance along the horizontal heading (dx,dz) to the first obstacle inside a corridor of the given
     * half width, ignoring anything behind or beside the start. +Infinity if the corridor is clear up to maxDist.
     */
    float ahead(float px, float pz, float dx, float dz, float maxDist, float halfWidth) {
        float len = (float)Math.hypot(dx, dz); if (len < 1e-6f) return Float.POSITIVE_INFINITY;
        dx /= len; dz /= len;
        float reach = maxDist + halfWidth + cell;
        int x0 = (int)Math.floor((px - reach - minX)/cell), x1 = (int)Math.floor((px + reach - minX)/cell);
        int z0 = (int)Math.floor((pz - reach - minZ)/cell), z1 = (int)Math.floor((pz + reach - minZ)/cell);
        float best = Float.POSITIVE_INFINITY, half = cell*.5f;
        for (int z = Math.max(0, z0); z <= Math.min(h-1, z1); z++) for (int x = Math.max(0, x0); x <= Math.min(w-1, x1); x++) {
            if (!occ[z*w + x]) continue;
            float qx = minX + (x+.5f)*cell - px, qz = minZ + (z+.5f)*cell - pz;
            float along = qx*dx + qz*dz - half, lat = Math.abs(qx*dz - qz*dx) - half;
            if (along <= 0 || lat > halfWidth || along > maxDist) continue;
            if (along < best) best = along;
        }
        return best;
    }

    /**
     * Floor height estimate: the most populated 2 cm height band in the lower part of the scan.
     * Robust to a few stray points far below the room.
     */
    static float estimateFloor(float[] xyz, int n, float minY, float maxY) {
        if (n == 0) return 0;
        float bin = .02f; int bins = Math.max(1, Math.min(200_000, (int)((maxY-minY)/bin) + 1));
        int[] hist = new int[bins];
        for (int i = 0; i < n; i++) { int b = (int)((xyz[i*3+1]-minY)/bin); if (b >= 0 && b < bins) hist[b]++; }
        int lo = 0, hi = bins-1, acc = 0;
        for (int b = 0; b < bins; b++) { acc += hist[b]; if (acc >= n*.01) { lo = b; break; } }
        acc = 0;
        for (int b = bins-1; b >= 0; b--) { acc += hist[b]; if (acc >= n*.01) { hi = b; break; } }
        int top = Math.max(lo, lo + (int)((hi-lo)*.4f)), start = Math.max(0, lo - 5), best = start;
        for (int b = start; b <= top; b++) if (hist[b] > hist[best]) best = b;
        double s = 0; int c = 0; float centre = minY + (best+.5f)*bin;
        for (int i = 0; i < n; i++) { float y = xyz[i*3+1]; if (Math.abs(y - centre) <= bin) { s += y; c++; } }
        return c == 0 ? centre : (float)(s/c);
    }
}
