package studio.junoh.phonetwin;

import android.media.AudioAttributes;
import android.media.MediaPlayer;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;

/**
 * Looping sound per recognised object. The closer the object, the louder; objects in front are louder than
 * objects behind, and left/right panning follows the direction (best with earphones).
 * The AR loop calls update() with the wanted sources; this class owns the MediaPlayers on its own thread.
 */
final class SpatialSound {
    static final class Src {
        final int key; final File file; final float left, right;
        Src(int key, File file, float left, float right) { this.key = key; this.file = file; this.left = left; this.right = right; }
    }
    private static final class Voice { MediaPlayer player; File file; float l, r; boolean wanted; float tl, tr; }

    private volatile List<Src> wanted = Collections.emptyList();
    private volatile boolean running = true, paused = false;
    private final Map<Integer, Voice> voices = new HashMap<>();   // sound thread only
    volatile String status = "";

    SpatialSound() { Thread t = new Thread(this::loop, "object-sound"); t.setDaemon(true); t.start(); }

    void update(List<Src> s) { wanted = s; }
    void setPaused(boolean p) { paused = p; }
    void shutdown() { running = false; }

    /**
     * Left/right gain for an object at horizontal distance d (metres) seen at angle a from the heading
     * (cosA, sinA; sinA > 0 = to the right). Silent beyond range, full at `near`.
     */
    static float[] gains(float d, float range, float near, float cosA, float sinA) {
        if (!(d < range)) return new float[]{0, 0};
        float g = Math.max(0, Math.min(1, (range - d)/Math.max(1e-3f, range - near)));
        g = g*g;                                              // perceived loudness rises steadily as you approach
        g *= .3f + .7f*(1 + cosA)/2;                          // in front: full, behind: 30 %
        float pan = Math.max(-1, Math.min(1, sinA))*.8f, th = (pan + 1)*(float)Math.PI/4;
        return new float[]{Math.min(1, g*(float)Math.cos(th)*1.4142f), Math.min(1, g*(float)Math.sin(th)*1.4142f)};
    }

    private void loop() {
        while (running) {
            List<Src> want = paused ? Collections.<Src>emptyList() : wanted;
            for (Voice v : voices.values()) { v.wanted = false; v.tl = 0; v.tr = 0; }
            for (Src s : want) {
                Voice v = voices.get(s.key);
                if (v != null && !v.file.equals(s.file)) { release(v); voices.remove(s.key); v = null; }
                if (v == null) {
                    v = new Voice(); v.file = s.file;
                    try {
                        MediaPlayer p = new MediaPlayer();
                        p.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
                        p.setDataSource(s.file.getAbsolutePath()); p.setLooping(true); p.setVolume(0, 0); p.prepare(); p.start();
                        v.player = p; status = "";
                    } catch (Exception e) { status = "소리 재생 실패: " + s.file.getName(); }
                    voices.put(s.key, v);
                }
                v.wanted = true; v.tl = s.left; v.tr = s.right;
            }
            Iterator<Map.Entry<Integer, Voice>> it = voices.entrySet().iterator();
            while (it.hasNext()) {
                Voice v = it.next().getValue();
                v.l += (v.tl - v.l)*.25f; v.r += (v.tr - v.r)*.25f;
                if (v.player != null) try { v.player.setVolume(v.l, v.r); } catch (Exception ignored) {}
                if (!v.wanted && v.l < .005f && v.r < .005f) { release(v); it.remove(); }
            }
            try { Thread.sleep(50); } catch (InterruptedException e) { break; }
        }
        for (Voice v : voices.values()) release(v);
        voices.clear();
    }
    private static void release(Voice v) { if (v.player != null) try { v.player.stop(); v.player.release(); } catch (Exception ignored) {} v.player = null; }

    /** Default sound when the user has not added one: a short soft ping that repeats (a "beacon"). */
    static void writeBeacon(File f) throws IOException {
        int rate = 22050, n = (int)(rate*.75f), ping = (int)(rate*.22f);
        ByteBuffer b = ByteBuffer.allocate(44 + n*2).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes("US-ASCII")).putInt(36 + n*2).put("WAVE".getBytes("US-ASCII"));
        b.put("fmt ".getBytes("US-ASCII")).putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16);
        b.put("data".getBytes("US-ASCII")).putInt(n*2);
        for (int i = 0; i < n; i++) {
            double t = i/(double)rate, env = i < ping ? Math.min(1, i/200.0)*Math.exp(-t*14) : 0;
            b.putShort((short)(env*(Math.sin(2*Math.PI*880*t) + .35*Math.sin(2*Math.PI*1760*t))*16000));
        }
        try (OutputStream o = new FileOutputStream(f)) { o.write(b.array()); }
    }
}
