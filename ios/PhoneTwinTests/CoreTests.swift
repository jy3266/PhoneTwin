import XCTest
import simd
@testable import PhoneTwin

/// Same cases as the Android unit tests (ScanTest, V4Test, RelayTest, GitHubScansTest, walking test),
/// so both apps read and write the same files and lines.
final class CoreTests: XCTestCase {
    private func temp(_ ext: String, _ data: Data) throws -> URL {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
        try data.write(to: u); return u
    }

    // ---------------------------------------------------------------- loaders
    func testAsciiPlyWithColours() throws {
        let ply = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n" +
            "1 2 3 255 0 0\n2 2 3 0 255 0\n1 4 4 0 0 255\n"
        let c = try ScanLoader.load(url: temp("ply", Data(ply.utf8)), ext: "ply", zUp: false)
        XCTAssertEqual(c.n, 3)
        XCTAssertEqual(c.xyz, [0, 0, 0, 1, 0, 0, 0, 2, 1])      // shifted so the first point is the origin
        XCTAssertEqual(c.rgb[0], 255); XCTAssertEqual(c.rgb[4], 255); XCTAssertEqual(c.rgb[8], 255)
    }

    func testBinaryPlyZUpAndDoubles() throws {
        var d = Data("ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty double x\nproperty double y\nproperty double z\nend_header\n".utf8)
        for v in [0.0, 0, 0, 1, 2, 3] { var x = v.bitPattern.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        let c = try ScanLoader.load(url: temp("ply", d), ext: "ply", zUp: true)
        XCTAssertEqual(c.n, 2)
        XCTAssertEqual(c.xyz[3], 1, accuracy: 1e-4); XCTAssertEqual(c.xyz[4], 3, accuracy: 1e-4); XCTAssertEqual(c.xyz[5], -2, accuracy: 1e-4)
    }

    func testBigEndianSplatColours() throws {
        var d = Data("ply\nformat binary_big_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nend_header\n".utf8)
        for v: Float in [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0] { var x = v.bitPattern.bigEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        let c = try ScanLoader.load(url: temp("ply", d), ext: "ply", zUp: false)
        XCTAssertEqual(c.n, 2); XCTAssertEqual(c.xyz[3], 3)
        XCTAssertEqual(c.rgb[0], 128)                             // f_dc = 0 → 0.5 grey
    }

    func testObjAndXyz() throws {
        XCTAssertEqual(try ScanLoader.load(url: temp("obj", Data("# x\nv 1 2 3\nvn 0 0 1\nv 4 5 6\nf 1 2 3\n".utf8)), ext: "obj", zUp: false).n, 2)
        let c = try ScanLoader.load(url: temp("xyz", Data("1,2,3,255,0,0\n// c\n2 3 4 0 255 0\n3;4;5;0;0;1\n".utf8)), ext: "xyz", zUp: false)
        XCTAssertEqual(c.n, 3); XCTAssertEqual(c.rgb[0], 255); XCTAssertEqual(c.rgb[4], 255)
    }

    func testRejectsGarbage() throws {
        XCTAssertThrowsError(try ScanLoader.load(url: temp("ply", Data("hello".utf8)), ext: "ply", zUp: false))
    }

    // ---------------------------------------------------------------- live scan
    func testLiveScanDedupsAndReloadsInSameFrame() throws {
        let ls = LiveScan(voxel: 0.02, capacity: 3)
        XCTAssertTrue(ls.add(10, 1.5, -3, 255, 0, 0))
        XCTAssertFalse(ls.add(10.005, 1.505, -3.005, 0, 255, 0))   // same 2 cm voxel: refines its mean, no new point
        XCTAssertTrue(ls.add(10.5, 1.5, -3, 0, 0, 255))
        XCTAssertEqual(ls.shift, SIMD3(10, 1.5, -3)); XCTAssertEqual(ls.n, 2)
        let c = ls.toCloud(info: "t")
        let u = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".ply")
        try ScanLoader.writePly(c, to: u)
        let r = try ScanLoader.load(url: u, ext: "ply", zUp: false)
        XCTAssertEqual(r.n, 2)
        XCTAssertEqual(r.xyz, c.xyz)                              // reload gives exactly the same scan-frame coordinates
        XCTAssertEqual(r.rgb, c.rgb)
        XCTAssertTrue(ls.add(11, 1.5, -3, 1, 1, 1)); XCTAssertTrue(ls.full)
        XCTAssertFalse(ls.add(12, 1.5, -3, 1, 1, 1))
    }

    func testVoxelKeepsWeightedMeanOfPositionAndColour() {
        let ls = LiveScan(voxel: 0.05, capacity: 10)
        XCTAssertTrue(ls.add(0, 2, 3, 50, 50, 50, weight: 1))   // first sample sets the shift; voxel 0 stays pinned at the origin
        XCTAssertTrue(ls.add(1.00, 2, 3, 100, 0, 0, weight: 1))
        XCTAssertFalse(ls.add(1.02, 2, 3, 200, 0, 0, weight: 3))  // same voxel, 3x weight
        XCTAssertEqual(ls.n, 2); XCTAssertEqual(ls.hits(1), 2)
        let c = ls.toCloud(info: "", minHits: 1)
        XCTAssertEqual(c.n, 2)
        XCTAssertEqual(c.xyz[3], 1.015, accuracy: 1e-5)
        XCTAssertEqual(c.rgb[3], 175)                             // (100*1 + 200*3) / 4
        XCTAssertEqual(ls.toCloud(info: "", minHits: 2).n, 2)     // voxel 0 is always kept; voxel 1 was seen twice
        XCTAssertEqual(ls.toCloud(info: "", minHits: 3).n, 1)
    }

    // ---------------------------------------------------------------- alignment
    func testAlignmentMapsAToOriginAndBForward() {
        let a = SIMD3<Float>(1, 0.2, 1), b = SIMD3<Float>(3, 0.2, 3)
        let m = Alignment.scanToLocal(a, b, scale: 1)!
        XCTAssertLessThan(simd_length(m.point(a)), 1e-5)
        XCTAssertLessThan(simd_length(m.point(b) - SIMD3(0, 0, -2.828427)), 1e-5)
        XCTAssertEqual(Alignment.scanToLocal(a, b, scale: 2)!.point(b).z, -5.656854, accuracy: 1e-5)
        // world frame from real marks: A is the origin, B lies along -Z of L
        let ra = SIMD3<Float>(-2, 0, 5), rb = SIMD3<Float>(-2, 0, 2)
        let w = Alignment.worldFromLocal(ra, rb)!
        XCTAssertLessThan(simd_length(w.point(SIMD3(0, 0, -3)) - rb), 1e-5)
        // scan A/B land exactly on real A/B (equal lengths)
        let sa = SIMD3<Float>(0, 0, 0), sb = SIMD3<Float>(3, 0, 0)
        let full = w*Alignment.scanToLocal(sa, sb, scale: 1)!
        XCTAssertLessThan(simd_length(full.point(sa) - ra), 1e-5)
        XCTAssertLessThan(simd_length(full.point(sb) - rb), 1e-5)
        XCTAssertNil(Alignment.scanToLocal(a, a, scale: 1))
    }

    // ---------------------------------------------------------------- walking test
    func testObstacleMapNearestAheadAndFloor() {
        // floor 4x4 m at y=0 plus a wall at x=2 (0.1..1.5 m high)
        var p = [Float]()
        for i in 0..<80 { for j in 0..<80 { p += [Float(i)*0.05, 0, Float(j)*0.05] } }
        for j in 0..<80 { for k in 2..<30 { p += [2, Float(k)*0.05, Float(j)*0.05] } }
        let c = ScanCloud(xyz: p, rgb: [UInt8](repeating: 0, count: p.count), n: p.count/3, info: "")
        XCTAssertEqual(ObstacleMap.estimateFloor(c), 0, accuracy: 0.02)
        let om = ObstacleMap.build(c, floorY: 0, lo: 0.12, hi: 1.9, cell: 0.05, minCount: 3)
        XCTAssertGreaterThan(om.occupiedCells, 0)
        let (near, _) = om.nearest(1.5, 2, maxR: 1)
        XCTAssertEqual(near, 0.5, accuracy: 0.06)
        XCTAssertEqual(om.ahead(1, 2, 1, 0, maxDist: 3, halfWidth: 0.25), 1, accuracy: 0.06)   // walking toward the wall
        XCTAssertTrue(om.ahead(1, 2, -1, 0, maxDist: 0.8, halfWidth: 0.25).isInfinite)         // walking away
        XCTAssertTrue(om.nearest(0.2, 2, maxR: 0.5).0.isInfinite)
    }

    // ---------------------------------------------------------------- protocol
    func testBuildsRelayUrl() {
        XCTAssertEqual(LinkProtocol.relayUrl(base: "https://a.ondigitalocean.app/", room: "arko", key: "k", role: "phone"), "wss://a.ondigitalocean.app/ws?room=arko&role=phone&key=k")
        XCTAssertEqual(LinkProtocol.relayUrl(base: "a.app", room: "", key: "", role: "phone"), "wss://a.app/ws?room=arko&role=phone&key=")
        XCTAssertEqual(LinkProtocol.relayUrl(base: "ws://127.0.0.1:8080/ws", room: "r 1", key: "a&b", role: "phone"), "ws://127.0.0.1:8080/ws?room=r+1&role=phone&key=a%26b")
        XCTAssertEqual(LinkProtocol.relayUrl(base: "http://h", room: "x", key: "", role: "phone"), "ws://h/ws?room=x&role=phone&key=")
    }

    func testPacketLines() {
        let h = LinkProtocol.parsePth1("PTH1,5,1,128,1,3,123\n")!
        XCTAssertTrue(h.valid); XCTAssertTrue(h.contact); XCTAssertEqual(h.object, 3)
        XCTAssertEqual(h.intensity, 128/255, accuracy: 1e-6); XCTAssertEqual(h.distance, 0.123, accuracy: 1e-6)
        XCTAssertTrue(LinkProtocol.parsePth1("PTH1,6,0,0,0,-1,-1")!.distance.isInfinite)
        XCTAssertNil(LinkProtocol.parsePth1("PTH1,1,2"))
        XCTAssertNil(LinkProtocol.parsePth1("PTE1,1,1,0,0,0,0"))
        var q = LinkProtocol.Pose(); q.valid = true; q.walk = true; q.p = SIMD3(1, 2, 3)
        XCTAssertEqual(LinkProtocol.ptp1(seq: 7, q, scanId: "a,b"), "PTP1,7,1,1.0000,2.0000,3.0000,0.0000,0.0000,-1.0000,0.0000,1.0000,0.0000,a_b,1\n")
        XCTAssertEqual(LinkProtocol.pth1(seq: 2, LinkProtocol.Haptic(valid: true, intensity: 1, contact: false, object: 0, distance: 0.25)), "PTH1,2,1,255,0,0,250\n")
        XCTAssertEqual(LinkProtocol.pth1(seq: 3, LinkProtocol.Haptic()), "PTH1,3,0,0,0,-1,-1\n")
    }

    func testMedianOfRtts() {
        XCTAssertTrue(LinkProtocol.median([]).isNaN)
        XCTAssertEqual(LinkProtocol.median([90, 50, 10]), 50)
    }

    // ---------------------------------------------------------------- GitHub
    func testIndexIsParsedNewestFirstAndUnsafeIdsDropped() throws {
        let json = #"{"version":1,"scans":[{"id":"phone_scan_20261011_1604","ply":"scans/phone_scan_20261011_1604.ply","meta":"scans/phone_scan_20261011_1604.json","points":64526},{"id":"../x"},{"id":"b"}]}"#
        let l = try GitHub.parseIndex(Data(json.utf8))
        XCTAssertEqual(l.count, 2)
        XCTAssertEqual(l[0].id, "phone_scan_20261011_1604"); XCTAssertEqual(l[0].points, 64526)
        XCTAssertEqual(l[1].ply, "scans/b.ply"); XCTAssertEqual(l[1].meta, "scans/b.json")
        XCTAssertTrue(try GitHub.parseIndex(Data("{}".utf8)).isEmpty)
    }

    func testMetaBecomesScanData() throws {
        let meta = #"{"a":[0.5,0,1],"b":[2,0,1],"objects":[{"id":3,"name":"x","c":[1,1,1],"r":0.3}],"ai":[{"label":"chair","name":"의자","c":[1,0.4,2],"r":0.5}]}"#
        let d = try GitHub.toScanData(meta: Data(meta.utf8))
        XCTAssertEqual(d.a?[0], 0.5); XCTAssertEqual(d.objects[0].id, 3)
        XCTAssertEqual(d.ai[0].label, "chair"); XCTAssertEqual(d.ai[0].hits, AiLabels.confirm)
        let none = try GitHub.toScanData(meta: Data(#"{"a":null,"b":null}"#.utf8))
        XCTAssertNil(none.a); XCTAssertTrue(none.ai.isEmpty)
        // the saved form round-trips
        XCTAssertEqual(ScanData.parse(d.json()), d)
    }

    func testMergeIndexAndScanId() throws {
        let old = Data(#"{"version":1,"scans":[{"id":"a"},{"id":"b"}]}"#.utf8)
        let merged = GitHub.mergeIndex(existing: old, entry: ["id": "b", "points": 5])
        let ids = (merged["scans"] as! [[String: Any]]).map { $0["id"] as! String }
        XCTAssertEqual(ids, ["b", "a"])
        XCTAssertEqual(GitHub.scanId("phone_scan 2026.ply"), "phone_scan_2026")
        XCTAssertEqual(GitHub.scanId(".ply"), "_ply")
        XCTAssertEqual(AiLabels.fileKey("dining table"), "dining_table")
        XCTAssertEqual(AiLabels.korean("chair"), "의자")
    }

    func testSoundGains() {
        let front = SoundMath.gains(d: 1, range: 4, near: 0.5, cosA: 1, sinA: 0)
        XCTAssertEqual(front.0, front.1, accuracy: 1e-5)
        let right = SoundMath.gains(d: 1, range: 4, near: 0.5, cosA: 0, sinA: 1)
        XCTAssertGreaterThan(right.1, right.0)
        XCTAssertEqual(SoundMath.gains(d: 5, range: 4, near: 0.5, cosA: 1, sinA: 0).0, 0)
    }
}
