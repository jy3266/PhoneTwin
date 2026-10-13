import Foundation
import simd

/// Top-down obstacle map for the walking test (port of the Android ObstacleMap). Every scan point between
/// "just above the floor" and "head height" is projected onto a 2D grid (x,z). A column with enough points
/// is an obstacle: a wall, furniture, an object. Walking distance questions are then cheap 2D lookups. Scan units.
final class ObstacleMap {
    let cell: Float, minX: Float, minZ: Float, floorY: Float
    let w: Int, h: Int
    private let occ: [Bool]
    let occupiedCells: Int

    private init(cell: Float, minX: Float, minZ: Float, w: Int, h: Int, occ: [Bool], count: Int, floorY: Float) {
        self.cell = cell; self.minX = minX; self.minZ = minZ; self.w = w; self.h = h; self.occ = occ; occupiedCells = count; self.floorY = floorY
    }

    /// floorY: floor height. Points with y in [floorY+lo, floorY+hi] count; a column needs minCount of them.
    static func build(_ c: ScanCloud, floorY: Float, lo: Float, hi: Float, cell cell0: Float, minCount: Int) -> ObstacleMap {
        let ex = c.hi.x - c.lo.x, ez = c.hi.z - c.lo.z
        let cell = max(cell0, sqrt(max(ex*ez, 1e-6)/4e6))          // at most ~4M cells
        let w = max(1, Int(ex/cell) + 1), h = max(1, Int(ez/cell) + 1)
        var count = [UInt16](repeating: 0, count: w*h)
        let y0 = floorY + lo, y1 = floorY + hi
        for i in 0..<c.n {
            let y = c.xyz[i*3+1]; if y < y0 || y > y1 { continue }
            let x = Int((c.xyz[i*3] - c.lo.x)/cell), z = Int((c.xyz[i*3+2] - c.lo.z)/cell)
            if x < 0 || z < 0 || x >= w || z >= h { continue }
            let k = z*w + x; if count[k] < UInt16.max { count[k] += 1 }
        }
        var occ = [Bool](repeating: false, count: w*h), n = 0
        for k in 0..<occ.count where Int(count[k]) >= minCount { occ[k] = true; n += 1 }
        return ObstacleMap(cell: cell, minX: c.lo.x, minZ: c.lo.z, w: w, h: h, occ: occ, count: n, floorY: floorY)
    }

    private func at(_ x: Int, _ z: Int) -> Bool { x >= 0 && z >= 0 && x < w && z < h && occ[z*w + x] }

    /// Horizontal distance to the nearest obstacle column (cell edge), searched up to maxR; also returns its centre (x,z).
    func nearest(_ px: Float, _ pz: Float, maxR: Float) -> (Float, SIMD2<Float>) {
        let cx = Int(floor((px - minX)/cell)), cz = Int(floor((pz - minZ)/cell)), r = Int(ceil(maxR/cell)) + 1
        var best = Float.infinity, out = SIMD2<Float>(px, pz)
        for dz in -r...r { for dx in -r...r {
            if !at(cx + dx, cz + dz) { continue }
            let qx = minX + (Float(cx + dx) + 0.5)*cell, qz = minZ + (Float(cz + dz) + 0.5)*cell
            let d = max(0, hypot(qx - px, qz - pz) - cell*0.5)
            if d < best { best = d; out = SIMD2(qx, qz) }
        } }
        return (best <= maxR ? best : .infinity, out)
    }

    /// Distance along the horizontal heading (dx,dz) to the first obstacle inside a corridor of the given
    /// half width, ignoring anything behind or beside the start. +infinity if the corridor is clear up to maxDist.
    func ahead(_ px: Float, _ pz: Float, _ dx0: Float, _ dz0: Float, maxDist: Float, halfWidth: Float) -> Float {
        let len = hypot(dx0, dz0); if len < 1e-6 { return .infinity }
        let dx = dx0/len, dz = dz0/len
        let reach = maxDist + halfWidth + cell
        let x0 = Int(floor((px - reach - minX)/cell)), x1 = Int(floor((px + reach - minX)/cell))
        let z0 = Int(floor((pz - reach - minZ)/cell)), z1 = Int(floor((pz + reach - minZ)/cell))
        var best = Float.infinity; let half = cell*0.5
        let zs = max(0, z0), ze = min(h - 1, z1), xs = max(0, x0), xe = min(w - 1, x1)
        if zs > ze || xs > xe { return .infinity }
        for z in zs...ze { for x in xs...xe {
            if !occ[z*w + x] { continue }
            let qx = minX + (Float(x) + 0.5)*cell - px, qz = minZ + (Float(z) + 0.5)*cell - pz
            let along = qx*dx + qz*dz - half, lat = abs(qx*dz - qz*dx) - half
            if along <= 0 || lat > halfWidth || along > maxDist { continue }
            if along < best { best = along }
        } }
        return best
    }

    /// Floor height estimate: the most populated 2 cm height band in the lower part of the scan.
    static func estimateFloor(_ c: ScanCloud) -> Float {
        let n = c.n; if n == 0 { return 0 }
        let minY = c.lo.y, maxY = c.hi.y, bin: Float = 0.02
        let bins = max(1, min(200_000, Int((maxY - minY)/bin) + 1))
        var hist = [Int](repeating: 0, count: bins)
        for i in 0..<n { let b = Int((c.xyz[i*3+1] - minY)/bin); if b >= 0 && b < bins { hist[b] += 1 } }
        var lo = 0, hi = bins - 1, acc = 0
        for b in 0..<bins { acc += hist[b]; if Double(acc) >= Double(n)*0.01 { lo = b; break } }
        acc = 0
        for b in stride(from: bins - 1, through: 0, by: -1) { acc += hist[b]; if Double(acc) >= Double(n)*0.01 { hi = b; break } }
        let top = max(lo, lo + Int(Float(hi - lo)*0.4)), start = max(0, lo - 5)
        var best = start
        if start <= top { for b in start...top where hist[b] > hist[best] { best = b } }
        var s = 0.0, k = 0; let centre = minY + (Float(best) + 0.5)*bin
        for i in 0..<n { let y = c.xyz[i*3+1]; if abs(y - centre) <= bin { s += Double(y); k += 1 } }
        return k == 0 ? centre : Float(s/Double(k))
    }
}
