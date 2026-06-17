import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  Database,
  MessageSquare,
  RefreshCw,
  Radio,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import { getHealth, getMessageStats, getSystemConfigs } from '../lib/api'
import { cn } from '../lib/utils'

function StatCard({ label, value, icon: Icon, tone }) {
  const color = {
    emerald: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
    amber: 'text-amber-300 bg-amber-400/10 border-amber-400/20',
    rose: 'text-rose-300 bg-rose-400/10 border-rose-400/20',
    cyan: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20',
    slate: 'text-slate-300 bg-slate-400/10 border-slate-400/20',
  }[tone]

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={cn('rounded-md border p-1.5', color)}>
          <Icon size={15} />
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value ?? 0}</div>
    </div>
  )
}

export default function SystemStatus() {
  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)
  const [configs, setConfigs] = useState({})
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = async () => {
    setRefreshing(true)
    try {
      const [healthData, statsData, configData] = await Promise.all([
        getHealth(),
        getMessageStats(),
        getSystemConfigs(),
      ])
      setHealth(healthData)
      setStats(statsData)
      setConfigs(configData || {})
    } catch (error) {
      console.error('Failed to fetch status:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 5000)
    return () => clearInterval(timer)
  }, [])

  const webhookUrl = health?.webhook_url || ''
  const exeUrl = health?.pywxrobot?.url || 'http://127.0.0.1:23235'
  const autoReplyOn = configs.auto_reply_enabled === 'true'
  const replyMode = useMemo(() => {
    const map = { all: '全部好友', keyword: '关键词触发', whitelist: '白名单' }
    return map[configs.reply_mode || 'all'] || '全部好友'
  }, [configs.reply_mode])

  const copyWebhook = async () => {
    if (!webhookUrl) return
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-emerald-300" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
            <Radio size={13} />
            本地机器人控制台
          </div>
          <h1 className="text-2xl font-semibold tracking-normal">VX智能AI</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            接收微信消息、调用知识库生成回复，并通过本地 pywxrobot 接口发回给好友。
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={refreshing}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all',
            refreshing
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-white/10 text-slate-300 hover:bg-white/[0.05]',
          )}
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          刷新状态
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <Zap size={16} className="text-emerald-300" />
              消息接收接口
            </h2>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
              POST
            </span>
          </div>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-emerald-300">
              {webhookUrl || '等待服务返回地址'}
            </code>
            <button
              onClick={copyWebhook}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.05]',
                copied && 'border-emerald-400/30 text-emerald-300',
              )}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
            <div>把这个 URL 填到已运行 exe 的消息推送地址里。</div>
            <div>请求体字段：wxpid、sender、recipient、content、msgid、timestamp。</div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-300">
            {health?.pywxrobot?.connected ? (
              <Wifi size={16} className="text-emerald-300" />
            ) : (
              <WifiOff size={16} className="text-rose-300" />
            )}
            pywxrobot 连接
          </h2>
          <div
            className={cn(
              'mb-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs',
              health?.pywxrobot?.connected
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                : 'border-rose-400/20 bg-rose-400/10 text-rose-200',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                health?.pywxrobot?.connected ? 'bg-emerald-300' : 'bg-rose-300',
              )}
            />
            {health?.pywxrobot?.connected ? '已连接' : '未连接'}
          </div>
          <div className="truncate font-mono text-xs text-slate-500">{exeUrl}</div>
          <div className="mt-4 text-xs text-slate-500">发送接口：{exeUrl}/send/text</div>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="总消息" value={stats?.total} icon={MessageSquare} tone="cyan" />
        <StatCard label="已回复" value={stats?.replied} icon={Check} tone="emerald" />
        <StatCard label="待处理" value={stats?.pending} icon={RefreshCw} tone="amber" />
        <StatCard label="已跳过" value={stats?.skipped} icon={Activity} tone="slate" />
        <StatCard label="失败" value={stats?.failed} icon={AlertCircle} tone="rose" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="text-xs text-slate-500">自动回复</div>
          <div className={cn('mt-2 text-sm font-medium', autoReplyOn ? 'text-emerald-300' : 'text-slate-400')}>
            {autoReplyOn ? '已开启' : '已关闭'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="text-xs text-slate-500">回复模式</div>
          <div className="mt-2 text-sm font-medium text-slate-200">{replyMode}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="text-xs text-slate-500">数据存储</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-200">
            <Database size={15} className="text-cyan-300" />
            SQLite 本地数据库
          </div>
        </div>
      </div>
    </div>
  )
}
