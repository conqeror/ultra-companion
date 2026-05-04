interface SharedPOIDiagnosticInput {
  id?: string;
  title?: string | null;
  text?: string | null;
  url?: string | null;
  receivedAt?: string | null;
}

const LOG_PREFIX = "[Ultra POI Share]";
const DEFAULT_TEXT_SAMPLE_LENGTH = 1_200;
const URL_RE = /https?:\/\/[^\s]+/gi;

function truncateDiagnosticText(value: string, maxLength = DEFAULT_TEXT_SAMPLE_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...<truncated ${value.length - maxLength} chars>`;
}

function extractUrls(value: string): string[] {
  return Array.from(value.matchAll(URL_RE), (match) => match[0]);
}

export function describeDiagnosticText(
  value: string | null | undefined,
  maxLength = DEFAULT_TEXT_SAMPLE_LENGTH,
) {
  if (value == null) {
    return {
      present: false,
      length: 0,
      value: null,
      urls: [],
      lines: [],
    };
  }

  return {
    present: true,
    length: value.length,
    value: truncateDiagnosticText(value, maxLength),
    urls: extractUrls(value),
    lines: value.split(/\r?\n/).map((line, index) => ({
      index,
      length: line.length,
      value: truncateDiagnosticText(line, maxLength),
    })),
  };
}

export function describeSharedPOIInput(input: SharedPOIDiagnosticInput | null | undefined) {
  if (!input) return null;
  return {
    id: input.id,
    receivedAt: input.receivedAt,
    title: describeDiagnosticText(input.title),
    text: describeDiagnosticText(input.text),
    url: describeDiagnosticText(input.url),
  };
}

export function describeRawSharedPOIText(rawText: string) {
  return describeDiagnosticText(rawText);
}

export function describeHtmlForDiagnostics(html: string) {
  return {
    length: html.length,
    sample: truncateDiagnosticText(html),
    hasStaticMapCenter: /[?&]center=-?\d+(?:\.\d+)?(?:%2C|,)-?\d+(?:\.\d+)?/i.test(html),
    hasPbCenter: /!2d-?\d+(?:\.\d+)?!3d-?\d+(?:\.\d+)?/.test(html),
    urls: extractUrls(html).slice(0, 8),
  };
}

export function logSharedPOIDiagnostic(event: string, data: Record<string, unknown> = {}) {
  console.info(LOG_PREFIX, event, data);
}
