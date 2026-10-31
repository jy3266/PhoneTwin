// 수업 지도안 + 강의 스크립트 (A4 HTML -> Chrome PDF)
const fs = require("fs");
const L = require("./lesson_data");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const table = (head, rows, cls) => `<table class="${cls || ""}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="k"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const ul = (a) => `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
const COLORS = ["#0891B2", "#64748B", "#F97316", "#7C3AED"];
const STAGES = { 1: ["도입", "개념", "개념", "질문", "실습", "정리"], 2: ["도입", "개념", "개념", "실습", "실습", "정리"], 3: ["도입", "개념", "개념", "실습", "실습", "정리"], 4: ["도입", "개념", "실습", "실습", "실습", "발표·회고"] };

let html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Phone Twin 수업 지도안과 스크립트</title><style>
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Malgun Gothic", sans-serif; color: #0F1A2B; font-size: 10.5pt; line-height: 1.65; margin: 0; }
h1 { font-size: 24pt; margin: 0 0 4mm; line-height: 1.25; }
h2 { font-size: 16pt; margin: 9mm 0 3mm; padding-top: 1mm; }
h3 { font-size: 12.5pt; margin: 6mm 0 2mm; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; padding: 0 6mm; background: #0F1A2B; color: #fff; margin: -18mm -16mm 0; padding: 0 22mm; page-break-after: always; }
.cover h1 { color: #fff; font-size: 30pt; }
.cover p { color: #9FD8E6; font-size: 13pt; margin: 2mm 0; }
.cover .meta { margin-top: 14mm; color: #CBD5E1; font-size: 10.5pt; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9.5pt; page-break-inside: avoid; }
th { background: #16304D; color: #fff; text-align: left; padding: 2mm 2.5mm; font-weight: bold; }
td { padding: 2mm 2.5mm; border-bottom: 0.3mm solid #D5DEE6; vertical-align: top; }
tbody tr:nth-child(odd) td { background: #EEF4F8; }
td.k { font-weight: bold; white-space: nowrap; }
.session { page-break-before: always; }
.badge { display: inline-block; color: #fff; border-radius: 3mm; padding: 0.5mm 3mm; font-size: 10pt; margin-right: 2mm; }
.goal { background: #EEF4F8; border-radius: 2mm; padding: 3mm 4mm; margin: 2mm 0 4mm; }
.script p { margin: 0 0 3mm; text-indent: 0; break-inside: avoid; }
.script .tag { font-weight: bold; color: #0891B2; font-size: 9pt; display: block; margin-bottom: 0.5mm; }
.check { border: 0.4mm solid #10B981; border-radius: 2mm; padding: 2mm 4mm; margin-top: 4mm; page-break-inside: avoid; }
.check b { color: #10B981; }
ul { margin: 1mm 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1mm; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 5mm; }
.box { background: #EEF4F8; border-radius: 2mm; padding: 3mm 4mm; page-break-inside: avoid; }
.box b { color: #0891B2; }
.note { color: #64748B; font-size: 9.5pt; }
</style></head><body>`;

html += `<section class="cover"><p>Phone Twin 수업 자료</p><h1>${esc(L.title)}</h1><p>${esc(L.subtitle)}</p>
<p class="meta">수업 지도안 · 강의 스크립트 · 평가 기준 · 안전 수칙<br>4차시 × 120분 · 2026년 10월</p></section>`;

html += `<h2>1. 수업 개요</h2>${table(["항목", "내용"], [["수업명", L.title], ["대상", L.overview.target], ["형식", L.overview.format], ["선수 지식", L.overview.prereq], ["결과물", L.overview.outcome]])}`;
html += `<h3>학습 목표</h3><div class="grid">${L.goals.map((g, i) => `<div class="box"><b>${i + 1}. ${esc(g[0])}</b><br>${esc(g[1])}</div>`).join("")}</div>`;
html += `<h3>차시 구성</h3>${table(["차시", "주제", "핵심 결과"], L.sessions.map((x) => [x.no + "차시", x.title, x.goal]))}`;
html += `<section class="session"><h2>2. 준비물과 사전 준비</h2>${table(["누가", "무엇", "언제"], L.materials)}<h3>강사 사전 준비 (수업 전날까지)</h3>${ul(L.prep)}</section>`;

L.sessions.forEach((x, i) => {
  html += `<section class="session"><h2><span class="badge" style="background:${COLORS[i]}">${x.no}차시</span>${esc(x.title)}</h2>
  <div class="goal"><b>차시 목표</b> · ${esc(x.goal)}</div>
  <h3>지도안 (120분)</h3>${table(["시간(분)", "단계", "활동", "자료"], x.timeline)}
  <h3>강의 스크립트</h3><div class="script">${x.script.map((p, k) => `<p><span class="tag">${STAGES[x.no][k]}</span>${esc(p)}</p>`).join("")}</div>
  <div class="check"><b>끝나기 전 확인</b>${ul(x.check)}</div></section>`;
});

html += `<section class="session"><h2>3. 평가 기준</h2>${table(["항목", "우수", "보통", "미흡"], L.rubric)}
<p class="note">결과물이 완벽하게 동작하지 않아도, 왜 안 됐는지 측정하고 설명하면 높은 점수를 줄 수 있다고 첫 시간에 미리 안내합니다.</p>
<h2>4. 안전과 윤리</h2>${ul(L.safety)}
<h2>5. 수업 중 자주 생기는 문제</h2>${table(["보이는 것", "원인과 해결"], L.troubleshoot)}
</section><section class="session"><h2>6. 하루 워크숍(3시간)으로 줄이기</h2>${table(["시간(분)", "내용"], L.oneDay)}
<p class="note">줄일 때는 강사가 스캔 1개를 미리 올려 두고, 언리얼은 강사 PC 1대로 시연하며, ESP32는 DEMO 모드만 씁니다.</p>
<h2>부록. 주소와 파일</h2>${table(["무엇", "어디"], [
  ["앱 설치 파일", "PhoneTwin_v4/install/PhoneTwin-Android-v4.apk · GitHub Releases v0.4.0"],
  ["GitHub 저장소", "github.com/jy3266/PhoneTwin"],
  ["웹 뷰어", "jy3266.github.io/PhoneTwin"],
  ["언리얼 프로젝트", "ARKO_PROJECT (플러그인 PhoneTwinLink), 스캔 원본은 ARKO_PROJECT/PhoneTwinScans"],
  ["ESP32 스케치", "PhoneTwin_v4/esp32/PhoneTwinUWB/PhoneTwinUWB.ino"],
  ["인터넷 릴레이", "wss://phonetwin-relay-95wfh.ondigitalocean.app (키는 강사만 보관)"],
  ["장비 없이 시험", "py tools/pose_sim.py --target <PC IP> --mode phone|esp32 --meta scans/sample_test_room.json"],
])}</section></body></html>`;

fs.writeFileSync(process.argv[2], html, "utf8");
console.log("wrote", process.argv[2]);
