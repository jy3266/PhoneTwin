import Foundation
import simd

/// A scan as a point cloud in the internal "scan frame" S: right-handed, Y up, metres,
/// shifted so the first point is at (0,0,0). Same frame as the Android app (ScanLoader.Cloud).
final class ScanCloud {
    let xyz: [Float]          // n*3
    var rgb: [UInt8]          // n*3
    let n: Int
    let info: String
    let lo: SIMD3<Float>, hi: SIMD3<Float>

    init(xyz: [Float], rgb: [UInt8], n: Int, info: String) {
        self.xyz = xyz; self.rgb = rgb; self.n = n; self.info = info
        var a = SIMD3<Float>(repeating: .greatestFiniteMagnitude), b = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        for i in 0..<n {
            let p = SIMD3<Float>(xyz[i*3], xyz[i*3+1], xyz[i*3+2])
            a = simd_min(a, p); b = simd_max(b, p)
        }
        lo = a; hi = b
    }

    func point(_ i: Int) -> SIMD3<Float> { SIMD3(xyz[i*3], xyz[i*3+1], xyz[i*3+2]) }
    var center: SIMD3<Float> { (lo + hi)/2 }
    var extent: Float { let e = hi - lo; return max(e.x, max(e.y, e.z)) }

    /// Height gradient for scans without colour: floor blue → ceiling warm.
    func heightColours() {
        let span = max(1e-3, hi.y - lo.y)
        for i in 0..<n {
            let t = (xyz[i*3+1] - lo.y)/span
            rgb[i*3] = ScanLoader.c8(0.25 + 0.7*t); rgb[i*3+1] = ScanLoader.c8(0.55 + 0.3*(1 - abs(t - 0.5)*2)); rgb[i*3+2] = ScanLoader.c8(0.95 - 0.6*t)
        }
    }
}

struct ScanError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

/// Loads PLY (ascii / binary LE / binary BE, incl. Gaussian-splat f_dc colours), OBJ vertices and
/// XYZ/PTS/TXT/CSV text clouds, and writes the app's binary PLY. Port of the Android ScanLoader.
enum ScanLoader {
    static let maxPoints = 600_000
    static let supported: Set<String> = ["ply", "obj", "xyz", "pts", "txt", "csv"]

    static func c8(_ v: Float) -> UInt8 { UInt8((max(0, min(1, v))*255).rounded()) }

    static func load(url: URL, ext: String, zUp: Bool) throws -> ScanCloud {
        let e = ext.lowercased()
        let data = try Data(contentsOf: url, options: .alwaysMapped)
        if e == "ply" { return try ply(data, zUp: zUp) }
        if supported.contains(e) { return try text(data, obj: e == "obj", zUp: zUp) }
        throw ScanError("지원하지 않는 형식: .\(ext)")
    }

    /// Accumulates points; sub-sampling is decided by the caller.
    private final class Sink {
        var xyz: [Float], rgb: [UInt8]; let zUp: Bool; let capacity: Int
        var n = 0, colour = false
        var ox = 0.0, oy = 0.0, oz = 0.0, hasOrigin = false
        init(capacity: Int, zUp: Bool) {
            self.capacity = capacity; self.zUp = zUp
            xyz = [Float](repeating: 0, count: capacity*3); rgb = [UInt8](repeating: 0, count: capacity*3)
        }
        func add(_ x0: Double, _ y0: Double, _ z0: Double, _ r: Float, _ g: Float, _ b: Float) {
            guard n < capacity, x0.isFinite, y0.isFinite, z0.isFinite else { return }
            var x = x0, y = y0, z = z0
            if zUp { let t = y; y = z; z = -t }
            if !hasOrigin { ox = x; oy = y; oz = z; hasOrigin = true }
            xyz[n*3] = Float(x - ox); xyz[n*3+1] = Float(y - oy); xyz[n*3+2] = Float(z - oz)
            if r >= 0 { colour = true; rgb[n*3] = c8(r); rgb[n*3+1] = c8(g); rgb[n*3+2] = c8(b) }
            n += 1
        }
        func finish(_ info: String) throws -> ScanCloud {
            if n == 0 { throw ScanError("점 데이터를 찾지 못했습니다") }
            let c = ScanCloud(xyz: Array(xyz[0..<n*3]), rgb: Array(rgb[0..<n*3]), n: n, info: info)
            if !colour { c.heightColours() }
            return c
        }
    }

    private static func stepFor(_ count: Int) -> Int { max(1, (count + maxPoints - 1)/maxPoints) }

    // ---------------------------------------------------------------- PLY
    private enum PlyType {
        case i8, u8, i16, u16, i32, u32, f32, f64
        init(_ t: String) throws {
            switch t {
            case "char", "int8": self = .i8
            case "uchar", "uint8": self = .u8
            case "short", "int16": self = .i16
            case "ushort", "uint16": self = .u16
            case "int", "int32": self = .i32
            case "uint", "uint32": self = .u32
            case "float", "float32": self = .f32
            case "double", "float64": self = .f64
            default: throw ScanError("알 수 없는 PLY 형식: \(t)")
            }
        }
        var size: Int { switch self { case .i8, .u8: return 1; case .i16, .u16: return 2; case .i32, .u32, .f32: return 4; case .f64: return 8 } }
        /// Scale to 0..1 for colour channels stored as integers.
        var colourScale: Float { switch self { case .i8, .u8: return 1/255; case .i16, .u16: return 1/65535; default: return 1 } }
        func read(_ p: UnsafeRawBufferPointer, _ off: Int, _ be: Bool) -> Double {
            switch self {
            case .i8: return Double(Int8(bitPattern: p[off]))
            case .u8: return Double(p[off])
            case .i16: let v = p.loadUnaligned(fromByteOffset: off, as: UInt16.self); return Double(Int16(bitPattern: be ? v.byteSwapped : v))
            case .u16: let v = p.loadUnaligned(fromByteOffset: off, as: UInt16.self); return Double(be ? v.byteSwapped : v)
            case .i32: let v = p.loadUnaligned(fromByteOffset: off, as: UInt32.self); return Double(Int32(bitPattern: be ? v.byteSwapped : v))
            case .u32: let v = p.loadUnaligned(fromByteOffset: off, as: UInt32.self); return Double(be ? v.byteSwapped : v)
            case .f32: let v = p.loadUnaligned(fromByteOffset: off, as: UInt32.self); return Double(Float(bitPattern: be ? v.byteSwapped : v))
            case .f64: let v = p.loadUnaligned(fromByteOffset: off, as: UInt64.self); return Double(bitPattern: be ? v.byteSwapped : v)
            }
        }
    }

    static func ply(_ data: Data, zUp: Bool) throws -> ScanCloud {
        // header: ASCII lines up to and including "end_header\n"
        var lines: [String] = [], pos = 0, line = [UInt8]()
        let bytes = data
        while true {
            if pos >= bytes.count { throw ScanError("PLY 헤더가 끝나지 않았습니다") }
            let c = bytes[bytes.startIndex + pos]; pos += 1
            if c == 10 {
                let s = String(decoding: line, as: UTF8.self).trimmingCharacters(in: .whitespaces)
                lines.append(s); line.removeAll(keepingCapacity: true)
                if lines.count == 1 && s != "ply" { throw ScanError("PLY 파일이 아닙니다") }
                if s == "end_header" { break }
            } else if c != 13 {
                line.append(c)
                if line.count > 4096 { throw ScanError("PLY 헤더가 너무 깁니다") }
            }
        }
        var format: String?, count = -1, vertexSeen = false, inVertex = false
        var types: [PlyType] = [], names: [String] = []
        for l in lines.dropFirst() where l != "end_header" {
            let t = l.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            guard let k = t.first else { continue }
            if k == "format", t.count > 1 { format = t[1] }
            else if k == "element", t.count > 2 {
                inVertex = t[1] == "vertex"
                if inVertex { count = Int(t[2]) ?? -1; vertexSeen = true }
                else if !vertexSeen { throw ScanError("vertex 요소가 첫 번째가 아닌 PLY는 지원하지 않습니다") }
            } else if k == "property", inVertex, t.count > 2 {
                if t[1] == "list" { throw ScanError("vertex 안의 list 속성은 지원하지 않습니다") }
                types.append(try PlyType(t[1])); names.append(t[2])
            }
        }
        guard let fmt = format, count > 0 else { throw ScanError("PLY vertex 정보가 없습니다") }
        guard let ix = names.firstIndex(of: "x"), let iy = names.firstIndex(of: "y"), let iz = names.firstIndex(of: "z") else { throw ScanError("PLY에 x/y/z 속성이 없습니다") }
        var ir = names.firstIndex(of: "red"), ig = names.firstIndex(of: "green"), ib = names.firstIndex(of: "blue")
        if ir == nil { ir = names.firstIndex(of: "diffuse_red"); ig = names.firstIndex(of: "diffuse_green"); ib = names.firstIndex(of: "diffuse_blue") }
        let f0 = names.firstIndex(of: "f_dc_0"), f1 = names.firstIndex(of: "f_dc_1"), f2 = names.firstIndex(of: "f_dc_2")
        let rgb = ir != nil && ig != nil && ib != nil, splat = !rgb && f0 != nil && f1 != nil && f2 != nil
        let step = stepFor(count)
        let sink = Sink(capacity: min(maxPoints, (count + step - 1)/step), zUp: zUp)
        let sh0 = 0.28209479177387814

        if fmt == "ascii" {
            let body = String(decoding: bytes[(bytes.startIndex + pos)...], as: UTF8.self)
            var i = 0
            body.enumerateLines { l, stop in
                if i >= count { stop = true; return }
                defer { i += 1 }
                if i % step != 0 { return }
                let t = l.split(whereSeparator: { $0 == " " || $0 == "\t" })
                if t.count < names.count { return }
                func d(_ k: Int) -> Double { Double(t[k]) ?? .nan }
                var cr: Float = -1, cg: Float = 0, cb: Float = 0
                if rgb, let r = ir, let g = ig, let b = ib { cr = Float(d(r))*types[r].colourScale; cg = Float(d(g))*types[g].colourScale; cb = Float(d(b))*types[b].colourScale }
                else if splat, let a = f0, let b = f1, let c = f2 { cr = Float(0.5 + sh0*d(a)); cg = Float(0.5 + sh0*d(b)); cb = Float(0.5 + sh0*d(c)) }
                sink.add(d(ix), d(iy), d(iz), cr, cg, cb)
            }
        } else {
            let be: Bool
            if fmt == "binary_little_endian" { be = false }
            else if fmt == "binary_big_endian" { be = true }
            else { throw ScanError("알 수 없는 PLY format: \(fmt)") }
            var off = [Int](), stride = 0
            for t in types { off.append(stride); stride += t.size }
            bytes.withUnsafeBytes { (all: UnsafeRawBufferPointer) in
                var i = 0
                while i < count {
                    let start = pos + i*stride
                    if start + stride > all.count { break }
                    let rec = UnsafeRawBufferPointer(rebasing: all[start..<(start + stride)])
                    var cr: Float = -1, cg: Float = 0, cb: Float = 0
                    if rgb, let r = ir, let g = ig, let b = ib {
                        cr = Float(types[r].read(rec, off[r], be))*types[r].colourScale; cg = Float(types[g].read(rec, off[g], be))*types[g].colourScale; cb = Float(types[b].read(rec, off[b], be))*types[b].colourScale
                    } else if splat, let a = f0, let b = f1, let c = f2 {
                        cr = Float(0.5 + sh0*types[a].read(rec, off[a], be)); cg = Float(0.5 + sh0*types[b].read(rec, off[b], be)); cb = Float(0.5 + sh0*types[c].read(rec, off[c], be))
                    }
                    sink.add(types[ix].read(rec, off[ix], be), types[iy].read(rec, off[iy], be), types[iz].read(rec, off[iz], be), cr, cg, cb)
                    i += step
                }
            }
        }
        return try sink.finish("PLY \(fmt) · 원본 \(count.formatted())점 → \(sink.n.formatted())점\(splat ? " · 스플랫 색상" : "")")
    }

    // ---------------------------------------------------------------- OBJ / XYZ / PTS / CSV / TXT
    private static func numbers(_ raw: Substring, obj: Bool) -> [Double]? {
        var line = raw.trimmingCharacters(in: .whitespaces)
        if line.isEmpty { return nil }
        if obj {
            guard line.hasPrefix("v ") || line.hasPrefix("v\t") else { return nil }
            line = String(line.dropFirst(2))
        } else if line.hasPrefix("#") || line.hasPrefix("//") { return nil }
        let t = line.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "," || $0 == ";" })
        if t.count < 3 { return nil }
        var v = [Double]()
        for s in t.prefix(8) { guard let d = Double(s) else { return nil }; v.append(d) }
        return v
    }

    static func text(_ data: Data, obj: Bool, zUp: Bool) throws -> ScanCloud {
        let s = String(decoding: data, as: UTF8.self)
        let lines = s.split(omittingEmptySubsequences: true, whereSeparator: { $0 == "\n" || $0 == "\r" })
        var rows = [[Double]]()
        for l in lines { if let v = numbers(l, obj: obj) { rows.append(v) } }
        if rows.isEmpty { throw ScanError("점 데이터를 찾지 못했습니다") }
        let step = stepFor(rows.count)
        let sink = Sink(capacity: min(maxPoints, (rows.count + step - 1)/step), zUp: zUp)
        for i in stride(from: 0, to: rows.count, by: step) {
            let v = rows[i]
            var cr: Float = -1, cg: Float = 0, cb: Float = 0
            // OBJ: x y z [r g b] (0..1). Text clouds: x y z [i] r g b (0..1 or 0..255), colours are the last three.
            if v.count >= 6 {
                let c = obj ? 3 : v.count - 3
                let k = (v[c] > 1 || v[c+1] > 1 || v[c+2] > 1) ? 1/255.0 : 1
                cr = Float(v[c]*k); cg = Float(v[c+1]*k); cb = Float(v[c+2]*k)
            }
            sink.add(v[0], v[1], v[2], cr, cg, cb)
        }
        return try sink.finish("\(obj ? "OBJ 정점" : "텍스트 점군") · 원본 \(rows.count.formatted())점 → \(sink.n.formatted())점")
    }

    // ---------------------------------------------------------------- writer
    /// Binary little-endian PLY, Y up, metres, relative to the first point (PROTOCOL.md §2).
    static func writePly(_ c: ScanCloud, to url: URL) throws {
        var d = Data()
        d.reserveCapacity(200 + c.n*15)
        d.append(("ply\nformat binary_little_endian 1.0\ncomment PhoneTwin scan, Y up, metres\n" +
            "element vertex \(c.n)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n").data(using: .ascii)!)
        var rec = [UInt8](repeating: 0, count: 15)
        for i in 0..<c.n {
            for k in 0..<3 {
                let b = c.xyz[i*3+k].bitPattern.littleEndian
                rec[k*4] = UInt8(b & 0xff); rec[k*4+1] = UInt8((b >> 8) & 0xff); rec[k*4+2] = UInt8((b >> 16) & 0xff); rec[k*4+3] = UInt8(b >> 24)
            }
            rec[12] = c.rgb[i*3]; rec[13] = c.rgb[i*3+1]; rec[14] = c.rgb[i*3+2]
            d.append(contentsOf: rec)
        }
        try d.write(to: url, options: .atomic)
    }
}
