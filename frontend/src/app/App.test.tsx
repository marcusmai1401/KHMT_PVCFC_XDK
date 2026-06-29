import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App login form", () => {
  it("disables mobile auto-capitalization and correction for the user id field", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('autoCapitalize="none"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('spellcheck="false"');
  });
});
