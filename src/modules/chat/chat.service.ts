import { Inject, Injectable } from '@nestjs/common';
import { LLM_PROVIDER, LlmProvider } from './interfaces/llm-provider.interface';
import { KnowledgeService } from './services/knowledge.service';
import { ChatDto, HistoryItemDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llmProvider: LlmProvider,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  private buildSystemPrompt(): string {
    const knowledgeBase = this.knowledgeService.getKnowledgeBase();

    return `
You are the official, friendly, and helpful AI Assistant for "Sabbir Academy" (https://sabbir-lms.vercel.app).
Founded and taught by Sabbir Hossen (Software Engineer at Sofof Tech, CSE - AMUST).

YOUR STRICT INSTRUCTIONS & RULES:
1. Grounded Knowledge Only: Answer questions ONLY using the official Knowledge Base provided below.
2. If Information is Missing or Unknown: Politely say that you do not have that specific information and warmly guide the user to contact Sabbir Hossen directly via WhatsApp (+880 1783-780066) or email (sabbir.ms2000@gmail.com). Never hallucinate or invent fake course dates, pricing, or contact info.
3. Language Adaptation: Automatically detect and respond in the exact same language as the visitor (Bangla, English, or conversational Banglish).
4. Tone & Brevity: Keep responses short, concise, polite, encouraging, and friendly. Avoid long essays.
5. Formatting: Use neat markdown bullet points or short paragraphs when helpful.

=== OFFICIAL KNOWLEDGE BASE ===
${knowledgeBase}
===============================
`.trim();
  }

  private sanitizeHistory(history?: HistoryItemDto[]): HistoryItemDto[] {
    if (!history || !Array.isArray(history)) return [];
    // Keep at most the last 10 messages to optimize context and adhere to rate limits
    return history.slice(-10);
  }

  async answerQuestion(dto: ChatDto): Promise<{ reply: string }> {
    const systemPrompt = this.buildSystemPrompt();
    const history = this.sanitizeHistory(dto.history);
    const reply = await this.llmProvider.generateReply(
      dto.message,
      history,
      systemPrompt,
    );

    return { reply };
  }

  streamAnswer(dto: ChatDto): AsyncGenerator<string, void, unknown> {
    const systemPrompt = this.buildSystemPrompt();
    const history = this.sanitizeHistory(dto.history);
    return this.llmProvider.generateStream(
      dto.message,
      history,
      systemPrompt,
    );
  }
}
