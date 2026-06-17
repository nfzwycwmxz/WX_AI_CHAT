import { useEffect, useState } from 'react'
import { Check, Edit2, Globe, Plus, RefreshCw, Save, Shield, Trash2, X } from 'lucide-react'
import { createProxyConfig, deleteProxyConfig, getProxyConfigs, updateProxyConfig } from '../lib/api'
import { cn } from '../lib/utils'

const emptyForm = { proxy_url: '', proxy_username: '', proxy_password: '' }

export default function ProxyConfig() {
  const [configs, setConfigs] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchData = async () => {
    try {
      const data = await getProxyConfigs()
      setConfigs(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const reset = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(false)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!form.proxy_url.trim()) return
    setSaving(true)
    try {
      if (editingId) await updateProxyConfig(editingId, form)
      else await createProxyConfig(form)
      await fetchData()
      reset()
    } finally {
      setSaving(false)
    }
  }

  const edit = (config) => {
    setForm({
      proxy_url: config.proxy_url || '',
      proxy_username: config.proxy_username || '',
      proxy_password: config.proxy_password || '',
    })
    setEditingId(config.id)
    setShowForm(true)
  }

  const remove = async (id) => {
    if (!window.confirm('确定删除这个代理配置吗？')) return
    await deleteProxyConfig(id)
    await fetchData()
  }

  const toggle = async (config) => {
    await updateProxyConfig(config.id, { is_active: config.is_active ? 0 : 1 })
    await fetchData()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Globe size={22} className="text-emerald-300" />
            代理设置
          </h1>
          <p className="mt-2 text-sm text-slate-500">用于知识库 API 请求。发送微信消息到本地 exe 不走代理。</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-950">
            <Plus size={16} />
            添加代理
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">{editingId ? '编辑代理' : '新增代理'}</h2>
            <button type="button" onClick={reset} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]">
              <X size={15} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block md:col-span-3">
              <span className="mb-1 block text-xs text-slate-500">代理地址 *</span>
              <input
                value={form.proxy_url}
                onChange={(event) => setForm({ ...form, proxy_url: event.target.value })}
                placeholder="例如：http://127.0.0.1:7890"
                className="input-field w-full rounded-lg px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">用户名</span>
              <input
                value={form.proxy_username}
                onChange={(event) => setForm({ ...form, proxy_username: event.target.value })}
                placeholder="可选"
                className="input-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">密码</span>
              <input
                type="password"
                value={form.proxy_password}
                onChange={(event) => setForm({ ...form, proxy_password: event.target.value })}
                placeholder="可选"
                className="input-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={saving || !form.proxy_url.trim()}
            className="btn-primary mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-slate-950"
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
            保存代理
          </button>
        </form>
      )}

      <section className="rounded-lg border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-300">代理列表</div>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw size={18} className="animate-spin text-emerald-300" />
          </div>
        ) : configs.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-600">
            <Shield size={34} className="mx-auto mb-3 opacity-40" />
            暂无代理配置
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {configs.map((config) => (
              <div key={config.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <code className="break-all font-mono text-sm text-emerald-200">{config.proxy_url}</code>
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
                  </div>
                  <div className="text-xs text-slate-500">认证：{config.proxy_username ? '已设置' : '无'}</div>
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
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
