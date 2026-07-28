import { describe, expect, it } from 'vitest';
import {
  RULE_CATALOGUE,
  isCorrectionRuleId,
  resolveRuleMode,
  ruleDefinition,
  ruleIdForCorrectionType,
  type RuleModeMap,
} from '../../src/shared/rules.js';
import { WRITING_PROFILES, writingProfile } from '../../src/shared/profiles.js';
import { fieldDisabled, profileFor, resolveSettings, withProfile } from '../../src/shared/effective-settings.js';
import { settings as makeSettings } from '../helpers.js';

describe('rule catalogue', () => {
  it('covers every rule the settings page promises to control', () => {
    const ids = RULE_CATALOGUE.map((r) => r.id);
    for (const required of [
      'spelling:duplicate-letter',
      'spelling:missing-letter',
      'spelling:extra-letter',
      'spelling:adjacent-swap',
      'spelling:keyboard-substitution',
      'spacing:merge',
      'spacing:split',
      'text:capitalisation',
      'grammar:harper',
      'punctuation:introductory-clause',
      'punctuation:nonrestrictive-clause',
    ]) {
      expect(ids, required).toContain(required);
    }
  });

  it('has a unique id, label and description for every rule', () => {
    const ids = new Set(RULE_CATALOGUE.map((r) => r.id));
    expect(ids.size).toBe(RULE_CATALOGUE.length);
    for (const rule of RULE_CATALOGUE) {
      expect(rule.label.length, rule.id).toBeGreaterThan(0);
      expect(rule.description.length, rule.id).toBeGreaterThan(10);
    }
  });

  it('recognises its own ids and rejects others', () => {
    expect(isCorrectionRuleId('spacing:merge')).toBe(true);
    expect(isCorrectionRuleId('spacing:nope')).toBe(false);
    expect(isCorrectionRuleId(42)).toBe(false);
    expect(ruleDefinition('spacing:merge')?.label).toBe('Token merging');
  });

  it('maps correction types back to the rule that produced them', () => {
    expect(ruleIdForCorrectionType('duplicate-letter')).toBe('spelling:duplicate-letter');
    expect(ruleIdForCorrectionType('token-split')).toBe('spacing:split');
    expect(ruleIdForCorrectionType('keyboard-proximity')).toBe('spelling:keyboard-substitution');
    expect(ruleIdForCorrectionType('exact-rule')).toBeUndefined();
  });
});

describe('resolveRuleMode', () => {
  const site: RuleModeMap = { 'spacing:merge': 'disabled' };
  const profile: RuleModeMap = { 'spacing:merge': 'suggestion', 'spacing:split': 'suggestion' };
  const global: RuleModeMap = { 'spacing:merge': 'automatic', 'spelling:dictionary': 'disabled' };

  it('prefers the site override above everything', () => {
    expect(resolveRuleMode('spacing:merge', { site, profile, global })).toBe('disabled');
  });

  it('falls back to the profile, then the global setting', () => {
    expect(resolveRuleMode('spacing:split', { profile, global })).toBe('suggestion');
    expect(resolveRuleMode('spelling:dictionary', { global })).toBe('disabled');
  });

  it('falls back to the catalogue default when no layer has an opinion', () => {
    expect(resolveRuleMode('spelling:adjacent-swap', {})).toBe('automatic');
    expect(resolveRuleMode('punctuation:nonrestrictive-clause', {})).toBe('disabled');
  });
});

describe('writing profiles', () => {
  it('always resolves to a real profile', () => {
    expect(writingProfile('fiction').id).toBe('fiction');
    expect(writingProfile('nonsense').id).toBe('general');
    expect(writingProfile(undefined).id).toBe('general');
  });

  it('offers every profile the brief asked for', () => {
    const ids = WRITING_PROFILES.map((p) => p.id);
    expect(ids).toEqual([
      'general',
      'casual',
      'formal',
      'fiction',
      'academic',
      'coding',
      'minimal',
      'aggressive',
    ]);
  });

  it('makes fiction conservative rather than silent', () => {
    const fiction = writingProfile('fiction');
    // It still helps with spelling; what it refuses to do is enforce style.
    expect(fiction.rules['punctuation:independent-clause']).toBe('disabled');
    expect(fiction.rules['spelling:dictionary']).toBe('suggestion');
    expect(fiction.autocorrectThreshold).toBeGreaterThan(0.9);
    expect(fiction.protectProse).toBe(true);
  });

  it('makes the coding profile protect identifiers and drop prose rules', () => {
    const coding = writingProfile('coding');
    expect(coding.protectCode).toBe(true);
    expect(coding.rules['spacing:merge']).toBe('disabled');
    expect(coding.rules['spacing:split']).toBe('disabled');
    expect(coding.punctuationEnabled).toBe(false);
  });
});

describe('resolveSettings', () => {
  it('applies the profile assigned to this origin', () => {
    const settings = makeSettings({
      profile: 'general',
      siteProfiles: { 'https://novel.example': 'fiction' },
    });
    expect(profileFor(settings, 'https://novel.example').id).toBe('fiction');
    expect(profileFor(settings, 'https://other.example').id).toBe('general');

    const effective = resolveSettings(settings, 'https://novel.example');
    expect(effective.autocorrectThreshold).toBe(0.96);
    expect(effective.protectProse).toBe(true);
  });

  it('reports an explicit override separately from the catalogue default', () => {
    const settings = makeSettings({ ruleModes: { 'spacing:split': 'disabled' } });
    const effective = resolveSettings(settings, 'https://example.com');

    expect(effective.ruleOverride('spacing:split')).toBe('disabled');
    // Nothing set this one, so enforcement must not invent a restriction even
    // though the catalogue has a default for display.
    expect(effective.ruleOverride('grammar:harper')).toBeUndefined();
    expect(effective.ruleMode('grammar:harper')).toBe('suggestion');
  });

  it('lets a site rule override the profile', () => {
    const settings = makeSettings({
      profile: 'coding',
      siteRuleModes: { 'https://example.com': { 'spacing:merge': 'automatic' } },
    });
    const effective = resolveSettings(settings, 'https://example.com');
    expect(effective.ruleOverride('spacing:merge')).toBe('automatic');
  });

  it('projects profile thresholds onto a plain Settings object', () => {
    const settings = makeSettings({ profile: 'minimal', autocorrectThreshold: 0.8 });
    const projected = withProfile(settings, 'https://example.com');
    expect(projected.autocorrectThreshold).toBe(0.95);
    // The suggestion bar can never end up above the automatic bar.
    expect(projected.suggestionThreshold).toBeLessThanOrEqual(projected.autocorrectThreshold);
    expect(projected.punctuationEnabled).toBe(false);
  });
});

describe('per-field disabling', () => {
  it('matches only the exact origin and field', () => {
    const settings = makeSettings({ disabledFields: ['https://example.com|field-a'] });
    expect(fieldDisabled(settings, 'https://example.com', 'field-a')).toBe(true);
    expect(fieldDisabled(settings, 'https://example.com', 'field-b')).toBe(false);
    expect(fieldDisabled(settings, 'https://other.com', 'field-a')).toBe(false);
  });
});
