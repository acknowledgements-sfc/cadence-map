// ============================================================
// CADENCE — Release Template Engine
//
// Each template defines the standard tasks for a release type,
// with dependency edges and due-date offsets (days before release).
// The cascade engine uses these offsets to compute actual dates.
// ============================================================

export type ReleaseType = 'Single' | 'EP' | 'Album' | 'Mixtape' | 'Compilation'
export type TaskPhase =
  | 'Pre-Production'
  | 'Production'
  | 'Distribution'
  | 'Marketing'
  | 'Release'
  | 'Post-Release'
export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'skipped'

// Domain knowledge — industry-standard lead times (days before release)
export const DOMAIN_KNOWLEDGE = {
  SPOTIFY_EDITORIAL_LEAD: 28,       // 4 weeks
  APPLE_MUSIC_EDITORIAL_LEAD: 21,   // 3 weeks
  DISTRIBUTION_PROCESSING: 7,       // 3–7 business days (use 7 to be safe)
  PRESS_BLOG_LEAD: 21,              // 2–4 weeks
  PRESS_MAGAZINE_LEAD: 63,          // 8–12 weeks (use 9)
  PLAYLIST_PITCH_LEAD: 21,          // 2–3 weeks
  PRESAVE_CAMPAIGN_LEAD: 21,        // 2–4 weeks before release
  CONTENT_CREATION_LEAD: 14,        // 2 weeks of social content ready
  ARTWORK_DESIGN: 14,               // 1–3 weeks
  MASTERING_TURNAROUND: 7,          // typical turnaround
  MIXING_TURNAROUND: 7,
  VINYL_MANUFACTURING: 98,          // 12–16 weeks — not in MVP template but here for reference
  CD_MANUFACTURING: 35,
  MUSIC_VIDEO_PRODUCTION: 42,
  RADIO_PROMOTION_LEAD: 49,         // 6–8 weeks
} as const

// ============================================================
// Template task definition (before IDs are assigned)
// ============================================================
export interface TemplateTask {
  key: string             // unique within template, used to wire deps
  title: string
  description: string
  phase: TaskPhase
  dueDateOffset: number   // negative = N days BEFORE release date
  effortHours: number
  isExternal: boolean
  isOptional: boolean
  dependsOn: string[]     // keys of tasks this depends on (must complete first)
  lagDays?: number        // buffer days after dependency before this can start
}

// ============================================================
// SINGLE release template
// Shorter chain, faster cycle. Default for most indie artists.
// ============================================================
const SINGLE_TASKS: TemplateTask[] = [
  // --- Pre-Production ---
  {
    key: 'recording',
    title: 'Complete recording',
    description: 'Finish all vocal and instrumental tracking for the single.',
    phase: 'Pre-Production',
    dueDateOffset: -49,
    effortHours: 8,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'mixing',
    title: 'Submit for mixing',
    description: 'Send stems to mix engineer. Agree on delivery date.',
    phase: 'Production',
    dueDateOffset: -42,
    effortHours: 2,
    isExternal: true,
    isOptional: false,
    dependsOn: ['recording'],
    lagDays: 0,
  },
  {
    key: 'mix_delivery',
    title: 'Receive mixed stems',
    description: 'Mix engineer delivers final mix. Review and approve.',
    phase: 'Production',
    dueDateOffset: -35,
    effortHours: 3,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mixing'],
    lagDays: 7,
  },
  {
    key: 'mastering',
    title: 'Submit for mastering',
    description: 'Send approved mix to mastering engineer.',
    phase: 'Production',
    dueDateOffset: -28,
    effortHours: 1,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mix_delivery'],
    lagDays: 0,
  },
  {
    key: 'master_delivery',
    title: 'Receive mastered audio',
    description: 'Mastering engineer delivers final WAV/FLAC. Review loudness and quality.',
    phase: 'Production',
    dueDateOffset: -21,
    effortHours: 2,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mastering'],
    lagDays: 7,
  },

  // --- Artwork ---
  {
    key: 'artwork_brief',
    title: 'Create artwork brief',
    description: 'Write the creative brief for cover art: mood, references, color palette, text treatment.',
    phase: 'Production',
    dueDateOffset: -35,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'artwork_design',
    title: 'Commission artwork design',
    description: 'Share brief with designer. Agree on delivery date and revision rounds.',
    phase: 'Production',
    dueDateOffset: -28,
    effortHours: 1,
    isExternal: true,
    isOptional: false,
    dependsOn: ['artwork_brief'],
    lagDays: 0,
  },
  {
    key: 'artwork_final',
    title: 'Approve final artwork',
    description: 'Review delivered artwork. Request revisions if needed. Approve final version at 3000×3000px.',
    phase: 'Production',
    dueDateOffset: -21,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['artwork_design'],
    lagDays: 7,
  },

  // --- Legal/Admin (optional) ---
  {
    key: 'split_sheet',
    title: 'Complete split sheet',
    description: 'Document ownership splits with all contributors before distribution.',
    phase: 'Pre-Production',
    dueDateOffset: -42,
    effortHours: 1,
    isExternal: false,
    isOptional: true,
    dependsOn: [],
  },

  // --- Distribution ---
  {
    key: 'isrc',
    title: 'Register ISRC code',
    description: 'Get an ISRC code for this recording. Most distributors assign one automatically.',
    phase: 'Distribution',
    dueDateOffset: -21,
    effortHours: 0.5,
    isExternal: false,
    isOptional: false,
    dependsOn: ['master_delivery', 'artwork_final'],
  },
  {
    key: 'distribution_submit',
    title: 'Submit to distributor',
    description: 'Upload audio, artwork, and metadata to DistroKid/TuneCore/CD Baby. Set release date.',
    phase: 'Distribution',
    dueDateOffset: -DOMAIN_KNOWLEDGE.DISTRIBUTION_PROCESSING,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['master_delivery', 'artwork_final'],
    lagDays: 0,
  },

  // --- Pitching ---
  {
    key: 'spotify_pitch',
    title: 'Pitch Spotify editorial',
    description: `Submit to Spotify for Artists editorial consideration. Must be at least ${DOMAIN_KNOWLEDGE.SPOTIFY_EDITORIAL_LEAD} days before release. Write compelling pitch notes covering mood, instrumentation, and story.`,
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.SPOTIFY_EDITORIAL_LEAD,
    effortHours: 1.5,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
    lagDays: 0,
  },
  {
    key: 'playlist_pitch',
    title: 'Pitch independent playlist curators',
    description: `Contact 10–20 independent curators via SubmitHub or direct outreach. Personalize each pitch. Start ${DOMAIN_KNOWLEDGE.PLAYLIST_PITCH_LEAD} days before release.`,
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PLAYLIST_PITCH_LEAD,
    effortHours: 3,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
    lagDays: 0,
  },
  {
    key: 'press_pitch',
    title: 'Send press/blog pitches',
    description: 'Write and send pitches to music blogs and online publications. Lead time: 2–4 weeks.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESS_BLOG_LEAD,
    effortHours: 3,
    isExternal: false,
    isOptional: true,
    dependsOn: [],
  },

  // --- Pre-save ---
  {
    key: 'presave',
    title: 'Launch pre-save campaign',
    description: 'Create pre-save link (Feature.fm or similar). Announce to your audience and add to bio link.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESAVE_CAMPAIGN_LEAD,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
    lagDays: 0,
  },

  // --- Content ---
  {
    key: 'content_plan',
    title: 'Plan social media content',
    description: 'Map out 2–4 weeks of pre-release content: teasers, behind-the-scenes, countdowns. Draft captions.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.CONTENT_CREATION_LEAD - 7,
    effortHours: 3,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'content_create',
    title: 'Create release content assets',
    description: 'Produce visual and video content for the release week: animated cover, teaser clips, lyric snippets.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.CONTENT_CREATION_LEAD,
    effortHours: 5,
    isExternal: false,
    isOptional: false,
    dependsOn: ['content_plan', 'artwork_final'],
  },

  // --- Release day ---
  {
    key: 'release_day',
    title: 'Release day — post and announce',
    description: 'Go live across all platforms. Post across social channels. Thank fans. Monitor streaming dashboards.',
    phase: 'Release',
    dueDateOffset: 0,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },

  // --- Post-release ---
  {
    key: 'post_playlist_followup',
    title: 'Follow up on playlist pitches',
    description: 'Check pitch responses. Thank curators who added the track. Send streaming data to those who passed.',
    phase: 'Post-Release',
    dueDateOffset: 7,
    effortHours: 1,
    isExternal: false,
    isOptional: true,
    dependsOn: ['release_day'],
  },
  {
    key: 'copyright_register',
    title: 'Register copyright',
    description: 'File copyright registration with the US Copyright Office (copyright.gov). Recommended within 3 months of release.',
    phase: 'Post-Release',
    dueDateOffset: 14,
    effortHours: 1,
    isExternal: false,
    isOptional: true,
    dependsOn: ['release_day'],
  },
]

// ============================================================
// EP template — extends single with additional tracks + longer runway
// ============================================================
const EP_TASKS: TemplateTask[] = [
  {
    key: 'recording',
    title: 'Complete all recording sessions',
    description: 'Finish vocal and instrumental tracking for all tracks on the EP.',
    phase: 'Pre-Production',
    dueDateOffset: -84,
    effortHours: 20,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'mixing',
    title: 'Submit all tracks for mixing',
    description: 'Send stems for all EP tracks to the mix engineer. Clarify order and any track-specific notes.',
    phase: 'Production',
    dueDateOffset: -77,
    effortHours: 3,
    isExternal: true,
    isOptional: false,
    dependsOn: ['recording'],
  },
  {
    key: 'mix_delivery',
    title: 'Receive and approve all mixes',
    description: 'Review all mixed tracks. Request revisions. Approve in sequence for mastering.',
    phase: 'Production',
    dueDateOffset: -63,
    effortHours: 6,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mixing'],
    lagDays: 14,
  },
  {
    key: 'mastering',
    title: 'Submit EP for mastering',
    description: 'Send all approved mixes for mastering. Ensure consistent loudness and tonality across tracks.',
    phase: 'Production',
    dueDateOffset: -56,
    effortHours: 2,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mix_delivery'],
  },
  {
    key: 'master_delivery',
    title: 'Receive mastered EP',
    description: 'Review all mastered tracks. Check sequencing, fade-ins/outs, and overall EP flow.',
    phase: 'Production',
    dueDateOffset: -42,
    effortHours: 3,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mastering'],
    lagDays: 14,
  },
  {
    key: 'track_listing',
    title: 'Finalize track listing and credits',
    description: 'Lock in track order, titles, featuring credits, songwriting splits, and liner notes.',
    phase: 'Production',
    dueDateOffset: -42,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['mix_delivery'],
  },
  {
    key: 'split_sheet',
    title: 'Complete split sheets for all tracks',
    description: 'Document ownership splits for every track before distribution.',
    phase: 'Pre-Production',
    dueDateOffset: -70,
    effortHours: 3,
    isExternal: false,
    isOptional: true,
    dependsOn: [],
  },
  {
    key: 'artwork_brief',
    title: 'Create artwork brief',
    description: 'Define the visual concept for the EP: theme, color, typography, and any additional assets needed (back cover, insert).',
    phase: 'Production',
    dueDateOffset: -63,
    effortHours: 3,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'artwork_design',
    title: 'Commission artwork',
    description: 'Brief designer. Agree on deliverables: front cover, any additional EP assets.',
    phase: 'Production',
    dueDateOffset: -56,
    effortHours: 1,
    isExternal: true,
    isOptional: false,
    dependsOn: ['artwork_brief'],
  },
  {
    key: 'artwork_final',
    title: 'Approve final artwork',
    description: 'Review and approve all artwork assets at full resolution.',
    phase: 'Production',
    dueDateOffset: -35,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['artwork_design'],
    lagDays: 14,
  },
  {
    key: 'lead_single',
    title: 'Choose and prepare lead single',
    description: 'Select the first single from the EP. Prepare for early release 2–4 weeks before EP drop.',
    phase: 'Marketing',
    dueDateOffset: -42,
    effortHours: 2,
    isExternal: false,
    isOptional: true,
    dependsOn: ['master_delivery'],
  },
  {
    key: 'distribution_submit',
    title: 'Submit EP to distributor',
    description: 'Upload all tracks, artwork, and metadata. Set release date and configure pre-save.',
    phase: 'Distribution',
    dueDateOffset: -DOMAIN_KNOWLEDGE.DISTRIBUTION_PROCESSING,
    effortHours: 3,
    isExternal: false,
    isOptional: false,
    dependsOn: ['master_delivery', 'artwork_final', 'track_listing'],
  },
  {
    key: 'spotify_pitch',
    title: 'Pitch Spotify editorial',
    description: `Submit to Spotify editorial. For EPs, pitch the lead single. Must be ${DOMAIN_KNOWLEDGE.SPOTIFY_EDITORIAL_LEAD}+ days before release.`,
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.SPOTIFY_EDITORIAL_LEAD,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'playlist_pitch',
    title: 'Pitch playlist curators',
    description: 'Pitch 15–30 curators across relevant genres. Prioritize curators who have played similar artists.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PLAYLIST_PITCH_LEAD,
    effortHours: 4,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'press_pitch',
    title: 'Send press pitches',
    description: 'Pitch blogs, online publications, and local press. An EP warrants more press effort than a single.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESS_BLOG_LEAD,
    effortHours: 4,
    isExternal: false,
    isOptional: true,
    dependsOn: [],
  },
  {
    key: 'presave',
    title: 'Launch pre-save campaign',
    description: 'Create pre-save link. Start building anticipation. Update all bios and link-in-bio.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESAVE_CAMPAIGN_LEAD,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'content_plan',
    title: 'Plan EP rollout content',
    description: 'Map 4 weeks of content: teasers, track reveals, behind-the-scenes, release week assets.',
    phase: 'Marketing',
    dueDateOffset: -35,
    effortHours: 4,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'content_create',
    title: 'Produce release content assets',
    description: 'Create all visual and video content for the rollout period.',
    phase: 'Marketing',
    dueDateOffset: -21,
    effortHours: 8,
    isExternal: false,
    isOptional: false,
    dependsOn: ['content_plan', 'artwork_final'],
  },
  {
    key: 'release_day',
    title: 'EP release day',
    description: 'Go live. Post across all platforms. Engage with fan responses. Monitor streaming dashboards.',
    phase: 'Release',
    dueDateOffset: 0,
    effortHours: 3,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'post_analytics',
    title: 'Review first-week streaming analytics',
    description: 'Analyze Spotify for Artists, Apple Music Analytics, and distributor dashboards. Note what worked.',
    phase: 'Post-Release',
    dueDateOffset: 8,
    effortHours: 2,
    isExternal: false,
    isOptional: true,
    dependsOn: ['release_day'],
  },
  {
    key: 'copyright_register',
    title: 'Register copyright for all tracks',
    description: 'File copyright registration for all EP tracks.',
    phase: 'Post-Release',
    dueDateOffset: 21,
    effortHours: 2,
    isExternal: false,
    isOptional: true,
    dependsOn: ['release_day'],
  },
]

// ============================================================
// ALBUM template — full campaign with longer runway
// ============================================================
const ALBUM_TASKS: TemplateTask[] = [
  {
    key: 'recording',
    title: 'Complete all recording sessions',
    description: 'Finish all tracking for every album track. Document any overdub sessions needed.',
    phase: 'Pre-Production',
    dueDateOffset: -168,
    effortHours: 40,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'track_selection',
    title: 'Finalize track selection and sequencing',
    description: 'Lock in which tracks make the album and the running order. This decision affects everything downstream.',
    phase: 'Pre-Production',
    dueDateOffset: -154,
    effortHours: 5,
    isExternal: false,
    isOptional: false,
    dependsOn: ['recording'],
  },
  {
    key: 'mixing',
    title: 'Submit all tracks for mixing',
    description: 'Send all stems to mix engineer. Provide track notes, reference mixes, and a clear delivery schedule.',
    phase: 'Production',
    dueDateOffset: -140,
    effortHours: 4,
    isExternal: true,
    isOptional: false,
    dependsOn: ['track_selection'],
  },
  {
    key: 'mix_delivery',
    title: 'Receive and approve all mixes',
    description: 'Review all mixes across multiple listening environments. Manage revision rounds.',
    phase: 'Production',
    dueDateOffset: -112,
    effortHours: 10,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mixing'],
    lagDays: 28,
  },
  {
    key: 'mastering',
    title: 'Submit album for mastering',
    description: 'Send all approved mixes for mastering in sequence. Brief on tone, loudness target, and format requirements.',
    phase: 'Production',
    dueDateOffset: -98,
    effortHours: 3,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mix_delivery'],
  },
  {
    key: 'master_delivery',
    title: 'Receive mastered album',
    description: 'Review complete mastered album. Check sequencing, DDP/WAV files, and metadata.',
    phase: 'Production',
    dueDateOffset: -77,
    effortHours: 5,
    isExternal: true,
    isOptional: false,
    dependsOn: ['mastering'],
    lagDays: 21,
  },
  {
    key: 'split_sheets',
    title: 'Complete all split sheets',
    description: 'Every track must have a signed split sheet before distribution.',
    phase: 'Pre-Production',
    dueDateOffset: -140,
    effortHours: 6,
    isExternal: false,
    isOptional: true,
    dependsOn: ['track_selection'],
  },
  {
    key: 'isrc_codes',
    title: 'Register ISRC codes for all tracks',
    description: 'Ensure every track has a unique ISRC. Most distributors handle this, but verify.',
    phase: 'Distribution',
    dueDateOffset: -70,
    effortHours: 1,
    isExternal: false,
    isOptional: false,
    dependsOn: ['master_delivery'],
  },
  {
    key: 'liner_notes',
    title: 'Write liner notes and credits',
    description: 'All track credits, production credits, lyrics, acknowledgements, and any sleeve notes.',
    phase: 'Production',
    dueDateOffset: -84,
    effortHours: 8,
    isExternal: false,
    isOptional: false,
    dependsOn: ['track_selection'],
  },
  {
    key: 'artwork_brief',
    title: 'Create album artwork brief',
    description: 'Define the full visual concept: front cover, back cover, booklet, inner sleeve, CD/vinyl label design.',
    phase: 'Production',
    dueDateOffset: -126,
    effortHours: 5,
    isExternal: false,
    isOptional: false,
    dependsOn: ['track_selection'],
  },
  {
    key: 'artwork_design',
    title: 'Commission artwork and design',
    description: 'Brief designer and photographer. Organize any photo shoots needed.',
    phase: 'Production',
    dueDateOffset: -112,
    effortHours: 3,
    isExternal: true,
    isOptional: false,
    dependsOn: ['artwork_brief'],
  },
  {
    key: 'artwork_final',
    title: 'Approve all artwork assets',
    description: 'Review and approve: front cover, back cover, all sleeve artwork at print resolution.',
    phase: 'Production',
    dueDateOffset: -70,
    effortHours: 4,
    isExternal: false,
    isOptional: false,
    dependsOn: ['artwork_design'],
    lagDays: 28,
  },
  {
    key: 'lead_single_1',
    title: 'Release lead single #1',
    description: 'First album single drops to build anticipation. Ideally 8–12 weeks before album.',
    phase: 'Marketing',
    dueDateOffset: -63,
    effortHours: 4,
    isExternal: false,
    isOptional: true,
    dependsOn: ['master_delivery'],
  },
  {
    key: 'lead_single_2',
    title: 'Release lead single #2',
    description: 'Second album single drops 4 weeks before album to sustain momentum.',
    phase: 'Marketing',
    dueDateOffset: -28,
    effortHours: 3,
    isExternal: false,
    isOptional: true,
    dependsOn: ['lead_single_1'],
  },
  {
    key: 'press_magazine',
    title: 'Pitch long-lead press (magazines)',
    description: `Pitch magazines and major publications. These require ${DOMAIN_KNOWLEDGE.PRESS_MAGAZINE_LEAD / 7}+ weeks lead time.`,
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESS_MAGAZINE_LEAD,
    effortHours: 5,
    isExternal: false,
    isOptional: true,
    dependsOn: [],
  },
  {
    key: 'distribution_submit',
    title: 'Submit album to distributor',
    description: 'Upload all tracks, artwork, and metadata. Set release date, configure any pre-orders.',
    phase: 'Distribution',
    dueDateOffset: -DOMAIN_KNOWLEDGE.DISTRIBUTION_PROCESSING,
    effortHours: 4,
    isExternal: false,
    isOptional: false,
    dependsOn: ['master_delivery', 'artwork_final', 'liner_notes'],
  },
  {
    key: 'spotify_pitch',
    title: 'Pitch Spotify editorial',
    description: `Submit lead single/album to Spotify editorial. Must be ${DOMAIN_KNOWLEDGE.SPOTIFY_EDITORIAL_LEAD}+ days before release.`,
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.SPOTIFY_EDITORIAL_LEAD,
    effortHours: 2,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'playlist_pitch',
    title: 'Pitch playlist curators',
    description: 'Pitch 20–40 curators. For albums, prioritize genre-specific playlist curators.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PLAYLIST_PITCH_LEAD,
    effortHours: 6,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'press_pitch',
    title: 'Send short-lead press pitches',
    description: 'Pitch blogs, online publications, independent music media 3–4 weeks before release.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESS_BLOG_LEAD,
    effortHours: 5,
    isExternal: false,
    isOptional: true,
    dependsOn: [],
  },
  {
    key: 'presave',
    title: 'Launch pre-save / pre-order campaign',
    description: 'Set up pre-save and optional pre-order. Start announcement campaign.',
    phase: 'Marketing',
    dueDateOffset: -DOMAIN_KNOWLEDGE.PRESAVE_CAMPAIGN_LEAD,
    effortHours: 3,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'content_plan',
    title: 'Plan album rollout content campaign',
    description: 'Map 8 weeks of content: track reveals, lyric videos, listening party, release week activations.',
    phase: 'Marketing',
    dueDateOffset: -56,
    effortHours: 8,
    isExternal: false,
    isOptional: false,
    dependsOn: [],
  },
  {
    key: 'content_create',
    title: 'Produce rollout content assets',
    description: 'Create all visual, video, and copy assets for the campaign.',
    phase: 'Marketing',
    dueDateOffset: -21,
    effortHours: 15,
    isExternal: false,
    isOptional: false,
    dependsOn: ['content_plan', 'artwork_final'],
  },
  {
    key: 'release_day',
    title: 'Album release day',
    description: 'Go live. Execute all scheduled social posts. Engage with fan responses all day.',
    phase: 'Release',
    dueDateOffset: 0,
    effortHours: 4,
    isExternal: false,
    isOptional: false,
    dependsOn: ['distribution_submit'],
  },
  {
    key: 'post_analytics',
    title: 'Week-one analytics review',
    description: 'Deep dive into streaming data, playlist adds, social performance, and press coverage.',
    phase: 'Post-Release',
    dueDateOffset: 8,
    effortHours: 3,
    isExternal: false,
    isOptional: true,
    dependsOn: ['release_day'],
  },
  {
    key: 'copyright_register',
    title: 'Register copyright for all tracks',
    description: 'File copyright registration for all album tracks.',
    phase: 'Post-Release',
    dueDateOffset: 21,
    effortHours: 3,
    isExternal: false,
    isOptional: true,
    dependsOn: ['release_day'],
  },
]

// ============================================================
// Template map
// ============================================================
export const TEMPLATES: Record<ReleaseType, TemplateTask[]> = {
  Single: SINGLE_TASKS,
  EP: EP_TASKS,
  Album: ALBUM_TASKS,
  Mixtape: ALBUM_TASKS,       // Mixtape follows album workflow
  Compilation: EP_TASKS,      // Compilation follows EP workflow
}

// ============================================================
// Helper: compute actual due dates from release date + offsets
// ============================================================
export function computeDueDate(releaseDate: Date, offsetDays: number): Date {
  const d = new Date(releaseDate)
  d.setDate(d.getDate() + offsetDays)
  return d
}

export function dateToISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ============================================================
// Build the insertion payload for a new release
// Returns tasks[] and edges[] ready to insert into Supabase
// ============================================================
export interface TaskInsert {
  release_id: string
  user_id: string
  title: string
  description: string
  phase: TaskPhase
  due_date: string
  due_date_offset: number
  effort_hours: number
  is_external: boolean
  is_optional: boolean
  template_key: string
  sort_order: number
  status: TaskStatus
}

export interface DependencyInsert {
  task_id: string     // will be filled after tasks are created
  depends_on_task_id: string
  lag_days: number
}

export function buildReleaseTaskPayload(
  releaseType: ReleaseType,
  releaseDateStr: string,
  releaseId: string,
  userId: string
): { tasks: TaskInsert[]; keyOrder: string[] } {
  const template = TEMPLATES[releaseType] ?? TEMPLATES.Single
  const releaseDate = new Date(releaseDateStr + 'T12:00:00Z') // noon UTC to avoid timezone drift

  const tasks: TaskInsert[] = template.map((t, i) => ({
    release_id: releaseId,
    user_id: userId,
    title: t.title,
    description: t.description,
    phase: t.phase,
    due_date: dateToISO(computeDueDate(releaseDate, t.dueDateOffset)),
    due_date_offset: t.dueDateOffset,
    effort_hours: t.effortHours,
    is_external: t.isExternal,
    is_optional: t.isOptional,
    template_key: t.key,
    sort_order: i,
    status: 'pending',
  }))

  const keyOrder = template.map(t => t.key)
  return { tasks, keyOrder }
}
