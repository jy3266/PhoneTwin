import Foundation
import simd

/// Two-point floor alignment between the scan and the real room (port of the Android Alignment).
///
/// Twin-local frame L: origin at floor point A, Y up, -Z pointing horizontally from A toward B, X to the right.
/// Scan frame S: the loader's Y-up frame. ARKit world: Y up (gravity), metres — the same convention as ARCore.
enum Alignment {
    static func horizontal(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float { hypot(b.x - a.x, b.z - a.z) }

    /// Matrix taking scan-frame points to twin-local L, with uniform scale s (scan units → metres).
    static func scanToLocal(_ a: SIMD3<Float>, _ b: SIMD3<Float>, scale s: Float) -> simd_float4x4? {
        let d = horizontal(a, b)
        if d < 1e-4 { return nil }
        let fx = (b.x - a.x)/d, fz = (b.z - a.z)/d    // forward (toward B) in S
        let rx = -fz, rz = fx                          // right = forward × up
        return simd_float4x4(columns: (
            SIMD4(s*rx, 0, -s*fx, 0),
            SIMD4(0, s, 0, 0),
            SIMD4(s*rz, 0, -s*fz, 0),
            SIMD4(-s*(rx*a.x + rz*a.z), -s*a.y, s*(fx*a.x + fz*a.z), 1)))
    }

    /// World pose of the frame L from the real floor marks A and B (world coordinates).
    static func worldFromLocal(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> simd_float4x4? {
        let d = horizontal(a, b)
        if d < 1e-4 { return nil }
        let fx = (b.x - a.x)/d, fz = (b.z - a.z)/d
        return simd_float4x4(columns: (
            SIMD4(-fz, 0, fx, 0),          // X: right
            SIMD4(0, 1, 0, 0),             // Y: up
            SIMD4(-fx, 0, -fz, 0),         // Z: away from B
            SIMD4(a.x, a.y, a.z, 1)))
    }

    static func translation(_ t: SIMD3<Float>) -> simd_float4x4 {
        var m = matrix_identity_float4x4; m.columns.3 = SIMD4(t.x, t.y, t.z, 1); return m
    }
}

extension simd_float4x4 {
    func point(_ p: SIMD3<Float>) -> SIMD3<Float> { let v = self*SIMD4(p.x, p.y, p.z, 1); return SIMD3(v.x, v.y, v.z) }
    func direction(_ p: SIMD3<Float>) -> SIMD3<Float> { let v = self*SIMD4(p.x, p.y, p.z, 0); return SIMD3(v.x, v.y, v.z) }
    var position: SIMD3<Float> { SIMD3(columns.3.x, columns.3.y, columns.3.z) }
}
