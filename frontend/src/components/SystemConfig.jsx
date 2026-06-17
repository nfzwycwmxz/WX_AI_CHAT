import { useEffect, useState } from 'react'
import { Check, MessageCircle, RefreshCw, Save } from 'lucide-react'
import { enableDontRevoke, getSystemConfigs, updateSystemConfig } from '../lib/api'
import { cn } from '../lib/utils'

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        'flex h-8 w-16 items-center rounded-full border px-1 transition-colors',
        checked ? 'justify-end border-emerald-400/30 bg-emerald-400/20' : 'justify-start border-white/10 bg-white/[0.05]',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full',
          checked ? 'bg-emerald-300 text-slate-950' : 'bg-slate-600 text-slate-200',
        )}
      >
        {checked && <Check size={13} />}
      </span>
    </button>
  )
}

function InlineSave({ value, placeholder, saving, onSave, width = 'w-72' }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        className={cn('input-field rounded-lg px-3 py-2 text-sm', width)}
      />
      <button onClick={() => onSave(draft)} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/[0.05]">
        {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
      </button>
    </div>
  )
}

export default function SystemConfig() {
  const [configs, setConfigs] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [status, setStatus] = useState('')

  const fetchData = async () => {
    try {
      const data = await getSystemConfigs()
      setConfigs(data || {})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const save = async (key, value) => {
    setSavingKey(key)
    try {
      await updateSystemConfig(key, value)
      setConfigs((current) => ({ ...current, [key]: value }))
    } finally {
      setSavingKey('')
    }
  }

  const toggleDontRevoke = async (value) => {
    const nextValue = value ? 'true' : 'false'
    const previousValue = configs.dontrevoke_enabled === 'true' ? 'true' : 'false'
    setSavingKey('dontrevoke_enabled')
    setStatus('')
    try {
      await updateSystemConfig('dontrevoke_enabled', nextValue)
      setConfigs((current) => ({ ...current, dontrevoke_enabled: nextValue }))
      if (value) {
        enableDontRevoke(true).catch((error) => {
          setStatus(`消息防撤回已开启；pywxrobot 触发失败：${error?.response?.data?.detail || error.message || '未知错误'}`)
        })
      }
      setStatus(value ? '消息防撤回已开启' : '消息防撤回已关闭')
    } catch (error) {
      setConfigs((current) => ({ ...current, dontrevoke_enabled: previousValue }))
      setStatus(`消息防撤回操作失败：${error?.response?.data?.detail || error.message || '未知错误'}`)
    } finally {
      setSavingKey('')
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw size={22} className="animate-spin text-emerald-300" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">系统设置</h1>
        <p className="mt-2 text-sm text-slate-500">pywxrobot 连接配置</p>
        {status && <p className="mt-2 text-sm text-slate-400">{status}</p>}
      </div>

      <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-medium text-slate-200">
          <MessageCircle size={17} className="text-emerald-300" />
          连接设置
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm text-slate-200">pywxrobot 端口</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                当前 exe 的本地端口，默认 23235。修改后请同步重启后端或更新环境变量。
              </div>
            </div>
            <div className="shrink-0">
              <InlineSave
                value={configs.exe_port || '23235'}
                placeholder="23235"
                saving={savingKey === 'exe_port'}
                onSave={(value) => save('exe_port', value)}
                width="w-32"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-medium text-slate-200">
          <MessageCircle size={17} className="text-emerald-300" />
          消息增强
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm text-slate-200">消息防撤回</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                开启后会调用 pywxrobot 的 <span className="font-mono">/other/dontrevoke</span> 接口。关闭仅保存本地状态。
              </div>
            </div>
            <div className="shrink-0">
              <Toggle
                checked={configs.dontrevoke_enabled === 'true'}
                onChange={toggleDontRevoke}
                disabled={savingKey === 'dontrevoke_enabled'}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
