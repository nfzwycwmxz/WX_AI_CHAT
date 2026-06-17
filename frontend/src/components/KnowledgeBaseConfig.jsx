import { useEffect, useMemo, useState } from 'react'
import { Check, Database, Edit2, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { createKBConfig, deleteKBConfig, getKBConfigs, updateKBConfig } from '../lib/api'
import { cn } from '../lib/utils'

const providers = [
  { value: 'zhipu', label: '智谱 Zhipu', desc: '当前主力：通过 knowledge_id 调用智谱知识库', defaultModel: 'glm-4-flash' },
  { value: 'dify', label: 'Dify', desc: '预留：Dify Chat API', defaultModel: '' },
  { value: 'fastgpt', label: 'FastGPT', desc: '预留：OpenAI 兼容 Chat Completions', defaultModel: '' },
  { value: 'xunfei', label: '讯飞星火', desc: '扩展：需要 API Secret', defaultModel: 'generalv3.5' },
]

const emptyForm = {
  name: '',
  provider: 'zhipu',
  api_key: '',
  api_secret: '',
  api_url: '',
  kb_id: '',
  model: providers[0].defaultModel,
  app_id: '',
}

export default function KnowledgeBaseConfig() {
  const [configs, setConfigs] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.value === form.provider) || providers[0],
    [form.provider],
  )

  const fetchConfigs = async () => {
    try {
      const data = await getKBConfigs()
      setConfigs(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  const reset = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(configs.length === 0)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!form.name.trim() || !form.api_key.trim()) return
    if (form.provider === 'zhipu' && !form.kb_id.trim()) return
    setSaving(true)
    try {
      if (editingId) await updateKBConfig(editingId, form)
      else await createKBConfig(form)
      await fetchConfigs()
      reset()
    } finally {
      setSaving(false)
    }
  }

  const edit = (config) => {
    setForm({
      name: config.name || '',
      provider: config.provider || 'zhipu',
      api_key: config.api_key || '',
      api_secret: config.api_secret || '',
      api_url: config.api_url || '',
      kb_id: config.kb_id || '',
      model: config.model || '',
      app_id: config.app_id || '',
    })
    setEditingId(config.id)
    setShowForm(true)
  }

  const remove = async (id) => {
    if (!window.confirm('确定删除这个知识库配置吗？')) return
    await deleteKBConfig(id)
    await fetchConfigs()
  }

  const toggle = async (config) => {
    await updateKBConfig(config.id, { is_active: config.is_active ? 0 : 1 })
    await fetchConfigs()
  }

  const setProvider = (providerValue) => {
    const provider = providers.find((item) => item.value === providerValue)
    setForm((current) => ({
      ...current,
      provider: providerValue,
      model: current.provider !== providerValue ? (provider?.defaultModel || '') : current.model,
    }))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Database size={22} className="text-emerald-300" />
            知识库配置
          </h1>
          <p className="mt-2 text-sm text-slate-500">配置知识库后，AI 自动回复将基于知识库内容回答，支持智谱、讯飞星火、FastGPT 等平台。</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-950">
            <Plus size={16} />
            新增知识库
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">{editingId ? '编辑配置' : '新增配置'}</h2>
            {configs.length > 0 && (
              <button type="button" onClick={reset} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="mb-4 grid gap-2 md:grid-cols-5">
            {providers.map((provider) => (
              <button
                type="button"
                key={provider.value}
                onClick={() => setProvider(provider.value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  form.provider === provider.value
                    ? 'border-emerald-400/30 bg-emerald-400/10'
                    : 'border-white/10 bg-black/10 hover:bg-white/[0.04]',
                )}
              >
                <div className="text-sm font-medium text-slate-200">{provider.label}</div>
                <div className="mt-1 text-[11px] leading-4 text-slate-500">{provider.desc}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">配置名称 *</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如：售前客服知识库"
                className="input-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">知识库 ID {(form.provider === 'zhipu' || form.provider === 'xunfei') ? '*' : ''}</span>
              <input
                value={form.kb_id}
                onChange={(event) => setForm({ ...form, kb_id: event.target.value })}
                placeholder={{ zhipu: '智谱 knowledge_id', xunfei: '讯飞知识库 ID', fastgpt: 'FastGPT 知识库 ID' }[form.provider] || '知识库 ID'}
                className="input-field w-full rounded-lg px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">API Key *</span>
              <input
                type="password"
                value={form.api_key}
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
                placeholder="平台 API Key"
                className="input-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">模型</span>
              <input
                value={form.model}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
                placeholder={selectedProvider.defaultModel || '可选'}
                className="input-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </label>
            {form.provider === 'xunfei' && (
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">API Secret *</span>
                <input
                  type="password"
                  value={form.api_secret}
                  onChange={(event) => setForm({ ...form, api_secret: event.target.value })}
                  placeholder="讯飞等平台需要"
                  className="input-field w-full rounded-lg px-3 py-2 text-sm"
                />
              </label>
            )}
            {form.provider === 'xunfei' && (
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">APPID *</span>
                <input
                  value={form.app_id}
                  onChange={(event) => setForm({ ...form, app_id: event.target.value })}
                  placeholder="讯飞开放平台的应用 APPID"
                  className="input-field w-full rounded-lg px-3 py-2 font-mono text-sm"
                />
              </label>
            )}
            <label className={cn('block', form.provider !== 'xunfei' && 'md:col-span-2')}>
              <span className="mb-1 block text-xs text-slate-500">API URL</span>
              <input
                value={form.api_url}
                onChange={(event) => setForm({ ...form, api_url: event.target.value })}
                placeholder="不填则使用平台默认地址"
                className="input-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !form.name.trim() || !form.api_key.trim() || (form.provider === 'zhipu' && !form.kb_id.trim()) || (form.provider === 'xunfei' && (!form.kb_id.trim() || !form.app_id.trim() || !form.api_secret.trim()))}
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-950"
            >
              {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
              {editingId ? '更新配置' : '保存配置'}
            </button>
            <span className="text-xs text-slate-600">当前平台：{selectedProvider.label}</span>
          </div>
        </form>
      )}

      <section className="rounded-lg border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-300">已配置知识库</div>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw size={18} className="animate-spin text-emerald-300" />
          </div>
        ) : configs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-600">还没有知识库配置，点击上方新增添加一个。</div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {configs.map((config) => {
              const provider = providers.find((item) => item.value === config.provider)
              return (
                <div key={config.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-100">{config.name}</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                          config.is_active
                            ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.04] text-slate-500',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', config.is_active ? 'bg-emerald-300' : 'bg-slate-500')} />
                        {config.is_active ? '启用' : '禁用'}
                      </span>
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200">
                        {provider?.label || config.provider}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="font-mono">KB: {config.kb_id || '-'}</span>
                      <span>模型: {config.model || '-'}</span>
                      {config.api_url && <span className="truncate">URL: {config.api_url}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => toggle(config)} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]" title={config.is_active ? '禁用' : '启用'}>
                      {config.is_active ? <X size={15} /> : <Check size={15} />}
                    </button>
                    <button onClick={() => edit(config)} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]" title="编辑">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => remove(config.id)} className="rounded-lg border border-white/10 p-2 text-rose-300 hover:bg-rose-400/10" title="删除">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
