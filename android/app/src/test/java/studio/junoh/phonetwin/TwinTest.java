package studio.junoh.phonetwin;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import static org.junit.Assert.*;

/** Collision shapes, touch rules and sounds that must match the Unreal plugin (PhoneTwinScanActor / PhoneTwinCalmSound). */
public class TwinTest {
    private static final String FILE = "{\"version\":1,\"scan\":\"s1\",\"voxel\":0.04,\"collisions\":["
        + "{\"id\":100,\"label\":\"bed\",\"name\":\"침대\",\"source\":\"ai\",\"cells\":[0,0,0, 1,0,0, 2,0,0],\"nearSound\":\"a.wav\",\"touchSound\":\"b.wav\",\"volume\":0.5},"
        + "{\"id\":200,\"label\":\"상자\",\"name\":\"벽\",\"source\":\"user\",\"cells\":[50,0,0],\"muted\":true,\"maxDistance\":2}]}";

    @Test public void parsesCellCentres() throws Exception {
        Collisions c = Collisions.parse(FILE);
        assertTrue(c.fromFile); assertEquals("s1", c.scan); assertEquals(2, c.shapes.size());
        Collisions.Shape b = c.shapes.get(0);
        assertEquals(100, b.id); assertEquals("침대", b.name); assertTrue(b.ai); assertEquals(.5f, b.volume, 1e-6);
        assertEquals(.02f, b.cells[0], 1e-6); assertEquals(.06f, b.cells[3], 1e-6); assertEquals(.02f, b.cellR, 1e-6);
        assertEquals(.06f, b.cx, 1e-6); assertEquals(4f, b.maxRange(), 0); assertEquals(.5f, b.fullRange(), 0);
        assertTrue(c.shapes.get(1).muted); assertEquals(2f, c.shapes.get(1).maxRange(), 0);
    }

    @Test public void measuresFloorAndHandLikeUnreal() throws Exception {
        Collisions c = Collisions.parse(FILE);
        float[] audience = {.06f, 1.5f, 1.02f}, hand = {.06f, .02f, .32f};
        c.measure(audience, hand);
        Collisions.Shape b = c.shapes.get(0);
        assertEquals(1.0f - .02f, b.floorD, 1e-4);   // floor plane only: height does not count
        assertEquals(.30f - .02f, b.handD, 1e-4);    // 3D to the nearest cell centre minus half a voxel
        assertEquals(.06f, b.handNear[0], 1e-6);
    }

    @Test public void gainsFollowTheWebAndUnrealFormula() throws Exception {
        Collisions c = Collisions.parse(FILE);
        float[] fwd = {0, 1};   // looking along +z
        // in front, 2.25 m: G = (4-2.25)/(4-.5) = .5 → .25 · volume .5
        float[] g = c.gains(new float[]{2.25f, .1f}, new float[]{.06f, 0, -2.3f}, fwd, 1);
        assertEquals(.125f, g[0], 1e-4);
        assertEquals(0f, g[1], 0);   // muted
        // straight behind: 30 %
        g = c.gains(new float[]{2.25f, 9f}, new float[]{.06f, 0, 2.3f}, fwd, 1);
        assertEquals(.125f*.3f, g[0], 1e-4);
        // inside the full distance and beyond the range
        assertEquals(1f, Collisions.distanceGain(.3f, .5f, 4f), 0);
        assertEquals(0f, Collisions.distanceGain(4.5f, .5f, 4f), 0);
        // vibration intensity as PhoneTwin::Intensity (30 cm range, 3 cm contact)
        assertEquals(0f, Collisions.intensity(.3f, .3f, .03f), 0);
        assertEquals(1f, Collisions.intensity(.03f, .3f, .03f), 1e-6);
        assertEquals(.5f, Collisions.intensity(.165f, .3f, .03f), 1e-5);
    }

    @Test public void touchRingsOnceThenEveryFourSeconds() {
        Collisions.Toucher t = new Collisions.Toucher();
        assertEquals(1f, t.step(10, true, false), 0);
        assertEquals(0f, t.step(11, true, false), 0);
        assertEquals(0f, t.step(13.9, true, false), 0);
        assertEquals(.55f, t.step(14.1, true, false), 0);
        assertEquals(0f, t.step(14.5, false, true), 0);      // walked away (> 50 cm)
        assertEquals(0f, t.step(14.7, true, false), 0);      // back within .8 s of the last strike: quiet
        assertEquals(1f, t.step(15.0, true, false), 0);      // a new touch: full strength again
    }

    @Test public void calmVoicesMatchUnrealTable() {
        assertEquals(146.83f*.5f, CalmSynth.note(0, 2), 1e-3);
        assertEquals(220f*4, CalmSynth.note(3, 5), 1e-2);
        assertEquals("bed", CalmSynth.voiceFor("Bed ").key);
        assertEquals("cup", CalmSynth.voiceFor("vase").key);
        assertEquals("surface", CalmSynth.voiceFor("surface").key);
        CalmSynth.Voice v = CalmSynth.voiceFor("상자");
        assertEquals("상자", v.key);
        assertEquals(1f, v.bellRatio[0], 0); assertEquals(5.15f, v.bellRatio[2], 0); assertEquals(1f, v.bellDecay[3], 0);
        // FCrc table: non-reflected CRC-32 (poly 0x04C11DB7); "" hashes to 0; case-insensitive like Strihash
        assertEquals(0, CalmSynth.ueHash(""));
        assertEquals(CalmSynth.ueHash("Chair"), CalmSynth.ueHash("CHAIR"));
        assertNotEquals(CalmSynth.ueHash("a"), CalmSynth.ueHash("b"));
    }

    @Test public void synthPadSwellsAndChimeRings() {
        CalmSynth s = new CalmSynth(CalmSynth.voiceFor("bed"), 48000);
        float[] buf = new float[48000];
        s.render(buf, buf.length); assertEquals(0f, s.peak(), 1e-6);   // silent until something happens
        s.setNear(1); for (int i = 0; i < 4; i++) s.render(buf, buf.length);
        float pad = s.peak(); assertTrue("pad " + pad, pad > .02f && pad < 1f);
        s.setNear(0); for (int i = 0; i < 12; i++) s.render(buf, buf.length);
        assertTrue("faded " + s.peak(), s.peak() < .01f);
        s.touch(1); s.render(buf, 4800);
        float bell = s.peak(); assertTrue("bell " + bell, bell > .05f && bell <= 1f);
        CalmSynth k = new CalmSynth(CalmSynth.voiceFor("keyboard"), 48000); k.setNear(1);
        for (int i = 0; i < 3; i++) k.render(buf, buf.length);
        assertTrue(k.peak() > .02f);
    }

    private static byte[] wav(int rate, int ch, short[] samples) {
        ByteBuffer b = ByteBuffer.allocate(44 + samples.length*2).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes()).putInt(36 + samples.length*2).put("WAVE".getBytes());
        b.put("fmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)ch).putInt(rate).putInt(rate*ch*2).putShort((short)(ch*2)).putShort((short)16);
        b.put("data".getBytes()).putInt(samples.length*2);
        for (short s : samples) b.putShort(s);
        return b.array();
    }
    @Test public void readsWavFiles() throws Exception {
        short[] st = TwinAudio.readWav(wav(48000, 2, new short[]{1, 2, 3, 4}));
        assertArrayEquals(new short[]{1, 2, 3, 4}, st);
        short[] mono = TwinAudio.readWav(wav(48000, 1, new short[]{100, -100}));
        assertArrayEquals(new short[]{100, 100, -100, -100}, mono);
        short[] slow = TwinAudio.readWav(wav(24000, 1, new short[]{0, 1000, 2000, 3000}));
        assertEquals(16, slow.length);                  // 4 frames at 24 kHz → 8 frames at 48 kHz
        assertEquals(500, slow[2]);                     // halfway between 0 and 1000
        try { TwinAudio.readWav(new byte[]{1, 2, 3}); fail(); } catch (java.io.IOException expected) {}
    }

    @Test public void editorSoundsWinCalmFillsTheRest() {
        short[] pcm = {0, 0};
        TwinAudio.Voice both = TwinAudio.make("bed", pcm, pcm, 1);
        assertNull(both.calm); assertFalse(both.calmNear);
        TwinAudio.Voice touchOnly = TwinAudio.make("bed", null, pcm, 1);
        assertNotNull(touchOnly.calm); assertTrue(touchOnly.calmNear);
        TwinAudio.Voice none = TwinAudio.make("cup", null, null, .5f);
        assertNotNull(none.calm); assertEquals(.5f, none.volume, 0);
    }
}
