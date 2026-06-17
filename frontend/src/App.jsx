import { useEffect, useState } from 'react'
import {
  Bot,
  BrainCircuit,
  Database,
  Globe,
  Menu,
  MessageSquare,
  Settings2,
  Shield,
  Users,
  X,
} from 'lucide-react'
import SystemStatus from './components/SystemStatus'
import MessageList from './components/MessageList'
import KnowledgeBaseConfig from './components/KnowledgeBaseConfig'
import ProxyConfig from './components/ProxyConfig'
import Settings from './components/Settings'
import SystemConfig from './components/SystemConfig'
import GroupChatConfig from './components/GroupChatConfig'
import FriendAccessConfig from './components/FriendAccessConfig'
import { cn } from './lib/utils'

const menuItems = [
  { id: 'status', label: '运行总览', icon: Bot },
  { id: 'messages', label: '消息工作台', icon: MessageSquare },
  { id: 'kb-config', label: '知识库', icon: Database },
  { id: 'groups', label: '群聊管理', icon: Users },
  { id: 'whitelist', label: '白名单', icon: Shield },
  { id: 'proxy', label: '代理设置', icon: Globe },
  { id: 'settings', label: '自动化规则', icon: BrainCircuit },
  { id: 'system', label: '系统设置', icon: Settings2 },
]

export default function App() {
  const [activeView, setActiveView] = useState('status')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setSidebarOpen(!mq.matches)
    const handler = (event) => setSidebarOpen(!event.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const renderView = () => {
    switch (activeView) {
      case 'messages':
        return <MessageList />
      case 'kb-config':
        return <KnowledgeBaseConfig />
      case 'groups':
        return <GroupChatConfig />
      case 'whitelist':
        return <FriendAccessConfig />
      case 'proxy':
        return <ProxyConfig />
      case 'settings':
        return <Settings />
      case 'system':
        return <SystemConfig />
      default:
        return <SystemStatus />
    }
  }

  const activeLabel = menuItems.find((item) => item.id === activeView)?.label

  return (
    <div className="flex h-screen overflow-hidden bg-[#07090f] text-slate-100">
      <aside
        className={cn(
          'fixed md:relative z-40 h-full flex flex-col border-r border-white/10 bg-[#0c1018]/95 backdrop-blur-xl transition-all duration-300',
          sidebarOpen ? 'w-64' : 'w-0 md:w-16 overflow-hidden',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20">
            <Bot size={20} />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-wide">VX智能AI</div>
              <div className="text-[11px] text-slate-500">微信机器人本地控制台</div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveView(item.id)
                if (window.innerWidth < 768) setSidebarOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                activeView === item.id
                  ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                  : 'border-transparent text-slate-400 hover:bg-white/[0.05] hover:text-slate-100',
              )}
              title={item.label}
            >
              <item.icon size={18} className="shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        {sidebarOpen && (
          <div className="border-t border-white/10 px-4 py-3 text-[11px] text-slate-500">
            本地数据保存在 SQLite，适合个人私有部署。
          </div>
        )}
      </aside>

      {sidebarOpen && (
        <button
          aria-label="关闭导航"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-[#07090f]/90 px-4 backdrop-blur">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"
            aria-label="切换导航"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]" />
            <span className="truncate text-sm text-slate-400">{activeLabel}</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="fade-in">{renderView()}</div>
        </div>
      </main>
    </div>
  )
}
