package studio.junoh.phonetwin;

import android.opengl.GLES20;
import java.nio.*;

/** Draws the scan point cloud (with a glow around the hand) plus simple line/point markers. */
final class CloudRenderer {
    private static final String POINT_VS =
        "uniform mat4 uMV;uniform mat4 uP;uniform float uSize;uniform vec3 uProbe;uniform float uGlow;" +
        "attribute vec3 aPos;attribute vec3 aCol;varying vec3 vCol;" +
        "void main(){vec4 mv=uMV*vec4(aPos,1.);gl_Position=uP*mv;" +
        "gl_PointSize=clamp(uSize/max(.05,-mv.z),1.,16.);" +
        "float g=uGlow>0.?1.-smoothstep(0.,uGlow,distance(aPos,uProbe)):0.;" +
        "vCol=mix(aCol,vec3(1.,.28,.12),g*.85);}";
    private static final String POINT_FS =
        "precision mediump float;uniform float uAlpha;varying vec3 vCol;void main(){gl_FragColor=vec4(vCol,uAlpha);}";
    private static final String LINE_VS =
        "uniform mat4 uMVP;uniform float uPointSize;attribute vec3 aPos;" +
        "void main(){gl_Position=uMVP*vec4(aPos,1.);gl_PointSize=uPointSize;}";
    private static final String LINE_FS =
        "precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}";

    private int pointProg, lineProg, count;
    private final int[] vbo = new int[2];
    private ScanLoader.Cloud uploaded, pending;
    private final FloatBuffer lines = ByteBuffer.allocateDirect(8192*4).order(ByteOrder.nativeOrder()).asFloatBuffer();

    private static int shader(int type, String src) {
        int s = GLES20.glCreateShader(type); GLES20.glShaderSource(s, src); GLES20.glCompileShader(s);
        int[] ok = new int[1]; GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) throw new IllegalStateException(GLES20.glGetShaderInfoLog(s));
        return s;
    }
    private static int program(String vs, String fs) {
        int p = GLES20.glCreateProgram();
        GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs)); GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs));
        GLES20.glLinkProgram(p);
        int[] ok = new int[1]; GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0);
        if (ok[0] == 0) throw new IllegalStateException(GLES20.glGetProgramInfoLog(p));
        return p;
    }

    /** GL thread, on every (re)created surface. Re-uploads the current cloud. */
    void create() {
        pointProg = program(POINT_VS, POINT_FS); lineProg = program(LINE_VS, LINE_FS);
        GLES20.glGenBuffers(2, vbo, 0);
        if (uploaded != null && pending == null) pending = uploaded;
        uploaded = null; count = 0;
        if (live) liveLost = true;
    }

    /** Any thread: the cloud is uploaded on the next draw. */
    synchronized void setCloud(ScanLoader.Cloud c) { pending = c; }

    private synchronized void upload() {
        if (pending == null) return;
        ScanLoader.Cloud c = pending; pending = null;
        FloatBuffer p = ByteBuffer.allocateDirect(c.n*12).order(ByteOrder.nativeOrder()).asFloatBuffer();
        p.put(c.xyz, 0, c.n*3).position(0);
        ByteBuffer col = ByteBuffer.allocateDirect(c.n*3); col.put(c.rgb, 0, c.n*3).position(0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0]); GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, c.n*12, p, GLES20.GL_STATIC_DRAW);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[1]); GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, c.n*3, col, GLES20.GL_STATIC_DRAW);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        uploaded = c; count = c.n;
    }

    boolean hasCloud() { return count > 0 || pending != null; }

    // ---- live scan: fixed-capacity buffers filled incrementally (GL thread only)
    private boolean live = false, liveLost = false;

    void beginLive(int capacity) {
        synchronized (this) { pending = null; }
        live = true; liveLost = false; uploaded = null; count = 0;
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0]); GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, capacity*12, null, GLES20.GL_DYNAMIC_DRAW);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[1]); GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, capacity*3, null, GLES20.GL_DYNAMIC_DRAW);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
    }

    /** Uploads points [from, to) of the live arrays. */
    void appendLive(float[] xyz, byte[] rgb, int from, int to) {
        if (!live || to <= from) return;
        int k = to - from;
        FloatBuffer p = ByteBuffer.allocateDirect(k*12).order(ByteOrder.nativeOrder()).asFloatBuffer(); p.put(xyz, from*3, k*3).position(0);
        ByteBuffer c = ByteBuffer.allocateDirect(k*3); c.put(rgb, from*3, k*3).position(0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0]); GLES20.glBufferSubData(GLES20.GL_ARRAY_BUFFER, from*12, k*12, p);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[1]); GLES20.glBufferSubData(GLES20.GL_ARRAY_BUFFER, from*3, k*3, c);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        count = to;
    }

    void endLive() { live = false; count = 0; }

    /** True once after the GL context was recreated during a live scan (caller re-begins and re-appends). */
    boolean consumeLiveLost() { boolean l = liveLost; liveLost = false; return l; }

    /** mv/p: model-view (scan frame → eye) and projection. probe in scan frame; glow radius in scan units (0 = off). */
    void drawPoints(float[] mv, float[] p, float size, float[] probe, float glow, float alpha) {
        upload();
        if (count == 0) return;
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
        if (alpha < 1) { GLES20.glEnable(GLES20.GL_BLEND); GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA); }
        GLES20.glUseProgram(pointProg);
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(pointProg, "uMV"), 1, false, mv, 0);
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(pointProg, "uP"), 1, false, p, 0);
        GLES20.glUniform1f(GLES20.glGetUniformLocation(pointProg, "uSize"), size);
        GLES20.glUniform3f(GLES20.glGetUniformLocation(pointProg, "uProbe"), probe[0], probe[1], probe[2]);
        GLES20.glUniform1f(GLES20.glGetUniformLocation(pointProg, "uGlow"), glow);
        GLES20.glUniform1f(GLES20.glGetUniformLocation(pointProg, "uAlpha"), alpha);
        int a = GLES20.glGetAttribLocation(pointProg, "aPos"), c = GLES20.glGetAttribLocation(pointProg, "aCol");
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0]); GLES20.glEnableVertexAttribArray(a); GLES20.glVertexAttribPointer(a, 3, GLES20.GL_FLOAT, false, 0, 0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[1]); GLES20.glEnableVertexAttribArray(c); GLES20.glVertexAttribPointer(c, 3, GLES20.GL_UNSIGNED_BYTE, true, 0, 0);
        GLES20.glDrawArrays(GLES20.GL_POINTS, 0, count);
        GLES20.glDisableVertexAttribArray(a); GLES20.glDisableVertexAttribArray(c);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0);
        GLES20.glDisable(GLES20.GL_BLEND);
    }

    /** Client-side vertices (xyz) drawn as GL_LINES / GL_LINE_LOOP / GL_POINTS, on top of everything. */
    void drawShape(float[] mvp, float[] xyz, int floats, int mode, float r, float g, float b, float pointSize) {
        if (floats <= 0) return;
        floats = Math.min(floats, lines.capacity());
        lines.clear(); lines.put(xyz, 0, floats).position(0);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glUseProgram(lineProg);
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(lineProg, "uMVP"), 1, false, mvp, 0);
        GLES20.glUniform4f(GLES20.glGetUniformLocation(lineProg, "uColor"), r, g, b, 1);
        GLES20.glUniform1f(GLES20.glGetUniformLocation(lineProg, "uPointSize"), pointSize);
        GLES20.glLineWidth(3);
        int a = GLES20.glGetAttribLocation(lineProg, "aPos");
        GLES20.glEnableVertexAttribArray(a); GLES20.glVertexAttribPointer(a, 3, GLES20.GL_FLOAT, false, 0, lines);
        GLES20.glDrawArrays(mode, 0, floats/3);
        GLES20.glDisableVertexAttribArray(a);
    }

    /** Three orthogonal rings of radius rad around (x,y,z): a cheap wire sphere for an interactive object. */
    void drawSphere(float[] mvp, float x, float y, float z, float rad, float r, float g, float b) {
        final int seg = 40; float[] v = new float[seg*3];
        for (int axis = 0; axis < 3; axis++) {
            for (int i = 0; i < seg; i++) {
                double t = 2*Math.PI*i/seg; float u = (float)(Math.cos(t)*rad), w = (float)(Math.sin(t)*rad);
                v[i*3]   = x + (axis == 0 ? 0 : u);
                v[i*3+1] = y + (axis == 1 ? 0 : axis == 0 ? u : w);
                v[i*3+2] = z + (axis == 2 ? 0 : w);
            }
            drawShape(mvp, v, v.length, GLES20.GL_LINE_LOOP, r, g, b, 1);
        }
    }
}
