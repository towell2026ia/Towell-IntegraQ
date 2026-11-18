import {readdirSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const operationalSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const forbiddenOperationalLinks = /(?:github\.(?:com|usercontent\.com)|gronk93\s*\/\s*capa-v01)/i;

function getOperationalSources(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return getOperationalSources(path);
    if (!operationalSourceExtensions.has(path.slice(path.lastIndexOf('.')))) return [];
    if (/\.(?:test|spec)\.[^.]+$/i.test(path)) return [];
    return [path];
  });
}

describe('operational IntegraQ interface links', () => {
  it('does not expose GitHub or the CAPA-V01 development repository', () => {
    const matches = getOperationalSources(sourceRoot).flatMap(path => {
      const source = readFileSync(path, 'utf8');
      return forbiddenOperationalLinks.test(source) ? [relative(sourceRoot, path)] : [];
    });

    expect(matches).toEqual([]);
  });
});
