import SwiftUI
import ARKit
import SceneKit

/// Camera + AR content (scan overlay, floor marks). Always in the view tree so the AR session keeps its view.
struct ARViewContainer: UIViewRepresentable {
    let model: TwinModel

    func makeUIView(context: Context) -> ARSCNView {
        let v = ARSCNView(frame: .zero)
        v.session = model.session
        v.scene = model.scene.arScene
        v.automaticallyUpdatesLighting = false
        v.rendersContinuously = true
        v.pointOfView?.addChildNode(model.scene.dome)
        context.coordinator.view = v
        return v
    }

    func updateUIView(_ v: ARSCNView, context: Context) {
        // ARSCNView may replace its camera node; keep the "twin view" dome attached to it
        if let pov = v.pointOfView, model.scene.dome.parent !== pov { model.scene.dome.removeFromParentNode(); pov.addChildNode(model.scene.dome) }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { weak var view: ARSCNView? }
}

/// Third-person 3D map of the scan (orbit with one finger, zoom with two, tap to pick scan A/B).
struct OrbitViewContainer: UIViewRepresentable {
    let model: TwinModel

    func makeUIView(context: Context) -> SCNView {
        let v = SCNView(frame: .zero)
        v.scene = model.scene.orbitScene
        v.pointOfView = model.scene.orbitCamera
        v.allowsCameraControl = true
        v.defaultCameraController.interactionMode = .orbitTurntable
        v.defaultCameraController.inertiaEnabled = true
        v.backgroundColor = .black
        v.antialiasingMode = .none
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        v.addGestureRecognizer(tap)
        context.coordinator.model = model
        return v
    }

    func updateUIView(_ v: SCNView, context: Context) {
        let t = model.scene.orbitTarget
        if context.coordinator.target != t {
            context.coordinator.target = t
            v.pointOfView = model.scene.orbitCamera
            v.defaultCameraController.target = SCNVector3(t.x, t.y, t.z)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject {
        weak var model: TwinModel?
        var target: SIMD3<Float>?
        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let v = g.view as? SCNView, let m = model else { return }
            m.pick(at: g.location(in: v), in: v)
        }
    }
}

/// Share sheet for exporting the current scan.
enum Share {
    static func present(_ url: URL) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              var top = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
        while let p = top.presentedViewController { top = p }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = top.view
        top.present(vc, animated: true)
    }
}
