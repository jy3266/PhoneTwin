import SwiftUI

@main
struct PhoneTwinApp: App {
    @StateObject private var model = TwinModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .onChange(of: phase) { p in model.setActive(p == .active) }
        }
    }
}

/// Main screen: camera / 3D map, top bar (views + walking test), HUD, settings sheet; full-screen camera while scanning.
struct ContentView: View {
    @EnvironmentObject var model: TwinModel

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            GeometryReader { geo in
                // while scanning, show the whole camera image (letterboxed) instead of cropping it to the screen
                let size = model.scanningUI ? fit(geo.size) : geo.size
                ARViewContainer(model: model)
                    .frame(width: size.width, height: size.height)
                    .position(x: geo.size.width/2, y: geo.size.height/2)
            }
            .ignoresSafeArea()
            if model.viewMode == .orbit && !model.scanningUI && model.aimTarget == 0 {
                OrbitViewContainer(model: model).ignoresSafeArea()
            }
            if model.viewMode == .ar && !model.scanningUI {
                Text("+").font(.system(size: 44, weight: .light)).foregroundColor(model.floorHitUI ? .green : .white).allowsHitTesting(false)
            }
            if model.scanningUI { scanOverlay } else { mainOverlay }
        }
        .sheet(isPresented: $model.showSettings) {
            SettingsView().environmentObject(model).presentationDetents([.medium, .large])
        }
    }

    private func fit(_ s: CGSize) -> CGSize {
        let a = model.imageAspect, w = min(s.width, s.height*a)
        return CGSize(width: w, height: w/a)
    }

    private var mainOverlay: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("PHONE TWIN v4  ·  스캔 트윈 / 햅틱").font(.headline)
                Text(model.status).font(.caption2).foregroundColor(.gray).lineLimit(3)
                Picker("화면", selection: Binding(get: { model.viewMode }, set: { model.setView($0) })) {
                    Text("1인칭 트윈").tag(ViewMode.twin)
                    Text("AR 겹쳐보기").tag(ViewMode.ar)
                    Text("3인칭 지도").tag(ViewMode.orbit)
                }
                .pickerStyle(.segmented)
                Button { model.setWalk(!model.walkUI) } label: {
                    Text(model.walkUI ? "■ 걷기 테스트 종료" : "🚶 걷기 테스트 시작").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(model.walkUI ? .red : .blue)
            }
            .padding(10)
            .background(Color.black.opacity(0.72))
            Spacer()
            VStack(alignment: .leading, spacing: 8) {
                if model.aimTarget != 0 {
                    let ab = model.aimTarget == 1 ? "A" : "B"
                    Text("현장 \(ab) 조준 중 · 바닥 테이프 \(ab) 지점에 십자선을 맞추세요.\n바닥이 인식되면 십자선이 초록색이 되고 바닥에 원이 보입니다.")
                        .font(.footnote).foregroundColor(.yellow)
                    HStack {
                        Button("여기를 \(ab)로 기록") { model.recordAim() }.buttonStyle(.borderedProminent)
                        Button("취소") { model.exitAim() }.buttonStyle(.bordered)
                    }
                }
                if model.pickMode != 0 {
                    HStack {
                        Text("3인칭 지도에서 바닥의 스캔 \(model.pickMode == 1 ? "A" : "B") 지점을 탭하세요").font(.footnote).foregroundColor(.yellow)
                        Spacer()
                        Button("취소") { model.pickMode = 0 }.buttonStyle(.bordered)
                    }
                }
                Text(model.hud).font(.system(.footnote, design: .monospaced)).fixedSize(horizontal: false, vertical: true)
                Button { model.showSettings = true } label: { Text("설정 ▲").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
            }
            .padding(10)
            .background(Color.black.opacity(0.78))
        }
    }

    private var scanOverlay: some View {
        VStack {
            Text(model.hud + "\n" + model.status)
                .font(.system(.caption, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.black.opacity(0.55))
            Spacer()
            HStack(spacing: 16) {
                Button { model.requestScan(2) } label: { Text("완료·저장").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent)
                Button { model.requestScan(3) } label: { Text("취소").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
            }
            .padding(14)
            .background(Color.black.opacity(0.55))
        }
        .statusBarHidden(true)
    }
}
