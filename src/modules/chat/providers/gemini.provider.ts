import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChatMessage, LlmProvider } from '../interfaces/llm-provider.interface';

@Injectable()
export class GeminiProvider implements LlmProvider {
  public readonly name = 'Google Gemini API';
  private readonly logger = new Logger(GeminiProvider.name);
  private genAI: GoogleGenerativeAI | null = null;
  // Models in preference order: flash-lite-latest is super fast and available on free tier
  private readonly candidateModels = [
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-2.5-flash',
  ];

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.getApiKey();
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.logger.log(`Initialized GeminiProvider (preferred model: ${this.candidateModels[0]})`);
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not configured. GeminiProvider will return fallback messages until an API key is set.',
      );
    }
  }

  private getApiKey(): string | undefined {
    return (
      process.env.GEMINI_API_KEY?.trim() ||
      this.configService.get<string>('GEMINI_API_KEY')?.trim()
    );
  }

  private getClient(): GoogleGenerativeAI | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;
    if (!this.genAI) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  private mapHistory(history: ChatMessage[] = []) {
    return history.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    }));
  }

  async generateReply(
    prompt: string,
    history: ChatMessage[] = [],
    systemInstruction?: string,
  ): Promise<string> {
    const client = this.getClient();
    if (!client) {
      return (
        'Sabbir Academy AI Assistant: বর্তমানে ফ্রি Gemini API Key সেট করা নেই। ' +
        'অনুগ্রহ করে সরাসরি সাব্বির ভাইয়ের সাথে WhatsApp (+880 1783-780066) অথবা ইমেইলে (sabbir.ms2000@gmail.com) যোগাযোগ করুন।'
      );
    }

    const contents = [
      ...this.mapHistory(history),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    let lastError: any = null;

    for (const modelName of this.candidateModels) {
      try {
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction
            ? { role: 'system', parts: [{ text: systemInstruction }] }
            : undefined,
        });

        const response = await model.generateContent({ contents });
        const text = response.response.text();
        if (text) {
          return text;
        }
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Model ${modelName} failed: ${error?.message || error}. Trying fallback...`);
      }
    }

    this.logger.error('All Gemini models failed:', lastError?.message || lastError);
    if (
      lastError?.status === 429 ||
      lastError?.message?.includes('429') ||
      lastError?.message?.includes('RESOURCE_EXHAUSTED')
    ) {
      return (
        'বর্তমানে ফ্রি API কোটা সাময়িকভাবে শেষ। অনুগ্রহ করে কিছু সময় পর আবার ট্রাই করুন অথবা ' +
        'সরাসরি সাব্বির ভাইয়ের সাথে WhatsApp (+880 1783-780066) এ যোগাযোগ করুন।'
      );
    }

    return (
      'আমি এই মুহূর্তে উত্তর দিতে পারছি না। অনুগ্রহ করে সাব্বির একাডেমির সাথে সরাসরি যোগাযোগ করুন: ' +
      'WhatsApp: +880 1783-780066 | Email: sabbir.ms2000@gmail.com'
    );
  }

  async *generateStream(
    prompt: string,
    history: ChatMessage[] = [],
    systemInstruction?: string,
  ): AsyncGenerator<string, void, unknown> {
    const client = this.getClient();
    if (!client) {
      yield 'Sabbir Academy AI: বর্তমানে Gemini API Key কনফিগার করা নেই। অনুগ্রহ করে সাব্বির ভাইয়ের সাথে সরাসরি WhatsApp (+880 1783-780066) এ যোগাযোগ করুন।';
      return;
    }

    const contents = [
      ...this.mapHistory(history),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    let streamedAny = false;
    let lastError: any = null;

    for (const modelName of this.candidateModels) {
      try {
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction
            ? { role: 'system', parts: [{ text: systemInstruction }] }
            : undefined,
        });

        const result = await model.generateContentStream({ contents });
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            streamedAny = true;
            yield text;
          }
        }

        if (streamedAny) {
          return;
        }
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Stream model ${modelName} failed: ${error?.message || error}. Trying fallback...`);
        if (streamedAny) {
          // If we already started streaming tokens to client, stop here
          return;
        }
      }
    }

    this.logger.error('All Gemini streaming models failed:', lastError?.message || lastError);
    if (lastError?.status === 429 || lastError?.message?.includes('RESOURCE_EXHAUSTED')) {
      yield 'API কোটা সাময়িকভাবে শেষ। অনুগ্রহ করে সরাসরি WhatsApp (+880 1783-780066) এ মেসেজ দিন।';
    } else {
      yield 'দুঃখিত, কোনো টেকনিক্যাল সমস্যার কারণে উত্তর দেওয়া যাচ্ছে না। অনুগ্রহ করে সরাসরি সাব্বির ভাইয়ের সাথে যোগাযোগ করুন (+880 1783-780066)।';
    }
  }
}
