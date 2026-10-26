import { useId, useState } from 'react';
import type { EndpointModel } from '@shared/protocol';
import { COST_FIELDS } from '@shared/model-metadata';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PRICE_LABELS = { input: '输入价格', output: '输出价格', cacheRead: '缓存读取', cacheWrite: '缓存写入' };

export function ModelEditor({ model, onApply, onCancel }: {
  model: EndpointModel;
  onApply: (model: EndpointModel) => void;
  onCancel: () => void;
}) {
  const prefix = useId();
  const [name, setName] = useState(model.name ?? '');
  const [context, setContext] = useState(String(model.contextWindow ?? ''));
  const [output, setOutput] = useState(String(model.maxTokens ?? ''));
  const [prices, setPrices] = useState(() => Object.fromEntries(COST_FIELDS.map((key) => [key, String(model.cost?.[key] ?? '')])));
  const [reasoning, setReasoning] = useState(model.reasoning === undefined ? 'auto' : String(model.reasoning));
  const [input, setInput] = useState(model.input === undefined ? 'auto' : model.input.includes('image') ? 'image' : 'text');
  const optionalNumber = (value: string) => value.trim() ? Number(value) : undefined;

  return (
    <form className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-3" onSubmit={(event) => {
      event.preventDefault();
      const cost = Object.fromEntries(COST_FIELDS.flatMap((key) => prices[key].trim() ? [[key, Number(prices[key])]] : []));
      onApply({
        ...model,
        name: name.trim() || undefined,
        contextWindow: optionalNumber(context),
        maxTokens: optionalNumber(output),
        cost: Object.keys(cost).length ? cost : undefined,
        reasoning: reasoning === 'auto' ? undefined : reasoning === 'true',
        input: input === 'auto' ? undefined : input === 'image' ? ['text', 'image'] : ['text'],
        source: 'manual',
      });
    }}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${prefix}-name`}>模型显示名称</FieldLabel>
          <Input id={`${prefix}-name`} value={name} placeholder={model.id} onChange={(event) => setName(event.target.value)} />
        </Field>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${prefix}-context`}>上下文大小（tokens）</FieldLabel>
            <Input id={`${prefix}-context`} type="number" min="1" step="1" value={context} placeholder="参考值 / 默认 128000" onChange={(event) => setContext(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${prefix}-output`}>最大输出（tokens）</FieldLabel>
            <Input id={`${prefix}-output`} type="number" min="1" step="1" value={output} placeholder="参考值 / 默认 16384" onChange={(event) => setOutput(event.target.value)} />
          </Field>
        </FieldGroup>
        <FieldSet className="gap-2">
          <FieldLegend variant="label">价格（美元 / 百万 tokens）</FieldLegend>
          <FieldGroup className="grid grid-cols-2 gap-3">
            {COST_FIELDS.map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`${prefix}-price-${key}`}>{PRICE_LABELS[key]}</FieldLabel>
                <Input id={`${prefix}-price-${key}`} type="number" min="0" step="any" value={prices[key]} placeholder="参考值 / 默认 0" onChange={(event) => setPrices((previous) => ({ ...previous, [key]: event.target.value }))} />
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${prefix}-reasoning`}>推理能力</FieldLabel>
            <Select value={reasoning} onValueChange={setReasoning}>
              <SelectTrigger id={`${prefix}-reasoning`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="auto">参考值 / 默认</SelectItem>
                <SelectItem value="true">支持</SelectItem>
                <SelectItem value="false">不支持</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${prefix}-input`}>输入类型</FieldLabel>
            <Select value={input} onValueChange={setInput}>
              <SelectTrigger id={`${prefix}-input`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="auto">参考值 / 默认</SelectItem>
                <SelectItem value="text">文本</SelectItem>
                <SelectItem value="image">文本和图像</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <FieldDescription>手动值优先；留空时使用 models.dev 参考值，未匹配时使用 pi 默认值。上下文和输出必须大于 0，价格可以为 0。</FieldDescription>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>取消修改</Button>
        <Button type="submit" variant="outline" size="sm">应用修改</Button>
      </div>
    </form>
  );
}
