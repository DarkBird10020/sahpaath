import { expect, it } from "vitest";
import { readAuthCallback } from "../src/lib/authCallback";

it("recognizes OAuth returns even when the provider falls back to the site root", () => {
  expect(readAuthCallback("http://example.test/#access_token=token&refresh_token=refresh").isCallback).toBe(true);
  expect(readAuthCallback("http://127.0.0.1:8088/?auth=callback").isCallback).toBe(true);
  expect(readAuthCallback("http://example.test/?code=authorization-code").isCallback).toBe(true);
  expect(readAuthCallback("http://example.test/#/account")).toEqual({ isCallback: false, error: null });
});

it("preserves provider errors from both query and fragment", () => {
  for (const separator of ["?", "#"]) {
    expect(readAuthCallback(`http://example.test/${separator}error=access_denied&error_description=Access+was+denied`))
      .toEqual({ isCallback: true, error: "Access was denied" });
  }
});
