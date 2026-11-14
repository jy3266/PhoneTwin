# Phone Twin v4 — 통신·저장 규격

앱, 언리얼(ARKO_PROJECT), ESP32, 웹 뷰어가 모두 이 문서를 기준으로 맞춥니다.

## 1. 실시간 통신: 같은 Wi-Fi 안의 UDP

| 방식 | 한 방향 지연(대략) | 판단 |
|---|---|---|
| **UDP, 같은 공유기/ESP32 SoftAP** | 2~10 ms | **채택.** 가장 빠르고 언리얼(Sockets 모듈)·ESP32·Android 모두 기본 지원 |
| BLE | 15~50 ms (Windows 연결 간격) | Windows 쪽 구현이 복잡하고 느림. ESP32-S3/C3는 클래식 BT 없음 |
| WebSocket(인터넷 경유) | 50~200 ms 이상 | 서버 경유라 느림 |
| GitHub | 수 초~수 분 | 실시간 통신 불가. **스캔 파일 저장·공유 전용** |

GitHub는 신호 통신에 쓰지 않습니다. 실시간 신호는 전부 LAN UDP이고, GitHub는 스캔 파일을 웹사이트·언리얼로 옮기는 저장소입니다.
지연을 줄이려면 2.4GHz 혼잡을 피하고, ESP32는 `WiFi.setSleep(false)`를 씁니다. 공유기가 없으면 ESP32 SoftAP(`PhoneTwin-Haptic`)에 휴대폰과 PC를 함께 붙입니다.

### 포트

| 받는 쪽 | 포트 | 받는 패킷 |
|---|---|---|
| 언리얼 PC | 7777 | `PTP1`(휴대폰 위치), `PTE1`(ESP32 위치) |
| 언리얼 PC | 8000 | OSC `/tag/position` 등 (라즈베리파이 UWB 게이트웨이, 아래 1-1) |
| ESP32 / 라즈베리파이 | 4210 | `PTH1`(햅틱) → `PTA1` 응답 |
| 휴대폰 앱 | 4211 | `PTH1`(언리얼이 계산한 햅틱) |

모든 패킷은 ASCII 한 줄, 쉼표 구분, `\n`으로 끝납니다. 소수는 `.`을 씁니다. 약 30Hz로 보냅니다.

### 1-1. UWB 태그 → 라즈베리파이 → 언리얼 (OSC)

앵커 4개(USB) → `pi/phonetwin_gateway.py`가 위치 계산 → 언리얼 UDP 8000 (OSC 1.0, 메시지 또는 번들, 최대 30Hz). 하드웨어·설치는 `arduino/README.md`.

| 주소 | 인자 | 뜻 |
|---|---|---|
| `/tag/position` | f x, f y, f z (cm) | 태그 위치. 바닥 표시 A·B를 `--mark`로 기록했으면 방 좌표 R(A=원점, A→B=+X, +Y=왼쪽, Z=바닥에서 높이), 아니면 앵커 좌표 그대로 |
| `/tag/heading` | f yaw (도) | 걷는 방향(+X에서 반시계). 0.15 m/s 이상 움직일 때만 |
| `/tag/quality` | f 잔차(m), i 앵커 수, i valid | 계산 품질. valid=0이면 언리얼이 추적 안 함 |

언리얼은 이것을 입력 [2](UWB 태그)로 받아 `PTE1`과 같은 방식(R → 언리얼 `(x, −y, z)×100`, ESP32 Frame 보정)으로 씁니다. 진동 `PTH1`은 OSC를 보낸 주소의 4210번으로 가고, 파이는 `PTA1,seq,0`으로 답한 뒤 앵커 USB에 `H,<0-255>,<닿음 0|1>\n`을 씁니다. 앵커는 그 값을 UWB 응답(POLL_ACK, 20바이트 중 [18] 세기 · [19] 닿음)에 실어 태그 모터로 보냅니다. 0.5초 넘게 새 값이 없으면 0.
앵커 줄(USB → 파이): `R,<sweep>,<anchor 1-4>,<거리 m>,<수신 세기 dBm>`.

### PTP1 — 휴대폰 → 언리얼 (위치·방향)
```
PTP1,seq,valid,x,y,z,fx,fy,fz,ux,uy,uz,scanId,walk
```
- 좌표계 **S(스캔 좌표)**: 저장된 PLY와 같은 좌표. 미터, **Y가 위**, 오른손 좌표계(ARCore와 같음).
- `x,y,z` 휴대폰 카메라 위치. `f` 카메라가 보는 방향(단위벡터), `u` 휴대폰 화면 위쪽(단위벡터).
- `valid` 1 = 정렬·추적 중. 0이면 나머지 값은 마지막 값이거나 0.
- `scanId` 휴대폰이 쓰는 스캔 이름(확장자 없음). 언리얼이 다른 스캔을 띄우고 있으면 경고합니다.
- `walk` 1 = 휴대폰에서 **걷기 테스트가 실행 중**. 진동·소리·ESP32·언리얼 반응은 모두 이 값이 1일 때만 시작합니다(앱 0.4.2부터 `valid`도 걷기 테스트 중에만 1). 휴대폰이 연결되어 있으면 언리얼은 ESP32 입력도 이 값이 1일 때만 반응합니다. 필드가 없는 예전 앱은 `walk = valid`로 봅니다.

### PTM1 — 휴대폰 → 언리얼 (스캔 A·B 표시용, 앱 0.4.5부터)
```
PTM1,scanId,ax,ay,az,bx,by,bz
```
- 휴대폰이 쓰는 스캔 A·B(좌표계 S, 미터, Y 위). 연결되어 있는 동안 1초에 한 번(UDP·릴레이 모두).
- "스캔 A·B 자동"은 A = 스캔 바닥의 정중앙(바닥 점의 2%~98% 범위의 가운데), B = A에서 바닥의 긴 축 방향으로 1m(가구가 있으면 반대쪽·옆·대각선, 0.7·0.5m 순)입니다.
- 언리얼은 `scanId`가 띄운 스캔과 같으면 A(초록)·B(파랑)·화살표 A→B를 그립니다(화살표 = 언리얼 +X). 좌표 변환·거리 계산에는 쓰지 않습니다 — 언리얼의 원점·방향은 스캔 meta의 a·b를 따릅니다. 5초 넘게 안 오면 meta의 a·b를 그립니다.

### PTE1 — ESP32 → 언리얼 (UWB 위치 + IMU 회전)
```
PTE1,seq,valid,x,y,z,yaw,pitch,roll
```
- 좌표계 **R(방 좌표)**: 미터, **Z가 위**, 오른손 좌표계. 원점 = 바닥 테이프 A, +X = A에서 B 쪽, +Y = 위에서 볼 때 +X의 왼쪽(반시계 90°).
  UWB 앵커 0을 A에, 앵커 1을 A→B 선 위에 두면 UWB 좌표가 그대로 R이 됩니다. 다르게 두었다면 언리얼의 `Esp Frame` 보정값(원점·회전·배율)으로 맞춥니다.
- `yaw` +X에서 반시계 방향 각도(도), `pitch` 위로 들면 +(도), `roll` 오른쪽으로 기울면 +(도). IMU가 없으면 0,0,0.
- `valid` 1 = UWB 위치가 유효.

### PTH1 — 언리얼(또는 휴대폰) → ESP32 / 휴대폰 (햅틱·소리 세기)
```
PTH1,seq,valid,intensity,contact,objectId,distanceMm
```
v3와 같습니다. `intensity` 0~255, `contact` 0/1, `objectId` -1 없음 · 0 스캔 표면 · 1~99 직접 놓은 사물 · 100+ AI 사물, `distanceMm` -1 = 범위 밖.
ESP32는 0.5초마다 보낸 쪽으로 `PTA1,lastSeq,rssi`를 돌려줍니다. 300ms 동안 PTH1이 없으면 모터를 멈춥니다.

### 언리얼 좌표 변환 (cm, Z 위, 왼손 좌표계)
- S → 언리얼: `UE = (x, z, y) × 100`. 방향 벡터도 같은 식(×100 제외).
- R → 언리얼: `UE = (x, −y, z) × 100`, 언리얼 Yaw = −yaw, Pitch = pitch, Roll = roll.
- 스캔에 A·B가 있으면(아래 meta의 `a`,`b`) 언리얼은 S 좌표를 A가 원점, A→B가 +X가 되도록 돌려서 놓습니다. 그러면 S와 R이 같은 공간을 가리킵니다.

## 2. 스캔 저장소 (GitHub 저장소의 `scans/`)

```
scans/index.json
scans/<id>.ply      binary_little_endian, float x y z + uchar red green blue, 미터, Y 위 (S 좌표)
scans/<id>.json     메타데이터
```

`index.json` — 최신이 앞:
```json
{ "version": 1,
  "scans": [ { "id": "phone_scan_20261011_1530", "ply": "scans/phone_scan_20261011_1530.ply",
               "meta": "scans/phone_scan_20261011_1530.json", "points": 412345,
               "created": "2026-10-11T15:30:00+09:00", "device": "SM-S918N" } ] }
```

`<id>.json`:
```json
{ "version": 1, "id": "phone_scan_20261011_1530", "created": "2026-10-11T15:30:00+09:00",
  "frame": "S: metres, Y up, right-handed", "points": 412345,
  "bounds": { "min": [x,y,z], "max": [x,y,z] },
  "a": [x,y,z] , "b": [x,y,z],
  "objects": [ { "id": 1, "name": "사물 1", "c": [x,y,z], "r": 0.25 } ],
  "ai": [ { "label": "chair", "name": "의자", "c": [x,y,z], "r": 0.4 } ] }
```
`a`, `b`는 없으면 `null`. 좌표는 모두 S.

### 흐름
1. 휴대폰 앱: 스캔 완료 → (설정에 GitHub 저장소·토큰이 있으면) PLY·JSON·index.json을 한 커밋으로 올림.
2. GitHub Pages가 main 브랜치 루트(index.html + web/ + scans/)를 그대로 배포 → 웹 뷰어에서 바로 보임.
3. 언리얼 플러그인: 시작할 때와 90초마다 `scans/index.json`을 확인 → 새 스캔을 `ARKO_PROJECT/PhoneTwinScans/`로 내려받고(Content 밖: 에디터 자동 가져오기가 .json을 DataTable로 바꾸려 하지 않도록), 에디터는 `/Game/PhoneTwinScans/<id>_Cloud` 포인트클라우드 에셋을 만들고 → 가장 최근(또는 고른) 스캔을 띄움.
   PC에서 직접 `ARKO_PROJECT/PhoneTwinScans/`에 PLY를 넣어도 됩니다.

## 3. 인터넷 릴레이 (DigitalOcean App Platform, WebSocket)

같은 Wi-Fi에 있을 수 없을 때 쓰는 **보조 경로**입니다. App Platform은 UDP를 받지 않으므로 WebSocket(wss)을 씁니다.
DigitalOcean에는 한국 리전이 없어 가장 가까운 싱가포르(`sgp`)를 쓰며, 한 번 오가는 데 약 70~90 ms, 장치→언리얼→ESP32 전체는 약 100~200 ms입니다.
**전시 현장에서는 §1의 LAN UDP를 기본으로 쓰고**, 릴레이는 원격 시연·네트워크가 분리된 현장·웹 실시간 보기용입니다. 언리얼은 두 경로를 동시에 받습니다.

```
wss://<앱 주소>/ws?room=<방 이름>&role=<phone|esp32|unreal|viewer>&key=<RELAY_KEY>
```
- 텍스트 프레임 한 개에 §1의 줄(`PTP1`, `PTM1`, `PTE1`, `PTH1`, `PTA1`)을 그대로 담습니다. 여러 줄이어도 됩니다.
- 전달 규칙(같은 room 안에서만):
  - `phone`, `esp32`가 보낸 것 → `unreal`, `viewer`
  - `unreal`이 보낸 것 → `phone`, `esp32`, `viewer`
  - `viewer`는 읽기 전용(보낸 것은 버림)
- 서버 → 클라이언트 알림: 접속 직후 `PTR1,welcome,<room>,<role>`, 2초마다 `PTR1,peers,phone=N,esp32=N,unreal=N,viewer=N`.
- 지연 측정: 클라이언트가 `PTR1,ping,<임의 값>`을 보내면 서버가 보낸 쪽에만 `PTR1,pong,<같은 값>`을 돌려줍니다.
- 서버 환경 변수 `RELAY_KEY`가 있으면 phone·esp32·unreal은 같은 key가 필요합니다. `VIEW_KEY`가 있으면 viewer도 key가 필요합니다(없으면 누구나 읽기 가능).
- 서버는 15초마다 ping을 보내고, 클라이언트는 끊기면 2초 뒤 다시 접속합니다.
- 앱 0.4.5부터 휴대폰은 켜자마자 릴레이에 접속하고(기본 주소·방 `arko`·앱에 넣은 키), 같은 Wi-Fi UDP는 설정 9번에서 켜면 함께 보냅니다. 언리얼은 릴레이로 온 휴대폰·ESP32 신호를 1.5초(`RelaySignalTimeout`)까지 끊김으로 보지 않습니다(UDP는 0.5초).
- `PTU1` — 언리얼 → (릴레이) → viewer: 언리얼이 계산한 **관객 위치**. 휴대폰·ESP32 중 지금 선택된 장치의 위치를 웹에서 볼 수 있게 합니다(초당 15번, 걷기 테스트 중에만 `valid=1`).
  ```
  PTU1,seq,valid,source,x,y,z,yaw,objectId,distanceMm,intensity,scanId
  ```
  `source` = `phone`|`esp32`, `x,y,z` = 방 좌표 R(m, PTE1과 같음), `yaw` = 도(위에서 봐서 반시계), 나머지는 PTH1과 같음.
  `scanId`(2026-11-13 추가, 12번째 필드) = 언리얼이 지금 연 스캔. 예전 언리얼은 11개 필드까지만 보냅니다(받는 쪽은 없으면 빈 값으로).
  휴대폰·ESP32는 PTH1만 읽으므로 이 줄은 무시합니다.

### 3-1. 체험자 흔적 (몰입 보기 로그인, 같은 릴레이 서버의 HTTP)

몰입 보기(`immersive.html`)에 들어온 사람이 **아이디 + 숫자 4개 비밀번호**로 들어와 체험을 시작·끝내면, 걸은 길이 작은 빛의 흔적으로 남습니다.
**현장**(실제 시스템: 언리얼이 보낸 PTU1 걷기) = 푸른 빛, **웹**(브라우저에서 직접 걷기) = 보라 빛. 아이디는 **자기 흔적에만** 표시됩니다.

| 요청 | 본문 / 쿼리 | 응답 |
|---|---|---|
| `POST /trails/login` | `{id, pin}` — 아이디 글자·숫자·`_.-` 1~20자, pin 숫자 4개. 없는 아이디면 새로 만듦 | `{ok, token, id, created}` · 틀리면 401(5번 틀리면 10분 잠금, 429) · **이미 체험한 아이디는 409** |
| `POST /trails/start` | `{token, scan, kind: "site"\|"web", room}` | `{ok, sid, kind}` · 체험을 끝낸 아이디는 409 |
| `POST /trails/add` | `{token, sid, pts: [[x,y,z], …]}` — 웹 걷기만 점을 보냄(방 좌표 R, m, 페이지가 3초마다). 현장은 점 없이 보내도 됨(그 걷기를 "내 것"으로 표시·유지) | `{ok, n}` |
| `POST /trails/end` | `{token, sid, final}` — `final:false` = 같은 방문이 이어짐(현장↔웹 전환, 다른 스캔). 없거나 true면 **그 아이디의 체험 끝** | `{ok, kept}` (점 5개 미만 또는 0.5 m 미만이면 저장 안 함) |
| `POST /trails/me` | `{token}` | `{ok, id, used, done}` |
| `POST /trails/admin` | `{key, action:"delete", ids:[…]}` 그 아이디와 그 사람만 가진 흔적 삭제 · `{key, action:"reset"}` 전부 삭제. key = 서버의 `TRAILS_ADMIN_KEY`(없으면 `RELAY_KEY`) | `{ok, accounts, trails}` · 키가 틀리면 403 |
| `GET /trails?scan=<id>&token=<선택>` | | `{ok, id, trails: [{kind, live, mine, t0, t1, pts}]}` — 다른 사람 아이디는 주지 않음 |
| `GET /trails/status` | | `{ok, trails, visitors, sessions, siteWalks, backup: {configured, last, error}}` |

- **보이는 방식**(2026-11-14): 체험 중에는 저장된 흔적을 그리지 않고 공간 탐험만 보여 줍니다(기록은 계속). 나비 바로 뒤에만 3초 동안 가늘어지며 사라지는 빛 꼬리가 따라옵니다. 처음 화면의 "흔적 보기"는 로그인 없이 모든 흔적을 보여 주고 아무것도 기록하지 않습니다(서버에 요청하는 것은 `GET /trails`뿐). 체험이 끝나면 "흔적 보기" — 방 전체를 위에서 보는 자유 카메라, 점구름은 어둡게, 모든 흔적을 나비가 날아간 높이 그대로의 **빛나는 선**(화면을 향한 리본, 빛이 선을 따라 흐름)으로, 내 흔적은 더 굵고 밝게 + 이름표.
- **체험은 아이디 하나에 한 번**(2026-11-14): 첫 `start`에서 `used`, `end`(final)·창 닫기(sendBeacon)·2분 동안 아무 신호 없음에서 `done`. `used`인 아이디는 다시 로그인할 수 없고(409), 다시 하려면 새 아이디를 만듭니다. 한 번의 방문 안에서 페이지가 자동으로 다시 시작하는 것(현장↔웹, 스캔 변경)은 `final:false`라 같은 체험입니다.
- 현장 걷기: 언리얼의 PTU1 `valid=1`이 시작, `valid=0` 또는 5초 끊김이 끝. `scanId`가 바뀌어도 새 걷기. 그동안 `kind=site`로 체험 중인 로그인 사용자 모두가 주인으로 기록됩니다.
- 점은 높이를 포함해 4 cm 이상 움직였거나 1초가 지났을 때만 남깁니다(흔적 하나 최대 4000점, 전체 최대 3000개).
- 비밀번호는 scrypt 해시로만 저장. 토큰은 서버 메모리에만 있고 12시간 동안 쓰지 않으면 만료(서버를 다시 켜면 다시 로그인).
- 저장: `relay/data/trails.json`(git 제외). 환경 변수 `TRAILS_GITHUB_REPO`(`owner/name`, 비공개 저장소) + `TRAILS_GITHUB_TOKEN`(그 저장소만 Contents 읽기/쓰기)이 있으면 2분마다 그 저장소의 `trails.json`에 백업하고, 서버가 비어 있는 채로 켜지면 거기서 복원합니다. 선택: `TRAILS_GITHUB_PATH`, `TRAILS_GITHUB_BRANCH`(main), `TRAILS_BACKUP_S`(120).
- 시험: `node relay/trails_test.js`(가짜 GitHub 포함), 웹은 `node tools/test_immersive_trails.mjs <PhoneTwin_v4> <스크린샷 폴더>`.

## 4. OSC — 언리얼 → TouchDesigner → 다른 프로그램

언리얼(`PhoneTwinLink`)이 진동을 보낼 때마다(기본 30Hz) 같은 PC의 TouchDesigner로 OSC를 보냅니다.
언리얼 Details > **Phone Twin|OSC**: `Send Osc`(기본 켬), `Osc Address`(기본 `127.0.0.1`), `Osc Port`(기본 `7000`).
좌표는 방 좌표 R: m, 원점 = 바닥 표시 A, +X = B 쪽, +Y = 왼쪽, +Z = 위.

| 주소 | 인자 |
|---|---|
| `/phonetwin/state` | `active`(i, 추적 중이고 걷기 테스트 중이면 1) `walk`(i) `source`(i, 0 휴대폰 · 1 ESP32) `objectCount`(i) |
| `/phonetwin/scan` | `scanId`(s) |
| `/phonetwin/pos` | `x y z`(f) — 관객(선택된 장치) 위치 |
| `/phonetwin/dir` | `fx fy fz`(f) `yaw`(f, 도) |
| `/phonetwin/nearest` | `objectId`(i, 0 = 스캔 표면, -1 = 없음) `distCm`(f, -1 = 범위 밖) `intensity`(f, 0~1) `contact`(i) `name`(s) — 진동 기준 |
| `/phonetwin/object` | `index id`(i) `name label`(s) `floorCm handCm`(f) `cx cy cz`(f, m) `radiusCm`(f) — 사물마다 한 개 |
| `/phonetwin/touch` | `index id`(i) `name`(s) `strength`(f 0~1) — 관객이 사물에 닿은 순간 한 번(계속 닿아 있으면 4초마다 0.55). index −1 = 스캔 표면. 바닥 거리 ≤ TouchDistance(35cm) 또는 손 접촉 |

| `/phonetwin/input` | `source`(i) `name`(s, 휴대폰 / UWB 태그 / ESP32) `signalAgeS`(f, 그 장치의 마지막 신호 뒤 초, −1 = 없음) |
| `/phonetwin/uwb` | `residualM`(f) `anchors`(i) `fresh`(i) — UWB 게이트웨이 품질. Apeficiation 원본 게이트웨이는 품질을 안 보내므로 `-1 0 0` |
| `/phonetwin/look` | `mode`(i, 0 예전 빛 · 1 기억 · 2 물결 · 3 별빛) `on`(i, 키 K) `name`(s) — 1초마다 |
| `/phonetwin/marks` | `ax ay bx by`(f, 방 좌표 R m) `source`(i, 0 없음 · 1 스캔 meta · 2 휴대폰 PTM1) — 바닥 표시 A·B, 1초마다 |
| `/phonetwin/shape` | `index`(i) `x0 y0 x1 y1`(f, R m) `real`(i, 1 = 콜리전 실제 형태) — 사물의 바닥 외곽 사각형, 1초마다 사물마다 |

(2026-11-13 추가: `input`·`uwb`·`look`·`marks`·`shape`. `state`의 `source` 1은 지금 "UWB 태그(OSC)" 또는 ESP32 — 이름은 `input`을 보세요.)

`floorCm` = 바닥에서 잰 관객 ↔ 사물 표면 거리(소리와 같은 기준), `handCm` = 손(장치) ↔ 사물 표면 3D 거리.
`active=0`이면 `pos`·`object`는 보내지 않습니다.

TouchDesigner(`Phone_Twin_Project.toe`)가 이것을 받아 움직임 신호로 바꿔 `Outhost:Outport`(기본 `127.0.0.1:7001`)로 다시 보냅니다:

| 주소 | 인자 |
|---|---|
| `/td/state` | `active live sim objectCount` |
| `/td/audience` | `x y z` `speed`(m/s) `heading`(도) |
| `/td/velocity` | `vx vy vz` `accel` |
| `/td/energy` | 0~1 (걷는 속도, 1.2 m/s = 1) |
| `/td/nearest` | `index id proximity floorCm name` |
| `/td/object/<index>` | `proximity`(0~1) `floorCm` `approach`(cm/s, 다가오면 +) `id name` |
| `/td/proximity` | 모든 사물의 proximity (index 순서) |
| `/td/touch` | `/phonetwin/touch`를 그대로 전달 (닿은 순간) |
| `/td/input` | `source name` — 지금 관객을 움직이는 입력 |
| `/td/look` | `mode on name` — 언리얼 빛 모양(조명이 따라가게) |
| `/td/marks` | `ax ay bx by source` — 바닥 A·B |

TD `signals` CHOP에는 `look`, `light_on`, `marks_source`, `uwb_residual`, `input_age` 채널도 있습니다. 지도(`map`)는 콜리전 외곽 사각형, A 초록·B 파랑·화살표를 그립니다.

`proximity = 1 - floorCm / 근접 범위`(TouchDesigner 설정, 기본 200 cm), 0~1로 자름. 시험: `py tools/osc_test.py both`.

## 5. 콜리전·소리 파일

원본(`scans/`)과 따로 저장합니다. 편집기(`editor.html`)가 만들고, 언리얼과 웹이 같은 내용을 읽습니다.

| 위치 | 용도 |
|---|---|
| `ARKO_PROJECT/PhoneTwinScans/collisions/<id>.json` | 기준 파일. 언리얼이 1초마다 바뀌었는지 확인해 실행 중에도 다시 읽음 |
| `ARKO_PROJECT/PhoneTwinScans/collisions/history/` | 저장할 때마다 남는 이전 판 |
| `ARKO_PROJECT/PhoneTwinScans/sounds/*.wav` | 편집기가 넣은 소리 (48 kHz 16-bit PCM, 1·2채널) |
| `web_scans/<id>.collision.json` | 같은 내용의 사본, 웹 뷰어용. 편집기 서버가 마지막 저장 15초 뒤 GitHub에 커밋·푸시(`--no-publish`면 안 함) |
| `web_scans/sounds/*.wav` | 콜리전 파일이 쓰는 소리의 사본. 편집기 서버가 올릴 때 함께 복사·커밋(`tools/web_sounds.mjs`). 휴대폰 앱이 GitHub에서 받아 언리얼과 같은 소리를 냄 |
| `ARKO_PROJECT/PhoneTwinScans/collisions/last_saved.txt` | 마지막으로 저장한 스캔 id. 언리얼은 시작할 때 이 스캔을 열고(`-PhoneTwinScan=`이 없으면), 실행 중 바뀌면 그 스캔으로 전환 (`bFollowEditorScan`) |
| `web_scans/edited.json` | `{"scan": "<id>"}` — 웹 뷰어·편집기가 주소에 스캔이 없을 때 처음 여는 스캔 |

```json
{ "version": 1, "scan": "<id>", "voxel": 0.04,
  "collisions": [ { "id": 100, "label": "chair", "name": "의자", "source": "ai|placed|user", "fallback": false,
    "cells": [i, j, k, i, j, k],
    "nearSound": "rain.wav", "touchSound": "/Game/Sounds/Bell",
    "volume": 1, "fullDistance": 0.5, "maxDistance": 4, "muted": false,
    "voxel": 0.02, "parent": 101, "haptic": "tick", "hapticRange": 0.8, "hapticGain": 1 } ] }
```

- `cells`: 모양을 이루는 정육면체. 칸 `(i,j,k)`의 범위는 S 좌표에서 `[i, i+1] × voxel`(m).
- `nearSound`/`touchSound`: `sounds/`의 WAV 파일 이름 또는 `/Game/`으로 시작하는 언리얼 에셋. 비어 있으면 사물별 내장 소리.
- `fallback`: 자동 구분이 불확실해 사람이 손봐야 하는 모양.
- (2026-11-14) `voxel`(선택): 이 모양만의 칸 크기(세밀도). 없으면 파일의 `voxel`(4 cm). 편집기에서 2 cm·1 cm로 바꾸면 칸을 나눈 뒤 실제 스캔 표면에 있는 칸만 남깁니다(1 cm는 바로 옆 칸까지). 한 모양 최대 12만 칸. 언리얼·앱·웹 모두 `(i+0.5)·voxel`로 읽습니다.
- `parent`(선택): "부위 떼기"로 떼어 낸 부위가 원래 사물의 id를 기억합니다(표시용, 동작은 독립된 모양과 같음).
- `haptic`(선택): 진동 느낌 `steady`(일정, 기본) · `pulse`(맥박) · `heartbeat`(두근두근) · `rumble`(웅웅) · `tick`(톡톡) · `wave`(물결). `hapticRange`: 진동이 시작되는 손 거리(m, 기본 = 언리얼 `ObjectReactRange` 1.2 m). `hapticGain`: 세기 배율(기본 1).
- 진동(2026-11-14 개정 — 손에 닿을 때만): 손(휴대폰·태그)에서 모양 표면까지의 3D 거리 d가 진동 시작 거리(`hapticRange`, 기본 = 언리얼 `ObjectReactRange` 8 cm) 안에 들어오는 순간 `I = 0.55 + 0.45·t`, `t = (range − d)/(range − contact)`로 바로 또렷하게 시작해 contact 4 cm에서 1. 멀리서부터 서서히 오는 진동은 없음. 벽 같은 스캔 표면도 같은 식(`ReactRange` 8 cm). 가장 센 것이 이기고 그 모양의 진동 느낌(`haptic`)을 곱함 — 닿았을 때 무엇인지 구분하는 데 씀. 언리얼 `PhoneTwinCore.h`, 앱 `Collisions.java`, 편집기 `collision_core.js`가 같은 식입니다.
- 소리(2026-11-14 개정): 언리얼 `bSoundsFromHand`(기본 켬)와 앱은 거리 d를 **손에서 모양 표면까지의 3D 거리**로 잽니다. 기본 `fullDistance` 0.06 m, `maxDistance` 0.35 m — 손이 닿기 직전부터 서서히 커짐. "닿을 때" 소리와 금빛 물결은 손이 contact(4 cm) 안에 들어올 때 울리고 9 cm 밖으로 떨어지면 다시 준비. 예전 콜리전 파일(0.5/4 m, 바닥 거리 기준)은 `tools/migrate_hand_sounds.mjs`로 옮겼고 이전 판은 `collisions/history/`. 웹 몰입 보기의 물결은 손이 없어 예전처럼 바닥 거리 35 cm.
- 거리: 언리얼·앱은 손에서 모양 표면까지 3차원으로 잰 값 `d`(m)로 진동과 소리를 정합니다(2026-11-14부터, 아래). 웹 뷰어의 거리 표시와 몰입 보기 물결은 바닥 평면 거리.
- 음량: `G = 1 (d ≤ fullDistance)`, 그 밖에는 `clamp((maxDistance − d) / (maxDistance − fullDistance), 0, 1)`, 최종 `G² × volume`. 웹 `distanceGain()`과 언리얼 `UpdateSounds()`가 같은 식이며, 언리얼은 관객이 등진 소리에 0.3배까지 줄이는 값을 더 곱합니다.

언리얼은 파일이 없으면 스캔 meta의 구 모양으로 동작합니다.

휴대폰 앱(0.4.4~)도 같은 규칙입니다: GitHub에서 스캔을 불러오면 `web_scans/<id>.collision.json`과 그 소리를 함께 받고(소리는 git blob sha로 바뀐 것만), 걷기 테스트 중 언리얼과 같은 식으로 거리·닿음(바닥 거리 ≤ 35cm, 계속 닿으면 4초마다 0.55)·음량(가까운 6개, 등지면 0.3배)을 계산합니다. 소리를 넣지 않은 사물은 언리얼 `PhoneTwinCalmSound.cpp`를 옮긴 `CalmSynth.java`가 같은 소리를 만듭니다(두 구현은 샘플 단위로 일치 — 한쪽을 고치면 다른 쪽도). `/Game/…` 언리얼 에셋 소리는 휴대폰에서 내장 소리로 대신합니다.

## 6. 스캔 원본 보관

`tools/archive_scans.mjs`가 git 기록의 모든 버전과 로컬에만 있는 파일을 `PhoneTwin/ScanArchive`와 `D:/PhoneTwin_ScanArchive`에 보관합니다. 파일은 추가만 하고 읽기 전용이며 `manifest.json`에 SHA-256을 기록합니다. 편집기를 켤 때, 언리얼이 새 스캔을 받았을 때 자동 실행되며 `--verify`로 검사합니다. 웹은 `web_scans/`의 복제본만 읽습니다(`tools/make_web_copies.mjs`, GitHub Actions `Web scan copies`).
