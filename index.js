/** Installable DeepSeek Harness Host plugin. First-party imports resolve from the Harness installation. */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { renderSkillContent } from '@deepseek-ai/dsh-skill';
import { defaultStateDir } from './src/storage.mjs';
import { install } from './src/host.mjs';
export const name = 'session-skill-switch';
export const inject = ['agents', 'skills', 'tools', 'commands'];
export const Config = z.object({
  stateDir: z.string().default(defaultStateDir()),
  commonSkills: z.array(z.string()).default([]),
  optionalSkills: z.array(z.string()).default([]),
  catalogDescriptionMaxLength: z.number().default(500),
});
export function apply(ctx, config = {}) { install(ctx, config, { createUserMessage, renderSkillContent }); }
