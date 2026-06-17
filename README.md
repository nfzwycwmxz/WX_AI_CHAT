# WX_AI_CHAT
# VX 智能 AI

> 微信 AI 自动回复机器人 — 给微信装一个 24 小时在线的 AI 管家
初步版本，可能有问题，不喜勿喷！

---

## 简介

VX 智能 AI 是一个将微信与大型语言模型深度结合的开源系统，通过 **pywxrobot** 实时监听微信消息，接入 AI 知识库实现智能自动回复。

支持好友私聊和群聊场景，提供白名单、关键词触发、知识库问答等多种模式。

---

## 功能

### AI 自动回复
- 接入 **智谱 GLM**、**讯飞星火**、**FastGPT**、**Dify** 等多种 AI 引擎
- 支持知识库问答，回复基于自定义资料内容
- 暂时只验证了智谱的知识库

### 群聊管理
- 指定哪些群聊启用 AI 回复
- 支持 **@触发** 模式，不干扰群内正常对话

### 白名单模式
- 设置白名单好友，只对指定好友触发 AI 回复
- 手动添加或从通讯录选择

### 关键词触发
- 预设关键词，命中时自动触发 AI 回复
- 适合常见问题自动解答

### 消息工作台
- 查看所有会话消息
- 未读消息气泡提示
- 消息状态标记（已回复 / 待处理 / 失败）
- 手动发送消息
- 联系人信息查看

### 消息防撤回
- 开启后可拦截并保存被撤回的消息

### 好友自动通过
- 自动通过好友申请
- 可配置欢迎语

### 上下文记忆
- 保留最近对话上下文，AI 回复更连贯

---

## 截图

| 模块 | 描述 |
|------|------|
| 运行总览 | 在线状态、消息统计、配置总览 |
| 消息工作台 | 会话列表 + 聊天记录 + 未读气泡 |
| 知识库配置 | 多供应商知识库 |
| 群聊管理 | 可添加群聊 / 已启用群聊 |
| 白名单 | 可添加好友 / 已加入白名单 |
| 自动化规则 | 自动回复、关键词、好友自动通过、上下文记忆 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite 5 + Tailwind CSS + Lucide icons |
| 后端 | Python 3.9+ / FastAPI + HTTPX |
| 数据库 | SQLite |
| 微信协议 | pywxrobot |
| AI 平台 | 智谱 GLM / 讯飞星火 / FastGPT / Dify |

---

## 快速启动

### 前置要求

- Python 3.9+
- Node.js 18+
- pywxrobot（微信协议客户端，需自行部署）

### 安装

```bash
# 1. 克隆项目
git clone <your-repo-url>
cd vx-ai-chat

# 2. 配置环境变量
cp env.txt .env
编辑 .env，填入 PYWXROBOT_URL 等配置

# 3. 安装后端依赖
pip install -r backend/requirements.txt

# 4. 安装前端依赖并构建
cd frontend
npm install
npm run build
cd ..

# 5. 启动服务
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8080

# 6. 打开浏览器
# http://localhost:8080
```

---

## 配置说明

### 环境变量（.env）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HOST` | 监听地址 | `0.0.0.0` |
| `PORT` | 监听端口 | `8080` |
| `PYWXROBOT_URL` | pywxrobot 地址 | `http://127.0.0.1:23235` |
| `DB_PATH` | SQLite 数据库路径 | `./data/vx_chat.db` |
| `LOG_LEVEL` | 日志级别 | `INFO` |

---


---

## 开发

```bash
# 前端开发模式（热更新）
cd frontend
npm run dev

# 后端开发模式（自动重启）
cd ..
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8080 --reload

# 前端构建
npm run build
```

---


可关注公众号“IT小只是大分享”询问。
