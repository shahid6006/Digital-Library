// Secure hashing using Web Crypto API (SHA-256 with salt)
export async function hashPassword(password: string, customSalt?: string): Promise<string> {
  const salt = customSalt || (window.crypto ? Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') : 'salt_' + Math.random().toString(36).substring(2));

  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${password}`);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return `${salt}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash?: string | null): Promise<boolean> {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }
  const [salt] = storedHash.split(':');
  const computed = await hashPassword(password, salt);
  return computed === storedHash;
}
