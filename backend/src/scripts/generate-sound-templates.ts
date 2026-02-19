#!/usr/bin/env ts-node
/**
 * CLI script to generate elastic sound templates using Suno API.
 *
 * Usage:
 *   npx ts-node src/scripts/generate-sound-templates.ts                  # Generate ALL templates
 *   npx ts-node src/scripts/generate-sound-templates.ts --genre Corporate # Generate only Corporate genre
 *   npx ts-node src/scripts/generate-sound-templates.ts --genre Indian    # Generate only Indian genre
 *   npx ts-node src/scripts/generate-sound-templates.ts --list            # List all available templates
 *   npx ts-node src/scripts/generate-sound-templates.ts --genres          # List all available genres
 *   npx ts-node src/scripts/generate-sound-templates.ts --ids corporate_upbeat_01,energetic_pop_01
 *   npx ts-node src/scripts/generate-sound-templates.ts --concurrency 1   # Slower but safer rate limit
 *
 * Environment:
 *   SUNO_API_KEY or KIE_API_KEY must be set.
 *   SOUND_TEMPLATES_PATH (optional) — output directory.
 */

import dotenv from 'dotenv';
dotenv.config();

import soundTemplateGenerator from '../services/music/sound-template-generator.service';
import { TEMPLATE_DEFINITIONS } from '../services/music/sound-template-generator.service';

async function main() {
  const args = process.argv.slice(2);

  // --list: Show all template definitions
  if (args.includes('--list')) {
    console.log('\n📋 Available Sound Template Definitions:\n');
    const defs = soundTemplateGenerator.listDefinitions();
    const grouped = new Map<string, typeof defs>();
    for (const d of defs) {
      if (!grouped.has(d.genre)) grouped.set(d.genre, []);
      grouped.get(d.genre)!.push(d);
    }
    for (const [genre, templates] of grouped) {
      console.log(`  ${genre}:`);
      for (const t of templates) {
        console.log(`    - ${t.id.padEnd(30)} ${t.name} (${t.mood}, ${t.energy} energy)`);
      }
    }
    console.log(`\n  Total: ${defs.length} templates across ${grouped.size} genres\n`);
    return;
  }

  // --genres: Show available genres
  if (args.includes('--genres')) {
    const genres = soundTemplateGenerator.listGenres();
    console.log('\n🎵 Available Genres:\n');
    for (const g of genres) {
      const count = TEMPLATE_DEFINITIONS.filter((d) => d.genre === g).length;
      console.log(`  - ${g} (${count} template${count > 1 ? 's' : ''})`);
    }
    console.log();
    return;
  }

  // Parse options
  const genreIdx = args.indexOf('--genre');
  const idsIdx = args.indexOf('--ids');
  const concurrencyIdx = args.indexOf('--concurrency');
  const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1], 10) || 2 : 2;

  const startTime = Date.now();

  console.log('\n🎶 Sound Template Generator');
  console.log('═══════════════════════════════════════════════════\n');

  // Progress callback
  const onProgress = (p: any) => {
    const pct = Math.round((p.completed / p.total) * 100);
    const icon = p.status === 'generating' ? '⏳' : p.status === 'done' ? '✅' : p.status === 'error' ? '❌' : '📦';
    console.log(`  ${icon} [${p.completed}/${p.total}] (${pct}%) ${p.current}${p.error ? ` — ${p.error}` : ''}`);
  };

  let results;

  if (genreIdx >= 0 && args[genreIdx + 1]) {
    const genre = args[genreIdx + 1];
    console.log(`  Generating templates for genre: ${genre}\n`);
    results = await soundTemplateGenerator.generateByGenre(genre, onProgress, concurrency);
  } else if (idsIdx >= 0 && args[idsIdx + 1]) {
    const ids = args[idsIdx + 1].split(',').map((s) => s.trim());
    console.log(`  Generating specific templates: ${ids.join(', ')}\n`);
    results = await soundTemplateGenerator.generateByIds(ids, onProgress, concurrency);
  } else {
    const total = TEMPLATE_DEFINITIONS.length;
    console.log(`  Generating ALL ${total} templates (this will take a while...)\n`);
    console.log(`  Each template = 3 Suno API calls (intro + main + outro)`);
    console.log(`  Total API calls: ~${total * 3}`);
    console.log(`  Estimated time: ${Math.ceil(total * 3 * 20 / 60)} minutes\n`);
    results = await soundTemplateGenerator.generateAll(onProgress, concurrency);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Done in ${elapsed}s`);
  console.log(`  ✅ Succeeded: ${succeeded}`);
  if (failed > 0) {
    console.log(`  ❌ Failed: ${failed}`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`     - ${r.id}: ${r.error}`);
    }
  }
  console.log(`\n  Templates saved to: uploads/sound-templates/`);
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
