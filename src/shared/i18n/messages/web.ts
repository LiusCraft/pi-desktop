import { defineMessages } from '../define';

export const web = defineMessages({
  'web.title': { en: 'Web search', zh: '联网搜索' },
  'web.sub': { en: 'Lets the model search the web and read pages.', zh: '让模型搜索网页并读取内容。' },
  'web.tip': {
    en: "Reading pages needs no key. Exa searches without a key (rate-limited); the other engines need your own API key, and all have a free tier. Keys stay in this computer's data folder and are never shown or sent to the model.",
    zh: '读取网页无需密钥。Exa 无需密钥即可搜索（有频率限制），其余引擎需要你自己的 API 密钥，都有免费额度。密钥只保存在这台电脑的数据目录中，不会显示或发给模型。',
  },
  'web.auto': { en: 'Auto', zh: '自动' },
  'web.hint.auto': { en: 'Falls back to the next engine when one fails.', zh: '失败时自动换下一个引擎。' },
  'web.hint.fixed': { en: 'Only {engine}; no fallback.', zh: '仅用 {engine}，不会回退。' },
  'web.keyless': { en: 'No key needed', zh: '无需密钥' },
  'web.keyOptional': { en: 'API key (optional, raises the rate limit)', zh: 'API Key（可选，可提高频率限制）' },
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
  'web.free.exa': { en: 'No key needed; a free key raises the limit', zh: '无需密钥；免费密钥可提高限额' },
  'web.free.brave': { en: 'Free credits every month; its own index', zh: '每月赠送免费额度，独立索引' },
  'web.free.tavily': {
    en: '1000 free searches a month; built for AI retrieval',
    zh: '每月 1000 次免费，专为 AI 检索设计',
  },
  'web.free.serper': { en: 'Free credits on sign-up; Google results', zh: '注册赠送免费额度，Google 搜索结果' },
});
