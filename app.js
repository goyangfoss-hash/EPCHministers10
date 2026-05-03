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
let calView = 'all', filterType = '', pollTimer = null, rtChannel = null;
let calTeamView = false; // 내 팀 보기

function toggleMyTeamView(){
  calTeamView = !calTeamView;
  if(calTeamView) calView='all';
  const btn=$('btn-my-team');
  const minBtn=$('btn-my-ministry');
  if(btn){ btn.classList.toggle('active', calTeamView); btn.textContent=calTeamView?'👥 내 팀 보기 ✓':'👥 내 팀 보기'; }
  if(calTeamView&&minBtn) minBtn.classList.remove('active');
  renderCalendar();
}
let allSchedules = {};
let currentUploadType = 'regular'; // 'regular' | 'special'
let scheduleTypes = {}; // {year: {month: 'regular'|'special'}}
const getMonthData = (y, m) => allSchedules[y]?.[m] || {};
const curData = () => getMonthData(curY, curM + 1);
let allMembers = [], notices = [], feedPosts = [];
let shiftComments = {}, commentLikes = {}, modalDate = null, parsedExcel = null;
let myShiftYear = new Date().getFullYear(), myShiftMonth = new Date().getMonth() + 1;
let srchYear = 0, srchMonth = 0, srchName = '';
let myTeam = JSON.parse(localStorage.getItem('ws_my_team') || '[]'); // 내 팀 이름 배열
let srchDept = 'team'; // 검색탭 선택 파트

// 채팅 상태
let chatMessages = {};   // { userId: [messages] }
let chatTarget = null;   // 현재 채팅 상대
let dmUnreadCount = 0;

// ── 알림 & 메모 (Supabase + localStorage 이중 저장) ──
let shiftAlarms = {};

function loadAlarms(){
  try { shiftAlarms = JSON.parse(localStorage.getItem('ws_alarms') || '{}'); } catch { shiftAlarms = {}; }
}

function saveAlarms(){
  localStorage.setItem('ws_alarms', JSON.stringify(shiftAlarms));
  // ★ Supabase에도 저장 (패치 후에도 유지)
  if(sb && cu?.id){
    sb.from('app_users')
      .update({ alarm_settings: shiftAlarms })
      .eq('id', cu.id)
      .then(({error}) => { if(error) console.warn('알림 설정 저장 실패:', error.message); });
  }
}

async function loadAlarmsFromServer(){
  // Supabase에서 알림 설정 불러오기
  if(!sb || !cu?.id) return;
  try {
    const { data } = await sb.from('app_users').select('alarm_settings').eq('id', cu.id).single();
    if(data?.alarm_settings && Object.keys(data.alarm_settings).length > 0){
      // 서버 설정을 로컬보다 우선 적용
      shiftAlarms = data.alarm_settings;
      localStorage.setItem('ws_alarms', JSON.stringify(shiftAlarms));
      updateAlarmBadge();
    }
  } catch(e){ console.warn('알림 설정 불러오기 실패:', e.message); }
}

function getDefaultAlarmTime(){ try{ return JSON.parse(localStorage.getItem('ws_notif_settings')||'{}').defaultAlarmTime||'18:30'; }catch{ return '18:30'; } }
function getAlarm(y,m,d) { return shiftAlarms[`${y}-${m}-${d}`] || { alarm: true, alarmTime: getDefaultAlarmTime(), memo: '' }; }
function setAlarm(y,m,d,data) { shiftAlarms[`${y}-${m}-${d}`] = data; saveAlarms(); }
function activeAlarmCount() {
  if(!cu) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // ★ 본인 사역 날짜만 카운트
  const myDates = new Set();
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myData = data[cu.name]||{};
      Object.keys(myData).forEach(ds=>{
        const d=parseInt(ds);
        const dt=new Date(parseInt(y),parseInt(m)-1,d);
        if(dt>=today) myDates.add(`${y}-${m}-${d}`);
      });
    });
  });

  // 본인 사역 날짜 중 알람 ON인 것만 카운트
  return [...myDates].filter(k=>{
    const v=shiftAlarms[k];
    return v?.alarm === true;
  }).length;
}

// ★ 로그인 후 본인 사역 알림 자동 설정
// - 명시적으로 해제한 알림은 유지
// - 새로 추가된 사역는 자동 ON
function autoSetMyShiftAlarms(){
  const defaultTime = getDefaultAlarmTime();
  const now = new Date();
  let newCount = 0;
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myData = data[cu?.name]||{};
      Object.keys(myData).forEach(ds=>{
        const d=parseInt(ds);
        const dt=new Date(parseInt(y),parseInt(m)-1,d);
        if(dt < new Date(now.getFullYear(),now.getMonth(),now.getDate())) return;
        const key=`${y}-${m}-${d}`;
        // 아직 설정된 적 없는 날만 자동 ON (명시적으로 끈 건 유지)
        if(!shiftAlarms[key]){
          shiftAlarms[key]={ alarm: true, alarmTime: defaultTime, memo: '' };
          newCount++;
        }
      });
    });
  });
  if(newCount>0){ saveAlarms(); updateAlarmBadge(); scheduleLocalAlarms(); }
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
function assignColors(types){ (types||[]).forEach(t=>{if(t&&!typeColorMap[t])typeColorMap[t]=getTypeColor(t);}); }
function resetTypeColors(){ typeColorMap={}; assignColors(collectAllTypes()); }
const tc = t => typeColorMap[t] || getTypeColor(t);
function collectAllTypes(){ const s=new Set(); Object.values(allSchedules).forEach(ym=>Object.values(ym).forEach(nm=>Object.values(nm).forEach(dm=>Object.values(dm).forEach(t=>t&&s.add(t))))); return[...s]; }

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
//  당겨서 새로고침 (Pull to Refresh)
// ══════════════════════════════════════════════════
function initPullToRefresh(){
  let startY=0, pulling=false, indicator=null;
  const threshold=70; // 당기는 최소 거리

  const createIndicator=()=>{
    if($('ptr-indicator')) return $('ptr-indicator');
    const el=document.createElement('div');
    el.id='ptr-indicator';
    el.style.cssText='position:fixed;top:56px;left:50%;transform:translateX(-50%);background:#185FA5;color:#fff;padding:8px 20px;border-radius:0 0 20px 20px;font-size:12px;font-weight:600;z-index:35;display:none;align-items:center;gap:8px;box-shadow:0 2px 10px rgba(0,0,0,.2)';
    el.innerHTML='<div class="ptr-spinner"></div><span id="ptr-text">당겨서 새로고침</span>';
    document.body.appendChild(el);
    return el;
  };

  document.addEventListener('touchstart', e=>{
    if(window.scrollY===0) { startY=e.touches[0].clientY; pulling=true; }
  }, {passive:true});

  document.addEventListener('touchmove', e=>{
    if(!pulling) return;
    const dist=e.touches[0].clientY - startY;
    if(dist<=0){ pulling=false; return; }
    indicator=createIndicator();
    if(dist>20){
      indicator.style.display='flex';
      $('ptr-text').textContent=dist>threshold?'놓아서 새로고침':'당겨서 새로고침';
    }
  }, {passive:true});

  document.addEventListener('touchend', async e=>{
    if(!pulling){return;}
    pulling=false;
    const dist=e.changedTouches[0].clientY - startY;
    if(dist>threshold && indicator){
      $('ptr-text').textContent='새로고침 중...';
      await refreshSchedules();
      if(cu) updateNoticeBadge();
    }
    if(indicator){ indicator.style.display='none'; }
  }, {passive:true});
}
// ══════════════════════════════════════════════════
async function refreshSchedules() {
  if (OFFLINE||!sb) return;
  try {
    const [schedRes, noticeRes, memberRes] = await Promise.all([
      sb.from('schedules').select('year,month,data,type').order('year').order('month'),
      sb.from('notices').select('*').order('created_at',{ascending:false}),
      sb.from('app_users').select('*'), // ★ 전체 (pending 포함)
    ]);
    if (schedRes.error) throw schedRes.error;

    // 스케줄 갱신
    allSchedules={};
    (schedRes.data||[]).forEach(r=>{
    const rType = r.type || 'regular';
    if(!allSchedules[r.year]) allSchedules[r.year]={};
    if(!scheduleTypes[r.year]) scheduleTypes[r.year]={};
    // ★ 같은 년월에 regular+special이 있으면 병합해서 표시
    const existing = allSchedules[r.year][r.month] || {};
    const merged = {...existing};
    Object.entries(r.data||{}).forEach(([name,days])=>{
      if(!merged[name]) merged[name]={};
      Object.entries(days||{}).forEach(([day,type])=>{
        if(merged[name][day]&&!merged[name][day].includes(type)) merged[name][day]+='/'+type;
        else merged[name][day]=type;
      });
    });
    allSchedules[r.year][r.month]=merged;
    // type별 원본 데이터 보관 (관리자용)
    if(!scheduleTypes[r.year][r.month]) scheduleTypes[r.year][r.month]={};
    scheduleTypes[r.year][r.month][rType]=r.data||{};
  });
    assignColors(collectAllTypes());

    // 공지 갱신
    if(noticeRes.data) notices = noticeRes.data;

    // 회원 갱신 (approved/pending 분리)
    if(memberRes.data){
      allMembers = memberRes.data.filter(u=>u.status==='approved');
      window._pending = memberRes.data.filter(u=>u.status==='pending');
    }

    // 알림 설정 서버 동기화
    await loadAlarmsFromServer();

    renderCalendar();
    if($('tab-myshift')?.style.display!=='none') renderMyShift();
    if($('tab-search')?.style.display!=='none') renderSearchResult();
    if($('tab-notice')?.style.display!=='none') renderNotices();
    if(isAdmin()&&$('tab-admin')?.style.display!=='none') renderAdmin();
    if(cu) autoSetMyShiftAlarms();
    updateAlarmBadge();
    updateNoticeBadge();
    if(isAdmin()) updatePendingBadge(); // ★ 가입 대기 배지 갱신
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
    if (user.status==='pending'){if(!silent){const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[name]));showErr($('l-err'),inS?`승인 대기 중입니다. 사역표에 '${name}'님의 일정이 있습니다.`:'관리자 승인 대기 중입니다.');}return false;}
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
  okEl.textContent=`'${name}'님의 가입 신청이 완료되었습니다.${inS?` 사역표에 '${name}'님의 일정이 있습니다. 관리자 승인 후 바로 확인하실 수 있습니다.`:' 관리자 승인 후 로그인 가능합니다.'}`;
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
  $('hdr-name').textContent=cu.name;
  // ★ 프로필 이미지 or 이름 첫 글자
  updateHeaderAvatar();
  $('btn-admin').style.display=isAdmin()?'flex':'none';
  assignColors(collectAllTypes());
  // 모든 이용자에게 내 사역만/전체 보기 토글 표시
  const toggleWrap=$('view-toggle-wrap');
  if(toggleWrap){
    toggleWrap.innerHTML=`
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="btn-my-ministry" onclick="toggleMyMinistry()" class="my-ministry-btn">🙋 내 사역 보기</button>
        <button id="btn-my-team" onclick="toggleMyTeamView()" class="my-ministry-btn">👥 내 팀 보기</button>
      </div>`;
  }
  renderCalendar(); renderNotices(); updateAlarmBadge();
  updateFeedBadge();
  startRealtime();
  if(!OFFLINE){
    if(pollTimer)clearInterval(pollTimer);
    pollTimer=setInterval(()=>refreshSchedules(),5*60*1000);
    // ★ 데이터 로드 완료 후 관리자 탭 렌더링
    refreshSchedules().then(()=>{
      if(isAdmin()) renderAdmin();
    });
  } else {
    if(isAdmin()) renderAdmin();
  }
  scheduleLocalAlarms();
  loadAlarmsFromServer().then(()=>{
    autoSetMyShiftAlarms();
  });
  checkNotifPermission();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
    navigator.serviceWorker.register('firebase-messaging-sw.js').catch(()=>{});
  }
  initFCM();
  initPullToRefresh(); // ★ 당겨서 새로고침
}

// ══════════════════════════════════════════════════
//  FCM 푸시 알림
// ══════════════════════════════════════════════════
const FCM_VAPID_KEY = 'BG-F2TKvkvGtQiYXLfhxPDazbmOYr-A-E4EyzE6waA5lczTpUCrMcp02Ei7R_gqb_UbEtsYbxXIcDnOS8FxsreA';

async function initFCM(){
  if(OFFLINE||!('serviceWorker' in navigator)) return;
  try {
    // Firebase 스크립트 동적 로드
    if(!window.firebase){
      await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');
      window.firebase.initializeApp({
        apiKey: "AIzaSyAQLc0H_AoD7E2JF8Tji3ZgMWAiJxQ2SPY",
        authDomain: "epchminister.firebaseapp.com",
        projectId: "epchminister",
        storageBucket: "epchminister.firebasestorage.app",
        messagingSenderId: "110307544897",
        appId: "1:110307544897:web:12e73220454bba67aedbc0"
      });
    }
    const messaging = window.firebase.messaging();
    // 알림 권한 확인
    if(Notification.permission !== 'granted') return;
    // FCM 토큰 발급
    const token = await messaging.getToken({ vapidKey: FCM_VAPID_KEY });
    if(token) await saveFCMToken(token);
    // 포그라운드 메시지 수신
    messaging.onMessage(payload=>{
      const {title, body} = payload.notification || {};
      if(title) showToastMsg(`🔔 ${title}: ${body||''}`);
    });
  } catch(e){ console.warn('FCM init error:', e.message); }
}

function loadScript(src){
  return new Promise((resolve,reject)=>{
    if(document.querySelector(`script[src="${src}"]`)){resolve();return;}
    const s=document.createElement('script');
    s.src=src; s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
}

async function saveFCMToken(token){
  try {
    // 기존 토큰 모두 삭제 후 새 토큰만 저장 (중복 방지)
    await sb.from('fcm_tokens').delete().eq('user_id', cu.id);
    await sb.from('fcm_tokens').insert({user_id: cu.id, token});
  } catch(e){ console.warn('FCM token save error:', e.message); }
}

// ★ 푸시 알림 전송 (Edge Function 호출)
async function sendPushToUsers(userIds, title, body){
  if(OFFLINE||!userIds?.length) return;
  try {
    await sb.functions.invoke('send-push', {
      body: { user_ids: userIds, title, body }
    });
  } catch(e){ console.warn('Push send error:', e.message); }
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
        showToastMsg(`${year}년 ${month}월 사역표가 업데이트되었습니다.`);
      }catch{await refreshSchedules();}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'app_users'},async(payload)=>{
      const{data}=await sb.from('app_users').select('*');
      if(data){
        allMembers=data.filter(u=>u.status==='approved');
        window._pending=data.filter(u=>u.status==='pending');
        // ★ 본인 프로필이 변경된 경우 헤더 아바타 업데이트
        const updatedMe=data.find(u=>u.id===cu?.id);
        if(updatedMe&&updatedMe.avatar!==cu?.avatar){
          cu.avatar=updatedMe.avatar;
          const img=$('hdr-profile-img');
          const av=$('hdr-avatar');
          if(img&&av){
            if(cu.avatar){img.src=cu.avatar;img.style.display='block';av.style.display='none';}
            else{img.style.display='none';av.style.display='flex';}
          }
        }
      }
      // ★ 회원 목록 즉시 갱신 (프로필 사진 포함)
      if(isAdmin()){renderAdmin();updatePendingBadge();}
      renderMembers(); // 관리자가 아니어도 소통탭 등에서 표시되는 멤버 정보 갱신
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
      if(!notices.find(x=>x.id===n.id)){notices.unshift(n);renderNotices();updateNoticeBadge();pushNotify(`새 공지: ${n.title}`,n.body,'notice');}
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'feed_posts'},payload=>{
      const idx=feedPosts.findIndex(p=>p.id===payload.new.id);
      if(idx>=0){
        const wasReplied=feedPosts[idx].admin_reply;
        feedPosts[idx]={...feedPosts[idx],...payload.new};
        // ★ 새 답변이 달렸으면 reply_read=false로 설정 (이용자에게 배지 표시)
        if(!wasReplied&&payload.new.admin_reply&&payload.new.user_id===cu.id){
          feedPosts[idx].reply_read=false;
        }
      }
      if($('tab-feed')?.style.display!=='none') renderMyFeed();
      if(isAdmin()&&$('tab-admin')?.style.display!=='none') renderAdminFeed();
      // ★ 이용자에게 배지 업데이트
      if(payload.new.admin_reply&&payload.new.user_id===cu.id){
        updateFeedBadge();
        pushNotify('관리자 답변 도착',payload.new.admin_reply);
      }
    })
    .subscribe(s=>console.log('[RT]',s));

  // ★ DM 실시간 구독 (별도 채널, 중복 방지)
  if(window._dmChannel) { try{sb.removeChannel(window._dmChannel);}catch{} }
  window._dmChannel = sb.channel('ws_dm_'+cu.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'direct_messages',filter:`to_id=eq.${cu.id}`},payload=>{
      const m=payload.new;
      const otherId=m.from_id;
      if(!chatMessages[otherId])chatMessages[otherId]=[];
      if(!chatMessages[otherId].find(x=>x.id===m.id)){
        chatMessages[otherId].push(m);
      }
      // 채팅창 열려있으면 즉시 렌더 + 읽음 처리
      if(chatTarget?.id===otherId){
        m.is_read=true;
        if(!OFFLINE) sb.from('direct_messages').update({is_read:true}).eq('id',m.id);
        renderChatMessages();
      }
      // 배지 업데이트
      updateFeedBadge();
      // 소통 탭 열려있으면 목록 갱신
      if($('tab-feed')?.style.display!=='none') renderFeedTab();
      // 알림
      const sender=allMembers.find(u=>u.id===m.from_id);
      pushNotify(`${sender?.name||'누군가'}님의 메시지`,m.content,'chat');
    }).subscribe(s=>console.log('[DM]',s));
}
function pushNotify(title, body, type=''){
  if(!canNotify(type)) return;
  try{ new Notification(title,{body,icon:'icon-192.png'}); }catch{}
}

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
        ${denied?'알림이 차단되어 있습니다.<br>브라우저 주소창 자물쇠 아이콘을 눌러<br>알림을 허용으로 변경해주세요.':unsupported?'이 브라우저는 알림을 지원하지 않습니다.<br>Chrome 앱으로 접속하면 알림을 받을 수 있습니다.':'사역 전날 알림·공지·댓글을<br>기기에서 바로 받을 수 있습니다.'}
      </div>
    </div>
    ${actionHtml}`;

  document.body.appendChild(b);
}

async function requestNotifPermission(){
  // ★ 설정 패널이 열려있으면 먼저 닫기
  const sp=$('settings-panel');
  if(sp&&sp.style.display!=='none'){sp.style.display='none';$('settings-overlay')?.remove();}
  $('notif-banner')?.remove();
  if(!('Notification'in window)) return showToastMsg('이 브라우저는 알림을 지원하지 않습니다.');
  try {
    const perm = await Notification.requestPermission();
    if(perm==='granted'){
      showToastMsg('✅ 기기 알림이 허용되었습니다!');
      updateAlarmBadge(); scheduleLocalAlarms();
      // 설정 패널 갱신
      setTimeout(()=>renderSettingsPanel(), 300);
      setTimeout(()=>pushNotify('사역표 앱 알림 설정 완료','이제 사역 전날 알림을 기기에서 받을 수 있습니다.','shift'),800);
    } else {
      showToastMsg('알림이 거부되었습니다. 브라우저 설정에서 변경할 수 있습니다.');
      localStorage.setItem('ws_notif_dismissed','1');
    }
  } catch(e) {
    showToastMsg('알림 설정 중 오류가 발생했습니다: '+e.message);
  }
}
function dismissNotifBanner(){ $('notif-banner')?.remove(); localStorage.setItem('ws_notif_dismissed','1'); }

// ── 알림 배지 (공지 미확인 + 메시지 미읽음 + 오늘/내일 사역) ──
function updateAlarmBadge(){
  const btn=$('btn-alarm'); if(!btn) return;
  const cnt = getNotifCount();
  let b=btn.querySelector('.alarm-badge');
  if(cnt>0){
    if(!b){b=document.createElement('div');b.className='alarm-badge';btn.appendChild(b);}
    b.textContent=cnt;
  } else b?.remove();
}

function getNotifCount(){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const tomorrow=new Date(today); tomorrow.setDate(tomorrow.getDate()+1);

  // ① 오늘/내일 사역 알림
  let shiftCnt=0;
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myData=data[cu?.name]||{};
      Object.entries(myData).forEach(([ds])=>{
        const d=parseInt(ds);
        const dt=new Date(parseInt(y),parseInt(m)-1,d);
        if(dt.getTime()===today.getTime()||dt.getTime()===tomorrow.getTime()) shiftCnt++;
      });
    });
  });

  // ② 미확인 공지
  const readIds=new Set(JSON.parse(localStorage.getItem('ws_read_notices')||'[]'));
  const unreadNotices=(notices||[]).filter(n=>!readIds.has(n.id)).length;

  // ③ 미읽은 DM
  const unreadDM=dmUnreadCount||0;

  return shiftCnt+unreadNotices+unreadDM;
}

function renderAlarmPanel(){
  const el=$('alarm-panel-list');
  const MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DN=['일','월','화','수','목','금','토'];
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const tomorrow=new Date(today); tomorrow.setDate(tomorrow.getDate()+1);

  let html='<div style="padding:10px 14px 6px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:500;color:var(--color-text-secondary)">알림 센터</span><button onclick="markAllRead()" style="font-size:11px;color:#185FA5;background:none;border:none;cursor:pointer">모두 읽음</button></div>';

  // ① 오늘/내일 사역
  const shiftItems=[];
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myData=data[cu?.name]||{};
      Object.entries(myData).forEach(([ds,type])=>{
        const d=parseInt(ds);
        const dt=new Date(parseInt(y),parseInt(m)-1,d);
        if(dt.getTime()===today.getTime()||dt.getTime()===tomorrow.getTime()){
          shiftItems.push({y:parseInt(y),m:parseInt(m),d,type,dt});
        }
      });
    });
  });
  shiftItems.sort((a,b)=>a.dt-b.dt);

  if(shiftItems.length){
    html+=`<div style="padding:4px 14px;font-size:10px;font-weight:500;color:var(--color-text-tertiary);letter-spacing:.5px;background:var(--color-background-secondary)">오늘/내일 사역</div>`;
    html+=shiftItems.map(({y,m,d,type,dt})=>{
      const c=tc(type);
      const isToday=dt.getTime()===today.getTime();
      const label=isToday?'오늘':'내일';
      return`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:0.5px solid var(--color-border-tertiary);background:#EAF3DE;cursor:pointer" onclick="viewDayInCal(${y},${m-1},${d});toggleAlarmPanel()">
        <div style="width:32px;height:32px;border-radius:50%;background:#FAEEDA;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">📅</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--color-text-primary)">${label} 사역</div>
          <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${m}월 ${d}일(${DN[new Date(y,m-1,d).getDay()]}) <span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:10px">${type}</span></div>
        </div>
        <div style="width:6px;height:6px;border-radius:50%;background:#639922;flex-shrink:0"></div>
      </div>`;
    }).join('');
  }

  // ② 미확인 공지
  const readIds=new Set(JSON.parse(localStorage.getItem('ws_read_notices')||'[]'));
  const unreadNotices=(notices||[]).filter(n=>!readIds.has(n.id));
  if(unreadNotices.length){
    html+=`<div style="padding:4px 14px;font-size:10px;font-weight:500;color:var(--color-text-tertiary);letter-spacing:.5px;background:var(--color-background-secondary)">새 공지</div>`;
    html+=unreadNotices.slice(0,3).map(n=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:0.5px solid var(--color-border-tertiary);background:#E6F1FB;cursor:pointer" onclick="switchTab('notice',$('btn-notice'));toggleAlarmPanel()">
        <div style="width:32px;height:32px;border-radius:50%;background:#E6F1FB;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">📢</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n.title)}</div>
          <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${fmtDate(n.created_at)}</div>
        </div>
        <div style="width:6px;height:6px;border-radius:50%;background:#185FA5;flex-shrink:0"></div>
      </div>`).join('');
  }

  // ③ 미읽은 DM
  if(dmUnreadCount>0){
    html+=`<div style="padding:4px 14px;font-size:10px;font-weight:500;color:var(--color-text-tertiary);letter-spacing:.5px;background:var(--color-background-secondary)">새 메시지</div>`;
    html+=`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:0.5px solid var(--color-border-tertiary);background:#EEEDFE;cursor:pointer" onclick="switchTab('feed',$('btn-feed'));toggleAlarmPanel()">
      <div style="width:32px;height:32px;border-radius:50%;background:#EEEDFE;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">💬</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:500;color:var(--color-text-primary)">새 메시지 ${dmUnreadCount}개</div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">소통 탭에서 확인하세요</div>
      </div>
      <div style="width:6px;height:6px;border-radius:50%;background:#534AB7;flex-shrink:0"></div>
    </div>`;
  }

  // 아무것도 없을 때
  if(!shiftItems.length&&!unreadNotices.length&&!unreadDMs.length){
    html+='<div style="padding:24px 16px;text-align:center;font-size:13px;color:var(--color-text-tertiary)">새 알림이 없습니다</div>';
  }

  el.innerHTML=html;
}

function markAllRead(){
  // 공지 모두 읽음
  const ids=(notices||[]).map(n=>n.id);
  localStorage.setItem('ws_read_notices',JSON.stringify(ids));
  dmUnreadCount=0;
  updateAlarmBadge();
  renderAlarmPanel();
  updateNoticeBadge();
}

function scheduleLocalAlarms(){
  const now=new Date();
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myD=data[cu?.name]||{};
      Object.entries(myD).forEach(([ds,type])=>{
        const d=parseInt(ds);
        const alarm=getAlarm(parseInt(y),parseInt(m),d);
        if(!alarm.alarm) return;
        const[h,mn]=(alarm.alarmTime||getDefaultAlarmTime()).split(':').map(Number);
        const alarmDt=new Date(parseInt(y),parseInt(m)-1,d-1,h,mn,0);
        const ms=alarmDt-now;
        if(ms>0&&ms<24*60*60*1000) setTimeout(()=>pushNotify(`내일 사역 알림 (${type})`,`${y}년 ${m}월 ${d}일 사역이 내일입니다.`,'shift'),ms);
      });
    });
  });
}

function closeAllPanels(){
  const ap=$('alarm-panel'), sp=$('settings-panel');
  if(ap) ap.style.display='none';
  if(sp) sp.style.display='none';
  $('alarm-overlay')?.remove();
  $('settings-overlay')?.remove();
}

function toggleAlarmPanel(){
  const panel=$('alarm-panel'); if(!panel) return;
  const isOpen=panel.style.display==='flex';
  closeAllPanels();
  if(!isOpen){
    panel.style.display='flex';
    renderAlarmPanel();
    const ov=document.createElement('div');
    ov.id='alarm-overlay';
    ov.style.cssText='position:fixed;inset:0;z-index:24;background:transparent';
    ov.onclick=()=>closeAllPanels();
    document.body.appendChild(ov);
    panel.style.zIndex='25';
  }
}

function toggleSettingsPanel(){
  const panel=$('settings-panel'); if(!panel) return;
  const isOpen=panel.style.display==='flex';
  closeAllPanels();
  if(!isOpen){
    renderSettingsPanel();
    panel.style.display='flex';
    panel.style.flexDirection='column';
    const ov=document.createElement('div');
    ov.id='settings-overlay';
    ov.style.cssText='position:fixed;inset:0;z-index:24;background:transparent';
    ov.onclick=()=>closeAllPanels();
    document.body.appendChild(ov);
    panel.style.zIndex='25';
  }
}

function toggleShiftAlarm(y,m,d){
  const cur=getAlarm(y,m,d); setAlarm(y,m,d,{...cur,alarm:!cur.alarm});
  updateAlarmBadge(); renderAlarmPanel(); scheduleLocalAlarms();
  // ★ 즉각 UI 반영
  renderCalendar();
  if($('tab-myshift')?.style.display!=='none') renderMyShift();
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
    sb.from('schedules').select('year,month,data,type').order('year').order('month'),
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
  const readIds = new Set((rR.data||[]).map(r=>r.notice_id));
  notices=(nR.data||[]).map(n=>({...n, is_unread: !readIds.has(n.id)}));
  feedPosts=(fR.data||[]).map(p=>({...p,author_name:p.app_users?.name}));
  shiftComments={};
  (cR.data||[]).forEach(c=>{const k=`${c.year}-${c.month}-${c.day}`;if(!shiftComments[k])shiftComments[k]=[];if(!shiftComments[k].find(x=>x.id===c.id))shiftComments[k].push({...c,author_name:c.app_users?.name});if(!commentLikes[c.id])commentLikes[c.id]=new Set();});
  // ★ DM 로드
  chatMessages={};
  const{data:dmData}=await sb.from('direct_messages').select('*').or(`from_id.eq.${cu.id},to_id.eq.${cu.id}`).order('created_at',{ascending:true});
  (dmData||[]).forEach(m=>{const otherId=m.from_id===cu.id?m.to_id:m.from_id;if(!chatMessages[otherId])chatMessages[otherId]=[];chatMessages[otherId].push(m);});
  updateDmBadge();
}
function initOfflineSample(){allSchedules={2026:{5:{'김동권':{'6':'[오전]자막','17':'[새벽]설교','24':'[저녁]기도'},'이미영':{'2':'[금요]기도','10':'[수요]설교','25':'[오전]사회'},'박지훈':{'5':'[새벽]설교','13':'[금요]영상'},'최수연':{'4':'[오전]사회','16':'[금요]자막'}}}};assignColors(collectAllTypes());}

// ══════════════════════════════════════════════════
//  탭 전환
// ══════════════════════════════════════════════════
function switchTab(tab,btn){
  closeAllPanels();
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  ['cal','myshift','search','notice','feed','admin'].forEach(t=>{
    const el=$(`tab-${t}`);
    if(t===tab){
      el.style.display='block';
      // ★ 애니메이션 리셋
      el.style.animation='none';
      el.offsetHeight; // reflow
      el.style.animation='';
    } else {
      el.style.display='none';
    }
  });
  $('hdr-title').textContent={cal:'캘린더',myshift:'내 사역',search:'사역 검색',notice:'공지사항',feed:'소통',admin:'관리자'}[tab]||tab;
  if(tab==='myshift'){myShiftYear=curY;myShiftMonth=curM+1;renderMyShift();}
  if(tab==='search'){renderSearchFilters();renderSearchResult();}
  if(tab==='notice')clearNoticeBadge();
  if(tab==='feed'){renderFeedTab();}
  if(tab==='admin')renderAdmin();
  $('alarm-panel').style.display='none';
}

// ══════════════════════════════════════════════════
//  카테고리 시스템
// ══════════════════════════════════════════════════
const CATEGORIES = [
  { id:'all',   label:'전체' },
  { id:'주일',  label:'주일' },
  { id:'수요',  label:'수요' },
  { id:'금요',  label:'금요' },
  { id:'새벽',  label:'새벽' },
  { id:'특새',  label:'특새&축복성회' },
];

// ★ 요일 + 사역유형으로 카테고리 판별
function getCategory(type, year, month, day){
  if(!type) return 'all';
  // ★ 새벽/저녁 통합 유형 처리
  const isCombined = type.includes('새벽/저녁') || type.includes('새벽+저녁');
  const t = isCombined ? type : type.split('/')[0];

  // 날짜 정보가 있으면 요일 기반 판별
  if(year && month && day){
    const dow=new Date(year, month-1, day).getDay();
    const isSunday   = dow===0;
    const isWednesday= dow===3;
    const isFriday   = dow===5;
    const hasSaebyeok= t.includes('새벽');

    if(isCombined) return '새벽'; // 새벽/저녁 통합은 새벽 카테고리
    if(isSunday)    return '주일';
    if(isWednesday && !hasSaebyeok) return '수요';
    if(isFriday    && !hasSaebyeok) return '금요';
    if(hasSaebyeok) return '새벽';
    return '특새';
  }

  // 날짜 정보 없으면 키워드 기반 fallback
  if(isCombined) return '새벽';
  if(t.includes('수요')) return '수요';
  if(t.includes('금요')) return '금요';
  if(t.includes('새벽')) return '새벽';
  if(t.includes('4부')||t.includes('저녁')||t.includes('오전')) return '주일';
  return '특새';
}

// 색상 간소화 — 사역 형태 키워드 기반
const TYPE_COLOR_RULES = [
  { keywords:['설교'],                              color:0 }, // 파랑
  { keywords:['사회'],                              color:1 }, // 초록
  { keywords:['자막'],                              color:2 }, // 주황
  { keywords:['영상'],                              color:3 }, // 보라
  { keywords:['기도'],                              color:4 }, // 청록
  { keywords:['백업'],                              color:9 }, // 회색
  { keywords:['방송','건반','드럼','베이스','싱어','인도'], color:5 }, // 연주황
];

function getTypeColor(type){
  if(!type) return PALETTE[9];
  for(const rule of TYPE_COLOR_RULES){
    if(rule.keywords.some(k=>type.includes(k))) return PALETTE[rule.color];
  }
  return PALETTE[6]; // 기타
}

let filterCategory = 'all'; // 카테고리 필터

function setCategoryFilter(catId){
  // ★ 토글 방식: 같은 탭 누르면 OFF (전체로), 다른 탭 누르면 ON
  filterCategory = filterCategory===catId ? 'all' : catId;
  filterType='';
  renderCalendar();
}

function renderLegend(){
  const el=$('cal-legend'); if(!el) return;
  const d=curData();
  const myModeActive=calView==='mine';

  // 이번 달 활성 카테고리 계산
  const activeCats=new Set();
  Object.keys(d).forEach(name=>{
    Object.entries(d[name]||{}).forEach(([day,type])=>{
      if(type) activeCats.add(getCategory(type, curY, curM+1, parseInt(day)));
    });
  });

  // 내 사역 모드: 내가 사역하는 카테고리
  const myRaw=d[cu?.name]||{};
  const myCats=new Set();
  if(myModeActive){
    Object.entries(myRaw).forEach(([day,type])=>{
      if(type) myCats.add(getCategory(type, curY, curM+1, parseInt(day)));
    });
  }

  // ★ '전체' 버튼 제거, 카테고리 탭만 토글로 표시
  const visibleCats = CATEGORIES.filter(c=>c.id!=='all'&&activeCats.has(c.id));

  el.innerHTML=`<div class="cat-tab-wrap">
    ${visibleCats.map(c=>{
      const isActive=filterCategory===c.id;
      const noMyShift=myModeActive&&!myCats.has(c.id);
      return `<button class="cat-tab-btn${isActive?' active':''}${noMyShift?' dimmed-cat':''}" onclick="setCategoryFilter('${c.id}')">${c.label}</button>`;
    }).join('')}
  </div>`;
}

// 카테고리 필터 적용된 사역 맵 생성
function getFilteredMap(allMap, myRaw, myDays){
  // fm: 전체 필터된 사역맵, fmMy: 내 사역 날짜 집합
  const fm={};
  const fmMy=new Set();

  Object.entries(allMap).forEach(([day,ws])=>{
    const d=parseInt(day);
    const cat=filterCategory;
    if(cat==='all'){
      fm[d]=ws;
    } else {
      const fw=ws.filter(w=>getCategory(w.type,curY,curM+1,d)===cat);
      if(fw.length) fm[d]=fw;
    }
  });

  myDays.forEach(d=>{
    const type=myRaw[String(d)];
    if(!type) return;
    if(filterCategory==='all'||getCategory(type,curY,curM+1,d)===filterCategory){
      fmMy.add(d);
    }
  });

  return {fm, fmMy};
}

// ══════════════════════════════════════════════════
//  캘린더
// ══════════════════════════════════════════════════
function toggleMyMinistry(){
  calView = calView==='all' ? 'mine' : 'all';
  filterType=''; filterCategory='all';
  const btn=$('btn-my-ministry');
  if(btn){
    btn.classList.toggle('active', calView==='mine');
    btn.innerHTML = calView==='mine'
      ? '🙋 내 사역 보기 ✓'
      : '🙋 내 사역 보기';
  }
  renderCalendar();
}
function setView(v){calView=v;filterType='';filterCategory='all';renderCalendar();}
function setFilter(t){filterType=filterType===t?'':t;renderCalendar();}
function changeMonth(d){curM+=d;if(curM>11){curM=0;curY++;}if(curM<0){curM=11;curY--;}filterType='';filterCategory='all';if(!OFFLINE&&!allSchedules[curY]?.[curM+1]){sb.from('schedules').select('year,month,data').eq('year',curY).eq('month',curM+1).maybeSingle().then(({data})=>{if(data){if(!allSchedules[curY])allSchedules[curY]={};allSchedules[curY][curM+1]=data.data||{};assignColors(collectAllTypes());}renderCalendar();});}else renderCalendar();}

function renderCalendar(){
  const DN=['일','월','화','수','목','금','토'],MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const fd=new Date(curY,curM,1).getDay(),dim=new Date(curY,curM+1,0).getDate(),now=new Date(),d=curData();
  const myRaw=d[cu.name]||{}, myDays=new Set(Object.keys(myRaw).map(Number).filter(n=>!isNaN(n)&&n>=1));
  $('month-label').textContent=`${curY}년 ${MN[curM]}`;
  const allMap={};
  Object.keys(d).forEach((name)=>{Object.entries(d[name]||{}).forEach(([ds,type])=>{const dn=parseInt(ds);if(isNaN(dn)||dn<1||dn>31)return;if(!allMap[dn])allMap[dn]=[];allMap[dn].push({name,type,c:tc(type)});});});

  // ★ 카테고리 필터 적용
  const {fm, fmMy}=getFilteredMap(allMap, myRaw, myDays);

  let html=DN.map(d=>`<div class="cal-head">${d}</div>`).join('');
  for(let i=0;i<fd;i++)html+=`<div class="cal-cell empty"></div>`;
  for(let d=1;d<=dim;d++){
    const isMy=myDays.has(d);
    const isToday=now.getFullYear()===curY&&now.getMonth()===curM&&now.getDate()===d;
    const dow=new Date(curY,curM,d).getDay();
    const key=`${curY}-${curM+1}-${d}`;
    const cc=(shiftComments[key]||[]).length;
    const myType=myRaw[String(d)]||'';
    const myC=myType?tc(myType):null;
    const workers=fm[d]||[];
    const myModeActive=calView==='mine';
    // ★ 내 팀 보기: 팀원들 사역만 표시
    const teamNames = calTeamView && myTeam.length ? new Set(myTeam) : null;
    const myHasDay=fmMy.has(d);
    const alarm=isMy?getAlarm(curY,curM+1,d):null;
    const alarmOff=isMy&&alarm&&!alarm.alarm;

    if(myModeActive){
      // ══ 내 사역 모드 ══
      const cls='cal-cell'+(dow===0?' sun':'')+(dow===6?' sat':'')+(!myHasDay&&!isToday?' dimmed':'');
      if(myHasDay){
        // 내 사역 있는 날 — 사역색 배경
        const bg=myC?myC.dot:'#185FA5';
        const typeLabel=`<div class="my-type-label">${myType.replace(/[\[\]]/g,'').slice(0,6)}</div>`;
        const cmtBadge=cc?`<div class="cmt-indicator" style="background:rgba(255,255,255,.3);color:#fff;border:none">${cc}</div>`:'';
        const alarmOffBadge=alarmOff?`<div style="position:absolute;bottom:2px;right:3px;font-size:10px;opacity:.8">🔕</div>`:'';
        // ★ 오늘+내사역: 사역색 배경 + 파란 이중 테두리
        const todayStyle=isToday?`background:${bg};border:2.5px solid #185FA5;outline:2px solid ${bg};outline-offset:1px;position:relative`:`background:${bg};border-color:${bg};position:relative`;
        html+=`<div class="${cls}" style="${todayStyle}" onclick="openDayModal(${d})">
          <div class="day-num-wrap"><span class="day-num" style="color:#fff;font-weight:800">${d}</span></div>
          ${typeLabel}${cmtBadge}${alarmOffBadge}
        </div>`;
      } else {
        // 내 사역 없는 날 — 흐린 셀 (오늘이면 파란 테두리)
        const todayStyle=isToday?`border:2.5px solid #185FA5;border-radius:8px`:``;
        const dayNumStyle=isToday?`color:#185FA5;font-weight:800`:``;
        html+=`<div class="${cls}" style="${todayStyle}" onclick="openDayModal(${d})">
          <div class="day-num-wrap"><span class="day-num" style="${dayNumStyle}">${d}</span></div>
        </div>`;
      }
    } else {
      // ══ 전체 사역 모드 ══
      const dimmed=filterCategory!=='all'&&!workers.length;
      const cls='cal-cell'+(dow===0?' sun':'')+(dow===6?' sat':'')+(dimmed?' dimmed':'');
      // ★ 내 사역 배경 + 오늘 파란 테두리 분리
      const hasMy=isMy&&myC;
      const bgStyle=hasMy?`background:${myC.bg};border-color:${myC.border}`:'';
      const todayBorder=isToday?`border:2.5px solid #185FA5`:'';
      const cellStyle=[bgStyle,todayBorder].filter(Boolean).join(';');
      const dots=workers.length?`<div class="shift-dots">${workers.filter(w=>!teamNames||teamNames.has(w.name)).slice(0,5).map(w=>`<div class="shift-dot" style="background:${w.c.dot}" title="${w.name}:${w.type}"></div>`).join('')}${workers.length>5?`<span class="more-dot">+${workers.length-5}</span>`:''}</div>`:'';
      const typeTip=myType&&myC?`<div class="type-tip" style="color:${myC.text}">${myType.replace(/[\[\]]/g,'').slice(0,4)}</div>`:'';
      const cmt=cc?`<div class="cmt-indicator">${cc}</div>`:'';
      const myDot=hasMy?`<span class="my-dot" style="background:${myC.dot}"></span>`:'';
      const dayNumStyle=isToday?`color:#185FA5;font-weight:800`:'';
      const alarmOffBadge=alarmOff?`<div class="alarm-dot-cal" style="opacity:.4;font-size:9px">🔕</div>`:'';
      html+=`<div class="${cls}" style="${cellStyle}" onclick="openDayModal(${d})"><div class="day-num-wrap"><span class="day-num" style="${dayNumStyle}">${d}</span>${myDot}</div>${typeTip}${dots}${cmt}${alarmOffBadge}</div>`;
    }
  }

  $('cal-grid').innerHTML=html; renderLegend(); renderShiftList(dim,MN,DN,myDays,myRaw,fm,allMap);
}

function renderShiftList(dim,MN,DN,myDays,myRaw,fm,allMap){
  const el=$('shift-list'),now=new Date();
  const makeChips=ws=>ws.map(w=>`<span class="worker-chip" style="background:${w.c.bg};color:${w.c.text};border:1px solid ${w.c.border}">${w.name}<span class="chip-type">${w.type}</span></span>`).join('');
  const pastDay=d=>(curY<now.getFullYear())||(curY===now.getFullYear()&&curM<now.getMonth())||(curY===now.getFullYear()&&curM===now.getMonth()&&d<now.getDate());
  const key='shift-list-body';
  const isOpen=collapseState[key]===true;
  const MNlabel=MN[curM];
  const myModeActive=calView==='mine';

  // 카테고리 필터가 적용된 내 사역 날짜 집합
  const {fmMy}=getFilteredMap(allMap,myRaw,myDays);
  const catLabel=filterCategory!=='all'?` (${filterCategory})`:'';

  let headerHtml=`<div onclick="toggleCollapse('${key}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 8px;cursor:pointer;user-select:none">
    <div class="list-section-title" style="margin:0">${myModeActive?`${MNlabel} 내 사역${catLabel}`:`${MNlabel} 전체 사역${catLabel}`}</div>
    <button class="collapse-btn" style="border:none;background:none;color:#aaa;font-size:12px;cursor:pointer;padding:2px 8px;border-radius:6px;background:#f0f0ea">${isOpen?'▲ 접기':'▼ 펼치기'}</button>
  </div>`;

  let bodyHtml='';
  if(myModeActive){
    // ★ 내 사역 모드: 카테고리 필터 + 내 사역 날짜만 표시
    const arr=[...fmMy].sort((a,b)=>a-b);
    if(!arr.length){
      const msg=filterCategory!=='all'?`이번 달 ${filterCategory} 내 사역이 없습니다.`:'이번 달 내 사역이 없습니다.';
      bodyHtml=`<p class="empty-state">${msg}</p>`;
    } else {
      bodyHtml=arr.map(d=>{
        const type=myRaw[String(d)]||'',c=type?tc(type):null;
        const key2=`${curY}-${curM+1}-${d}`,cc=(shiftComments[key2]||[]).length,alarm=getAlarm(curY,curM+1,d);
        return`<div class="list-card${pastDay(d)?' past':''}" onclick="openDayModal(${d})">
          <div class="list-card-header">
            <span class="list-date">${MNlabel} ${d}일 <span class="list-dow">${DN[new Date(curY,curM,d).getDay()]}</span></span>
            <div style="display:flex;gap:6px;align-items:center">
              ${alarm.alarm?'<span>🔔</span>':''}
              ${cc?`<span class="cmt-cnt">${cc}개 댓글</span>`:''}
              ${type&&c?`<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span>`:''}
            </div>
          </div>
          ${alarm.memo?`<div style="font-size:12px;color:#888;margin-top:4px;border-top:1px solid #f5f5f0;padding-top:4px">📝 ${esc(alarm.memo)}</div>`:''}
        </div>`;
      }).join('');
    }
  } else {
    // 전체 사역 모드
    let any=false;
    for(let d=1;d<=dim;d++){
      const ws=fm[d]||[];if(!ws.length)continue;any=true;
      const key2=`${curY}-${curM+1}-${d}`,cc=(shiftComments[key2]||[]).length;
      bodyHtml+=`<div class="list-card${pastDay(d)?' past':''}" onclick="openDayModal(${d})">
        <div class="list-card-header">
          <span class="list-date">${MNlabel} ${d}일 <span class="list-dow">${DN[new Date(curY,curM,d).getDay()]}</span></span>
          <div style="display:flex;gap:6px;align-items:center">${cc?`<span class="cmt-cnt">${cc}개</span>`:''}<span class="worker-cnt">${ws.length}명</span></div>
        </div>
        <div class="worker-chips">${makeChips(ws)}</div>
      </div>`;
    }
    if(!any) bodyHtml=`<p class="empty-state">${filterCategory!=='all'?`${filterCategory} 사역 일정이 없습니다.`:'사역 일정이 없습니다. 엑셀을 업로드해주세요.'}</p>`;
  }

  el.innerHTML=headerHtml+`<div data-collapse="${key}" style="display:${isOpen?'block':'none'}">${bodyHtml}</div>`;
}

// ══════════════════════════════════════════════════
//  날짜 모달 — 사역자 + 알림/메모 + 댓글
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

  // 사역자 목록
  let wHtml=`<div class="modal-section"><div class="modal-section-title">이 날 사역자</div>`;
  wHtml+=workers.length?workers.map(w=>{const c=tc(w.type);return`<div class="day-worker-row"><div style="display:flex;align-items:center;gap:9px"><div class="worker-av" style="background:${c.bg};color:${c.text}">${w.name[0]}</div><span class="worker-nm">${w.name}</span></div><span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${w.type}</span></div>`;}).join(''):`<p class="empty-state" style="padding:10px 0">사역자가 없습니다</p>`;
  wHtml+='</div>';

  // 알림 설정 (내 사역일만)
  let alarmHtml='';
  if(myType){
    alarmHtml=`<div class="modal-section">
      <div class="modal-section-title">알림 설정</div>
      <div class="alarm-setting-row">
        <div><div style="font-size:13px;font-weight:600">전날 알림 받기</div><div style="font-size:11px;color:#aaa;margin-top:2px">사역 전날 ${alarm.alarmTime||'18:30'}에 알림</div></div>
        <div class="toggle${alarm.alarm?' on':''}" onclick="toggleShiftAlarm(${year},${month},${day});renderDayModal();updateAlarmBadge()"></div>
      </div>
      ${alarm.alarm?`<div class="alarm-time-row"><label style="font-size:12px;color:#888;font-weight:600;flex-shrink:0">알림 시각</label><input type="time" class="time-input" value="${alarm.alarmTime||'18:30'}" onchange="updateAlarmTime(${year},${month},${day},this.value);renderDayModal()"></div>`:''}
    </div>`;
  }

  $('modal-body').innerHTML=wHtml+alarmHtml;
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
//  내 사역 탭 (관리자도 본인 이름으로 조회)
// ══════════════════════════════════════════════════
// ── 내 사역 탭 카테고리별 누적 통계 accordion ──────
const MY_CAT_ORDER = ['주일','수요','금요','새벽','특새'];
const MY_CAT_META  = {
  '주일': { icon:'☀️', label:'주일 예배', color:'#185FA5' },
  '수요': { icon:'🌿', label:'수요 예배', color:'#16a34a' },
  '금요': { icon:'🔥', label:'금요 예배', color:'#ea580c' },
  '새벽': { icon:'🌙', label:'새벽 예배', color:'#9333ea' },
  '특새': { icon:'⭐', label:'특새&축복성회', color:'#d97706' },
};

function buildCumByCategory(cumCount, myMonths){
  // { '주일': { total: N, types: {type: cnt} }, ... }
  const cats={};
  MY_CAT_ORDER.forEach(c=>cats[c]={total:0,types:{}});
  myMonths.forEach(({y,m})=>{
    const raw=getMonthData(y,m)[cu.name]||{};
    Object.entries(raw).forEach(([ds,type])=>{
      if(!type) return;
      const cat=getCategory(type,y,m,parseInt(ds));
      const key=MY_CAT_ORDER.includes(cat)?cat:'특새';
      if(!cats[key]) cats[key]={total:0,types:{}};
      cats[key].total++;
      cats[key].types[type]=(cats[key].types[type]||0)+1;
    });
  });
  return cats;
}

function renderMyShift(){
  const el=$('myshift-content');
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DN=['일','월','화','수','목','금','토'];
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());

  // 내 사역 전체 목록 (미래 + 오늘)
  const myFuture=[];
  const cumCount={};
  let cumTotal=0;

  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myData=data[cu.name]||{};
      Object.entries(myData).forEach(([ds,type])=>{
        if(!type) return;
        cumCount[type]=(cumCount[type]||0)+1;
        cumTotal++;
        const d=parseInt(ds);
        const dt=new Date(parseInt(y),parseInt(m)-1,d);
        if(dt>=today){
          myFuture.push({y:parseInt(y),m:parseInt(m),d,type,dt});
        }
      });
    });
  });

  myFuture.sort((a,b)=>a.dt-b.dt);

  if(!cumTotal){
    el.innerHTML=`<div class="search-empty"><div style="font-size:36px;margin-bottom:12px">📅</div><div style="font-size:14px;font-weight:600;color:#888">등록된 사역 기록이 없습니다</div></div>`;
    return;
  }

  // D-Day 계산
  const next=myFuture[0];
  const remaining=myFuture.length;
  let ddayHtml='';
  if(next){
    const diff=Math.ceil((next.dt-today)/(1000*60*60*24));
    const ddayStr=diff===0?'오늘':diff===1?'내일':`D-${diff}`;
    const c=tc(next.type);
    const alarm=getAlarm(next.y,next.m,next.d);
    ddayHtml=`
      <div style="background:#E6F1FB;border-radius:14px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:11px;color:#185FA5;font-weight:500;margin-bottom:4px">다음 사역까지</div>
          <div style="display:flex;align-items:baseline;gap:6px">
            <span style="font-size:26px;font-weight:700;color:#185FA5">${ddayStr}</span>
            <span style="font-size:12px;color:#378ADD">${next.m}월 ${next.d}일 (${DN[new Date(next.y,next.m-1,next.d).getDay()]})</span>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:600;color:#185FA5;background:#fff;padding:4px 10px;border-radius:8px;border:1px solid #dbeafe">${next.type}</div>
          <div style="font-size:10px;color:#378ADD;margin-top:4px">${alarm.alarm?'🔔 알림 '+alarm.alarmTime:'🔕 알림 꺼짐'}</div>
        </div>
      </div>`;
  }

  // 통계 카드
  const myMonths=new Set(Object.entries(allSchedules).flatMap(([y,ym])=>Object.entries(ym).filter(([m,d])=>d[cu.name]).map(([m])=>`${y}-${m}`))).size;
  const statsHtml=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:#fff;border-radius:10px;border:0.5px solid #f0f0ea;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#185FA5">${cumTotal}</div>
        <div style="font-size:10px;color:#aaa;margin-top:2px">전체 사역</div>
      </div>
      <div style="background:#fff;border-radius:10px;border:0.5px solid #f0f0ea;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#3B6D11">${remaining}</div>
        <div style="font-size:10px;color:#aaa;margin-top:2px">남은 사역</div>
      </div>
      <div style="background:#fff;border-radius:10px;border:0.5px solid #f0f0ea;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#BA7517">${myMonths}</div>
        <div style="font-size:10px;color:#aaa;margin-top:2px">사역 개월</div>
      </div>
    </div>`;

  // 카테고리별 누적 accordion
  const cumByCat=buildCumByCategory(cumCount,[]);
  // buildCumByCategory가 myMonths 파라미터 필요 — 직접 계산
  const catTotals={};
  MY_CAT_ORDER.forEach(c=>catTotals[c]={total:0,types:{}});
  Object.entries(cumCount).forEach(([type,cnt])=>{
    const cat=MY_CAT_ORDER.find(c=>MY_CAT_META[c]&&type.includes(c))||'특새';
    if(!catTotals[cat]) catTotals[cat]={total:0,types:{}};
    catTotals[cat].total+=cnt;
    catTotals[cat].types[type]=(catTotals[cat].types[type]||0)+cnt;
  });
  const activeCats=MY_CAT_ORDER.filter(c=>catTotals[c]?.total>0);
  let catHtml='';
  activeCats.forEach(cat=>{
    const meta=MY_CAT_META[cat]||{icon:'📋',label:cat,color:'#888'};
    const {total,types}=catTotals[cat];
    const key=`mycat-${cat}`;
    const isOpen=collapseState[key]===true;
    const typeItems=Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([type,cnt])=>{
      const c=tc(type);
      return`<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}"><div class="type-stat-name" style="color:${c.text}">${type}</div><div class="type-stat-big" style="color:${c.dot}">${cnt}</div><div class="type-stat-sub" style="color:${c.text}">회</div></div>`;
    }).join('');
    catHtml+=`<div style="margin-bottom:6px;background:#fff;border-radius:12px;overflow:hidden;border:1.5px solid #f0f0ea">
      <div onclick="toggleCollapse('${key}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${meta.icon}</span>
          <span style="font-size:13px;font-weight:700;color:${meta.color}">${meta.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:18px;font-weight:700;color:${meta.color}">${total}</span>
          <button class="collapse-btn" style="border:none;background:#ececea;color:#aaa;font-size:10px;cursor:pointer;padding:2px 6px;border-radius:5px">${isOpen?'▲':'▼'}</button>
        </div>
      </div>
      <div data-collapse="${key}" style="display:${isOpen?'block':'none'};padding:0 13px 12px"><div class="type-stat-grid">${typeItems}</div></div>
    </div>`;
  });

  // 예정 사역 목록 (완료 숨김)
  let listHtml='';
  if(myFuture.length){
    listHtml=myFuture.map(({y,m,d,type,dt})=>{
      const c=tc(type);
      const dow=new Date(y,m-1,d).getDay();
      const alarm=getAlarm(y,m,d);
      const isToday=dt.getTime()===today.getTime();
      const diff=Math.ceil((dt-today)/(1000*60*60*24));
      const ddayBadge=isToday?'<span style="background:#185FA5;color:#fff;font-size:10px;padding:2px 7px;border-radius:6px;margin-left:6px">오늘</span>':
        diff===1?'<span style="background:#E6F1FB;color:#185FA5;font-size:10px;padding:2px 7px;border-radius:6px;margin-left:6px">내일</span>':'';
      return`<div style="background:#fff;border-radius:12px;border:1.5px solid ${isToday?'#185FA5':'#f0f0ea'};padding:12px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between" onclick="openDayModal_myshift(${y},${m},${d})">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:8px;height:8px;border-radius:50%;background:${c?.dot||'#185FA5'};flex-shrink:0"></div>
          <div>
            <div style="font-size:13px;font-weight:600;color:${isToday?'#185FA5':'var(--color-text-primary)'}">
              ${m}월 ${d}일 (${DN[dow]})${ddayBadge}
            </div>
            <div style="margin-top:3px"><span style="background:${c?.bg};color:${c?.text};border:1px solid ${c?.border};font-size:11px;padding:2px 7px;border-radius:6px">${type}</span></div>
          </div>
        </div>
        <div style="font-size:16px">${alarm.alarm?'🔔':'🔕'}</div>
      </div>`;
    }).join('');
  } else {
    listHtml='<p class="empty-state">예정된 사역이 없습니다.</p>';
  }

  el.innerHTML=`
    <div class="my-header-card">
      <div class="my-name-badge">${cu.name}${isAdmin()?` <span class="role-tag">관리자</span>`:''}</div>
    </div>
    ${ddayHtml}
    ${statsHtml}
    <div class="list-section-title" style="margin-bottom:8px">누적 사역 통계</div>
    ${catHtml}
    <div class="list-section-title" style="margin-top:14px;margin-bottom:8px">예정된 사역</div>
    ${listHtml}`;
}

function openDayModal_myshift(y,m,d){
  // 내 사역 탭 유지하면서 날짜 팝업
  curY=y; curM=m-1;
  renderCalendar();
  setTimeout(()=>openDayModal(d),50);
}

function selectMyMonth(y,m){myShiftYear=y;myShiftMonth=m;renderMyShift();}
function viewDayInCal(y,m0,d){curY=y;curM=m0;switchTab('cal',$('btn-cal'));renderCalendar();setTimeout(()=>openDayModal(d),50);}

// ══════════════════════════════════════════════════
//  검색 탭
// ══════════════════════════════════════════════════
function saveMyTeam(){ localStorage.setItem('ws_my_team', JSON.stringify(myTeam)); }

const DEPT_META = {
  'team':       { icon:'⭐', label:'내 팀',     color:'#3B6D11', bg:'#EAF3DE', border:'#C0DD97' },
  '담임목사':   { icon:'⛪', label:'담임목사',  color:'#185FA5', bg:'#E6F1FB', border:'#BFDBFE' },
  '교구':       { icon:'🏘️', label:'교구',      color:'#633806', bg:'#FAEEDA', border:'#FCD9A0' },
  '청년국':     { icon:'🔥', label:'청년국',    color:'#7C3AED', bg:'#EEEDFE', border:'#C4B5FD' },
  '교육국':     { icon:'📚', label:'교육국',    color:'#0E7490', bg:'#E0F7FA', border:'#99E6F5' },
  '행정/선교':  { icon:'⚙️', label:'행정/선교', color:'#374151', bg:'#F3F4F6', border:'#D1D5DB' },
};
const DEPT_ORDER = ['team','담임목사','교구','청년국','교육국','행정/선교'];

function renderSearchFilters(){
  // 파트별 인원 수 계산
  const deptCounts = {};
  DEPT_ORDER.forEach(d => deptCounts[d] = 0);
  deptCounts['team'] = myTeam.length;
  allMembers.forEach(u => {
    if(u.department && deptCounts[u.department] !== undefined) deptCounts[u.department]++;
  });

  let html = `<div style="margin-bottom:4px">
    <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:10px;font-weight:500">파트 선택</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;

  DEPT_ORDER.forEach((d, i) => {
    const meta = DEPT_META[d];
    const isActive = srchDept === d;
    const isTeam = d === 'team';
    const isWide = d === 'team' || d === '행정/선교';
    const count = deptCounts[d] || 0;

    html += `<button onclick="setSrchDept('${d}')"
      style="grid-column:${isWide?'1/-1':'auto'};
        padding:12px;border-radius:14px;border:1.5px solid ${isActive?meta.color:meta.border};
        background:${isActive?meta.bg:'var(--color-background-primary)'};
        cursor:pointer;text-align:left;transition:all .2s;
        box-shadow:${isActive?`0 2px 8px ${meta.border}`:'none'}">
      <div style="font-size:18px;margin-bottom:5px">${meta.icon}</div>
      <div style="font-size:13px;font-weight:700;color:${isActive?meta.color:'var(--color-text-primary)'}">
        ${meta.label}
      </div>
      <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">
        ${isTeam ? `${count}명 등록됨` : `${count}명`}
      </div>
    </button>`;
  });

  html += `</div></div>`;
  $('search-filters').innerHTML = html;
}

function setSrchDept(dept){
  srchDept = dept;
  srchName = '';
  renderSearchFilters();
  renderSearchResult();
}

function setSrch(key,v2){
  if(key==='y') srchYear=v2;
  else if(key==='m') srchMonth=v2;
  else { srchName=v2; }
  renderSearchResult();
}

// ★ 내 팀 편집 모달 (개선)
function openTeamEditModal(){
  document.getElementById('team-edit-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'team-edit-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';

  // 전체 사역자 (파트 순서대로)
  const allOrderedNames = [
    '박지현',
    '안종훈','안성구','한상권','정의혁','최성자','권혜성','이상복','김현수',
    '허남홍','서동빈','손우성',
    '김증인','김용경','이성은','김재은','장시현','박은혜','김선양','이인경',
    '김동권','최성은'
  ];
  // DB에 있는 추가 이용자
  allMembers.forEach(u=>{ if(!allOrderedNames.includes(u.name)) allOrderedNames.push(u.name); });

  const currentTeamHtml = myTeam.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px">
        ${myTeam.map(n=>`
          <div style="display:flex;align-items:center;gap:5px;background:#EAF3DE;border:1px solid #C0DD97;border-radius:20px;padding:4px 8px 4px 6px">
            <span style="font-size:12px;font-weight:500;color:#3B6D11">${n}</span>
            <button onclick="removeFromTeam('${n}')" style="border:none;background:none;color:#E24B4A;cursor:pointer;font-size:14px;line-height:1;padding:0">×</button>
          </div>`).join('')}
      </div>`
    : `<p style="font-size:12px;color:var(--color-text-secondary);padding:8px 0">아직 팀원이 없어요</p>`;

  const addListHtml = allOrderedNames
    .filter(n=>!myTeam.includes(n))
    .map(n=>{
      const u = allMembers.find(m=>m.name===n);
      const isPending = !u;
      const titleText = u?.title || '';
      const deptKey = u?.department || '';
      const dMeta = DEPT_META[deptKey] || {color:'#888',bg:'#f0f0ea'};
      return`<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:0.5px solid var(--color-border-tertiary);${isPending?'opacity:.4':''}">
        <div style="width:32px;height:32px;border-radius:50%;background:${dMeta.bg};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:${dMeta.color};flex-shrink:0">${n[0]}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500">${n}</div>
          ${titleText?`<div style="font-size:10px;color:var(--color-text-secondary)">${titleText}</div>`:''}
        </div>
        ${!isPending
          ?`<button onclick="addToTeam('${n}')" style="flex-shrink:0;padding:5px 12px;background:#185FA5;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:500;cursor:pointer">추가</button>`
          :`<span style="font-size:10px;color:#bbb">준비중</span>`}
      </div>`;
    }).join('');

  modal.innerHTML=`
    <div style="background:var(--color-background-primary);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 -4px 24px rgba(0,0,0,.2)">
      <div style="padding:14px 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:0.5px solid var(--color-border-tertiary)">
        <div>
          <div style="font-size:15px;font-weight:600">내 팀 편집</div>
          <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">팀원을 추가하면 캘린더에서도 함께 확인돼요</div>
        </div>
        <button onclick="document.getElementById('team-edit-modal').remove()" style="border:none;background:var(--color-background-secondary);width:28px;height:28px;border-radius:50%;font-size:16px;color:var(--color-text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1">
        <div style="padding:12px 16px;background:var(--color-background-secondary);border-bottom:0.5px solid var(--color-border-tertiary)">
          <div style="font-size:11px;font-weight:600;color:var(--color-text-secondary);margin-bottom:8px">현재 팀원 ${myTeam.length}명</div>
          <div id="current-team-list">${currentTeamHtml}</div>
        </div>
        <div>
          <div style="padding:10px 16px 6px;font-size:11px;font-weight:600;color:var(--color-text-secondary)">추가하기</div>
          ${addListHtml}
        </div>
      </div>
    </div>`;
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}


function addToTeam(name){
  if(!myTeam.includes(name)){ myTeam.push(name); saveMyTeam(); }
  document.getElementById('team-edit-modal')?.remove();
  openTeamEditModal();
  renderSearchFilters();
  renderSearchResult();
  renderCalendar(); // 캘린더도 즉시 반영
}

function removeFromTeam(name){
  myTeam = myTeam.filter(n=>n!==name);
  saveMyTeam();
  document.getElementById('team-edit-modal')?.remove();
  openTeamEditModal();
  renderSearchFilters();
  renderSearchResult();
  renderCalendar();
}
// 파트별 고정 순서
const DEPT_NAMES = {
  '담임목사': ['박지현'],
  '교구': ['안종훈','안성구','한상권','정의혁','최성자','권혜성','이상복','김현수'],
  '청년국': ['허남홍','서동빈','손우성'],
  '교육국': ['김증인','김용경','이성은','김재은','장시현','박은혜','김선양','이인경'],
  '행정/선교': ['김동권','최성은'],
};

let srchOpenPerson = null; // 현재 열린 사람 이름

function renderSearchResult(){
  const el=$('search-result');
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());

  // 파트가 선택 안 됐으면 빈 화면
  if(!srchDept){
    el.innerHTML='<p class="empty-state">위에서 파트를 선택해주세요.</p>';
    return;
  }

  let targetNames=[];
  if(srchDept==='team'){
    targetNames=myTeam.filter(n=>n);
  } else {
    targetNames = DEPT_NAMES[srchDept] || [];
  }

  if(!targetNames.length){
    el.innerHTML=`<div style="text-align:center;padding:30px 0;color:var(--color-text-secondary);font-size:13px">
      ${srchDept==='team'?'팀원을 추가해주세요.<br><button onclick="openTeamEditModal()" style="margin-top:8px;padding:6px 16px;background:#185FA5;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer">+ 팀원 추가</button>':'사역자가 없습니다.'}
    </div>`;
    return;
  }

  // 각 이름별 사역 집계
  const meta = DEPT_META[srchDept] || DEPT_META['교구'];
  const DN=['일','월','화','수','목','금','토'];

  const teamEditBtn = srchDept==='team'
    ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:12px;font-weight:600;color:${meta.color}">⭐ 내 팀 ${targetNames.length}명</span>
        <button onclick="openTeamEditModal()" style="font-size:11px;color:#185FA5;background:#E6F1FB;border:none;padding:4px 10px;border-radius:8px;cursor:pointer">✏️ 팀 편집</button>
      </div>`
    : `<div style="font-size:12px;font-weight:600;color:${meta.color};margin-bottom:10px">${meta.icon} ${meta.label} · ${targetNames.length}명</div>`;

  let listHtml = `<div style="background:var(--color-background-primary);border-radius:16px;overflow:hidden;border:1px solid ${meta.border}">`;

  targetNames.forEach((name, idx) => {
    const u = allMembers.find(m=>m.name===name);
    const isPending = !u;
    const c = u ? PALETTE[allMembers.indexOf(u)%PALETTE.length] : {bg:'#f0f0ea',text:'#888'};
    const isOpen = srchOpenPerson === name;

    // 사역 집계
    const shifts = [];
    Object.entries(allSchedules).forEach(([y,ym])=>{
      Object.entries(ym).forEach(([m,d])=>{
        const days = d[name]||{};
        Object.entries(days).forEach(([day,type])=>{
          if(type) shifts.push({y:parseInt(y),m:parseInt(m),d:parseInt(day),type,dt:new Date(parseInt(y),parseInt(m)-1,parseInt(day))});
        });
      });
    });
    shifts.sort((a,b)=>a.dt-b.dt);
    const totalCount = shifts.length;
    const futureCount = shifts.filter(s=>s.dt>=today).length;
    const months = new Set(shifts.map(s=>`${s.y}-${s.m}`)).size;

    const avHtml = u?.avatar
      ? `<img src="${u.avatar}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid ${meta.border}">`
      : `<div style="width:36px;height:36px;border-radius:50%;background:${isPending?'#f0f0ea':c.bg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:${isPending?'#bbb':c.text};flex-shrink:0">${name[0]}</div>`;

    const titleText = u?.title
      ? `<span style="font-size:10px;color:var(--color-text-secondary);background:var(--color-background-secondary);padding:1px 5px;border-radius:4px;margin-left:5px">${u.title}</span>`
      : '';

    // 통계+사역 리스트 (펼쳐질 때)
    let statsHtml = '';
    if(isOpen && !isPending){
      const future = shifts.filter(s=>s.dt>=today);
      const shiftRows = shifts.slice(0,20).map(({y,m,d,type,dt})=>{
        const c2=tc(type); const isPastShift=dt<today; const dow=new Date(y,m-1,d).getDay();
        return`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 14px;border-top:0.5px solid var(--color-border-tertiary);${isPastShift?'opacity:.4':''}">
          <span style="font-size:11px;color:var(--color-text-secondary)">${m}월 ${d}일 (${DN[dow]})</span>
          <span style="font-size:10px;padding:2px 7px;border-radius:5px;background:${c2.bg};color:${c2.text};border:1px solid ${c2.border}">${type}</span>
        </div>`;
      }).join('');

      statsHtml = `
        <div style="border-top:0.5px solid ${meta.border}">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:${meta.bg}">
            <div style="padding:10px;text-align:center;border-right:0.5px solid ${meta.border}">
              <div style="font-size:18px;font-weight:700;color:${meta.color}">${totalCount}</div>
              <div style="font-size:9px;color:var(--color-text-secondary)">전체</div>
            </div>
            <div style="padding:10px;text-align:center;border-right:0.5px solid ${meta.border}">
              <div style="font-size:18px;font-weight:700;color:#3B6D11">${futureCount}</div>
              <div style="font-size:9px;color:var(--color-text-secondary)">예정</div>
            </div>
            <div style="padding:10px;text-align:center">
              <div style="font-size:18px;font-weight:700;color:#BA7517">${months}</div>
              <div style="font-size:9px;color:var(--color-text-secondary)">개월</div>
            </div>
          </div>
          ${shiftRows||`<div style="text-align:center;font-size:12px;color:var(--color-text-secondary);padding:12px">등록된 사역 없음</div>`}
        </div>`;
    }

    listHtml += `
      <div style="border-bottom:${idx<targetNames.length-1?'0.5px solid var(--color-border-tertiary)':'none'}">
        <div onclick="${isPending?'void(0)':'togglePersonStats(\''+name+'\''+')'}"
          style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:${isPending?'default':'pointer'};background:${isOpen?meta.bg:'transparent'};transition:background .15s;${isPending?'opacity:.45':''}">
          ${avHtml}
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;color:var(--color-text-primary);display:flex;align-items:center;flex-wrap:wrap;gap:2px">
              ${name}${titleText}
            </div>
            <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">
              ${isPending
                ? '<span style="background:#f0f0ea;color:#aaa;padding:1px 6px;border-radius:4px;font-size:10px">준비중</span>'
                : `전체 ${totalCount}건 · 남은 ${futureCount}건`}
            </div>
          </div>
          ${!isPending?`<span style="font-size:16px;color:${isOpen?meta.color:'var(--color-text-secondary)'};transition:transform .2s;display:inline-block;transform:${isOpen?'rotate(90deg)':'rotate(0deg)'}">${isOpen?'∨':'›'}</span>`:''}
        </div>
        ${statsHtml}
      </div>`;
  });

  listHtml += `</div>`;
  el.innerHTML = teamEditBtn + listHtml;
}

function togglePersonStats(name){
  srchOpenPerson = srchOpenPerson===name ? null : name;
  renderSearchResult();
}

  const el=$('search-result');
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DN=['일','월','화','수','목','금','토'];
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());

  const u=allMembers.find(m=>m.name===name);
  const deptKey=u?.department||'';
  const meta=DEPT_META[deptKey]||{color:'#185FA5',bg:'#E6F1FB',border:'#BFDBFE',label:deptKey};
  const c=u?PALETTE[allMembers.indexOf(u)%PALETTE.length]:{bg:'#f0f0ea',text:'#888'};

  // 전체 사역 집계
  const shifts=[];
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,d])=>{
      const days=d[name]||{};
      Object.entries(days).forEach(([day,type])=>{
        if(type) shifts.push({y:parseInt(y),m:parseInt(m),d:parseInt(day),type,dt:new Date(parseInt(y),parseInt(m)-1,parseInt(day))});
      });
    });
  });
  shifts.sort((a,b)=>a.dt-b.dt);

  const future=shifts.filter(s=>s.dt>=today);
  const past=shifts.filter(s=>s.dt<today);
  const months=new Set(shifts.map(s=>`${s.y}-${s.m}`)).size;

  const avHtml=u?.avatar
    ?`<img src="${u.avatar}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid ${meta.border}">`
    :`<div style="width:44px;height:44px;border-radius:50%;background:${c.bg};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;color:${c.text}">${name[0]}</div>`;

  const shiftRows = [...future, ...past].slice(0,20).map(({y,m,d,type,dt})=>{
    const tc2=tc(type);
    const isPast=dt<today;
    const dow=new Date(y,m-1,d).getDay();
    return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:0.5px solid var(--color-border-tertiary);${isPast?'opacity:.4':''}">
      <span style="font-size:12px;color:var(--color-text-secondary)">${m}월 ${d}일 (${DN[dow]})</span>
      <span style="font-size:11px;padding:2px 8px;border-radius:5px;background:${tc2.bg};color:${tc2.text};border:1px solid ${tc2.border}">${type}</span>
    </div>`;
  }).join('');

  el.innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <button onclick="renderSearchResult()" style="border:none;background:var(--color-background-primary);border-radius:8px;padding:6px 10px;font-size:13px;color:#185FA5;cursor:pointer;border:1px solid var(--color-border-secondary)">‹ 목록</button>
      <span style="font-size:13px;font-weight:500;color:var(--color-text-primary)">${name} 사역</span>
    </div>
    <div style="background:var(--color-background-primary);border-radius:16px;overflow:hidden;border:1px solid ${meta.border}">
      <div style="padding:14px;border-bottom:0.5px solid var(--color-border-tertiary);display:flex;align-items:center;gap:12px">
        ${avHtml}
        <div>
          <div style="font-size:15px;font-weight:600">${name}</div>
          <div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">${meta.label}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr">
        <div style="padding:12px;text-align:center;border-right:0.5px solid var(--color-border-tertiary)">
          <div style="font-size:22px;font-weight:600;color:#185FA5">${shifts.length}</div>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">전체 사역</div>
        </div>
        <div style="padding:12px;text-align:center;border-right:0.5px solid var(--color-border-tertiary)">
          <div style="font-size:22px;font-weight:600;color:#3B6D11">${future.length}</div>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">남은 사역</div>
        </div>
        <div style="padding:12px;text-align:center">
          <div style="font-size:22px;font-weight:600;color:#BA7517">${months}</div>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">사역 개월</div>
        </div>
      </div>
      <div style="border-top:0.5px solid var(--color-border-tertiary)">
        ${shiftRows||`<div style="padding:16px;text-align:center;color:var(--color-text-secondary);font-size:12px">등록된 사역이 없습니다</div>`}
      </div>
    </div>`;

// ══════════════════════════════════════════════════
//  공지
// ══════════════════════════════════════════════════
// ★ 관리자: 공지 읽음 현황 조회
async function loadNoticeReadStatus(noticeId){
  if(!isAdmin()||OFFLINE) return;
  const{data}=await sb.from('notice_reads').select('user_id').eq('notice_id',noticeId);
  const readIds=new Set((data||[]).map(r=>r.user_id));
  const total=allMembers.length;
  const readCount=allMembers.filter(u=>readIds.has(u.id)).length;
  const unreadMembers=allMembers.filter(u=>!readIds.has(u.id)&&!isAdminRole(u));
  // 팝업 표시
  const msg=`읽음 ${readCount}/${total}명\n\n미읽음:\n${unreadMembers.map(u=>u.name).join(', ')||'없음'}`;
  alert(msg);
}

function renderNotices(){
  const el=$('notice-list');
  if(!notices.length){el.innerHTML='<p class="empty-state">등록된 공지가 없습니다.</p>';return;}
  el.innerHTML=notices.map(n=>`
    <div class="notice-card${n.is_unread?' unread':''}" id="nc-${n.id}">
      <div onclick="toggleNotice(${n.id})">
        ${n.is_unread?`<span class="new-badge">NEW</span>`:''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
          <div class="n-title">${esc(n.title)}</div>
          <div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px" onclick="event.stopPropagation()">
            ${isAdmin()?`
              <button class="n-action-btn" onclick="loadNoticeReadStatus(${n.id})" title="읽음 현황">👁</button>
              <button class="n-action-btn" onclick="editNotice(${n.id})">수정</button>
              <button class="n-action-btn del" onclick="deleteNotice(${n.id})">삭제</button>
            `:''}
          </div>
        </div>
        <div class="n-meta">${fmtDate(n.created_at)}</div>
        <div class="n-body">${escNl(n.body)}</div>
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
  updateAppBadge();
}

// ★ 공지 탭 진입 시 모두 읽음 처리
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
  // 기존 모달 제거
  document.getElementById('notice-edit-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='notice-edit-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`
    <div style="background:#fff;border-radius:18px;padding:22px;width:100%;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div style="font-size:16px;font-weight:700;color:#185FA5;margin-bottom:16px">📝 공지 수정</div>
      <div style="font-size:12px;color:#888;margin-bottom:6px;font-weight:600">제목</div>
      <input id="edit-notice-title" type="text" value="${esc(n.title)}" style="width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;margin-bottom:14px;box-sizing:border-box;font-family:inherit">
      <div style="font-size:12px;color:#888;margin-bottom:6px;font-weight:600">내용</div>
      <textarea id="edit-notice-body" rows="8" style="width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;font-family:inherit;line-height:1.6">${esc(n.body)}</textarea>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button onclick="document.getElementById('notice-edit-modal').remove()" style="flex:1;padding:12px;border:1.5px solid #e0e0e0;background:#fff;border-radius:10px;font-size:14px;font-weight:600;color:#888;cursor:pointer">취소</button>
        <button onclick="saveNoticeEdit(${id})" style="flex:1;padding:12px;background:#185FA5;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">저장</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // 바깥 클릭 닫기
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.remove(); });
}

function saveNoticeEdit(id){
  const n=notices.find(x=>x.id===id); if(!n) return;
  const title=document.getElementById('edit-notice-title')?.value?.trim();
  const body=document.getElementById('edit-notice-body')?.value?.trim();
  if(!title||!body) return showToastMsg('제목과 내용을 입력해주세요.');
  n.title=title; n.body=body;
  if(!OFFLINE) sb.from('notices').update({title,body}).eq('id',id);
  document.getElementById('notice-edit-modal')?.remove();
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
//  설정 패널
// ══════════════════════════════════════════════════
// 알림 설정 (localStorage)
function getNotifSettings(){
  try{ return JSON.parse(localStorage.getItem('ws_notif_settings')||'{}'); }catch{ return {}; }
}
function saveNotifSettings(s){ localStorage.setItem('ws_notif_settings', JSON.stringify(s)); }

// ★ 알림 전송 전 설정 확인 헬퍼
function canNotify(type){
  // 배지는 항상 허용 — 이 함수는 소리/배너 알림 여부만 제어
  if(!('Notification' in window)||Notification.permission!=='granted') return false;
  const s=getNotifSettings();
  if(s.masterOff) return false; // 마스터 OFF
  if(type==='notice' && s.noticeOff) return false;
  if(type==='chat'   && s.chatOff)   return false;
  if(type==='shift'  && s.shiftOff)  return false;
  return true;
}

function renderSettingsPanel(){
  const el=$('settings-panel-body'); if(!el) return;
  const notifGranted='Notification' in window && Notification.permission==='granted';
  const keepLogin=localStorage.getItem('ws_session')!==null;
  const s=getNotifSettings();
  const masterOn=notifGranted && !s.masterOff;
  const defaultAlarmTime = s.defaultAlarmTime || '18:30';

  el.innerHTML=`
    <!-- 기기 알림 마스터 -->
    <div class="settings-item">
      <div class="settings-item-left">
        <div class="settings-item-title">기기 알림 허용</div>
        <div class="settings-item-desc">${notifGranted?'사역·공지·채팅 소리/배너 알림':'먼저 허용하기를 눌러주세요'}</div>
      </div>
      ${notifGranted
        ? `<div class="toggle${masterOn?' on':''}" onclick="toggleNotifMaster(this)"></div>`
        : `<button onclick="requestNotifPermission()" style="padding:7px 14px;background:#185FA5;color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer">허용하기</button>`}
    </div>
    <!-- 세부 알림 (마스터 ON일 때만 활성화) -->
    <div style="opacity:${masterOn?1:0.35};pointer-events:${masterOn?'auto':'none'}">
      <div class="settings-item">
        <div class="settings-item-left">
          <div class="settings-item-title">사역 알림</div>
          <div class="settings-item-desc">사역 전날 자동 알림</div>
        </div>
        <div class="toggle${!s.shiftOff?' on':''}" onclick="toggleNotifSetting('shiftOff',this)"></div>
      </div>
      <!-- ★ 기본 알림 시간 설정 -->
      <div class="settings-item">
        <div class="settings-item-left">
          <div class="settings-item-title">기본 알림 시간</div>
          <div class="settings-item-desc">전날 이 시각에 사역 알림 발송</div>
        </div>
        <input type="time" value="${defaultAlarmTime}" onchange="saveDefaultAlarmTime(this.value)" style="width:120px;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-weight:700;text-align:center;box-sizing:border-box">
      </div>
      <div class="settings-item">
        <div class="settings-item-left">
          <div class="settings-item-title">공지 알림</div>
          <div class="settings-item-desc">새 공지 등록 시 알림</div>
        </div>
        <div class="toggle${!s.noticeOff?' on':''}" onclick="toggleNotifSetting('noticeOff',this)"></div>
      </div>
      <div class="settings-item">
        <div class="settings-item-left">
          <div class="settings-item-title">채팅 알림</div>
          <div class="settings-item-desc">새 메시지 수신 시 알림</div>
        </div>
        <div class="toggle${!s.chatOff?' on':''}" onclick="toggleNotifSetting('chatOff',this)"></div>
      </div>
    </div>
    <!-- 로그인 유지 -->
    <div class="settings-item" style="border-top:4px solid #f5f5f0">
      <div class="settings-item-left">
        <div class="settings-item-title">로그인 유지</div>
        <div class="settings-item-desc">로그아웃 전까지 자동 로그인</div>
      </div>
      <div class="toggle${keepLogin?' on':''}" onclick="toggleKeepLogin(this)"></div>
    </div>
    <!-- 앱 버전 -->
    <div class="settings-item">
      <div class="settings-item-left">
        <div class="settings-item-title">앱 버전</div>
        <div class="settings-item-desc">은평교회 교역자 사역스케줄러</div>
      </div>
      <span style="font-size:12px;color:#bbb">v10.0</span>
    </div>
    <!-- ★ 로그아웃 -->
    <div class="settings-item" style="border-top:4px solid #f5f5f0">
      <div class="settings-item-left">
        <div class="settings-item-title" style="color:#e74c3c">로그아웃</div>
        <div class="settings-item-desc">현재 기기에서 로그아웃합니다</div>
      </div>
      <button onclick="closeAllPanels();doLogout()" style="padding:7px 16px;background:#fff0f0;color:#e74c3c;border:1.5px solid #fcc;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer">로그아웃</button>
    </div>`;
}

// ★ 기본 알림 시간 저장 (설정창에서 수정 가능)
function saveDefaultAlarmTime(time){
  const s=getNotifSettings();
  s.defaultAlarmTime=time;
  saveNotifSettings(s);
  showToastMsg(`기본 알림 시간이 ${time}으로 저장되었습니다.`);
  scheduleLocalAlarms();
}

function toggleNotifMaster(el){  const s=getNotifSettings();
  s.masterOff=!s.masterOff;
  saveNotifSettings(s);
  el.classList.toggle('on', !s.masterOff);
  renderSettingsPanel();
  showToastMsg(s.masterOff?'기기 알림이 꺼졌습니다':'기기 알림이 켜졌습니다');
}

function toggleNotifSetting(key, el){
  const s=getNotifSettings();
  s[key]=!s[key];
  saveNotifSettings(s);
  el.classList.toggle('on', !s[key]);
  showToastMsg('설정이 저장되었습니다.');
}

function toggleKeepLogin(toggleEl){
  const isOn=toggleEl.classList.contains('on');
  if(isOn){
    localStorage.removeItem('ws_session');
    toggleEl.classList.remove('on');
    showToastMsg('로그인 유지가 해제되었습니다.');
  } else {
    if(cu){
      // 현재 로그인 정보 다시 저장 (비밀번호는 없으므로 안내)
      showToastMsg('다음 로그인 시 자동 저장됩니다.');
    }
    toggleEl.classList.add('on');
  }
}
// ══════════════════════════════════════════════════
let feedTab = 'members'; // 'members' | 'chat'

function renderFeedTab(){
  const el=$('feed-list'); if(!el) return;

  const segHtml=`
    <div style="display:flex;gap:0;background:var(--color-background-secondary);border-radius:8px;padding:2px;margin-bottom:14px">
      <button onclick="setFeedTab('members')" style="flex:1;padding:7px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;background:${feedTab==='members'?'var(--color-background-primary)':'transparent'};color:${feedTab==='members'?'#185FA5':'var(--color-text-secondary)'}">사역자 목록</button>
      <button onclick="setFeedTab('chat')" style="flex:1;padding:7px;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;background:${feedTab==='chat'?'var(--color-background-primary)':'transparent'};color:${feedTab==='chat'?'#185FA5':'var(--color-text-secondary)'}">관리자 메시지</button>
    </div>`;

  if(feedTab==='members'){
    el.innerHTML = segHtml + renderMemberListHtml();
  } else {
    el.innerHTML = segHtml + renderChatListHtml();
  }
}

function setFeedTab(tab){
  feedTab = tab;
  renderFeedTab();
}

// ★ 사역자 목록 (파트별)
function renderMemberListHtml(){
  const DEPT_SECTIONS=[
    {label:'담임목사', names:['박지현']},
    {label:'교구', names:['안종훈','안성구','한상권','정의혁','최성자','권혜성','이상복','김현수']},
    {label:'청년국', names:['허남홍','서동빈','손우성']},
    {label:'교육국', names:['김증인','김용경','이성은','김재은','장시현','박은혜','김선양','이인경']},
    {label:'행정/선교', names:['김동권','최성은']},
  ];

  let html='';
  DEPT_SECTIONS.forEach(sec=>{
    const dMeta=DEPT_META[sec.label]||{color:'#888',bg:'#f0f0ea',border:'#e0e0e0'};
    html+=`<div style="font-size:10px;font-weight:500;color:${dMeta.color};padding:8px 2px 4px;letter-spacing:.5px">${sec.label}</div>
    <div style="background:var(--color-background-primary);border-radius:12px;overflow:hidden;border:1px solid ${dMeta.border};margin-bottom:10px">`;

    sec.names.forEach((name,idx)=>{
      const u=allMembers.find(m=>m.name===name);
      const isPending=!u;
      const isInTeam=myTeam.includes(name);
      const avHtml=u?.avatar
        ?`<img src="${u.avatar}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid ${dMeta.border}">`
        :`<div style="width:34px;height:34px;border-radius:50%;background:${isPending?'#f0f0ea':dMeta.bg};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:${isPending?'#bbb':dMeta.color};flex-shrink:0">${name[0]}</div>`;

      const teamBtn = isPending
        ? `<div style="width:28px;height:28px;border-radius:50%;border:1px solid #e0e0e0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#ccc;opacity:.4">+</div>`
        : isInTeam
          ? `<button onclick="event.stopPropagation();removeFromTeam('${name}')" style="width:28px;height:28px;border-radius:50%;border:1.5px solid #3B6D11;background:#EAF3DE;display:flex;align-items:center;justify-content:center;font-size:12px;color:#3B6D11;cursor:pointer">✓</button>`
          : `<button onclick="event.stopPropagation();addToTeam('${name}')" style="width:28px;height:28px;border-radius:50%;border:1.5px solid #185FA5;background:none;display:flex;align-items:center;justify-content:center;font-size:16px;color:#185FA5;cursor:pointer">+</button>`;

      html+=`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:${idx<sec.names.length-1?'0.5px solid var(--color-border-tertiary)':'none'};${isPending?'opacity:.4':''}">
        ${avHtml}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--color-text-primary)">${name}</div>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-top:1px">${u?.title||(isPending?'준비중':'')}</div>
        </div>
        ${teamBtn}
      </div>`;
    });
    html+=`</div>`;
  });
  return html;
}

// ★ 관리자 메시지
function renderChatListHtml(){
  let html='';
  if(isAdmin()){
    const members=allMembers.filter(u=>!isAdminRole(u));
    if(!members.length) return '<p class="empty-state">이용자가 없습니다.</p>';
    members.forEach((u,i)=>{
      const msgs=chatMessages[u.id]||[];
      const unread=msgs.filter(m=>m.to_id===cu.id&&!m.is_read).length;
      const last=msgs[msgs.length-1];
      const c=PALETTE[i%PALETTE.length];
      const avHtml=u.avatar
        ?`<img src="${u.avatar}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid #f0f0ea">`
        :`<div style="width:42px;height:42px;border-radius:50%;background:${c.bg};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;color:${c.text};flex-shrink:0">${u.name[0]}</div>`;
      html+=`<div class="list-card${unread?' feed-card-new':''}" onclick="openChat(${u.id})" style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        ${avHtml}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:14px;font-weight:500">${u.name}</span>
            <div style="display:flex;align-items:center;gap:6px">
              ${unread?`<span class="cnt-badge">${unread}</span>`:''}
              ${last?`<span style="font-size:10px;color:var(--color-text-secondary)">${fmtTime(last.created_at)}</span>`:''}
            </div>
          </div>
          <div style="font-size:12px;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${last?`${last.from_id===cu.id?'나: ':''}${esc(last.content)}`:'아직 대화가 없습니다'}
          </div>
        </div>
      </div>`;
    });
  } else {
    const admin=allMembers.find(u=>isAdminRole(u));
    if(!admin) return '<p class="empty-state">관리자를 찾을 수 없습니다.</p>';
    const msgs=chatMessages[admin.id]||[];
    const unread=msgs.filter(m=>m.to_id===cu.id&&!m.is_read).length;
    const last=msgs[msgs.length-1];
    html+=`<div class="list-card${unread?' feed-card-new':''}" onclick="openChat(${admin.id})" style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      ${admin.avatar
        ?`<img src="${admin.avatar}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid #dbeafe">`
        :`<div style="width:42px;height:42px;border-radius:50%;background:#185FA5;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;color:#fff;flex-shrink:0">${admin.name[0]}</div>`}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:14px;font-weight:500">${admin.name} <span style="font-size:11px;color:#185FA5;font-weight:400">관리자</span></span>
          <div style="display:flex;align-items:center;gap:6px">
            ${unread?`<span class="cnt-badge">${unread}</span>`:''}
             ${last?`<span style="font-size:10px;color:var(--color-text-secondary)">${fmtTime(last.created_at)}</span>`:''}
           </div>
         </div>
         <div style="font-size:12px;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
           ${last?`${last.from_id===cu.id?'나: ':''}${esc(last.content)}`:'아직 대화가 없습니다'}
         </div>
       </div>
     </div>`;
  }
  return html;
}

function isAdminRole(u){return u?.role==='admin'||u?.role==='superadmin';}

// 배지: 받은 읽지 않은 DM 수
function updateFeedBadge(){
  const cnt=Object.values(chatMessages).flat().filter(m=>m.to_id===cu.id&&!m.is_read).length;
  const btn=$('btn-feed');
  btn?.querySelectorAll('.nav-badge').forEach(b=>b.remove());
  if(cnt>0){const b=document.createElement('div');b.className='nav-badge';btn?.appendChild(b);b.textContent=cnt;}
  updateAppBadge();
}
function updateDmBadge(){updateFeedBadge();}

// ★ 앱 아이콘 배지
function updateAppBadge(){
  if(!cu) return;
  const dmCnt=Object.values(chatMessages).flat().filter(m=>m.to_id===cu.id&&!m.is_read).length;
  const noticeCnt=notices.filter(n=>n.is_unread).length;
  const total=dmCnt+noticeCnt;
  if('setAppBadge' in navigator){
    total>0 ? navigator.setAppBadge(total).catch(()=>{}) : navigator.clearAppBadge().catch(()=>{});
  }
}
// 하위 호환용 (관리자 탭에서 renderAdminFeed 호출 방지)
function renderMyFeed(){}
function renderDmInbox(){}

function openChat(userId){
  const user=allMembers.find(u=>u.id===userId);
  if(!user) return;
  chatTarget=user;
  // ★ 로컬 읽음 처리
  const msgs=chatMessages[userId]||[];
  const unreadIds=msgs.filter(m=>m.to_id===cu.id&&!m.is_read).map(m=>m.id);
  msgs.forEach(m=>{if(m.to_id===cu.id)m.is_read=true;});
  // ★ DB 한 번에 업데이트
  if(!OFFLINE&&unreadIds.length>0){
    sb.from('direct_messages')
      .update({is_read:true})
      .eq('to_id',cu.id)
      .eq('from_id',userId)
      .then(({error})=>{if(error)console.warn('DM read error:',error.message);});
  }
  updateFeedBadge();
  $('chat-target-name').textContent=user.name;
  $('chat-modal').style.display='flex';
  renderChatMessages();
  setTimeout(()=>{const el=$('chat-messages');if(el)el.scrollTop=el.scrollHeight;},50);
}

function renderChatMessages(){
  const el=$('chat-messages'); if(!el||!chatTarget) return;
  const msgs=chatMessages[chatTarget.id]||[];
  if(!msgs.length){el.innerHTML='<p style="text-align:center;color:#ccc;font-size:13px;padding:20px">첫 메시지를 보내보세요</p>';return;}
  el.innerHTML=msgs.map(m=>{
    const isMine=m.from_id===cu.id;
    return`<div style="display:flex;flex-direction:column;align-items:${isMine?'flex-end':'flex-start'};margin-bottom:10px">
      <div style="max-width:75%;padding:10px 13px;border-radius:${isMine?'16px 16px 4px 16px':'16px 16px 16px 4px'};background:${isMine?'#185FA5':'#fff'};color:${isMine?'#fff':'#1a1a18'};font-size:13px;line-height:1.5;box-shadow:0 1px 3px rgba(0,0,0,.1)">${esc(m.content)}</div>
      <div style="font-size:10px;color:#bbb;margin-top:3px">${fmtTime(m.created_at)}</div>
    </div>`;
  }).join('');
  el.scrollTop=el.scrollHeight;
}

let dmSending = false;
async function sendDm(){
  if(dmSending) return;
  const input=$('chat-input');
  const txt=input?.value.trim();
  if(!txt||!chatTarget) return;
  dmSending = true;
  const msg={id:Date.now(),from_id:cu.id,to_id:chatTarget.id,content:txt,is_read:false,created_at:new Date().toISOString()};
  if(!chatMessages[chatTarget.id])chatMessages[chatTarget.id]=[];
  chatMessages[chatTarget.id].push(msg);
  input.value='';
  renderChatMessages();
  if(!OFFLINE){
    const{data}=await sb.from('direct_messages').insert({from_id:cu.id,to_id:chatTarget.id,content:txt}).select('*').single();
    if(data){
      const idx=chatMessages[chatTarget.id].findIndex(m=>m.id===msg.id);
      if(idx>=0)chatMessages[chatTarget.id][idx]=data;
      // ★ 상대방에게 푸시 알림
      sendPushToUsers([chatTarget.id], `💬 ${cu.name}`, txt);
    }
  }
  dmSending = false;
}

function closeChatModal(){
  $('chat-modal').style.display='none';
  chatTarget=null;
  // ★ 채팅창 닫을 때 소통 탭 목록 갱신 → 배지 사라짐
  if($('tab-feed')?.style.display!=='none') renderFeedTab();
  updateFeedBadge();
}

function fmtTime(s){
  if(!s)return'';
  try{const d=new Date(s);return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}catch{return'';}
}

// ══════════════════════════════════════════════════
//  관리자
// ══════════════════════════════════════════════════
function renderAdmin(){renderPending();renderMembers();buildSchedPreview();renderAdminFeed();renderUploadSettings();updatePendingBadge();}

function renderUploadSettings(){
  const el=$('upload-settings-ui'); if(!el) return;
  const s=getUploadSettings();
  const confirmOn=s.confirmUpload!==false;
  const undoOn=s.enableUndo!==false;
  el.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="alarm-setting-row">
        <div>
          <div style="font-size:13px;font-weight:600">저장 전 확인 팝업</div>
          <div style="font-size:11px;color:#aaa;margin-top:2px">업로드 시 병합/덮어쓰기 내용을 확인창으로 보여줍니다</div>
        </div>
        <div class="toggle${confirmOn?' on':''}" onclick="toggleUploadSetting('confirmUpload')"></div>
      </div>
      <div class="alarm-setting-row" style="border-bottom:none">
        <div>
          <div style="font-size:13px;font-weight:600">저장 후 되돌리기 (30초)</div>
          <div style="font-size:11px;color:#aaa;margin-top:2px">저장 완료 후 30초 내에 이전 상태로 복원할 수 있습니다</div>
        </div>
        <div class="toggle${undoOn?' on':''}" onclick="toggleUploadSetting('enableUndo')"></div>
      </div>
    </div>`;
}

function toggleUploadSetting(key){
  const s=getUploadSettings();
  s[key]=s[key]===false?true:false;
  saveUploadSettings(s);
  renderUploadSettings();
  showToastMsg('설정이 저장되었습니다.');
}
function updatePendingBadge(){const cnt=(window._pending||[]).length;let b=$('btn-admin').querySelector('.nav-badge');if(cnt>0){if(!b){b=document.createElement('div');b.className='nav-badge';$('btn-admin').appendChild(b);}b.textContent=cnt;}else b?.remove();}
function renderPending(){if(OFFLINE){$('pending-list').innerHTML='<p class="empty-state">오프라인 모드</p>';return;}const pending=window._pending||[];$('pending-badge').innerHTML=pending.length?`<span class="cnt-badge">${pending.length}</span>`:'';const el=$('pending-list');if(!pending.length){el.innerHTML='<p class="empty-state">대기 중인 신청이 없습니다.</p>';return;}el.innerHTML=pending.map(u=>{const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[u.name]));return`<div class="member-row" onclick="openMemberModal(${u.id})"><div class="member-av">${u.name[0]}</div><div class="member-info"><div class="m-name">${u.name}${inS?` <span class="sched-match-tag">사역표 있음</span>`:''}</div><div class="m-sub">연락처: ${u.phone} · 생년월일: ${u.birth}</div></div><div class="m-actions" onclick="event.stopPropagation()"><button class="act-btn approve" onclick="approveUser(${u.id})">승인</button><button class="act-btn reject" onclick="rejectUser(${u.id})">거절</button></div></div>`;}).join('');}
function renderMembers(){
  const el=$('member-list');
  if(!allMembers.length){el.innerHTML='<p class="empty-state">승인된 회원이 없습니다.</p>';return;}

  const DEPT_SECTIONS=[
    {label:'담임목사',names:['박지현']},
    {label:'교구',names:['안종훈','안성구','한상권','정의혁','최성자','권혜성','이상복','김현수']},
    {label:'청년국',names:['허남홍','서동빈','손우성']},
    {label:'교육국',names:['김증인','김용경','이성은','김재은','장시현','박은혜','김선양','이인경']},
    {label:'행정/선교',names:['김동권','최성은']},
  ];

  let html='';
  DEPT_SECTIONS.forEach(sec=>{
    const dMeta=DEPT_META[sec.label]||{color:'#888',bg:'#f0f0ea',border:'#e0e0e0'};
    const secMembers=sec.names.map(n=>allMembers.find(u=>u.name===n)).filter(Boolean);
    const pendingNames=sec.names.filter(n=>!allMembers.find(u=>u.name===n));
    if(!secMembers.length&&!pendingNames.length)return;

    html+=`<div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:${dMeta.color};padding:4px;letter-spacing:.8px;text-transform:uppercase">${sec.label}</div>
      <div style="background:var(--color-background-primary);border-radius:14px;overflow:hidden;border:1px solid ${dMeta.border}">`;

    secMembers.forEach((u,i)=>{
      const total=Object.values(allSchedules).reduce((s,ym)=>s+Object.values(ym).reduce((s2,d)=>s2+Object.keys(d[u.name]||{}).length,0),0);
      const avHtml=u.avatar
        ?`<img src="${u.avatar}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:1.5px solid ${dMeta.border}" alt="${u.name}">`
        :`<div style="width:38px;height:38px;border-radius:50%;background:${dMeta.bg};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:${dMeta.color}">${u.name[0]}</div>`;
      html+=`<div class="member-row" onclick="openMemberModal(${u.id})" style="border-bottom:${i<secMembers.length-1||pendingNames.length?'0.5px solid var(--color-border-tertiary)':'none'}">
        ${avHtml}
        <div class="member-info">
          <div class="m-name">${u.name}
            ${u.title?`<span style="font-size:10px;color:${dMeta.color};background:${dMeta.bg};padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:400">${u.title}</span>`:''}
          </div>
          <div class="m-sub">전체 ${total}건</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:#ddd;flex-shrink:0"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </div>`;
    });
    pendingNames.forEach(n=>{
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;opacity:.35;border-top:0.5px solid var(--color-border-tertiary)">
        <div style="width:38px;height:38px;border-radius:50%;background:#f0f0ea;display:flex;align-items:center;justify-content:center;font-size:14px;color:#bbb">${n[0]}</div>
        <div><div style="font-size:13px;color:#aaa">${n}</div><div style="font-size:11px;color:#ccc">준비중</div></div>
      </div>`;
    });
    html+=`</div></div>`;
  });

  const listedNames=DEPT_SECTIONS.flatMap(s=>s.names);
  const others=allMembers.filter(u=>!listedNames.includes(u.name));
  if(others.length){
    html+=`<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#888;padding:4px">기타</div>
      <div style="background:var(--color-background-primary);border-radius:14px;overflow:hidden;border:1px solid var(--color-border-tertiary)">
        ${others.map((u,i)=>{
          const total=Object.values(allSchedules).reduce((s,ym)=>s+Object.values(ym).reduce((s2,d)=>s2+Object.keys(d[u.name]||{}).length,0),0);
          return`<div class="member-row" onclick="openMemberModal(${u.id})" style="border-bottom:${i<others.length-1?'0.5px solid var(--color-border-tertiary)':'none'}">
            <div style="width:38px;height:38px;border-radius:50%;background:#f0f0ea;display:flex;align-items:center;justify-content:center;font-size:14px;color:#888">${u.name[0]}</div>
            <div class="member-info"><div class="m-name">${u.name}</div><div class="m-sub">전체 ${total}건</div></div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:#ddd;flex-shrink:0"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>`;
        }).join('')}
      </div></div>`;
  }
  el.innerHTML=html;
}
function openMemberModal(id){
  const u=allMembers.find(x=>x.id===id)||(window._pending||[]).find(x=>x.id===id);if(!u)return;
  const rl=u.role==='superadmin'?'최고관리자':u.role==='admin'?'관리자':'사역자';
  const sl=u.status==='approved'?'승인됨':u.status==='pending'?'가입 대기':'거절됨';
  const inS=Object.values(allSchedules).some(ym=>Object.values(ym).some(d=>d[u.name]));
  let act='';
  if(isAdmin()&&u.id!==cu.id){
    if(u.status==='pending'){act=`<button class="detail-btn promote" onclick="approveUser(${u.id});closeModalById('member-modal')">승인</button><button class="detail-btn reject-btn" onclick="rejectUser(${u.id});closeModalById('member-modal')">거절</button>`;}
    else{if(u.role==='employee')act+=`<button class="detail-btn promote" onclick="changeRole(${u.id},'admin');openMemberModal(${u.id})">관리자 지정</button>`;if(u.role==='admin')act+=`<button class="detail-btn demote" onclick="changeRole(${u.id},'employee');openMemberModal(${u.id})">사역자로 변경</button>`;if(u.role!=='superadmin')act+=`<button class="detail-btn reject-btn" onclick="if(confirm('삭제?')){removeUser(${u.id});closeModalById('member-modal')}">삭제</button>`;}
  }

  const chatBtn = u.id!==cu.id
    ? `<button class="detail-btn promote" style="background:#f0f5fd;color:#185FA5" onclick="closeModalById('member-modal');openChat(${u.id})">💬 메시지 보내기</button>`
    : '';

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

  // ★ 프로필 사진 표시 (공유)
  const isMe = u.id === cu.id;
  const profileImg = u.avatar
    ? `<img src="${u.avatar}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;cursor:pointer;border:2px solid #f0f0ea"
        onclick="enlargeProfileImg('${u.avatar}','${esc(u.name)}')" alt="${esc(u.name)}">`
    : `<div class="member-av-lg" style="cursor:default">${u.name[0]}</div>`;

  $('member-modal-body').innerHTML=`
    <div class="member-detail-top">
      <div style="position:relative">
        ${profileImg}
      </div>
      <div><div style="font-size:19px;font-weight:700">${u.name}</div>
        <div style="font-size:13px;color:#888;margin-top:2px">${rl} · ${sl}</div>
        ${inS?'<span class="sched-match-tag" style="margin-top:4px;display:inline-block">사역표 등록됨</span>':''}
      </div>
    </div>
    <div class="detail-table">
      <div class="detail-row"><span>연락처 뒷자리</span><span>${u.phone}</span></div>
      <div class="detail-row"><span>생년월일</span><span>${u.birth}</span></div>
      <div class="detail-row"><span>가입일</span><span>${fmtDate(u.created_at)}</span></div>
      ${isAdmin()?`<div class="detail-row"><span>직분</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span id="title-display-${u.id}">${u.title||'미설정'}</span>
          <button onclick="editMemberTitle(${u.id})" style="font-size:10px;color:#185FA5;background:#E6F1FB;border:none;padding:2px 7px;border-radius:5px;cursor:pointer">수정</button>
        </div>
      </div>`:''}
    </div>
    ${chatBtn}
    ${memoSection}`;
  $('member-modal').style.display='flex';
}

// ★ 프로필 사진 확대
function enlargeProfileImg(src, name){
  document.getElementById('profile-enlarge-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'profile-enlarge-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`
    <div style="text-align:center">
      <img src="${src}" style="width:260px;height:260px;border-radius:50%;object-fit:cover;border:3px solid #fff" alt="${name}">
      <div style="color:#fff;margin-top:12px;font-size:16px;font-weight:600">${name}</div>
      <button onclick="document.getElementById('profile-enlarge-modal').remove()"
        style="margin-top:16px;padding:8px 24px;background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:10px;font-size:13px;cursor:pointer">닫기</button>
    </div>`;
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}
async function saveMemo(uid){const memo=$(`memo-${uid}`)?.value||'';const u=allMembers.find(x=>x.id===uid);if(!u)return;u.memo=memo;if(!OFFLINE)await sb.from('app_users').update({memo}).eq('id',uid);showToastMsg('저장되었습니다.');}
async function approveUser(id){if(!OFFLINE)await sb.from('app_users').update({status:'approved'}).eq('id',id);window._pending=(window._pending||[]).filter(u=>u.id!==id);const{data}=await sb.from('app_users').select('*');if(data){allMembers=data.filter(u=>u.status==='approved');window._pending=data.filter(u=>u.status==='pending');}renderAdmin();}
async function rejectUser(id){if(!OFFLINE)await sb.from('app_users').update({status:'rejected'}).eq('id',id);window._pending=(window._pending||[]).filter(u=>u.id!==id);renderPending();}
async function changeRole(id,role){const u=allMembers.find(x=>x.id===id);if(!u)return;u.role=role;if(!OFFLINE)await sb.from('app_users').update({role}).eq('id',id);renderMembers();}

async function editMemberTitle(id){
  const u=allMembers.find(x=>x.id===id); if(!u) return;
  const newTitle=prompt(`${u.name} 직분 수정:`, u.title||'');
  if(newTitle===null) return;
  u.title=newTitle.trim();
  if(!OFFLINE) await sb.from('app_users').update({title:u.title}).eq('id',id);
  const el=document.getElementById(`title-display-${id}`);
  if(el) el.textContent=u.title||'미설정';
  renderMembers();
  showToastMsg('직분이 수정되었습니다.');
}
async function removeUser(id){allMembers=allMembers.filter(x=>x.id!==id);if(!OFFLINE)await sb.from('app_users').delete().eq('id',id);renderAdmin();}
function renderAdminFeed(){
  const el=$('admin-feed-list');
  if(!el) return; // 요소 없으면 무시

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
  const n={id:Date.now(),title,body,created_at:new Date().toISOString(),is_unread:false};
  if(!OFFLINE){
    const{data}=await sb.from('notices').insert({title,body,created_by:cu.id}).select('*').single();
    if(data){
      n.id=data.id; n.created_at=data.created_at;
      await sb.from('notice_reads').upsert({notice_id:n.id, user_id:cu.id});
      // ★ 모든 이용자에게 푸시 알림
      const userIds=allMembers.filter(u=>u.id!==cu.id).map(u=>u.id);
      sendPushToUsers(userIds, `📢 새 공지: ${title}`, body);
    }
  } else { notices.unshift(n); renderNotices(); }
  notices.unshift(n);
  renderNotices();
  $('n-title').value=''; $('n-body').value='';
  toast('notice-toast');
}

// ══════════════════════════════════════════════════
//  엑셀 업로드
// ══════════════════════════════════════════════════
function dragOver(e){e.preventDefault();$('upload-zone').classList.add('drag');}

// ★ 상시/특별 사역표 업로드 타입 전환
function setUploadType(type){
  currentUploadType = type;
  const regBtn=$('upload-tab-regular');
  const spcBtn=$('upload-tab-special');
  const desc=$('upload-type-desc');
  if(type==='regular'){
    regBtn.style.background='#185FA5'; regBtn.style.color='#fff'; regBtn.style.borderColor='#185FA5';
    spcBtn.style.background='#fff'; spcBtn.style.color='#888'; spcBtn.style.borderColor='#ddd';
    desc.innerHTML='<b>상시 사역표</b> — 정기 예배 사역자 (기존 데이터 덮어쓰기)<br>형식: 1행 = 이름 | 1(금) | 2(토) | ... / 2행~ = 홍길동 | [오전]자막 | ...';
  } else {
    spcBtn.style.background='#d97706'; spcBtn.style.color='#fff'; spcBtn.style.borderColor='#d97706';
    regBtn.style.background='#fff'; regBtn.style.color='#888'; regBtn.style.borderColor='#ddd';
    desc.innerHTML='<b>⭐ 특별 사역표</b> — 특별행사/축복성회 (상시 사역표와 병합, 덮어쓰기 안 함)<br>같은 날짜에 상시+특별 사역이 함께 표시됩니다.';
  }
  // ★ 탭 전환 시 목록 갱신
  buildSchedPreview();
}
function dragLeave(){$('upload-zone').classList.remove('drag');}
function dropFile(e){e.preventDefault();$('upload-zone').classList.remove('drag');handleAnyFile(e.dataTransfer.files[0]);}
function handleExcelFile(inp){const f=inp.files[0];if(f)handleAnyFile(f);inp.value='';}

// ★ 파일 형식 자동 감지 → 엑셀/이미지 분기
function handleAnyFile(file){
  if(!file) return;
  const isImage = file.type.startsWith('image/');
  const isExcel = file.name.match(/\.(xlsx|xls)$/i);
  if(isImage){
    parseImageWithAI(file);
  } else if(isExcel){
    parseExcelFile(file);
  } else {
    showExcelErr('엑셀(.xlsx) 또는 이미지(jpg, png) 파일만 업로드 가능합니다.');
  }
}

// ★ AI 파서 — 이미지를 Claude API로 분석
// ══════════════════════════════════════════════════
//  AI 파서 — 이미지 → Claude API (Edge Function 프록시)
// ══════════════════════════════════════════════════
async function parseImageWithAI(file){
  // 이미지 타입 검증
  const allowedTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
  const mediaType = 'image/jpeg'; // 압축 시 항상 JPEG로 변환됨
  if(!allowedTypes.includes(mediaType)){
    showExcelErr('jpg, png, gif, webp 이미지 파일만 분석할 수 있습니다.');
    return;
  }

  showAILoading(true, '이미지를 읽는 중...');
  try {
    // 이미지를 base64로 변환 (최대 5MB 압축)
    const base64 = await compressImageToBase64(file);

    showAILoading(true, 'AI가 사역표를 분석 중입니다...');

    const memberNames = allMembers.map(u=>u.name).join(', ');
    const prompt = `이 이미지는 교회 사역자 사역표입니다. 다음 규칙에 따라 분석해주세요:

1. 날짜별로 사역자와 역할(사역유형)을 추출해주세요.
2. 괄호 안에 사람 이름이 있으면 [기도] 역할입니다.
3. 괄호 안에 행사명/교회명/소속 등 이름이 아닌 내용은 무시하세요.
4. 괄호가 두 개면 첫 번째는 무시, 두 번째 이름이 [기도]입니다.
5. 주일 새벽 설교의 경우, 다음 주 설교자가 이번 주 백업입니다.
6. 등록된 회원 이름 목록: ${memberNames || '(없음)'}
7. 이름이 비슷하면 회원 목록의 이름으로 자동 교정해주세요.
8. 연도와 월 정보를 이미지나 제목에서 최대한 추출하세요.
9. 날짜 표기 규칙: "5/1"은 5월 1일, "4/27"은 4월 27일입니다. 슬래시(/) 앞 숫자가 월, 뒤 숫자가 일입니다.
10. 표 상단이나 제목에 월 정보가 있으면 반드시 그 월로 인식하세요.
11. 병합된 셀(merged cells) 처리 규칙:
   - 열이 병합되어 있어도 반드시 각 날짜 열을 정확히 따라 내려오세요
   - 병합된 행의 내용은 해당 열의 날짜에만 적용하세요
   - 예: 4/30열과 5/1열이 나란히 있을 때, 싱어 행이 두 칸으로 나뉘어 있으면 왼쪽은 4/30, 오른쪽은 5/1 데이터입니다
   - 열 경계를 정확히 추적해서 각 날짜에 맞는 사람을 기록하세요
12. 싱어는 여러 명이 있을 수 있습니다. 쉼표로 구분해서 한 셀에 모두 기록하세요 (예: "김증인,박은혜,김용경")

결과를 반드시 아래 JSON 형식으로만 응답하세요 (마크다운 코드블록, 설명 텍스트 없이 순수 JSON만):

두 달치 데이터가 있으면 months 배열로, 한 달이면 단일 객체로 응답하세요:

단일 월: {"year":연도숫자,"month":월숫자,"data":{"이름":{"날짜숫자":"사역유형"}},"summary":"요약"}

두 달치: {"months":[{"year":연도숫자,"month":월숫자,"data":{"이름":{"날짜숫자":"사역유형"}}},{"year":연도숫자,"month":월숫자,"data":{"이름":{"날짜숫자":"사역유형"}}}],"summary":"요약"}

예: 4/27~5/3 이 있으면 4월 데이터와 5월 데이터를 분리해서 months 배열로 응답하세요.

사역유형 예시:
- 새벽 예배: "[새벽]설교", "[새벽]인도", "[새벽]건반", "[새벽]세컨건반", "[새벽]드럼", "[새벽]베이스", "[새벽]싱어", "[새벽]자막", "[새벽]영상", "[새벽]기도지원"
- 저녁 예배 (중요 규칙):
  * "[저녁]설교" — 설교자 기록
  * "[저녁]인도" — 넓은 칸에 적힌 인도자 이름만 기록 (팀명 괄호 포함 가능)
  * "[저녁]자막", "[저녁]영상", "[저녁]기도지원" — 기록
  * 저녁의 싱어, 베이스, 드럼, 건반, 세컨건반은 기록하지 않음 (생략)
- 주일 예배: "[주일새벽]설교", "[주일오전]사회", "[주일오전]자막", "[주일4부]자막", "[주일4부]설교"
- 수요 예배: "[수요]설교", "[수요]사회", "[수요]자막", "[수요]영상"
- 금요 예배: "[금요]설교", "[금요]사회", "[금요]자막", "[금요]영상"
- 기타: "[기도]설교", "[백업]설교"

★ 중요 — 새벽/저녁 구분 규칙:
- 표에 "새벽"이라고 표시된 행/섹션의 역할 → 반드시 "[새벽]역할명" 형식
- 표에 "저녁"이라고 표시된 행/섹션의 역할 → 반드시 "[저녁]역할명" 형식
- 같은 사람이 같은 날 새벽 설교와 저녁 설교를 모두 할 수 있음 → 두 개 모두 별도로 기록
- 같은 날 새벽과 저녁 모두 설교하는 경우 → "[새벽/저녁]설교" 로 기록
- 같은 날 새벽과 저녁 모두 인도하는 경우 → "[새벽/저녁]인도" 로 기록
- 같은 날 새벽과 저녁 모두 건반인 경우 → "[새벽/저녁]건반" 으로 기록
- 새벽과 저녁이 다른 역할이면 더 중요한 역할(설교>인도>건반>기타) 하나만 기록
- 새벽만 있으면 "[새벽]역할명", 저녁만 있으면 "[저녁]역할명", 둘 다면 "[새벽/저녁]역할명"으로 기록`;

    // ★ Gemini API — Supabase Edge Function 프록시 사용
    let text = '';
    // ★ Anthropic Claude API — Supabase Edge Function 프록시
    const fnResp = await fetch(`${SUPABASE_URL}/functions/v1/ai-parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ base64, mediaType, prompt })
    });
    if(!fnResp.ok){
      const errText = await fnResp.text();
      throw new Error(`Gemini 오류 ${fnResp.status}: ${errText.slice(0,200)}`);
    }
    const fnData = await fnResp.json();
    text = fnData?.text || '';

    if(!text) throw new Error('AI 응답이 비어 있습니다.');

    // JSON 파싱 (코드블록 제거)
    const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    const jsonStart = clean.indexOf('{');
    const jsonEnd   = clean.lastIndexOf('}');
    if(jsonStart<0||jsonEnd<0) throw new Error('JSON 형식을 찾을 수 없습니다. AI 응답: '+clean.slice(0,100));
    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd+1));

    showAILoading(false);

    // ★ 두 달치 데이터 처리
    if(parsed.months && parsed.months.length > 0){
      showAIPreviewMulti(parsed.months, parsed.summary, file.name);
    } else {
      if(!parsed.year || !parsed.month) throw new Error('연도/월 정보를 인식하지 못했습니다.');
      if(!parsed.data || !Object.keys(parsed.data).length) throw new Error('사역자 데이터를 찾을 수 없습니다.');
      showAIPreview(parsed, file.name);
    }

  } catch(e) {
    showAILoading(false);
    showExcelErr('AI 분석 오류: ' + e.message);
    console.error('[AI Parser]', e);
  }
}

// 이미지 압축 + base64 변환 (최대 1600px, JPEG 0.85)
function compressImageToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        // ★ Edge Function 크기 제한 대응: 최대 1024px, 품질 0.75
        const MAX = 1024;
        let {width:w, height:h} = img;
        if(w>MAX||h>MAX){const r=Math.min(MAX/w,MAX/h);w=Math.round(w*r);h=Math.round(h*r);}
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        // 품질 낮춰서 크기 줄이기 (약 200~400KB 목표)
        let quality = 0.75;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        // base64 크기가 400KB 초과하면 품질 더 낮춤
        while(dataUrl.length > 400000 && quality > 0.3){
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl.split(',')[1]);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function showAILoading(show, msg){
  let el=$('ai-loading');
  if(!el){
    el=document.createElement('div');
    el.id='ai-loading';
    el.style.cssText='text-align:center;padding:24px 20px;color:#185FA5;font-size:13px;font-weight:600';
    el.innerHTML=`<div class="spinner" style="margin:0 auto 12px;width:32px;height:32px;border-width:3px"></div><div id="ai-loading-msg">AI가 사역표를 분석하고 있습니다...</div><div style="font-size:11px;color:#aaa;margin-top:6px;line-height:1.5">사역표 이미지에 따라 10~30초 소요됩니다</div>`;
    $('upload-zone').after(el);
  }
  if(msg){const m=$('ai-loading-msg');if(m)m.textContent=msg;}
  el.style.display=show?'block':'none';
  $('upload-zone').style.display=show?'none':'block';
}

// AI 분석 결과 미리보기
function showAIPreview(parsed, fileName){
  const {year, month, data, summary} = parsed;
  if(!data||!Object.keys(data).length){ showExcelErr('사역자 데이터를 찾을 수 없습니다.'); return; }

  parsedExcel = {year, month, data, fileName: fileName||'AI분석결과'};
  assignColors(collectAllTypes());

  $('upload-zone').style.display='none';
  $('excel-preview').style.display='block';

  // ★ 기존 AI 요약 박스 제거 (중복 방지)
  $('excel-preview').querySelectorAll('.ai-summary-box').forEach(el=>el.remove());

  // ★ 년도/월 수정 가능한 헤더
  $('excel-info').innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:12px;color:#888">AI 분석 결과 —</span>
      <input id="ai-year" type="number" value="${year}" min="2020" max="2030"
        style="width:70px;padding:4px 8px;border:1.5px solid #185FA5;border-radius:8px;font-size:13px;font-weight:700;text-align:center"
        onchange="updateAIParsed()"> 년
      <input id="ai-month" type="number" value="${month}" min="1" max="12"
        style="width:50px;padding:4px 8px;border:1.5px solid #185FA5;border-radius:8px;font-size:13px;font-weight:700;text-align:center"
        onchange="updateAIParsed()"> 월
      <span style="font-size:12px;color:#888">· 사역자 ${Object.keys(data).length}명</span>
    </div>`;

  // 요약 표시
  if(summary){
    const sumEl=document.createElement('div');
    sumEl.className='ai-summary-box';
    sumEl.style.cssText='background:#f0f5fd;border-radius:10px;padding:10px 13px;font-size:12px;color:#185FA5;margin-bottom:10px;line-height:1.6;border:1px solid #dbeafe';
    sumEl.innerHTML=`🤖 <b>AI 분석 완료</b><br>${esc(summary)}<br><span style="font-size:11px;color:#888;margin-top:4px;display:block">⚠️ 이름이 틀렸다면 아래 표에서 직접 클릭해서 수정하세요</span>`;
    $('excel-preview').prepend(sumEl);
  }

  renderAIPreviewTable();
}

function updateAIParsed(){
  const y=parseInt($('ai-year')?.value)||parsedExcel.year;
  const m=parseInt($('ai-month')?.value)||parsedExcel.month;
  parsedExcel={...parsedExcel, year:y, month:m};
}

// ★ 두 달치 미리보기
function showAIPreviewMulti(months, summary, fileName){
  if(!months?.length) return;

  // 각 월 데이터를 parsedExcelMulti에 저장
  window.parsedExcelMulti = months.map(m => ({...m, fileName}));

  $('upload-zone').style.display='none';
  $('excel-preview').style.display='block';
  $('excel-preview').querySelectorAll('.ai-summary-box').forEach(el=>el.remove());

  // 요약 박스
  if(summary){
    const sumEl=document.createElement('div');
    sumEl.className='ai-summary-box';
    sumEl.style.cssText='background:#f0f5fd;border-radius:10px;padding:10px 13px;font-size:12px;color:#185FA5;margin-bottom:10px;line-height:1.6;border:1px solid #dbeafe';
    sumEl.innerHTML=`🤖 <b>AI 분석 완료 — ${months.length}개월치 감지</b><br>${esc(summary)}`;
    $('excel-preview').prepend(sumEl);
  }

  // 월별 탭 UI
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let tabHtml = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">`;
  months.forEach((m,i) => {
    tabHtml += `<button onclick="showAIMonthTab(${i})" id="ai-month-tab-${i}"
      style="padding:7px 16px;border-radius:10px;border:1.5px solid ${i===0?'#185FA5':'#ddd'};
      background:${i===0?'#185FA5':'#fff'};color:${i===0?'#fff':'#888'};
      font-size:13px;font-weight:700;cursor:pointer">
      ${m.year}년 ${MN[m.month]}
    </button>`;
  });
  tabHtml += `</div>`;

  $('excel-info').innerHTML = tabHtml;

  // 첫 번째 월 표시
  showAIMonthTab(0);

  // 저장 버튼을 "전체 저장"으로 교체
  const saveBtn = document.querySelector('[onclick="applyExcelSchedule()"]');
  if(saveBtn) {
    saveBtn.textContent = '전체 저장 (두 달치)';
    saveBtn.onclick = applyExcelScheduleMulti;
  }
}

function showAIMonthTab(idx){
  const months = window.parsedExcelMulti;
  if(!months || idx >= months.length) return;

  // 탭 버튼 스타일 업데이트
  months.forEach((_,i) => {
    const btn = document.getElementById(`ai-month-tab-${i}`);
    if(btn){
      btn.style.background = i===idx ? '#185FA5' : '#fff';
      btn.style.color = i===idx ? '#fff' : '#888';
      btn.style.borderColor = i===idx ? '#185FA5' : '#ddd';
    }
  });

  // 현재 탭 parsedExcel에 설정
  parsedExcel = months[idx];

  // 테이블 렌더링
  renderAIPreviewTable();
}

async function applyExcelScheduleMulti(){
  const months = window.parsedExcelMulti;
  if(!months?.length) return applyExcelSchedule();

  for(const m of months){
    parsedExcel = m;
    await applyExcelSchedule();
    await new Promise(r=>setTimeout(r,500));
  }
  window.parsedExcelMulti = null;
  showToastMsg(`${months.length}개월치 저장 완료!`);
}

function renderAIPreviewTable(){
  if(!parsedExcel) return;
  const {data} = parsedExcel;
  const names=Object.keys(data);
  const allDays=[...new Set(names.flatMap(n=>Object.keys(data[n]).map(Number)))].sort((a,b)=>a-b);

  let th='<tr><th>이름 (클릭시 수정)</th>';
  allDays.forEach(d=>th+=`<th>${d}일</th>`);
  th+='</tr>';

  const tb=names.map((name)=>{
    const dd=data[name];
    let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap;cursor:pointer;color:#185FA5" onclick="editAIName('${esc(name)}')" title="클릭해서 이름 수정">✏️ ${esc(name)}</td>`;
    allDays.forEach(d=>{
      const v=dd[String(d)]||'';
      const c=v?tc(v):null;
      r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600;cursor:pointer"`:' style="cursor:pointer;color:#ddd"'}
        onclick="editAICell('${esc(name)}',${d})"
        title="${v?v:'클릭해서 추가'}">${v?v.replace(/[\[\]]/g,'').slice(0,6):'+'}</td>`;
    });
    return r+'</tr>';
  }).join('');

  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>사역자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...new Set(names.flatMap(n=>Object.values(data[n]||{})))].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
}

function editAICell(name, day){
  if(!parsedExcel?.data) return;
  const current = parsedExcel.data[name]?.[String(day)] || '';
  // 수정 모달
  document.getElementById('ai-cell-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ai-cell-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`
    <div style="background:#fff;border-radius:18px;padding:22px;width:100%;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div style="font-size:15px;font-weight:700;color:#185FA5;margin-bottom:4px">✏️ 사역 수정</div>
      <div style="font-size:12px;color:#888;margin-bottom:14px">${esc(name)} · ${day}일</div>
      <input id="ai-cell-input" type="text" value="${esc(current)}" placeholder="예: [새벽]설교 (비우면 삭제)"
        style="width:100%;padding:10px 12px;border:1.5px solid #185FA5;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:inherit">
      <div style="font-size:11px;color:#aaa;margin:8px 0 14px;line-height:1.6">
        예시: [새벽]설교 / [새벽]자막 / [저녁]설교 / [저녁]인도<br>비워두면 해당 날짜 사역이 삭제됩니다
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('ai-cell-modal').remove()" style="flex:1;padding:11px;border:1.5px solid #e0e0e0;background:#fff;border-radius:10px;font-size:13px;font-weight:600;color:#888;cursor:pointer">취소</button>
        <button onclick="saveAICell('${esc(name)}',${day})" style="flex:2;padding:11px;background:#185FA5;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">저장</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.remove(); });
  setTimeout(()=>document.getElementById('ai-cell-input')?.focus(), 100);
}

function saveAICell(name, day){
  const val = document.getElementById('ai-cell-input')?.value?.trim();
  if(!parsedExcel?.data[name]) parsedExcel.data[name]={};
  if(val){
    parsedExcel.data[name][String(day)] = val;
  } else {
    delete parsedExcel.data[name][String(day)];
  }
  document.getElementById('ai-cell-modal')?.remove();
  renderAIPreviewTable();
  showToastMsg(val ? `${day}일 사역 수정됨` : `${day}일 사역 삭제됨`);
}

function editAIName(oldName){
  const newName = prompt(`이름 수정: "${oldName}"`, oldName);
  if(!newName || newName===oldName) return;
  if(!parsedExcel?.data) return;
  // 데이터에서 이름 교체
  const data = parsedExcel.data;
  data[newName] = data[oldName];
  delete data[oldName];
  parsedExcel.data = data;
  renderAIPreviewTable();
  showToastMsg(`"${oldName}" → "${newName}" 수정됨`);
}

function parseExcelFile(file){const reader=new FileReader();reader.onload=e=>{try{const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});// 형식 자동 감지: 1행에 '이름'이 있으면 기존 형식, 없으면 새 형식
    const header=rows[0]||[];const hasNameCol=header.some(h=>h&&String(h).trim()==='이름');
    if(hasNameCol){processExcelRows(rows,file.name,wb.SheetNames[0]);}
    else{processExcelRows2(rows,file.name,wb.SheetNames[0]);}
  }catch(err){showExcelErr('파일 읽기 오류: '+err.message);}};reader.readAsArrayBuffer(file);}

// ★ 새 형식 파서: 날짜가 열, 이름이 셀값인 형식
// 구조: 날짜행(5월 4일...) + 사역행(설교: 이름, 방송실: 이름...)
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
      // 날짜행 발견 → 다음 행들이 사역행
      let j=i+1;
      while(j<rows.length){
        const shiftRow=rows[j];
        if(!shiftRow||shiftRow.every(v=>v==null)){j++;break;}
        // 첫 셀이 사역유형인지 확인
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
  if(!names.length){showExcelErr('사역자 데이터를 찾을 수 없습니다. 파일 형식을 확인해주세요.');return;}

  parsedExcel={year,month,data:result,fileName};
  assignColors([...types]);

  // 미리보기
  $('upload-zone').style.display='none';$('excel-preview').style.display='block';
  $('excel-info').textContent=`${year}년 ${month}월 · 사역자 ${names.length}명 · 유형 ${types.size}종`;
  const days=[...new Set(names.flatMap(n=>Object.keys(result[n]).map(Number)))].sort((a,b)=>a-b);
  let th='<tr><th>이름</th>';days.forEach(d=>th+=`<th>${d}</th>`);th+='</tr>';
  const tb=names.map(name=>{const dd=result[name];let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap">${name}</td>`;days.forEach(d=>{const v=dd[String(d)]||'';const c=v?tc(v.split('/')[0]):null;r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600"`:''} title="${v}">${v?v.replace(/[\[\]]/g,'').slice(0,6):''}</td>`;});return r+'</tr>';}).join('');
  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>사역자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...types].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
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
  const names=Object.keys(result);if(!names.length){showExcelErr('사역자 데이터를 찾을 수 없습니다.');return;}
  parsedExcel={year,month,data:result,fileName:fileName};assignColors([...types]);
  $('upload-zone').style.display='none';$('excel-preview').style.display='block';
  $('excel-info').textContent=`${year}년 ${month}월 · 사역자 ${names.length}명 · 유형 ${types.size}종`;
  let th='<tr><th>이름</th>';dateCols.forEach(({d})=>th+=`<th>${d}</th>`);th+='</tr>';
  const tb=names.map(name=>{const dd=result[name];let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap">${name}</td>`;dateCols.forEach(({d})=>{const v=dd[String(d)]||'';const c=v?tc(v):null;r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600"`:''} title="${v}">${v?v.replace(/[\[\]]/g,'').slice(0,4):''}</td>`;});return r+'</tr>';}).join('');
  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>사역자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...types].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
}
function showExcelErr(msg){clearExcel();const t=$('excel-err-toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',5000);}
function clearExcel(){parsedExcel=null;$('upload-zone').style.display='block';$('excel-preview').style.display='none';$('excel-err-toast').style.display='none';}

// 월별 업로드된 파일명 기록 (메모리)
const uploadedFiles = {};
// 되돌리기용 이전 데이터 저장
let undoData = null;
let undoTimer = null;

// ★ 안전장치 설정 (localStorage 저장)
function getUploadSettings(){
  try { return JSON.parse(localStorage.getItem('ws_upload_settings')||'{}'); } catch { return {}; }
}
function saveUploadSettings(s){ localStorage.setItem('ws_upload_settings', JSON.stringify(s)); }

async function applyExcelSchedule(){
  if(!parsedExcel)return;
  // ★ 입력창에서 수정된 년도/월 반영
  const editedYear = parseInt($('ai-year')?.value) || parsedExcel.year;
  const editedMonth = parseInt($('ai-month')?.value) || parsedExcel.month;
  parsedExcel.year = editedYear;
  parsedExcel.month = editedMonth;
  const{year,month,data,fileName}=parsedExcel;
  const settings=getUploadSettings();
  const isSpecial = currentUploadType === 'special';

  if(!allSchedules[year]) allSchedules[year]={};
  if(!uploadedFiles[year]) uploadedFiles[year]={};
  if(!uploadedFiles[year][month]) uploadedFiles[year][month]=new Set();

  const prevFiles=uploadedFiles[year][month];
  const hasExisting = Object.keys(allSchedules[year]?.[month]||{}).length > 0;
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const existingNames=Object.keys(allSchedules[year]?.[month]||{});

  // ★ 기존 데이터가 있으면 병합/덮어쓰기 선택 모달 표시
  if(hasExisting && !isSpecial){
    document.getElementById('merge-choice-modal')?.remove();
    const modal=document.createElement('div');
    modal.id='merge-choice-modal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML=`
      <div style="background:#fff;border-radius:18px;padding:22px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:15px;font-weight:700;color:#185FA5;margin-bottom:6px">📅 ${year}년 ${MN[month]} 사역표</div>
        <div style="font-size:12px;color:#888;margin-bottom:16px">기존 사역자: ${existingNames.slice(0,5).join(', ')}${existingNames.length>5?` 외 ${existingNames.length-5}명`:''}</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button onclick="doApplySchedule(${year},${month},true)" style="padding:14px;background:#E6F1FB;color:#185FA5;border:1.5px solid #185FA5;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;text-align:left">
            ➕ 병합 저장
            <div style="font-size:11px;font-weight:400;color:#378ADD;margin-top:3px">기존 사역표에 새 데이터를 추가합니다</div>
          </button>
          <button onclick="doApplySchedule(${year},${month},false)" style="padding:14px;background:#FDECEA;color:#e74c3c;border:1.5px solid #e74c3c;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;text-align:left">
            🔄 덮어쓰기
            <div style="font-size:11px;font-weight:400;color:#e74c3c;margin-top:3px">기존 사역표를 완전히 교체합니다</div>
          </button>
          <button onclick="document.getElementById('merge-choice-modal').remove()" style="padding:11px;background:#fff;color:#888;border:1.5px solid #e0e0e0;border-radius:12px;font-size:13px;cursor:pointer">취소</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return; // 모달 선택 대기
  }

  // 특별 사역표이거나 기존 데이터 없으면 바로 처리
  doApplySchedule(year, month, isSpecial || !hasExisting ? false : true);
}

async function doApplySchedule(year, month, isMerge){
  document.getElementById('merge-choice-modal')?.remove();
  if(!parsedExcel) return;

  const{data,fileName}=parsedExcel;
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const settings=getUploadSettings();
  const isSpecial = currentUploadType === 'special';

  if(!allSchedules[year]) allSchedules[year]={};
  if(!uploadedFiles[year]) uploadedFiles[year]={};
  if(!uploadedFiles[year][month]) uploadedFiles[year][month]=new Set();
  const prevFiles=uploadedFiles[year][month];

  // 되돌리기용 이전 상태 저장
  if(settings.enableUndo!==false){
    undoData={year,month,data:JSON.parse(JSON.stringify(allSchedules[year]?.[month]||{})),files:new Set(prevFiles)};
  }

  let finalData;
  if(isMerge){
    // 병합: 기존 데이터에 새 데이터 추가
    const existing=allSchedules[year][month]||{};
    finalData={...existing};
    Object.entries(data).forEach(([name,days])=>{
      if(!finalData[name]) finalData[name]={};
      Object.entries(days).forEach(([day,type])=>{
        if(finalData[name][day]){
          if(!finalData[name][day].includes(type)) finalData[name][day]+='/'+type;
        } else {
          finalData[name][day]=type;
        }
      });
    });
  } else {
    finalData=data;
  }

  prevFiles.add(fileName);

  // ★ 변경된 사역자 감지 (알림 발송용)
  const prevData = undoData?.data || {};
  const changedWorkers = [];
  const MN2=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DN2=['일','월','화','수','목','금','토'];

  Object.entries(finalData).forEach(([name, days])=>{
    Object.entries(days||{}).forEach(([day, type])=>{
      const prevType = prevData[name]?.[day];
      if(prevType !== type){
        // 새로 추가되거나 변경된 사역
        const u = allMembers.find(m=>m.name===name);
        if(u) changedWorkers.push({userId: u.id, name, day: parseInt(day), type, isNew: !prevType});
      }
    });
  });

  allSchedules[year][month]=finalData;
  assignColors(collectAllTypes());filterType='';curY=year;curM=month-1;

  if(!OFFLINE){
    const{error}=await sb.from('schedules').upsert(
      {year,month,data:finalData,type:currentUploadType,updated_by:cu.id,updated_at:new Date().toISOString()},
      {onConflict:'year,month,type'}
    );
    if(error){showExcelErr('저장 오류: '+error.message);return;}

    // ★ 변경된 사역자들에게 FCM 알림 발송
    if(changedWorkers.length){
      // 사역자별로 그룹핑
      const byUser={};
      changedWorkers.forEach(({userId,name,day,type,isNew})=>{
        if(!byUser[userId]) byUser[userId]={userId,name,shifts:[]};
        byUser[userId].shifts.push({day,type,isNew});
      });

      for(const {userId,name,shifts} of Object.values(byUser)){
        const shiftDesc = shifts.slice(0,3).map(({day,type,isNew})=>{
          const dow=DN2[new Date(year,month-1,day).getDay()];
          return `${month}월 ${day}일(${dow}) ${type}`;
        }).join(', ');
        const title = shifts[0].isNew ? '📅 사역 등록 알림' : '📝 사역 변경 알림';
        const body = shifts[0].isNew
          ? `${shiftDesc} 사역이 등록되었습니다.`
          : `${shiftDesc} 사역이 변경되었습니다.`;

        sendPushToUsers([userId], title, body).catch(e=>console.warn('push err:', e));
      }
      console.log(`[알림] ${Object.keys(byUser).length}명에게 사역 알림 발송`);
    }

    await refreshSchedules();
  }

  clearExcel();switchTab('cal',$('btn-cal'));renderCalendar();buildSchedPreview();

  // ★ 안전장치 2: 되돌리기 토스트
  if(settings.enableUndo!==false && undoData){
    showUndoToast(isMerge?`'${fileName}' 병합 완료`:isSameFile?`'${fileName}' 수정본 적용`:`${year}년 ${MN[month]} 사역표 저장 완료`);
  } else {
    toast('excel-toast');
  }
}

function showUndoToast(msg){
  if(undoTimer){clearTimeout(undoTimer);undoTimer=null;}
  let el=$('undo-toast');
  if(!el){
    el=document.createElement('div');el.id='undo-toast';
    el.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1c1c1a;color:#fff;padding:12px 16px;border-radius:14px;z-index:99;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.3);white-space:nowrap;font-size:13px';
    document.body.appendChild(el);
  }
  el.innerHTML=`<span>✅ ${esc(msg)}</span><button onclick="doUndo()" style="padding:5px 12px;background:#185FA5;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">되돌리기</button><span id="undo-countdown" style="color:#aaa;font-size:11px">30</span>`;
  el.style.display='flex';
  let sec=30;
  const tick=setInterval(()=>{sec--;const cd=$('undo-countdown');if(cd)cd.textContent=sec;if(sec<=0){clearInterval(tick);el.style.display='none';undoData=null;}},1000);
  undoTimer=setTimeout(()=>{clearInterval(tick);el.style.display='none';undoData=null;},30000);
}

async function doUndo(){
  if(!undoData){showToastMsg('되돌릴 데이터가 없습니다.');return;}
  const{year,month,data,files}=undoData;
  if(!confirm('이전 사역표로 되돌리시겠습니까?'))return;
  if(!allSchedules[year])allSchedules[year]={};
  allSchedules[year][month]=data;
  if(uploadedFiles[year]?.[month]) uploadedFiles[year][month]=files;
  assignColors(collectAllTypes());filterType='';
  if(!OFFLINE){
    await sb.from('schedules').upsert({year,month,data,type:currentUploadType,updated_by:cu.id,updated_at:new Date().toISOString()},{onConflict:'year,month,type'});
    await refreshSchedules();
  }
  $('undo-toast').style.display='none';
  if(undoTimer){clearTimeout(undoTimer);undoTimer=null;}
  undoData=null;
  renderCalendar();buildSchedPreview();
  showToastMsg('이전 사역표로 되돌렸습니다.');
}
function buildSchedPreview(){
  const el=$('sched-form'),allMonths=[];
  const filterType = currentUploadType;
  // ★ 해당 타입의 원본 데이터가 있는 월만 표시
  Object.entries(scheduleTypes).forEach(([y,ym])=>Object.entries(ym).forEach(([m,types])=>{
    if(types[filterType]) allMonths.push({y:parseInt(y),m:parseInt(m)});
  }));
  allMonths.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);
  if(!allMonths.length){el.innerHTML='<p class="empty-state">업로드된 사역표가 없습니다.</p>';return;}
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let html='';
  allMonths.forEach(({y,m})=>{
    const d=scheduleTypes[y]?.[m]?.[filterType]||{},names=Object.keys(d);
    const key=`sched-${y}-${m}`;
    const isOpen=collapseState[key]===true;
    const totalDays=names.reduce((s,n)=>s+Object.keys(d[n]||{}).length,0);
    html+=`<div style="margin-bottom:8px;background:#f8f8f4;border-radius:12px;overflow:hidden;border:1px solid #ececea">
      <div onclick="toggleCollapse('${key}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none">
        <div>
          <div style="font-size:13px;font-weight:700;color:#185FA5">${y}년 ${MN[m]}</div>
          <div style="font-size:11px;color:#aaa;margin-top:2px">사역자 ${names.length}명 · 총 ${totalDays}건</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button onclick="event.stopPropagation();editSchedMonth(${y},${m})" style="padding:5px 10px;background:#E6F1FB;color:#185FA5;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer">✏️ 수정</button>
          <button onclick="event.stopPropagation();deleteSchedMonth(${y},${m})" style="padding:5px 10px;background:#FDECEA;color:#e74c3c;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer">🗑️ 삭제</button>
          <button class="collapse-btn" style="border:none;background:none;color:#aaa;font-size:12px;cursor:pointer;padding:2px 6px">${isOpen?'▲':'▼'}</button>
        </div>
      </div>
      <div data-collapse="${key}" style="display:${isOpen?'block':'none'};padding:0 14px 12px">
        ${names.map(name=>{
          const wd=d[name]||{},days=Object.keys(wd).map(Number).sort((a,b)=>a-b);
          const approved=allMembers.some(u=>u.name===name);
          return`<div class="sched-preview-row">
            <span class="sched-name">${name}${!approved?` <span class="unregistered-tag">미가입</span>`:''}</span>
            <span class="sched-days">${days.map(d2=>{
              const t=wd[String(d2)],c=t?tc(t):null;
              return c
                ?`<span class="day-chip" style="background:${c.bg};color:${c.text};border:1px solid ${c.border};cursor:pointer" title="${t}" onclick="editSchedCell('${name}',${y},${m},${d2},'${t}')">${d2}</span>`
                :`<span class="day-chip">${d2}</span>`;
            }).join('')}</span>
          </div>`;
        }).join('')}
        <button onclick="addSchedRow(${y},${m})" style="margin-top:8px;padding:6px 14px;background:#185FA5;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">+ 사역자 추가</button>
      </div>
    </div>`;
  });
  el.innerHTML=html;
}

// ★ 사역표 셀 수정
function editSchedCell(name, y, m, day, currentType){
  document.getElementById('sched-edit-modal')?.remove();
  const modal=document.createElement('div');
  modal.id='sched-edit-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`
    <div style="background:#fff;border-radius:18px;padding:22px;width:100%;max-width:360px">
      <div style="font-size:15px;font-weight:700;color:#185FA5;margin-bottom:4px">✏️ 사역 수정</div>
      <div style="font-size:12px;color:#888;margin-bottom:12px">${name} · ${y}년 ${m}월 ${day}일</div>
      <input id="sched-edit-input" type="text" value="${esc(currentType)}"
        style="width:100%;padding:10px 12px;border:1.5px solid #185FA5;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:inherit">
      <div style="font-size:11px;color:#aaa;margin:6px 0 14px">비우면 해당 사역 삭제</div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('sched-edit-modal').remove()" style="flex:1;padding:11px;border:1.5px solid #e0e0e0;background:#fff;border-radius:10px;font-size:13px;color:#888;cursor:pointer">취소</button>
        <button onclick="saveSchedCell('${name}',${y},${m},${day})" style="flex:2;padding:11px;background:#185FA5;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">저장</button>
      </div>
    </div>`;
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
  setTimeout(()=>document.getElementById('sched-edit-input')?.focus(),100);
}

async function saveSchedCell(name,y,m,day){
  const val=document.getElementById('sched-edit-input')?.value?.trim();
  const data=getMonthData(y,m);
  if(!data[name]) data[name]={};
  if(val){ data[name][String(day)]=val; }
  else { delete data[name][String(day)]; }
  // 해당 type 원본 업데이트
  if(!scheduleTypes[y]) scheduleTypes[y]={};
  if(!scheduleTypes[y][m]) scheduleTypes[y][m]={};
  scheduleTypes[y][m][currentUploadType]=data;
  if(!OFFLINE) await sb.from('schedules').upsert({year:y,month:m,data,type:currentUploadType,updated_by:cu.id,updated_at:new Date().toISOString()},{onConflict:'year,month,type'});
  document.getElementById('sched-edit-modal')?.remove();
  assignColors(collectAllTypes());
  renderCalendar();
  buildSchedPreview();
  showToastMsg('수정되었습니다.');
}

// ★ 사역자 행 추가
function addSchedRow(y,m){
  const name=prompt('추가할 사역자 이름:'); if(!name?.trim()) return;
  const data=getMonthData(y,m);
  if(!data[name.trim()]) data[name.trim()]={};
  buildSchedPreview();
  showToastMsg(`${name} 추가됨. 날짜를 클릭해서 사역을 입력하세요.`);
}

// ★ 월 전체 삭제
async function deleteSchedMonth(y,m){
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  if(!confirm(`${y}년 ${MN[m]} 사역표를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  if(allSchedules[y]) delete allSchedules[y][m];
  if(!OFFLINE) await sb.from('schedules').delete().eq('year',y).eq('month',m).eq('type',currentUploadType);
  // 메모리에서도 해당 type 제거
  if(scheduleTypes[y]?.[m]) delete scheduleTypes[y][m][currentUploadType];
  // allSchedules 재병합
  const remaining=Object.values(scheduleTypes[y]?.[m]||{});
  if(remaining.length){const merged={};remaining.forEach(d=>Object.entries(d).forEach(([n,days])=>{if(!merged[n])merged[n]={};Object.assign(merged[n],days);}));allSchedules[y][m]=merged;}else{delete allSchedules[y][m];}
  renderCalendar();
  buildSchedPreview();
  showToastMsg(`${y}년 ${MN[m]} 사역표가 삭제되었습니다.`);
}

// ★ 월 전체 수정 (미리보기로 열기)
function editSchedMonth(y,m){
  const data=getMonthData(y,m);
  parsedExcel={year:y,month:m,data:JSON.parse(JSON.stringify(data)),fileName:`${y}년 ${m}월 수정`};
  $('upload-zone').style.display='none';
  $('excel-preview').style.display='block';
  $('excel-preview').querySelectorAll('.ai-summary-box').forEach(e=>e.remove());
  $('excel-info').innerHTML=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="font-size:12px;color:#888">${y}년 ${m}월 사역표 수정 중 —</span>
    <span style="font-size:13px;font-weight:700;color:#185FA5">${y}년 ${m}월</span>
  </div>`;
  renderAIPreviewTable();
  // 저장 버튼 텍스트 변경
  const saveBtn=document.querySelector('[onclick="applyExcelSchedule()"]');
  if(saveBtn) saveBtn.textContent='수정 내용 저장';
  // 관리자 탭에서 스크롤
  switchTab('admin',$('btn-admin'));
  setTimeout(()=>$('excel-preview')?.scrollIntoView({behavior:'smooth'}),300);
}

// ══════════════════════════════════════════════════
//  프로필 이미지
// ══════════════════════════════════════════════════
function updateHeaderAvatar(){
  const av=$('hdr-avatar'); if(!av) return;
  if(cu.avatar){
    av.style.backgroundImage=`url(${cu.avatar})`;
    av.style.backgroundSize='cover';
    av.style.backgroundPosition='center';
    av.textContent='';
  } else {
    av.style.backgroundImage='';
    av.textContent=cu.name[0];
  }
}

function openProfileModal(){
  const modal=$('profile-modal'); if(!modal) return;
  const img=$('profile-modal-img');
  const txt=$('profile-modal-txt');
  const nameEl=$('profile-modal-name');
  if(nameEl) nameEl.textContent=cu.name;
  if(cu.avatar){
    img.src=cu.avatar; img.style.display='block';
    txt.style.display='none';
  } else {
    img.style.display='none';
    txt.style.display='flex'; txt.textContent=cu.name[0];
  }
  $('profile-preview-wrap').style.display='none';
  modal.style.display='flex';
}

function closeProfileModal(){
  $('profile-modal').style.display='none';
  $('profile-preview-wrap').style.display='none';
}

function openProfileEdit(){
  $('profile-file-input').click();
}

function handleProfileFile(inp){
  const file=inp.files[0]; if(!file) return;
  if(!file.type.startsWith('image/')){showToastMsg('이미지 파일만 선택해주세요.');return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const dataUrl=e.target.result;
    // 이미지 압축 (최대 300x300)
    const canvas=document.createElement('canvas');
    const imgEl=new Image();
    imgEl.onload=()=>{
      const size=300;
      const ratio=Math.min(size/imgEl.width, size/imgEl.height);
      canvas.width=imgEl.width*ratio;
      canvas.height=imgEl.height*ratio;
      canvas.getContext('2d').drawImage(imgEl,0,0,canvas.width,canvas.height);
      const compressed=canvas.toDataURL('image/jpeg',0.7);
      // 미리보기 표시
      $('profile-preview-img').src=compressed;
      $('profile-preview-wrap').style.display='block';
      $('profile-preview-wrap').dataset.avatar=compressed;
    };
    imgEl.src=dataUrl;
  };
  reader.readAsDataURL(file);
  inp.value='';
}

async function saveProfileImage(){
  const wrap=$('profile-preview-wrap'); if(!wrap) return;
  const avatar=wrap.dataset.avatar; if(!avatar) return;
  cu.avatar=avatar;
  updateHeaderAvatar();
  if(!OFFLINE) await sb.from('app_users').update({avatar}).eq('id',cu.id);
  // 세션에도 저장
  const raw=localStorage.getItem('ws_session');
  if(raw){ try{ const s=JSON.parse(raw); localStorage.setItem('ws_session',JSON.stringify({...s})); }catch{} }
  closeProfileModal();
  showToastMsg('프로필 이미지가 저장되었습니다.');
}

function cancelProfileEdit(){
  $('profile-preview-wrap').style.display='none';
}

// ══════════════════════════════════════════════════
//  외부 탭 시 닫기 — 전역 클릭 핸들러
// ══════════════════════════════════════════════════
document.addEventListener('click', e=>{
  // 알림 패널
  const alarmPanel=$('alarm-panel');
  const alarmBtn=$('btn-alarm');
  if(alarmPanel&&alarmPanel.style.display!=='none'){
    if(!alarmPanel.contains(e.target)&&!alarmBtn?.contains(e.target)){
      alarmPanel.style.display='none';
    }
  }
}, true);

// ══════════════════════════════════════════════════
//  접기/펼치기 상태 관리
// ══════════════════════════════════════════════════
const collapseState = {}; // { 'sched-2026-5': false, 'shift-list': false }

function toggleCollapse(key, btnEl){
  collapseState[key] = !collapseState[key]; // true=펼침
  const content=document.querySelector(`[data-collapse="${key}"]`);
  if(!content) return;
  content.style.display=collapseState[key]?'block':'none';
  if(btnEl) btnEl.textContent=collapseState[key]?'▲':'▼';
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
function escNl(s){return esc(s).replace(/\n/g,"<br>").replace(/\r/g,"");}
function fmtDate(s){if(!s)return'';try{const d=new Date(s);return`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;}catch{return'';}}
