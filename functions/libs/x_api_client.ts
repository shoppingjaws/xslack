/**
 * X API v2 client using OAuth 1.0a (HMAC-SHA1)
 * No external dependencies — uses Web Crypto API for signing.
 */

export interface XCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface PostTweetResult {
  id: string;
  text: string;
}

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function buildAuthHeader(
  method: string,
  url: string,
  credentials: XCredentials,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(credentials.consumerSecret)}&${
    percentEncode(credentials.accessTokenSecret)
  }`;

  const signature = await hmacSha1(signingKey, baseString);
  oauthParams["oauth_signature"] = signature;

  const header = "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(", ");

  return header;
}

/**
 * Post a tweet via X API v2.
 * @returns tweet id and text on success
 * @throws on API error
 */
export async function postTweet(
  text: string,
  credentials: XCredentials,
): Promise<PostTweetResult> {
  const url = "https://api.x.com/2/tweets";
  const method = "POST";
  const body = JSON.stringify({ text });

  const authHeader = await buildAuthHeader(method, url, credentials);
  console.log("[DEBUG] Auth header:", authHeader.substring(0, 120) + "...");

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`X API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return {
    id: data.data.id,
    text: data.data.text,
  };
}
