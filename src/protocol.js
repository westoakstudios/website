
export const FRAME = '\n';

export function encodeAuth(password, name) {
  return `AUTH ${password} ${name}${FRAME}`;
}

export function encodeHeartbeat() {
  return `H${FRAME}`;
}

export function encodeOk() {
  return `OK${FRAME}`;
}

export function encodeNone() {
  return `N${FRAME}`;
}

export function encodeCommand(cmd) {
  return `C${Buffer.from(cmd, 'utf8').toString('base64')}${FRAME}`;
}

export function decodeLine(line) {
  if (line === 'H') return { type: 'heartbeat' };
  if (line.startsWith('AUTH ')) {
    const rest = line.slice(5);
    const sp = rest.indexOf(' ');
    if (sp === -1) return { type: 'invalid' };
    return {
      type: 'auth',
      password: rest.slice(0, sp),
      name: rest.slice(sp + 1).trim(),
    };
  }
  return { type: 'unknown' };
}