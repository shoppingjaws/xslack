const URL_REGEX = /https?:\/\/[^\s]+/g;
const TCO_URL_LENGTH = 23;

export function countXCharacters(text: string): number {
  const urls = text.match(URL_REGEX);
  if (!urls) return text.length;

  let count = text.length;
  for (const url of urls) {
    count += TCO_URL_LENGTH - url.length;
  }
  return count;
}
