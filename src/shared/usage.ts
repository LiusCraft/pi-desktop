/** Prompt tokens of one model call or of a whole session, split by how the provider served them. */
export interface PromptTokens {
  /** Sent uncached. */
  input: number;
  /** Read from the provider's prompt cache. */
  cacheRead: number;
  /** Written to the prompt cache for later calls. */
  cacheWrite: number;
}

/**
 * Share of the prompt tokens served from the cache (0-1), or null when the
 * provider never reported any cache activity: there is no rate to show.
 */
export function cacheHitRate({ input, cacheRead, cacheWrite }: PromptTokens): number | null {
  const prompt = input + cacheRead + cacheWrite;
  if (prompt <= 0 || cacheRead + cacheWrite <= 0) return null;
  return cacheRead / prompt;
}
