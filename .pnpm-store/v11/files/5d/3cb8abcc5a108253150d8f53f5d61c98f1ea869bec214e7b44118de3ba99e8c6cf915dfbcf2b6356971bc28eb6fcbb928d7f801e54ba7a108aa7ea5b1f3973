export declare function _setEnvForwardTimeoutMs(ms: number): void;
/**
 * Applies an env-carrying client message to the daemon. Must be awaited
 * before dispatching the message's handler: plugin workers key their disk
 * caches on their own process env, so a graph request must not reach a worker
 * whose env still reflects the previous client.
 */
export declare function handleClientEnv(env: Record<string, string>): Promise<void>;
