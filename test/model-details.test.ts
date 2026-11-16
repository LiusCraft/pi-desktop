import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translate } from '../src/shared/i18n';
import {
  ModelDetails,
  modelDetailRows,
  modelInputLabel,
  type ModelDetailsTranslate,
} from '../src/renderer/src/components/composer/model-details';

const t: ModelDetailsTranslate = (key, params) => translate('zh', key, params);

describe('model details', () => {
  it('formats known, unknown and default input types', () => {
    expect(modelInputLabel(undefined, t)).toBe('文本');
    expect(modelInputLabel([], t)).toBe('文本');
    expect(modelInputLabel(['text', 'image', 'audio', 'video', 'pdf', 'custom'], t)).toBe(
      '文本, 图像, 音频, 视频, PDF, custom',
    );
  });

  it('formats model capabilities and fallback values', () => {
    const full = modelDetailRows(
      {
        provider: 'OpenCode',
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro Preview',
        input: ['text', 'image'],
        reasoning: true,
        contextWindow: 1_048_576,
      },
      t,
    );
    expect(full).toEqual([
      { label: '模型', value: 'Gemini 3.1 Pro Preview' },
      { label: '提供商', value: 'OpenCode' },
      { label: '输入', value: '文本, 图像' },
      { label: '推理', value: '支持推理' },
      { label: '上下文', value: '1,048,576' },
    ]);

    const missing = modelDetailRows({ provider: 'custom', id: 'custom-model', reasoning: false }, t);
    expect(missing.at(-2)).toEqual({ label: '推理', value: '不支持推理' });
    expect(missing.at(-1)).toEqual({ label: '上下文', value: '未知' });
    expect(modelDetailRows({ provider: 'custom', id: 'unknown-model' }, t).at(-2)).toEqual({
      label: '推理',
      value: '未知',
    });
  });

  it('renders the detail card rows', () => {
    const html = renderToStaticMarkup(
      createElement(ModelDetails, {
        model: { provider: 'OpenCode', id: 'model-id', name: 'Model name', reasoning: true, contextWindow: 1000 },
        t,
      }),
    );
    expect(html).toContain('Model name');
    expect(html).toContain('提供商');
    expect(html).toContain('1,000');
  });
});
