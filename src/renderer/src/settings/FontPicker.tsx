// A searchable dropdown of the installed fonts. The list comes from Chromium's queryLocalFonts,
// which needs a user gesture, so it is read when the dropdown opens. A font that is not in the
// list (a CSS list the user typed, a font that was uninstalled) can still be typed and used.
import { useState } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n';
import { fontFamilyCss } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface LocalFont {
  family: string;
}
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFont[]>;
  }
}

let installed: Promise<string[]> | null = null;
/** Installed font families, sorted; empty when the platform will not say. */
function installedFonts(): Promise<string[]> {
  installed ??= (window.queryLocalFonts?.() ?? Promise.resolve([]))
    .then((fonts) => [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b)))
    .catch(() => {
      installed = null; // denied or no gesture: try again next time
      return [];
    });
  return installed;
}

export function FontPicker({
  value,
  onChange,
  label,
  className,
}: {
  value: string | null;
  onChange: (font: string | null) => void;
  label: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const pick = (font: string | null) => {
    setOpen(false);
    if (font !== value) onChange(font);
  };
  const typed = query.trim();
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setQuery('');
        if (o) void installedFonts().then(setFonts);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls="font-picker-list"
          aria-label={label}
          className={cn('h-8 w-56 justify-between px-3 font-normal', className)}
        >
          <span
            className={cn('truncate', !value && 'text-muted-foreground')}
            style={value ? { fontFamily: fontFamilyCss(value) } : undefined}
          >
            {value ?? t('settings.font.placeholder')}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('settings.font.search')} />
          <CommandList id="font-picker-list">
            <CommandEmpty>{t('settings.font.empty')}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__system__" keywords={[t('settings.font.placeholder')]} onSelect={() => pick(null)}>
                {t('settings.font.placeholder')}
                {!value && <CheckIcon className="ml-auto size-4" />}
              </CommandItem>
              {typed && !fonts.includes(typed) && (
                <CommandItem value={`__custom__${typed}`} keywords={[typed]} onSelect={() => pick(typed)}>
                  {t('settings.font.use', { name: typed })}
                </CommandItem>
              )}
              {fonts.map((f) => (
                <CommandItem key={f} value={f} onSelect={() => pick(f)}>
                  <span className="truncate" style={{ fontFamily: fontFamilyCss(f) }}>
                    {f}
                  </span>
                  {value === f && <CheckIcon className="ml-auto size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
