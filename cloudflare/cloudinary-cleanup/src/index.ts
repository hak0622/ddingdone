interface Env {
  CLOUDINARY_CLOUD_NAME: string
  CLOUDINARY_API_KEY: string
  CLOUDINARY_API_SECRET: string
  WORKER_AUTH_TOKEN: string
}

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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
    if (authHeader !== `Bearer ${env.WORKER_AUTH_TOKEN}`) {
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    let body: { publicId?: string }
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: cors })
    }

    const publicId = body.publicId
    if (!publicId || typeof publicId !== 'string') {
      return new Response('publicId is required', { status: 400, headers: cors })
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
