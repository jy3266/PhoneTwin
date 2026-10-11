package studio.junoh.phonetwin;

import static org.junit.Assert.*;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

public class GitHubScansTest {
    @Test public void indexIsParsedNewestFirstAndUnsafeIdsDropped() throws Exception {
        List<GitHubScans.Entry> l = GitHubScans.parseIndex("{\"version\":1,\"scans\":[{\"id\":\"phone_scan_20261011_1604\",\"points\":64526,\"created\":\"2026-10-11T16:04:00+09:00\",\"device\":\"SM-S918N\"},"
            + "{\"id\":\"../evil\"},{\"id\":\"sample_test_room\",\"ply\":\"scans/sample_test_room.ply\"}]}");
        assertEquals(2, l.size());
        assertEquals("phone_scan_20261011_1604", l.get(0).id);
        assertEquals("scans/phone_scan_20261011_1604.ply", l.get(0).ply);
        assertEquals("scans/phone_scan_20261011_1604.json", l.get(0).meta);
        assertEquals(64526, l.get(0).points);
        assertTrue(GitHubScans.parseIndex("{}").isEmpty());
    }

    @Test public void metaBecomesScanData() throws Exception {
        JSONObject d = GitHubScans.toScanData("{\"id\":\"s\",\"a\":[0.5,-0.7,1],\"b\":[2,-0.7,1],"
            + "\"objects\":[{\"id\":3,\"name\":\"사물 3\",\"c\":[1,0,1],\"r\":0.2}],\"ai\":[{\"label\":\"chair\",\"name\":\"의자\",\"c\":[1,0.4,2],\"r\":0.35}]}");
        assertEquals(0.5, d.getJSONArray("a").getDouble(0), 1e-9);
        assertEquals(3, d.getJSONArray("objects").getJSONObject(0).getInt("id"));
        assertEquals("chair", d.getJSONArray("ai").getJSONObject(0).getString("label"));
        assertEquals(AiObjects.CONFIRM, d.getJSONArray("ai").getJSONObject(0).getInt("hits"));
        JSONObject none = GitHubScans.toScanData("{\"id\":\"x\",\"a\":null,\"b\":null}");
        assertFalse(none.has("a"));
        assertEquals(0, none.getJSONArray("ai").length());
    }
}
