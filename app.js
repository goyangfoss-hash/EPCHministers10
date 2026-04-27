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
let allSchedules = {};
const getMonthData = (y, m) => allSchedules[y]?.[m] || {};
const curData = () => getMonthData(curY, curM + 1);
let allMembers = [], notices = [], feedPosts = [];
let shiftComments = {}, commentLikes = {}, modalDate = null, parsedExcel = null;
let myShiftYear = new Date().getFullYear(), myShiftMonth = new Date().getMonth() + 1;
let srchYear = 0, srchMonth = 0, srchName = '';

// 채팅 상태
let chatMessages = {};   // { userId: [messages] }
let chatTarget = null;   // 현재 채팅 상대
let dmUnreadCount = 0;

// ── 알림 & 메모 (localStorage 저장) ──────────────
let shiftAlarms = {};
function loadAlarms()  { try { shiftAlarms = JSON.parse(localStorage.getItem('ws_alarms') || '{}'); } catch { shiftAlarms = {}; } }
function saveAlarms()  { localStorage.setItem('ws_alarms', JSON.stringify(shiftAlarms)); }
function getDefaultAlarmTime(){ try{ return JSON.parse(localStorage.getItem('ws_notif_settings')||'{}').defaultAlarmTime||'18:30'; }catch{ return '18:30'; } }
function getAlarm(y,m,d) { return shiftAlarms[`${y}-${m}-${d}`] || { alarm: false, alarmTime: getDefaultAlarmTime(), memo: '' }; }
function setAlarm(y,m,d,data) { shiftAlarms[`${y}-${m}-${d}`] = data; saveAlarms(); }
function activeAlarmCount() {
  const now = new Date();
  return Object.entries(shiftAlarms).filter(([k,v]) => {
    if (!v.alarm) return false;
    const [y,m,d] = k.split('-').map(Number);
    return new Date(y, m-1, d) >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }).length;
}

// ★ 로그인 후 본인 근무에 알림 자동 설정 (기존에 alarm=false인 날짜만 자동 설정)
function autoSetMyShiftAlarms(){
  if(Notification.permission!=='granted') return; // 알림 권한 없으면 skip
  const defaultTime = getDefaultAlarmTime();
  const now = new Date();
  let newCount = 0;
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myData = data[cu.name]||{};
      Object.keys(myData).forEach(ds=>{
        const d=parseInt(ds);
        const dt=new Date(parseInt(y),parseInt(m)-1,d);
        if(dt < new Date(now.getFullYear(),now.getMonth(),now.getDate())) return; // 지난 날짜 skip
        const key=`${y}-${m}-${d}`;
        // 아직 설정된 적 없는 날만 자동 설정
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
    const {data,error}=await sb.from('schedules').select('year,month,data').order('year').order('month');
    if (error) throw error;
    allSchedules={};
    (data||[]).forEach(r=>{if(!allSchedules[r.year])allSchedules[r.year]={};allSchedules[r.year][r.month]=r.data||{};});
    assignColors(collectAllTypes());
    renderCalendar();
    if($('tab-myshift')?.style.display!=='none') renderMyShift();
    if($('tab-search')?.style.display!=='none') renderSearchResult();
    if(isAdmin()&&$('tab-admin')?.style.display!=='none') buildSchedPreview();
    if(cu) autoSetMyShiftAlarms(); // ★ 새 근무 등록 시 자동 알림
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
  $('hdr-name').textContent=cu.name;
  // ★ 프로필 이미지 or 이름 첫 글자
  updateHeaderAvatar();
  $('btn-admin').style.display=isAdmin()?'flex':'none';
  assignColors(collectAllTypes());
  // 모든 이용자에게 내 근무만/전체 보기 토글 표시
  const toggleWrap=$('view-toggle-wrap');
  if(toggleWrap){
    toggleWrap.innerHTML=`<button id="btn-my-ministry" onclick="toggleMyMinistry()" class="my-ministry-btn">
      <span style="font-size:14px">🙋</span> 내 사역
    </button>`;
  }
  renderCalendar(); renderNotices(); updateAlarmBadge();
  if(isAdmin()) renderAdmin();
  updateFeedBadge();
  startRealtime();
  if(!OFFLINE){if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>refreshSchedules(),5*60*1000);}
  scheduleLocalAlarms();
  autoSetMyShiftAlarms(); // ★ 로그인 후 본인 근무 자동 알림 설정
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
        ${denied?'알림이 차단되어 있습니다.<br>브라우저 주소창 자물쇠 아이콘을 눌러<br>알림을 허용으로 변경해주세요.':unsupported?'이 브라우저는 알림을 지원하지 않습니다.<br>Chrome 앱으로 접속하면 알림을 받을 수 있습니다.':'근무 전날 알림·공지·댓글을<br>기기에서 바로 받을 수 있습니다.'}
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
      setTimeout(()=>pushNotify('근무표 앱 알림 설정 완료','이제 근무 전날 알림을 기기에서 받을 수 있습니다.','shift'),800);
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
  const now=new Date();
  // 모든 달의 본인 근무에 대해 알람 스케줄링
  Object.entries(allSchedules).forEach(([y,ym])=>{
    Object.entries(ym).forEach(([m,data])=>{
      const myD=data[cu.name]||{};
      Object.entries(myD).forEach(([ds,type])=>{
        const d=parseInt(ds);
        const alarm=getAlarm(parseInt(y),parseInt(m),d);
        if(!alarm.alarm) return;
        const[h,mn]=(alarm.alarmTime||getDefaultAlarmTime()).split(':').map(Number);
        const alarmDt=new Date(parseInt(y),parseInt(m)-1,d-1,h,mn,0);
        const ms=alarmDt-now;
        if(ms>0&&ms<24*60*60*1000) setTimeout(()=>pushNotify(`내일 근무 알림 (${type})`,`${y}년 ${m}월 ${d}일 근무가 내일입니다.`,'shift'),ms);
      });
    });
  });
}

// ★ 모든 패널 닫기 (상호 배타적)
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

function renderAlarmPanel(){
  const el=$('alarm-panel-list');
  const MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DN=['일','월','화','수','목','금','토'];

  // ★ 알림 설정된 근무만 표시 (전체 저장된 알람에서 alarm=true인 것)
  const alarmDays=[];
  Object.entries(shiftAlarms).forEach(([key,v])=>{
    if(!v.alarm) return;
    const[y,m,d]=key.split('-').map(Number);
    // 본인 근무인지 확인
    const myData=getMonthData(y,m)[cu.name]||{};
    const type=myData[String(d)];
    if(!type) return;
    alarmDays.push({y,m,d,type,alarm:v});
  });
  alarmDays.sort((a,b)=>a.y!==b.y?a.y-b.y:a.m!==b.m?a.m-b.m:a.d-b.d);

  if(!alarmDays.length){
    el.innerHTML='<p style="font-size:13px;color:#bbb;padding:16px;text-align:center">설정된 알림이 없습니다<br><span style="font-size:11px">근무일을 탭해서 알림을 설정하세요</span></p>';
    return;
  }
  el.innerHTML=alarmDays.map(({y,m,d,type,alarm})=>{
    const c=type?tc(type):null;
    const dow=new Date(y,m-1,d).getDay();
    const now=new Date();
    const isPast=new Date(y,m-1,d)<new Date(now.getFullYear(),now.getMonth(),now.getDate());
    return`<div class="alarm-item${isPast?' past-card':''}" onclick="viewDayInCal(${y},${m-1},${d});toggleAlarmPanel()">
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <div class="alarm-day-num" ${c?`style="background:${c.bg};color:${c.dot}"`:''}>${d}</div>
        <div>
          <div style="font-size:13px;font-weight:600">${y}년 ${MN[m-1]} ${d}일 <span style="color:#aaa;font-weight:400">${DN[dow]}</span></div>
          ${type&&c?`<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span>`:''}
          <div style="font-size:11px;color:#888;margin-top:3px">⏰ ${alarm.alarmTime||'09:00'} 알림</div>
          ${alarm.memo?`<div style="font-size:11px;color:#888;margin-top:2px">📝 ${esc(alarm.memo)}</div>`:''}
        </div>
      </div>
      <div onclick="event.stopPropagation()">
        <div class="toggle${alarm.alarm?' on':''}" onclick="toggleShiftAlarm(${y},${m},${d})"></div>
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
  closeAllPanels(); // ★ 탭 전환 시 모든 패널 닫기
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  ['cal','myshift','search','notice','feed','admin'].forEach(t=>$(`tab-${t}`).style.display=t===tab?'block':'none');
  $('hdr-title').textContent={cal:'사역스케줄',myshift:'내 사역',search:'사역 검색',notice:'공지사항',feed:'소통',admin:'관리자'}[tab]||tab;
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

// ★ 요일 + 근무유형으로 카테고리 판별
function getCategory(type, year, month, day){
  if(!type) return 'all';
  const t=type.split('/')[0]; // 병합된 경우 첫 번째

  // 날짜 정보가 있으면 요일 기반 판별
  if(year && month && day){
    const dow=new Date(year, month-1, day).getDay();
    const isSunday   = dow===0;
    const isWednesday= dow===3;
    const isFriday   = dow===5;
    const hasSaebyeok= t.includes('새벽');

    if(isSunday)    return '주일';
    if(isWednesday && !hasSaebyeok) return '수요';
    if(isFriday    && !hasSaebyeok) return '금요';
    if(hasSaebyeok) return '새벽'; // 평일 새벽 (수/금 포함)
    return '특새'; // 그 외
  }

  // 날짜 정보 없으면 키워드 기반 fallback
  if(t.includes('수요')) return '수요';
  if(t.includes('금요')) return '금요';
  if(t.includes('새벽')) return '새벽';
  if(t.includes('4부')||t.includes('저녁')||t.includes('오전')) return '주일';
  return '특새';
}

// 색상 간소화 — 근무 형태 키워드 기반
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
  filterCategory=catId;
  filterType='';
  renderCalendar();
}

function renderLegend(){
  const el=$('cal-legend'); if(!el) return;
  const d=curData();
  // ★ 날짜 정보 포함해서 카테고리 판별
  const activeCats=new Set();
  Object.keys(d).forEach(name=>{
    Object.entries(d[name]||{}).forEach(([day,type])=>{
      if(type) activeCats.add(getCategory(type, curY, curM+1, parseInt(day)));
    });
  });

  el.innerHTML=`<div class="cat-tab-wrap">
    ${CATEGORIES.filter(c=>c.id==='all'||activeCats.has(c.id)).map(c=>`
      <button class="cat-tab-btn${filterCategory===c.id?' active':''}" onclick="setCategoryFilter('${c.id}')">
        ${c.label}
      </button>`).join('')}
  </div>`;
}

// 카테고리 필터 적용된 근무 맵 생성
function getFilteredMap(allMap, myRaw, myDays){
  if(filterCategory==='all') return {fm:{...allMap}, fmMy:new Set(myDays)};
  const fm={};
  Object.entries(allMap).forEach(([day,ws])=>{
    const d=parseInt(day);
    const fw=ws.filter(w=>getCategory(w.type,curY,curM+1,d)===filterCategory);
    if(fw.length) fm[d]=fw;
  });
  const fmMy=new Set();
  myDays.forEach(d=>{
    if(getCategory(myRaw[String(d)],curY,curM+1,d)===filterCategory) fmMy.add(d);
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
      ? '<span style="font-size:14px">🙋</span> 내 사역 <span style="font-size:10px;opacity:.8">ON</span>'
      : '<span style="font-size:14px">🙋</span> 내 사역';
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
    const isMy=myDays.has(d),isToday=now.getFullYear()===curY&&now.getMonth()===curM&&now.getDate()===d;
    const dow=new Date(curY,curM,d).getDay(),key=`${curY}-${curM+1}-${d}`,cc=(shiftComments[key]||[]).length;
    const myType=myRaw[String(d)]||'',myC=myType?tc(myType):null,workers=fm[d]||[];
    const myModeActive=calView==='mine'&&!isAdmin();
    const myHasDay=fmMy.has(d);
    const alarm=isMy?getAlarm(curY,curM+1,d):null;
    const alarmOff=isMy&&alarm&&!alarm.alarm;

    if(myModeActive){
      // ★ 내 사역 모드: 내 사역 날 셀 전체 색칠, 없는 날 dimmed
      const dimmed=!myHasDay;
      const cls='cal-cell'+(dow===0?' sun':'')+(dow===6?' sat':'')+(dimmed?' dimmed':'');
      const bgColor=myHasDay&&myC?myC.dot:'';
      const cellStyle=myHasDay&&bgColor?`background:${bgColor};border-color:${bgColor};position:relative`:`position:relative`;
      const dayStyle=myHasDay?`color:#fff;font-weight:800`:``;
      const typeLabel=myHasDay&&myC?`<div class="my-type-label">${myType.replace(/[\[\]]/g,'').slice(0,5)}</div>`:'';
      const todayRing=isToday&&myHasDay?`<div style="position:absolute;inset:1px;border:2px solid rgba(255,255,255,.7);border-radius:6px;pointer-events:none"></div>`:'';
      const cmtBadge=cc&&myHasDay?`<div class="cmt-indicator" style="background:rgba(255,255,255,.3);color:#fff">${cc}</div>`:'';
      const alarmOffBadge=alarmOff?`<div style="font-size:9px;color:rgba(255,255,255,.5);position:absolute;bottom:2px;right:2px">🔕</div>`:'';
      html+=`<div class="${cls}" style="${cellStyle}" onclick="openDayModal(${d})">
        <div class="day-num-wrap"><span class="day-num" style="${dayStyle}">${d}</span></div>
        ${typeLabel}${cmtBadge}${todayRing}${alarmOffBadge}
      </div>`;
    } else {
      // ★ 전체 사역 모드: 기존 방식
      const dimmed=filterCategory!=='all'&&!workers.length;
      const cls='cal-cell'+(dow===0?' sun':'')+(dow===6?' sat':'')+(isToday?' today':'')+(dimmed?' dimmed':'');
      const cellStyle=isMy&&myC?`background:${myC.bg};border-color:${myC.border}`:'';
      const dots=workers.length?`<div class="shift-dots">${workers.slice(0,5).map(w=>`<div class="shift-dot" style="background:${w.c.dot}" title="${w.name}:${w.type}"></div>`).join('')}${workers.length>5?`<span class="more-dot">+${workers.length-5}</span>`:''}</div>`:'';
      const typeTip=myType&&myC?`<div class="type-tip" style="color:${myC.text}">${myType.replace(/[\[\]]/g,'').slice(0,4)}</div>`:'';
      const cmt=cc?`<div class="cmt-indicator">${cc}</div>`:'';
      const myDot=isMy&&myC?`<span class="my-dot" style="background:${myC.dot}"></span>`:'';
      const alarmOffBadge=alarmOff?`<div class="alarm-dot-cal" style="opacity:.4;font-size:9px">🔕</div>`:'';
      html+=`<div class="${cls}" style="${cellStyle}" onclick="openDayModal(${d})"><div class="day-num-wrap"><span class="day-num">${d}</span>${myDot}</div>${typeTip}${dots}${cmt}${alarmOffBadge}</div>`;
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
  const myModeActive=calView==='mine'&&!isAdmin();

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
    if(!any) bodyHtml=`<p class="empty-state">${filterCategory!=='all'?`${filterCategory} 사역 일정이 없습니다.`:'근무 일정이 없습니다. 엑셀을 업로드해주세요.'}</p>`;
  }

  el.innerHTML=headerHtml+`<div data-collapse="${key}" style="display:${isOpen?'block':'none'}">${bodyHtml}</div>`;
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
// ── 내 근무 탭 카테고리별 누적 통계 accordion ──────
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
  const el=$('myshift-content'),MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],DN=['일','월','화','수','목','금','토'],now=new Date();
  const myMonths=[];
  Object.entries(allSchedules).forEach(([y,ym])=>Object.entries(ym).forEach(([m,d])=>{if(d[cu.name])myMonths.push({y:parseInt(y),m:parseInt(m)});}));
  myMonths.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);
  if(!myMonths.length){el.innerHTML=`<div class="search-empty"><div style="font-size:36px;margin-bottom:12px">📅</div><div style="font-size:14px;font-weight:600;color:#888">등록된 근무 기록이 없습니다</div><div style="font-size:12px;color:#bbb;margin-top:6px;line-height:1.6">근무표에 '${cu.name}'님의 이름이<br>포함되면 여기서 확인할 수 있습니다</div></div>`;return;}
  if(!myMonths.find(x=>x.y===myShiftYear&&x.m===myShiftMonth)){myShiftYear=myMonths[0].y;myShiftMonth=myMonths[0].m;}

  const cumCount={};
  myMonths.forEach(({y,m})=>{Object.values(getMonthData(y,m)[cu.name]||{}).forEach(t=>{if(t)cumCount[t]=(cumCount[t]||0)+1;});});
  const cumTotal=Object.values(cumCount).reduce((s,v)=>s+v,0);
  const remaining=myMonths.reduce((s,{y,m})=>s+Object.keys(getMonthData(y,m)[cu.name]||{}).filter(d=>new Date(y,m-1,parseInt(d))>=new Date(now.getFullYear(),now.getMonth(),now.getDate())).length,0);
  const myRaw2=getMonthData(myShiftYear,myShiftMonth)[cu.name]||{},myDays=Object.keys(myRaw2).map(Number).sort((a,b)=>a-b);
  const typeCount={};myDays.forEach(d=>{const t=myRaw2[String(d)];if(t)typeCount[t]=(typeCount[t]||0)+1;});
  const pastDay=(y,m,d)=>new Date(y,m-1,d)<new Date(now.getFullYear(),now.getMonth(),now.getDate());

  // ── 카테고리별 누적 집계 ──
  const cumByCat = buildCumByCategory(cumCount, myMonths);
  const activeCats = MY_CAT_ORDER.filter(c=>cumByCat[c]?.total>0);

  // 카테고리 accordion HTML
  let catHtml = '';
  activeCats.forEach(cat=>{
    const meta = MY_CAT_META[cat]||{icon:'📋',label:cat,color:'#888'};
    const {total, types} = cumByCat[cat];
    const key = `mycat-${cat}`;
    const isOpen = collapseState[key]===true;
    const typeItems = Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([type,cnt])=>{
      const c=tc(type);
      return `<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}">
        <div class="type-stat-name" style="color:${c.text}">${type}</div>
        <div class="type-stat-big" style="color:${c.dot}">${cnt}</div>
        <div class="type-stat-sub" style="color:${c.text}">회</div>
      </div>`;
    }).join('');
    catHtml += `
      <div class="mycat-accordion" style="margin-bottom:8px;background:#fff;border-radius:14px;overflow:hidden;border:1.5px solid #f0f0ea">
        <div onclick="toggleCollapse('${key}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;padding:13px 15px;cursor:pointer;user-select:none">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">${meta.icon}</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:${meta.color}">${meta.label}</div>
              <div style="font-size:11px;color:#aaa;margin-top:1px">총 ${total}회</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px;font-weight:800;color:${meta.color}">${total}</span>
            <button class="collapse-btn" style="border:none;background:#f5f5f0;color:#aaa;font-size:11px;cursor:pointer;padding:3px 7px;border-radius:6px">${isOpen?'▲':'▼'}</button>
          </div>
        </div>
        <div data-collapse="${key}" style="display:${isOpen?'block':'none'};padding:0 14px 14px">
          <div class="type-stat-grid">${typeItems}</div>
        </div>
      </div>`;
  });

  // ── 월별 현황 섹션 ──
  const typeCount2 = {};
  myDays.forEach(d=>{const t=myRaw2[String(d)];if(t)typeCount2[t]=(typeCount2[t]||0)+1;});

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
    <div class="list-section-title" style="margin-bottom:8px">전체 기간 누적 통계</div>
    ${catHtml}
    <div class="list-section-title" style="margin-top:16px">월 선택</div>
    <div class="month-tabs">${myMonths.map(x=>`<button class="month-tab-btn${x.y===myShiftYear&&x.m===myShiftMonth?' active':''}" onclick="selectMyMonth(${x.y},${x.m})">${x.y}년 ${MN[x.m]}</button>`).join('')}</div>
    <div class="stat-section-card" style="margin-top:10px">
      <div class="stat-section-title">${myShiftYear}년 ${MN[myShiftMonth]} 근무현황</div>
      ${Object.keys(typeCount2).length?`<div class="type-stat-grid" style="margin-bottom:12px">${Object.entries(typeCount2).map(([type,cnt])=>{const c=tc(type);return`<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}"><div class="type-stat-name" style="color:${c.text}">${type}</div><div class="type-stat-big" style="color:${c.dot}">${cnt}</div><div class="type-stat-sub" style="color:${c.text}">회</div></div>`;}).join('')}</div>`:''}
      ${myDays.length?myDays.map(d=>{
        const type=myRaw2[String(d)]||'',c=type?tc(type):null,dow=new Date(myShiftYear,myShiftMonth-1,d).getDay();
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
            ${alarm.alarm?'<span>🔔</span>':''}
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
  const monthList=[];
  Object.entries(allSchedules).forEach(([y,ym])=>{
    if(srchYear&&parseInt(y)!==srchYear)return;
    Object.entries(ym).forEach(([m,d])=>{if(srchMonth&&parseInt(m)!==srchMonth)return;monthList.push({y:parseInt(y),m:parseInt(m),d});});
  });
  monthList.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);
  if(!monthList.length){el.innerHTML='<p class="empty-state">해당 기간에 근무표가 없습니다.</p>';return;}

  const nf=srchName.trim();
  // ── 카테고리별 누적 집계 ──
  const cumByCat={};
  MY_CAT_ORDER.forEach(c=>cumByCat[c]={total:0,types:{}});
  let cumTotal=0;
  monthList.forEach(({y,m,d})=>{
    const targets=nf?(d[nf]?{[nf]:d[nf]}:{}):d;
    Object.entries(targets).forEach(([,wd])=>{
      Object.entries(wd||{}).forEach(([ds,type])=>{
        if(!type) return;
        const cat=getCategory(type,y,m,parseInt(ds));
        const key=MY_CAT_ORDER.includes(cat)?cat:'특새';
        if(!cumByCat[key]) cumByCat[key]={total:0,types:{}};
        cumByCat[key].total++;
        cumByCat[key].types[type]=(cumByCat[key].types[type]||0)+1;
        cumTotal++;
      });
    });
  });

  let html='';
  const activeCats=MY_CAT_ORDER.filter(c=>cumByCat[c]?.total>0);
  if(activeCats.length){
    const yearLabel=srchYear?`${srchYear}년 `:'전체 ';
    const monthLabel=srchMonth?`${srchMonth}월 `:'';
    const nameLabel=nf?`· ${nf} `:'';
    html+=`<div class="stat-section-card" style="margin-bottom:12px"><div class="stat-section-title">${yearLabel}${monthLabel}${nameLabel}근무 현황 (${cumTotal}건)</div>`;
    activeCats.forEach(cat=>{
      const meta=MY_CAT_META[cat]||{icon:'📋',label:cat,color:'#888'};
      const {total,types}=cumByCat[cat];
      const ckey=`srch-cat-${cat}`;
      const isOpen=collapseState[ckey]===true;
      const typeItems=Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([type,cnt])=>{const c=tc(type);return`<div class="type-stat-block" style="background:${c.bg};border:1px solid ${c.border}"><div class="type-stat-name" style="color:${c.text}">${type}</div><div class="type-stat-big" style="color:${c.dot}">${cnt}</div><div class="type-stat-sub" style="color:${c.text}">회</div></div>`;}).join('');
      html+=`<div style="border-radius:10px;overflow:hidden;border:1.5px solid #f0f0ea;margin-bottom:6px"><div onclick="toggleCollapse('${ckey}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;padding:11px 13px;cursor:pointer;user-select:none;background:#fafaf8"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">${meta.icon}</span><span style="font-size:13px;font-weight:700;color:${meta.color}">${meta.label}</span></div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px;font-weight:800;color:${meta.color}">${total}</span><button class="collapse-btn" style="border:none;background:#ececea;color:#aaa;font-size:10px;cursor:pointer;padding:2px 6px;border-radius:5px">${isOpen?'▲':'▼'}</button></div></div><div data-collapse="${ckey}" style="display:${isOpen?'block':'none'};padding:10px 13px 12px"><div class="type-stat-grid">${typeItems}</div></div></div>`;
    });
    html+='</div>';
  }

  // ── 월별 목록 (기본 접힘) ──
  monthList.forEach(({y,m,d})=>{
    const targets=nf?(d[nf]?{[nf]:d[nf]}:{}):d;
    const entries=Object.entries(targets).flatMap(([name,wd])=>Object.entries(wd||{}).map(([day,type])=>({name,day:parseInt(day),type}))).sort((a,b)=>a.day-b.day);
    if(!entries.length)return;
    const mkey=`srch-month-${y}-${m}`;
    const isOpen=collapseState[mkey]===true;
    const rows=entries.map(({name,day,type})=>{const c=tc(type),dow=new Date(y,m-1,day).getDay(),past=new Date(y,m-1,day)<new Date(now.getFullYear(),now.getMonth(),now.getDate());const isMyShift=name===cu.name;const alarm=isMyShift?getAlarm(y,m,day):null;return`<div class="list-card${past?' past':''}" style="margin-bottom:6px" onclick="viewDayInCal(${y},${m-1},${day})"><div class="list-card-header"><div><span class="list-date">${MN[m]} ${day}일 <span class="list-dow">${DN[dow]}</span></span>${!nf?`<span style="font-size:12px;color:#888;margin-left:6px">${name}</span>`:''}</div><div style="display:flex;gap:6px;align-items:center">${alarm?.alarm?'<span>🔔</span>':''}<span class="duty-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">${type}</span></div></div></div>`;}).join('');
    html+=`<div style="margin-bottom:8px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #f0f0ea"><div onclick="toggleCollapse('${mkey}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;padding:12px 15px;cursor:pointer;user-select:none"><div style="font-size:13px;font-weight:700;color:#185FA5">${y}년 ${MN[m]} <span style="font-size:11px;color:#aaa;font-weight:400">(${entries.length}건)</span></div><button class="collapse-btn" style="border:none;background:#f5f5f0;color:#aaa;font-size:11px;cursor:pointer;padding:3px 8px;border-radius:6px">${isOpen?'▲ 접기':'▼ 펼치기'}</button></div><div data-collapse="${mkey}" style="display:${isOpen?'block':'none'};padding:0 12px 12px">${rows}</div></div>`;
  });
  el.innerHTML=html||'<p class="empty-state">조건에 맞는 근무 기록이 없습니다.</p>';
}

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
        <div class="settings-item-desc">${notifGranted?'근무·공지·채팅 소리/배너 알림':'먼저 허용하기를 눌러주세요'}</div>
      </div>
      ${notifGranted
        ? `<div class="toggle${masterOn?' on':''}" onclick="toggleNotifMaster(this)"></div>`
        : `<button onclick="requestNotifPermission()" style="padding:7px 14px;background:#185FA5;color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer">허용하기</button>`}
    </div>
    <!-- 세부 알림 (마스터 ON일 때만 활성화) -->
    <div style="opacity:${masterOn?1:0.35};pointer-events:${masterOn?'auto':'none'}">
      <div class="settings-item">
        <div class="settings-item-left">
          <div class="settings-item-title">근무 알림</div>
          <div class="settings-item-desc">근무 전날 자동 알림</div>
        </div>
        <div class="toggle${!s.shiftOff?' on':''}" onclick="toggleNotifSetting('shiftOff',this)"></div>
      </div>
      <!-- ★ 기본 알림 시간 설정 -->
      <div class="settings-item">
        <div class="settings-item-left">
          <div class="settings-item-title">기본 알림 시간</div>
          <div class="settings-item-desc">전날 이 시각에 근무 알림 발송</div>
        </div>
        <input type="time" class="time-input" value="${defaultAlarmTime}" onchange="saveDefaultAlarmTime(this.value)" style="width:100px;text-align:center;font-size:14px;font-weight:700">
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
function renderFeedTab(){
  const el=$('feed-list'); if(!el) return;
  if(isAdmin()){
    // 관리자: 전체 이용자 대화 목록
    const members=allMembers.filter(u=>!isAdminRole(u));
    if(!members.length){el.innerHTML='<p class="empty-state">이용자가 없습니다.</p>';return;}
    let html='<div class="list-section-title">이용자 채팅</div>';
    members.forEach((u,i)=>{
      const msgs=chatMessages[u.id]||[];
      const unread=msgs.filter(m=>m.to_id===cu.id&&!m.is_read).length;
      const last=msgs[msgs.length-1];
      const c=PALETTE[i%PALETTE.length];
      html+=`<div class="list-card${unread?' feed-card-new':''}" onclick="openChat(${u.id})" style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <div style="width:42px;height:42px;border-radius:50%;background:${c.bg};display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:${c.text};flex-shrink:0;border:2px solid ${c.border}">${u.name[0]}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:14px;font-weight:700">${u.name}</span>
            <div style="display:flex;align-items:center;gap:6px">
              ${unread?`<span class="cnt-badge">${unread}</span>`:''}
              ${last?`<span style="font-size:10px;color:#bbb">${fmtTime(last.created_at)}</span>`:''}
            </div>
          </div>
          <div style="font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${last?`<span style="color:${last.from_id===cu.id?'#aaa':'#555'}">${last.from_id===cu.id?'나: ':''}${esc(last.content)}</span>`:'<span style="color:#ccc">아직 대화가 없습니다</span>'}
          </div>
        </div>
      </div>`;
    });
    el.innerHTML=html;
  } else {
    // ★ 이용자: 관리자와의 대화 목록 표시 (카드 형태)
    const admin=allMembers.find(u=>isAdminRole(u));
    if(!admin){ el.innerHTML='<p class="empty-state">관리자를 찾을 수 없습니다.</p>'; return; }
    const msgs=chatMessages[admin.id]||[];
    const unread=msgs.filter(m=>m.to_id===cu.id&&!m.is_read).length;
    const last=msgs[msgs.length-1];
    let html='<div class="list-section-title">관리자와의 대화</div>';
    html+=`<div class="list-card${unread?' feed-card-new':''}" onclick="openChat(${admin.id})" style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div style="width:42px;height:42px;border-radius:50%;background:#185FA5;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:#fff;flex-shrink:0">${admin.name[0]}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:14px;font-weight:700">${admin.name} <span style="font-size:11px;color:#185FA5;font-weight:400">관리자</span></span>
          <div style="display:flex;align-items:center;gap:6px">
            ${unread?`<span class="cnt-badge">${unread}</span>`:''}
            ${last?`<span style="font-size:10px;color:#bbb">${fmtTime(last.created_at)}</span>`:''}
          </div>
        </div>
        <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${last?`<span style="color:${last.from_id===cu.id?'#aaa':'#555'}">${last.from_id===cu.id?'나: ':''}${esc(last.content)}</span>`:'<span style="color:#bbb">관리자에게 먼저 말을 걸어보세요 💬</span>'}
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:#ddd;flex-shrink:0"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </div>`;
    el.innerHTML=html;
  }
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
  // ★ 채팅 버튼 (자기 자신 제외)
  const chatBtn = u.id!==cu.id
    ? `<button class="detail-btn promote" style="background:#f0f5fd;color:#185FA5" onclick="closeModalById('member-modal');openChat(${u.id})">💬 메시지 보내기</button>`
    : '';

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
    ${chatBtn}
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
  const mediaType = file.type || 'image/jpeg';
  if(!allowedTypes.includes(mediaType)){
    showExcelErr('jpg, png, gif, webp 이미지 파일만 분석할 수 있습니다.');
    return;
  }

  showAILoading(true, '이미지를 읽는 중...');
  try {
    // 이미지를 base64로 변환 (최대 5MB 압축)
    const base64 = await compressImageToBase64(file);

    showAILoading(true, 'AI가 근무표를 분석 중입니다...');

    const memberNames = allMembers.map(u=>u.name).join(', ');
    const prompt = `이 이미지는 교회 사역자 근무표입니다. 다음 규칙에 따라 분석해주세요:

1. 날짜별로 근무자와 역할(근무유형)을 추출해주세요.
2. 괄호 안에 사람 이름이 있으면 [기도] 역할입니다.
3. 괄호 안에 행사명/교회명/소속 등 이름이 아닌 내용은 무시하세요.
4. 괄호가 두 개면 첫 번째는 무시, 두 번째 이름이 [기도]입니다.
5. 주일 새벽 설교의 경우, 다음 주 설교자가 이번 주 백업입니다.
6. 등록된 회원 이름 목록: ${memberNames || '(없음)'}
7. 이름이 비슷하면 회원 목록의 이름으로 자동 교정해주세요.
8. 연도와 월 정보를 이미지나 제목에서 최대한 추출하세요.

결과를 반드시 아래 JSON 형식으로만 응답하세요 (마크다운 코드블록, 설명 텍스트 없이 순수 JSON만):
{"year":연도숫자,"month":월숫자,"data":{"이름":{"날짜숫자":"근무유형"}},"summary":"요약"}

근무유형 예시: "[주일새벽]설교", "[주일오전]사회", "[주일4부]자막", "[수요]설교", "[금요]설교", "[수요]사회", "[금요]자막", "[새벽]설교", "[기도]설교", "[백업]설교"`;

    // ★ Google Gemini API 직접 호출 (무료)
    let text = '';
    const GEMINI_KEY = 'AIzaSyCsVNUYub1bktkmN_Q6v7dZmEgJ_I4jcIw';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const geminiResp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      })
    });
    if(!geminiResp.ok){
      const errText = await geminiResp.text();
      throw new Error(`Gemini API 오류 ${geminiResp.status}: ${errText.slice(0,200)}`);
    }
    const geminiData = await geminiResp.json();
    text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if(!text) throw new Error('AI 응답이 비어 있습니다.');

    // JSON 파싱 (코드블록 제거)
    const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    // JSON만 추출 (중괄호 기준)
    const jsonStart = clean.indexOf('{');
    const jsonEnd   = clean.lastIndexOf('}');
    if(jsonStart<0||jsonEnd<0) throw new Error('JSON 형식을 찾을 수 없습니다. AI 응답: '+clean.slice(0,100));
    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd+1));

    if(!parsed.year || !parsed.month) throw new Error('연도/월 정보를 인식하지 못했습니다.');
    if(!parsed.data || !Object.keys(parsed.data).length) throw new Error('근무자 데이터를 찾을 수 없습니다.');

    showAILoading(false);
    showAIPreview(parsed, file.name);

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
    el.innerHTML=`<div class="spinner" style="margin:0 auto 12px;width:32px;height:32px;border-width:3px"></div><div id="ai-loading-msg">AI가 근무표를 분석하고 있습니다...</div><div style="font-size:11px;color:#aaa;margin-top:6px;line-height:1.5">근무표 이미지에 따라 10~30초 소요됩니다</div>`;
    $('upload-zone').after(el);
  }
  if(msg){const m=$('ai-loading-msg');if(m)m.textContent=msg;}
  el.style.display=show?'block':'none';
  $('upload-zone').style.display=show?'none':'block';
}

// AI 분석 결과 미리보기
function showAIPreview(parsed, fileName){
  const {year, month, data, summary} = parsed;
  if(!data||!Object.keys(data).length){ showExcelErr('근무자 데이터를 찾을 수 없습니다.'); return; }

  parsedExcel = {year, month, data, fileName: fileName||'AI분석결과'};
  assignColors(collectAllTypes());

  $('upload-zone').style.display='none';
  $('excel-preview').style.display='block';

  // ★ 기존 AI 요약 박스 제거 (중복 방지)
  $('excel-preview').querySelectorAll('.ai-summary-box').forEach(el=>el.remove());

  $('excel-info').textContent=`${year}년 ${month}월 · 근무자 ${Object.keys(data).length}명 (AI 분석)`;

  // 요약 표시
  if(summary){
    const sumEl=document.createElement('div');
    sumEl.className='ai-summary-box';
    sumEl.style.cssText='background:#f0f5fd;border-radius:10px;padding:10px 13px;font-size:12px;color:#185FA5;margin-bottom:10px;line-height:1.6;border:1px solid #dbeafe';
    sumEl.innerHTML=`🤖 <b>AI 분석 완료</b><br>${esc(summary)}`;
    $('excel-preview').prepend(sumEl);
  }

  // 미리보기 테이블
  const names=Object.keys(data);
  const allDays=[...new Set(names.flatMap(n=>Object.keys(data[n]).map(Number)))].sort((a,b)=>a-b);
  let th='<tr><th>이름</th>';
  allDays.forEach(d=>th+=`<th>${d}</th>`);
  th+='</tr>';
  const tb=names.map(name=>{
    const dd=data[name];
    let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap">${name}</td>`;
    allDays.forEach(d=>{
      const v=dd[String(d)]||'';
      const c=v?tc(v):null;
      r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600"`:''} title="${v}">${v?v.replace(/[\[\]]/g,'').slice(0,5):''}</td>`;
    });
    return r+'</tr>';
  }).join('');
  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>근무자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...new Set(names.flatMap(n=>Object.values(data[n]||{})))].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
}

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

  parsedExcel={year,month,data:result,fileName};
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
  parsedExcel={year,month,data:result,fileName:fileName};assignColors([...types]);
  $('upload-zone').style.display='none';$('excel-preview').style.display='block';
  $('excel-info').textContent=`${year}년 ${month}월 · 근무자 ${names.length}명 · 유형 ${types.size}종`;
  let th='<tr><th>이름</th>';dateCols.forEach(({d})=>th+=`<th>${d}</th>`);th+='</tr>';
  const tb=names.map(name=>{const dd=result[name];let r=`<tr><td style="font-weight:600;text-align:left;padding-left:8px;white-space:nowrap">${name}</td>`;dateCols.forEach(({d})=>{const v=dd[String(d)]||'';const c=v?tc(v):null;r+=`<td ${c?`style="background:${c.bg};color:${c.text};font-weight:600"`:''} title="${v}">${v?v.replace(/[\[\]]/g,'').slice(0,4):''}</td>`;});return r+'</tr>';}).join('');
  $('preview-table').innerHTML=`<thead>${th}</thead><tbody>${tb}</tbody>`;
  $('parse-summary').innerHTML=`<b>근무자:</b> ${names.join(', ')}<br><b>유형:</b> ${[...types].map(t=>{const c=tc(t);return`<span style="background:${c.bg};color:${c.text};padding:1px 6px;border-radius:4px;font-size:11px;margin:0 2px">${t}</span>`;}).join('')}`;
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
  const{year,month,data,fileName}=parsedExcel;
  const settings=getUploadSettings();

  if(!allSchedules[year]) allSchedules[year]={};
  if(!uploadedFiles[year]) uploadedFiles[year]={};
  if(!uploadedFiles[year][month]) uploadedFiles[year][month]=new Set();

  const prevFiles=uploadedFiles[year][month];
  const isFirstUpload=prevFiles.size===0;
  const isSameFile=prevFiles.has(fileName);
  const isMerge=!isFirstUpload&&!isSameFile;

  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const existingNames=Object.keys(allSchedules[year]?.[month]||{});

  // ★ 안전장치 1: 확인 팝업
  if(settings.confirmUpload!==false){
    const actionLabel=isMerge?'병합':'덮어쓰기';
    const actionDesc=isMerge
      ? `기존 ${MN[month]} 근무표에 추가됩니다.\n현재 등록된 근무자: ${existingNames.join(', ')||'없음'}`
      : isSameFile
        ? `기존 ${MN[month]} 근무표가 수정본으로 교체됩니다.`
        : `${year}년 ${MN[month]} 근무표로 저장됩니다.`;
    const confirmed=confirm(`[${actionLabel}] ${fileName}\n\n${actionDesc}\n\n계속하시겠습니까?`);
    if(!confirmed) return;
  }

  // ★ 안전장치 2: 되돌리기용 이전 상태 저장
  if(settings.enableUndo!==false){
    undoData={year,month,data:JSON.parse(JSON.stringify(allSchedules[year]?.[month]||{})),files:new Set(prevFiles)};
  }

  let finalData;
  if(isMerge){
    const existing=allSchedules[year][month]||{};
    finalData={...existing};
    Object.entries(data).forEach(([name,days])=>{
      if(!finalData[name]) finalData[name]={};
      Object.entries(days).forEach(([day,type])=>{
        if(finalData[name][day]){if(!finalData[name][day].includes(type))finalData[name][day]+='/'+type;}
        else{finalData[name][day]=type;}
      });
    });
  } else {
    finalData=data;
  }

  prevFiles.add(fileName);
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

  clearExcel();switchTab('cal',$('btn-cal'));renderCalendar();buildSchedPreview();

  // ★ 안전장치 2: 되돌리기 토스트
  if(settings.enableUndo!==false && undoData){
    showUndoToast(isMerge?`'${fileName}' 병합 완료`:isSameFile?`'${fileName}' 수정본 적용`:`${year}년 ${MN[month]} 근무표 저장 완료`);
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
  if(!confirm('이전 근무표로 되돌리시겠습니까?'))return;
  if(!allSchedules[year])allSchedules[year]={};
  allSchedules[year][month]=data;
  if(uploadedFiles[year]?.[month]) uploadedFiles[year][month]=files;
  assignColors(collectAllTypes());filterType='';
  if(!OFFLINE){
    await sb.from('schedules').upsert({year,month,data,updated_by:cu.id,updated_at:new Date().toISOString()},{onConflict:'year,month'});
    await refreshSchedules();
  }
  $('undo-toast').style.display='none';
  if(undoTimer){clearTimeout(undoTimer);undoTimer=null;}
  undoData=null;
  renderCalendar();buildSchedPreview();
  showToastMsg('이전 근무표로 되돌렸습니다.');
}
function buildSchedPreview(){
  const el=$('sched-form'),allMonths=[];
  Object.entries(allSchedules).forEach(([y,ym])=>Object.keys(ym).forEach(m=>allMonths.push({y:parseInt(y),m:parseInt(m)})));
  allMonths.sort((a,b)=>a.y!==b.y?b.y-a.y:b.m-a.m);
  if(!allMonths.length){el.innerHTML='<p class="empty-state">업로드된 근무표가 없습니다.</p>';return;}
  const MN=['','1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let html='';
  allMonths.forEach(({y,m},idx)=>{
    const d=getMonthData(y,m),names=Object.keys(d);
    const key=`sched-${y}-${m}`;
    // 기본: 접힘 (collapseState에 없으면 false=접힘)
    const isOpen=collapseState[key]===true;
    html+=`<div style="margin-bottom:8px;background:#f8f8f4;border-radius:10px;overflow:hidden">
      <div onclick="toggleCollapse('${key}',this.querySelector('.collapse-btn'))" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;user-select:none">
        <div style="font-size:13px;font-weight:700;color:#185FA5">${y}년 ${MN[m]} <span style="font-size:11px;color:#aaa;font-weight:400">(${names.length}명)</span></div>
        <button class="collapse-btn" style="border:none;background:none;color:#aaa;font-size:12px;cursor:pointer;padding:2px 6px">${isOpen?'▲':'▼'}</button>
      </div>
      <div data-collapse="${key}" style="display:${isOpen?'block':'none'};padding:0 14px 10px">
        ${names.map(name=>{const wd=d[name]||{},days=Object.keys(wd).map(Number).sort((a,b)=>a-b),approved=allMembers.some(u=>u.name===name);return`<div class="sched-preview-row"><span class="sched-name">${name}${!approved?` <span class="unregistered-tag">미가입</span>`:''}</span><span class="sched-days">${days.map(d2=>{const t=wd[String(d2)],c=t?tc(t):null;return c?`<span class="day-chip" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}" title="${t}">${d2}</span>`:`<span class="day-chip">${d2}</span>`;}).join('')}</span></div>`;}).join('')}
      </div>
    </div>`;
  });
  el.innerHTML=html;
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
function fmtDate(s){if(!s)return'';try{const d=new Date(s);return`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;}catch{return'';}}
