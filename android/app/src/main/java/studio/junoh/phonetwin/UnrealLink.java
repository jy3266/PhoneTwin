package studio.junoh.phonetwin;

import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * UDP link to the Unreal PC (PROTOCOL.md §1). Sends the latest phone pose as PTP1 at ~30 Hz to host:port
 * (default 7777) and listens on UDP 4211 for PTH1 haptic values computed by Unreal.
 * The AR loop only calls setPose(); everything else runs on the link's own threads.
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

    void setPose(boolean valid, float[] p, float[] f, float[] u, String scanId) {
        pose = new float[]{valid ? 1 : 0, p[0], p[1], p[2], f[0], f[1], f[2], u[0], u[1], u[2]};
        this.scanId = scanId;
    }

    /** PTP1 line (PROTOCOL.md): PTP1,seq,valid,x,y,z,fx,fy,fz,ux,uy,uz,scanId */
    static String ptp1(long seq, float[] q, String scanId) {
        return String.format(Locale.US, "PTP1,%d,%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%s\n",
            seq, q[0] > 0 ? 1 : 0, q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8], q[9], scanId.replace(',', '_'));
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
        running = false;
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
