/** Prisma hands `contains` to LIKE as-is, so `%`, `_` and `\` in a search must be escaped to match literally. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);
