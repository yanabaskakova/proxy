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
  RecordedChunk,
  ResponseRule,
  ResponseRuleType,
} from './interfaces/response-rule.interface';

interface CompiledRule {
  rule: ResponseRule;
  /** Pre-compiled regex for `regex` rules; undefined for `contains`. */
  regex?: RegExp;
}

interface RuleBundle {
  /** Pattern (model-name substring) this bundle is keyed under; '' = default. */
  pattern: string;
  /** Absolute path on disk. */
  path: string;
  rules: CompiledRule[];
  watcher?: FSWatcher;
  reloadTimer?: NodeJS.Timeout;
}

/**
 * Loads response rules from one or more JSON files, recompiles them, and
 * hot-reloads automatically when each file changes. The default bundle is
 * `RESPONSES_FILE`; optional per-model bundles come from
 * `RESPONSES_FILES_BY_MODEL` (JSON map of pattern → filepath). When
 * `match()` is called with a `model`, bundles whose pattern is contained in
 * the model name are checked in insertion order, falling back to the
 * default bundle.
 */
@Injectable()
export class ResponsesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResponsesService.name);
  private readonly bundles: RuleBundle[] = [];

  constructor(private readonly config: ConfigService) {
    const defaultPath = this.config.get<string>(
      'app.responsesFile',
      './responses.json',
    );
    this.bundles.push(this.makeBundle('', defaultPath));

    const overrides = this.config.get<Record<string, string>>(
      'app.responsesFilesByModel',
      {},
    );
    for (const [pattern, path] of Object.entries(overrides)) {
      this.bundles.push(this.makeBundle(pattern, path));
    }
  }

  private makeBundle(pattern: string, configured: string): RuleBundle {
    const path = isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
    return { pattern, path, rules: [] };
  }

  async onModuleInit(): Promise<void> {
    for (const bundle of this.bundles) {
      await this.loadBundle(bundle);
      this.watchBundle(bundle);
    }
  }

  onModuleDestroy(): void {
    for (const bundle of this.bundles) {
      if (bundle.reloadTimer) clearTimeout(bundle.reloadTimer);
      bundle.watcher?.close();
    }
  }

  /** Total rules across all bundles (used by health/diagnostics). */
  get ruleCount(): number {
    return this.bundles.reduce((sum, b) => sum + b.rules.length, 0);
  }

  /**
   * Returns the response for the rule whose value matches LATEST in `prompt`
   * (highest match position) within the bundle selected by `model`. Ties
   * broken by rule definition order. Returns `undefined` if nothing matches
   * (caller falls back to DEFAULT_RESPONSE).
   *
   * Bundle selection: the first override bundle whose pattern is contained
   * in the model name wins; otherwise the default bundle is used.
   */
  match(
    prompt: string,
    model?: string,
  ):
    | { ruleId: string; response: string; chunks?: RecordedChunk[] }
    | undefined {
    const bundle = this.selectBundle(model);
    const haystack = prompt.toLowerCase();
    let best:
      | {
          ruleId: string;
          response: string;
          chunks?: RecordedChunk[];
          position: number;
        }
      | undefined;

    for (const compiled of bundle.rules) {
      const position = this.matchPosition(compiled, prompt, haystack);
      if (position < 0) continue;
      if (!best || position > best.position) {
        best = {
          ruleId: compiled.rule.id,
          response: compiled.rule.response,
          chunks: compiled.rule.chunks,
          position,
        };
      }
    }

    return best
      ? {
          ruleId: best.ruleId,
          response: best.response,
          chunks: best.chunks,
        }
      : undefined;
  }

  private selectBundle(model?: string): RuleBundle {
    if (model) {
      const lower = model.toLowerCase();
      for (const bundle of this.bundles) {
        if (bundle.pattern === '') continue;
        if (lower.includes(bundle.pattern.toLowerCase())) {
          return bundle;
        }
      }
    }
    return this.bundles[0];
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

  private async loadBundle(bundle: RuleBundle): Promise<void> {
    try {
      const raw = await readFile(bundle.path, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        throw new Error('Responses file must contain a JSON array of rules');
      }

      const compiled: CompiledRule[] = [];
      for (const entry of parsed) {
        const rule = this.validateRule(entry);
        if (!rule) continue;
        compiled.push(this.compileRule(rule));
      }

      bundle.rules = compiled;
      const tag = bundle.pattern ? ` [${bundle.pattern}]` : '';
      this.logger.log(
        `Responses reloaded from ${basename(bundle.path)}${tag} (${compiled.length} rule(s))`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load responses from ${bundle.path}: ${(error as Error).message}`,
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

    const chunks = this.validateChunks(candidate.chunks, id);

    return { id, type: type as ResponseRuleType, value, response, chunks };
  }

  private validateChunks(
    raw: unknown,
    ruleId: string,
  ): RecordedChunk[] | undefined {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) {
      this.logger.warn(`Rule "${ruleId}": "chunks" must be an array; ignoring`);
      return undefined;
    }
    const out: RecordedChunk[] = [];
    for (const entry of raw) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as Record<string, unknown>).raw !== 'string'
      ) {
        // Skip malformed chunk entries silently — a partial recording is
        // still usable.
        continue;
      }
      const c = entry as Record<string, unknown>;
      out.push({
        t_ms: typeof c.t_ms === 'number' ? c.t_ms : 0,
        dt_ms: typeof c.dt_ms === 'number' ? c.dt_ms : 0,
        raw: c.raw as string,
        done: c.done === true || c.raw === '[DONE]',
      });
    }
    return out.length > 0 ? out : undefined;
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

  private watchBundle(bundle: RuleBundle): void {
    try {
      bundle.watcher = watch(bundle.path, (eventType) => {
        if (eventType !== 'change' && eventType !== 'rename') return;
        if (bundle.reloadTimer) clearTimeout(bundle.reloadTimer);
        bundle.reloadTimer = setTimeout(() => {
          void this.loadBundle(bundle);
        }, 150);
      });
      this.logger.log(`Watching ${bundle.path} for changes`);
    } catch (error) {
      this.logger.warn(
        `Could not watch ${bundle.path} for hot-reload: ${(error as Error).message}`,
      );
    }
  }
}
