package studio.junoh.phonetwin;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;

/**
 * The Unreal plugin's object sounds on the phone: per object an approach layer (the editor's looping WAV, or the
 * calm pad) and a touch layer (the editor's one-shot WAV, or the calm chime), mixed on one 48 kHz stereo AudioTrack
 * with the same volume rules as Unreal (non-spatialised 2D sound, linear volume multipliers).
 * The GL thread calls set()/strike(); the audio thread owns the synths and play positions.
 */
final class TwinAudio {
    static final int RATE = 48000;
    /** 16-bit PCM WAV → interleaved stereo shorts at 48 kHz (mono is copied to both sides, other rates resampled linearly). */
    static short[] readWav(byte[] b) throws IOException {
        ByteBuffer bb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
        if (b.length < 12 || bb.getInt(0) != 0x46464952 || bb.getInt(8) != 0x45564157) throw new IOException("WAV가 아닙니다");
        int pos = 12, ch = 0, rate = 0, bits = 0, fmt = 0, dataAt = -1, dataLen = 0;
        while (pos + 8 <= b.length) {
            int id = bb.getInt(pos), len = bb.getInt(pos + 4); int body = pos + 8;
            if (id == 0x20746d66) { fmt = bb.getShort(body) & 0xffff; ch = bb.getShort(body + 2); rate = bb.getInt(body + 4); bits = bb.getShort(body + 14); }
            else if (id == 0x61746164) { dataAt = body; dataLen = Math.min(len < 0 ? Integer.MAX_VALUE : len, b.length - body); break; }
            pos = body + len + (len & 1);
            if (len < 0) break;
        }
        if (dataAt < 0 || (fmt != 1 && fmt != 0xfffe) || bits != 16 || ch < 1 || ch > 2 || rate < 8000) throw new IOException("16비트 PCM 1·2채널 WAV만 됩니다");
        int frames = dataLen/(2*ch);
        int outFrames = rate == RATE ? frames : (int)((long)frames*RATE/rate);
        short[] out = new short[outFrames*2];
        for (int i = 0; i < outFrames; i++) {
            double src = rate == RATE ? i : i*(double)rate/RATE; int a = (int)src; float t = (float)(src - a); int bIdx = Math.min(frames - 1, a + 1);
            for (int c = 0; c < 2; c++) {
                int cc = Math.min(c, ch - 1);
                float s0 = bb.getShort(dataAt + (a*ch + cc)*2), s1 = bb.getShort(dataAt + (bIdx*ch + cc)*2);
                out[i*2 + c] = (short)Math.round(s0 + (s1 - s0)*t);
            }
        }
        return out;
    }

    /** What one object sounds like (built on the GL/loader thread, then handed over whole). */
    static final class Voice {
        final String idea; final CalmSynth calm; final short[] near, touch; final float volume;
        final boolean calmNear;   // the calm pad is the approach layer (no near WAV)
        Voice(CalmSynth calm, short[] near, short[] touch, float volume, String idea) {
            this.calm = calm; this.near = near; this.touch = touch; this.volume = volume; this.idea = idea; calmNear = near == null;
        }
        // GL thread → audio thread
        volatile float nearGain; volatile int strikes; volatile float strikeStrength;
        // audio thread
        int seenStrikes, nearPos, touchPos = Integer.MAX_VALUE; float nearVol, touchVol; long lastLoud, lastStrike = Long.MIN_VALUE/2;
    }

    /**
     * MakeObjSound: WAV files from the editor win; the calm voice fills in the missing layer.
     * A missing file (or an Unreal asset path like /Game/…) falls back to the calm voice, as Unreal does when a sound cannot load.
     */
    static Voice make(String label, short[] nearWav, short[] touchWav, float volume) {
        CalmSynth calm = null; CalmSynth.Voice v = CalmSynth.voiceFor(label);
        if (nearWav == null || touchWav == null) calm = new CalmSynth(v, RATE);
        return new Voice(calm, nearWav, touchWav, volume, calm != null ? v.idea : "편집기 소리");
    }

    private volatile List<Voice> voices = Collections.emptyList();
    private volatile boolean running = true, paused = false;
    volatile float master = 1f;
    volatile String status = "";

    TwinAudio() { Thread t = new Thread(this::loop, "twin-audio"); t.setDaemon(true); t.setPriority(Thread.MAX_PRIORITY); t.start(); }

    void setVoices(List<Voice> v) { voices = v == null ? Collections.<Voice>emptyList() : v; }
    void setPaused(boolean p) { paused = p; }
    void shutdown() { running = false; }
    /** GL thread: approach gain (already G²·volume·front) of voice i. */
    static void set(Voice v, float nearGain) { v.nearGain = nearGain; }
    /** GL thread: ring the touch layer (DriveSound: the WAV restarts, or the calm chime rings). */
    static void strike(Voice v, float strength) { v.strikeStrength = strength; v.strikes++; }

    private void loop() {
        final int block = 480;   // 10 ms
        int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack track;
        try {
            track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build())
                .setBufferSizeInBytes(Math.max(min, block*4*4)).setTransferMode(AudioTrack.MODE_STREAM).build();
        } catch (Exception e) { status = "소리 장치를 열지 못했습니다"; return; }
        float[] mono = new float[block], mixL = new float[block], mixR = new float[block]; short[] out = new short[block*2];
        boolean playing = false;
        while (running) {
            List<Voice> vs = voices; long now = System.currentTimeMillis();
            boolean any = false;
            Arrays.fill(mixL, 0); Arrays.fill(mixR, 0);
            for (Voice v : vs) {
                // touch: restart the WAV, or hand the strike to the synth
                int s = v.strikes;
                if (s != v.seenStrikes) {
                    v.seenStrikes = s;
                    if (v.touch != null) { v.touchPos = 0; v.touchVol = master*v.strikeStrength*v.volume; }
                    else if (v.calm != null) v.calm.touch(v.strikeStrength);
                    v.lastStrike = now;
                }
                float ng = paused ? 0 : v.nearGain;
                // calm synth: runs while its pad or chime can be heard; Unreal stops it 3 s later (the synth has faded by then)
                if (v.calm != null) {
                    v.calm.setNear(v.calmNear ? ng : 0);
                    if ((v.calmNear && ng > .005f) || (v.touch == null && now - v.lastStrike < 9000)) v.lastLoud = now;
                    if (now - v.lastLoud < 3000) {
                        v.calm.render(mono, block);
                        float g = master*20000f/32768f;
                        for (int i = 0; i < block; i++) { float x = mono[i]*g; mixL[i] += x; mixR[i] += x; }
                        any = true;
                    }
                }
                // approach WAV loop: plays while louder than 1 %, linear volume glide over the block
                if (v.near != null) {
                    float target = ng*master; if (target <= .01f) target = 0;
                    if (target > 0 || v.nearVol > 1e-4f) {
                        short[] p = v.near; int frames = p.length/2; float g0 = v.nearVol, g1 = target;
                        for (int i = 0; i < block && frames > 0; i++) {
                            float g = g0 + (g1 - g0)*(i + 1)/block;
                            if (v.nearPos >= frames) v.nearPos = 0;
                            mixL[i] += p[v.nearPos*2]*g/32768f; mixR[i] += p[v.nearPos*2 + 1]*g/32768f; v.nearPos++;
                        }
                        v.nearVol = g1; any = true;
                    }
                }
                // touch WAV: one shot from the start
                if (v.touch != null && v.touchPos < v.touch.length/2) {
                    short[] p = v.touch; int frames = p.length/2; float g = v.touchVol;
                    for (int i = 0; i < block && v.touchPos < frames; i++, v.touchPos++) { mixL[i] += p[v.touchPos*2]*g/32768f; mixR[i] += p[v.touchPos*2 + 1]*g/32768f; }
                    any = true;
                }
            }
            if (!any) {
                if (playing) { track.pause(); track.flush(); playing = false; }
                try { Thread.sleep(10); } catch (InterruptedException e) { break; }
                continue;
            }
            if (!playing) { track.play(); playing = true; }
            for (int i = 0; i < block; i++) {
                out[i*2] = (short)Math.max(-32768, Math.min(32767, Math.round(mixL[i]*32767f)));
                out[i*2 + 1] = (short)Math.max(-32768, Math.min(32767, Math.round(mixR[i]*32767f)));
            }
            track.write(out, 0, out.length);
        }
        track.release();
    }
}
