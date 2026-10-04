export type OwnerSession = { authenticated: false } | { authenticated: true; wallet: string; csrf: string };

const jsonHeaders = { "content-type": "application/json" };

export async function ownerSession(): Promise<OwnerSession> {
  const response = await fetch("/api/v1/owner/session", { credentials: "include" });
  if (!response.ok) return { authenticated: false };
  return response.json() as Promise<OwnerSession>;
}

export async function signOwnerSession(wallet: string, sign: (message: Uint8Array) => Promise<Uint8Array>): Promise<OwnerSession> {
  const challenge = await fetch("/api/v1/owner/challenge", { method: "POST", credentials: "include", headers: jsonHeaders, body: JSON.stringify({ wallet }) });
  const body = await challenge.json() as { message?: string; nonce?: string; error?: { message: string } };
  if (!challenge.ok || !body.message || !body.nonce) throw new Error(body.error?.message ?? "The ownership challenge was not issued.");
  const signature = await sign(new TextEncoder().encode(body.message));
  const session = await fetch("/api/v1/owner/session", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ wallet, nonce: body.nonce, signature: btoa(String.fromCharCode(...signature)) }),
  });
  const signed = await session.json() as { csrf?: string; error?: { message: string } };
  if (!session.ok || !signed.csrf) throw new Error(signed.error?.message ?? "The wallet signature was not accepted.");
  return { authenticated: true, wallet, csrf: signed.csrf };
}

export async function ownerPost<T>(path: string, csrf: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", credentials: "include", headers: { ...jsonHeaders, "x-csrf-token": csrf }, body: JSON.stringify(body) });
  const payload = await response.json() as T & { error?: { message: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "The request failed.");
  return payload;
}
