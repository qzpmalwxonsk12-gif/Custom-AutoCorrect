/**
 * Turns the stored settings plus the active writing profile into the concrete
 * values a provider should obey at one origin.
 *
 * Every consumer resolves through here rather than reading `Settings` directly
 * for anything a profile can influence, so "why did the coding profile not stop
 * that?" has exactly one place to look.
 */
import { writingProfile, type WritingProfile } from './profiles.js';
import {
  resolveRuleMode,
  ruleMayAutoApply,
  ruleEnabled,
  type CorrectionRuleId,
  type RuleControlMode,
} from './rules.js';
import type { Settings } from './types.js';

export interface EffectiveSettings {
  profile: WritingProfile;
  autocorrectThreshold: number;
  suggestionThreshold: number;
  contextualEnabled: boolean;
  punctuationEnabled: boolean;
  spacingCorrectionEnabled: boolean;
  protectCode: boolean;
  protectProse: boolean;
  /** The effective mode, including the catalogue default. For display. */
  ruleMode: (id: CorrectionRuleId) => RuleControlMode;
  /**
   * The *explicit* override only, or undefined when no layer has an opinion.
   *
   * Enforcement uses this rather than `ruleMode`, because several rules are
   * already gated by their own long-standing settings (`harperAutoApply`,
   * `punctuationNonrestrictiveClause`, ...). Applying the catalogue default on
   * top would gate them twice and silently change behaviour that the older
   * setting is still responsible for.
   */
  ruleOverride: (id: CorrectionRuleId) => RuleControlMode | undefined;
  /** True when the rule may run at all (suggestion or automatic). */
  ruleAllowed: (id: CorrectionRuleId) => boolean;
  /** True when the rule may write text without asking. */
  ruleAutomatic: (id: CorrectionRuleId) => boolean;
}

export function profileFor(settings: Settings, origin: string): WritingProfile {
  return writingProfile(settings.siteProfiles[origin] ?? settings.profile);
}

/**
 * A profile may only tighten a threshold the user has set, never loosen it -
 * except "aggressive", which exists precisely to loosen and says so. Taking the
 * max would make the aggressive profile a no-op; taking the profile value
 * outright would let a profile silently override an explicit user choice. The
 * compromise: the profile wins, because selecting a profile *is* an explicit
 * user choice, and the profile list documents what each one does.
 */
export function resolveSettings(settings: Settings, origin: string): EffectiveSettings {
  const profile = profileFor(settings, origin);
  const siteRules = settings.siteRuleModes[origin];

  const mode = (id: CorrectionRuleId): RuleControlMode =>
    resolveRuleMode(id, {
      site: siteRules,
      profile: profile.rules,
      global: settings.ruleModes,
    });

  const override = (id: CorrectionRuleId): RuleControlMode | undefined =>
    siteRules?.[id] ?? profile.rules[id] ?? settings.ruleModes[id];

  return {
    profile,
    ruleOverride: override,
    autocorrectThreshold: profile.autocorrectThreshold ?? settings.autocorrectThreshold,
    suggestionThreshold: profile.suggestionThreshold ?? settings.suggestionThreshold,
    contextualEnabled: settings.contextualEnabled && profile.contextualEnabled !== false,
    punctuationEnabled: settings.punctuationEnabled && profile.punctuationEnabled !== false,
    spacingCorrectionEnabled: settings.spacingCorrectionEnabled,
    protectCode: profile.protectCode === true,
    protectProse: profile.protectProse === true,
    ruleMode: mode,
    ruleAllowed: (id) => ruleEnabled(mode(id)),
    ruleAutomatic: (id) => ruleMayAutoApply(mode(id)),
  };
}

/**
 * Applies profile-derived overrides onto a Settings object, so existing code
 * paths that take `Settings` keep working without every one of them learning
 * about profiles. The returned object is a copy; the stored settings are never
 * mutated.
 */
export function withProfile(settings: Settings, origin: string): Settings {
  const effective = resolveSettings(settings, origin);
  return {
    ...settings,
    autocorrectThreshold: effective.autocorrectThreshold,
    suggestionThreshold: Math.min(effective.suggestionThreshold, effective.autocorrectThreshold),
    contextualEnabled: effective.contextualEnabled,
    punctuationEnabled: effective.punctuationEnabled,
  };
}

/** `${origin}|${fieldId}` - the key used by "disable for this field". */
export function fieldKey(origin: string, fieldId: string): string {
  return `${origin}|${fieldId}`;
}

export function fieldDisabled(settings: Settings, origin: string, fieldId: string): boolean {
  return settings.disabledFields.includes(fieldKey(origin, fieldId));
}
