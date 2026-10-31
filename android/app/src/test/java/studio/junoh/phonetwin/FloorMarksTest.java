package studio.junoh.phonetwin;

import org.junit.Test;
import static org.junit.Assert.*;

/** Automatic scan A·B: 1 m apart, on open floor, away from furniture. */
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

    @Test public void picksTwoOpenFloorPointsOneMetreApart() {
        int[] n = new int[1]; float[] xyz = room(n);
        ScanLoader.Cloud c = new ScanLoader.Cloud(xyz, new byte[n[0]*3], n[0], "t");
        float fy = ObstacleMap.estimateFloor(xyz, n[0], c.min[1], c.max[1]);
        assertEquals(-1.2f, fy, .02f);
        float[][] ab = FloorMarks.pick(xyz, n[0], c.min, c.max, fy, 1f);
        assertNotNull(ab);
        assertEquals(1f, Alignment.horizontal(ab[0], ab[1]), 1e-4f);
        for (float[] q : ab) {
            assertEquals(fy, q[1], 1e-6f);
            assertTrue("inside the room", q[0] > .1f && q[0] < 3.9f && q[2] > .1f && q[2] < 2.9f);
            assertFalse("not on the box", q[0] < 1.1f && q[2] < 1.1f);
        }
    }

    @Test public void tooSmallFloorGivesNull() {
        float[] xyz = new float[300];
        for (int i = 0; i < 100; i++) { xyz[i*3] = (i % 10)*.02f; xyz[i*3+1] = 0; xyz[i*3+2] = (i / 10)*.02f; }
        assertNull(FloorMarks.pick(xyz, 100, new float[]{0, 0, 0}, new float[]{.2f, 0, .2f}, 0, 1f));
    }
}
