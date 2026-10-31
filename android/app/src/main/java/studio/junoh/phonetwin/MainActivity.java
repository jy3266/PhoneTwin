package studio.junoh.phonetwin;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.Image;
import android.net.Uri;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Range;
import android.util.Size;
import android.util.SizeF;
import android.view.*;
import android.widget.*;
import com.google.ar.core.*;
import com.google.ar.core.exceptions.NotYetAvailableException;
import org.json.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.function.Consumer;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Phone Twin v2: the 3D scan of the room lives on the phone as a point cloud, the phone's ARCore pose
 * is aligned to it with two floor points, and proximity to scanned surfaces / placed objects drives
 * phone vibration, a proximity tone and the ESP32 wristband. Windows streaming stays optional.
 */
public final class MainActivity extends Activity implements GLSurfaceView.Renderer {
    private static final int VIEW_TWIN = 0, VIEW_AR = 1, VIEW_ORBIT = 2;
    private static final int PICK_NONE = 0, PICK_A = 1, PICK_B = 2, PICK_OBJECT = 3;
    private static final int REQ_SCAN = 20, REQ_EXPORT = 21, REQ_SOUND = 22, LIVE_CAP = 800_000;

    private static final class Obj {
        final int id; final String name; final float x, y, z, r;
        Obj(int id, String name, float x, float y, float z, float r) { this.id = id; this.name = name; this.x = x; this.y = y; this.z = z; this.r = r; }
    }

    // ---- UI
    private GLSurfaceView surface;
    private TextView status, hud, scanInfo, alignInfo, objectInfo, espInfo, crosshair;
    private Button upAxis, panelToggle;
    private final Button[] viewButtons = new Button[3];
    private ScrollView panelScroll;
    private EditText host, code, espHost, espPort;
    private SharedPreferences prefs;

    // ---- AR / rendering (GL thread unless noted)
    private Session session;
    private Config arConfig;
    private volatile boolean depthSupported = false;

    // ---- in-app scanning (GL thread, except the volatile flags)
    private volatile int scanRequest = 0;                 // 1 start, 2 finish+save, 3 cancel
    private volatile boolean scanning = false, liveAlign = false;
    private volatile int liveCount = 0;
    private volatile float scanMaxRange = 5f, scanVoxel = .015f, scanConf = .6f; private volatile int scanMinHits = 2;
    private final float[] lastScanPose = new float[7]; private long lastScanPoseT = 0;   // GL thread: motion-blur gate

    // ---- full-screen scanning UI, wide lens, fit viewport
    private LinearLayout topBar, bottomBar; private FrameLayout scanOverlay; private TextView scanOverlayText, camInfo;
    private volatile CameraConfig chosenConfig; private volatile String camText = "";
    private int viewX = 0, viewY = 0, viewW = 1, viewH = 1;           // GL thread: current AR viewport (full screen, or letterboxed while scanning)

    // ---- GitHub upload + Unreal link
    private final UnrealLink unreal = new UnrealLink();
    private EditText ghRepo, ghBranch, ghToken, unrealHost, unrealPort, relayUrl, relayRoom, relayKey; private RadioButton viaRelay; private TextView ghInfo, unrealInfo;
    private volatile String ghStatus = "업로드 전"; private volatile boolean uploading = false;

    // ---- aiming at the floor marks A/B with the camera visible
    private volatile int aimTarget = 0;                    // 0 off, 1 A, 2 B
    private LinearLayout aimBar; private TextView aimText; private Button aimRecord;

    // ---- walking test
    private volatile boolean walkMode = false;
    private Button walkButton;
    private volatile ObstacleMap obstacles;
    private volatile int obstacleGen = 0;
    private volatile float walkRange = .6f, lookAhead = 1.5f, bodyHalf = .25f, walkContact = .2f, obstacleTop = 1.9f;
    private volatile float hudNear = Float.POSITIVE_INFINITY, hudAhead = Float.POSITIVE_INFINITY; private volatile boolean hudDeadEnd = false;

    // ---- AI object recognition + object sounds
    private final AiObjects ai = new AiObjects();
    private volatile List<AiObjects.Item> aiCache = new ArrayList<>();
    private Detector detector; private SpatialSound sound;
    private volatile boolean aiOn = true, aiSkipPerson = true, soundOn = true;
    private volatile float soundRange = 4f;
    private final List<Detector.Obs> pendingObs = new ArrayList<>();
    private long lastDetect = 0, lastSound = 0; private volatile int sensorRotation = 90;
    private LinearLayout aiList; private TextView aiInfo; private String aiSig = "";
    private String pendingSoundLabel = null;
    private File soundDir, beaconFile;
    private volatile Map<String, File> soundFiles = new HashMap<>();
    private FrameLayout labelLayer; private final TextView[] labelViews = new TextView[16];
    private final Object labelLock = new Object(); private final float[] labelXY = new float[32]; private final String[] labelTxt = new String[16]; private int labelCount = 0;
    private LiveScan live;
    private long lastIntegrate = 0, lastDepthTs = -1, integrateCost = 0;
    private TextView liveInfo;
    private Anchor origin, realA, realB;
    private final CameraBackground background = new CameraBackground();
    private final CloudRenderer renderer = new CloudRenderer();
    private final SocketSender sender = new SocketSender();
    private Feedback feedback;
    private final String sessionId = UUID.randomUUID().toString();
    private boolean installRequested = false, resumed = false;
    private int width = 1, heightPx = 1, epoch = 0;
    private long seq = 0, lastFrame = 0, lastSent = 0, lastUi = 0;
    private volatile String note = "스캔 파일을 열고 정렬하세요";
    private float[] lastPosition = {0, 0, 0};

    // ---- shared state
    private volatile int view = VIEW_ORBIT, pickMode = PICK_NONE, realRequest = 0;
    private volatile boolean alignDirty = true, aligned = false, zUp = false;
    private volatile ScanLoader.Cloud cloud;
    private volatile SurfaceIndex index;
    private final Object data = new Object();           // guards scanA, scanB, objects
    private float[] scanA, scanB;
    private final List<Obj> objects = new ArrayList<>();
    private float[] mLS = new float[16];
    private volatile float scale = 1;
    private volatile String alignText = "정렬 전";

    // feedback settings (metres)
    private volatile float range = 0.30f, contactDist = 0.03f, probeOffset = 0f, objRadius = 0.25f;
    private volatile boolean surfaceOn = true, skipFloor = true, useScale = false;

    // last twin state (written by GL thread)
    private volatile boolean valid = false, floorHit = false;
    private volatile float[] probeS = null;
    private volatile float hudDist = Float.POSITIVE_INFINITY, hudIntensity = 0;
    private volatile int hudObj = -1; private volatile boolean hudContact = false;

    // orbit camera (UI thread writes, GL thread reads)
    private volatile float yaw = .8f, pitch = .6f, dist = 6f;
    private final Object orbitLock = new Object();
    private final float[] orbitMVP = new float[16]; private boolean orbitReady = false;

    // ---------------------------------------------------------------------------------- UI helpers
    private int dp(float v) { return Math.round(v*getResources().getDisplayMetrics().density); }
    private TextView label(String text, int size) {
        TextView t = new TextView(this); t.setText(text); t.setTextColor(Color.WHITE); t.setTextSize(size); t.setPadding(dp(6), dp(4), dp(6), dp(4)); return t;
    }
    private TextView section(String text) {
        TextView t = label(text, 13); t.setTextColor(0xff7dd3fc); t.setTypeface(Typeface.DEFAULT_BOLD); t.setPadding(dp(6), dp(14), dp(6), dp(2)); return t;
    }
    private Button button(String text, View.OnClickListener l) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setTextSize(13); b.setOnClickListener(l); return b;
    }
    private LinearLayout row(View... views) {
        LinearLayout r = new LinearLayout(this);
        for (View v : views) r.addView(v, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        return r;
    }
    private CheckBox check(String text, boolean on, Consumer<Boolean> c) {
        CheckBox b = new CheckBox(this); b.setText(text); b.setTextColor(Color.WHITE); b.setChecked(on);
        b.setOnCheckedChangeListener((v, s) -> c.accept(s)); return b;
    }
    private EditText field(String hint, String value) {
        EditText e = new EditText(this); e.setSingleLine(); e.setHint(hint); e.setText(value);
        e.setTextColor(Color.WHITE); e.setHintTextColor(0xff94a3b8); e.setTextSize(14); return e;
    }
    /** Numeric setting with a caption; applied live while typing when within [min,max]. */
    private LinearLayout number(String caption, String key, float value, float min, float max, Consumer<Float> c) {
        float saved = prefs.getFloat(key, value); c.accept(saved);
        EditText e = field("", Float.toString(saved)); e.setInputType(8194);
        e.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int d) {}
            public void onTextChanged(CharSequence s, int a, int b, int d) {}
            public void afterTextChanged(Editable s) {
                try { float v = Float.parseFloat(s.toString()); if (v >= min && v <= max) { c.accept(v); prefs.edit().putFloat(key, v).apply(); e.setError(null); } else e.setError(min + "~" + max); }
                catch (NumberFormatException x) { e.setError("숫자"); }
            }
        });
        TextView t = label(caption, 13);
        LinearLayout r = new LinearLayout(this); r.setGravity(Gravity.CENTER_VERTICAL);
        r.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        r.addView(e, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        return r;
    }
    private void toastNote(String s) { note = s; runOnUiThread(this::refreshPanel); }

    // ---------------------------------------------------------------------------------- lifecycle
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("phonetwin", 0);
        feedback = new Feedback(this);
        zUp = prefs.getBoolean("zup", false);
        detector = new Detector(this, this::onDetections); sound = new SpatialSound();
        soundDir = new File(getFilesDir(), "sounds"); soundDir.mkdirs(); beaconFile = new File(getFilesDir(), "builtin_beacon.wav");
        new Thread(() -> { try { if (!beaconFile.exists()) SpatialSound.writeBeacon(beaconFile); } catch (IOException ignored) {} rebuildSoundFiles(); }, "beacon").start();

        FrameLayout root = new FrameLayout(this); setContentView(root);
        surface = new GLSurfaceView(this); surface.setEGLContextClientVersion(2); surface.setPreserveEGLContextOnPause(true);
        surface.setEGLConfigChooser(8, 8, 8, 8, 16, 0); surface.setRenderer(this); root.addView(surface);
        installGestures();
        labelLayer = new FrameLayout(this); root.addView(labelLayer, new FrameLayout.LayoutParams(-1, -1));
        for (int i = 0; i < labelViews.length; i++) {
            TextView t = label("", 13); t.setBackgroundColor(0xb0003040); t.setTextColor(0xffa5f3fc); t.setVisibility(View.GONE);
            labelViews[i] = t; labelLayer.addView(t, new FrameLayout.LayoutParams(-2, -2));
        }

        crosshair = label("+", 44); crosshair.setVisibility(View.GONE);
        root.addView(crosshair, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));

        // top bar
        LinearLayout top = topBar = new LinearLayout(this); top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(10), dp(12), dp(10), dp(6)); top.setBackgroundColor(0xd0101820);
        top.addView(label("PHONE TWIN v4  ·  스캔 트윈 / 햅틱", 18));
        status = label("AR 시작 중", 12); top.addView(status);
        viewButtons[VIEW_TWIN] = button("1인칭 트윈", v -> setView(VIEW_TWIN));
        viewButtons[VIEW_AR] = button("AR 겹쳐보기", v -> setView(VIEW_AR));
        viewButtons[VIEW_ORBIT] = button("3인칭 지도", v -> setView(VIEW_ORBIT));
        top.addView(row(viewButtons));
        walkButton = button("", v -> setWalk(!walkMode));
        top.addView(row(walkButton));
        root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        // bottom: HUD + collapsible panel
        LinearLayout bottom = bottomBar = new LinearLayout(this); bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(10), dp(6), dp(10), dp(8)); bottom.setBackgroundColor(0xe6101820);
        hud = label("", 14); hud.setTypeface(Typeface.MONOSPACE);
        panelToggle = button("설정 ▼", v -> togglePanel());
        aimBar = new LinearLayout(this); aimBar.setOrientation(LinearLayout.VERTICAL); aimBar.setVisibility(View.GONE);
        aimText = label("", 14); aimText.setTextColor(0xfffde68a);
        aimRecord = button("", v -> { if (aimTarget != 0) realRequest = aimTarget; });
        aimBar.addView(aimText); aimBar.addView(row(aimRecord, button("취소", v -> exitAim())));
        bottom.addView(aimBar);
        bottom.addView(hud); bottom.addView(panelToggle);
        panelScroll = new ScrollView(this); LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        panelScroll.addView(panel);
        bottom.addView(panelScroll, new LinearLayout.LayoutParams(-1, (int)(getResources().getDisplayMetrics().heightPixels*.42f)));
        root.addView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));

        // full-screen scan overlay: status line in the top letterbox bar, finish/cancel in the bottom one
        scanOverlay = new FrameLayout(this); scanOverlay.setVisibility(View.GONE);
        scanOverlayText = label("", 13); scanOverlayText.setTypeface(Typeface.MONOSPACE); scanOverlayText.setBackgroundColor(0x90000000);
        scanOverlayText.setPadding(dp(12), dp(10), dp(12), dp(8));
        scanOverlay.addView(scanOverlayText, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        LinearLayout scanButtons = row(button("완료·저장", v -> requestScan(2)), button("취소", v -> requestScan(3)));
        scanButtons.setPadding(dp(12), dp(6), dp(12), dp(14)); scanButtons.setBackgroundColor(0x90000000);
        scanOverlay.addView(scanButtons, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        root.addView(scanOverlay, new FrameLayout.LayoutParams(-1, -1));

        // 0. in-app scan
        panel.addView(section("0 · 휴대폰으로 바로 스캔"));
        panel.addView(row(button("스캔 시작", v -> requestScan(1)), button("완료·저장", v -> requestScan(2)), button("취소", v -> requestScan(3))));
        liveInfo = label("", 12); panel.addView(liveInfo);
        panel.addView(number("스캔 최대 거리 (m)", "scanrange2", 5f, .5f, 8f, v -> scanMaxRange = v));
        panel.addView(number("스캔 점 간격 (m)", "scanvoxel3", .015f, .005f, .1f, v -> scanVoxel = v));
        panel.addView(number("깊이 신뢰도 최소 (0~1)", "scanconf", .6f, .1f, .95f, v -> scanConf = v));
        panel.addView(number("점 확정에 필요한 관측 횟수", "scanhits", 2f, 1f, 10f, v -> scanMinHits = Math.round(v)));
        camInfo = label("", 12); panel.addView(camInfo);
        panel.addView(label("스캔을 시작하면 화면 전체가 카메라 화면이 되고, 카메라 영상이 잘리지 않게 전체 화각을 보여 줍니다. 같은 자리를 여러 번 비출수록 점 위치가 평균으로 다듬어지고, 한 번만 찍힌 잡음 점은 저장할 때 빠집니다. 너무 빨리 움직이면 흔들린 프레임은 건너뜁니다.", 11));
        panel.addView(label("먼저 아래 2번의 '현장 A·B 기록'을 해 두고 스캔하면, A·B가 스캔에 자동으로 저장됩니다. 그러면 다음 실행에서는 현장 A·B만 다시 기록하면 바로 정렬됩니다. 벽과 가구를 0.5~3m 거리에서 천천히 훑으세요. AI 인식이 켜져 있으면 스캔하는 동안 사물도 함께 인식합니다.", 11));

        // 1. scan file
        panel.addView(section("1 · 3D 스캔 파일 불러오기 / 내보내기"));
        upAxis = button("", v -> toggleUpAxis());
        panel.addView(row(button("스캔 파일 열기 (PLY/OBJ/XYZ)", v -> openScan()), upAxis));
        panel.addView(row(button("☁ GitHub에 올린 스캔 불러오기…", v -> chooseGitHubScan())));
        panel.addView(row(button("현재 스캔 내보내기 (PLY 저장·공유)", v -> exportScan())));
        scanInfo = label("스캔 없음", 12); panel.addView(scanInfo);

        // 2. alignment
        panel.addView(section("2 · 정렬: 바닥의 두 점 A·B"));
        panel.addView(row(button("스캔 A·B 자동 (바닥 1m)", v -> new Thread(() -> { if (cloud == null) toastNote("먼저 스캔 파일을 여세요"); else { autoScanAB(cloud); toastNote(note); } }, "auto-ab").start()),
            button("A 직접 탭", v -> startPick(PICK_A)), button("B 직접 탭", v -> startPick(PICK_B))));
        panel.addView(row(button("현장 A 조준·기록", v -> enterAim(1)), button("현장 B 조준·기록", v -> enterAim(2))));
        panel.addView(check("A–B 실측 거리로 스케일 보정 (사진측량 스캔용)", prefs.getBoolean("scale", false), s -> { useScale = s; prefs.edit().putBoolean("scale", s).apply(); alignDirty = true; }));
        useScale = prefs.getBoolean("scale", false);
        alignInfo = label("", 12); panel.addView(alignInfo);
        panel.addView(label("스캔 A·B는 앱이 스캔 바닥의 넓은 곳에 1m 간격으로 자동으로 정합니다(초록 A, 파랑 B). '현장 A 조준·기록'을 누르면 카메라 화면이 열리고, 바닥에 초록·파란 기둥(스캔 위치를 아는 경우) 또는 오른쪽 위 작은 지도에 A·B 위치가 보입니다. 그 바닥 지점에 십자선을 맞추고 '여기를 A로 기록'을 누르세요. B는 A에서 1m 떨어진 하얀 원 위에 있습니다. 위치를 바꾸고 싶으면 'A 직접 탭'·'B 직접 탭'.", 11));

        // 3. walking test
        panel.addView(section("3 · 걷기 테스트 (스캔한 공간을 들고 걸어 보기)"));
        panel.addView(number("주변 경고 거리 (m)", "walkrange", .6f, .1f, 3f, v -> walkRange = v));
        panel.addView(number("앞 막힘 감지 거리 (m)", "lookahead", 1.5f, .3f, 5f, v -> lookAhead = v));
        panel.addView(number("몸 폭의 절반 (m)", "bodyhalf", .25f, .05f, 1f, v -> bodyHalf = v));
        panel.addView(number("걷기 접촉 판정 거리 (m)", "walkcontact", .2f, 0f, 1f, v -> walkContact = v));
        panel.addView(number("장애물로 볼 최대 높이 (m)", "obstop", 1.9f, .3f, 4f, v -> { obstacleTop = v; rebuildObstacles(); }));
        panel.addView(label("위쪽 '걷기 테스트 시작'을 누르고 휴대폰을 들고 걸으세요. 바닥 위 12cm~최대 높이 사이의 스캔 점을 장애물로 봅니다. 주변에 벽·사물이 가까우면 연속 진동, 앞이 막혀 있으면 가까워질수록 빨라지는 톡톡 진동이 옵니다.", 11));

        // 4. AI objects + sounds
        panel.addView(section("4 · AI 사물 인식과 소리"));
        aiOn = prefs.getBoolean("ai", true); aiSkipPerson = prefs.getBoolean("aiperson", true); soundOn = prefs.getBoolean("aisound", true);
        panel.addView(check("AI 사물 인식 (스캔 중·걷기 테스트 중 자동)", aiOn, s -> { aiOn = s; prefs.edit().putBoolean("ai", s).apply(); }));
        panel.addView(check("사람은 인식하지 않음 (관객 제외)", aiSkipPerson, s -> { aiSkipPerson = s; prefs.edit().putBoolean("aiperson", s).apply(); }));
        panel.addView(check("사물에 가까워지면 소리 재생", soundOn, s -> { soundOn = s; prefs.edit().putBoolean("aisound", s).apply(); }));
        panel.addView(number("소리가 들리기 시작하는 거리 (m)", "soundrange", 4f, .5f, 15f, v -> soundRange = v));
        panel.addView(number("인식 최소 신뢰도 (0~1)", "aiscore", .5f, .2f, .95f, v -> detector.minScore = v));
        aiInfo = label("", 12); panel.addView(aiInfo);
        aiList = new LinearLayout(this); aiList.setOrientation(LinearLayout.VERTICAL); panel.addView(aiList);
        panel.addView(row(button("다른 사물에 소리 지정…", v -> chooseLabelForSound()), button("기본 소리 지정", v -> pickSound("default"))));
        panel.addView(row(button("AI 사물 전체 삭제", v -> { ai.clear(); refreshAi(); saveScanData(); refreshPanel(); })));
        panel.addView(label("소리 파일은 mp3·wav·ogg·m4a 모두 됩니다. 반복 재생되니 짧은 루프가 좋습니다. 소리를 지정하지 않은 사물은 '기본 소리'를 내고, 기본 소리도 없으면 내장 신호음을 냅니다. 이어폰을 쓰면 왼쪽·오른쪽 방향도 들립니다.", 11));

        // 3. objects + reaction
        panel.addView(section("5 · 손 터치 반응과 직접 놓는 사물"));
        panel.addView(row(button("손 위치에 사물 추가", v -> addObjectAtHand()), button("3D에서 탭해 추가", v -> startPick(PICK_OBJECT))));
        panel.addView(row(button("마지막 사물 삭제", v -> removeObject(false)), button("사물 전체 삭제", v -> removeObject(true))));
        objectInfo = label("", 12); panel.addView(objectInfo);
        panel.addView(number("사물 반경 (m)", "objr", .25f, .03f, 3f, v -> objRadius = v));
        panel.addView(number("반응 시작 거리 (m)", "range", .30f, .05f, 2f, v -> range = v));
        panel.addView(number("접촉 판정 거리 (m)", "contact", .03f, 0f, .5f, v -> contactDist = v));
        panel.addView(number("손 위치 = 카메라 앞 (m)", "offset", 0f, 0f, 1f, v -> probeOffset = v));
        surfaceOn = prefs.getBoolean("surface", true); skipFloor = prefs.getBoolean("floor", true);
        feedback.phoneVibe = prefs.getBoolean("vibe", true); feedback.tone = prefs.getBoolean("tone", false);
        panel.addView(check("스캔된 모든 표면(벽·가구)에 반응", surfaceOn, s -> { surfaceOn = s; prefs.edit().putBoolean("surface", s).apply(); }));
        panel.addView(check("바닥(10cm 이하)은 반응에서 제외", skipFloor, s -> { skipFloor = s; prefs.edit().putBoolean("floor", s).apply(); }));
        panel.addView(check("휴대폰 진동", feedback.phoneVibe, s -> { feedback.phoneVibe = s; prefs.edit().putBoolean("vibe", s).apply(); }));
        panel.addView(check("근접음 (사물마다 음높이 다름)", feedback.tone, s -> { feedback.tone = s; prefs.edit().putBoolean("tone", s).apply(); }));
        panel.addView(button("진동/ESP32 테스트 (1초)", v -> feedback.test()));

        // 4. ESP32
        panel.addView(section("6 · ESP32 손목 장치 (UDP)"));
        espHost = field("ESP32 IP (예: 192.168.0.50 또는 x.x.x.255)", prefs.getString("esphost", ""));
        espPort = field("포트", String.valueOf(prefs.getInt("espport", 4210))); espPort.setInputType(2);
        panel.addView(row(espHost)); panel.addView(row(espPort));
        panel.addView(row(button("ESP32 송신 시작", v -> startEsp()), button("중지", v -> feedback.setEsp(false, "", 4210))));
        espInfo = label("", 12); panel.addView(espInfo);

        // 5. Windows (optional)
        panel.addView(section("7 · Windows 모니터 (선택)"));
        host = field("Windows IPv4", prefs.getString("host", "192.168.0.100")); code = field("Windows 연결 코드", "");
        panel.addView(row(host)); panel.addView(row(code));
        panel.addView(row(button("연결", v -> {
            try { sender.start(host.getText().toString(), code.getText().toString()); prefs.edit().putString("host", host.getText().toString()).apply(); }
            catch (Exception e) { toastNote("Windows IPv4 주소를 확인하세요"); }
        }), button("중지", v -> sender.stop())));

        // 8. GitHub
        panel.addView(section("8 · GitHub 업로드 (웹·언리얼 공유)"));
        ghRepo = field("저장소 owner/name", prefs.getString("gh_repo", "jy3266/PhoneTwin"));
        ghBranch = field("브랜치", prefs.getString("gh_branch", "main"));
        ghToken = field("GitHub 토큰 (github_pat_…)", prefs.getString("gh_token", "")); ghToken.setInputType(129);
        panel.addView(row(ghRepo)); panel.addView(row(ghBranch)); panel.addView(row(ghToken));
        panel.addView(check("스캔 저장 후 자동 업로드", prefs.getBoolean("gh_auto", false), s -> prefs.edit().putBoolean("gh_auto", s).apply()));
        panel.addView(row(button("현재 스캔 업로드", v -> uploadScan()), button("☁ 올린 스캔 불러오기…", v -> chooseGitHubScan())));
        ghInfo = label("", 12); panel.addView(ghInfo);
        panel.addView(label("업로드하면 웹 뷰어(GitHub Pages)와 언리얼 ARKO_PROJECT가 이 스캔을 자동으로 가져갑니다. 토큰은 GitHub → Settings → Developer settings → Fine-grained tokens에서 이 저장소 하나만 고르고 Contents 권한을 Read and write로 만들어 붙여 넣으세요. 토큰은 이 휴대폰 안에만 저장됩니다.", 11));

        // 9. Unreal
        panel.addView(section("9 · 언리얼 연동 (UDP / 인터넷 릴레이)"));
        RadioGroup mode = new RadioGroup(this); mode.setOrientation(RadioGroup.VERTICAL);
        RadioButton viaUdp = new RadioButton(this); viaUdp.setText("같은 Wi-Fi (UDP, 빠름 · 약 5ms)"); viaUdp.setTextColor(Color.WHITE); viaUdp.setId(View.generateViewId());
        viaRelay = new RadioButton(this); viaRelay.setText("인터넷 릴레이 (DigitalOcean, 느림 · 약 100ms 이상)"); viaRelay.setTextColor(Color.WHITE); viaRelay.setId(View.generateViewId());
        mode.addView(viaUdp); mode.addView(viaRelay);
        if (prefs.getBoolean("ue_relay", false)) viaRelay.setChecked(true); else viaUdp.setChecked(true);
        mode.setOnCheckedChangeListener((g, id) -> prefs.edit().putBoolean("ue_relay", id == viaRelay.getId()).apply());
        panel.addView(mode);
        unrealHost = field("언리얼 PC IPv4 (예: 192.168.0.10) · Wi-Fi 방식", prefs.getString("ue_host", ""));
        unrealPort = field("포트", String.valueOf(prefs.getInt("ue_port", 7777))); unrealPort.setInputType(2);
        panel.addView(row(unrealHost)); panel.addView(row(unrealPort));
        relayUrl = field("릴레이 주소 (예: wss://phonetwin-relay-xxxx.ondigitalocean.app)", prefs.getString("relay_url", ""));
        relayRoom = field("방 이름 (언리얼·ESP32와 같게)", prefs.getString("relay_room", "arko"));
        relayKey = field("릴레이 키 (서버의 RELAY_KEY)", prefs.getString("relay_key", ""));
        relayKey.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        panel.addView(row(relayUrl)); panel.addView(row(relayRoom)); panel.addView(row(relayKey));
        panel.addView(row(button("송신 시작", v -> startUnreal()), button("중지", v -> unreal.stop())));
        feedback.remote = unreal; feedback.useRemote = prefs.getBoolean("ue_haptic", true);
        panel.addView(check("언리얼이 계산한 진동 사용 (UDP 4211 또는 릴레이로 수신)", feedback.useRemote, s -> { feedback.useRemote = s; prefs.edit().putBoolean("ue_haptic", s).apply(); }));
        unrealInfo = label("", 12); panel.addView(unrealInfo);
        panel.addView(label("휴대폰 위치·방향(PTP1)을 30Hz로 언리얼 PC에 보냅니다. 언리얼이 거리를 계산해 진동 세기(PTH1)를 돌려주면 그 값으로 진동하고, 신호가 끊기면 휴대폰이 직접 계산한 값으로 돌아갑니다. Wi-Fi 방식은 PC와 같은 Wi-Fi에 연결하세요. 같은 Wi-Fi가 안 되는 곳에서는 릴레이 방식을 고르고 DigitalOcean 릴레이 주소·방 이름·키를 넣으세요(언리얼 프로젝트 설정의 Relay 값과 같게). 릴레이는 싱가포르 서버를 거쳐 진동이 0.1~0.2초 늦습니다.", 11));
        panel.addView(label("\n", 8));

        setView(VIEW_ORBIT);
        loadScanData();
        if (new File(getFilesDir(), "scan_current").exists()) loadScan(); else refreshPanel();
    }

    @Override protected void onResume() { super.onResume(); feedback.setPaused(false); sound.setPaused(false); startAR(); }
    private void startAR() {
        if (resumed) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.CAMERA}, 10); return; }
        try {
            if (session == null) {
                if (ArCoreApk.getInstance().requestInstall(this, !installRequested) == ArCoreApk.InstallStatus.INSTALL_REQUESTED) { installRequested = true; return; }
                Session s = new Session(this);
                chooseWideCamera(s);
                Config c = new Config(s); c.setFocusMode(Config.FocusMode.AUTO); arConfig = c;
                depthSupported = s.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY);
                try {
                    Integer o = ((CameraManager)getSystemService(CAMERA_SERVICE)).getCameraCharacteristics(s.getCameraConfig().getCameraId()).get(CameraCharacteristics.SENSOR_ORIENTATION);
                    if (o != null) sensorRotation = o;
                } catch (Exception ignored) {}
                c.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
                c.setLightEstimationMode(Config.LightEstimationMode.DISABLED); s.configure(c);
                session = s;
            }
            session.resume(); surface.onResume(); resumed = true;
        } catch (Exception e) {
            if (session != null) { session.close(); session = null; }
            surface.onResume(); resumed = true; // the 3D map still works without AR
            status.setText("AR 시작 실패: " + e.getClass().getSimpleName() + "\nARCore 지원·Google Play AR 서비스를 확인하세요 (스캔 보기만 가능)");
        }
    }
    /** Widest field of view among the back-camera configs ARCore offers (must run before the first resume). */
    private void chooseWideCamera(Session s) {
        try {
            CameraConfigFilter filter = new CameraConfigFilter(s);
            filter.setFacingDirection(CameraConfig.FacingDirection.BACK);
            List<CameraConfig> list = s.getSupportedCameraConfigs(filter);
            if (list.isEmpty()) return;
            CameraManager cm = (CameraManager)getSystemService(CAMERA_SERVICE);
            CameraConfig best = null; float bestFov = -1, bestShort = 0; double bestScore = -1;
            Set<String> lenses = new HashSet<>();
            for (CameraConfig cfg : list) {
                lenses.add(cfg.getCameraId());
                float[] fov = lensFov(cm, cfg);
                Size t = cfg.getTextureSize(); int longSide = Math.max(t.getWidth(), t.getHeight());
                Range<Integer> fps = cfg.getFpsRange();
                // FOV first (1° steps), then a depth sensor, then texture resolution up to 1920, then 30 fps
                double score = Math.round(fov[0])*1e6
                    + (cfg.getDepthSensorUsage() == CameraConfig.DepthSensorUsage.REQUIRE_AND_USE ? 1e5 : 0)
                    + Math.min(longSide, 1920)*10 + (fps.getUpper() == 30 ? 1 : 0);
                if (score > bestScore) { bestScore = score; best = cfg; bestFov = fov[0]; bestShort = fov[1]; }
            }
            s.setCameraConfig(best); chosenConfig = best;
            Size t = best.getTextureSize();
            camText = String.format(Locale.US, "카메라 화각 수평 %.0f° (세로로 들었을 때 화면 위아래 %.0f°) · 렌즈 ID %s · %dx%d%s\n%s",
                bestShort, bestFov, best.getCameraId(), t.getWidth(), t.getHeight(),
                best.getDepthSensorUsage() == CameraConfig.DepthSensorUsage.REQUIRE_AND_USE ? " · 깊이 센서 사용" : "",
                lenses.size() > 1 ? "ARCore가 렌즈 " + lenses.size() + "개를 제공 → 가장 넓은 렌즈를 골랐습니다"
                    : "이 기종은 ARCore가 메인 렌즈 1개만 제공합니다 (초광각 렌즈는 ARCore에서 쓸 수 없음). 대신 스캔 중에는 영상을 자르지 않고 전체 화각을 보여 줍니다.");
        } catch (Exception e) { camText = "카메라 설정 선택 실패: " + e.getClass().getSimpleName() + " · 기본 카메라 사용"; }
    }
    /** {long-side FOV, short-side FOV} in degrees for the config's texture crop of its lens. */
    private static float[] lensFov(CameraManager cm, CameraConfig cfg) {
        try {
            CameraCharacteristics ch = cm.getCameraCharacteristics(cfg.getCameraId());
            float[] fl = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS); SizeF sz = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
            if (fl == null || fl.length == 0 || sz == null) return new float[]{0, 0};
            float f = fl[0]; for (float x : fl) f = Math.min(f, x);
            Size t = cfg.getTextureSize(); float aspect = Math.min(t.getWidth(), t.getHeight())/(float)Math.max(t.getWidth(), t.getHeight());
            float w = Math.max(sz.getWidth(), sz.getHeight()), h = Math.min(sz.getWidth(), sz.getHeight());
            float wUsed = Math.min(w, h/aspect), hUsed = wUsed*aspect;        // texture crop of the sensor (e.g. 16:9 from 4:3)
            return new float[]{(float)Math.toDegrees(2*Math.atan(wUsed/(2*f))), (float)Math.toDegrees(2*Math.atan(hUsed/(2*f)))};
        } catch (Exception e) { return new float[]{0, 0}; }
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] result) {
        super.onRequestPermissionsResult(request, permissions, result);
        if (request == 10 && result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED) startAR();
        else { status.setText("위치 추적에 카메라 권한이 필요합니다 (스캔 보기만 가능)"); surface.onResume(); resumed = true; }
    }
    @Override protected void onPause() {
        feedback.setPaused(true); sound.setPaused(true);
        if (resumed) { surface.onPause(); if (session != null) session.pause(); resumed = false; }
        sender.send(packet(false, "APP_PAUSED", lastPosition, new float[]{1, 0, 0}, new float[]{0, 0, 1}));
        super.onPause();
    }
    @Override protected void onDestroy() {
        feedback.shutdown(); sender.shutdown(); detector.shutdown(); sound.shutdown(); unreal.stop();
        if (origin != null) origin.detach(); if (session != null) session.close();
        super.onDestroy();
    }

    // ---------------------------------------------------------------------------------- UI actions
    private void setView(int v) {
        if (aimTarget != 0 && v != VIEW_AR) { toastNote("A·B 조준 중에는 카메라 화면을 씁니다 · 취소를 누르면 돌아갑니다"); v = VIEW_AR; }
        if (scanning && v != VIEW_AR) { toastNote("스캔 중에는 AR 화면만 사용합니다 · 완료·저장 또는 취소를 누르세요"); v = VIEW_AR; }
        view = v;
        for (int i = 0; i < 3; i++) viewButtons[i].setTextColor(i == v ? 0xff38bdf8 : Color.BLACK);
        crosshair.setVisibility(v == VIEW_AR ? View.VISIBLE : View.GONE);
    }
    private void togglePanel() { setPanel(panelScroll.getVisibility() != View.VISIBLE); }
    private void setPanel(boolean show) { panelScroll.setVisibility(show ? View.VISIBLE : View.GONE); panelToggle.setText(show ? "설정 ▼" : "설정 ▲"); }

    /** Opens the camera view with a floor reticle; the mark is recorded only when the user presses the button. */
    private void enterAim(int which) {
        if (session == null) { toastNote("AR이 실행 중이 아닙니다"); return; }
        aimTarget = which; setPanel(false); setView(VIEW_AR);
        String m = which == 1 ? "A" : "B", color = which == 1 ? "초록" : "파란";
        boolean other = which == 1 ? realB != null : realA != null;
        aimText.setText("현장 " + m + " 조준 중 · " + (aligned
                ? "바닥에 보이는 " + color + " 기둥(스캔 " + m + ") 아래에 십자선을 맞추세요."
                : "오른쪽 위 스캔 지도의 " + color + " 점(" + m + ")과 같은 실제 바닥 지점에 십자선을 맞추세요.")
            + (other ? "\n하얀 원 = 다른 점에서 스캔 A–B 거리만큼 떨어진 곳 · " + m + "는 이 원 위에 있습니다." : "")
            + "\n바닥이 인식되면 십자선이 초록색이 됩니다.");
        aimRecord.setText("여기를 " + (which == 1 ? "A" : "B") + "로 기록");
        aimBar.setVisibility(View.VISIBLE);
    }
    private void exitAim() { aimTarget = 0; aimBar.setVisibility(View.GONE); }

    private void setWalk(boolean on) {
        if (on && cloud == null) { toastNote("먼저 스캔하거나 스캔 파일을 여세요"); return; }
        if (on && scanning) { toastNote("스캔을 마친 뒤 걷기 테스트를 시작하세요"); return; }
        walkMode = on;
        if (on) { setPanel(false); if (view == VIEW_ORBIT) setView(VIEW_AR); if (obstacles == null) rebuildObstacles(); }
        toastNote(on ? (aligned ? "걷기 테스트 시작 · 휴대폰을 들고 천천히 걸어 보세요" : "걷기 테스트 대기 · 정렬되면 자동으로 시작합니다\n" + alignText) : "걷기 테스트 종료 · 진동·소리·ESP32·언리얼 연동을 멈췄습니다");
    }
    private void startPick(int mode) {
        if (cloud == null) { toastNote("먼저 스캔 파일을 여세요"); return; }
        pickMode = mode; setView(VIEW_ORBIT);
        toastNote(mode == PICK_A ? "3인칭 지도에서 바닥의 A 지점을 탭하세요" : mode == PICK_B ? "3인칭 지도에서 바닥의 B 지점을 탭하세요" : "사물을 놓을 표면을 탭하세요");
    }
    private void requestScan(int which) {
        if (session == null) { toastNote("AR이 실행 중이 아닙니다"); return; }
        if (which == 1) { if (scanning) return; walkMode = false; setPanel(false); setView(VIEW_AR); }
        scanRequest = which;
    }

    /** UI thread: full-screen camera with a minimal overlay while scanning; the normal UI otherwise. */
    private void setScanUi(boolean on) {
        topBar.setVisibility(on ? View.GONE : View.VISIBLE); bottomBar.setVisibility(on ? View.GONE : View.VISIBLE);
        labelLayer.setVisibility(on ? View.GONE : View.VISIBLE); scanOverlay.setVisibility(on ? View.VISIBLE : View.GONE);
        crosshair.setVisibility(!on && view == VIEW_AR ? View.VISIBLE : View.GONE);
        hideSystemBars(on);
    }
    @SuppressWarnings("deprecation")
    private void hideSystemBars(boolean on) {
        View d = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController(); if (c == null) return;
            if (on) { c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); c.hide(WindowInsets.Type.systemBars()); }
            else c.show(WindowInsets.Type.systemBars());
        } else d.setSystemUiVisibility(on ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE : 0);
    }
    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if (focus && scanning) hideSystemBars(true); }

    private void startUnreal() {
        if (viaRelay.isChecked()) {
            String u = relayUrl.getText().toString().trim(), r = relayRoom.getText().toString().trim(), k = relayKey.getText().toString().trim();
            if (u.isEmpty()) { toastNote("릴레이 주소를 넣으세요 (DigitalOcean 앱 주소)"); return; }
            prefs.edit().putString("relay_url", u).putString("relay_room", r).putString("relay_key", k).apply();
            unreal.startRelay(u, r, k);
            return;
        }
        String h = unrealHost.getText().toString().trim(); int port;
        try { port = Integer.parseInt(unrealPort.getText().toString().trim()); } catch (NumberFormatException e) { port = -1; }
        if (h.isEmpty() || port < 1 || port > 65535) { toastNote("언리얼 PC IP와 포트를 확인하세요"); return; }
        prefs.edit().putString("ue_host", h).putInt("ue_port", port).apply();
        unreal.start(h, port);
    }
    private String currentScanId() { return GitHubUploader.scanId(prefs.getString("scan_name", "scan.ply")); }

    /** Meta JSON for the current scan (PROTOCOL.md §2), all coordinates in the scan frame S. */
    private JSONObject scanMeta(String id, String created, ScanLoader.Cloud c) throws JSONException {
        JSONObject j = new JSONObject().put("version", 1).put("id", id).put("created", created).put("frame", "S: metres, Y up, right-handed").put("points", c.n);
        j.put("bounds", new JSONObject().put("min", vec(c.min)).put("max", vec(c.max)));
        JSONArray objs = new JSONArray();
        synchronized (data) {
            j.put("a", scanA != null ? vec(scanA) : JSONObject.NULL); j.put("b", scanB != null ? vec(scanB) : JSONObject.NULL);
            for (Obj o : objects) objs.put(new JSONObject().put("id", o.id).put("name", o.name).put("c", vec(new float[]{o.x, o.y, o.z})).put("r", (double)o.r));
        }
        j.put("objects", objs);
        JSONArray ais = new JSONArray();
        for (AiObjects.Item it : ai.confirmed()) ais.put(new JSONObject().put("label", it.label).put("name", AiObjects.korean(it.label)).put("c", vec(new float[]{it.x, it.y, it.z})).put("r", (double)it.r));
        j.put("ai", ais);
        return j;
    }
    private void uploadScan() {
        final ScanLoader.Cloud c = cloud;
        if (c == null) { ghStatus = "업로드할 스캔이 없습니다"; refreshPanel(); return; }
        if (uploading) return;
        final String repo = ghRepo.getText().toString().trim(), branch = ghBranch.getText().toString().trim(), token = ghToken.getText().toString().trim();
        prefs.edit().putString("gh_repo", repo).putString("gh_branch", branch.isEmpty() ? "main" : branch).putString("gh_token", token).apply();
        uploading = true; ghStatus = "업로드 준비 중…"; refreshPanel();
        new Thread(() -> {
            File tmp = new File(getCacheDir(), "upload.ply");
            try {
                String id = currentScanId();
                String created = prefs.getString("scan_created", null);
                if (created == null) created = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date());
                JSONObject meta = scanMeta(id, created, c);
                JSONObject entry = new JSONObject().put("id", id).put("ply", "scans/" + id + ".ply").put("meta", "scans/" + id + ".json")
                    .put("points", c.n).put("created", created).put("device", Build.MODEL);
                LiveScan.writePly(c, tmp);          // always the loaded cloud in frame S, whatever format it was imported from
                String sha = new GitHubUploader(repo, branch.isEmpty() ? "main" : branch, token).upload(id, tmp, meta, entry, s -> { ghStatus = s; runOnUiThread(this::refreshPanel); });
                ghStatus = "업로드 완료: scans/" + id + ".ply · 커밋 " + sha.substring(0, 7) + "\n웹사이트는 1~2분 뒤 갱신됩니다";
            } catch (Exception e) { ghStatus = "업로드 실패: " + e.getMessage(); }
            finally { tmp.delete(); uploading = false; runOnUiThread(this::refreshPanel); }
        }, "github-upload").start();
    }
    // ---------------------------------------------------------------------------------- load a scan back from GitHub
    private GitHubScans gitHubScans() {
        String repo = ghRepo.getText().toString().trim(), branch = ghBranch.getText().toString().trim(), token = ghToken.getText().toString().trim();
        prefs.edit().putString("gh_repo", repo).putString("gh_branch", branch.isEmpty() ? "main" : branch).putString("gh_token", token).apply();
        return new GitHubScans(repo, branch, token);
    }
    /** Lists scans/index.json and lets the user pick one (for comparing the scanned space with another place). */
    private void chooseGitHubScan() {
        if (scanning) { toastNote("스캔을 마친 뒤 불러오세요"); return; }
        final GitHubScans gh = gitHubScans();
        ghStatus = "GitHub 스캔 목록을 받는 중…"; toastNote(ghStatus);
        new Thread(() -> {
            try {
                final List<GitHubScans.Entry> list = gh.list();
                ghStatus = "GitHub 스캔 " + list.size() + "개";
                runOnUiThread(() -> {
                    refreshPanel();
                    if (list.isEmpty()) { toastNote("GitHub에 올린 스캔이 없습니다"); return; }
                    String cur = currentScanId(); String[] names = new String[list.size()];
                    for (int i = 0; i < names.length; i++) {
                        GitHubScans.Entry e = list.get(i);
                        names[i] = (e.id.equals(cur) ? "● " : "") + e.id + "\n" + (e.created.length() >= 16 ? e.created.substring(0, 16).replace('T', ' ') : e.created)
                            + String.format(Locale.US, " · %,d점", e.points) + (e.device.isEmpty() ? "" : " · " + e.device);
                    }
                    new AlertDialog.Builder(this).setTitle("불러올 스캔 (최신이 위)").setItems(names, (d, which) -> downloadGitHubScan(gh, list.get(which)))
                        .setNegativeButton("닫기", null).show();
                });
            } catch (Exception e) { ghStatus = "목록 받기 실패: " + e.getMessage(); toastNote(ghStatus); }
        }, "github-list").start();
    }
    private void downloadGitHubScan(GitHubScans gh, GitHubScans.Entry e) {
        ghStatus = "내려받는 중: " + e.id + String.format(Locale.US, " (%,d점)", e.points); toastNote(ghStatus);
        new Thread(() -> {
            File tmp = new File(getFilesDir(), "scan_tmp"), dst = new File(getFilesDir(), "scan_current");
            try {
                gh.download(e.ply, tmp);
                JSONObject scanData = new JSONObject().put("objects", new JSONArray()).put("ai", new JSONArray());
                try { scanData = GitHubScans.toScanData(gh.text(e.meta)); } catch (Exception noMeta) { /* PLY only: no A·B, no objects */ }
                if (dst.exists() && !dst.delete() || !tmp.renameTo(dst)) throw new IOException("파일 저장 실패");
                walkMode = false; liveAlign = false; zUp = false;
                prefs.edit().putBoolean("zup", false).putString("scan_name", e.id + ".ply").putString("scan_ext", "ply")
                    .putString("scan_created", e.created.isEmpty() ? new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date()) : e.created)
                    .putString("scan_data", scanData.toString()).apply();
                loadScanData();
                boolean ab; synchronized (data) { ab = scanA != null && scanB != null; }
                ghStatus = "GitHub 스캔을 불러왔습니다: " + e.id + (ab ? "\n스캔 A·B 포함 · 2번에서 이 장소의 현장 A·B를 기록하면 겹쳐 비교할 수 있습니다" : "\n스캔 A·B 없음 · 3인칭 지도에서 스캔 A·B를 먼저 탭하세요");
                saveScanData(); loadScan();
                runOnUiThread(this::refreshPanel);
            } catch (Exception ex) { tmp.delete(); ghStatus = "불러오기 실패: " + ex.getMessage(); toastNote(ghStatus); }
        }, "github-download").start();
    }

    private void exportScan() {
        if (!new File(getFilesDir(), "scan_current").exists()) { toastNote("내보낼 스캔이 없습니다"); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/octet-stream"); i.putExtra(Intent.EXTRA_TITLE, prefs.getString("scan_name", "scan.ply"));
        startActivityForResult(i, REQ_EXPORT);
    }
    private void writeExport(Uri u) {
        new Thread(() -> {
            try (InputStream in = new FileInputStream(new File(getFilesDir(), "scan_current")); OutputStream out = getContentResolver().openOutputStream(u)) {
                byte[] buf = new byte[1 << 16]; for (int k; (k = in.read(buf)) > 0; ) out.write(buf, 0, k);
                toastNote("스캔을 내보냈습니다");
            } catch (Exception e) { toastNote("내보내기 실패: " + e.getMessage()); }
        }, "scan-export").start();
    }
    private void startEsp() {
        String h = espHost.getText().toString().trim(); int port;
        try { port = Integer.parseInt(espPort.getText().toString().trim()); } catch (NumberFormatException e) { port = -1; }
        if (h.isEmpty() || port < 1 || port > 65535) { toastNote("ESP32 IP와 포트를 확인하세요"); return; }
        prefs.edit().putString("esphost", h).putInt("espport", port).apply();
        feedback.setEsp(true, h, port);
    }
    private void addObjectAtHand() {
        float[] p = probeS;
        if (!valid || p == null) { toastNote("정렬·추적 중일 때만 손 위치에 사물을 추가할 수 있습니다"); return; }
        addObject(p);
    }
    private void addObject(float[] p) {
        synchronized (data) {
            int id = 1; for (Obj o : objects) id = Math.max(id, o.id + 1);
            objects.add(new Obj(id, "사물 " + id, p[0], p[1], p[2], objRadius/scale));
        }
        saveScanData(); toastNote("사물을 추가했습니다");
    }
    private void removeObject(boolean all) {
        synchronized (data) { if (all) objects.clear(); else if (!objects.isEmpty()) objects.remove(objects.size()-1); }
        saveScanData(); refreshPanel();
    }
    private void toggleUpAxis() {
        zUp = !zUp; prefs.edit().putBoolean("zup", zUp).apply(); liveAlign = false;
        synchronized (data) { scanA = scanB = null; objects.clear(); }
        ai.clear(); refreshAi(); saveScanData();
        if (new File(getFilesDir(), "scan_current").exists()) loadScan(); else refreshPanel();
        toastNote("위쪽 축을 바꿨습니다 · 스캔 A/B와 사물을 다시 지정하세요");
    }

    private void refreshPanel() {
        upAxis.setText(zUp ? "위쪽 축: Z (CloudCompare·LAS)" : "위쪽 축: Y (Polycam·Scaniverse)");
        ScanLoader.Cloud c = cloud;
        scanInfo.setText(c == null ? "스캔 없음" : prefs.getString("scan_name", "?") + "\n" + c.info +
            String.format(Locale.US, "\n크기 %.2f × %.2f × %.2f (높이) m · 표면 셀 %,d", c.max[0]-c.min[0], c.max[2]-c.min[2], c.max[1]-c.min[1], index == null ? 0 : index.cells()));
        float[] a, b; int n; StringBuilder objs = new StringBuilder();
        synchronized (data) { a = scanA; b = scanB; n = objects.size(); for (Obj o : objects) objs.append(o.name).append("  "); }
        alignInfo.setText(String.format(Locale.US, "스캔 A %s · 스캔 B %s · 현장 A %s · 현장 B %s\n%s",
            a != null ? "✔" : "—", b != null ? "✔" : "—", realA != null ? "✔" : "—", realB != null ? "✔" : "—", alignText));
        liveInfo.setText(session == null ? "AR이 실행 중이어야 스캔할 수 있습니다" :
            (depthSupported ? "이 기종: Depth API 지원 → 컬러 고밀도 스캔" : "이 기종: Depth API 미지원 → 특징점 스캔 (점이 성김, 외부 스캔 파일 권장)") +
            (scanning ? String.format(Locale.US, "\n스캔 중 %,d점", liveCount) : ""));
        objectInfo.setText(n == 0 ? "사물 없음 (표면 반응만 사용)" : "사물 " + n + "개: " + objs);
        walkButton.setText(walkMode ? "■ 걷기 테스트 종료" : "🚶 걷기 테스트 시작");
        walkButton.setTextColor(walkMode ? 0xffef4444 : Color.BLACK);
        aiInfo.setText(detector.status + (detector.lastSeen.isEmpty() ? "" : "\n방금 본 것: " + detector.lastSeen) + (sound.status.isEmpty() ? "" : "\n" + sound.status));
        refreshAiList();
        camInfo.setText(camText.isEmpty() ? "카메라 정보는 AR이 시작되면 표시됩니다" : camText);
        ghInfo.setText(ghStatus); unrealInfo.setText(unreal.status + (feedback.remoteActive() ? "\n지금 언리얼이 계산한 진동을 쓰는 중" : ""));
        espInfo.setText(feedback.espStatus + (feedback.hasVibrator() ? "" : "\n이 휴대폰은 진동 모터가 없습니다") + (feedback.hasAmplitude() ? "" : "\n진동 세기 조절 미지원 기기: 진동 길이로 표현"));
    }

    // ---------------------------------------------------------------------------------- scan import / persistence
    private void openScan() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*");
        startActivityForResult(i, REQ_SCAN);
    }
    @Override protected void onActivityResult(int req, int res, Intent d) {
        super.onActivityResult(req, res, d);
        if (req == REQ_SCAN && res == RESULT_OK && d != null && d.getData() != null) importScan(d.getData());
        if (req == REQ_EXPORT && res == RESULT_OK && d != null && d.getData() != null) writeExport(d.getData());
        if (req == REQ_SOUND && res == RESULT_OK && d != null && d.getData() != null && pendingSoundLabel != null) importSound(pendingSoundLabel, d.getData());
    }
    private String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        String s = u.getLastPathSegment(); return s == null ? "scan" : s;
    }
    private void importScan(Uri u) {
        String name = displayName(u); int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (!ScanLoader.supported(ext)) { toastNote("지원 형식: .ply .obj .xyz .pts .txt .csv (선택: " + name + ")"); return; }
        toastNote("스캔 복사 중…");
        new Thread(() -> {
            File tmp = new File(getFilesDir(), "scan_tmp"), dst = new File(getFilesDir(), "scan_current");
            try (InputStream in = getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[1 << 16]; for (int k; (k = in.read(buf)) > 0; ) out.write(buf, 0, k);
            } catch (Exception e) { toastNote("파일을 읽지 못했습니다: " + e.getMessage()); return; }
            if (dst.exists() && !dst.delete() || !tmp.renameTo(dst)) { toastNote("파일 저장 실패"); return; }
            prefs.edit().putString("scan_name", name).putString("scan_ext", ext).putString("scan_created", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date())).apply();
            synchronized (data) { scanA = scanB = null; objects.clear(); }
            ai.clear(); refreshAi(); liveAlign = false; saveScanData(); loadScan();
        }, "scan-import").start();
    }
    private void loadScan() {
        toastNote("스캔 불러오는 중…");
        new Thread(() -> {
            try {
                ScanLoader.Cloud c = ScanLoader.load(new File(getFilesDir(), "scan_current"), prefs.getString("scan_ext", "ply"), zUp);
                SurfaceIndex idx = SurfaceIndex.build(c.xyz, c.n, .03f, c.min, c.max);
                index = idx; cloud = c; renderer.setCloud(c); obstacles = buildObstacles(c);
                dist = Math.max(2f, c.extent()*1.1f); yaw = .8f; pitch = .7f;
                alignDirty = true;
                boolean noMarks; synchronized (data) { noMarks = scanA == null || scanB == null; }
                if (noMarks && autoScanAB(c)) toastNote("스캔을 불러왔습니다 · " + note);
                else toastNote("스캔을 불러왔습니다 · 3인칭 지도에서 확인하세요");
            } catch (Throwable e) {
                cloud = null; index = null;
                toastNote("스캔 읽기 실패: " + e.getMessage());
            }
        }, "scan-load").start();
    }
    private static JSONArray vec(float[] v) throws JSONException { JSONArray a = new JSONArray(); for (float x : v) a.put((double)x); return a; }
    private static float[] vec(JSONArray a) throws JSONException { return new float[]{(float)a.getDouble(0), (float)a.getDouble(1), (float)a.getDouble(2)}; }
    private void saveScanData() {
        try {
            JSONObject j = new JSONObject(); JSONArray objs = new JSONArray();
            synchronized (data) {
                if (scanA != null) j.put("a", vec(scanA)); if (scanB != null) j.put("b", vec(scanB));
                for (Obj o : objects) objs.put(new JSONObject().put("id", o.id).put("name", o.name).put("c", vec(new float[]{o.x, o.y, o.z})).put("r", (double)o.r));
            }
            JSONArray ais = new JSONArray();
            for (AiObjects.Item it : ai.confirmed()) ais.put(new JSONObject().put("label", it.label).put("c", vec(new float[]{it.x, it.y, it.z})).put("r", (double)it.r).put("hits", it.hits));
            j.put("ai", ais);
            j.put("objects", objs); prefs.edit().putString("scan_data", j.toString()).apply();
        } catch (JSONException ignored) {}
        alignDirty = true; rebuildObstacles();
    }
    /** Scan A·B picked by the app: 1 m apart on open floor of the scan (FloorMarks). Any thread; false if the floor is too small. */
    private boolean autoScanAB(ScanLoader.Cloud c) {
        if (c == null) return false;
        float fy = ObstacleMap.estimateFloor(c.xyz, c.n, c.min[1], c.max[1]);
        float[][] ab = FloorMarks.pick(c.xyz, c.n, c.min, c.max, fy, 1f);
        if (ab == null) { note = "스캔 바닥이 좁아 A·B를 자동으로 정하지 못했습니다 · 2번에서 'A 직접 탭'·'B 직접 탭'으로 지정하세요"; return false; }
        synchronized (data) { scanA = ab[0]; scanB = ab[1]; }
        saveScanData();
        note = String.format(Locale.US, "스캔 A·B를 바닥에 %.1fm 간격으로 자동 지정했습니다 · 2번에서 현장 A·B를 조준·기록하세요", Alignment.horizontal(ab[0], ab[1]));
        return true;
    }

    private void loadScanData() {
        try {
            JSONObject j = new JSONObject(prefs.getString("scan_data", "{}"));
            synchronized (data) {
                scanA = j.has("a") ? vec(j.getJSONArray("a")) : null; scanB = j.has("b") ? vec(j.getJSONArray("b")) : null;
                objects.clear(); JSONArray objs = j.optJSONArray("objects");
                for (int i = 0; objs != null && i < objs.length(); i++) {
                    JSONObject o = objs.getJSONObject(i); float[] c = vec(o.getJSONArray("c"));
                    objects.add(new Obj(o.getInt("id"), o.getString("name"), c[0], c[1], c[2], (float)o.getDouble("r")));
                }
            }
            ai.clear(); JSONArray ais = j.optJSONArray("ai");
            for (int i = 0; ais != null && i < ais.length(); i++) {
                JSONObject o = ais.getJSONObject(i); float[] c = vec(o.getJSONArray("c"));
                ai.add(new AiObjects.Item(o.getString("label"), c[0], c[1], c[2], (float)o.getDouble("r"), Math.max(AiObjects.CONFIRM, o.optInt("hits", AiObjects.CONFIRM))));
            }
            refreshAi();
        } catch (JSONException ignored) {}
    }

    // ---------------------------------------------------------------------------------- orbit gestures + picking
    private void installGestures() {
        ScaleGestureDetector scaler = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector d) { dist = Math.max(.3f, Math.min(300f, dist/d.getScaleFactor())); return true; }
        });
        GestureDetector gestures = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) { return true; }
            @Override public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                if (e2.getPointerCount() == 1 && !scaler.isInProgress()) { yaw += dx*.006f; pitch = Math.max(-1.45f, Math.min(1.45f, pitch - dy*.006f)); }
                return true;
            }
            @Override public boolean onSingleTapUp(MotionEvent e) { if (pickMode != PICK_NONE) pick(e.getX(), e.getY()); return true; }
            @Override public boolean onDoubleTap(MotionEvent e) { ScanLoader.Cloud c = cloud; dist = c == null ? 6 : Math.max(2f, c.extent()*1.1f); yaw = .8f; pitch = .7f; return true; }
        });
        surface.setOnTouchListener((v, e) -> {
            if (view != VIEW_ORBIT) return false;
            scaler.onTouchEvent(e); gestures.onTouchEvent(e); return true;
        });
    }

    /** UI thread: nearest-to-camera cloud point within ~28dp of the tap, using the last orbit matrix. */
    private void pick(float sx, float sy) {
        ScanLoader.Cloud c = cloud; float[] m;
        synchronized (orbitLock) { if (!orbitReady || c == null) return; m = orbitMVP.clone(); }
        float w = surface.getWidth(), h = surface.getHeight(), r2 = dp(28)*dp(28), bestZ = Float.MAX_VALUE; int best = -1;
        float[] p = c.xyz;
        for (int i = 0; i < c.n; i++) {
            float x = p[i*3], y = p[i*3+1], z = p[i*3+2];
            float cw = m[3]*x + m[7]*y + m[11]*z + m[15]; if (cw <= .01f) continue;
            float px = ((m[0]*x + m[4]*y + m[8]*z + m[12])/cw*.5f + .5f)*w;
            float py = (.5f - (m[1]*x + m[5]*y + m[9]*z + m[13])/cw*.5f)*h;
            float dx = px - sx, dy = py - sy; if (dx*dx + dy*dy > r2) continue;
            float cz = (m[2]*x + m[6]*y + m[10]*z + m[14])/cw;
            if (cz < bestZ) { bestZ = cz; best = i; }
        }
        if (best < 0) { toastNote("그 위치에 스캔 점이 없습니다 · 점 위를 탭하세요"); return; }
        float[] q = {p[best*3], p[best*3+1], p[best*3+2]};
        int mode = pickMode; pickMode = PICK_NONE;
        if (mode == PICK_OBJECT) { addObject(q); return; }
        synchronized (data) { if (mode == PICK_A) scanA = q; else scanB = q; }
        saveScanData(); toastNote(mode == PICK_A ? "스캔 A 지정됨" : "스캔 B 지정됨");
    }

    // ---------------------------------------------------------------------------------- GL
    @Override public void onSurfaceCreated(GL10 gl, EGLConfig config) { background.create(); renderer.create(); }
    @Override public void onSurfaceChanged(GL10 gl, int w, int h) { width = w; heightPx = h; GLES20.glViewport(0, 0, w, h); }

    private final float[] anchorM = new float[16], worldFromS = new float[16], sFromWorld = new float[16];
    private final float[] proj = new float[16], viewM = new float[16], mv = new float[16], mvp = new float[16];
    private float[] camS, camFwdS, nearS = new float[3]; private boolean nearOn = false; private int activeObj = -1;

    private static float[] xf(float[] m, float[] p) { return Alignment.apply(m, p[0], p[1], p[2]); }
    private float floorY() { float[] a; synchronized (data) { a = scanA; } ObstacleMap om = obstacles; ScanLoader.Cloud c = cloud; return a != null ? a[1] : om != null ? om.floorY : c != null ? c.min[1] : 0; }

    private float[] ueP = {0, 0, 0}, ueF = {0, 0, -1}, ueU = {0, 1, 0};
    private static float[] unit(float[] v) { float l = (float)Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return l < 1e-9f ? v : new float[]{v[0]/l, v[1]/l, v[2]/l}; }
    /** GL thread: latest phone pose in the scan frame S for the Unreal link (PTP1). Invalid while scanning or not aligned. */
    private void sendUnreal(Camera camera) {
        if (!unreal.running()) return;
        boolean ok = valid && !scanning && camS != null, walk = ok && walkMode;
        if (ok) {
            Pose d = camera.getDisplayOrientedPose(); float[] z = d.getZAxis(), y = d.getYAxis();
            ueP = camS.clone(); ueF = unit(dirXf(sFromWorld, new float[]{-z[0], -z[1], -z[2]})); ueU = unit(dirXf(sFromWorld, y));
        }
        // pose is valid only during the walking test: Unreal reacts only after "걷기 테스트 시작"
        unreal.setPose(walk, walk, ueP, ueF, ueU, currentScanId());
    }

    @Override public void onDrawFrame(GL10 gl) {
        if (scanning) GLES20.glClearColor(0, 0, 0, 1); else GLES20.glClearColor(.02f, .03f, .05f, 1);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        sender.tick();
        if (session == null) { drawOrbit(); uiTick("NO_AR"); return; }
        try {
            session.setCameraTextureName(background.texture());
            int rot = getWindowManager().getDefaultDisplay().getRotation();
            computeViewport(scanning, rot); GLES20.glViewport(viewX, viewY, viewW, viewH);
            session.setDisplayGeometry(rot, viewW, viewH);
            Frame frame = session.update(); Camera camera = frame.getCamera();
            boolean tracking = camera.getTrackingState() == TrackingState.TRACKING;

            synchronized (labelLock) { labelCount = 0; }
            HitResult hit = tracking && (view == VIEW_AR || realRequest != 0 || aimTarget != 0) ? floorHitTest(frame) : null;
            floorHit = hit != null;
            int req = realRequest;
            if (req != 0) {
                realRequest = 0;
                if (hit == null) note = "바닥 평면이 아직 인식되지 않았습니다 · 바닥을 천천히 비춘 뒤 십자선이 초록일 때 기록";
                else {
                    Anchor a = hit.createAnchor();
                    if (req == 1) { if (realA != null) realA.detach(); realA = a; } else { if (realB != null) realB.detach(); realB = a; }
                    alignDirty = true; note = req == 1 ? "현장 A 기록됨" : "현장 B 기록됨";
                    runOnUiThread(this::exitAim);
                }
            }
            if (scanRequest != 0) handleScanRequest(tracking);
            if (scanning) {
                valid = false; feedback.update(false, 0, false, -1, Float.POSITIVE_INFINITY);
                background.draw(frame);
                if (tracking) integrate(frame, camera);
                LiveScan ls = live;
                if (tracking && ls.started()) maybeDetect(frame, camera, ls.shift());
                if (renderer.consumeLiveLost()) { renderer.beginLive(LIVE_CAP); ls.uploaded = 0; }
                renderer.appendLive(ls.xyz, ls.rgb, ls.uploaded, ls.n); ls.uploaded = ls.n; liveCount = ls.n;
                if (ls.started()) {
                    float[] sh = ls.shift(), model = new float[16];
                    Matrix.setIdentityM(model, 0); Matrix.translateM(model, 0, sh[0], sh[1], sh[2]);
                    camera.getProjectionMatrix(proj, 0, .05f, 100f); camera.getViewMatrix(viewM, 0);
                    Matrix.multiplyMM(mv, 0, viewM, 0, model, 0);
                    renderer.drawPoints(mv, proj, heightPx/450f, new float[3], 0, .8f);
                }
                if (tracking) arWorldMarkers(camera, hit);
                sendUnreal(camera);
                uiTick(tracking ? "SCANNING" : camera.getTrackingFailureReason().toString());
                return;
            }
            if (alignDirty) align();
            twin(camera, tracking);
            sendUnreal(camera);
            if (valid && walkMode && tracking) maybeDetect(frame, camera, null);
            updateSounds(camera);

            int v = view;
            if (v == VIEW_ORBIT) drawOrbit();
            else {
                if (v == VIEW_AR || !valid) background.draw(frame);
                if (valid) {
                    camera.getProjectionMatrix(proj, 0, .05f, 100f); camera.getViewMatrix(viewM, 0);
                    Matrix.multiplyMM(mv, 0, viewM, 0, worldFromS, 0); Matrix.multiplyMM(mvp, 0, proj, 0, mv, 0);
                    boolean ar = v == VIEW_AR;
                    renderer.drawPoints(mv, proj, heightPx/(ar ? 450f : 300f), probeS, walkMode ? 0 : range/scale, ar ? .55f : 1f);
                    markers(mvp, false);
                }
                if (v == VIEW_AR && tracking) arWorldMarkers(camera, hit);
                if (aimTarget != 0 && !(aligned && valid)) drawAimMap();
            }

            String reason = !tracking ? camera.getTrackingFailureReason().toString() : !aligned ? "ALIGN_NEEDED" : valid ? "TRACKING" : "ANCHOR_PAUSED";
            float[] p = lastPosition, f = {1, 0, 0}, u = {0, 0, 1};
            if (valid) {
                Pose rel = origin.getPose().inverse().compose(camera.getPose());
                p = ue(rel.getTranslation()); f = ue(rel.rotateVector(new float[]{0, 0, -1})); u = ue(rel.rotateVector(new float[]{0, 1, 0})); lastPosition = p;
            }
            long now = SystemClock.elapsedRealtimeNanos();
            boolean newFrame = frame.getTimestamp() != lastFrame && frame.getTimestamp() != 0;
            if ((newFrame || !valid) && now - lastSent >= 33333333L) { lastSent = now; lastFrame = frame.getTimestamp(); sender.send(packet(valid, reason, p, f, u)); }
            uiTick(reason);
        } catch (Exception e) {
            valid = false; feedback.update(false, 0, false, -1, Float.POSITIVE_INFINITY);
            long now = SystemClock.elapsedRealtimeNanos();
            if (now - lastSent > 100000000L) { lastSent = now; sender.send(packet(false, "AR_ERROR", lastPosition, new float[]{1, 0, 0}, new float[]{0, 0, 1})); }
            note = "AR 오류: " + e.getClass().getSimpleName();
            uiTick("AR_ERROR");
        }
    }

    // ---------------------------------------------------------------------------------- in-app scanning (GL thread)
    private void setDepth(boolean on) {
        try { arConfig.setDepthMode(on && depthSupported ? Config.DepthMode.RAW_DEPTH_ONLY : Config.DepthMode.DISABLED); session.configure(arConfig); }
        catch (Exception e) { if (on) depthSupported = false; }
        // turning depth on must not swap the lens / crop (it would narrow the view): put the chosen wide config back
        CameraConfig want = chosenConfig;
        try {
            CameraConfig now = session.getCameraConfig();
            if (want != null && (!want.getCameraId().equals(now.getCameraId()) || !want.getTextureSize().equals(now.getTextureSize()))) {
                session.pause(); session.setCameraConfig(want); session.configure(arConfig); session.resume();
            }
        } catch (Exception e) { note = "카메라 설정 복원 실패: " + e.getClass().getSimpleName(); }
    }

    /** GL thread: full screen, or (fit) the largest centred rect with the camera image's aspect so nothing is cropped. */
    private void computeViewport(boolean fit, int rotation) {
        viewX = 0; viewY = 0; viewW = width; viewH = heightPx;
        if (!fit) return;
        CameraConfig cc = chosenConfig; Size t;
        try { t = cc != null ? cc.getTextureSize() : session.getCameraConfig().getTextureSize(); } catch (Exception e) { return; }
        float lo = Math.min(t.getWidth(), t.getHeight()), hi = Math.max(t.getWidth(), t.getHeight());
        float a = rotation % 2 == 0 ? lo/hi : hi/lo;                       // displayed width / height (portrait: sensor is sideways)
        int w = width, h = Math.round(width/a);
        if (h > heightPx) { h = heightPx; w = Math.round(heightPx*a); }
        viewX = (width - w)/2; viewY = (heightPx - h)/2; viewW = Math.max(1, w); viewH = Math.max(1, h);
    }

    private void handleScanRequest(boolean tracking) {
        int r = scanRequest; scanRequest = 0;
        if (r == 1) {
            if (scanning) return;
            if (!tracking) { note = "추적이 안정된 뒤 스캔을 시작하세요 (주변을 천천히 비추기)"; return; }
            setDepth(true);
            live = new LiveScan(scanVoxel, LIVE_CAP); renderer.beginLive(LIVE_CAP); lastDepthTs = -1; liveCount = 0;
            scanning = true; aligned = false; liveAlign = false; walkMode = false; lastScanPoseT = 0;
            runOnUiThread(() -> setScanUi(true));
            synchronized (pendingObs) { pendingObs.clear(); }
            note = depthSupported ? "스캔 중 (깊이 모드)" : "스캔 중 (특징점 모드 · 이 기종은 Depth API 미지원이라 점이 성깁니다)";
            return;
        }
        if (!scanning) return;
        scanning = false; renderer.endLive(); setDepth(false);
        runOnUiThread(() -> setScanUi(false));
        LiveScan ls = live; live = null;
        if (r == 3 || ls.n < 500) {
            note = r == 3 ? "스캔을 취소했습니다" : "점이 너무 적어 저장하지 않았습니다 (" + ls.n + "점)";
            ScanLoader.Cloud old = cloud; if (old != null) renderer.setCloud(old);
            alignDirty = true; return;
        }
        finishScan(ls);
    }

    private void finishScan(LiveScan ls) {
        float[] sh = ls.shift();
        String name = "phone_scan_" + new SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(new Date()) + ".ply";
        int minHits = depthSupported ? scanMinHits : 1;          // feature points are sparse: every one counts
        ScanLoader.Cloud c0 = ls.toCloud("", minHits);
        if (c0.n < 500) { minHits = 1; c0 = ls.toCloud("", 1); }
        ScanLoader.Cloud c = new ScanLoader.Cloud(c0.xyz, c0.rgb, c0.n, String.format(Locale.US, "휴대폰 스캔 (%s) · %,d점 (복셀 %,d개 중 %d회 이상 관측)", depthSupported ? "깊이" : "특징점", c0.n, ls.n, minHits));
        float[] a = null, b = null;
        if (realA != null && realB != null && realA.getTrackingState() != TrackingState.STOPPED && realB.getTrackingState() != TrackingState.STOPPED) {
            float[] wa = realA.getPose().getTranslation(), wb = realB.getPose().getTranslation();
            a = new float[]{wa[0]-sh[0], wa[1]-sh[1], wa[2]-sh[2]}; b = new float[]{wb[0]-sh[0], wb[1]-sh[1], wb[2]-sh[2]};
        }
        synchronized (data) { scanA = a; scanB = b; objects.clear(); }
        ai.clear(); refreshAi();
        zUp = false;
        prefs.edit().putBoolean("zup", false).putString("scan_name", name).putString("scan_ext", "ply").putString("scan_created", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date())).apply();
        cloud = c; index = null; renderer.setCloud(c);
        if (a == null) {
            // Scan frame = world shifted by sh: an anchor at sh with no rotation aligns the scan right away.
            Anchor next = session.createAnchor(new Pose(sh, new float[]{0, 0, 0, 1}));
            if (origin != null) origin.detach();
            float[] id = new float[16]; Matrix.setIdentityM(id, 0);
            origin = next; epoch++; mLS = id; scale = 1; aligned = true; liveAlign = true;
            alignText = "스캔 직후 자동 정렬 (이번 실행에서만 유효)\n다음 실행을 위해 3인칭 지도에서 바닥의 스캔 A·B를 탭해 두세요";
        } else liveAlign = false;
        saveScanData();
        dist = Math.max(2f, c.extent()*1.1f); yaw = .8f; pitch = .7f;
        note = "스캔 완료 · 저장 중…";
        final boolean noMarks = a == null;
        new Thread(() -> {
            if (noMarks) autoScanAB(c);   // no floor marks recorded before the scan: pick scan A·B on its floor
            SurfaceIndex idx = SurfaceIndex.build(c.xyz, c.n, .03f, c.min, c.max);
            index = idx;
            ObstacleMap om = buildObstacles(c); obstacles = om;
            List<Detector.Obs> seen; synchronized (pendingObs) { seen = new ArrayList<>(pendingObs); pendingObs.clear(); }
            for (Detector.Obs o : seen) resolveObs(o, idx, om.floorY + .08f, 1f);
            refreshAi(); saveScanData();
            File tmp = new File(getFilesDir(), "scan_tmp"), dst = new File(getFilesDir(), "scan_current");
            try {
                LiveScan.writePly(c, tmp);
                if (dst.exists() && !dst.delete() || !tmp.renameTo(dst)) throw new IOException("rename");
                int found = aiCache.size();
                toastNote("스캔 저장됨: " + name + " · 바로 반응을 시험할 수 있습니다" + (found > 0 ? " · AI가 사물 " + found + "개를 인식했습니다" : ""));
                if (prefs.getBoolean("gh_auto", false)) runOnUiThread(this::uploadScan);
            } catch (IOException e) { toastNote("스캔 저장 실패: " + e.getMessage()); }
        }, "scan-save").start();
    }

    private static int clamp255(float v) { return v < 0 ? 0 : v > 255 ? 255 : (int)v; }

    /** Motion-blur gate: true when the camera turned faster than 60°/s or moved faster than 1 m/s since the last check. */
    private boolean movingTooFast(Pose p, long now) {
        float[] t = p.getTranslation(), q = p.getRotationQuaternion(), l = lastScanPose;
        long last = lastScanPoseT; float dt = (now - last)/1000f;
        float dot = Math.abs(q[0]*l[3] + q[1]*l[4] + q[2]*l[5] + q[3]*l[6]);
        float ang = (float)Math.toDegrees(2*Math.acos(Math.min(1f, dot)));
        float move = (float)Math.sqrt((t[0]-l[0])*(t[0]-l[0]) + (t[1]-l[1])*(t[1]-l[1]) + (t[2]-l[2])*(t[2]-l[2]));
        System.arraycopy(t, 0, l, 0, 3); System.arraycopy(q, 0, l, 3, 4); lastScanPoseT = now;
        if (last == 0 || dt <= 0 || dt > 1f) return false;
        return ang/dt > 60f || move/dt > 1f;
    }

    /**
     * Adds the newest depth image (or ARCore feature points) to the live scan, in world coordinates.
     * Every depth pixel is used; low-confidence pixels, flying pixels at depth edges and blurred (fast-moving)
     * frames are skipped, and each sample is weighted by confidence / distance² for the per-voxel mean.
     */
    private void integrate(Frame frame, Camera camera) {
        long now = SystemClock.uptimeMillis();
        LiveScan ls = live;
        if (now - lastIntegrate < Math.max(50, integrateCost*2)) return;   // adaptive: keeps the GL thread under ~50% for big depth maps; when full, voxels keep refining
        float[] m = new float[16]; camera.getPose().toMatrix(m, 0);
        if (!depthSupported) {
            PointCloud pc = frame.acquirePointCloud();
            try {
                if (pc.getTimestamp() == lastDepthTs) return;
                lastDepthTs = pc.getTimestamp(); lastIntegrate = now;
                FloatBuffer b = pc.getPoints();
                for (int i = 0; i + 3 < b.limit(); i += 4) if (b.get(i+3) > .3f) ls.add(b.get(i), b.get(i+1), b.get(i+2), -1, 0, 0, b.get(i+3));
            } finally { pc.close(); }
            return;
        }
        Image depth = null, conf = null, cam = null;
        try {
            depth = frame.acquireRawDepthImage16Bits();
            if (depth.getTimestamp() == lastDepthTs) return;
            lastDepthTs = depth.getTimestamp(); lastIntegrate = now;
            if (movingTooFast(camera.getPose(), now)) { note = "너무 빨리 움직여 흔들린 프레임은 건너뜁니다 · 천천히"; return; }
            conf = frame.acquireRawDepthConfidenceImage();
            try { cam = frame.acquireCameraImage(); } catch (Exception ignored) {}
            int dw = depth.getWidth(), dh = depth.getHeight();
            CameraIntrinsics in = camera.getTextureIntrinsics();
            float[] fl = in.getFocalLength(), pp = in.getPrincipalPoint(); int[] dim = in.getImageDimensions();
            float fx = fl[0]*dw/dim[0], fy = fl[1]*dh/dim[1], cx = pp[0]*dw/dim[0], cy = pp[1]*dh/dim[1];
            Image.Plane dpl = depth.getPlanes()[0]; ByteBuffer db = dpl.getBuffer().order(ByteOrder.nativeOrder());
            int drs = dpl.getRowStride(), dps = dpl.getPixelStride();
            Image.Plane cpl = conf.getPlanes()[0]; ByteBuffer cb = cpl.getBuffer(); int crs = cpl.getRowStride(), cps = cpl.getPixelStride();
            // colour: depth pixel -> texture-normalised -> CPU camera image pixel (both sensor-oriented, axis-aligned)
            float ix0 = 0, iy0 = 0, ixs = 0, iys = 0; int iw = 0, ih = 0, yrs = 0, yps = 0, urs = 0, ups = 0, vrs = 0, vps = 0;
            ByteBuffer yb = null, ub = null, vb = null;
            if (cam != null) {
                float[] o = new float[4];
                frame.transformCoordinates2d(Coordinates2d.TEXTURE_NORMALIZED, new float[]{0, 0, 1, 1}, Coordinates2d.IMAGE_PIXELS, o);
                ix0 = o[0]; iy0 = o[1]; ixs = o[2]-o[0]; iys = o[3]-o[1]; iw = cam.getWidth(); ih = cam.getHeight();
                Image.Plane[] pl = cam.getPlanes();
                yb = pl[0].getBuffer(); yrs = pl[0].getRowStride(); yps = pl[0].getPixelStride();
                ub = pl[1].getBuffer(); urs = pl[1].getRowStride(); ups = pl[1].getPixelStride();
                vb = pl[2].getBuffer(); vrs = pl[2].getRowStride(); vps = pl[2].getPixelStride();
            }
            float maxR = scanMaxRange; int confMin = Math.round(scanConf*255);
            for (int y = 0; y < dh; y++) for (int x = 0; x < dw; x++) {
                int mm = db.getShort(y*drs + x*dps) & 0xffff; if (mm == 0) continue;
                float d = mm/1000f; if (d < .2f || d > maxR) continue;
                int c = cb.get(y*crs + x*cps) & 0xff; if (c < confMin) continue;   // raw depth confidence
                // flying pixels: a sample sitting on a depth edge is a blend of foreground and background
                int tol = Math.round(mm*.04f) + 10; boolean edge = false;
                if (x > 0) { int k = db.getShort(y*drs + (x-1)*dps) & 0xffff; edge |= k != 0 && Math.abs(k - mm) > tol; }
                if (x + 1 < dw) { int k = db.getShort(y*drs + (x+1)*dps) & 0xffff; edge |= k != 0 && Math.abs(k - mm) > tol; }
                if (y > 0) { int k = db.getShort((y-1)*drs + x*dps) & 0xffff; edge |= k != 0 && Math.abs(k - mm) > tol; }
                if (y + 1 < dh) { int k = db.getShort((y+1)*drs + x*dps) & 0xffff; edge |= k != 0 && Math.abs(k - mm) > tol; }
                if (edge) continue;
                float px = d*(x - cx)/fx, py = d*(cy - y)/fy, pz = -d;          // camera space (OpenGL convention)
                float wx = m[0]*px + m[4]*py + m[8]*pz + m[12], wy = m[1]*px + m[5]*py + m[9]*pz + m[13], wz = m[2]*px + m[6]*py + m[10]*pz + m[14];
                int r = -1, g = 0, bl = 0;
                if (cam != null) {
                    int u = (int)(ix0 + (x + .5f)/dw*ixs), v = (int)(iy0 + (y + .5f)/dh*iys);
                    if (u >= 0 && v >= 0 && u < iw && v < ih) {
                        int Y = yb.get(v*yrs + u*yps) & 0xff, U = (ub.get((v/2)*urs + (u/2)*ups) & 0xff) - 128, V = (vb.get((v/2)*vrs + (u/2)*vps) & 0xff) - 128;
                        r = clamp255(Y + 1.402f*V); g = clamp255(Y - .344f*U - .714f*V); bl = clamp255(Y + 1.772f*U);
                    }
                }
                ls.add(wx, wy, wz, r, g, bl, (c/255f)/(d*d));                  // depth noise grows with d², so near samples count more
                if (ls.full()) note = "최대 점 수에 도달했습니다 · 기존 점은 계속 다듬어집니다 · 완료·저장을 누르세요";
            }
        } catch (NotYetAvailableException ignored) {
        } catch (Exception e) {
            depthSupported = false; note = "깊이 스캔 오류(" + e.getClass().getSimpleName() + ") → 특징점 모드로 전환";
        } finally {
            if (depth != null) depth.close(); if (conf != null) conf.close(); if (cam != null) cam.close();
            integrateCost = SystemClock.uptimeMillis() - now;
        }
    }

    private HitResult floorHitTest(Frame frame) {
        for (HitResult h : frame.hitTest(viewW/2f, viewH/2f)) {
            Trackable t = h.getTrackable();
            if (t instanceof Plane) { Plane pl = (Plane)t; if (pl.getType() == Plane.Type.HORIZONTAL_UPWARD_FACING && pl.isPoseInPolygon(h.getHitPose())) return h; }
        }
        return null;
    }

    /** Shortest usable A–B baseline; under 1m only a warning is shown. */
    static final float MIN_AB = .15f;
    /** GL thread: rebuild the origin anchor from scan A/B + real A/B. */
    private void align() {
        alignDirty = false;
        float[] sa, sb; synchronized (data) { sa = scanA; sb = scanB; }
        if (liveAlign && (sa == null || sb == null) && realA != null && realB != null && origin != null
                && realA.getTrackingState() != TrackingState.STOPPED && realB.getTrackingState() != TrackingState.STOPPED) {
            // the scan was made in this run, so its frame is known: the floor marks recorded now become the scan's A·B too
            float[] am = new float[16], wfs = new float[16], sfw = new float[16];
            origin.getPose().toMatrix(am, 0); Matrix.multiplyMM(wfs, 0, am, 0, mLS, 0); Matrix.invertM(sfw, 0, wfs, 0);
            float[] a = xf(sfw, realA.getPose().getTranslation()), b = xf(sfw, realB.getPose().getTranslation());
            synchronized (data) { scanA = a; scanB = b; }
            saveScanData();   // marks alignDirty: the next frame aligns with all four points
            note = "현장 A·B를 이 스캔의 A·B로도 저장했습니다 · 다음 실행에서도 현장 A·B만 기록하면 정렬됩니다";
            return;
        }
        if (liveAlign && (sa == null || sb == null || realA == null || realB == null)) return;   // keep the post-scan alignment
        if (cloud == null || sa == null || sb == null || realA == null || realB == null) {
            aligned = false;
            alignText = cloud == null ? "스캔을 먼저 여세요"
                : sa == null || sb == null ? "정렬 전 · 이 스캔에 스캔 A·B가 없습니다 · 2번 '스캔에서 A 탭'·'스캔에서 B 탭'으로 바닥 두 점을 지정하세요"
                : "정렬 전 · 2번에서 현장 " + (realA == null && realB == null ? "A·B" : realA == null ? "A" : "B") + "를 기록하세요";
            return;
        }
        // a PAUSED anchor still holds its last pose; only a STOPPED one is gone
        if (realA.getTrackingState() == TrackingState.STOPPED || realB.getTrackingState() == TrackingState.STOPPED) {
            aligned = false; alignText = "현장 A·B 기록이 사라졌습니다 · 2번에서 다시 기록하세요"; return;
        }
        float[] a = realA.getPose().getTranslation(), b = realB.getPose().getTranslation();
        float realD = Alignment.horizontal(a, b), scanD = Alignment.horizontal(sa, sb);
        if (realD < MIN_AB || scanD < MIN_AB) {
            aligned = false;
            alignText = String.format(Locale.US, "A–B 간격이 너무 짧습니다 (스캔 %.2f / 현장 %.2f m · %.0fcm 이상, 가능하면 2m 이상)", scanD, realD, MIN_AB*100);
            return;
        }
        float s = useScale ? realD/scanD : 1f;
        float[] q = Alignment.yawFacing((b[0]-a[0])/realD, (b[2]-a[2])/realD);
        Anchor next = session.createAnchor(new Pose(a, q));
        if (origin != null) origin.detach();
        origin = next; epoch++; mLS = Alignment.scanToLocal(sa, sb, s); scale = s; aligned = true; liveAlign = false;
        float diff = (realD/scanD - 1)*100;
        alignText = String.format(Locale.US, "정렬 완료 · 스캔 A–B %.2f / 현장 %.2f m · 차이 %+.1f%%%s", scanD, realD, diff,
            (useScale ? String.format(Locale.US, " → 스케일 %.3f 적용", s) : Math.abs(diff) > 3 ? "\n차이가 큽니다: 지점 재확인 또는 스케일 보정 사용" : "")
            + (Math.min(realD, scanD) < 1f ? "\nA–B가 1m보다 짧아 방향 오차가 큽니다 · 다음엔 2~3m 간격 권장" : ""));
        if (walkMode) note = "정렬 완료 · 걷기 테스트 연동을 시작합니다";
    }

    /** GL thread: hand position in the scan, nearest surface/object, feedback. */
    private void twin(Camera camera, boolean tracking) {
        boolean ok = tracking && aligned && origin != null && origin.getTrackingState() != TrackingState.STOPPED;
        valid = ok;
        if (!ok) { feedback.update(false, 0, false, -1, Float.POSITIVE_INFINITY); hudNear = hudAhead = Float.POSITIVE_INFINITY; hudDeadEnd = false; hudDist = Float.POSITIVE_INFINITY; hudIntensity = 0; hudObj = -1; hudContact = false; activeObj = -1; nearOn = false; return; }
        origin.getPose().toMatrix(anchorM, 0);
        Matrix.multiplyMM(worldFromS, 0, anchorM, 0, mLS, 0);
        Matrix.invertM(sFromWorld, 0, worldFromS, 0);
        Pose cam = camera.getPose();
        float[] probe = xf(sFromWorld, cam.transformPoint(new float[]{0, 0, -probeOffset}));
        camS = xf(sFromWorld, cam.getTranslation()); camFwdS = xf(sFromWorld, cam.transformPoint(new float[]{0, 0, -.4f}));
        probeS = probe;
        if (walkMode) { walkTwin(camera); return; }
        // Everything (vibration, sound, ESP32, Unreal) starts only with "걷기 테스트 시작".
        feedback.update(false, 0, false, -1, Float.POSITIVE_INFINITY);
        hudNear = hudAhead = Float.POSITIVE_INFINITY; hudDeadEnd = false; hudDist = Float.POSITIVE_INFINITY; hudIntensity = 0; hudObj = -1; hudContact = false; activeObj = -1; nearOn = false;
    }

    /** v3 hand-touch reaction; no longer called (tests start with the walking test only). Kept for reference. */
    @SuppressWarnings("unused")
    private void handTwin(float[] probe) {
        float sc = scale, best = Float.POSITIVE_INFINITY; int obj = -1; float[] near = new float[3];
        SurfaceIndex idx = index;
        if (surfaceOn && idx != null) {
            float d = idx.nearest(probe[0], probe[1], probe[2], range/sc, skipFloor, floorY(), .10f/sc, near);
            if (!Float.isInfinite(d)) { best = d*sc; obj = aiAt(near[0], near[1], near[2], true); System.arraycopy(near, 0, nearS, 0, 3); }
        }
        synchronized (data) {
            for (Obj o : objects) {
                float dx = probe[0]-o.x, dy = probe[1]-o.y, dz = probe[2]-o.z, len = (float)Math.sqrt(dx*dx+dy*dy+dz*dz);
                float d = Math.max(0, (len - o.r)*sc);
                if (d < best) {
                    best = d; obj = o.id;
                    if (len > 1e-5f) { nearS[0] = o.x + dx/len*o.r; nearS[1] = o.y + dy/len*o.r; nearS[2] = o.z + dz/len*o.r; } else System.arraycopy(probe, 0, nearS, 0, 3);
                }
            }
        }
        float rg = range, ct = Math.min(contactDist, rg*.9f);
        float intensity = best >= rg ? 0 : Math.max(0, Math.min(1, (rg - best)/(rg - ct)));
        boolean contact = best <= ct;
        if (best >= rg) obj = -1;
        nearOn = obj >= 0; activeObj = obj;
        feedback.update(true, intensity, contact, obj, best);
        hudDist = best; hudIntensity = intensity; hudObj = obj; hudContact = contact;
    }

    private void drawOrbit() {
        ScanLoader.Cloud c = cloud;
        if (c == null) return;
        boolean al = aligned;
        float[] model = new float[16];
        if (al) System.arraycopy(mLS, 0, model, 0, 16); else Matrix.setIdentityM(model, 0);
        float[] target;
        if (al && valid && camS != null) target = xf(mLS, camS);
        else if (al) target = new float[]{0, 1, 0};
        else target = c.center();
        float cp = (float)Math.cos(pitch), d = dist;
        float ex = target[0] + d*cp*(float)Math.sin(yaw), ey = target[1] + d*(float)Math.sin(pitch), ez = target[2] + d*cp*(float)Math.cos(yaw);
        Matrix.perspectiveM(proj, 0, 60, width/(float)heightPx, .05f, 500f);
        Matrix.setLookAtM(viewM, 0, ex, ey, ez, target[0], target[1], target[2], 0, 1, 0);
        Matrix.multiplyMM(mv, 0, viewM, 0, model, 0); Matrix.multiplyMM(mvp, 0, proj, 0, mv, 0);
        synchronized (orbitLock) { System.arraycopy(mvp, 0, orbitMVP, 0, 16); orbitReady = true; }
        float[] probe = probeS;
        renderer.drawPoints(mv, proj, heightPx/300f, valid && probe != null ? probe : new float[3], valid ? range/scale : 0, 1f);
        markers(mvp, true);
    }

    /** Markers in scan frame: objects, scan A/B, hand probe, nearest-surface line, phone. */
    private void markers(float[] m, boolean showPhone) {
        float[] a, b;
        synchronized (data) {
            a = scanA; b = scanB;
            for (Obj o : objects) {
                boolean hot = o.id == activeObj;
                renderer.drawSphere(m, o.x, o.y, o.z, o.r, 1f, hot ? .25f : .85f, hot ? .2f : .1f);
            }
        }
        List<AiObjects.Item> items = aiCache;
        synchronized (labelLock) {
            int k = 0;
            for (int i = 0; i < items.size(); i++) {
                AiObjects.Item it = items.get(i);
                boolean hot = activeObj == 100 + i;
                renderer.drawSphere(m, it.x, it.y, it.z, it.r, hot ? 1f : .2f, hot ? .35f : .9f, hot ? .2f : 1f);
                if (k >= labelViews.length) continue;
                float lx = it.x, ly = it.y + it.r, lz = it.z;
                float cw = m[3]*lx + m[7]*ly + m[11]*lz + m[15]; if (cw <= .05f) continue;
                float nx = (m[0]*lx + m[4]*ly + m[8]*lz + m[12])/cw, ny = (m[1]*lx + m[5]*ly + m[9]*lz + m[13])/cw;
                if (Math.abs(nx) > 1.1f || Math.abs(ny) > 1.1f) continue;
                labelXY[k*2] = (nx*.5f + .5f)*width; labelXY[k*2+1] = (.5f - ny*.5f)*heightPx; labelTxt[k] = AiObjects.korean(it.label); k++;
            }
            labelCount = k;
        }
        if (a != null) renderer.drawShape(m, a, 3, GLES20.GL_POINTS, .2f, 1f, .4f, dp(9));
        if (b != null) renderer.drawShape(m, b, 3, GLES20.GL_POINTS, .3f, .6f, 1f, dp(9));
        float[] p = probeS;
        if (!valid || p == null) return;
        float i = hudIntensity;
        if (nearOn) renderer.drawShape(m, new float[]{p[0], p[1], p[2], nearS[0], nearS[1], nearS[2]}, 6, GLES20.GL_LINES, 1f, .55f, .1f, 1);
        renderer.drawShape(m, p, 3, GLES20.GL_POINTS, 1f, 1f - i, 1f - i, dp(8));
        if (showPhone && camS != null && camFwdS != null) {
            renderer.drawShape(m, camS, 3, GLES20.GL_POINTS, .1f, .9f, 1f, dp(7));
            renderer.drawShape(m, new float[]{camS[0], camS[1], camS[2], camFwdS[0], camFwdS[1], camFwdS[2]}, 6, GLES20.GL_LINES, .1f, .9f, 1f, 1);
        }
    }

    private void uiTick(String reason) {
        long now = SystemClock.elapsedRealtimeNanos();
        if (now - lastUi < 150000000L) return;
        lastUi = now;
        final String info = sender.status + " · " + feedback.espStatus + "\n" + reason + " · " + note;
        final String h = hudText();
        final boolean green = floorHit;
        final int lc; final float[] lxy; final String[] lt;
        synchronized (labelLock) { lc = labelCount; lxy = labelXY.clone(); lt = labelTxt.clone(); }
        runOnUiThread(() -> {
            status.setText(info); hud.setText(h); crosshair.setTextColor(green ? 0xff4ade80 : 0xffffffff); refreshPanel();
            if (scanning) scanOverlayText.setText(h + "\n" + reason + " · " + note);
            for (int i = 0; i < labelViews.length; i++) {
                TextView t = labelViews[i];
                if (i >= lc) { t.setVisibility(View.GONE); continue; }
                t.setText(lt[i]); t.setVisibility(View.VISIBLE);
                t.setTranslationX(lxy[i*2] - t.getWidth()/2f); t.setTranslationY(lxy[i*2+1] - t.getHeight());
            }
        });
    }

    private String hudText() {
        if (scanning) {
            int seen; synchronized (pendingObs) { seen = pendingObs.size(); }
            return String.format(Locale.US, "● 스캔 중  %,d점 (%d%%) · %s%s\n천천히 훑어 빈 곳을 채우세요 · 끝나면 완료·저장", liveCount, liveCount*100/LIVE_CAP, depthSupported ? "깊이" : "특징점",
                aiOn ? "\nAI: " + (detector.lastSeen.isEmpty() ? "사물을 찾는 중" : detector.lastSeen) + " (관측 " + seen + ")" : "");
        }
        if (aimTarget != 0) return floorHit ? "바닥 인식됨 · 원을 테이프 지점에 맞추고 기록 버튼을 누르세요" : "바닥을 찾는 중 · 바닥을 비추며 휴대폰을 천천히 움직이세요";
        if (!valid) return cloud == null ? "스캔 없음 · 설정 ▼ 에서 스캔 파일을 여세요" : !aligned ? alignText : "추적 대기 중 · 카메라로 주변을 비추세요";
        if (!walkMode) return "정렬 완료 · 위쪽 '🚶 걷기 테스트 시작'을 누르면 진동·소리·ESP32·언리얼 연동이 시작됩니다";
        float d = hudDist, i = hudIntensity; int o = hudObj;
        StringBuilder bar = new StringBuilder(); int n = Math.round(i*12); for (int k = 0; k < 12; k++) bar.append(k < n ? '█' : '·');
        String what = o < 0 ? "범위 밖" : o == 0 ? (walkMode ? "벽·장애물" : "스캔 표면") : objName(o);
        if (walkMode) {
            float na = hudNear, ah = hudAhead;
            return String.format(Locale.US, "🚶 %s  앞 %s · 주변 %s%s\n%s %3.0f%%  %s",
                hudContact ? "▶ 부딪힘 주의" : hudDeadEnd ? "■ 막다른 곳" : "걷기", Float.isInfinite(ah) ? "열림" : String.format(Locale.US, "%.2fm", ah),
                Float.isInfinite(na) ? "여유" : String.format(Locale.US, "%.2fm", na), o < 0 ? "" : " (" + what + ")", bar, i*100, obstacles == null ? "장애물 지도 준비 중" : "");
        }
        float[] p = lastPosition;
        return String.format(Locale.US, "%s %s %s\n%s %3.0f%%  X %.2f  Y %.2f  Z %.2f m",
            hudContact ? "▶ 접촉" : "  근접", what, Float.isInfinite(d) ? "" : String.format(Locale.US, "%.2fm", d), bar, i*100, p[0], p[1], p[2]);
    }
    private String objName(int id) {
        if (id >= 100) { List<AiObjects.Item> l = aiCache; return id - 100 < l.size() ? AiObjects.korean(l.get(id - 100).label) : "AI 사물"; }
        synchronized (data) { for (Obj o : objects) if (o.id == id) return o.name; } return "사물 " + id; }

    // ---------------------------------------------------------------------------------- AR markers in world space
    /** Recorded real A/B marks and, while aiming, a ring on the floor where the crosshair hits. */
    private void arWorldMarkers(Camera camera, HitResult hit) {
        camera.getProjectionMatrix(proj, 0, .05f, 100f); camera.getViewMatrix(viewM, 0);
        float[] w = new float[16]; Matrix.multiplyMM(w, 0, proj, 0, viewM, 0);
        float[] a = realA != null && realA.getTrackingState() == TrackingState.TRACKING ? realA.getPose().getTranslation() : null;
        float[] b = realB != null && realB.getTrackingState() == TrackingState.TRACKING ? realB.getPose().getTranslation() : null;
        if (a != null) { ring(w, a, .08f, .2f, 1f, .4f); renderer.drawShape(w, a, 3, GLES20.GL_POINTS, .2f, 1f, .4f, dp(10)); }
        if (b != null) { ring(w, b, .08f, .3f, .6f, 1f); renderer.drawShape(w, b, 3, GLES20.GL_POINTS, .3f, .6f, 1f, dp(10)); }
        if (a != null && b != null) renderer.drawShape(w, new float[]{a[0], a[1], a[2], b[0], b[1], b[2]}, 6, GLES20.GL_LINES, 1f, 1f, 1f, 1);
        if (aimTarget != 0 && hit != null) {
            float[] t = hit.getHitPose().getTranslation(); boolean isA = aimTarget == 1;
            ring(w, t, .12f, isA ? .2f : .3f, isA ? 1f : .6f, isA ? .4f : 1f); ring(w, t, .03f, 1f, 1f, 1f);
        }
        if (aimTarget == 0) return;
        float[] sa, sb; synchronized (data) { sa = scanA; sb = scanB; }
        if (sa == null || sb == null) return;
        if (aligned && valid) {
            // the scan's place in the room is known: stand pillars on its A·B so the crosshair can go right under them
            for (int k = 0; k < 2; k++) {
                float[] p = xf(worldFromS, k == 0 ? sa : sb); boolean aimed = aimTarget == k + 1;
                float r = k == 0 ? .2f : .3f, g = k == 0 ? 1f : .6f, bl = k == 0 ? .4f : 1f;
                ring(w, p, .15f, r, g, bl); if (aimed) { ring(w, p, .22f, r, g, bl); ring(w, p, .3f, r, g, bl); }
                renderer.drawShape(w, new float[]{p[0], p[1], p[2], p[0], p[1] + (aimed ? 1.2f : .6f), p[2]}, 6, GLES20.GL_LINES, r, g, bl, 1);
                renderer.drawShape(w, p, 3, GLES20.GL_POINTS, r, g, bl, dp(aimed ? 14 : 9));
            }
        } else {
            // one real mark is down: the other one lies on a circle of the scan's A–B distance around it
            float[] o = aimTarget == 2 ? a : b;
            if (o != null) { float d = Alignment.horizontal(sa, sb); ring(w, o, d, 1f, 1f, 1f); ring(w, o, d + .02f, 1f, 1f, 1f); }
        }
    }

    /** While aiming without a known scan placement: a top-down map of the scan in the corner with scan A (green) and B (blue). */
    private void drawAimMap() {
        ScanLoader.Cloud c = cloud; float[] sa, sb; synchronized (data) { sa = scanA; sb = scanB; }
        if (c == null || sa == null || sb == null) return;
        int s = Math.round(Math.min(width, heightPx)*.42f), x = width - s - dp(8), y = heightPx - s - dp(110);
        GLES20.glViewport(x, y, s, s);
        GLES20.glEnable(GLES20.GL_SCISSOR_TEST); GLES20.glScissor(x, y, s, s);
        GLES20.glClearColor(.02f, .03f, .05f, 1); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        GLES20.glDisable(GLES20.GL_SCISSOR_TEST);
        // look straight down, A→B pointing up the map, whole scan in view
        float d = Alignment.horizontal(sa, sb), ux = (sb[0]-sa[0])/d, uz = (sb[2]-sa[2])/d;
        float cx = (c.min[0]+c.max[0])/2, cz = (c.min[2]+c.max[2])/2, half = Math.max(c.max[0]-c.min[0], c.max[2]-c.min[2])*.55f;
        float eyeY = c.max[1] + 5;
        float[] v = new float[16], p = new float[16], m = new float[16], mvp2 = new float[16];
        Matrix.setLookAtM(v, 0, cx, eyeY, cz, cx, c.min[1], cz, ux, 0, uz);
        Matrix.orthoM(p, 0, -half, half, -half, half, .1f, eyeY - c.min[1] + 5);
        renderer.drawPoints(v, p, 2.5f*(eyeY - sa[1]), new float[3], 0, 1f);
        Matrix.multiplyMM(mvp2, 0, p, 0, v, 0);
        renderer.drawShape(mvp2, new float[]{sa[0], sa[1], sa[2], sb[0], sb[1], sb[2]}, 6, GLES20.GL_LINES, 1f, 1f, 1f, 1);
        renderer.drawShape(mvp2, sa, 3, GLES20.GL_POINTS, .2f, 1f, .4f, dp(aimTarget == 1 ? 16 : 10));
        renderer.drawShape(mvp2, sb, 3, GLES20.GL_POINTS, .3f, .6f, 1f, dp(aimTarget == 2 ? 16 : 10));
        Matrix.setIdentityM(m, 0);
        renderer.drawShape(m, new float[]{-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0}, 12, GLES20.GL_LINE_LOOP, .6f, .7f, .8f, 1);
        GLES20.glViewport(viewX, viewY, viewW, viewH);
    }
    private void ring(float[] mvp, float[] c, float rad, float r, float g, float b) {
        final int seg = 32; float[] v = new float[seg*3];
        for (int i = 0; i < seg; i++) { double t = 2*Math.PI*i/seg; v[i*3] = c[0] + (float)Math.cos(t)*rad; v[i*3+1] = c[1] + .005f; v[i*3+2] = c[2] + (float)Math.sin(t)*rad; }
        renderer.drawShape(mvp, v, v.length, GLES20.GL_LINE_LOOP, r, g, b, 1);
    }

    // ---------------------------------------------------------------------------------- walking test (GL thread)
    private static float[] dirXf(float[] m, float[] v) { return new float[]{m[0]*v[0] + m[4]*v[1] + m[8]*v[2], m[1]*v[0] + m[5]*v[1] + m[9]*v[2], m[2]*v[0] + m[6]*v[1] + m[10]*v[2]}; }
    /** Horizontal walking direction in the scan frame (x,z unit). Uses the top edge of the phone when the camera points at the floor. */
    private float[] heading(Camera camera) {
        Pose dp = camera.getDisplayOrientedPose();
        float[] z = dp.getZAxis(), y = dp.getYAxis();
        float[] f = dirXf(sFromWorld, new float[]{-z[0], -z[1], -z[2]});
        float len = (float)Math.sqrt(f[0]*f[0] + f[1]*f[1] + f[2]*f[2]), hz = (float)Math.hypot(f[0], f[2]);
        if (hz < .5f*len) { float[] t = dirXf(sFromWorld, y); float sg = f[1] < 0 ? 1 : -1; f = new float[]{t[0]*sg, t[1]*sg, t[2]*sg}; hz = (float)Math.hypot(f[0], f[2]); }
        return hz < 1e-6f ? new float[]{0, -1} : new float[]{f[0]/hz, f[2]/hz};
    }
    private void walkTwin(Camera camera) {
        ObstacleMap om = obstacles; float sc = scale; float[] p = camS;
        if (om == null || p == null) {
            feedback.update(true, 0, false, -1, Float.POSITIVE_INFINITY); hudNear = hudAhead = Float.POSITIVE_INFINITY; hudDeadEnd = false;
            hudDist = Float.POSITIVE_INFINITY; hudIntensity = 0; hudObj = -1; hudContact = false; nearOn = false; activeObj = -1; return;
        }
        float[] h = heading(camera), out = new float[2];
        float near = om.nearest(p[0], p[2], walkRange/sc, out)*sc;
        float ahead = om.ahead(p[0], p[2], h[0], h[1], lookAhead/sc, bodyHalf/sc)*sc;
        float left = om.ahead(p[0], p[2], h[1], -h[0], 1f/sc, bodyHalf/sc)*sc, right = om.ahead(p[0], p[2], -h[1], h[0], 1f/sc, bodyHalf/sc)*sc;
        boolean deadEnd = ahead < lookAhead && left < 1f && right < 1f;
        float ct = Math.min(walkContact, walkRange*.9f), ca = Math.min(walkContact, lookAhead*.9f);
        float aroundI = near >= walkRange ? 0 : Math.max(0, Math.min(1, (walkRange - near)/(walkRange - ct)));
        float aheadI = ahead >= lookAhead ? 0 : Math.max(0, Math.min(1, (lookAhead - ahead)/(lookAhead - ca)));
        if (deadEnd) aheadI = Math.max(aheadI, .5f);
        float intensity = Math.max(aroundI, aheadI);
        boolean contact = near <= ct || ahead <= ca, pulse = aheadI > 0 && aheadI >= aroundI;
        int obj = -1; float dist = Math.min(near, ahead);
        if (intensity > 0) {
            if (pulse) { nearS[0] = p[0] + h[0]*ahead/sc; nearS[2] = p[2] + h[1]*ahead/sc; } else { nearS[0] = out[0]; nearS[2] = out[1]; }
            nearS[1] = p[1];
            obj = aiAt(nearS[0], nearS[1], nearS[2], false);
        }
        nearOn = obj >= 0; activeObj = obj;
        feedback.update(true, intensity, contact, obj, dist, pulse);
        hudNear = near; hudAhead = ahead; hudDeadEnd = deadEnd;
        hudDist = dist; hudIntensity = intensity; hudObj = obj; hudContact = contact;
    }
    /** 100+index of the recognised object containing the point (horizontal only when !full3d), else 0 (plain surface). */
    private int aiAt(float x, float y, float z, boolean full3d) {
        List<AiObjects.Item> l = aiCache; float pad = .1f/scale;
        for (int i = 0; i < l.size(); i++) {
            AiObjects.Item it = l.get(i); float dx = x - it.x, dz = z - it.z, dy = full3d ? y - it.y : 0;
            if (Math.sqrt(dx*dx + dy*dy + dz*dz) < it.r + pad) return 100 + i;
        }
        return 0;
    }

    private ObstacleMap buildObstacles(ScanLoader.Cloud c) {
        float[] a; synchronized (data) { a = scanA; }
        float sc = scale, fy = a != null ? a[1] : ObstacleMap.estimateFloor(c.xyz, c.n, c.min[1], c.max[1]);
        return ObstacleMap.build(c.xyz, c.n, c.min, c.max, fy, .12f/sc, obstacleTop/sc, .05f/sc, 3);
    }
    private void rebuildObstacles() {
        final ScanLoader.Cloud c = cloud; if (c == null) return;
        final int gen = ++obstacleGen;
        new Thread(() -> { ObstacleMap om = buildObstacles(c); if (gen == obstacleGen && cloud == c) obstacles = om; }, "obstacles").start();
    }

    // ---------------------------------------------------------------------------------- AI recognition
    private static byte[] bytes(ByteBuffer b) { ByteBuffer d = b.duplicate(); d.rewind(); byte[] o = new byte[d.remaining()]; d.get(o); return o; }

    /** GL thread: hands the current camera image to the detector (about 1.5 per second). liveShift != null while scanning. */
    private void maybeDetect(Frame frame, Camera camera, float[] liveShift) {
        long now = SystemClock.uptimeMillis();
        if (!aiOn || now - lastDetect < 700 || !detector.available()) return;
        Image img = null;
        try {
            img = frame.acquireCameraImage();
            Detector.Job j = new Detector.Job();
            j.w = img.getWidth(); j.h = img.getHeight();
            Image.Plane[] pl = img.getPlanes();
            j.y = bytes(pl[0].getBuffer()); j.yRow = pl[0].getRowStride(); j.yPix = pl[0].getPixelStride();
            j.u = bytes(pl[1].getBuffer()); j.v = bytes(pl[2].getBuffer()); j.uvRow = pl[1].getRowStride(); j.uvPix = pl[1].getPixelStride();
            CameraIntrinsics in = camera.getImageIntrinsics();
            float[] fl = in.getFocalLength(), pp = in.getPrincipalPoint(); int[] dim = in.getImageDimensions();
            float sx = j.w/(float)dim[0], sy = j.h/(float)dim[1];
            j.fx = fl[0]*sx; j.fy = fl[1]*sy; j.cx = pp[0]*sx; j.cy = pp[1]*sy;
            float[] m = new float[16]; camera.getPose().toMatrix(m, 0);
            if (liveShift != null) { m[12] -= liveShift[0]; m[13] -= liveShift[1]; m[14] -= liveShift[2]; j.camToS = m; }
            else { float[] o = new float[16]; Matrix.multiplyMM(o, 0, sFromWorld, 0, m, 0); j.camToS = o; }
            int display = 90*getWindowManager().getDefaultDisplay().getRotation();
            j.rotation = ((sensorRotation - display) % 360 + 360) % 360;
            j.pending = liveShift != null;
            lastDetect = now; detector.submit(j);
        } catch (NotYetAvailableException ignored) {
        } catch (Exception e) { lastDetect = now;
        } finally { if (img != null) img.close(); }
    }

    /** Detector thread. */
    private void onDetections(Detector.Job j, List<Detector.Obs> obs) {
        List<Detector.Obs> keep = new ArrayList<>();
        for (Detector.Obs o : obs) if (!(aiSkipPerson && "person".equals(o.label))) keep.add(o);
        if (keep.isEmpty()) return;
        if (j.pending) { synchronized (pendingObs) { if (scanning && pendingObs.size() < 5000) pendingObs.addAll(keep); } return; }
        SurfaceIndex idx = index; if (idx == null) return;
        float ft = floorY() + .08f/scale; boolean changed = false;
        for (Detector.Obs o : keep) if (resolveObs(o, idx, ft, scale)) { changed = true; note = "AI 인식: " + AiObjects.korean(o.label) + " 추가"; }
        if (changed) { refreshAi(); saveScanData(); }
    }

    /** Intersects the detection's rays with the scan; the median hit becomes one observation. True if it confirmed a new object. */
    private boolean resolveObs(Detector.Obs o, SurfaceIndex idx, float floorTop, float sc) {
        int n = o.rays.length/6; float[] ts = new float[n], hx = new float[n], hy = new float[n], hz = new float[n]; float[] hit = new float[3]; int k = 0;
        for (int i = 0; i < n; i++) {
            float[] r = o.rays; int b = i*6;
            float t = idx.raycast(r[b], r[b+1], r[b+2], r[b+3], r[b+4], r[b+5], .25f/sc, 8f/sc, hit);
            if (Float.isInfinite(t) || hit[1] < floorTop) continue;
            ts[k] = t; hx[k] = hit[0]; hy[k] = hit[1]; hz[k] = hit[2]; k++;
        }
        if (k == 0) return false;
        Integer[] order = new Integer[k]; for (int i = 0; i < k; i++) order[i] = i;
        final float[] tt = ts; Arrays.sort(order, (x, y) -> Float.compare(tt[x], tt[y]));
        int m = order[k/2];
        float width = o.angle*ts[m]*sc, r = Math.max(.15f, Math.min(1.2f, width*.5f))/sc;
        return ai.observe(o.label, hx[m], hy[m], hz[m], r, .6f/sc);
    }
    private void refreshAi() { aiCache = ai.confirmed(); }

    // ---------------------------------------------------------------------------------- object sounds
    private void rebuildSoundFiles() {
        Map<String, File> m = new HashMap<>(); File[] fs = soundDir.listFiles();
        if (fs != null) for (File f : fs) { String n = f.getName(); int dot = n.lastIndexOf('.'); m.put(dot < 0 ? n : n.substring(0, dot), f); }
        soundFiles = m;
    }
    private File soundFor(String label) {
        Map<String, File> m = soundFiles; File f = m.get(AiObjects.fileKey(label));
        if (f == null) f = m.get("default");
        return f != null ? f : beaconFile.exists() ? beaconFile : null;
    }
    /** GL thread, 10 Hz: the 3 nearest recognised objects within range play their sound. */
    private void updateSounds(Camera camera) {
        long now = SystemClock.uptimeMillis(); if (now - lastSound < 100) return; lastSound = now;
        List<AiObjects.Item> l = aiCache; float[] p = camS;
        if (!soundOn || !valid || !walkMode || p == null || l.isEmpty()) { sound.update(Collections.<SpatialSound.Src>emptyList()); return; }
        float[] h = heading(camera); float sc = scale;
        List<float[]> near = new ArrayList<>();
        for (int i = 0; i < l.size(); i++) {
            AiObjects.Item it = l.get(i); float dx = it.x - p[0], dz = it.z - p[2], len = (float)Math.hypot(dx, dz);
            float d = Math.max(0, len - it.r)*sc;
            if (d < soundRange) near.add(new float[]{d, i, len < 1e-4f ? 1 : (dx*h[0] + dz*h[1])/len, len < 1e-4f ? 0 : (-dx*h[1] + dz*h[0])/len});
        }
        Collections.sort(near, (x, y) -> Float.compare(x[0], y[0]));
        List<SpatialSound.Src> out = new ArrayList<>();
        for (int k = 0; k < Math.min(3, near.size()); k++) {
            float[] e = near.get(k); File f = soundFor(l.get((int)e[1]).label); if (f == null) continue;
            float[] g = SpatialSound.gains(e[0], soundRange, .5f, e[2], e[3]);
            out.add(new SpatialSound.Src((int)e[1], f, g[0], g[1]));
        }
        sound.update(out);
    }

    // ---------------------------------------------------------------------------------- AI list + sound files (UI thread)
    private void refreshAiList() {
        List<AiObjects.Item> l = aiCache; Map<String, Integer> count = new LinkedHashMap<>();
        for (AiObjects.Item it : l) count.put(it.label, count.containsKey(it.label) ? count.get(it.label) + 1 : 1);
        StringBuilder sig = new StringBuilder();
        for (Map.Entry<String, Integer> e : count.entrySet()) sig.append(e.getKey()).append(e.getValue()).append(prefs.getString("sound_" + AiObjects.fileKey(e.getKey()), "")).append(';');
        sig.append(prefs.getString("sound_default", ""));
        if (sig.toString().equals(aiSig)) return;
        aiSig = sig.toString(); aiList.removeAllViews();
        if (count.isEmpty()) aiList.addView(label("인식된 사물 없음 · 스캔하거나 걷기 테스트 중에 사물을 비추면 자동으로 추가됩니다", 12));
        for (Map.Entry<String, Integer> e : count.entrySet()) {
            final String lab = e.getKey(); String snd = prefs.getString("sound_" + AiObjects.fileKey(lab), "");
            TextView t = label(AiObjects.korean(lab) + " ×" + e.getValue() + "\n소리: " + (snd.isEmpty() ? "기본" : snd), 12);
            LinearLayout r = new LinearLayout(this); r.setGravity(Gravity.CENTER_VERTICAL);
            r.addView(t, new LinearLayout.LayoutParams(0, -2, 2));
            r.addView(button("소리 지정", v -> pickSound(lab)), new LinearLayout.LayoutParams(0, -2, 1));
            r.addView(button("삭제", v -> { ai.removeLabel(lab); refreshAi(); saveScanData(); refreshPanel(); }), new LinearLayout.LayoutParams(0, -2, 1));
            aiList.addView(r);
        }
        String def = prefs.getString("sound_default", "");
        aiList.addView(label("기본 소리: " + (def.isEmpty() ? "내장 신호음" : def), 12));
    }
    private void chooseLabelForSound() {
        String[] names = new String[AiObjects.LABELS.length];
        for (int i = 0; i < names.length; i++) {
            String snd = prefs.getString("sound_" + AiObjects.fileKey(AiObjects.LABELS[i]), "");
            names[i] = AiObjects.korean(AiObjects.LABELS[i]) + " (" + AiObjects.LABELS[i] + ")" + (snd.isEmpty() ? "" : " ♪ " + snd);
        }
        new AlertDialog.Builder(this).setTitle("소리를 지정할 사물").setItems(names, (d, which) -> pickSound(AiObjects.LABELS[which])).setNegativeButton("닫기", null).show();
    }
    private void pickSound(String label) {
        pendingSoundLabel = label;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("audio/*");
        startActivityForResult(i, REQ_SOUND);
    }
    private void importSound(String label, Uri u) {
        String name = displayName(u), key = label.equals("default") ? "default" : AiObjects.fileKey(label);
        int dot = name.lastIndexOf('.'); String ext = dot < 0 ? "snd" : name.substring(dot + 1).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        new Thread(() -> {
            File[] old = soundDir.listFiles();
            if (old != null) for (File f : old) if (f.getName().startsWith(key + ".")) f.delete();
            File dst = new File(soundDir, key + "." + (ext.isEmpty() ? "snd" : ext));
            try (InputStream in = getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(dst)) {
                byte[] buf = new byte[1 << 16]; for (int k; (k = in.read(buf)) > 0; ) out.write(buf, 0, k);
                prefs.edit().putString("sound_" + key, name).apply();
                rebuildSoundFiles();
                toastNote((key.equals("default") ? "기본 소리" : AiObjects.korean(label) + " 소리") + " 지정됨: " + name);
            } catch (Exception e) { toastNote("소리 파일을 읽지 못했습니다: " + e.getMessage()); }
        }, "sound-import").start();
    }

    // ---------------------------------------------------------------------------------- Windows packet (unchanged v1 pose + haptic)
    private float[] ue(float[] ar) { return new float[]{-ar[2], ar[0], ar[1]}; }
    private JSONArray array(float[] v) throws JSONException { JSONArray a = new JSONArray(); for (float x : v) a.put((double)x); return a; }
    private String packet(boolean ok, String reason, float[] p, float[] f, float[] u) {
        try {
            JSONObject j = new JSONObject(); j.put("v", 1); j.put("type", "pose"); j.put("session", sessionId); j.put("epoch", epoch); j.put("seq", ++seq);
            j.put("t_ns", SystemClock.elapsedRealtimeNanos()); j.put("frame_age_ms", 0); j.put("valid", ok); j.put("reason", reason);
            j.put("p", array(p)); j.put("forward", array(f)); j.put("up", array(u));
            float d = hudDist;
            j.put("haptic", new JSONObject().put("i", (double)hudIntensity).put("contact", hudContact).put("obj", hudObj).put("d", Float.isInfinite(d) ? -1 : (double)d));
            return j.toString();
        } catch (JSONException e) { return "{}"; }
    }
}
