import { useId, useState } from 'react';
import { THINKING_LEVELS, type EndpointModel, type ThinkingLevel, type ThinkingLevelMap } from '@shared/protocol';
import { cleanThinkingLevelMap, COST_FIELDS, levelSupported } from '@shared/model-metadata';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Tip } from '@/components/common/Tip';
import { levelLabel } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PRICE_LABELS = { input: 'editor.price.input', output: 'editor.price.output', cacheRead: 'editor.price.cacheRead', cacheWrite: 'editor.price.cacheWrite' } as const;

export function ModelEditor({ model, onApply, onCancel }: {
  model: EndpointModel;
  onApply: (model: EndpointModel) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const prefix = useId();
  const [name, setName] = useState(model.name ?? '');
  const [context, setContext] = useState(String(model.contextWindow ?? ''));
  const [output, setOutput] = useState(String(model.maxTokens ?? ''));
  const [prices, setPrices] = useState(() => Object.fromEntries(COST_FIELDS.map((key) => [key, String(model.cost?.[key] ?? '')])));
  const [reasoning, setReasoning] = useState(model.reasoning === undefined ? 'auto' : String(model.reasoning));
  const [levels, setLevels] = useState<ThinkingLevelMap>(() => ({ ...model.thinkingLevelMap }));
  const [input, setInput] = useState(model.input === undefined ? 'auto' : model.input.includes('image') ? 'image' : 'text');
  const optionalNumber = (value: string) => value.trim() ? Number(value) : undefined;

  /** Re-enabling a level keeps the provider value the file already had, else uses the level's own name. */
  const toggleLevel = (level: ThinkingLevel) => {
    setLevels((previous) => {
      const next = { ...previous };
      if (levelSupported(previous, level)) {
        next[level] = null;
        return next;
      }
      const saved = model.thinkingLevelMap?.[level];
      const value = typeof saved === 'string' ? saved : level === 'xhigh' || level === 'max' ? level : undefined;
      if (value === undefined) delete next[level];
      else next[level] = value;
      return next;
    });
  };

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
        thinkingLevelMap: reasoning === 'true' ? cleanThinkingLevelMap(levels) : reasoning === 'auto' ? model.thinkingLevelMap : undefined,
        input: input === 'auto' ? undefined : input === 'image' ? ['text', 'image'] : ['text'],
        source: 'manual',
      });
    }}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${prefix}-name`}>{t('editor.name')}</FieldLabel>
          <Input id={`${prefix}-name`} value={name} placeholder={model.id} onChange={(event) => setName(event.target.value)} />
        </Field>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${prefix}-context`}>{t('editor.context')}</FieldLabel>
            <Input id={`${prefix}-context`} type="number" min="1" step="1" value={context} placeholder={t('editor.contextPh')} onChange={(event) => setContext(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${prefix}-output`}>{t('editor.output')}</FieldLabel>
            <Input id={`${prefix}-output`} type="number" min="1" step="1" value={output} placeholder={t('editor.outputPh')} onChange={(event) => setOutput(event.target.value)} />
          </Field>
        </FieldGroup>
        <FieldSet className="gap-2">
          <FieldLegend variant="label">{t('editor.prices')}</FieldLegend>
          <FieldGroup className="grid grid-cols-2 gap-3">
            {COST_FIELDS.map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`${prefix}-price-${key}`}>{t(PRICE_LABELS[key])}</FieldLabel>
                <Input id={`${prefix}-price-${key}`} type="number" min="0" step="any" value={prices[key]} placeholder={t('editor.pricePh')} onChange={(event) => setPrices((previous) => ({ ...previous, [key]: event.target.value }))} />
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${prefix}-reasoning`}>{t('editor.reasoning')}</FieldLabel>
            <Select value={reasoning} onValueChange={setReasoning}>
              <SelectTrigger id={`${prefix}-reasoning`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="auto">{t('editor.auto')}</SelectItem>
                <SelectItem value="true">{t('editor.supported')}</SelectItem>
                <SelectItem value="false">{t('editor.unsupported')}</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${prefix}-input`}>{t('editor.inputType')}</FieldLabel>
            <Select value={input} onValueChange={setInput}>
              <SelectTrigger id={`${prefix}-input`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="auto">{t('editor.auto')}</SelectItem>
                <SelectItem value="text">{t('editor.text')}</SelectItem>
                <SelectItem value="image">{t('editor.textImage')}</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        {reasoning === 'true' && (
          <Field>
            <FieldLabel>{t('editor.levels')}<Tip>{t('editor.levelsTip')}</Tip></FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {THINKING_LEVELS.map((level) => (
                <Toggle
                  key={level}
                  type="button"
                  variant="outline"
                  size="sm"
                  pressed={levelSupported(levels, level)}
                  onPressedChange={() => toggleLevel(level)}
                >
                  {levelLabel(level)}
                </Toggle>
              ))}
            </div>
            <FieldDescription>{t('editor.levelsHint')}</FieldDescription>
          </Field>
        )}
        <FieldDescription>{t('editor.hint')}</FieldDescription>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t('editor.discard')}</Button>
        <Button type="submit" variant="outline" size="sm">{t('editor.apply')}</Button>
      </div>
    </form>
  );
}
