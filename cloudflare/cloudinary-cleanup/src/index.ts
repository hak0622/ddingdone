interface Env {
  CLOUDINARY_CLOUD_NAME: string
  CLOUDINARY_API_KEY: string
  CLOUDINARY_API_SECRET: string
  FIREBASE_API_KEY: string
  FIREBASE_PROJECT_ID: string
}

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// 고정된 비밀번호 대신 호출자가 보낸 Firebase ID 토큰을 구글 서버에 직접 검증
// 요청해서 진짜 유효한 토큰인지, 그 토큰이 누구의 것인지(uid)를 알아낸다.
// 고정값은 앱 코드 안에 그대로 박혀 누구나 꺼내 쓸 수 있지만, ID 토큰은 매번
// 새로 발급되고 본인 로그인 세션에만 유효해 훔쳐서 재사용하기 어렵다.
async function verifyIdToken(idToken: string, apiKey: string): Promise<string | null> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  )
  if (!res.ok) return null
  const data = await res.json<{ users?: Array<{ localId?: string }> }>()
  return data.users?.[0]?.localId ?? null
}

// 같은 idToken을 그대로 Firestore REST API에 보내면 클라이언트 SDK가 호출할 때와
// 동일하게 firestore.rules가 적용된다. 검증된 uid가 실제로 해당 모임의
// memberUids에 속하는지까지 확인해야, "남의 모임 사진을 마음대로 지우는" 시도를
// 막을 수 있다 — meetings의 get 규칙은 인증된 사용자 누구에게나 열려 있어서
// 문서 조회 자체는 항상 성공하므로, 멤버 여부는 우리가 직접 검사해야 한다.
async function isMeetingMember(
  projectId: string,
  meetingId: string,
  uid: string,
  idToken: string,
): Promise<boolean> {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/meetings/${meetingId}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  )
  if (!res.ok) return false
  const data = await res.json<{
    fields?: { memberUids?: { arrayValue?: { values?: Array<{ stringValue?: string }> } } }
  }>()
  const memberUids = data.fields?.memberUids?.arrayValue?.values?.map((v) => v.stringValue) ?? []
  return memberUids.includes(uid)
}

const APP_NAME = 'ddingdone'
// 앱인토스 공식 가이드: https://developers-apps-in-toss.toss.im/development/test/toss.html
const PROD_HOSTNAMES = new Set([
  `${APP_NAME}.apps.tossmini.com`,
  `${APP_NAME}.private-apps.tossmini.com`,
])
// granite dev 서버는 네트워크마다 다른 사설 IP(HOST_IP)로 뜨므로 패턴으로 허용
const LOCAL_HOSTNAME_PATTERN = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  try {
    const hostname = new URL(origin).hostname
    return PROD_HOSTNAMES.has(hostname) || LOCAL_HOSTNAME_PATTERN.test(hostname)
  } catch {
    return false
  }
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors })
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors })
    }

    const authHeader = request.headers.get('Authorization')
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!idToken) {
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    let body: { publicId?: string; meetingId?: string }
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: cors })
    }

    const publicId = body.publicId
    const meetingId = body.meetingId
    if (!publicId || typeof publicId !== 'string' || !meetingId || typeof meetingId !== 'string') {
      return new Response('publicId and meetingId are required', { status: 400, headers: cors })
    }
    // meetingId는 Firestore 자동 생성 문서 ID라 영문/숫자/-/_ 외 문자가 나올 수
    // 없다. 이 형식을 강제하면 meetingId를 Firestore REST URL 경로에 그대로 끼워
    // 넣어도 다른 경로를 가리키도록 조작할 수 없다.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(meetingId)) {
      return new Response('Invalid meetingId', { status: 400, headers: cors })
    }
    // publicId가 meetingId 소유 폴더(ddingdone/{meetingId}/...) 밖이면 즉시 거부한다.
    // 멤버십 검증만으로는 "내가 멤버인 모임A"와 "지우려는 사진이 실제로 모임A
    // 소속인지"가 연결되지 않아, A의 정당한 멤버가 다른 모임 B의 photoPublicId를
    // (모임 조회는 누구에게나 열려있어 B의 publicId도 알 수 있다) meetingId=A로
    // 속여 보내면 B의 사진을 지울 수 있었다 — 업로드 시 폴더를 모임별로 못박고,
    // 여기서 그 폴더 안의 publicId만 받아들이면 그 경로 자체가 막힌다.
    if (!publicId.startsWith(`ddingdone/${meetingId}/`)) {
      return new Response('publicId does not belong to meetingId', { status: 403, headers: cors })
    }

    const uid = await verifyIdToken(idToken, env.FIREBASE_API_KEY)
    if (!uid) {
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const isMember = await isMeetingMember(env.FIREBASE_PROJECT_ID, meetingId, uid, idToken)
    if (!isMember) {
      return new Response('Forbidden', { status: 403, headers: cors })
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const signature = await sha1Hex(
      `public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`,
    )

    const form = new FormData()
    form.append('public_id', publicId)
    form.append('timestamp', String(timestamp))
    form.append('api_key', env.CLOUDINARY_API_KEY)
    form.append('signature', signature)

    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`,
      { method: 'POST', body: form },
    )
    const result = await cloudinaryRes.json<{ result?: string }>()

    if (!cloudinaryRes.ok || (result.result !== 'ok' && result.result !== 'not found')) {
      return new Response(JSON.stringify(result), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  },
}
