package studio.junoh.phonetwin;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** v4: weighted voxel means, observation filter, GitHub index merge, Unreal UDP lines. */
public class V4Test {
    @Test public void voxelKeepsWeightedMeanOfPositionAndColour() {
        LiveScan ls = new LiveScan(.05f, 100);
        assertTrue(ls.add(0f, 2f, 3f, 50, 50, 50, 1f));        // first sample sets the shift (0,2,3); voxel 0 stays pinned at the origin
        assertTrue(ls.add(1.00f, 2f, 3f, 100, 0, 0, 1f));
        assertFalse(ls.add(1.02f, 2f, 3f, 200, 0, 0, 3f));     // same 5 cm voxel, 3x weight
        assertEquals(2, ls.n); assertEquals(2, ls.hits(1));
        ScanLoader.Cloud c = ls.toCloud("t");
        assertEquals(2, c.n);
        assertEquals(1.015f, c.xyz[3], 1e-5f);                 // (1*1 + 1.02*3) / 4 relative to the shift
        assertEquals(0f, c.xyz[4], 1e-6f); assertEquals(0f, c.xyz[5], 1e-6f);
        assertEquals(175, c.rgb[3] & 0xff);                    // (100*1 + 200*3) / 4
        assertArrayEquals(new float[]{0, 2, 3}, ls.shift(), 1e-6f);
        // live preview keeps the first sample
        assertEquals(1f, ls.xyz[3], 0f); assertEquals(100, ls.rgb[3] & 0xff);
    }

    @Test public void minHitsDropsSingleObservations() {
        LiveScan ls = new LiveScan(.02f, 100);
        for (int k = 0; k < 3; k++) ls.add(0, 0, 0, -1, 0, 0, 1);      // seen 3 times
        ls.add(1, 0, 0, -1, 0, 0, 1); ls.add(1.001f, 0, 0, -1, 0, 0, 1);  // seen twice
        ls.add(2, 0, 0, -1, 0, 0, 1);                                     // noise: once
        assertEquals(3, ls.n);
        assertEquals(3, ls.toCloud("", 1).n);
        assertEquals(2, ls.toCloud("", 2).n);
        assertEquals(1, ls.toCloud("", 3).n);
        assertEquals(1, ls.toCloud("", 4).n);                             // voxel 0 (the frame origin) is always kept
        assertFalse(ls.add(0, 0, 0, -1, 0, 0, 0));                        // zero weight ignored
    }

    @Test public void fullScanStillRefinesExistingVoxels() {
        LiveScan ls = new LiveScan(.1f, 2);
        ls.add(0, 0, 0, -1, 0, 0); ls.add(1, 0, 0, -1, 0, 0);
        assertTrue(ls.full());
        assertFalse(ls.add(5, 0, 0, -1, 0, 0));                           // no room for a new voxel
        ls.add(1.04f, 0, 0, -1, 0, 0);                                    // but this one updates voxel #2
        assertEquals(2, ls.hits(1));
        assertEquals(1.02f, ls.toCloud("").xyz[3], 1e-5f);
    }

    @Test public void indexMergePrependsAndReplacesSameId() throws Exception {
        JSONObject a = new JSONObject().put("id", "a").put("points", 1);
        JSONObject first = GitHubUploader.mergeIndex(null, a);
        assertEquals(1, first.getInt("version")); assertEquals(1, first.getJSONArray("scans").length());
        JSONObject b = new JSONObject().put("id", "b");
        JSONObject second = GitHubUploader.mergeIndex(first.toString(), b);
        assertEquals("b", second.getJSONArray("scans").getJSONObject(0).getString("id"));
        assertEquals("a", second.getJSONArray("scans").getJSONObject(1).getString("id"));
        JSONObject again = GitHubUploader.mergeIndex(second.toString(), new JSONObject().put("id", "a").put("points", 9));
        assertEquals(2, again.getJSONArray("scans").length());
        assertEquals(9, again.getJSONArray("scans").getJSONObject(0).getInt("points"));
        assertEquals("phone_scan_20261011_1530", GitHubUploader.scanId("phone_scan_20261011_1530.ply"));
        assertEquals("my_room__1_", GitHubUploader.scanId("my room (1).obj"));
    }

    @Test public void unrealLinesFollowProtocol() {
        String s = UnrealLink.ptp1(7, new float[]{1, 1.5f, -2, .25f, 0, -1, 0, 0, 1, 0}, "scan,a");
        assertEquals("PTP1,7,1,1.5000,-2.0000,0.2500,0.0000,-1.0000,0.0000,0.0000,1.0000,0.0000,scan_a\n", s);
        float[] v = UnrealLink.parsePth1("PTH1,12,1,255,1,104,350\n");
        assertArrayEquals(new float[]{1, 1, 1, 104, .35f}, v, 1e-6f);
        float[] far = UnrealLink.parsePth1("PTH1,1,1,0,0,-1,-1");
        assertTrue(Float.isInfinite(far[4])); assertEquals(-1, far[3], 0);
        assertNull(UnrealLink.parsePth1("PTA1,3,-60")); assertNull(UnrealLink.parsePth1("PTH1,x"));
    }
}
