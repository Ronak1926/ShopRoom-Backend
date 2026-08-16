/**
 * utils/variableResolver.ts — Resolves {{namespace.key}} tokens in a design
 * against a runtime context. Only known tokens are substituted; nothing is
 * evaluated. The SAME resolver is used for previews (demo product context) and
 * production sends (the shopkeeper's real product / shop / customer context),
 * so a template never stores a concrete value — only the token.
 */

export type RenderContext = Record<string, Record<string, string | number | null | undefined>>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\}\}/g;

/** Replaces every known {{ns.key}} with its context value; unknown → "". */
export function resolveVariables(text: string, ctx: RenderContext): string {
  return text.replace(TOKEN, (_m, ns: string, key: string) => {
    const value = ctx[ns]?.[key];
    return value == null ? "" : String(value);
  });
}

/**
 * Resolves a PRODUCT_IMAGE element's source to a concrete image URL.
 * `variable` is the stored token (e.g. "{{product.image}}"). Returns undefined
 * when the context has no image, so the renderer can fall back to a placeholder.
 */
export function resolveProductImage(
  variable: string | undefined,
  ctx: RenderContext,
): string | undefined {
  if (!variable) return undefined;
  const resolved = resolveVariables(variable, ctx);
  return resolved.trim() ? resolved : undefined;
}
