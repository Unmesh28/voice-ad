import { useState } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  CircularProgress,
  Slider,
  Grid,
  Tooltip,
  Collapse,
} from '@mui/material';
import { PlayArrow, Stop, ExpandMore, ExpandLess } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import ttsService from '../services/tts.service';
import { Voice } from '../types';
import toast from 'react-hot-toast';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceChange: (voiceId: string) => void;
  voiceSettings?: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
  onSettingsChange?: (settings: any) => void;
  showSettings?: boolean;
}

const VoiceSelector = ({
  selectedVoiceId,
  onVoiceChange,
  voiceSettings,
  onSettingsChange,
  showSettings = true,
}: VoiceSelectorProps) => {
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Fetch voices
  const { data: voices, isLoading } = useQuery({
    queryKey: ['voices'],
    queryFn: () => ttsService.getVoices(),
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  const selectedVoice = voices?.find((v: Voice) => v.voice_id === selectedVoiceId);

  const handlePreview = async () => {
    if (previewPlaying && audioElement) {
      audioElement.pause();
      setPreviewPlaying(false);
      return;
    }

    if (!selectedVoiceId) {
      toast.error('Please select a voice first');
      return;
    }

    try {
      setPreviewPlaying(true);
      const blob = await ttsService.previewVoice(selectedVoiceId);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => {
        setPreviewPlaying(false);
        URL.revokeObjectURL(url);
      };

      audio.onerror = () => {
        setPreviewPlaying(false);
        toast.error('Failed to play preview');
      };

      setAudioElement(audio);
      await audio.play();
    } catch (error) {
      setPreviewPlaying(false);
      toast.error('Failed to preview voice');
    }
  };

  const handleSettingChange = (key: string, value: number | boolean) => {
    if (onSettingsChange) {
      onSettingsChange({
        ...voiceSettings,
        [key]: value,
      });
    }
  };

  return (
    <Box>
      <FormControl fullWidth margin="normal">
        <InputLabel>Voice</InputLabel>
        <Select
          value={selectedVoiceId}
          onChange={(e) => onVoiceChange(e.target.value)}
          label="Voice"
          disabled={isLoading}
        >
          {isLoading ? (
            <MenuItem disabled>
              <CircularProgress size={20} />
              <Typography sx={{ ml: 2 }}>Loading voices...</Typography>
            </MenuItem>
          ) : (
            voices?.map((voice: Voice) => (
              <MenuItem key={voice.voice_id} value={voice.voice_id}>
                {voice.name}
                {voice.labels?.accent && (
                  <Chip
                    label={voice.labels.accent}
                    size="small"
                    sx={{ ml: 1, height: 20 }}
                  />
                )}
              </MenuItem>
            ))
          )}
        </Select>
      </FormControl>

      {selectedVoice && (
        <Card sx={{ mt: 2, bgcolor: 'background.default' }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" gutterBottom>
                  {selectedVoice.name}
                </Typography>
                {selectedVoice.description && (
                  <Typography variant="body2" color="text.secondary">
                    {selectedVoice.description}
                  </Typography>
                )}
                {selectedVoice.labels && (
                  <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {Object.entries(selectedVoice.labels).map(([key, value]) => (
                      <Chip key={key} label={`${key}: ${value}`} size="small" />
                    ))}
                  </Box>
                )}
              </Box>
              <Tooltip title={previewPlaying ? 'Stop preview' : 'Play preview'}>
                <IconButton
                  onClick={handlePreview}
                  color="primary"
                  disabled={!selectedVoiceId}
                  size="large"
                >
                  {previewPlaying ? <Stop /> : <PlayArrow />}
                </IconButton>
              </Tooltip>
            </Box>

            {showSettings && voiceSettings && onSettingsChange && (
              <Box sx={{ mt: 2 }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSettingsExpanded(!settingsExpanded)}
                >
                  <Typography variant="subtitle2">Voice Settings</Typography>
                  <IconButton size="small">
                    {settingsExpanded ? <ExpandLess /> : <ExpandMore />}
                  </IconButton>
                </Box>

                <Collapse in={settingsExpanded}>
                  <Box sx={{ mt: 2 }}>
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <Typography variant="body2" gutterBottom>
                          Stability: {voiceSettings.stability?.toFixed(2)}
                        </Typography>
                        <Slider
                          value={voiceSettings.stability || 0.5}
                          onChange={(_, value) => handleSettingChange('stability', value as number)}
                          min={0}
                          max={1}
                          step={0.01}
                          valueLabelDisplay="auto"
                        />
                        <Typography variant="caption" color="text.secondary">
                          Higher values make output more consistent
                        </Typography>
                      </Grid>

                      <Grid item xs={12}>
                        <Typography variant="body2" gutterBottom>
                          Similarity Boost: {voiceSettings.similarity_boost?.toFixed(2)}
                        </Typography>
                        <Slider
                          value={voiceSettings.similarity_boost || 0.75}
                          onChange={(_, value) =>
                            handleSettingChange('similarity_boost', value as number)
                          }
                          min={0}
                          max={1}
                          step={0.01}
                          valueLabelDisplay="auto"
                        />
                        <Typography variant="caption" color="text.secondary">
                          Higher values enhance voice similarity
                        </Typography>
                      </Grid>

                      <Grid item xs={12}>
                        <Typography variant="body2" gutterBottom>
                          Style: {voiceSettings.style?.toFixed(2)}
                        </Typography>
                        <Slider
                          value={voiceSettings.style || 0.0}
                          onChange={(_, value) => handleSettingChange('style', value as number)}
                          min={0}
                          max={1}
                          step={0.01}
                          valueLabelDisplay="auto"
                        />
                        <Typography variant="caption" color="text.secondary">
                          Higher values add more expressiveness
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                </Collapse>
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default VoiceSelector;
