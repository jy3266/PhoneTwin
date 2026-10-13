import SwiftUI
import UniformTypeIdentifiers

/// Settings, numbered like the Android app (0 스캔 … 9 언리얼; there is no 7 · Windows monitor on iPhone).
struct SettingsView: View {
    @EnvironmentObject var model: TwinModel
    @Environment(\.dismiss) private var dismiss

    @AppStorage("scale") private var useScale = false
    @AppStorage("zup") private var zUp = false
    @AppStorage("aisound") private var soundOn = true
    @AppStorage("vibe") private var vibe = true
    @AppStorage("tone") private var tone = false
    @AppStorage("esphost") private var espHost = ""
    @AppStorage("espport") private var espPort = 4210
    @AppStorage("gh_repo") private var ghRepo = "jy3266/PhoneTwin"
    @AppStorage("gh_branch") private var ghBranch = "main"
    @AppStorage("gh_auto") private var ghAuto = false
    @AppStorage("ue_relay") private var viaRelay = false
    @AppStorage("ue_host") private var ueHost = ""
    @AppStorage("ue_port") private var uePort = 7777
    @AppStorage("relay_url") private var relayUrl = ""
    @AppStorage("relay_room") private var relayRoom = "arko"
    @AppStorage("ue_haptic") private var ueHaptic = true
    @State private var ghToken = Keychain.get("gh_token")
    @State private var relayKey = Keychain.get("relay_key")

    private enum Importing { case scan, sound(String) }
    @State private var importing: Importing?
    @State private var showImporter = false
    @State private var showLabels = false

    var body: some View {
        NavigationStack {
            Form {
                scanSection; fileSection; alignSection; walkSection; soundSection; vibeSection; espSection; gitHubSection; unrealSection
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("완료") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                }
            }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: importerTypes) { result in
            guard case .success(let url) = result, let what = importing else { return }
            switch what {
            case .scan: model.importScan(url)
            case .sound(let label): model.importSound(label: label, from: url)
            }
        }
        .sheet(item: $model.ghChoices) { c in GitHubListView(choices: c) { e in model.ghChoices = nil; model.downloadGitHubScan(e) } }
        .sheet(isPresented: $showLabels) {
            LabelListView { label in
                showLabels = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { pick(.sound(label)) }
            }
        }
    }

    private var importerTypes: [UTType] {
        if case .some(.sound) = importing { return [.audio] }
        return [.item]
    }
    private func pick(_ what: Importing) { importing = what; showImporter = true }

    private func note(_ s: String) -> some View { Text(s).font(.caption2).foregroundColor(.gray) }
    private func info(_ s: String) -> some View { Text(s).font(.caption).textSelection(.enabled) }

    // ---------------------------------------------------------------- 0
    private var scanSection: some View {
        Section {
            Button("스캔 시작") { model.requestScan(1) }
            info(model.liveInfo)
            NumberRow("스캔 최대 거리 (m)", key: "scanrange2", def: 5, range: 0.5...8)
            NumberRow("스캔 점 간격 (m)", key: "scanvoxel3", def: 0.015, range: 0.005...0.1)
            NumberRow("깊이 신뢰도 최소 (0~1)", key: "scanconf", def: 0.6, range: 0.1...0.95)
            NumberRow("점 확정에 필요한 관측 횟수", key: "scanhits", def: 2, range: 1...10)
            info(model.camInfo)
            note("LiDAR 신뢰도는 낮음·중간·높음 3단계입니다: 0.5 이상이면 '높음'만, 0.2~0.5면 '중간' 이상, 그보다 낮으면 전부 씁니다.")
            note("스캔을 시작하면 화면 전체가 카메라 화면이 되고, 카메라 영상이 잘리지 않게 전체 화각을 보여 줍니다. 같은 자리를 여러 번 비출수록 점 위치가 평균으로 다듬어지고, 한 번만 찍힌 잡음 점은 저장할 때 빠집니다. 너무 빨리 움직이면 흔들린 프레임은 건너뜁니다.")
            note("먼저 아래 2번의 '현장 A·B 기록'을 해 두고 스캔하면, A·B가 스캔에 자동으로 저장됩니다. 벽과 가구를 0.5~3m 거리에서 천천히 훑으세요. 저장한 스캔은 '파일' 앱 > 나의 iPhone > Phone Twin v4 에도 복사됩니다.")
        } header: { Text("0 · 휴대폰으로 바로 스캔") }
    }

    // ---------------------------------------------------------------- 1
    private var fileSection: some View {
        Section {
            Button("스캔 파일 열기 (PLY/OBJ/XYZ)") { pick(.scan) }
            Button(zUp ? "위쪽 축: Z (CloudCompare·LAS) · 눌러서 바꾸기" : "위쪽 축: Y (Polycam·Scaniverse) · 눌러서 바꾸기") { model.toggleUpAxis() }
            Button("☁ GitHub에 올린 스캔 불러오기…") { model.chooseGitHubScan() }
            Button("현재 스캔 내보내기 (PLY 저장·공유)") { if let u = model.exportURL() { Share.present(u) } }
            info(model.scanInfo)
        } header: { Text("1 · 3D 스캔 파일 불러오기 / 내보내기") }
    }

    // ---------------------------------------------------------------- 2
    private var alignSection: some View {
        Section {
            HStack {
                Button("스캔에서 A 탭") { model.startPick(1) }.buttonStyle(.bordered)
                Spacer()
                Button("스캔에서 B 탭") { model.startPick(2) }.buttonStyle(.bordered)
            }
            HStack {
                Button("현장 A 조준·기록") { model.enterAim(1) }.buttonStyle(.bordered)
                Spacer()
                Button("현장 B 조준·기록") { model.enterAim(2) }.buttonStyle(.bordered)
            }
            Toggle("A–B 실측 거리로 스케일 보정 (사진측량 스캔용)", isOn: $useScale)
            info(model.alignInfo)
            note("바닥에 테이프로 A·B(1m 이상, 가능하면 2~3m 간격)를 표시 → 3인칭 지도에서 같은 지점을 탭 → '현장 A 조준·기록'을 누르면 카메라 화면이 열립니다. 십자선과 바닥의 원을 테이프에 맞추고 '여기를 A로 기록'을 누르세요.")
        } header: { Text("2 · 정렬: 바닥의 두 점 A·B") }
    }

    // ---------------------------------------------------------------- 3
    private var walkSection: some View {
        Section {
            NumberRow("주변 경고 거리 (m)", key: "walkrange", def: 0.6, range: 0.1...3)
            NumberRow("앞 막힘 감지 거리 (m)", key: "lookahead", def: 1.5, range: 0.3...5)
            NumberRow("몸 폭의 절반 (m)", key: "bodyhalf", def: 0.25, range: 0.05...1)
            NumberRow("걷기 접촉 판정 거리 (m)", key: "walkcontact", def: 0.2, range: 0...1)
            NumberRow("장애물로 볼 최대 높이 (m)", key: "obstop", def: 1.9, range: 0.3...4) { model.rebuildObstaclesFromUI() }
            note("위쪽 '걷기 테스트 시작'을 누르고 휴대폰을 들고 걸으세요. 바닥 위 12cm~최대 높이 사이의 스캔 점을 장애물로 봅니다. 주변에 벽·사물이 가까우면 연속 진동, 앞이 막혀 있으면 가까워질수록 빨라지는 톡톡 진동이 옵니다.")
        } header: { Text("3 · 걷기 테스트 (스캔한 공간을 들고 걸어 보기)") }
    }

    // ---------------------------------------------------------------- 4
    private var soundSection: some View {
        Section {
            Toggle("사물에 가까워지면 소리 재생", isOn: $soundOn)
            NumberRow("소리가 들리기 시작하는 거리 (m)", key: "soundrange", def: 4, range: 0.5...15)
            let groups = Dictionary(grouping: model.aiItems, by: { $0.label })
            let labels = model.aiItems.map(\.label).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
            if labels.isEmpty { info("인식된 사물 없음 · 안드로이드 앱이 인식한 사물은 GitHub 스캔을 불러오면 함께 들어옵니다") }
            ForEach(labels, id: \.self) { lab in
                HStack {
                    VStack(alignment: .leading) {
                        Text("\(AiLabels.korean(lab)) ×\(groups[lab]?.count ?? 0)")
                        let s = Prefs.soundName(AiLabels.fileKey(lab))
                        Text("소리: \(s.isEmpty ? "기본" : s)").font(.caption).foregroundColor(.gray)
                    }
                    Spacer()
                    Button("소리 지정") { pick(.sound(lab)) }.buttonStyle(.bordered)
                    Button("삭제") { model.removeAiLabel(lab) }.buttonStyle(.bordered).tint(.red)
                }
            }
            let def = Prefs.soundName("default")
            info("기본 소리: \(def.isEmpty ? "내장 신호음" : def)")
            HStack {
                Button("다른 사물에 소리 지정…") { showLabels = true }.buttonStyle(.bordered)
                Spacer()
                Button("기본 소리 지정") { pick(.sound("default")) }.buttonStyle(.bordered)
            }
            Button("AI 사물 전체 삭제", role: .destructive) { model.clearAi() }
            if !model.soundInfo.isEmpty { info(model.soundInfo) }
            note("아이폰 앱은 사물을 직접 인식하지 않습니다(인식은 안드로이드 앱). 안드로이드 스캔을 GitHub에서 불러오면 인식된 사물과 위치가 함께 들어오고, 걷기 테스트 중 가까워지면 소리가 납니다. 소리 파일은 mp3·wav·m4a·aiff가 됩니다. 이어폰을 쓰면 왼쪽·오른쪽 방향도 들립니다.")
        } header: { Text("4 · 사물 소리") }
    }

    // ---------------------------------------------------------------- 5
    private var vibeSection: some View {
        Section {
            Toggle("휴대폰 진동", isOn: $vibe)
            Toggle("근접음 (사물마다 음높이 다름)", isOn: $tone)
            Button("진동/ESP32 테스트 (1초)") { model.feedback.test() }
        } header: { Text("5 · 진동과 근접음") }
    }

    // ---------------------------------------------------------------- 6
    private var espSection: some View {
        Section {
            TextField("ESP32 IP (예: 192.168.0.50)", text: $espHost).keyboardType(.numbersAndPunctuation).autocorrectionDisabled().textInputAutocapitalization(.never)
            HStack { Text("포트"); TextField("4210", value: $espPort, format: .number.grouping(.never)).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
            HStack {
                Button("ESP32 송신 시작") { model.startEsp(host: espHost, port: espPort) }.buttonStyle(.borderedProminent)
                Spacer()
                Button("중지") { model.feedback.setEsp(on: false) }.buttonStyle(.bordered)
            }
            info(model.espInfo)
            note("처음 송신할 때 '로컬 네트워크' 접근을 허용하세요. iPhone은 x.x.x.255 같은 브로드캐스트 주소로 보낼 수 없으니 ESP32의 실제 IP를 넣으세요.")
        } header: { Text("6 · ESP32 손목 장치 (UDP)") }
    }

    // ---------------------------------------------------------------- 8
    private var gitHubSection: some View {
        Section {
            TextField("저장소 owner/name", text: $ghRepo).autocorrectionDisabled().textInputAutocapitalization(.never)
            TextField("브랜치", text: $ghBranch).autocorrectionDisabled().textInputAutocapitalization(.never)
            SecureField("GitHub 토큰 (github_pat_…)", text: $ghToken).onChange(of: ghToken) { Keychain.set("gh_token", $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            Toggle("스캔 저장 후 자동 업로드", isOn: $ghAuto)
            HStack {
                Button("현재 스캔 업로드") { model.uploadScan() }.buttonStyle(.borderedProminent).disabled(model.uploading)
                Spacer()
                Button("☁ 올린 스캔 불러오기…") { model.chooseGitHubScan() }.buttonStyle(.bordered)
            }
            info(model.ghStatus)
            note("업로드하면 웹 뷰어(GitHub Pages)와 언리얼 ARKO_PROJECT가 이 스캔을 자동으로 가져갑니다. 토큰은 GitHub → Settings → Developer settings → Fine-grained tokens에서 이 저장소 하나만 고르고 Contents 권한을 Read and write로 만들어 붙여 넣으세요. 토큰은 이 iPhone의 키체인에만 저장됩니다. 불러오기는 토큰 없이도 됩니다.")
        } header: { Text("8 · GitHub 업로드 (웹·언리얼 공유)") }
    }

    // ---------------------------------------------------------------- 9
    private var unrealSection: some View {
        Section {
            Picker("방식", selection: $viaRelay) {
                Text("같은 Wi-Fi (UDP, 빠름 · 약 5ms)").tag(false)
                Text("인터넷 릴레이 (DigitalOcean, 느림 · 약 100ms 이상)").tag(true)
            }
            .pickerStyle(.inline)
            if viaRelay {
                TextField("릴레이 주소 (예: wss://phonetwin-relay-xxxx.ondigitalocean.app)", text: $relayUrl).keyboardType(.URL).autocorrectionDisabled().textInputAutocapitalization(.never)
                TextField("방 이름 (언리얼·ESP32와 같게)", text: $relayRoom).autocorrectionDisabled().textInputAutocapitalization(.never)
                SecureField("릴레이 키 (서버의 RELAY_KEY)", text: $relayKey).onChange(of: relayKey) { Keychain.set("relay_key", $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            } else {
                TextField("언리얼 PC IPv4 (예: 192.168.0.10)", text: $ueHost).keyboardType(.numbersAndPunctuation).autocorrectionDisabled().textInputAutocapitalization(.never)
                HStack { Text("포트"); TextField("7777", value: $uePort, format: .number.grouping(.never)).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
            }
            HStack {
                Button("송신 시작") { model.startUnreal(relay: viaRelay, host: ueHost, port: uePort, relayUrl: relayUrl, room: relayRoom, key: relayKey) }.buttonStyle(.borderedProminent)
                Spacer()
                Button("중지") { model.unreal.stop() }.buttonStyle(.bordered)
            }
            Toggle("언리얼이 계산한 진동 사용 (UDP 4211 또는 릴레이로 수신)", isOn: $ueHaptic)
            info(model.unrealInfo)
            note("휴대폰 위치·방향(PTP1)을 30Hz로 언리얼 PC에 보냅니다. 언리얼이 거리를 계산해 진동 세기(PTH1)를 돌려주면 그 값으로 진동하고, 신호가 끊기면 휴대폰이 직접 계산한 값으로 돌아갑니다. Wi-Fi 방식은 PC와 같은 Wi-Fi에 연결하고, 처음 송신할 때 '로컬 네트워크' 접근을 허용하세요. 같은 Wi-Fi가 안 되는 곳에서는 릴레이 방식을 고르고 릴레이 주소·방 이름·키를 넣으세요(언리얼 프로젝트 설정의 Relay 값과 같게).")
        } header: { Text("9 · 언리얼 연동 (UDP / 인터넷 릴레이)") }
    }
}

/// Number setting; applied while typing when within range (red when not).
struct NumberRow: View {
    let caption: String
    let range: ClosedRange<Double>
    let onChange: (() -> Void)?
    @AppStorage private var value: Double
    @State private var text = ""
    @State private var bad = false

    init(_ caption: String, key: String, def: Double, range: ClosedRange<Double>, onChange: (() -> Void)? = nil) {
        self.caption = caption; self.range = range; self.onChange = onChange
        _value = AppStorage(wrappedValue: def, key)
    }

    var body: some View {
        HStack {
            Text(caption).font(.subheadline)
            Spacer()
            TextField("", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
                .foregroundColor(bad ? .red : .primary)
                .onAppear { text = String(format: "%g", value) }
                .onChange(of: text) { t in
                    if let v = Double(t.replacingOccurrences(of: ",", with: ".")), range.contains(v) {
                        bad = false
                        if v != value { value = v; onChange?() }
                    } else { bad = true }
                }
        }
    }
}

/// Scans listed in scans/index.json (newest first).
struct GitHubListView: View {
    let choices: TwinModel.GhChoices
    let onPick: (GitHub.Entry) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(choices.entries, id: \.id) { e in
                Button { onPick(e) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text((e.id == choices.current ? "● " : "") + e.id).font(.body)
                        Text("\(e.created.count >= 16 ? String(e.created.prefix(16)).replacingOccurrences(of: "T", with: " ") : e.created) · \(e.points.formatted())점\(e.device.isEmpty ? "" : " · " + e.device)")
                            .font(.caption).foregroundColor(.gray)
                    }
                }
            }
            .navigationTitle("불러올 스캔 (최신이 위)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
    }
}

/// All detector labels, to give an object a sound before it was recognised.
struct LabelListView: View {
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(AiLabels.labels, id: \.self) { l in
                Button {
                    onPick(l)
                } label: {
                    let s = Prefs.soundName(AiLabels.fileKey(l))
                    Text("\(AiLabels.korean(l)) (\(l))" + (s.isEmpty ? "" : "  ♪ \(s)"))
                }
            }
            .navigationTitle("소리를 지정할 사물")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
    }
}
