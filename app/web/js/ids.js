// User ids. New ids look like K7M3-9QXD: no characters that are easy to
// misread (0/O, 1/I/L, U), case-insensitive, and the last character is a
// check character — a mistyped id is rejected as "doesn't look right" instead
// of silently pointing at an empty log.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // 30 characters
const NEW_STYLE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;

// Weights are all coprime to 30, so changing any single character always
// changes the check character — every one-character typo is caught.
const WEIGHTS = [1, 7, 11, 13, 17, 19, 23];

function checkChar(body) {
  let sum = 0;
  [...body].forEach((ch, i) => { sum += ALPHABET.indexOf(ch) * WEIGHTS[i]; });
  return ALPHABET[sum % ALPHABET.length];
}

export function generateUserId() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  // 256 % 30 leaves a tiny bias; irrelevant for an id that only needs to be unique.
  const body = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  const full = body + checkChar(body);
  return full.slice(0, 4) + "-" + full.slice(4);
}

// Legacy (u001) and short personal ids (e.g. AB1-234) are accepted as they are.
// Returns the canonical id, or null if it can't be one.
export function normalizeUserId(raw) {
  const id = String(raw || "").trim();
  if (/^u\d{3,}$/i.test(id)) return id.toLowerCase();
  const upper = id.toUpperCase();
  if (/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(upper) && upper.length >= 3 && upper.length <= 20) return upper;
  return null;
}

// Only generated-style ids carry a check character to verify.
export function checkUserId(id) {
  if (!NEW_STYLE.test(id)) return true;
  const plain = id.replace("-", "");
  return checkChar(plain.slice(0, 7)) === plain[7];
}
