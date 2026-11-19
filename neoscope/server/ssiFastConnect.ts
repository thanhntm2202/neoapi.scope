import type { NeoScopeSettings } from './config.ts';

export interface SsiCredentialStatus {
  provider: 'SSI' | 'NEO' | 'SYNTHETIC';
  mode: 'SYNTHETIC' | 'LIVE';
  apiUrl: string;
  streamingUrl: string;
  rateLimitRps: number;
  hasClientId: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  readyForLiveRest: boolean;
  neoBackupReady: boolean;
}

export interface SsiConnectionTestResult {
  ok: boolean;
  checkedAtVn: string;
  statusCode: number | null;
  latencyMs: number;
  stage: 'CREDENTIALS' | 'RATE_LIMIT' | 'AUTH_TOKEN' | 'SECURITIES';
  message: string;
  sampleSecuritiesCount?: number;
}

/**
 * SSI FastConnect API v3 published quote examples report bid/ask prices in thousand-VND
 * while trade tick messages report prices in canonical VND.
 */
export function scaleSsiQuotePrice(rawPrice: unknown): number | null {
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') return null;
  const num = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice).replace(/,/g, '').trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  return num < 1000 ? num * 1000 : num;
}

export function scaleSsiTradePrice(rawPrice: unknown): number | null {
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') return null;
  const num = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice).replace(/,/g, '').trim());
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

export class TokenBucketLimiter {
  private tokens: number;
  private lastRefillMs: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(rps: number, nowFn: () => number = () => Date.now()) {
    this.capacity = Math.max(1, rps);
    this.tokens = this.capacity;
    this.refillPerMs = this.capacity / 1000;
    this.nowFn = nowFn;
    this.lastRefillMs = nowFn();
  }

  private readonly nowFn: () => number;

  tryConsume(cost = 1): boolean {
    const now = this.nowFn();
    const elapsed = Math.max(0, now - this.lastRefillMs);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefillMs = now;
    }
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  availableTokens(): number {
    return this.tokens;
  }
}

export function inspectProviderReadiness(settings: NeoScopeSettings): SsiCredentialStatus {
  const ssiCfg = (settings.data.ssi_api || {}) as Record<string, unknown>;
  const hasClientId = Boolean(process.env.SSI_CLIENT_ID?.trim());
  const hasApiKey = Boolean(process.env.SSI_API_KEY?.trim());
  const hasApiSecret = Boolean(process.env.SSI_API_SECRET?.trim());
  const neoReady = Boolean(process.env.NEO_USERNAME?.trim() && process.env.NEO_PASSWORD?.trim());

  return {
    provider: settings.provider,
    mode: settings.mode,
    apiUrl: String(ssiCfg.api_url || 'https://api.ssi.com.vn'),
    streamingUrl: String(ssiCfg.streaming_url || 'wss://stream.ssi.com.vn/ws/v3'),
    rateLimitRps: Number(ssiCfg.rate_limit_rps || 5),
    hasClientId,
    hasApiKey,
    hasApiSecret,
    readyForLiveRest: hasClientId && hasApiKey && hasApiSecret,
    neoBackupReady: neoReady,
  };
}

let sharedSsiLimiter: TokenBucketLimiter | null = null;

export async function testSsiFastConnectConnection(
  settings: NeoScopeSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<SsiConnectionTestResult> {
  const t0 = Date.now();
  const vnNow = new Date(t0 + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' (UTC+7)';
  const status = inspectProviderReadiness(settings);

  if (!status.readyForLiveRest) {
    const missing: string[] = [];
    if (!status.hasClientId) missing.push('SSI_CLIENT_ID');
    if (!status.hasApiKey) missing.push('SSI_API_KEY');
    if (!status.hasApiSecret) missing.push('SSI_API_SECRET');
    return {
      ok: false,
      checkedAtVn: vnNow,
      statusCode: null,
      latencyMs: Date.now() - t0,
      stage: 'CREDENTIALS',
      message: `Chưa cấu hình biến môi trường SSI FastConnect v3 (${missing.join(', ')}). Hệ thống giữ nguyên chế độ an toàn và không treo.`,
    };
  }

  if (!sharedSsiLimiter) {
    sharedSsiLimiter = new TokenBucketLimiter(status.rateLimitRps);
  }
  if (!sharedSsiLimiter.tryConsume(1)) {
    return {
      ok: false,
      checkedAtVn: vnNow,
      statusCode: 429,
      latencyMs: Date.now() - t0,
      stage: 'RATE_LIMIT',
      message: `Vượt ngưỡng giới hạn tần suất nội bộ (${status.rateLimitRps} req/giây) của SSI FastConnect v3. Vui lòng thử lại sau giây lát.`,
    };
  }

  const ssiCfg = (settings.data.ssi_api || {}) as Record<string, unknown>;
  const restCfg = (ssiCfg.rest || {}) as Record<string, unknown>;
  const authPath = String(restCfg.auth_path || 'api/v3/Market/AccessToken').replace(/^\/+/, '');
  const baseUrl = status.apiUrl.replace(/\/+$/, '');
  const timeoutMs = Number(ssiCfg.timeout_ms || 8000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${baseUrl}/${authPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consumerID: process.env.SSI_CLIENT_ID,
        consumerSecret: process.env.SSI_API_SECRET,
      }),
      signal: controller.signal,
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      return {
        ok: false,
        checkedAtVn: vnNow,
        statusCode: res.status,
        latencyMs: elapsed,
        stage: 'AUTH_TOKEN',
        message: `SSI FastConnect v3 trả mã HTTP ${res.status}. Kiểm tra lại consumerID/consumerSecret hoặc quyền Market Data.`,
      };
    }
    const payload = (await res.json()) as Record<string, unknown>;
    const tokenOk = Boolean(
      (payload.data as Record<string, unknown> | undefined)?.accessToken || payload.accessToken,
    );
    return {
      ok: tokenOk,
      checkedAtVn: vnNow,
      statusCode: res.status,
      latencyMs: elapsed,
      stage: 'AUTH_TOKEN',
      message: tokenOk
        ? `Xác thực OAuth2 SSI FastConnect v3 thành công (${elapsed} ms). Kênh REST Market Data sẵn sàng.`
        : 'Phản hồi SSI thiếu trường accessToken — kiểm tra hợp đồng API.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      checkedAtVn: vnNow,
      statusCode: null,
      latencyMs: Date.now() - t0,
      stage: 'AUTH_TOKEN',
      message: `Lỗi kết nối tới SSI FastConnect v3: ${msg}. Không để ứng dụng treo.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
