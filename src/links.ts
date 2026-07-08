/** URL builders for user-facing Ridvay links returned by the MCP tools. */

export interface LinkOptions {
  webUrl: string;
}

const DEFAULT_WEB_URL = "https://ridvay.com";

export function normalizeWebUrl(webUrl?: string): string {
  return (webUrl ?? DEFAULT_WEB_URL).replace(/\/+$/, "");
}

/** Public read-only share page (server-rendered, works for anyone). */
export function viewUrl(designId: string, opts?: Partial<LinkOptions>): string {
  return `${normalizeWebUrl(opts?.webUrl)}/d/${encodeURIComponent(designId)}`;
}

/**
 * Opens the shared design in Ridvay Studio as an editable copy. Uses `?remix=`
 * (the public endpoint) — NOT `?open=`, which is ownership-scoped and silently
 * fails for a browser that isn't logged into the API-key's account (the norm for
 * MCP). Requires the design to have been shared public first.
 */
export function editUrl(designId: string, opts?: Partial<LinkOptions>): string {
  return `${normalizeWebUrl(opts?.webUrl)}/studio?remix=${encodeURIComponent(designId)}`;
}
