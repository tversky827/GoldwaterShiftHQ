/** Turn HTTP failures into plain-English explanations for the owner. */
export class IntegrationHttpError extends Error {
  constructor(
    public status: number,
    public plainEnglish: string,
    public bodySnippet?: string,
  ) {
    super(`HTTP ${status}: ${plainEnglish}`);
  }
}

export function explainHttpStatus(system: "Paycor" | "Attendance on Demand", status: number): string {
  switch (status) {
    case 400:
      return `${system} rejected the request as malformed. Usually a wrong setting value (e.g. legal entity ID or redirect URL).`;
    case 401:
      return `${system} did not accept the credentials. The token expired, or the client secret / password is wrong.`;
    case 403:
      return `${system} recognized us but refused access. Usually the API permission (scope) for this data was not granted, the app was not activated for this legal entity, or the subscription key is wrong.`;
    case 404:
      return `${system} says this address does not exist. Usually a wrong base URL, wrong ID, or an endpoint not enabled for your account.`;
    case 429:
      return `${system} says we sent too many requests. Wait a few minutes and try again.`;
    default:
      if (status >= 500) return `${system} had an internal error. This is on their side - try again later; contact their support if it persists.`;
      return `${system} returned an unexpected response (HTTP ${status}).`;
  }
}

/** Strip anything that looks like a token/secret before showing or logging a body. */
export function redact(text: string): string {
  return text
    .replace(/("?(access_token|refresh_token|client_secret|password|subscription-key)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]")
    .slice(0, 500);
}
