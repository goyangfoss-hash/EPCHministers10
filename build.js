// build.js — Vercel 빌드 시 자동 실행
// app.js 안의 %%BUILD_TIME%% 을 현재 타임스탬프로 교체

const fs = require('fs');
const ts = Date.now().toString();
const code = fs.readFileSync('app.js', 'utf8').replace(/%%BUILD_TIME%%/g, ts);
fs.writeFileSync('app.js', code);
console.log(`[build] sw version = ${ts}`);
