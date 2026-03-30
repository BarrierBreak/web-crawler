import type Redis from 'ioredis';

import { config } from '../config';
import { domainCooldownKey } from './keys';
import { sleep } from './time';

const acquireSlotScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local delay = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local nextAt = tonumber(redis.call("GET", key) or "0")
if nextAt > now then
  return nextAt - now
end
redis.call("SET", key, now + delay, "PX", ttl)
return 0
`;

const extendCooldownScript = `
local key = KEYS[1]
local target = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call("GET", key) or "0")
if target > current then
  redis.call("SET", key, target, "PX", ttl)
end
return 1
`;

export class PolitenessService {
  constructor(private readonly redis: Redis) {}

  async waitForSlot(origin: string, baseDelayMs: number): Promise<void> {
    const delayMs = Math.max(baseDelayMs, config.defaultPolitenessMs);
    const ttlMs = Math.max(delayMs * 20, 60_000);
    const key = domainCooldownKey(origin);

    for (;;) {
      const waitMs = Number(
        await this.redis.eval(acquireSlotScript, 1, key, Date.now(), delayMs, ttlMs)
      );

      if (waitMs <= 0) {
        return;
      }

      await sleep(waitMs);
    }
  }

  async extendCooldown(origin: string, delayMs: number): Promise<void> {
    const ttlMs = Math.max(delayMs * 20, 60_000);
    const key = domainCooldownKey(origin);
    await this.redis.eval(extendCooldownScript, 1, key, Date.now() + delayMs, ttlMs);
  }
}
