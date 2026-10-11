import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";
import { db } from "../db/index.js";
import { whatsappAuthState } from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../security/crypto.js";

// Baileys' multi-device session (the reference project kept it in ./auth_info_baileys/). Here every
// entry is an AES-GCM encrypted row in MySQL, so the linked device survives restarts and redeploys
// on hosts without a persistent disk, and the session never sits on disk in plain text.

const CREDS_KEY = "creds";

function rowKey(name: string) {
  return name.length <= 190 ? name : `sha256:${createHash("sha256").update(name).digest("hex")}`;
}

async function readMany(names: string[]) {
  if (!names.length) return new Map<string, unknown>();
  const keys = names.map(rowKey);
  const rows = await db.select().from(whatsappAuthState).where(inArray(whatsappAuthState.keyName, keys));
  const values = new Map<string, unknown>();
  for (const row of rows) {
    try { values.set(row.keyName, JSON.parse(decryptSecret(row.valueEncrypted), BufferJSON.reviver)); } catch { /* unreadable row is treated as missing */ }
  }
  return values;
}

async function write(name: string, value: unknown) {
  const valueEncrypted = encryptSecret(JSON.stringify(value, BufferJSON.replacer));
  await db.insert(whatsappAuthState).values({ keyName: rowKey(name), valueEncrypted }).onDuplicateKeyUpdate({ set: { valueEncrypted } });
}

async function remove(names: string[]) {
  if (names.length) await db.delete(whatsappAuthState).where(inArray(whatsappAuthState.keyName, names.map(rowKey)));
}

export async function hasLinkedSession() {
  const creds = (await readMany([CREDS_KEY])).get(rowKey(CREDS_KEY)) as AuthenticationCreds | undefined;
  return Boolean(creds?.me?.id);
}

export async function clearAuthState() {
  await db.delete(whatsappAuthState);
}

export async function useDbAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const stored = (await readMany([CREDS_KEY])).get(rowKey(CREDS_KEY)) as AuthenticationCreds | undefined;
  const creds = stored ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const values = await readMany(ids.map((id) => `${type}-${id}`));
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let value = values.get(rowKey(`${type}-${id}`));
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            if (value) data[id] = value as SignalDataTypeMap[T];
          }
          return data;
        },
        set: async (data) => {
          const removals: string[] = [];
          const writes: Promise<void>[] = [];
          for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            for (const [id, value] of Object.entries(data[category] ?? {})) {
              const name = `${category}-${id}`;
              if (value) writes.push(write(name, value)); else removals.push(name);
            }
          }
          await Promise.all([...writes, remove(removals)]);
        }
      }
    },
    saveCreds: () => write(CREDS_KEY, creds)
  };
}


