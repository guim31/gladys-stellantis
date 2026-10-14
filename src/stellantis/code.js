// -----------------------------------------------------------------------------
// The sign-in code the user copies from the browser.
//
// After the sign-in, the brand's page sends the browser to
// `mymap://oauth2redirect/fr?code=…&scope=…` (or mymacsdk://, mymdssdk://…),
// an address only the mobile app opens. The browser shows nothing, but the
// address appears in the developer tools: in the console ("Failed to launch
// 'mymap://…'" in Chrome and Edge, "Prevented navigation to “mymap://…”" in
// Firefox) or in the Network tab. The user pastes the line, the address or
// the code alone: the code is taken out of whatever was pasted.
// -----------------------------------------------------------------------------

// What a code of the sign-in server looks like (ForgeRock AM): letters,
// digits and a few URL-safe signs, a few dozen characters.
const BARE_CODE = /^[A-Za-z0-9._~+/=-]{8,512}$/;
const IN_ADDRESS = /[?&]code=([^&#\s'"“”‘’<>]+)/;

/**
 * The code of a pasted text, `null` when none is found.
 * @param {unknown} pasted
 */
export function extractCode(pasted) {
  const text = String(pasted ?? '').trim();
  if (!text) return null;
  const match = text.match(IN_ADDRESS);
  let code = match ? match[1] : text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  try {
    code = decodeURIComponent(code);
  } catch {
    return null;
  }
  return BARE_CODE.test(code) ? code : null;
}
