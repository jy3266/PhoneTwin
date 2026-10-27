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
| ESP32 | 4210 | `PTH1`(햅틱) |
| 휴대폰 앱 | 4211 | `PTH1`(언리얼이 계산한 햅틱) |

모든 패킷은 ASCII 한 줄, 쉼표 구분, `\n`으로 끝납니다. 소수는 `.`을 씁니다. 약 30Hz로 보냅니다.

### PTP1 — 휴대폰 → 언리얼 (위치·방향)
```
PTP1,seq,valid,x,y,z,fx,fy,fz,ux,uy,uz,scanId,walk
```
- 좌표계 **S(스캔 좌표)**: 저장된 PLY와 같은 좌표. 미터, **Y가 위**, 오른손 좌표계(ARCore와 같음).
- `x,y,z` 휴대폰 카메라 위치. `f` 카메라가 보는 방향(단위벡터), `u` 휴대폰 화면 위쪽(단위벡터).
- `valid` 1 = 정렬·추적 중. 0이면 나머지 값은 마지막 값이거나 0.
- `scanId` 휴대폰이 쓰는 스캔 이름(확장자 없음). 언리얼이 다른 스캔을 띄우고 있으면 경고합니다.
- `walk` 1 = 휴대폰에서 **걷기 테스트가 실행 중**. 진동·소리·ESP32·언리얼 반응은 모두 이 값이 1일 때만 시작합니다(앱 0.4.2부터 `valid`도 걷기 테스트 중에만 1). 휴대폰이 연결되어 있으면 언리얼은 ESP32 입력도 이 값이 1일 때만 반응합니다. 필드가 없는 예전 앱은 `walk = valid`로 봅니다.

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
- 텍스트 프레임 한 개에 §1의 줄(`PTP1`, `PTE1`, `PTH1`, `PTA1`)을 그대로 담습니다. 여러 줄이어도 됩니다.
- 전달 규칙(같은 room 안에서만):
  - `phone`, `esp32`가 보낸 것 → `unreal`, `viewer`
  - `unreal`이 보낸 것 → `phone`, `esp32`, `viewer`
  - `viewer`는 읽기 전용(보낸 것은 버림)
- 서버 → 클라이언트 알림: 접속 직후 `PTR1,welcome,<room>,<role>`, 2초마다 `PTR1,peers,phone=N,esp32=N,unreal=N,viewer=N`.
- 지연 측정: 클라이언트가 `PTR1,ping,<임의 값>`을 보내면 서버가 보낸 쪽에만 `PTR1,pong,<같은 값>`을 돌려줍니다.
- 서버 환경 변수 `RELAY_KEY`가 있으면 phone·esp32·unreal은 같은 key가 필요합니다. `VIEW_KEY`가 있으면 viewer도 key가 필요합니다(없으면 누구나 읽기 가능).
- 서버는 15초마다 ping을 보내고, 클라이언트는 끊기면 2초 뒤 다시 접속합니다.
- `PTU1` — 언리얼 → (릴레이) → viewer: 언리얼이 계산한 **관객 위치**. 휴대폰·ESP32 중 지금 선택된 장치의 위치를 웹에서 볼 수 있게 합니다(초당 15번, 걷기 테스트 중에만 `valid=1`).
  ```
  PTU1,seq,valid,source,x,y,z,yaw,objectId,distanceMm,intensity
  ```
  `source` = `phone`|`esp32`, `x,y,z` = 방 좌표 R(m, PTE1과 같음), `yaw` = 도(위에서 봐서 반시계), 나머지는 PTH1과 같음.
  휴대폰·ESP32는 PTH1만 읽으므로 이 줄은 무시합니다.

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

`proximity = 1 - floorCm / 근접 범위`(TouchDesigner 설정, 기본 200 cm), 0~1로 자름. 시험: `py tools/osc_test.py both`.
