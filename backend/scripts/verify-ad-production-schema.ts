/**
 * Verify the unified ad production JSON schema: parse and validate fixture JSON.
 * Run from backend: npx ts-node scripts/verify-ad-production-schema.ts
 */
import {
  parseAndValidateAdProductionResponse,
  getAdProductionExampleJSONString,
  type AdProductionLLMResponse,
} from '../src/types/ad-production';

// Use canonical example from types (1.2) — same as used for LLM few-shot
const FIXTURE_JSON = getAdProductionExampleJSONString();

function main(): void {
  console.log('Verifying ad production schema...');
  const result = parseAndValidateAdProductionResponse(FIXTURE_JSON) as AdProductionLLMResponse;
  console.log('Parsed and validated successfully.');
  console.log('  script length:', result.script.length);
  console.log('  context.adCategory:', result.context.adCategory);
  console.log('  music.targetBPM:', result.music.targetBPM);
  console.log('  fades:', result.fades);
  console.log('  volume.voiceVolume:', result.volume.voiceVolume);
  console.log('  volume.segments count:', result.volume.segments?.length ?? 0);

  // Assert expected shape
  if (!result.script || !result.context?.adCategory || result.music.targetBPM == null) {
    throw new Error('Missing required fields after validation');
  }
  if (result.fades.fadeInSeconds < 0.1 || result.fades.fadeInSeconds > 2) {
    throw new Error('fadeInSeconds should be clamped to [0.1, 2]');
  }
  // Test minimal JSON (missing optional fields) — should get safe defaults
  const minimalJson = `{"script":"Hello world.","context":{"adCategory":"other","tone":"neutral","emotion":"calm","pace":"moderate","durationSeconds":15},"music":{"prompt":"Background music","targetBPM":90},"fades":{"fadeInSeconds":0.2,"fadeOutSeconds":0.4},"volume":{"voiceVolume":1,"musicVolume":0.12}}`;
  const minimal = parseAndValidateAdProductionResponse(minimalJson);
  if (minimal.fades.curve !== 'exp') throw new Error('Expected default curve exp');
  if (minimal.music.targetBPM !== 90) throw new Error('Expected targetBPM 90');
  console.log('Minimal JSON with defaults: OK');

  // Test markdown-wrapped JSON
  const wrapped = parseAndValidateAdProductionResponse('```json\n' + FIXTURE_JSON + '\n```');
  if (!wrapped.script || wrapped.context.adCategory !== 'tech') throw new Error('Markdown strip failed');
  console.log('Markdown-wrapped JSON: OK');

  console.log('All checks passed.');
}

main();
