import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private cachedKnowledge = '';

  onModuleInit() {
    this.reloadKnowledgeBase();
  }

  public reloadKnowledgeBase(): string {
    const knowledgeDir = path.join(process.cwd(), 'knowledge');
    let combinedContent = '';

    try {
      if (fs.existsSync(knowledgeDir)) {
        const files = fs.readdirSync(knowledgeDir);
        for (const file of files) {
          if (file.endsWith('.md') || file.endsWith('.txt')) {
            const filePath = path.join(knowledgeDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            combinedContent += `\n\n--- Source: ${file} ---\n` + content;
          } else if (file.endsWith('.json')) {
            const filePath = path.join(knowledgeDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            combinedContent += `\n\n--- Source: ${file} (JSON) ---\n` + content;
          }
        }
      } else {
        this.logger.warn(`Knowledge directory not found at ${knowledgeDir}. Creating folder...`);
        fs.mkdirSync(knowledgeDir, { recursive: true });
      }

      this.cachedKnowledge = combinedContent.trim();
      this.logger.log(
        `Knowledge base loaded successfully (${this.cachedKnowledge.length} chars).`,
      );
    } catch (error) {
      this.logger.error('Failed to load knowledge base files', error);
      this.cachedKnowledge = '';
    }

    return this.cachedKnowledge;
  }

  public getKnowledgeBase(): string {
    if (!this.cachedKnowledge) {
      return this.reloadKnowledgeBase();
    }
    return this.cachedKnowledge;
  }
}
