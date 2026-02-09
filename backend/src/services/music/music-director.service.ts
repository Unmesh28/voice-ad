import { logger } from '../../config/logger';
import type {
    MusicDirectionInput,
    MusicDirectionOutput,
    PreAnalysis,
    TimingMap,
    TimingSection,
    GlobalMusicDirection,
    SegmentMusicDirection,
    SyncPoint,
    ButtonEndingSpec,
    MixingInstructions,
    PlatformAdjustments,
    GenerationStrategy,
    MusicCategory,
    Platform,
} from '../../types/music-direction';
import {
    TEMPO_GUIDELINES,
    PLATFORM_LOUDNESS,
} from '../../types/music-direction';
import {
    buildSegmentPrompt,
    buildOutroPrompt,
    STYLE_PRESETS,
    INSTRUMENT_PALETTE,
    suggestMoodByTempo,
    validatePrompt,
} from './prompt-templates';

/**
 * Music Director Service
 * Implements the complete 10-step professional workflow for ad music composition
 */
class MusicDirectorService {
    /**
     * Main entry point - generates complete music direction
     */
    async generateMusicDirection(input: MusicDirectionInput): Promise<MusicDirectionOutput> {
        try {
            logger.info('Generating music direction', {
                duration: input.duration_seconds,
                category: input.product_category,
                platform: input.platform,
            });

            // STEP 1: Understand the ad's purpose
            const preAnalysis = this.analyzeAdPurpose(input);
            logger.info('Pre-analysis complete', preAnalysis);

            // STEP 2: Create timing map
            const timingMap = this.createTimingMap(input.script, input.duration_seconds);
            logger.info('Timing map created', { sections: timingMap.structure.length });

            // STEP 3: Global music direction
            const globalDirection = this.createGlobalMusicDirection(input, preAnalysis);

            // STEP 4-7: Generate segment-by-segment direction
            const segments = this.generateSegments(input, timingMap, preAnalysis, globalDirection);
            logger.info('Segments generated', { count: segments.length });

            // STEP 5: Identify critical sync points
            const criticalSyncPoints = this.identifyCriticalSyncPoints(input.script, segments);

            // STEP 6: Button ending specification
            const buttonEnding = this.createButtonEndingSpec(input.duration_seconds, globalDirection);

            // STEP 9: Mixing instructions
            const mixingInstructions = this.generateMixingInstructions(input.platform);

            // STEP 10: Platform adjustments
            const platformAdjustments = this.applyPlatformOptimizations(input.platform);

            // Generate full track prompt (alternative to segment-based)
            const fullTrackPrompt = this.generateFullTrackPrompt(input, preAnalysis, globalDirection, segments);

            // Quality checklist
            const qualityChecklist = this.generateQualityChecklist(segments, criticalSyncPoints, buttonEnding);

            // Generation strategy
            const generationStrategy = this.determineGenerationStrategy(segments, input.duration_seconds);

            const output: MusicDirectionOutput = {
                pre_analysis: preAnalysis,
                timing_map: timingMap,
                global_music_direction: globalDirection,
                segments,
                critical_sync_points: criticalSyncPoints,
                button_ending_specification: buttonEnding,
                sound_design_map: [], // Can be enhanced later
                mixing_instructions: mixingInstructions,
                platform_adjustments: platformAdjustments,
                full_track_prompt: fullTrackPrompt,
                quality_checklist: qualityChecklist,
                generation_strategy: generationStrategy,
            };

            logger.info('Music direction generated successfully');
            return output;
        } catch (error: any) {
            logger.error('Error generating music direction:', error.message);
            throw new Error(`Failed to generate music direction: ${error.message}`);
        }
    }

    /**
     * STEP 1: Analyze the ad's purpose and determine music approach
     */
    private analyzeAdPurpose(input: MusicDirectionInput): PreAnalysis {
        const category = input.product_category.toLowerCase();
        const tone = input.brand_tone.toLowerCase();

        // Determine music category
        let musicCategory: MusicCategory = 'Minimal/Corporate';
        let emotionJourney = 'Curiosity → Trust → Confidence → Action';

        if (category.includes('luxury') || category.includes('premium')) {
            musicCategory = 'Ambient';
            emotionJourney = 'Aspiration → Desire → Exclusivity → Possession';
        } else if (category.includes('healthcare') || category.includes('wellness') || category.includes('emotional')) {
            musicCategory = 'Cinematic';
            emotionJourney = 'Empathy → Hope → Relief → Trust';
        } else if (category.includes('fitness') || category.includes('sports') || category.includes('entertainment')) {
            musicCategory = 'Commercial/Pop';
            emotionJourney = 'Excitement → Energy → Achievement → Motivation';
        } else if (category.includes('tech') || category.includes('saas') || category.includes('b2b')) {
            musicCategory = 'Minimal/Corporate';
            emotionJourney = 'Frustration/Recognition → Curiosity → Relief/Confidence → Trust → Action';
        }

        // Determine energy curve based on category and duration
        let energyCurve = '3 → 5 → 7 → 5';

        if (input.duration_seconds <= 15) {
            energyCurve = '5 → 7 → 6'; // Front-loaded for short ads
        } else if (musicCategory === 'Ambient') {
            energyCurve = '3 → 4 → 5 → 4'; // Subtle, never overwhelming
        } else if (musicCategory === 'Commercial/Pop') {
            energyCurve = '6 → 7 → 8 → 7'; // High energy throughout
        }

        return {
            ad_purpose: `${input.product_category} advertisement targeting ${input.target_audience} with ${tone} tone`,
            target_emotion_journey: emotionJourney,
            music_category: musicCategory,
            overall_energy_curve: energyCurve,
        };
    }

    /**
     * STEP 2: Create timing map and structure breakdown
     */
    private createTimingMap(script: string, duration: number): TimingMap {
        const structure: TimingSection[] = [];

        if (duration <= 15) {
            // Very short ad: 2-3 sections
            structure.push(
                { time: '0-5s', section: 'Hook + Problem', purpose: 'Immediate attention and setup' },
                { time: '5-12s', section: 'Solution + Benefits', purpose: 'Peak energy and value' },
                { time: '12-15s', section: 'CTA', purpose: 'Action' }
            );
        } else if (duration <= 30) {
            // Standard 30-second ad: 4 sections
            const hookEnd = Math.floor(duration * 0.17); // ~5s
            const problemEnd = Math.floor(duration * 0.5); // ~15s
            const benefitsEnd = Math.floor(duration * 0.73); // ~22s

            structure.push(
                { time: `0-${hookEnd}s`, section: 'Hook', purpose: 'Grab attention' },
                { time: `${hookEnd}-${problemEnd}s`, section: 'Problem/Setup', purpose: 'Build tension' },
                { time: `${problemEnd}-${benefitsEnd}s`, section: 'Solution/Benefits', purpose: 'Peak energy' },
                { time: `${benefitsEnd}-${duration}s`, section: 'CTA', purpose: 'Resolve and close' }
            );
        } else {
            // Longer ad: 5+ sections
            const hookEnd = 5;
            const problemEnd = Math.floor(duration * 0.33);
            const solutionEnd = Math.floor(duration * 0.5);
            const benefitsEnd = Math.floor(duration * 0.75);

            structure.push(
                { time: `0-${hookEnd}s`, section: 'Hook', purpose: 'Grab attention' },
                { time: `${hookEnd}-${problemEnd}s`, section: 'Problem', purpose: 'Build tension' },
                { time: `${problemEnd}-${solutionEnd}s`, section: 'Solution', purpose: 'Introduce answer' },
                { time: `${solutionEnd}-${benefitsEnd}s`, section: 'Benefits', purpose: 'Peak energy' },
                { time: `${benefitsEnd}-${duration}s`, section: 'CTA', purpose: 'Resolve and close' }
            );
        }

        return {
            total_duration: duration,
            structure,
        };
    }

    /**
     * STEP 3: Create global music direction
     */
    private createGlobalMusicDirection(
        input: MusicDirectionInput,
        preAnalysis: PreAnalysis
    ): GlobalMusicDirection {
        const category = input.product_category.toLowerCase();
        const categoryKey = Object.keys(TEMPO_GUIDELINES).find(k => category.includes(k)) || 'corporate';
        const tempoGuide = TEMPO_GUIDELINES[categoryKey] || TEMPO_GUIDELINES['corporate'];

        // Select BPM in the middle of the range
        const baseTempoBpm = Math.floor((tempoGuide.bpm[0] + tempoGuide.bpm[1]) / 2);

        // Determine genre and instrumentation based on music category
        let genre = 'modern corporate';
        let instrumentationPalette: string[] = [];
        let instrumentsToAvoid: string[] = [];

        switch (preAnalysis.music_category) {
            case 'Ambient':
                genre = 'ambient cinematic';
                instrumentationPalette = INSTRUMENT_PALETTE['luxury'] || [];
                instrumentsToAvoid = ['heavy drums', 'distorted guitars', 'aggressive synths'];
                break;
            case 'Cinematic':
                genre = 'cinematic emotional';
                instrumentationPalette = INSTRUMENT_PALETTE['emotional'] || [];
                instrumentsToAvoid = ['electronic drums', 'synthetic bass', 'harsh sounds'];
                break;
            case 'Commercial/Pop':
                genre = 'modern pop';
                instrumentationPalette = INSTRUMENT_PALETTE['energetic'] || [];
                instrumentsToAvoid = ['slow strings', 'ambient pads', 'minimal elements'];
                break;
            case 'Minimal/Corporate':
            default:
                genre = 'modern corporate tech';
                instrumentationPalette = INSTRUMENT_PALETTE['tech'] || [];
                instrumentsToAvoid = ['orchestral elements', 'heavy guitars', 'vocals'];
                break;
        }

        const mood = suggestMoodByTempo(baseTempoBpm);

        return {
            genre,
            key: 'major', // Default to major for most ads
            base_tempo_bpm: baseTempoBpm,
            overall_mood: mood,
            instrumentation_palette: instrumentationPalette,
            instruments_to_avoid: instrumentsToAvoid,
            frequency_notes: 'Keep 2-4kHz very sparse throughout. Music lives in sub-bass (50-100Hz) and shimmer (8kHz+)',
            reference_style: `Similar to ${preAnalysis.music_category.toLowerCase()} production music`,
        };
    }

    /**
     * STEP 4-7: Generate segment-by-segment music direction
     */
    private generateSegments(
        input: MusicDirectionInput,
        timingMap: TimingMap,
        preAnalysis: PreAnalysis,
        globalDirection: GlobalMusicDirection
    ): SegmentMusicDirection[] {
        const segments: SegmentMusicDirection[] = [];
        const energyLevels = this.parseEnergyCurve(preAnalysis.overall_energy_curve);

        timingMap.structure.forEach((section, index) => {
            const [startStr, endStr] = section.time.split('-').map(s => parseInt(s.replace('s', '')));
            const duration = endStr - startStr;
            const energyLevel = energyLevels[index] || 5;

            // Determine energy curve for this segment
            let energyCurve: 'building' | 'peaking' | 'resolving' | 'static' = 'static';
            if (index < energyLevels.length - 1) {
                if (energyLevels[index + 1] > energyLevel) {
                    energyCurve = 'building';
                } else if (energyLevels[index + 1] < energyLevel) {
                    energyCurve = 'resolving';
                } else if (energyLevel >= 7) {
                    energyCurve = 'peaking';
                }
            } else {
                energyCurve = 'resolving';
            }

            // Select mood based on section purpose
            let mood: string[] = [];
            if (section.section.toLowerCase().includes('hook')) {
                mood = ['curious', 'anticipating', 'intriguing'];
            } else if (section.section.toLowerCase().includes('problem')) {
                mood = ['thoughtful', 'slightly tense', 'building'];
            } else if (section.section.toLowerCase().includes('solution') || section.section.toLowerCase().includes('benefits')) {
                mood = ['confident', 'triumphant', 'satisfying'];
            } else if (section.section.toLowerCase().includes('cta')) {
                mood = ['warm', 'trustworthy', 'inviting'];
            }

            // Select instruments based on energy level
            const activeInstruments = this.selectInstruments(energyLevel, globalDirection.instrumentation_palette);

            // Build the text-to-music prompt
            const isFinalSegment = index === timingMap.structure.length - 1;
            const textToMusicPrompt = isFinalSegment
                ? buildOutroPrompt(globalDirection.genre, mood, globalDirection.base_tempo_bpm, activeInstruments)
                : buildSegmentPrompt({
                    segment_name: section.section,
                    energy_level: energyLevel,
                    genre: globalDirection.genre,
                    mood,
                    tempo_bpm: globalDirection.base_tempo_bpm,
                    instruments: activeInstruments,
                    melodic_content: energyLevel >= 6 ? 'clear melodic hook' : 'sparse, ambient',
                    harmonic_movement: energyLevel >= 5 ? 'chord change every 2 bars' : 'static or slow chord change',
                    rhythmic_feel: energyLevel >= 6 ? 'driving pulse' : 'subtle pulse',
                    is_final_segment: isFinalSegment,
                });

            // Validate prompt
            const validation = validatePrompt(textToMusicPrompt);
            if (!validation.valid) {
                logger.warn(`Prompt validation issues for segment ${index + 1}:`, validation.issues);
            }

            segments.push({
                segment_id: index + 1,
                name: section.section.toLowerCase().replace(/\s+/g, '_'),
                script_text: '', // Will be filled by orchestrator
                start_time: startStr,
                end_time: endStr,
                duration,
                music_direction: {
                    energy_level: energyLevel,
                    energy_curve: energyCurve,
                    mood,
                    tempo: `${globalDirection.base_tempo_bpm} BPM ${energyCurve}`,
                    instrumentation: {
                        active: activeInstruments,
                        entering: index > 0 ? this.getEnteringInstruments(energyLevel, energyLevels[index - 1]) : [],
                        exiting: [],
                        intensity: this.getIntensityLabel(energyLevel),
                    },
                    melodic_content: energyLevel >= 6 ? 'clear melodic hook that reinforces positivity' : 'sparse, ambient, no strong melody',
                    harmonic_movement: energyLevel >= 5 ? 'chord change every 2 bars, optimistic progression' : 'static or slow chord change',
                    rhythmic_feel: energyLevel >= 6 ? 'driving but not aggressive, confident pulse' : 'subtle pulse, not driving',
                    transition_in: index === 0 ? 'fade from silence over 0.5s' : 'smooth transition from previous segment',
                    transition_out: isFinalSegment ? 'CLEAN BUTTON ENDING' : 'smooth transition to next segment',
                    sync_points: [],
                },
                sound_design: {
                    sfx_suggestions: [],
                    transition_sound: index > 0 ? 'subtle whoosh or musical transition' : 'none',
                },
                technical_specs: {
                    frequency_focus: 'warm sub-bass, airy high shimmer, empty mids for voice',
                    dynamics_db: `-${22 - energyLevel}dB below voice`,
                    ducking_intensity: energyLevel >= 7 ? 'heavy' : energyLevel >= 5 ? 'medium' : 'light',
                },
                text_to_music_prompt: textToMusicPrompt,
            });
        });

        return segments;
    }

    /**
     * Parse energy curve string (e.g., "3 → 5 → 7 → 5") into array of numbers
     */
    private parseEnergyCurve(curve: string): number[] {
        return curve.split('→').map(s => parseInt(s.trim()));
    }

    /**
     * Select instruments based on energy level
     */
    private selectInstruments(energyLevel: number, palette: string[]): string[] {
        if (energyLevel <= 2) {
            return palette.slice(0, 2); // Minimal
        } else if (energyLevel <= 4) {
            return palette.slice(0, 3); // Building
        } else if (energyLevel <= 6) {
            return palette; // Full palette
        } else {
            return [...palette, 'additional rhythmic elements']; // Peak
        }
    }

    /**
     * Get instruments entering based on energy change
     */
    private getEnteringInstruments(currentEnergy: number, previousEnergy: number): string[] {
        if (currentEnergy > previousEnergy) {
            if (currentEnergy >= 7) {
                return ['melodic hook', 'fuller drums'];
            } else if (currentEnergy >= 5) {
                return ['drums', 'bass line'];
            } else {
                return ['subtle texture'];
            }
        }
        return [];
    }

    /**
     * Get intensity label for energy level
     */
    private getIntensityLabel(energyLevel: number): string {
        if (energyLevel <= 2) return 'minimal, almost subliminal';
        if (energyLevel <= 4) return 'medium-low, supportive groove';
        if (energyLevel <= 6) return 'medium, established presence';
        if (energyLevel <= 8) return 'full but controlled';
        return 'maximum intensity';
    }

    /**
     * STEP 5: Identify critical sync points
     */
    private identifyCriticalSyncPoints(script: string, segments: SegmentMusicDirection[]): SyncPoint[] {
        const syncPoints: SyncPoint[] = [];

        // Look for brand name mentions (usually critical)
        // This is a simplified version - in production, use NLP or LLM to identify key moments

        // Add peak energy moment
        const peakSegment = segments.reduce((max, seg) =>
            seg.music_direction.energy_level > max.music_direction.energy_level ? seg : max
        );

        syncPoints.push({
            timestamp: peakSegment.start_time + peakSegment.duration / 2,
            script_moment: 'Key benefit or product reveal',
            music_action: 'PEAK energy moment - most full and satisfying',
            importance: 'critical',
        });

        // Add CTA moment
        const lastSegment = segments[segments.length - 1];
        syncPoints.push({
            timestamp: lastSegment.end_time - 1,
            script_moment: 'Final word of CTA',
            music_action: 'Button ending lands on beat',
            importance: 'critical',
        });

        return syncPoints;
    }

    /**
     * STEP 6: Create button ending specification
     */
    private createButtonEndingSpec(duration: number, globalDirection: GlobalMusicDirection): ButtonEndingSpec {
        return {
            type: 'sustained chord with clean release',
            timing: `Final chord initiates on the beat immediately following last word at ~${duration - 0.5}s`,
            tail_duration_ms: 800,
            silence_after_ms: 1500,
            chord: 'Root major chord (tonic) - warm and resolved',
            description: 'Sustained warm chord, slight natural decay, clean cutoff - NOT a fade, feels conclusive and satisfying',
        };
    }

    /**
     * STEP 9: Generate mixing instructions
     */
    private generateMixingInstructions(platform: Platform): MixingInstructions {
        return {
            music_bed_level_db: -18,
            voice_level_db: -6,
            ducking: {
                enabled: true,
                threshold: 0.02,
                ratio: 4,
                attack_ms: 200,
                release_ms: 1000,
                duck_amount_db: -6,
            },
            eq_for_voice_space: [
                { frequency_hz: 2500, gain_db: -4, q: 1.5 },
                { frequency_hz: 3200, gain_db: -3, q: 2.0 },
            ],
        };
    }

    /**
     * STEP 10: Apply platform optimizations
     */
    private applyPlatformOptimizations(platform: Platform): PlatformAdjustments {
        const loudness = PLATFORM_LOUDNESS[platform] || PLATFORM_LOUDNESS['podcast'];

        let notes = '';
        switch (platform) {
            case 'podcast':
                notes = 'Podcast listeners are in relaxed, intimate listening mode. Music should support but never demand attention.';
                break;
            case 'radio':
                notes = 'Radio requires clean, balanced, punchy mix that cuts through car speakers and background noise.';
                break;
            case 'instagram':
            case 'tiktok':
                notes = 'First 3 seconds must be strongest hook. Fast, catchy, attention-grabbing.';
                break;
            case 'youtube':
                notes = 'Cinematic, dynamic range allowed. Viewers are actively watching.';
                break;
            case 'spotify':
                notes = 'Competing with music context. Must sound polished and professional.';
                break;
        }

        return {
            platform,
            target_loudness_lufs: loudness.lufs,
            true_peak_dbtp: loudness.peak,
            specific_notes: notes,
        };
    }

    /**
     * Generate full track prompt (alternative to segment-based)
     */
    private generateFullTrackPrompt(
        input: MusicDirectionInput,
        preAnalysis: PreAnalysis,
        globalDirection: GlobalMusicDirection,
        segments: SegmentMusicDirection[]
    ): string {
        const energyCurve = segments.map(s => s.music_direction.energy_level).join(' → ');
        const duration = input.duration_seconds;
        const genre = globalDirection.genre;
        const bpm = globalDirection.base_tempo_bpm;
        const mood = globalDirection.overall_mood.join(' ');

        return `${genre} instrumental, ${duration} seconds, ${bpm} BPM in major key, ${mood} mood, energy progression ${energyCurve}, starts minimal with soft pads, builds through confident section adding drums and bass, reaches full peak with melodic hooks for benefit statements, then resolves warmly to conclusion with sustained chords, ends with CLEAN DEFINITIVE BUTTON ENDING on major chord with no fade out followed by silence, professional broadcast quality throughout, mixed specifically to leave clear space for voiceover in 2-4kHz mid frequencies`;
    }

    /**
     * Generate quality checklist
     */
    private generateQualityChecklist(
        segments: SegmentMusicDirection[],
        syncPoints: SyncPoint[],
        buttonEnding: ButtonEndingSpec
    ): string[] {
        const peakSegment = segments.reduce((max, seg) =>
            seg.music_direction.energy_level > max.music_direction.energy_level ? seg : max
        );

        return [
            `✓ Energy peak (level ${peakSegment.music_direction.energy_level}) aligns with key benefit statement`,
            '✓ Brand name moment has subtle musical support',
            '✓ Button ending lands cleanly after final word',
            '✓ Music never competes with voice - always 15-18dB below',
            '✓ NO fade-out ending - clean button resolution',
            '✓ 2-4kHz carved throughout for voice clarity',
            `✓ Emotion journey matches script arc`,
            '✓ Each segment has intentional energy direction',
            '✓ Platform-appropriate loudness target',
            `✓ Tempo consistent at ${segments[0]?.music_direction.tempo || 'specified BPM'} throughout`,
        ];
    }

    /**
     * Determine generation strategy
     */
    private determineGenerationStrategy(segments: SegmentMusicDirection[], duration: number): GenerationStrategy {
        if (duration <= 15 || segments.length <= 2) {
            return {
                recommended_approach: 'full-track',
                reasoning: 'Short duration with few segments. Full-track generation is simpler and avoids transition issues.',
                fallback: 'If full-track doesn\'t achieve proper energy curve, try segment-based with careful crossfading.',
            };
        } else if (segments.length >= 4) {
            return {
                recommended_approach: 'segment-based',
                reasoning: `${duration}-second ad has ${segments.length} distinct emotional sections that benefit from individual attention. Segment generation allows precise control over energy curve and sync points.`,
                fallback: 'If segment assembly creates jarring transitions, use full_track_prompt and manually verify sync points align.',
            };
        } else {
            return {
                recommended_approach: 'segment-based',
                reasoning: 'Multiple segments with distinct energy levels. Segment-based generation provides better control.',
                fallback: 'Use full-track generation if segment transitions are problematic.',
            };
        }
    }
}

export default new MusicDirectorService();
