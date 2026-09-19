import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * Module resolver for `npm test`.
 *
 * Tests run the real TypeScript sources on Node's built-in type stripping —
 * no bundler, no transpile step. Two things the bundler normally does are
 * supplied here: the `@/*` → `src/*` alias from tsconfig, and the file
 * extensions that TypeScript source omits on relative imports.
 */
const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function firstExisting(base) {
  for (const candidate of [base, base + '.ts', base + '.tsx', base + '/index.ts']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const hit = firstExisting(resolvePath(SRC, specifier.slice(2)));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.startsWith('file:')) {
    const hit = firstExisting(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  return next(specifier, context);
}
