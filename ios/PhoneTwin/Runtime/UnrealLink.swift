import Foundation
import Network

/// Small lock-protected box for values shared between the AR, link and UI threads.
final class Locked<T> {
    private var v: T; private let l = NSLock()
    init(_ v: T) { self.v = v }
    var value: T { get { l.lock(); defer { l.unlock() }; return v } set { l.lock(); v = newValue; l.unlock() } }
    func mutate(_ f: (inout T) -> Void) { l.lock(); f(&v); l.unlock() }
}

/// Link to the Unreal PC (PROTOCOL.md §1, §3), same behaviour as the Android UnrealLink:
/// UDP mode sends the latest phone pose as PTP1 at ~30 Hz to host:port (default 7777) and listens on UDP 4211
/// for PTH1 haptic values computed by Unreal. Relay mode carries the same lines over a WebSocket to the
/// DigitalOcean relay (wss://host/ws?room=..&role=phone&key=..). The AR loop only calls setPose().
final class UnrealLink: NSObject, URLSessionWebSocketDelegate {
    static let listenPort: UInt16 = 4211

    private struct Shared {
        var running = false, relay = false
        var pose: LinkProtocol.Pose?, scanId = ""
        var rx = LinkProtocol.Haptic(), rxAt: TimeInterval = 0, rxFrom = ""
        var status = "언리얼 연동 꺼짐"
    }
    private let shared = Locked(Shared())
    private let q = DispatchQueue(label: "unreal-link")
    private lazy var opQueue: OperationQueue = { let o = OperationQueue(); o.maxConcurrentOperationCount = 1; o.underlyingQueue = self.q; return o }()
    private lazy var urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: opQueue)

    // link-queue state
    private var timer: DispatchSourceTimer?
    private var udp: NWConnection?, listener: NWListener?
    private var host = "", port: UInt16 = 7777, seq = 0, gen = 0
    private var relayURL = "", task: URLSessionWebSocketTask?, wsOpen = false, retryAt: TimeInterval = 0
    private var peers = "", wsState = "", rtts = [Float](), lastPing: TimeInterval = 0

    var running: Bool { shared.value.running }
    var relayMode: Bool { shared.value.relay }
    var status: String { shared.value.status }
    /// How old an Unreal PTH1 may be before falling back to local haptics: the relay adds ~100-200 ms.
    var freshWindow: TimeInterval { relayMode ? 0.7 : 0.3 }
    func fresh(_ window: TimeInterval) -> Bool { Date.timeIntervalSinceReferenceDate - shared.value.rxAt < window }
    /// The last PTH1 from Unreal while it is fresh, else nil.
    func remoteHaptic() -> LinkProtocol.Haptic? {
        let s = shared.value
        return s.running && Date.timeIntervalSinceReferenceDate - s.rxAt < (s.relay ? 0.7 : 0.3) ? s.rx : nil
    }

    /// walk: the walking test is running on the phone (the start switch for Unreal's vibration and sound).
    func setPose(_ p: LinkProtocol.Pose, scanId: String) { shared.mutate { $0.pose = p; $0.scanId = scanId } }

    private static func now() -> TimeInterval { Date.timeIntervalSinceReferenceDate }

    // ------------------------------------------------------------------ start / stop
    func start(host h: String, port p: UInt16) {
        q.async { [self] in
            stopOnQueue()
            host = h.trimmingCharacters(in: .whitespaces); port = p; gen += 1
            shared.mutate { $0.running = true; $0.relay = false; $0.status = "언리얼로 보내는 중…" }
            if let nwPort = NWEndpoint.Port(rawValue: port) {
                let c = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .udp)
                c.start(queue: q); udp = c
            }
            startListener()
            startTimer { [weak self] in self?.tickUdp() }
        }
    }

    func startRelay(base: String, room: String, key: String) {
        q.async { [self] in
            stopOnQueue()
            relayURL = LinkProtocol.relayUrl(base: base, room: room, key: key, role: "phone"); gen += 1
            retryAt = 0; peers = ""; wsState = "접속 중"; rtts.removeAll()
            shared.mutate { $0.running = true; $0.relay = true }
            startTimer { [weak self] in self?.tickRelay() }
        }
    }

    func stop() { q.async { [self] in stopOnQueue() } }

    private func stopOnQueue() {
        gen += 1
        timer?.cancel(); timer = nil
        udp?.cancel(); udp = nil
        listener?.cancel(); listener = nil
        task?.cancel(with: .normalClosure, reason: nil); task = nil; wsOpen = false
        shared.mutate { $0.running = false; $0.relay = false; $0.rxAt = 0; $0.status = "언리얼 연동 꺼짐" }
    }

    private func startTimer(_ tick: @escaping () -> Void) {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now(), repeating: .milliseconds(33), leeway: .milliseconds(3))
        t.setEventHandler(handler: tick); t.resume(); timer = t
    }

    // ------------------------------------------------------------------ UDP
    private func startListener() {
        guard let p = NWEndpoint.Port(rawValue: UnrealLink.listenPort) else { return }
        let params = NWParameters.udp; params.allowLocalEndpointReuse = true
        do {
            let l = try NWListener(using: params, on: p)
            let g = gen
            l.newConnectionHandler = { [weak self] c in
                guard let self = self, g == self.gen else { c.cancel(); return }
                c.start(queue: self.q); self.receive(c, g)
            }
            l.stateUpdateHandler = { [weak self] st in
                if case .failed(let e) = st { self?.shared.mutate { $0.status = "언리얼 수신 포트 \(UnrealLink.listenPort) 오류: \(e.localizedDescription)" } }
            }
            l.start(queue: q); listener = l
        } catch { shared.mutate { $0.status = "언리얼 수신 포트 \(UnrealLink.listenPort) 오류: \(error.localizedDescription)" } }
    }

    private func receive(_ c: NWConnection, _ g: Int) {
        c.receiveMessage { [weak self] data, _, _, error in
            guard let self = self, g == self.gen else { c.cancel(); return }
            if let d = data, let s = String(data: d, encoding: .ascii) {
                var from = ""
                if case .hostPort(let h, _) = c.endpoint { from = "\(h)" }
                self.onLine(s, from: from)
            }
            if error == nil { self.receive(c, g) } else { c.cancel() }
        }
    }

    private func tickUdp() {
        let s = shared.value
        var text: String
        if let c = udp {
            switch c.state {
            case .ready:
                if let p = s.pose {
                    seq += 1
                    c.send(content: LinkProtocol.ptp1(seq: seq, p, scanId: s.scanId).data(using: .ascii), completion: .idempotent)
                    text = "언리얼로 보내는 중 · \(host):\(port)"
                } else { text = "위치 대기 중" }
            case .failed(let e), .waiting(let e): text = "언리얼 송신 오류: \(e.localizedDescription) (\(host))"
            default: text = "언리얼 PC 주소를 찾는 중 (\(host))"
            }
        } else { text = "포트를 확인하세요" }
        let ok = fresh(0.3)
        shared.mutate { $0.status = text + (ok ? " · 언리얼 진동 수신 OK (\($0.rxFrom))" : " · 언리얼 진동 신호 없음") }
    }

    /// Handles one text line from Unreal / the relay.
    private func onLine(_ text: String, from: String) {
        for line in text.split(separator: "\n").map(String.init) where !line.isEmpty {
            if line.hasPrefix("PTH1") {
                guard let h = LinkProtocol.parsePth1(line) else { continue }
                shared.mutate { $0.rx = h; $0.rxAt = UnrealLink.now(); $0.rxFrom = from }
            } else if line.hasPrefix("PTR1,peers,") {
                peers = String(line.dropFirst(11)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("PTR1,pong,"), let sent = UInt64(line.dropFirst(10).trimmingCharacters(in: .whitespaces)) {
                let ms = Float(Double(DispatchTime.now().uptimeNanoseconds &- sent)/1e6)
                rtts.append(ms); if rtts.count > 10 { rtts.removeFirst() }
            }
        }
    }

    // ------------------------------------------------------------------ relay (WebSocket)
    private func tickRelay() {
        let now = UnrealLink.now()
        if task == nil && now >= retryAt, let url = URL(string: relayURL) {
            wsState = "접속 중"; retryAt = .greatestFiniteMagnitude   // one attempt at a time; drop() schedules the next
            let t = urlSession.webSocketTask(with: url); task = t; wsOpen = false
            t.resume(); receiveWs(t, gen)
        }
        if let t = task, wsOpen {
            if let p = shared.value.pose {
                seq += 1
                t.send(.string(LinkProtocol.ptp1(seq: seq, p, scanId: shared.value.scanId))) { _ in }
            }
            if now - lastPing >= 2 { lastPing = now; t.send(.string("PTR1,ping,\(DispatchTime.now().uptimeNanoseconds)")) { _ in } }
        }
        let m = LinkProtocol.median(rtts), ok = fresh(0.7)
        let text = "릴레이 \(wsState)" + (peers.isEmpty ? "" : " · \(peers)") + (m.isNaN ? "" : String(format: " · 왕복 %.0f ms", m))
            + (ok ? " · 언리얼 진동 수신 OK" : " · 언리얼 진동 신호 없음")
        shared.mutate { $0.status = text }
    }

    private func receiveWs(_ t: URLSessionWebSocketTask, _ g: Int) {
        t.receive { [weak self] result in
            guard let self = self, g == self.gen, t === self.task else { return }
            switch result {
            case .success(.string(let s)): self.onLine(s, from: "릴레이"); self.receiveWs(t, g)
            case .success(.data(let d)): self.onLine(String(decoding: d, as: UTF8.self), from: "릴레이"); self.receiveWs(t, g)
            case .success: self.receiveWs(t, g)
            case .failure: self.drop(t, "연결 끊김")
            }
        }
    }

    private func drop(_ t: URLSessionTask, _ why: String) {
        guard t === task else { return }   // a socket from an earlier start/stop
        task = nil; wsOpen = false; wsState = why + " · 2초 뒤 재접속"; retryAt = UnrealLink.now() + 2
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { webSocketTask.cancel(with: .normalClosure, reason: nil); return }
        wsOpen = true; wsState = "연결됨"
    }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        drop(webSocketTask, "연결 끊김")
    }
    func urlSession(_ session: URLSession, task t: URLSessionTask, didCompleteWithError error: Error?) {
        guard error != nil else { return }
        let code = (t.response as? HTTPURLResponse)?.statusCode ?? 0
        drop(t, code == 401 ? "키가 틀립니다 (401)" : "연결 실패")
    }
}
