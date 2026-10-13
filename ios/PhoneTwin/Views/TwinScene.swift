import Foundation
import SceneKit
import UIKit
import simd

/// What the 3D views should show, written by the AR thread and applied on the main thread.
struct SceneState {
    var worldFromS: simd_float4x4?          // nil: the scan is not placed in the room (not aligned / not tracking)
    var arOpacity: CGFloat = 0.55
    var twinView = false                    // 1st-person twin: hide the camera image
    var realA: SIMD3<Float>?, realB: SIMD3<Float>?   // world
    var aim: SIMD3<Float>?, aimIsA = true            // world
    var camS: SIMD3<Float>?, camFwdS: SIMD3<Float>?  // scan frame
    var intensity: Float = 0
    var hot = -1                            // 100+i: AI object i is the nearest thing
    var scanA: SIMD3<Float>?, scanB: SIMD3<Float>?
    var ai: [ScanData.Ai] = [], placed: [ScanData.Placed] = []
}

/// SceneKit content for the AR view (world coordinates) and the 3D map (scan frame S).
/// All node changes happen on the main thread.
final class TwinScene {
    let arScene = SCNScene(), orbitScene = SCNScene()
    // AR
    private let twinRoot = SCNNode(), arMarks = SCNNode(), liveRoot = SCNNode()
    private var arCloud: SCNNode?
    private let ringA = TwinScene.ring(0.08, .green), ringB = TwinScene.ring(0.08, .systemBlue), aimRing = TwinScene.ring(0.12, .green), aimDot = TwinScene.ring(0.03, .white)
    private let abLine = SCNNode()
    let dome: SCNNode
    // orbit
    private let orbitRoot = SCNNode(), orbitMarks = SCNNode()
    private var orbitCloud: SCNNode?
    private let phone = TwinScene.sphere(0.06, .cyan), heading = SCNNode()
    let orbitCamera = SCNNode()
    private(set) var orbitTarget = SIMD3<Float>(0, 0, 0)

    private var lastMarks: ([ScanData.Ai], [ScanData.Placed], SIMD3<Float>?, SIMD3<Float>?, Int)?

    init() {
        let sphere = SCNSphere(radius: 40)
        let m = SCNMaterial(); m.diffuse.contents = UIColor(red: 0.02, green: 0.03, blue: 0.05, alpha: 1); m.lightingModel = .constant
        m.cullMode = .front; m.writesToDepthBuffer = false; m.readsFromDepthBuffer = false
        sphere.materials = [m]
        dome = SCNNode(geometry: sphere); dome.renderingOrder = -100; dome.isHidden = true

        arScene.rootNode.addChildNode(twinRoot); twinRoot.addChildNode(arMarks); twinRoot.isHidden = true
        arScene.rootNode.addChildNode(liveRoot)
        for n in [ringA, ringB, aimRing, aimDot, abLine] { n.isHidden = true; arScene.rootNode.addChildNode(n) }

        orbitScene.background.contents = UIColor(red: 0.02, green: 0.03, blue: 0.05, alpha: 1)
        orbitScene.rootNode.addChildNode(orbitRoot); orbitRoot.addChildNode(orbitMarks)
        orbitRoot.addChildNode(phone); orbitRoot.addChildNode(heading); phone.isHidden = true
        let cam = SCNCamera(); cam.zNear = 0.05; cam.zFar = 1000; cam.fieldOfView = 60
        orbitCamera.camera = cam; orbitScene.rootNode.addChildNode(orbitCamera)
        orbitCamera.simdPosition = SIMD3(4, 3, 4); orbitCamera.simdLook(at: .zero)
    }

    // ------------------------------------------------------------------ geometry helpers
    static func material(_ c: UIColor) -> SCNMaterial {
        let m = SCNMaterial(); m.diffuse.contents = c; m.lightingModel = .constant; return m
    }
    static func ring(_ r: CGFloat, _ c: UIColor) -> SCNNode {
        let t = SCNTorus(ringRadius: r, pipeRadius: 0.004); t.materials = [material(c)]; return SCNNode(geometry: t)
    }
    static func sphere(_ r: CGFloat, _ c: UIColor, alpha: CGFloat = 1) -> SCNNode {
        let s = SCNSphere(radius: r); s.segmentCount = 16
        let m = material(c.withAlphaComponent(alpha)); if alpha < 1 { m.blendMode = .alpha; m.writesToDepthBuffer = false }
        s.materials = [m]; return SCNNode(geometry: s)
    }
    static func line(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: UIColor, into n: SCNNode) {
        let d = b - a, len = simd_length(d)
        if len < 1e-4 { n.isHidden = true; return }
        let cyl = SCNCylinder(radius: 0.004, height: CGFloat(len)); cyl.radialSegmentCount = 6; cyl.materials = [material(c)]
        n.geometry = cyl; n.isHidden = false
        n.simdPosition = (a + b)/2
        n.simdOrientation = simd_quatf(from: SIMD3(0, 1, 0), to: d/len)
    }
    static func label(_ text: String) -> SCNNode {
        let t = SCNText(string: text, extrusionDepth: 0); t.font = UIFont.systemFont(ofSize: 1, weight: .semibold); t.flatness = 0.05
        t.materials = [material(UIColor(red: 0.65, green: 0.95, blue: 0.99, alpha: 1))]
        let n = SCNNode(geometry: t)
        let (lo, hi) = t.boundingBox
        n.pivot = SCNMatrix4MakeTranslation((lo.x + hi.x)/2, lo.y, 0)
        n.scale = SCNVector3(0.09, 0.09, 0.09)
        n.constraints = [SCNBillboardConstraint()]
        return n
    }

    /// Point cloud geometry (positions relative to the node), constant colour per point.
    static func points(_ xyz: ArraySlice<Float>, _ rgb: ArraySlice<UInt8>, count: Int) -> SCNGeometry {
        let vdata = xyz.withUnsafeBufferPointer { Data(buffer: $0) }
        var col = [Float](repeating: 0, count: count*3)
        rgb.withUnsafeBufferPointer { c in for i in 0..<count*3 { col[i] = Float(c[i])/255 } }
        let cdata = col.withUnsafeBufferPointer { Data(buffer: $0) }
        var idx = [UInt32](repeating: 0, count: count)
        for i in 0..<count { idx[i] = UInt32(i) }
        let idata = idx.withUnsafeBufferPointer { Data(buffer: $0) }
        let vs = SCNGeometrySource(data: vdata, semantic: .vertex, vectorCount: count, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let cs = SCNGeometrySource(data: cdata, semantic: .color, vectorCount: count, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let el = SCNGeometryElement(data: idata, primitiveType: .point, primitiveCount: count, bytesPerIndex: 4)
        el.pointSize = 0.015; el.minimumPointScreenSpaceRadius = 1.5; el.maximumPointScreenSpaceRadius = 5
        let g = SCNGeometry(sources: [vs, cs], elements: [el])
        let m = SCNMaterial(); m.lightingModel = .constant; m.diffuse.contents = UIColor.white; m.isDoubleSided = true
        g.materials = [m]
        return g
    }

    // ------------------------------------------------------------------ content (main thread)
    /// Replaces the scan cloud in both views (geometry may be built on any thread).
    func setCloud(_ g: SCNGeometry?, center: SIMD3<Float>, extent: Float) {
        arCloud?.removeFromParentNode(); orbitCloud?.removeFromParentNode(); arCloud = nil; orbitCloud = nil
        if let g = g {
            let a = SCNNode(geometry: g); twinRoot.addChildNode(a); arCloud = a
            let o = SCNNode(geometry: g.copy() as? SCNGeometry ?? g); orbitRoot.addChildNode(o); orbitCloud = o
        }
        resetOrbit(center: center, extent: extent)
    }

    func resetOrbit(center: SIMD3<Float>, extent: Float) {
        let d = max(2, extent*1.1), yaw: Float = 0.8, pitch: Float = 0.7
        orbitTarget = center
        orbitCamera.simdPosition = center + d*SIMD3(cos(pitch)*sin(yaw), sin(pitch), cos(pitch)*cos(yaw))
        orbitCamera.simdLook(at: center)
    }

    func beginLive(shift: SIMD3<Float>) { liveRoot.childNodes.forEach { $0.removeFromParentNode() }; liveRoot.simdPosition = shift; liveRoot.isHidden = false }
    func addLive(_ g: SCNGeometry) { liveRoot.addChildNode(SCNNode(geometry: g)) }
    func endLive() { liveRoot.childNodes.forEach { $0.removeFromParentNode() }; liveRoot.isHidden = true }

    func apply(_ s: SceneState) {
        // scan placed in the room
        if let m = s.worldFromS { twinRoot.simdTransform = m; twinRoot.isHidden = false } else { twinRoot.isHidden = true }
        arCloud?.opacity = s.twinView ? 1 : s.arOpacity
        dome.isHidden = !s.twinView || s.worldFromS == nil
        // real floor marks and the aiming ring
        place(ringA, s.realA); place(ringB, s.realB)
        if let a = s.realA, let b = s.realB { TwinScene.line(a + SIMD3(0, 0.005, 0), b + SIMD3(0, 0.005, 0), .white, into: abLine) } else { abLine.isHidden = true }
        if let t = s.aim {
            (aimRing.geometry as? SCNTorus)?.materials = [TwinScene.material(s.aimIsA ? .green : .systemBlue)]
            place(aimRing, t); place(aimDot, t)
        } else { aimRing.isHidden = true; aimDot.isHidden = true }
        // markers in the scan frame (rebuilt only when they change)
        let key = (s.ai, s.placed, s.scanA, s.scanB, s.hot)
        if lastMarks == nil || lastMarks!.0 != key.0 || lastMarks!.1 != key.1 || lastMarks!.2 != key.2 || lastMarks!.3 != key.3 || lastMarks!.4 != key.4 {
            lastMarks = key
            for root in [arMarks, orbitMarks] {
                root.childNodes.forEach { $0.removeFromParentNode() }
                if let a = s.scanA { let n = TwinScene.sphere(0.05, .green); n.simdPosition = a; root.addChildNode(n) }
                if let b = s.scanB { let n = TwinScene.sphere(0.05, .systemBlue); n.simdPosition = b; root.addChildNode(n) }
                for o in s.placed { guard let c = ScanData.vec(o.c) else { continue }; let n = TwinScene.sphere(CGFloat(o.r), .orange, alpha: 0.5); n.simdPosition = c; root.addChildNode(n) }
                for (i, it) in s.ai.enumerated() {
                    guard let c = ScanData.vec(it.c) else { continue }
                    let hot = s.hot == 100 + i
                    let n = TwinScene.sphere(CGFloat(it.r), hot ? .systemOrange : .cyan, alpha: 0.35); n.simdPosition = c; root.addChildNode(n)
                    let l = TwinScene.label(AiLabels.korean(it.label)); l.simdPosition = c + SIMD3(0, it.r + 0.05, 0); root.addChildNode(l)
                }
            }
        }
        // phone in the 3D map
        if let p = s.camS {
            phone.isHidden = false; phone.simdPosition = p
            let i = CGFloat(s.intensity)
            (phone.geometry as? SCNSphere)?.materials = [TwinScene.material(UIColor(red: 0.1 + 0.9*i, green: 0.9*(1 - i), blue: 1 - i, alpha: 1))]
            if let f = s.camFwdS { TwinScene.line(p, f, .cyan, into: heading) }
        } else { phone.isHidden = true; heading.isHidden = true }
    }

    private func place(_ n: SCNNode, _ p: SIMD3<Float>?) {
        guard let p = p else { n.isHidden = true; return }
        n.isHidden = false; n.simdPosition = p + SIMD3(0, 0.005, 0)
    }
}
