# Phone Twin v4 — 스캔 · 웹 · 언리얼(ARKO) · ESP32 UWB 연동

휴대폰으로 공간을 스캔하고, 스캔을 GitHub에 올려 **웹에서 보고**, **언리얼(ARKO_PROJECT)로 자동으로 가져와**,
휴대폰 또는 **ESP32(UWB 위치 + IMU 회전)** 의 위치로 사물과의 거리를 실시간 계산해 **진동과 소리**를 바꿉니다.

- 웹 뷰어: https://jy3266.github.io/PhoneTwin/
- 통신·저장 규격: [PROTOCOL.md](PROTOCOL.md)
- v3 앱(`studio.junoh.phonetwin`)은 그대로 두고, v4는 별도 앱(`studio.junoh.phonetwin.v4`, 이름 "Phone Twin v4")으로 함께 설치됩니다.

```
                 ┌──────────── GitHub (jy3266/PhoneTwin) ─────────────┐
 휴대폰 v4 ──스캔 업로드──▶ scans/*.ply·json ──────▶ GitHub Pages 웹 뷰어
     │                         │
     │                         └──자동 내려받기──▶ ARKO_PROJECT/PhoneTwinScans → Content 포인트클라우드 에셋
     │
     │  같은 Wi-Fi · UDP (2~10 ms)
     ├── PTP1 위치·방향 ─────────▶ 언리얼 :7777 ◀──────── PTE1 UWB 위치 + IMU ── ESP32
     ◀── PTH1 진동 세기 (:4211) ──┤  거리 계산 · 소리 재생 ├── PTH1 진동 세기 (:4210) ──▶ ESP32 진동 모터
```

## 0. 앱 설치 (안드로이드 · 아이폰)

| | 안드로이드 | 아이폰 |
|---|---|---|
| 설치 파일 | [`install/PhoneTwin-Android-v4.apk`](https://github.com/jy3266/PhoneTwin/raw/main/install/PhoneTwin-Android-v4.apk) | [`install/PhoneTwin-iOS-v4.ipa`](https://github.com/jy3266/PhoneTwin/raw/main/install/PhoneTwin-iOS-v4.ipa) |
| 다른 받는 곳 | [Releases v0.4.0](https://github.com/jy3266/PhoneTwin/releases/tag/v0.4.0) | [Releases v0.4.0](https://github.com/jy3266/PhoneTwin/releases/tag/v0.4.0) |
| 필요한 것 | Android 8.0 이상, ARCore 지원 기종 | iOS 16 이상 iPhone, Windows PC + USB 케이블 + Apple ID |
| 설치 방법 | 휴대폰에서 APK를 받아 바로 설치 | PC에서 Sideloadly로 설치 (Mac 필요 없음) |
| 유지 | 한 번 설치하면 끝 | 무료 Apple ID는 **7일마다 다시 설치** |
| 스캔 | Depth API 지원 기종은 컬러 고밀도 | LiDAR 있는 Pro 모델은 컬러 고밀도, 그 외는 성김 |

### 안드로이드

1. 휴대폰 브라우저에서 위 표의 **APK 링크**를 열어 내려받습니다(또는 PC에서 받아 USB로 휴대폰에 복사).
2. 내려받은 `PhoneTwin-Android-v4.apk`를 누릅니다. "출처를 알 수 없는 앱" 경고가 나오면 **설정 → 이 출처 허용**을 켜고 돌아와 **설치**를 누릅니다.
3. 앱 이름은 **Phone Twin v4**입니다. 예전 v3 앱과 따로 설치되므로 v3를 지울 필요가 없습니다.
4. 처음 실행하면 **카메라 권한**을 허용합니다. "Google Play 서비스 AR(ARCore)" 설치·업데이트 화면이 나오면 설치합니다.
5. 새 버전이 나오면 같은 방법으로 덮어 설치하면 됩니다(스캔·설정은 그대로 남음).

### 아이폰 (Windows PC에서 Sideloadly로)

App Store에 올린 앱이 아니라서, 내 Apple ID로 서명해 직접 설치합니다.

1. **PC 준비:** Windows에 **iTunes**(Microsoft Store 버전이 아닌 [Apple 웹사이트 버전](https://www.apple.com/kr/itunes/))와 **[Sideloadly](https://sideloadly.io/)**를 설치합니다.
2. PC에서 위 표의 **IPA 링크**로 `PhoneTwin-iOS-v4.ipa`를 내려받습니다.
3. 아이폰을 USB로 PC에 연결하고, 아이폰에 "이 컴퓨터를 신뢰하겠습니까?"가 나오면 **신뢰**를 누릅니다.
4. Sideloadly를 열고 IPA 파일을 창에 끌어다 놓습니다. 위쪽에서 연결된 아이폰을 고르고 **Apple account**에 Apple ID를 넣은 뒤 **Start**를 누릅니다(Apple ID 암호, 2단계 인증 코드를 물으면 입력).
5. "Done"이 나오면 아이폰에서:
   - 설정 → 일반 → **VPN 및 기기 관리** → 내 Apple ID → **신뢰**
   - 설정 → 개인정보 보호 및 보안 → **개발자 모드** 켜기 → 아이폰 재시동 후 "켜기" 확인
6. **Phone Twin v4** 앱을 열고 **카메라**를 허용합니다. 언리얼·ESP32로 처음 보낼 때 나오는 **로컬 네트워크** 접근도 허용합니다.
7. **7일 뒤 앱이 열리지 않으면** 3~4번을 다시 하면 됩니다(스캔·설정은 남음). 유료 Apple 개발자 계정($99/년)으로 설치하면 1년 동안 유지됩니다.

> 두 앱은 같은 스캔 파일·GitHub 저장소·언리얼·ESP32 신호를 씁니다. 안드로이드에서 찍어 올린 스캔을 아이폰에서 불러오거나 그 반대도 됩니다.

## v4에서 바뀐 것

| 요청 | 구현 |
|---|---|
| 스캔할 때만 전체화면, 끝나면 원래 화면 | 스캔 시작 시 상단바·설정창·시스템 바를 모두 숨기고, 카메라 화면 + 점 수 + `완료·저장`/`취소`만 남깁니다. 완료·취소·점 부족·저장 실패 어느 경우든 원래 UI로 돌아옵니다. |
| 화각이 좁아지는 문제, 넓은 렌즈 | ① ARCore가 허용하는 카메라 설정 중 **수평 화각이 가장 넓은 것**을 자동 선택(설정 0번에 화각°·렌즈 ID 표시). ② 스캔 중에는 카메라 영상을 **잘라내지 않고 전체를 표시**(위아래 검은 띠). 세로 화면에서 좌우로 약 1.6배 넓게 보입니다. ③ 깊이 모드를 켤 때 카메라 설정이 바뀌면 원래 설정으로 되돌립니다. |
| 스캔 정밀도 | 점 간격 2.5 → **1.5 cm**, 같은 칸의 측정값을 **신뢰도·거리 가중 평균**(한 번 찍힌 값이 아니라 여러 번의 평균), **2번 이상 관측된 칸만 저장**, 깊이 경계의 떠다니는 점 제거, 너무 빨리 움직인 프레임 제외, 깊이 픽셀 전부 사용, 최대 80만 점. |
| 웹 연동 · GitHub | 앱 설정 8번에서 스캔을 GitHub에 한 커밋으로 업로드 → GitHub Pages 웹 뷰어에서 3D로 보기(A·B, 사물, AI 사물 이름표 포함). |
| 언리얼 자동 반입 | ARKO_PROJECT에 C++ 플러그인 `PhoneTwinLink` 추가. 에디터가 켜져 있으면 90초마다 GitHub를 확인해 새 스캔(.ply/.json)을 `ARKO_PROJECT/PhoneTwinScans/`로 받고, Content 안에는 **LiDAR 포인트클라우드 에셋**(`/Game/PhoneTwinScans/<id>_Cloud`)을 만듭니다. Play를 누르면 가장 최근 스캔이 자동으로 뜹니다. |
| 휴대폰 ↔ ESP32 스위치 | 언리얼 화면 왼쪽 위 패널의 **[1] 휴대폰 / [2] ESP32** 버튼(키보드 1·2)으로 위치 입력 장치를 바꿉니다. |
| 거리 → 진동·소리 | 언리얼이 매 프레임 손(장치) 위치에서 가장 가까운 스캔 표면·사물까지 거리를 재고, 30 Hz로 진동 세기를 ESP32·휴대폰에 보냅니다. 사물마다 직접 만든 소리를 지정하면 가까워질수록 커집니다. |
| 블루투스 vs 웹, 가장 빠른 방식 | **같은 Wi-Fi 안의 UDP**를 선택했습니다(2~10 ms). BLE는 Windows에서 15~50 ms, 인터넷 경유 웹은 50~200 ms 이상입니다. GitHub는 실시간 신호에 쓸 수 없고 **스캔 파일 저장·공유 전용**입니다. 자세한 비교는 PROTOCOL.md §1. |

## 1. 휴대폰 앱

> **모든 반응은 위쪽 "🚶 걷기 테스트 시작"을 눌렀을 때만 시작합니다.** 정렬만 해 두면 아무것도 울리지 않고, 걷기 테스트를 시작하면 휴대폰 진동·사물 소리·ESP32 진동·언리얼 연동(위치 전송과 언리얼의 진동·소리)이 함께 켜지며, 종료하면 모두 멈춥니다. 휴대폰이 언리얼에 연결되어 있으면 언리얼의 ESP32 입력도 이 버튼을 기다립니다(휴대폰 없이 ESP32만 쓸 때는 바로 동작). "진동/ESP32 테스트(1초)" 버튼은 장치 점검용이라 예외입니다.
>
> **GitHub에 올린 스캔 다시 불러오기:** 설정 1번 또는 8번의 **☁ GitHub에 올린 스캔 불러오기…** → 목록(최신이 위)에서 고르면 스캔·A·B·사물·AI 사물이 함께 내려옵니다. 다른 장소에서 2번의 **현장 A·B**를 기록하면 그 스캔이 이 장소에 겹쳐지고, 정렬 결과의 "스캔 A–B / 현장 A–B · 차이 %"와 **AR 겹쳐보기**로 두 공간의 크기를 비교할 수 있습니다(크기 비교 때는 "스케일 보정"을 끄세요). 공개 저장소는 토큰 없이 읽습니다.

1. 앱을 설치합니다 — 안드로이드·아이폰 모두 위 **0. 앱 설치** 참고.
2. 스캔: 설정 ▼ → **0 · 스캔 시작** → 전체화면에서 벽·가구를 0.5~3 m 거리에서 천천히 훑기 → **완료·저장**.
   - 너무 빨리 움직이면 그 프레임은 버립니다. 천천히 돌수록 정밀해집니다.
   - "관측 횟수"를 3으로 올리면 잡음이 더 줄고, 1로 내리면 점이 늘어납니다.
3. **8 · GitHub 업로드**
   - GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate. Repository access: `jy3266/PhoneTwin`만, Permissions → **Contents: Read and write**.
   - 앱에 저장소 `jy3266/PhoneTwin`, 브랜치 `main`, 토큰을 넣고 **현재 스캔 업로드**(또는 "스캔 저장 후 자동 업로드" 체크).
   - 1~2분 뒤 웹 뷰어에 나타나고, 언리얼 에디터에는 다음 확인 주기(최대 90초)에 들어옵니다.
   - 토큰은 휴대폰 안에만 저장됩니다. 토큰을 코드나 저장소에 넣지 마세요.
4. **9 · 언리얼 연동**: PC의 IPv4(명령 프롬프트 `ipconfig`)를 넣고 **송신 시작**. "언리얼이 계산한 진동 사용"을 켜면 언리얼 값으로 진동합니다(신호가 끊기면 휴대폰 자체 계산으로 돌아감).

## 1-1. iPhone 앱 (`ios/`)

안드로이드 앱과 같은 기능의 iPhone 버전입니다(Swift · ARKit). 스캔 파일(PLY)·GitHub 스캔·언리얼(PTP1/PTH1)·ESP32 신호가 모두 같아서 웹·언리얼·ESP32는 그대로 씁니다.

- **설치:** 위 **0. 앱 설치 → 아이폰** 참고 (Windows PC + Sideloadly, Mac 필요 없음).
- **스캔:** LiDAR가 있는 iPhone(Pro 모델)은 컬러 고밀도 스캔, 그 외 기종은 특징점 스캔(성김)입니다.
- **다른 점:** AI 사물 인식은 안드로이드 앱만 합니다(인식된 사물은 GitHub 스캔을 불러오면 함께 들어와 소리가 납니다). 7번 Windows 모니터는 없습니다. ESP32에는 브로드캐스트 주소(x.x.x.255) 대신 실제 IP를 넣으세요. 처음 송신할 때 "로컬 네트워크" 접근을 허용하세요.
- **빌드:** `ios/`를 고쳐 push하면 GitHub Actions(`.github/workflows/ios.yml`)가 macOS에서 단위 테스트 후 IPA를 만듭니다(Actions 실행 결과의 Artifacts). Mac이 있으면 `brew install xcodegen && cd ios && xcodegen generate` 후 Xcode로 열어도 됩니다.

## 2. 언리얼 (ARKO_PROJECT)

ARKO_PROJECT에 이미 설치·빌드되어 있습니다(`Plugins/PhoneTwinLink`, `Source/`). 이 저장소의 `unreal/ARKO_PROJECT/`는 팀원 공유용 사본입니다.

1. 에디터를 다시 열면 됩니다. "모듈을 다시 빌드할까요?"가 뜨면 **예**(Visual Studio 2022 필요).
2. 아무 레벨에서 **Play** → 자동으로 `PhoneTwinScan_Auto` 액터가 생기고 가장 최근 스캔이 뜹니다. 왼쪽 위 패널:
   - **[1] 휴대폰 / [2] ESP32** — 입력 장치 스위치. 초록 = 신호 수신 중, 주황 = 선택했지만 신호 없음.
   - Play하면 **스캔 전체를 멀리서 내려다보는 카메라**로 시작합니다. **[V]** 보기 전환(전체 → 장치 시점 → 레벨 캐릭터), 전체 보기에서 **Q·E** 회전, **마우스 휠·Z·X** 거리.
   - **[ ]** 점 크기 줄이기·키우기(기본 0.7, 둥근 점, Per Point 크기 — 사물 윤곽이 또렷하게). Details > Scan의 `Point Size`·`Point Scaling`·`Round Points`로 고정.
   - 관객은 하늘색 기둥(바닥 → 장치 높이)으로, 전체 보기에서는 각 사물까지 바닥 거리선과 cm가 표시됩니다.
   - **[C]** 장치 시점으로 보기, **[H]** 템플릿 레벨 메쉬 숨기기, **[N]** 다음 스캔, **[G]** GitHub 동기화, **[M]** 마우스 커서(버튼 클릭용).
   - 콘솔: `PhoneTwin.Source esp32`, `PhoneTwin.Follow`, `PhoneTwin.NextScan`, 에디터에서 `PhoneTwin.Sync`, `PhoneTwin.ImportAll`.
3. 세부 조정은 레벨에 **Phone Twin Scan** 액터를 직접 놓고 Details에서 바꿉니다(직접 놓으면 자동 생성은 생기지 않음).
   - **Reaction**: 반응 시작 거리(기본 30 cm), 접촉 거리(3 cm), 손 위치 오프셋, 바닥 제외.
   - **Sound**: `Object Sounds`에 AI 라벨(`chair`, `potted plant` …) 또는 직접 놓은 사물 이름(`사물 1`) → 사운드 에셋. 없으면 `Default Object Sound`, 그것도 없으면 내장 비프음. `Surface Sound`는 아무 표면에 가까워질 때 진동 세기를 따라 커지는 소리.
   - **ESP32 Frame**: UWB 좌표계를 스캔에 맞추는 원점·회전·배율.
   - 블루프린트에서 `On Proximity`(거리, 세기, 사물 ID, 이름) 이벤트로 직접 효과를 붙일 수 있습니다.
4. 프로젝트 설정 → Plugins → **Phone Twin**: 저장소·브랜치·확인 주기·에셋 자동 생성·자동 생성 액터 끄기.
5. 방화벽: 처음 Play 때 Windows가 묻는 네트워크 허용을 **개인 네트워크 허용**으로 해 주세요(UDP 7777 수신).
6. **OSC (TouchDesigner)**: Details > OSC — `Send Osc`(기본 켬)로 관객 위치와 사물마다의 거리를 `127.0.0.1:7000`에 보냅니다(PROTOCOL.md §4). 같은 값을 릴레이에 `PTU1`로도 올려 웹 뷰어에서 관객이 움직이는 것이 보입니다.

## 2-0. 콜리전·소리 편집기

`콜리전_편집기.bat`을 더블클릭하면 브라우저에 편집기가 열립니다(Node.js 필요, 이 PC 안에서만 동작). 켤 때 새 스캔을 C:·D: 두 곳에 보관하고, 콜리전이 없는 스캔은 자동으로 만듭니다.

- 사물 선택: 왼쪽 목록이나 화면의 콜리전을 클릭. "손봐 주세요"가 붙은 것은 자동 구분이 불확실합니다.
- 모양: 지우기(2)·칠하기(3)·옮기기(4)·크기(5), 붓 크기, "이 자리에서 다시 찾기", "클릭해서 추가", "상자 추가". 되돌리기 Ctrl+Z, 시점은 오른쪽 버튼 드래그.
- 소리: 콜리전마다 "다가갈 때"(반복)와 "닿을 때"(한 번) 파일 넣기. mp3·wav 등 브라우저가 읽는 형식을 자동으로 WAV로 바꿉니다. 언리얼 에셋 경로(`/Game/…`)도 됩니다.
- 거리: "최대 크기 거리"부터 "들리기 시작 거리"까지 작아집니다. "거리 시험"을 켜고 바닥을 클릭하면 그 자리의 음량을 들어 볼 수 있습니다.
- 저장(Ctrl+S): 언리얼이 Play 중이어도 1초 안에 반영됩니다. 웹 사이트에 반영하려면 `web_scans/`를 GitHub에 올립니다.

언리얼: `B` 키로 모든 콜리전 보기. 전시에서 스캔을 고정하려면 실행 옵션 `-PhoneTwinScan=<id>`.

## 2-1. TouchDesigner (`touchdesigner/Phone_Twin_Project.toe`)

언리얼이 보낸 OSC(:7000)를 받아 **관객 위치·사물별 거리 표**, 위에서 본 **지도**, **움직임 신호**(속도·방향·에너지·사물별 근접도·다가오는 속도)를 만들고, 그 신호를 다시 OSC(:7001)로 보냅니다. TouchDesigner 안에서는 `signals_out` CHOP 채널(`speed`, `obj0_prox` …)로 바로 씁니다.
- `project1`의 **PhoneTwin** 파라미터 페이지: 입력 포트, 출력 주소·포트·속도, 근접 범위(cm), 부드럽게(초), 시뮬레이션.
- 시뮬레이션이 켜져 있으면 언리얼 신호가 1초 이상 없을 때 가짜 관객이 돌아다닙니다(신호가 오면 자동으로 실제 값). **전시 때는 끄세요.**
- 장비 없이 시험: `py tools\osc_test.py both` (언리얼 흉내로 :7000에 보내고 :7001 출력 확인).
- 네트워크를 다시 만들기: `py touchdesigner\make_toe.py --src <기존.toe> --out <새.toe>` (`td_core.py`가 네트워크의 파이썬 코드).

좌표: 스캔에 바닥 A·B가 있으면 A가 언리얼 원점(0,0,0), A→B가 +X, 위가 +Z입니다(단위 cm). 그래서 ESP32 UWB 앵커 0을 바닥 A에, 앵커 1을 B 방향에 두면 보정 없이 같은 공간이 됩니다.

## 3. ESP32 (팀원용) — `esp32/PhoneTwinUWB/PhoneTwinUWB.ino`

- 언리얼에서 받은 **PTH1**(UDP 4210)로 진동 모터 PWM 세기를 바꿉니다. 300 ms 동안 신호가 없으면 정지.
- 30 Hz로 **PTE1**(UWB 위치 m + IMU yaw/pitch/roll °)을 언리얼 PC `UNREAL_IP:7777`로 보냅니다.
- `readUwbPosition()`·`readImu()` 두 함수만 실제 센서 코드로 채우면 됩니다(DW3000/DWM1000, BNO055/MPU6050 등). 앵커까지 거리만 나오는 경우를 위한 최소제곱 삼변측량 함수가 들어 있습니다.
- `DEMO_MOTION 1`이면 센서 없이 원을 그리며 걷는 위치를 보내므로, 언리얼 쪽을 먼저 시험할 수 있습니다.
- 소리: 거리 값(`distanceMm`)과 세기(`intensity`)가 PTH1에 들어 있으니, ESP32 쪽 소리 모듈(DFPlayer 등)도 같은 값으로 제어할 수 있습니다. 언리얼 쪽 소리는 위 2-3의 `Object Sounds`.

## 3-1. 인터넷 릴레이 (DigitalOcean) — 같은 Wi-Fi에 있을 수 없을 때

GitHub는 실시간 신호를 못 나르므로, 실시간 신호는 DigitalOcean App Platform 위의 WebSocket 릴레이(`relay/`)로 보냅니다. App Platform은 UDP를 받지 않아 WebSocket(wss)을 씁니다.

| 경로 | 장치 → 언리얼 → 진동까지 | 언제 |
|---|---|---|
| 같은 Wi-Fi UDP (§1) | 약 10~20 ms | **전시 현장 기본** |
| DigitalOcean 릴레이 | 실측 260~295 ms (2026-10-11, 서울 PC ↔ phonetwin-relay-95wfh, 릴레이 왕복 약 141 ms). 싱가포르 리전이면 더 짧아질 것으로 예상 | 장치와 PC가 다른 네트워크 · 원격 시연 · 웹 실시간 보기 |

언리얼은 두 경로를 동시에 받으므로 둘 다 켜 두어도 됩니다.

**배포 (한 번만)**
1. [![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/jy3266/PhoneTwin/tree/main) — `.do/deploy.template.yaml`을 읽어 `relay/`를 싱가포르 리전에 올립니다(약 $5/월).
2. 환경 변수 `RELAY_KEY`를 아무도 모르는 긴 문자열로 바꿉니다. phone·ESP32·언리얼이 같은 값을 씁니다.
3. 배포가 끝나면 앱 주소(`https://phonetwin-relay-xxxxx.ondigitalocean.app`)를 확인합니다. `/health`를 열면 `{"ok":true…}`가 보입니다.
4. 저장소에 스캔이 올라올 때마다 릴레이가 재시작되지 않도록 자동 배포는 꺼 두었습니다. `relay/`를 고쳤을 때만 DigitalOcean 화면에서 **Deploy**를 누릅니다.

**연결**
- 언리얼: 프로젝트 설정 → Plugins → Phone Twin → **Relay**: URL `wss://…ondigitalocean.app`, Room `arko`, Key. HUD에 `릴레이: 연결됨 · phone=1 … · 왕복 xx ms`가 보입니다.
- 휴대폰: 설정 9번에서 "인터넷 릴레이"를 고르고 같은 URL·방·키를 넣습니다.
- ESP32: `USE_RELAY 1`, `RELAY_HOST`·`RELAY_KEY`를 채웁니다(Arduino 라이브러리 "WebSockets by Markus Sattler" 필요).
- 웹 뷰어: "실시간 위치" 패널에 URL·방을 넣으면 휴대폰·ESP32 위치와 진동 세기가 3D 위에 실시간으로 보입니다(읽기 전용, 키 불필요).
- UDP만 되는 장치는 PC에서 `node relay/bridge.js --url wss://… --key … --role esp32 --listen 7787`로 다리를 놓을 수 있습니다.

언리얼 설정 주의: 언리얼은 기본적으로 WebSocket을 초당 30번만 처리해, 초당 30번 오는 위치가 밀려 지연이 몇 초까지 늘어납니다. ARKO_PROJECT의 `Config/DefaultEngine.ini`에 `[WebSockets.LibWebSockets] ThreadTargetFrameTimeInSeconds=0.002`를 넣어 두었습니다(`unreal/ARKO_PROJECT/Config/PhoneTwin_ini_snippets.ini`). 이 설정 전후로 로컬 측정에서 지연이 1.5초까지 계속 늘던 것이 30 ms 안팎으로 고정되었습니다.

## 4. 장비 없이 시험

```bat
:: 언리얼에서 Play 한 상태로
py tools\pose_sim.py --target 127.0.0.1 --mode phone --meta scans\sample_test_room.json
py tools\pose_sim.py --target 127.0.0.1 --mode esp32 --meta scans\sample_test_room.json   :: 언리얼에서 [2] ESP32 선택
py tools\sync_scans.py --dry-run          :: GitHub → ARKO_PROJECT/PhoneTwinScans 수동 동기화
```
`scans/sample_test_room.*`은 PC에서 만든 시험용 가상 방(4.5 × 3.6 m, 빨간 구 = 사물 1, 의자 = AI 사물)입니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `android/` | v4 앱 소스 (`gradlew.bat testDebugUnitTest assembleDebug`) |
| `index.html`, `web/` | 웹 뷰어(three.js). GitHub Pages가 main 브랜치 루트를 그대로 배포 |
| `scans/` | 업로드된 스캔(앱이 자동으로 추가) |
| `unreal/ARKO_PROJECT/` | 언리얼 플러그인 `PhoneTwinLink` + 프로젝트 C++ 모듈 사본 |
| `esp32/PhoneTwinUWB/` | ESP32 UWB+IMU 송신 · 진동 수신 스케치 (`PhoneTwinHaptic/`는 v3 그대로) |
| `relay/`, `.do/` | DigitalOcean WebSocket 릴레이(`server.js`, 시험 `test.js`, UDP 다리 `bridge.js`)와 배포 설정 |
| `touchdesigner/` | `Phone_Twin_Project.toe`(OSC 입·출력 네트워크), `td_core.py`(네트워크 코드), `build_phonetwin_td.py`·`make_toe.py`(다시 만들기) |
| `tools/` | `pose_sim.py`(장치 흉내), `osc_test.py`(OSC 시험), `sync_scans.py`(수동 동기화), `make_sample_scan.py` |
| `windows/` | v1 Windows 모니터(선택) |

## 검증 범위 (2026-10-11)

확인함
- Android: 빌드 성공, 단위 테스트 19개 통과(가중 평균·관측 횟수 필터·PLY 재로드 좌표 일치·PTP1/PTH1 형식 등).
- 언리얼: UE 5.5에서 플러그인 컴파일, 자동화 테스트 4종 통과(PLY 읽기, 좌표 변환, 거리 격자, 패킷). 헤드리스 게임에서 시험 방을 띄우고 `pose_sim.py`로 실제 UDP 왕복 확인 — 휴대폰 모드와 ESP32 모드 모두 빨간 구에 다가가면 세기 0 → 59 → 133 → 204 → 255(접촉), 두 좌표계가 같은 결과.
- 웹: 로컬 서버 + 헤드리스 Chrome에서 시험 방·이름표·A/B 표시, 빈 상태 메시지 확인.

아직 못 함 (실기기 필요)
- 휴대폰 실행 전부: 전체화면 전환, 화각 선택 결과, 정밀도 개선 효과, 실제 GitHub 업로드, 휴대폰↔언리얼 UDP.
- ESP32 실제 컴파일·하드웨어(UWB/IMU 드라이버는 팀원이 채울 자리).
- 언리얼 에디터 화면(HUD 한글 표시·버튼)은 헤드리스로만 돌려 보았습니다.

## 한계

- ARCore는 대부분의 휴대폰에서 **메인 카메라 1개만** 씁니다. 초광각 렌즈를 강제로 쓸 수는 없고, 앱은 ARCore가 허용하는 것 중 가장 넓은 것을 고릅니다(0번 항목에 "선택 가능한 렌즈 1개"라고 나오면 그 기종의 한계입니다).
- 휴대폰 깊이 추정은 LiDAR보다 거칩니다(수 cm). 가중 평균으로 잡음은 줄지만 유리·검은 면의 구멍은 남습니다.
- 공개 저장소이므로 업로드한 스캔은 누구나 볼 수 있습니다. 비공개가 필요하면 저장소를 Private로 바꾸고(웹 뷰어는 유료 플랜 필요) 언리얼 PC에 `GITHUB_TOKEN` 환경 변수를 설정하세요.
- 시각장애 보조처럼 안전이 걸린 용도로 쓰면 안 됩니다. 스캔 뒤에 옮긴 물건·사람은 모릅니다.
