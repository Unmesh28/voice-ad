#!/bin/bash

# Sync Music Director implementation files from worktree to actual workspace

SOURCE_DIR="/Users/unmeshdabhade/.cursor/worktrees/voice-ad/emp/backend"
DEST_DIR="/Users/unmeshdabhade/Downloads/Voicemaker/voice-ad/backend"

echo "Syncing Music Director implementation files..."

# Core implementation files
cp "$SOURCE_DIR/src/services/llm/openai.service.ts" "$DEST_DIR/src/services/llm/openai.service.ts"
echo "✓ Copied openai.service.ts (Enhanced LLM with Music Director prompts)"

cp "$SOURCE_DIR/src/services/audio/ffmpeg.service.ts" "$DEST_DIR/src/services/audio/ffmpeg.service.ts"
echo "✓ Copied ffmpeg.service.ts (Added crossfadeAudioSegments utility)"

cp "$SOURCE_DIR/src/jobs/musicGeneration.worker.ts" "$DEST_DIR/src/jobs/musicGeneration.worker.ts"
echo "✓ Copied musicGeneration.worker.ts (Segment-based generation)"

cp "$SOURCE_DIR/src/services/production.orchestrator.ts" "$DEST_DIR/src/services/production.orchestrator.ts"
echo "✓ Copied production.orchestrator.ts (Segment mode detection)"

# Check if alignment utilities exist
if [ -f "$SOURCE_DIR/src/types/alignment.types.ts" ]; then
  cp "$SOURCE_DIR/src/types/alignment.types.ts" "$DEST_DIR/src/types/alignment.types.ts"
  echo "✓ Copied alignment.types.ts"
fi

if [ -f "$SOURCE_DIR/src/utils/alignment-to-sentences.ts" ]; then
  cp "$SOURCE_DIR/src/utils/alignment-to-sentences.ts" "$DEST_DIR/src/utils/alignment-to-sentences.ts"
  echo "✓ Copied alignment-to-sentences.ts"
fi

echo ""
echo "All Music Director implementation files synced successfully!"
echo "The server should auto-restart via nodemon."
