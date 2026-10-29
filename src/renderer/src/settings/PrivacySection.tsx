// Settings → Privacy & usage: what is masked before a request leaves this computer, the request log's own
// settings, and the usage and request lists the log feeds.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  MASK_ACTION, MASK_KIND, PERSONAL_KINDS, SECRET_KINDS,
  type MaskAction, type MaskKind, type MaskRule, type RedactPreview, type RedactSettings, type RequestHookSettings,
} from '@shared/request-log';
import { REQUEST_RETENTION } from '@shared/request-log';
import type { MessageKey } from '@shared/i18n';
import { Segmented } from '@/components/common/Segmented';
import { Tip } from '@/components/common/Tip';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Group, Heading, Panel, Row } from './ui';

const fail = (err: unknown) => toast.error(errText(err));

const KIND_LABEL: Record<MaskKind, MessageKey> = {
  PRIVATE_KEY: 'privacy.kind.PRIVATE_KEY', API_KEY: 'privacy.kind.API_KEY', JWT: 'privacy.kind.JWT', PASSWORD: 'privacy.kind.PASSWORD',
  EMAIL: 'privacy.kind.EMAIL', PHONE: 'privacy.kind.PHONE', ID_CARD: 'privacy.kind.ID_CARD', BANK_CARD: 'privacy.kind.BANK_CARD',
  TERM: 'privacy.kind.TERM', CUSTOM: 'privacy.kind.CUSTOM',
};
const ACTION_LABEL: Record<MaskAction, MessageKey> = { mask: 'privacy.action.mask', warn: 'privacy.action.warn', block: 'privacy.action.block' };
const ACTIONS = Object.values(MASK_ACTION);
/** A rules line starting with this is a regular expression, anything else is a prefix. */
const REGEX_PREFIX = 're:';
/** The preview waits this long after the last keystroke. */
const PREVIEW_DELAY_MS = 300;

const ruleToLine = (r: MaskRule) => (r.regex ? REGEX_PREFIX + r.pattern : r.pattern);
const lineToRule = (line: string): MaskRule => (line.startsWith(REGEX_PREFIX) ? { pattern: line.slice(REGEX_PREFIX.length), regex: true } : { pattern: line, regex: false });
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** A text box that saves when it loses focus, so a half-typed list is never saved. */
function ListInput({ value, onCommit, multiline, placeholder, label }: { value: string; onCommit: (text: string) => void; multiline?: boolean; placeholder?: string; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text);
  return multiline ? (
    <Textarea className="min-h-16 w-72 shrink-0 font-mono text-xs" value={text} aria-label={label} placeholder={placeholder} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={commit} />
  ) : (
    <Input className="h-8 w-72 shrink-0" value={text} aria-label={label} placeholder={placeholder} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
  );
}

function RetentionInput({ value, onCommit }: { value: number; onCommit: (days: number) => void }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n)) return setText(String(value));
    onCommit(Math.min(REQUEST_RETENTION.max, Math.max(REQUEST_RETENTION.min, n)));
  };
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Input type="number" className="h-8 w-20 text-center" min={REQUEST_RETENTION.min} max={REQUEST_RETENTION.max} value={text} aria-label={t('privacy.retention')} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span className="text-sm text-muted-foreground">{t('privacy.days')}</span>
    </div>
  );
}

function TryIt({ redact }: { redact: RedactSettings }) {
  const t = useT();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<RedactPreview | null>(null);
  const key = JSON.stringify(redact);
  useEffect(() => {
    if (!text.trim()) return setPreview(null);
    const timer = setTimeout(() => void call('requests:preview', text, redact).then(setPreview).catch(fail), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // `key` stands for the settings' content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, key]);

  const found = preview ? Object.values(preview.masked).reduce((n, c) => n + c, 0) : 0;
  const warned = preview ? Object.keys(preview.warned).map((k) => t(KIND_LABEL[k as MaskKind])).join(', ') : '';
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">{t('privacy.try')}<Tip>{t('privacy.try.tip')}</Tip></div>
      <Textarea className="min-h-20 font-mono text-xs" value={text} placeholder={t('privacy.try.placeholder')} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      {preview && (
        <>
          {found > 0 && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2.5 font-mono text-xs">{preview.text}</pre>}
          <p className="text-xs text-muted-foreground">
            {found === 0 && !warned && !preview.blocked && t('privacy.try.none')}
            {warned && t('privacy.try.warned', { kinds: warned })}
            {preview.blocked && ` ${t('privacy.try.blocked', { kind: t(KIND_LABEL[preview.blocked]) })}`}
          </p>
        </>
      )}
    </div>
  );
}

export function PrivacySection() {
  const t = useT();
  const [settings, setSettings] = useState<RequestHookSettings | null>(null);
  useEffect(() => {
    void call('requests:getSettings').then(setSettings).catch(fail);
  }, []);
  if (!settings) return null;

  const save = async (patch: Partial<RequestHookSettings>) => {
    try {
      setSettings(await call('requests:saveSettings', patch));
    } catch (err) {
      fail(err);
    }
  };
  const { redact } = settings;
  const saveRedact = (patch: Partial<RedactSettings>) => save({ redact: { ...redact, ...patch } });
  const setAction = (kind: MaskKind, action: MaskAction) => {
    const { [kind]: _dropped, ...rest } = redact.actions;
    return saveRedact({ actions: action === MASK_ACTION.mask ? rest : { ...rest, [kind]: action } });
  };

  const shown: MaskKind[] = [
    ...(redact.secrets ? SECRET_KINDS : []),
    ...(redact.personal ? PERSONAL_KINDS : []),
    ...(redact.words.length ? [MASK_KIND.term] : []),
    ...(redact.rules.length ? [MASK_KIND.custom] : []),
  ];

  return (
    <>
      <Heading title={t('settings.section.privacy')} sub={t('privacy.sub')} />
      <div>
        <Group id="mask" title={t('privacy.group.mask')} sub={t('privacy.group.mask.sub')} tip={t('privacy.group.mask.tip')}>
          <Panel>
            <Row title={t('privacy.secrets')} hint={t('privacy.secrets.hint')}>
              <Switch checked={redact.secrets} onCheckedChange={(v) => void saveRedact({ secrets: v })} />
            </Row>
            <Row title={t('privacy.personal')} hint={t('privacy.personal.hint')}>
              <Switch checked={redact.personal} onCheckedChange={(v) => void saveRedact({ personal: v })} />
            </Row>
            <Row title={t('privacy.words')} hint={t('privacy.words.hint')}>
              <ListInput label={t('privacy.words')} value={redact.words.join(', ')} onCommit={(v) => void saveRedact({ words: v.split(/[,，\n]/).map((w) => w.trim()).filter(Boolean) })} />
            </Row>
            <Row title={t('privacy.rules')} tip={t('privacy.rules.tip')}>
              <ListInput multiline label={t('privacy.rules')} value={redact.rules.map(ruleToLine).join('\n')} placeholder="gw_&#10;re:ID-\d{4}" onCommit={(v) => void saveRedact({ rules: lines(v).map(lineToRule) })} />
            </Row>
            <Row title={t('privacy.allow')} tip={t('privacy.allow.tip')}>
              <ListInput multiline label={t('privacy.allow')} value={redact.allow.join('\n')} onCommit={(v) => void saveRedact({ allow: lines(v) })} />
            </Row>
            <TryIt redact={redact} />
          </Panel>
        </Group>

        {shown.length > 0 && (
          <Group id="actions" title={t('privacy.actions')}>
            <Panel>
              {shown.map((kind) => (
                <Row key={kind} title={t(KIND_LABEL[kind])}>
                  <Segmented value={redact.actions[kind] ?? MASK_ACTION.mask} options={ACTIONS.map((id) => ({ id, label: t(ACTION_LABEL[id]) }))} onChange={(a) => void setAction(kind, a)} compact />
                </Row>
              ))}
            </Panel>
          </Group>
        )}

        <Group id="log" title={t('privacy.group.log')}>
          <Panel>
            <Row title={t('privacy.logBody')} tip={t('privacy.logBody.tip')}>
              <Switch checked={settings.logBody} onCheckedChange={(v) => void save({ logBody: v })} />
            </Row>
            <Row title={t('privacy.retention')}>
              <RetentionInput value={settings.retentionDays} onCommit={(days) => void save({ retentionDays: days })} />
            </Row>
          </Panel>
        </Group>

      </div>
    </>
  );
}
