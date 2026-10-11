package studio.junoh.phonetwin;

import static org.junit.Assert.*;
import org.junit.Test;

public class WalkAiTest {
    /** 4 x 4 m room, floor y=-1.2, ceiling 2.4 m above, walls x=0 and x=4, a 40 cm "chair" box centred at (2.0, 2.0). */
    private static ScanLoader.Cloud room() {
        float[] p = new float[3*400_000]; int n = 0;
        for (int i = 0; i <= 160; i++) for (int k = 0; k <= 160; k++) {
            float x = i*.025f, z = k*.025f;
            p[n*3] = x; p[n*3+1] = -1.2f; p[n*3+2] = z; n++;                      // floor
            p[n*3] = x; p[n*3+1] = 1.2f; p[n*3+2] = z; n++;                       // ceiling
        }
        for (int j = 0; j <= 96; j++) for (int k = 0; k <= 160; k++) {
            float y = -1.2f + j*.025f, z = k*.025f;
            p[n*3] = 0; p[n*3+1] = y; p[n*3+2] = z; n++;
            p[n*3] = 4; p[n*3+1] = y; p[n*3+2] = z; n++;
        }
        for (int j = 0; j <= 32; j++) for (int a = 0; a <= 16; a++) {             // chair: four faces of a 0.4 m box, 0.8 m tall
            float y = -1.2f + j*.025f, t = 1.8f + a*.025f;
            p[n*3] = 1.8f; p[n*3+1] = y; p[n*3+2] = t; n++;
            p[n*3] = 2.2f; p[n*3+1] = y; p[n*3+2] = t; n++;
            p[n*3] = t; p[n*3+1] = y; p[n*3+2] = 1.8f; n++;
            p[n*3] = t; p[n*3+1] = y; p[n*3+2] = 2.2f; n++;
        }
        p[n*3] = 2; p[n*3+1] = -10; p[n*3+2] = 2; n++;                           // stray point far below
        return new ScanLoader.Cloud(java.util.Arrays.copyOf(p, n*3), new byte[n*3], n, "");
    }

    @Test public void floorEstimateAndObstacleDistances() {
        ScanLoader.Cloud c = room();
        float floor = ObstacleMap.estimateFloor(c.xyz, c.n, c.min[1], c.max[1]);
        assertEquals(-1.2f, floor, .015f);
        ObstacleMap m = ObstacleMap.build(c.xyz, c.n, c.min, c.max, floor, .12f, 1.9f, .05f, 3);
        float[] out = new float[2];
        assertEquals(.78f, m.nearest(1.0f, 2.0f, 1.5f, out), .06f);                  // chair face at x=1.8 (wall x=0 is 1.0 away)
        assertEquals(1.8f, out[0], .06f);
        assertTrue(Float.isInfinite(m.nearest(1.0f, 2.0f, .5f, out)));             // nothing within 0.5 m: floor and ceiling are not obstacles
        assertEquals(.78f, m.ahead(1.0f, 2.0f, 1, 0, 1.5f, .25f), .06f);             // walking +x: chair ahead
        assertEquals(.96f, m.ahead(1.0f, 2.0f, -1, 0, 1.5f, .25f), .06f);           // walking -x: wall
        assertTrue(Float.isInfinite(m.ahead(1.0f, 2.0f, 0, -1, 1.5f, .25f)));       // walking -z: open
        assertTrue(Float.isInfinite(m.ahead(.4f, 1.0f, 0, 1, 1.5f, .25f)));         // along the wall 40 cm away: it is beside, not ahead
        assertEquals(.78f, m.ahead(2.0f, 1.0f, 0, 1, 1.5f, .25f), .06f);             // walking +z into the chair
    }

    @Test public void raycastFindsFirstSurface() {
        ScanLoader.Cloud c = room();
        SurfaceIndex idx = SurfaceIndex.build(c.xyz, c.n, .03f, c.min, c.max);
        float[] hit = new float[3];
        float t = idx.raycast(1f, -.8f, 2f, 1, 0, 0, .1f, 8f, hit);
        assertEquals(.8f, t, .04f); assertEquals(1.8f, hit[0], .03f);
        float d = (float)Math.sqrt(.5);
        assertTrue(idx.raycast(1f, -.8f, 2f, 0, -1, 0, .1f, 8f, hit) < .45f);         // straight down: floor
        assertEquals(-1.2f, hit[1], .02f);
        assertTrue(Float.isInfinite(idx.raycast(1f, 0, 2f, 0, 0, -1, .1f, .5f, hit)));  // nothing within 0.5 m
        assertTrue(idx.raycast(3f, -.8f, 2f, d, 0, d, .1f, 8f, hit) < 1.5f);          // diagonal reaches wall x=4
        assertEquals(4f, hit[0], .03f);
    }

    @Test public void aiObservationsMergeAndConfirm() {
        AiObjects ai = new AiObjects();
        assertFalse(ai.observe("chair", 2, 0, 2, .3f, .6f));
        assertFalse(ai.observe("chair", 2.1f, 0, 2.05f, .3f, .6f));
        assertTrue(ai.confirmed().isEmpty());
        assertTrue(ai.observe("chair", 1.95f, 0, 1.9f, .3f, .6f));                 // third sighting confirms
        assertFalse(ai.observe("couch", 2, 0, 2, .3f, .6f));                       // other label: separate object
        assertFalse(ai.observe("chair", 5, 0, 2, .3f, .6f));                       // far away: a second chair
        assertEquals(1, ai.confirmed().size());
        AiObjects.Item it = ai.confirmed().get(0);
        assertEquals(2.017f, it.x, .01f);
        ai.removeLabel("chair"); assertTrue(ai.confirmed().isEmpty());
        assertEquals("의자", AiObjects.korean("chair")); assertEquals("dining_table", AiObjects.fileKey("dining table"));
        assertEquals(AiObjects.LABELS.length, 80);
    }

    @Test public void uprightImageMapsBackToSensorPixels() {
        int w = 5, h = 3; byte[] y = new byte[w*h], uv = new byte[w*h];
        for (int i = 0; i < w*h; i++) { y[i] = (byte)(i*10); uv[i] = (byte)128; }
        for (int rot : new int[]{0, 90, 180, 270}) {
            int[] img = CameraGeometry.yuvToArgb(y, uv, uv, w, h, w, 1, w, 1, rot);
            int rw = CameraGeometry.rotatedWidth(rot, w, h), rh = w*h/rw;
            for (int yy = 0; yy < rh; yy++) for (int x = 0; x < rw; x++) {
                float[] s = CameraGeometry.toSensor(x + .5f, yy + .5f, rot, w, h);
                int sx = (int)Math.floor(s[0]), sy = (int)Math.floor(s[1]);
                assertEquals("rot " + rot, (y[sy*w + sx] & 0xff), img[yy*rw + x] & 0xff);
            }
        }
    }

    @Test public void cameraRayDirections() {
        float[] id = new float[16]; id[0] = id[5] = id[10] = id[15] = 1; id[12] = 1; id[13] = 2; id[14] = 3;
        float[] r = CameraGeometry.ray(320, 240, 500, 500, 320, 240, id);
        assertArrayEquals(new float[]{1, 2, 3, 0, 0, -1}, r, 1e-6f);
        r = CameraGeometry.ray(820, 240, 500, 500, 320, 240, id);                   // 45 degrees to the right
        assertEquals(r[3], -r[5], 1e-6f); assertTrue(r[3] > 0);
        r = CameraGeometry.ray(320, 0, 500, 500, 320, 240, id);                     // top of the image looks up
        assertTrue(r[4] > 0);
    }

    @Test public void soundGetsLouderCloserAndInFront() {
        float[] far = SpatialSound.gains(3.5f, 4, .5f, 1, 0), near = SpatialSound.gains(1f, 4, .5f, 1, 0), at = SpatialSound.gains(.3f, 4, .5f, 1, 0);
        assertArrayEquals(new float[]{0, 0}, SpatialSound.gains(4.5f, 4, .5f, 1, 0), 0);
        assertTrue(far[0] > 0 && near[0] > far[0] && at[0] >= near[0]);
        assertEquals(near[0], near[1], 1e-6f);                                      // straight ahead: centred
        assertEquals(1f, at[0], 1e-4f);
        float[] behind = SpatialSound.gains(1f, 4, .5f, -1, 0), right = SpatialSound.gains(1f, 4, .5f, 0, 1);
        assertTrue(behind[0] < near[0]*.4f);
        assertTrue(right[1] > right[0]);
    }
}
