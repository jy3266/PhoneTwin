package studio.junoh.phonetwin;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Turns "how close is the hand to something" into phone vibration, an optional proximity tone,
 * and a 30 Hz UDP stream to the ESP32 wristband. Runs on its own threads; the AR loop only calls update().
 *
 * UDP packet (ASCII, one line):  PTH1,seq,valid,intensity0-255,contact0/1,objectId,distanceMm
 * objectId: -1 none, 0 scanned surface, 1..99 placed objects, 100+ AI-recognised objects. distanceMm: -1 when nothing in range.
 * The ESP32 answers with  PTA1,lastSeq,rssi  which the app shows as "ESP32 응답".
 */
final class Feedback {
    private final Vibrator vibrator;
    private final boolean amplitude;
    private volatile boolean running = true, paused = false;
    volatile boolean phoneVibe = true, tone = false;

    private volatile boolean valid, contact, pulse;
    private volatile float intensity, distance = Float.POSITIVE_INFINITY;
    private volatile int object = -1;

    /** When set and useRemote is on, a fresh PTH1 from Unreal (UnrealLink) replaces the locally computed values. */
    volatile UnrealLink remote; volatile boolean useRemote = false;
    boolean remoteActive() { UnrealLink l = remote; return useRemote && l != null && l.running() && l.fresh(300); }

    private volatile boolean espOn = false; private volatile String espHost = ""; private volatile int espPort = 4210;
    volatile String espStatus = "ESP32 꺼짐";

    Feedback(Context context) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= 31) v = ((VibratorManager)context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator();
        else v = (Vibrator)context.getSystemService(Context.VIBRATOR_SERVICE);
        vibrator = v;
        amplitude = v != null && v.hasAmplitudeControl();
        Thread t = new Thread(this::loop, "feedback"); t.setDaemon(true); t.start();
        Thread a = new Thread(this::audio, "proximity-tone"); a.setDaemon(true); a.start();
    }

    boolean hasVibrator() { return vibrator != null && vibrator.hasVibrator(); }
    boolean hasAmplitude() { return amplitude; }

    void update(boolean valid, float intensity, boolean contact, int object, float distance) { update(valid, intensity, contact, object, distance, false); }
    /** pulse: parking-sensor style taps that speed up as intensity rises (used for "blocked ahead" while walking). */
    void update(boolean valid, float intensity, boolean contact, int object, float distance, boolean pulse) {
        this.valid = valid; this.intensity = intensity; this.contact = contact; this.object = object; this.distance = distance; this.pulse = pulse;
    }
    void setPaused(boolean p) { paused = p; }
    void setEsp(boolean on, String host, int port) { espHost = host.trim(); espPort = port; espOn = on; }
    void shutdown() { running = false; }
    /** Full-strength vibration and ESP32 signal for one second, independent of tracking. */
    void test() { testUntil = System.currentTimeMillis() + 1000; }
    private volatile long testUntil = 0;

    // ------------------------------------------------------------ vibration + UDP, 30 Hz
    private void loop() {
        DatagramSocket socket = null; InetAddress address = null; String resolved = null;
        long seq = 0, nextVibe = 0, lastAck = 0, lastResolve = 0; boolean vibrating = false, wasContact = false;
        byte[] in = new byte[64];
        while (running) {
            long start = System.currentTimeMillis();
            boolean testing = start < testUntil;
            UnrealLink rl = remote; boolean rem = remoteActive();
            boolean vValid = rem ? rl.rValid : valid, vContact = rem ? rl.rContact : contact, vPulse = !rem && pulse;
            float vI = rem ? rl.rIntensity : intensity, vDist = rem ? rl.rDistance : distance; int vObj = rem ? rl.rObject : object;
            boolean live = testing || vValid && !paused;
            float i = testing ? 1 : live ? vI : 0; boolean c = !testing && live && vContact;
            int obj = testing ? 0 : live ? vObj : -1; float dist = testing ? 0 : vDist;

            // ESP32 link
            try {
                if (espOn) {
                    if (socket == null) { socket = new DatagramSocket(); socket.setBroadcast(true); socket.setSoTimeout(1); }
                    if (!espHost.equals(resolved) || (address == null && start - lastResolve > 2000)) {
                        resolved = espHost; lastResolve = start; address = null;
                        address = InetAddress.getByName(espHost);
                    }
                    if (address != null) {
                        int mm = Float.isInfinite(dist) || !live ? -1 : Math.round(Math.min(65, Math.max(0, dist))*1000);
                        String msg = String.format(Locale.US, "PTH1,%d,%d,%d,%d,%d,%d\n", ++seq, live ? 1 : 0, Math.round(i*255), c ? 1 : 0, obj, mm);
                        byte[] b = msg.getBytes(StandardCharsets.US_ASCII);
                        socket.send(new DatagramPacket(b, b.length, address, espPort));
                        try {
                            DatagramPacket p = new DatagramPacket(in, in.length); socket.receive(p);
                            if (new String(in, 0, p.getLength(), StandardCharsets.US_ASCII).startsWith("PTA1")) lastAck = start;
                        } catch (SocketTimeoutException ignored) {}
                        espStatus = start - lastAck < 1500 ? "ESP32 응답 OK · " + address.getHostAddress() : "ESP32로 송신 중 · 응답 없음 (IP/전원/Wi-Fi 확인)";
                    }
                } else if (socket != null) {
                    // final "stop" packet so the motor never keeps running
                    if (address != null) { byte[] b = "PTH1,0,0,0,0,-1,-1\n".getBytes(StandardCharsets.US_ASCII); socket.send(new DatagramPacket(b, b.length, address, espPort)); }
                    socket.close(); socket = null; address = null; resolved = null; espStatus = "ESP32 꺼짐";
                }
            } catch (Exception e) {
                espStatus = "ESP32 오류: " + e.getClass().getSimpleName();
                if (e instanceof UnknownHostException) address = null;
            }

            // phone vibration
            try {
                boolean active = phoneVibe && hasVibrator() && i > 0.01f;
                if (active) {
                    if (c && !wasContact) { vibe(VibrationEffect.createOneShot(70, 255)); nextVibe = start + 80; }
                    else if (!c && !testing && vPulse) {
                        if (start >= nextVibe) {
                            vibe(VibrationEffect.createOneShot(60, amplitude ? Math.round(90 + 165*i) : VibrationEffect.DEFAULT_AMPLITUDE));
                            nextVibe = start + Math.round(650 - 530*i);
                        }
                    }
                    else if (start >= nextVibe) {
                        if (amplitude) vibe(VibrationEffect.createOneShot(120, c ? 255 : Math.max(1, Math.round(25 + 200*i))));
                        else vibe(VibrationEffect.createOneShot(Math.round(15 + 85*i), VibrationEffect.DEFAULT_AMPLITUDE));
                        nextVibe = start + 100;
                    }
                    vibrating = true;
                } else if (vibrating) { vibrator.cancel(); vibrating = false; }
                wasContact = active && c;
            } catch (Exception ignored) {}

            long wait = 33 - (System.currentTimeMillis() - start);
            if (wait > 0) try { Thread.sleep(wait); } catch (InterruptedException e) { break; }
        }
        if (vibrator != null) vibrator.cancel();
        if (socket != null) socket.close();
    }

    @SuppressWarnings("deprecation")
    private void vibe(VibrationEffect e) {
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(e, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        else vibrator.vibrate(e, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
    }

    // ------------------------------------------------------------ proximity tone (pitch per object)
    private void audio() {
        final int rate = 22050, chunk = 256;
        int min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(Math.max(min, chunk*8)).setTransferMode(AudioTrack.MODE_STREAM).build();
        short[] buf = new short[chunk]; double phase = 0; float amp = 0; boolean playing = false;
        while (running) {
            UnrealLink rl = remote; boolean rem = remoteActive();
            boolean live = tone && (rem ? rl.rValid : valid) && !paused;
            float inten = rem ? rl.rIntensity : intensity; boolean cont = rem ? rl.rContact : contact;
            float target = live ? inten*(cont ? 1f : .6f) : 0;
            if (!live && amp < 1e-3f) {
                if (playing) { track.pause(); track.flush(); playing = false; }
                try { Thread.sleep(50); } catch (InterruptedException e) { break; }
                continue;
            }
            if (!playing) { track.play(); playing = true; }
            int obj = rem ? rl.rObject : object;
            double freq = obj <= 0 ? 330 : 220*Math.pow(2, (obj % 12)/6.0);
            if (cont) freq *= 1.5;
            for (int k = 0; k < chunk; k++) {
                amp += (target - amp)*0.002f;
                phase += 2*Math.PI*freq/rate; if (phase > 2*Math.PI) phase -= 2*Math.PI;
                buf[k] = (short)(Math.sin(phase)*amp*12000);
            }
            track.write(buf, 0, chunk);
        }
        track.release();
    }
}
