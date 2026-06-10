import { describe, expect, it } from 'vitest';
import { buildContinuationPrompt, buildNudgePrompt } from '../core/inline-agent/prompt';
import { INLINE_AGENT_COMPACTION_KEEP_RECENT } from '../core/inline-agent/types';
import type { ToolExecutionRecord } from '../core/types';

function execution(name: string, overrides: Partial<ToolExecutionRecord['result']> = {}): ToolExecutionRecord {
  return {
    name,
    result: {
      ok: true,
      summary: `${name} 执行成功`,
      detail: `${name} detail`,
      output: { value: name },
      ...overrides,
    },
  };
}

function extractToolResults(prompt: string): Array<Record<string, unknown>> {
  const match = /<tool_results>\n([\s\S]*?)\n<\/tool_results>/.exec(prompt);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

describe('continuation prompt compaction', () => {
  it('keeps all results full when under the compaction threshold', () => {
    const executions = Array.from({ length: 3 }, (_, i) => execution(`tool_${i}`));
    const results = extractToolResults(buildContinuationPrompt('任务', executions));
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.compacted === undefined)).toBe(true);
    expect(results[0].detail).toBe('tool_0 detail');
  });

  it('compacts older results beyond the keep-recent window', () => {
    const total = INLINE_AGENT_COMPACTION_KEEP_RECENT + 4;
    const executions = Array.from({ length: total }, (_, i) => execution(`tool_${i}`));
    const results = extractToolResults(buildContinuationPrompt('任务', executions));

    expect(results).toHaveLength(total);
    for (let i = 0; i < 4; i++) {
      expect(results[i].compacted).toBe(true);
      expect(results[i].detail).toBeUndefined();
      expect(results[i].output).toBeUndefined();
      expect(results[i].summary).toBe(`tool_${i} 执行成功`);
    }
    for (let i = 4; i < total; i++) {
      expect(results[i].compacted).toBeUndefined();
      expect(results[i].detail).toBe(`tool_${i} detail`);
    }
  });
});

describe('plan section in prompts', () => {
  const planExecution: ToolExecutionRecord = {
    name: 'update_plan',
    result: {
      ok: true,
      summary: '计划已更新（1/2 完成）',
      output: {
        explanation: null,
        items: [
          { step: '调查问题', status: 'completed' },
          { step: '修复代码', status: 'in_progress' },
        ],
      },
    },
  };

  it('includes the latest plan in the continuation prompt', () => {
    const prompt = buildContinuationPrompt('任务', [planExecution]);
    expect(prompt).toContain('<current_plan>');
    expect(prompt).toContain('[x] 调查问题');
    expect(prompt).toContain('[>] 修复代码');
  });

  it('includes the latest plan in the nudge prompt', () => {
    const prompt = buildNudgePrompt('任务', '上轮文本', [planExecution], 0);
    expect(prompt).toContain('<current_plan>');
    expect(prompt).toContain('[>] 修复代码');
  });

  it('omits the plan section when no plan exists', () => {
    const prompt = buildContinuationPrompt('任务', [execution('web_search')]);
    expect(prompt).not.toContain('<current_plan>');
  });
});
