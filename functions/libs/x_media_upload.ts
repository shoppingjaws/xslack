/**
 * X v1.1 media upload using multipart/form-data with base64-encoded media_data.
 * Uses OAuth 1.0a authentication via buildAuthHeader from x_api_client.
 */

import { buildAuthHeader, XCredentials } from "./x_api_client.ts";

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

/**
 * Convert Uint8Array to base64 string using chunked processing
 * to avoid stack overflow on large files.
 */
function uint8ArrayToBase64(data: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = "";
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Upload a single image to X media endpoint.
 * Returns the media_id_string for use in tweet creation.
 */
export async function uploadMedia(
  imageData: Uint8Array,
  mimetype: string,
  credentials: XCredentials,
): Promise<string> {
  const method = "POST";
  const authHeader = await buildAuthHeader(method, UPLOAD_URL, credentials);

  const base64Data = uint8ArrayToBase64(imageData);

  const formData = new FormData();
  formData.append("media_data", base64Data);
  formData.append("media_category", "tweet_image");

  const response = await fetch(UPLOAD_URL, {
    method,
    headers: {
      Authorization: authHeader,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Xメディアアップロードエラー ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.media_id_string;
}

/**
 * Upload multiple images sequentially and return their media IDs.
 * Sequential processing to maintain memory efficiency.
 */
export async function uploadMultipleMedia(
  images: { data: Uint8Array; mimetype: string }[],
  credentials: XCredentials,
): Promise<string[]> {
  const mediaIds: string[] = [];

  for (const image of images) {
    const mediaId = await uploadMedia(image.data, image.mimetype, credentials);
    mediaIds.push(mediaId);
  }

  return mediaIds;
}
