package studio.junoh.phonetwin;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;

/**
 * Accumulates an in-app scan. Points arrive in ARCore world coordinates (Y up, metres) and are stored
 * relative to the first point ("shift"), exactly like ScanLoader does, so the saved PLY reloads into the
 * same scan frame. Each voxel keeps a weighted running mean of every sample that fell into it
 * (weight = depth confidence / distance², so close, confident samples dominate). xyz/rgb hold the first
 * sample of each voxel for the live preview; toCloud() returns the means and can drop voxels that were
 * seen fewer than minHits times (single-frame noise, flying pixels). Pure Java.
 */
final class LiveScan {
    final float voxel;
    final float[] xyz; final byte[] rgb;          // first sample per voxel (live preview)
    int n = 0, uploaded = 0;
    boolean colour = false;
    private final float[] sum, w, csum, cw;       // weighted position sums (relative), weights, colour sums, colour weights
    private final int[] hits;
    private double sx, sy, sz; private boolean hasShift = false;
    private final long[] table;                   // open addressing set of voxel keys (+1, 0 = empty)
    private final int[] slot;                     // voxel index for each table entry
    private final int mask;

    LiveScan(float voxel, int capacity) {
        this.voxel = voxel; xyz = new float[capacity*3]; rgb = new byte[capacity*3];
        sum = new float[capacity*3]; w = new float[capacity]; csum = new float[capacity*3]; cw = new float[capacity]; hits = new int[capacity];
        int size = Integer.highestOneBit(Math.max(16, capacity*2)) << 1;   // load factor <= 0.5
        table = new long[size]; slot = new int[size]; mask = size - 1;
    }

    boolean full() { return n*3 >= xyz.length; }
    float[] shift() { return new float[]{(float)sx, (float)sy, (float)sz}; }
    boolean started() { return hasShift; }
    int hits(int i) { return hits[i]; }

    /** World point + colour (0-255, or r < 0 for none), weight 1. Returns true if it filled a new voxel. */
    boolean add(float wx, float wy, float wz, int r, int g, int b) { return add(wx, wy, wz, r, g, b, 1f); }

    /** Same with a sample weight (> 0). Samples in an existing voxel only refine its mean. */
    boolean add(float wx, float wy, float wz, int r, int g, int b, float weight) {
        if (!Float.isFinite(wx) || !Float.isFinite(wy) || !Float.isFinite(wz) || !(weight > 0)) return false;
        if (!hasShift) { sx = wx; sy = wy; sz = wz; hasShift = true; }
        float x = (float)(wx - sx), y = (float)(wy - sy), z = (float)(wz - sz);
        long ix = Math.round(x/voxel) + (1 << 20), iy = Math.round(y/voxel) + (1 << 20), iz = Math.round(z/voxel) + (1 << 20);   // first point sits at a voxel centre
        if (ix < 0 || iy < 0 || iz < 0 || ix >= (1 << 21) || iy >= (1 << 21) || iz >= (1 << 21)) return false;
        long key = ((ix << 42) | (iy << 21) | iz) + 1;
        int h = (int)((key * 0x9E3779B97F4A7C15L) >>> 40) & mask;
        while (table[h] != 0) {
            if (table[h] == key) { accumulate(slot[h], x, y, z, r, g, b, weight); return false; }
            h = (h + 1) & mask;
        }
        if (full()) return false;
        table[h] = key; slot[h] = n;
        xyz[n*3] = x; xyz[n*3+1] = y; xyz[n*3+2] = z;
        if (r >= 0) { colour = true; rgb[n*3] = (byte)r; rgb[n*3+1] = (byte)g; rgb[n*3+2] = (byte)b; }
        else { rgb[n*3] = rgb[n*3+1] = rgb[n*3+2] = (byte)170; }
        accumulate(n, x, y, z, r, g, b, weight);
        n++;
        return true;
    }

    private void accumulate(int i, float x, float y, float z, int r, int g, int b, float weight) {
        sum[i*3] += x*weight; sum[i*3+1] += y*weight; sum[i*3+2] += z*weight; w[i] += weight; hits[i]++;
        if (r >= 0) { csum[i*3] += r*weight; csum[i*3+1] += g*weight; csum[i*3+2] += b*weight; cw[i] += weight; }
    }

    /** All voxels (means). */
    ScanLoader.Cloud toCloud(String info) { return toCloud(info, 1); }

    /** Weighted mean of every voxel seen at least minHits times. */
    ScanLoader.Cloud toCloud(String info, int minHits) {
        // Voxel 0 is always written first at exactly (0,0,0): ScanLoader re-centres on the first point, so this keeps
        // a reloaded PLY in the same frame as A/B, objects and AI observations (costs at most half a voxel on one point).
        int k = 0; for (int i = 0; i < n; i++) if (i == 0 || hits[i] >= minHits) k++;
        float[] p = new float[k*3]; byte[] c = new byte[k*3]; int o = 0;
        for (int i = 0; i < n; i++) {
            if (i > 0 && hits[i] < minHits) continue;
            float wi = w[i];
            if (i > 0) { p[o*3] = sum[i*3]/wi; p[o*3+1] = sum[i*3+1]/wi; p[o*3+2] = sum[i*3+2]/wi; }
            if (cw[i] > 0) for (int j = 0; j < 3; j++) c[o*3+j] = (byte)Math.round(Math.min(255f, csum[i*3+j]/cw[i]));
            else c[o*3] = c[o*3+1] = c[o*3+2] = (byte)170;
            o++;
        }
        ScanLoader.Cloud cloud = new ScanLoader.Cloud(p, c, k, info);
        if (!colour) ScanLoader.heightColours(cloud);
        return cloud;
    }

    /** Binary little-endian PLY, Y up, metres, relative to the shift (first point at 0,0,0). */
    static void writePly(ScanLoader.Cloud c, File f) throws IOException {
        try (OutputStream o = new BufferedOutputStream(new FileOutputStream(f), 1 << 16)) {
            o.write(String.format(Locale.US, "ply\nformat binary_little_endian 1.0\ncomment PhoneTwin scan, Y up, metres\n" +
                "element vertex %d\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n", c.n).getBytes("US-ASCII"));
            ByteBuffer b = ByteBuffer.allocate(15*4096).order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < c.n; i++) {
                b.putFloat(c.xyz[i*3]).putFloat(c.xyz[i*3+1]).putFloat(c.xyz[i*3+2]).put(c.rgb[i*3]).put(c.rgb[i*3+1]).put(c.rgb[i*3+2]);
                if (!b.hasRemaining()) { o.write(b.array(), 0, b.position()); b.clear(); }
            }
            o.write(b.array(), 0, b.position());
        }
    }
}
