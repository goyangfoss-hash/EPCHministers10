// supabase/functions/daily-shift-push/index.ts
// 매일 18:30 (KST) = 09:30 UTC 에 cron으로 실행
// 내일 사역이 있는 모든 등록 이용자에게 FCM 푸시 1건 전송

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID')!;
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!;

async function getFCMAccessToken(): Promise<string> {
  const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pemKey = sa.private_key;
  const keyData = pemKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenJson = await tokenRes.json();
  return tokenJson.access_token;
}

async function sendFCM(accessToken: string, token: string, title: string, body: string) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: { tab: 'cal', url: '/?tab=cal' },
          webpush: {
            notification: {
              title, body,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'epch-shift',   // 같은 날 중복 알림 방지
              renotify: false,
            },
            fcm_options: { link: '/?tab=cal' },
          },
        },
      }),
    }
  );
  const json = await res.json();
  if (json.error?.details?.find((d: any) => d.errorCode === 'UNREGISTERED')) {
    return { invalid: true, token };
  }
  return { ok: res.ok };
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 내일 날짜 계산 (KST)
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const tomorrowKST = new Date(nowKST);
  tomorrowKST.setDate(tomorrowKST.getDate() + 1);
  const y = tomorrowKST.getUTCFullYear();
  const m = tomorrowKST.getUTCMonth() + 1;
  const d = tomorrowKST.getUTCDate();

  // schedules 테이블에서 내일 해당하는 모든 사역 조회
  // schedules 구조: { year, month, data: { name: { day: type } } }
  const { data: schedules } = await supabase
    .from('schedules')
    .select('data')
    .eq('year', y)
    .eq('month', m);

  if (!schedules?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no schedules' }));
  }

  // 내일 사역이 있는 이름 수집
  const namesWithShift = new Set<string>();
  const shiftTypes: Record<string, string> = {};
  for (const row of schedules) {
    const data = row.data || {};
    for (const [name, days] of Object.entries(data as Record<string, Record<string, string>>)) {
      if (days[String(d)]) {
        namesWithShift.add(name);
        shiftTypes[name] = days[String(d)];
      }
    }
  }

  if (!namesWithShift.size) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no shifts tomorrow' }));
  }

  // 해당 이름을 가진 이용자 조회
  const { data: users } = await supabase
    .from('app_users')
    .select('id, name')
    .in('name', [...namesWithShift]);

  if (!users?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no users found' }));
  }

  const userIds = users.map(u => u.id);
  const userNameMap: Record<number, string> = {};
  users.forEach(u => { userNameMap[u.id] = u.name; });

  // 각 이용자의 모든 FCM 토큰 조회
  const { data: tokens } = await supabase
    .from('fcm_tokens')
    .select('user_id, token')
    .in('user_id', userIds);

  if (!tokens?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no tokens' }));
  }

  const accessToken = await getFCMAccessToken();
  const invalidTokens: string[] = [];
  let sent = 0;

  // user_id별로 토큰 그룹핑 → 각 이용자에게 한 번만 (모든 기기에 전송)
  const byUser: Record<number, string[]> = {};
  for (const { user_id, token } of tokens) {
    if (!byUser[user_id]) byUser[user_id] = [];
    byUser[user_id].push(token);
  }

  for (const [userIdStr, userTokens] of Object.entries(byUser)) {
    const userId = parseInt(userIdStr);
    const name = userNameMap[userId];
    const shiftType = shiftTypes[name] || '사역';
    const title = '📅 내일 사역 알림';
    const body = `${m}월 ${d}일 [${shiftType}] 사역이 내일입니다.`;

    // 동일 이용자의 모든 기기에 전송 (각 기기에서 알림 1건)
    for (const token of userTokens) {
      const result = await sendFCM(accessToken, token, title, body);
      if (result.invalid) invalidTokens.push(token);
      else if (result.ok) sent++;
    }
  }

  // 만료된 토큰 정리
  if (invalidTokens.length) {
    await supabase.from('fcm_tokens').delete().in('token', invalidTokens);
  }

  console.log(`daily-shift-push: ${y}-${m}-${d} 내일 사역자 ${namesWithShift.size}명, ${sent}건 전송`);
  return new Response(JSON.stringify({ sent, users: namesWithShift.size }));
});
