/**
 * A single matching rule loaded from the configured responses file.
 *
 * Matching is always case-insensitive and the first rule that matches the
 * incoming prompt wins.
 */
export type ResponseRuleType = 'contains' | 'regex';

/**
 * A single recorded SSE chunk from a previous streamed response. When a rule
 * carries an array of these, the proxy replays them verbatim — emitting
 * `data: ${raw}\n\n` per entry with the recorded `dt_ms` sleeps between
 * them — so timing AND wire format match the original model exactly.
 */
export interface RecordedChunk {
  /** ms since the original request was fired. */
  t_ms: number;
  /** ms since the previous recorded chunk (or since request fire for the first). */
  dt_ms: number;
  /** Verbatim payload that followed `data: ` on the wire. `[DONE]` sentinel
   *  marks stream termination. */
  raw: string;
  /** True for the `[DONE]` sentinel. */
  done?: boolean;
  // Other fields (role/reasoning/content/finish) are convenience extracts;
  // not required for replay.
}

export interface ResponseRule {
  /** Stable identifier, used in logs ("matched rule id"). */
  id: string;

  /** How `value` should be interpreted when matching the prompt. */
  type: ResponseRuleType;

  /**
   * For `contains`: a substring to look for.
   * For `regex`: a regular expression source string.
   */
  value: string;

  /** The text returned to the client when this rule matches. */
  response: string;

  /** Optional pre-recorded SSE chunks. When present, streaming responses
   *  replay these verbatim instead of chunking `response` synthetically. */
  chunks?: RecordedChunk[];
}
