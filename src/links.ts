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

/** Opens the design in Ridvay Studio from the owner's account. */
export function editUrl(designId: string, opts?: Partial<LinkOptions>): string {
  return `${normalizeWebUrl(opts?.webUrl)}/studio?open=${encodeURIComponent(designId)}`;
}

/** Lets anyone (not just the owner) open an editable copy in Ridvay Studio. */
export function remixUrl(designId: string, opts?: Partial<LinkOptions>): string {
  return `${normalizeWebUrl(opts?.webUrl)}/studio?remix=${encodeURIComponent(designId)}`;
}
