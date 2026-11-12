# UWB 태그 + 앵커 4개 + 라즈베리파이 → 언리얼 (OSC)

참고: [gwsylvia/Apeficiation](https://github.com/gwsylvia/Apeficiation)의 `uwb_tag_motors`·`4uwb_anchor`·`pi_gateway.py`.
같은 하드웨어(XIAO nRF52840 + DWM1000, 태그에는 PCA9685 + 진동 모터 5개)와 거리 측정 방식을 그대로 쓰고, Phone Twin에 맞게 아래를 바꿨습니다.

```
태그(관객이 착용) ──UWB──▶ 앵커 1~4 ──USB──▶ 라즈베리파이 ──OSC /tag/position──▶ 언리얼 :8000
     ▲                         ▲                     │ ◀──PTH1 진동 세기 (UDP 4210)── 언리얼
     └── 진동 세기 (POLL_ACK) ──┘◀── H,세기,닿음 (USB) ─┘
```

| 바뀐 점 | 내용 |
|---|---|
| 앵커 위치는 아무 데나 | 위치 계산은 파이만 합니다. 태그에는 좌표가 없고, 앵커 좌표는 `pi/anchors.json` 한 곳에만 있습니다. 좌표를 직접 적거나, **줄자로 잰 앵커 사이 거리 6개 + 높이**만 적으면 파이가 배치를 계산합니다. |
| 앵커 3개만 잡혀도 계산 | 최소제곱(가우스-뉴턴). 앵커 높이가 거의 같으면(30cm 미만 차이) z는 `tag_height`로 고정하고 x·y만 구합니다(원래 코드는 이 경우 계산 불가). |
| 스캔과 같은 좌표 | 태그를 스캔의 바닥 표시 A·B에 놓고 `--mark A`, `--mark B`를 한 번씩 실행하면, 그 뒤로는 A=원점, A→B=+X인 방 좌표(R)로 보냅니다. 언리얼의 기존 ESP32 좌표와 같아서 언리얼에서 보정할 필요가 없습니다. |
| 진동 | 언리얼이 계산한 진동 세기(PTH1)를 파이가 받아 앵커 USB로 보내고, 앵커가 태그에 보내는 응답(POLL_ACK)에 실어 태그 모터를 돌립니다. 태그는 Wi-Fi가 없어도 됩니다. 닿으면 모터가 톡톡 끊어 울립니다. 걷기 테스트 전에는 언리얼이 0을 보내므로 조용합니다. |
| 데이터 길이 | 18 → **20바이트** (`[18]` 진동 0~255, `[19]` 닿음). **태그와 앵커 4개를 모두 이 폴더의 스케치로 다시 올려야 합니다** (섞으면 동작하지 않음). |

## 1. 보드에 올리기 (Arduino IDE)

라이브러리: `DW1000`(arduino-dw1000), `Adafruit PWM Servo Driver`, `Adafruit TinyUSB`. 보드: Seeed XIAO nRF52840.

1. `phonetwin_uwb_anchor/phonetwin_uwb_anchor.ino` — 맨 위 `#define ANCHOR_ID`를 1, 2, 3, 4로 바꿔 가며 앵커 4개에 하나씩 올립니다.
2. `phonetwin_uwb_tag/phonetwin_uwb_tag.ino` — 태그에 올립니다. 모터가 약하게는 안 돌면 `DUTY_MIN_RUN`을 올리세요. 신호가 없을 때 원래의 느린 리듬을 원하면 `IDLE_RHYTHM 1`.
3. 태그 LED: 초록 = 앵커 4개 응답, 노랑 = 3개(계산 가능), 빨강 = 2개 이하.

## 2. 라즈베리파이

```bash
pip install pyserial
cd PhoneTwin_v4/pi
cp anchors.example.json anchors.json      # 앵커 위치를 방에 맞게 고치기 (아래)
python3 phonetwin_gateway.py --show-layout # 계산된 앵커 배치 확인
python3 phonetwin_gateway.py --mark A      # 태그를 스캔 바닥 표시 A 위에 4초간 두기
python3 phonetwin_gateway.py --mark B      # B 위에서 한 번 더
python3 phonetwin_gateway.py --osc-host <언리얼 PC IP>
```

- 앵커 위치 적기: `"anchors": {"1": [x, y, z], …}` (m, z = 바닥에서 높이) **또는** `"tape": {"heights": {…}, "distances": {"1-2": …, "1-3": …, "1-4": …, "2-3": …, "2-4": …, "3-4": …}}`. 예시는 `anchors.example.json`의 `tape_example`(이름을 `tape`로 바꾸면 사용).
- 앵커는 가능하면 높이를 다르게(예: 둘은 0.5m, 둘은 2.5m) 두면 키 높이(z)까지 계산됩니다.
- 장비 없이 시험: `python3 phonetwin_gateway.py --simulate --osc-host <PC IP>` (가짜 태그가 8자로 걷습니다), 출력만 보기: `--dry-run`.
- 시험: `python3 test_gateway.py` (계산·줄자 배치·좌표 변환·OSC 바이트 10개 검사).

## 3. 언리얼

따로 설정할 것은 없습니다. Play를 누르면 OSC 8000번을 듣고, HUD의 **[2] UWB 태그 (Pi·OSC)** (키 2)로 바꾸면 태그 위치로 거리·진동·소리를 계산합니다. HUD에 "UWB 태그 (Pi OSC) · 추적 중 · 앵커 4개 · 오차 2 cm · 진동 응답 OK"가 보이면 정상입니다.
Details(액터 `PhoneTwinScan_Auto`): `bUwbOscInput`, `UwbOscPort`(8000), `UwbOscAddress`(`/tag/position`), `UwbOscMetresPerUnit`(0.01 = cm). 진동은 OSC를 보낸 파이 주소의 4210번으로 자동으로 갑니다(`EspAddress`를 비워 두면).

## 4. Apeficiation 원본을 그대로 쓸 때 (gwsylvia/Apeficiation, 고치지 않은 18바이트 펌웨어 + `pi_gateway.py`)

원본 게이트웨이는 OSC `/tag/position [x, y, z]`(cm)만 보내고, 좌표는 **앵커 1이 있는 방 모서리 = 원점**입니다(스캔의 A·B와 무관). 언리얼은 이것을 그대로 받을 수 있고, 스캔과 맞추는 일은 언리얼에서 합니다.

1. 파이: `python3 pi_gateway.py --osc-host <언리얼 PC IP>` (기본값 127.0.0.1은 파이 자신이라 PC에 안 옵니다). 원본 파일의 `ANCHOR_POS`(앵커 좌표)는 펌웨어(`uwb_tag_motors.ino`)와 파이 양쪽에 같은 값으로 실제 방에 맞게 적어야 합니다. 앵커 4개가 모두 같은 높이면 원본 계산이 동작하지 않습니다(위치가 하나도 안 나옴).
2. 언리얼 Play → 키 **2** (UWB 태그). HUD에 "UWB 원 좌표 (…) · Apeficiation 게이트웨이 형식"이 보이면 수신 중.
3. 태그를 스캔 바닥 **A** 위에 두고 **7**, **B** 위에 두고 **8** → "UWB A·B 맞춤 완료 · A→B 실측 x m". 그 뒤로 A=원점, A→B=앞(+X)으로 바뀝니다. 값은 `ARKO_PROJECT/PhoneTwinScans/uwb_frame.json`에 저장되어 다음 Play에도 쓰이고, **9**는 지움. 콘솔: `PhoneTwin.UwbMark A|B|clear`.
4. 태그가 좌우 반대로 움직이면 Details > Phone Twin|Input > `bUwbMirror`를 켭니다(앵커를 시계 방향으로 번호 매긴 경우).
5. 원본 게이트웨이는 방향(/tag/heading)을 보내지 않으므로 언리얼이 걸어가는 방향으로 정합니다(`UwbHeadingStepCm` 15 cm마다).
6. 진동: 원본 태그는 정해진 리듬으로만 모터를 돌리고 언리얼의 진동 세기(PTH1)를 받지 않습니다. 거리에 따른 진동이 필요하면 이 폴더의 20바이트 스케치 + `pi/phonetwin_gateway.py`로 바꿔야 합니다.
7. PC 방화벽에서 UnrealEditor의 UDP 8000 수신을 허용해야 파이에서 보낸 OSC가 들어옵니다.

### 하드웨어 없이 시험 (`tools/apeficiation_sim.py`)

원본 `pi_gateway.py`를 GitHub에서 받아(`tools/.apeficiation/`, git 제외) **고치지 않고** 실행하고, 앵커 4개의 USB 줄(`R,스윕,앵커,거리,수신세기`)과 태그의 순서대로 묻기(앵커당 약 8 ms, 응답 없으면 50 ms 기다림)만 가짜로 만듭니다.

```bash
py tools/apeficiation_sim.py                    # 8자 걷기 → OSC 127.0.0.1:8000 (언리얼 Play 중)
py tools/apeficiation_sim.py --walk ab          # 0~6초 A 위(언리얼에서 7), 6~12초 B 위(8), 그다음 걷기
py tools/apeficiation_sim.py --scenario dropout # ideal noisy uncal dropout spikes flat
py tools/apeficiation_sim.py --dry-run --show-lines   # 앵커 줄과 정확도만
py tools/apeficiation_sim.py --selftest         # 모든 상황 + OSC 바이트를 다시 풀어 검사
```

상황: `noisy` 거리 잡음 5 cm · `uncal` 안테나 지연 미보정(모든 거리 +25 cm) · `dropout` 앵커 응답 10% 실패(원본은 4개가 다 와야 계산 → 출력이 절반 이하로) · `spikes` 반사로 1.5 m 튐(중앙값 3개 필터) · `flat` 앵커 높이 모두 같음(원본은 계산 불가). A·B 자리는 `--mark-a 1.0,1.5 --mark-b 2.0,1.5`(원본 방 좌표 m), 앵커는 `--anchors "x,y,z;…"`.
