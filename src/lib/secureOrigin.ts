/** The HTTPS address of the classroom. Browsers only offer the microphone (and
 * its Allow/Block prompt) on secure pages, so the plain-http load-balancer
 * address is never a place to stay. */
export const HTTPS_FRONT_DOOR = "https://dnde2gq0rg.execute-api.ap-south-1.amazonaws.com";

type Place = Pick<Location, "protocol" | "hostname" | "pathname" | "search" | "hash">;

/** Where to send the visitor, or null when the page is already fine. The path,
 * query and fragment are kept so a sign-in return is not lost on the way. */
export function secureRedirectTarget(place: Place): string | null {
  if (place.protocol !== "http:" || !place.hostname.endsWith(".elb.amazonaws.com")) return null;
  return HTTPS_FRONT_DOOR + place.pathname + place.search + place.hash;
}
