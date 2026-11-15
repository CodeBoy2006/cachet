/** Value of `type` inside every proof object. */
export const PROFILE_TYPE = 'bch-nostr-bind/v1';

/** First line of the text a BCH wallet signs. */
export const MESSAGE_HEADER = 'BCH-NOSTR-ID/v1';

/** Second line prefix; the npub follows. */
export const MESSAGE_INTRO = 'Verifying that I control the following Nostr public key: ';

/** NIP-39 external identities (replaceable). */
export const KIND_EXTERNAL_IDENTITIES = 10011;
/** NIP-65 relay list metadata. */
export const KIND_RELAY_LIST = 10002;
/** NIP-01 user metadata. */
export const KIND_METADATA = 0;
/** NIP-98 HTTP auth. */
export const KIND_HTTP_AUTH = 27235;
/** NIP-78 app data, used only for read-only awareness of legacy Paytaca announcements. */
export const KIND_APP_DATA = 30078;
export const PAYTACA_LEGACY_D_TAG = 'paytaca:bch-address';

/** NIP-39 platform name for this profile. Claims look like `["i", "bch:<cashaddr>", "<proof>"]`. */
export const CLAIM_PLATFORM = 'bch';

export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Tolerance for clocks that disagree, in seconds. */
export const DEFAULT_CLOCK_SKEW = 300;
/** Inputs above these sizes are rejected before parsing. */
export const MAX_EVENT_BYTES = 128 * 1024;
export const MAX_PROOF_BYTES = 4 * 1024;
/** Anything larger is almost certainly milliseconds, not seconds. */
export const MAX_UNIX_SECONDS = 99_999_999_999;

export const NETWORKS = ['mainnet', 'chipnet'] as const;
export type Network = (typeof NETWORKS)[number];
