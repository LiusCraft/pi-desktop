import { createElement } from 'react';
import type { MessageKey, MessageParams } from '@shared/i18n';
import type { ModelInfo } from '@shared/protocol';

export type ModelDetailsTranslate = (key: MessageKey, params?: MessageParams) => string;

const MODEL_INPUT_LABELS = {
  text: 'menu.modelInput.text',
  image: 'menu.modelInput.image',
  audio: 'menu.modelInput.audio',
  video: 'menu.modelInput.video',
  pdf: 'menu.modelInput.pdf',
} as const;

export function modelInputLabel(input: readonly string[] | undefined, t: ModelDetailsTranslate) {
  const types = input?.length ? input : ['text'];
  return types
    .map((type) => t(MODEL_INPUT_LABELS[type as keyof typeof MODEL_INPUT_LABELS] ?? 'menu.modelInput.other', { type }))
    .join(', ');
}

export interface ModelDetailRow {
  label: string;
  value: string;
}

export function modelDetailRows(model: ModelInfo, t: ModelDetailsTranslate): ModelDetailRow[] {
  return [
    { label: t('menu.modelDetail.model'), value: model.name || model.id },
    { label: t('menu.modelDetail.provider'), value: model.provider },
    { label: t('menu.modelDetail.input'), value: modelInputLabel(model.input, t) },
    {
      label: t('menu.modelDetail.reasoning'),
      value:
        model.reasoning === undefined
          ? t('menu.modelDetail.unknown')
          : model.reasoning
            ? t('menu.modelDetail.supported')
            : t('menu.modelDetail.unsupported'),
    },
    {
      label: t('menu.modelDetail.context'),
      value: model.contextWindow ? model.contextWindow.toLocaleString() : t('menu.modelDetail.unknown'),
    },
  ];
}

export function ModelDetails({ model, t }: { model: ModelInfo; t: ModelDetailsTranslate }) {
  return createElement(
    'div',
    { className: 'space-y-1.5 w-60 text-xs' },
    modelDetailRows(model, t).map(({ label, value }) =>
      createElement(
        'div',
        { key: label, className: 'grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1' },
        createElement('span', { className: 'text-muted-foreground' }, label),
        createElement('span', { className: 'min-w-0 text-right font-medium text-foreground' }, value),
      ),
    ),
  );
}
