import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'

export type RenovateProvider = 'anthropic' | 'openai' | 'google'

export interface VisionImage {
  dataUrl: string
}

export interface VisionRequest {
  prompt: string
  images?: VisionImage[]
  maxTokens?: number
}

function env(key: string): string | undefined {
  return process.env[key]
}

export function resolveProvider(): RenovateProvider | null {
  const forced = env('RENOVATE_PROVIDER')?.toLowerCase()
  if (forced === 'anthropic' || forced === 'openai' || forced === 'google') {
    if (hasKeyFor(forced)) return forced
    return null
  }

  if (env('ANTHROPIC_API_KEY')) return 'anthropic'
  if (env('OPENAI_API_KEY')) return 'openai'
  if (env('GOOGLE_GENERATIVE_AI_API_KEY') || env('GEMINI_API_KEY')) return 'google'
  return null
}

function hasKeyFor(provider: RenovateProvider): boolean {
  if (provider === 'anthropic') return Boolean(env('ANTHROPIC_API_KEY'))
  if (provider === 'openai') return Boolean(env('OPENAI_API_KEY'))
  return Boolean(env('GOOGLE_GENERATIVE_AI_API_KEY') || env('GEMINI_API_KEY'))
}

export function providerLabel(provider: RenovateProvider): string {
  if (provider === 'anthropic') return 'Claude'
  if (provider === 'openai') return 'OpenAI'
  return 'Gemini'
}

function mediaTypeFromDataUrl(url: string): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
  const m = /^data:([^;,]+)?/.exec(url)
  const mt = m?.[1] ?? 'image/jpeg'
  if (mt === 'image/png') return 'image/png'
  if (mt === 'image/webp') return 'image/webp'
  if (mt === 'image/gif') return 'image/gif'
  return 'image/jpeg'
}

function dataUrlPayload(url: string): string {
  const m = /^data:[^;,]*(?:;base64)?,(.*)$/.exec(url)
  return m?.[1] ?? ''
}

function anthropicModel(): string {
  return env('CLAUDE_MODEL') ?? env('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5'
}

function openaiModel(): string {
  return env('OPENAI_MODEL') ?? 'gpt-4o'
}

function geminiModel(): string {
  return env('GEMINI_MODEL') ?? 'gemini-2.0-flash'
}

async function completeAnthropic(request: VisionRequest): Promise<string> {
  const key = env('ANTHROPIC_API_KEY')
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')
  const client = new Anthropic({ apiKey: key })

  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: request.prompt }]
  for (const image of request.images ?? []) {
    if (!image.dataUrl.startsWith('data:')) continue
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaTypeFromDataUrl(image.dataUrl),
        data: dataUrlPayload(image.dataUrl),
      },
    })
  }

  const response = await client.messages.create({
    model: anthropicModel(),
    max_tokens: request.maxTokens ?? 2048,
    messages: [{ role: 'user', content }],
  })

  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
}

async function completeOpenAI(request: VisionRequest): Promise<string> {
  const key = env('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY not set')
  const client = new OpenAI({ apiKey: key })

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: request.prompt },
  ]
  for (const image of request.images ?? []) {
    if (!image.dataUrl.startsWith('data:')) continue
    content.push({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    })
  }

  const response = await client.chat.completions.create({
    model: openaiModel(),
    max_tokens: request.maxTokens ?? 2048,
    messages: [{ role: 'user', content }],
  })

  return response.choices[0]?.message?.content ?? ''
}

async function completeGoogle(request: VisionRequest): Promise<string> {
  const key = env('GOOGLE_GENERATIVE_AI_API_KEY') ?? env('GEMINI_API_KEY')
  if (!key) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) not set')

  const client = new GoogleGenerativeAI(key)
  const model = client.getGenerativeModel({ model: geminiModel() })

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: request.prompt },
  ]
  for (const image of request.images ?? []) {
    if (!image.dataUrl.startsWith('data:')) continue
    parts.push({
      inlineData: {
        data: dataUrlPayload(image.dataUrl),
        mimeType: mediaTypeFromDataUrl(image.dataUrl),
      },
    })
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: request.maxTokens ?? 2048 },
  })

  return result.response.text()
}

export async function completeVision(
  provider: RenovateProvider,
  request: VisionRequest,
): Promise<string> {
  if (provider === 'anthropic') return completeAnthropic(request)
  if (provider === 'openai') return completeOpenAI(request)
  return completeGoogle(request)
}
