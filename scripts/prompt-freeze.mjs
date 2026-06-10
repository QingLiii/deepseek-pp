#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_HASHES = {
  systemTemplateChat: '5bca8e90d23381c9605cbfebf7ecb91f28f4010ddbc2a6ccc291fa046fcd6eec',
  systemTemplateThinking: 'fa31e863e5f54f7a4e48cffdbae0e543028de4a565f77504e66edd707c73b5f3',
  memoryToolSchemas: 'a64e0a8874552177eba10089d5acfdc2996d0b703f83b1a57e9d76c733da9a7b',
  promptAugmentationBuild: '1b42d5b8df743388dfb86ee83e055e00a56fb5389bd7df1afd961c57b45b2335',
  promptToolSchemaRenderer: '485476d25877b988ca4b253d72f9c691354044790fd6f1464e538075ce9bf3e9',
  inlineAgentContinuationPrompt: 'e705ca1110aec9d3f499e43deb620447c61542c09655dcced398d432ffb02119',
  inlineAgentNudgePrompt: 'dcc88afa3e5b1b9de3236918543cabba483ff78e90ea2c044e372c36d2418fbb',
  inlineAgentFinalizationPrompt: 'a476d1b4ad4d8f1895e2f1bedeacbc41932257c359106d7c9ecd090e7abff5da',
  inlineAgentPromptHelpers: '034242c02ffb4d3d759267499f59cd76eb50c653e56c38ac02ca0016152c5047',
};

const sources = {
  constants: readSource('core/constants.ts'),
  augmentation: readSource('core/prompt/augmentation.ts'),
  inlinePrompt: readSource('core/inline-agent/prompt.ts'),
};

const cases = {
  systemTemplateChat: extractRegex(
    'SYSTEM_TEMPLATE_CHAT',
    sources.constants,
    /export const SYSTEM_TEMPLATE_CHAT = `[\s\S]*?`;\n/,
  ),
  systemTemplateThinking: extractRegex(
    'SYSTEM_TEMPLATE_THINKING',
    sources.constants,
    /export const SYSTEM_TEMPLATE_THINKING = `[\s\S]*?`;\n/,
  ),
  memoryToolSchemas: [
    extractRegex('MEMORY_SAVE_SCHEMA', sources.constants, /export const MEMORY_SAVE_SCHEMA = '[\s\S]*?';\n/),
    extractRegex('MEMORY_UPDATE_SCHEMA', sources.constants, /export const MEMORY_UPDATE_SCHEMA = '[\s\S]*?';\n/),
    extractRegex('MEMORY_DELETE_SCHEMA', sources.constants, /export const MEMORY_DELETE_SCHEMA = '[\s\S]*?';\n/),
  ].join('\n'),
  promptAugmentationBuild: extractFunction('buildPromptAugmentation', sources.augmentation),
  promptToolSchemaRenderer: [
    extractFunction('renderToolSchemas', sources.augmentation),
    extractFunction('renderWebSearchGuidance', sources.augmentation),
    extractFunction('renderToolSchema', sources.augmentation),
    extractFunction('renderShellMcpHint', sources.augmentation),
    extractFunction('renderPythonMcpHint', sources.augmentation),
    extractFunction('renderToolFormatReminder', sources.augmentation),
    extractFunction('createExamplePayload', sources.augmentation),
    extractFunction('exampleValue', sources.augmentation),
  ].join('\n\n'),
  inlineAgentContinuationPrompt: extractFunction('buildContinuationPrompt', sources.inlinePrompt),
  inlineAgentNudgePrompt: extractFunction('buildNudgePrompt', sources.inlinePrompt),
  inlineAgentFinalizationPrompt: extractFunction('buildFinalizationPrompt', sources.inlinePrompt),
  inlineAgentPromptHelpers: [
    extractFunction('extractTaskCompleteSignal', sources.inlinePrompt),
    extractFunction('shouldNudge', sources.inlinePrompt),
    extractFunction('renderPlanSection', sources.inlinePrompt),
    extractFunction('renderToolResults', sources.inlinePrompt),
    extractFunction('renderCompactedToolResult', sources.inlinePrompt),
    extractFunction('renderFullToolResult', sources.inlinePrompt),
    extractFunction('clampText', sources.inlinePrompt),
  ].join('\n\n'),
};

const failures = [];
for (const [name, text] of Object.entries(cases)) {
  const actual = sha256(text);
  const expected = EXPECTED_HASHES[name];
  if (actual !== expected) {
    failures.push(`${name}: expected ${expected}, got ${actual}`);
  }
}

if (failures.length > 0) {
  console.error('Prompt freeze failed: prompt-generating source changed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Prompt freeze passed: ${Object.keys(cases).length} cases`);

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function extractRegex(name, text, regex) {
  const match = regex.exec(text);
  if (!match) throw new Error(`Prompt freeze case not found: ${name}`);
  return match[0];
}

function extractFunction(name, text) {
  const start = text.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Prompt freeze function not found: ${name}`);

  const openingBrace = text.indexOf('{', start);
  if (openingBrace < 0) throw new Error(`Prompt freeze function has no body: ${name}`);

  let depth = 0;
  for (let i = openingBrace; i < text.length; i++) {
    const char = text[i];
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error(`Prompt freeze function is not closed: ${name}`);
}
