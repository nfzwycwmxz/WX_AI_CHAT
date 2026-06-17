import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react'
import { createGroupConfig, deleteGroupConfig, getGroupConfigs, getWxRooms } from '../lib/api'

export default function GroupChatConfig() {
  const [groups, setGroups] = useState([])
  const [rooms, setRooms] = useState([])
  const [search, setSearch] = useState('')
  const [manualRoomid, setManualRoomid] = useState('')
  const [manualName, setManualName] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      const [groupData, roomData] = await Promise.allSettled([getGroupConfigs(), getWxRooms()])
      if (groupData.status === 'fulfilled') setGroups(Array.isArray(groupData.value) ? groupData.value : [])
      if (roomData.status === 'fulfilled') {
        const data = roomData.value
        setSourceError(data.error || '')
        if (!data.error || (data.rooms && data.rooms.length)) {
          setRooms(Array.isArray(data.rooms) ? data.rooms : [])
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

  const added = useMemo(() => new Set(groups.map((group) => group.roomid)), [groups])
  const availableRooms = rooms
    .filter((room) => !added.has(room.roomid))
    .filter((room) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [room.name, room.roomid].some((item) => String(item || '').toLowerCase().includes(q))
    })

  const addRoom = async (room) => {
    await createGroupConfig({ roomid: room.roomid, name: room.name || room.roomid, enabled: true, reply_mode: 'mention' })
    fetchData()
  }

  const addManual = async () => {
    if (!manualRoomid.trim()) return
    if (added.has(manualRoomid.trim())) {
      alert('该群聊已在启用列表中')
      return
    }
    await createGroupConfig({
      roomid: manualRoomid.trim(),
      name: manualName.trim() || manualRoomid.trim(),
      enabled: true,
      reply_mode: 'mention',
    })
    setManualRoomid('')
    setManualName('')
    fetchData()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Users size={22} className="text-emerald-300" />
          群聊管理
        </h1>
        <p className="mt-2 text-sm text-slate-500">指定哪些群聊允许 AI 回复。默认只在群聊里 @机器人 时触发。</p>
      </div>

      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <div className="mb-3 text-sm font-medium text-slate-300">手动添加群聊</div>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={manualRoomid}
            onChange={(event) => setManualRoomid(event.target.value)}
            placeholder="群 roomid，通常以 @chatroom 结尾"
            className="input-field rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={manualName}
            onChange={(event) => setManualName(event.target.value)}
            placeholder="群名称，可选"
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
          <div className="mb-3 text-sm font-medium text-slate-300">可添加群聊</div>
          {sourceError && (
            <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              pywxrobot 群聊接口返回异常或为空，当前显示本地消息缓存。详情：{sourceError}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索群名或 roomid"
                className="input-field w-full rounded-lg py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <button
              onClick={fetchData}
              className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]"
              title="刷新群聊列表"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <RefreshCw size={18} className="animate-spin text-emerald-300" />
              </div>
            ) : availableRooms.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-600">
                {rooms.length === 0 ? '未从 pywxrobot 获取到群聊列表' : '没有可添加的群聊'}
              </div>
            ) : (
              <div className="space-y-2">
                {availableRooms.map((room) => (
                  <button
                    key={room.roomid}
                    onClick={() => addRoom(room)}
                    className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-3 text-left hover:bg-white/[0.05]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400 text-sm font-semibold text-slate-950">
                      {(room.name || '群')[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{room.name || room.roomid}</div>
                      <div className="truncate font-mono text-[11px] text-slate-600">{room.roomid}</div>
                    </div>
                    <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">添加</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="mb-3 text-sm font-medium text-slate-300">已启用群聊</div>
          {groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-600">暂无群聊配置</div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-400 text-sm font-semibold text-slate-950">
                    {(group.name || '群')[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{group.name || group.roomid}</div>
                    <div className="truncate font-mono text-[11px] text-slate-600">{group.roomid}</div>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
                    @触发
                  </span>
                  <button
                    onClick={async () => {
                      await deleteGroupConfig(group.id)
                      fetchData()
                    }}
                    className="rounded-lg border border-white/10 p-2 text-rose-300 hover:bg-rose-400/10"
                    title="删除"
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
