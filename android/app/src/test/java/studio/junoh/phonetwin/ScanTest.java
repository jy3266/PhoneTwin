package studio.junoh.phonetwin;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class ScanTest {
    private static File temp(String ext, byte[] content) throws IOException {
        File f = File.createTempFile("scan", "." + ext); f.deleteOnExit();
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(content); }
        return f;
    }

    @Test public void asciiPlyWithColours() throws IOException {
        String s = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n" +
            "property uchar red\nproperty uchar green\nproperty uchar blue\nelement face 0\nproperty list uchar int vertex_indices\nend_header\n" +
            "10 20 30 255 0 0\n11 20 30 0 255 0\n10 22 31 0 0 255\n";
        ScanLoader.Cloud c = ScanLoader.load(temp("ply", s.getBytes(StandardCharsets.US_ASCII)), "ply", false);
        assertEquals(3, c.n);
        assertArrayEquals(new float[]{0, 0, 0, 1, 0, 0, 0, 2, 1}, c.xyz, 1e-6f);   // shifted so first point is origin
        assertEquals((byte)255, c.rgb[0]); assertEquals((byte)255, c.rgb[4]); assertEquals((byte)255, c.rgb[8]);
    }

    @Test public void binaryPlyZUpAndDoubles() throws IOException {
        String h = "ply\r\nformat binary_little_endian 1.0\r\nelement vertex 2\r\nproperty double x\r\nproperty double y\r\nproperty double z\r\nproperty float intensity\r\nend_header\r\n";
        ByteBuffer b = ByteBuffer.allocate(2*28).order(ByteOrder.LITTLE_ENDIAN);
        b.putDouble(500000).putDouble(4000000).putDouble(10).putFloat(1);   // geo-referenced, Z up
        b.putDouble(500001).putDouble(4000002).putDouble(13).putFloat(1);
        ByteArrayOutputStream o = new ByteArrayOutputStream(); o.write(h.getBytes(StandardCharsets.US_ASCII)); o.write(b.array());
        ScanLoader.Cloud c = ScanLoader.load(temp("ply", o.toByteArray()), "ply", true);
        assertEquals(2, c.n);
        // Z-up (x,y,z) -> Y-up (x, z, -y), relative to first point: (1, 3, -2)
        assertArrayEquals(new float[]{1, 3, -2}, new float[]{c.xyz[3], c.xyz[4], c.xyz[5]}, 1e-4f);
    }

    @Test public void bigEndianSplatColoursAndSubsampling() throws IOException {
        int n = ScanLoader.MAX_POINTS*2 + 1;
        String h = "ply\nformat binary_big_endian 1.0\nelement vertex " + n + "\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nend_header\n";
        ByteBuffer b = ByteBuffer.allocate(n*24).order(ByteOrder.BIG_ENDIAN);
        for (int i = 0; i < n; i++) b.putFloat(i).putFloat(0).putFloat(0).putFloat(0).putFloat(0).putFloat(0);
        ByteArrayOutputStream o = new ByteArrayOutputStream(); o.write(h.getBytes(StandardCharsets.US_ASCII)); o.write(b.array());
        ScanLoader.Cloud c = ScanLoader.load(temp("ply", o.toByteArray()), "ply", false);
        assertTrue(c.n <= ScanLoader.MAX_POINTS);
        assertEquals(3f, c.xyz[3], 0);              // step 3 → every third point kept
        assertEquals((byte)128, c.rgb[0]);          // f_dc = 0 → 0.5 grey
    }

    @Test public void objAndXyz() throws IOException {
        String obj = "# comment\nv 0 0 0 1 0 0\nvt 0.5 0.5\nvn 0 1 0\nv 1 0 0\nf 1 2 2\n";
        assertEquals(2, ScanLoader.load(temp("obj", obj.getBytes(StandardCharsets.UTF_8)), "obj", false).n);
        String pts = "3\n0 0 0 50 255 0 0\n1,1,1,50,0,255,0\nbad line\n2 2 2\n";
        ScanLoader.Cloud c = ScanLoader.load(temp("pts", pts.getBytes(StandardCharsets.UTF_8)), "pts", false);
        assertEquals(3, c.n);
        assertEquals((byte)255, c.rgb[0]); assertEquals((byte)255, c.rgb[4]);
    }

    @Test(expected = IOException.class) public void rejectsGarbage() throws IOException {
        ScanLoader.load(temp("ply", "hello".getBytes(StandardCharsets.US_ASCII)), "ply", false);
    }

    @Test public void surfaceDistanceAndFloorSkip() {
        // a floor (y=0) and a wall plane x=2, 1cm spacing
        int n = 0; float[] p = new float[2*200*200*3];
        for (int i = 0; i < 200; i++) for (int k = 0; k < 200; k++) {
            p[n*3] = i*.01f; p[n*3+1] = 0; p[n*3+2] = k*.01f; n++;
            p[n*3] = 2; p[n*3+1] = i*.01f; p[n*3+2] = k*.01f; n++;
        }
        ScanLoader.Cloud c = new ScanLoader.Cloud(p, new byte[n*3], n, "");
        SurfaceIndex idx = SurfaceIndex.build(p, n, .03f, c.min, c.max);
        float[] out = new float[3];
        float d = idx.nearest(1.8f, 1f, 1f, .5f, true, 0, .1f, out);
        assertEquals(.2f, d, .02f);                       // wall 20cm away
        assertEquals(2f, out[0], .02f);
        assertTrue(Float.isInfinite(idx.nearest(1f, .05f, 1f, .3f, true, 0, .1f, out)));   // only floor nearby, skipped
        assertEquals(.05f, idx.nearest(1f, .05f, 1f, .3f, false, 0, .1f, out), .02f);
        assertTrue(Float.isInfinite(idx.nearest(50, 50, 50, .3f, false, 0, .1f, out)));    // far outside grid
    }

    @Test public void liveScanDedupsAndReloadsInSameFrame() throws IOException {
        LiveScan ls = new LiveScan(.02f, 1000);
        assertTrue(ls.add(10.0f, 1.5f, -3.0f, 255, 0, 0));
        assertFalse(ls.add(10.005f, 1.505f, -3.005f, 0, 255, 0));   // same 2 cm voxel: refines its mean, no new point
        assertTrue(ls.add(10.5f, 1.5f, -3.0f, 0, 0, 255));
        assertArrayEquals(new float[]{10, 1.5f, -3}, ls.shift(), 1e-6f);
        assertEquals(2, ls.n);
        ScanLoader.Cloud c = ls.toCloud("t");
        File f = File.createTempFile("live", ".ply"); f.deleteOnExit();
        LiveScan.writePly(c, f);
        ScanLoader.Cloud r = ScanLoader.load(f, "ply", false);
        assertEquals(2, r.n);
        assertArrayEquals(c.xyz, r.xyz, 0f);          // reload gives exactly the same scan-frame coordinates
        assertArrayEquals(c.rgb, r.rgb);
        LiveScan full = new LiveScan(.01f, 3);
        for (int i = 0; i < 10; i++) full.add(i, 0, 0, -1, 0, 0);
        assertEquals(3, full.n); assertTrue(full.full());
    }

    @Test public void alignmentMapsAToOriginAndBForward() {
        float[] a = {3, -1.2f, 4}, b = {3 + 2, -1.2f, 4 + 2};   // diagonal, 2.83 m apart
        float[] m = Alignment.scanToLocal(a, b, 1);
        assertArrayEquals(new float[]{0, 0, 0}, Alignment.apply(m, a[0], a[1], a[2]), 1e-5f);
        assertArrayEquals(new float[]{0, 0, -2.828427f}, Alignment.apply(m, b[0], b[1], b[2]), 1e-5f);
        // a point 1 m up and to the right of A (right = forward x up)
        float fx = (float)(1/Math.sqrt(2)), fz = fx;
        assertArrayEquals(new float[]{1, 1, 0}, Alignment.apply(m, a[0] - fz, a[1] + 1, a[2] + fx), 1e-5f);
        float[] scaled = Alignment.scanToLocal(a, b, 2);
        assertEquals(-5.656854f, Alignment.apply(scaled, b[0], b[1], b[2])[2], 1e-5f);
        // yaw quaternion rotates -Z onto the forward direction
        float[] q = Alignment.yawFacing(fx, fz);
        float yaw = 2*(float)Math.atan2(q[1], q[3]);
        assertEquals(fx, -(float)Math.sin(yaw), 1e-5f); assertEquals(fz, -(float)Math.cos(yaw), 1e-5f);
    }
}
