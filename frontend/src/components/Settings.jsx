import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import {
  createKeyword,
  createLLMConfig,
  deleteKeyword,
  deleteLLMConfig,
  getKBConfigs,
  getKeywords,
  getLLMConfigs,
  getSystemConfigs,
  updateSystemConfig,
} from '../lib/api'
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
        {checked && <CheckCircle2 size={13} />}
      </span>
    </button>
  )
}

function Section({ icon: Icon, title, desc, children }) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-medium text-slate-200">
        <Icon size={17} className="text-emerald-300" />
        {title}
      </div>
      {desc && <div className="px-5 pt-4 text-xs leading-5 text-slate-500">{desc}</div>}
      <div className="space-y-4 px-5 py-5">{children}</div>
    </section>
  )
}

function Row({ label, desc, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SmallButton({ children, onClick, disabled = false, className = '', title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      {children}
    </button>
  )
}

export default function Settings() {
  const [configs, setConfigs] = useState({})
  const [kbConfigs, setKbConfigs] = useState([])
  const [keywords, setKeywords] = useState([])
  const [llmConfigs, setLlmConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [status, setStatus] = useState('')
  const [keywordDraft, setKeywordDraft] = useState('')
  const [llmOpen, setLlmOpen] = useState(false)
  const [llmEditId, setLlmEditId] = useState(null)
  const [llmForm, setLlmForm] = useState({
    name: '',
    provider: 'zhipu',
    api_key: '',
    api_secret: '',
    api_url: '',
    model: '',
    app_id: '',
  })

  const loadData = async () => {
    try {
      const [systemData, keywordData, llmData, kbData] = await Promise.all([
        getSystemConfigs(),
        getKeywords(),
        getLLMConfigs(),
        getKBConfigs(),
      ])
      setConfigs(systemData || {})
      setKeywords(Array.isArray(keywordData) ? keywordData : [])
      setLlmConfigs(Array.isArray(llmData) ? llmData : [])
      setKbConfigs(Array.isArray(kbData) ? kbData : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const saveConfig = async (key, value) => {
    setSavingKey(key)
    try {
      await updateSystemConfig(key, value)
      setConfigs((current) => ({ ...current, [key]: value }))
    } finally {
      setSavingKey('')
    }
  }

  const handleAutoAccept = async (checked) => {
    const next = checked ? 'true' : 'false'
    setSavingKey('auto_accept_friend')
    try {
      await updateSystemConfig('auto_accept_friend', next)
      setConfigs((current) => ({ ...current, auto_accept_friend: next }))
      setStatus(checked ? '自动通过好友申请已开启' : '自动通过好友申请已关闭')
    } catch (error) {
      setStatus(`自动通过好友申请失败：${error?.response?.data?.detail || error.message || '未知错误'}`)
    } finally {
      setSavingKey('')
    }
  }

  const addKeyword = async () => {
    const value = keywordDraft.trim()
    if (!value) return
    setSavingKey('keyword')
    try {
      await createKeyword(value)
      setKeywordDraft('')
      await loadData()
    } finally {
      setSavingKey('')
    }
  }

  const startLlmEdit = (config) => {
    setLlmForm({
      name: config.name || '',
      provider: config.provider || 'zhipu',
      api_key: config.api_key || '',
      api_secret: config.api_secret || '',
      api_url: config.api_url || '',
      model: config.model || '',
      app_id: config.app_id || '',
    })
    setLlmEditId(config.id)
    setLlmOpen(true)
  }

  const saveLlm = async (event) => {
    event.preventDefault()
    if (!llmForm.name.trim() || !llmForm.api_key.trim()) return
    setSavingKey('llm')
    try {
      const payload = { ...llmForm, provider: llmForm.provider || 'zhipu' }
      await createLLMConfig(payload)
      setLlmOpen(false)
      setLlmEditId(null)
      setLlmForm({
        name: '',
        provider: 'zhipu',
        api_key: '',
        api_secret: '',
        api_url: '',
        model: '',
        app_id: '',
      })
      await loadData()
    } finally {
      setSavingKey('')
    }
  }

  const activeKbConfigs = kbConfigs.filter((item) => item?.is_active)

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
        <h1 className="text-2xl font-semibold">自动化规则</h1>
        <p className="mt-2 text-sm text-slate-500">
          控制自动回复、白名单、上下文记忆，以及默认大模型和知识库的路由关系。
        </p>
        {status && <p className="mt-2 text-sm text-slate-400">{status}</p>}
      </div>

      <Section icon={Sparkles} title="自动回复" desc="收到微信消息后，自动路由到知识库或默认大模型。">
        <Row label="启用自动回复" desc="打开后才会处理收到的新消息。">
          <Toggle
            checked={configs.auto_reply_enabled === 'true'}
            onChange={(checked) => saveConfig('auto_reply_enabled', checked ? 'true' : 'false')}
            disabled={savingKey === 'auto_reply_enabled'}
          />
        </Row>
        <Row label="回复模式" desc="全部好友、关键词触发，或只回复白名单好友。">
          <select
            value={configs.reply_mode || 'all'}
            onChange={(event) => saveConfig('reply_mode', event.target.value)}
            className="input-field w-48 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all" className="bg-slate-950">全部好友</option>
            <option value="keyword" className="bg-slate-950">关键词触发</option>
            <option value="whitelist" className="bg-slate-950">白名单好友</option>
          </select>
        </Row>
        <Row label="默认知识库" desc="选中后，咨询类消息优先使用这里；不选则直接走默认大模型。">
          <select
            value={configs.auto_reply_kb_id || ''}
            onChange={(event) => saveConfig('auto_reply_kb_id', event.target.value)}
            className="input-field w-56 rounded-lg px-3 py-2 text-sm"
          >
            <option value="" className="bg-slate-950">不使用知识库</option>
            {activeKbConfigs.map((item) => (
              <option key={item.id} value={String(item.id)} className="bg-slate-950">
                {item.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="回复前缀" desc="给 AI 回复统一加一段文字。">
          <input
            value={configs.auto_reply_prefix || ''}
            onChange={(event) => saveConfig('auto_reply_prefix', event.target.value)}
            className="input-field w-72 rounded-lg px-3 py-2 text-sm"
            placeholder="可留空"
          />
        </Row>
        <Row label="意图识别" desc="开启后，系统会粗分咨询和闲聊。">
          <Toggle
            checked={configs.intent_mode === 'true'}
            onChange={(checked) => saveConfig('intent_mode', checked ? 'true' : 'false')}
            disabled={savingKey === 'intent_mode'}
          />
        </Row>
      </Section>

      <Section icon={ShieldCheck} title="好友自动通过" desc="这里保持只处理好友申请，不再混入转账相关开关。">
        <Row label="自动通过好友申请" desc="需要 exe 推送或手动调用 /api/friend-request。">
          <Toggle
            checked={configs.auto_accept_friend === 'true'}
            onChange={handleAutoAccept}
            disabled={savingKey === 'auto_accept_friend'}
          />
        </Row>
        <Row label="欢迎语" desc="通过好友后自动发送。">
          <input
            value={configs.auto_accept_welcome || ''}
            onChange={(event) => saveConfig('auto_accept_welcome', event.target.value)}
            className="input-field w-72 rounded-lg px-3 py-2 text-sm"
            placeholder="你好，很高兴认识你"
          />
        </Row>
      </Section>

      <Section icon={KeyRound} title="关键词触发" desc="仅当回复模式为关键词触发时生效。">
        <div className="flex gap-2">
          <input
            value={keywordDraft}
            onChange={(event) => setKeywordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                addKeyword()
              }
            }}
            placeholder="例如：客服、价格、尺码"
            className="input-field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={addKeyword} className="btn-primary rounded-lg px-3 py-2 text-slate-950">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {keywords.length === 0 ? (
            <span className="text-xs text-slate-600">暂无关键词</span>
          ) : (
            keywords.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200"
              >
                {item.keyword}
                <button
                  onClick={async () => {
                    await deleteKeyword(item.id)
                    await loadData()
                  }}
                  className="text-emerald-200/70 hover:text-rose-300"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))
          )}
        </div>
      </Section>

      <Section icon={Sparkles} title="默认大模型" desc="当自动回复没有选择知识库时，会直接使用默认大模型配置。">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">当前保留原有大模型配置列表编辑入口。</div>
          <button
            onClick={() => setLlmOpen((current) => !current)}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-950"
          >
            <Plus size={16} />
            新增
          </button>
        </div>
        {llmOpen && (
          <form onSubmit={saveLlm} className="space-y-4 rounded-lg border border-white/10 bg-black/10 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">配置名称 *</span>
                <input
                  value={llmForm.name}
                  onChange={(event) => setLlmForm((current) => ({ ...current, name: event.target.value }))}
                  className="input-field w-full rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">模型</span>
                <input
                  value={llmForm.model}
                  onChange={(event) => setLlmForm((current) => ({ ...current, model: event.target.value }))}
                  className="input-field w-full rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">API Key *</span>
                <input
                  type="password"
                  value={llmForm.api_key}
                  onChange={(event) => setLlmForm((current) => ({ ...current, api_key: event.target.value }))}
                  className="input-field w-full rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">API Secret</span>
                <input
                  type="password"
                  value={llmForm.api_secret}
                  onChange={(event) => setLlmForm((current) => ({ ...current, api_secret: event.target.value }))}
                  className="input-field w-full rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">API URL</span>
                <input
                  value={llmForm.api_url}
                  onChange={(event) => setLlmForm((current) => ({ ...current, api_url: event.target.value }))}
                  className="input-field w-full rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">APPID</span>
                <input
                  value={llmForm.app_id}
                  onChange={(event) => setLlmForm((current) => ({ ...current, app_id: event.target.value }))}
                  className="input-field w-full rounded-lg px-3 py-2 font-mono text-sm"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={savingKey === 'llm' || !llmForm.name.trim() || !llmForm.api_key.trim()}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-950"
              >
                {savingKey === 'llm' ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {llmEditId ? '更新配置' : '保存配置'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLlmOpen(false)
                  setLlmEditId(null)
                }}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.05]"
              >
                取消
              </button>
            </div>
          </form>
        )}
        <div className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-black/10">
          {llmConfigs.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-600">还没有默认大模型配置</div>
          ) : (
            llmConfigs.map((item) => (
              <div key={item.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-100">{item.name}</span>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200">
                      {item.provider}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="font-mono">Model: {item.model || '-'}</span>
                    {item.api_url && <span className="truncate">URL: {item.api_url}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <SmallButton onClick={() => startLlmEdit(item)} title="编辑">
                    <CheckCircle2 size={15} />
                  </SmallButton>
                  <SmallButton
                    onClick={async () => {
                      await deleteLLMConfig(item.id)
                      await loadData()
                    }}
                    className="text-rose-300 hover:bg-rose-400/10"
                    title="删除"
                  >
                    <Trash2 size={15} />
                  </SmallButton>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  )
}
