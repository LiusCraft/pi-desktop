import { Type } from 'typebox';

/** Keep TypeBox inference in Object/Optional while emitting a provider-friendly string enum. */
export function StringEnum<const Values extends string[]>(
  values: readonly [...Values],
  options?: { description?: string; default?: Values[number] },
) {
  return Type.Enum(values, { type: 'string', ...options });
}
