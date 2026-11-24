/** RFC 3987 section 2.2: validate an absolute RDF IRI without normalizing it.
 * In particular, Unicode spaces such as U+202F are ucschar, not ASCII space.
 * The original string is always passed unchanged to the RDF factory.
 */
const ucschar = String.raw`\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF\u{10000}-\u{1FFFD}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}\u{40000}-\u{4FFFD}\u{50000}-\u{5FFFD}\u{60000}-\u{6FFFD}\u{70000}-\u{7FFFD}\u{80000}-\u{8FFFD}\u{90000}-\u{9FFFD}\u{A0000}-\u{AFFFD}\u{B0000}-\u{BFFFD}\u{C0000}-\u{CFFFD}\u{D0000}-\u{DFFFD}\u{E1000}-\u{EFFFD}`;
const iprivate = String.raw`\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}`;
const unreserved = `A-Za-z0-9._~!$&'()*+,;=${ucschar}`;
// Use an actual end-of-input assertion: JS $ also matches before a final newline.
const part = (chars: string) => new RegExp(`^(?:[${chars}\\-]|%[0-9A-Fa-f]{2})*(?![\\s\\S])`, "u");
const userinfo = part(`${unreserved}:`);
const regName = part(unreserved);
const path = part(`${unreserved}:@/`);
const query = part(`${unreserved}:@/?${iprivate}`);
const fragment = part(`${unreserved}:@/?`);

function validAuthority(authority: string): boolean {
  const at = authority.lastIndexOf("@");
  if (at !== -1 && !userinfo.test(authority.slice(0, at))) return false;
  const hostPort = authority.slice(at + 1);
  if (hostPort.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::[0-9]*)?(?![\s\S])/.exec(hostPort);
    if (!match) return false;
    const literal = match[1];
    if (/^v[0-9a-f]+\.[a-z0-9._~!$&'()*+,;=:\-]+(?![\s\S])/i.test(literal)) return true;
    if (!/^[0-9a-f:.]+(?![\s\S])/i.test(literal)) return false;
    // URL is used only to check ASCII IPv6 syntax, never to rewrite an RDF IRI.
    try { new URL(`http://[${literal}]/`); return true; } catch { return false; }
  }
  const colon = hostPort.lastIndexOf(":");
  if (colon !== -1 && !/^[0-9]*(?![\s\S])/.test(hostPort.slice(colon + 1))) return false;
  return regName.test(colon === -1 ? hostPort : hostPort.slice(0, colon));
}

export function isValidRdfIri(value: string): boolean {
  if (typeof value !== "string" || value.length > 4096) return false;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(value);
  if (!scheme) return false;
  let rest = value.slice(scheme[0].length);
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    if (!fragment.test(rest.slice(hash + 1))) return false;
    rest = rest.slice(0, hash);
  }
  const question = rest.indexOf("?");
  if (question !== -1) {
    if (!query.test(rest.slice(question + 1))) return false;
    rest = rest.slice(0, question);
  }
  if (rest.startsWith("//")) {
    const slash = rest.indexOf("/", 2);
    if (!validAuthority(slash === -1 ? rest.slice(2) : rest.slice(2, slash))) return false;
    rest = slash === -1 ? "" : rest.slice(slash);
  }
  return path.test(rest);
}
