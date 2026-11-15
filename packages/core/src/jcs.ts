/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * - Object keys sorted by UTF-16 code units (the default JS string sort).
 * - Numbers use the ECMAScript serialization, which is what JSON.stringify emits.
 * - Strings use JSON.stringify escaping; lone surrogates are rejected (I-JSON).
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const encodeString = (value: string): string => {
  if (LONE_SURROGATE.test(value)) throw new TypeError('JCS: string contains a lone surrogate');
  return JSON.stringify(value);
};

export const canonicalize = (value: unknown): string => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return encodeString(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${encodeString(k)}:${canonicalize(record[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`JCS: unsupported type ${typeof value}`);
  }
};
