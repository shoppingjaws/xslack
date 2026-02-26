/**
 * Slack file ID parsing, validation, and download utilities.
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIMETYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface SlackFileInfo {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  urlPrivateDownload: string;
}

/**
 * Parse comma-separated file IDs string into an array.
 */
export function parseFileIds(input: string): string[] {
  if (!input) return [];
  return input.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Fetch file info from Slack API and validate each file is an image within size limits.
 */
export async function getSlackFileInfos(
  fileIds: string[],
  // deno-lint-ignore no-explicit-any
  client: any,
): Promise<SlackFileInfo[]> {
  const infos: SlackFileInfo[] = [];

  for (const fileId of fileIds) {
    const result = await client.files.info({ file: fileId });

    if (!result.ok) {
      throw new Error(
        `Slackファイル情報の取得に失敗しました (${fileId}): ${result.error}`,
      );
    }

    const file = result.file;
    const mimetype = file.mimetype as string;
    const size = file.size as number;

    if (!ALLOWED_MIMETYPES.has(mimetype)) {
      throw new Error(
        `サポートされていないファイル形式です (${file.name}): ${mimetype}。対応形式: JPEG, PNG, GIF, WebP`,
      );
    }

    if (size > MAX_FILE_SIZE) {
      const sizeMB = (size / 1024 / 1024).toFixed(1);
      throw new Error(
        `ファイルサイズが上限を超えています (${file.name}): ${sizeMB}MB。上限: 5MB`,
      );
    }

    infos.push({
      id: fileId,
      name: file.name,
      mimetype,
      size,
      urlPrivateDownload: file.url_private_download,
    });
  }

  return infos;
}

/**
 * Download a Slack file using its private download URL with Bearer token auth.
 */
export async function downloadSlackFile(
  url: string,
  token: string,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Slackファイルのダウンロードに失敗しました: ${response.status}`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}
