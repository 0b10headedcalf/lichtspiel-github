/**
 * Minimal OSC 1.0 codec — just enough for the Max ⇄ bridge channel, over
 * Node's built-in `dgram` (no native deps). Handles plain messages with
 * string/int/float/double args; bundles (`#bundle`) are ignored (Max's
 * `udpsend` emits plain messages).
 *
 * OSC strings are ASCII, null-terminated, padded to a 4-byte boundary.
 */

export interface OscMessage {
  address: string;
  args: Array<string | number>;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function readString(buf: Buffer, offset: number): { value: string; next: number } {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const value = buf.toString('ascii', offset, end);
  return { value, next: pad4(end + 1) };
}

function writeString(s: string): Buffer {
  const b = Buffer.alloc(pad4(s.length + 1));
  b.write(s, 0, 'ascii');
  return b;
}

/** Decode one OSC message. Returns null for bundles or malformed input. */
export function decodeOscMessage(buf: Buffer): OscMessage | null {
  if (buf.length < 4 || buf[0] !== 0x2f) return null; // must start with '/'
  let off = 0;
  const addr = readString(buf, off);
  off = addr.next;
  if (off >= buf.length) return { address: addr.value, args: [] };

  const tagsRead = readString(buf, off);
  off = tagsRead.next;
  if (!tagsRead.value.startsWith(',')) return { address: addr.value, args: [] };

  const args: Array<string | number> = [];
  for (const tag of tagsRead.value.slice(1)) {
    if (tag === 'i') {
      args.push(buf.readInt32BE(off));
      off += 4;
    } else if (tag === 'f') {
      args.push(buf.readFloatBE(off));
      off += 4;
    } else if (tag === 'd') {
      args.push(buf.readDoubleBE(off));
      off += 8;
    } else if (tag === 's' || tag === 'S') {
      const s = readString(buf, off);
      args.push(s.value);
      off = s.next;
    } else if (tag === 'T') {
      args.push(1);
    } else if (tag === 'F') {
      args.push(0);
    }
    // unknown tags (e.g. blob) are skipped — not used on this channel
  }
  return { address: addr.value, args };
}

/** Encode an OSC message. Integers → 'i', other numbers → 'f', else → 's'. */
export function encodeOscMessage(address: string, args: Array<string | number> = []): Buffer {
  let tags = ',';
  const parts: Buffer[] = [];
  for (const a of args) {
    if (typeof a === 'number' && Number.isInteger(a)) {
      tags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a);
      parts.push(b);
    } else if (typeof a === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      parts.push(b);
    } else {
      tags += 's';
      parts.push(writeString(String(a)));
    }
  }
  return Buffer.concat([writeString(address), writeString(tags), ...parts]);
}
