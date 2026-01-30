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
  Chip,
  Slider,
  Card,
  CardContent,
} from '@mui/material';
import { MusicNote } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import musicService from '../services/music.service';
import AudioPlayer from '../components/AudioPlayer';

const MusicGenerator = () => {
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    text: '',
    duration_seconds: 10,
    prompt_influence: 0.3,
    name: '',
    genre: '',
    mood: '',
  });

  const [generatedMusic, setGeneratedMusic] = useState<any>(null);
  const [selectedPreset, setSelectedPreset] = useState('');

  // Fetch genre presets
  const { data: genrePresets } = useQuery({
    queryKey: ['genre-presets'],
    queryFn: () => musicService.getGenrePresets(),
    staleTime: Infinity,
  });

  // Fetch example prompts
  const { data: examplePrompts } = useQuery({
    queryKey: ['example-prompts'],
    queryFn: () => musicService.getExamplePrompts(),
    staleTime: Infinity,
  });

  // Generate music mutation
  const generateMutation = useMutation({
    mutationFn: (data: typeof formData) => musicService.generateMusic(data),
    onSuccess: (data) => {
      setGeneratedMusic(data);
      toast.success('Music generated successfully!');
      queryClient.invalidateQueries({ queryKey: ['music-library'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to generate music');
    },
  });

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePresetSelect = (presetKey: string) => {
    setSelectedPreset(presetKey);
    if (genrePresets && genrePresets[presetKey]) {
      const preset = genrePresets[presetKey];
      setFormData((prev) => ({
        ...prev,
        text: preset.prompt,
        duration_seconds: preset.duration,
        genre: presetKey,
      }));
    }
  };

  const handleExampleSelect = (example: string) => {
    setFormData((prev) => ({ ...prev, text: example }));
  };

  const handleGenerate = () => {
    if (!formData.text.trim()) {
      toast.error('Please enter a music description');
      return;
    }

    generateMutation.mutate(formData);
  };

  const getAudioUrl = (fileUrl: string) => {
    return `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}${fileUrl}`;
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <MusicNote sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" gutterBottom>
            AI Music Generator
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Generate background music and sound effects with AI
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left side - Input */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Music Description
            </Typography>

            {/* Genre Presets */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Quick Presets
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {genrePresets &&
                  Object.entries(genrePresets).map(([key]) => (
                    <Chip
                      key={key}
                      label={key.charAt(0).toUpperCase() + key.slice(1)}
                      onClick={() => handlePresetSelect(key)}
                      color={selectedPreset === key ? 'primary' : 'default'}
                      variant={selectedPreset === key ? 'filled' : 'outlined'}
                    />
                  ))}
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            <TextField
              fullWidth
              multiline
              rows={6}
              value={formData.text}
              onChange={(e) => handleChange('text', e.target.value)}
              placeholder="Describe the music you want to generate... (e.g., 'Upbeat electronic music with synthesizers and drums')"
              margin="normal"
              helperText={`${formData.text.length} / 500 characters`}
              required
            />

            {/* Example Prompts */}
            {examplePrompts && examplePrompts.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Example Prompts
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {examplePrompts.slice(0, 3).map((example, index) => (
                    <Button
                      key={index}
                      size="small"
                      onClick={() => handleExampleSelect(example)}
                      sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                    >
                      {example}
                    </Button>
                  ))}
                </Box>
              </Box>
            )}

            <Divider sx={{ my: 3 }} />

            {/* Duration Slider */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Duration: {formData.duration_seconds}s
              </Typography>
              <Slider
                value={formData.duration_seconds}
                onChange={(_, value) => handleChange('duration_seconds', value)}
                min={0.5}
                max={22}
                step={0.5}
                marks={[
                  { value: 0.5, label: '0.5s' },
                  { value: 10, label: '10s' },
                  { value: 22, label: '22s' },
                ]}
                valueLabelDisplay="auto"
              />
              <Typography variant="caption" color="text.secondary">
                Choose music duration (0.5 to 22 seconds)
              </Typography>
            </Box>

            {/* Prompt Influence Slider */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Prompt Influence: {formData.prompt_influence?.toFixed(2)}
              </Typography>
              <Slider
                value={formData.prompt_influence}
                onChange={(_, value) => handleChange('prompt_influence', value)}
                min={0}
                max={1}
                step={0.1}
                valueLabelDisplay="auto"
              />
              <Typography variant="caption" color="text.secondary">
                Higher values follow prompt more closely
              </Typography>
            </Box>

            <TextField
              fullWidth
              label="Track Name (Optional)"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              margin="normal"
              placeholder="Give your music a name"
            />

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleGenerate}
              disabled={generateMutation.isPending || !formData.text}
              startIcon={
                generateMutation.isPending ? <CircularProgress size={20} /> : <MusicNote />
              }
              sx={{ mt: 3 }}
            >
              {generateMutation.isPending ? 'Generating Music...' : 'Generate Music'}
            </Button>
          </Paper>
        </Grid>

        {/* Right side - Output */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, minHeight: 600 }}>
            <Typography variant="h6" gutterBottom>
              Generated Music
            </Typography>

            <Divider sx={{ my: 2 }} />

            {generatedMusic ? (
              <Box>
                <Card sx={{ mb: 2 }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      {generatedMusic.name}
                    </Typography>
                    {generatedMusic.description && (
                      <Typography variant="body2" color="text.secondary" paragraph>
                        {generatedMusic.description}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                      {generatedMusic.genre && (
                        <Chip label={generatedMusic.genre} size="small" color="primary" />
                      )}
                      {generatedMusic.mood && (
                        <Chip label={generatedMusic.mood} size="small" color="secondary" />
                      )}
                      <Chip label={`${generatedMusic.duration}s`} size="small" />
                    </Box>
                  </CardContent>
                </Card>

                <AudioPlayer
                  audioUrl={getAudioUrl(generatedMusic.fileUrl)}
                  title={generatedMusic.name}
                />

                <Box sx={{ mt: 3, p: 2, bgcolor: 'success.50', borderRadius: 1 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Music Details
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Duration: {generatedMusic.duration} seconds
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Format: MP3
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Generated: {new Date(generatedMusic.createdAt).toLocaleString()}
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
                <MusicNote sx={{ fontSize: 80, mb: 2, opacity: 0.3 }} />
                <Typography variant="body1" align="center">
                  Your generated music will appear here
                </Typography>
                <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                  Describe the music you want and click "Generate Music"
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Tips Section */}
      <Paper sx={{ p: 3, mt: 3, bgcolor: 'info.50' }}>
        <Typography variant="h6" gutterBottom>
          Tips for Better Music Generation
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <Typography variant="subtitle2" gutterBottom>
              Be Descriptive
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Include instruments, tempo, and mood in your description
            </Typography>
          </Grid>
          <Grid item xs={12} md={3}>
            <Typography variant="subtitle2" gutterBottom>
              Use Presets
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Start with a preset and modify it to your needs
            </Typography>
          </Grid>
          <Grid item xs={12} md={3}>
            <Typography variant="subtitle2" gutterBottom>
              Adjust Duration
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Shorter durations (5-10s) work best for loops
            </Typography>
          </Grid>
          <Grid item xs={12} md={3}>
            <Typography variant="subtitle2" gutterBottom>
              Experiment
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Try different prompt influence values for varied results
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default MusicGenerator;
