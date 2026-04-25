// ════════════════════════════════════════════════════
//  ⚙️  Supabase 설정
// ════════════════════════════════════════════════════
const SUPABASE_URL      = 'https://uvkhjulyccytzeilykum.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2a2hqdWx5Y2N5dHplaWx5a3VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTQ5NzQsImV4cCI6MjA5MjAzMDk3NH0.AXb-AyKGhmJq_SvEMqFza47qegiTndwXH0ajU40kWiE';
// ════════════════════════════════════════════════════

const OFFLINE = SUPABASE_URL.includes('여기에');
const sb = OFFLINE ? null : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// ══════════════════════════════════════════════════
//  전역 상태
// ══════════════════════════════════════════════════
let cu = null, curY = new Date().getFullYear(), curM = new Date().getMonth();
let calView = 'mine', filterType = '', pollTimer = null, rtChannel = null;
let allSchedules = {};
const getMonthData = (y, m) => allSchedules[y]?.[m] || {};
const curData = () => getMonthData(curY, curM + 1);
let allMembers = [], notices = [], feedPosts = [];
let shiftComments = {}, commentLikes = {}, modalDate = null, parsedExcel = null;
let myShiftYear = new Date().getFullYear(), myShiftMonth = new Date().getMonth() + 1;
let srchYear = 0, srchMonth = 0, srchName = '';

// ── 알림 & 메모 (localStorage 저장) ──────────────
let shiftAlarms = {};
function loadAlarms()  { try { shiftAlarms = JSON.parse(localStorage.getItem('ws_alarms') || '{}'); } catch { shiftAlarms = {}; } }
function saveAlarms()  { localStorage.setItem('ws_alarms', JSON.stringify(shiftAlarms)); }
function getAlarm(y,m,d) { return shiftAlarms[`${y}-${m}-${d}`] || { alarm: false, alarmTime: '09:00', memo: '' }; }
function setAlarm(y,m,d,data) { shiftAlarms[`${y}-${m}-${d}`] = data; saveAlarms(); }
function activeAlarmCount() {
  const now = new Date();
  return Object.entries(shiftAlarms).filter(([k,v]) => {
    if (!v.alarm) return false;
    const [y,m,d] = k.split('-').map(Number);
    return new Date(y, m-1, d) >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }).length;
}

// ── 색상 팔레트 ───────────────────────────────────
const PALETTE = [
  {bg:'#dbeafe',text:'#1e40af',dot:'#2563eb',border:'#93c5fd'},
  {bg:'#dcfce7',text:'#15803d',dot:'#16a34a',border:'#86efac'},
  {bg:'#fef3c7',text:'#92400e',dot:'#d97706',border:'#fcd34d'},
  {bg:'#ffe4e6',text:'#9f1239',dot:'#e11d48',border:'#fda4af'},
  {bg:'#f3e8ff',text:'#6b21a8',dot:'#9333ea',border:'#d8b4fe'},
  {bg:'#ffedd5',text:'#9a3412',dot:'#ea580c',border:'#fdba74'},
  {bg:'#cffafe',text:'#155e75',dot:'#0891b2',border:'#67e8f9'},
  {bg:'#fce7f3',text:'#9d174d',dot:'#db2777',border:'#f9a8d4'},
  {bg:'#ecfdf5',text:'#065f46',dot:'#059669',border:'#6ee7b7'},
  {bg:'#f1f5f9',text:'#334155',dot:'#64748b',border:'#cbd5e1'},
];
let typeColorMap = {};
function assignColors(types) { let idx=Object.keys(typeColorMap).length; (types||[]).forEach(t=>{if(t&&!typeColorMap[t])typeColorMap[t]=PALETTE[idx++%PALETTE.length];}); }
const tc = t => typeColorMap[t] || PALETTE[9];
function collectAllTypes() { const s=new Set(); Object.values(allSchedules).forEach(ym=>Object.values(ym).forEach(nm=>Object.values(nm).forEach(dm=>Object.values(dm).forEach(t=>t&&s.add(t))))); return[...s]; }

// ══════════════════════════════════════════════════
//  초기화
// ══════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  loadAlarms();
  const raw = localStorage.getItem('ws_session');
  if (raw) {
    try { const s=JSON.parse(raw); if (await doLoginWith(s.name,s.phone,s.birth,true)) return; } catch {}
    localStorage.removeItem('ws_session');
  }
  hide('loading'); showScreen('login-screen');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && cu) refreshSchedules(); });

// ══════════════════════════════════════════════════
//  스케줄 새로고침 (폴링 / 포커스 시)
// ══════════════════════════════════════════════════
async function refreshSchedules() {
  if (OFFLINE||!sb) return;
  try {
    const {data,error}=await sb.from('schedules').select('year,month,data').order('year').order('month');
    if (error) throw error;
    allSchedules={};
    (data||[]).forEach(r=>{if(!allSchedules[r.year])allSchedules[r.year]={};allSchedules[r.year][r.month]=r.data||{};});
    assignColors(collectAllTypes());
    renderCalendar();
    if($('tab-myshift')?.style.display!=='none') renderMyShift();
    if($('tab-search')?.style.display!=='none') renderSearchResult();
    if(isAdmin()&&$('tab-admin')?.style.display!=='none') buildSchedPreview();
  } catch(e){console.warn('refreshSchedules:',e.message);}
}

// ══════════════════════════════════════════════════
//  인증
// ══════════════════════════════════════════════════
async function doLoginWith(name, phone, birth, silent=false) {
  try {
    let user=null;
    if (OFFLINE) {
      if (name==='김동권'&&phone==='0932'&&birth==='890726') { user={id:1,name:'김동권',phone:'0932',birth:'890726',role:'admin',status:'approved',memo:'',created_at:new Date().toISOString()}; allMembers=[user]; initOfflineSample(); }
    } else {
      const {data:ud}=await sb.from('app_users').select('*').eq('name',name).eq('phone',phone).eq('birth',birth).maybeSingle();
      user=ud;
      if (user?.status==='approved') {
        // ★ cu를 먼저 설정한 후 loadAll() 호출 (notice_reads 조회 시 cu.id 필요)
        cu = user;
        await loadAll();
      }
      else if (user?.status==='pending') await refreshSchedules();
    }
    if (!user){if(!silent)showErr($('l-err'),'이름, 연락처, 생년월일을 다시 확인해주세요.');return false;}
    if (user.status==='pending'){if(!silent){const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[name]));showErr($('l-err'),inS?`승인 대기 중입니다. 근무표에 '${name}'님의 일정이 있습니다.`:'관리자 승인 대기 중입니다.');}return false;}
    if (user.status==='rejected'){if(!silent)showErr($('l-err'),'가입이 거절되었습니다.');return false;}
    cu=user;
    // ★ 로그인 유지: 체크박스가 체크되거나, 세션복원 경로(silent)면 저장
    const keepLogin = silent || ($('keep-login')?.checked !== false);
    if (keepLogin) localStorage.setItem('ws_session',JSON.stringify({name,phone,birth}));
    hide('loading'); enterApp(); return true;
  } catch(e){console.error(e);if(!silent)showErr($('l-err'),'연결 오류: '+e.message);return false;}
}

async function doLogin() {
  const name=val('l-name'),phone=val('l-phone'),birth=val('l-pw');
  $('l-err').style.display='none';
  if(!name||!phone||!birth) return showErr($('l-err'),'모든 항목을 입력해주세요.');
  const btn=$('login-btn'); btn.textContent='로그인 중...'; btn.disabled=true;
  await doLoginWith(name,phone,birth);
  btn.textContent='로그인'; btn.disabled=false;
}

async function doRegister() {
  const name=val('r-name'),phone=val('r-phone'),birth=val('r-pw');
  const errEl=$('r-err'),okEl=$('r-ok'); errEl.style.display='none'; okEl.style.display='none';
  if(!name||!phone||!birth) return showErr(errEl,'모든 항목을 입력해주세요.');
  if(!/^\d{4}$/.test(phone)) return showErr(errEl,'연락처는 숫자 4자리로 입력해주세요.');
  if(!/^\d{6}$/.test(birth)) return showErr(errEl,'생년월일은 숫자 6자리로 입력해주세요.');
  if(OFFLINE){okEl.textContent='가입 신청 완료 (오프라인 모드)';okEl.style.display='block';return;}
  const {data:ex}=await sb.from('app_users').select('id').eq('name',name).eq('phone',phone).maybeSingle();
  if(ex) return showErr(errEl,'이미 가입된 계정입니다.');
  const {error}=await sb.from('app_users').insert({name,phone,birth,role:'employee',status:'pending'});
  if(error) return showErr(errEl,'오류가 발생했습니다.');
  await refreshSchedules();
  const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[name]));
  okEl.textContent=`'${name}'님의 가입 신청이 완료되었습니다.${inS?` 근무표에 '${name}'님의 일정이 있습니다. 관리자 승인 후 바로 확인하실 수 있습니다.`:' 관리자 승인 후 로그인 가능합니다.'}`;
  okEl.style.display='block'; ['r-name','r-phone','r-pw'].forEach(id=>$(id).value='');
}

function doLogout() {
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  if(rtChannel){sb?.removeChannel(rtChannel);rtChannel=null;}
  cu=null; localStorage.removeItem('ws_session');
  allMembers=[];allSchedules={};notices=[];feedPosts=[];shiftComments={};commentLikes={};typeColorMap={};filterType='';
  showScreen('login-screen'); showLoginCard();
  ['l-name','l-phone','l-pw'].forEach(id=>$(id).value=''); $('l-err').style.display='none';
}
function showLoginCard(){$('reg-card').style.display='none';$('login-card').style.display='block';}
function showRegCard(){$('login-card').style.display='none';$('reg-card').style.display='block';}
function isAdmin(){return cu?.role==='admin'||cu?.role==='superadmin';}

// ══════════════════════════════════════════════════
//  앱 진입
// ══════════════════════════════════════════════════
function enterApp() {
  showScreen('main-screen');
  $('hdr-name').textContent=cu.name; $('hdr-avatar').textContent=cu.name[0];
  $('btn-admin').style.display=isAdmin()?'flex':'none';
  assignColors(collectAllTypes()); renderCalendar(); renderNotices(); updateAlarmBadge();
  if(isAdmin()) renderAdmin();
  startRealtime();
  if(!OFFLINE){if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>refreshSchedules(),5*60*1000);}
  scheduleLocalAlarms();
  checkNotifPermission(); // ★ 기기 알림 권한 배너
  if('serviceWorker'in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// ══════════════════════════════════════════════════
//  Realtime
// ══════════════════════════════════════════════════
function startRealtime() {
  if(OFFLINE) return;
  if(rtChannel){sb.removeChannel(rtChannel);rtChannel=null;}
  rtChannel=sb.channel('ws_v10')
    .on('postgres_changes',{event:'*',schema:'public',table:'schedules'},async payload=>{
      const{year,month}=payload.new||payload.old||{};
      if(!year||!month){await refreshSchedules();return;}
      try{
        const{data}=await sb.from('schedules').select('data').eq('year',year).eq('month',month).maybeSingle();
        if(!allSchedules[year])allSchedules[year]={};
        allSchedules[year][month]=data?.data||{};
        assignColors(collectAllTypes());filterType='';
        renderCalendar();
        if($('tab-myshift')?.style.display!=='none') renderMyShift();
        if($('tab-search')?.style.display!=='none') renderSearchResult();
        if(isAdmin()) buildSchedPreview();
        showToastMsg(`${year}년 ${month}월 근무표가 업데이트되었습니다.`);
      }catch{await refreshSchedules();}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'app_users'},async()=>{
      const{data}=await sb.from('app_users').select('*');
      if(data){allMembers=data.filter(u=>u.status==='approved');window._pending=data.filter(u=>u.status==='pending');}
      if(isAdmin()){renderAdmin();updatePendingBadge();}
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'shift_comments'},payload=>{
      const row=payload.new, author=allMembers.find(u=>u.id===row.user_id);
      const key=`${row.year}-${row.month}-${row.day}`;
      if(!shiftComments[key])shiftComments[key]=[];
      if(!shiftComments[key].find(c=>c.id===row.id)){shiftComments[key].push({...row,author_name:author?.name||'알 수 없음'});if(!commentLikes[row.id])commentLikes[row.id]=new Set();}
      if(row.year===curY&&row.month===curM+1) renderCalendar();
      if(modalDate?.year===row.year&&modalDate?.month===row.month&&modalDate?.day===row.day) renderDayModal();
      if(row.user_id!==cu.id) pushNotify(`${author?.name||'누군가'}님의 댓글`,`${row.month}월 ${row.day}일: ${row.content}`);
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notices'},payload=>{
      const n={...payload.new,is_unread:true};
      if(!notices.find(x=>x.id===n.id)){notices.unshift(n);renderNotices();updateNoticeBadge();pushNotify(`새 공지: ${n.title}`,n.body);}
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'feed_posts'},payload=>{
      const idx=feedPosts.findIndex(p=>p.id===payload.new.id);
      if(idx>=0)feedPosts[idx]={...feedPosts[idx],...payload.new};
      if($('tab-feed')?.style.display!=='none')renderMyFeed();
      if(isAdmin()&&$('tab-admin')?.style.display!=='none')renderAdminFeed();
      if(payload.new.admin_reply&&payload.new.user_id===cu.id)pushNotify('관리자 답변 도착',payload.new.admin_reply);
    })
    .subscribe(s=>console.log('[RT]',s));
}
function pushNotify(title,body){if(!('Notification'in window)||Notification.permission!=='granted')return;try{new Notification(title,{body,icon:'icon-192.png'});}catch{}}

// ── 기기 알림 권한 배너 ───────────────────────────
function checkNotifPermission(){
  // 이미 배너를 닫은 경우 → 건너뜀
  if(localStorage.getItem('ws_notif_dismissed')==='1') return;
  // 이미 허용된 경우 → 건너뜀
  if('Notification' in window && Notification.permission==='granted') return;
  // 그 외 모든 경우(미결정·거부·미지원) → 배너 표시
  // denied 상태도 표시 (브라우저 설정 안내 목적)
  setTimeout(showNotifBanner, 2000);
}

function showNotifBanner(){
  if($('notif-banner')) return;
  const denied = 'Notification' in window && Notification.permission==='denied';
  const unsupported = !('Notification' in window);

  const b = document.createElement('div');
  b.id = 'notif-banner';
  b.style.cssText = 'position:fixed;bottom:75px;left:50%;transform:translateX(-50%);width:calc(100% - 28px);max-width:452px;background:#1c1c1a;color:#fff;border-radius:16px;padding:14px 16px;z-index:40;display:flex;align-items:center;gap:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);animation:slideUp .3s ease';

  let actionHtml;
  if (unsupported) {
    // Safari 등 미지원 브라우저
    actionHtml = `<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <div style="font-size:10px;color:#aaa;text-align:center;line-height:1.4">홈 화면에 추가 후<br>앱으로 실행하면<br>알림을 받을 수 있습니다</div>
      <button onclick="dismissNotifBanner()" style="padding:6px 14px;background:transparent;color:#777;border:1px solid #444;border-radius:9px;font-size:11px;cursor:pointer">확인</button>
    </div>`;
  } else if (denied) {
    // 이미 거부된 경우 → 브라우저 설정 안내
    actionHtml = `<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <div style="font-size:10px;color:#aaa;text-align:center;line-height:1.4">브라우저 설정에서<br>알림을 허용해주세요</div>
      <button onclick="dismissNotifBanner()" style="padding:6px 14px;background:transparent;color:#777;border:1px solid #444;border-radius:9px;font-size:11px;cursor:pointer">닫기</button>
    </div>`;
  } else {
    // 미결정 → 허용 요청
    actionHtml = `<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <button onclick="requestNotifPermission()" style="padding:8px 14px;background:#185FA5;color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer">허용하기</button>
      <button onclick="dismissNotifBanner()" style="padding:6px 14px;background:transparent;color:#777;border:1px solid #444;border-radius:9px;font-size:11px;cursor:pointer">다음에</button>
    </div>`;
  }

  b.innerHTML = `
    <style>@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>
    <span style="font-size:24px;flex-shrink:0">🔔</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:700;margin-bottom:3px">기기 알림 ${denied?'설정 안내':unsupported?'안내':'허용'}</div>
      <div style="font-size:11px;color:#999;line-height:1.6">
        ${denied?'알림이 차단되어 있습니다.<br>브라우저 주소창 자물쇠 아이콘을 눌러<br>알림을 허용으로 변경해주세요.':unsupported?'이 브라우저는 알림을 지원하지 않습니다.<br>Chrome 앱으로 접속하면 알림을 받을 수 있습니다.':'근무 전날 알림·공지·댓글을<br>기기에서 바로 받을 수 있습니다.'}
      </div>
    </div>
    ${actionHtml}`;

  document.body.appendChild(b);
}

async function requestNotifPermission(){
  $('notif-banner')?.remove();
  if(!('Notification'in window)) return showToastMsg('이 브라우저는 알림을 지원하지 않습니다.');
  try {
    const perm = await Notification.requestPermission();
    if(perm==='granted'){
      showToastMsg('✅ 기기 알림이 허용되었습니다!');
      updateAlarmBadge(); scheduleLocalAlarms();
      setTimeout(()=>pushNotify('근무표 앱 알림 설정 완료','이제 근무 전날 알림을 기기에서 받을 수 있습니다.'),800);
    } else {
      showToastMsg('알림이 거부되었습니다. 브라우저 설정에서 변경할 수 있습니다.');
      localStorage.setItem('ws_notif_dismissed','1');
    }
  } catch(e) {
    showToastMsg('알림 설정 중 오류가 발생했습니다: '+e.message);
  }
}
function dismissNotifBanner(){ $('notif-banner')?.remove(); localStorage.setItem('ws_notif_dismissed','1'); }

// ── 알림 기능 ─────────────────────────────────────
function updateAlarmBadge(){
  const cnt=activeAlarmCount();
  const btn=$('btn-alarm'); if(!btn)return;
  let b=btn.querySelector('.alarm-badge');
  if(cnt>0){if(!b){b=document.createElement('div');b.className='alarm-badge';btn.appendChild(b);}b.textContent=cnt;}
  else b?.remove();
}

function scheduleLocalAlarms(){
  const now=new Date(), myD=curData()[cu.name]||{};
  Object.entries(myD).forEach(([ds,type])=>{
    const d=parseInt(ds), alarm=getAlarm(curY,curM+1,d);
    if(!alarm.alarm) return;
    const[h,m]=(alarm.alarmTime||'09:00').split(':').map(Number);
    const alarmDt=new Date(curY,curM,d-1,h,m,0);
    const ms=alarmDt-now;
    if(ms>0&&ms<24*60*60*1000) setTimeout(()=>pushNotify(`내일 근무 알림 (${type})`,`${curY}년 ${curM+1}월 ${d}일 근무가 내일입니다.`),ms);
  });
}

function toggleAlarmPanel(){
  const panel=$('alarm-panel');if(!panel)return;
  panel.style.display=panel.style.display==='none'?'block':'none';
  if(panel.style.display==='block') renderAlarmPanel();
}

function renderAlarmPanel(){
  const el=$('alarm-panel-list');
  const myD=curData()[cu.name]||{};
  const days=Object.keys(myD).map(Number).sort((a,b)=>a-b);
  const MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DN=['일','월','화','수','목','금','토'];
  if(!days.length){el.innerHTML='<p style="font-size:13px;color:#bbb;padding:16px;text-align:center">이번 달 근무일이 없습니다</p>';return;}
  el.innerHTML=days.map(d=>{
    const type=myD[String(d)]||'',c=type?tc(type):null,alarm=getAlarm(curY,curM+1,d);
    const dow=new Date(curY,curM,d).getDay();
    return`<div class="alarm-item" onclick="openDayModal(${d});toggleAlarmPanel()">
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <div class="alarm-day-num" ${c?`style="background:${c.bg};color:${c.dot}"`:''}>${d}</div>
        <div>
          <div style="font-size:13px;font-weight:600">${MN[curM]} ${d}일 <span style="color:#aaa;font-weight:400">${DN[dow]}</span></div>
          ${type&&c?`<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span>`:''}
          ${alarm.memo?`<div style="font-size:11px;color:#888;margin-top:3px">📝 ${esc(alarm.memo)}</div>`:''}
        </div>
      </div>
      <div onclick="event.stopPropagation()">
        <div class="toggle${alarm.alarm?' on':''}" onclick="toggleShiftAlarm(${curY},${curM+1},${d})"></div>
      </div>
    </div>`;
  }).join('');
}

function toggleShiftAlarm(y,m,d){
  const cur=getAlarm(y,m,d); setAlarm(y,m,d,{...cur,alarm:!cur.alarm});
  updateAlarmBadge(); renderAlarmPanel(); scheduleLocalAlarms();
  showToastMsg(!cur.alarm?`${m}월 ${d}일 알림 설정됨`:`${m}월 ${d}일 알림 해제됨`);
}
function updateAlarmTime(y,m,d,time){const cur=getAlarm(y,m,d);setAlarm(y,m,d,{...cur,alarmTime:time});scheduleLocalAlarms();}
function saveShiftMemo(y,m,d){
  const key=`${y}-${m}-${d}`, memo=$(`shift-memo-${key}`)?.value||'';
  const cur=getAlarm(y,m,d); setAlarm(y,m,d,{...cur,memo});
  showToastMsg('메모가 저장되었습니다.'); renderDayModal(); renderCalendar();
  if($('tab-myshift')?.style.display!=='none')renderMyShift();
}

// ══════════════════════════════════════════════════
//  DB 전체 로드
// ══════════════════════════════════════════════════
async function loadAll(){
  const[uR,sR,nR,fR,cR,rR]=await Promise.all([
    sb.from('app_users').select('*'),
    sb.from('schedules').select('year,month,data').order('year').order('month'),
    sb.from('notices').select('*').order('created_at',{ascending:false}),
    sb.from('feed_posts').select('*,app_users(name)').order('created_at',{ascending:false}),
    sb.from('shift_comments').select('*,app_users(name)').gte('year',new Date().getFullYear()-1),
    // ★ 내가 읽은 공지 ID 목록 조회
    sb.from('notice_reads').select('notice_id').eq('user_id', cu?.id || 0),
  ]);
  const all=uR.data||[];
  allMembers=all.filter(u=>u.status==='approved'); window._pending=all.filter(u=>u.status==='pending');
  allSchedules={};
  (sR.data||[]).forEach(r=>{if(!allSchedules[r.year])allSchedules[r.year]={};allSchedules[r.year][r.month]=r.data||{};});
  assignColors(collectAllTypes());
  // ★ 읽은 공지 ID 세트 생성 → 읽지 않은 것만 is_unread:true
  const readIds = new Set((rR.data||[]).map(r=>r.notice_id));
  notices=(nR.data||[]).map(n=>({...n, is_unread: !readIds.has(n.id)}));
  feedPosts=(fR.data||[]).map(p=>({...p,author_name:p.app_users?.name}));
  shiftComments={};
  (cR.data||[]).forEach(c=>{const k=`${c.year}-${c.month}-${c.day}`;if(!shiftComments[k])shiftComments[k]=[];if(!shiftComments[k].find(x=>x.id===c.id))shiftComments[k].push({...c,author_name:c.app_users?.name});if(!commentLikes[c.id])commentLikes[c.id]=new Set();});
}
function initOfflineSample(){allSchedules={2026:{5:{'김동권':{'6':'[오전]자막','17':'[새벽]설교','24':'[저녁]기도'},'이미영':{'2':'[금요]기도','10':'[수요]설교','25':'[오전]사회'},'박지훈':{'5':'[새벽]설교','13':'[금요]영상'},'최수연':{'4':'[오전]사회','16':'[금요]자막'}}}};assignColors(collectAllTypes());}

// ══════════════════════════════════════════════════
//  탭 전환
// ══════════════════════════════════════════════════
function switchTab(tab,btn){
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  ['cal','myshift','search','notice','feed','admin'].forEach(t=>$(`tab-${t}`).style.display=t===tab?'block':'none');
  $('hdr-title').textContent={cal:'근무표',myshift:'내 근무',search:'근무 검색',notice:'공지사항',feed:'소통',admin:'관리자'}[tab]||tab;
  if(tab==='myshift'){myShiftYear=curY;myShiftMonth=curM+1;renderMyShift();}
  if(tab==='search'){renderSearchFilters();renderSearchResult();}
  if(tab==='notice')clearNoticeBadge();
  if(tab==='feed')renderMyFeed();
  if(tab==='admin')renderAdmin();
  $('alarm-panel').style.display='none';
}

// ══════════════════════════════════════════════════
//  캘린더
// ══════════════════════════════════════════════════
function setView(v){calView=v;filterType='';$('view-mine').classList.toggle('active',v==='mine');$('view-all').classList.toggle('active',v==='all');renderCalendar();}
function setFilter(t){filterType=filterType===t?'':t;renderCalendar();}
function changeMonth(d){curM+=d;if(curM>11){curM=0;curY++;}if(curM<0){curM=11;curY--;}filterType='';if(!OFFLINE&&!allSchedules[curY]?.[curM+1]){sb.from('schedules').select('year,month,data').eq('year',curY).eq('month',curM+1).maybeSingle().then(({data})=>{if(data){if(!allSchedules[curY])allSchedules[curY]={};allSchedules[curY][curM+1]=data.data||{};assignColors(collectAllTypes());}renderCalendar();});}else renderCalendar();}

function renderLegend(){
  const el=$('cal-legend');if(!el)return;
  const types=(()=>{const s=new Set();Object.values(curData()).forEach(wd=>Object.values(wd).forEach(t=>t&&s.add(t)));return[...s];})();
  if(!types.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="legend-wrap"><button class="legend-btn${filterType===''?' active':''}" onclick="setFilter('')" style="background:#f0f0ea;color:#666;border-color:#ddd">전체</button>${types.map(t=>{const c=tc(t);return`<button class="legend-btn${filterType===t?' active':''}" onclick="setFilter('${esc(t)}')" style="background:${c.bg};color:${c.text};border-color:${c.border}"><span class="legend-dot" style="background:${c.dot}"></span>${t}</button>`;}).join('')}</div>`;
}

function renderCalendar(){
  const DN=['일','월','화','수','목','금','토'],MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const fd=new Date(curY,curM,1).getDay(),dim=new Date(curY,curM+1,0).getDate(),now=new Date(),d=curData();
  const myRaw=d[cu.name]||{}, myDays=new Set(Object.keys(myRaw).map(Number).filter(n=>!isNaN(n)&&n>=1));
  $('month-label').textContent=`${curY}년 ${MN[curM]}`;
  const allMap={};
  Object.keys(d).forEach((name)=>{Object.entries(d[name]||{}).forEach(([ds,type])=>{const dn=parseInt(ds);if(isNaN(dn)||dn<1||dn>31)return;if(!allMap[dn])allMap[dn]=[];allMap[dn].push({name,type,c:tc(type)});});});
  const fm={};if(filterType){Object.entries(allMap).forEach(([day,ws])=>{const fw=ws.filter(w=>w.type===filterType);if(fw.length)fm[parseInt(day)]=fw;});}else Object.assign(fm,allMap);
  const fmMy=new Set();if(filterType)myDays.forEach(d=>{if(myRaw[String(d)]===filterType)fmMy.add(d);});else myDays.forEach(d=>fmMy.add(d));
  let html=DN.map(d=>`<div class="cal-head">${d}</div>`).join('');
  for(let i=0;i<fd;i++)html+=`<div class="cal-cell empty"></div>`;
  for(let d=1;d<=dim;d++){
    const isMy=myDays.has(d),isToday=now.getFullYear()===curY&&now.getMonth()===curM&&now.getDate()===d;
    const dow=new Date(curY,curM,d).getDay(),key=`${curY}-${curM+1}-${d}`,cc=(shiftComments[key]||[]).length;
    const myType=myRaw[String(d)]||'',myC=myType?tc(myType):null,workers=fm[d]||[];
    const dimmed=filterType&&((calView==='mine'&&!fmMy.has(d)&&!isAdmin())||(calView==='all'&&!workers.length));
    const alarm=isMy?getAlarm(curY,curM+1,d):null;
    let cls='cal-cell'+(dow===0?' sun':'')+(dow===6?' sat':'')+(isToday?' today':'')+(dimmed?' dimmed':'');
    let style=isMy&&calView==='mine'&&myC?`style="background:${myC.bg};border-color:${myC.border}"`:'';
    const dots=(calView==='all'||isAdmin())&&workers.length?`<div class="shift-dots">${workers.slice(0,5).map(w=>`<div class="shift-dot" style="background:${w.c.dot}" title="${w.name}:${w.type}"></div>`).join('')}${workers.length>5?`<span class="more-dot">+${workers.length-5}</span>`:''}</div>`:'';
    const typeTip=myType&&calView==='mine'&&myC?`<div class="type-tip" style="color:${myC.text}">${myType.replace(/[\[\]]/g,'').slice(0,4)}</div>`:'';
    const cmt=cc?`<div class="cmt-indicator">${cc}</div>`:'';
    const myDot=isMy?`<span class="my-dot" style="background:${myC?.dot||'#185FA5'}"></span>`:'';
    const alarmDot=alarm?.alarm?`<div class="alarm-dot-cal">🔔</div>`:'';
    html+=`<div class="${cls}" ${style} onclick="openDayModal(${d})"><div class="day-num-wrap"><span class="day-num">${d}</span>${myDot}</div>${typeTip}${dots}${cmt}${alarmDot}</div>`;
  }
  $('cal-grid').innerHTML=html; renderLegend(); renderShiftList(dim,MN,DN,myDays,myRaw,fm,allMap);
}

function renderShiftList(dim,MN,DN,myDays,myRaw,fm,allMap){
  const el=$('shift-list'),now=new Date();
  const makeChips=ws=>ws.map(w=>`<span class="worker-chip" style="background:${w.c.bg};color:${w.c.text};border:1px solid ${w.c.border}">${w.name}<span class="chip-type">${w.type}</span></span>`).join('');
  const pastDay=d=>(curY<now.getFullYear())||(curY===now.getFullYear()&&curM<now.getMonth())||(curY===now.getFullYear()&&curM===now.getMonth()&&d<now.getDate());
  if(isAdmin()||calView==='all'){
    let html=`<div class="list-section-title">${filterType?`'${filterType}' 근무 `:''}이번 달 전체</div>`,any=false;
    for(let d=1;d<=dim;d++){const ws=fm[d]||[];if(!ws.length)continue;any=true;const key=`${curY}-${curM+1}-${d}`,cc=(shiftComments[key]||[]).length;html+=`<div class="list-card${pastDay(d)?' past':''}" onclick="openDayModal(${d})"><div class="list-card-header"><span class="list-date">${MN[curM]} ${d}일 <span class="list-dow">${DN[new Date(curY,curM,d).getDay()]}</span></span><div style="display:flex;gap:6px;align-items:center">${cc?`<span class="cmt-cnt">${cc}개</span>`:''}<span class="worker-cnt">${ws.length}명</span></div></div><div class="worker-chips">${makeChips(ws)}</div></div>`;}
    if(!any)html+=`<p class="empty-state">${filterType?`'${filterType}' 근무자 없음`:'근무 일정이 없습니다. 엑셀을 업로드해주세요.'}</p>`;
    el.innerHTML=html;return;
  }
  const arr=[...myDays].filter(d=>!filterType||myRaw[String(d)]===filterType).sort((a,b)=>a-b);
  if(!arr.length){el.innerHTML=`<p class="empty-state">${filterType?`'${filterType}' 근무일 없음`:'이번 달 등록된 근무일이 없습니다.'}</p>`;return;}
  let html=`<div class="list-section-title">근무일 (${arr.length}일)</div>`;
  html+=arr.map(d=>{
    const type=myRaw[String(d)]||'',c=type?tc(type):null,key=`${curY}-${curM+1}-${d}`,cc=(shiftComments[key]||[]).length,alarm=getAlarm(curY,curM+1,d);
    return`<div class="list-card${pastDay(d)?' past':''}" onclick="openDayModal(${d})"><div class="list-card-header"><span class="list-date">${MN[curM]} ${d}일 <span class="list-dow">${DN[new Date(curY,curM,d).getDay()]}</span></span><div style="display:flex;gap:6px;align-items:center">${alarm.alarm?'<span>🔔</span>':''}${cc?`<span class="cmt-cnt">${cc}개 댓글</span>`:''}${type&&c?`<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span>`:''}</div></div>${alarm.memo?`<div style="font-size:12px;color:#888;margin-top:4px;border-top:1px solid #f5f5f0;padding-top:4px">📝 ${esc(alarm.memo)}</div>`:''}</div>`;
  }).join('');
  el.innerHTML=html;
}

// ══════════════════════════════════════════════════
//  날짜 모달 — 근무자 + 알림/메모 + 댓글
// ══════════════════════════════════════════════════
function openDayModal(day){
  const DN=['일','월','화','수','목','금','토'],MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  modalDate={year:curY,month:curM+1,day};
  $('modal-title').textContent=`${MN[curM]} ${day}일 (${DN[new Date(curY,curM,day).getDay()]})`;
  $('comment-modal').style.display='flex'; renderDayModal();
}
function renderDayModal(){
  if(!modalDate)return;
  const{year,month,day}=modalDate,key=`${year}-${month}-${day}`,d=getMonthData(year,month);
  const workers=Object.keys(d).filter(n=>d[n]?.[String(day)]).map(n=>({name:n,type:d[n][String(day)]}));
  const myType=d[cu.name]?.[String(day)]||'',alarm=getAlarm(year,month,day);
  // 근무자
  let wHtml=`<div class="modal-section"><div class="modal-section-title">이 날 근무자</div>`;
  wHtml+=workers.length?workers.map(w=>{const c=tc(w.type);return`<div class="day-worker-row"><div style="display:flex;align-items:center;gap:9px"><div class="worker-av" style="background:${c.bg};color:${c.text}">${w.name[0]}</div><span class="worker-nm">${w.name}</span></div><span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${w.type}</span></div>`;}).join(''):`<p class="empty-state" style="padding:10px 0">근무자가 없습니다</p>`;
  wHtml+='</div>';
  // 알림 & 메모 (내 근무일만)
  let alarmHtml='';
  if(myType){
    alarmHtml=`<div class="modal-section">
      <div class="modal-section-title">알림 & 메모</div>
      <div class="alarm-setting-row">
        <div><div style="font-size:13px;font-weight:600">전날 알림 받기</div><div style="font-size:11px;color:#aaa;margin-top:2px">근무 전날 ${alarm.alarmTime||'09:00'}에 알림</div></div>
        <div class="toggle${alarm.alarm?' on':''}" onclick="toggleShiftAlarm(${year},${month},${day});renderDayModal();updateAlarmBadge()"></div>
      </div>
      ${alarm.alarm?`<div class="alarm-time-row"><label style="font-size:12px;color:#888;font-weight:600;flex-shrink:0">알림 시각</label><input type="time" class="time-input" value="${alarm.alarmTime||'09:00'}" onchange="updateAlarmTime(${year},${month},${day},this.value);renderDayModal()"></div>`:''}
      <div style="margin-top:10px">
        <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:5px">메모</div>
        <textarea class="shift-memo-area" id="shift-memo-${key}" placeholder="이 근무에 대한 메모를 남겨보세요...">${esc(alarm.memo||'')}</textarea>
        <button class="memo-save-btn" onclick="saveShiftMemo(${year},${month},${day})">메모 저장</button>
      </div>
    </div>`;
  }
  // 댓글
  const cmts=shiftComments[key]||[];
  let cHtml=`<div class="modal-section"><div class="modal-section-title">댓글 (${cmts.length})</div>`;
  cHtml+=cmts.length?cmts.map(c=>{const lk=commentLikes[c.id]||new Set(),liked=lk.has(cu.id);return`<div class="comment-item"><div class="comment-header"><span class="comment-author">${c.author_name}</span><span class="comment-time">${fmtDate(c.created_at)}</span></div><div class="comment-text">${esc(c.content)}</div><div class="comment-actions"><button class="like-btn${liked?' liked':''}" onclick="toggleLike(${c.id})"><svg width="12" height="12" viewBox="0 0 12 12" fill="${liked?'#e74c3c':'none'}"><path d="M6 10.5C6 10.5 1 7.5 1 4a2.5 2.5 0 015 0 2.5 2.5 0 015 0c0 3.5-5 6.5-5 6.5z" stroke="${liked?'#e74c3c':'#bbb'}" stroke-width="1.2"/></svg>${lk.size||''}</button>${isAdmin()?`<button class="del-btn" style="color:#185FA5" onclick="editComment('${key}',${c.id})">수정</button>`:''} ${isAdmin()||c.user_id===cu.id?`<button class="del-btn" onclick="deleteComment('${key}',${c.id})">삭제</button>`:''}</div></div>`;}).join(''):`<p class="empty-state" style="padding:10px 0">첫 댓글을 남겨보세요</p>`;
  cHtml+='</div>';
  $('modal-body').innerHTML=wHtml+alarmHtml+cHtml;
}
function closeModalById(id){$(id).style.display='none';if(id==='comment-modal')modalDate=null;}
function closeBgModal(e,id){if(e.target===$(id))closeModalById(id);}
async function submitComment(){
  const txt=$('comment-input').value.trim();if(!txt||!modalDate)return;
  const key=`${modalDate.year}-${modalDate.month}-${modalDate.day}`,cmt={id:Date.now(),author_name:cu.name,user_id:cu.id,content:txt,created_at:new Date().toISOString(),...modalDate};
  if(!OFFLINE){const{data}=await sb.from('shift_comments').insert({user_id:cu.id,...modalDate,content:txt}).select('*').single();if(data){cmt.id=data.id;cmt.created_at=data.created_at;}}
  else{if(!shiftComments[key])shiftComments[key]=[];shiftComments[key].push(cmt);if(!commentLikes[cmt.id])commentLikes[cmt.id]=new Set();renderDayModal();renderCalendar();}
  $('comment-input').value='';
}
function toggleLike(cid){if(!commentLikes[cid])commentLikes[cid]=new Set();const s=commentLikes[cid];s.has(cu.id)?s.delete(cu.id):s.add(cu.id);if(!OFFLINE)s.has(cu.id)?sb.from('comment_likes').upsert({comment_id:cid,user_id:cu.id}):sb.from('comment_likes').delete().eq('comment_id',cid).eq('user_id',cu.id);renderDayModal();}
function deleteComment(key,cid){if(!confirm('댓글을 삭제하시겠습니까?'))return;shiftComments[key]=(shiftComments[key]||[]).filter(c=>c.id!==cid);if(!OFFLINE)sb.from('shift_comments').delete().eq('id',cid);renderDayModal();renderCalendar();}
// ★ 관리자: 댓글 수정
async function editComment(key,cid){
  const cmts=shiftComments[key]||[];
  const c=cmts.find(x=>x.id===cid); if(!c) return;
  const newTxt=prompt('댓글 수정:',c.content); if(newTxt===null||!newTxt.trim()) return;
  c.content=newTxt.trim();
  if(!OFFLINE) await sb.from('shift_comments').update({content:c.content}).eq('id',cid);
  renderDayModal();
  showToastMsg('댓글이 수정되었습니다.');
}

// ══════════════════════════════════════════════════
//  내 근무 탭 (관리자도 본인 이름으로 조회)
// ══════════════════════════════════════════════════
function renderMyShift(){
  const el=$('myshift-content'),MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],DN=['일','월','화','수','목','금','토'],now=new Date();
  const myMonths=[];
  Object.entries(allSchedules).forEach(([y,ym])=>Object.entries(ym).forEach(([m,d])=>{if(d[cu.name])myMonths.push({y:parseInt(y),m:parseInt(m)});}));
  myMonths.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);
  if(!myMonths.length){el.innerHTML=`<div class="search-empty"><div style="font-size:36px;margin-bottom:12px">📅</div><div style="font-size:14px;font-weight:600;color:#888">등록된 근무 기록이 없습니다</div><div style="font-size:12px;color:#bbb;margin-top:6px;line-height:1.6">근무표에 '${cu.name}'님의 이름이<br>포함되면 여기서 확인할 수 있습니다</div></div>`;return;}
  if(!myMonths.find(x=>x.y===myShiftYear&&x.m===myShiftMonth)){myShiftYear=myMonths[0].y;myShiftMonth=myMonths[0].m;}
  const cumCount={};myMonths.forEach(({y,m})=>{Object.values(getMonthData(y,m)[cu.name]||{}).forEach(t=>{if(t)cumCount[t]=(cumCount[t]||0)+1;});});
  const cumTotal=Object.values(cumCount).reduce((s,v)=>s+v,0);
  const remaining=myMonths.reduce((s,{y,m})=>s+Object.keys(getMonthData(y,m)[cu.name]||{}).filter(d=>new Date(y,m-1,parseInt(d))>=new Date(now.getFullYear(),now.getMonth(),now.getDate())).length,0);
  const myRaw2=getMonthData(myShiftYear,myShiftMonth)[cu.name]||{},myDays=Object.keys(myRaw2).map(Number).sort((a,b)=>a-b);
  const typeCount={};myDays.forEach(d=>{const t=myRaw2[String(d)];if(t)typeCount[t]=(typeCount[t]||0)+1;});
  const pastDay=(y,m,d)=>new Date(y,m-1,d)<new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let html=`
    <div class="my-header-card">
      <div class="my-name-badge">${cu.name}${isAdmin()?` <span class="role-tag" style="font-size:11px">관리자</span>`:''}</div>
      <div class="search-stats">
        <div class="stat-item"><div class="stat-num">${cumTotal}</div><div class="stat-label">전체 근무</div></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><div class="stat-num">${myMonths.length}</div><div class="stat-label">근무 개월</div></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><div class="stat-num" style="color:#185FA5">${remaining}</div><div class="stat-label">남은 근무</div></div>
      </div>
    </div>
    <div class="stat-section-card"><div class="stat-section-title">전체 기간 근무형태별 누적</div>
      <div class="type-stat-grid">${Object.entries(cumCount).sort((a,b)=>b[1]-a[1]).map(([type,cnt])=>{const c=tc(type);return`<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}"><div class="type-stat-name" style="color:${c.text}">${type}</div><div class="type-stat-big" style="color:${c.dot}">${cnt}</div><div class="type-stat-sub" style="color:${c.text}">회</div></div>`;}).join('')}</div>
    </div>
    <div class="list-section-title">월 선택</div>
    <div class="month-tabs">${myMonths.map(x=>`<button class="month-tab-btn${x.y===myShiftYear&&x.m===myShiftMonth?' active':''}" onclick="selectMyMonth(${x.y},${x.m})">${x.y}년 ${MN[x.m]}</button>`).join('')}</div>
    <div class="stat-section-card" style="margin-top:10px">
      <div class="stat-section-title">${myShiftYear}년 ${MN[myShiftMonth]} 근무현황</div>
      ${Object.keys(typeCount).length?`<div class="type-stat-grid" style="margin-bottom:12px">${Object.entries(typeCount).map(([type,cnt])=>{const c=tc(type);return`<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}"><div class="type-stat-name" style="color:${c.text}">${type}</div><div class="type-stat-big" style="color:${c.dot}">${cnt}</div><div class="type-stat-sub" style="color:${c.text}">회</div></div>`;}).join('')}</div>`:''}
      ${myDays.length?myDays.map(d=>{
        const type=myRaw2[String(d)]||'',c=type?tc(type):null,dow=new Date(myShiftYear,myShiftMonth-1,d).getDay(),key=`${myShiftYear}-${myShiftMonth}-${d}`,cc=(shiftComments[key]||[]).length;
        const alarm=getAlarm(myShiftYear,myShiftMonth,d),isToday=now.getFullYear()===myShiftYear&&now.getMonth()===myShiftMonth-1&&now.getDate()===d,past=pastDay(myShiftYear,myShiftMonth,d)&&!isToday;
        return`<div class="search-card${isToday?' today-card':past?' past-card':''}" ${type&&c?`style="border-left:4px solid ${c.dot}"`:''}  onclick="viewDayInCal(${myShiftYear},${myShiftMonth-1},${d})">
          <div class="search-card-left">
            <div class="search-day-num${isToday?' today-num':''}" ${c?`style="color:${c.dot}"`:''}>${d}</div>
            <div>
              <div class="search-dow">${DN[dow]}요일${isToday?` <span class="today-label">오늘</span>`:''}</div>
              ${type&&c?`<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span>`:''}
              ${alarm.memo?`<div style="font-size:11px;color:#888;margin-top:2px">📝 ${esc(alarm.memo)}</div>`:''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${alarm.alarm?'<span>🔔</span>':''}${cc?`<span class="cmt-cnt">${cc}개</span>`:''}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:#ddd"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
        </div>`;
      }).join(''):'<p class="empty-state">이 달에 근무 일정이 없습니다.</p>'}
    </div>`;
  el.innerHTML=html;
}
function selectMyMonth(y,m){myShiftYear=y;myShiftMonth=m;renderMyShift();}
function viewDayInCal(y,m0,d){curY=y;curM=m0;switchTab('cal',$('btn-cal'));renderCalendar();setTimeout(()=>openDayModal(d),50);}

// ══════════════════════════════════════════════════
//  검색 탭
// ══════════════════════════════════════════════════
function renderSearchFilters(){
  const years=[...new Set(Object.keys(allSchedules).map(Number))].sort((a,b)=>b-a);
  const allNames=new Set();Object.values(allSchedules).forEach(ym=>Object.values(ym).forEach(d=>Object.keys(d).forEach(n=>allNames.add(n))));
  const names=[...allNames].sort();
  $('search-filters').innerHTML=`
    <div class="filter-row"><div class="filter-label">연도</div><div class="filter-chips"><button class="filter-chip${srchYear===0?' active':''}" onclick="setSrch('y',0)">전체</button>${years.map(y=>`<button class="filter-chip${srchYear===y?' active':''}" onclick="setSrch('y',${y})">${y}년</button>`).join('')}</div></div>
    <div class="filter-row"><div class="filter-label">월</div><div class="filter-chips"><button class="filter-chip${srchMonth===0?' active':''}" onclick="setSrch('m',0)">전체</button>${[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<button class="filter-chip${srchMonth===m?' active':''}" onclick="setSrch('m',${m})">${m}월</button>`).join('')}</div></div>
    <div class="filter-row"><div class="filter-label">이름</div>
      <div class="search-bar-wrap"><input id="search-input" class="search-input" placeholder="이름 입력 또는 선택" value="${esc(srchName)}" oninput="srchName=this.value;renderSearchResult()">${srchName?`<button class="search-clear-btn" onclick="setSrch('n','')">✕</button>`:''}</div>
      <div class="filter-chips" style="margin-top:6px">${names.map(n=>`<button class="filter-chip${srchName===n?' active':''}" onclick="setSrch('n','${esc(n)}')">${n}</button>`).join('')}</div>
    </div>`;
}
function setSrch(key,v2){if(key==='y')srchYear=v2;else if(key==='m')srchMonth=v2;else{srchName=v2;const inp=$('search-input');if(inp)inp.value=v2;}renderSearchFilters();renderSearchResult();}
function renderSearchResult(){
  const el=$('search-result'),MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],DN=['일','월','화','수','목','금','토'],now=new Date();
  const monthList=[];Object.entries(allSchedules).forEach(([y,ym])=>{if(srchYear&&parseInt(y)!==srchYear)return;Object.entries(ym).forEach(([m,d])=>{if(srchMonth&&parseInt(m)!==srchMonth)return;monthList.push({y:parseInt(y),m:parseInt(m),d});});});
  monthList.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);
  if(!monthList.length){el.innerHTML='<p class="empty-state">해당 기간에 근무표가 없습니다.</p>';return;}
  const nf=srchName.trim(),cumCount={};let cumTotal=0;
  monthList.forEach(({d})=>{const targets=nf?(d[nf]?{[nf]:d[nf]}:{}):d;Object.values(targets).forEach(wd=>{Object.values(wd||{}).forEach(t=>{cumCount[t]=(cumCount[t]||0)+1;cumTotal++;});});});
  let html='';
  if(Object.keys(cumCount).length) html+=`<div class="stat-section-card"><div class="stat-section-title">${srchYear||'전체'}년 ${srchMonth?srchMonth+'월':'전체'} · ${nf||'전체'} 집계 (${cumTotal}건)</div><div class="type-stat-grid">${Object.entries(cumCount).sort((a,b)=>b[1]-a[1]).map(([type,cnt])=>{const c=tc(type);return`<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}"><div class="type-stat-name" style="color:${c.text}">${type}</div><div class="type-stat-big" style="color:${c.dot}">${cnt}</div><div class="type-stat-sub" style="color:${c.text}">회</div></div>`;}).join('')}</div></div>`;
  monthList.forEach(({y,m,d})=>{
    const targets=nf?(d[nf]?{[nf]:d[nf]}:{}):d;
    const entries=Object.entries(targets).flatMap(([name,wd])=>Object.entries(wd||{}).map(([day,type])=>({name,day:parseInt(day),type}))).sort((a,b)=>a.day-b.day);
    if(!entries.length)return;
    html+=`<div class="list-section-title">${y}년 ${MN[m]} (${entries.length}건)</div>`;
    html+=entries.map(({name,day,type})=>{const c=tc(type),dow=new Date(y,m-1,day).getDay(),key=`${y}-${m}-${day}`,cc=(shiftComments[key]||[]).length,past=new Date(y,m-1,day)<new Date(now.getFullYear(),now.getMonth(),now.getDate());return`<div class="list-card${past?' past':''}" onclick="viewDayInCal(${y},${m-1},${day})"><div class="list-card-header"><div><span class="list-date">${MN[m]} ${day}일 <span class="list-dow">${DN[dow]}</span></span>${!nf?`<span style="font-size:12px;color:#888;margin-left:6px">${name}</span>`:''}</div><div style="display:flex;gap:6px;align-items:center">${cc?`<span class="cmt-cnt">${cc}개</span>`:''}<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span></div></div></div>`;}).join('');
  });
  el.innerHTML=html||'<p class="empty-state">조건에 맞는 근무 기록이 없습니다.</p>';
}

// ══════════════════════════════════════════════════
//  공지
// ══════════════════════════════════════════════════
function renderNotices(){
  const el=$('notice-list');
  if(!notices.length){el.innerHTML='<p class="empty-state">등록된 공지가 없습니다.</p>';return;}
  el.innerHTML=notices.map(n=>`
    <div class="notice-card${n.is_unread?' unread':''}" id="nc-${n.id}">
      <div onclick="toggleNotice(${n.id})">
        ${n.is_unread?`<span class="new-badge">NEW</span>`:''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <div class="n-title">${esc(n.title)}</div>
          ${isAdmin()?`<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px" onclick="event.stopPropagation()">
            <button class="n-action-btn" onclick="editNotice(${n.id})">수정</button>
            <button class="n-action-btn del" onclick="deleteNotice(${n.id})">삭제</button>
          </div>`:''}
        </div>
        <div class="n-meta">${fmtDate(n.created_at)}</div>
        <div class="n-body">${esc(n.body)}</div>
      </div>
    </div>`).join('');
  updateNoticeBadge();
}

function toggleNotice(id){
  const el=$(`nc-${id}`); if(!el) return;
  el.classList.toggle('open');
  const n=notices.find(x=>x.id===id);
  if(n && n.is_unread){
    n.is_unread=false;
    el.querySelector('.new-badge')?.remove();
    el.classList.remove('unread');
    updateNoticeBadge();
    // ★ DB에 읽음 기록 저장
    if(!OFFLINE) sb.from('notice_reads').upsert({notice_id:id, user_id:cu.id});
  }
}

function updateNoticeBadge(){
  const cnt=notices.filter(n=>n.is_unread).length;
  let b=$('btn-notice').querySelector('.nav-badge');
  if(cnt>0){if(!b){b=document.createElement('div');b.className='nav-badge';$('btn-notice').appendChild(b);}b.textContent=cnt;}
  else b?.remove();
}

// ★ 공지 탭 진입 시 모두 읽음 처리 (clearNoticeBadge 개선)
function clearNoticeBadge(){
  const unread = notices.filter(n => n.is_unread);
  if (!unread.length) return;

  // 로컬 상태 즉시 업데이트
  unread.forEach(n => {
    n.is_unread = false;
    const el = $(`nc-${n.id}`);
    if (el) { el.classList.remove('unread'); el.querySelector('.new-badge')?.remove(); }
  });
  updateNoticeBadge();

  // DB에 일괄 읽음 저장 (각각 개별 upsert → 하나라도 실패해도 나머지 저장)
  if (!OFFLINE && cu?.id) {
    unread.forEach(n => {
      sb.from('notice_reads')
        .upsert({ notice_id: n.id, user_id: cu.id }, { onConflict: 'notice_id,user_id' })
        .then(({ error }) => { if (error) console.warn('notice_reads upsert error:', error.message); });
    });
  }
}

// ★ 관리자: 공지 수정
function editNotice(id){
  const n=notices.find(x=>x.id===id); if(!n) return;
  const newTitle=prompt('제목 수정:', n.title); if(newTitle===null) return;
  const newBody=prompt('내용 수정:', n.body); if(newBody===null) return;
  if(!newTitle.trim()||!newBody.trim()) return showToastMsg('제목과 내용을 입력해주세요.');
  n.title=newTitle.trim(); n.body=newBody.trim();
  if(!OFFLINE) sb.from('notices').update({title:n.title,body:n.body}).eq('id',id);
  renderNotices();
  showToastMsg('공지가 수정되었습니다.');
}

// ★ 관리자: 공지 삭제
async function deleteNotice(id){
  if(!confirm('이 공지를 삭제하시겠습니까?')) return;
  notices=notices.filter(n=>n.id!==id);
  if(!OFFLINE) await sb.from('notices').delete().eq('id',id);
  renderNotices();
  showToastMsg('공지가 삭제되었습니다.');
}

// ══════════════════════════════════════════════════
//  피드
// ══════════════════════════════════════════════════
async function submitFeed(){const txt=$('feed-input').value.trim();const errEl=$('feed-err'),okEl=$('feed-ok');errEl.style.display='none';okEl.style.display='none';if(!txt)return showErr(errEl,'내용을 입력해주세요.');const post={id:Date.now(),user_id:cu.id,author_name:cu.name,content:txt,admin_reply:null,created_at:new Date().toISOString()};if(!OFFLINE){const{data}=await sb.from('feed_posts').insert({user_id:cu.id,content:txt,is_private:true}).select('*').single();if(data){post.id=data.id;post.created_at=data.created_at;}}feedPosts.unshift(post);$('feed-input').value='';okEl.textContent='전송되었습니다.';okEl.style.display='block';setTimeout(()=>okEl.style.display='none',3000);renderMyFeed();}
function renderMyFeed(){const mp=feedPosts.filter(p=>p.user_id===cu.id),el=$('feed-list');if(!mp.length){el.innerHTML='<p class="empty-state">전송된 피드가 없습니다.</p>';return;}el.innerHTML=mp.map(p=>`<div class="feed-card"><div class="feed-content">${esc(p.content)}</div><div class="feed-time">${fmtDate(p.created_at)}</div>${p.admin_reply?`<div class="feed-reply"><div class="feed-reply-label">관리자 답변</div>${esc(p.admin_reply)}</div>`:`<div class="feed-pending">답변 대기 중...</div>`}</div>`).join('');}

// ══════════════════════════════════════════════════
//  관리자
// ══════════════════════════════════════════════════
function renderAdmin(){renderPending();renderMembers();buildSchedPreview();renderAdminFeed();updatePendingBadge();}
function updatePendingBadge(){const cnt=(window._pending||[]).length;let b=$('btn-admin').querySelector('.nav-badge');if(cnt>0){if(!b){b=document.createElement('div');b.className='nav-badge';$('btn-admin').appendChild(b);}b.textContent=cnt;}else b?.remove();}
function renderPending(){if(OFFLINE){$('pending-list').innerHTML='<p class="empty-state">오프라인 모드</p>';return;}const pending=window._pending||[];$('pending-badge').innerHTML=pending.length?`<span class="cnt-badge">${pending.length}</span>`:'';const el=$('pending-list');if(!pending.length){el.innerHTML='<p class="empty-state">대기 중인 신청이 없습니다.</p>';return;}el.innerHTML=pending.map(u=>{const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[u.name]));return`<div class="member-row" onclick="openMemberModal(${u.id})"><div class="member-av">${u.name[0]}</div><div class="member-info"><div class="m-name">${u.name}${inS?` <span class="sched-match-tag">근무표 있음</span>`:''}</div><div class="m-sub">연락처: ${u.phone} · 생년월일: ${u.birth}</div></div><div class="m-actions" onclick="event.stopPropagation()"><button class="act-btn approve" onclick="approveUser(${u.id})">승인</button><button class="act-btn reject" onclick="rejectUser(${u.id})">거절</button></div></div>`;}).join('');}
function renderMembers(){const el=$('member-list');if(!allMembers.length){el.innerHTML='<p class="empty-state">승인된 회원이 없습니다.</p>';return;}el.innerHTML=allMembers.map((u,i)=>{const rl=u.role==='superadmin'?'최고관리자':u.role==='admin'?'관리자':'직원';const total=Object.values(allSchedules).reduce((s,ym)=>s+Object.values(ym).reduce((s2,d)=>s2+Object.keys(d[u.name]||{}).length,0),0);const c=PALETTE[i%PALETTE.length];return`<div class="member-row" onclick="openMemberModal(${u.id})"><div class="member-av" style="background:${c.bg};color:${c.text}">${u.name[0]}</div><div class="member-info"><div class="m-name">${u.name} <span class="role-tag">${rl}</span></div><div class="m-sub">연락처: ${u.phone} · 전체 ${total}건</div></div><svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:#ddd;flex-shrink:0"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>`;}).join('');}
function openMemberModal(id){
  const u=allMembers.find(x=>x.id===id)||(window._pending||[]).find(x=>x.id===id);if(!u)return;
  const rl=u.role==='superadmin'?'최고관리자':u.role==='admin'?'관리자':'직원';
  const sl=u.status==='approved'?'승인됨':u.status==='pending'?'가입 대기':'거절됨';
  const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[u.name]));
  let act='';
  if(isAdmin()&&u.id!==cu.id){
    if(u.status==='pending'){act=`<button class="detail-btn promote" onclick="approveUser(${u.id});closeModalById('member-modal')">승인</button><button class="detail-btn reject-btn" onclick="rejectUser(${u.id});closeModalById('member-modal')">거절</button>`;}
    else{if(u.role==='employee')act+=`<button class="detail-btn promote" onclick="changeRole(${u.id},'admin');openMemberModal(${u.id})">관리자 지정</button>`;if(u.role==='admin')act+=`<button class="detail-btn demote" onclick="changeRole(${u.id},'employee');openMemberModal(${u.id})">직원으로 변경</button>`;if(u.role!=='superadmin')act+=`<button class="detail-btn reject-btn" onclick="if(confirm('삭제?')){removeUser(${u.id});closeModalById('member-modal')}">삭제</button>`;}
  }
  // ★ 메모 섹션: 관리자만 열람 가능
  const memoSection = isAdmin()
    ? `<div style="margin-top:10px">
        <div style="font-size:12px;font-weight:600;color:#888;margin-bottom:5px">
          관리자 메모 <span style="font-size:10px;color:#bbb;font-weight:400;background:#f5f5f0;padding:2px 6px;border-radius:4px;margin-left:4px">관리자만 열람</span>
        </div>
        <textarea class="memo-area" id="memo-${u.id}">${u.memo||''}</textarea>
        <button class="save-memo-btn" onclick="saveMemo(${u.id})">메모 저장</button>
      </div>
      <div class="detail-actions">${act}</div>`
    : (act ? `<div class="detail-actions">${act}</div>` : '');

  $('member-modal-body').innerHTML=`
    <div class="member-detail-top">
      <div class="member-av-lg">${u.name[0]}</div>
      <div><div style="font-size:19px;font-weight:700">${u.name}</div>
        <div style="font-size:13px;color:#888;margin-top:2px">${rl} · ${sl}</div>
        ${inS?'<span class="sched-match-tag" style="margin-top:4px;display:inline-block">근무표 등록됨</span>':''}
      </div>
    </div>
    <div class="detail-table">
      <div class="detail-row"><span>연락처 뒷자리</span><span>${u.phone}</span></div>
      <div class="detail-row"><span>생년월일</span><span>${u.birth}</span></div>
      <div class="detail-row"><span>가입일</span><span>${fmtDate(u.created_at)}</span></div>
    </div>
    ${memoSection}`;
  $('member-modal').style.display='flex';
}
async function saveMemo(uid){const memo=$(`memo-${uid}`)?.value||'';const u=allMembers.find(x=>x.id===uid);if(!u)return;u.memo=memo;if(!OFFLINE)await sb.from('app_users').update({memo}).eq('id',uid);showToastMsg('저장되었습니다.');}
async function approveUser(id){if(!OFFLINE)await sb.from('app_users').update({status:'approved'}).eq('id',id);window._pending=(window._pending||[]).filter(u=>u.id!==id);const{data}=await sb.from('app_users').select('*');if(data){allMembers=data.filter(u=>u.status==='approved');window._pending=data.filter(u=>u.status==='pending');}renderAdmin();}
async function rejectUser(id){if(!OFFLINE)await sb.from('app_users').update({status:'rejected'}).eq('id',id);window._pending=(window._pending||[]).filter(u=>u.id!==id);renderPending();}
async function changeRole(id,role){const u=allMembers.find(x=>x.id===id);if(!u)return;u.role=role;if(!OFFLINE)await sb.from('app_users').update({role}).eq('id',id);renderMembers();}
async function removeUser(id){allMembers=allMembers.filter(x=>x.id!==id);if(!OFFLINE)await sb.from('app_users').delete().eq('id',id);renderAdmin();}
function renderAdminFeed(){
  const el=$('admin-feed-list');
  if(!feedPosts.length){el.innerHTML='<p class="empty-state">피드가 없습니다.</p>';return;}
  el.innerHTML=feedPosts.map(p=>`
    <div class="feed-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <div class="feed-author">${esc(p.author_name||'직원')}</div>
        <div style="display:flex;gap:6px">
          <button class="n-action-btn del" onclick="deleteFeedPost(${p.id})">삭제</button>
        </div>
      </div>
      <div class="feed-content">${esc(p.content)}</div>
      <div class="feed-time">${fmtDate(p.created_at)}</div>
      ${p.admin_reply
        ? `<div class="feed-reply">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <div class="feed-reply-label">답변 완료</div>
              <button class="n-action-btn del" onclick="deleteReply(${p.id})">답변 삭제</button>
            </div>
            ${esc(p.admin_reply)}
           </div>`
        : `<div class="reply-wrap">
            <input id="ar-${p.id}" class="reply-input" placeholder="답변 입력...">
            <button class="reply-btn" onclick="sendReply(${p.id})">답변 전송</button>
           </div>`}
    </div>`).join('');
}
async function sendReply(postId){const input=$(`ar-${postId}`);const txt=input?.value.trim();if(!txt)return showToastMsg('답변 내용을 입력해주세요.');const p=feedPosts.find(x=>x.id===postId);if(!p)return;p.admin_reply=txt;if(!OFFLINE)await sb.from('feed_posts').update({admin_reply:txt,replied_at:new Date().toISOString()}).eq('id',postId);renderAdminFeed();}
// ★ 관리자: 피드 삭제
async function deleteFeedPost(id){
  if(!confirm('이 피드를 삭제하시겠습니까?')) return;
  feedPosts=feedPosts.filter(p=>p.id!==id);
  if(!OFFLINE) await sb.from('feed_posts').delete().eq('id',id);
  renderAdminFeed();
}
// ★ 관리자: 답변 삭제
async function deleteReply(postId){
  if(!confirm('답변을 삭제하시겠습니까?')) return;
  const p=feedPosts.find(x=>x.id===postId); if(!p) return;
  p.admin_reply=null;
  if(!OFFLINE) await sb.from('feed_posts').update({admin_reply:null,replied_at:null}).eq('id',postId);
  renderAdminFeed();
}
async function postNotice(){
  const title=val('n-title'),body=val('n-body');
  if(!title||!body) return;
  const n={id:Date.now(),title,body,created_at:new Date().toISOString(),is_unread:false}; // 관리자 본인은 읽음
  if(!OFFLINE){
    const{data}=await sb.from('notices').insert({title,body,created_by:cu.id}).select('*').single();
    if(data){
      n.id=data.id; n.created_at=data.created_at;
      // 관리자 본인 읽음 처리
      await sb.from('notice_reads').upsert({notice_id:n.id, user_id:cu.id});
    }
  }
  notices.unshift(n);
  renderNotices();
  $('n-title').value=''; $('n-body').value='';
  toast('notice-toast');
}

// ══════════════════════════════════════════════════
//  엑셀 업로드
// ══════════════════════════════════════════════════
function dragOver(e){e.preventDefault();$('upload-zone').classList.add('drag');}
function dragLeave(){$('upload-zone').classList.remove('drag');}
function dropFile(e){e.preventDefault();$('upload-zone').classList.remove('drag');parseExcelFile(e.dataTransfer.files[0]);}
function handleExcelFile(inp){const f=inp.files[0];if(f)parseExcelFile(f);inp.value='';}
function parseExcelFile(file){const reader=new FileReader();reader.onload=e=>{try{const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});// 형식 자동 감지: 1행에 '이름'이 있으면 기존 형식, 없으면 새 형식
    const header=rows[0]||[];const hasNameCol=header.some(h=>h&&String(h).trim()==='이름');
    if(hasNameCol){processExcelRows(rows,file.name,wb.SheetNames[0]);}
    else{processExcelRows2(rows,file.name,wb.SheetNames[0]);}
  }catch(err){showExcelErr('파일 읽기 오류: '+err.message);}};reader.readAsArrayBuffer(file);}

// ★ 새 형식 파서: 날짜가 열, 이름이 셀값인 형식
// 구조: 날짜행(5월 4일...) + 근무행(설교: 이름, 방송실: 이름...)
function processExcelRows2(rows, fileName, sheetName){
  // 연월 파싱
  let year=curY, month=curM+1;
  const ymM=(sheetName+' '+fileName).match(/(\d{4})[년\s_-]*(\d{1,2})[월]/);
  if(ymM){year=parseInt(ymM[1]);month=parseInt(ymM[2]);}

  // 날짜 파싱 헬퍼: "5월 4일" → 4
  function parseDay(str){
    if(!str) return null;
    const m=String(str).match(/(\d{1,2})[월]\s*(\d{1,2})[일]/);
    if(m) return parseInt(m[2]);
    const m2=String(str).match(/(\d{1,2})[일]/);
    if(m2) return parseInt(m2[1]);
    return null;
  }

  // 이름 파싱: "안종훈\n(김동권)" → 메인: "안종훈", 백업: "김동권"
  function parseNames(str){
    if(!str) return [];
    const s = String(str).trim();
    const results = [];
    // \n 으로 분리
    const parts = s.split(/\n/);
    parts.forEach(part => {
      part = part.trim();
      if(!part) return;
      // 괄호 안에 있으면 백업
      const backupMatch = part.match(/^[（(](.+)[)）]$/);
      if(backupMatch){
        const name = backupMatch[1].trim();
        if(name) results.push({name, isBackup: true});
      } else {
        // 괄호가 포함된 경우: "안종훈(김동권)"
        const inlineBackup = part.match(/^([^（(]+)[（(]([^)）]+)[)）]$/);
        if(inlineBackup){
          const main = inlineBackup[1].trim();
          const backup = inlineBackup[2].trim();
          if(main) results.push({name: main, isBackup: false});
          if(backup) results.push({name: backup, isBackup: true});
        } else {
          results.push({name: part, isBackup: false});
        }
      }
    });
    return results.filter(r => r.name.length >= 2);
  }

  const result={};
  const types=new Set();
  let i=0;

  while(i<rows.length){
    const row=rows[i];
    if(!row||row.every(v=>v==null)){i++;continue;}

    // 날짜행 감지: 셀 중에 "X월 X일" 패턴이 있으면
    const dateCols=[];
    row.forEach((cell,colIdx)=>{
      const day=parseDay(cell);
      if(day) dateCols.push({colIdx,day});
    });

    if(dateCols.length>0){
      // 날짜행 발견 → 다음 행들이 근무행
      let j=i+1;
      while(j<rows.length){
        const shiftRow=rows[j];
        if(!shiftRow||shiftRow.every(v=>v==null)){j++;break;}
        // 첫 셀이 근무유형인지 확인
        const shiftType=shiftRow[0]?String(shiftRow[0]).trim():'';
        if(!shiftType){j++;break;}
        // 날짜행이 다시 나오면 중단
        const isDateRow=shiftRow.some(cell=>parseDay(cell)!==null);
        if(isDateRow) break;

        // 각 날짜 열에서 이름 추출
        dateCols.forEach(({colIdx,day})=>{
          const cell=shiftRow[colIdx];
          const persons=parseNames(cell);
          persons.forEach(({name,isBackup})=>{
            if(!name||name.length<2) return;
            if(!result[name]) result[name]={};
            const dayStr=String(day);
            const typeLabel=isBackup?`[백업]${shiftType}`:`[새벽]${shiftType}`;
            // 기존 값 있으면 /로 합치기
            if(result[name][dayStr]){
              if(!result[name][dayStr].includes(typeLabel))
                result[name][dayStr]+='/'+typeLabel;
            } else {
              result[name][dayStr]=typeLabel;
            }
            types.add(typeLabel);
          });
        });
        j++;
      }
      i=j;
    } else {
      i++;
    }
  }

  const names=Object.keys(result);
  if(!names.length){showExcelErr('근무자 데이터를 찾을 수 없습니다. 파일 형식을 확인해주세요.');return;}

  parsedExcel={year,month,data:result};
  assignColors([...types]);

  // 미리보기
  $('upload-zone').style.display='none';$('excel-preview').style.display='block';
  $('excel-info').textContent=`${year}년 ${month}월 · 근무자 ${names.length}명 · 유형 ${types.size}종`;
  const days=[...new Set(names.flatMap(n=>Object.keys(result[n]).map(Number)))].sort((a,b)=>a-b);
  let th='<tr><th>이름</th>';days.forEach(d=>th+=`<th>${d}</th>`);th+='</tr>';
  const tb=names.map(name=>{const dd=result[name];let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap">${name}</td>`;days.forEach(d=>{const v=dd[String(d)]||'';const c=v?tc(v.split('/')[0]):null;r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600"`:''} title="${v}">${v?v.replace(/[\[\]]/g,'').slice(0,6):''}</td>`;});return r+'</tr>';}).join('');
  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>근무자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...types].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
}
function processExcelRows(rows,fileName,sheetName){
  if(!rows||rows.length<2){showExcelErr('데이터가 없습니다.');return;}
  let year=curY,month=curM+1;
  const ymM=(sheetName+' '+fileName).match(/(\d{4})[년\s_-]*(\d{1,2})[월]/);
  if(ymM){year=parseInt(ymM[1]);month=parseInt(ymM[2]);}
  const header=rows[0],nameCol=header.findIndex(h=>h&&String(h).trim()==='이름');if(nameCol<0){showExcelErr('"이름" 열을 찾을 수 없습니다.');return;}
  const dateCols=[];header.forEach((h,i)=>{if(i===nameCol||h==null)return;const m=String(h).match(/^(\d{1,2})/);if(m){const d=parseInt(m[1]);if(d>=1&&d<=31)dateCols.push({i,d});}});
  if(!dateCols.length){showExcelErr('날짜 열을 찾을 수 없습니다.');return;}
  const result={},types=new Set();
  rows.slice(1).forEach(row=>{if(!row||row.every(v=>v==null))return;const name=String(row[nameCol]||'').trim();if(!name)return;result[name]={};dateCols.forEach(({i,d})=>{const v=row[i];if(v==null||v==='')return;const t=String(v).trim();if(t){result[name][String(d)]=t;types.add(t);}});});
  const names=Object.keys(result);if(!names.length){showExcelErr('근무자 데이터를 찾을 수 없습니다.');return;}
  parsedExcel={year,month,data:result};assignColors([...types]);
  $('upload-zone').style.display='none';$('excel-preview').style.display='block';
  $('excel-info').textContent=`${year}년 ${month}월 · 근무자 ${names.length}명 · 유형 ${types.size}종`;
  let th='<tr><th>이름</th>';dateCols.forEach(({d})=>th+=`<th>${d}</th>`);th+='</tr>';
  const tb=names.map(name=>{const dd=result[name];let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap">${name}</td>`;dateCols.forEach(({d})=>{const v=dd[String(d)]||'';const c=v?tc(v):null;r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600"`:''} title="${v}">${v?v.replace(/[\[\]]/g,'').slice(0,4):''}</td>`;});return r+'</tr>';}).join('');
  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>근무자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...types].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
}
function showExcelErr(msg){clearExcel();const t=$('excel-err-toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',5000);}
function clearExcel(){parsedExcel=null;$('upload-zone').style.display='block';$('excel-preview').style.display='none';$('excel-err-toast').style.display='none';}
async function applyExcelSchedule(){
  if(!parsedExcel)return;
  const{year,month,data}=parsedExcel;
  const isMerge=$('merge-mode')?.checked;

  if(!allSchedules[year]) allSchedules[year]={};

  let finalData;
  if(isMerge){
    // 병합 모드: 기존 데이터와 합치기
    const existing=allSchedules[year][month]||{};
    finalData={...existing};
    Object.entries(data).forEach(([name,days])=>{
      if(!finalData[name]) finalData[name]={};
      Object.entries(days).forEach(([day,type])=>{
        if(finalData[name][day]){
          if(!finalData[name][day].includes(type))
            finalData[name][day]+='/'+type;
        } else {
          finalData[name][day]=type;
        }
      });
    });
  } else {
    // 덮어쓰기 모드: 새 데이터로 완전 교체
    finalData=data;
  }

  allSchedules[year][month]=finalData;
  assignColors(collectAllTypes());filterType='';curY=year;curM=month-1;

  if(!OFFLINE){
    const{error}=await sb.from('schedules').upsert(
      {year,month,data:finalData,updated_by:cu.id,updated_at:new Date().toISOString()},
      {onConflict:'year,month'}
    );
    if(error){showExcelErr('저장 오류: '+error.message);return;}
    await refreshSchedules();
  }
  clearExcel();switchTab('cal',$('btn-cal'));renderCalendar();buildSchedPreview();toast('excel-toast');
}
function buildSchedPreview(){
  const el=$('sched-form'),allMonths=[];Object.entries(allSchedules).forEach(([y,ym])=>Object.keys(ym).forEach(m=>allMonths.push({y:parseInt(y),m:parseInt(m)})));
  allMonths.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);if(!allMonths.length){el.innerHTML='<p class="empty-state">업로드된 근무표가 없습니다.</p>';return;}
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];let html='';
  allMonths.forEach(({y,m})=>{const d=getMonthData(y,m),names=Object.keys(d);html+=`<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:#185FA5;margin-bottom:6px">${y}년 ${MN[m]}</div>`;html+=names.map(name=>{const wd=d[name]||{},days=Object.keys(wd).map(Number).sort((a,b)=>a-b),approved=allMembers.some(u=>u.name===name);return`<div class="sched-preview-row"><span class="sched-name">${name}${!approved?` <span class="unregistered-tag">미가입</span>`:''}</span><span class="sched-days">${days.map(d2=>{const t=wd[String(d2)],c=t?tc(t):null;return c?`<span class="day-chip" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}" title="${t}">${d2}</span>`:`<span class="day-chip">${d2}</span>`;}).join('')}</span></div>`;}).join('');html+='</div>';});
  el.innerHTML=html;
}

// ══════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');}
function $(id){return document.getElementById(id);}
function val(id){return($(id)?.value||'').trim();}
function hide(id){const e=$(id);if(e)e.style.display='none';}
function showErr(el,msg){if(el){el.textContent=msg;el.style.display='block';}}
function toast(id){const e=$(id);if(!e)return;e.style.display='block';setTimeout(()=>e.style.display='none',3000);}
function showToastMsg(msg){let el=$('g-toast');if(!el){el=document.createElement('div');el.id='g-toast';el.style.cssText='position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(26,26,24,.9);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;z-index:999;opacity:0;transition:opacity .2s;white-space:nowrap;pointer-events:none';document.body.appendChild(el);}el.textContent=msg;el.style.opacity='1';setTimeout(()=>el.style.opacity='0',2500);}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(s){if(!s)return'';try{const d=new Date(s);return`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;}catch{return'';}}
