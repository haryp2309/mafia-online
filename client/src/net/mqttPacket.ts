/**
 * Minimal, zero-dependency MQTT v3.1.1 binary packet codec for WebSocket (wss://) connections.
 * Implements CONNECT (with optional Last Will), CONNACK, PUBLISH (QoS 0), SUBSCRIBE, SUBACK,
 * PINGREQ, PINGRESP, and DISCONNECT.
 */

export type MqttPacket =
  | { type: 'connack'; returnCode: number }
  | { type: 'publish'; topic: string; payload: Uint8Array }
  | { type: 'suback'; packetId: number }
  | { type: 'pingresp' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeLength(len: number): number[] {
  const out: number[] = [];
  let x = len;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encodedByte |= 128;
    out.push(encodedByte);
  } while (x > 0);
  return out;
}

function encodeString(str: string): Uint8Array {
  const bytes = encoder.encode(str);
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function encodeBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + bytes.length);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function framePacket(headerByte: number, body: Uint8Array): Uint8Array {
  const remLen = encodeLength(body.length);
  const out = new Uint8Array(1 + remLen.length + body.length);
  out[0] = headerByte;
  out.set(remLen, 1);
  out.set(body, 1 + remLen.length);
  return out;
}

export interface ConnectOptions {
  clientId: string;
  keepAliveSec?: number;
  will?: {
    topic: string;
    payload: Uint8Array;
  };
}

export function encodeConnect(opts: ConnectOptions): Uint8Array {
  const keepAlive = opts.keepAliveSec ?? 30;
  // Variable header: Protocol Name "MQTT", Protocol Level 4 (v3.1.1), Connect Flags, Keep Alive
  let flags = 0x02; // CleanSession = 1
  if (opts.will) {
    flags |= 0x04; // Will Flag = 1 (QoS 0, Retain 0)
  }
  const varHeader = new Uint8Array([
    0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // "MQTT"
    0x04, // Level 4 (3.1.1)
    flags,
    (keepAlive >> 8) & 0xff,
    keepAlive & 0xff,
  ]);
  const parts: Uint8Array[] = [varHeader, encodeString(opts.clientId)];
  if (opts.will) {
    parts.push(encodeString(opts.will.topic), encodeBytes(opts.will.payload));
  }
  return framePacket(0x10, concatBytes(...parts));
}

export function encodeSubscribe(packetId: number, topics: string[]): Uint8Array {
  const idBytes = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const topicParts: Uint8Array[] = [idBytes];
  for (const t of topics) {
    topicParts.push(encodeString(t), new Uint8Array([0x00])); // QoS 0
  }
  return framePacket(0x82, concatBytes(...topicParts));
}

export function encodePublish(topic: string, payload: Uint8Array | string): Uint8Array {
  const topicBytes = encodeString(topic);
  const payloadBytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  return framePacket(0x30, concatBytes(topicBytes, payloadBytes));
}

export function encodePingReq(): Uint8Array {
  return new Uint8Array([0xc0, 0x00]);
}

export function encodeDisconnect(): Uint8Array {
  return new Uint8Array([0xe0, 0x00]);
}

/**
 * Stateful stream decoder for incoming MQTT binary frames.
 */
export class MqttStreamDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): MqttPacket[] {
    if (this.buf.length === 0) {
      this.buf = chunk;
    } else {
      this.buf = concatBytes(this.buf, chunk);
    }

    const packets: MqttPacket[] = [];
    while (this.buf.length >= 2) {
      const header = this.buf[0];
      const packetType = header >> 4;

      let multiplier = 1;
      let remLength = 0;
      let idx = 1;
      let encodedByte = 0;
      let completeLength = false;

      while (idx < this.buf.length) {
        encodedByte = this.buf[idx++];
        remLength += (encodedByte & 127) * multiplier;
        if ((encodedByte & 128) === 0) {
          completeLength = true;
          break;
        }
        multiplier *= 128;
        if (multiplier > 128 * 128 * 128) {
          // Malformed remaining length: reset buffer
          this.buf = new Uint8Array(0);
          return packets;
        }
      }

      if (!completeLength) break; // Need more bytes for length
      const totalFrameLen = idx + remLength;
      if (this.buf.length < totalFrameLen) break; // Need more bytes for body

      const body = this.buf.subarray(idx, totalFrameLen);
      this.buf = this.buf.subarray(totalFrameLen);

      if (packetType === 2 && body.length >= 2) {
        // CONNACK
        packets.push({ type: 'connack', returnCode: body[1] });
      } else if (packetType === 3 && body.length >= 2) {
        // PUBLISH
        const topicLen = (body[0] << 8) | body[1];
        if (2 + topicLen <= body.length) {
          const topic = decoder.decode(body.subarray(2, 2 + topicLen));
          const qos = (header >> 1) & 0x03;
          const payloadStart = 2 + topicLen + (qos > 0 ? 2 : 0);
          if (payloadStart <= body.length) {
            const payload = body.slice(payloadStart);
            packets.push({ type: 'publish', topic, payload });
          }
        }
      } else if (packetType === 9 && body.length >= 2) {
        // SUBACK
        const packetId = (body[0] << 8) | body[1];
        packets.push({ type: 'suback', packetId });
      } else if (packetType === 13) {
        // PINGRESP
        packets.push({ type: 'pingresp' });
      }
    }

    return packets;
  }
}
