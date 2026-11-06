package studio.junoh.phonetwin;

import org.junit.Test;
import static org.junit.Assert.*;

/** Automatic scan A·B: A in the middle of the floor, B 1 m along the long axis on open floor. */
public class FloorMarksTest {
    /** Floor 4 m × 3 m at y = -1.2 with a 1 m box standing in the corner x,z ∈ [0,1]. */
    private static float[] room(int[] count) {
        java.util.ArrayList<float[]> p = new java.util.ArrayList<>();
        for (float x = 0; x < 4; x += .03f) for (float z = 0; z < 3; z += .03f) p.add(new float[]{x, -1.2f, z});
        for (float x = 0; x < 1; x += .05f) for (float z = 0; z < 1; z += .05f) for (float y = -1.1f; y < -.2f; y += .1f) p.add(new float[]{x, y, z});
        float[] xyz = new float[p.size()*3];
        for (int i = 0; i < p.size(); i++) System.arraycopy(p.get(i), 0, xyz, i*3, 3);
        count[0] = p.size();
        return xyz;
    }

    @Test public void aIsTheMiddleOfTheFloorAndBIsOneMetreAlongTheLongAxis() {
        int[] n = new int[1]; float[] xyz = room(n);
        ScanLoader.Cloud c = new ScanLoader.Cloud(xyz, new byte[n[0]*3], n[0], "t");
        float fy = ObstacleMap.estimateFloor(xyz, n[0], c.min[1], c.max[1]);
        assertEquals(-1.2f, fy, .02f);
        float[][] ab = FloorMarks.pick(xyz, n[0], c.min, c.max, fy, 1f);
        assertNotNull(ab);
        assertEquals("A in the middle (x)", 2f, ab[0][0], .06f);
        assertEquals("A in the middle (z)", 1.5f, ab[0][2], .06f);
        assertEquals(1f, Alignment.horizontal(ab[0], ab[1]), 1e-4f);
        assertEquals("B along the 4 m side", 0f, ab[1][2] - ab[0][2], .05f);
        for (float[] q : ab) {
            assertEquals(fy, q[1], 1e-6f);
            assertFalse("not on the box", q[0] < 1.1f && q[2] < 1.1f);
        }
    }

    @Test public void bAvoidsFurnitureButAStaysInTheMiddle() {
        int[] n = new int[1]; float[] base = room(n);
        // a cupboard 0.8 m to the right of the middle: B goes the other way along the long axis
        java.util.ArrayList<Float> p = new java.util.ArrayList<>();
        for (float v : base) p.add(v);
        for (float x = 2.8f; x < 3.3f; x += .05f) for (float z = 1.2f; z < 1.8f; z += .05f) for (float y = -1.1f; y < -.2f; y += .1f) { p.add(x); p.add(y); p.add(z); }
        float[] xyz = new float[p.size()]; for (int i = 0; i < xyz.length; i++) xyz[i] = p.get(i);
        int cnt = xyz.length/3;
        ScanLoader.Cloud c = new ScanLoader.Cloud(xyz, new byte[cnt*3], cnt, "t");
        float[][] ab = FloorMarks.pick(xyz, cnt, c.min, c.max, -1.2f, 1f);
        assertEquals(2f, ab[0][0], .06f); assertEquals(1.5f, ab[0][2], .06f);
        assertEquals(1f, Alignment.horizontal(ab[0], ab[1]), 1e-4f);
        assertTrue("B left of A, away from the cupboard", ab[1][0] < ab[0][0] - .9f);
    }

    @Test public void emptyScanGivesNullAndTinyFloorStillHasAInTheMiddle() {
        assertNull(FloorMarks.pick(new float[0], 0, new float[]{0, 0, 0}, new float[]{0, 0, 0}, 0, 1f));
        float[] xyz = new float[300];
        for (int i = 0; i < 100; i++) { xyz[i*3] = (i % 10)*.02f; xyz[i*3+1] = 0; xyz[i*3+2] = (i / 10)*.02f; }
        float[][] ab = FloorMarks.pick(xyz, 100, new float[]{0, 0, 0}, new float[]{.18f, 0, .18f}, 0, 1f);
        assertNotNull(ab);
        assertEquals(.09f, ab[0][0], .02f); assertEquals(.09f, ab[0][2], .02f);
        assertEquals(1f, Alignment.horizontal(ab[0], ab[1]), 1e-4f);
    }
}
