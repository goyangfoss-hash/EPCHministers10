// supabase/functions/send-push/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function getAccessToken() {
  const sa = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!)
  const now = Math.floor(Date.now() / 1000)
  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const payload = encode({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })
  const signingInput = `${header}.${payload}`
  const keyData = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,'')
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const jwt = `${signingInput}.${signature}`
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  return (await r.json()).access_token as string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const { user_ids, title = '', body: msg = '', data = {} } = body

    if (!user_ids?.length) {
      return new Response(JSON.stringify({ sent: 0, ok: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ★ 계정 기준: user_id별로 가장 최근 토큰 1개만 조회
    // updated_at 기준 최신 토큰 = 가장 최근에 로그인한 기기
    const { data: allTokens } = await supabase
      .from('fcm_tokens')
      .select('user_id, token, updated_at')
      .in('user_id', user_ids)
      .order('updated_at', { ascending: false })

    if (!allTokens?.length) {
      return new Response(JSON.stringify({ sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // user_id별 최신 토큰 1개만 선택
    const latestByUser: Record<number, string> = {}
    for (const row of allTokens as any[]) {
      if (!latestByUser[row.user_id]) {
        latestByUser[row.user_id] = row.token
      }
    }
    const tokens = Object.values(latestByUser)

    const projectId = Deno.env.get('FIREBASE_PROJECT_ID')!
    const accessToken = await getAccessToken()
    const invalid: string[] = []
    let sent = 0

    await Promise.all(tokens.map(async (token) => {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: msg },
            data,
            webpush: {
              notification: {
                title, body: msg,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: `epch-${data.tab||'msg'}`,
                renotify: true,
              },
              fcm_options: { link: data.url || '/' },
            },
          },
        }),
      })
      const j = await r.json()
      if (j.error?.details?.some((d: any) => ['UNREGISTERED','INVALID_ARGUMENT'].includes(d.errorCode))) {
        invalid.push(token)
      } else if (r.ok) sent++
    }))

    if (invalid.length) await supabase.from('fcm_tokens').delete().in('token', invalid)

    return new Response(JSON.stringify({ sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch(e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
