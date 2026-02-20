#!/usr/bin/env npx ts-node
/**
 * End-to-End AdForm Pipeline Test
 *
 * Runs the FULL pipeline through the AdForm builder:
 *   1. CONTENT  — Script with sections
 *   2. SPEECH   — ElevenLabs TTS (real voice generation)
 *   3. PRODUCTION — Elastic music assembly + sidechain ducking + mastering
 *   4. DELIVERY — Final MP3 output
 *
 * Usage:
 *   npx ts-node src/scripts/test-adform-pipeline.ts
 *   npx ts-node src/scripts/test-adform-pipeline.ts --template calm_ambient_01
 *   npx ts-node src/scripts/test-adform-pipeline.ts --preset voiceenhanced
 *   npx ts-node src/scripts/test-adform-pipeline.ts --ad luxury_car --template dramatic_cinematic_01
 *   npx ts-node src/scripts/test-adform-pipeline.ts --list-templates
 *   npx ts-node src/scripts/test-adform-pipeline.ts --list-voices
 *   npx ts-node src/scripts/test-adform-pipeline.ts --all
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import fs from 'fs';
import adFormBuilder from '../services/adform/adform-builder.service';
import soundTemplateService from '../services/music/sound-template.service';
import ttsManager from '../services/tts/tts-manager.service';
import type { AdForm, MasteringPreset, LoudnessPreset } from '../types/adform';

// ============================================================================
// Sample Ad Scripts
// ============================================================================

interface SampleAd {
  title: string;
  brand: string;
  sections: { name: string; soundSegment: 'intro' | 'main' | 'outro'; text: string }[];
}

const SAMPLE_ADS: Record<string, SampleAd> = {
  tech_product: {
    title: 'TechFlow Pro - Smart Automation',
    brand: 'TechFlow',
    sections: [
      {
        name: 'hook',
        soundSegment: 'intro',
        text: 'Tired of spending hours on repetitive tasks? There is a better way.',
      },
      {
        name: 'body',
        soundSegment: 'main',
        text: 'Introducing TechFlow Pro. The smart automation platform that learns your workflow and handles the rest. From data entry to report generation, TechFlow Pro saves your team an average of twenty hours per week.',
      },
      {
        name: 'cta',
        soundSegment: 'outro',
        text: 'Start your free trial today at techflow pro dot com. TechFlow Pro. Work smarter, not harder.',
      },
    ],
  },
  food_delivery: {
    title: 'FreshBite - Food Delivery',
    brand: 'FreshBite',
    sections: [
      {
        name: 'hook',
        soundSegment: 'intro',
        text: 'Craving something delicious? FreshBite has you covered.',
      },
      {
        name: 'body',
        soundSegment: 'main',
        text: 'Order from over five thousand restaurants near you. From sushi to pizza, healthy bowls to comfort food. FreshBite delivers in thirty minutes or less, guaranteed fresh.',
      },
      {
        name: 'cta',
        soundSegment: 'outro',
        text: 'Download FreshBite now and get free delivery on your first three orders. Great food, delivered fast.',
      },
    ],
  },
  luxury_car: {
    title: 'Meridian EV Seven - Luxury Electric',
    brand: 'Meridian Motors',
    sections: [
      {
        name: 'hook',
        soundSegment: 'intro',
        text: 'The future of luxury driving has arrived.',
      },
      {
        name: 'body',
        soundSegment: 'main',
        text: 'The all new Meridian EV Seven. Zero to sixty in three point two seconds. Five hundred miles of range. Hand crafted interiors with sustainable materials. Every detail engineered for those who demand excellence.',
      },
      {
        name: 'cta',
        soundSegment: 'outro',
        text: 'Experience the Meridian EV Seven at your nearest dealer. Meridian Motors. Drive the future.',
      },
    ],
  },
};

// ============================================================================
// Build AdForm JSON
// ============================================================================

function buildAdFormJson(
  ad: SampleAd,
  voiceId: string,
  templateId: string,
  masteringPreset: MasteringPreset,
  loudnessPreset: LoudnessPreset
): AdForm {
  return {
    version: 'v1',
    content: {
      sections: ad.sections.map((s) => ({
        name: s.name,
        soundSegment: s.soundSegment,
        text: s.text,
      })),
    },
    speech: {
      voice: {
        provider: 'elevenlabs',
        voiceId,
        speed: 1.0,
        settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
    },
    production: {
      soundTemplate: templateId,
      masteringPreset,
      loudnessPreset,
      timelineProperties: {
        fadeIn: 0.05,
        fadeOut: 2.0,
        fadeCurve: 'exp',
        soundTail: 2.0,
        introPadding: 0.5,
      },
    },
    delivery: {
      format: 'mp3',
      public: true,
    },
    metadata: {
      title: ad.title,
      brand: ad.brand,
      category: 'product',
    },
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // --list-templates
  if (args.includes('--list-templates')) {
    const templates = soundTemplateService.getTemplates();
    console.log(`\n${templates.length} sound templates available:\n`);
    for (const t of templates) {
      console.log(`  ${t.id.padEnd(30)} ${(t.genre || '').padEnd(15)} ${(t.mood || '').padEnd(15)} Energy: ${t.energy || 'n/a'}`);
    }
    return;
  }

  // --list-voices
  if (args.includes('--list-voices')) {
    console.log('\nFetching ElevenLabs voices...\n');
    const voices = await ttsManager.getVoices('elevenlabs');
    for (const v of voices.slice(0, 30)) {
      console.log(`  ${v.voiceId.padEnd(25)} ${v.name.padEnd(20)} ${v.gender || 'n/a'} | ${v.category || ''}`);
    }
    console.log(`\n  ... ${voices.length} total voices`);
    return;
  }

  // --list-ads
  if (args.includes('--list-ads')) {
    console.log('\nAvailable ad scripts:\n');
    for (const [key, ad] of Object.entries(SAMPLE_ADS)) {
      const chars = ad.sections.reduce((sum, s) => sum + s.text.length, 0);
      console.log(`  ${key.padEnd(20)} "${ad.title}" (${ad.sections.length} sections, ${chars} chars)`);
    }
    return;
  }

  // Parse options
  const getArg = (flag: string, def: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
  };

  const templateId = getArg('--template', 'corporate_upbeat_01');
  const masteringPreset = getArg('--preset', 'balanced') as MasteringPreset;
  const loudnessPreset = getArg('--loudness', 'crossPlatform') as LoudnessPreset;
  const adKey = getArg('--ad', 'tech_product');
  const voiceIdArg = getArg('--voice', '');

  // Resolve voice ID: use provided one or fetch first available
  let voiceId = voiceIdArg;
  if (!voiceId) {
    console.log('Fetching ElevenLabs voices to pick a default...');
    const voices = await ttsManager.getVoices('elevenlabs');
    // Prefer a professional/narrative male voice for ads
    const preferred = voices.find(
      (v) => v.name?.toLowerCase().includes('adam') || v.name?.toLowerCase().includes('josh')
    );
    voiceId = preferred?.voiceId || voices[0]?.voiceId;
    if (!voiceId) {
      console.error('No ElevenLabs voices available. Check your API key.');
      process.exit(1);
    }
    const chosen = voices.find((v) => v.voiceId === voiceId);
    console.log(`  Using voice: "${chosen?.name}" (${voiceId})\n`);
  }

  // --all: run all 3 sample ads with different templates
  if (args.includes('--all')) {
    const combos = [
      { adKey: 'tech_product', templateId: 'corporate_upbeat_01' },
      { adKey: 'food_delivery', templateId: 'happy_ukulele_01' },
      { adKey: 'luxury_car', templateId: 'dramatic_cinematic_01' },
    ];

    console.log('========================================');
    console.log('  Running ALL sample ads');
    console.log('========================================\n');

    for (const combo of combos) {
      const ad = SAMPLE_ADS[combo.adKey];
      await runBuild(ad, voiceId, combo.templateId, masteringPreset, loudnessPreset);
      console.log(''); // spacing
    }
    return;
  }

  // Single ad run
  const ad = SAMPLE_ADS[adKey];
  if (!ad) {
    console.error(`Unknown ad: "${adKey}". Available: ${Object.keys(SAMPLE_ADS).join(', ')}`);
    process.exit(1);
  }

  await runBuild(ad, voiceId, templateId, masteringPreset, loudnessPreset);
}

async function runBuild(
  ad: SampleAd,
  voiceId: string,
  templateId: string,
  masteringPreset: MasteringPreset,
  loudnessPreset: LoudnessPreset
) {
  console.log('========================================');
  console.log(`  ${ad.title}`);
  console.log('========================================');
  console.log(`  Template:  ${templateId}`);
  console.log(`  Mastering: ${masteringPreset}`);
  console.log(`  Loudness:  ${loudnessPreset}`);
  console.log(`  Voice:     ${voiceId}`);
  console.log('----------------------------------------');

  const adform = buildAdFormJson(ad, voiceId, templateId, masteringPreset, loudnessPreset);
  const result = await adFormBuilder.build(adform);

  if (result.status === 'failed') {
    console.error(`\n  BUILD FAILED: ${result.error}`);
    console.error(`  Stage: ${result.stage}`);
    console.error(`  Timing: ${JSON.stringify(result.timing)}`);
    return;
  }

  console.log('\n  BUILD COMPLETE');
  console.log('----------------------------------------');
  console.log(`  Build ID:     ${result.buildId}`);
  console.log(`  Status:       ${result.status}`);

  if (result.outputs) {
    for (const out of result.outputs) {
      console.log(`  Output:       ${out.url}`);
      console.log(`  Duration:     ${out.duration?.toFixed(1)}s`);
    }
  }

  if (result.timing) {
    console.log(`  Timing:`);
    if (result.timing.contentMs) console.log(`    Content:    ${result.timing.contentMs}ms`);
    if (result.timing.speechMs) console.log(`    Speech:     ${result.timing.speechMs}ms`);
    if (result.timing.productionMs) console.log(`    Production: ${result.timing.productionMs}ms`);
    if (result.timing.deliveryMs) console.log(`    Delivery:   ${result.timing.deliveryMs}ms`);
    if (result.timing.totalMs) console.log(`    TOTAL:      ${(result.timing.totalMs / 1000).toFixed(1)}s`);
  }
  console.log('========================================');
}

main().catch((err) => {
  console.error('\nPipeline failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
