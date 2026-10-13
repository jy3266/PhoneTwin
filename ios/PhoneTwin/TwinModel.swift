import Foundation
import ARKit
import AVFoundation
import SceneKit
import SwiftUI
import UIKit
import simd

enum ViewMode: Int { case twin = 0, ar = 1, orbit = 2 }

/// Phone Twin v4 for iPhone: the scan of the room lives on the phone as a point cloud, the ARKit pose is
/// aligned to it with two floor points, and the walking test drives vibration, object sounds, the ESP32
/// wristband and the Unreal link. Port of the Android MainActivity; the AR work runs on `arQueue`
/// (the ARSession delegate queue), the UI on the main thread.
final class TwinModel: NSObject, ObservableObject, ARSessionDelegate {
    static let liveCap = 800_000

    // ---- published UI state (main thread)
    @Published var viewMode: ViewMode = .orbit
    @Published var scanningUI = false
    @Published var aimTarget = 0                 // 0 off, 1 A, 2 B
    @Published var walkUI = false
    @Published var pickMode = 0                  // 0 none, 1 scan A, 2 scan B
    @Published var showSettings = false
    @Published var status = "AR 시작 중"
    @Published var hud = ""
    @Published var floorHitUI = false
    @Published var scanInfo = "스캔 없음"
    @Published var alignInfo = ""
    @Published var liveInfo = ""
    @Published var camInfo = ""
    @Published var ghStatus = "업로드 전"
    @Published var uploading = false
    @Published var unrealInfo = ""
    @Published var espInfo = ""
    @Published var soundInfo = ""
    @Published var aiItems: [ScanData.Ai] = []
    @Published var ghChoices: GhChoices?
    @Published var hasCloud = false
    @Published var imageAspect: CGFloat = 0.75     // camera image width/height in portrait (1440/1920 on LiDAR iPhones)

    struct GhChoices: Identifiable { let id = UUID(); let entries: [GitHub.Entry]; let current: String }

    let session = ARSession()
    let scene = TwinScene()
    let unreal = UnrealLink()
    let feedback = Feedback()
    let sounds = ObjectSounds()
    let lidar = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    let arSupported = ARWorldTrackingConfiguration.isSupported
    private let arQueue = DispatchQueue(label: "ar-frames", qos: .userInteractive)
    private let sceneState = Locked(SceneState())
    private var displayLink: CADisplayLink?

    // ---- files
    private let appDir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PhoneTwin", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private var scanFile: URL { appDir.appendingPathComponent("scan_current") }
    private var soundDir: URL { appDir.appendingPathComponent("sounds", isDirectory: true) }
    private var beaconFile: URL { appDir.appendingPathComponent("builtin_beacon.wav") }
    private let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private let soundFiles = Locked<[String: URL]>([:])

    // ---- AR-thread state (arQueue only)
    private var cloud: ScanCloud?
    private var obstacles: ObstacleMap?
    private var obstacleGen = 0
    private var data = ScanData()
    private var realA: UUID?, realB: UUID?
    private var liveAlign: simd_float4x4?          // right after a scan without A/B: scan frame = world shifted
    private var worldFromS = matrix_identity_float4x4, sFromWorld = matrix_identity_float4x4
    private var aligned = false, valid = false, scale: Float = 1
    private var alignText = "정렬 전"
    private var tracking = false
    private var arView: ViewMode = .orbit, aim = 0, walkMode = false, realRequest = 0
    private var scanning = false, live: LiveScan?, scanNote = ""
    private var lastIntegrate: CFTimeInterval = 0, integrateCost: CFTimeInterval = 0, lastChunk: CFTimeInterval = 0
    private var lastPose: (SIMD3<Float>, simd_quatf, CFTimeInterval)?
    private var camS: SIMD3<Float>?, camFwdS: SIMD3<Float>?
    private var hudNear = Float.infinity, hudAhead = Float.infinity, hudDeadEnd = false
    private var hudDist = Float.infinity, hudIntensity: Float = 0, hudObj = -1, hudContact = false
    private var uePose = LinkProtocol.Pose()
    private var lastUi: CFTimeInterval = 0, lastSound: CFTimeInterval = 0
    private var note = "스캔 파일을 열고 정렬하세요"
    private var floorHit = false
    private var aspectKnown = false
    private var aiCache: [ScanData.Ai] { data.ai.filter { ($0.hits ?? AiLabels.confirm) >= AiLabels.confirm } }

    override init() {
        super.init()
        feedback.remote = unreal
        session.delegate = self
        session.delegateQueue = arQueue
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        try? FileManager.default.createDirectory(at: soundDir, withIntermediateDirectories: true)
        DispatchQueue.global(qos: .utility).async { [self] in
            if !FileManager.default.fileExists(atPath: beaconFile.path) { try? ObjectSounds.writeBeacon(to: beaconFile) }
            rebuildSoundFiles()
        }
        camInfo = arSupported ? "ARKit은 메인(광각) 카메라로만 위치를 추적합니다 (초광각 렌즈는 ARKit에서 쓸 수 없음). 대신 스캔 중에는 영상을 자르지 않고 전체 화각을 보여 줍니다." : ""
        let link = CADisplayLink(target: self, selector: #selector(frameTick))
        link.preferredFramesPerSecond = 30; link.add(to: .main, forMode: .common); displayLink = link
        let saved = Prefs.scanData
        arQueue.async { [self] in data = saved; publishAi() }
        if FileManager.default.fileExists(atPath: scanFile.path) { loadScan() }
        startAR()
    }

    // ------------------------------------------------------------------ lifecycle
    private func configuration(depth: Bool) -> ARWorldTrackingConfiguration {
        let c = ARWorldTrackingConfiguration()
        c.planeDetection = [.horizontal]
        c.isAutoFocusEnabled = true
        if depth && lidar { c.frameSemantics.insert(.sceneDepth) }
        return c
    }

    func startAR() {
        guard arSupported else { status = "이 기기는 ARKit을 지원하지 않습니다 (스캔 보기만 가능)"; return }
        session.run(configuration(depth: false))
    }

    func setActive(_ on: Bool) {
        feedback.setPaused(!on); sounds.setPaused(!on)
    }

    @objc private func frameTick() {
        scene.apply(sceneState.value)
    }

    // ------------------------------------------------------------------ UI actions (main thread)
    func setView(_ v: ViewMode) {
        var v = v
        if aimTarget != 0 && v != .ar { flash("A·B 조준 중에는 카메라 화면을 씁니다 · 취소를 누르면 돌아갑니다"); v = .ar }
        if scanningUI && v != .ar { flash("스캔 중에는 AR 화면만 사용합니다 · 완료·저장 또는 취소를 누르세요"); v = .ar }
        viewMode = v
        arQueue.async { [self] in arView = v }
    }

    func enterAim(_ which: Int) {
        guard arSupported else { flash("AR이 실행 중이 아닙니다"); return }
        aimTarget = which; showSettings = false; setView(.ar)
        arQueue.async { [self] in aim = which }
    }
    func exitAim() { aimTarget = 0; arQueue.async { [self] in aim = 0 } }
    func recordAim() { let a = aimTarget; arQueue.async { [self] in realRequest = a } }

    func setWalk(_ on: Bool) {
        arQueue.async { [self] in
            if on && cloud == nil { note = "먼저 스캔하거나 스캔 파일을 여세요"; return }
            if on && scanning { note = "스캔을 마친 뒤 걷기 테스트를 시작하세요"; return }
            walkMode = on
            if on && obstacles == nil { rebuildObstacles() }
            note = on ? (aligned ? "걷기 테스트 시작 · 휴대폰을 들고 천천히 걸어 보세요" : "걷기 테스트 · 먼저 정렬이 필요합니다 (스캔 A·B, 현장 A·B)")
                : "걷기 테스트 종료 · 진동·소리·ESP32·언리얼 연동을 멈췄습니다"
            DispatchQueue.main.async { [self] in
                walkUI = on
                if on { showSettings = false; if viewMode == .orbit { setView(.ar) } }
            }
        }
    }

    func startPick(_ mode: Int) {
        guard hasCloud else { flash("먼저 스캔 파일을 여세요"); return }
        pickMode = mode; showSettings = false; setView(.orbit)
        flash(mode == 1 ? "3인칭 지도에서 바닥의 A 지점을 탭하세요" : "3인칭 지도에서 바닥의 B 지점을 탭하세요")
    }

    /// 1 start, 2 finish + save, 3 cancel
    func requestScan(_ which: Int) {
        guard arSupported else { flash("AR이 실행 중이 아닙니다"); return }
        if which == 1 { showSettings = false; walkUI = false }
        arQueue.async { [self] in handleScanRequest(which) }
    }

    private func flash(_ s: String) { arQueue.async { [self] in note = s; lastUi = 0 } }

    // ------------------------------------------------------------------ orbit picking (main thread)
    /// Nearest-to-camera cloud point within ~28 pt of the tap, in the scan frame.
    func pick(at p: CGPoint, in view: SCNView) {
        let mode = pickMode
        guard mode != 0 else { return }
        arQueue.async { [self] in
            guard let c = cloud else { return }
            DispatchQueue.main.async { [self] in
                let near = view.unprojectPoint(SCNVector3(Float(p.x), Float(p.y), 0)), far = view.unprojectPoint(SCNVector3(Float(p.x), Float(p.y), 1))
                let o = SIMD3<Float>(near.x, near.y, near.z), d = simd_normalize(SIMD3<Float>(far.x - near.x, far.y - near.y, far.z - near.z))
                let fov = Float(scene.orbitCamera.camera?.fieldOfView ?? 60)*Float.pi/180
                let tol = tan(fov/2)*2*28/Float(max(1, view.bounds.height))    // 28 pt as a slope
                var best = -1, bestT = Float.greatestFiniteMagnitude
                for i in 0..<c.n {
                    let v = c.point(i) - o, t = simd_dot(v, d)
                    if t <= 0.01 || t >= bestT { continue }
                    if simd_length_squared(v - d*t) <= (tol*t)*(tol*t) { best = i; bestT = t }
                }
                if best < 0 { flash("그 위치에 스캔 점이 없습니다 · 점 위를 탭하세요"); return }
                let q = c.point(best)
                pickMode = 0
                arQueue.async { [self] in
                    if mode == 1 { data.a = ScanData.arr(q) } else { data.b = ScanData.arr(q) }
                    saveScanData(); note = mode == 1 ? "스캔 A 지정됨" : "스캔 B 지정됨"
                }
            }
        }
    }

    // ------------------------------------------------------------------ ARSessionDelegate (arQueue)
    func session(_ session: ARSession, didFailWithError error: Error) {
        note = "AR 오류: \(error.localizedDescription)"
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let cam = frame.camera
        if !aspectKnown {
            aspectKnown = true
            let r = cam.imageResolution, a = min(r.width, r.height)/max(r.width, r.height)
            DispatchQueue.main.async { [self] in imageAspect = a }
        }
        var reason = "TRACKING"
        switch cam.trackingState {
        case .normal: tracking = true
        case .notAvailable: tracking = false; reason = "추적 불가"
        case .limited(let r):
            tracking = false
            switch r {
            case .initializing: reason = "초기화 중 · 주변을 천천히 비추세요"
            case .relocalizing: reason = "위치 다시 찾는 중"
            case .excessiveMotion: reason = "너무 빠르게 움직임"
            case .insufficientFeatures: reason = "특징이 부족함 · 밝고 무늬 있는 곳을 비추세요"
            @unknown default: reason = "추적 제한"
            }
        }
        var hit: SIMD3<Float>?
        if tracking && (arView == .ar || aim != 0 || realRequest != 0) { hit = floorHitTest(frame) }
        floorHit = hit != nil
        if realRequest != 0 {
            let req = realRequest; realRequest = 0
            if let h = hit {
                let anchor = ARAnchor(name: req == 1 ? "realA" : "realB", transform: Alignment.translation(h))
                session.add(anchor: anchor)
                if req == 1 { if let old = anchorFor(realA, frame) { session.remove(anchor: old) }; realA = anchor.identifier }
                else { if let old = anchorFor(realB, frame) { session.remove(anchor: old) }; realB = anchor.identifier }
                note = req == 1 ? "현장 A 기록됨" : "현장 B 기록됨"
                aim = 0
                DispatchQueue.main.async { [self] in aimTarget = 0 }
            } else { note = "바닥 평면이 아직 인식되지 않았습니다 · 바닥을 천천히 비춘 뒤 십자선이 초록일 때 기록" }
        }
        let ra = anchorFor(realA, frame)?.transform.position, rb = anchorFor(realB, frame)?.transform.position

        if scanning {
            valid = false; feedback.update(LinkProtocol.Haptic())
            if tracking { integrate(frame) }
            pushLiveChunk()
            sendUnreal(frame)
            publishScene(realA: ra, realB: rb, aimHit: hit)
            uiTick(tracking ? "SCANNING" : reason)
            return
        }
        align(ra, rb)
        twin(frame)
        sendUnreal(frame)
        updateSounds(frame)
        publishScene(realA: ra, realB: rb, aimHit: hit)
        uiTick(!tracking ? reason : !aligned ? "ALIGN_NEEDED" : "TRACKING")
    }

    private func anchorFor(_ id: UUID?, _ frame: ARFrame) -> ARAnchor? {
        guard let id = id else { return nil }
        return frame.anchors.first { $0.identifier == id }
    }

    private func floorHitTest(_ frame: ARFrame) -> SIMD3<Float>? {
        let q = frame.raycastQuery(from: CGPoint(x: 0.5, y: 0.5), allowing: .existingPlaneGeometry, alignment: .horizontal)
        return session.raycast(q).first?.worldTransform.position
    }

    private func publishScene(realA: SIMD3<Float>?, realB: SIMD3<Float>?, aimHit: SIMD3<Float>?) {
        var s = SceneState()
        s.worldFromS = aligned && tracking && !scanning ? worldFromS : nil
        s.twinView = arView == .twin
        s.realA = realA; s.realB = realB
        s.aim = aim != 0 ? aimHit : nil; s.aimIsA = aim == 1
        s.camS = valid ? camS : nil; s.camFwdS = valid ? camFwdS : nil
        s.intensity = hudIntensity; s.hot = hudObj
        s.scanA = data.scanA; s.scanB = data.scanB
        s.ai = aiCache; s.placed = data.objects
        sceneState.value = s
    }

    // ------------------------------------------------------------------ alignment (arQueue)
    private func align(_ ra: SIMD3<Float>?, _ rb: SIMD3<Float>?) {
        let sa = data.scanA, sb = data.scanB
        if let m = liveAlign, sa == nil || sb == nil || ra == nil || rb == nil {   // keep the post-scan alignment
            worldFromS = m; sFromWorld = m.inverse; scale = 1; aligned = true; return
        }
        guard cloud != nil, let sa = sa, let sb = sb, let ra = ra, let rb = rb else {
            aligned = false
            alignText = cloud == nil ? "스캔을 먼저 여세요" : "정렬 전 · 네 지점(스캔 A·B, 현장 A·B)이 모두 필요합니다"
            return
        }
        let realD = Alignment.horizontal(ra, rb), scanD = Alignment.horizontal(sa, sb)
        if realD < 0.5 || scanD < 0.05 { aligned = false; alignText = "A–B 간격이 너무 짧습니다 (0.5m 이상, 가능하면 2m 이상)"; return }
        let useScale = Prefs.useScale, s = useScale ? realD/scanD : 1
        guard let wl = Alignment.worldFromLocal(ra, rb), let ls = Alignment.scanToLocal(sa, sb, scale: s) else { aligned = false; return }
        worldFromS = wl*ls; sFromWorld = worldFromS.inverse; scale = s; aligned = true; liveAlign = nil
        let diff = (realD/scanD - 1)*100
        alignText = String(format: "정렬 완료 · 스캔 A–B %.2f / 현장 %.2f m · 차이 %+.1f%%", scanD, realD, diff)
            + (useScale ? String(format: " → 스케일 %.3f 적용", s) : abs(diff) > 3 ? "\n차이가 큽니다: 지점 재확인 또는 스케일 보정 사용" : "")
    }

    // ------------------------------------------------------------------ twin + walking test (arQueue)
    private func resetHud() {
        hudNear = .infinity; hudAhead = .infinity; hudDeadEnd = false; hudDist = .infinity; hudIntensity = 0; hudObj = -1; hudContact = false
    }

    private func twin(_ frame: ARFrame) {
        valid = tracking && aligned
        guard valid else { feedback.update(LinkProtocol.Haptic()); resetHud(); camS = nil; return }
        let t = frame.camera.transform
        let fwd = -SIMD3(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        camS = sFromWorld.point(t.position); camFwdS = sFromWorld.point(t.position + fwd*0.4)
        if walkMode { walkTwin(frame); return }
        // Everything (vibration, sound, ESP32, Unreal) starts only with "걷기 테스트 시작".
        feedback.update(LinkProtocol.Haptic()); resetHud()
    }

    /// Display-oriented camera pose (portrait): x = screen right, y = screen up, -z = into the screen.
    private func displayPose(_ frame: ARFrame) -> simd_float4x4 { frame.camera.viewMatrix(for: .portrait).inverse }

    /// Horizontal walking direction in the scan frame (x,z unit). Uses the top edge of the phone when the camera points at the floor.
    private func heading(_ frame: ARFrame) -> SIMD2<Float> {
        let d = displayPose(frame)
        let z = SIMD3(d.columns.2.x, d.columns.2.y, d.columns.2.z), y = SIMD3(d.columns.1.x, d.columns.1.y, d.columns.1.z)
        var f = sFromWorld.direction(-z)
        let len = simd_length(f); var hz = hypot(f.x, f.z)
        if hz < 0.5*len { let u = sFromWorld.direction(y); f = u*(f.y < 0 ? 1 : -1); hz = hypot(f.x, f.z) }
        return hz < 1e-6 ? SIMD2(0, -1) : SIMD2(f.x/hz, f.z/hz)
    }

    private func walkTwin(_ frame: ARFrame) {
        guard let om = obstacles, let p = camS else { feedback.update(LinkProtocol.Haptic(valid: true)); resetHud(); return }
        let sc = scale, walkRange = Prefs.walkRange, lookAhead = Prefs.lookAhead, bodyHalf = Prefs.bodyHalf, walkContact = Prefs.walkContact
        let h = heading(frame)
        let (n0, out) = om.nearest(p.x, p.z, maxR: walkRange/sc)
        let near = n0*sc
        let ahead = om.ahead(p.x, p.z, h.x, h.y, maxDist: lookAhead/sc, halfWidth: bodyHalf/sc)*sc
        let left = om.ahead(p.x, p.z, h.y, -h.x, maxDist: 1/sc, halfWidth: bodyHalf/sc)*sc, right = om.ahead(p.x, p.z, -h.y, h.x, maxDist: 1/sc, halfWidth: bodyHalf/sc)*sc
        let deadEnd = ahead < lookAhead && left < 1 && right < 1
        let ct = min(walkContact, walkRange*0.9), ca = min(walkContact, lookAhead*0.9)
        let aroundI: Float = near >= walkRange ? 0 : max(0, min(1, (walkRange - near)/(walkRange - ct)))
        var aheadI: Float = ahead >= lookAhead ? 0 : max(0, min(1, (lookAhead - ahead)/(lookAhead - ca)))
        if deadEnd { aheadI = max(aheadI, 0.5) }
        let intensity = max(aroundI, aheadI)
        let contact = near <= ct || ahead <= ca, pulse = aheadI > 0 && aheadI >= aroundI
        var obj = -1; let dist = min(near, ahead)
        if intensity > 0 {
            let q = pulse ? SIMD3(p.x + h.x*ahead/sc, p.y, p.z + h.y*ahead/sc) : SIMD3(out.x, p.y, out.y)
            obj = aiAt(q)
        }
        feedback.update(LinkProtocol.Haptic(valid: true, intensity: intensity, contact: contact, object: obj, distance: dist), pulse: pulse)
        hudNear = near; hudAhead = ahead; hudDeadEnd = deadEnd
        hudDist = dist; hudIntensity = intensity; hudObj = obj; hudContact = contact
    }

    /// 100+index of the recognised object containing the point (horizontally), else 0 (plain surface).
    private func aiAt(_ q: SIMD3<Float>) -> Int {
        let pad = 0.1/scale
        for (i, it) in aiCache.enumerated() {
            guard let c = ScanData.vec(it.c) else { continue }
            if hypot(q.x - c.x, q.z - c.z) < it.r + pad { return 100 + i }
        }
        return 0
    }

    private static func buildObstacles(_ c: ScanCloud, floorY: Float?, scale sc: Float) -> ObstacleMap {
        let fy = floorY ?? ObstacleMap.estimateFloor(c)
        return ObstacleMap.build(c, floorY: fy, lo: 0.12/sc, hi: Prefs.obstacleTop/sc, cell: 0.05/sc, minCount: 3)
    }
    /// arQueue: builds the walking-test map in the background.
    private func rebuildObstacles() {
        guard let c = cloud else { return }
        obstacleGen += 1
        let gen = obstacleGen, fy = data.scanA?.y, sc = scale
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let om = TwinModel.buildObstacles(c, floorY: fy, scale: sc)
            arQueue.async { [self] in if gen == obstacleGen && cloud === c { obstacles = om } }
        }
    }
    func rebuildObstaclesFromUI() { arQueue.async { [self] in rebuildObstacles() } }

    // ------------------------------------------------------------------ Unreal + sounds (arQueue)
    private func sendUnreal(_ frame: ARFrame) {
        guard unreal.running else { return }
        let ok = valid && !scanning && camS != nil, walk = ok && walkMode
        if ok, let p = camS {
            let d = displayPose(frame)
            let z = SIMD3(d.columns.2.x, d.columns.2.y, d.columns.2.z), y = SIMD3(d.columns.1.x, d.columns.1.y, d.columns.1.z)
            uePose.p = p; uePose.f = simd_normalize(sFromWorld.direction(-z)); uePose.u = simd_normalize(sFromWorld.direction(y))
        }
        // pose is valid only during the walking test: Unreal reacts only after "걷기 테스트 시작"
        uePose.valid = walk; uePose.walk = walk
        unreal.setPose(uePose, scanId: GitHub.scanId(Prefs.scanName))
    }

    private func soundFor(_ label: String) -> URL? {
        let m = soundFiles.value
        if let u = m[AiLabels.fileKey(label)] ?? m["default"] { return u }
        return FileManager.default.fileExists(atPath: beaconFile.path) ? beaconFile : nil
    }

    /// 10 Hz: the 3 nearest recognised objects within range play their sound.
    private func updateSounds(_ frame: ARFrame) {
        let now = CACurrentMediaTime(); if now - lastSound < 0.1 { return }; lastSound = now
        let l = aiCache
        guard Prefs.soundOn, valid, walkMode, let p = camS, !l.isEmpty else { sounds.update([]); return }
        let h = heading(frame), sc = scale, range = Prefs.soundRange
        var near: [(Float, Int, Float, Float)] = []
        for (i, it) in l.enumerated() {
            guard let c = ScanData.vec(it.c) else { continue }
            let dx = c.x - p.x, dz = c.z - p.z, len = hypot(dx, dz)
            let d = max(0, len - it.r)*sc
            if d < range { near.append((d, i, len < 1e-4 ? 1 : (dx*h.x + dz*h.y)/len, len < 1e-4 ? 0 : (-dx*h.y + dz*h.x)/len)) }
        }
        near.sort { $0.0 < $1.0 }
        var out = [ObjectSounds.Src]()
        for e in near.prefix(3) {
            guard let u = soundFor(l[e.1].label) else { continue }
            let g = SoundMath.gains(d: e.0, range: range, near: 0.5, cosA: e.2, sinA: e.3)
            out.append(.init(key: e.1, url: u, left: g.0, right: g.1))
        }
        sounds.update(out)
    }

    // ------------------------------------------------------------------ in-app scanning (arQueue)
    private func handleScanRequest(_ r: Int) {
        if r == 1 {
            if scanning { return }
            if !tracking { note = "추적이 안정된 뒤 스캔을 시작하세요 (주변을 천천히 비추기)"; return }
            session.run(configuration(depth: true))     // no reset: tracking and anchors continue
            live = LiveScan(voxel: Prefs.scanVoxel, capacity: TwinModel.liveCap)
            scanning = true; aligned = false; liveAlign = nil; walkMode = false; lastPose = nil; lastChunk = 0; lastIntegrate = 0
            note = lidar ? "스캔 중 (LiDAR 깊이 모드)" : "스캔 중 (특징점 모드 · 이 기종은 LiDAR가 없어 점이 성깁니다)"
            DispatchQueue.main.async { [self] in scanningUI = true; walkUI = false; setView(.ar) }
            return
        }
        guard scanning, let ls = live else { return }
        scanning = false; live = nil
        session.run(configuration(depth: false))
        DispatchQueue.main.async { [self] in scanningUI = false; scene.endLive() }
        if r == 3 || ls.n < 500 {
            note = r == 3 ? "스캔을 취소했습니다" : "점이 너무 적어 저장하지 않았습니다 (\(ls.n)점)"
            return
        }
        finishScan(ls)
    }

    private func finishScan(_ ls: LiveScan) {
        let sh = ls.shift
        let stamp = DateFormatter(); stamp.locale = Locale(identifier: "en_US_POSIX"); stamp.dateFormat = "yyyyMMdd_HHmm"
        let name = "phone_scan_\(stamp.string(from: Date())).ply"
        var minHits = lidar ? Prefs.scanHits : 1          // feature points are sparse: every one counts
        var c0 = ls.toCloud(info: "", minHits: minHits)
        if c0.n < 500 { minHits = 1; c0 = ls.toCloud(info: "", minHits: 1) }
        let c = ScanCloud(xyz: c0.xyz, rgb: c0.rgb, n: c0.n, info: "휴대폰 스캔 (\(lidar ? "LiDAR" : "특징점")) · \(c0.n.formatted())점 (복셀 \(ls.n.formatted())개 중 \(minHits)회 이상 관측)")
        var a: SIMD3<Float>?, b: SIMD3<Float>?
        if let f = session.currentFrame, let wa = anchorFor(realA, f)?.transform.position, let wb = anchorFor(realB, f)?.transform.position {
            a = wa - sh; b = wb - sh
        }
        data = ScanData(a: a.map(ScanData.arr), b: b.map(ScanData.arr), objects: [], ai: [])
        Prefs.zUp = false; Prefs.scanName = name; Prefs.scanExt = "ply"; Prefs.scanCreated = Prefs.now()
        cloud = c; obstacles = nil
        if a == nil {
            // Scan frame = world shifted by sh: aligned right away (this run only).
            liveAlign = Alignment.translation(sh); scale = 1
            alignText = "스캔 직후 자동 정렬 (이번 실행에서만 유효)\n다음 실행을 위해 3인칭 지도에서 바닥의 스캔 A·B를 탭해 두세요"
        } else { liveAlign = nil }
        saveScanData(); publishAi()
        note = "스캔 완료 · 저장 중…"
        showCloud(c)
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try ScanLoader.writePly(c, to: scanFile)
                try? FileManager.default.removeItem(at: documents.appendingPathComponent(name))
                try? FileManager.default.copyItem(at: scanFile, to: documents.appendingPathComponent(name))   // also visible in the Files app
                arQueue.async { [self] in note = "스캔 저장됨: \(name) · 정렬 상태에서 바로 걷기 테스트를 할 수 있습니다" }
                if Prefs.ghAuto { DispatchQueue.main.async { [self] in uploadScan() } }
            } catch { arQueue.async { [self] in note = "스캔 저장 실패: \(error.localizedDescription)" } }
        }
    }

    /// Motion-blur gate: true when the camera turned faster than 60°/s or moved faster than 1 m/s since the last check.
    private func movingTooFast(_ m: simd_float4x4, _ now: CFTimeInterval) -> Bool {
        let t = m.position, q = simd_quatf(m)
        defer { lastPose = (t, q, now) }
        guard let lp = lastPose else { return false }
        let lt = lp.0, lq = lp.1, dt = Float(now - lp.2)
        if dt <= 0 || dt > 1 { return false }
        let dot = min(1, abs(simd_dot(q.vector, lq.vector)))
        let ang = 2*acos(dot)*180/Float.pi
        return ang/dt > 60 || simd_length(t - lt)/dt > 1
    }

    /// Adds the newest LiDAR depth map (or ARKit feature points) to the live scan, in world coordinates.
    /// Low-confidence pixels, flying pixels at depth edges and blurred (fast-moving) frames are skipped,
    /// and each sample is weighted by confidence / distance² for the per-voxel mean.
    private func integrate(_ frame: ARFrame) {
        let now = CACurrentMediaTime()
        guard let ls = live, now - lastIntegrate >= max(0.05, integrateCost*2) else { return }
        lastIntegrate = now
        defer { integrateCost = CACurrentMediaTime() - now }
        let m = frame.camera.transform
        guard lidar, let depth = frame.sceneDepth, let confMap = depth.confidenceMap else {
            if let pc = frame.rawFeaturePoints { for p in pc.points { ls.add(p.x, p.y, p.z, -1, 0, 0) } }
            return
        }
        if movingTooFast(m, now) { scanNote = "너무 빨리 움직여 흔들린 프레임은 건너뜁니다 · 천천히"; return }
        scanNote = ""
        let dm = depth.depthMap, img = frame.capturedImage
        CVPixelBufferLockBaseAddress(dm, .readOnly); CVPixelBufferLockBaseAddress(confMap, .readOnly); CVPixelBufferLockBaseAddress(img, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(dm, .readOnly); CVPixelBufferUnlockBaseAddress(confMap, .readOnly); CVPixelBufferUnlockBaseAddress(img, .readOnly) }
        guard let dBase = CVPixelBufferGetBaseAddress(dm), let cBase = CVPixelBufferGetBaseAddress(confMap) else { return }
        let dw = CVPixelBufferGetWidth(dm), dh = CVPixelBufferGetHeight(dm), drow = CVPixelBufferGetBytesPerRow(dm)/4, crow = CVPixelBufferGetBytesPerRow(confMap)
        let dp = dBase.assumingMemoryBound(to: Float32.self), cp = cBase.assumingMemoryBound(to: UInt8.self)
        let K = frame.camera.intrinsics, res = frame.camera.imageResolution
        let sx = Float(dw)/Float(res.width), sy = Float(dh)/Float(res.height)
        let fx = K[0][0]*sx, fy = K[1][1]*sy, cx = K[2][0]*sx, cy = K[2][1]*sy
        // colour: the captured image is YCbCr 4:2:0 (plane 0 = Y, plane 1 = interleaved CbCr), same sensor crop as the depth map
        var yp: UnsafeMutablePointer<UInt8>?, uvp: UnsafeMutablePointer<UInt8>?
        var yrow = 0, uvrow = 0, iw = 0, ih = 0
        if CVPixelBufferGetPlaneCount(img) >= 2, let y0 = CVPixelBufferGetBaseAddressOfPlane(img, 0), let uv0 = CVPixelBufferGetBaseAddressOfPlane(img, 1) {
            yp = y0.assumingMemoryBound(to: UInt8.self); uvp = uv0.assumingMemoryBound(to: UInt8.self)
            yrow = CVPixelBufferGetBytesPerRowOfPlane(img, 0); uvrow = CVPixelBufferGetBytesPerRowOfPlane(img, 1)
            iw = CVPixelBufferGetWidthOfPlane(img, 0); ih = CVPixelBufferGetHeightOfPlane(img, 0)
        }
        let maxR = Prefs.scanRange, confSetting = Prefs.scanConf
        let confMin: UInt8 = confSetting >= 0.5 ? 2 : confSetting >= 0.2 ? 1 : 0   // ARConfidenceLevel: 0 low, 1 medium, 2 high
        for y in 0..<dh {
            for x in 0..<dw {
                let d = dp[y*drow + x]
                if !(d >= 0.2 && d <= maxR) { continue }
                let c = cp[y*crow + x]; if c < confMin { continue }
                // flying pixels: a sample sitting on a depth edge is a blend of foreground and background
                let tol = d*0.04 + 0.01
                if x > 0 { let k = dp[y*drow + x - 1]; if k > 0 && abs(k - d) > tol { continue } }
                if x + 1 < dw { let k = dp[y*drow + x + 1]; if k > 0 && abs(k - d) > tol { continue } }
                if y > 0 { let k = dp[(y - 1)*drow + x]; if k > 0 && abs(k - d) > tol { continue } }
                if y + 1 < dh { let k = dp[(y + 1)*drow + x]; if k > 0 && abs(k - d) > tol { continue } }
                let px = d*(Float(x) - cx)/fx, py = d*(cy - Float(y))/fy, pz = -d       // camera space
                let w = m*SIMD4(px, py, pz, 1)
                var r = -1, g = 0, b = 0
                if let yp = yp, let uvp = uvp {
                    let u = Int((Float(x) + 0.5)/Float(dw)*Float(iw)), v = Int((Float(y) + 0.5)/Float(dh)*Float(ih))
                    if u >= 0 && v >= 0 && u < iw && v < ih {
                        let Y = Float(yp[v*yrow + u]), cb = Float(uvp[(v/2)*uvrow + (u/2)*2]) - 128, cr = Float(uvp[(v/2)*uvrow + (u/2)*2 + 1]) - 128
                        r = Int(max(0, min(255, Y + 1.402*cr))); g = Int(max(0, min(255, Y - 0.344*cb - 0.714*cr))); b = Int(max(0, min(255, Y + 1.772*cb)))
                    }
                }
                ls.add(w.x, w.y, w.z, r, g, b, weight: (Float(c) + 1)/3/(d*d))   // depth noise grows with d², so near samples count more
            }
        }
        if ls.full { scanNote = "최대 점 수에 도달했습니다 · 기존 점은 계속 다듬어집니다 · 완료·저장을 누르세요" }
    }

    private func pushLiveChunk() {
        guard let ls = live, ls.started else { return }
        let now = CACurrentMediaTime()
        if ls.n - ls.uploaded < 2000 && !(ls.n > ls.uploaded && now - lastChunk > 0.5) { return }
        let a = ls.uploaded, b = ls.n, first = a == 0, shift = ls.shift
        let xyz = Array(ls.xyz[(a*3)..<(b*3)]), rgb = Array(ls.rgb[(a*3)..<(b*3)])   // copies, so the live buffers stay unshared
        ls.uploaded = b; lastChunk = now
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let g = TwinScene.points(xyz[...], rgb[...], count: b - a)
            DispatchQueue.main.async { [self] in
                if first { scene.beginLive(shift: shift) }
                if scanningUI { scene.addLive(g) }
            }
        }
    }

    // ------------------------------------------------------------------ scans: load, import, persist
    private func showCloud(_ c: ScanCloud) {
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let g = TwinScene.points(c.xyz[...], c.rgb[...], count: c.n)
            DispatchQueue.main.async { [self] in scene.setCloud(g, center: c.center, extent: c.extent); hasCloud = true }
        }
    }

    func loadScan() {
        flash("스캔 불러오는 중…")
        let url = scanFile, ext = Prefs.scanExt, zUp = Prefs.zUp
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                let c = try ScanLoader.load(url: url, ext: ext, zUp: zUp)
                arQueue.async { [self] in
                    cloud = c; obstacles = nil; rebuildObstacles()
                    note = "스캔을 불러왔습니다 · 3인칭 지도에서 확인하세요"
                }
                showCloud(c)
            } catch {
                arQueue.async { [self] in cloud = nil; note = "스캔 읽기 실패: \(error.localizedDescription)" }
            }
        }
    }

    /// A PLY/OBJ/XYZ… chosen in the Files app.
    func importScan(_ src: URL) {
        let name = src.lastPathComponent, ext = src.pathExtension.lowercased()
        guard ScanLoader.supported.contains(ext) else { flash("지원 형식: .ply .obj .xyz .pts .txt .csv (선택: \(name))"); return }
        let access = src.startAccessingSecurityScopedResource()
        defer { if access { src.stopAccessingSecurityScopedResource() } }
        do {
            try? FileManager.default.removeItem(at: scanFile)
            try FileManager.default.copyItem(at: src, to: scanFile)
        } catch { flash("파일을 읽지 못했습니다: \(error.localizedDescription)"); return }
        Prefs.scanName = name; Prefs.scanExt = ext; Prefs.scanCreated = Prefs.now()
        arQueue.async { [self] in data = ScanData(); liveAlign = nil; saveScanData(); publishAi() }
        loadScan()
    }

    func toggleUpAxis() {
        Prefs.zUp = !Prefs.zUp
        arQueue.async { [self] in data = ScanData(); liveAlign = nil; saveScanData(); publishAi() }
        if FileManager.default.fileExists(atPath: scanFile.path) { loadScan() }
        flash("위쪽 축을 바꿨습니다 · 스캔 A/B를 다시 지정하세요")
    }

    /// Copy of the current scan named like the scan, for the share sheet.
    func exportURL() -> URL? {
        guard FileManager.default.fileExists(atPath: scanFile.path) else { flash("내보낼 스캔이 없습니다"); return nil }
        let dst = FileManager.default.temporaryDirectory.appendingPathComponent(Prefs.scanName)
        try? FileManager.default.removeItem(at: dst)
        do { try FileManager.default.copyItem(at: scanFile, to: dst); return dst } catch { flash("내보내기 실패: \(error.localizedDescription)"); return nil }
    }

    /// arQueue
    private func saveScanData() {
        Prefs.scanData = data
        if cloud != nil { rebuildObstacles() }
    }

    /// arQueue → main: the AI object list for the settings screen.
    private func publishAi() { let l = aiCache; DispatchQueue.main.async { [self] in aiItems = l } }

    func removeAiLabel(_ label: String) { arQueue.async { [self] in data.ai.removeAll { $0.label == label }; saveScanData(); publishAi() } }
    func clearAi() { arQueue.async { [self] in data.ai.removeAll(); saveScanData(); publishAi() } }

    // ------------------------------------------------------------------ sounds (main thread)
    private func rebuildSoundFiles() {
        var m = [String: URL]()
        for u in (try? FileManager.default.contentsOfDirectory(at: soundDir, includingPropertiesForKeys: nil)) ?? [] {
            m[u.deletingPathExtension().lastPathComponent] = u
        }
        soundFiles.value = m
    }

    func importSound(label: String, from src: URL) {
        let key = label == "default" ? "default" : AiLabels.fileKey(label), name = src.lastPathComponent
        let ext = src.pathExtension.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        let access = src.startAccessingSecurityScopedResource()
        defer { if access { src.stopAccessingSecurityScopedResource() } }
        for u in (try? FileManager.default.contentsOfDirectory(at: soundDir, includingPropertiesForKeys: nil)) ?? [] where u.deletingPathExtension().lastPathComponent == key {
            try? FileManager.default.removeItem(at: u)
        }
        let dst = soundDir.appendingPathComponent(key + "." + (ext.isEmpty ? "snd" : ext))
        do {
            try FileManager.default.copyItem(at: src, to: dst)
            Prefs.setSoundName(key, name); rebuildSoundFiles()
            flash((key == "default" ? "기본 소리" : AiLabels.korean(label) + " 소리") + " 지정됨: " + name)
            objectWillChange.send()
        } catch { flash("소리 파일을 읽지 못했습니다: \(error.localizedDescription)") }
    }

    // ------------------------------------------------------------------ GitHub (main thread)
    func uploadScan() {
        guard !uploading else { return }
        arQueue.async { [self] in
            guard let c = cloud else { DispatchQueue.main.async { [self] in ghStatus = "업로드할 스캔이 없습니다" }; return }
            let d = data, ai = aiCache
            DispatchQueue.main.async { [self] in upload(c, d, ai) }
        }
    }

    private func upload(_ c: ScanCloud, _ d: ScanData, _ ai: [ScanData.Ai]) {
        uploading = true; ghStatus = "업로드 준비 중…"
        let repo = Prefs.ghRepo, branch = Prefs.ghBranch, token = Keychain.get("gh_token")
        Task.detached { [self] in
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("upload.ply")
            defer { try? FileManager.default.removeItem(at: tmp) }
            let msg: String
            do {
                let id = GitHub.scanId(Prefs.scanName), created = Prefs.scanCreated ?? Prefs.now()
                var meta: [String: Any] = ["version": 1, "id": id, "created": created, "frame": "S: metres, Y up, right-handed", "points": c.n,
                    "bounds": ["min": TwinModel.doubles([c.lo.x, c.lo.y, c.lo.z]), "max": TwinModel.doubles([c.hi.x, c.hi.y, c.hi.z])]]
                if let a = d.a { meta["a"] = TwinModel.doubles(a) } else { meta["a"] = NSNull() }
                if let b = d.b { meta["b"] = TwinModel.doubles(b) } else { meta["b"] = NSNull() }
                meta["objects"] = d.objects.map { ["id": $0.id, "name": $0.name, "c": TwinModel.doubles($0.c), "r": Double($0.r)] as [String: Any] }
                meta["ai"] = ai.map { ["label": $0.label, "name": AiLabels.korean($0.label), "c": TwinModel.doubles($0.c), "r": Double($0.r)] as [String: Any] }
                let entry: [String: Any] = ["id": id, "ply": "scans/\(id).ply", "meta": "scans/\(id).json", "points": c.n, "created": created, "device": TwinModel.deviceName()]
                try ScanLoader.writePly(c, to: tmp)        // always the loaded cloud in frame S, whatever format it was imported from
                let sha = try await GitHub.Uploader(repo: repo, branch: branch, token: token).upload(id: id, ply: tmp, meta: meta, entry: entry) { s in
                    DispatchQueue.main.async { self.ghStatus = s }
                }
                msg = "업로드 완료: scans/\(id).ply · 커밋 \(sha.prefix(7))\n웹사이트는 1~2분 뒤 갱신됩니다"
            } catch { msg = "업로드 실패: \(error.localizedDescription)" }
            await MainActor.run { self.ghStatus = msg; self.uploading = false }
        }
    }

    /// Lists scans/index.json and lets the user pick one (for comparing the scanned space with another place).
    func chooseGitHubScan() {
        if scanningUI { flash("스캔을 마친 뒤 불러오세요"); return }
        let reader = GitHub.Reader(repo: Prefs.ghRepo, branch: Prefs.ghBranch, token: Keychain.get("gh_token"))
        ghStatus = "GitHub 스캔 목록을 받는 중…"
        Task { @MainActor in
            do {
                let list = try await reader.list()
                ghStatus = "GitHub 스캔 \(list.count)개"
                if list.isEmpty { flash("GitHub에 올린 스캔이 없습니다"); return }
                ghChoices = GhChoices(entries: list, current: GitHub.scanId(Prefs.scanName))
            } catch { ghStatus = "목록 받기 실패: \(error.localizedDescription)" }
        }
    }

    func downloadGitHubScan(_ e: GitHub.Entry) {
        let reader = GitHub.Reader(repo: Prefs.ghRepo, branch: Prefs.ghBranch, token: Keychain.get("gh_token"))
        ghStatus = "내려받는 중: \(e.id) (\(e.points.formatted())점)"
        Task { @MainActor in
            do {
                let ply = try await reader.fetch(e.ply)
                var sd = ScanData()
                if let meta = try? await reader.fetch(e.meta), let parsed = try? GitHub.toScanData(meta: meta) { sd = parsed }   // PLY only: no A·B, no objects
                try ply.write(to: scanFile, options: .atomic)
                Prefs.zUp = false; Prefs.scanName = e.id + ".ply"; Prefs.scanExt = "ply"; Prefs.scanCreated = e.created.isEmpty ? Prefs.now() : e.created
                setWalk(false)
                let ab = sd.scanA != nil && sd.scanB != nil
                ghStatus = "GitHub 스캔을 불러왔습니다: \(e.id)" + (ab ? "\n스캔 A·B 포함 · 2번에서 이 장소의 현장 A·B를 기록하면 겹쳐 비교할 수 있습니다" : "\n스캔 A·B 없음 · 3인칭 지도에서 스캔 A·B를 먼저 탭하세요")
                arQueue.async { [self] in data = sd; liveAlign = nil; saveScanData(); publishAi() }
                loadScan()
            } catch { ghStatus = "불러오기 실패: \(error.localizedDescription)" }
        }
    }

    static func doubles(_ v: [Float]) -> [Double] { v.map { Double($0) } }

    static func deviceName() -> String {
        var s = utsname(); uname(&s)
        let id = withUnsafeBytes(of: &s.machine) { String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self) }
        return id.isEmpty ? "iPhone" : id
    }

    // ------------------------------------------------------------------ links (main thread)
    func startUnreal(relay: Bool, host: String, port: Int, relayUrl: String, room: String, key: String) {
        if relay {
            if relayUrl.trimmingCharacters(in: .whitespaces).isEmpty { flash("릴레이 주소를 넣으세요 (DigitalOcean 앱 주소)"); return }
            unreal.startRelay(base: relayUrl, room: room, key: key)
        } else {
            if host.trimmingCharacters(in: .whitespaces).isEmpty || port < 1 || port > 65535 { flash("언리얼 PC IP와 포트를 확인하세요"); return }
            unreal.start(host: host, port: UInt16(port))
        }
    }

    func startEsp(host: String, port: Int) {
        if host.trimmingCharacters(in: .whitespaces).isEmpty || port < 1 || port > 65535 { flash("ESP32 IP와 포트를 확인하세요"); return }
        feedback.setEsp(on: true, host: host, port: UInt16(port))
    }

    // ------------------------------------------------------------------ status text (arQueue → main, ~7 Hz)
    private func uiTick(_ reason: String) {
        let now = CACurrentMediaTime()
        if now - lastUi < 0.15 { return }
        lastUi = now
        let s = "\(feedback.espStatus)\n\(reason) · \(scanNote.isEmpty ? note : scanNote)"
        let h = hudText()
        let c = cloud
        let scan = c.map { "\(Prefs.scanName)\n\($0.info)\n" + String(format: "크기 %.2f × %.2f × %.2f (높이) m", $0.hi.x - $0.lo.x, $0.hi.z - $0.lo.z, $0.hi.y - $0.lo.y) } ?? "스캔 없음"
        let al = "스캔 A \(data.a != nil ? "✔" : "—") · 스캔 B \(data.b != nil ? "✔" : "—") · 현장 A \(realA != nil ? "✔" : "—") · 현장 B \(realB != nil ? "✔" : "—")\n\(alignText)"
        let li = (lidar ? "이 기종: LiDAR 지원 → 컬러 고밀도 스캔" : "이 기종: LiDAR 없음 → 특징점 스캔 (점이 성김, 외부 스캔 파일 권장)") + (scanning ? "\n스캔 중 \((live?.n ?? 0).formatted())점" : "")
        let ue = unreal.status + (feedback.remoteActive ? "\n지금 언리얼이 계산한 진동을 쓰는 중" : "")
        let esp = feedback.espStatus + (feedback.hasHaptics ? "" : "\n이 기기는 진동(Core Haptics)을 지원하지 않습니다")
        let snd = sounds.status, fh = floorHit
        DispatchQueue.main.async { [self] in
            status = s; hud = h; floorHitUI = fh; scanInfo = scan; alignInfo = al; liveInfo = li; unrealInfo = ue; espInfo = esp; soundInfo = snd
        }
    }

    private func hudText() -> String {
        if scanning {
            let n = live?.n ?? 0
            return "● 스캔 중  \(n.formatted())점 (\(n*100/TwinModel.liveCap)%) · \(lidar ? "LiDAR" : "특징점")\n천천히 훑어 빈 곳을 채우세요 · 끝나면 완료·저장"
        }
        if aim != 0 { return floorHit ? "바닥 인식됨 · 원을 테이프 지점에 맞추고 기록 버튼을 누르세요" : "바닥을 찾는 중 · 바닥을 비추며 휴대폰을 천천히 움직이세요" }
        if !valid { return cloud == nil ? "스캔 없음 · 설정에서 스캔하거나 스캔 파일을 여세요" : !aligned ? "정렬 전 · 스캔 A·B, 현장 A·B를 지정하세요" : "추적 대기 중 · 카메라로 주변을 비추세요" }
        if !walkMode { return "정렬 완료 · 위쪽 '🚶 걷기 테스트 시작'을 누르면 진동·소리·ESP32·언리얼 연동이 시작됩니다" }
        let i = hudIntensity, o = hudObj
        let bar = String(repeating: "█", count: Int((i*12).rounded())) + String(repeating: "·", count: 12 - Int((i*12).rounded()))
        let what = o < 0 ? "" : o == 0 ? " (벽·장애물)" : " (\(objName(o)))"
        let head = hudContact ? "▶ 부딪힘 주의" : hudDeadEnd ? "■ 막다른 곳" : "걷기"
        let ah = hudAhead.isInfinite ? "열림" : String(format: "%.2fm", hudAhead), na = hudNear.isInfinite ? "여유" : String(format: "%.2fm", hudNear)
        return "🚶 \(head)  앞 \(ah) · 주변 \(na)\(what)\n\(bar) \(String(format: "%3.0f%%", i*100))  \(obstacles == nil ? "장애물 지도 준비 중" : "")"
    }

    private func objName(_ id: Int) -> String {
        if id >= 100 { let l = aiCache; return id - 100 < l.count ? AiLabels.korean(l[id - 100].label) : "AI 사물" }
        return data.objects.first { $0.id == id }?.name ?? "사물 \(id)"
    }
}
