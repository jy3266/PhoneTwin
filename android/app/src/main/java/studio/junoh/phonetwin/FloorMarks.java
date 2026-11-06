package studio.junoh.phonetwin;

/**
 * Picks scan A·B automatically. A is always the exact middle of the scanned floor (so the model's origin is easy to
 * find in the room), B is `spacing` away from A along the floor's long axis, on seen floor with nothing standing on it
 * when possible. A→B is Unreal's +X. Pure Java, scan frame S (Y up), scan units.
 */
final class FloorMarks {
    private FloorMarks() {}

    /** {A, B}, or null for an empty scan. A = middle of the floor; B tries spacing, then 70% and 50% of it, then spacing anyway. */
    static float[][] pick(float[] xyz, int n, float[] min, float[] max, float floorY, float spacing) {
        if (n <= 0) return null;
        // floor points (±4 cm); without enough of them the whole scan stands in for the floor
        int step = Math.max(1, n / 200_000), m = 0;
        float[] fx = new float[n/step + 1], fz = new float[n/step + 1];
        for (int i = 0; i < n; i += step) {
            if (Math.abs(xyz[i*3+1] - floorY) > .04f) continue;
            fx[m] = xyz[i*3]; fz[m] = xyz[i*3+2]; m++;
        }
        float cx, cz; double axis;
        if (m >= 50) {
            // middle = halfway between the 2% and 98% edges of the floor, so a few stray points do not move it
            float[] sx = java.util.Arrays.copyOf(fx, m), sz = java.util.Arrays.copyOf(fz, m);
            java.util.Arrays.sort(sx); java.util.Arrays.sort(sz);
            cx = (sx[(int)(m*.02f)] + sx[Math.min(m-1, (int)(m*.98f))])/2;
            cz = (sz[(int)(m*.02f)] + sz[Math.min(m-1, (int)(m*.98f))])/2;
            double mx = 0, mz = 0; for (int i = 0; i < m; i++) { mx += fx[i]; mz += fz[i]; } mx /= m; mz /= m;
            double cxx = 0, czz = 0, cxz = 0;
            for (int i = 0; i < m; i++) { double dx = fx[i]-mx, dz = fz[i]-mz; cxx += dx*dx; czz += dz*dz; cxz += dx*dz; }
            axis = .5*Math.atan2(2*cxz, cxx - czz);                // long axis of the floor
        } else {
            cx = (min[0]+max[0])/2; cz = (min[2]+max[2])/2;
            axis = max[0]-min[0] >= max[2]-min[2] ? 0 : Math.PI/2;
        }
        float[] a = {cx, floorY, cz};

        // open floor cells (10 cm): floor seen, nothing between 12 cm and 1.9 m above it
        float ex = max[0]-min[0], ez = max[2]-min[2];
        float cell = Math.max(.1f, (float)Math.sqrt(Math.max(ex*ez, 1e-6f)/250_000));
        int w = (int)(ex/cell) + 1, h = (int)(ez/cell) + 1;
        int[] floor = new int[w*h], block = new int[w*h];
        for (int i = 0; i < n; i++) {
            float y = xyz[i*3+1] - floorY;
            int x = (int)((xyz[i*3]-min[0])/cell), z = (int)((xyz[i*3+2]-min[2])/cell);
            if (x < 0 || z < 0 || x >= w || z >= h) continue;
            if (Math.abs(y) <= .04f) floor[z*w + x]++;
            else if (y > .12f && y < 1.9f) block[z*w + x]++;
        }
        // B: along the long axis first (either way), then across it, then the diagonals
        double[] turns = {0, Math.PI, Math.PI/2, -Math.PI/2, Math.PI/4, -Math.PI/4, 3*Math.PI/4, -3*Math.PI/4};
        for (float s : new float[]{spacing, spacing*.7f, spacing*.5f})
            for (double t : turns) {
                float bx = cx + s*(float)Math.cos(axis + t), bz = cz + s*(float)Math.sin(axis + t);
                if (open(floor, block, w, h, (int)((bx-min[0])/cell), (int)((bz-min[2])/cell))) return new float[][]{a, {bx, floorY, bz}};
            }
        return new float[][]{a, {cx + spacing*(float)Math.cos(axis), floorY, cz + spacing*(float)Math.sin(axis)}};
    }

    /** The cell and its 8 neighbours are seen floor with nothing standing there. */
    private static boolean open(int[] floor, int[] block, int w, int h, int x, int z) {
        for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
            int i = x + dx, j = z + dz;
            if (i < 0 || j < 0 || i >= w || j >= h) return false;
            int k = j*w + i;
            if (block[k] >= 3 || (dx == 0 && dz == 0 && floor[k] < 2)) return false;
        }
        return true;
    }
}
