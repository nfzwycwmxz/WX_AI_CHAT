import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Shield, Trash2 } from 'lucide-react'
import { addFriendAccess, getFriendAccess, getWxContacts, removeFriendAccess } from '../lib/api'

export default function FriendAccessConfig() {
  const [friends, setFriends] = useState([])
  const [contacts, setContacts] = useState([])
  const [search, setSearch] = useState('')
  const [manualWxid, setManualWxid] = useState('')
  const [manualRemark, setManualRemark] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      const [friendData, contactData] = await Promise.allSettled([getFriendAccess(), getWxContacts()])
      if (friendData.status === 'fulfilled') setFriends(Array.isArray(friendData.value) ? friendData.value : [])
      if (contactData.status === 'fulfilled') {
        const data = contactData.value
        setSourceError(data.error || '')
        if (!data.error || (data.contacts && data.contacts.length)) {
          setContacts(Array.isArray(data.contacts) ? data.contacts : [])
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 20000)
    return () => clearInterval(timer)
  }, [])

  const added = useMemo(() => new Set(friends.map((friend) => friend.wxid)), [friends])
  const availableContacts = contacts
    .filter((contact) => !added.has(contact.wxid))
    .filter((contact) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [contact.nickname, contact.remarks, contact.wxid].some((item) => String(item || '').toLowerCase().includes(q))
    })

  const add = async (contact) => {
    await addFriendAccess(contact.wxid, contact.remarks || contact.nickname || contact.wxid)
    fetchData()
  }

  const addManual = async () => {
    if (!manualWxid.trim()) return
    if (added.has(manualWxid.trim())) {
      alert('该好友已在白名单中')
      return
    }
    await addFriendAccess(manualWxid.trim(), manualRemark.trim() || manualWxid.trim())
    setManualWxid('')
    setManualRemark('')
    fetchData()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Shield size={22} className="text-emerald-300" />
          白名单
        </h1>
        <p className="mt-2 text-sm text-slate-500">当回复模式设置为“白名单好友”时，只有这里的好友会触发 AI 回复。</p>
      </div>

      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <div className="mb-3 text-sm font-medium text-slate-300">手动添加好友</div>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={manualWxid}
            onChange={(event) => setManualWxid(event.target.value)}
            placeholder="好友 wxid"
            className="input-field rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={manualRemark}
            onChange={(event) => setManualRemark(event.target.value)}
            placeholder="备注，可选"
            className="input-field rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={addManual} className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-950">
            <Plus size={15} />
            添加
          </button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="mb-3 text-sm font-medium text-slate-300">可添加好友</div>
          {sourceError && (
            <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              pywxrobot 通讯录接口返回异常或为空，当前显示本地消息缓存。详情：{sourceError}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索昵称、备注或 wxid"
                className="input-field w-full rounded-lg py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <button
              onClick={fetchData}
              className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]"
              title="刷新好友列表"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <RefreshCw size={18} className="animate-spin text-emerald-300" />
              </div>
            ) : availableContacts.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-600">
                {contacts.length === 0 ? '未从 pywxrobot 获取到好友列表' : '没有可添加的好友'}
              </div>
            ) : (
              <div className="space-y-2">
                {availableContacts.map((contact) => (
                  <button
                    key={contact.wxid}
                    onClick={() => add(contact)}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-3 text-left hover:bg-white/[0.05]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-400 text-sm font-semibold text-slate-950">
                      {(contact.remarks || contact.nickname || '?')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{contact.remarks || contact.nickname || contact.wxid}</div>
                      <div className="truncate font-mono text-[11px] text-slate-600">{contact.wxid}</div>
                    </div>
                    <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">添加</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="mb-3 text-sm font-medium text-slate-300">已加入白名单</div>
          {friends.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-600">白名单为空</div>
          ) : (
            <div className="space-y-2">
              {friends.map((friend) => (
                <div key={friend.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400 text-sm font-semibold text-slate-950">
                    {(friend.remark || '?')[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{friend.remark || friend.wxid}</div>
                    <div className="truncate font-mono text-[11px] text-slate-600">{friend.wxid}</div>
                  </div>
                  <button
                    onClick={async () => {
                      await removeFriendAccess(friend.id)
                      fetchData()
                    }}
                    className="rounded-lg border border-white/10 p-2 text-rose-300 hover:bg-rose-400/10"
                    title="移除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
