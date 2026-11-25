import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { KnowledgeService } from './services/knowledge.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [ConfigModule],
  controllers: [ChatController],
  providers: [
    KnowledgeService,
    GeminiProvider,
    {
      provide: LLM_PROVIDER,
      useClass: GeminiProvider,
    },
    ChatService,
  ],
  exports: [ChatService, LLM_PROVIDER, KnowledgeService],
})
export class ChatModule {}
