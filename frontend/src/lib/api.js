import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// ======== Health & Status ========
export const getHealth = () => api.get('/health').then(r => r.data);

// ======== Messages ========
export const getMessages = (limit = 50, offset = 0) =>
  api.get('/messages', { params: { limit, offset } }).then(r => r.data);

export const getMessageStats = () =>
  api.get('/messages/stats').then(r => r.data);

// ======== KB Configs ========
export const getKBConfigs = () =>
  api.get('/kb-configs').then(r => r.data);

export const createKBConfig = (data) =>
  api.post('/kb-configs', data).then(r => r.data);

export const updateKBConfig = (id, data) =>
  api.put(`/kb-configs/${id}`, data).then(r => r.data);

export const deleteKBConfig = (id) =>
  api.delete(`/kb-configs/${id}`).then(r => r.data);

// ======== Default LLM Configs ========
export const getLLMConfigs = () =>
  api.get('/llm-configs').then(r => r.data);

export const createLLMConfig = (data) =>
  api.post('/llm-configs', data).then(r => r.data);

export const updateLLMConfig = (id, data) =>
  api.put(`/llm-configs/${id}`, data).then(r => r.data);

export const deleteLLMConfig = (id) =>
  api.delete(`/llm-configs/${id}`).then(r => r.data);

// ======== Proxy Configs ========
export const getProxyConfigs = () =>
  api.get('/proxy-configs').then(r => r.data);

export const createProxyConfig = (data) =>
  api.post('/proxy-configs', data).then(r => r.data);

export const updateProxyConfig = (id, data) =>
  api.put(`/proxy-configs/${id}`, data).then(r => r.data);

export const deleteProxyConfig = (id) =>
  api.delete(`/proxy-configs/${id}`).then(r => r.data);

// ======== System Config ========
export const getSystemConfigs = () =>
  api.get('/system-config').then(r => r.data);

export const getSystemConfig = (key) =>
  api.get(`/system-config/${key}`).then(r => r.data);

export const updateSystemConfig = (key, value) =>
  api.put(`/system-config/${key}`, { value }).then(r => r.data);

// ======== Other Features ========
export const enableDontRevoke = (revoke = true) =>
  api.post('/other/dontrevoke', { revoke }).then(r => r.data);

// ======== Send Test ========
export const sendTestMessage = (wxid, content) =>
  api.post('/send-test', { wxid, content, wait: false }).then(r => r.data);

// ======== Wx Accounts ========
export const getWxAccounts = () =>
  api.get('/wx-accounts').then(r => Array.isArray(r.data) ? r.data : (r.data?.accounts || []));

export const getCachedWxAccounts = () =>
  api.get('/wx-accounts/cached').then(r => Array.isArray(r.data) ? r.data : (r.data?.accounts || []));

// ======== Contacts ========
export const getContacts = () =>
  api.get('/contacts').then(r => Array.isArray(r.data) ? r.data : (r.data?.contacts || []));

export const getContactDetail = (wxid) =>
  api.get(`/contacts/${encodeURIComponent(wxid)}`).then(r => r.data);

export const cacheContact = (data) =>
  api.put('/contacts/cache', data).then(r => r.data);

// ======== Conversations ========
export const getConversations = () =>
  api.get('/conversations').then(r => Array.isArray(r.data) ? r.data : (r.data?.conversations || []));

export const markConversationRead = (sender) =>
  api.post('/conversations/read', { sender }).then(r => r.data);

// ======== Messages by Sender ========
export const getMessagesBySender = (sender, limit = 100, offset = 0) =>
  api.get(`/messages/by-sender/${encodeURIComponent(sender)}`, { params: { limit, offset } }).then(r => r.data);

export const clearMessagesBySender = (sender) =>
  api.delete(`/messages/by-sender/${encodeURIComponent(sender)}`).then(r => r.data);

export const resetAllMessages = () =>
  api.delete('/messages').then(r => r.data);

// ======== Group Configs ========
export const getGroupConfigs = () => api.get('/groups').then(r => r.data);
export const createGroupConfig = (data) => api.post('/groups', data).then(r => r.data);
export const deleteGroupConfig = (id) => api.delete(`/groups/${id}`).then(r => r.data);

// ======== Keyword Triggers ========
export const getKeywords = () => api.get('/keywords').then(r => r.data);
export const createKeyword = (kw) => api.post('/keywords', { keyword: kw }).then(r => r.data);
export const deleteKeyword = (id) => api.delete(`/keywords/${id}`).then(r => r.data);

// ======== Friend Access (Whitelist) ========
export const getFriendAccess = () => api.get('/friend-access').then(r => r.data);
export const addFriendAccess = (wxid, remark) => api.post('/friend-access', { wxid, remark }).then(r => r.data);
export const removeFriendAccess = (id) => api.delete(`/friend-access/${id}`).then(r => r.data);

// ======== Wx Contacts & Rooms (for selection) ========
export const getWxContacts = () => api.get('/wx-contacts').then(r => r.data);
export const getWxRooms = () => api.get('/wx-rooms').then(r => r.data);
