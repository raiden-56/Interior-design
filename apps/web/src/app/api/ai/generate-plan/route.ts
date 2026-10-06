import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { PLAN_AUTHORING_GUIDE, PLAN_SPEC_JSON_SCHEMA, catalogForPrompt, extractJsonObject, planSpecToProject, type PlanSpec } from '@/lib/ai-plan';

/**
 * "Build a plan from a description" with the user's own API key.
 *
 * The key arrives with the request and is used for exactly one call; nothing
 * is stored on the server (the browser keeps it in localStorage only if the
 * person ticked "remember"). Both providers are asked for a `PlanSpec` under a
 * JSON schema, and the answer is converted and validated by the same code the
 * MCP tools use, so a hallucinated chair or a door off its wall is dropped
 * with a note rather than written into the model.
 *
 * Runs on the Node runtime; a full two-storey plan can take a minute or two.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

type Provider = 'anthropic' | 'openai';

interface Body {
  provider?: Provider;
  apiKey?: string;
  model?: string;
  brief?: string;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
};

function userPrompt(brief: string): string {
  const catalog = catalogForPrompt()
    .map((a) => `${a.id} (${a.w}×${a.d}×${a.h}${a.mounted ? ', mounted' : ''})`)
    .join('; ');
  return `Design brief:\n${brief.trim()}\n\nFurniture catalog (id (w×d×h m)):\n${catalog}\n\nReturn the PlanSpec JSON only.`;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }
  const provider: Provider = body.provider === 'openai' ? 'openai' : 'anthropic';
  const apiKey = (body.apiKey ?? '').trim();
  const brief = (body.brief ?? '').trim();
  const model = (body.model ?? '').trim() || DEFAULT_MODELS[provider];
  if (!apiKey) return NextResponse.json({ error: 'An API key is required.' }, { status: 400 });
  if (brief.length < 10) return NextResponse.json({ error: 'Describe the home in a sentence or two first.' }, { status: 400 });
  if (brief.length > 4000) return NextResponse.json({ error: 'Keep the brief under 4000 characters.' }, { status: 400 });

  try {
    const { spec, engine, note } = provider === 'anthropic' ? await withAnthropic(apiKey, model, brief) : await withOpenAI(apiKey, model, brief);
    if (!spec) return NextResponse.json({ error: note ?? 'The model returned no plan.' }, { status: 502 });
    const { project, notes, warnings } = planSpecToProject(spec);
    if (project.floors.every((f) => f.walls.length === 0)) {
      return NextResponse.json({ error: 'The model answered, but without any walls. Try a more specific brief.', notes }, { status: 502 });
    }
    return NextResponse.json({ project, notes, warnings, engine });
  } catch (err) {
    const { status, message } = describeError(err, provider);
    return NextResponse.json({ error: message }, { status });
  }
}

async function withAnthropic(apiKey: string, model: string, brief: string): Promise<{ spec: PlanSpec | null; engine: string; note?: string }> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 280_000 });
  // Streaming keeps a long plan under the request timeout; the server-side
  // fallback re-runs a declined request on another model inside the same call.
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 48_000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: PLAN_SPEC_JSON_SCHEMA as unknown as Record<string, unknown> } },
    system: PLAN_AUTHORING_GUIDE,
    messages: [{ role: 'user', content: userPrompt(brief) }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') return { spec: null, engine: message.model, note: 'The model declined this request.' };
  if (message.stop_reason === 'max_tokens') return { spec: null, engine: message.model, note: 'The plan was too long to return; ask for a smaller home.' };
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { spec: extractJsonObject(text) as PlanSpec, engine: message.model };
}

async function withOpenAI(apiKey: string, model: string, brief: string): Promise<{ spec: PlanSpec | null; engine: string; note?: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: PLAN_AUTHORING_GUIDE },
        { role: 'user', content: userPrompt(brief) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'plan_spec', strict: true, schema: PLAN_SPEC_JSON_SCHEMA } },
    }),
    signal: AbortSignal.timeout(280_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[]; model?: string };
  if (!res.ok) {
    const e = new Error(data.error?.message ?? `OpenAI error ${res.status}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) return { spec: null, engine: data.model ?? model, note: 'The model declined this request.' };
  if (choice?.finish_reason === 'length') return { spec: null, engine: data.model ?? model, note: 'The plan was too long to return; ask for a smaller home.' };
  const text = choice?.message?.content ?? '';
  return { spec: extractJsonObject(text) as PlanSpec, engine: data.model ?? model };
}

function describeError(err: unknown, provider: Provider): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) return { status: 401, message: 'Claude rejected the API key.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: 'Claude is rate limiting this key; try again in a moment.' };
  if (err instanceof Anthropic.BadRequestError) return { status: 400, message: `Claude rejected the request: ${err.message}` };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `Claude API error ${err.status ?? ''}: ${err.message}` };
  const status = (err as { status?: number })?.status;
  if (provider === 'openai' && status === 401) return { status: 401, message: 'OpenAI rejected the API key.' };
  if (provider === 'openai' && status === 429) return { status: 429, message: 'OpenAI is rate limiting this key; try again in a moment.' };
  if (err instanceof SyntaxError) return { status: 502, message: 'The model returned something that was not a plan. Try again or rephrase.' };
  return { status: status && status >= 400 ? status : 502, message: err instanceof Error ? err.message : 'Generation failed' };
}
