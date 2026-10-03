/** The only address the Shell Server binds to (Requirement 2.1). */
export const LOOPBACK_HOST = '127.0.0.1';

/** Remote addresses accepted as loopback by the peer check (Requirement 2.5). */
export const LOOPBACK_PEERS: readonly string[] = ['127.0.0.1', '::ffff:127.0.0.1'];

export const SESSION_COOKIE = 'tc_session';
