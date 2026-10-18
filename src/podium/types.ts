export type Json = Record<string, unknown>;

export interface HealthResponse extends Json {
  status: string;
  /** Podium's own version; absent on older Podium releases. */
  version?: string;
  worker: string;
  heartbeatAgeSeconds?: number;
}

export interface SettingsField extends Json {
  key: string;
  kind: string;
  label?: string;
  help?: string;
  section?: string;
  value?: unknown;
  isSet?: boolean;
  source?: string;
  defaultValue?: unknown;
}

export interface SettingsResponse extends Json {
  fields: SettingsField[];
  effective: Record<string, unknown>;
}

export type RefreshScope = 'all' | 'group';

/** Glob patterns over provider (M3U) group names. `null` clears a stored filter. */
export interface GroupFilter {
  includeGroups?: string[] | undefined;
  excludeGroups?: string[] | undefined;
}

export interface ExcludeGroupFilter {
  excludeGroups: string[];
}

/** Where a channel's matches may come from. Provider IDs are Podium/Dispatcharr M3U account IDs. */
export interface MatchScope {
  providers?: number[];
  groupFilter?: GroupFilter | null;
  aliasGroupFilters?: Record<string, ExcludeGroupFilter>;
  containsGroupFilters?: Record<string, ExcludeGroupFilter>;
  aliasProviders?: Record<string, number[]>;
  /** Keyed by alias, then provider ID. */
  aliasProviderGroupFilters?: Record<string, Record<string, ExcludeGroupFilter>>;
}

export interface PreviewRequest extends MatchScope {
  channelId: number;
  aliases?: string[];
  contains?: string[];
  exclude?: string[];
}

export interface ApplyRequest {
  order: number[];
  removeUnmatched?: boolean;
  force?: boolean;
  allowAssign?: boolean;
  /** Stream IDs a check pruned; an apply with allowAssign skips them when keeping the old tail. */
  pruned?: number[];
}

export interface RulesRequest extends MatchScope {
  aliases: string[];
  contains: string[];
  exclude: string[];
  minResolution?: string | null;
  maxResolution?: string | null;
}

export type GroupMode = 'always' | 'never' | 'after_epg_start' | 'assigned';

export interface GroupUpdateRequest {
  mode: GroupMode;
  measureOnly?: boolean;
  minResolution?: string | null;
  maxResolution?: string | null;
  groupFilter?: GroupFilter | null;
}

export interface GroupPatternRequest extends GroupUpdateRequest {
  pattern: string;
}

export interface OrderingWeights {
  resolution?: number;
  bitrate?: number;
  fps?: number;
  codec?: number;
  audio?: number;
  hdr?: number;
  preferH265?: boolean;
  hdrPreference?: string;
  hevcBitrateFactor?: number;
  uhdBitrateKbps?: number;
}

export interface OrderingRequest {
  mode?: string;
  providerPreference?: string[];
  weights?: OrderingWeights;
}

export interface QualityProfileQuery {
  minSamples: number;
  eventOnly?: boolean;
  include?: string;
  exclude?: string;
}
