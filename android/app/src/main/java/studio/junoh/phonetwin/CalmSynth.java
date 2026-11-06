package studio.junoh.phonetwin;

/**
 * The calm built-in sounds of the Unreal plugin (PhoneTwinCalmSound.cpp), ported line by line so the phone
 * sounds the same as Unreal: one voice per kind of object, a soft pad that swells while the audience comes
 * closer and a chime that rings on touch, all on D major pentatonic, with a small mono Freeverb.
 * Keep this file in step with ARKO_PROJECT/Plugins/PhoneTwinLink/.../PhoneTwinCalmSound.cpp.
 */
final class CalmSynth {
    /** Sound design of one kind of object (FCalmVoice). */
    static final class Voice {
        String key = "", idea = "";
        float padHz = 110f; float[] padRatio = {1, 2, 0, 0}, padAmp = {1, .3f, 0, 0};
        float beat = .3f, swell = .08f, air = 0, airHz = 800f, drops = 0;
        float bellHz = 440f; float[] bellRatio = {1, 2.76f, 5.4f, 0}, bellAmp = {1, .4f, .15f, 0}, bellDecay = {3, 1.5f, .6f, 1};
        float attack = .008f;

        Voice(String key, String idea) { this.key = key; this.idea = idea; }
        Voice pad(float hz, float[] r, float[] a, float beat, float swell) {
            padHz = hz; this.beat = beat; this.swell = swell; padRatio = fill(r, 0); padAmp = fill(a, 0); return this;
        }
        Voice airNoise(float amount, float hz) { air = amount; airHz = hz; return this; }
        Voice rain(float perSecond) { drops = perSecond; return this; }
        Voice bell(float hz, float[] r, float[] a, float[] decay) { return bell(hz, r, a, decay, .008f); }
        Voice bell(float hz, float[] r, float[] a, float[] decay, float attack) {
            bellHz = hz; this.attack = attack; bellRatio = fill(r, 0); bellAmp = fill(a, 0); bellDecay = fill(decay, 1); return this;
        }
        private static float[] fill(float[] v, float rest) { float[] o = new float[4]; for (int k = 0; k < 4; k++) o[k] = k < v.length ? v[k] : rest; return o; }
    }

    private static float[] f(float... v) { return v; }
    // D major pentatonic: degree 0..4 = D E F# A B, octave 3 = D3 (146.8 Hz)
    static float note(int degree, int octave) {
        final float[] d3 = {146.83f, 164.81f, 185.00f, 220.00f, 246.94f};
        return d3[((degree % 5) + 5) % 5]*(float)Math.pow(2.0, octave - 3);
    }
    // modal ratios: singing bowl, glass, wooden bar, kalimba tine, string, gong
    private static final float[] BOWL = {1f, 2.71f, 5.15f}, GLASS = {1f, 2.32f, 4.25f, 6.63f}, WOOD = {1f, 3.93f, 9.24f},
        TINE = {1f, 5.4f, 13.1f}, STRING = {1f, 2f, 3f, 4f}, GONG = {1f, 1.47f, 2.09f, 2.56f};

    /** Unreal's GetTypeHash(FString): FCrc::Strihash_DEPRECATED over UTF-16 code units, ASCII upper-cased. */
    static int ueHash(String s) {
        int h = 0;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i); if (ch >= 'a' && ch <= 'z') ch -= 32;
            h = (h >>> 8) ^ CRC[(h ^ (ch & 0xff)) & 0xff];
            h = (h >>> 8) ^ CRC[(h ^ (ch >>> 8)) & 0xff];
        }
        return h;
    }
    private static final int[] CRC = new int[256];
    static { for (int i = 0; i < 256; i++) { int c = i << 24; for (int j = 0; j < 8; j++) c = (c & 0x80000000) != 0 ? (c << 1) ^ 0x04c11db7 : c << 1; CRC[i] = c; } }
    /** FString::ToLower (ASCII only) + TrimStartAndEnd. */
    static String ueLower(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) { char c = s.charAt(i); b.append(c >= 'A' && c <= 'Z' ? (char)(c + 32) : c); }
        return b.toString().trim();
    }

    /** CalmVoiceFor: voice for an AI label ("cup", "potted plant" …); unknown labels get a singing bowl on a note picked from the label. */
    static Voice voiceFor(String labelIn) {
        String l = ueLower(labelIn == null ? "" : labelIn);
        switch (l) {
            case "cup": case "vase": case "bowl":
                return new Voice("cup", "찻잔·그릇 → 싱잉볼처럼 낮게 울리는 허밍 · 닿으면 도자기 종")
                    .pad(note(3, 2), f(1, 2, 2.76f), f(1, .3f, .18f), .35f, .07f).airNoise(.04f, 900)
                    .bell(note(3, 5), f(1, 2.76f, 5.4f, 8.93f), f(1, .45f, .2f, .08f), f(4, 1.8f, .8f, .35f));
            case "bottle": case "wine glass":
                return new Voice("bottle", "유리병 → 병 입구를 부는 숨결 · 닿으면 유리 풍경")
                    .pad(note(0, 3), f(1, 2, 3), f(.55f, .15f, .05f), .2f, .11f).airNoise(.5f, 1500)
                    .bell(note(0, 5), GLASS, f(1, .5f, .25f, .1f), f(3.5f, 1.4f, .6f, .3f));
            case "keyboard":
                return new Voice("keyboard", "키보드 → 타자 소리를 닮은 잔잔한 빗방울 · 닿으면 나무 마림바")
                    .pad(note(1, 2), f(1, 1.5f, 2, 3), f(.7f, .3f, .25f, .08f), .25f, .06f).airNoise(.2f, 600).rain(3)
                    .bell(note(1, 4), WOOD, f(1, .22f, .05f), f(1.6f, .4f, .12f), .004f);
            case "mouse":
                return new Voice("mouse", "마우스 → 작은 클릭이 물방울로 · 닿으면 칼림바")
                    .pad(note(2, 3), f(1, 2), f(.5f, .15f), .3f, .09f).airNoise(.08f, 900).rain(1.2f)
                    .bell(note(2, 4), TINE, f(1, .18f, .05f), f(2, .4f, .15f));
            case "tv": case "monitor":
                return new Voice("tv", "TV → 화면의 웅웅거림을 따뜻한 전자 패드로 · 닿으면 전자 피아노")
                    .pad(note(4, 2), f(1, 2, 3, 4), f(1, .4f, .22f, .1f), .5f, .05f).airNoise(.03f, 3000)
                    .bell(note(4, 4), f(1, 2, 3, 4.01f), f(1, .35f, .12f, .05f), f(2.8f, 1.3f, .6f, .3f));
            case "laptop":
                return new Voice("laptop", "노트북 → 팬 바람과 화면 빛 · 닿으면 맑은 전자 종")
                    .pad(note(3, 2), f(1, 2, 4), f(.9f, .35f, .12f), .3f, .06f).airNoise(.12f, 1800)
                    .bell(note(3, 4), f(1, 2, 3, 4.2f), f(1, .3f, .1f, .05f), f(2.5f, 1.2f, .5f, .25f));
            case "remote": case "cell phone":
                return new Voice("remote", "리모컨·휴대폰 → 작은 신호음을 부드러운 사인파로 · 닿으면 유리 방울")
                    .pad(note(4, 3), f(1, 2), f(.4f, .1f), .4f, .1f)
                    .bell(note(4, 4), f(1, 5.4f), f(1, .15f), f(1.5f, .3f));
            case "book":
                return new Voice("book", "책 → 종이를 넘기는 바람결 · 닿으면 하프")
                    .pad(note(0, 2), f(1, 2, 3), f(.7f, .25f, .1f), .2f, .07f).airNoise(.45f, 450)
                    .bell(note(0, 4), STRING, f(1, .5f, .25f, .12f), f(2.4f, 1.5f, .9f, .5f), .003f);
            case "backpack": case "handbag": case "suitcase": case "teddy bear":
                return new Voice("backpack", "가방·천 → 천이 스치는 부드러운 바람 · 닿으면 낮은 현")
                    .pad(note(1, 2), f(1, 2), f(.6f, .2f), .2f, .09f).airNoise(.5f, 350)
                    .bell(note(1, 3), STRING, f(1, .45f, .2f, .1f), f(2.2f, 1.4f, .8f, .4f), .004f);
            case "chair": case "bench": case "dining table": case "desk":
                return new Voice("chair", "의자·탁자 → 나무의 낮은 울림(첼로 같은 드론) · 닿으면 나무 마림바")
                    .pad(note(0, 2), f(1, 2, 3, 4), f(1, .5f, .28f, .12f), .22f, .05f).airNoise(.05f, 500)
                    .bell(note(0, 3), WOOD, f(1, .25f, .06f), f(2, .5f, .15f), .004f);
            case "potted plant":
                return new Voice("potted plant", "화분 → 잎을 흔드는 바람 · 닿으면 칼림바")
                    .pad(note(3, 2), f(1, 1.5f, 2), f(.5f, .2f, .2f), .3f, .1f).airNoise(.4f, 2200)
                    .bell(note(3, 4), TINE, f(1, .2f, .06f), f(2.4f, .5f, .2f));
            case "bed": case "couch":
                return new Voice("bed", "침대·소파 → 잠든 숨결처럼 천천히 부풀었다 가라앉는 소리 · 닿으면 낮은 징")
                    .pad(note(0, 2), f(1, 2, 3), f(.8f, .25f, .08f), .15f, .1f).airNoise(.35f, 400)
                    .bell(note(0, 3), GONG, f(1, .5f, .3f, .2f), f(6, 4, 2.5f, 1.5f), .02f);
            case "clock":
                return new Voice("clock", "시계 → 째깍임을 느린 물방울로 · 닿으면 작은 종")
                    .pad(note(2, 2), f(1, 2), f(.6f, .2f), .25f, .06f).rain(1)
                    .bell(note(2, 5), BOWL, f(1, .35f, .12f), f(3, 1.4f, .6f));
            case "sink": case "toilet":
                return new Voice("sink", "물가 → 고요한 물결과 물방울 · 닿으면 맑은 종")
                    .pad(note(0, 3), f(1, 1.5f), f(.45f, .15f), .2f, .08f).airNoise(.3f, 700).rain(2)
                    .bell(note(0, 5), BOWL, f(1, .35f, .12f), f(3.5f, 1.6f, .7f));
            case "surface":
                return new Voice("surface", "벽·바닥 → 공간의 잔잔한 물결 · 닿으면 싱잉볼")
                    .pad(note(0, 3), f(1, 1.5f, 2), f(.5f, .2f, .15f), .2f, .06f).airNoise(.25f, 700)
                    .bell(note(0, 4), BOWL, f(1, .35f, .12f), f(5, 2.5f, 1));
            default:
                int deg = (int)(Integer.toUnsignedLong(ueHash(l)) % 5);
                return new Voice(l, "사물 → 싱잉볼 허밍 · 닿으면 싱잉볼 종")
                    .pad(note(deg, 2), f(1, 2, 2.71f), f(.8f, .3f, .15f), .3f, .07f).airNoise(.1f, 800)
                    .bell(note(deg, 4), BOWL, f(1, .4f, .15f), f(4, 2, .8f));
        }
    }

    // ---------------------------------------------------------------- FCalmSynth (mono; render() runs on the audio thread)
    private final int rate; private int numPad = 0;
    private final double[] padPhase = new double[8], padStep = new double[8]; private final float[] padGain = new float[8];
    private final double[] bellPhase = new double[4], bellStep = new double[4]; private final float[] bellGain = new float[4], bellBase = new float[4], bellMul = new float[4];
    private double swellPhase = 0, swellStep, dropPhase = 0, dropStep = 0;
    private float env = 0, envCoef, air, airCoef, lp1 = 0, lp2 = 0, dropProb, dropGain = 0, dropMul, dropBaseHz;
    private float attack = 1, attackStep, pending = 0, lastPeak = 0;
    private volatile float nearTarget = 0;
    private int rng;
    private final float[][] comb = new float[4][], allpass = new float[2][];
    private final int[] combPos = new int[4], allpassPos = new int[2]; private final float[] combLp = new float[4];
    final String idea;

    CalmSynth(Voice v, int rate) {
        this.rate = rate; idea = v.idea;
        final double twoPi = 2.0*Math.PI;
        float sum = 0; for (int k = 0; k < 4; k++) if (v.padRatio[k] > 0) sum += v.padAmp[k];
        for (int k = 0; k < 4; k++) {
            if (v.padRatio[k] <= 0) continue;
            double fr = v.padHz*v.padRatio[k];
            for (int c = 0; c < 2; c++) {   // two copies a few tenths of a Hz apart: slow, gentle beating
                padStep[numPad] = twoPi*(fr + c*v.beat*(1 + .3*k))/rate;
                padPhase[numPad] = c*1.3 + k*.7;
                padGain[numPad] = v.padAmp[k]/Math.max(sum, 1e-3f)*.5f;
                numPad++;
            }
        }
        float bellSum = 0; for (int k = 0; k < 4; k++) if (v.bellRatio[k] > 0) bellSum += v.bellAmp[k];
        for (int k = 0; k < 4; k++) {
            bellStep[k] = twoPi*v.bellHz*v.bellRatio[k]/rate;
            bellBase[k] = v.bellRatio[k] > 0 ? v.bellAmp[k]/Math.max(bellSum, 1e-3f) : 0;
            bellMul[k] = (float)Math.exp(-6.9078f/(Math.max(.05f, v.bellDecay[k])*rate));
        }
        envCoef = 1f - (float)Math.exp(-1f/(.8f*rate));
        swellStep = twoPi*v.swell/rate;
        air = v.air; airCoef = 1f - (float)Math.exp(-2f*(float)Math.PI*v.airHz/rate);
        dropProb = v.drops/rate; dropMul = (float)Math.exp(-6.9078f/(.25f*rate)); dropBaseHz = v.padHz*8;
        attackStep = 1f/Math.max(1f, v.attack*rate); attack = 1;
        rng = 22222 + ueHash(v.key);
        final int[] combLen = {1116, 1188, 1277, 1356}, apLen = {556, 441};
        for (int k = 0; k < 4; k++) comb[k] = new float[combLen[k]*rate/44100];
        for (int k = 0; k < 2; k++) allpass[k] = new float[apLen[k]*rate/44100];
    }

    /** Target loudness of the approach pad, 0..1 (glides over ~0.8 s). Any thread. */
    void setNear(float t) { nearTarget = Math.max(0, Math.min(1, t)); }
    /** Ring the touch chime. Audio thread (the mixer forwards strikes). */
    void touch(float strength) { pending = Math.max(0, Math.min(1, strength)); attack = 0; }
    float peak() { return lastPeak; }
    /** True while nothing can be heard any more (pad faded, chime and droplet gone). */
    boolean silent() {
        if (env > 1e-4f || nearTarget > 0 || attack < 1f || dropGain > 1e-5f) return false;
        for (float g : bellGain) if (g >= 1e-5f) return false;
        return lastPeak < 1e-4f;
    }

    private float noise() { rng = rng*1664525 + 1013904223; return (float)(Integer.toUnsignedLong(rng) >>> 8)/8388608f - 1f; }

    private float reverb(float in) {
        // mono Freeverb (4 combs + 2 all-passes): a soft room around every voice
        float out = 0; final float x = in*.03f;
        for (int k = 0; k < 4; k++) {
            float[] c = comb[k]; float y = c[combPos[k]];
            combLp[k] = y*.75f + combLp[k]*.25f;
            c[combPos[k]] = x + combLp[k]*.84f; out += y;
            if (++combPos[k] >= c.length) combPos[k] = 0;
        }
        for (int k = 0; k < 2; k++) {
            float[] a = allpass[k]; float b = a[allpassPos[k]];
            float y = b - out; a[allpassPos[k]] = out + b*.5f; out = y;
            if (++allpassPos[k] >= a.length) allpassPos[k] = 0;
        }
        return out;
    }

    void render(float[] out, int num) {
        final float[] penta = {1f, 1.125f, 1.25f, 1.5f, 1.6667f, 2f};
        final double twoPi = 2.0*Math.PI;
        final float target = nearTarget;
        float peak = 0;
        for (int i = 0; i < num; i++) {
            env += (target - env)*envCoef;
            swellPhase += swellStep; if (swellPhase > twoPi) swellPhase -= twoPi;
            final float sw = .75f + .25f*(float)Math.sin((float)swellPhase);
            float pad = 0, a = 0, drop = 0, bell = 0;
            if (env > 1e-4f) {
                for (int k = 0; k < numPad; k++) {
                    pad += (float)Math.sin((float)padPhase[k])*padGain[k];
                    padPhase[k] += padStep[k]; if (padPhase[k] > twoPi) padPhase[k] -= twoPi;
                }
                pad *= env*sw*.3f;
                if (air > 0) {
                    lp1 += airCoef*(noise() - lp1); lp2 += airCoef*(lp1 - lp2);
                    a = lp2*air*env*sw*.35f/(float)Math.sqrt(airCoef);
                }
                if (dropProb > 0 && env > .02f && noise()*.5f + .5f < dropProb) {
                    dropGain = .1f*(.4f + .6f*(noise()*.5f + .5f))*env;
                    dropStep = twoPi*dropBaseHz*penta[Math.min(5, (int)((noise()*.5f + .5f)*6))]/rate; dropPhase = 0;
                }
            }
            if (dropGain > 1e-5f) { drop = (float)Math.sin((float)dropPhase)*dropGain; dropPhase += dropStep; dropGain *= dropMul; }
            if (attack < 1f) {
                for (int k = 0; k < 4; k++) bellGain[k] = Math.min(bellGain[k] + bellBase[k]*pending*attackStep, bellBase[k]*1.5f);
                attack += attackStep;
            }
            for (int k = 0; k < 4; k++) {
                if (bellGain[k] < 1e-5f) continue;
                bell += (float)Math.sin((float)bellPhase[k])*bellGain[k];
                bellPhase[k] += bellStep[k]; if (bellPhase[k] > twoPi) bellPhase[k] -= twoPi;
                bellGain[k] *= bellMul[k];
            }
            bell *= .32f;
            final float dry = pad + a + drop + bell;
            final float y = Math.max(-3f, Math.min(3f, dry*.85f + reverb(dry)*.5f));
            out[i] = y*(27f + y*y)/(27f + 9f*y*y);   // soft clip
            peak = Math.max(peak, Math.abs(out[i]));
        }
        lastPeak = peak;
    }
}
