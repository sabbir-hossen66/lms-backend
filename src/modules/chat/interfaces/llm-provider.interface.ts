export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const LLM_PROVIDER = 'LLM_PROVIDER';

export interface LlmProvider {
  readonly name: string;
  generateReply(
    prompt: string,
    history?: ChatMessage[],
    systemInstruction?: string,
  ): Promise<string>;
  generateStream(
    prompt: string,
    history?: ChatMessage[],
    systemInstruction?: string,
  ): AsyncGenerator<string, void, unknown>;
}
