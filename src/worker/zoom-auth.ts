interface TokenCache {
  token: string;
  exp: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __zoomToken: TokenCache | undefined;
}

export interface ZoomEnv {
  ZOOM_ACCOUNT_ID: string;
  ZOOM_CLIENT_ID: string;
  ZOOM_CLIENT_SECRET: string;
}

export async function getAccessToken(env: ZoomEnv): Promise<string> {
  if (!globalThis.__zoomToken) {
    globalThis.__zoomToken = { token: "", exp: 0 };
  }
  const mem = globalThis.__zoomToken;
  if (mem.token && Date.now() < mem.exp - 30_000) {
    return mem.token;
  }

  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error("Missing Zoom OAuth environment variables");
  }

  const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`;
  const basic = btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`);

  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Zoom token request failed (${r.status}): ${text}`);
  }

  const tok = (await r.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + Math.max(30, tok.expires_in || 3600) * 1000;
  mem.token = tok.access_token;
  mem.exp = expiresAt;

  return tok.access_token;
}
