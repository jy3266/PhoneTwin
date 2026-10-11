package studio.junoh.phonetwin;

import static org.junit.Assert.*;
import java.util.Arrays;
import org.junit.Test;

public class RelayTest {
    @Test public void buildsRelayUrl() {
        assertEquals("wss://a.ondigitalocean.app/ws?room=arko&role=phone&key=k", UnrealLink.relayUrl("https://a.ondigitalocean.app/", "arko", "k", "phone"));
        assertEquals("wss://a.app/ws?room=arko&role=phone&key=", UnrealLink.relayUrl("a.app", "", "", "phone"));
        assertEquals("ws://127.0.0.1:8080/ws?room=r+1&role=phone&key=a%26b", UnrealLink.relayUrl("ws://127.0.0.1:8080/ws", "r 1", "a&b", "phone"));
        assertEquals("ws://h/ws?room=x&role=phone&key=", UnrealLink.relayUrl("http://h", "x", "", "phone"));
    }
    @Test public void relayLinesUpdateState() {
        UnrealLink l = new UnrealLink();
        l.onLine("PTH1,9,1,128,1,3,123");
        assertTrue(l.rValid); assertTrue(l.rContact); assertEquals(3, l.rObject); assertEquals(128/255f, l.rIntensity, 1e-6); assertEquals(.123f, l.rDistance, 1e-6);
        assertTrue(l.fresh(1000));
        l.onLine("PTH1,10,1,0,0,-1,-1");
        assertEquals(-1, l.rObject); assertTrue(Float.isInfinite(l.rDistance));
        l.onLine("PTR1,peers,phone=1,esp32=0,unreal=1,viewer=0");   // must not throw or touch haptics
        l.onLine("PTR1,pong,notanumber");
        assertFalse(l.rContact);
        assertEquals(300, l.freshWindow());
    }
    @Test public void medianOfRtts() {
        assertTrue(Float.isNaN(UnrealLink.median(Arrays.<Float>asList())));
        assertEquals(50f, UnrealLink.median(Arrays.asList(90f, 50f, 10f)), 0);
    }
}
