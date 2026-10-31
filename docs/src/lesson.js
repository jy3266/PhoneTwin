// 수업 슬라이드 (발표자 노트 = 강의 스크립트)
const { THEME, HEX, newDeck, card, bullets, stat, box, arrow, table } = require("./common");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");
const L = require("./lesson_data");

const OUT = process.argv[2];
const { pres, C } = newDeck("Phone Twin 수업 — " + L.title);
const T = (sec) => ({ masterName: "Content", sectionTitle: sec });
const SC = [C.accent1, C.accent5, C.accent2, C.accent4];

// ---------------------------------------------------------------- opening
pres.addSection({ title: "수업 안내" });
let s = pres.addSlide({ masterName: "Title", sectionTitle: "수업 안내" });
s.addText(L.title, { placeholder: "title" });
s.addText(L.subtitle + "\n4차시 × 120분 워크숍", { placeholder: "body" });
s.addNotes("수업 시작 전: 모든 PC에서 언리얼 Play가 되는지, 휴대폰에 앱이 설치되어 있는지 확인합니다. 첫 인사 후 바로 완성 시연으로 들어갑니다.");

s = pres.addSlide(T("수업 안내"));
s.addText("수업 흐름: 4차시, 공간에서 몸까지", { placeholder: "title" });
L.sessions.forEach((x, i) => {
  card(s, C, { x: 0.6 + i * 3.08, y: 1.5, w: 2.9, h: 3.6, num: x.no, head: x.no + "차시", color: SC[i], body: x.title.split(":")[0] + "\n\n" + x.title.split(":")[1].trim(), bodySize: 14 });
  if (i < 3) arrow(s, C, 0.6 + i * 3.08 + 2.9, 3.3, 0.6 + (i + 1) * 3.08, 3.3, C.accent5);
});
s.addText([{ text: "대상  ", options: { bold: true } }, { text: L.overview.target, options: { breakLine: true } },
  { text: "결과물  ", options: { bold: true } }, { text: L.overview.outcome }],
  { x: 0.6, y: 5.4, w: 12.1, h: 1.2, fontSize: 14, color: C.text1, margin: 0, paraSpaceAfter: 6, isTextBox: true });
s.addNotes("이 수업은 네 번에 걸쳐 '공간 → 공유 → 반응 → 몸'의 순서로 진행합니다. 1차시에 스캔한 공간을 2차시에 공유하고, 3차시에 그 공간이 반응하게 만들고, 4차시에 손목 센서로 몸과 연결합니다. 마지막 시간에는 팀별로 통합 시연을 합니다.");

s = pres.addSlide(T("수업 안내"));
s.addText("학습 목표", { placeholder: "title" });
L.goals.forEach((g, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  card(s, C, { x: 0.6 + col * 6.1, y: 1.5 + row * 2.55, w: 5.9, h: 2.35, num: i + 1, head: g[0], body: g[1], color: SC[i], bodySize: 14 });
});
s.addNotes("학습 목표는 네 가지입니다. 각 목표는 한 차시와 짝을 이룹니다. 마지막 평가도 이 네 가지와 협업·발표를 기준으로 합니다.");

s = pres.addSlide(T("수업 안내"));
s.addText("준비물", { placeholder: "title" });
table(s, C, [["누가", "무엇", "언제"], ...L.materials], { x: 0.6, y: 1.5, w: 12.1, colW: [1.3, 7.7, 3.1], size: 13, rowH: 0.55 });
s.addNotes("준비물은 팀별, 반 공용, 강사 준비로 나뉩니다. UWB·IMU 모듈이 없어도 4차시는 DEMO 모드로 진행할 수 있습니다.");

s = pres.addSlide(T("수업 안내"));
s.addText("강사 사전 준비 체크리스트", { placeholder: "title" });
L.prep.forEach((p, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  card(s, C, { x: 0.6 + col * 6.1, y: 1.5 + row * 1.65, w: 5.9, h: 1.5, num: i + 1, head: ["언리얼 첫 빌드", "앱 설치", "교실 Wi-Fi", "방화벽", "GitHub 토큰", "시험 실행"][i], body: p, color: C.text2, bodySize: 12, headSize: 15 });
});
s.addNotes("수업 전날까지 이 여섯 가지를 끝내 두면 수업 중 기술 문제의 대부분을 막을 수 있습니다. 특히 게스트 Wi-Fi는 기기끼리 통신을 막는 경우가 많으니 꼭 확인하세요.");

// ---------------------------------------------------------------- sessions
const concept = {
  1: (s) => {
    const st = [["깊이 추정", "픽셀마다 몇 m인지"], ["3D 점", "깊이 → 좌표"], ["1.5cm 칸", "같은 칸끼리 모음"], ["가중 평균", "가깝고 확실할수록 크게"], ["2회 이상만", "한 번 찍힌 점은 잡음"]];
    st.forEach((x, i) => {
      box(s, C, 0.6 + i * 2.5, 1.7, 2.1, 1.0, x[0], SC[0], 15);
      s.addText(x[1], { x: 0.6 + i * 2.5, y: 2.85, w: 2.1, h: 0.6, fontSize: 13, color: C.text1, align: "center", margin: 0, isTextBox: true });
      if (i < 4) arrow(s, C, 0.6 + i * 2.5 + 2.1, 2.2, 0.6 + (i + 1) * 2.5, 2.2, C.accent5);
    });
    card(s, C, { x: 0.6, y: 3.9, w: 5.9, h: 2.5, head: "질문 던지기", color: C.accent2, body: "\"어떻게 움직여야 정밀해질까?\"\n→ 천천히. 같은 칸을 여러 번 재야 평균이 정확해지고, 빠른 프레임은 버려진다.", bodySize: 14 });
    card(s, C, { x: 6.8, y: 3.9, w: 5.9, h: 2.5, head: "구멍이 생기는 곳", color: C.accent6, body: bullets(["유리, 거울", "검은 면, 아주 밝은 창", "5m보다 먼 곳"], 14) });
  },
  2: (s) => {
    card(s, C, { x: 0.6, y: 1.5, w: 5.9, h: 3.6, head: "GitHub = 창고", color: C.accent5, body: bullets(["파일의 모든 버전을 기억", "웹사이트로 바로 보여 줌 (GitHub Pages)", "언리얼이 90초마다 가져감", "반영까지 수 초~수 분"], 15) });
    card(s, C, { x: 6.8, y: 1.5, w: 5.9, h: 3.6, head: "실시간 신호 = 전화선", color: C.accent1, body: bullets(["손 위치, 진동 세기처럼 매 순간 바뀌는 값", "같은 Wi-Fi UDP로 1초에 30번", "GitHub로는 보내지 않음"], 15) });
    s.addText("크기 비교: 다른 팀 스캔을 불러와 우리 바닥 A·B에 정렬 → \"스캔 A–B / 현장 A–B · 차이 %\" 읽기 (스케일 보정은 끄기)", { x: 0.6, y: 5.4, w: 12.1, h: 0.9, fontSize: 15, bold: true, color: C.accent2, margin: 0, isTextBox: true });
  },
  3: (s) => {
    const xs = [], ys = [];
    for (let d = 0; d <= 40; d += 2) { xs.push(String(d)); ys.push(d >= 30 ? 0 : Math.round(Math.min(1, (30 - d) / 27) * 100)); }
    s.addChart(pres.charts.LINE, [{ name: "진동 세기(%)", labels: xs, values: ys }], {
      x: 0.6, y: 1.4, w: 7.0, h: 4.6, chartColors: [HEX.accent2], lineSize: 3, lineDataSymbol: "none",
      showTitle: true, title: "거리(cm)에 따른 진동 세기(%)", titleFontSize: 13, titleColor: HEX.dk1, titleFontFace: "+mn-lt",
      catAxisLabelColor: HEX.accent5, catAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", valAxisLabelColor: HEX.accent5, valAxisLabelFontSize: 11, valAxisLabelFontFace: "+mn-lt",
      valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false, valAxisMaxVal: 100,
      catAxisTitle: "거리 (cm)", showCatAxisTitle: true, catAxisTitleFontSize: 11, catAxisTitleColor: HEX.accent5,
    });
    s.addText([{ text: "세기 = (30 − 거리) ÷ (30 − 3)", options: { bold: true, fontSize: 18, color: C.accent2, breakLine: true } },
      { text: "30cm보다 멀면 0, 3cm 이하는 최대(접촉)", options: { breakLine: true } },
      { text: "두 숫자가 오늘 바꿔 볼 손잡이", options: { bold: true, breakLine: true } },
      { text: "Reaction → React Range, Contact Distance" }],
      { x: 8.0, y: 1.6, w: 4.7, h: 2.6, fontSize: 14, color: C.text1, margin: 0, paraSpaceAfter: 8, valign: "top", isTextBox: true });
    card(s, C, { x: 8.0, y: 4.4, w: 4.7, h: 1.9, head: "좌표 약속", color: C.text2, body: "바닥 A = 원점, A→B = 앞(+X), 위 = +Z. 휴대폰·언리얼·ESP32가 공유", bodySize: 13 });
  },
  4: (s) => {
    s.addChart(pres.charts.BAR, [{ name: "ms", labels: ["같은 Wi-Fi UDP", "블루투스 BLE", "인터넷 릴레이 (실측)"], values: [6, 33, 290] }], {
      x: 0.6, y: 1.4, w: 7.0, h: 4.6, barDir: "bar", chartColors: [HEX.accent1, HEX.accent5, HEX.accent4],
      showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 12, dataLabelColor: HEX.dk1, dataLabelFontFace: "+mn-lt",
      showTitle: true, title: "대략적인 지연 (ms, UDP·BLE는 일반적인 범위의 중간값)", titleFontSize: 12, titleColor: HEX.dk1, titleFontFace: "+mn-lt",
      catAxisLabelColor: HEX.dk1, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt", valAxisLabelColor: HEX.accent5, valAxisLabelFontSize: 11, valAxisLabelFontFace: "+mn-lt",
      valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false, valAxisMaxVal: 350,
    });
    card(s, C, { x: 8.0, y: 1.4, w: 4.7, h: 2.3, head: "ESP32가 보내는 것", color: C.accent2, body: "PTE1: UWB 위치(m) + IMU 방향(°)\n초당 30번", bodySize: 14 });
    card(s, C, { x: 8.0, y: 3.95, w: 4.7, h: 2.3, head: "ESP32가 받는 것", color: C.accent2, body: "PTH1: 진동 세기 0~255, 접촉, 거리(mm)\n0.3초 끊기면 모터 정지", bodySize: 14 });
  },
};

L.sessions.forEach((x, i) => {
  const sec = x.no + "차시";
  pres.addSection({ title: sec });
  // plan
  s = pres.addSlide(T(sec));
  s.addText(x.no + "차시 · " + x.title, { placeholder: "title", fontSize: 26 });
  s.addText([{ text: "목표  ", options: { bold: true, color: SC[i] } }, { text: x.goal }], { x: 0.6, y: 1.3, w: 12.1, h: 0.7, fontSize: 15, color: C.text1, margin: 0, isTextBox: true });
  table(s, C, [["시간(분)", "단계", "활동", "자료"], ...x.timeline], { x: 0.6, y: 2.15, w: 12.1, colW: [1.3, 1.1, 7.2, 2.5], size: 13, rowH: 0.62 });
  s.addNotes(["[도입 스크립트]", x.script[0]].join("\n"));
  // concept
  s = pres.addSlide(T(sec));
  s.addText(x.no + "차시 핵심 개념", { placeholder: "title" });
  concept[x.no](s);
  s.addNotes(["[개념 스크립트]", ...x.script.slice(1, 3)].join("\n\n"));
  // practice
  s = pres.addSlide(T(sec));
  s.addText(x.no + "차시 실습과 확인", { placeholder: "title" });
  const steps = x.timeline.filter((t) => t[1].startsWith("실습") || t[1] === "준비");
  steps.forEach((t, k) => card(s, C, { x: 0.6, y: 1.4 + k * 1.75, w: 7.2, h: 1.6, num: k + 1, head: t[1] + " (" + t[0] + "분)", body: t[2], color: SC[i], bodySize: 13 }));
  card(s, C, { x: 8.1, y: 1.4, w: 4.6, h: 4.9, head: "끝나기 전 확인", color: C.accent3, body: bullets(x.check, 14) });
  s.addNotes(["[실습·정리 스크립트]", ...x.script.slice(3)].join("\n\n"));
});

// ---------------------------------------------------------------- closing
pres.addSection({ title: "평가와 안전" });
s = pres.addSlide(T("평가와 안전"));
s.addText("평가 기준", { placeholder: "title" });
table(s, C, [["항목", "우수", "보통", "미흡"], ...L.rubric], { x: 0.6, y: 1.5, w: 12.1, colW: [1.9, 4.6, 3.2, 2.4], size: 13, rowH: 0.7 });
s.addNotes("평가는 다섯 항목을 3단계로 봅니다. 결과물이 완벽하게 동작하지 않아도, 왜 안 됐는지 측정하고 설명하면 높은 점수를 받을 수 있다고 미리 알려 주세요.");

s = pres.addSlide(T("평가와 안전"));
s.addText("안전과 윤리", { placeholder: "title" });
L.safety.forEach((t, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  card(s, C, { x: 0.6 + col * 6.1, y: 1.5 + row * 1.65, w: 5.9, h: 1.5, num: i + 1, head: ["공개 저장소", "비밀 정보", "촬영 동의", "걷기 안전", "용도 제한", "전기 안전"][i], body: t, color: C.accent6, bodySize: 12, headSize: 15 });
});
s.addNotes("첫 차시와 마지막 차시에 한 번씩 꼭 짚어 주세요. 특히 공개 저장소에 올린 스캔은 누구나 볼 수 있고, 이 시스템은 안전 보조 장치가 아니라는 점이 중요합니다.");

s = pres.addSlide(T("평가와 안전"));
s.addText("하루 워크숍(3시간)으로 줄이기", { placeholder: "title" });
table(s, C, [["시간(분)", "내용"], ...L.oneDay], { x: 0.6, y: 1.5, w: 7.4, colW: [1.6, 5.8], size: 14, rowH: 0.62 });
card(s, C, { x: 8.3, y: 1.5, w: 4.4, h: 4.3, head: "줄일 때 팁", color: C.text2, body: bullets(["스캔은 강사가 미리 1개 올려 두고 비교용으로 사용", "언리얼은 강사 PC 1대로 시연, 팀은 휴대폰만", "ESP32는 DEMO 모드만", "UWB 실제 연결은 생략"], 14) });

s = pres.addSlide({ masterName: "Title", sectionTitle: "평가와 안전" });
s.addText("공간이 우리를 느끼게", { placeholder: "title" });
s.addText("다음 단계: 실제 전시 공간에서 스캔 → 관객 동선 따라 소리 설계 → 여러 명 동시 체험", { placeholder: "body" });

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
