// Keep a configured API key out of text that can reach a job record, the
// browser or a log: each occurrence becomes `…` plus the key's last four
// characters, enough to tell keys apart. Shared by the MinerU and translator
// clients.

export function redact(token: string): string {
  if (!token) return "";
  return `…${token.slice(-4)}`;
}

export function scrub(message: string, token: string): string {
  if (!token || !message.includes(token)) return message;
  return message.split(token).join(redact(token));
}
