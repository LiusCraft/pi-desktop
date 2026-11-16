import type { ModelInfo } from '@shared/protocol';
import claudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg?url';
import grokIcon from '@lobehub/icons-static-svg/icons/grok.svg?url';
import kimiIcon from '@lobehub/icons-static-svg/icons/kimi-color.svg?url';
import metaIcon from '@lobehub/icons-static-svg/icons/meta-color.svg?url';
import minimaxIcon from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import mistralIcon from '@lobehub/icons-static-svg/icons/mistral-color.svg?url';
import moonshotIcon from '@lobehub/icons-static-svg/icons/moonshot.svg?url';
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg?url';
import opencodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg?url';
import qwenIcon from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import zhipuIcon from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url';
import { BotIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type ModelVendor =
  | 'anthropic'
  | 'beam'
  | 'deepseek'
  | 'google'
  | 'kimi'
  | 'meta'
  | 'minimax'
  | 'mistral'
  | 'moonshot'
  | 'openai'
  | 'opencode'
  | 'qwen'
  | 'xai'
  | 'zhipu'
  | 'generic';

type VendorRule = { vendor: Exclude<ModelVendor, 'generic'>; needles: readonly string[] };

/** Model names are more specific than the provider for gateways that host several vendors. */
const VENDOR_RULES: readonly VendorRule[] = [
  { vendor: 'anthropic', needles: ['anthropic', 'claude'] },
  { vendor: 'deepseek', needles: ['deepseek'] },
  { vendor: 'google', needles: ['google', 'gemini', 'gemma'] },
  { vendor: 'qwen', needles: ['qwen'] },
  { vendor: 'minimax', needles: ['minimax'] },
  { vendor: 'kimi', needles: ['kimi'] },
  { vendor: 'moonshot', needles: ['moonshot'] },
  { vendor: 'zhipu', needles: ['zhipu', 'glm', 'chatglm', '智谱'] },
  { vendor: 'meta', needles: ['meta', 'llama'] },
  { vendor: 'mistral', needles: ['mistral'] },
  { vendor: 'xai', needles: ['xai', 'grok'] },
  { vendor: 'beam', needles: ['beam'] },
  { vendor: 'openai', needles: ['openai', 'gpt', 'codex', 'o1', 'o3', 'o4'] },
  { vendor: 'opencode', needles: ['opencode'] },
];

const VENDOR_ICONS: Record<ModelVendor, string | null> = {
  anthropic: claudeIcon,
  beam: opencodeIcon,
  deepseek: deepseekIcon,
  google: geminiIcon,
  kimi: kimiIcon,
  meta: metaIcon,
  minimax: minimaxIcon,
  mistral: mistralIcon,
  moonshot: moonshotIcon,
  openai: openaiIcon,
  opencode: opencodeIcon,
  qwen: qwenIcon,
  xai: grokIcon,
  zhipu: zhipuIcon,
  generic: null,
};

export function modelVendor(model: Pick<ModelInfo, 'provider' | 'id' | 'name'>): ModelVendor {
  const haystack = `${model.provider} ${model.id} ${model.name ?? ''}`.toLowerCase();
  return VENDOR_RULES.find((rule) => rule.needles.some((needle) => haystack.includes(needle)))?.vendor ?? 'generic';
}

export function ModelVendorIcon({
  model,
  className,
}: {
  model: Pick<ModelInfo, 'provider' | 'id' | 'name'>;
  className?: string;
}) {
  const src = VENDOR_ICONS[modelVendor(model)];
  if (!src) return <BotIcon aria-hidden className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', className)} />;
  return <img src={src} alt="" aria-hidden draggable={false} className={cn('mt-0.5 size-4 shrink-0', className)} />;
}
