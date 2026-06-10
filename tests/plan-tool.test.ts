import { describe, expect, it } from 'vitest';
import {
  executePlanToolCall,
  extractLatestPlan,
  parsePlanPayload,
  planFromOutput,
} from '../core/tool/plan';
import type { ToolCall } from '../core/tool/types';
import { renderToolSchemas } from '../core/prompt/augmentation';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool/invocation';

function updatePlanCall(payload: Record<string, unknown>): ToolCall {
  return {
    name: 'update_plan',
    payload,
    raw: '<update_plan />',
  };
}

describe('parsePlanPayload', () => {
  it('parses a valid plan with explanation', () => {
    const parsed = parsePlanPayload({
      explanation: '先调查再修复',
      plan: [
        { step: '调查问题', status: 'completed' },
        { step: '修复代码', status: 'in_progress' },
        { step: '验证结果', status: 'pending' },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.plan.explanation).toBe('先调查再修复');
      expect(parsed.plan.items).toHaveLength(3);
    }
  });

  it('rejects an empty plan array', () => {
    const parsed = parsePlanPayload({ plan: [] });
    expect(parsed.ok).toBe(false);
  });

  it('rejects invalid statuses', () => {
    const parsed = parsePlanPayload({
      plan: [{ step: '步骤', status: 'doing' }],
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects empty step text', () => {
    const parsed = parsePlanPayload({
      plan: [{ step: '  ', status: 'pending' }],
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects more than one in_progress step', () => {
    const parsed = parsePlanPayload({
      plan: [
        { step: '步骤一', status: 'in_progress' },
        { step: '步骤二', status: 'in_progress' },
      ],
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('injected tool schema example', () => {
  it('renders an update_plan example payload that passes plan validation', () => {
    const schemas = renderToolSchemas(DEFAULT_TOOL_DESCRIPTORS);
    const match = schemas.match(/<update_plan>\n([\s\S]*?)\n<\/update_plan>/);
    expect(match).not.toBeNull();
    const parsed = parsePlanPayload(JSON.parse(match![1]));
    expect(parsed.ok).toBe(true);
  });
});

describe('executePlanToolCall', () => {
  it('returns the plan as structured output on success', async () => {
    const result = await executePlanToolCall(updatePlanCall({
      plan: [
        { step: '步骤一', status: 'completed' },
        { step: '步骤二', status: 'pending' },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('1/2');
    expect(result.output).toMatchObject({
      items: [
        { step: '步骤一', status: 'completed' },
        { step: '步骤二', status: 'pending' },
      ],
    });
  });

  it('fails on invalid payloads without throwing', async () => {
    const result = await executePlanToolCall(updatePlanCall({ plan: 'not-an-array' }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('plan_invalid_payload');
  });
});

describe('extractLatestPlan', () => {
  const planOutput = (steps: Array<{ step: string; status: string }>) => ({
    explanation: null,
    items: steps,
  });

  it('returns the most recent successful plan', () => {
    const plan = extractLatestPlan([
      {
        name: 'update_plan',
        result: { ok: true, output: planOutput([{ step: '旧计划', status: 'pending' }]) },
      },
      {
        name: 'web_search',
        result: { ok: true, output: { results: [] } },
      },
      {
        name: 'update_plan',
        result: { ok: true, output: planOutput([{ step: '新计划', status: 'in_progress' }]) },
      },
    ]);
    expect(plan).not.toBeNull();
    expect(plan?.items[0]?.step).toBe('新计划');
  });

  it('skips failed plan executions', () => {
    const plan = extractLatestPlan([
      {
        name: 'update_plan',
        result: { ok: true, output: planOutput([{ step: '有效计划', status: 'pending' }]) },
      },
      {
        name: 'update_plan',
        result: { ok: false, output: undefined },
      },
    ]);
    expect(plan?.items[0]?.step).toBe('有效计划');
  });

  it('returns null when no plan executions exist', () => {
    expect(extractLatestPlan([
      { name: 'web_search', result: { ok: true, output: {} } },
    ])).toBeNull();
  });
});

describe('planFromOutput', () => {
  it('parses plan output serialized as a JSON string', () => {
    const plan = planFromOutput(JSON.stringify({
      explanation: '说明',
      items: [{ step: '步骤', status: 'pending' }],
    }));
    expect(plan?.explanation).toBe('说明');
    expect(plan?.items).toHaveLength(1);
  });

  it('returns null for malformed values', () => {
    expect(planFromOutput('not json')).toBeNull();
    expect(planFromOutput({ items: [{ step: '', status: 'pending' }] })).toBeNull();
    expect(planFromOutput(42)).toBeNull();
  });
});
