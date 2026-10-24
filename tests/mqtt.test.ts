import { describe, expect, it } from "vitest";
import {
  deriveRoomKeys,
  deriveSessionKey,
  EncryptedSession,
  encryptHandshake,
  decryptHandshake,
  generateEphemeralKeyPair,
  HandshakeReplayGuard,
  isValidRoomSecret,
  newRoomSecret,
  randomHex,
  type HandshakeSyn,
} from "../client/src/net/mqttCrypto";
import {
  encodeConnect,
  encodeDisconnect,
  encodePingReq,
  encodePublish,
  encodeSubscribe,
  MqttStreamDecoder,
} from "../client/src/net/mqttPacket";
import { ReliableLink } from "../client/src/net/mqttReliable";
import {
  MqttClientConnection,
  MqttHostServer,
  type WebSocketFactory,
  type WebSocketLike,
} from "../client/src/net/mqttTransport";
import { HostController } from "../shared/host";
import type { HostMessage } from "../shared/protocol";
import { DEFAULT_SETTINGS, PRESET_ROLES } from "../shared/roles";

const SECRET = newRoomSecret();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Two ends of one encrypted session, as the client and the host would hold them. */
async function sessionPair() {
  const clientKp = await generateEphemeralKeyPair();
  const hostKp = await generateEphemeralKeyPair();
  const cn = randomHex(12);
  const hn = randomHex(12);
  const clientKey = await deriveSessionKey(
    clientKp.privateKey,
    hostKp.publicKeyB64,
    "ABCDE",
    "c1",
    "sess-1",
    cn,
    hn,
  );
  const hostKey = await deriveSessionKey(
    hostKp.privateKey,
    clientKp.publicKeyB64,
    "ABCDE",
    "c1",
    "sess-1",
    cn,
    hn,
  );
  return {
    client: new EncryptedSession("sess-1", clientKey, "c2h", "h2c"),
    host: new EncryptedSession("sess-1", hostKey, "h2c", "c2h"),
  };
}

/**
 * In-memory MQTT v3.1.1 broker for testing multi-client pub/sub, wildcard topics (`+`),
 * Last Will and Testament (LWT), and broker failover without external network calls.
 */
class MockMqttBroker {
  private clients = new Set<{
    subs: string[];
    will?: { topic: string; payload: Uint8Array };
    sendFrame: (bytes: Uint8Array) => void;
    closed: boolean;
  }>();

  offline = false;
  publishedTopics: string[] = [];
  publishedPayloads: string[] = [];

  createSocket(): WebSocketLike {
    const stream = new MqttStreamDecoder();
    const client = {
      subs: [] as string[],
      will: undefined as { topic: string; payload: Uint8Array } | undefined,
      sendFrame: (bytes: Uint8Array) => {
        if (ws.readyState === 1) ws.onmessage?.({ data: bytes });
      },
      closed: false,
    };

    const ws: WebSocketLike & { readyState: number; crash: () => void } = {
      binaryType: "arraybuffer",
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data: Uint8Array) => {
        if (this.offline || ws.readyState !== 1) return;
        for (const pkt of stream.push(data)) {
          if (pkt.type === "publish") {
            this.broadcast(pkt.topic, pkt.payload);
          }
        }
        // Check CONNECT (0x10) after stream decoder so multi-byte remaining length is handled cleanly
        if (data[0] >> 4 === 1) {
          let idx = 1;
          while ((data[idx++] & 128) !== 0) {
            // skip remaining length varint
          }
          // Variable header: [0x00, 0x04, 'M','Q','T','T', 0x04, flags, keepAliveHi, keepAliveLo]
          const flags = data[idx + 7];
          const hasWill = (flags & 0x04) !== 0;
          if (hasWill) {
            let pos = idx + 10;
            const cidLen = (data[pos] << 8) | data[pos + 1];
            pos += 2 + cidLen;
            const wTopicLen = (data[pos] << 8) | data[pos + 1];
            pos += 2;
            const wTopic = new TextDecoder().decode(
              data.subarray(pos, pos + wTopicLen),
            );
            pos += wTopicLen;
            const wPayloadLen = (data[pos] << 8) | data[pos + 1];
            pos += 2;
            const wPayload = data.slice(pos, pos + wPayloadLen);
            client.will = { topic: wTopic, payload: wPayload };
          }
          this.clients.add(client);
          queueMicrotask(() => {
            client.sendFrame(new Uint8Array([0x20, 0x02, 0x00, 0x00]));
          });
          return;
        }
        if (data[0] === 0x82) {
          let idx = 1;
          while ((data[idx++] & 128) !== 0) {
            // skip varint
          }
          const pktIdHi = data[idx++];
          const pktIdLo = data[idx++];
          while (idx < data.length) {
            const tLen = (data[idx] << 8) | data[idx + 1];
            idx += 2;
            const topic = new TextDecoder().decode(
              data.subarray(idx, idx + tLen),
            );
            idx += tLen + 1;
            client.subs.push(topic);
          }
          queueMicrotask(() => {
            client.sendFrame(
              new Uint8Array([0x90, 0x03, pktIdHi, pktIdLo, 0x00]),
            );
          });
          return;
        }
        if (data[0] === 0xc0) {
          queueMicrotask(() => client.sendFrame(new Uint8Array([0xd0, 0x00])));
          return;
        }
        if (data[0] === 0xe0) {
          client.will = undefined;
          return;
        }
      },
      close: () => {
        if (client.closed) return;
        client.closed = true;
        ws.readyState = 3;
        this.clients.delete(client);
        ws.onclose?.();
      },
      crash: () => {
        if (client.closed) return;
        client.closed = true;
        ws.readyState = 3;
        this.clients.delete(client);
        if (client.will) {
          this.broadcast(client.will.topic, client.will.payload);
        }
        ws.onclose?.();
      },
    };

    queueMicrotask(() => {
      if (this.offline) {
        ws.readyState = 3;
        ws.onerror?.();
        ws.onclose?.();
      } else {
        ws.readyState = 1;
        ws.onopen?.();
      }
    });

    return ws;
  }

  broadcast(topic: string, payload: Uint8Array) {
    this.publishedTopics.push(topic);
    this.publishedPayloads.push(new TextDecoder().decode(payload));
    const frame = encodePublish(topic, payload);
    for (const c of this.clients) {
      if (c.subs.some((pattern) => matchesTopic(pattern, topic))) {
        queueMicrotask(() => c.sendFrame(frame));
      }
    }
  }
}

function matchesTopic(pattern: string, topic: string): boolean {
  const pParts = pattern.split("/");
  const tParts = topic.split("/");
  if (pParts.length !== tParts.length) return false;
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i] === "+") continue;
    if (pParts[i] !== tParts[i]) return false;
  }
  return true;
}

describe("MQTT binary packet codec", () => {
  it("encodes and decodes fragmented publish, subscribe, and ping packets", () => {
    const decoder = new MqttStreamDecoder();
    const pub1 = encodePublish("mfo/v2/abc/join", '{"hello":"world"}');
    const pub2 = encodePublish(
      "mfo/v2/abc/c/123",
      new Uint8Array([1, 2, 3, 4]),
    );
    const pingResp = new Uint8Array([0xd0, 0x00]);

    // Concatenate and feed in 3-byte chunks to verify streaming reassembly
    const combined = new Uint8Array(
      pub1.length + pub2.length + pingResp.length,
    );
    combined.set(pub1, 0);
    combined.set(pub2, pub1.length);
    combined.set(pingResp, pub1.length + pub2.length);

    const decoded = [];
    for (let i = 0; i < combined.length; i += 3) {
      decoded.push(...decoder.push(combined.subarray(i, i + 3)));
    }

    expect(decoded).toHaveLength(3);
    expect(decoded[0]).toMatchObject({
      type: "publish",
      topic: "mfo/v2/abc/join",
    });
    expect(
      new TextDecoder().decode((decoded[0] as { payload: Uint8Array }).payload),
    ).toBe('{"hello":"world"}');
    expect(decoded[1]).toMatchObject({
      type: "publish",
      topic: "mfo/v2/abc/c/123",
    });
    expect(Array.from((decoded[1] as { payload: Uint8Array }).payload)).toEqual(
      [1, 2, 3, 4],
    );
    expect(decoded[2]).toEqual({ type: "pingresp" });

    // Also verify CONNECT, SUBSCRIBE, PINGREQ, DISCONNECT headers
    expect(encodeConnect({ clientId: "test-1" })[0]).toBe(0x10);
    expect(encodeSubscribe(7, ["a/b"])[0]).toBe(0x82);
    expect(encodePingReq()).toEqual(new Uint8Array([0xc0, 0x00]));
    expect(encodeDisconnect()).toEqual(new Uint8Array([0xe0, 0x00]));
  });
});

describe("MQTT E2EE cryptography & replay protection", () => {
  it("obfuscates room codes in topic hashes and derives deterministic room keys", async () => {
    const k1 = await deriveRoomKeys("ABCDE", SECRET);
    const k2 = await deriveRoomKeys("abcde", SECRET);
    const k3 = await deriveRoomKeys("ZYXWV", SECRET);
    expect(k1.topicHash).toBe(k2.topicHash);
    expect(k1.topicHash).toHaveLength(32);
    expect(k1.topicHash.toLowerCase()).not.toContain("abcde");
    expect(k1.topicHash).not.toBe(k3.topicHash);
  });

  it("needs the host secret: same code with another secret gives an unrelated room", async () => {
    const other = newRoomSecret();
    expect(other).not.toBe(SECRET);
    expect(isValidRoomSecret(SECRET)).toBe(true);
    expect(SECRET.length).toBeGreaterThanOrEqual(43);
    const a = await deriveRoomKeys("ABCDE", SECRET);
    const b = await deriveRoomKeys("ABCDE", other);
    expect(a.topicHash).not.toBe(b.topicHash);
    for (const bad of [
      "",
      "short",
      "has spaces in it and is long enough!!",
      null,
      undefined,
    ]) {
      expect(isValidRoomSecret(bad as string)).toBe(false);
    }
    await expect(deriveRoomKeys("ABCDE", "short")).rejects.toThrow();
  });

  it("rejects handshake tampering, wrong room keys, and handshake replay attacks", async () => {
    const roomA = await deriveRoomKeys("ABCDE", SECRET);
    const roomB = await deriveRoomKeys("ABCDE", newRoomSecret());
    const kp = await generateEphemeralKeyPair();
    const syn: HandshakeSyn = {
      t: "syn",
      clientId: "c1",
      clientPub: kp.publicKeyB64,
      clientNonce: randomHex(12),
      ts: Date.now(),
    };

    const wire = await encryptHandshake(
      roomA.roomAuthKey,
      roomA.topicHash,
      syn,
    );
    // Ciphertext hides clientId and public key
    expect(wire).not.toContain(kp.publicKeyB64);

    // Wrong room key cannot decrypt
    expect(
      await decryptHandshake(roomB.roomAuthKey, roomB.topicHash, "syn", wire),
    ).toBeNull();
    // Wrong expected type in AAD fails authentication
    expect(
      await decryptHandshake(
        roomA.roomAuthKey,
        roomA.topicHash,
        "syn-ack",
        wire,
      ),
    ).toBeNull();

    // Valid decrypt succeeds
    const dec = await decryptHandshake<HandshakeSyn>(
      roomA.roomAuthKey,
      roomA.topicHash,
      "syn",
      wire,
    );
    expect(dec).toEqual(syn);

    // Replay guard accepts once and rejects duplicate or expired nonces
    const guard = new HandshakeReplayGuard();
    expect(guard.checkAndRecord(dec!)).toBe(true);
    expect(guard.checkAndRecord(dec!)).toBe(false);
    expect(
      guard.checkAndRecord({
        ...syn,
        clientNonce: randomHex(12),
        ts: Date.now() - 300_000,
      }),
    ).toBe(false);
  });

  it("encrypts frames and blocks tampering, reflection and control replay", async () => {
    const { client, host } = await sessionPair();

    const d1 = await client.sealData(1, { secret: "mafia-target-eve" });
    // Plaintext is never visible on the wire
    expect(d1).not.toContain("mafia-target-eve");
    // Reflection: the client can't open its own c2h frame
    expect(await client.open(d1)).toBeNull();
    expect(await host.open(d1)).toEqual({
      ch: "d",
      seq: 1,
      data: { secret: "mafia-target-eve" },
    });
    // Data frames may repeat (re-sends); the reliable link dedupes them by seq
    expect(await host.open(d1)).toEqual({
      ch: "d",
      seq: 1,
      data: { secret: "mafia-target-eve" },
    });

    // Tampered seq breaks authentication
    const parsed = JSON.parse(d1) as { seq: number };
    expect(
      await host.open(JSON.stringify({ ...parsed, seq: parsed.seq + 1 })),
    ).toBeNull();

    // Control frames are replay-protected
    const c1 = await client.sealControl({ k: "ping" });
    const c2 = await client.sealControl({ k: "ack", upTo: 3 });
    expect(await host.open(c2)).toEqual({
      ch: "c",
      frame: { k: "ack", upTo: 3 },
    });
    expect(await host.open(c2)).toBeNull();
    expect(await host.open(c1)).toBeNull();
  });
});

describe("Reliable delivery over a lossy relay", () => {
  /** Wires two links together through a channel that can drop, duplicate and reorder frames. */
  async function lossyPair(
    chaos: (wire: string, deliver: (w: string) => void) => void,
  ) {
    const { client, host } = await sessionPair();
    const got: unknown[] = [];
    let broken = false;
    const ends: { a?: ReliableLink; b?: ReliableLink } = {};
    const opts = { resendAfterMs: 60, maxSends: 50 };
    ends.a = new ReliableLink(
      client,
      (w) => chaos(w, (x) => void ends.b!.receive(x)),
      {
        onData: () => {},
        onControl: () => {},
        onBroken: () => (broken = true),
      },
      opts,
    );
    ends.b = new ReliableLink(
      host,
      (w) => chaos(w, (x) => void ends.a!.receive(x)),
      {
        onData: (d) => got.push(d),
        onControl: () => {},
        onBroken: () => (broken = true),
      },
      opts,
    );
    return { a: ends.a, b: ends.b, got, isBroken: () => broken };
  }

  it("delivers every message exactly once, in order, despite loss, duplicates and reordering", async () => {
    let n = 0;
    const { a, b, got, isBroken } = await lossyPair((wire, deliver) => {
      n++;
      if (n % 3 === 0) return; // drop every third frame
      if (n % 5 === 0) deliver(wire); // duplicate
      setTimeout(() => deliver(wire), (n * 7) % 30); // reorder
    });
    for (let i = 1; i <= 40; i++) a.send({ i });
    for (let t = 0; t < 80 && got.length < 40; t++) await wait(25);
    expect(got).toEqual(Array.from({ length: 40 }, (_, k) => ({ i: k + 1 })));
    for (let t = 0; t < 40 && a.pending > 0; t++) await wait(25);
    expect(a.pending).toBe(0); // everything was acknowledged
    expect(isBroken()).toBe(false);
    a.close();
    b.close();
  });

  it("reports a broken link when nothing gets through", async () => {
    const { client } = await sessionPair();
    let broken = false;
    const link = new ReliableLink(
      client,
      () => {},
      {
        onData: () => {},
        onControl: () => {},
        onBroken: () => (broken = true),
      },
      { resendAfterMs: 20, maxSends: 3 },
    );
    link.send({ vote: "x" });
    for (let t = 0; t < 40 && !broken; t++) await wait(10);
    expect(broken).toBe(true);
    link.close();
  });
});

describe("MQTT transport integration & broker failover", () => {
  it("connects phones over MQTT fallback to HostController with full E2EE and broker failover", async () => {
    const brokenBroker = new MockMqttBroker();
    brokenBroker.offline = true;
    const workingBroker = new MockMqttBroker();

    const brokers = [
      "wss://broken.example/mqtt",
      "wss://working.example/mqtt",
    ] as const;
    const wsFactory: WebSocketFactory = (url) =>
      url.includes("broken")
        ? brokenBroker.createSocket()
        : workingBroker.createSocket();

    const host = new HostController(null, () => {}, "build-1");
    host.hostAction("host:setup", {
      names: ["Ann", "Bob", "Cat"],
      roles: PRESET_ROLES,
      roleCounts: { mafia: 1, police: 0, doctor: 0, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });

    const mqttHost = new MqttHostServer("ROOMX", SECRET, {
      brokers,
      wsFactory,
      onConnection: (conn) => {
        const id = conn.connectionId;
        conn.on("open", () =>
          host.connect({
            id,
            send: (msg) => conn.open && conn.send(msg),
            relayed: !!conn.relayed,
          }),
        );
        conn.on("data", (data) => host.receive(id, data));
        conn.on("close", () => host.disconnect(id));
      },
    });

    // Give host a moment to derive keys and subscribe on the working broker
    await new Promise((r) => setTimeout(r, 60));
    expect(mqttHost.isOnline).toBe(true);

    // Client tries brokenBroker first, fails over to workingBroker automatically
    const received: HostMessage[] = [];
    const client = new MqttClientConnection("ROOMX", SECRET, {
      brokers,
      wsFactory,
      brokerAttemptTimeoutMs: 100,
    });

    await new Promise<void>((resolve) => {
      client.on("open", () => {
        client.send({ t: "hello", build: "build-1", token: null });
      });
      client.on("data", (d) => {
        const msg = d as HostMessage;
        received.push(msg);
        if (msg.t === "state" && !msg.state.you) {
          // Claim Ann's seat over MQTT
          const annId = msg.state.public.players[0].id;
          client.send({ t: "act", event: "player:claim", args: [annId] });
        } else if (msg.t === "state" && msg.state.you?.name === "Ann") {
          resolve();
        }
      });
    });

    expect(client.relayed).toBe(true);
    expect(host.view().public.players[0]).toMatchObject({
      name: "Ann",
      claimed: true,
      connected: true,
      relayed: true,
    });
    expect(host.view().public.players[1].relayed).toBeUndefined();

    // Verify topic obfuscation & payload encryption on the public broker
    for (const t of workingBroker.publishedTopics) {
      expect(t).not.toContain("ROOMX");
      expect(t.startsWith("mfo/v2/")).toBe(true);
    }
    for (const p of workingBroker.publishedPayloads) {
      expect(p).not.toContain("player:claim");
      expect(p).not.toContain('"Ann"');
    }

    // Verify graceful disconnect propagates to HostController
    client.close();
    await new Promise((r) => setTimeout(r, 40));
    expect(host.view().public.players[0].connected).toBe(false);

    mqttHost.destroy();
    host.dispose();
  });

  it("detects sudden client tab crash via encrypted MQTT Last Will and Testament (LWT)", async () => {
    const broker = new MockMqttBroker();
    const clientSockets: (WebSocketLike & { crash?: () => void })[] = [];
    const wsFactory: WebSocketFactory = () => {
      const s = broker.createSocket() as WebSocketLike & { crash?: () => void };
      clientSockets.push(s);
      return s;
    };

    const host = new HostController(null, () => {}, "build-1");
    host.hostAction("host:setup", {
      names: ["Ann", "Bob", "Cat"],
      roles: PRESET_ROLES,
      roleCounts: { mafia: 1, police: 0, doctor: 0, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });

    const mqttHost = new MqttHostServer("CRASH", SECRET, {
      brokers: ["wss://broker.example/mqtt"],
      wsFactory,
      onConnection: (conn) => {
        const id = conn.connectionId;
        conn.on("open", () =>
          host.connect({
            id,
            send: (msg) => conn.open && conn.send(msg),
            relayed: !!conn.relayed,
          }),
        );
        conn.on("data", (data) => host.receive(id, data));
        conn.on("close", () => host.disconnect(id));
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    const client = new MqttClientConnection("CRASH", SECRET, {
      brokers: ["wss://broker.example/mqtt"],
      wsFactory,
    });

    await new Promise<void>((resolve) => {
      client.on("open", () =>
        client.send({ t: "hello", build: "build-1", token: null }),
      );
      client.on("data", (d) => {
        const msg = d as HostMessage;
        if (msg.t === "state" && !msg.state.you) {
          client.send({
            t: "act",
            event: "player:claim",
            args: [msg.state.public.players[1].id],
          });
        } else if (msg.t === "state" && msg.state.you?.name === "Bob") {
          resolve();
        }
      });
    });

    expect(host.view().public.players[1].connected).toBe(true);

    // Simulate ungraceful tab crash (triggers broker LWT)
    const clientWs = clientSockets.at(-1)!;
    clientWs.crash!();

    await new Promise((r) => setTimeout(r, 40));
    expect(host.view().public.players[1].connected).toBe(false);

    mqttHost.destroy();
    host.dispose();
  });
});

describe("MQTT relay needs the QR secret", () => {
  it("a phone with the wrong secret never reaches the host", async () => {
    const broker = new MockMqttBroker();
    const wsFactory: WebSocketFactory = () => broker.createSocket();
    let connections = 0;
    const mqttHost = new MqttHostServer("ROOMQ", SECRET, {
      brokers: ["wss://broker.example/mqtt"],
      wsFactory,
      onConnection: () => connections++,
    });
    await wait(50);
    const client = new MqttClientConnection("ROOMQ", newRoomSecret(), {
      brokers: ["wss://broker.example/mqtt"],
      wsFactory,
    });
    let opened = false;
    client.on("open", () => (opened = true));
    await wait(150);
    expect(opened).toBe(false);
    expect(connections).toBe(0);
    client.close();
    mqttHost.destroy();
  });
});

describe("HostController relay tracking", () => {
  it("marks a player relayed only while all their connections are relayed", () => {
    const host = new HostController(null, () => {}, "b");
    host.hostAction("host:setup", {
      names: ["Ann", "Bob", "Cat"],
      roles: PRESET_ROLES,
      roleCounts: { mafia: 1, police: 0, doctor: 0, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });
    const annId = host.view().public.players[0].id;
    host.connect({ id: "c1", send: () => {} });
    host.receive("c1", { t: "act", event: "player:claim", args: [annId] });
    expect(host.view().public.players[0].relayed).toBeUndefined();
    host.setRelayed("c1", true); // e.g. TURN detected after the link opened
    expect(host.view().public.players[0].relayed).toBe(true);
    host.setRelayed("c1", false);
    expect(host.view().public.players[0].relayed).toBeUndefined();
    host.dispose();
  });
});
