/** Capture OAuth parameters before the SDK consumes and removes the fragment. */
export function readAuthCallback(href: string): { isCallback: boolean; error: string | null } {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const error = url.searchParams.get("error_description") || fragment.get("error_description") ||
    url.searchParams.get("error") || fragment.get("error");
  return {
    isCallback: url.searchParams.get("auth") === "callback" || url.searchParams.has("code") ||
      fragment.has("access_token") || !!error,
    error,
  };
}
