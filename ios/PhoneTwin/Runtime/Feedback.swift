import Foundation
import AVFoundation
import CoreHaptics
import Network

/// Turns "how close is the phone to something" into vibration (Core Haptics), an optional proximity tone,
/// and a 30 Hz UDP stream to the ESP32 wristband (port of the Android Feedback).
///
/// ESP32 packet (ASCII, one line):  PTH1,seq,valid,intensity0-255,contact0/1,objectId,distanceMm
/// The ESP32 answers with  PTA1,lastSeq,rssi  which the app shows as "ESP32 응답".
final class Feedback {
    private struct Shared {
        var h = LinkProtocol.Haptic(), pulse = false, paused = false, testUntil: TimeInterval = 0
        var espOn = false, espHost = "", espPort: UInt16 = 4210
        var espStatus = "ESP32 꺼짐"
    }
    private let shared = Locked(Shared())
    private let q = DispatchQueue(label: "feedback")
    private var timer: DispatchSourceTimer?
    weak var remote: UnrealLink?

    let hasHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    private var engine: CHHapticEngine?, engineOn = false
    private var cont: CHHapticAdvancedPatternPlayer?, contOn = false
    private var nextVibe: TimeInterval = 0, wasContact = false
    private let tone = ToneGen()

    private var esp: NWConnection?, espKey = "", espSeq = 0, lastAck: TimeInterval = 0

    init() {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now(), repeating: .milliseconds(33), leeway: .milliseconds(3))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume(); timer = t
    }

    var espStatus: String { shared.value.espStatus }
    /// True while a fresh PTH1 from Unreal replaces the locally computed values.
    var remoteActive: Bool { Prefs.useUnrealHaptic && remote?.remoteHaptic() != nil }

    /// pulse: parking-sensor style taps that speed up as intensity rises (used for "blocked ahead" while walking).
    func update(_ h: LinkProtocol.Haptic, pulse: Bool = false) { shared.mutate { $0.h = h; $0.pulse = pulse } }
    func setPaused(_ p: Bool) { shared.mutate { $0.paused = p } }
    func setEsp(on: Bool, host: String = "", port: UInt16 = 4210) { shared.mutate { $0.espOn = on; $0.espHost = host.trimmingCharacters(in: .whitespaces); $0.espPort = port } }
    /// Full-strength vibration and ESP32 signal for one second, independent of tracking.
    func test() { shared.mutate { $0.testUntil = Date.timeIntervalSinceReferenceDate + 1 } }

    private static func now() -> TimeInterval { Date.timeIntervalSinceReferenceDate }

    // ------------------------------------------------------------ 30 Hz: ESP32, vibration, tone
    private func tick() {
        let s = shared.value, now = Feedback.now()
        let testing = now < s.testUntil
        var v = s.h, pulse = s.pulse
        if Prefs.useUnrealHaptic, let r = remote?.remoteHaptic() { v = r; pulse = false }
        let live = testing || (v.valid && !s.paused)
        let i: Float = testing ? 1 : live ? v.intensity : 0
        let c = !testing && live && v.contact
        let out = LinkProtocol.Haptic(valid: live, intensity: i, contact: c, object: testing ? 0 : live ? v.object : -1, distance: testing ? 0 : v.distance)

        espTick(s, out, now)
        hapticTick(i: i, contact: c, pulse: pulse, testing: testing, now: now)

        let toneLive = Prefs.tone && v.valid && !s.paused && !testing
        let obj = v.object
        var freq = obj <= 0 ? 330.0 : 220*pow(2, Double(obj % 12)/6)
        if v.contact { freq *= 1.5 }
        tone.set(target: toneLive ? v.intensity*(v.contact ? 1 : 0.6) : 0, freq: freq)
    }

    // ------------------------------------------------------------ ESP32 (UDP 4210)
    private func espTick(_ s: Shared, _ h: LinkProtocol.Haptic, _ now: TimeInterval) {
        if s.espOn, !s.espHost.isEmpty, let port = NWEndpoint.Port(rawValue: s.espPort) {
            let key = "\(s.espHost):\(s.espPort)"
            if esp == nil || key != espKey {
                esp?.cancel()
                let c = NWConnection(host: NWEndpoint.Host(s.espHost), port: port, using: .udp)
                c.start(queue: q); esp = c; espKey = key; receiveEsp(c)
            }
            guard let c = esp else { return }
            espSeq += 1
            c.send(content: LinkProtocol.pth1(seq: espSeq, h).data(using: .ascii), completion: .idempotent)
            let st: String
            if case .failed(let e) = c.state { st = "ESP32 오류: \(e.localizedDescription)" }
            else if case .waiting(let e) = c.state { st = "ESP32 오류: \(e.localizedDescription)" }
            else { st = now - lastAck < 1.5 ? "ESP32 응답 OK · \(s.espHost)" : "ESP32로 송신 중 · 응답 없음 (IP/전원/Wi-Fi 확인)" }
            shared.mutate { $0.espStatus = st }
        } else if let c = esp {
            // final "stop" packet so the motor never keeps running
            c.send(content: "PTH1,0,0,0,0,-1,-1\n".data(using: .ascii), completion: .contentProcessed { _ in c.cancel() })
            esp = nil; espKey = ""
            shared.mutate { $0.espStatus = "ESP32 꺼짐" }
        }
    }

    private func receiveEsp(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, _, error in
            guard let self = self, c === self.esp else { return }
            if let d = data, String(decoding: d, as: UTF8.self).hasPrefix("PTA1") { self.lastAck = Feedback.now() }
            if error == nil { self.receiveEsp(c) }
        }
    }

    // ------------------------------------------------------------ vibration (Core Haptics)
    private func hapticTick(i: Float, contact c: Bool, pulse: Bool, testing: Bool, now: TimeInterval) {
        let active = Prefs.vibe && hasHaptics && i > 0.01
        if active {
            if c && !wasContact { stopContinuous(); transient(1, sharpness: 1); nextVibe = now + 0.08 }
            else if !c && !testing && pulse {
                stopContinuous()
                if now >= nextVibe { transient(0.35 + 0.65*i, sharpness: 0.6); nextVibe = now + Double(0.65 - 0.53*i) }
            } else if now >= nextVibe { continuous(c ? 1 : 0.15 + 0.85*i) }
        } else if contOn { stopContinuous() }
        wasContact = active && c
    }

    private func ensureEngine() -> CHHapticEngine? {
        guard hasHaptics else { return nil }
        if engine == nil {
            guard let e = try? CHHapticEngine() else { return nil }
            e.playsHapticsOnly = true; e.isAutoShutdownEnabled = false
            e.stoppedHandler = { [weak self] _ in self?.q.async { self?.engineOn = false; self?.cont = nil; self?.contOn = false } }
            e.resetHandler = { [weak self] in self?.q.async { self?.engineOn = false; self?.cont = nil; self?.contOn = false } }
            engine = e
        }
        if !engineOn { do { try engine?.start(); engineOn = true } catch { return nil } }
        return engine
    }

    private func transient(_ intensity: Float, sharpness: Float) {
        guard let e = ensureEngine() else { return }
        let ev = CHHapticEvent(eventType: .hapticTransient, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: max(0, min(1, intensity))),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)], relativeTime: 0)
        if let pattern = try? CHHapticPattern(events: [ev], parameters: []), let p = try? e.makePlayer(with: pattern) { try? p.start(atTime: CHHapticTimeImmediate) }
    }

    private func continuous(_ intensity: Float) {
        guard let e = ensureEngine() else { return }
        if cont == nil {
            let ev = CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.4)], relativeTime: 0, duration: 30)
            guard let pattern = try? CHHapticPattern(events: [ev], parameters: []), let p = try? e.makeAdvancedPlayer(with: pattern) else { return }
            p.loopEnabled = true; cont = p
        }
        guard let p = cont else { return }
        if !contOn { do { try p.start(atTime: CHHapticTimeImmediate); contOn = true } catch { cont = nil; return } }
        try? p.sendParameters([CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: max(0, min(1, intensity)), relativeTime: 0)], atTime: CHHapticTimeImmediate)
    }

    private func stopContinuous() {
        if contOn { try? cont?.stop(atTime: CHHapticTimeImmediate); contOn = false }
    }
}

/// Proximity tone: a sine whose pitch depends on the object and whose loudness follows the intensity.
final class ToneGen {
    private let engine = AVAudioEngine()
    private var node: AVAudioSourceNode?
    private var running = false
    // read by the audio render thread
    private var target: Float = 0, freq: Double = 330, amp: Float = 0, phase: Double = 0

    init() {
        let rate = 44100.0
        let n = AVAudioSourceNode { [unowned self] _, _, frameCount, abl -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(abl)
            let t = self.target, f = self.freq
            for k in 0..<Int(frameCount) {
                self.amp += (t - self.amp)*0.001
                self.phase += 2*Double.pi*f/rate; if self.phase > 2*Double.pi { self.phase -= 2*Double.pi }
                let s = Float(sin(self.phase))*self.amp*0.37
                for b in buffers { b.mData?.assumingMemoryBound(to: Float.self)[k] = s }
            }
            return noErr
        }
        if let fmt = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) {
            engine.attach(n); engine.connect(n, to: engine.mainMixerNode, format: fmt); node = n
        }
    }

    func set(target t: Float, freq f: Double) {
        target = t; freq = f
        if t > 0.001 && !running && node != nil { do { try engine.start(); running = true } catch {} }
        else if t <= 0.001 && running && amp < 1e-3 { engine.pause(); running = false }
    }
}
