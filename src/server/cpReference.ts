// Random part of Channel Partner application references (server only).
// The sequence number keeps references unique; the random part makes them impractical to guess, because the public
// tracking page and the approval certificate are available to anyone who has the full reference.
import crypto from 'crypto';
import { CP_REF_SUFFIX_ALPHABET, CP_REF_SUFFIX_LENGTH } from '../cpOptions.js';

/** e.g. "K7Q2", from a cryptographically secure generator (crypto.randomInt is unbiased) */
export const cpReferenceSuffix = () =>
  Array.from({ length: CP_REF_SUFFIX_LENGTH }, () => CP_REF_SUFFIX_ALPHABET[crypto.randomInt(CP_REF_SUFFIX_ALPHABET.length)]).join('');
