import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FSWatcher, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  ResponseRule,
  ResponseRuleType,
} from './interfaces/response-rule.interface';

interface CompiledRule {
  rule: ResponseRule;
  /** Pre-compiled regex for `regex` rules; undefined for `contains`. */
  regex?: RegExp;
}

/**
 * Loads response rules from the configured JSON file, recompiles them, and
 * hot-reloads automatically when the file changes (without restarting the
 * server). Exposes `match()` to resolve a prompt to a response string.
 */
@Injectable()
export class ResponsesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResponsesService.name);
  private readonly responsesPath: string;
  private compiledRules: CompiledRule[] = [];
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('app.responsesFile', './responses.json');
    this.responsesPath = isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }

  async onModuleInit(): Promise<void> {
    await this.loadRules();
    this.startWatching();
  }

  onModuleDestroy(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.watcher?.close();
  }

  /** Number of currently loaded rules (used by health/diagnostics). */
  get ruleCount(): number {
    return this.compiledRules.length;
  }

  /**
   * Returns the response for the rule whose value matches LATEST in `prompt`
   * (highest match position). Ties broken by rule definition order. If the
   * client sends a concatenated conversation history, this picks the rule
   * for the latest turn rather than the earliest. Returns `undefined` if
   * nothing matches (caller falls back to DEFAULT_RESPONSE).
   */
  match(prompt: string): { ruleId: string; response: string } | undefined {
    const haystack = prompt.toLowerCase();
    let best: { ruleId: string; response: string; position: number } | undefined;

    for (const compiled of this.compiledRules) {
      const position = this.matchPosition(compiled, prompt, haystack);
      if (position < 0) continue;
      if (!best || position > best.position) {
        best = {
          ruleId: compiled.rule.id,
          response: compiled.rule.response,
          position,
        };
      }
    }

    return best
      ? { ruleId: best.ruleId, response: best.response }
      : undefined;
  }

  private matchPosition(
    compiled: CompiledRule,
    rawPrompt: string,
    lowerPrompt: string,
  ): number {
    if (compiled.regex) {
      compiled.regex.lastIndex = 0;
      const m = compiled.regex.exec(rawPrompt);
      return m === null ? -1 : m.index;
    }
    return lowerPrompt.lastIndexOf(compiled.rule.value.toLowerCase());
  }

  private async loadRules(): Promise<void> {
    try {
      const raw = await readFile(this.responsesPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error('Responses file must contain a JSON array of rules');
      }

      const compiled: CompiledRule[] = [];
      for (const entry of parsed) {
        const rule = this.validateRule(entry);
        if (!rule) {
          continue;
        }
        compiled.push(this.compileRule(rule));
      }

      this.compiledRules = compiled;
      this.logger.log(
        `Responses reloaded from ${basename(this.responsesPath)} (${compiled.length} rule(s))`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load responses from ${this.responsesPath}: ${(error as Error).message}`,
      );
      // Keep the previously loaded rules on a failed reload so a bad edit
      // does not blank out the server.
    }
  }

  private validateRule(entry: unknown): ResponseRule | undefined {
    if (typeof entry !== 'object' || entry === null) {
      this.logger.warn('Skipping rule: not an object');
      return undefined;
    }
    const candidate = entry as Record<string, unknown>;
    const { id, type, value, response } = candidate;

    if (typeof id !== 'string' || id.trim() === '') {
      this.logger.warn('Skipping rule: missing/invalid "id"');
      return undefined;
    }
    if (type !== 'contains' && type !== 'regex') {
      this.logger.warn(`Skipping rule "${id}": "type" must be contains|regex`);
      return undefined;
    }
    if (typeof value !== 'string' || value === '') {
      this.logger.warn(`Skipping rule "${id}": missing/invalid "value"`);
      return undefined;
    }
    if (typeof response !== 'string') {
      this.logger.warn(`Skipping rule "${id}": missing/invalid "response"`);
      return undefined;
    }

    return { id, type: type as ResponseRuleType, value, response };
  }

  private compileRule(rule: ResponseRule): CompiledRule {
    if (rule.type === 'regex') {
      try {
        // `i` for case-insensitive matching per spec.
        return { rule, regex: new RegExp(rule.value, 'i') };
      } catch (error) {
        this.logger.warn(
          `Rule "${rule.id}": invalid regex (${(error as Error).message}); treating as literal contains`,
        );
        return { rule };
      }
    }
    return { rule };
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.responsesPath, (eventType) => {
        if (eventType !== 'change' && eventType !== 'rename') {
          return;
        }
        // Debounce: editors often emit several events for one save.
        if (this.reloadTimer) {
          clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
          void this.loadRules();
        }, 150);
      });
      this.logger.log(`Watching ${this.responsesPath} for changes`);
    } catch (error) {
      this.logger.warn(
        `Could not watch responses file for hot-reload: ${(error as Error).message}`,
      );
    }
  }
}
