import { describe, expect, expectTypeOf, it } from 'vitest';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { StringEnum } from '../src/agent/tool-schema';

describe('tool string enums', () => {
  it('emits a plain string enum without anyOf/const', () => {
    const schema = StringEnum(['list', 'add'], { description: 'Action', default: 'list' });
    expect(JSON.parse(JSON.stringify(schema))).toEqual({
      type: 'string',
      enum: ['list', 'add'],
      description: 'Action',
      default: 'list',
    });
  });

  it('preserves literal unions and optional fields inside TypeBox objects', () => {
    const schema = Type.Object({
      action: StringEnum(['list', 'add'] as const),
      scope: Type.Optional(StringEnum(['user', 'project'] as const)),
    });
    expectTypeOf<Static<typeof schema>>().toEqualTypeOf<{
      action: 'list' | 'add';
      scope?: 'user' | 'project';
    }>();
    expect(Value.Check(schema, { action: 'list' })).toBe(true);
    expect(Value.Check(schema, { action: 'add', scope: 'project' })).toBe(true);
    expect(Value.Check(schema, { action: 'delete' })).toBe(false);
    expect(Value.Check(schema, { action: 'add', scope: 'invalid' })).toBe(false);
  });

  it('accepts runtime-generated choices', () => {
    const choices: string[] = ['explore', 'plan'];
    const schema = StringEnum(choices);
    expectTypeOf<Static<typeof schema>>().toEqualTypeOf<string>();
    expect(Value.Check(schema, 'explore')).toBe(true);
    expect(Value.Check(schema, 'unknown')).toBe(false);
  });
});
