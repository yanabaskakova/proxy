/**
 * A single matching rule loaded from the configured responses file.
 *
 * Matching is always case-insensitive and the first rule that matches the
 * incoming prompt wins.
 */
export type ResponseRuleType = 'contains' | 'regex';

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
}
