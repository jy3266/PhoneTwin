import Foundation
import simd

/// Text lines of PROTOCOL.md shared by the UDP and relay links (same format as the Android app).
enum LinkProtocol {
    struct Pose {
        var valid = false, walk = false
        var p = SIMD3<Float>(0, 0, 0), f = SIMD3<Float>(0, 0, -1), u = SIMD3<Float>(0, 1, 0)
    }

    /// PTP1,seq,valid,x,y,z,fx,fy,fz,ux,uy,uz,scanId,walk  (scan frame S, metres, Y up)
    static func ptp1(seq: Int, _ q: Pose, scanId: String) -> String {
        let v: [Double] = [q.p.x, q.p.y, q.p.z, q.f.x, q.f.y, q.f.z, q.u.x, q.u.y, q.u.z].map { Double($0) }
        let nums = v.map { String(format: "%.4f", $0) }.joined(separator: ",")
        return "PTP1,\(seq),\(q.valid ? 1 : 0),\(nums),\(scanId.replacingOccurrences(of: ",", with: "_")),\(q.walk ? 1 : 0)\n"
    }

    struct Haptic: Equatable {
        var valid = false, intensity: Float = 0, contact = false, object = -1, distance: Float = .infinity
    }

    /// PTH1,seq,valid,intensity0-255,contact,objectId,distanceMm
    static func parsePth1(_ s: String) -> Haptic? {
        let a = s.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        guard a.count >= 7, a[0] == "PTH1", let valid = Int(a[2]), let i = Int(a[3]), let c = Int(a[4]), let o = Int(a[5]), let mm = Int(a[6]) else { return nil }
        return Haptic(valid: valid > 0, intensity: Float(max(0, min(255, i)))/255, contact: c > 0, object: o, distance: mm < 0 ? .infinity : Float(mm)/1000)
    }

    /// PTH1 line for the ESP32 (distance in metres, infinity = nothing in range).
    static func pth1(seq: Int, _ h: Haptic) -> String {
        let mm = h.distance.isInfinite || !h.valid ? -1 : Int((min(65, max(0, h.distance))*1000).rounded())
        return "PTH1,\(seq),\(h.valid ? 1 : 0),\(Int((h.intensity*255).rounded())),\(h.contact ? 1 : 0),\(h.object),\(mm)\n"
    }

    /// Builds wss://host/ws?room=..&role=..&key=.. from what the user typed (scheme optional, http(s) mapped to ws(s)).
    static func relayUrl(base: String, room: String, key: String, role: String) -> String {
        var b = base.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        if b.hasSuffix("/ws") { b.removeLast(3) }
        if b.hasPrefix("https://") { b = "wss://" + b.dropFirst(8) }
        else if b.hasPrefix("http://") { b = "ws://" + b.dropFirst(7) }
        else if !b.hasPrefix("ws://") && !b.hasPrefix("wss://") { b = "wss://" + b }
        let r = room.trimmingCharacters(in: .whitespaces)
        return b + "/ws?room=" + enc(r.isEmpty ? "arko" : r) + "&role=" + role + "&key=" + enc(key.trimmingCharacters(in: .whitespaces))
    }

    /// Like Java URLEncoder: everything except A-Z a-z 0-9 - _ . * is percent-encoded (space as +).
    static func enc(_ s: String) -> String {
        var out = ""
        for b in s.utf8 {
            switch b {
            case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2D, 0x5F, 0x2E, 0x2A: out.append(Character(UnicodeScalar(b)))
            case 0x20: out.append("+")
            default: out += String(format: "%%%02X", b)
            }
        }
        return out
    }

    static func median(_ v: [Float]) -> Float {
        if v.isEmpty { return .nan }
        let a = v.sorted(); return a[a.count/2]
    }
}
