import type {
  JsonValue,
  ToolCall,
  ToolDescriptor,
  ToolProviderIdentity,
  ToolResult,
} from './types';

export const PLAN_ITEM_STATUSES = ['pending', 'in_progress', 'completed'] as const;

export type PlanItemStatus = typeof PLAN_ITEM_STATUSES[number];

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

export interface AgentPlan {
  explanation?: string;
  items: PlanItem[];
}

export const PLAN_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'plan',
  displayName: 'DeepSeek++ Plan',
  transport: 'in_process',
};

export const PLAN_TOOL_NAMES = ['update_plan'] as const;

export type PlanToolName = typeof PLAN_TOOL_NAMES[number];

export const PLAN_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    id: 'local:plan:update_plan',
    provider: PLAN_TOOL_PROVIDER,
    name: 'update_plan',
    invocationName: 'update_plan',
    title: '更新任务计划',
    description: '记录或更新当前任务的分步计划。多步任务开始时先调用一次列出全部步骤；每完成一步立即调用更新状态。最多一个步骤处于 in_progress。',
    inputSchema: {
      type: 'object',
      properties: {
        explanation: { type: 'string', description: '本次计划变更的简短说明（可选）' },
        plan: {
          type: 'array',
          description: '计划步骤列表',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: '步骤描述' },
              status: {
                type: 'string',
                enum: [...PLAN_ITEM_STATUSES],
                description: '步骤状态：pending、in_progress 或 completed',
              },
            },
            required: ['step', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
  },
];

export function isPlanToolName(name: string): name is PlanToolName {
  return (PLAN_TOOL_NAMES as readonly string[]).includes(name);
}

export async function executePlanToolCall(call: ToolCall): Promise<ToolResult> {
  if (call.name !== 'update_plan') {
    return failure(call, 'plan_tool_unsupported', '不支持的计划工具', `Unsupported plan tool: ${call.name}`);
  }

  const parsed = parsePlanPayload(call.payload);
  if (!parsed.ok) {
    return failure(call, 'plan_invalid_payload', '计划格式错误', parsed.error);
  }

  const plan = parsed.plan;
  const completed = plan.items.filter((item) => item.status === 'completed').length;
  return {
    ok: true,
    name: call.name,
    callId: call.id,
    descriptorId: call.descriptorId,
    provider: call.provider ?? PLAN_TOOL_PROVIDER,
    summary: `计划已更新（${completed}/${plan.items.length} 完成）`,
    detail: renderPlanLines(plan),
    output: planToJson(plan),
  };
}

export function parsePlanPayload(
  payload: Record<string, unknown>,
): { ok: true; plan: AgentPlan } | { ok: false; error: string } {
  const rawPlan = payload.plan;
  if (!Array.isArray(rawPlan) || rawPlan.length === 0) {
    return { ok: false, error: 'plan 必须是非空数组' };
  }

  const items: PlanItem[] = [];
  for (const entry of rawPlan) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: '每个计划项必须是包含 step 和 status 的对象' };
    }
    const { step, status } = entry as Record<string, unknown>;
    if (typeof step !== 'string' || step.trim().length === 0) {
      return { ok: false, error: 'step 必须是非空字符串' };
    }
    if (typeof status !== 'string' || !(PLAN_ITEM_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, error: `status 必须是 ${PLAN_ITEM_STATUSES.join('、')} 之一` };
    }
    items.push({ step: step.trim(), status: status as PlanItemStatus });
  }

  const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
  if (inProgressCount > 1) {
    return { ok: false, error: '最多只能有一个步骤处于 in_progress 状态' };
  }

  const explanation = typeof payload.explanation === 'string' && payload.explanation.trim()
    ? payload.explanation.trim()
    : undefined;

  return { ok: true, plan: { explanation, items } };
}

export interface PlanExecutionLike {
  name: string;
  result: {
    ok: boolean;
    output?: unknown;
  };
}

export function extractLatestPlan(executions: readonly PlanExecutionLike[]): AgentPlan | null {
  for (let i = executions.length - 1; i >= 0; i--) {
    const exec = executions[i];
    if (exec.name !== 'update_plan' || !exec.result.ok || exec.result.output == null) continue;
    const plan = planFromOutput(exec.result.output);
    if (plan) return plan;
  }
  return null;
}

export function planFromOutput(value: unknown): AgentPlan | null {
  let parsed: { explanation?: unknown; items?: unknown };
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as { explanation?: unknown; items?: unknown };
    } catch {
      return null;
    }
  } else if (value && typeof value === 'object') {
    parsed = value as { explanation?: unknown; items?: unknown };
  } else {
    return null;
  }

  if (!Array.isArray(parsed.items)) return null;
  const items: PlanItem[] = [];
  for (const entry of parsed.items) {
    if (!entry || typeof entry !== 'object') return null;
    const { step, status } = entry as Record<string, unknown>;
    if (typeof step !== 'string' || !step.trim() || typeof status !== 'string') return null;
    if (!(PLAN_ITEM_STATUSES as readonly string[]).includes(status)) return null;
    items.push({ step, status: status as PlanItemStatus });
  }
  return {
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : undefined,
    items,
  };
}

export function renderPlanLines(plan: AgentPlan): string {
  const marks: Record<PlanItemStatus, string> = {
    pending: '[ ]',
    in_progress: '[>]',
    completed: '[x]',
  };
  return plan.items.map((item) => `${marks[item.status]} ${item.step}`).join('\n');
}

function planToJson(plan: AgentPlan): JsonValue {
  return {
    explanation: plan.explanation ?? null,
    items: plan.items.map((item) => ({ step: item.step, status: item.status })),
  };
}

function failure(call: ToolCall, code: string, summary: string, detail: string): ToolResult {
  return {
    ok: false,
    name: call.name,
    callId: call.id,
    descriptorId: call.descriptorId,
    provider: call.provider ?? PLAN_TOOL_PROVIDER,
    summary,
    detail,
    error: {
      code,
      message: detail,
      retryable: false,
    },
  };
}
