// Phone Twin v4 — 개발 정리와 사용 방법
const path = require("path");
const { THEME, HEX, newDeck, card, bullets, stat, box, arrow, table } = require("./common");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const OUT = process.argv[2];
const { pres, C } = newDeck("Phone Twin v4 — 개발 정리와 사용 방법");
const T = (s) => ({ masterName: "Content", sectionTitle: s });

// ------------------------------------------------------------------ 1 title
pres.addSection({ title: "소개" });
let s = pres.addSlide({ masterName: "Title", sectionTitle: "소개" });
s.addText("Phone Twin v4", { placeholder: "title" });
s.addText("휴대폰 3D 스캔 · 웹 · 언리얼(ARKO) · ESP32 햅틱\n개발 정리와 사용 방법 · 2026년 10월", { placeholder: "body" });
s.addNotes("Phone Twin v4는 휴대폰으로 공간을 스캔하고, 그 스캔을 웹과 언리얼에서 공유하며, 휴대폰 또는 ESP32의 위치에 따라 진동과 소리를 바꾸는 시스템입니다.");

// ------------------------------------------------------------------ 2 summary
s = pres.addSlide(T("소개"));
s.addText("한눈에 보기: 요청한 기능을 모두 구현했습니다", { placeholder: "title" });
const sum = [
  ["전체화면 · 넓은 화각 스캔", "스캔 중에만 전체화면, 가장 넓은 카메라 자동 선택"],
  ["더 정밀한 스캔", "1.5cm 간격, 여러 번 잰 값의 가중 평균"],
  ["GitHub · 웹 뷰어", "한 번에 업로드, 웹에서 3D 보기, 다시 불러오기"],
  ["언리얼 자동 반입", "C++ 플러그인이 새 스캔을 받아 에셋으로 만듦"],
  ["휴대폰 ↔ ESP32 스위치", "언리얼 화면의 [1] / [2] 버튼으로 입력 장치 선택"],
  ["거리 → 진동·소리", "가까운 표면·사물까지 거리로 진동 세기·소리 조절"],
  ["통신: UDP + 릴레이", "같은 Wi-Fi UDP가 기본, 다르면 DigitalOcean"],
  ["걷기 테스트 시작 = 시작 스위치", "모든 반응은 이 버튼을 누른 뒤에만 동작"],
];
sum.forEach((r, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  card(s, C, { x: 0.6 + col * 6.1, y: 1.4 + row * 1.35, w: 5.9, h: 1.22, head: r[0], body: r[1], num: i + 1, color: i < 3 ? C.accent1 : i < 6 ? C.accent2 : C.accent4, headSize: 15, bodySize: 13 });
});
s.addNotes("왼쪽 위부터 차례로 요청 사항과 결과입니다. 7번 통신 방식은 사용자 질문(블루투스 vs 웹)에 대한 결론이고, 8번은 마지막에 추가된 요청입니다.");

// ------------------------------------------------------------------ 3 architecture
s = pres.addSlide(T("소개"));
s.addText("전체 구조", { placeholder: "title" });
box(s, C, 0.6, 2.9, 2.5, 1.0, "휴대폰 앱 v4\nARCore 스캔·위치", C.accent1);
box(s, C, 0.6, 5.2, 2.5, 1.0, "ESP32\nUWB 위치 + IMU", C.accent2);
box(s, C, 5.4, 4.05, 2.6, 1.1, "언리얼 ARKO\nPhoneTwinLink", C.text2);
box(s, C, 5.4, 1.5, 2.6, 0.95, "GitHub 저장소\nscans/*.ply·json", C.accent5);
box(s, C, 10.1, 1.5, 2.6, 0.95, "웹 뷰어\nGitHub Pages", C.accent3);
box(s, C, 10.1, 5.2, 2.6, 1.0, "DigitalOcean\nWebSocket 릴레이", C.accent4);
const lab = (t, x, y, w, color) => s.addText(t, { x, y, w, h: 0.32, fontSize: 11, color, margin: 0, isTextBox: true });
arrow(s, C, 1.85, 2.9, 5.4, 1.98, C.accent5); lab("① 스캔 업로드", 2.0, 2.05, 2.2, C.accent5);
arrow(s, C, 8.0, 1.98, 10.1, 1.98, C.accent5); lab("② 자동 배포", 8.4, 1.6, 1.6, C.accent5);
arrow(s, C, 6.7, 2.45, 6.7, 4.05, C.accent5); lab("③ 90초마다 자동 다운로드", 6.85, 3.05, 2.6, C.accent5);
arrow(s, C, 3.1, 3.4, 5.4, 4.4, C.accent1, "", { both: true }); lab("UDP 위치 PTP1", 3.75, 3.25, 1.8, C.accent1);
arrow(s, C, 3.1, 5.7, 5.4, 4.9, C.accent2, "", { both: true }); lab("UDP 위치 PTE1 · 진동 PTH1", 2.3, 6.3, 3.2, C.accent2);
arrow(s, C, 8.0, 4.8, 10.1, 5.6, C.accent4, "", { both: true, dash: true }); lab("같은 Wi-Fi가 아닐 때", 8.9, 4.65, 2.2, C.accent4);
s.addText([
  { text: "실시간 신호: ", options: { bold: true, color: C.accent1 } },
  { text: "같은 Wi-Fi UDP가 기본, 다른 네트워크면 릴레이", options: { breakLine: true } },
  { text: "GitHub: ", options: { bold: true, color: C.accent5 } },
  { text: "스캔 파일 저장·공유 전용 (실시간 불가)" },
], { x: 5.4, y: 6.15, w: 4.6, h: 0.65, fontSize: 11, color: C.text1, margin: 0, isTextBox: true });

// ------------------------------------------------------------------ section: development
pres.addSection({ title: "개발 내용" });
s = pres.addSlide({ masterName: "Section", sectionTitle: "개발 내용" });
s.addText("개발 내용", { placeholder: "title" });
s.addText("휴대폰 앱 · 웹 · 언리얼 플러그인 · 통신 · ESP32", { placeholder: "body" });

// ------------------------------------------------------------------ app
s = pres.addSlide(T("개발 내용"));
s.addText("휴대폰 앱 v4: 원본은 그대로, 별도 앱으로 복제", { placeholder: "title" });
card(s, C, { x: 0.6, y: 1.4, w: 3.9, h: 4.6, bodySize: 14, head: "전체화면 스캔", color: C.accent1, body: bullets([
  "스캔을 시작하면 상단바·설정창·시스템 바를 숨김",
  "점 수, 완료·저장 / 취소만 남김",
  "완료·취소·실패 어느 경우든 원래 화면으로 복귀",
], 13) });
card(s, C, { x: 4.72, y: 1.4, w: 3.9, h: 4.6, bodySize: 14, head: "넓은 화각", color: C.accent1, body: bullets([
  "ARCore가 허용하는 카메라 중 수평 화각이 가장 넓은 것을 자동 선택",
  "스캔 중에는 영상을 자르지 않고 전체 표시 (세로 화면에서 좌우 약 1.6배)",
  "깊이 모드를 켤 때 바뀐 카메라 설정을 되돌림",
], 13) });
card(s, C, { x: 8.84, y: 1.4, w: 3.9, h: 4.6, bodySize: 14, head: "새 설정 항목", color: C.accent1, body: bullets([
  "8 · GitHub 업로드 / 올린 스캔 불러오기",
  "9 · 언리얼 연동: 같은 Wi-Fi(UDP) 또는 인터넷 릴레이",
  "앱 이름 \"Phone Twin v4\", v3와 함께 설치",
], 14) });
s.addText("한계: 대부분의 휴대폰에서 ARCore는 메인 카메라 1개만 씁니다. 초광각 렌즈를 강제로 쓸 수는 없습니다.", { x: 0.6, y: 6.4, w: 12.1, h: 0.4, fontSize: 12, italic: true, color: C.accent5, margin: 0, isTextBox: true });

// ------------------------------------------------------------------ precision
s = pres.addSlide(T("개발 내용"));
s.addText("스캔 정밀도: 한 번 찍힌 값 대신 여러 번의 평균", { placeholder: "title" });
const steps = ["깊이 픽셀 전부 사용", "신뢰도 60% 미만 제외", "경계의 튀는 점 제거", "빠른 움직임 제외", "1.5cm 칸 가중 평균", "2회 이상 관측만 저장"];
steps.forEach((t, i) => {
  const x = 0.6 + i * 2.05;
  s.addShape("ellipse", { x: x + 0.62, y: 1.55, w: 0.65, h: 0.65, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: "step" });
  s.addText(String(i + 1), { x: x + 0.62, y: 1.55, w: 0.65, h: 0.65, fontSize: 18, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true });
  s.addText(t, { x, y: 2.35, w: 1.9, h: 0.9, fontSize: 13, align: "center", color: C.text1, margin: 0, isTextBox: true });
  if (i < steps.length - 1) arrow(s, C, x + 1.4, 1.88, x + 2.55, 1.88, C.accent5);
});
stat(s, C, 0.6, 3.75, 3.9, "2.5→1.5cm", "점 간격", C.accent1, 36);
stat(s, C, 4.7, 3.75, 3.6, "80만 점", "한 스캔 최대 점 수 (v3 60만)", C.accent1, 36);
stat(s, C, 8.8, 3.75, 3.9, "신뢰도÷거리²", "가중치: 가깝고 확실한 측정일수록 크게", C.accent2, 36);
s.addText("천천히 훑을수록 같은 자리를 여러 번 재므로 정밀해집니다. 관측 횟수를 3으로 올리면 잡음이 더 줄고, 1로 내리면 점이 늘어납니다.", { x: 0.6, y: 5.75, w: 12.1, h: 0.7, fontSize: 14, color: C.text1, margin: 0, isTextBox: true });

// ------------------------------------------------------------------ github / web
s = pres.addSlide(T("개발 내용"));
s.addText("GitHub와 웹 뷰어: 스캔을 저장하고 어디서나 보기", { placeholder: "title" });
card(s, C, { x: 0.6, y: 1.4, w: 5.9, h: 2.5, head: "업로드 (앱 설정 8번)", color: C.accent5, body: bullets([
  "PLY + 메타(A·B, 사물, AI 사물) + 목록을 한 커밋으로",
  "저장소: github.com/jy3266/PhoneTwin (공개)",
  "토큰은 이 저장소 Contents 쓰기 권한만, 휴대폰 안에만 저장",
], 13) });
card(s, C, { x: 6.8, y: 1.4, w: 5.9, h: 2.5, head: "웹 뷰어", color: C.accent3, body: bullets([
  "jy3266.github.io/PhoneTwin",
  "스캔 목록, 3D 점군, A·B 표시, 사물 이름표",
  "실시간 위치 패널: 휴대폰·ESP32 위치와 진동 세기",
], 13) });
card(s, C, { x: 0.6, y: 4.15, w: 12.1, h: 2.3, head: "올린 스캔 다시 불러오기: 다른 장소와 크기 비교", color: C.accent2, body: bullets([
  "설정 1번 또는 8번 → ☁ GitHub에 올린 스캔 불러오기 → 목록에서 선택",
  "새 장소에서 현장 A·B를 기록하면 \"스캔 A–B / 현장 A–B · 차이 %\"로 길이를 바로 비교",
  "AR 겹쳐보기로 예전 공간을 현재 장소 위에 겹쳐 봄 (크기 비교 때는 스케일 보정을 끄기)",
], 13) });

// ------------------------------------------------------------------ unreal
s = pres.addSlide(T("개발 내용"));
s.addText("언리얼 플러그인 PhoneTwinLink (C++)", { placeholder: "title" });
card(s, C, { x: 0.6, y: 1.4, w: 3.9, h: 5.0, head: "스캔 자동 반입", color: C.text2, body: bullets([
  "에디터가 켜져 있으면 90초마다 GitHub 확인",
  "원본은 ARKO_PROJECT/PhoneTwinScans",
  "Content/PhoneTwinScans에 포인트클라우드 에셋 생성",
  "Play를 누르면 가장 최근 스캔이 자동으로 뜸",
], 13) });
card(s, C, { x: 4.72, y: 1.4, w: 3.9, h: 5.0, head: "거리 → 진동·소리", color: C.accent2, body: bullets([
  "손(장치) 위치에서 가장 가까운 표면·사물까지 거리",
  "30cm에서 시작, 3cm 이하면 접촉 (조절 가능)",
  "ESP32·휴대폰에 초당 30번 진동 세기 전송",
  "사물별 소리: 가까울수록 크게, 뒤쪽은 30%",
], 13) });
card(s, C, { x: 8.84, y: 1.4, w: 3.9, h: 5.0, head: "화면 패널(HUD)", color: C.accent1, body: bullets([
  "[1] 휴대폰 / [2] ESP32 입력 스위치",
  "연결 상태, 거리, 세기 막대, 릴레이 왕복 시간",
  "C 시점 따라가기 · H 레벨 메쉬 숨김",
  "블루프린트 이벤트 On Proximity 제공",
], 13) });

// ------------------------------------------------------------------ comms
s = pres.addSlide(T("개발 내용"));
s.addText("통신 방식: 같은 Wi-Fi UDP가 가장 빠름", { placeholder: "title" });
s.addChart(pres.charts.BAR, [{ name: "지연(ms)", labels: ["같은 Wi-Fi UDP (예상)", "릴레이, PC 안 시험 (실측)", "DigitalOcean 릴레이 (실측)"], values: [15, 30, 290] }], {
  x: 0.6, y: 1.4, w: 6.6, h: 4.6, barDir: "bar", chartColors: [HEX.accent1, HEX.accent5, HEX.accent4],
  showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 12, dataLabelColor: HEX.dk1, dataLabelFontFace: "+mn-lt",
  showTitle: true, title: "위치가 바뀐 뒤 진동이 바뀌기까지 (ms)", titleFontSize: 13, titleColor: HEX.dk1, titleFontFace: "+mn-lt",
  catAxisLabelColor: HEX.dk1, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt", valAxisLabelColor: HEX.accent5, valAxisLabelFontSize: 11, valAxisLabelFontFace: "+mn-lt",
  valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false, valAxisMaxVal: 350,
});
table(s, C, [["방식", "한 방향 지연", "판단"],
  ["같은 Wi-Fi UDP", "2~10ms", "기본. 전시 현장"],
  ["블루투스 BLE", "15~50ms", "Windows 구현 복잡"],
  ["DO 릴레이 (WebSocket)", "실측 약 0.3초*", "네트워크가 다를 때"],
  ["GitHub", "수 초~수 분", "실시간 불가, 저장만"]], { x: 7.5, y: 1.5, w: 5.2, colW: [2.0, 1.5, 1.7], size: 12 });
s.addText("* 장치 → 언리얼 → 장치 전체 왕복. DigitalOcean에는 한국 리전이 없어 싱가포르가 가장 가깝습니다. 언리얼은 두 경로를 동시에 받습니다.", { x: 7.5, y: 4.6, w: 5.2, h: 1.2, fontSize: 12, color: C.accent5, margin: 0, isTextBox: true });

// ------------------------------------------------------------------ esp32
s = pres.addSlide(T("개발 내용"));
s.addText("ESP32 (UWB + IMU): 팀원이 채울 자리를 남겨 둠", { placeholder: "title" });
card(s, C, { x: 0.6, y: 1.4, w: 5.9, h: 2.6, head: "ESP32 → 언리얼: PTE1 (초당 30번)", color: C.accent2, body: bullets([
  "UWB 위치(m) + IMU yaw·pitch·roll(°)",
  "readUwbPosition(), readImu() 두 함수만 실제 센서로 채우면 됨",
  "앵커 거리 → 위치 계산(삼변측량) 함수 포함",
], 13) });
card(s, C, { x: 6.8, y: 1.4, w: 5.9, h: 2.6, head: "언리얼 → ESP32: PTH1 진동 세기", color: C.accent2, body: bullets([
  "세기 0~255, 접촉 여부, 사물 번호, 거리(mm)",
  "모터 PWM 세기 조절, 신호가 끊기면 0.3초 뒤 정지",
  "거리 값으로 ESP32 쪽 소리 모듈도 제어 가능",
], 13) });
card(s, C, { x: 0.6, y: 4.25, w: 12.1, h: 2.2, head: "좌표 맞추기: 바닥 테이프 A·B", color: C.text2, body: bullets([
  "UWB 앵커 0을 바닥 A에, 앵커 1을 B 방향에 두면 보정 없이 스캔과 같은 공간",
  "다르게 두었다면 언리얼의 ESP32 Frame(원점·회전·배율)으로 맞춤",
  "DEMO_MOTION 1이면 센서 없이 원을 그리며 걷는 위치를 보내 언리얼부터 시험 가능",
], 13) });

// ------------------------------------------------------------------ walk gate
s = pres.addSlide(T("개발 내용"));
s.addText("시작 스위치: 걷기 테스트 시작", { placeholder: "title" });
s.addText(bullets([
  "정렬만 해 두면 아무것도 울리지 않음",
  "걷기 테스트 시작 → 휴대폰 진동·사물 소리·ESP32·언리얼 반응이 함께 켜짐",
  "종료하면 모두 멈춤",
  "휴대폰이 연결되어 있으면 언리얼의 ESP32 입력도 이 버튼을 기다림",
  "진동/ESP32 테스트(1초) 버튼은 장치 점검용이라 예외",
], 15), { x: 0.6, y: 1.5, w: 6.2, h: 4.5, color: C.text1, margin: 0, paraSpaceAfter: 8, valign: "top", isTextBox: true });
s.addText("검증: 빨간 시험 구에 닿은 상태에서 진동 세기", { x: 7.2, y: 1.5, w: 5.5, h: 0.5, fontSize: 14, bold: true, color: C.text1, margin: 0, isTextBox: true });
stat(s, C, 7.2, 2.1, 1.7, "0", "시작 전", C.accent5);
stat(s, C, 9.1, 2.1, 1.7, "255", "걷기 테스트 중", C.accent2);
stat(s, C, 11.0, 2.1, 1.7, "0", "종료 후", C.accent5);
s.addText("언리얼을 화면 없이 실행하고 실제 UDP로 휴대폰 신호를 흉내 내어 측정", { x: 7.2, y: 3.9, w: 5.5, h: 0.6, fontSize: 12, color: C.accent5, margin: 0, isTextBox: true });

// ------------------------------------------------------------------ verification
s = pres.addSlide(T("개발 내용"));
s.addText("검증 결과", { placeholder: "title" });
stat(s, C, 0.6, 1.4, 2.9, "24", "Android 단위 테스트 통과", C.accent3);
stat(s, C, 3.7, 1.4, 2.9, "4", "언리얼 자동화 테스트 통과", C.accent3);
stat(s, C, 6.8, 1.4, 2.9, "9", "릴레이 시험 통과 (실서버)", C.accent3);
stat(s, C, 9.9, 1.4, 2.9, "≈0.3초", "DO 릴레이 실측 왕복", C.accent4);
card(s, C, { x: 0.6, y: 3.3, w: 5.9, h: 3.2, head: "확인함", color: C.accent3, body: bullets([
  "휴대폰·ESP32 두 좌표계가 언리얼에서 같은 결과",
  "GitHub 업로드 → 언리얼 자동 다운로드·에셋 생성",
  "웹 뷰어 표시, 실시간 위치 패널",
  "언리얼 WebSocket 지연 누적 문제를 찾아 해결",
], 13) });
card(s, C, { x: 6.8, y: 3.3, w: 5.9, h: 3.2, head: "아직 실기기 확인 필요", color: C.accent6, body: bullets([
  "휴대폰: 전체화면 전환, 실제 화각, 정밀도 효과",
  "휴대폰 ↔ 언리얼 실제 Wi-Fi 연결",
  "ESP32 하드웨어 (UWB·IMU 드라이버는 팀원 몫)",
  "현장 지연과 발열·배터리",
], 13) });

// ------------------------------------------------------------------ section: usage
pres.addSection({ title: "사용 방법" });
s = pres.addSlide({ masterName: "Section", sectionTitle: "사용 방법" });
s.addText("사용 방법", { placeholder: "title" });
s.addText("설치 → 스캔·업로드 → 정렬 → 연동 → 걷기 테스트", { placeholder: "body" });

// ------------------------------------------------------------------ what goes where
s = pres.addSlide(T("사용 방법"));
s.addText("무엇을 어디에 설치하나", { placeholder: "title" });
table(s, C, [["대상", "무엇", "할 일"],
  ["휴대폰", "PhoneTwin-Android-v4.apk (0.4.2)", "install 폴더 또는 GitHub Releases에서 설치. 덮어 설치해도 스캔 유지"],
  ["언리얼 PC", "ARKO_PROJECT + PhoneTwinLink", "이미 설치·빌드됨. 에디터를 열고 Play"],
  ["ESP32", "esp32/PhoneTwinUWB.ino", "Arduino IDE로 업로드. Wi-Fi·언리얼 PC IP 입력"],
  ["웹", "jy3266.github.io/PhoneTwin", "설치 없음. 브라우저로 열기"],
  ["릴레이", "DigitalOcean phonetwin-relay", "배포 완료. 키는 RELAY_KEY_private.txt"]],
  { x: 0.6, y: 1.5, w: 12.1, colW: [1.6, 4.0, 6.5], size: 14, rowH: 0.62 });
s.addText("나머지 폴더(android, tools, relay, unreal)는 소스와 시험 도구입니다. 평소에는 필요 없습니다.", { x: 0.6, y: 5.7, w: 12.1, h: 0.5, fontSize: 13, color: C.accent5, margin: 0, isTextBox: true });

// ------------------------------------------------------------------ steps
s = pres.addSlide(T("사용 방법"));
s.addText("사용 순서 6단계", { placeholder: "title" });
const flow = [
  ["스캔", "설정 0번 → 스캔 시작 → 벽·가구를 0.5~3m에서 천천히 → 완료·저장", C.accent1],
  ["업로드", "설정 8번 → 현재 스캔 업로드 (자동 업로드 체크 가능)", C.accent5],
  ["언리얼 Play", "최신 스캔이 자동으로 뜸. G로 즉시 동기화, H로 템플릿 벽 숨김", C.text2],
  ["정렬", "설정 2번 → 현장 A·B 조준·기록. \"정렬 완료 · 차이 3% 이내\" 확인", C.accent1],
  ["연동", "설정 9번 → 같은 Wi-Fi면 PC IP, 아니면 릴레이 → 송신 시작", C.accent4],
  ["걷기 테스트 시작", "위쪽 버튼. 진동·소리·ESP32·언리얼이 함께 시작", C.accent2],
];
flow.forEach((f, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  card(s, C, { x: 0.6 + col * 4.1, y: 1.4 + row * 2.6, w: 3.9, h: 2.4, head: f[0], body: f[1], num: i + 1, color: f[2], bodySize: 13 });
});

// ------------------------------------------------------------------ unreal controls
s = pres.addSlide(T("사용 방법"));
s.addText("언리얼 조작과 설정", { placeholder: "title" });
table(s, C, [["키", "기능"], ["1 / 2", "입력 장치: 휴대폰 / ESP32"], ["C", "장치 시점으로 보기"], ["H", "템플릿 레벨 메쉬 숨김"], ["N", "다음 스캔"], ["G", "GitHub 바로 동기화"], ["M", "마우스 커서 (버튼 클릭용)"]],
  { x: 0.6, y: 1.5, w: 5.2, colW: [1.2, 4.0], size: 14, rowH: 0.55 });
card(s, C, { x: 6.2, y: 1.5, w: 6.5, h: 4.0, bodySize: 14, head: "Details / 프로젝트 설정", color: C.text2, body: bullets([
  "레벨에 Phone Twin Scan 액터를 직접 놓으면 세부 조정 가능",
  "Reaction: 반응 시작 30cm, 접촉 3cm, 바닥 제외",
  "Sound: AI 라벨(chair 등)·사물 이름별 소리 지정",
  "프로젝트 설정 → Phone Twin: 저장소, 릴레이",
  "릴레이 주소는 반드시 따옴표 포함 (ini에서 // 는 주석)",
], 14) });

// ------------------------------------------------------------------ troubleshooting
s = pres.addSlide(T("사용 방법"));
s.addText("자주 만나는 상황", { placeholder: "title" });
table(s, C, [["보이는 것", "원인", "해결"],
  ["DataTable Options 창", "예전 버전이 원본 .json을 Content에 저장", "Cancel. 0.4.2 플러그인에서 해결됨"],
  ["HUD \"대기 중\"", "휴대폰에서 걷기 테스트를 시작하지 않음", "휴대폰 위쪽 걷기 테스트 시작"],
  ["\"정렬/추적 대기\"", "앱을 다시 켜서 정렬이 풀림", "설정 2번에서 현장 A·B 다시 기록"],
  ["\"다른 스캔을 쓰고 있습니다\"", "휴대폰 스캔이 아직 업로드 안 됨", "설정 8번 업로드 → 언리얼 G"],
  ["휴대폰 신호 없음", "PC IP 비어 있음 · 방화벽", "9번에 PC IP 입력, Windows 방화벽 허용"],
  ["점군이 안 보임", "템플릿 벽에 가려짐", "언리얼에서 H"]],
  { x: 0.6, y: 1.5, w: 12.1, colW: [3.2, 4.4, 4.5], size: 13, rowH: 0.6 });

// ------------------------------------------------------------------ closing
pres.addSection({ title: "마무리" });
s = pres.addSlide({ masterName: "Title", sectionTitle: "마무리" });
s.addText("다음 단계", { placeholder: "title" });
s.addText("1. 휴대폰 실기기에서 정렬·걷기 테스트\n2. ESP32에 UWB·IMU 센서 연결\n3. 현장 Wi-Fi에서 지연 측정\n4. 사물별 소리 제작·지정", { placeholder: "body" });

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
