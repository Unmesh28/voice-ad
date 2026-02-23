import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  CircularProgress,
  Divider,
} from '@mui/material';
import { RecordVoiceOver } from '@mui/icons-material';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ttsService from '../services/tts.service';
import VoiceSelector from '../components/VoiceSelector';
import AudioPlayer from '../components/AudioPlayer';

const TTSGenerator = () => {
  const [text, setText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceSettings, setVoiceSettings] = useState(ttsService.getDefaultVoiceSettings());
  const [audioUrl, setAudioUrl] = useState('');

  // Generate TTS mutation
  const generateMutation = useMutation({
    mutationFn: (data: { text: string; voiceId: string; voiceSettings: any }) =>
      ttsService.generateTTSFromText(data),
    onSuccess: (data) => {
      const fullUrl = `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5011'}${data.audioUrl}`;
      setAudioUrl(fullUrl);
      toast.success('Audio generated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to generate audio');
    },
  });

  const handleGenerate = () => {
    if (!text.trim()) {
      toast.error('Please enter some text');
      return;
    }

    if (!selectedVoiceId) {
      toast.error('Please select a voice');
      return;
    }

    generateMutation.mutate({
      text,
      voiceId: selectedVoiceId,
      voiceSettings,
    });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <RecordVoiceOver sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" gutterBottom>
            Text-to-Speech Generator
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Convert any text to professional AI voice with ElevenLabs
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left side - Input */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Input Text
            </Typography>

            <TextField
              fullWidth
              multiline
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter the text you want to convert to speech..."
              margin="normal"
              helperText={`${text.length} / 5000 characters`}
            />

            <Divider sx={{ my: 3 }} />

            <VoiceSelector
              selectedVoiceId={selectedVoiceId}
              onVoiceChange={setSelectedVoiceId}
              voiceSettings={voiceSettings}
              onSettingsChange={setVoiceSettings}
              showSettings={true}
            />

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleGenerate}
              disabled={generateMutation.isPending || !text || !selectedVoiceId}
              startIcon={
                generateMutation.isPending ? <CircularProgress size={20} /> : <RecordVoiceOver />
              }
              sx={{ mt: 3 }}
            >
              {generateMutation.isPending ? 'Generating Audio...' : 'Generate Audio'}
            </Button>
          </Paper>
        </Grid>

        {/* Right side - Output */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, minHeight: 600 }}>
            <Typography variant="h6" gutterBottom>
              Generated Audio
            </Typography>

            <Divider sx={{ my: 2 }} />

            {audioUrl ? (
              <Box>
                <AudioPlayer audioUrl={audioUrl} title="Generated Audio" />

                <Box sx={{ mt: 3, p: 2, bgcolor: 'info.50', borderRadius: 1 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Audio Information
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Character Count: {text.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Estimated Duration: {Math.ceil(text.split(/\s+/).length / 150 * 60)}s
                  </Typography>
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 400,
                  color: 'text.secondary',
                }}
              >
                <RecordVoiceOver sx={{ fontSize: 80, mb: 2, opacity: 0.3 }} />
                <Typography variant="body1" align="center">
                  Your generated audio will appear here
                </Typography>
                <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                  Enter text, select a voice, and click "Generate Audio"
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Tips Section */}
      <Paper sx={{ p: 3, mt: 3, bgcolor: 'info.50' }}>
        <Typography variant="h6" gutterBottom>
          Tips for Better Audio
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Use Punctuation
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Proper punctuation helps the AI understand pacing and emphasis
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Adjust Voice Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Experiment with stability and similarity for different effects
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Preview Voices
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Listen to voice previews to find the perfect match for your content
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default TTSGenerator;
