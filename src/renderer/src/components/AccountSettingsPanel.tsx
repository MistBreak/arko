import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Coins,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Zap
} from 'lucide-react'
import { ARKO_CLOUD_PROVIDER_ID } from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  AppSettings,
  ArkoAccountState,
  ArkoAuthServerCapabilities,
  ArkoCaptchaChallenge
} from '@shared/types'

interface Props {
  isDark: boolean
  lang: AppLanguage
  settings: AppSettings
  accountState?: ArkoAccountState
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onJumpToModels: () => void
}

type AuthTabMode = 'login' | 'register' | 'reset'

function suggestHandleFromEmail(email: string): string {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed.length <= 20) return trimmed
  const [local = ''] = trimmed.split('@')
  return local.replace(/[^a-z0-9._-]/gi, '').slice(0, 20)
}

export const AccountSettingsPanel: React.FC<Props> = ({
  isDark,
  lang,
  settings,
  accountState,
  onUpdateSettings,
  onJumpToModels
}) => {
  const [mode, setMode] = useState<AuthTabMode>('login')

  // Capabilities & Captcha
  const [capabilities, setCapabilities] = useState<ArkoAuthServerCapabilities>(
    accountState?.capabilities || {
      registerEnabled: true,
      passwordLoginEnabled: true,
      passwordRegisterEnabled: true,
      emailVerificationRequired: false,
      registerCaptchaEnabled: true
    }
  )
  const [captcha, setCaptcha] = useState<ArkoCaptchaChallenge | null>(null)
  const [loadingCaptcha, setLoadingCaptcha] = useState(false)

  // Form inputs
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // 2FA state
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')

  // Sign-up inputs
  const [regEmail, setRegEmail] = useState('')
  const [regUsername, setRegUsername] = useState('')
  const [regUsernameTouched, setRegUsernameTouched] = useState(false)
  const [regPassword, setRegPassword] = useState('')
  const [regConfirmPassword, setRegConfirmPassword] = useState('')
  const [regEmailCode, setRegEmailCode] = useState('')
  const [regCaptchaCode, setRegCaptchaCode] = useState('')
  const [emailCodeCountdown, setEmailCodeCountdown] = useState(0)
  const [sendingEmailCode, setSendingEmailCode] = useState(false)

  // Reset password
  const [resetEmail, setResetEmail] = useState('')

  // Signed-in actions
  const [submitting, setSubmitting] = useState(false)
  const [syncingProfile, setSyncingProfile] = useState(false)
  const [redeemCodeInput, setRedeemCodeInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const loadCaptcha = useCallback(async () => {
    setLoadingCaptcha(true)
    setRegCaptchaCode('')
    try {
      const ch = await window.arko.getRegisterCaptcha()
      setCaptcha(ch)
    } finally {
      setLoadingCaptcha(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void window.arko.getAuthCapabilities().then((caps) => {
      if (!active) return
      setCapabilities(caps)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (mode === 'register' && capabilities.registerCaptchaEnabled && !accountState?.authenticated) {
      void loadCaptcha()
    }
  }, [mode, capabilities.registerCaptchaEnabled, accountState?.authenticated, loadCaptcha])

  useEffect(() => {
    if (emailCodeCountdown <= 0) return
    const timer = window.setTimeout(() => setEmailCodeCountdown((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [emailCodeCountdown])

  const handleEmailChange = (val: string): void => {
    setRegEmail(val)
    if (!regUsernameTouched) {
      setRegUsername(suggestHandleFromEmail(val))
    }
  }

  const handleSendEmailCode = async (): Promise<void> => {
    setFeedback(null)
    if (!regEmail.trim()) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter your email address first.', '请先填写邮箱地址')
      })
      return
    }
    setSendingEmailCode(true)
    const res = await window.arko.sendEmailVerificationCode(regEmail.trim())
    setSendingEmailCode(false)
    if (res.ok) {
      setEmailCodeCountdown(60)
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Verification code sent! Please check your inbox.',
          '验证码已发送至您的邮箱，请注意查收'
        )
      })
    } else {
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Failed to send verification code', '验证码发送失败')
      })
    }
  }

  const handleLoginSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFeedback(null)

    if (twoFactorToken) {
      if (!twoFactorCode.trim()) {
        setFeedback({
          kind: 'err',
          text: tr(lang, 'Please enter your 2FA verification code.', '请输入两步验证码')
        })
        return
      }
      setSubmitting(true)
      const res = await window.arko.verifyTwoFactorLogin({
        flowToken: twoFactorToken,
        code: twoFactorCode.trim()
      })
      setSubmitting(false)
      if (res.ok) {
        setTwoFactorToken(null)
        setTwoFactorCode('')
        setLoginPassword('')
        setFeedback({
          kind: 'ok',
          text: tr(lang, 'Signed in to Arko Cloud!', '登录成功，Arko 云端引擎已就绪！')
        })
      } else {
        setFeedback({
          kind: 'err',
          text: res.error || tr(lang, 'Verification failed', '两步验证失败')
        })
      }
      return
    }

    if (!loginIdentifier.trim() || !loginPassword) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter your email/account and password.', '请输入邮箱/账号与密码')
      })
      return
    }

    setSubmitting(true)
    const res = await window.arko.loginAccount({
      identifier: loginIdentifier.trim(),
      password: loginPassword
    })
    setSubmitting(false)

    if (res.requiresTwoFactor && res.twoFactorFlowToken) {
      setTwoFactorToken(res.twoFactorFlowToken)
      setTwoFactorCode('')
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Enter the 6-digit code from your authenticator app.',
          '该账号已开启两步验证，请输入 6 位动态验证码或备用码'
        )
      })
      return
    }

    if (res.ok) {
      setLoginPassword('')
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Welcome back! Arko Cloud AI is active.',
          '欢迎回来！Arko 云端模型已自动激活'
        )
      })
    } else {
      const lockSuffix = res.lockoutMinutes
        ? tr(
            lang,
            ` (Locked for ~${res.lockoutMinutes} min)`,
            `（连续失败保护，请约 ${res.lockoutMinutes} 分钟后再试）`
          )
        : ''
      setFeedback({
        kind: 'err',
        text: `${res.error || tr(lang, 'Sign in failed', '登录失败')}${lockSuffix}`
      })
    }
  }

  const handleRegisterSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFeedback(null)

    const cleanEmail = regEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter a valid email address.', '请输入有效的邮箱地址')
      })
      return
    }
    if ([...regPassword].length < 8) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Password must be at least 8 characters.', '密码长度至少需要 8 位字符')
      })
      return
    }
    if (regPassword !== regConfirmPassword) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Passwords do not match.', '两次输入的密码不一致')
      })
      return
    }
    if (capabilities.emailVerificationRequired && !regEmailCode.trim()) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter the email verification code.', '请输入邮箱验证码')
      })
      return
    }
    if (capabilities.registerCaptchaEnabled && captcha?.enabled && !regCaptchaCode.trim()) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter the image verification code.', '请输入图形安全验证码')
      })
      return
    }

    setSubmitting(true)
    const res = await window.arko.registerAccount({
      email: cleanEmail,
      username: cleanEmail.length > 20 ? regUsername.trim() || undefined : undefined,
      password: regPassword,
      verificationCode: regEmailCode.trim() || undefined,
      captchaId: captcha?.captchaId,
      captchaCode: regCaptchaCode.trim() || undefined
    })
    setSubmitting(false)

    if (res.ok) {
      setRegPassword('')
      setRegConfirmPassword('')
      setRegCaptchaCode('')
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Account created & signed in! Arko Cloud AI is ready to use.',
          '注册成功并已自动登录！Arko 云端 AI 已即刻可用'
        )
      })
    } else {
      if (capabilities.registerCaptchaEnabled) {
        void loadCaptcha()
      }
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Registration failed', '注册失败，请检查填写内容')
      })
    }
  }

  const handleResetSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFeedback(null)
    if (!resetEmail.trim()) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter your registered email.', '请输入注册邮箱地址')
      })
      return
    }
    setSubmitting(true)
    const res = await window.arko.sendPasswordResetEmail(resetEmail.trim())
    setSubmitting(false)
    if (res.ok) {
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'If an account matches this email, a password reset link has been sent.',
          '若该邮箱已绑定账号，重置密码邮件已发送，请查收收件箱'
        )
      })
    } else {
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Unable to send reset email', '发送重置邮件失败')
      })
    }
  }

  const handleRefreshAccount = async (): Promise<void> => {
    setSyncingProfile(true)
    setFeedback(null)
    const res = await window.arko.refreshAccountProfile()
    setSyncingProfile(false)
    if (res.ok) {
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Synced latest account balance and available Cloud AI models.',
          '已同步最新账户余额与云端可用模型列表'
        )
      })
    } else if (res.error) {
      setFeedback({ kind: 'err', text: res.error })
    }
  }

  const handleRedeem = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!redeemCodeInput.trim()) return
    setRedeeming(true)
    setFeedback(null)
    const res = await window.arko.redeemAccountCode(redeemCodeInput.trim())
    setRedeeming(false)
    if (res.ok) {
      setRedeemCodeInput('')
      const amt =
        typeof res.addedUsd === 'number' ? ` (+$${res.addedUsd.toFixed(2)} USD)` : ''
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          `✓ Credit code redeemed successfully${amt}!`,
          `✓ 额度码兑换成功${amt}！账户余额已实时更新`
        )
      })
    } else {
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Invalid or expired credit code.', '兑换失败，请检查兑换码是否有效')
      })
    }
  }

  const handleLogout = async (): Promise<void> => {
    setSubmitting(true)
    await window.arko.logoutAccount()
    setSubmitting(false)
    setFeedback({
      kind: 'ok',
      text: tr(lang, 'Signed out of Arko Account.', '已安全退出当前 Arko 账号')
    })
  }

  const inputCls = `w-full h-9.5 px-3.5 rounded-[10px] border text-[13px] outline-none transition ${
    isDark
      ? 'bg-[#151519] border-white/10 focus:border-indigo-400 text-zinc-100'
      : 'bg-white border-black/12 focus:border-indigo-500 text-zinc-900'
  }`

  const user = accountState?.user
  const isCloudActive = settings.activeProviderId === ARKO_CLOUD_PROVIDER_ID

  if (accountState?.authenticated && user) {
    const remaining = typeof user.remainingUsd === 'number' ? user.remainingUsd : 0
    const used = typeof user.usedUsd === 'number' ? user.usedUsd : 0
    const total = remaining + used
    const remainPct = total > 0 ? Math.min(100, Math.max(3, (remaining / total) * 100)) : 100
    const avatarChar = (user.email || user.displayName || user.username || 'A')
      .trim()
      .charAt(0)
      .toUpperCase()

    return (
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 text-[13px]">
        {/* Account Identity Hero Card */}
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
            isDark
              ? 'bg-gradient-to-br from-indigo-500/12 via-white/[0.02] to-violet-500/8 border-indigo-400/25'
              : 'bg-gradient-to-br from-indigo-50/90 via-white to-violet-50/60 border-indigo-200/80'
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white font-bold text-base flex items-center justify-center shadow-md shrink-0">
              <span>{avatarChar}</span>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#1D1D24]" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">
                  {user.email || user.displayName || user.username}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25 shrink-0">
                  {tr(lang, 'Arko Cloud · Connected', 'Arko 云端已连接')}
                </span>
              </div>
              <div className="opacity-60 truncate">
                {user.email && user.username && user.username !== user.email
                  ? `${tr(lang, 'Account ID:', '账号标识：')} ${user.username} · `
                  : ''}
                {tr(
                  lang,
                  'Built-in Cloud AI credentials provisioned & encrypted on device',
                  '内置云端 AI 凭证已自动签发并本机加密托管'
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={syncingProfile}
              onClick={() => void handleRefreshAccount()}
              className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1.5 transition ${
                isDark
                  ? 'border-white/12 bg-white/5 hover:bg-white/10'
                  : 'border-black/10 bg-white hover:bg-zinc-100'
              }`}
            >
              <RefreshCw size={12} className={syncingProfile ? 'animate-spin' : ''} />
              <span>{tr(lang, 'Sync', '同步状态')}</span>
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleLogout()}
              className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1.5 transition ${
                isDark
                  ? 'border-rose-500/30 text-rose-300 hover:bg-rose-500/15'
                  : 'border-rose-200 text-rose-600 bg-rose-50/60 hover:bg-rose-100'
              }`}
            >
              <LogOut size={12} />
              <span>{tr(lang, 'Sign Out', '退出登录')}</span>
            </button>
          </div>
        </div>

        {/* Cloud AI Balance & Usage */}
        <div
          className={`p-4 rounded-2xl border space-y-3.5 ${
            isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/80 border-black/7'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-1.5">
              <Coins size={14} className="text-amber-500" />
              <span>{tr(lang, 'Arko Cloud AI Credits & Usage', 'Arko 云端 AI 额度与用量')}</span>
            </div>
            <span className="text-[11px] opacity-55">
              {tr(lang, 'Requests:', '累计调用：')} {user.requestCount ?? 0}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div
              className={`p-3 rounded-xl border ${
                isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/7'
              }`}
            >
              <div className="text-[11px] opacity-55">
                {tr(lang, 'Available Balance', '当前可用额度')}
              </div>
              <div className="text-base font-bold text-emerald-500 mt-0.5">
                ${remaining.toFixed(2)} <span className="text-[10px] font-normal opacity-70">USD</span>
              </div>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/7'
              }`}
            >
              <div className="text-[11px] opacity-55">{tr(lang, 'Used Credits', '历史已用额度')}</div>
              <div className="text-base font-bold mt-0.5">
                ${used.toFixed(2)} <span className="text-[10px] font-normal opacity-60">USD</span>
              </div>
            </div>

            <div
              className={`p-3 rounded-xl border flex flex-col justify-between ${
                isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/7'
              }`}
            >
              <div className="text-[11px] opacity-55">{tr(lang, 'Active Engine', '当前默认引擎')}</div>
              {isCloudActive ? (
                <button
                  type="button"
                  onClick={onJumpToModels}
                  className="mt-0.5 text-left font-semibold text-indigo-500 hover:underline truncate"
                >
                  ✓ Arko Cloud ({settings.activeModelId})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const cloudProv = settings.providers.find(
                      (p) => p.id === ARKO_CLOUD_PROVIDER_ID || p.isArkoCloud
                    )
                    void onUpdateSettings({
                      activeProviderId: ARKO_CLOUD_PROVIDER_ID,
                      activeModelId: cloudProv?.defaultModelId || 'gemini-4-carbon'
                    })
                  }}
                  className="mt-0.5 text-left font-semibold text-indigo-500 hover:underline"
                >
                  {tr(lang, 'Switch to Arko Cloud →', '一键切换至 Arko 云端 →')}
                </button>
              )}
            </div>
          </div>

          <div className="w-full h-1.5 rounded-full overflow-hidden bg-black/8 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-300"
              style={{ width: `${remainPct}%` }}
            />
          </div>
        </div>

        {/* Redeem Credit Code */}
        <form
          onSubmit={(e) => void handleRedeem(e)}
          className={`p-4 rounded-2xl border space-y-2.5 ${
            isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/80 border-black/7'
          }`}
        >
          <div className="font-semibold flex items-center gap-1.5">
            <Gift size={14} className="text-indigo-500" />
            <span>{tr(lang, 'Redeem Arko Credit Code', '兑换 Arko 额度充值码')}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={redeemCodeInput}
              onChange={(e) => setRedeemCodeInput(e.target.value)}
              placeholder={tr(
                lang,
                'Paste your Arko credit redemption code…',
                '粘贴您的 Arko 专属额度兑换码…'
              )}
              className={`${inputCls} flex-1 font-mono`}
            />
            <button
              type="submit"
              disabled={redeeming || !redeemCodeInput.trim()}
              className="h-9 px-4 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
            >
              {redeeming ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              <span>{tr(lang, 'Redeem', '立即兑换')}</span>
            </button>
          </div>
        </form>

        {feedback && (
          <div
            className={`p-3 rounded-xl border ${
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7 text-[13px]">
      <div className="max-w-[480px] mx-auto space-y-5">
        {/* Brand Header */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md shrink-0">
            <Sparkles size={19} />
          </div>
          <div>
            <div className="font-semibold text-[15px] tracking-[-0.01em]">
              {tr(lang, 'Arko Account & Cloud AI', 'Arko 账号与内置云端 AI')}
            </div>
            <div className="text-[12.5px] leading-relaxed opacity-60 mt-0.5">
              {tr(
                lang,
                'Sign in with email to unlock Gemini, GPT & Claude models with zero API key setup.',
                '使用邮箱注册或登录，无需手动配置 API Key 即可畅享内置旗舰大模型。'
              )}
            </div>
          </div>
        </div>

        {/* Mode Segmented Switcher */}
        <div
          className={`grid grid-cols-2 p-1 rounded-xl border ${
            isDark ? 'bg-[#15151B] border-white/8' : 'bg-zinc-100/90 border-black/6'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setTwoFactorToken(null)
              setFeedback(null)
            }}
            className={`h-8.5 rounded-[9px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
              mode === 'login'
                ? isDark
                  ? 'bg-[#252530] text-white shadow-xs'
                  : 'bg-white text-zinc-900 shadow-xs'
                : 'opacity-65 hover:opacity-100'
            }`}
          >
            <LogIn size={14} />
            <span>{tr(lang, 'Sign In', '邮箱 / 账号登录')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('register')
              setTwoFactorToken(null)
              setFeedback(null)
            }}
            className={`h-8.5 rounded-[9px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
              mode === 'register'
                ? isDark
                  ? 'bg-[#252530] text-white shadow-xs'
                  : 'bg-white text-zinc-900 shadow-xs'
                : 'opacity-65 hover:opacity-100'
            }`}
          >
            <UserPlus size={14} />
            <span>{tr(lang, 'Create Account', '邮箱注册新账号')}</span>
          </button>
        </div>

        {mode === 'login' ? (
          <form
            onSubmit={(e) => void handleLoginSubmit(e)}
            className={`p-5 rounded-2xl border space-y-3.5 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
            }`}
          >
            {twoFactorToken ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 font-semibold text-indigo-500">
                  <KeyRound size={14} />
                  <span>{tr(lang, 'Two-Factor Verification', '两步安全验证')}</span>
                </div>
                <div className="space-y-1">
                  <label className="opacity-70">
                    {tr(lang, '6-Digit Code or Backup Code', '请输入 6 位验证码或备用恢复码')}
                  </label>
                  <input
                    autoFocus
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    placeholder="123456"
                    className={`${inputCls} font-mono tracking-widest text-center`}
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTwoFactorToken(null)
                      setTwoFactorCode('')
                    }}
                    className="h-9 px-3 rounded-xl border opacity-75 hover:opacity-100"
                  >
                    {tr(lang, 'Back', '返回')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 h-9 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                  >
                    {submitting && <Loader2 size={13} className="animate-spin" />}
                    <span>{tr(lang, 'Verify & Sign In', '验证并登录')}</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="opacity-70">
                    {tr(lang, 'Email Address or Account ID', '邮箱地址 / 账号')}
                  </label>
                  <input
                    autoFocus
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder={tr(lang, 'name@example.com', '输入注册邮箱或账号名')}
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="opacity-70">{tr(lang, 'Password', '登录密码')}</label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset')
                        setResetEmail(loginIdentifier.includes('@') ? loginIdentifier : '')
                        setFeedback(null)
                      }}
                      className="text-[11px] text-indigo-500 hover:underline"
                    >
                      {tr(lang, 'Forgot password?', '忘记密码？')}
                    </button>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder={tr(lang, 'Enter your password', '请输入登录密码')}
                      className={`${inputCls} pr-9`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 opacity-55 hover:opacity-100"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-9 mt-1 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {submitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <LogIn size={14} />
                  )}
                  <span>{tr(lang, 'Sign In to Arko', '登录并启用 Arko 云端 AI')}</span>
                </button>
              </>
            )}
          </form>
        ) : mode === 'register' ? (
          <form
            onSubmit={(e) => void handleRegisterSubmit(e)}
            className={`p-5 rounded-2xl border space-y-3.5 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
            }`}
          >
            <div className="space-y-1">
              <label className="opacity-70">{tr(lang, 'Email Address', '电子邮箱')}</label>
              <div className="relative flex items-center">
                <Mail size={13.5} className="absolute left-3 opacity-45 pointer-events-none" />
                <input
                  autoFocus
                  type="email"
                  value={regEmail}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  placeholder="name@example.com"
                  className={`${inputCls} pl-8`}
                />
              </div>
            </div>

            {regEmail.trim().length > 20 && (
              <div className="space-y-1">
                <label className="opacity-70">
                  {tr(
                    lang,
                    'Account ID (1–20 chars, can also be used to sign in)',
                    '账号短标识（20 字符内，可用于跨设备快捷登录）'
                  )}
                </label>
                <input
                  value={regUsername}
                  maxLength={20}
                  onChange={(e) => {
                    setRegUsernameTouched(true)
                    setRegUsername(e.target.value)
                  }}
                  placeholder={tr(lang, 'Up to 20 characters', '最多 20 个字符')}
                  className={`${inputCls} font-mono`}
                />
              </div>
            )}

            {capabilities.emailVerificationRequired && (
              <div className="space-y-1">
                <label className="opacity-70">
                  {tr(lang, 'Email Verification Code', '邮箱验证码')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={regEmailCode}
                    onChange={(e) => setRegEmailCode(e.target.value)}
                    placeholder={tr(lang, '6-digit code', '输入邮件中的验证码')}
                    className={`${inputCls} flex-1 font-mono`}
                  />
                  <button
                    type="button"
                    disabled={sendingEmailCode || emailCodeCountdown > 0 || !regEmail.trim()}
                    onClick={() => void handleSendEmailCode()}
                    className={`h-9 px-3 rounded-xl border font-medium shrink-0 transition disabled:opacity-50 ${
                      isDark
                        ? 'border-white/12 bg-white/5 hover:bg-white/10'
                        : 'border-black/10 bg-white hover:bg-zinc-100'
                    }`}
                  >
                    {sendingEmailCode ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : emailCodeCountdown > 0 ? (
                      `${emailCodeCountdown}s`
                    ) : (
                      tr(lang, 'Send Code', '获取验证码')
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="opacity-70">
                  {tr(lang, 'Password (8+ chars)', '设置密码（至少 8 位）')}
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="opacity-70">{tr(lang, 'Confirm Password', '确认密码')}</label>
                <div className="relative flex items-center">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`${inputCls} pr-8`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 opacity-55 hover:opacity-100"
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            </div>

            {capabilities.registerCaptchaEnabled && (
              <div className="space-y-1">
                <label className="opacity-70">
                  {tr(lang, 'Security Verification', '安全图形验证码（点击图片可刷新）')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={regCaptchaCode}
                    onChange={(e) => setRegCaptchaCode(e.target.value.toUpperCase())}
                    placeholder={tr(lang, 'Enter characters', '输入右侧字符')}
                    className={`${inputCls} flex-1 font-mono tracking-wider uppercase`}
                  />
                  <button
                    type="button"
                    onClick={() => void loadCaptcha()}
                    title={tr(lang, 'Click to refresh code', '点击换一张验证码')}
                    className={`h-9 w-28 rounded-xl border overflow-hidden flex items-center justify-center shrink-0 transition ${
                      isDark ? 'border-white/12 bg-white/95' : 'border-black/12 bg-slate-50'
                    }`}
                  >
                    {loadingCaptcha ? (
                      <Loader2 size={14} className="animate-spin text-zinc-500" />
                    ) : captcha?.captchaImage ? (
                      <img
                        src={captcha.captchaImage}
                        alt="Verification"
                        className="w-full h-full object-cover select-none"
                      />
                    ) : (
                      <span className="text-[11px] text-zinc-600 px-1">
                        {tr(lang, 'Reload', '点击加载')}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-9 mt-1 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shadow-sm"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              <span>{tr(lang, 'Create Account & Start Using AI', '创建邮箱账号并即刻启用 AI')}</span>
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void handleResetSubmit(e)}
            className={`p-5 rounded-2xl border space-y-3.5 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
            }`}
          >
            <div className="font-semibold">
              {tr(lang, 'Reset Account Password', '通过邮箱重置登录密码')}
            </div>
            <div className="space-y-1">
              <label className="opacity-70">{tr(lang, 'Registered Email', '注册邮箱地址')}</label>
              <input
                autoFocus
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="name@example.com"
                className={inputCls}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setFeedback(null)
                }}
                className="h-9 px-3.5 rounded-xl border opacity-75 hover:opacity-100"
              >
                {tr(lang, 'Back to Sign In', '返回登录')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 h-9 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {submitting && <Loader2 size={13} className="animate-spin" />}
                <span>{tr(lang, 'Send Reset Link', '发送重置邮件')}</span>
              </button>
            </div>
          </form>
        )}

        {feedback && (
          <div
            className={`p-3 rounded-xl border ${
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[11px] opacity-50 pt-1">
          <ShieldCheck size={12} />
          <span>
            {tr(
              lang,
              'End-to-end local keychain encryption · Unified Arko Cloud routing',
              '凭证采用系统级本地加密存储 · 统一通过 Arko 云端安全通道加速'
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
