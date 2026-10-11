package studio.junoh.phonetwin;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.*;

/**
 * UDP link to the Unreal PC (PROTOCOL.md §1). Sends the latest phone pose as PTP1 at ~30 Hz to host:port
 * (default 7777) and listens on UDP 4211 for PTH1 haptic values computed by Unreal.
 * The AR loop only calls setPose(); everything else runs on the link's own threads.
 *
 * Relay mode (PROTOCOL.md §3): the same PTP1/PTH1 lines travel over a WebSocket to the DigitalOcean relay
 * (wss://host/ws?room=..&role=phone&key=..) for when the phone and the Unreal PC are not on one Wi-Fi.
 */
final class UnrealLink {
    static final int LISTEN_PORT = 4211;

    private volatile boolean running = false;
    private volatile String host = ""; private volatile int port = 7777;
    private volatile Thread sendThread, recvThread; private volatile DatagramSocket recvSocket;

    // latest pose in scan frame S (written by the GL thread as one array so it is never torn)
    private volatile float[] pose = null;         // {valid, x,y,z, fx,fy,fz, ux,uy,uz}
    private volatile String scanId = "";

    // last PTH1 from Unreal
    private volatile long rxAt = 0; private volatile String rxFrom = "";
    volatile boolean rValid, rContact; volatile float rIntensity, rDistance = Float.POSITIVE_INFINITY; volatile int rObject = -1;
    volatile String status = "언리얼 연동 꺼짐";
    private volatile long sent = 0;

    boolean running() { return running; }
    /** True when a PTH1 arrived within ms. */
    boolean fresh(long ms) { return System.currentTimeMillis() - rxAt < ms; }
    /** How old an Unreal PTH1 may be before falling back to local haptics: the relay adds ~100-200 ms. */
    long freshWindow() { return relay ? 700 : 300; }

    // ---- relay mode
    private volatile boolean relay = false;
    private volatile String relayUrl = "";
    private OkHttpClient client;
    private volatile WebSocket ws; private volatile boolean wsOpen = false; private volatile long retryAt = 0;
    private volatile String peers = "", wsState = "";
    private volatile int gen = 0;   // bumps on start/stop so callbacks of old sockets are ignored
    private final List<Float> rtts = new ArrayList<>();
    boolean relayMode() { return relay; }

    /** Builds wss://host/ws?room=..&role=phone&key=.. from what the user typed (scheme optional, http(s) mapped to ws(s)). */
    static String relayUrl(String base, String room, String key, String role) {
        String b = base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.endsWith("/ws")) b = b.substring(0, b.length() - 3);
        if (b.startsWith("https://")) b = "wss://" + b.substring(8);
        else if (b.startsWith("http://")) b = "ws://" + b.substring(7);
        else if (!b.startsWith("ws://") && !b.startsWith("wss://")) b = "wss://" + b;
        return b + "/ws?room=" + enc(room.trim().isEmpty() ? "arko" : room.trim()) + "&role=" + role + "&key=" + enc(key.trim());
    }
    private static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; } }
    static float median(List<Float> v) { if (v.isEmpty()) return Float.NaN; float[] a = new float[v.size()]; for (int i = 0; i < a.length; i++) a[i] = v.get(i); Arrays.sort(a); return a[a.length/2]; }

    /** Handles one text line from Unreal/relay. */
    void onLine(String line) {
        if (line.startsWith("PTH1")) {
            float[] v = parsePth1(line); if (v == null) return;
            rValid = v[0] > 0; rIntensity = v[1]; rContact = v[2] > 0; rObject = (int)v[3]; rDistance = v[4];
            rxFrom = relay ? "릴레이" : rxFrom; rxAt = System.currentTimeMillis();
        } else if (line.startsWith("PTR1,peers,")) peers = line.substring(11).trim();
        else if (line.startsWith("PTR1,pong,")) {
            try {
                float ms = (System.nanoTime() - Long.parseLong(line.substring(10).trim()))/1e6f;
                synchronized (rtts) { rtts.add(ms); if (rtts.size() > 10) rtts.remove(0); }
            } catch (NumberFormatException ignored) {}
        }
    }

    synchronized void startRelay(String base, String room, String key) {
        stop();
        relayUrl = relayUrl(base, room, key, "phone"); gen++; relay = true; running = true; retryAt = 0; peers = ""; wsState = "접속 중";
        synchronized (rtts) { rtts.clear(); }
        if (client == null) client = new OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(15, TimeUnit.SECONDS).build();
        Thread s = new Thread(this::relayLoop, "relay-send"); s.setDaemon(true); sendThread = s; s.start();
    }

    private void relayLoop() {
        long seq = 0, lastPing = 0;
        while (running && relay && Thread.currentThread() == sendThread) {
            long start = System.currentTimeMillis();
            WebSocket w = ws;
            if (w == null && start >= retryAt) {
                wsState = "접속 중"; retryAt = Long.MAX_VALUE;   // one attempt at a time; drop() schedules the next
                // ws is only set once the socket is open, so callbacks can never race the assignment
                final int g = gen;
                client.newWebSocket(new Request.Builder().url(relayUrl).build(), new WebSocketListener() {
                    @Override public void onOpen(WebSocket s, Response r) {
                        if (g != gen || !running || !relay) { s.close(1000, "stop"); return; }
                        ws = s; wsOpen = true; wsState = "연결됨";
                    }
                    @Override public void onMessage(WebSocket s, String text) { if (g != gen) return; for (String l : text.split("\n")) if (!l.isEmpty()) onLine(l); }
                    @Override public void onFailure(WebSocket s, Throwable t, Response r) { drop(g, s, r != null && r.code() == 401 ? "키가 틀립니다 (401)" : "연결 실패: " + t.getClass().getSimpleName()); }
                    @Override public void onClosed(WebSocket s, int code, String reason) { drop(g, s, "연결 끊김"); }
                });
            }
            if (w != null && wsOpen) {
                float[] q = pose;
                if (q != null) { w.send(ptp1(++seq, q, scanId)); sent = start; }
                if (start - lastPing >= 2000) { lastPing = start; w.send("PTR1,ping," + System.nanoTime()); }
            }
            float m; synchronized (rtts) { m = median(rtts); }
            status = "릴레이 " + wsState + (peers.isEmpty() ? "" : " · " + peers) + (Float.isNaN(m) ? "" : String.format(Locale.US, " · 왕복 %.0f ms", m))
                + (fresh(freshWindow()) ? " · 언리얼 진동 수신 OK" : " · 언리얼 진동 신호 없음");
            long wait = 33 - (System.currentTimeMillis() - start);
            if (wait > 0) try { Thread.sleep(wait); } catch (InterruptedException e) { break; }
        }
    }
    private void drop(int g, WebSocket s, String why) {
        if (g != gen || (ws != null && s != ws)) return;   // a socket from an earlier start/stop
        ws = null; wsOpen = false; wsState = why + " · 2초 뒤 재접속"; retryAt = System.currentTimeMillis() + 2000;
    }

    /** walk: the walking test is running on the phone (the start switch for Unreal's vibration and sound). */
    void setPose(boolean valid, boolean walk, float[] p, float[] f, float[] u, String scanId) {
        pose = new float[]{valid ? 1 : 0, p[0], p[1], p[2], f[0], f[1], f[2], u[0], u[1], u[2], walk ? 1 : 0};
        this.scanId = scanId;
    }

    /** PTP1 line (PROTOCOL.md): PTP1,seq,valid,x,y,z,fx,fy,fz,ux,uy,uz,scanId,walk */
    static String ptp1(long seq, float[] q, String scanId) {
        return String.format(Locale.US, "PTP1,%d,%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%s,%d\n",
            seq, q[0] > 0 ? 1 : 0, q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8], q[9], scanId.replace(',', '_'), q.length > 10 && q[10] > 0 ? 1 : 0);
    }

    /** Parses PTH1,seq,valid,intensity,contact,objectId,distanceMm; returns {valid, intensity0-1, contact, obj, distM} or null. */
    static float[] parsePth1(String s) {
        String[] a = s.trim().split(",");
        if (a.length < 7 || !a[0].equals("PTH1")) return null;
        try {
            int valid = Integer.parseInt(a[2].trim()), i = Integer.parseInt(a[3].trim()), c = Integer.parseInt(a[4].trim()), o = Integer.parseInt(a[5].trim()), mm = Integer.parseInt(a[6].trim());
            return new float[]{valid, Math.max(0, Math.min(255, i))/255f, c, o, mm < 0 ? Float.POSITIVE_INFINITY : mm/1000f};
        } catch (NumberFormatException e) { return null; }
    }

    synchronized void start(String host, int port) {
        stop();
        this.host = host.trim(); this.port = port; running = true; status = "언리얼로 보내는 중…";
        Thread s = new Thread(this::sendLoop, "unreal-send"); s.setDaemon(true); sendThread = s; s.start();
        Thread r = new Thread(this::recvLoop, "unreal-recv"); r.setDaemon(true); recvThread = r; r.start();
    }
    synchronized void stop() {
        running = false; relay = false; gen++;
        WebSocket w = ws; ws = null; wsOpen = false; if (w != null) w.close(1000, "stop");
        DatagramSocket r = recvSocket; if (r != null) r.close();
        recvSocket = null; rxAt = 0; status = "언리얼 연동 꺼짐";
    }

    private void sendLoop() {
        long seq = 0; InetAddress addr = null; String resolved = null; long lastResolve = 0;
        try (DatagramSocket socket = new DatagramSocket()) {
            while (running && Thread.currentThread() == sendThread) {
                long start = System.currentTimeMillis();
                try {
                    if (!host.equals(resolved) || (addr == null && start - lastResolve > 2000)) { resolved = host; lastResolve = start; addr = null; addr = InetAddress.getByName(host); }
                    float[] q = pose;
                    if (addr != null && q != null) {
                        byte[] b = ptp1(++seq, q, scanId).getBytes(StandardCharsets.US_ASCII);
                        socket.send(new DatagramPacket(b, b.length, addr, port)); sent = start;
                    }
                    status = (addr == null ? "언리얼 PC 주소를 찾는 중 (" + host + ")" : q == null ? "위치 대기 중" : "언리얼로 보내는 중 · " + addr.getHostAddress() + ":" + port)
                        + (fresh(300) ? " · 언리얼 진동 수신 OK (" + rxFrom + ")" : " · 언리얼 진동 신호 없음");
                } catch (Exception e) { status = "언리얼 송신 오류: " + e.getClass().getSimpleName(); if (e instanceof UnknownHostException) addr = null; }
                long wait = 33 - (System.currentTimeMillis() - start);
                if (wait > 0) try { Thread.sleep(wait); } catch (InterruptedException e) { break; }
            }
        } catch (SocketException e) { status = "언리얼 송신 소켓 오류: " + e.getMessage(); }
    }

    private void recvLoop() {
        try (DatagramSocket socket = new DatagramSocket(null)) {
            socket.setReuseAddress(true); socket.bind(new InetSocketAddress(LISTEN_PORT)); recvSocket = socket;
            byte[] buf = new byte[256];
            while (running && Thread.currentThread() == recvThread) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                socket.receive(p);
                float[] v = parsePth1(new String(buf, 0, p.getLength(), StandardCharsets.US_ASCII));
                if (v == null) continue;
                rValid = v[0] > 0; rIntensity = v[1]; rContact = v[2] > 0; rObject = (int)v[3]; rDistance = v[4];
                rxFrom = p.getAddress().getHostAddress(); rxAt = System.currentTimeMillis();
            }
        } catch (Exception e) {
            if (running && Thread.currentThread() == recvThread) status = "언리얼 수신 포트 " + LISTEN_PORT + " 오류: " + e.getClass().getSimpleName();
        }
    }
}
