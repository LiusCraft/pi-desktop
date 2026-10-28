export interface SkillMessage {
  name: string;
  /** The skill's instructions, as expanded by the agent. */
  content: string;
  /** What the user typed after `/skill:name`. */
  args: string;
}

/** `/skill:name args` reaches the model as a `<skill>` block followed by the args; this reads it back. */
export function decodeSkillMessage(text: string): SkillMessage | null {
  const m = /^<skill name="([^"]+)" location="[^"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(text);
  return m ? { name: m[1], content: m[2], args: m[3] ?? '' } : null;
}
