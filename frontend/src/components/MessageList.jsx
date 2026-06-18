import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  Info,
  Image,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Search,
  Send,
  SkipForward,
  Smile,
  Trash2,
  User,
  Video,
  XCircle,
} from 'lucide-react'
import {
  cacheContact,
  clearMessagesBySender,
  getCachedWxAccounts,
  getContactDetail,
  getContacts,
  getConversations,
  getMessagesBySender,
  getWxAccounts,
  markConversationRead,
  resetAllMessages,
  sendTestMessage,
} from '../lib/api'
import { cn } from '../lib/utils'

const statusMap = {
  sent: { label: '已回复', icon: CheckCircle2, className: 'text-emerald-300' },
  pending: { label: '待处理', icon: Clock, className: 'text-amber-300' },
  failed: { label: '失败', icon: XCircle, className: 'text-rose-300' },
  skipped: { label: '已跳过', icon: SkipForward, className: 'text-slate-500' },
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(Number(value))
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function stripMessage(text) {
  if (!text) return ''
  let s = String(text)
  const title = s.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
  if (title?.[1]?.trim()) return title[1].trim()
  const content = s.match(/<content>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/)
  if (content?.[1]?.trim()) return content[1].trim()
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  s = s.replace(/<\/?[^>]+>/g, ' ')
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  return s.replace(/\s+/g, ' ').trim()
}

function decodeEntity(text = '') {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function readXmlTagAttrs(text = '', tagName) {
  const tag = String(text).match(new RegExp(`<${tagName}\\b([^>]*)>`, 'i'))
  if (!tag) return {}
  const attrs = {}
  tag[1].replace(/([\\w:-]+)=["']([^"']*)["']/g, (_, key, value) => {
    attrs[key] = decodeEntity(value)
    return ''
  })
  return attrs
}

function readXmlText(text = '', tagName) {
  const match = String(text).match(new RegExp(`<${tagName}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tagName}>`, 'i'))
  return match?.[1] ? decodeEntity(match[1]).trim() : ''
}

function extractUrlFromText(text = '') {
  const match = String(text).match(/https?:\/\/[^\s"'<>]+/i)
  return match ? decodeEntity(match[0]) : ''
}

function buildMessageImageUrl(msgid, variant = 'thumb') {
  if (!msgid) return ''
  const search = new URLSearchParams({ variant })
  return `/api/messages/image/${encodeURIComponent(msgid)}?${search.toString()}`
}

function getImageMessagePayload(message) {
  const content = message?.content || ''
  const attrs = readXmlTagAttrs(content, 'img')
  const fallbackUrl = attrs.url || extractUrlFromText(content)
  return {
    thumbUrl: buildMessageImageUrl(message?.msgid, 'thumb') || fallbackUrl,
    fullUrl: buildMessageImageUrl(message?.msgid, 'full') || fallbackUrl,
    meta: [
      attrs.cdnthumbwidth && attrs.cdnthumbheight ? `${attrs.cdnthumbwidth}x${attrs.cdnthumbheight}` : '',
      attrs.length ? `${attrs.length} B` : '',
      attrs.md5 ? `MD5 ${attrs.md5}` : '',
    ].filter(Boolean).join(' · '),
  }
}

function parseMessageContent(message) {
  const content = message.content || ''
  const type = Number(message.msg_type)

  if (type === 3) {
    const attrs = readXmlTagAttrs(content, 'img')
    const image = getImageMessagePayload(message)
    return {
      kind: 'image',
      label: '图片',
      url: image.thumbUrl,
      thumbUrl: image.thumbUrl,
      fullUrl: image.fullUrl,
      meta: image.meta,
      text: stripMessage(content),
    }
  }

  if (type === 47) {
    const attrs = readXmlTagAttrs(content, 'emoji')
    const url = attrs.cdnurl || attrs.thumburl || attrs.externurl || attrs.url || extractUrlFromText(content)
    return {
      kind: 'emoji',
      label: '表情包',
      url,
      meta: attrs.md5 ? `MD5 ${attrs.md5}` : '',
      text: readXmlText(content, 'des') || stripMessage(content),
    }
  }

  if (type === 34) {
    return { kind: 'voice', label: '语音', text: message.voice || stripMessage(content) }
  }

  if (type === 43) {
    return { kind: 'video', label: '视频', text: stripMessage(content) }
  }

  if (type === 49 || content.includes('<appmsg')) {
    return {
      kind: 'card',
      label: '卡片消息',
      title: readXmlText(content, 'title') || '卡片消息',
      desc: readXmlText(content, 'des') || readXmlText(content, 'digest') || '',
      url: readXmlText(content, 'url') || extractUrlFromText(content),
    }
  }

  return { kind: 'text', text: stripMessage(content) }
}

function messagePreview(message) {
  const parsed = parseMessageContent(message)
  if (parsed.kind === 'text') return parsed.text || '暂无消息内容'
  if (parsed.kind === 'card') return `[${parsed.label}] ${parsed.title || ''}`.trim()
  return `[${parsed.label}] ${parsed.text || ''}`.trim()
}

function avatarTone(id = '') {
  const tones = [
    'bg-emerald-500 text-slate-950',
    'bg-cyan-500 text-slate-950',
    'bg-violet-500 text-white',
    'bg-rose-500 text-white',
    'bg-amber-400 text-slate-950',
  ]
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return tones[Math.abs(hash) % tones.length]
}

function displayName(contact) {
  return contact?.remarks || contact?.nickname || contact?.nick_name || contact?.wxid || contact?.sender || '未知好友'
}

function isGroupWxid(wxid = '') {
  return String(wxid || '').includes('@chatroom')
}

function groupSpeakerName(message) {
  return message?.nick_name || message?.nickname || message?.username || message?.room_sender || message?.sender || '群成员'
}

function stripGroupSpeakerPrefix(text, message) {
  const value = String(text || '')
  const speaker = message?.room_sender || message?.sender
  if (!speaker || !value.startsWith(`${speaker}:`)) return value
  return value.slice(String(speaker).length + 1).replace(/^\s+/, '')
}

function sameList(prev = [], next = []) {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i += 1) {
    if (JSON.stringify(prev[i]) !== JSON.stringify(next[i])) return false
  }
  return true
}

function MediaShell({ icon: Icon, title, children, meta, fromSelf }) {
  return (
    <div className="min-w-[180px] max-w-sm">
      <div className="mb-2 flex items-center gap-2 text-xs opacity-80">
        <Icon size={15} />
        <span>{title}</span>
      </div>
      {children}
      {meta && <div className={cn('mt-2 break-all text-[10px]', fromSelf ? 'text-slate-800/70' : 'text-slate-500')}>{meta}</div>}
    </div>
  )
}

function MessageImage({ parsed }) {
  const primarySrc = parsed.thumbUrl || parsed.url || ''
  const fallbackSrc = parsed.fullUrl || parsed.url || ''
  const [src, setSrc] = useState(primarySrc)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSrc(primarySrc)
    setFailed(false)
  }, [primarySrc, fallbackSrc])

  if (!primarySrc) {
    return (
      <div className="rounded-md border border-dashed border-current/20 px-3 py-6 text-center text-xs opacity-70">
        鍥剧墖璧勬簮鏈笅杞芥垨闇€瑕侀€氳繃寰俊瀹㈡埛绔В瀵?
      </div>
    )
  }

  return failed ? (
    <div className="rounded-md border border-dashed border-current/20 px-3 py-6 text-center text-xs opacity-70">
      鍥剧墖鍔犺浇澶辫触锛屽彲灏濊瘯鍦ㄥ井淇″鎴风涓煡鐪嬪師鍥?
    </div>
  ) : (
    <a href={fallbackSrc || primarySrc} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-black/10 bg-black/20">
      <img
        src={src}
        alt="寰俊鍥剧墖"
        className="max-h-64 max-w-full object-contain"
        loading="lazy"
        onError={() => {
          if (src !== fallbackSrc && fallbackSrc) {
            setSrc(fallbackSrc)
            return
          }
          setFailed(true)
        }}
      />
    </a>
  )
}

function MessageBody({ message, fromSelf }) {
  const parsed = parseMessageContent(message)
  if (parsed.kind === 'image') {
    return (
      <MediaShell icon={Image} title="图片" meta={parsed.meta || ''} fromSelf={fromSelf}>
        <MessageImage parsed={parsed} />
      </MediaShell>
    )
  }

  if (parsed.kind === 'emoji') {
    return (
      <MediaShell icon={Smile} title="表情包" meta={parsed.url ? '' : parsed.meta || '未解析到表情地址'} fromSelf={fromSelf}>
        {parsed.url ? (
          <a href={parsed.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-black/10 bg-black/20 p-2">
            <img src={parsed.url} alt="微信表情包" className="max-h-40 max-w-full object-contain" loading="lazy" />
          </a>
        ) : (
          <div className="rounded-md border border-dashed border-current/20 px-3 py-5 text-center text-xs opacity-70">
            表情资源未下载或需要微信 CDN 授权
          </div>
        )}
      </MediaShell>
    )
  }

  if (parsed.kind === 'voice') {
    return (
      <MediaShell icon={Mic} title="语音" fromSelf={fromSelf}>
        <div className="text-xs opacity-80">{parsed.text || '收到一条语音消息'}</div>
      </MediaShell>
    )
  }

  if (parsed.kind === 'video') {
    return (
      <MediaShell icon={Video} title="视频" fromSelf={fromSelf}>
        <div className="text-xs opacity-80">{parsed.text || '收到一条视频消息'}</div>
      </MediaShell>
    )
  }

  if (parsed.kind === 'card') {
    return (
      <div className="min-w-[220px] max-w-sm">
        <div className="text-sm font-medium">{parsed.title}</div>
        {parsed.desc && <div className={cn('mt-1 max-h-14 overflow-hidden text-xs', fromSelf ? 'text-slate-800/75' : 'text-slate-400')}>{parsed.desc}</div>}
        {parsed.url && (
          <a
            href={parsed.url}
            target="_blank"
            rel="noreferrer"
            className={cn('mt-2 block truncate border-t pt-2 text-xs underline-offset-2 hover:underline', fromSelf ? 'border-slate-900/10 text-slate-800' : 'border-white/10 text-cyan-200')}
          >
            {parsed.url}
          </a>
        )}
      </div>
    )
  }

  return (
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {stripGroupSpeakerPrefix(parsed.text, message) || '[非文本消息]'}
    </p>
  )
}

export default function MessageList() {
  const [contacts, setContacts] = useState([])
  const [conversations, setConversations] = useState([])
  const [selfAccounts, setSelfAccounts] = useState([])
  const [selectedWxid, setSelectedWxid] = useState(null)
  const [messages, setMessages] = useState([])
  const [contactDetail, setContactDetail] = useState(null)
  const [search, setSearch] = useState('')
  const [sendInput, setSendInput] = useState('')
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [sending, setSending] = useState(false)
  const [clearingSelected, setClearingSelected] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [messageCache, setMessageCache] = useState({})
  const messageCacheRef = useRef({})
  const listRef = useRef(null)
  const userScrolledUpRef = useRef(false)
  const selectedWxidRef = useRef(selectedWxid)
  selectedWxidRef.current = selectedWxid

  const fetchContacts = useCallback(async () => {
    try {
      const accountResult = await getWxAccounts().catch(() => null)
      if (Array.isArray(accountResult)) {
        setSelfAccounts((prev) => (sameList(prev, accountResult) ? prev : accountResult))
      }
      else {
        const cached = await getCachedWxAccounts().catch(() => [])
        if (Array.isArray(cached)) {
          setSelfAccounts((prev) => (sameList(prev, cached) ? prev : cached))
        }
      }

      const [conversationData, contactData] = await Promise.allSettled([getConversations(), getContacts()])
      if (conversationData.status === 'fulfilled') {
        const value = conversationData.value
        const nextConversations = Array.isArray(value) ? value : value.conversations || []
        setConversations((prev) => (sameList(prev, nextConversations) ? prev : nextConversations))
      }
      if (contactData.status === 'fulfilled') {
        const value = contactData.value
        const nextContacts = Array.isArray(value) ? value : value.contacts || []
        setContacts((prev) => (sameList(prev, nextContacts) ? prev : nextContacts))
      }
    } finally {
      setLoadingContacts(false)
    }
  }, [])

  const mergedContacts = useMemo(() => {
    const map = new Map(contacts.map((contact) => [contact.wxid, contact]))
    return conversations
      .map((conversation) => {
        const cached = map.get(conversation.sender) || {}
        return {
          ...cached,
          wxid: conversation.sender,
          msg_count: conversation.msg_count || 0,
          last_msg_time: conversation.last_time || cached.last_msg_time || 0,
          last_msg_content: cached.last_msg_content || conversation.last_content || '',
          last_msg_type: conversation.last_msg_type || cached.last_msg_type || 1,
          nickname: cached.nickname || cached.remarks || conversation.sender,
          unread_count: conversation.unread_count || 0,
        }
      })
      .sort((a, b) => Number(b.last_msg_time || 0) - Number(a.last_msg_time || 0))
  }, [contacts, conversations])

  const filteredContacts = mergedContacts.filter((contact) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [contact.wxid, contact.nickname, contact.remarks, contact.last_msg_content].some((item) =>
      String(item || '').toLowerCase().includes(q),
    )
  })

  const selectedContact = mergedContacts.find((contact) => contact.wxid === selectedWxid)
  const selfWxid = selfAccounts[0]?.wxid || null

  const fetchMessages = useCallback(async (wxid, { background = false } = {}) => {
    if (!wxid) return
    if (!background) setLoadingMessages(true)
    try {
      const [messageData, detailData] = await Promise.allSettled([
        getMessagesBySender(wxid, 200),
        isGroupWxid(wxid) ? Promise.resolve(null) : getContactDetail(wxid),
      ])
      if (messageData.status === 'fulfilled') {
        const nextMessages = messageData.value.messages || []
        messageCacheRef.current = { ...messageCacheRef.current, [wxid]: nextMessages }
        setMessageCache(messageCacheRef.current)
        if (selectedWxidRef.current === wxid) {
          setMessages((prev) => (sameList(prev, nextMessages) ? prev : nextMessages))
        }
      } else if (!background && messageCacheRef.current[wxid]) {
        if (selectedWxidRef.current === wxid) {
          setMessages(messageCacheRef.current[wxid])
        }
      }
      if (detailData.status === 'fulfilled' && detailData.value && !detailData.value?.error && selectedWxidRef.current === wxid) {
        const detail = detailData.value
        setContactDetail(detail)
        cacheContact({
          wxid,
          nickname: detail.nick_name,
          remarks: detail.remarks,
          sex: detail.sex,
          country: detail.country,
          province: detail.province,
          city: detail.city,
          signature: detail.signature,
          avatar: detail.avatar,
        }).catch(() => {})
      }
    } finally {
      if (!background && selectedWxidRef.current === wxid) setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    fetchContacts()
    const timer = setInterval(fetchContacts, 12000)
    return () => clearInterval(timer)
  }, [fetchContacts])

  useEffect(() => {
    if (!selectedWxid) return
    if (messageCacheRef.current[selectedWxid]) {
      setMessages(messageCacheRef.current[selectedWxid])
    }
    fetchMessages(selectedWxid)
    const timer = setInterval(() => {
      if (!userScrolledUpRef.current) {
        fetchMessages(selectedWxidRef.current, { background: true })
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [selectedWxid, fetchMessages])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const threshold = 80
    const wasScrolledUp = userScrolledUpRef.current
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold
    userScrolledUpRef.current = !atBottom
    if (wasScrolledUp && atBottom && selectedWxidRef.current) {
      fetchMessages(selectedWxidRef.current)
    }
  }, [fetchMessages])

  useEffect(() => {
    if (!listRef.current || userScrolledUpRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length, selectedWxid])

  const isSelfMessage = (message) => message.local_type === 2 || (selfWxid && message.sender === selfWxid)
  const isGroupConversation = isGroupWxid(selectedWxid)

  const sendMessage = async () => {
    if (!selectedWxid || !sendInput.trim() || sending) return
    setSending(true)
    try {
      await sendTestMessage(selectedWxid, sendInput.trim())
      setSendInput('')
      await fetchMessages(selectedWxid)
    } finally {
      setSending(false)
    }
  }

  const clearSelected = async () => {
    if (!selectedWxid || clearingSelected) return
    const currentWxid = selectedWxid
    const currentName = displayName(selectedContact)
    const currentIndex = filteredContacts.findIndex((contact) => contact.wxid === currentWxid)
    const nextContact =
      filteredContacts[currentIndex + 1] ||
      filteredContacts[currentIndex - 1] ||
      mergedContacts.find((contact) => contact.wxid !== currentWxid)
    const ok = window.confirm(`确定清空 ${currentName} 的消息记录吗？`)
    if (!ok) return
    setClearingSelected(true)
    try {
      await clearMessagesBySender(currentWxid)
      const nextCache = { ...messageCacheRef.current }
      delete nextCache[currentWxid]
      messageCacheRef.current = nextCache
      setMessageCache(nextCache)
      setConversations((prev) => prev.filter((conversation) => conversation.sender !== currentWxid))

      if (selectedWxidRef.current === currentWxid && nextContact?.wxid) {
        handleSelectConversation(nextContact.wxid)
      } else if (selectedWxidRef.current === currentWxid) {
        selectedWxidRef.current = null
        setSelectedWxid(null)
        setMessages([])
        setContactDetail(null)
        setShowDetail(false)
      }

      await fetchContacts()
    } finally {
      setClearingSelected(false)
    }
  }

  const clearAll = async () => {
    const ok = window.confirm('确定清空所有用户消息记录吗？此操作不可恢复。')
    if (!ok) return
    setClearingAll(true)
    try {
      await resetAllMessages()
      messageCacheRef.current = {}
      setMessageCache({})
      setMessages([])
      setConversations([])
      selectedWxidRef.current = null
      setSelectedWxid(null)
      setContactDetail(null)
      setShowDetail(false)
      await fetchContacts()
    } finally {
      setClearingAll(false)
    }
  }

  const handleSelectConversation = (wxid) => {
    selectedWxidRef.current = wxid
    setSelectedWxid(wxid)
    setContactDetail(null)
    setShowDetail(false)
    userScrolledUpRef.current = false
    markConversationRead(wxid).catch(() => {})
    setConversations((prev) => prev.map((c) => (c.sender === wxid ? { ...c, unread_count: 0 } : c)))
    if (messageCacheRef.current[wxid]) {
      setMessages(messageCacheRef.current[wxid])
    } else {
      setMessages([])
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
      <aside
        className={cn(
          'flex w-full flex-col border-r border-white/10 bg-[#0b0f17] md:w-80 lg:w-96',
          selectedWxid && 'hidden md:flex',
        )}
      >
        <div className="border-b border-white/10 p-3">
          {selfAccounts[0] && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400 text-sm font-semibold text-slate-950">
                {(selfAccounts[0].nickname || '我')[0]}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-emerald-100">{selfAccounts[0].nickname || '当前微信账号'}</div>
                <div className="truncate font-mono text-[11px] text-emerald-200/60">{selfAccounts[0].wxid}</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索好友、wxid 或消息"
                className="input-field w-full rounded-lg py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <button
              onClick={fetchContacts}
              className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]"
              title="刷新会话列表"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={clearAll}
              disabled={clearingAll}
              className="rounded-lg border border-rose-400/20 p-2 text-rose-300 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-60"
              title="清空所有用户消息"
            >
              {clearingAll ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingContacts ? (
            <div className="flex h-32 items-center justify-center">
              <RefreshCw size={18} className="animate-spin text-emerald-300" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center text-slate-600">
              <MessageSquare size={36} className="mb-3 opacity-40" />
              <div className="text-sm">暂无会话</div>
              <div className="mt-1 text-xs">收到 exe 推送消息后会自动出现在这里。</div>
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <button
                key={contact.wxid}
                onClick={() => handleSelectConversation(contact.wxid)}
                className={cn(
                  'group flex w-full items-center gap-3 border-b border-white/[0.06] px-3 py-3 text-left transition-colors',
                  selectedWxid === contact.wxid ? 'bg-emerald-400/10' : 'hover:bg-white/[0.04]',
                )}
              >
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold', avatarTone(contact.wxid))}>
                  {displayName(contact)[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">{displayName(contact)}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-600">{formatTime(contact.last_msg_time)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="truncate text-xs text-slate-500">{messagePreview({ content: contact.last_msg_content, msg_type: contact.last_msg_type })}</span>
                    {contact.unread_count > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-emerald-400 px-2 py-0.5 text-[11px] font-bold text-slate-950">
                        {contact.unread_count > 99 ? '99+' : contact.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className={cn('hidden min-w-0 flex-1 flex-col bg-[#07090f] md:flex', selectedWxid && 'flex')}>
        {!selectedWxid ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-600">
            <Bot size={44} className="mb-3 opacity-40" />
            <div className="text-sm">选择一个会话开始查看消息</div>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  className="rounded-lg border border-white/10 p-2 text-slate-400 md:hidden"
                  onClick={() => setSelectedWxid(null)}
                  aria-label="返回会话列表"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold', avatarTone(selectedWxid))}>
                  {displayName(contactDetail || selectedContact)[0]}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{displayName(contactDetail || selectedContact)}</div>
                  <div className="truncate font-mono text-[11px] text-slate-600">{selectedWxid}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    fetchMessages(selectedWxid)
                    userScrolledUpRef.current = false
                  }}
                  className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]"
                  title="刷新消息"
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  onClick={() => setShowDetail(!showDetail)}
                  className={cn('rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05]', showDetail && 'text-emerald-300')}
                  title="联系人信息"
                >
                  <Info size={16} />
                </button>
                <button
                  onClick={clearSelected}
                  disabled={clearingSelected}
                  className="rounded-lg border border-white/10 p-2 text-rose-300 hover:bg-rose-400/10"
                  title="清空消息"
                >
                  {clearingSelected ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <div ref={listRef} onScroll={handleScroll} className="min-w-0 flex-1 overflow-y-auto px-4 py-4">
                {loadingMessages && messages.length === 0 ? (
                  <div className="flex h-32 items-center justify-center">
                    <RefreshCw size={18} className="animate-spin text-emerald-300" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-xs text-slate-600">暂无消息记录</div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((message, index) => {
                      const fromSelf = isSelfMessage(message)
                      const status = statusMap[message.reply_status]
                      const StatusIcon = status?.icon
                      return (
                        <div key={message.msgid || index} className={cn('flex items-end gap-2', fromSelf ? 'justify-end' : 'justify-start')}>
                          {!fromSelf && (
                            <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold', avatarTone(isGroupConversation ? groupSpeakerName(message) : selectedWxid))}>
                              {(isGroupConversation ? groupSpeakerName(message) : displayName(selectedContact))[0]}
                            </div>
                          )}
                          <div className={cn('max-w-[78%]', fromSelf && 'items-end')}>
                            {!fromSelf && isGroupConversation && (
                              <div className="mb-1 pl-1 text-[11px] text-slate-500">{groupSpeakerName(message)}</div>
                            )}
                            <div
                              className={cn(
                                'rounded-lg px-3 py-2 text-sm leading-relaxed shadow-sm',
                                fromSelf
                                  ? 'bg-emerald-500 text-slate-950'
                                  : 'border border-white/10 bg-white/[0.06] text-slate-100',
                              )}
                            >
                              <MessageBody message={message} fromSelf={fromSelf} />
                            </div>
                            <div className={cn('mt-1 flex items-center gap-2 text-[10px] text-slate-600', fromSelf && 'justify-end')}>
                              <span>{formatTime(message.timestamp)}</span>
                              {!fromSelf && status && (
                                <span className={cn('inline-flex items-center gap-1', status.className)} title={message.reply_error || status.label}>
                                  <StatusIcon size={11} />
                                  {status.label}
                                </span>
                              )}
                            </div>
                          </div>
                          {fromSelf && (
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-400 text-[10px] font-semibold text-slate-950">
                              {(selfAccounts[0]?.nickname || '我')[0]}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {showDetail && (
                <aside className="hidden w-72 shrink-0 border-l border-white/10 bg-white/[0.025] p-4 lg:block">
                  <div className="mb-5 text-center">
                    <div className={cn('mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-xl text-xl font-semibold', avatarTone(selectedWxid))}>
                      {displayName(contactDetail || selectedContact)[0]}
                    </div>
                    <div className="truncate text-sm font-medium">{displayName(contactDetail || selectedContact)}</div>
                    <div className="mt-1 break-all font-mono text-[11px] text-slate-600">{selectedWxid}</div>
                  </div>
                  <div className="space-y-2 text-xs">
                    {[
                      ['备注', contactDetail?.remarks],
                      ['昵称', contactDetail?.nick_name || selectedContact?.nickname],
                      ['地区', [contactDetail?.country, contactDetail?.province, contactDetail?.city].filter(Boolean).join(' ')],
                      ['签名', contactDetail?.signature],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-3">
                        <div className="mb-1 text-slate-500">{label}</div>
                        <div className="break-words text-slate-300">{value || '-'}</div>
                      </div>
                    ))}
                  </div>
                </aside>
              )}
            </div>

            <footer className="shrink-0 border-t border-white/10 p-3">
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-500 sm:flex">
                  <User size={14} />
                  手动发送
                </div>
                <input
                  value={sendInput}
                  onChange={(event) => setSendInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') sendMessage()
                  }}
                  placeholder="输入要发送给该好友的消息"
                  className="input-field min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={sendMessage}
                  disabled={!sendInput.trim() || sending}
                  className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-950"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  发送
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
