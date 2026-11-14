// Phone Twin — 전체 개발·구동·연동 발표 (2026-11-13)
const path = require("path");
const { HEX, newDeck, card, bullets, stat, box, arrow, table } = require("./common");
const { THEME } = require("./common");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const OUT = process.argv[2];
const { pres, C } = newDeck("Phone Twin — 개발·구동·연동 발표");
const T = (sec) => ({ masterName: "Content", sectionTitle: sec });
let s;

// small helpers ------------------------------------------------------------
const txt = (slide, t, o) => slide.addText(t, Object.assign({ fontSize: 14, color: C.text1, margin: 0, valign: "top", isTextBox: true }, o));
const pill = (slide, x, y, w, t, fill) => {
  slide.addShape("roundRect", { x, y, w, h: 0.38, rectRadius: 0.19, fill: { color: fill }, line: { color: fill }, objectName: "pill" });
  slide.addText(t, { x, y, w, h: 0.38, fontSize: 12, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, isTextBox: true });
};
const codeBox = (slide, x, y, w, h, t, size) => {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: "code" });
  slide.addText(t, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: h - 0.24, fontFace: "Consolas", fontSize: size || 13, color: "BFE3EE", margin: 0, valign: "middle", isTextBox: true });
};
const section = (title, sub) => {
  pres.addSection({ title });
  const d = pres.addSlide({ masterName: "Section", sectionTitle: title });
  d.addText(title, { placeholder: "title" });
  d.addText(sub, { placeholder: "body" });
  return d;
};

// ========================================================================== 1 표지
pres.addSection({ title: "소개" });
s = pres.addSlide({ masterName: "Title", sectionTitle: "소개" });
s.addText("Phone Twin", { placeholder: "title" });
s.addText("공간을 스캔하고, 그 공간 안에서 걷는 사람에게 진동과 소리로 답하는 시스템\n개발 과정 · 구동 방식 · 연동 방식 — 2026년 11월", { placeholder: "body" });
s.addNotes("안녕하세요. 오늘은 Phone Twin 프로젝트의 전체 개발 과정과 구동 방식, 그리고 각 장치가 어떻게 연동되는지를 자세히 설명드리겠습니다. 휴대폰으로 공간을 스캔하고, 그 디지털 쌍둥이 공간 안에서 관객이 걸으면, 사물과의 거리에 따라 진동과 소리, 빛이 반응하는 작품입니다.");

// ========================================================================== 2 한 문장
s = pres.addSlide(T("소개"));
s.addText("한 문장으로: 실제 방과 디지털 방을 겹쳐 걷게 합니다", { placeholder: "title" });
const flow = [
  ["1", "스캔", "휴대폰으로 방을\n3D 점구름으로 기록", C.accent1],
  ["2", "공유", "GitHub에 올려\n웹·언리얼이 함께 사용", C.accent5],
  ["3", "추적", "휴대폰 또는 UWB 태그로\n관객 위치를 실시간 추적", C.accent4],
  ["4", "계산", "언리얼이 가장 가까운\n사물까지 거리 계산", C.text2],
  ["5", "반응", "진동 · 소리 · 빛으로\n관객에게 되돌려 줌", C.accent2],
];
flow.forEach((f, i) => {
  const x = 0.6 + i * 2.5;
  s.addShape("ellipse", { x: x + 0.55, y: 1.7, w: 1.1, h: 1.1, fill: { color: f[3] }, line: { color: f[3] }, objectName: "step" });
  txt(s, f[0], { x: x + 0.55, y: 1.7, w: 1.1, h: 1.1, fontSize: 30, bold: true, color: C.background1, align: "center", valign: "middle" });
  txt(s, f[1], { x, y: 3.0, w: 2.2, h: 0.5, fontSize: 22, bold: true, color: f[3], align: "center" });
  txt(s, f[2], { x, y: 3.55, w: 2.2, h: 1.0, fontSize: 14, align: "center" });
  if (i < 4) arrow(s, C, x + 1.75, 2.25, x + 3.05, 2.25, C.accent5);
});
s.addShape("roundRect", { x: 0.6, y: 5.0, w: 12.1, h: 1.55, rectRadius: 0.12, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "rule" });
txt(s, [
  { text: "시작 스위치  ", options: { bold: true, color: C.accent6, fontSize: 18 } },
  { text: "모든 반응은 휴대폰의 ", options: { fontSize: 16 } },
  { text: "“🚶 걷기 테스트 시작”", options: { bold: true, fontSize: 16 } },
  { text: "을 눌러야 시작됩니다. 정렬만 해서는 아무것도 울리지 않고, 버튼을 끄면 언리얼·ESP32·UWB 모터까지 모두 멈춥니다.", options: { fontSize: 16 } },
], { x: 0.9, y: 5.15, w: 11.5, h: 1.25, valign: "middle" });
s.addNotes("전체 흐름은 다섯 단계입니다. 휴대폰으로 방을 스캔하고, GitHub를 통해 웹과 언리얼이 같은 스캔을 공유합니다. 관객의 위치는 휴대폰 또는 UWB 태그로 추적하고, 언리얼이 매 프레임 가장 가까운 사물까지의 거리를 계산해서 진동과 소리, 빛으로 돌려줍니다. 그리고 중요한 규칙 하나, 모든 반응은 휴대폰의 걷기 테스트 시작 버튼을 눌러야만 시작됩니다.");

// ========================================================================== 3 전체 구조
s = pres.addSlide(T("소개"));
s.addText("전체 구조: 저장 경로와 실시간 경로가 나뉩니다", { placeholder: "title" });
box(s, C, 0.6, 1.55, 2.6, 0.95, "휴대폰 앱\nAndroid · iPhone", C.accent1);
box(s, C, 0.6, 3.35, 2.6, 0.95, "UWB 태그 + 앵커 4\n라즈베리파이", C.accent2);
box(s, C, 0.6, 5.15, 2.6, 0.95, "ESP32\n(예전 방식)", C.accent5);
box(s, C, 5.35, 3.25, 2.7, 1.15, "언리얼 ARKO\nPhoneTwinLink 플러그인", C.text2);
box(s, C, 5.35, 1.4, 2.7, 0.85, "GitHub 저장소", C.accent5);
box(s, C, 10.2, 1.4, 2.5, 0.85, "웹 뷰어 · 몰입 보기", C.accent3);
box(s, C, 10.2, 3.35, 2.5, 0.95, "DigitalOcean\nWebSocket 릴레이", C.accent4);
box(s, C, 10.2, 5.15, 2.5, 0.95, "TouchDesigner\nOSC 7000 → 7001", C.accent6);
arrow(s, C, 3.2, 1.9, 5.35, 1.82, C.accent5, "스캔 업로드", { dy: 0.05 });
arrow(s, C, 8.05, 1.82, 10.2, 1.82, C.accent5, "Pages · web_scans");
arrow(s, C, 6.7, 2.25, 6.7, 3.25, C.accent5);
txt(s, "90초마다 자동 반입", { x: 6.85, y: 2.55, w: 2.2, h: 0.35, fontSize: 11, color: C.accent5 });
arrow(s, C, 3.2, 2.2, 5.35, 3.55, C.accent1, "", { both: true });
txt(s, "PTP1 / PTH1", { x: 4.0, y: 2.33, w: 1.4, h: 0.3, fontSize: 11, color: C.accent1 });
arrow(s, C, 3.2, 3.82, 5.35, 3.82, C.accent2, "OSC 8000 / PTH1", { both: true, dy: 0.05 });
arrow(s, C, 3.2, 5.6, 5.35, 4.2, C.accent5, "", { both: true });
txt(s, "PTE1 / PTH1", { x: 4.3, y: 5.1, w: 1.6, h: 0.3, fontSize: 11, color: C.accent5 });
arrow(s, C, 8.05, 3.82, 10.2, 3.82, C.accent4, "PTU1 · PTH1", { both: true, dash: true, dy: 0.05 });
arrow(s, C, 8.05, 4.2, 10.2, 5.5, C.accent6, "", {});
txt(s, "/phonetwin/*", { x: 7.6, y: 5.0, w: 1.4, h: 0.3, fontSize: 11, color: C.accent6 });
txt(s, [
  { text: "실선 = 같은 공유기 UDP/OSC (2~10ms)   ", options: { color: C.text1 } },
  { text: "점선 = 인터넷 릴레이 (약 0.3초)   ", options: { color: C.accent4 } },
  { text: "GitHub = 저장 전용, 실시간 아님", options: { color: C.accent5 } },
], { x: 0.6, y: 6.45, w: 12.1, h: 0.35, fontSize: 12 });
s.addNotes("구조를 크게 보면 두 갈래입니다. 위쪽은 저장 경로로, 스캔 파일이 GitHub에 올라가고 웹 뷰어와 언리얼이 각각 가져갑니다. 이 경로는 실시간이 아닙니다. 가운데는 실시간 경로로, 휴대폰, UWB 태그, ESP32가 위치를 언리얼에 보내고 언리얼이 진동 값을 돌려줍니다. 같은 공유기면 UDP로 직접, 다른 네트워크면 DigitalOcean 릴레이를 거칩니다. 언리얼은 TouchDesigner에도 OSC로 관객 정보를 보냅니다.");

// ========================================================================== 4 구성 요소
s = pres.addSlide(T("소개"));
s.addText("만든 것: 7개의 구성 요소", { placeholder: "title" });
const parts = [
  ["휴대폰 앱", "Android 0.4.5 (Java · ARCore)\niPhone 0.4.2 (Swift · ARKit)", C.accent1],
  ["언리얼 플러그인", "PhoneTwinLink (C++, UE 5.5)\nARKO_PROJECT에 설치", C.text2],
  ["웹", "스캔 뷰어 · 몰입 보기 ·\n콜리전 편집기 (Three.js)", C.accent3],
  ["릴레이 서버", "Node.js WebSocket\nDigitalOcean App Platform", C.accent4],
  ["UWB · 모터", "앵커·태그 Arduino 스케치\n파이 게이트웨이 (Python)", C.accent2],
  ["TouchDesigner", "OSC 수신 → 지도·빛 흔적\n→ OSC 송신", C.accent6],
  ["도구", "시뮬레이터 · 스캔 동기화 ·\n보관 · 임시 소리 생성", C.accent5],
];
parts.forEach((p, i) => {
  const col = i % 4, row = Math.floor(i / 4);
  const x = 0.6 + col * 3.075, y = 1.5 + row * 2.6;
  card(s, C, { x, y, w: 2.9, h: 2.35, head: p[0], body: p[1], color: p[2], headSize: 18, bodySize: 14 });
});
s.addShape("roundRect", { x: 0.6 + 3 * 3.075, y: 4.1, w: 2.9, h: 2.35, rectRadius: 0.12, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: "repo" });
txt(s, [
  { text: "공개 저장소", options: { bold: true, fontSize: 16, color: "9FD8E6", breakLine: true } },
  { text: "github.com/jy3266/PhoneTwin", options: { fontSize: 13, color: C.background1, breakLine: true } },
  { text: "웹: jy3266.github.io/PhoneTwin", options: { fontSize: 13, color: C.background1 } },
], { x: 0.85 + 3 * 3.075, y: 4.35, w: 2.5, h: 1.9, paraSpaceAfter: 6 });
s.addNotes("이번 프로젝트에서 만든 것은 크게 일곱 가지입니다. 안드로이드와 아이폰 앱, 언리얼 C++ 플러그인, 웹 페이지 세 종류, 인터넷 릴레이 서버, UWB 하드웨어와 라즈베리파이 게이트웨이, TouchDesigner 네트워크, 그리고 장비 없이 시험할 수 있는 여러 도구입니다. 코드는 모두 공개 GitHub 저장소에 있습니다.");

// ========================================================================== 5 타임라인
s = pres.addSlide(T("소개"));
s.addText("개발 과정: 한 달 동안의 흐름", { placeholder: "title" });
const tl = [
  ["10.11", "v4 시작", "넓은 화각·정밀 스캔, GitHub·웹, 언리얼 플러그인, 릴레이"],
  ["10.14", "iPhone 앱", "Swift/ARKit, Actions로 빌드"],
  ["10.28", "TD · 웹 실시간", "OSC 연동, 원거리 카메라, 웹 관객 표시"],
  ["10.29", "정렬 · 소리 · 빛", "자동 A·B, 차분한 소리, 빛나는 점구름"],
  ["10.31", "콜리전 편집기", "실제 형태 콜리전, 원본 이중 보관"],
  ["11.05", "몰입 보기 · UWB", "빛의 나비, 물결, 파이 게이트웨이"],
  ["11.06", "GPU · 앱 0.4.5", "170fps, 앱=언리얼 소리, 자동 연결"],
  ["11.12", "Apeficiation", "원본 게이트웨이 연결, 시뮬레이터"],
];
s.addShape("line", { x: 0.8, y: 3.85, w: 11.7, h: 0, line: { color: C.accent5, width: 2 }, objectName: "axis" });
tl.forEach((t, i) => {
  const x = 0.6 + i * 1.53, up = i % 2 === 0;
  s.addShape("ellipse", { x: x + 0.55, y: 3.7, w: 0.3, h: 0.3, fill: { color: C.accent1 }, line: { color: C.background1, width: 2 }, objectName: "dot" });
  txt(s, t[0], { x: x + 0.1, y: up ? 3.25 : 4.15, w: 1.2, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: "center" });
  const by = up ? 1.45 : 4.65;
  s.addShape("roundRect", { x: x - 0.05, y: by, w: 1.5, h: 1.7, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "event" });
  txt(s, t[1], { x: x + 0.05, y: by + 0.1, w: 1.3, h: 0.45, fontSize: 13, bold: true, color: C.text2 });
  txt(s, t[2], { x: x + 0.05, y: by + 0.55, w: 1.3, h: 1.1, fontSize: 11 });
});
s.addNotes("개발은 10월 11일 v4를 시작해 약 한 달 동안 진행했습니다. 처음에는 스캔과 저장, 언리얼 반입의 기본 골격을 만들고, 아이폰 앱, TouchDesigner, 정렬 자동화와 소리, 콜리전 편집기, 몰입 보기와 UWB, GPU 최적화를 차례로 더했습니다. 가장 최근에는 협업팀의 Apeficiation 하드웨어 게이트웨이를 그대로 연결했습니다.");

// ========================================================================== 섹션: 휴대폰 앱
section("1. 휴대폰 앱", "스캔 · 정렬 · 걷기 테스트 · 소리와 진동");

// 7 스캔 정밀도
s = pres.addSlide(T("1. 휴대폰 앱"));
s.addText("스캔: 같은 자리를 여러 번 재서 평균합니다", { placeholder: "title" });
stat(s, C, 0.6, 1.45, 2.8, "1.5cm", "복셀(작은 칸) 크기 — 이 칸마다 점 하나", C.accent1, 54);
stat(s, C, 3.6, 1.45, 2.8, "2회+", "두 번 이상 관측된 칸만 저장 (튀는 점 제거)", C.accent1, 54);
stat(s, C, 6.6, 1.45, 2.8, "80만", "한 스캔의 최대 점 수", C.accent1, 54);
stat(s, C, 9.6, 1.45, 3.1, "÷거리²", "가까이서 본 값일수록 더 믿음 (신뢰도 가중)", C.accent1, 54);
card(s, C, { x: 0.6, y: 3.85, w: 5.9, h: 2.8, head: "정밀도를 높인 방법", body: bullets([
  "ARCore 깊이 픽셀을 전부 사용",
  "신뢰도 ÷ 거리² 가중 평균으로 칸의 위치·색 결정",
  "물체 경계에서 튀는 점, 빠르게 움직인 프레임은 제외",
  "첫 점은 정확히 (0,0,0) — PLY로 저장",
], 14), headSize: 17 });
card(s, C, { x: 6.8, y: 3.85, w: 5.9, h: 2.8, head: "화면과 화각", color: C.accent2, body: bullets([
  "스캔하는 동안만 전체화면, 끝나면 원래 UI로 복귀",
  "ARCore가 허용하는 카메라 중 수평 화각이 가장 넓은 것 자동 선택",
  "한계: 대부분 기종은 메인 카메라만 허용 → 초광각 강제 불가",
], 14), headSize: 17 });
s.addNotes("스캔 정밀도는 같은 공간을 여러 번 관측해서 평균을 내는 방식으로 높였습니다. 공간을 1.5센티미터 칸으로 나누고, 각 칸에 들어온 깊이 값을 신뢰도와 거리를 고려해 가중 평균합니다. 가까이서 본 값일수록 더 믿는 거죠. 두 번 이상 관측된 칸만 저장해서 허공에 튀는 점을 없앴습니다. 화각은 ARCore가 허용하는 카메라 중 가장 넓은 것을 자동으로 고르지만, 대부분의 휴대폰은 메인 카메라만 허용해서 초광각을 강제로 쓸 수는 없습니다.");

// 8 정렬 A·B
s = pres.addSlide(T("1. 휴대폰 앱"));
s.addText("정렬: 바닥의 두 점 A·B로 스캔과 현장을 겹칩니다", { placeholder: "title" });
// floor drawing
s.addShape("rect", { x: 0.6, y: 1.5, w: 5.6, h: 4.9, fill: { color: C.background2 }, line: { color: "C9D6E0", width: 1 }, objectName: "floor" });
s.addShape("rect", { x: 0.9, y: 1.8, w: 1.4, h: 0.9, fill: { color: "C9D6E0" }, line: { color: "C9D6E0" }, objectName: "furniture" });
s.addShape("rect", { x: 4.5, y: 4.9, w: 1.4, h: 1.2, fill: { color: "C9D6E0" }, line: { color: "C9D6E0" }, objectName: "furniture" });
txt(s, "가구", { x: 0.9, y: 2.05, w: 1.4, h: 0.4, fontSize: 12, color: C.accent5, align: "center" });
txt(s, "가구", { x: 4.5, y: 5.3, w: 1.4, h: 0.4, fontSize: 12, color: C.accent5, align: "center" });
s.addShape("ellipse", { x: 3.05, y: 3.6, w: 0.5, h: 0.5, fill: { color: C.accent3 }, line: { color: C.accent3 }, objectName: "A" });
txt(s, "A", { x: 3.05, y: 3.6, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle" });
s.addShape("ellipse", { x: 4.75, y: 3.6, w: 0.5, h: 0.5, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: "B" });
txt(s, "B", { x: 4.75, y: 3.6, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle" });
arrow(s, C, 3.55, 3.85, 4.75, 3.85, C.text1);
txt(s, "1m = +X (앞)", { x: 3.4, y: 4.2, w: 2.0, h: 0.35, fontSize: 12, bold: true, align: "center" });
txt(s, "바닥 정중앙", { x: 2.3, y: 3.15, w: 2.0, h: 0.35, fontSize: 12, color: C.accent3, align: "center" });
txt(s, "앱 0.4.5", { x: 0.75, y: 6.0, w: 2.0, h: 0.3, fontSize: 11, color: C.accent5 });
card(s, C, { x: 6.6, y: 1.5, w: 6.1, h: 2.35, head: "스캔 A·B는 앱이 자동으로", num: 1, body: bullets([
  "A = 바닥 점들(±4cm) 범위의 정중앙",
  "B = A에서 방의 긴 축(PCA) 방향으로 1m",
  "가구가 있으면 반대쪽 → 옆 → 대각선, 0.7 · 0.5m",
], 14), headSize: 16 });
card(s, C, { x: 6.6, y: 4.05, w: 6.1, h: 2.35, head: "현장 A·B는 사람이 그 자리를 찍기", num: 2, color: C.accent2, body: bullets([
  "AR 화면에 초록·파란 기둥으로 위치 안내",
  "두 점 → 회전·이동 계산 (최소 0.15m, 1m 미만은 경고)",
  "정렬되면 걷기 테스트가 자동 시작",
], 14), headSize: 16 });
s.addNotes("스캔한 디지털 방과 실제 방을 겹치려면 기준점이 필요합니다. 바닥의 두 점 A와 B를 씁니다. 처음에는 사용자가 직접 찍게 했는데 어렵다는 의견이 있어서, 지금은 앱이 자동으로 정합니다. A는 바닥의 정중앙, B는 방의 긴 방향으로 1미터 떨어진 곳입니다. 가구가 있으면 피해서 다른 방향을 찾습니다. 현장에서는 AR 화면에 보이는 기둥 자리에 서서 A와 B를 찍기만 하면 정렬이 끝나고, 걷기 테스트가 자동으로 시작됩니다.");

// 9 걷기 테스트
s = pres.addSlide(T("1. 휴대폰 앱"));
s.addText("걷기 테스트: 전시 중에는 스캔하지 않고 반응만 합니다", { placeholder: "title" });
const wt = [
  ["걷기 테스트 시작 전", "진동 없음 · 소리 없음\n언리얼 PTP1 walk=0\n→ ESP32·UWB 모터도 0", C.accent5],
  ["걷기 테스트 중", "위치를 30Hz로 언리얼에 전송\n콜리전에 다가가면 소리\n닿으면 종소리 + 톡 진동", C.accent3],
  ["끝 / 앱이 뒤로 감", "pose valid=0\n언리얼은 1.5초 뒤 추적 해제\n모든 모터 정지", C.accent6],
];
wt.forEach((w, i) => {
  const x = 0.6 + i * 4.15;
  s.addShape("roundRect", { x, y: 1.55, w: 3.8, h: 2.6, rectRadius: 0.12, fill: { color: w[2] }, line: { color: w[2] }, objectName: "state" });
  txt(s, w[0], { x: x + 0.3, y: 1.75, w: 3.2, h: 0.5, fontSize: 19, bold: true, color: C.background1 });
  txt(s, w[1], { x: x + 0.3, y: 2.35, w: 3.2, h: 1.6, fontSize: 14, color: C.background1 });
  if (i < 2) arrow(s, C, x + 3.82, 2.85, x + 4.13, 2.85, C.text1);
});
card(s, C, { x: 0.6, y: 4.45, w: 12.1, h: 2.2, head: "0.4.4에서 바꾼 점 (사용자 피드백)", color: C.accent2, body: bullets([
  "걷기 테스트 중 AI 사물 인식을 끔 → 전시 중에 사물이 새로 추가·저장되던 문제 해결",
  "GitHub에서 스캔을 불러올 때 콜리전 파일과 편집기 소리(web_scans/sounds)도 함께 받음",
  "닿음 판정 · 음량 규칙 · 소리 합성기를 언리얼과 똑같이 옮김 (샘플 단위 일치)",
], 14), headSize: 16 });
s.addNotes("걷기 테스트는 일종의 시작 스위치입니다. 누르기 전에는 아무 반응도 없고, 언리얼에도 walk=0을 보내서 다른 장치의 모터까지 멈춥니다. 누르면 위치를 초당 30번 언리얼로 보내고, 휴대폰 자체도 소리와 진동을 냅니다. 0.4.4 버전에서는 전시 중에 AI가 사물을 새로 인식해서 저장하던 문제를 고쳤고, 언리얼과 같은 콜리전과 소리를 쓰도록 맞췄습니다.");

// 10 앱 소리·진동
s = pres.addSlide(T("1. 휴대폰 앱"));
s.addText("휴대폰과 언리얼이 같은 소리를 냅니다", { placeholder: "title" });
box(s, C, 0.6, 1.6, 3.4, 1.0, "콜리전 파일\nweb_scans/<id>.collision.json", C.accent5, 13);
box(s, C, 0.6, 3.1, 3.4, 1.0, "편집기 소리 WAV\n다가감(반복) · 닿음(1회)", C.accent5, 13);
box(s, C, 4.9, 2.35, 3.2, 1.0, "Collisions.java\n거리 · 닿음 판정", C.accent1, 13);
box(s, C, 9.0, 1.6, 3.7, 1.0, "TwinAudio\n48kHz 스테레오 믹서", C.accent3, 13);
box(s, C, 9.0, 3.1, 3.7, 1.0, "CalmSynth.java\n= PhoneTwinCalmSound.cpp", C.accent2, 13);
arrow(s, C, 4.0, 2.1, 4.9, 2.7, C.accent5); arrow(s, C, 4.0, 3.6, 4.9, 3.0, C.accent5);
arrow(s, C, 8.1, 2.7, 9.0, 2.1, C.accent1); arrow(s, C, 8.1, 3.0, 9.0, 3.6, C.accent1);
stat(s, C, 0.6, 4.6, 3.6, "6×10⁻⁸", "Java ↔ 언리얼 C++ 합성음 최대 차이 (175만 샘플 비교)", C.accent2, 40);
card(s, C, { x: 4.6, y: 4.6, w: 8.1, h: 2.05, head: "규칙 (언리얼과 동일)", body: bullets([
  "다가가면 패드: 바닥 거리 400cm에서 시작 → 50cm에서 최대",
  "닿음: 바닥 거리 ≤ 35cm 또는 손 3cm → 종 + 톡 진동, 계속 닿으면 4초마다 작게",
  "편집기 소리가 없으면 사물 이름에 맞는 내장 소리",
], 14), headSize: 16 });
s.addNotes("휴대폰 앱의 소리는 언리얼과 똑같이 들리도록 만들었습니다. 같은 콜리전 파일과 같은 소리 파일을 읽고, 거리와 닿음 판정 규칙도 같습니다. 소리 합성기는 언리얼의 C++ 코드를 자바로 한 줄씩 옮겼고, 실제로 두 코드를 같은 상황에서 렌더링해 비교해 보니 175만 샘플에서 최대 차이가 0.00000006이었습니다. 사실상 같은 소리입니다.");

// 11 iPhone
s = pres.addSlide(T("1. 휴대폰 앱"));
s.addText("iPhone 앱: Mac 없이 GitHub Actions로 빌드", { placeholder: "title" });
const ios = [["ios/ 소스 push", C.accent5], ["Actions macOS 러너\n단위 테스트 16개", C.text2], ["서명 없는 IPA", C.accent1], ["Sideloadly로 설치\n(무료 ID, 7일마다)", C.accent2]];
ios.forEach((p, i) => { box(s, C, 0.6 + i * 3.1, 1.6, 2.7, 1.1, p[0], p[1], 14); if (i < 3) arrow(s, C, 3.3 + i * 3.1, 2.15, 3.7 + i * 3.1, 2.15, C.text1); });
card(s, C, { x: 0.6, y: 3.15, w: 5.9, h: 3.5, head: "안드로이드와 같은 것", color: C.accent3, body: bullets([
  "PLY · scan_data · meta 파일 형식",
  "PTP1 / PTH1 / PTR1 패킷, 설정 키 이름과 번호",
  "LiDAR 스캔 (sceneDepth + 신뢰도 · 경계 · 흔들림 필터)",
  "Core Haptics 진동, 릴레이 키는 Keychain",
], 14), headSize: 16 });
card(s, C, { x: 6.8, y: 3.15, w: 5.9, h: 3.5, head: "아직 다른 것", color: C.accent6, body: bullets([
  "AI 사물 인식 없음 (meta의 사물로 소리만)",
  "자동 스캔 A·B, 자동 연결, 걷기 중 콜리전 소리는 아직 이식 전",
  "ESP32 브로드캐스트 불가 (멀티캐스트 권한)",
  "실기기 시험은 아직 못 함",
], 14), headSize: 16 });
s.addNotes("아이폰 앱도 있습니다. 개발용 Mac이 없어서 GitHub Actions의 macOS 서버에서 빌드하고, 서명 없는 IPA 파일을 Sideloadly로 설치하는 방식입니다. 무료 Apple ID라 7일마다 다시 설치해야 합니다. 파일 형식과 통신 규격은 안드로이드와 같지만, 자동 A·B와 콜리전 소리 같은 최근 기능은 아직 옮기지 못했습니다.");

// ========================================================================== 섹션: 저장과 웹
section("2. 저장과 웹", "GitHub 저장 · 웹 뷰어 · 몰입 보기 · 콜리전 편집기");

// 13 저장
s = pres.addSlide(T("2. 저장과 웹"));
s.addText("저장: 원본은 지키고, 웹과 편집은 복제본으로", { placeholder: "title" });
table(s, C, [
  ["위치", "무엇", "누가 씀"],
  ["scans/index.json", "스캔 목록 (최신이 앞)", "앱 · 언리얼 · 웹"],
  ["scans/<id>.ply", "점구름: float xyz + uchar rgb, 스캔 좌표 S(m, Y 위)", "앱이 한 커밋으로 업로드"],
  ["scans/<id>.json", "meta: bounds, 스캔 A·B, 사물, AI 인식 결과", "앱 · 언리얼 · 웹"],
  ["ScanArchive (C:) + D:", "원본 이중 보관, 읽기 전용, SHA-256 일치 확인", "tools/archive_scans.mjs"],
  ["web_scans/", "웹용 복제본 + collision.json + sounds/", "편집기 · 웹 · 앱 · 언리얼"],
  ["ARKO_PROJECT/PhoneTwinScans", "언리얼용 원본 (Content 밖)", "플러그인이 90초마다 동기화"],
], { x: 0.6, y: 1.5, w: 12.1, colW: [3.3, 5.6, 3.2], size: 13, rowH: 0.5 });
s.addShape("roundRect", { x: 0.6, y: 5.35, w: 12.1, h: 1.25, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "tip" });
txt(s, [
  { text: "왜 Content 밖?  ", options: { bold: true, color: C.accent6 } },
  { text: "Content 안에 .json을 두면 언리얼 에디터가 DataTable로 가져오려 해서 원본은 밖에 두고, 점구름 에셋(<id>_Cloud)만 Content/PhoneTwinScans에 만듭니다." },
], { x: 0.9, y: 5.5, w: 11.5, h: 0.95, fontSize: 14, valign: "middle" });
s.addNotes("저장 구조입니다. 휴대폰이 스캔을 올리면 GitHub의 scans 폴더에 점구름 PLY와 메타 JSON이 한 커밋으로 들어갑니다. 원본은 두 개의 디스크에 읽기 전용으로 이중 보관하고, 웹과 편집은 복제본인 web_scans를 씁니다. 콜리전과 소리도 원본을 건드리지 않도록 별도 파일로 둡니다.");

// 14 웹 뷰어
s = pres.addSlide(T("2. 저장과 웹"));
s.addText("웹 뷰어: 링크만 있으면 누구나 스캔을 봅니다", { placeholder: "title" });
s.addShape("roundRect", { x: 0.6, y: 1.5, w: 6.4, h: 5.1, rectRadius: 0.12, fill: { color: C.text1 }, line: { color: C.text1 }, objectName: "browser" });
txt(s, "jy3266.github.io/PhoneTwin", { x: 0.9, y: 1.65, w: 5.8, h: 0.35, fontSize: 13, color: "9FD8E6", fontFace: "Consolas" });
for (let i = 0; i < 260; i++) {
  const a = (i * 137.5) % 360, r = 0.3 + ((i * 53) % 100) / 100 * 2.0;
  const px = 3.8 + Math.cos(a * Math.PI / 180) * r * 1.25, py = 4.1 + Math.sin(a * Math.PI / 180) * r * 0.9;
  if (py < 2.2 || py > 6.3) continue;
  s.addShape("ellipse", { x: px, y: py, w: 0.05, h: 0.05, fill: { color: i % 5 ? "4FB3CF" : "F2C14E" }, line: { color: i % 5 ? "4FB3CF" : "F2C14E" }, objectName: "pt" });
}
s.addShape("ellipse", { x: 3.65, y: 3.95, w: 0.3, h: 0.3, fill: { color: C.accent2 }, line: { color: C.background1, width: 2 }, objectName: "audience" });
txt(s, "관객 (PTU1)", { x: 4.05, y: 3.95, w: 1.6, h: 0.3, fontSize: 12, color: C.background1 });
card(s, C, { x: 7.3, y: 1.5, w: 5.4, h: 2.4, head: "스캔 보기", body: bullets([
  "index.json에서 목록, PLY를 브라우저에서 바로 3D로",
  "콜리전(실제 형태)·스캔 A·B 표시",
  "편집기가 마지막에 저장한 스캔부터 엶",
], 14), headSize: 16 });
card(s, C, { x: 7.3, y: 4.2, w: 5.4, h: 2.4, head: "실시간 패널", color: C.accent4, body: bullets([
  "열자마자 릴레이에 viewer로 자동 연결 (읽기 전용)",
  "언리얼이 15Hz로 보내는 관객 위치 · 궤적",
  "사물별 거리 목록 (오른쪽 위)",
], 14), headSize: 16 });
s.addNotes("웹 뷰어는 GitHub Pages로 운영합니다. 링크만 열면 누구나 스캔을 3D로 볼 수 있습니다. 릴레이에 읽기 전용으로 자동 연결되기 때문에, 전시장에서 관객이 걷고 있으면 원격에서도 관객 위치와 궤적, 사물까지의 거리가 실시간으로 보입니다.");

// 15 몰입 보기
s = pres.addSlide(T("2. 저장과 웹"));
s.addText("몰입 보기: 관객이 걸어간 곳만 또렷해지는 공간", { placeholder: "title" });
s.addShape("roundRect", { x: 0.6, y: 1.5, w: 5.2, h: 5.1, rectRadius: 0.12, fill: { color: "0A1220" }, line: { color: "0A1220" }, objectName: "dark" });
for (let i = 0; i < 300; i++) {
  const px = 0.8 + ((i * 71) % 480) / 100, py = 1.7 + ((i * 37) % 460) / 100;
  const d = Math.hypot(px - 3.2, py - 4.0);
  const col = d < 0.9 ? "F2C14E" : d < 1.4 ? "8FD3E8" : "2B4C6F";
  s.addShape("ellipse", { x: px, y: py, w: d < 0.9 ? 0.07 : 0.04, h: d < 0.9 ? 0.07 : 0.04, fill: { color: col }, line: { color: col }, objectName: "pt" });
}
s.addShape("ellipse", { x: 2.2, y: 3.0, w: 2.0, h: 2.0, fill: { type: "none" }, line: { color: "F2C14E", width: 1.5, dashType: "dash" }, objectName: "wave" });
txt(s, "닿으면 금빛 파동", { x: 2.2, y: 5.15, w: 2.0, h: 0.3, fontSize: 11, color: "F2C14E", align: "center" });
const im = [
  ["빛의 나비", "관객 = 빛나는 날개·빛가루, 걸을수록 날갯짓이 빨라짐 (0.75배 크기)"],
  ["보는 방식 3가지", "물결(기본: 콜리전에 닿으면 금빛 파동) · 기억(지나간 자리 흔적) · 별빛"],
  ["가까이는 실제 색", "반경 160cm만 또렷, 먼 점은 푸른 먼지로 흩어져 떠다님"],
  ["휴대폰 손 움직임", "✋ = 기울기로 시선, 끌기 = 둘러보기, 두 손가락 = 거리, 길게 = 걷기"],
  ["실제 사람 우선", "시스템이 연결돼 있으면 키보드 걷기를 끄고 실제 관객만 따라감"],
];
im.forEach((r, i) => {
  const y = 1.5 + i * 1.03;
  s.addShape("ellipse", { x: 6.15, y: y + 0.1, w: 0.42, h: 0.42, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: "dot" });
  txt(s, String(i + 1), { x: 6.15, y: y + 0.1, w: 0.42, h: 0.42, fontSize: 13, bold: true, color: C.background1, align: "center", valign: "middle" });
  txt(s, r[0], { x: 6.8, y: y + 0.05, w: 5.9, h: 0.38, fontSize: 16, bold: true, color: C.text2 });
  txt(s, r[1], { x: 6.8, y: y + 0.45, w: 5.9, h: 0.5, fontSize: 13 });
});
s.addNotes("몰입 보기는 작품의 시각적인 핵심입니다. 관객은 빛을 가진 나비로 표현되고, 나비 주변만 실제 색으로 또렷하게 보이며, 먼 곳은 푸른 먼지처럼 흩어져 떠다닙니다. 기본인 물결 모드에서는 관객이 사물에 닿는 순간 그 자리에서 금빛 파동이 퍼집니다. 휴대폰에서는 기울기와 손가락으로 둘러볼 수 있고, 실제 시스템이 연결되어 있으면 키보드 조작은 꺼지고 실제 관객만 따라갑니다.");

// 16 콜리전 편집기
s = pres.addSlide(T("2. 저장과 웹"));
s.addText("콜리전 편집기: 사물의 실제 모양과 소리를 정합니다", { placeholder: "title" });
const ed = [
  ["1", "자동 생성", "스캔 사물 104개 → 실제 형태\n(39개는 \"손봐 주세요\")", C.accent5],
  ["2", "다듬기", "지우기 · 상자 추가 ·\n옮기기 · 회전(5) · 크기(6)", C.accent1],
  ["3", "소리 넣기", "사물마다 다가감 · 닿음 WAV,\n거리별 음량 시험", C.accent3],
  ["4", "저장", "collisions/ + last_saved.txt\n+ web_scans/edited.json", C.accent2],
];
ed.forEach((e, i) => {
  const x = 0.6 + i * 3.1;
  card(s, C, { x, y: 1.5, w: 2.85, h: 2.3, head: e[1], body: e[2], num: e[0], color: e[3], headSize: 17, bodySize: 13 });
});
box(s, C, 0.6, 4.25, 3.6, 0.9, "저장 즉시", C.text2, 16);
box(s, C, 4.8, 4.25, 3.6, 0.9, "언리얼: 1초 안에\n그 스캔으로 전환", C.accent1, 14);
box(s, C, 9.0, 4.25, 3.7, 0.9, "15초 뒤 GitHub 자동 푸시\n→ 웹 · 휴대폰 앱", C.accent3, 14);
arrow(s, C, 4.2, 4.7, 4.8, 4.7, C.text1); arrow(s, C, 8.4, 4.7, 9.0, 4.7, C.text1);
s.addShape("roundRect", { x: 0.6, y: 5.5, w: 12.1, h: 1.1, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "bug" });
txt(s, [
  { text: "고친 버그  ", options: { bold: true, color: C.accent6 } },
  { text: "상자를 옮기면 모양이 변함 → 칸 번호(cellKey)가 2⁵³을 넘어 서로 다른 칸이 같은 번호가 됨. 키를 1<<16 단위로 바꾸고, 옮기기는 정수 이동으로." },
], { x: 0.9, y: 5.6, w: 11.5, h: 0.9, fontSize: 14, valign: "middle" });
s.addNotes("콜리전 편집기는 사물의 실제 모양과 소리를 정하는 웹 도구입니다. 스캔에서 사물 모양을 자동으로 만들고, 사람이 다듬은 뒤, 사물마다 다가갈 때와 닿을 때의 소리를 넣습니다. 저장하면 언리얼이 1초 안에 그 스캔으로 바뀌고, 15초 뒤 GitHub에 자동으로 올라가 웹과 휴대폰에도 반영됩니다. 개발 중 상자를 옮기면 모양이 깨지는 버그가 있었는데, 숫자 범위 문제였고 지금은 고쳤습니다.");

// ========================================================================== 섹션: 언리얼
section("3. 언리얼 (ARKO_PROJECT)", "PhoneTwinLink 플러그인 · 거리 계산 · 소리 · 빛");

// 18 플러그인 구조
s = pres.addSlide(T("3. 언리얼 (ARKO_PROJECT)"));
s.addText("PhoneTwinLink 플러그인: Play를 누르면 알아서 붙습니다", { placeholder: "title" });
table(s, C, [
  ["파일", "하는 일"],
  ["PhoneTwinScanActor", "메인: UDP 7777 · OSC 8000 · 릴레이 수신, 거리 계산, PTH1 송신, 소리, HUD, 키 입력"],
  ["PhoneTwinCore", "PLY·meta 읽기, 좌표 변환, 2단계 근접점 격자, 패킷 해석"],
  ["PhoneTwinSync", "GitHub 다운로더, 설정 (Project Settings > Plugins > Phone Twin)"],
  ["PhoneTwinCloud / Material", "점구름 만들기, 몰입 보기 셰이더 (HLSL 커스텀 노드 2개)"],
  ["PhoneTwinCalmSound", "사물별 음색, 패드 · 종 · 물방울 · 잔향 합성기"],
  ["PhoneTwinWorldSubsystem", "Play 시 액터가 없으면 PhoneTwinScan_Auto 자동 생성"],
  ["PhoneTwinLinkEditor", "에디터: 90초마다 GitHub 동기화 → 점구름 에셋 저장"],
], { x: 0.6, y: 1.5, w: 12.1, colW: [3.4, 8.7], size: 13, rowH: 0.5 });
pill(s, 0.6, 5.85, 2.6, "자동화 테스트 8종", C.accent3);
pill(s, 3.4, 5.85, 2.6, "UE 5.5 · C++", C.text2);
pill(s, 6.2, 5.85, 3.2, "LidarPointCloud 사용", C.accent1);
s.addNotes("언리얼 쪽은 PhoneTwinLink라는 C++ 플러그인 하나로 동작합니다. 원래 블루프린트 전용 프로젝트였던 ARKO_PROJECT에 최소한의 C++ 모듈을 추가했습니다. Play를 누르면 레벨에 액터가 없어도 자동으로 생성되고, 휴대폰, UWB, 릴레이에서 오는 신호를 모두 받습니다. 에디터는 90초마다 GitHub에서 새 스캔을 받아 점구름 에셋으로 만듭니다.");

// 19 거리 → 진동
s = pres.addSlide(T("3. 언리얼 (ARKO_PROJECT)"));
s.addText("거리 → 진동 세기: 30cm부터 커져서 3cm에서 최대", { placeholder: "title" });
const dx = [], dy = [];
for (let d = 0; d <= 40; d += 1) { dx.push(String(d)); dy.push(d >= 30 ? 0 : Math.round(Math.min(1, Math.max(0, (30 - d) / 27)) * 255)); }
s.addChart(pres.charts.LINE, [{ name: "intensity", labels: dx, values: dy }], {
  x: 0.6, y: 1.45, w: 6.6, h: 4.6, showTitle: true, title: "PTH1 intensity (0~255) — 거리(cm)", titleFontSize: 14, titleColor: HEX.dk1, titleFontFace: "+mn-lt",
  chartColors: [HEX.accent2], lineSize: 3, lineDataSymbol: "none", showLegend: false,
  catAxisLabelColor: HEX.accent5, valAxisLabelColor: HEX.accent5, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
  catAxisLabelFrequency: 5, valAxisMaxVal: 255, valAxisMinVal: 0, valAxisMajorUnit: 64,
  valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" },
});
codeBox(s, 0.6, 6.15, 6.6, 0.55, "intensity = clamp((30 − d) / (30 − 3), 0, 1) × 255", 13);
card(s, C, { x: 7.5, y: 1.45, w: 5.2, h: 5.25, head: "매 프레임 하는 일", body: bullets([
  "관객 위치(+손 위치 오프셋)를 스캔 좌표로 변환",
  "2단계 근접점 격자로 가장 가까운 표면·사물 찾기 (바닥은 제외)",
  "거리 → 세기, 3cm 이내 = contact",
  "SendRateHz 30으로 PTH1 송신: ESP32·파이(4210), 휴대폰(4211), 릴레이",
  "블루프린트 이벤트 OnProximity로도 전달",
  "Details에서 ReactRange · ContactDistance 조절",
], 14), headSize: 17 });
s.addNotes("언리얼의 핵심 계산은 거리입니다. 매 프레임 관객 위치에서 가장 가까운 표면이나 사물까지의 거리를 찾습니다. 점이 수십만 개라서 2단계 격자로 빠르게 찾습니다. 30센티미터 안에 들어오면 진동이 시작되고, 3센티미터에서 최대 255가 됩니다. 이 값을 초당 30번 PTH1이라는 한 줄짜리 메시지로 ESP32, 라즈베리파이, 휴대폰에 보냅니다. 두 거리 값은 Details 패널에서 바꿀 수 있습니다.");

// 20 소리
s = pres.addSlide(T("3. 언리얼 (ARKO_PROJECT)"));
s.addText("소리: 사물마다 다른 차분한 음색", { placeholder: "title" });
const voices = [["찻잔·그릇", "싱잉볼 허밍"], ["키보드", "잔잔한 빗방울"], ["TV", "따뜻한 전자 패드"], ["유리병", "병 입구 숨결"], ["마우스", "작은 물방울"], ["책", "종이 바람결"]];
voices.forEach((v, i) => {
  const col = i % 3, row = Math.floor(i / 3), x = 0.6 + col * 2.1, y = 1.55 + row * 1.5;
  s.addShape("roundRect", { x, y, w: 1.9, h: 1.3, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "voice" });
  txt(s, v[0], { x, y: y + 0.15, w: 1.9, h: 0.45, fontSize: 17, bold: true, color: C.text2, align: "center" });
  txt(s, v[1], { x, y: y + 0.65, w: 1.9, h: 0.45, fontSize: 14, color: C.accent2, align: "center" });
});
txt(s, "다가갈 때의 음색 — 닿으면 도자기 종 · 마림바 · 전자 피아노 · 하프 등 (CalmVoiceFor 표)",{ x: 0.6, y: 4.6, w: 6.2, h: 0.35, fontSize: 11, color: C.accent5 });
card(s, C, { x: 7.2, y: 1.55, w: 5.5, h: 2.65, head: "두 가지 소리", color: C.accent2, body: bullets([
  "다가감 = 패드: 바닥 거리 400cm → 50cm로 커짐",
  "닿음 = 종: 35cm 이내 또는 손 접촉, 계속 닿으면 4초마다 작게",
  "D장조 5음계 + 잔향 → 겹쳐도 불협화음 없음",
], 14), headSize: 16 });
card(s, C, { x: 7.2, y: 4.4, w: 5.5, h: 2.25, head: "직접 고른 소리로 바꾸기", color: C.accent3, body: bullets([
  "콜리전 편집기에서 사물마다 WAV 지정 (우선)",
  "언리얼 Details의 ObjectSounds · TouchSounds",
  "닿으면 OSC /phonetwin/touch도 보냄",
], 14), headSize: 16 });
s.addShape("roundRect", { x: 0.6, y: 5.1, w: 6.2, h: 1.55, rectRadius: 0.1, fill: { color: C.text2 }, line: { color: C.text2 }, objectName: "why" });
txt(s, "처음엔 비프음이었지만 “차분하게, AI가 인식한 사물에서 영감을”이라는 요청에 따라 합성기를 새로 만들었습니다.", { x: 0.85, y: 5.2, w: 5.7, h: 1.35, fontSize: 14, color: C.background1, valign: "middle" });
s.addNotes("소리는 처음에는 단순한 비프음이었는데, 차분하고 사물에서 영감을 받은 소리를 원한다는 요청에 따라 합성기를 새로 만들었습니다. 사물 종류마다 음색이 다르고, 다가갈 때는 부드러운 패드가, 닿으면 종소리가 납니다. 모든 소리가 D장조 5음계라서 여러 사물이 동시에 울려도 어울립니다. 물론 편집기에서 직접 고른 소리 파일로 바꿀 수 있습니다.");

// 21 빛 / GPU
s = pres.addSlide(T("3. 언리얼 (ARKO_PROJECT)"));
s.addText("빛: 점구름을 다시 만들지 않고 셰이더로 칠합니다", { placeholder: "title" });
stat(s, C, 0.6, 1.5, 3.0, "6~8Hz", "예전: 45만 점을 다시 만들어 GPU로 올림 (SetData 130ms)", C.accent6, 54);
arrow(s, C, 3.7, 2.0, 4.6, 2.0, C.text1);
stat(s, C, 4.8, 1.5, 3.4, "133~183", "지금: 머티리얼 셰이더, fps (같은 45만 점 스캔)", C.accent3, 54);
card(s, C, { x: 8.6, y: 1.5, w: 4.1, h: 2.4, head: "원인 → 해결", color: C.text2, body: "관객이 움직일 때마다 점 색을 CPU에서 계산해 점구름을 통째로 교체 → 끊김. 이제 점은 그대로 두고 매 프레임 파라미터와 흔적 텍스처(128²)만 바꿈.", bodySize: 13, headSize: 16 });
card(s, C, { x: 0.6, y: 4.2, w: 6.0, h: 2.45, head: "웹 몰입 보기와 같은 식", color: C.accent1, body: bullets([
  "Look: 물결(기본) · 기억 · 별빛 · 예전 빛 — 키 L",
  "가까이 실제 색, 멀리 푸른 먼지(World Position Offset)",
  "닿음 종이 울리는 순간 금빛 파동 (최대 4개)",
], 14), headSize: 16 });
card(s, C, { x: 6.9, y: 4.2, w: 5.8, h: 2.45, head: "Play 화면", color: C.accent4, body: bullets([
  "레벨의 모든 액터를 숨기고 어두운 배경에 점구름만 (H)",
  "고정 노출 · 블룸 · 비네트",
  "점은 솎지 않음 (솎으면 점이 커져 덩어리로 보임)",
], 14), headSize: 16 });
s.addNotes("빛 표현에서 가장 큰 문제는 성능이었습니다. 처음에는 관객이 움직일 때마다 45만 개 점의 색을 다시 계산해 통째로 교체했는데, 이 교체가 130밀리초씩 걸려서 화면이 초당 6에서 8번밖에 바뀌지 않았습니다. 지금은 점은 그대로 두고 셰이더가 매 프레임 색을 칠하는 방식으로 바꿔서 133에서 183 fps가 나옵니다. 모양은 웹의 몰입 보기와 같은 식을 씁니다.");

// 22 조작
s = pres.addSlide(T("3. 언리얼 (ARKO_PROJECT)"));
s.addText("언리얼 조작: 키 하나로 바뀝니다", { placeholder: "title" });
table(s, C, [
  ["키", "기능", "키", "기능"],
  ["1 / 2", "입력: 휴대폰 / UWB 태그(ESP32)", "V", "보기: 전체 · 장치 · 캐릭터"],
  ["7 / 8 / 9", "UWB 좌표 A·B 맞추기 / 지우기", "Q / E", "회전"],
  ["L", "빛 모양: 물결·기억·별빛·예전", "휠 · Z / X", "거리"],
  ["K", "빛 켜기/끄기", "[ / ]", "점 크기"],
  ["H", "레벨 메쉬 숨기기", "C", "시점 따라가기"],
  ["N", "다음 스캔", "G", "GitHub 동기화"],
  ["B", "콜리전 다시 읽기", "M", "마우스 커서"],
], { x: 0.6, y: 1.5, w: 12.1, colW: [1.6, 4.45, 1.6, 4.45], size: 14, rowH: 0.52 });
codeBox(s, 0.6, 5.85, 12.1, 0.8, "콘솔: PhoneTwin.Source phone|esp32 · PhoneTwin.Look 0~3 · PhoneTwin.UwbMark A|B|clear · PhoneTwin.Sync", 13);
s.addNotes("언리얼 화면에서는 키 하나로 대부분을 바꿀 수 있습니다. 1과 2로 입력 장치를 고르고, 7과 8로 UWB 좌표를 스캔에 맞추고, L로 빛 모양을 바꿉니다. 화면 왼쪽 위 HUD에 현재 상태와 누를 키가 안내됩니다.");

// ========================================================================== 섹션: 연동
section("4. 연동 방식", "통신 경로 · 메시지 규격 · 좌표 · 시작 게이트 · TouchDesigner");

// 24 통신 비교
s = pres.addSlide(T("4. 연동 방식"));
s.addText("세 가지 경로를 역할에 맞게 씁니다", { placeholder: "title" });
const routes = [
  ["같은 Wi-Fi UDP / OSC", "2~10ms", "기본 실시간 경로. 전시 본 운영", C.accent1],
  ["인터넷 릴레이 (WebSocket)", "≈0.3초", "위치 변화 → 진동 변화 실측 270~310ms. 네트워크가 다를 때", C.accent4],
  ["GitHub", "저장 전용", "스캔·콜리전·소리 파일 공유. 실시간 불가", C.accent5],
];
routes.forEach((r, i) => {
  const x = 0.6 + i * 4.1;
  s.addShape("roundRect", { x, y: 1.5, w: 3.85, h: 3.0, rectRadius: 0.12, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "route" });
  txt(s, r[0], { x: x + 0.25, y: 1.7, w: 3.35, h: 0.5, fontSize: 16, bold: true, color: r[3] });
  txt(s, r[1], { x: x + 0.25, y: 2.25, w: 3.35, h: 0.95, fontSize: 44, bold: true, color: r[3], valign: "middle" });
  txt(s, r[2], { x: x + 0.25, y: 3.3, w: 3.35, h: 1.1, fontSize: 13 });
});
card(s, C, { x: 0.6, y: 4.8, w: 12.1, h: 1.85, head: "왜 블루투스가 아니라 UDP?", color: C.text2, body: bullets([
  "휴대폰·ESP32·파이·PC가 모두 같은 공유기에 붙으면 장치 수에 상관없이 한 방식으로 연결 — 페어링 불필요",
  "DigitalOcean App Platform은 UDP를 못 받아서 릴레이는 WebSocket. 언리얼 WebSocket 처리 주기를 30Hz → 2ms로 줄여 1.5초 밀림 해결",
], 14), headSize: 16 });
s.addNotes("통신 경로는 세 가지입니다. 같은 공유기 안의 UDP와 OSC가 기본이고 지연이 2에서 10밀리초입니다. 장치가 다른 네트워크에 있으면 DigitalOcean의 웹소켓 릴레이를 거치는데, 위치가 바뀌고 진동이 바뀌기까지 약 0.3초가 걸립니다. GitHub는 파일 저장용이라 실시간에는 쓰지 않습니다. 블루투스 대신 UDP를 고른 이유는 장치가 여러 개여도 페어링 없이 한 방식으로 묶을 수 있기 때문입니다.");

// 25 메시지 규격
s = pres.addSlide(T("4. 연동 방식"));
s.addText("메시지 규격: 쉼표로 나눈 텍스트 한 줄", { placeholder: "title" });
table(s, C, [
  ["메시지", "보내는 쪽 → 받는 쪽", "내용"],
  ["PTP1", "휴대폰 → 언리얼 (UDP 7777)", "seq, valid, 위치 xyz, 앞 fx fy fz, 위 ux uy uz, scanId, walk — 스캔 좌표 S (m)"],
  ["PTE1", "ESP32 · 파이 → 언리얼", "seq, valid, x y z, yaw pitch roll — 방 좌표 R (m)"],
  ["OSC /tag/*", "파이 → 언리얼 (UDP 8000)", "/tag/position x y z (cm), /tag/heading, /tag/quality"],
  ["PTH1", "언리얼 → 모든 장치 (30Hz)", "seq, valid, intensity 0~255, contact, objectId, distanceMm"],
  ["PTA1", "장치 → 언리얼", "lastSeq, rssi — 진동 받았음 응답"],
  ["PTM1", "휴대폰 → 언리얼 (1초마다)", "휴대폰의 스캔 A·B (언리얼 바닥에 초록·파랑·화살표)"],
  ["PTU1", "언리얼 → 웹 (15Hz)", "관객 위치·방향·가장 가까운 사물·거리·세기"],
  ["PTR1", "릴레이 ↔ 모두", "welcome · peers · ping/pong (지연 측정)"],
], { x: 0.6, y: 1.5, w: 12.1, colW: [1.7, 3.6, 6.8], size: 13, rowH: 0.5 });
s.addNotes("장치끼리 주고받는 메시지는 모두 쉼표로 나눈 텍스트 한 줄입니다. 그래서 어떤 언어로도 쉽게 읽고 쓸 수 있고, UDP든 릴레이든 같은 줄을 그대로 보냅니다. 휴대폰은 PTP1로 위치를, UWB는 OSC나 PTE1로 위치를 보내고, 언리얼은 PTH1로 진동 세기를 모든 장치에 돌려줍니다. 웹에는 PTU1로 관객 정보를 보냅니다. 자세한 규격은 저장소의 PROTOCOL.md에 있습니다.");

// 26 좌표계
s = pres.addSlide(T("4. 연동 방식"));
s.addText("좌표: 세 좌표계를 언리얼 하나로 모읍니다", { placeholder: "title" });
const frames = [
  ["스캔 좌표 S", "휴대폰 · PLY", "m, Y가 위\n(ARCore/ARKit 그대로)", "(x, z, y) × 100", C.accent1],
  ["방 좌표 R", "PTE1 · 우리 게이트웨이", "m, Z가 위, +Y = 왼쪽\nA = 원점, A→B = +X", "(x, −y, z) × 100\nyaw 부호 반대", C.accent2],
  ["UWB 원 좌표", "Apeficiation pi_gateway", "cm, 원점 = 앵커 1 모서리", "키 7·8로 A·B 맞춤\n→ R로 변환", C.accent4],
];
frames.forEach((f, i) => {
  const y = 1.5 + i * 1.45;
  box(s, C, 0.6, y, 3.0, 1.2, f[0] + "\n" + f[1], f[4], 14);
  txt(s, f[2], { x: 3.85, y: y + 0.15, w: 3.4, h: 0.95, fontSize: 14, valign: "middle" });
  arrow(s, C, 7.3, y + 0.6, 8.2, y + 0.6, f[4]);
  txt(s, f[3], { x: 8.3, y: y + 0.15, w: 2.4, h: 0.95, fontSize: 13, bold: true, color: f[4], valign: "middle" });
});
box(s, C, 10.8, 1.5, 1.9, 4.1, "언리얼\n좌표\n(cm, Z 위)", C.text2, 16);
s.addShape("roundRect", { x: 0.6, y: 5.95, w: 12.1, h: 0.75, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "tip" });
txt(s, "스캔 meta에 A·B가 있으면 A = 원점, A→B = +X로 돌려 맞춥니다. 그래서 UWB 앵커를 A·B 기준으로 두면 보정 없이 일치합니다.", { x: 0.9, y: 6.0, w: 11.5, h: 0.65, fontSize: 14, valign: "middle" });
s.addNotes("좌표계가 세 가지라서 혼동하기 쉽습니다. 휴대폰 스캔은 Y가 위인 미터 단위, 우리 게이트웨이와 ESP32는 Z가 위인 방 좌표, Apeficiation 원본 게이트웨이는 앵커 모서리가 원점인 센티미터 단위입니다. 언리얼은 이 셋을 모두 받아서 자기 좌표로 바꿉니다. 공통의 기준은 바닥의 A와 B 두 점입니다.");

// 27 시작 게이트
s = pres.addSlide(T("4. 연동 방식"));
s.addText("시작 게이트: walk 값 하나가 전체를 켜고 끕니다", { placeholder: "title" });
box(s, C, 0.6, 2.0, 2.9, 1.2, "휴대폰\n걷기 테스트 버튼", C.accent1, 15);
box(s, C, 4.6, 2.0, 3.0, 1.2, "PTP1 …, walk\n0 또는 1", C.text2, 15);
box(s, C, 8.7, 1.3, 4.0, 1.0, "walk=1 → 거리 계산, PTH1 세기", C.accent3, 14);
box(s, C, 8.7, 2.9, 4.0, 1.0, "walk=0 → PTH1 0, UWB·ESP32도 무시", C.accent6, 14);
arrow(s, C, 3.5, 2.6, 4.6, 2.6, C.text1); arrow(s, C, 7.6, 2.4, 8.7, 1.8, C.accent3); arrow(s, C, 7.6, 2.8, 8.7, 3.4, C.accent6);
table(s, C, [
  ["시험 (실제 UDP, 헤드리스 언리얼)", "결과"],
  ["walk=0", "intensity 0"],
  ["walk=1, 빨간 구에 접근", "0 → 59 → 133 → 204 → 255"],
  ["다시 walk=0", "0"],
], { x: 0.6, y: 4.3, w: 7.4, colW: [4.4, 3.0], size: 14, rowH: 0.5 });
card(s, C, { x: 8.3, y: 4.3, w: 4.4, h: 2.35, head: "규칙", color: C.accent2, body: bullets([
  "휴대폰이 연결돼 있으면 휴대폰이 스위치 (bRequirePhoneWalkStart)",
  "휴대폰 없이 UWB만 쓰면 언리얼에서 바로 동작",
  "예전 앱(walk 없음)은 walk = valid",
], 13), headSize: 16 });
s.addNotes("모든 반응을 걷기 테스트 버튼 하나로 켜고 끈다는 규칙은 PTP1 메시지의 walk 값으로 구현했습니다. walk가 0이면 언리얼은 진동 세기를 0으로 보내고, 그 사이에 UWB나 ESP32에서 위치가 와도 무시합니다. 실제 UDP로 시험해서 0에서 255까지 올라갔다가 다시 0으로 내려가는 것을 확인했습니다.");

// 28 릴레이
s = pres.addSlide(T("4. 연동 방식"));
s.addText("인터넷 릴레이: 방(room)과 역할(role)로 전달", { placeholder: "title" });
codeBox(s, 0.6, 1.5, 12.1, 0.7, "wss://phonetwin-relay-95wfh.ondigitalocean.app/ws?room=arko&role=phone|esp32|unreal|viewer&key=…", 13);
box(s, C, 5.15, 3.35, 3.0, 1.2, "릴레이 서버\n(DigitalOcean)", C.accent4, 15);
box(s, C, 0.6, 2.65, 2.6, 0.85, "phone", C.accent1, 15);
box(s, C, 0.6, 4.4, 2.6, 0.85, "esp32 (UWB 파이)", C.accent2, 14);
box(s, C, 10.1, 2.65, 2.6, 0.85, "unreal", C.text2, 15);
box(s, C, 10.1, 4.4, 2.6, 0.85, "viewer (웹, 읽기만)", C.accent3, 14);
arrow(s, C, 3.2, 3.07, 5.15, 3.7, C.accent1, "", { both: true });
arrow(s, C, 3.2, 4.82, 5.15, 4.2, C.accent2, "", { both: true });
arrow(s, C, 8.15, 3.7, 10.1, 3.07, C.text2, "", { both: true });
arrow(s, C, 8.15, 4.2, 10.1, 4.82, C.accent3);
table(s, C, [
  ["보낸 역할", "받는 역할"],
  ["phone · esp32", "unreal + viewer"],
  ["unreal", "phone + esp32 + viewer"],
  ["viewer", "(보내지 못함)"],
], { x: 0.6, y: 5.55, w: 6.0, colW: [2.5, 3.5], size: 12, rowH: 0.28 });
txt(s, [
  { text: "키는 앱에 빌드 때 넣음. ", options: { bold: true } },
  { text: "키 든 APK는 git·Release에 올리지 않고, 공개 APK는 키 없이 빌드. 키는 공개 자료에 적지 않습니다.", options: {} },
], { x: 6.9, y: 5.6, w: 5.8, h: 1.05, fontSize: 13 });
s.addNotes("릴레이는 아주 단순한 서버입니다. 같은 방 이름으로 접속한 장치끼리 역할에 따라 메시지를 전달합니다. 휴대폰과 UWB 파이가 보낸 위치는 언리얼과 웹으로, 언리얼이 보낸 진동은 휴대폰과 UWB 파이와 웹으로 갑니다. 웹은 읽기만 합니다. 접속에는 키가 필요하고, 키는 공개 자료에는 넣지 않습니다.");

// 29 TouchDesigner
s = pres.addSlide(T("4. 연동 방식"));
s.addText("TouchDesigner: 관객의 움직임을 빛의 흔적으로", { placeholder: "title" });
s.addImage({ path: path.join(__dirname, "td_map.png"), x: 0.6, y: 1.5, w: 7.2, h: 3.2, altText: "TouchDesigner 지도: 위에서 본 사물 원과 관객 주변의 빛" });
txt(s, "TouchDesigner 2025 지도 화면 — 노란 원 = 사물, 빛 = 관객 (시뮬레이션)",{ x: 0.6, y: 4.8, w: 7.2, h: 0.3, fontSize: 11, color: C.accent5 });
card(s, C, { x: 8.1, y: 1.5, w: 4.6, h: 3.6, head: "주고받는 주소", color: C.accent6, body: bullets([
  "언리얼 → TD :7000  /phonetwin/state · pos · dir · nearest · object · touch",
  "TD → :7001  /td/audience · velocity · energy · proximity · touch",
  "신호 1초 없으면 가짜 관객 (전시 땐 Simulate 끄기)",
], 13), headSize: 16 });
card(s, C, { x: 0.6, y: 5.25, w: 12.1, h: 1.4, head: "빛 흔적 (light_trail → trail_out)", color: C.accent1, body: "지나간 자리가 청록↔보라 빛으로 남고 6초마다 반으로 흐려짐, 사물 가까이는 금빛, 닿으면 금빛 물결. 프로젝터용 검은 배경 출력.", bodySize: 13, headSize: 15 });
s.addNotes("TouchDesigner도 연결되어 있습니다. 언리얼이 OSC 7000번으로 관객 위치와 사물 거리를 보내면, TouchDesigner가 위에서 본 지도와 빛의 흔적을 그리고, 속도와 에너지 같은 값을 다시 7001번으로 내보냅니다. 이 값은 조명이나 사운드 프로그램이 받아 쓸 수 있습니다. 관객이 지나간 자리는 빛으로 남았다가 서서히 사라집니다.");

// ========================================================================== 섹션: UWB·모터
section("5. UWB 위치 추적과 모터", "Apeficiation 하드웨어 · 라즈베리파이 게이트웨이 · 진동 전달");

// 31 하드웨어 구조
s = pres.addSlide(T("5. UWB 위치 추적과 모터"));
s.addText("UWB: 앵커 4개가 태그까지의 거리를 잽니다", { placeholder: "title" });
s.addShape("rect", { x: 0.6, y: 1.5, w: 5.4, h: 5.1, fill: { color: C.background2 }, line: { color: "C9D6E0" }, objectName: "room" });
[[0.8, 1.7], [5.4, 1.7], [0.8, 6.0], [5.4, 6.0]].forEach((p, i) => {
  s.addShape("rect", { x: p[0], y: p[1], w: 0.4, h: 0.4, fill: { color: C.accent4 }, line: { color: C.accent4 }, objectName: "anchor" });
  txt(s, "A" + (i + 1), { x: p[0], y: p[1], w: 0.4, h: 0.4, fontSize: 11, bold: true, color: C.background1, align: "center", valign: "middle" });
  arrow(s, C, p[0] + 0.2, p[1] + 0.2, 3.3, 4.0, C.accent4, "", { dash: true });
});
s.addShape("ellipse", { x: 3.05, y: 3.75, w: 0.5, h: 0.5, fill: { color: C.accent2 }, line: { color: C.background1, width: 2 }, objectName: "tag" });
txt(s, "태그 + 모터", { x: 3.65, y: 3.85, w: 1.3, h: 0.3, fontSize: 12, bold: true, color: C.accent2 });
card(s, C, { x: 6.3, y: 1.5, w: 6.4, h: 2.45, head: "장비", color: C.accent4, body: bullets([
  "XIAO nRF52840 + DWM1000 (앵커 4 · 태그 1)",
  "태그에 PCA9685 + 진동 모터, 관객이 착용",
  "앵커는 USB로 라즈베리파이에 연결 → 거리 전달",
], 14), headSize: 16 });
card(s, C, { x: 6.3, y: 4.15, w: 6.4, h: 2.45, head: "파이의 위치 계산", color: C.accent2, body: bullets([
  "원본 pi_gateway.py: 앵커 4개 모두 와야 계산 (크라메르 공식)",
  "우리 게이트웨이: 3개 이상이면 최소제곱, 평평하면 z 고정",
  "OSC /tag/position(cm)으로 언리얼 8000번에 전송",
], 14), headSize: 16 });
s.addNotes("두 번째 위치 추적 방식은 UWB입니다. 방 네 모서리에 앵커를 두고, 관객이 착용한 태그까지의 거리를 재서 위치를 계산합니다. 협업팀인 Apeficiation이 만든 하드웨어와 라즈베리파이 게이트웨이가 있고, 우리는 앵커가 3개만 잡혀도 계산하는 게이트웨이도 따로 만들었습니다. 계산한 위치는 OSC로 언리얼에 보냅니다.");

// 32 언리얼 OSC 수신 + A·B
s = pres.addSlide(T("5. UWB 위치 추적과 모터"));
s.addText("원본 게이트웨이를 그대로 받고, 키 7·8로 스캔에 맞춥니다", { placeholder: "title" });
const steps = [
  ["1", "언리얼 Play, 입력 [2]", "HUD: “UWB 원 좌표 · Apeficiation 게이트웨이 형식”"],
  ["2", "태그를 바닥 A 위에 → 7", "그 자리의 원 좌표를 A로 기억"],
  ["3", "태그를 B 위에 → 8", "A→B 실측 거리 표시, uwb_frame.json에 저장"],
  ["4", "걸어 보기", "좌우가 반대면 Details > bUwbMirror"],
];
steps.forEach((st, i) => {
  const y = 1.5 + i * 1.05;
  s.addShape("ellipse", { x: 0.6, y: y + 0.1, w: 0.6, h: 0.6, fill: { color: C.accent2 }, line: { color: C.accent2 }, objectName: "num" });
  txt(s, st[0], { x: 0.6, y: y + 0.1, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: C.background1, align: "center", valign: "middle" });
  txt(s, st[1], { x: 1.4, y: y + 0.05, w: 5.2, h: 0.4, fontSize: 16, bold: true, color: C.text2 });
  txt(s, st[2], { x: 1.4, y: y + 0.45, w: 5.2, h: 0.4, fontSize: 13 });
});
card(s, C, { x: 6.9, y: 1.5, w: 5.8, h: 4.0, head: "언리얼이 받는 OSC (UDP 8000)", color: C.accent4, body: bullets([
  "/tag/position x y z — 필수, cm",
  "/tag/heading yaw — 선택. 없으면 걷는 방향으로 계산",
  "/tag/quality 잔차 앵커수 valid — 선택. valid=0이면 추적 멈춤",
  "OSC를 보낸 주소를 기억해 그쪽 4210번으로 진동을 돌려줌 (IP 설정 불필요)",
], 14), headSize: 16 });
txt(s, "PC 방화벽에서 UDP 8000 허용 필요", { x: 6.9, y: 5.7, w: 5.8, h: 0.4, fontSize: 13, bold: true, color: C.accent6 });
s.addNotes("Apeficiation의 원본 게이트웨이는 좌표 원점이 앵커 모서리라서 스캔과 맞지 않습니다. 그래서 언리얼에서 태그를 바닥 A 위에 놓고 7, B 위에 놓고 8을 누르면 두 좌표계를 맞추도록 만들었습니다. 한 번 맞추면 파일로 저장됩니다. 원본 게이트웨이는 방향 정보를 보내지 않아서, 언리얼이 걷는 방향으로 방향을 계산합니다.");

// 33 모터 진동 경로
s = pres.addSlide(T("5. UWB 위치 추적과 모터"));
s.addText("진동 경로: 언리얼에서 손목의 모터까지", { placeholder: "title" });
const path5 = [
  ["언리얼", "PTH1 30Hz\nUDP 4210", C.text2],
  ["라즈베리파이", "USB 시리얼\nH,세기,닿음", C.accent2],
  ["앵커", "UWB 응답 20바이트\n[18] 세기 · [19] 닿음", C.accent4],
  ["태그", "PCA9685 듀티\nDUTY_MIN_RUN ~ 4095", C.accent1],
  ["모터", "닿으면\n맥박처럼 깜빡임", C.accent6],
];
path5.forEach((p, i) => {
  const x = 0.6 + i * 2.5;
  s.addShape("roundRect", { x, y: 1.6, w: 2.15, h: 2.0, rectRadius: 0.12, fill: { color: p[2] }, line: { color: p[2] }, objectName: "hop" });
  txt(s, p[0], { x: x + 0.15, y: 1.75, w: 1.85, h: 0.45, fontSize: 17, bold: true, color: C.background1, align: "center" });
  txt(s, p[1], { x: x + 0.1, y: 2.3, w: 1.95, h: 1.1, fontSize: 12, color: C.background1, align: "center" });
  if (i < 4) arrow(s, C, x + 2.17, 2.6, x + 2.48, 2.6, C.text1);
});
codeBox(s, 0.6, 3.95, 12.1, 0.65, "PTH1,seq,valid,intensity,contact,objectId,distanceMm     예) PTH1,1532,1,180,0,104,92", 14);
card(s, C, { x: 0.6, y: 4.9, w: 5.9, h: 1.75, head: "안전장치", color: C.accent6, body: bullets([
  "0.5초 넘게 새 값이 없으면 모터 0",
  "valid=0 (걷기 전·추적 끊김) → 0",
], 14), headSize: 16 });
card(s, C, { x: 6.8, y: 4.9, w: 5.9, h: 1.75, head: "주의", color: C.accent2, body: bullets([
  "데이터가 18 → 20바이트: 앵커 4개와 태그를 같은 버전으로",
  "원본 태그는 고정 리듬 → 거리별 진동엔 우리 스케치 필요",
], 13), headSize: 16 });
s.addNotes("진동이 관객의 손목까지 가는 길입니다. 언리얼이 PTH1을 라즈베리파이로 보내면, 파이는 USB로 앵커에 세기와 닿음 값을 씁니다. 앵커는 원래 거리를 재기 위해 태그와 주고받는 UWB 응답에 이 두 바이트를 실어 보내고, 태그는 그 값으로 모터를 돌립니다. 별도 무선 장치 없이 UWB 통신에 얹은 것이 특징입니다. 0.5초 동안 값이 없으면 모터를 끄는 안전장치가 있습니다.");

// 34 OSC vs 웹 (모터 연동)
s = pres.addSlide(T("5. UWB 위치 추적과 모터"));
s.addText("모터 팀 연동: 두 가지 방법", { placeholder: "title" });
card(s, C, { x: 0.6, y: 1.5, w: 5.9, h: 3.35, head: "A. 같은 공유기 OSC/UDP", color: C.accent1, body: bullets([
  "파이 → PC:8000  OSC /tag/position (cm)",
  "PC → 파이:4210  PTH1 줄",
  "지연 2~10ms, 좌표는 키 7·8로 맞춤",
  "PC 방화벽 UDP 8000 허용",
  "→ 전시 본 운영",
], 14), headSize: 17 });
card(s, C, { x: 6.8, y: 1.5, w: 5.9, h: 3.35, head: "B. 웹 릴레이 (role=esp32)", color: C.accent4, body: bullets([
  "파이 → 릴레이  PTE1 (m, 방 좌표 R)",
  "릴레이 → 파이  PTH1 (같은 줄)",
  "약 0.3초, 공유기가 달라도 됨",
  "코드 없이: node relay/bridge.js 로 UDP ↔ 릴레이",
  "→ 떨어져서 개발·원격 시험",
], 14), headSize: 17 });
s.addShape("roundRect", { x: 0.6, y: 5.1, w: 12.1, h: 1.55, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "note" });
txt(s, [
  { text: "현재 한계  ", options: { bold: true, color: C.accent6 } },
  { text: "키 7·8의 A·B 맞춤은 OSC 입력에만 적용됩니다. 웹 경로는 좌표를 맞춰서 보내거나(우리 게이트웨이 --mark A/B, Details의 ESP32 Frame) 플러그인 수정이 필요합니다. 협업 작가용 안내서: docs/PhoneTwin_UWB모터_언리얼_데이터형식.pdf", options: {} },
], { x: 0.9, y: 5.2, w: 11.5, h: 1.35, fontSize: 14, valign: "middle" });
s.addNotes("모터를 만드는 협업 작가님께는 두 가지 연동 방법을 안내했습니다. 같은 공유기에서 OSC와 UDP로 직접 주고받는 방법이 가장 빠르고 전시에 적합합니다. 떨어져서 작업할 때는 웹 릴레이에 esp32 역할로 접속해서 같은 진동 메시지를 받을 수 있습니다. 다만 웹 경로에서는 아직 키 7, 8의 좌표 맞춤이 적용되지 않는다는 한계가 있습니다.");

// 35 시뮬레이터
s = pres.addSlide(T("5. UWB 위치 추적과 모터"));
s.addText("장비 없이 시험: 원본 코드 + 가짜 앵커 시뮬레이터", { placeholder: "title" });
s.addChart(pres.charts.BAR, [{ name: "평균 오차 (cm)", labels: ["ideal\n잡음 없음", "noisy\n거리 잡음", "uncal\n보정 안 됨"], values: [3, 5, 10] }], {
  x: 0.6, y: 1.45, w: 6.2, h: 4.4, barDir: "col", showTitle: true, title: "위치 평균 오차 (cm)", titleFontSize: 14, titleColor: HEX.dk1, titleFontFace: "+mn-lt",
  chartColors: [HEX.accent4], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: HEX.dk1, dataLabelFontSize: 13, dataLabelFontFace: "+mn-lt", showLegend: false,
  catAxisLabelColor: HEX.accent5, valAxisLabelColor: HEX.accent5, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
  valAxisMaxVal: 12, valAxisMinVal: 0, valAxisMajorUnit: 3, valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, barGapWidthPct: 70,
});
codeBox(s, 0.6, 6.0, 6.2, 0.65, "py tools/apeficiation_sim.py --walk ab", 14);
card(s, C, { x: 7.1, y: 1.45, w: 5.6, h: 2.6, head: "어떻게", color: C.accent4, body: bullets([
  "Apeficiation의 pi_gateway.py를 GitHub에서 받아 그대로 실행",
  "가짜 앵커 4개가 거리 줄을 시리얼처럼 흘려 줌",
  "실제 언리얼(-game)에서 A 위 → (0,0)±3cm, B 위 → (1,0)",
], 13), headSize: 16 });
card(s, C, { x: 7.1, y: 4.25, w: 5.6, h: 2.4, head: "드러난 원본의 특성", color: C.accent6, body: bullets([
  "앵커 하나가 빠지면 출력 12/s로 감소",
  "튀는 거리값에 최대 70cm 튐",
  "앵커가 모두 같은 높이면 출력 0 → 높이를 다르게",
], 13), headSize: 16 });
s.addNotes("하드웨어가 아직 완성되지 않아서, 장비 없이 시험할 수 있는 시뮬레이터를 만들었습니다. Apeficiation의 원본 게이트웨이 코드를 그대로 실행하고, 가짜 앵커가 거리 값을 흘려 줍니다. 잡음이 없으면 평균 3센티미터, 잡음이 있으면 5센티미터, 보정이 안 되면 10센티미터 오차였습니다. 그리고 앵커가 모두 같은 높이면 계산이 안 된다는 것처럼, 원본 코드의 특성도 미리 찾을 수 있었습니다.");

// ========================================================================== 섹션: 검증
section("6. 검증과 다음 단계", "무엇을 확인했고, 무엇이 남았나");

// 37 검증 결과
s = pres.addSlide(T("6. 검증과 다음 단계"));
s.addText("자동 시험으로 확인한 것", { placeholder: "title" });
stat(s, C, 0.6, 1.5, 2.9, "36", "Android 단위 테스트 통과 (0.4.5)", C.accent1, 60);
stat(s, C, 3.6, 1.5, 2.9, "8", "언리얼 자동화 테스트 통과 (실제 GPU 셰이더 포함)", C.text2, 60);
stat(s, C, 6.6, 1.5, 2.9, "16", "iPhone 단위 테스트 (Actions 시뮬레이터)", C.accent2, 60);
stat(s, C, 9.6, 1.5, 3.1, "114ms", "실제 릴레이 왕복 (앱 기본 설정)", C.accent4, 60);
table(s, C, [
  ["시험", "결과"],
  ["헤드리스 언리얼 + 실제 UDP", "휴대폰·ESP32 두 좌표계가 같은 결과, walk 게이트 0 ↔ 255"],
  ["웹 몰입 보기 (헤드리스 Chrome 모바일)", "16개 자동 시험 통과, JS 오류 0"],
  ["콜리전 편집기 (실제 마우스 조작)", "추가·이동·회전·되돌리기, 모양 유지"],
  ["UWB 게이트웨이 · 시뮬레이터", "파이 테스트 10개, 언리얼 OSC 추적, PTH1 왕복"],
  ["TouchDesigner", "OSC 7000 → /td/* 9개 주소 7001 수신"],
], { x: 0.6, y: 3.6, w: 12.1, colW: [4.6, 7.5], size: 13, rowH: 0.5 });
s.addNotes("검증은 가능한 한 자동 시험으로 했습니다. 안드로이드 36개, 언리얼 8개, 아이폰 16개 테스트가 통과했고, 실제 DigitalOcean 릴레이로 왕복 114밀리초를 측정했습니다. 헤드리스 언리얼에 실제 UDP 패킷을 보내서 좌표 변환과 시작 게이트를 확인했고, 웹과 편집기도 브라우저 자동 조작으로 시험했습니다.");

// 38 아직 못 한 것
s = pres.addSlide(T("6. 검증과 다음 단계"));
s.addText("아직 확인하지 못한 것", { placeholder: "title" });
const todo = [
  ["실기기", "휴대폰 실기기에서 자동 연결 · A·B 화면 · 걷기 테스트 진동 · 소리 크기\niPhone은 실기기 시험 전체", C.accent1],
  ["하드웨어", "실제 DWM1000 · 모터 · 아두이노 스케치 컴파일 (이 PC에 Arduino 없음)\n실제 앵커 위치·높이에서의 정확도", C.accent2],
  ["귀와 눈", "언리얼 스피커 출력, 에디터 Play에서 금빛 파동의 움직임\n빛 밝기·점 크기 취향 조정", C.accent4],
  ["네트워크", "DigitalOcean 리전 확인 (왕복 124ms는 싱가포르치고 김)\n웹 릴레이 경로에서 UWB A·B 맞춤", C.accent6],
];
todo.forEach((t, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  card(s, C, { x: 0.6 + col * 6.2, y: 1.5 + row * 2.6, w: 5.9, h: 2.35, head: t[0], body: t[1], color: t[2], headSize: 18, bodySize: 14 });
});
s.addNotes("솔직하게 말씀드리면 아직 확인하지 못한 부분도 많습니다. 실제 휴대폰에서의 진동과 소리 느낌, 실제 UWB 하드웨어와 모터, 언리얼 스피커로 듣는 소리, 그리고 네트워크 리전 같은 것들입니다. 자동 시험은 코드가 맞게 동작하는지를 보여 주지만, 사람이 느끼는 경험은 현장에서 직접 확인해야 합니다.");

// 39 다음 단계
s = pres.addSlide(T("6. 검증과 다음 단계"));
s.addText("다음 단계", { placeholder: "title" });
const next = [
  ["UWB 하드웨어 연결", "실제 앵커 위치를 ANCHOR_POS에 → 파이 --osc-host PC → 키 7·8 → 걸어 보기", C.accent2],
  ["휴대폰 실기기 시험", "키 포함 APK 설치 → 자동 연결 확인 → A·B → 걷기 테스트 → 언리얼 반응", C.accent1],
  ["감각 다듬기", "소리 파일 교체, 반응 거리·진동 곡선, 빛 밝기·점 크기 값 고정", C.accent3],
  ["iPhone 따라잡기", "자동 A·B · 자동 연결 · 콜리전 소리를 iOS에 이식", C.accent5],
  ["전시 준비", "TD Simulate 끄기, 방화벽, 같은 공유기, 여러 관객(ID 필드) 검토", C.accent6],
];
next.forEach((n, i) => {
  const y = 1.5 + i * 1.03;
  s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: 0.88, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: "next" });
  s.addShape("ellipse", { x: 0.8, y: y + 0.17, w: 0.54, h: 0.54, fill: { color: n[2] }, line: { color: n[2] }, objectName: "num" });
  txt(s, String(i + 1), { x: 0.8, y: y + 0.17, w: 0.54, h: 0.54, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle" });
  txt(s, n[0], { x: 1.6, y: y + 0.1, w: 3.2, h: 0.68, fontSize: 17, bold: true, color: C.text2, valign: "middle" });
  txt(s, n[1], { x: 4.9, y: y + 0.1, w: 7.6, h: 0.68, fontSize: 14, valign: "middle" });
});
s.addNotes("다음 단계는 다섯 가지입니다. 가장 중요한 것은 UWB 하드웨어를 실제로 연결하는 것이고, 휴대폰 실기기 시험, 소리와 진동과 빛의 감각을 다듬는 일, 아이폰 앱 보완, 그리고 전시 준비입니다.");

// 40 마무리
pres.addSection({ title: "마무리" });
s = pres.addSlide({ masterName: "Title", sectionTitle: "마무리" });
s.addText("감사합니다", { placeholder: "title" });
s.addText("질문 받겠습니다\ngithub.com/jy3266/PhoneTwin · jy3266.github.io/PhoneTwin", { placeholder: "body" });
s.addNotes("들어 주셔서 감사합니다. 코드와 웹 뷰어는 화면의 주소에서 누구나 볼 수 있습니다. 질문 받겠습니다.");

pres.writeFile({ fileName: OUT }).then(async () => { await applyTheme(OUT, THEME); console.log("wrote", OUT); });
