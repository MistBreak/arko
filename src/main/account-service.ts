import { app, safeStorage } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import { ARKO_CLOUD_PROVIDER_ID, PRESET_ARKO_CLOUD_MODELS } from '@shared/constants'
import type {
  AIModelItem,
  AIProviderConfig,
  ArkoAccountState,
  ArkoAccountUser,
  ArkoAuthResult,
  ArkoAuthServerCapabilities,
  ArkoBalancePlanPurchaseResult,
  ArkoBillingSummary,
  ArkoCaptchaChallenge,
  ArkoRedeemResult,
  ArkoSubscriptionItem,
  ArkoSubscriptionPlanItem,
  ArkoTopUpCheckoutResult,
  ArkoTopUpOrderStatusResult,
  ArkoTopUpPaymentMethod,
  ArkoTopUpQuoteResult,
  TokenQuotaResult
} from '@shared/types'

// Upstream cloud gateway endpoint stays strictly inside Electron Main Process.
const DEFAULT_CLOUD_GATEWAY_ORIGIN =
  process.env['ARKO_CLOUD_UPSTREAM_URL']?.trim().replace(/\/+$/, '') ||
  Buffer.from('aHR0cHM6Ly83MTF0b2tlbi5jb20=', 'base64').toString('utf-8')

const REFRESH_COOKIE_NAME = 'new_api_refresh'
const DEFAULT_QUOTA_PER_UNIT = 500000
const SAFE_TRADE_NO_RE = /^[A-Za-z0-9]{1,64}$/
const ALLOWED_QR_TEXT_PROTOCOLS = ['https:', 'http:', 'weixin:', 'alipays:', 'alipayqr:']

interface PersistedCloudAccountFile {
  user: ArkoAccountUser | null
  billing?: ArkoBillingSummary | null
  plans?: ArkoSubscriptionPlanItem[]
  sessionId?: string
  accessExpiresAt?: number
  accessTokenSecret?: string
  refreshTokenSecret?: string
  cloudApiKeySecret?: string
  quotaPerUnit?: number
  defaultUseAutoGroup?: boolean
  emailToUsernameMap?: Record<string, string>
  usernameToEmailMap?: Record<string, string>
  syncedAt?: number
}

/**
 * 校验扫码支付文本内容是否安全（限制长度、过滤控制字符并校验受控协议前缀）。
 * @param value 网关返回的原始二维码文本
 * @returns 是否允许在本地生成支付二维码
 */
function isSafeQrCodePayload(value?: string | null): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return false
  }
  try {
    const parsed = new URL(trimmed)
    return ALLOWED_QR_TEXT_PROTOCOLS.includes(parsed.protocol.toLowerCase())
  } catch {
    return false
  }
}

/**
 * 校验网关托管二维码图片地址是否为安全的 HTTPS 或 PNG/SVG/JPEG DataURL。
 * @param value 网关返回的备用二维码图片地址
 * @returns 是否允许在渲染层直接展示
 */
function isSafeQrImageUrl(value?: string | null): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 8192) return false
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true
  }
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * Scrubs any upstream gateway hostnames or brand identifiers from server messages/errors
 * so Arko Browser presents a 100% self-contained account and cloud AI experience.
 */
export function sanitizeCloudBranding(input?: string | null): string {
  if (!input) return ''
  return String(input)
    .replace(/https?:\/\/([a-z0-9-]+\.)*711token\.[a-z]+(\/[^\s"'<>)]*)?/gi, 'Arko Cloud')
    .replace(/\b([a-z0-9-]+\.)*711token\.[a-z]+(\/[^\s"'<>)]*)?/gi, 'Arko Cloud')
    .replace(/711\s*[-_]?\s*token(\s*switch|\s*image)?/gi, 'Arko Cloud')
    .replace(/\bnew[-_\s]?api\b/gi, 'Arko Cloud')
    .trim()
}

function encodeSecret(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(plain).toString('base64')}`
    }
  } catch {
    // Fallback below if OS keychain is unavailable
  }
  return `b64:${Buffer.from(plain, 'utf-8').toString('base64')}`
}

function decodeSecret(encoded?: string): string {
  if (!encoded) return ''
  try {
    if (encoded.startsWith('enc:')) {
      const buf = Buffer.from(encoded.slice(4), 'base64')
      return safeStorage.decryptString(buf)
    }
    if (encoded.startsWith('b64:')) {
      return Buffer.from(encoded.slice(4), 'base64').toString('utf-8')
    }
  } catch {
    return ''
  }
  return ''
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 50
}

function deriveSafeUsernameFromEmail(email: string, explicitUsername?: string): string {
  const custom = explicitUsername?.trim()
  if (custom) {
    return custom.slice(0, 20)
  }
  if (email.length <= 20) {
    return email
  }
  const [localPart = 'user', domainPart = ''] = email.split('@')
  const cleanedLocal = localPart.replace(/[^a-zA-Z0-9._-]/g, '') || 'arko'
  const hash4 = crypto
    .createHash('sha256')
    .update(`${localPart}@${domainPart}`)
    .digest('hex')
    .slice(0, 4)
  const prefix = cleanedLocal.slice(0, 15)
  return `${prefix}_${hash4}`.slice(0, 20)
}

function formatModelLabel(id: string): string {
  const preset = PRESET_ARKO_CLOUD_MODELS.find((m) => m.id === id)
  if (preset) return preset.label
  return id
    .split(/[-_/]+/)
    .map((part) => {
      if (/^gpt$/i.test(part)) return 'GPT'
      if (/^o\d/i.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function extractCookieValue(resp: Response, cookieName: string): string | null {
  const headersAny = resp.headers as unknown as { getSetCookie?: () => string[] }
  const setCookies: string[] =
    typeof headersAny.getSetCookie === 'function'
      ? headersAny.getSetCookie()
      : resp.headers.get('set-cookie')
        ? [resp.headers.get('set-cookie')!]
        : []

  for (const raw of setCookies) {
    const firstPair = raw.split(';')[0]?.trim() || ''
    const eqIdx = firstPair.indexOf('=')
    if (eqIdx <= 0) continue
    const name = firstPair.slice(0, eqIdx).trim()
    const val = firstPair.slice(eqIdx + 1).trim()
    if (name === cookieName) {
      return val
    }
  }
  return null
}

function extractLockoutMinutes(json: Record<string, any>): number | undefined {
  if (json?.code !== 'AUTH_LOGIN_LOCKED' && json?.data?.code !== 'AUTH_LOGIN_LOCKED') {
    return undefined
  }
  const retryAfter = Number(json?.retry_after ?? json?.data?.retry_after ?? 0)
  if (retryAfter > 0) {
    return Math.max(1, Math.ceil(retryAfter / 60))
  }
  return 60
}

export class AccountService {
  private filePath: string
  private user: ArkoAccountUser | null = null
  private billingSummary: ArkoBillingSummary | null = null
  private availablePlans: ArkoSubscriptionPlanItem[] = []
  private sessionId = ''
  private accessExpiresAt = 0
  private accessToken = ''
  private refreshToken = ''
  private cloudApiKey = ''
  private quotaPerUnit = DEFAULT_QUOTA_PER_UNIT
  private defaultUseAutoGroup = true
  private passwordEncryptionEnabled = false
  private emailToUsernameMap: Record<string, string> = {}
  private usernameToEmailMap: Record<string, string> = {}
  private syncedAt = 0

  private cachedCapabilities: ArkoAuthServerCapabilities = {
    registerEnabled: true,
    passwordLoginEnabled: true,
    passwordRegisterEnabled: true,
    emailVerificationRequired: false,
    registerCaptchaEnabled: true
  }
  private capabilitiesFetchedAt = 0
  private onStateChange?: () => void

  constructor(legacyCloudApiKey?: string) {
    const storeDir = path.join(app.getPath('userData'), 'arko-browser-store')
    fs.mkdirSync(storeDir, { recursive: true })
    this.filePath = path.join(storeDir, 'cloud-account.json')
    this.loadFromDisk()

    if (!this.cloudApiKey && legacyCloudApiKey?.trim()) {
      const normalized = legacyCloudApiKey.trim().startsWith('sk-')
        ? legacyCloudApiKey.trim()
        : `sk-${legacyCloudApiKey.trim()}`
      this.cloudApiKey = normalized
      this.saveToDisk()
    }
  }

  public setOnStateChange(cb: () => void): void {
    this.onStateChange = cb
  }

  public getGatewayOrigin(): string {
    return DEFAULT_CLOUD_GATEWAY_ORIGIN
  }

  public getCloudApiKey(): string {
    return this.cloudApiKey
  }

  public isCloudProvider(provider?: AIProviderConfig | null): boolean {
    if (!provider) return false
    return provider.id === ARKO_CLOUD_PROVIDER_ID || Boolean(provider.isArkoCloud)
  }

  /**
   * Resolves an AIProviderConfig at runtime inside Main Process:
   * injects the private gateway URL, provisioned sk-... key, and optimal protocol.
   */
  public resolveRuntimeProvider(
    provider: AIProviderConfig,
    targetModelId?: string
  ): AIProviderConfig {
    if (!this.isCloudProvider(provider)) {
      return provider
    }
    const model = (targetModelId || provider.defaultModelId || '').toLowerCase()
    const useAnthropicNative = model.startsWith('claude-')
    return {
      ...provider,
      isArkoCloud: true,
      protocol: useAnthropicNative ? 'anthropic-messages' : 'openai-chat',
      baseUrl: useAnthropicNative
        ? DEFAULT_CLOUD_GATEWAY_ORIGIN
        : `${DEFAULT_CLOUD_GATEWAY_ORIGIN}/v1`,
      apiKey: this.cloudApiKey
    }
  }

  public getState(): ArkoAccountState {
    return {
      authenticated: Boolean(this.user && (this.accessToken || this.refreshToken)),
      hasCloudCredential: Boolean(this.cloudApiKey),
      user: this.user ? { ...this.user } : null,
      billing: this.billingSummary ? JSON.parse(JSON.stringify(this.billingSummary)) : null,
      plans: this.availablePlans.length > 0 ? [...this.availablePlans] : undefined,
      capabilities: { ...this.cachedCapabilities },
      syncedAt: this.syncedAt || undefined
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as PersistedCloudAccountFile
      this.user = raw.user || null
      this.billingSummary = raw.billing || null
      this.availablePlans = Array.isArray(raw.plans) ? raw.plans : []
      this.sessionId = raw.sessionId || ''
      this.accessExpiresAt = Number(raw.accessExpiresAt || 0)
      this.accessToken = decodeSecret(raw.accessTokenSecret)
      this.refreshToken = decodeSecret(raw.refreshTokenSecret)
      this.cloudApiKey = decodeSecret(raw.cloudApiKeySecret)
      this.quotaPerUnit = Number(raw.quotaPerUnit) || DEFAULT_QUOTA_PER_UNIT
      this.defaultUseAutoGroup = raw.defaultUseAutoGroup !== false
      this.emailToUsernameMap = raw.emailToUsernameMap || {}
      this.usernameToEmailMap = raw.usernameToEmailMap || {}
      this.syncedAt = Number(raw.syncedAt || 0)
    } catch {
      // Ignore corrupted local cache
    }
  }

  private saveToDisk(): void {
    try {
      const payload: PersistedCloudAccountFile = {
        user: this.user,
        billing: this.billingSummary || undefined,
        plans: this.availablePlans.length > 0 ? this.availablePlans : undefined,
        sessionId: this.sessionId || undefined,
        accessExpiresAt: this.accessExpiresAt || undefined,
        accessTokenSecret: this.accessToken ? encodeSecret(this.accessToken) : undefined,
        refreshTokenSecret: this.refreshToken ? encodeSecret(this.refreshToken) : undefined,
        cloudApiKeySecret: this.cloudApiKey ? encodeSecret(this.cloudApiKey) : undefined,
        quotaPerUnit: this.quotaPerUnit,
        defaultUseAutoGroup: this.defaultUseAutoGroup,
        emailToUsernameMap: this.emailToUsernameMap,
        usernameToEmailMap: this.usernameToEmailMap,
        syncedAt: this.syncedAt || undefined
      }
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8')
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('[AccountService] Failed saving cloud account state:', err)
    }
  }

  private notifyChanged(): void {
    this.onStateChange?.()
  }

  private mapRawUser(raw: Record<string, any>, fallbackEmail?: string): ArkoAccountUser {
    const username = String(raw?.username || '').trim()
    const rawEmail = normalizeEmail(String(raw?.email || ''))
    const knownEmail =
      rawEmail ||
      (fallbackEmail && isValidEmail(fallbackEmail) ? normalizeEmail(fallbackEmail) : '') ||
      this.usernameToEmailMap[username.toLowerCase()] ||
      (isValidEmail(username) ? normalizeEmail(username) : '')

    if (knownEmail && username) {
      this.emailToUsernameMap[knownEmail] = username
      this.usernameToEmailMap[username.toLowerCase()] = knownEmail
    }

    const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
    const quotaRaw = typeof raw?.quota === 'number' ? raw.quota : 0
    const usedRaw = typeof raw?.used_quota === 'number' ? raw.used_quota : 0

    return {
      id: Number(raw?.id || 0),
      username,
      displayName: String(raw?.display_name || username || knownEmail || 'Arko User'),
      email: knownEmail,
      group: raw?.group ? sanitizeCloudBranding(String(raw.group)) : 'default',
      remainingUsd: Math.max(0, quotaRaw / unit),
      usedUsd: Math.max(0, usedRaw / unit),
      requestCount: typeof raw?.request_count === 'number' ? raw.request_count : 0
    }
  }

  public async getCapabilities(force = false): Promise<ArkoAuthServerCapabilities> {
    if (!force && Date.now() - this.capabilitiesFetchedAt < 60_000) {
      return { ...this.cachedCapabilities }
    }
    try {
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/status`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'arko-browser/0.1'
        },
        signal: AbortSignal.timeout(8000)
      })
      const json = (await resp.json()) as Record<string, any>
      const data = json?.data
      if (json?.success && data) {
        if (typeof data.quota_per_unit === 'number' && data.quota_per_unit > 0) {
          this.quotaPerUnit = data.quota_per_unit
        }
        this.defaultUseAutoGroup = data.default_use_auto_group !== false
        this.passwordEncryptionEnabled = Boolean(data.password_login_encryption_enabled)
        this.cachedCapabilities = {
          registerEnabled: data.register_enabled !== false,
          passwordLoginEnabled: data.password_login_enabled !== false,
          passwordRegisterEnabled: data.password_register_enabled !== false,
          emailVerificationRequired: Boolean(data.email_verification),
          registerCaptchaEnabled: Boolean(data.register_captcha_enabled)
        }
        this.capabilitiesFetchedAt = Date.now()
      }
    } catch {
      // Keep cached/default capabilities offline
    }
    return { ...this.cachedCapabilities }
  }

  public async getRegisterCaptcha(): Promise<ArkoCaptchaChallenge> {
    try {
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/register/captcha`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': 'arko-browser/0.1'
        },
        signal: AbortSignal.timeout(8000)
      })
      const json = (await resp.json()) as Record<string, any>
      if (json?.success && json?.data) {
        return {
          ok: true,
          enabled: Boolean(json.data.enabled),
          captchaId: json.data.captcha_id,
          captchaImage: json.data.captcha_image,
          expiresIn: json.data.expires_in
        }
      }
      return {
        ok: false,
        enabled: true,
        error: sanitizeCloudBranding(json?.message) || 'Failed to load verification challenge'
      }
    } catch (err: any) {
      return {
        ok: false,
        enabled: true,
        error: sanitizeCloudBranding(err?.message) || 'Network error while loading verification code'
      }
    }
  }

  public async sendEmailVerificationCode(
    rawEmail: string
  ): Promise<{ ok: boolean; error?: string }> {
    const email = normalizeEmail(rawEmail)
    if (!isValidEmail(email)) {
      return { ok: false, error: 'Please enter a valid email address.' }
    }
    try {
      const url = new URL(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/verification`)
      url.searchParams.set('email', email)
      url.searchParams.set('turnstile', '')
      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'arko-browser/0.1'
        },
        signal: AbortSignal.timeout(12000)
      })
      const json = (await resp.json()) as Record<string, any>
      if (json?.success) {
        return { ok: true }
      }
      return {
        ok: false,
        error: sanitizeCloudBranding(json?.message) || 'Failed to send verification email.'
      }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Network error while sending verification code.'
      }
    }
  }

  public async sendPasswordResetEmail(rawEmail: string): Promise<{ ok: boolean; error?: string }> {
    const email = normalizeEmail(rawEmail)
    if (!isValidEmail(email)) {
      return { ok: false, error: 'Please enter a valid email address.' }
    }
    try {
      const url = new URL(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/reset_password`)
      url.searchParams.set('email', email)
      url.searchParams.set('turnstile', '')
      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'arko-browser/0.1'
        },
        signal: AbortSignal.timeout(12000)
      })
      const json = (await resp.json()) as Record<string, any>
      if (json?.success) {
        return { ok: true }
      }
      return {
        ok: false,
        error: sanitizeCloudBranding(json?.message) || 'Unable to send password reset email.'
      }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Network error while requesting password reset.'
      }
    }
  }

  private async encryptLoginPasswordIfNeeded(
    password: string
  ): Promise<
    { password: string } | { password_encrypted: string; encryption_key_id: string }
  > {
    if (!this.passwordEncryptionEnabled) {
      return { password }
    }
    try {
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/login/encryption-key`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'arko-browser/0.1' },
        signal: AbortSignal.timeout(8000)
      })
      const json = (await resp.json()) as Record<string, any>
      const data = json?.data
      if (!json?.success || !data?.enabled || !data?.kid || !data?.public_key) {
        return { password }
      }
      const aesKey = crypto.randomBytes(32)
      const nonce = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce)
      cipher.setAAD(Buffer.from(`password-v2:${String(data.kid)}`, 'utf-8'))
      const encrypted = Buffer.concat([cipher.update(password, 'utf-8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      const combined = Buffer.concat([encrypted, authTag])

      const wrappedKey = crypto.publicEncrypt(
        {
          key: String(data.public_key),
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
          oaepLabel: Buffer.from('password-v2', 'utf-8')
        },
        aesKey
      )
      const envelope = `v2.${wrappedKey.toString('base64')}.${nonce.toString('base64')}.${combined.toString('base64')}`
      return {
        password_encrypted: envelope,
        encryption_key_id: String(data.kid)
      }
    } catch {
      return { password }
    }
  }

  public async registerAccount(params: {
    email: string
    username?: string
    password: string
    verificationCode?: string
    captchaId?: string
    captchaCode?: string
  }): Promise<ArkoAuthResult> {
    const email = normalizeEmail(params.email)
    if (!isValidEmail(email)) {
      return { ok: false, error: 'Please enter a valid email address.' }
    }
    const pwdLen = [...params.password].length
    if (pwdLen < 8 || pwdLen > 128) {
      return { ok: false, error: 'Password must be between 8 and 128 characters.' }
    }

    const caps = await this.getCapabilities()
    if (!caps.registerEnabled || !caps.passwordRegisterEnabled) {
      return { ok: false, error: 'New account registration is currently closed.' }
    }
    if (caps.emailVerificationRequired && !params.verificationCode?.trim()) {
      return { ok: false, error: 'Please enter the email verification code.' }
    }
    if (
      caps.registerCaptchaEnabled &&
      (!params.captchaId?.trim() || !params.captchaCode?.trim())
    ) {
      return { ok: false, error: 'Please enter the security verification code.' }
    }

    const username = deriveSafeUsernameFromEmail(email, params.username)
    if (!username || username.length > 20) {
      return { ok: false, error: 'Account ID must be between 1 and 20 characters.' }
    }

    try {
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/register?turnstile=`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: DEFAULT_CLOUD_GATEWAY_ORIGIN,
          'User-Agent': 'arko-browser/0.1'
        },
        body: JSON.stringify({
          username,
          password: params.password,
          email,
          verification_code: params.verificationCode?.trim() || undefined,
          captcha_id: caps.registerCaptchaEnabled ? params.captchaId?.trim() : undefined,
          captcha_code: caps.registerCaptchaEnabled ? params.captchaCode?.trim() : undefined
        }),
        signal: AbortSignal.timeout(15000)
      })
      const json = (await resp.json()) as Record<string, any>
      if (!json?.success) {
        return {
          ok: false,
          error: sanitizeCloudBranding(json?.message) || 'Failed to create account.'
        }
      }

      // 本地记录邮箱与短标识双向映射，兼容未开启强制邮箱验证时的本机邮箱快捷登录
      this.emailToUsernameMap[email] = username
      this.usernameToEmailMap[username.toLowerCase()] = email
      this.saveToDisk()

      // 优先直接消费服务端注册接口同步签发的会话与初始密钥，减少二次登录往返；旧服务端回退显式登录
      if (json?.data?.access_token) {
        return await this.completeAuthenticatedSession(resp, json.data, email)
      }

      const loginTarget =
        caps.emailVerificationRequired || Boolean(params.verificationCode?.trim())
          ? email
          : username
      return await this.loginAccount(
        { identifier: loginTarget, password: params.password },
        email
      )
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Network error while creating account.'
      }
    }
  }

  public async loginAccount(
    params: { identifier: string; password: string },
    knownEmailHint?: string
  ): Promise<ArkoAuthResult> {
    const rawIdentifier = params.identifier.trim()
    if (!rawIdentifier || !params.password) {
      return { ok: false, error: 'Please enter your email/account and password.' }
    }

    await this.getCapabilities()

    const normalizedLower = rawIdentifier.toLowerCase()
    const resolvedUsername = this.emailToUsernameMap[normalizedLower] || rawIdentifier
    const emailHint =
      knownEmailHint || (isValidEmail(normalizedLower) ? normalizedLower : undefined)

    try {
      const passwordFields = await this.encryptLoginPasswordIfNeeded(params.password)
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/login?turnstile=`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: DEFAULT_CLOUD_GATEWAY_ORIGIN,
          'User-Agent': 'arko-browser/0.1'
        },
        body: JSON.stringify({
          username: resolvedUsername,
          ...passwordFields
        }),
        signal: AbortSignal.timeout(15000)
      })

      const json = (await resp.json()) as Record<string, any>
      if (!json?.success) {
        const lockoutMinutes = extractLockoutMinutes(json)
        return {
          ok: false,
          lockoutMinutes,
          error:
            sanitizeCloudBranding(json?.message) ||
            'Incorrect email/account or password.'
        }
      }

      const data = json?.data || {}
      // Handle 2FA / Login Verification Challenge if enabled on user's account
      if (!data.access_token && data.flow_token) {
        return {
          ok: false,
          requiresTwoFactor: true,
          twoFactorFlowToken: String(data.flow_token)
        }
      }

      return await this.completeAuthenticatedSession(resp, data, emailHint)
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Network error while signing in.'
      }
    }
  }

  public async verifyTwoFactorLogin(params: {
    flowToken: string
    code: string
  }): Promise<ArkoAuthResult> {
    if (!params.flowToken?.trim() || !params.code?.trim()) {
      return { ok: false, error: 'Please enter the 6-digit verification code.' }
    }
    try {
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/login/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: DEFAULT_CLOUD_GATEWAY_ORIGIN,
          'User-Agent': 'arko-browser/0.1'
        },
        body: JSON.stringify({
          flow_token: params.flowToken.trim(),
          method: '2fa',
          code: params.code.trim()
        }),
        signal: AbortSignal.timeout(15000)
      })
      const json = (await resp.json()) as Record<string, any>
      if (!json?.success || !json?.data?.access_token) {
        return {
          ok: false,
          error: sanitizeCloudBranding(json?.message) || 'Invalid or expired verification code.'
        }
      }
      return await this.completeAuthenticatedSession(resp, json.data)
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Verification failed.'
      }
    }
  }

  /**
   * 完成认证后的本地会话落盘、初始或存量云端密钥托管、统一账单摘要及可用模型同步。
   * @param resp 登录或注册响应对象（用于提取 HttpOnly 刷新令牌 Cookie）
   * @param data 响应体中的认证数据包
   * @param emailHint 可选的已知登录邮箱提示
   * @returns 认证结果与最新账户状态
   */
  private async completeAuthenticatedSession(
    resp: Response,
    data: Record<string, any>,
    emailHint?: string
  ): Promise<ArkoAuthResult> {
    const refreshCookie = extractCookieValue(resp, REFRESH_COOKIE_NAME)
    if (refreshCookie) {
      this.refreshToken = refreshCookie
    }
    this.accessToken = String(data.access_token || '')
    this.accessExpiresAt = Number(data.access_expires_at || 0)
    this.sessionId = String(data.session?.sid || '')
    this.user = this.mapRawUser(data.user || {}, emailHint)
    this.syncedAt = Date.now()

    // 若注册接口已一次性返回初始 sk- 密钥则直接托管，否则自动查询或补签发无限额度令牌
    const provisionedKey = typeof data.api_key === 'string' ? data.api_key.trim() : ''
    if (provisionedKey) {
      this.cloudApiKey = provisionedKey.startsWith('sk-') ? provisionedKey : `sk-${provisionedKey}`
    } else {
      await this.ensureCloudApiKey()
    }

    const [, models] = await Promise.all([
      this.syncBillingAndPlansInternal(),
      this.fetchUserModelsInternal()
    ])
    this.saveToDisk()
    this.notifyChanged()

    return {
      ok: true,
      state: this.getState(),
      models: models.length > 0 ? models : undefined
    }
  }

  private async refreshAccessTokenIfNeeded(force = false): Promise<boolean> {
    const nowSec = Math.floor(Date.now() / 1000)
    if (
      !force &&
      this.accessToken &&
      (!this.accessExpiresAt || this.accessExpiresAt - nowSec > 45)
    ) {
      return true
    }
    if (!this.refreshToken) {
      return Boolean(this.accessToken)
    }

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Origin: DEFAULT_CLOUD_GATEWAY_ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${this.refreshToken}`,
        'User-Agent': 'arko-browser/0.1'
      }
      if (this.sessionId) {
        headers['X-Auth-Session'] = this.sessionId
      }
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/auth/refresh`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(10000)
      })
      const json = (await resp.json()) as Record<string, any>
      if (json?.success && json?.data?.access_token) {
        const nextRefresh = extractCookieValue(resp, REFRESH_COOKIE_NAME)
        if (nextRefresh) this.refreshToken = nextRefresh
        this.accessToken = String(json.data.access_token)
        this.accessExpiresAt = Number(json.data.access_expires_at || 0)
        if (json.data.session?.sid) {
          this.sessionId = String(json.data.session.sid)
        }
        if (json.data.user) {
          this.user = this.mapRawUser(json.data.user, this.user?.email)
        }
        this.saveToDisk()
        return true
      }
      if (resp.status === 401 || resp.status === 403) {
        this.accessToken = ''
        this.refreshToken = ''
        this.saveToDisk()
      }
    } catch {
      // Transient network issue
    }
    return false
  }

  private async authenticatedFetch(
    apiPath: string,
    init: RequestInit = {}
  ): Promise<Response> {
    await this.refreshAccessTokenIfNeeded(false)
    const buildHeaders = (): Record<string, string> => {
      const base: Record<string, string> = {
        Accept: 'application/json',
        Origin: DEFAULT_CLOUD_GATEWAY_ORIGIN,
        'User-Agent': 'arko-browser/0.1',
        ...(init.headers as Record<string, string> | undefined)
      }
      if (this.accessToken) {
        base['Authorization'] = `Bearer ${this.accessToken}`
      }
      if (this.user?.id) {
        base['New-Api-User'] = String(this.user.id)
      }
      if (this.refreshToken) {
        base['Cookie'] = `${REFRESH_COOKIE_NAME}=${this.refreshToken}`
      }
      return base
    }

    let resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}${apiPath}`, {
      ...init,
      headers: buildHeaders(),
      signal: init.signal || AbortSignal.timeout(12000)
    })

    if (resp.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessTokenIfNeeded(true)
      if (refreshed) {
        resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}${apiPath}`, {
          ...init,
          headers: buildHeaders(),
          signal: init.signal || AbortSignal.timeout(12000)
        })
      }
    }
    return resp
  }

  /**
   * Automatically finds an active API token on the user's account (or creates one if none exists)
   * and retrieves its full sk-... secret so Arko AI works out of the box with zero manual setup.
   */
  public async ensureCloudApiKey(): Promise<string> {
    if (!this.accessToken && !this.refreshToken) {
      return this.cloudApiKey
    }
    try {
      const listTokens = async (): Promise<Array<Record<string, any>>> => {
        const resp = await this.authenticatedFetch('/api/token/?p=1&size=30', {
          method: 'GET'
        })
        const json = (await resp.json()) as Record<string, any>
        if (!json?.success) return []
        const items = json?.data?.items ?? json?.data
        return Array.isArray(items) ? items : []
      }

      let tokens = await listTokens()
      const nowSec = Math.floor(Date.now() / 1000)
      const isUsable = (t: Record<string, any>): boolean =>
        t?.status === 1 &&
        (t?.expired_time === -1 || !t?.expired_time || Number(t.expired_time) > nowSec) &&
        (Boolean(t?.unlimited_quota) || Number(t?.remain_quota || 0) > 0)

      let candidate =
        tokens.find((t) => isUsable(t) && String(t.name || '').toLowerCase().includes('arko')) ||
        tokens.find((t) => isUsable(t) && Boolean(t.unlimited_quota)) ||
        tokens.find((t) => isUsable(t))

      if (!candidate) {
        const createWithGroup = async (group: string): Promise<boolean> => {
          const createResp = await this.authenticatedFetch('/api/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'Arko Cloud',
              expired_time: -1,
              remain_quota: 500000,
              unlimited_quota: true,
              model_limits_enabled: false,
              allow_user_quota_query: true,
              group
            })
          })
          const createJson = (await createResp.json()) as Record<string, any>
          return Boolean(createJson?.success)
        }

        const created =
          (this.defaultUseAutoGroup && (await createWithGroup('auto'))) ||
          (await createWithGroup(''))
        if (created) {
          tokens = await listTokens()
          candidate =
            tokens.find((t) => isUsable(t) && String(t.name || '').toLowerCase().includes('arko')) ||
            tokens.find((t) => isUsable(t))
        }
      }

      if (candidate?.id) {
        const keyResp = await this.authenticatedFetch(`/api/token/${candidate.id}/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        const keyJson = (await keyResp.json()) as Record<string, any>
        const rawKey = String(keyJson?.data?.key || '').trim()
        if (keyJson?.success && rawKey) {
          this.cloudApiKey = rawKey.startsWith('sk-') ? rawKey : `sk-${rawKey}`
        }
      }
    } catch (err) {
      console.warn('[AccountService] Token auto-provision warning:', err)
    }
    return this.cloudApiKey
  }

  private async fetchUserModelsInternal(): Promise<AIModelItem[]> {
    try {
      if (this.accessToken || this.refreshToken) {
        const resp = await this.authenticatedFetch('/api/user/models', { method: 'GET' })
        const json = (await resp.json()) as Record<string, any>
        if (json?.success && Array.isArray(json?.data) && json.data.length > 0) {
          const ids = json.data
            .map((m: unknown) => String(m || '').trim())
            .filter(Boolean)
          return this.prioritizeCloudModels(ids)
        }
      }
      if (this.cloudApiKey) {
        const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/v1/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.cloudApiKey}`,
            'User-Agent': 'arko-browser/0.1'
          },
          signal: AbortSignal.timeout(10000)
        })
        if (resp.ok) {
          const json = (await resp.json()) as { data?: Array<{ id: string }> }
          const ids = (json.data || []).map((m) => String(m?.id || '').trim()).filter(Boolean)
          if (ids.length > 0) {
            return this.prioritizeCloudModels(ids)
          }
        }
      }
    } catch {
      // Fallback to presets
    }
    return []
  }

  private prioritizeCloudModels(ids: string[]): AIModelItem[] {
    const unique = Array.from(new Set(ids))
    const presetOrder = new Map(PRESET_ARKO_CLOUD_MODELS.map((m, idx) => [m.id, idx]))
    unique.sort((a, b) => {
      const pa = presetOrder.has(a) ? presetOrder.get(a)! : 999
      const pb = presetOrder.has(b) ? presetOrder.get(b)! : 999
      if (pa !== pb) return pa - pb
      return a.localeCompare(b)
    })
    return unique.map((id) => ({ id, label: formatModelLabel(id) }))
  }

  public async refreshProfile(): Promise<{
    ok: boolean
    state: ArkoAccountState
    models?: AIModelItem[]
    error?: string
  }> {
    await this.getCapabilities()

    if (!this.accessToken && !this.refreshToken) {
      if (this.cloudApiKey) {
        const quota = await this.queryCloudQuota()
        if (quota.ok && this.user) {
          this.user.remainingUsd = quota.remainingUsd
          this.user.usedUsd = quota.usedUsd
          this.syncedAt = Date.now()
          this.saveToDisk()
          this.notifyChanged()
        }
        const models = await this.fetchUserModelsInternal()
        return {
          ok: quota.ok,
          state: this.getState(),
          models: models.length > 0 ? models : undefined,
          error: quota.error
        }
      }
      return {
        ok: false,
        state: this.getState(),
        error: 'Not signed in.'
      }
    }

    try {
      const resp = await this.authenticatedFetch('/api/user/self', { method: 'GET' })
      const json = (await resp.json()) as Record<string, any>
      if (!json?.success || !json?.data) {
        return {
          ok: false,
          state: this.getState(),
          error: sanitizeCloudBranding(json?.message) || 'Session expired. Please sign in again.'
        }
      }

      this.user = this.mapRawUser(json.data, this.user?.email)
      this.syncedAt = Date.now()
      if (!this.cloudApiKey) {
        await this.ensureCloudApiKey()
      }
      const [, models] = await Promise.all([
        this.syncBillingAndPlansInternal(),
        this.fetchUserModelsInternal()
      ])
      this.saveToDisk()
      this.notifyChanged()

      return {
        ok: true,
        state: this.getState(),
        models: models.length > 0 ? models : undefined
      }
    } catch (err: any) {
      return {
        ok: false,
        state: this.getState(),
        error: sanitizeCloudBranding(err?.message) || 'Failed to sync account status.'
      }
    }
  }

  /**
   * 同步服务端统一账单摘要（GET /api/user/billing）与可用订阅套餐（GET /api/subscription/plans），
   * 将钱包余额、生效套餐剩余额度及应用内扫码充值配置合并写入当前账户快照。
   * @returns 无返回值
   */
  private async syncBillingAndPlansInternal(): Promise<void> {
    if (!this.accessToken && !this.refreshToken) return

    try {
      const resp = await this.authenticatedFetch('/api/user/billing', { method: 'GET' })
      const json = (await resp.json()) as Record<string, any>
      if (json?.success && json?.data) {
        const d = json.data as Record<string, any>
        if (typeof d.quota_per_unit === 'number' && d.quota_per_unit > 0) {
          this.quotaPerUnit = d.quota_per_unit
        }
        const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
        const wallet = (d.wallet || {}) as Record<string, any>
        const sub = (d.subscription || {}) as Record<string, any>
        const topup = (d.topup || {}) as Record<string, any>

        const effectiveRemainingUsd = Math.max(0, Number(d.effective_remaining_usd ?? 0))
        const effectiveUnlimited = Boolean(d.effective_unlimited)
        const walletRemainingUsd = Math.max(0, Number(wallet.remaining_usd ?? 0))
        const walletUsedUsd = Math.max(0, Number(wallet.used_usd ?? 0))
        const subRemainingUsd = Math.max(0, Number(sub.remaining_usd ?? 0))
        const subUsedUsd = Math.max(0, Number(sub.used_quota ?? 0) / unit)

        // 过滤仅保留支持应用内闭环扫码的支付方式（如 alipay / wxpay），并清洗显示名称
        const rawMethods: Array<Record<string, any>> = Array.isArray(topup.pay_methods)
          ? topup.pay_methods
          : []
        const payMethods: ArkoTopUpPaymentMethod[] = rawMethods
          .filter((m) => {
            const t = String(m?.type || '').toLowerCase()
            return t === 'alipay' || t === 'wxpay'
          })
          .map((m) => ({
            name: sanitizeCloudBranding(String(m?.name || m?.type || '')),
            type: String(m?.type || '').toLowerCase(),
            color: m?.color ? String(m.color) : undefined,
            minTopup: m?.min_topup ? Number(m.min_topup) : undefined
          }))

        const rawOptions = Array.isArray(topup.amount_options) ? topup.amount_options : []
        const parsedOptions = rawOptions
          .map((n: unknown) => Math.floor(Number(n)))
          .filter((n: number) => Number.isFinite(n) && n > 0)
        const minTopup = Math.max(1, Math.floor(Number(topup.min_topup || 1)))
        const defaultPresets = [5, 10, 20, 50, 100].filter((n) => n >= minTopup)

        const rawItems: Array<Record<string, any>> = Array.isArray(sub.items) ? sub.items : []
        const subItems: ArkoSubscriptionItem[] = rawItems.map((item) => {
          const amountRemaining = Math.max(0, Number(item.amount_remaining || 0))
          return {
            id: Number(item.id || 0),
            planId: Number(item.plan_id || 0),
            planTitle: sanitizeCloudBranding(String(item.plan_title || 'Cloud Plan')),
            amountTotal: Math.max(0, Number(item.amount_total || 0)),
            amountUsed: Math.max(0, Number(item.amount_used || 0)),
            amountRemaining,
            remainingUsd: amountRemaining / unit,
            unlimited: Boolean(item.unlimited),
            startTime: Number(item.start_time || 0),
            endTime: Number(item.end_time || 0),
            nextResetTime: Number(item.next_reset_time || 0),
            allowWalletOverflow: item.allow_wallet_overflow !== false
          }
        })

        const discountMap: Record<string, number> = {}
        if (topup.discount && typeof topup.discount === 'object') {
          for (const [k, v] of Object.entries(topup.discount as Record<string, unknown>)) {
            const num = Number(v)
            if (Number.isFinite(num) && num > 0) {
              discountMap[String(k)] = num
            }
          }
        }

        this.billingSummary = {
          effectiveRemainingUsd,
          effectiveUnlimited,
          walletRemainingUsd,
          walletUsedUsd,
          requestCount: Number(wallet.request_count ?? this.user?.requestCount ?? 0),
          subscription: {
            billingPreference: String(sub.billing_preference || 'subscription_first'),
            hasActive: Boolean(sub.has_active),
            hasUnlimited: Boolean(sub.has_unlimited),
            allowWalletOverflow: sub.allow_wallet_overflow !== false,
            remainingUsd: subRemainingUsd,
            usedUsd: subUsedUsd,
            items: subItems
          },
          topup: {
            enableOnlineTopup: Boolean(topup.enable_online_topup),
            supportsQrcodeCheckout: Boolean(topup.supports_qrcode_checkout) && payMethods.length > 0,
            enableRedemption: topup.enable_redemption !== false,
            payMethods,
            amountOptions: parsedOptions.length > 0 ? parsedOptions : defaultPresets,
            discount: discountMap,
            minTopup,
            maxTopup: Math.max(minTopup, Math.floor(Number(topup.max_topup || 10000))),
            payCurrency: String(topup.pay_currency || 'CNY'),
            price: Number(topup.price || 1)
          }
        }

        // 将综合可用额度同步至 user.remainingUsd，保证顶栏与侧栏微标统一反映钱包+活跃套餐总可用余额
        if (this.user) {
          this.user = {
            ...this.user,
            remainingUsd: effectiveRemainingUsd,
            walletRemainingUsd,
            subscriptionRemainingUsd: subRemainingUsd,
            effectiveUnlimited,
            usedUsd: walletUsedUsd + subUsedUsd,
            requestCount: this.billingSummary.requestCount
          }
        }
      }
    } catch {
      // 网络波动时保留上一次持久化的账单摘要
    }

    try {
      const plansResp = await this.authenticatedFetch('/api/subscription/plans', { method: 'GET' })
      const plansJson = (await plansResp.json()) as Record<string, any>
      if (plansJson?.success && Array.isArray(plansJson?.data)) {
        const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
        this.availablePlans = plansJson.data
          .map((entry: Record<string, any>) => (entry?.plan || entry) as Record<string, any>)
          .filter((p) => p && Number(p.id) > 0 && p.enabled !== false && p.allow_balance_pay !== false)
          .map((p) => {
            const totalQuota = Number(p.total_amount || 0)
            return {
              id: Number(p.id),
              title: sanitizeCloudBranding(String(p.title || 'Cloud Plan')),
              subtitle: sanitizeCloudBranding(String(p.subtitle || '')),
              priceAmount: Math.max(0, Number(p.price_amount || 0)),
              currency: String(p.currency || 'USD'),
              durationUnit: String(p.duration_unit || 'month'),
              durationValue: Math.max(1, Number(p.duration_value || 1)),
              totalAmountUsd: totalQuota > 0 ? totalQuota / unit : 0,
              unlimited: totalQuota <= 0,
              quotaResetPeriod: String(p.quota_reset_period || 'never'),
              allowBalancePay: p.allow_balance_pay !== false
            }
          })
      }
    } catch {
      // 忽略套餐列表可选查询错误
    }
  }

  /**
   * 试算指定充值额度对应的精确实付金额、支付币种及预计入账美元额度。
   * @param rawAmount 期望充值的整数额度单位（USD 挡位）
   * @returns 试算报价结果
   */
  public async quoteTopUpAmount(rawAmount: number): Promise<ArkoTopUpQuoteResult> {
    const amount = Math.floor(Number(rawAmount))
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, amount: 0, error: 'Please enter a valid recharge amount.' }
    }
    if (!this.accessToken && !this.refreshToken) {
      return { ok: false, amount, error: 'Please sign in to your Arko Account first.' }
    }

    try {
      const resp = await this.authenticatedFetch('/api/user/amount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      })
      const json = (await resp.json()) as Record<string, any>
      if (json?.message === 'success' && (json?.pay_amount || json?.data)) {
        const payAmount = String(json.pay_amount || json.data).trim()
        const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
        const creditedQuota = Number(json.credited_quota || 0)
        return {
          ok: true,
          amount,
          payAmount,
          payCurrency: String(json.pay_currency || this.billingSummary?.topup.payCurrency || 'CNY'),
          creditedUsd: creditedQuota > 0 ? creditedQuota / unit : amount
        }
      }
      return {
        ok: false,
        amount,
        error: sanitizeCloudBranding(String(json?.data || json?.message || 'Unable to quote amount.'))
      }
    } catch (err: any) {
      return {
        ok: false,
        amount,
        error: sanitizeCloudBranding(err?.message) || 'Network error while quoting amount.'
      }
    }
  }

  /**
   * 创建应用内扫码充值订单（携带 scene: "client" 使用中性商品标题），并在主进程本地离线编码二维码图像。
   * @param params 包含充值数量、支付渠道（alipay / wxpay）及已确认的实付金额字符串
   * @returns 包含订单号与本地二维码 DataURL 的下单结果
   */
  public async createTopUpQrOrder(params: {
    amount: number
    paymentMethod: string
    confirmedPayAmount: string
  }): Promise<ArkoTopUpCheckoutResult> {
    const amount = Math.floor(Number(params.amount))
    const paymentMethod = String(params.paymentMethod || '').trim().toLowerCase()
    const confirmedPayAmount = String(params.confirmedPayAmount || '').trim()

    if (!Number.isFinite(amount) || amount <= 0 || !paymentMethod || !confirmedPayAmount) {
      return { ok: false, error: 'Invalid recharge parameters.' }
    }
    if (!this.accessToken && !this.refreshToken) {
      return { ok: false, error: 'Please sign in to your Arko Account first.' }
    }

    try {
      const resp = await this.authenticatedFetch('/api/user/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          payment_method: paymentMethod,
          confirmed_pay_amount: confirmedPayAmount,
          scene: 'client'
        })
      })
      const json = (await resp.json()) as Record<string, any>
      if (json?.code === 'price_changed' && json?.pay_amount) {
        return {
          ok: false,
          priceChanged: true,
          latestPayAmount: String(json.pay_amount),
          error: sanitizeCloudBranding(String(json.data || 'Payment quote updated. Please confirm again.'))
        }
      }
      if (json?.message !== 'success' || json?.checkout !== 'qrcode') {
        return {
          ok: false,
          error:
            sanitizeCloudBranding(String(json?.data || json?.message || '')) ||
            'QR checkout is currently unavailable.'
        }
      }

      const tradeNo = String(json.trade_no || '').trim()
      if (!SAFE_TRADE_NO_RE.test(tradeNo)) {
        return { ok: false, error: 'Invalid order identifier returned by server.' }
      }

      // 优先在主进程内将二维码协议串离线渲染为高对比度 PNG DataURL，绝不外发第三方二维码服务
      let qrImageDataUrl: string | undefined
      const rawQrText = typeof json.qrcode === 'string' ? json.qrcode.trim() : ''
      if (isSafeQrCodePayload(rawQrText)) {
        qrImageDataUrl = await QRCode.toDataURL(rawQrText, {
          width: 240,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#09090B', light: '#FFFFFF' }
        })
      }

      const rawQrImage = typeof json.qr_image === 'string' ? json.qr_image.trim() : ''
      const qrImageUrl = !qrImageDataUrl && isSafeQrImageUrl(rawQrImage) ? rawQrImage : undefined
      if (!qrImageDataUrl && !qrImageUrl) {
        return { ok: false, error: 'Failed to generate payment QR code.' }
      }

      const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
      const creditedQuota = Number(json.credited_quota || 0)

      return {
        ok: true,
        tradeNo,
        payAmount: String(json.pay_amount || confirmedPayAmount),
        payCurrency: String(json.pay_currency || 'CNY'),
        creditedUsd: creditedQuota > 0 ? creditedQuota / unit : amount,
        paymentMethod,
        qrImageDataUrl,
        qrImageUrl
      }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Network error while creating payment order.'
      }
    }
  }

  /**
   * 查询指定扫码充值订单状态；一旦状态变为 success，立即触发账户余额与账单快照全量同步。
   * @param rawTradeNo 30 位安全订单号
   * @returns 订单当前状态及同步后的最新账户快照
   */
  public async checkTopUpOrderStatus(rawTradeNo: string): Promise<ArkoTopUpOrderStatusResult> {
    const tradeNo = String(rawTradeNo || '').trim()
    if (!SAFE_TRADE_NO_RE.test(tradeNo)) {
      return { ok: false, tradeNo: '', status: 'invalid', error: 'Invalid order number.' }
    }
    if (!this.accessToken && !this.refreshToken) {
      return { ok: false, tradeNo, status: 'unauthorized', error: 'Not signed in.' }
    }

    try {
      const resp = await this.authenticatedFetch(`/api/user/epay/orders/${encodeURIComponent(tradeNo)}`, {
        method: 'GET'
      })
      const json = (await resp.json()) as Record<string, any>
      if (!json?.success || !json?.data) {
        return {
          ok: false,
          tradeNo,
          status: 'pending',
          error: sanitizeCloudBranding(json?.message) || undefined
        }
      }
      const status = String(json.data.status || 'pending')
      if (status === 'success') {
        await this.refreshProfile()
      }
      return {
        ok: true,
        tradeNo,
        status,
        state: this.getState()
      }
    } catch (err: any) {
      return {
        ok: false,
        tradeNo,
        status: 'pending',
        error: sanitizeCloudBranding(err?.message)
      }
    }
  }

  /**
   * 使用当前钱包余额在应用内直接购买并激活指定订阅套餐。
   * @param planId 订阅套餐 ID
   * @returns 购买结果与刷新后的账户状态
   */
  public async purchaseSubscriptionWithBalance(
    planId: number
  ): Promise<ArkoBalancePlanPurchaseResult> {
    const cleanId = Math.floor(Number(planId))
    if (!Number.isFinite(cleanId) || cleanId <= 0) {
      return { ok: false, error: 'Invalid plan selection.' }
    }
    if (!this.accessToken && !this.refreshToken) {
      return { ok: false, error: 'Please sign in to your Arko Account first.' }
    }

    try {
      const resp = await this.authenticatedFetch('/api/subscription/balance/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: cleanId })
      })
      const json = (await resp.json()) as Record<string, any>
      if (!json?.success) {
        return {
          ok: false,
          error: sanitizeCloudBranding(json?.message) || 'Unable to activate plan with balance.'
        }
      }
      await this.refreshProfile()
      return {
        ok: true,
        state: this.getState()
      }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Network error while purchasing plan.'
      }
    }
  }

  public async redeemCode(rawCode: string): Promise<ArkoRedeemResult> {
    const key = rawCode.trim()
    if (!key) {
      return { ok: false, error: 'Please enter a valid credit code.' }
    }
    if (!this.accessToken && !this.refreshToken) {
      return { ok: false, error: 'Please sign in to your Arko Account first.' }
    }

    try {
      const resp = await this.authenticatedFetch('/api/user/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      })
      const json = (await resp.json()) as Record<string, any>
      if (!json?.success) {
        return {
          ok: false,
          error: sanitizeCloudBranding(json?.message) || 'Credit code is invalid or already used.'
        }
      }
      const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
      const addedQuota = Number(json?.data || 0)
      const addedUsd = addedQuota > 0 ? addedQuota / unit : undefined
      await this.refreshProfile()
      return {
        ok: true,
        addedUsd,
        state: this.getState()
      }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Failed to redeem credit code.'
      }
    }
  }

  public async logout(): Promise<ArkoAccountState> {
    try {
      if (this.accessToken || this.refreshToken) {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          Origin: DEFAULT_CLOUD_GATEWAY_ORIGIN,
          'User-Agent': 'arko-browser/0.1'
        }
        if (this.accessToken) {
          headers['Authorization'] = `Bearer ${this.accessToken}`
        }
        if (this.sessionId) {
          headers['X-Auth-Session'] = this.sessionId
        }
        if (this.refreshToken) {
          headers['Cookie'] = `${REFRESH_COOKIE_NAME}=${this.refreshToken}`
        }
        await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/user/auth/logout`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(6000)
        }).catch(() => {})
      }
    } finally {
      this.user = null
      this.billingSummary = null
      this.availablePlans = []
      this.sessionId = ''
      this.accessExpiresAt = 0
      this.accessToken = ''
      this.refreshToken = ''
      this.cloudApiKey = ''
      this.syncedAt = 0
      this.saveToDisk()
      this.notifyChanged()
    }
    return this.getState()
  }

  public async queryCloudQuota(): Promise<TokenQuotaResult> {
    if (this.user && (this.accessToken || this.refreshToken)) {
      const refreshed = await this.refreshProfile()
      if (refreshed.ok && refreshed.state.user) {
        const u = refreshed.state.user
        return {
          ok: true,
          planName: 'Arko Cloud',
          remainingUsd: u.remainingUsd,
          usedUsd: u.usedUsd,
          totalUsd:
            typeof u.remainingUsd === 'number' && typeof u.usedUsd === 'number'
              ? u.remainingUsd + u.usedUsd
              : undefined
        }
      }
    }

    if (!this.cloudApiKey) {
      return {
        ok: false,
        error: 'Please sign in to your Arko Account first.'
      }
    }

    try {
      const resp = await fetch(`${DEFAULT_CLOUD_GATEWAY_ORIGIN}/api/usage/token/`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cloudApiKey}`,
          'User-Agent': 'arko-browser/0.1'
        },
        signal: AbortSignal.timeout(10000)
      })
      const json = (await resp.json()) as Record<string, any>
      const data = json?.data
      if ((json?.code === true || json?.success === true) && data) {
        const unit = this.quotaPerUnit > 0 ? this.quotaPerUnit : DEFAULT_QUOTA_PER_UNIT
        const userQuota = data.user_quota
        let remainingUsd: number | undefined
        let usedUsd: number | undefined
        let totalUsd: number | undefined

        if (data.unlimited_quota) {
          if (userQuota && typeof userQuota.total_available === 'number') {
            const effectiveAvail =
              typeof userQuota.effective_available === 'number'
                ? userQuota.effective_available
                : userQuota.total_available
            const subUsed =
              typeof userQuota.subscription_used === 'number' ? userQuota.subscription_used : 0
            remainingUsd = effectiveAvail / unit
            usedUsd = ((userQuota.total_used || 0) + subUsed) / unit
            totalUsd = remainingUsd + usedUsd
          } else {
            usedUsd = (data.total_used || 0) / unit
          }
        } else {
          remainingUsd = (data.total_available || 0) / unit
          usedUsd = (data.total_used || 0) / unit
          totalUsd = (data.total_granted || 0) / unit
        }

        return {
          ok: true,
          planName: 'Arko Cloud',
          remainingUsd,
          usedUsd,
          totalUsd
        }
      }
      return {
        ok: false,
        error: sanitizeCloudBranding(
          String(json?.message || json?.error?.message || `HTTP ${resp.status}`)
        )
      }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Failed to query cloud balance.'
      }
    }
  }
}
