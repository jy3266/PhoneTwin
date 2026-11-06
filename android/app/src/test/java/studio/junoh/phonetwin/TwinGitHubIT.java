package studio.junoh.phonetwin;

import java.io.File;
import java.nio.file.Files;
import java.util.Map;
import org.junit.Assume;
import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Real GitHub: the edited scan's collision file and one of its sounds, the way the app fetches them.
 * Runs only with TWIN_IT_SCAN set (e.g. phone_scan_20261030_1311).
 */
public class TwinGitHubIT {
    @Test public void downloadsCollisionsAndSounds() throws Exception {
        String id = System.getenv("TWIN_IT_SCAN");
        Assume.assumeTrue(id != null && !id.isEmpty());
        GitHubScans gh = new GitHubScans("jy3266/PhoneTwin", "main", "");
        String json = gh.collisionJson(id);
        assertNotNull(json);
        Collisions c = Collisions.parse(json);
        assertFalse(c.shapes.isEmpty());
        assertNull(gh.collisionJson("no_such_scan_x"));
        Map<String, String> shas = gh.soundShas();
        String name = null;
        for (Collisions.Shape s : c.shapes) if (!s.nearSound.isEmpty() && shas.containsKey(s.nearSound)) { name = s.nearSound; break; }
        assertNotNull("a near sound of " + id + " is on GitHub", name);
        File f = File.createTempFile("twin", ".wav"); f.deleteOnExit();
        gh.downloadSound(name, f);
        assertEquals("the phone's sha check sees GitHub's file as up to date", shas.get(name), GitHubScans.blobSha(f));
        short[] pcm = TwinAudio.readWav(Files.readAllBytes(f.toPath()));
        assertTrue(pcm.length > 48000);
        System.out.println(id + ": " + c.shapes.size() + " shapes, sounds on GitHub " + shas.size() + ", got " + name + " (" + pcm.length/2 + " frames)");
    }
}
