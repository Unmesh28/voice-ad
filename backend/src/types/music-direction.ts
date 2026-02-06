/**
 * Type definitions for the Music Director AI system
 * Implements the professional music composition and direction workflow
 */

export type Platform = 'podcast' | 'radio' | 'youtube' | 'instagram' | 'tiktok' | 'spotify';
export type MusicCategory = 'Ambient' | 'Cinematic' | 'Commercial/Pop' | 'Minimal/Corporate';
export type EnergyCurve = 'building' | 'peaking' | 'resolving' | 'static';
export type DuckingIntensity = 'light' | 'medium' | 'heavy';

/**
 * Input to the Music Director service
 */
export interface MusicDirectionInput {
    script: string;
    duration_seconds: number;
    product_category: string;
    brand_tone: string;
    target_audience: string;
    platform: Platform;
    userPrompt?: string; // Original user request for context
}

/**
 * Pre-analysis of the ad's purpose and emotional journey
 */
export interface PreAnalysis {
    ad_purpose: string;
    target_emotion_journey: string;
    music_category: MusicCategory;
    overall_energy_curve: string; // e.g., "3 → 5 → 7 → 5"
}

/**
 * Timing structure breakdown
 */
export interface TimingMap {
    total_duration: number;
    structure: TimingSection[];
}

export interface TimingSection {
    time: string; // e.g., "0-5s"
    section: string; // e.g., "Hook", "Problem/Setup"
    purpose: string; // e.g., "Grab attention"
}

/**
 * Global music direction for the entire track
 */
export interface GlobalMusicDirection {
    genre: string;
    key: string; // e.g., "major", "minor", "C major"
    base_tempo_bpm: number;
    overall_mood: string[];
    instrumentation_palette: string[];
    instruments_to_avoid: string[];
    frequency_notes: string;
    reference_style: string;
}

/**
 * Instrumentation specification for a segment
 */
export interface InstrumentationSpec {
    active: string[]; // Currently playing instruments
    entering: string[]; // Instruments entering in this segment
    exiting: string[]; // Instruments exiting in this segment
    intensity: string; // e.g., "minimal", "medium-low", "full"
}

/**
 * Micro sync point within a segment
 */
export interface MicroSyncPoint {
    time: number; // Timestamp in seconds
    script_moment: string; // What's happening in the script
    music_action: string; // What the music should do
}

/**
 * Detailed music direction for a single segment
 */
export interface SegmentMusicDirection {
    segment_id: number;
    name: string;
    script_text: string;
    start_time: number;
    end_time: number;
    duration: number;

    music_direction: {
        energy_level: number; // 1-10 scale
        energy_curve: EnergyCurve;
        mood: string[];
        tempo: string; // e.g., "108 BPM steady"

        instrumentation: InstrumentationSpec;

        melodic_content: string;
        harmonic_movement: string;
        rhythmic_feel: string;

        transition_in: string;
        transition_out: string;

        sync_points: MicroSyncPoint[];
    };

    sound_design: {
        sfx_suggestions: string[];
        transition_sound: string;
    };

    technical_specs: {
        frequency_focus: string;
        dynamics_db: string; // e.g., "-22dB below peak"
        ducking_intensity: DuckingIntensity;
    };

    text_to_music_prompt: string; // Ready-to-use AI music generation prompt
}

/**
 * Critical sync point across the entire ad
 */
export interface SyncPoint {
    timestamp: number;
    script_moment: string;
    music_action: string;
    importance: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Button ending specification (no fade-outs!)
 */
export interface ButtonEndingSpec {
    type: string; // e.g., "sustained chord with clean cutoff"
    timing: string; // When it should land
    tail_duration_ms: number;
    silence_after_ms: number;
    chord?: string; // e.g., "Root major chord (tonic)"
    description: string;
}

/**
 * Sound design element (SFX, transitions)
 */
export interface SoundDesignElement {
    timestamp: number;
    sound: string;
    purpose: string;
}

/**
 * EQ specification for voice space carving
 */
export interface EQSpec {
    frequency_hz: number;
    gain_db: number;
    q: number;
}

/**
 * Ducking parameters for voice clarity
 */
export interface DuckingSpec {
    enabled: boolean;
    threshold: number;
    ratio: number;
    attack_ms: number;
    release_ms: number;
    duck_amount_db: number;
}

/**
 * Mixing instructions for final audio production
 */
export interface MixingInstructions {
    music_bed_level_db: number;
    voice_level_db: number;
    ducking: DuckingSpec;
    eq_for_voice_space: EQSpec[];
}

/**
 * Platform-specific adjustments
 */
export interface PlatformAdjustments {
    platform: Platform;
    target_loudness_lufs: number;
    true_peak_dbtp: number;
    specific_notes: string;
}

/**
 * Generation strategy recommendation
 */
export interface GenerationStrategy {
    recommended_approach: 'segment-based' | 'full-track';
    reasoning: string;
    fallback: string;
}

/**
 * Complete music direction output
 */
export interface MusicDirectionOutput {
    pre_analysis: PreAnalysis;
    timing_map: TimingMap;
    global_music_direction: GlobalMusicDirection;
    segments: SegmentMusicDirection[];
    critical_sync_points: SyncPoint[];
    button_ending_specification: ButtonEndingSpec;
    sound_design_map: SoundDesignElement[];
    mixing_instructions: MixingInstructions;
    platform_adjustments: PlatformAdjustments;
    full_track_prompt: string;
    quality_checklist: string[];
    generation_strategy: GenerationStrategy;
}

/**
 * Tempo guidelines by ad category
 */
export const TEMPO_GUIDELINES: Record<string, { bpm: [number, number]; energy: string }> = {
    'luxury': { bpm: [60, 80], energy: 'Slow, spacious, elegant' },
    'premium': { bpm: [60, 80], energy: 'Slow, spacious, elegant' },
    'healthcare': { bpm: [70, 90], energy: 'Calm, reassuring, warm' },
    'wellness': { bpm: [70, 90], energy: 'Calm, reassuring, warm' },
    'corporate': { bpm: [100, 120], energy: 'Confident, professional' },
    'b2b': { bpm: [100, 120], energy: 'Confident, professional' },
    'saas': { bpm: [110, 130], energy: 'Modern, forward' },
    'tech': { bpm: [110, 130], energy: 'Modern, forward' },
    'food': { bpm: [100, 125], energy: 'Upbeat, friendly' },
    'beverage': { bpm: [100, 125], energy: 'Upbeat, friendly' },
    'automotive': { bpm: [90, 140], energy: 'Dynamic, powerful' },
    'finance': { bpm: [85, 110], energy: 'Trustworthy, stable' },
    'insurance': { bpm: [85, 110], energy: 'Trustworthy, stable' },
    'entertainment': { bpm: [120, 150], energy: 'Exciting, fun' },
    'fitness': { bpm: [130, 160], energy: 'High-energy, driving' },
    'sports': { bpm: [130, 160], energy: 'High-energy, driving' },
};

/**
 * Platform loudness targets
 */
export const PLATFORM_LOUDNESS: Record<Platform, { lufs: number; peak: number }> = {
    'podcast': { lufs: -16, peak: -1 },
    'spotify': { lufs: -14, peak: -1 },
    'youtube': { lufs: -14, peak: -1 },
    'radio': { lufs: -24, peak: -2 }, // US Broadcast (ATSC)
    'instagram': { lufs: -14, peak: -1 },
    'tiktok': { lufs: -14, peak: -1 },
};
