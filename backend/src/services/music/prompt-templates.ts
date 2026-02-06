/**
 * Prompt engineering templates for AI music generation
 * Based on energy levels, moods, and professional production standards
 */

/**
 * Generate a text-to-music prompt based on energy level and context
 */
export function buildMusicPrompt(params: {
    energy_level: number; // 1-10
    genre: string;
    mood: string[];
    tempo_bpm: number;
    instruments: string[];
    section_type: 'intro' | 'building' | 'peak' | 'resolution' | 'outro';
    is_button_ending?: boolean;
}): string {
    const { energy_level, genre, mood, tempo_bpm, instruments, section_type, is_button_ending } = params;

    // Select template based on energy level
    if (energy_level <= 2) {
        return buildMinimalPrompt(genre, mood, tempo_bpm, instruments);
    } else if (energy_level <= 4) {
        return buildBuildingPrompt(genre, mood, tempo_bpm, instruments, section_type);
    } else if (energy_level <= 6) {
        return buildEstablishedPrompt(genre, mood, tempo_bpm, instruments);
    } else if (energy_level <= 8) {
        return buildPeakPrompt(genre, mood, tempo_bpm, instruments);
    } else {
        return buildMaximumPrompt(genre, mood, tempo_bpm, instruments);
    }
}

/**
 * Energy 1-2: Minimal/Ambient
 */
function buildMinimalPrompt(
    genre: string,
    mood: string[],
    bpm: number,
    instruments: string[]
): string {
    const moodStr = mood.slice(0, 2).join(' and ');
    const instrStr = instruments.slice(0, 2).join(' with gentle ');

    return `ambient ${genre} music, ${moodStr}, ${bpm} BPM, soft ${instrStr}, very sparse minimal arrangement, instrumental background music, clean mix with space in mid frequencies for voiceover, subtle and unobtrusive`;
}

/**
 * Energy 3-4: Building/Supportive
 */
function buildBuildingPrompt(
    genre: string,
    mood: string[],
    bpm: number,
    instruments: string[],
    direction: string
): string {
    const moodStr = mood.join(' ');
    const instrStr = instruments.slice(0, 3).join(' with ');

    return `${genre} instrumental, ${moodStr} feeling, ${bpm} BPM, ${instrStr}, building energy, medium arrangement, broadcast-ready production, leaves room for voice, ${direction}`;
}

/**
 * Energy 5-6: Established/Engaging
 */
function buildEstablishedPrompt(
    genre: string,
    mood: string[],
    bpm: number,
    instruments: string[]
): string {
    const moodStr = mood.slice(0, 3).join(' and ');
    const instrStr = instruments.join(', ');

    return `${genre} production music, ${moodStr}, ${bpm} BPM, ${instrStr}, established groove with forward momentum, professional broadcast quality, mixed for voiceover, engaging but not overpowering`;
}

/**
 * Energy 7-8: Peak/Climactic
 */
function buildPeakPrompt(
    genre: string,
    mood: string[],
    bpm: number,
    instruments: string[]
): string {
    const moodStr = mood.filter(m => m.includes('energetic') || m.includes('triumphant') || m.includes('exciting')).join(' ');
    const instrStr = instruments.join(', ');

    return `upbeat ${genre} instrumental, ${moodStr || 'energetic triumphant'}, ${bpm} BPM, full arrangement with ${instrStr}, peak energy climactic section, driving rhythm, broadcast-ready professional mix, maintains voice space in mid frequencies`;
}

/**
 * Energy 9-10: Maximum (use sparingly)
 */
function buildMaximumPrompt(
    genre: string,
    mood: string[],
    bpm: number,
    instruments: string[]
): string {
    const moodStr = mood.join(' ');
    const instrStr = instruments.join(', ');

    return `high-energy ${genre}, ${moodStr}, ${bpm} BPM, full powerful arrangement, maximum intensity climax, ${instrStr}, explosive energy, professional production, brief peak moment`;
}

/**
 * Resolution/Outro with button ending
 */
export function buildOutroPrompt(
    genre: string,
    mood: string[],
    bpm: number,
    instruments: string[],
    buttonEndingType: 'sustained' | 'quick' | 'stinger' = 'sustained'
): string {
    const moodStr = mood.join(' ');
    const instrStr = instruments.join(' with ');

    let endingDescription = '';
    switch (buttonEndingType) {
        case 'sustained':
            endingDescription = 'CLEAN DEFINITIVE BUTTON ENDING on downbeat with 800ms sustain then silence';
            break;
        case 'quick':
            endingDescription = 'QUICK PUNCHY BUTTON ENDING, sharp cutoff, no sustain';
            break;
        case 'stinger':
            endingDescription = 'STINGER BUTTON ENDING with impact hit and immediate silence';
            break;
    }

    return `warm ${genre} conclusion, ${moodStr}, ${bpm} BPM with relaxing feel, ${instrStr}, resolving energy, satisfying musical conclusion, ${endingDescription}, no fade out, 1 second silence after final chord`;
}

/**
 * Category-specific style presets
 */
export const STYLE_PRESETS: Record<string, string> = {
    'corporate': 'Corporate contemporary with acoustic piano, warm strings, and subtle percussion',
    'energetic': 'Energetic modern pop with bright synths, driving beat, and uplifting melody',
    'calm': 'Calm ambient with soft piano, atmospheric pads, and minimal percussion',
    'dramatic': 'Dramatic cinematic with orchestral strings, powerful brass, and impactful percussion',
    'tech': 'Modern tech with clean electronic sounds, minimal beats, and forward-moving synths',
    'luxury': 'Luxurious ambient with soft piano, elegant strings, and spacious arrangement',
    'playful': 'Playful upbeat with quirky instruments, bouncy rhythm, and fun melodic elements',
    'emotional': 'Emotional cinematic with piano, strings, and gentle build-ups',
};

/**
 * Instrument suggestions by category
 */
export const INSTRUMENT_PALETTE: Record<string, string[]> = {
    'corporate': ['acoustic piano', 'warm strings', 'subtle percussion', 'clean electric piano'],
    'tech': ['clean synth pad', 'electronic drums', 'synth bass', 'digital textures'],
    'luxury': ['soft piano', 'elegant strings', 'subtle harp', 'ambient pad'],
    'energetic': ['bright synths', 'driving drums', 'electric bass', 'rhythmic guitars'],
    'calm': ['soft piano', 'atmospheric pads', 'gentle strings', 'minimal percussion'],
    'dramatic': ['orchestral strings', 'powerful brass', 'timpani', 'epic percussion'],
    'playful': ['pizzicato strings', 'marimba', 'quirky synths', 'light percussion'],
    'emotional': ['piano', 'strings', 'acoustic guitar', 'soft pads'],
};

/**
 * Tempo-based mood suggestions
 */
export function suggestMoodByTempo(bpm: number): string[] {
    if (bpm < 80) {
        return ['calm', 'contemplative', 'luxurious', 'intimate'];
    } else if (bpm < 100) {
        return ['warm', 'trustworthy', 'reassuring', 'professional'];
    } else if (bpm < 120) {
        return ['confident', 'modern', 'capable', 'forward-moving'];
    } else if (bpm < 140) {
        return ['energetic', 'upbeat', 'exciting', 'dynamic'];
    } else {
        return ['high-energy', 'intense', 'driving', 'powerful'];
    }
}

/**
 * Anti-patterns to avoid in prompts
 */
export const PROMPT_ANTI_PATTERNS = [
    'epic cinematic orchestral', // too dramatic for most ads
    'with vocals',
    'with singing',
    'lo-fi beats', // too muddy
    'experimental',
    'avant-garde',
    'fade out ending',
    'fades away',
    'relaxing', // without context, too sleepy
    'background music', // too generic alone
];

/**
 * Pro-patterns to always include
 */
export const PROMPT_PRO_PATTERNS = [
    'instrumental only',
    'no vocals',
    'broadcast quality',
    'professional production',
    'space for voiceover',
    'carved mid frequencies',
    'button ending, no fade',
];

/**
 * Build a complete segment prompt with all best practices
 */
export function buildSegmentPrompt(params: {
    segment_name: string;
    energy_level: number;
    genre: string;
    mood: string[];
    tempo_bpm: number;
    instruments: string[];
    melodic_content: string;
    harmonic_movement: string;
    rhythmic_feel: string;
    is_final_segment?: boolean;
}): string {
    const {
        energy_level,
        genre,
        mood,
        tempo_bpm,
        instruments,
        melodic_content,
        harmonic_movement,
        rhythmic_feel,
        is_final_segment,
    } = params;

    // Base prompt from energy level
    let basePrompt = '';

    if (is_final_segment) {
        basePrompt = buildOutroPrompt(genre, mood, tempo_bpm, instruments);
    } else {
        basePrompt = buildMusicPrompt({
            energy_level,
            genre,
            mood,
            tempo_bpm,
            instruments,
            section_type: energy_level <= 4 ? 'building' : energy_level <= 6 ? 'peak' : 'resolution',
        });
    }

    // Add specific musical details
    const details: string[] = [];

    if (melodic_content && melodic_content !== 'none') {
        details.push(melodic_content);
    }

    if (harmonic_movement) {
        details.push(harmonic_movement);
    }

    if (rhythmic_feel) {
        details.push(rhythmic_feel);
    }

    // Combine
    if (details.length > 0) {
        return `${basePrompt}, ${details.join(', ')}`;
    }

    return basePrompt;
}

/**
 * Validate prompt against anti-patterns
 */
export function validatePrompt(prompt: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const lowerPrompt = prompt.toLowerCase();

    // Check for anti-patterns
    for (const antiPattern of PROMPT_ANTI_PATTERNS) {
        if (lowerPrompt.includes(antiPattern.toLowerCase())) {
            issues.push(`Contains anti-pattern: "${antiPattern}"`);
        }
    }

    // Check for missing pro-patterns
    const hasInstrumental = lowerPrompt.includes('instrumental') || lowerPrompt.includes('no vocals');
    const hasBroadcastQuality = lowerPrompt.includes('broadcast') || lowerPrompt.includes('professional');
    const hasVoiceSpace = lowerPrompt.includes('voice') || lowerPrompt.includes('mid frequencies');

    if (!hasInstrumental) {
        issues.push('Missing: instrumental/no vocals specification');
    }
    if (!hasBroadcastQuality) {
        issues.push('Missing: broadcast quality specification');
    }
    if (!hasVoiceSpace) {
        issues.push('Missing: voice space specification');
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}
