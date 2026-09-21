const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>(
  Array.from(BASE64_ALPHABET).map((char, index) => [char, index]),
);

export function utf8ToBytes(value: string): Uint8Array {
  const Encoder = globalThis.TextEncoder;
  if (Encoder) {
    return new Uint8Array(new Encoder().encode(value));
  }

  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes;
}

export function bytesToUtf8(bytes: Uint8Array): string {
  const Decoder = globalThis.TextDecoder;
  if (Decoder) {
    return new Decoder().decode(bytes);
  }

  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return decodeURIComponent(escape(binary));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triplet = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return output;
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '');
  if (!normalized || normalized.length % 4 === 1) {
    throw new Error('Invalid base64 payload');
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const padding = padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((padded.length / 4) * 3 - padding);
  let byteIndex = 0;

  for (let index = 0; index < padded.length; index += 4) {
    const chunk = padded.slice(index, index + 4);
    const values = Array.from(chunk).map((char) => {
      if (char === '=') {
        return 0;
      }
      const decoded = BASE64_LOOKUP.get(char);
      if (decoded === undefined) {
        throw new Error('Invalid base64 payload');
      }
      return decoded;
    });

    const triplet = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    if (byteIndex < bytes.length) {
      bytes[byteIndex] = (triplet >> 16) & 0xff;
      byteIndex += 1;
    }
    if (byteIndex < bytes.length) {
      bytes[byteIndex] = (triplet >> 8) & 0xff;
      byteIndex += 1;
    }
    if (byteIndex < bytes.length) {
      bytes[byteIndex] = triplet & 0xff;
      byteIndex += 1;
    }
  }

  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
}
