import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Coins,
  CreditCard,
  Crown,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
  Zap
} from 'lucide-react'
import { ARKO_CLOUD_PROVIDER_ID } from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  AppSettings,
  ArkoAccountState,
  ArkoAuthServerCapabilities,
  ArkoCaptchaChallenge,
  ArkoTopUpCheckoutResult,
  ArkoTopUpQuoteResult
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
type TopUpMode = 'qrcode' | 'redeem'

const QR_POLL_INTERVAL_MS = 2000
const QR_POLL_MAX_ATTEMPTS = 90

/**
 * 从用户输入的注册邮箱推导长度不超过 20 字符的合法短账号标识。
 * @param email 原始邮箱字符串
 * @returns 截断清洗后的推荐账号短名
 */
function suggestHandleFromEmail(email: string): string {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed.length <= 20) return trimmed
  const [local = ''] = trimmed.split('@')
  return local.replace(/[^a-z0-9._-]/gi, '').slice(0, 20)
}

/**
 * 按当前界面语言返回支付方式的标准显示文案。
 * @param type 支付渠道标识（alipay / wxpay）
 * @param fallbackName 服务端返回的名称
 * @param lang 当前界面语言
 * @returns 双语支付渠道名称
 */
function formatPaymentMethodLabel(type: string, fallbackName: string, lang: AppLanguage): string {
  const normalized = type.trim().toLowerCase()
  if (normalized === 'alipay') {
    return tr(lang, 'Alipay', '支付宝')
  }
  if (normalized === 'wxpay') {
    return tr(lang, 'WeChat Pay', '微信支付')
  }
  return fallbackName || type
}

/**
 * 格式化支付币种金额显示（如 ¥73.00 CNY 或 $10.00 USD）。
 * @param amountText 金额文本
 * @param currency 币种代码
 * @returns 带货币符号与代码的格式化字符串
 */
function formatPayMoney(amountText?: string, currency = 'CNY'): string {
  const code = (currency || 'CNY').toUpperCase()
  const symbol = code === 'CNY' ? '¥' : code === 'USD' ? '$' : ''
  return `${symbol}${amountText || '0.00'} ${code}`
}

/**
 * 按当前界面语言格式化秒级时间戳为简短日期字符串。
 * @param unixSeconds 秒级时间戳
 * @param lang 当前界面语言
 * @returns 本地化短日期文本
 */
function formatUnixDate(unixSeconds: number, lang: AppLanguage): string {
  if (!unixSeconds || unixSeconds <= 0) return ''
  try {
    const locale = lang === 'zh-CN' ? 'zh-CN' : 'en-US'
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(unixSeconds * 1000))
  } catch {
    return ''
  }
}

/**
 * 按当前界面语言格式化订阅套餐时长单位。
 * @param value 时长数值
 * @param unit 时长单位（year / month / day / hour）
 * @param lang 当前界面语言
 * @returns 双语周期描述
 */
function formatPlanDuration(value: number, unit: string, lang: AppLanguage): string {
  const n = Math.max(1, value || 1)
  switch (unit) {
    case 'year':
      return tr(lang, n === 1 ? '1 Year' : `${n} Years`, `${n} 年`)
    case 'day':
      return tr(lang, n === 1 ? '1 Day' : `${n} Days`, `${n} 天`)
    case 'hour':
      return tr(lang, n === 1 ? '1 Hour' : `${n} Hours`, `${n} 小时`)
    default:
      return tr(lang, n === 1 ? '1 Month' : `${n} Months`, `${n} 个月`)
  }
}

/**
 * Arko 账号、统一余额（钱包 + 订阅套餐）与应用内扫码/兑换充值设置面板。
 * 同时兼容窄屏/移动端布局与桌面宽屏布局、深浅双色主题及中英双语实时切换。
 */
export const AccountSettingsPanel: React.FC<Props> = ({
  isDark,
  lang,
  settings,
  accountState,
  onUpdateSettings,
  onJumpToModels
}) => {
  const [mode, setMode] = useState<AuthTabMode>('login')

  // 服务端认证能力与图形验证码状态
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

  // 登录表单状态
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // 两步验证状态
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')

  // 注册表单状态（两步式：第 1 步「邮箱 + 图形验证码 -> 发邮件验证码」；第 2 步「邮件验证码 + 密码 -> 完成注册」）
  const [regStep, setRegStep] = useState<1 | 2>(1)
  const [regEmail, setRegEmail] = useState('')
  const [regUsername, setRegUsername] = useState('')
  const [regUsernameTouched, setRegUsernameTouched] = useState(false)
  const [regPassword, setRegPassword] = useState('')
  const [regConfirmPassword, setRegConfirmPassword] = useState('')
  const [regEmailCode, setRegEmailCode] = useState('')
  const [regCaptchaCode, setRegCaptchaCode] = useState('')
  const [emailCodeCountdown, setEmailCodeCountdown] = useState(0)
  const [sendingEmailCode, setSendingEmailCode] = useState(false)
  const [showResendCaptcha, setShowResendCaptcha] = useState(false)

  // 密码重置状态
  const [resetEmail, setResetEmail] = useState('')

  // 已登录态交互：同步、扫码充值、兑换码与余额买套餐
  const [submitting, setSubmitting] = useState(false)
  const [syncingProfile, setSyncingProfile] = useState(false)
  const [topUpMode, setTopUpMode] = useState<TopUpMode>('qrcode')
  const [selectedAmount, setSelectedAmount] = useState<number>(10)
  const [customAmountInput, setCustomAmountInput] = useState<string>('')
  const [selectedPayMethod, setSelectedPayMethod] = useState<string>('alipay')
  const [quoteState, setQuoteState] = useState<ArkoTopUpQuoteResult | null>(null)
  const [quotingAmount, setQuotingAmount] = useState(false)
  const [creatingQrOrder, setCreatingQrOrder] = useState(false)
  const [activeQrOrder, setActiveQrOrder] = useState<ArkoTopUpCheckoutResult | null>(null)
  const [qrOrderStatus, setQrOrderStatus] = useState<string>('pending')
  const [checkingOrderNow, setCheckingOrderNow] = useState(false)
  const [redeemCodeInput, setRedeemCodeInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [purchasingPlanId, setPurchasingPlanId] = useState<number | null>(null)

  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const creditedTradeNoRef = useRef<string>('')

  const billing = accountState?.billing || null
  const supportsQrTopUp = Boolean(billing?.topup?.supportsQrcodeCheckout)
  const enableRedemption = billing?.topup ? billing.topup.enableRedemption : true
  const payMethods = useMemo(() => billing?.topup?.payMethods || [], [billing?.topup?.payMethods])
  const amountPresets = useMemo(() => {
    const raw = billing?.topup?.amountOptions
    return raw && raw.length > 0 ? raw : [5, 10, 20, 50, 100]
  }, [billing?.topup?.amountOptions])

  // 根据服务端充值配置自动对齐默认支付方式与充值Tab
  useEffect(() => {
    if (!supportsQrTopUp && enableRedemption) {
      setTopUpMode('redeem')
    } else if (supportsQrTopUp) {
      setTopUpMode('qrcode')
    }
  }, [supportsQrTopUp, enableRedemption])

  useEffect(() => {
    if (payMethods.length > 0 && !payMethods.some((m) => m.type === selectedPayMethod)) {
      setSelectedPayMethod(payMethods[0].type)
    }
  }, [payMethods, selectedPayMethod])

  useEffect(() => {
    if (amountPresets.length > 0 && !customAmountInput.trim()) {
      if (!amountPresets.includes(selectedAmount)) {
        setSelectedAmount(amountPresets[0])
      }
    }
  }, [amountPresets, customAmountInput, selectedAmount])

  /**
   * 拉取一次性注册图形安全验证码。
   */
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

  // 登录态打开面板且尚未拿到统一账单快照时自动拉取一次
  useEffect(() => {
    if (accountState?.authenticated && !accountState.billing) {
      void window.arko.refreshAccountProfile()
    }
  }, [accountState?.authenticated, accountState?.billing])

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

  // 计算当前选中的有效整数充值金额
  const effectiveTopUpAmount = useMemo(() => {
    const trimmed = customAmountInput.trim()
    if (trimmed) {
      const parsed = Math.floor(Number(trimmed))
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    }
    return selectedAmount
  }, [customAmountInput, selectedAmount])

  // 当选中充值金额变化时，防抖向主进程请求服务端精确实付报价
  useEffect(() => {
    if (!accountState?.authenticated || !supportsQrTopUp || topUpMode !== 'qrcode') {
      return
    }
    if (effectiveTopUpAmount <= 0) {
      setQuoteState(null)
      return
    }
    let cancelled = false
    setQuotingAmount(true)
    const timer = window.setTimeout(() => {
      void window.arko.quoteTopUpAmount(effectiveTopUpAmount).then((res) => {
        if (cancelled) return
        setQuotingAmount(false)
        setQuoteState(res)
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [accountState?.authenticated, supportsQrTopUp, topUpMode, effectiveTopUpAmount])

  // 针对待支付二维码订单启动后台自动轮询，支付成功后自动关闭二维码并提示到账
  useEffect(() => {
    const tradeNo = activeQrOrder?.tradeNo
    if (!tradeNo) return

    let cancelled = false
    let attempts = 0
    let timer = 0

    const pollOnce = async (): Promise<void> => {
      attempts += 1
      try {
        const res = await window.arko.checkTopUpOrderStatus(tradeNo)
        if (cancelled) return
        if (res.ok && res.status) {
          setQrOrderStatus(res.status)
          if (res.status === 'success' && creditedTradeNoRef.current !== tradeNo) {
            creditedTradeNoRef.current = tradeNo
            const creditedUsd = activeQrOrder?.creditedUsd
            setActiveQrOrder(null)
            setFeedback({
              kind: 'ok',
              text: tr(
                lang,
                `Payment confirmed!${typeof creditedUsd === 'number' ? ` +$${creditedUsd.toFixed(2)} USD` : ''} added to your balance.`,
                `支付已确认到账！${typeof creditedUsd === 'number' ? `+$${creditedUsd.toFixed(2)} USD ` : ''}已实时计入账户余额`
              )
            })
            return
          }
          if (res.status === 'manual_review' || res.status === 'expired') {
            return
          }
        }
      } catch {
        // 忽略单次网络抖动，继续下一次轮询
      }
      if (!cancelled && attempts < QR_POLL_MAX_ATTEMPTS) {
        timer = window.setTimeout(() => {
          void pollOnce()
        }, QR_POLL_INTERVAL_MS)
      }
    }

    void pollOnce()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeQrOrder, lang])

  /**
   * 同步更新注册邮箱并自动推荐短账号标识。
   * @param val 输入框最新邮箱字符串
   */
  const handleEmailChange = (val: string): void => {
    setRegEmail(val)
    if (!regUsernameTouched) {
      setRegUsername(suggestHandleFromEmail(val))
    }
  }

  /**
   * 校验图形安全验证码并向目标邮箱发送一次性 6 位注册验证码，成功后进入第 2 步。
   * @param e 可选表单提交事件
   */
  const handleSendEmailCode = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    setFeedback(null)

    const cleanEmail = regEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter a valid email address.', '请输入有效的邮箱地址')
      })
      return
    }

    const needCaptcha = capabilities.registerCaptchaEnabled && captcha?.enabled !== false
    if (needCaptcha && (!captcha?.captchaId || !regCaptchaCode.trim())) {
      if (!captcha?.captchaId) {
        void loadCaptcha()
      }
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter the image verification code.', '请先输入右侧图形安全验证码')
      })
      return
    }

    setSendingEmailCode(true)
    const res = await window.arko.sendEmailVerificationCode({
      email: cleanEmail,
      captchaId: needCaptcha ? captcha?.captchaId : undefined,
      captchaCode: needCaptcha ? regCaptchaCode.trim() : undefined
    })
    setSendingEmailCode(false)

    if (res.ok) {
      setEmailCodeCountdown(60)
      setShowResendCaptcha(false)
      setRegStep(2)
      if (capabilities.registerCaptchaEnabled) {
        void loadCaptcha()
      }
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          `Verification code sent to ${cleanEmail}! Please check your inbox.`,
          `邮件验证码已发送至 ${cleanEmail}，请查收并完成注册`
        )
      })
    } else {
      if (capabilities.registerCaptchaEnabled) {
        void loadCaptcha()
      }
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Failed to send verification code', '邮件验证码发送失败')
      })
    }
  }

  /**
   * 处理邮箱/账号密码登录与两步验证提交。
   * @param e 表单事件
   */
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

  /**
   * 第 2 步：核验 6 位邮箱验证码与密码，完成真实邮箱绑定注册并自动登录激活内置云端模型。
   * @param e 表单事件
   */
  const handleRegisterSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFeedback(null)

    const cleanEmail = regEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setRegStep(1)
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter a valid email address.', '请输入有效的邮箱地址')
      })
      return
    }
    if (!regEmailCode.trim()) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please enter the email verification code.', '请输入邮件中的 6 位验证码')
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

    setSubmitting(true)
    const res = await window.arko.registerAccount({
      email: cleanEmail,
      username: cleanEmail.length > 20 ? regUsername.trim() || undefined : undefined,
      password: regPassword,
      verificationCode: regEmailCode.trim()
    })
    setSubmitting(false)

    if (res.ok) {
      setRegPassword('')
      setRegConfirmPassword('')
      setRegEmailCode('')
      setRegCaptchaCode('')
      setShowResendCaptcha(false)
      setRegStep(1)
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Email verified & account created! Arko Cloud AI is ready to use.',
          '邮箱核验通过并已完成注册登录！Arko 云端 AI 已即刻可用'
        )
      })
    } else {
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Registration failed', '注册失败，请检查邮件验证码或填写内容')
      })
    }
  }

  /**
   * 处理密码重置邮件发送。
   * @param e 表单事件
   */
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

  /**
   * 手动同步账户余额、订阅套餐状态与可用云端模型列表。
   */
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
          'Synced latest account balance, plans, and Cloud AI models.',
          '已同步最新账户余额、套餐状态与云端模型列表'
        )
      })
    } else if (res.error) {
      setFeedback({ kind: 'err', text: res.error })
    }
  }

  /**
   * 创建应用内支付宝/微信二维码充值订单。
   */
  const handleCreateQrOrder = async (): Promise<void> => {
    setFeedback(null)
    if (effectiveTopUpAmount <= 0) {
      setFeedback({
        kind: 'err',
        text: tr(lang, 'Please select or enter a valid recharge amount.', '请选择或输入有效的充值金额')
      })
      return
    }
    const minTopup = billing?.topup?.minTopup || 1
    if (effectiveTopUpAmount < minTopup) {
      setFeedback({
        kind: 'err',
        text: tr(
          lang,
          `Minimum recharge amount is $${minTopup}.`,
          `单笔最低充值额度为 $${minTopup}`
        )
      })
      return
    }

    setCreatingQrOrder(true)
    // 确保持有当前金额对应的最新确认报价
    let confirmedPayAmount = quoteState?.ok && quoteState.amount === effectiveTopUpAmount
      ? quoteState.payAmount || ''
      : ''
    if (!confirmedPayAmount) {
      const freshQuote = await window.arko.quoteTopUpAmount(effectiveTopUpAmount)
      setQuoteState(freshQuote)
      if (!freshQuote.ok || !freshQuote.payAmount) {
        setCreatingQrOrder(false)
        setFeedback({
          kind: 'err',
          text: freshQuote.error || tr(lang, 'Unable to calculate payment quote.', '无法计算实付金额，请稍后重试')
        })
        return
      }
      confirmedPayAmount = freshQuote.payAmount
    }

    const orderRes = await window.arko.createTopUpQrOrder({
      amount: effectiveTopUpAmount,
      paymentMethod: selectedPayMethod,
      confirmedPayAmount
    })
    setCreatingQrOrder(false)

    if (orderRes.priceChanged && orderRes.latestPayAmount) {
      setQuoteState({
        ok: true,
        amount: effectiveTopUpAmount,
        payAmount: orderRes.latestPayAmount,
        payCurrency: billing?.topup?.payCurrency || 'CNY',
        creditedUsd: effectiveTopUpAmount
      })
      setFeedback({
        kind: 'err',
        text: tr(
          lang,
          `Payment quote updated to ${orderRes.latestPayAmount}. Click pay again to confirm.`,
          `实付金额已更新为 ${orderRes.latestPayAmount}，请再次点击确认生成二维码`
        )
      })
      return
    }

    if (!orderRes.ok || !orderRes.tradeNo) {
      setFeedback({
        kind: 'err',
        text: orderRes.error || tr(lang, 'Failed to generate payment QR code.', '生成支付二维码失败')
      })
      return
    }

    setQrOrderStatus('pending')
    setActiveQrOrder(orderRes)
  }

  /**
   * 用户点击「我已支付」时立即主动查询一次订单入账状态。
   */
  const handleManualCheckOrder = async (): Promise<void> => {
    if (!activeQrOrder?.tradeNo) return
    setCheckingOrderNow(true)
    const res = await window.arko.checkTopUpOrderStatus(activeQrOrder.tradeNo)
    setCheckingOrderNow(false)
    if (res.ok && res.status === 'success') {
      const creditedUsd = activeQrOrder.creditedUsd
      creditedTradeNoRef.current = activeQrOrder.tradeNo
      setActiveQrOrder(null)
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          `Payment confirmed!${typeof creditedUsd === 'number' ? ` +$${creditedUsd.toFixed(2)} USD` : ''} added to your balance.`,
          `支付已确认到账！${typeof creditedUsd === 'number' ? `+$${creditedUsd.toFixed(2)} USD ` : ''}已实时计入账户余额`
        )
      })
    } else if (res.status === 'manual_review') {
      setQrOrderStatus('manual_review')
      setFeedback({
        kind: 'err',
        text: tr(
          lang,
          'This payment requires manual review. Please wait or contact support.',
          '该笔订单正在进行人工对账审核，请稍候刷新查看'
        )
      })
    } else {
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          'Still waiting for payment confirmation — keep this QR code open if you just paid.',
          '暂未收到支付完成回执，若刚完成扫码请稍候片刻，系统将持续自动检测'
        )
      })
    }
  }

  /**
   * 处理额度兑换码核销。
   * @param e 表单事件
   */
  const handleRedeem = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!redeemCodeInput.trim()) return
    setRedeeming(true)
    setFeedback(null)
    const res = await window.arko.redeemAccountCode(redeemCodeInput.trim())
    setRedeeming(false)
    if (res.ok) {
      setRedeemCodeInput('')
      const amt = typeof res.addedUsd === 'number' ? ` (+$${res.addedUsd.toFixed(2)} USD)` : ''
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

  /**
   * 使用当前钱包余额直接购买激活指定订阅套餐。
   * @param planId 套餐 ID
   * @param planTitle 套餐名称
   */
  const handlePurchasePlanWithBalance = async (
    planId: number,
    planTitle: string
  ): Promise<void> => {
    setPurchasingPlanId(planId)
    setFeedback(null)
    const res = await window.arko.purchaseSubscriptionWithBalance(planId)
    setPurchasingPlanId(null)
    if (res.ok) {
      setFeedback({
        kind: 'ok',
        text: tr(
          lang,
          `✓ Plan "${planTitle}" activated! Quota is ready to use.`,
          `✓ 已使用钱包余额成功开通「${planTitle}」套餐！`
        )
      })
    } else {
      setFeedback({
        kind: 'err',
        text: res.error || tr(lang, 'Failed to activate plan.', '套餐开通失败，请检查钱包可用余额')
      })
    }
  }

  /**
   * 安全退出当前云端账号并清理本地加密凭证。
   */
  const handleLogout = async (): Promise<void> => {
    setSubmitting(true)
    setActiveQrOrder(null)
    await window.arko.logoutAccount()
    setSubmitting(false)
    setFeedback({
      kind: 'ok',
      text: tr(lang, 'Signed out of Arko Account.', '已安全退出当前 Arko 账号')
    })
  }

  const inputCls = `w-full h-9 px-3 rounded-xl border outline-none transition ${
    isDark
      ? 'bg-[#16161C] border-white/10 focus:border-indigo-400 text-zinc-100 placeholder:text-zinc-500'
      : 'bg-white border-black/12 focus:border-indigo-500 text-zinc-900 placeholder:text-zinc-400'
  }`

  const user = accountState?.user
  const isCloudActive = settings.activeProviderId === ARKO_CLOUD_PROVIDER_ID

  if (accountState?.authenticated && user) {
    const effectiveRemaining =
      typeof billing?.effectiveRemainingUsd === 'number'
        ? billing.effectiveRemainingUsd
        : typeof user.remainingUsd === 'number'
          ? user.remainingUsd
          : 0
    const walletRemaining =
      typeof billing?.walletRemainingUsd === 'number'
        ? billing.walletRemainingUsd
        : typeof user.walletRemainingUsd === 'number'
          ? user.walletRemainingUsd
          : effectiveRemaining
    const subRemaining =
      typeof billing?.subscription?.remainingUsd === 'number'
        ? billing.subscription.remainingUsd
        : 0
    const hasActiveSub = Boolean(billing?.subscription?.hasActive)
    const effectiveUnlimited = Boolean(
      billing?.effectiveUnlimited || user.effectiveUnlimited
    )
    const used = typeof user.usedUsd === 'number' ? user.usedUsd : 0
    const total = effectiveRemaining + used
    const remainPct = effectiveUnlimited
      ? 100
      : total > 0
        ? Math.min(100, Math.max(4, (effectiveRemaining / total) * 100))
        : 100
    const avatarChar = (user.email || user.displayName || user.username || 'A')
      .trim()
      .charAt(0)
      .toUpperCase()
    const plans = accountState.plans || []

    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
        {/* 账号身份顶栏卡片（兼容窄屏自动换行） */}
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 ${
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm truncate max-w-full">
                  {user.email || user.displayName || user.username}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25 shrink-0">
                  {tr(lang, 'Arko Cloud · Connected', 'Arko 云端已连接')}
                </span>
              </div>
              <div className="opacity-65 break-words">
                {user.email && user.username && user.username !== user.email
                  ? `${tr(lang, 'Account ID:', '账号标识：')} ${user.username} · `
                  : ''}
                {tr(
                  lang,
                  'Unified Cloud AI balance & credentials encrypted on device',
                  '内置云端 AI 凭证与实时余额已在本机加密托管'
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={syncingProfile}
              onClick={() => void handleRefreshAccount()}
              className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1.5 transition ${
                isDark
                  ? 'border-white/12 bg-white/5 hover:bg-white/10 text-zinc-100'
                  : 'border-black/10 bg-white hover:bg-zinc-100 text-zinc-800'
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

        {/* 综合额度、钱包与生效套餐卡片 */}
        <div
          className={`p-4 rounded-2xl border space-y-3.5 ${
            isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/80 border-black/7'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold flex items-center gap-1.5">
              <Coins size={14} className="text-amber-500 shrink-0" />
              <span>{tr(lang, 'Cloud AI Balance & Usage', '云端 AI 余额与用量')}</span>
            </div>
            <span className="text-[11px] opacity-60">
              {tr(lang, 'Total Requests:', '累计调用：')} {user.requestCount ?? 0}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              className={`p-3 rounded-xl border min-w-0 ${
                isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/7'
              }`}
            >
              <div className="text-[11px] opacity-60">
                {tr(lang, 'Total Available', '当前总可用余额')}
              </div>
              <div className="text-base font-bold text-emerald-500 mt-0.5 truncate">
                {effectiveUnlimited ? (
                  <span>∞ {tr(lang, 'Unlimited', '不限额')}</span>
                ) : (
                  <>
                    ${effectiveRemaining.toFixed(2)}{' '}
                    <span className="text-[10px] font-normal opacity-70">USD</span>
                  </>
                )}
              </div>
              {hasActiveSub && (
                <div className="text-[10.5px] opacity-60 mt-0.5 truncate">
                  {tr(
                    lang,
                    `Wallet $${walletRemaining.toFixed(2)} + Plan $${subRemaining.toFixed(2)}`,
                    `钱包 $${walletRemaining.toFixed(2)} + 套餐 $${subRemaining.toFixed(2)}`
                  )}
                </div>
              )}
            </div>

            <div
              className={`p-3 rounded-xl border min-w-0 ${
                isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/7'
              }`}
            >
              <div className="text-[11px] opacity-60">
                {tr(lang, 'Used Credits', '历史已用额度')}
              </div>
              <div className="text-base font-bold mt-0.5 truncate">
                ${used.toFixed(2)}{' '}
                <span className="text-[10px] font-normal opacity-60">USD</span>
              </div>
              {!hasActiveSub && (
                <div className="text-[10.5px] opacity-55 mt-0.5 truncate">
                  {tr(lang, 'Pay-as-you-go wallet', '按量实时扣减')}
                </div>
              )}
            </div>

            <div
              className={`p-3 rounded-xl border flex flex-col justify-between min-w-0 ${
                isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/7'
              }`}
            >
              <div className="text-[11px] opacity-60">
                {tr(lang, 'Active Engine', '当前默认引擎')}
              </div>
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
                  className="mt-0.5 text-left font-semibold text-indigo-500 hover:underline truncate"
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

          {/* 生效中的订阅套餐列表 */}
          {hasActiveSub && billing?.subscription?.items && billing.subscription.items.length > 0 && (
            <div className="pt-1 space-y-2">
              {billing.subscription.items.map((item) => {
                const expireText = formatUnixDate(item.endTime, lang)
                const resetText = formatUnixDate(item.nextResetTime, lang)
                return (
                  <div
                    key={item.id}
                    className={`px-3 py-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      isDark
                        ? 'bg-indigo-500/8 border-indigo-400/20 text-zinc-200'
                        : 'bg-indigo-50/70 border-indigo-200/70 text-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Crown size={13} className="text-amber-500 shrink-0" />
                      <span className="font-semibold truncate">{item.planTitle}</span>
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 shrink-0">
                        {item.unlimited
                          ? tr(lang, 'Unlimited', '不限额')
                          : `$${item.remainingUsd.toFixed(2)} ${tr(lang, 'left', '剩余')}`}
                      </span>
                    </div>
                    <div className="text-[11px] opacity-65 shrink-0">
                      {resetText
                        ? `${tr(lang, 'Resets', '重置')} ${resetText} · `
                        : ''}
                      {expireText ? `${tr(lang, 'Valid until', '有效期至')} ${expireText}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 应用内在线扫码充值与额度兑换码一体面板 */}
        {(supportsQrTopUp || enableRedemption) && (
          <div
            className={`p-4 rounded-2xl border space-y-3.5 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/80 border-black/7'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="font-semibold flex items-center gap-1.5">
                <CreditCard size={14} className="text-indigo-500 shrink-0" />
                <span>{tr(lang, 'Add Cloud AI Credits', '充值云端 AI 额度')}</span>
              </div>

              {supportsQrTopUp && enableRedemption && (
                <div
                  className={`inline-grid grid-cols-2 p-0.5 rounded-xl border self-start sm:self-auto ${
                    isDark ? 'bg-[#15151B] border-white/10' : 'bg-zinc-200/70 border-black/8'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setTopUpMode('qrcode')
                      setFeedback(null)
                    }}
                    className={`h-7 px-3 rounded-lg text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
                      topUpMode === 'qrcode'
                        ? isDark
                          ? 'bg-[#262633] text-white shadow-xs'
                          : 'bg-white text-zinc-900 shadow-xs'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    <QrCode size={12} />
                    <span>{tr(lang, 'Scan to Pay', '扫码直充')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTopUpMode('redeem')
                      setActiveQrOrder(null)
                      setFeedback(null)
                    }}
                    className={`h-7 px-3 rounded-lg text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
                      topUpMode === 'redeem'
                        ? isDark
                          ? 'bg-[#262633] text-white shadow-xs'
                          : 'bg-white text-zinc-900 shadow-xs'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    <Gift size={12} />
                    <span>{tr(lang, 'Redeem Code', '兑换码核销')}</span>
                  </button>
                </div>
              )}
            </div>

            {supportsQrTopUp && topUpMode === 'qrcode' ? (
              activeQrOrder ? (
                /* 扫码待支付视图（白色高对比度扫码垫兼容深浅色主题） */
                <div
                  className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center gap-5 ${
                    isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/10'
                  }`}
                >
                  <div className="p-2.5 rounded-2xl bg-white border border-zinc-200 shadow-sm shrink-0">
                    <img
                      src={activeQrOrder.qrImageDataUrl || activeQrOrder.qrImageUrl}
                      alt={tr(lang, 'Payment QR Code', '支付二维码')}
                      className="w-40 h-40 object-contain select-none"
                    />
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5 text-center sm:text-left w-full">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/12 text-indigo-600 dark:text-indigo-300">
                        <QrCode size={12} />
                        <span>
                          {tr(
                            lang,
                            `Scan with ${formatPaymentMethodLabel(activeQrOrder.paymentMethod || selectedPayMethod, '', lang)}`,
                            `请使用${formatPaymentMethodLabel(activeQrOrder.paymentMethod || selectedPayMethod, '', lang)}扫一扫`
                          )}
                        </span>
                      </div>
                      <div className="text-lg font-bold tracking-tight">
                        {formatPayMoney(activeQrOrder.payAmount, activeQrOrder.payCurrency)}
                      </div>
                      <div className="text-[11px] opacity-65">
                        {tr(
                          lang,
                          `Credits added upon payment: +$${(activeQrOrder.creditedUsd ?? effectiveTopUpAmount).toFixed(2)} USD`,
                          `支付完成后自动到账：+$${(activeQrOrder.creditedUsd ?? effectiveTopUpAmount).toFixed(2)} USD`
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-center sm:justify-start gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                      <Loader2 size={12} className="animate-spin shrink-0" />
                      <span>
                        {qrOrderStatus === 'manual_review'
                          ? tr(lang, 'Pending manual review…', '订单审核中…')
                          : tr(
                              lang,
                              'Confirming payment automatically…',
                              '正在自动检测支付结果，到账后自动刷新…'
                            )}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                      <button
                        type="button"
                        disabled={checkingOrderNow}
                        onClick={() => void handleManualCheckOrder()}
                        className="h-8 px-3.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        {checkingOrderNow ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={12} />
                        )}
                        <span>{tr(lang, "I've Paid · Check Now", '我已支付 · 立即刷新')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveQrOrder(null)}
                        className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1 transition ${
                          isDark
                            ? 'border-white/12 hover:bg-white/8 text-zinc-300'
                            : 'border-black/12 hover:bg-zinc-100 text-zinc-700'
                        }`}
                      >
                        <X size={12} />
                        <span>{tr(lang, 'Change Amount', '更换金额')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* 选择金额与支付渠道表单 */
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="text-[11px] opacity-65">
                      {tr(lang, 'Select Credit Amount (USD)', '选择充值额度（USD）')}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {amountPresets.map((amt) => {
                        const isSelected = !customAmountInput.trim() && selectedAmount === amt
                        const discount = billing?.topup?.discount?.[String(amt)]
                        const hasDiscount = typeof discount === 'number' && discount > 0 && discount < 1
                        return (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => {
                              setCustomAmountInput('')
                              setSelectedAmount(amt)
                            }}
                            className={`h-9 px-3.5 rounded-xl border font-semibold inline-flex items-center gap-1.5 transition ${
                              isSelected
                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                                : isDark
                                  ? 'bg-[#16161C] border-white/10 hover:border-white/25 text-zinc-200'
                                  : 'bg-white border-black/10 hover:border-black/25 text-zinc-800'
                            }`}
                          >
                            <span>${amt}</span>
                            {hasDiscount && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold ${
                                  isSelected
                                    ? 'bg-white/20 text-white'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                                }`}
                              >
                                {lang === 'zh-CN'
                                  ? `${+(discount * 10).toFixed(1)}折`
                                  : `-${Math.round((1 - discount) * 100)}%`}
                              </span>
                            )}
                          </button>
                        )
                      })}

                      <div className="relative flex items-center min-w-[132px] flex-1 sm:flex-initial">
                        <span className="absolute left-3 opacity-50 font-semibold pointer-events-none">
                          $
                        </span>
                        <input
                          type="number"
                          min={billing?.topup?.minTopup || 1}
                          max={billing?.topup?.maxTopup || 10000}
                          step={1}
                          value={customAmountInput}
                          onChange={(e) => setCustomAmountInput(e.target.value)}
                          placeholder={tr(lang, 'Custom USD', '自定义金额')}
                          className={`${inputCls} pl-6 pr-3`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 支付渠道选择与实付金额确认行 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {payMethods.map((method) => {
                        const active = selectedPayMethod === method.type
                        const isWechat = method.type === 'wxpay'
                        return (
                          <button
                            key={method.type}
                            type="button"
                            onClick={() => setSelectedPayMethod(method.type)}
                            className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1.5 transition ${
                              active
                                ? isWechat
                                  ? 'border-emerald-500/60 bg-emerald-500/14 text-emerald-600 dark:text-emerald-300'
                                  : 'border-sky-500/60 bg-sky-500/14 text-sky-600 dark:text-sky-300'
                                : isDark
                                  ? 'bg-[#16161C] border-white/10 hover:border-white/20 text-zinc-300'
                                  : 'bg-white border-black/10 hover:border-black/20 text-zinc-700'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isWechat ? 'bg-emerald-500' : 'bg-sky-500'
                              }`}
                            />
                            <span>{formatPaymentMethodLabel(method.type, method.name, lang)}</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
                      <div className="text-left sm:text-right">
                        <div className="text-[10.5px] opacity-60">
                          {tr(lang, 'Estimated Total', '预计实付')}
                        </div>
                        <div className="font-bold text-sm">
                          {quotingAmount ? (
                            <span className="inline-flex items-center gap-1 opacity-65 text-xs">
                              <Loader2 size={11} className="animate-spin" />
                              {tr(lang, 'Quoting…', '计算中…')}
                            </span>
                          ) : quoteState?.ok && quoteState.payAmount ? (
                            formatPayMoney(quoteState.payAmount, quoteState.payCurrency)
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={creatingQrOrder || quotingAmount || effectiveTopUpAmount <= 0}
                        onClick={() => void handleCreateQrOrder()}
                        className="h-9 px-4 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0 shadow-xs"
                      >
                        {creatingQrOrder ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <QrCode size={13} />
                        )}
                        <span>{tr(lang, 'Generate QR Code', '生成付款二维码')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* 兑换充值码核销表单 */
              <form onSubmit={(e) => void handleRedeem(e)} className="space-y-2">
                <div className="text-[11px] opacity-65">
                  {tr(
                    lang,
                    'Enter a credit redemption code to top up your balance instantly.',
                    '输入专属额度兑换码，核销后立即计入账户可用余额'
                  )}
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    value={redeemCodeInput}
                    onChange={(e) => setRedeemCodeInput(e.target.value)}
                    placeholder={tr(
                      lang,
                      'Paste your Arko credit redemption code…',
                      '粘贴您的 Arko 专属额度兑换码…'
                    )}
                    className={`${inputCls} flex-1 font-mono min-w-0`}
                  />
                  <button
                    type="submit"
                    disabled={redeeming || !redeemCodeInput.trim()}
                    className="h-9 px-4 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shrink-0"
                  >
                    {redeeming ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                    <span>{tr(lang, 'Redeem', '立即兑换')}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* 可通过钱包余额直接开通的订阅套餐卡片（服务端已配置启用套餐时展示） */}
        {plans.length > 0 && (
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/80 border-black/7'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold flex items-center gap-1.5">
                <Crown size={14} className="text-amber-500 shrink-0" />
                <span>{tr(lang, 'Cloud AI Plans (Pay with Balance)', '云端套餐包（支持钱包余额直通）')}</span>
              </div>
              <span className="text-[11px] opacity-60">
                {tr(lang, 'Wallet Balance:', '当前钱包余额：')} ${walletRemaining.toFixed(2)} USD
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {plans.map((plan) => {
                const enoughWallet = walletRemaining + 1e-6 >= plan.priceAmount
                const buying = purchasingPlanId === plan.id
                return (
                  <div
                    key={plan.id}
                    className={`p-3 rounded-xl border flex flex-col justify-between gap-2.5 ${
                      isDark ? 'bg-[#16161C] border-white/8' : 'bg-white border-black/8'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold truncate">{plan.title}</span>
                        <span className="font-bold text-indigo-500 shrink-0">
                          ${plan.priceAmount.toFixed(2)}
                        </span>
                      </div>
                      {plan.subtitle && (
                        <div className="text-[11px] opacity-60 line-clamp-2">{plan.subtitle}</div>
                      )}
                      <div className="text-[10.5px] opacity-65">
                        {formatPlanDuration(plan.durationValue, plan.durationUnit, lang)} ·{' '}
                        {plan.unlimited
                          ? tr(lang, 'Unlimited quota', '周期内不限额')
                          : tr(
                              lang,
                              `$${plan.totalAmountUsd.toFixed(2)} USD quota`,
                              `含 $${plan.totalAmountUsd.toFixed(2)} USD 额度`
                            )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={buying || !enoughWallet}
                      onClick={() => void handlePurchasePlanWithBalance(plan.id, plan.title)}
                      className={`h-8 px-3 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 transition ${
                        enoughWallet
                          ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                          : isDark
                            ? 'bg-white/6 text-zinc-400 cursor-not-allowed'
                            : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                      }`}
                    >
                      {buying && <Loader2 size={12} className="animate-spin" />}
                      <span>
                        {enoughWallet
                          ? tr(lang, 'Activate with Balance', '使用钱包余额开通')
                          : tr(lang, 'Insufficient Wallet Balance', '钱包余额不足，请先充值')}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {feedback && (
          <div
            className={`p-3 rounded-xl border break-words ${
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 text-xs">
      <div className="max-w-md mx-auto space-y-5">
        {/* 品牌引导头 */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm">
              {tr(lang, 'Arko Account & Cloud AI', 'Arko 账号与内置云端 AI')}
            </div>
            <div className="opacity-60 mt-0.5 break-words">
              {tr(
                lang,
                'Sign in with email to unlock Gemini, GPT & Claude models with zero API key setup.',
                '使用邮箱注册或登录，无需手动配置 API Key 即可畅享内置旗舰大模型。'
              )}
            </div>
          </div>
        </div>

        {/* 登录 / 注册分段切换器 */}
        <div
          className={`grid grid-cols-2 p-1 rounded-xl border ${
            isDark ? 'bg-[#15151B] border-white/8' : 'bg-zinc-100 border-black/6'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setTwoFactorToken(null)
              setFeedback(null)
            }}
            className={`h-8 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 transition px-2 truncate ${
              mode === 'login'
                ? isDark
                  ? 'bg-[#252530] text-white shadow-xs'
                  : 'bg-white text-zinc-900 shadow-xs'
                : 'opacity-65 hover:opacity-100'
            }`}
          >
            <LogIn size={13} className="shrink-0" />
            <span className="truncate">{tr(lang, 'Sign In', '邮箱 / 账号登录')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('register')
              setTwoFactorToken(null)
              setFeedback(null)
            }}
            className={`h-8 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 transition px-2 truncate ${
              mode === 'register'
                ? isDark
                  ? 'bg-[#252530] text-white shadow-xs'
                  : 'bg-white text-zinc-900 shadow-xs'
                : 'opacity-65 hover:opacity-100'
            }`}
          >
            <UserPlus size={13} className="shrink-0" />
            <span className="truncate">{tr(lang, 'Create Account', '邮箱注册新账号')}</span>
          </button>
        </div>

        {mode === 'login' ? (
          <form
            onSubmit={(e) => void handleLoginSubmit(e)}
            className={`p-4 sm:p-5 rounded-2xl border space-y-3.5 ${
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
                  <label className="opacity-70 block">
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
                    className={`h-9 px-3 rounded-xl border opacity-80 hover:opacity-100 ${
                      isDark ? 'border-white/12' : 'border-black/12'
                    }`}
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
                  <label className="opacity-70 block">
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="opacity-70">{tr(lang, 'Password', '登录密码')}</label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset')
                        setResetEmail(loginIdentifier.includes('@') ? loginIdentifier : '')
                        setFeedback(null)
                      }}
                      className="text-[11px] text-indigo-500 hover:underline shrink-0"
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
          <div
            className={`p-4 sm:p-5 rounded-2xl border space-y-3.5 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
            }`}
          >
            {/* 两步引导进度条 */}
            <div className="flex items-center gap-2 text-[11px]">
              <div
                className={`flex-1 px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition ${
                  regStep === 1
                    ? 'border-indigo-500/40 bg-indigo-500/12 text-indigo-600 dark:text-indigo-300'
                    : isDark
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                <span className="w-4 h-4 rounded-full text-[10px] font-bold inline-flex items-center justify-center bg-current/15 shrink-0">
                  {regStep > 1 ? '✓' : '1'}
                </span>
                <span className="truncate">{tr(lang, 'Verify Email', '安全校验并发信')}</span>
              </div>

              <div
                className={`flex-1 px-2.5 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition ${
                  regStep === 2
                    ? 'border-indigo-500/40 bg-indigo-500/12 text-indigo-600 dark:text-indigo-300'
                    : isDark
                      ? 'border-white/8 bg-white/[0.02] opacity-50'
                      : 'border-black/8 bg-white/60 opacity-50'
                }`}
              >
                <span className="w-4 h-4 rounded-full text-[10px] font-bold inline-flex items-center justify-center bg-current/15 shrink-0">
                  2
                </span>
                <span className="truncate">{tr(lang, 'Confirm & Setup', '邮件确认并设密码')}</span>
              </div>
            </div>

            {regStep === 1 ? (
              <form onSubmit={(e) => void handleSendEmailCode(e)} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="opacity-70 block">{tr(lang, 'Email Address', '电子邮箱')}</label>
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

                {capabilities.registerCaptchaEnabled && captcha?.enabled !== false && (
                  <div className="space-y-1">
                    <label className="opacity-70 block">
                      {tr(lang, 'Security Verification', '安全图形验证码（点击图片可刷新）')}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        value={regCaptchaCode}
                        onChange={(e) => setRegCaptchaCode(e.target.value.toUpperCase())}
                        placeholder={tr(lang, 'Enter characters', '输入右侧图形字符')}
                        className={`${inputCls} flex-1 font-mono tracking-wider uppercase min-w-0`}
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
                            alt={tr(lang, 'Verification Code', '图形验证码')}
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
                  disabled={sendingEmailCode || emailCodeCountdown > 0 || !regEmail.trim()}
                  className="w-full h-9 mt-1 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {sendingEmailCode ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Mail size={14} />
                  )}
                  <span>
                    {emailCodeCountdown > 0
                      ? tr(
                          lang,
                          `Code Sent (${emailCodeCountdown}s)`,
                          `邮件验证码已发送（${emailCodeCountdown}s）`
                        )
                      : tr(lang, 'Send Email Verification Code', '验证并发送邮件验证码')}
                  </span>
                </button>

                {emailCodeCountdown > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(regEmail.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFeedback(null)
                      setRegStep(2)
                    }}
                    className="w-full text-center text-[11px] text-indigo-500 hover:underline pt-0.5"
                  >
                    {tr(
                      lang,
                      'Already received your email code? Continue to Step 2 →',
                      '已收到邮件验证码？直接进入第 2 步填写 →'
                    )}
                  </button>
                )}
              </form>
            ) : (
              <form onSubmit={(e) => void handleRegisterSubmit(e)} className="space-y-3.5">
                {/* 已验证目标邮箱摘要栏 */}
                <div
                  className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${
                    isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/10'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail size={13} className="text-indigo-500 shrink-0" />
                    <span className="font-medium truncate">{regEmail.trim().toLowerCase()}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRegStep(1)
                      setShowResendCaptcha(false)
                      setFeedback(null)
                    }}
                    className="text-[11px] text-indigo-500 hover:underline shrink-0"
                  >
                    {tr(lang, 'Change Email', '修改邮箱')}
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="opacity-70 block">
                    {tr(lang, 'Email Verification Code', '邮件验证码（6 位）')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      maxLength={8}
                      autoComplete="one-time-code"
                      value={regEmailCode}
                      onChange={(e) => setRegEmailCode(e.target.value)}
                      placeholder={tr(lang, 'Enter 6-digit code from email', '输入邮件中的 6 位验证码')}
                      className={`${inputCls} flex-1 font-mono tracking-widest min-w-0`}
                    />
                    <button
                      type="button"
                      disabled={sendingEmailCode || emailCodeCountdown > 0}
                      onClick={() => {
                        const needCaptcha =
                          capabilities.registerCaptchaEnabled && captcha?.enabled !== false
                        if (needCaptcha && !showResendCaptcha) {
                          setShowResendCaptcha(true)
                          setFeedback(null)
                          if (!captcha?.captchaId) {
                            void loadCaptcha()
                          }
                          return
                        }
                        void handleSendEmailCode()
                      }}
                      className={`h-9 px-3 rounded-xl border font-medium shrink-0 transition disabled:opacity-50 whitespace-nowrap ${
                        isDark
                          ? 'border-white/12 bg-white/5 hover:bg-white/10 text-zinc-100'
                          : 'border-black/10 bg-white hover:bg-zinc-100 text-zinc-800'
                      }`}
                    >
                      {sendingEmailCode ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : emailCodeCountdown > 0 ? (
                        `${emailCodeCountdown}s`
                      ) : (
                        tr(lang, 'Resend Code', '重新发送')
                      )}
                    </button>
                  </div>
                </div>

                {/* 倒计时结束后如需重发邮件验证码，内联核验新图形码而无需丢失已填密码 */}
                {showResendCaptcha &&
                  emailCodeCountdown === 0 &&
                  capabilities.registerCaptchaEnabled &&
                  captcha?.enabled !== false && (
                    <div
                      className={`p-3 rounded-xl border space-y-2 ${
                        isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="opacity-75">
                          {tr(
                            lang,
                            'Enter security code to resend verification email',
                            '输入新图形验证码以重新发送邮件'
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowResendCaptcha(false)}
                          className="opacity-60 hover:opacity-100"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={regCaptchaCode}
                          onChange={(e) => setRegCaptchaCode(e.target.value.toUpperCase())}
                          placeholder={tr(lang, 'Enter characters', '输入图形字符')}
                          className={`${inputCls} flex-1 font-mono tracking-wider uppercase min-w-0`}
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
                              alt={tr(lang, 'Verification Code', '图形验证码')}
                              className="w-full h-full object-cover select-none"
                            />
                          ) : (
                            <span className="text-[11px] text-zinc-600 px-1">
                              {tr(lang, 'Reload', '点击加载')}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={sendingEmailCode || !regCaptchaCode.trim()}
                          onClick={() => void handleSendEmailCode()}
                          className="h-9 px-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition disabled:opacity-50 shrink-0"
                        >
                          {tr(lang, 'Send', '发送')}
                        </button>
                      </div>
                    </div>
                  )}

                {regEmail.trim().length > 20 && (
                  <div className="space-y-1">
                    <label className="opacity-70 block">
                      {tr(
                        lang,
                        'Account ID (1–20 chars, optional handle)',
                        '账号短标识（20 字符内，可选）'
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="opacity-70 block">
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
                    <label className="opacity-70 block">
                      {tr(lang, 'Confirm Password', '确认密码')}
                    </label>
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
                  <span>
                    {tr(lang, 'Verify & Create Account', '确认无误并完成注册')}
                  </span>
                </button>
              </form>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleResetSubmit(e)}
            className={`p-4 sm:p-5 rounded-2xl border space-y-3.5 ${
              isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
            }`}
          >
            <div className="font-semibold">
              {tr(lang, 'Reset Account Password', '通过邮箱重置登录密码')}
            </div>
            <div className="space-y-1">
              <label className="opacity-70 block">
                {tr(lang, 'Registered Email', '注册邮箱地址')}
              </label>
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
                className={`h-9 px-3.5 rounded-xl border opacity-80 hover:opacity-100 shrink-0 ${
                  isDark ? 'border-white/12' : 'border-black/12'
                }`}
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
            className={`p-3 rounded-xl border break-words ${
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[11px] opacity-50 pt-1 text-center">
          <ShieldCheck size={12} className="shrink-0" />
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
