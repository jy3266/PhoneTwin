package studio.junoh.phonetwin;

import java.util.*;
import org.json.*;

/**
 * Collision shapes made in the collision editor (web_scans/&lt;id&gt;.collision.json, PROTOCOL.md §5) and the
 * touch / approach rules of the Unreal plugin (APhoneTwinScanActor::MeasureObjects, UpdateSounds, DriveSound),
 * so the phone decides "close", "touching" and "how loud" exactly like Unreal. All lengths here are metres in
 * the scan frame S (x, z = floor plane, y = up); callers multiply by the alignment scale.
 */
final class Collisions {
    // Unreal defaults (APhoneTwinScanActor): TouchDistance 35 cm, release +15 cm, TouchRepeatSeconds 4,
    // SoundRange 400 cm, SoundFullDistance 50 cm, MaxSimultaneousSounds 6, behind = 30 %
    static final float TOUCH = .35f, RELEASE_EXTRA = .15f, REPEAT_S = 4f, FIRST_GAP_S = .8f;
    static final float SOUND_RANGE = 4f, SOUND_FULL = .5f, BEHIND = .3f; static final int MAX_SOUNDS = 6;

    static final class Shape {
        int id; String label = "", name = "", nearSound = "", touchSound = ""; boolean ai, muted;
        float volume = 1, full = -1, max = -1;           // full/max < 0: Unreal's SoundFullDistance / SoundRange
        float[] cells = new float[0]; float cellR;        // cell centres (x,y,z …), half a voxel
        float cx, cy, cz, r;                              // centre + rough radius (labels, sphere objects)
        float[] preview = new float[0];                   // at most ~1500 cells for drawing
        // measured every frame (GL thread)
        float floorD = Float.POSITIVE_INFINITY, handD = Float.POSITIVE_INFINITY;
        final float[] handNear = new float[3];
        boolean isSphere() { return cells.length == 0; }
        float maxRange() { return max >= 0 ? max : SOUND_RANGE; }
        float fullRange() { return full >= 0 ? full : SOUND_FULL; }
    }

    final List<Shape> shapes; final boolean fromFile; final String scan;
    Collisions(List<Shape> s, boolean fromFile, String scan) { shapes = s; this.fromFile = fromFile; this.scan = scan; }

    /** Parses a collision file (same rules as PhoneTwin::ParseCollisions: cell (i,j,k) centre = (i+.5)·voxel). */
    static Collisions parse(String json) throws JSONException {
        JSONObject o = new JSONObject(json);
        float voxel = (float)o.optDouble("voxel", .04);
        JSONArray arr = o.getJSONArray("collisions");
        List<Shape> out = new ArrayList<>();
        for (int n = 0; n < arr.length(); n++) {
            JSONObject e = arr.optJSONObject(n); if (e == null) continue;
            JSONArray flat = e.optJSONArray("cells"); if (flat == null || flat.length() < 3) continue;
            Shape s = new Shape();
            s.id = e.optInt("id", 0); s.label = e.optString("label", ""); s.name = e.optString("name", "");
            if (s.name.isEmpty()) s.name = s.label;
            s.ai = "ai".equals(e.optString("source", "")); s.nearSound = e.optString("nearSound", ""); s.touchSound = e.optString("touchSound", "");
            s.volume = (float)e.optDouble("volume", 1); s.full = (float)e.optDouble("fullDistance", -1); s.max = (float)e.optDouble("maxDistance", -1);
            s.muted = e.optBoolean("muted", false);
            int k = flat.length()/3; s.cells = new float[k*3]; s.cellR = voxel*.5f;
            float[] lo = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE}, hi = {-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
            for (int i = 0; i < k; i++)
                for (int a = 0; a < 3; a++) {
                    float v = (float)((flat.getDouble(i*3 + a) + .5)*voxel); s.cells[i*3 + a] = v;
                    lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v);
                }
            s.cx = (lo[0] + hi[0])/2; s.cy = (lo[1] + hi[1])/2; s.cz = (lo[2] + hi[2])/2;
            s.r = Math.max((hi[0] - lo[0])/2, (hi[2] - lo[2])/2) + voxel*.5f;
            int step = Math.max(1, (k + 1499)/1500); s.preview = new float[((k + step - 1)/step)*3];
            for (int i = 0, j = 0; i < k; i += step, j++) System.arraycopy(s.cells, i*3, s.preview, j*3, 3);
            out.add(s);
        }
        return new Collisions(out, true, o.optString("scan", ""));
    }

    /** Without a collision file Unreal uses the spheres of the scan meta (placed objects + AI objects). */
    static Shape sphere(int id, String label, String name, boolean ai, float x, float y, float z, float r) {
        Shape s = new Shape(); s.id = id; s.label = label; s.name = name.isEmpty() ? label : name; s.ai = ai;
        s.cx = x; s.cy = y; s.cz = z; s.r = r; return s;
    }

    /** MeasureObjects: floor-plane distance from the audience and 3D distance from the hand to every shape's surface. */
    void measure(float[] audience, float[] hand) {
        for (Shape o : shapes) {
            if (o.isSphere()) {
                float dx = hand[0] - o.cx, dy = hand[1] - o.cy, dz = hand[2] - o.cz, len = (float)Math.sqrt(dx*dx + dy*dy + dz*dz);
                o.floorD = Math.max(0, (float)Math.hypot(audience[0] - o.cx, audience[2] - o.cz) - o.r);
                o.handD = Math.max(0, len - o.r);
                if (len > 1e-5f) { o.handNear[0] = o.cx + dx/len*o.r; o.handNear[1] = o.cy + dy/len*o.r; o.handNear[2] = o.cz + dz/len*o.r; }
                else System.arraycopy(hand, 0, o.handNear, 0, 3);
                continue;
            }
            float floor2 = Float.MAX_VALUE, hand2 = Float.MAX_VALUE; int at = 0; float[] c = o.cells;
            for (int i = 0; i < c.length; i += 3) {
                float dx = c[i] - audience[0], dz = c[i+2] - audience[2], f2 = dx*dx + dz*dz;
                if (f2 < floor2) floor2 = f2;
                float hx = c[i] - hand[0], hy = c[i+1] - hand[1], hz = c[i+2] - hand[2], h2 = hx*hx + hy*hy + hz*hz;
                if (h2 < hand2) { hand2 = h2; at = i; }
            }
            o.floorD = Math.max(0, (float)Math.sqrt(floor2) - o.cellR); o.handD = Math.max(0, (float)Math.sqrt(hand2) - o.cellR);
            o.handNear[0] = c[at]; o.handNear[1] = c[at+1]; o.handNear[2] = c[at+2];
        }
    }

    /** PhoneTwin::Intensity: 0 beyond range, 1 at the contact distance. */
    static float intensity(float d, float range, float contact) {
        float c = Math.min(contact, range*.9f);
        return d >= range ? 0 : Math.max(0, Math.min(1, (range - d)/(range - c)));
    }
    /** distanceGain() of web/collision_core.js and Unreal's UpdateSounds (before squaring). */
    static float distanceGain(float d, float full, float max) {
        return d <= full ? 1f : Math.max(0, Math.min(1, (max - d)/Math.max(.01f, max - full)));
    }

    /**
     * UpdateSounds: approach gain of every shape (the 6 nearest within range, louder when closer, 30 % when behind).
     * d = floor distances in metres (already scaled), fwd = horizontal heading (x, z), pos = audience (S).
     */
    float[] gains(float[] d, float[] pos, float[] fwd, float scale) {
        int n = shapes.size(); float[] g = new float[n];
        Integer[] order = new Integer[n]; int k = 0;
        for (int i = 0; i < n; i++) if (d[i] < shapes.get(i).maxRange() && !shapes.get(i).muted) order[k++] = i;
        Arrays.sort(order, 0, k, (a, b) -> Float.compare(d[a], d[b]));
        for (int j = 0; j < Math.min(MAX_SOUNDS, k); j++) {
            int i = order[j]; Shape o = shapes.get(i);
            float gg = distanceGain(d[i], o.fullRange(), o.maxRange());
            float tx = o.cx - pos[0], tz = o.cz - pos[2], tl = (float)Math.hypot(tx, tz);
            float front = tl < 1e-4f/scale || (fwd[0] == 0 && fwd[1] == 0) ? 1 : (fwd[0]*tx + fwd[1]*tz)/tl;
            g[i] = gg*gg*o.volume*(front >= 0 ? 1 : 1 + (BEHIND - 1)*-front);
        }
        return g;
    }

    /** DriveSound's touch rule for one sound: when it rings, how strong (1 first, .55 while it lasts). */
    static final class Toucher {
        boolean touching; double lastStrike = -1e9;
        /** Returns 0 when nothing rings, else the chime strength. */
        float step(double now, boolean touchNow, boolean released) {
            if (touchNow && now - lastStrike > (touching ? REPEAT_S : FIRST_GAP_S)) {
                float s = touching ? .55f : 1f; touching = true; lastStrike = now; return s;
            }
            if (released) touching = false;
            return 0;
        }
    }
}
