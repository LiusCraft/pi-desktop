// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { expect, it, vi } from 'vitest';
const { resolveCodeProject } = await import('../src/renderer/src/lib/code-project');

it.each(['linked', 'skipped'])('does not open a picker when the host says %s', async (result) => {
  invoke.mockResolvedValue(result);
  const pick = vi.fn();
  await resolveCodeProject('/repo', pick);
  expect(pick).not.toHaveBeenCalled();
});

it('asks once, submits the exact selected folder, and does not submit on cancel', async () => {
  invoke.mockResolvedValue('ask');
  const pick = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('/my/notes');
  await Promise.all([resolveCodeProject('/repo', pick), resolveCodeProject('/repo', pick)]);
  expect(invoke.mock.calls).toEqual([['work:resolveCode', '/repo']]);
  expect(pick).toHaveBeenCalledTimes(1);
  await resolveCodeProject('/repo', pick);
  expect(invoke).toHaveBeenLastCalledWith('work:resolveCode', '/repo', '/my/notes');
});
