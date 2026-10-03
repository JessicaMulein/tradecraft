/**
 * The `config/authoring.yaml` schema and the local-endpoint check
 * (content-expansion task 5.13; design, "Authoring Aid"; Req 16.5, 16.7).
 *
 * The Authoring Aid talks to an OpenAI-compatible endpoint of its own — it uses
 * *no* game Model Role, so the slice `Role` set and `config/models.yaml` are
 * untouched (design, "Authoring Aid"). Its endpoint and model live in a
 * dedicated `config/authoring.yaml`:
 *
 * ```yaml
 * endpoint: http://localhost:1234/v1
 * model: <model id as LM Studio reports it>
 * temperature: 0.9
 * maxTokens: 2000
 * allowRemote: false
 * ```
 *
 * The endpoint check is the privacy gate (Req 16.7): a remote endpoint sends
 * pack content off the machine, so the host must resolve to the local machine
 * (`localhost`, `127.0.0.1` or `::1`) *unless* both `allowRemote: true` is set
 * in the config and `--remote` is passed on the CLI. {@link endpointDecision}
 * is the pure decision function behind that table, so the refusal/acceptance
 * matrix is tested directly.
 */

import { z } from 'zod';

/**
 * The `config/authoring.yaml` schema. `endpoint` is the OpenAI-compatible base
 * URL; `model` is the model id as the endpoint reports it; `temperature` and
 * `maxTokens` are the sampling settings; `allowRemote` opts the config into
 * sending to a non-local endpoint (still gated behind `--remote`).
 */
export const AuthoringConfigSchema = z
  .object({
    endpoint: z.string().min(1, 'authoring config needs an endpoint'),
    model: z.string().min(1, 'authoring config needs a model id'),
    temperature: z.number().min(0).max(2).default(0.9),
    maxTokens: z
      .number()
      .int('maxTokens must be a whole number')
      .positive('maxTokens must be positive')
      .default(2000),
    allowRemote: z.boolean().default(false),
  })
  .strict();

/** The validated `config/authoring.yaml` content. */
export type AuthoringConfig = z.infer<typeof AuthoringConfigSchema>;

/** The hosts that count as the local machine for the endpoint check. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  // `URL` strips the brackets from an IPv6 host, but keep the bracketed form
  // too in case a caller passes a raw host string rather than a full URL.
  '[::1]',
]);

/**
 * Whether an endpoint URL points at the local machine. The host is read with
 * the `URL` parser so a port, path or scheme does not matter; a string that is
 * not a URL is treated as non-local, so a malformed endpoint fails closed
 * (refused) rather than slipping past the gate.
 */
export function isLocalEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** The outcome of the endpoint check: send, or refuse with a reason. */
export type EndpointDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * The endpoint refusal/acceptance table (Req 16.7):
 *
 * | endpoint | `allowRemote` | `--remote` | decision |
 * |----------|---------------|------------|----------|
 * | local    | any           | any        | send     |
 * | remote   | false         | any        | refuse   |
 * | remote   | true          | false      | refuse   |
 * | remote   | true          | true       | send     |
 *
 * A local endpoint always sends. A non-local endpoint is refused unless the
 * config opted in (`allowRemote: true`) *and* the author passed `--remote` on
 * the CLI — both are required, so neither the config nor the flag alone opens
 * the gate. The refusal reason names which of the two is missing so the CLI can
 * state what the author needs to do.
 */
export function endpointDecision(
  config: AuthoringConfig,
  remoteFlag: boolean,
): EndpointDecision {
  if (isLocalEndpoint(config.endpoint)) {
    return { allowed: true };
  }
  if (!config.allowRemote) {
    return {
      allowed: false,
      reason:
        `endpoint "${config.endpoint}" is not on the local machine; ` +
        `sending pack content to it is refused. Set allowRemote: true in ` +
        `config/authoring.yaml and pass --remote to allow it.`,
    };
  }
  if (!remoteFlag) {
    return {
      allowed: false,
      reason:
        `endpoint "${config.endpoint}" is not on the local machine; ` +
        `allowRemote is set but --remote was not passed. Re-run with --remote ` +
        `to send pack content to it.`,
    };
  }
  return { allowed: true };
}

/** Parse already-read `config/authoring.yaml` content; throws on a bad config. */
export function parseAuthoringConfig(content: unknown): AuthoringConfig {
  const parsed = AuthoringConfigSchema.safeParse(content);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid config/authoring.yaml: ${detail}`);
  }
  return parsed.data;
}
