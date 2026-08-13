import { describe, expect, it } from 'vitest';
import { mdTwinUrlFor } from '../../src/lib/mdtwin.ts';

describe('mdTwinUrlFor', () => {
  it('maps the landing page', () => {
    expect(mdTwinUrlFor('/')).toBe('/index.md');
  });

  it('maps install and agents, with or without a trailing slash', () => {
    expect(mdTwinUrlFor('/install')).toBe('/install.md');
    expect(mdTwinUrlFor('/install/')).toBe('/install.md');
    expect(mdTwinUrlFor('/agents')).toBe('/agents.md');
    expect(mdTwinUrlFor('/agents/')).toBe('/agents.md');
  });

  it('maps the module catalog to its own index twin, not a module named "index"', () => {
    expect(mdTwinUrlFor('/modules')).toBe('/modules/index.md');
    expect(mdTwinUrlFor('/modules/')).toBe('/modules/index.md');
  });

  it('maps a module detail page to /modules/{name}.md', () => {
    expect(mdTwinUrlFor('/modules/verification')).toBe('/modules/verification.md');
    expect(mdTwinUrlFor('/modules/verification/')).toBe('/modules/verification.md');
    expect(mdTwinUrlFor('/modules/autoheal')).toBe('/modules/autoheal.md');
  });

  it('returns null for pages with no twin (404, unknown paths)', () => {
    expect(mdTwinUrlFor('/404')).toBeNull();
    expect(mdTwinUrlFor('/some/bogus/path')).toBeNull();
    expect(mdTwinUrlFor('/modules/foo/bar')).toBeNull();
  });
});
