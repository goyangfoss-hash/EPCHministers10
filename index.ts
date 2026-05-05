// supabase/functions/send-push/index.ts
// 채팅·공지 즉시 푸시 알림 전송
// 동일 user_id에 여러 기기 토큰이 있어도 각 기기에 전송 (중복 알림 아님 — 기기별 1건)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID')!;
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!; // JSON string

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Google OAuth2 액세스 토큰 발급 (FCM v1 API용)
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
  // JWT 서명 (RS256)
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

async function sendFCM(accessToken: string, token: string, title: string, body: string, data: Record<string, string> = {}) {
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
          data,
          webpush: {
            notification: {
              title, body,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: data.tab ? `epch-${data.tab}` : 'epch',
              renotify: true,
            },
            fcm_options: { link: data.url || '/' },
          },
        },
      }),
    }
  );
  const json = await res.json();
  // 유효하지 않은 토큰은 DB에서 삭제
  if (json.error?.details?.find((d: any) => d.errorCode === 'UNREGISTERED')) {
    return { invalid: true, token };
  }
  return { ok: res.ok, status: res.status };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_ids, title, body, data = {} } = await req.json();
    if (!user_ids?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // user_ids에 해당하는 모든 FCM 토큰 조회
    const { data: tokens } = await supabase
      .from('fcm_tokens')
      .select('user_id, token')
      .in('user_id', user_ids);

    if (!tokens?.length) return new Response(JSON.stringify({ sent: 0 }), { headers: corsHeaders });

    const accessToken = await getFCMAccessToken();
    const invalidTokens: string[] = [];
    let sent = 0;

    await Promise.all(tokens.map(async ({ token }) => {
      const result = await sendFCM(accessToken, token, title, body, data);
      if (result.invalid) invalidTokens.push(token);
      else if (result.ok) sent++;
    }));

    // 만료된 토큰 정리
    if (invalidTokens.length) {
      await supabase.from('fcm_tokens').delete().in('token', invalidTokens);
    }

    return new Response(JSON.stringify({ sent }), { headers: corsHeaders });
  } catch (e) {
    console.error('send-push error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
