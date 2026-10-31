package studio.junoh.phonetwin;

/**
 * Picks scan A·B automatically: two floor points `spacing` apart in the most open part of the scanned floor,
 * so the user only has to find the same two spots in the room. Prefers the floor's long axis (easy to tape along
 * a wall) and the middle of the room. Pure Java, scan frame S (Y up), scan units.
 */
final class FloorMarks {
    private FloorMarks() {}

    /** {A, B} or null when there is not enough open floor. Tries spacing, then 70% and 50% of it. */
    static float[][] pick(float[] xyz, int n, float[] min, float[] max, float floorY, float spacing) {
        for (float s : new float[]{spacing, spacing*.7f, spacing*.5f}) {
            float[][] ab = pickAt(xyz, n, min, max, floorY, s);
            if (ab != null) return ab;
        }
        return null;
    }

    private static float[][] pickAt(float[] xyz, int n, float[] min, float[] max, float floorY, float spacing) {
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
        // open floor = seen floor, nothing standing on it
        boolean[] open = new boolean[w*h]; int count = 0; double sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
        for (int z = 0; z < h; z++) for (int x = 0; x < w; x++) {
            int k = z*w + x; if (floor[k] < 2 || block[k] >= 3) continue;
            open[k] = true; count++; sx += x; sz += z; sxx += (double)x*x; szz += (double)z*z; sxz += (double)x*z;
        }
        if (count < 4) return null;
        double mx = sx/count, mz = sz/count, cxx = sxx/count - mx*mx, czz = szz/count - mz*mz, cxz = sxz/count - mx*mz;
        double axis = .5*Math.atan2(2*cxz, cxx - czz);            // long axis of the open floor

        // clearance: distance (cells) to the nearest cell that is not open floor (two-pass chamfer)
        float[] clr = new float[w*h]; final float INF = 1e9f, D = 1.4142f;
        for (int k = 0; k < clr.length; k++) clr[k] = open[k] ? INF : 0;
        for (int z = 0; z < h; z++) for (int x = 0; x < w; x++) {
            int k = z*w + x; if (clr[k] == 0) continue; float v = clr[k];
            if (x == 0 || z == 0 || x == w-1 || z == h-1) v = 1;    // the scan's edge counts as unknown
            if (x > 0) v = Math.min(v, clr[k-1] + 1); if (z > 0) v = Math.min(v, clr[k-w] + 1);
            if (x > 0 && z > 0) v = Math.min(v, clr[k-w-1] + D); if (x < w-1 && z > 0) v = Math.min(v, clr[k-w+1] + D);
            clr[k] = v;
        }
        for (int z = h-1; z >= 0; z--) for (int x = w-1; x >= 0; x--) {
            int k = z*w + x; if (clr[k] == 0) continue; float v = clr[k];
            if (x < w-1) v = Math.min(v, clr[k+1] + 1); if (z < h-1) v = Math.min(v, clr[k+w] + 1);
            if (x < w-1 && z < h-1) v = Math.min(v, clr[k+w+1] + D); if (x > 0 && z < h-1) v = Math.min(v, clr[k+w-1] + D);
            clr[k] = v;
        }

        float step = spacing/cell, best = -INF; int bx = -1, bz = -1; double bt = 0;
        float diag = (float)Math.hypot(w, h);
        for (int d = 0; d < 16; d++) {
            boolean main = d % 4 == 0;                                 // 0°, 90°, 180°, 270° from the long axis
            double t = axis + d*Math.PI/8;
            int dx = Math.round((float)Math.cos(t)*step), dz = Math.round((float)Math.sin(t)*step);
            if (dx == 0 && dz == 0) continue;
            for (int z = 0; z < h; z++) for (int x = 0; x < w; x++) {
                int k = z*w + x; if (clr[k] < 1) continue;
                int x2 = x + dx, z2 = z + dz; if (x2 < 0 || z2 < 0 || x2 >= w || z2 >= h) continue;
                int k2 = z2*w + x2; if (clr[k2] < 1) continue;
                float mid = (float)Math.hypot((x + x2)*.5 - mx, (z + z2)*.5 - mz);
                float score = Math.min(Math.min(clr[k], clr[k2]), 6f) - (main ? 0 : 1f) - 3f*mid/diag;
                if (score > best) { best = score; bx = x; bz = z; bt = t; }
            }
        }
        if (bx < 0) return null;
        float[] a = {min[0] + (bx + .5f)*cell, floorY, min[2] + (bz + .5f)*cell};
        float[] b = {a[0] + spacing*(float)Math.cos(bt), floorY, a[2] + spacing*(float)Math.sin(bt)};   // exactly `spacing` apart
        return new float[][]{a, b};
    }
}
