import { expect, it } from "vitest";
import { HTTPS_FRONT_DOOR, secureRedirectTarget } from "../src/lib/secureOrigin";
import { quietSpeechErrors, speechErrorMessage } from "../src/lib/microphone";

const at = (protocol: string, hostname: string, pathname = "/", search = "", hash = "") => ({ protocol, hostname, pathname, search, hash });

it("sends the plain-http load balancer address to https, keeping the sign-in return", () => {
  expect(secureRedirectTarget(at("http:", "sahpaath-alb-1.ap-south-1.elb.amazonaws.com", "/", "?auth=callback", "#access_token=t")))
    .toBe(`${HTTPS_FRONT_DOOR}/?auth=callback#access_token=t`);
});

it("leaves https, localhost and the loopback preview alone", () => {
  expect(secureRedirectTarget(at("https:", "dnde2gq0rg.execute-api.ap-south-1.amazonaws.com"))).toBeNull();
  expect(secureRedirectTarget(at("http:", "localhost"))).toBeNull();
  expect(secureRedirectTarget(at("http:", "127.0.0.1"))).toBeNull();
});

it("treats pauses as quiet and names every real speech failure", () => {
  expect(quietSpeechErrors.has("no-speech")).toBe(true);
  expect(speechErrorMessage("not-allowed")).toMatch(/lock icon/);
  expect(speechErrorMessage("service-not-allowed")).toMatch(/Online speech recognition/);
  expect(speechErrorMessage("network")).toMatch(/could not be reached/);
  expect(speechErrorMessage("audio-capture")).toMatch(/No microphone/);
});
