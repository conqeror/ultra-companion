import { describe, expect, it } from "vitest";
import {
  buildSharedPOIDeepLink,
  getSharedPOIDisplayName,
  getSharedPOIRawText,
  parsePendingSharedPOIJSON,
  parseSharedPOIDeepLink,
} from "@/services/sharedPOIService";

describe("sharedPOIService", () => {
  it("round-trips share extension payloads through the app deep link", () => {
    const deepLink = buildSharedPOIDeepLink({
      title: "Known Shop",
      text: "Known Shop\nhttps://maps.app.goo.gl/example",
      url: "https://maps.app.goo.gl/example",
    });

    const parsed = parseSharedPOIDeepLink(deepLink);

    expect(parsed?.title).toBe("Known Shop");
    expect(parsed?.text).toContain("maps.app.goo.gl/example");
    expect(parsed?.url).toBe("https://maps.app.goo.gl/example");
  });

  it("rejects unrelated links", () => {
    expect(parseSharedPOIDeepLink("ultra://settings")).toBeNull();
    expect(parseSharedPOIDeepLink("https://maps.app.goo.gl/example")).toBeNull();
  });

  it("parses pending POI payloads saved by the iOS share extension", () => {
    const parsed = parsePendingSharedPOIJSON(
      JSON.stringify({
        title: "Known Shop",
        text: "Known Shop\nhttps://maps.app.goo.gl/example",
        url: "https://maps.app.goo.gl/example",
        receivedAt: "2026-05-04T16:00:00Z",
      }),
    );

    expect(parsed?.title).toBe("Known Shop");
    expect(parsed?.text).toContain("maps.app.goo.gl/example");
    expect(parsed?.url).toBe("https://maps.app.goo.gl/example");
    expect(parsed?.receivedAt).toBe("2026-05-04T16:00:00Z");
  });

  it("rejects empty pending POI payloads", () => {
    expect(parsePendingSharedPOIJSON("{}")).toBeNull();
    expect(parsePendingSharedPOIJSON("not json")).toBeNull();
  });

  it("builds resolver text from url, text, and title", () => {
    const raw = getSharedPOIRawText({
      title: "Known Shop",
      text: "Shared text",
      url: "https://maps.app.goo.gl/example",
    });

    expect(raw).toBe("https://maps.app.goo.gl/example\nShared text\nKnown Shop");
  });

  it("infers display names from title or first non-url text line", () => {
    expect(getSharedPOIDisplayName({ title: "Known Shop", text: null })).toBe("Known Shop");
    expect(
      getSharedPOIDisplayName({
        title: null,
        text: "https://maps.app.goo.gl/example\nFallback Name",
      }),
    ).toBe("Fallback Name");
  });
});
