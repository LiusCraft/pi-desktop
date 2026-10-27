import { defineMessages } from '../define';

export const web = defineMessages({
  'web.title': { en: 'Web search', zh: '联网搜索' },
  'web.sub': {
    en: 'Lets the model search the web (pidesk_web_search) and read pages (pidesk_web_fetch, no key needed). Searching needs your own API key; every engine below has a free tier. Keys stay in this computer\'s data folder and are never shown or sent to the model.',
    zh: '让模型能搜索网页（pidesk_web_search）并读取网页内容（pidesk_web_fetch，无需密钥）。搜索需要你自己的 API 密钥，下面几家都有免费额度。密钥只保存在这台电脑的数据目录中，不会显示或发给模型。',
  },
  'web.auto': { en: 'Auto', zh: '自动' },
  'web.hint.auto': {
    en: 'Auto: starts with the engine that last worked; if it fails (e.g. its free quota is used up) the next configured engine is tried, and that one becomes the default from then on.',
    zh: '自动：优先用上次成功的引擎；它失败（如免费额度用完）就换下一个已配置的重试，之后默认用换到的这个。',
  },
  'web.hint.fixed': { en: 'Always uses {engine}; no other engine is tried if it fails.', zh: '固定使用 {engine}，失败时不会换别的引擎。' },
  'web.none': { en: 'No key is set yet, so the model cannot search the web.', zh: '还没有配置任何密钥，模型暂时不能联网搜索。' },
  'web.configured': { en: 'Configured', zh: '已配置' },
  'web.configured.current': { en: 'Configured · in use', zh: '已配置 · 当前使用' },
  'web.getKey': { en: 'Get a key', zh: '获取密钥' },
  'web.keyPlaceholder': { en: 'API key', zh: 'API Key' },
  'web.keyKeep': { en: '•••••••• (leave empty to keep)', zh: '••••••••（留空表示不修改）' },
  'web.test': { en: 'Test', zh: '测试' },
  'web.testing': { en: 'Testing…', zh: '检测中…' },
  'web.works': { en: '{engine} works', zh: '{engine} 可用' },
  'web.save': { en: 'Save', zh: '保存' },
  'web.remove': { en: 'Remove', zh: '移除' },
  'web.saved': { en: 'Saved', zh: '已保存' },
  'web.removed': { en: 'Removed', zh: '已移除' },
  'web.free.exa': { en: 'Free credits on sign-up; results come with highlighted passages', zh: '注册即送免费额度，结果自带正文高亮' },
  'web.free.brave': { en: 'Free credits every month; its own index', zh: '每月赠送免费额度，独立索引' },
  'web.free.tavily': { en: '1000 free searches a month; built for AI retrieval', zh: '每月 1000 次免费，专为 AI 检索设计' },
  'web.free.serper': { en: 'Free credits on sign-up; Google results', zh: '注册赠送免费额度，Google 搜索结果' },
});
