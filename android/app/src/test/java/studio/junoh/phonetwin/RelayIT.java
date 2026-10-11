package studio.junoh.phonetwin;

import static org.junit.Assert.*;
import org.junit.Assume;
import org.junit.Test;

/** Runs only with RELAY_IT_URL set (a relay with RELAY_KEY=RELAY_IT_KEY and an "unreal" client echoing PTP1 -> PTH1). */
public class RelayIT {
    @Test public void phoneTalksThroughRelay() throws Exception {
        String url = System.getenv("RELAY_IT_URL"); Assume.assumeTrue(url != null && !url.isEmpty());
        String key = System.getenv("RELAY_IT_KEY") == null ? "" : System.getenv("RELAY_IT_KEY");
        UnrealLink l = new UnrealLink();
        l.setPose(true, true, new float[]{1, 2, 3}, new float[]{0, 0, -1}, new float[]{0, 1, 0}, "scan");
        l.startRelay(url, "it", key);
        long until = System.currentTimeMillis() + 8000;
        while (System.currentTimeMillis() < until && !(l.fresh(500) && l.status.contains("왕복") && l.status.contains("unreal=1"))) Thread.sleep(100);
        String status = l.status;
        l.stop();
        System.out.println("status: " + status + " | intensity " + l.rIntensity + " obj " + l.rObject);
        assertTrue("PTH1 came back through the relay", l.rIntensity > .4f && l.rObject == 7);
        assertTrue("rtt measured", status.contains("왕복"));
        assertTrue("peers shown", status.contains("unreal=1"));
    }
}
