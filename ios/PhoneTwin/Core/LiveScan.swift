import Foundation
import simd

/// Accumulates an in-app scan (port of the Android LiveScan). Points arrive in ARKit world coordinates
/// (Y up, metres) and are stored relative to the first point ("shift"), so the saved PLY reloads into the
/// same scan frame. Each voxel keeps a weighted running mean of every sample that fell into it
/// (weight = depth confidence / distance², so close, confident samples dominate). xyz/rgb hold the first
/// sample of each voxel for the live preview; toCloud() returns the means and can drop voxels that were
/// seen fewer than minHits times (single-frame noise, flying pixels).
final class LiveScan {
    let voxel: Float
    let capacity: Int
    private(set) var xyz: [Float]           // first sample per voxel (live preview)
    private(set) var rgb: [UInt8]
    private(set) var n = 0
    var uploaded = 0
    private(set) var colour = false
    private var sum: [Float], w: [Float], csum: [Float], cw: [Float], hitCount: [Int32]
    private var sx = 0.0, sy = 0.0, sz = 0.0
    private(set) var started = false
    private var table: [UInt64]             // open addressing set of voxel keys (+1, 0 = empty)
    private var slot: [Int32]               // voxel index for each table entry
    private let mask: Int

    init(voxel: Float, capacity: Int) {
        self.voxel = voxel; self.capacity = capacity
        xyz = [Float](repeating: 0, count: capacity*3); rgb = [UInt8](repeating: 0, count: capacity*3)
        sum = [Float](repeating: 0, count: capacity*3); w = [Float](repeating: 0, count: capacity)
        csum = [Float](repeating: 0, count: capacity*3); cw = [Float](repeating: 0, count: capacity)
        hitCount = [Int32](repeating: 0, count: capacity)
        var size = 16
        while size < capacity*2 { size <<= 1 }       // load factor <= 0.5
        table = [UInt64](repeating: 0, count: size); slot = [Int32](repeating: 0, count: size); mask = size - 1
    }

    var full: Bool { n >= capacity }
    var shift: SIMD3<Float> { SIMD3(Float(sx), Float(sy), Float(sz)) }
    func hits(_ i: Int) -> Int { Int(hitCount[i]) }

    /// World point + colour (0-255, or r < 0 for none) with a sample weight (> 0).
    /// Returns true if it filled a new voxel; samples in an existing voxel only refine its mean.
    @discardableResult
    func add(_ wx: Float, _ wy: Float, _ wz: Float, _ r: Int, _ g: Int, _ b: Int, weight: Float = 1) -> Bool {
        guard wx.isFinite, wy.isFinite, wz.isFinite, weight > 0 else { return false }
        if !started { sx = Double(wx); sy = Double(wy); sz = Double(wz); started = true }
        let x = Float(Double(wx) - sx), y = Float(Double(wy) - sy), z = Float(Double(wz) - sz)
        let ix = Int64((x/voxel).rounded()) + (1 << 20), iy = Int64((y/voxel).rounded()) + (1 << 20), iz = Int64((z/voxel).rounded()) + (1 << 20)   // first point sits at a voxel centre
        if ix < 0 || iy < 0 || iz < 0 || ix >= (1 << 21) || iy >= (1 << 21) || iz >= (1 << 21) { return false }
        let key = (UInt64(ix) << 42 | UInt64(iy) << 21 | UInt64(iz)) &+ 1
        var h = Int(truncatingIfNeeded: (key &* 0x9E37_79B9_7F4A_7C15) >> 40) & mask
        while table[h] != 0 {
            if table[h] == key { accumulate(Int(slot[h]), x, y, z, r, g, b, weight); return false }
            h = (h + 1) & mask
        }
        if full { return false }
        table[h] = key; slot[h] = Int32(n)
        xyz[n*3] = x; xyz[n*3+1] = y; xyz[n*3+2] = z
        if r >= 0 { colour = true; rgb[n*3] = UInt8(clamping: r); rgb[n*3+1] = UInt8(clamping: g); rgb[n*3+2] = UInt8(clamping: b) }
        else { rgb[n*3] = 170; rgb[n*3+1] = 170; rgb[n*3+2] = 170 }
        accumulate(n, x, y, z, r, g, b, weight)
        n += 1
        return true
    }

    private func accumulate(_ i: Int, _ x: Float, _ y: Float, _ z: Float, _ r: Int, _ g: Int, _ b: Int, _ weight: Float) {
        sum[i*3] += x*weight; sum[i*3+1] += y*weight; sum[i*3+2] += z*weight; w[i] += weight; hitCount[i] += 1
        if r >= 0 { csum[i*3] += Float(r)*weight; csum[i*3+1] += Float(g)*weight; csum[i*3+2] += Float(b)*weight; cw[i] += weight }
    }

    /// Weighted mean of every voxel seen at least minHits times.
    func toCloud(info: String, minHits: Int = 1) -> ScanCloud {
        // Voxel 0 is always written first at exactly (0,0,0): loaders re-centre on the first point, so this keeps
        // a reloaded PLY in the same frame as A/B, objects and AI observations.
        var k = 0
        for i in 0..<n where i == 0 || Int(hitCount[i]) >= minHits { k += 1 }
        var p = [Float](repeating: 0, count: k*3), c = [UInt8](repeating: 0, count: k*3)
        var o = 0
        for i in 0..<n {
            if i > 0 && Int(hitCount[i]) < minHits { continue }
            let wi = w[i]
            if i > 0 { p[o*3] = sum[i*3]/wi; p[o*3+1] = sum[i*3+1]/wi; p[o*3+2] = sum[i*3+2]/wi }
            if cw[i] > 0 { for j in 0..<3 { c[o*3+j] = UInt8(min(255, (csum[i*3+j]/cw[i]).rounded())) } }
            else { c[o*3] = 170; c[o*3+1] = 170; c[o*3+2] = 170 }
            o += 1
        }
        let cloud = ScanCloud(xyz: p, rgb: c, n: k, info: info)
        if !colour { cloud.heightColours() }
        return cloud
    }
}
