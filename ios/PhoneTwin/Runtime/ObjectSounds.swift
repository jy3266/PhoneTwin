import Foundation
import AVFoundation

/// Looping sound per recognised object (port of the Android SpatialSound). The closer the object, the louder;
/// objects in front are louder than objects behind, and left/right panning follows the direction (best with earphones).
final class ObjectSounds {
    struct Src: Equatable { let key: Int; let url: URL; let left: Float; let right: Float }
    private final class Voice { var player: AVAudioPlayer?; let url: URL; var l: Float = 0, r: Float = 0, tl: Float = 0, tr: Float = 0, wanted = false; init(_ u: URL) { url = u } }

    private let wanted = Locked<[Src]>([])
    private let pausedBox = Locked(false)
    private let statusBox = Locked("")
    private let q = DispatchQueue(label: "object-sound")
    private var timer: DispatchSourceTimer?
    private var voices: [Int: Voice] = [:]   // sound queue only

    var status: String { statusBox.value }

    init() {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now(), repeating: .milliseconds(50))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume(); timer = t
    }

    func update(_ s: [Src]) { wanted.value = s }
    func setPaused(_ p: Bool) { pausedBox.value = p }

    private func tick() {
        let want = pausedBox.value ? [] : wanted.value
        for v in voices.values { v.wanted = false; v.tl = 0; v.tr = 0 }
        for s in want {
            var v = voices[s.key]
            if let old = v, old.url != s.url { old.player?.stop(); voices[s.key] = nil; v = nil }
            if v == nil {
                let nv = Voice(s.url)
                do {
                    let p = try AVAudioPlayer(contentsOf: s.url)
                    p.numberOfLoops = -1; p.volume = 0; p.prepareToPlay(); p.play()
                    nv.player = p; statusBox.value = ""
                } catch { statusBox.value = "소리 재생 실패: \(s.url.lastPathComponent)" }
                voices[s.key] = nv; v = nv
            }
            v?.wanted = true; v?.tl = s.left; v?.tr = s.right
        }
        for (k, v) in voices {
            v.l += (v.tl - v.l)*0.25; v.r += (v.tr - v.r)*0.25
            if let p = v.player { p.volume = max(v.l, v.r); p.pan = (v.r - v.l)/max(1e-3, v.r + v.l) }
            if !v.wanted && v.l < 0.005 && v.r < 0.005 { v.player?.stop(); voices[k] = nil }
        }
    }

    /// Default sound when the user has not added one: a short soft ping that repeats (a "beacon").
    static func writeBeacon(to url: URL) throws {
        let rate = 22050, n = Int(Double(rate)*0.75), ping = Int(Double(rate)*0.22)
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        d.append(contentsOf: Array("RIFF".utf8)); u32(36 + n*2); d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate*2); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(n*2)
        for i in 0..<n {
            let t = Double(i)/Double(rate), env = i < ping ? min(1, Double(i)/200)*exp(-t*14) : 0
            var s = Int16(max(-32767, min(32767, env*(sin(2*Double.pi*880*t) + 0.35*sin(2*Double.pi*1760*t))*16000))).littleEndian
            withUnsafeBytes(of: &s) { d.append(contentsOf: $0) }
        }
        try d.write(to: url, options: .atomic)
    }
}
