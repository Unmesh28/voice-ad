import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Grid,
  CircularProgress,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Slider,
  Switch,
  FormControlLabel,
  LinearProgress,
  Alert,
  SelectChangeEvent,
} from '@mui/material';
import { Mic, PlayArrow, Download } from '@mui/icons-material';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import productionService from '../services/production.service';
import projectService from '../services/project.service';
import scriptService from '../services/script.service';
import musicService from '../services/music.service';
import AudioPlayer from '../components/AudioPlayer';
import { Script, MusicTrack, Project, Production as ProductionType } from '../types';

const Production = () => {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [selectedMusicId, setSelectedMusicId] = useState('');
  const [voiceVolume, setVoiceVolume] = useState(100);
  const [musicVolume, setMusicVolume] = useState(30);
  const [fadeIn, setFadeIn] = useState(2);
  const [fadeOut, setFadeOut] = useState(2);
  const [audioDucking, setAudioDucking] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'mp3' | 'wav' | 'aac'>('mp3');
  const [productionId, setProductionId] = useState('');
  const [production, setProduction] = useState<ProductionType | null>(null);

  // Fetch projects
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => projectService.getProjects(),
  });

  // Fetch scripts for selected project
  const { data: scripts = [] } = useQuery<Script[]>({
    queryKey: ['scripts', selectedProjectId],
    queryFn: () => scriptService.getScripts(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  // Fetch music tracks
  const { data: musicTracks = [] } = useQuery<MusicTrack[]>({
    queryKey: ['music'],
    queryFn: () => musicService.getMusicTracks(),
  });

  // Create production mutation
  const createProductionMutation = useMutation({
    mutationFn: () =>
      productionService.createProduction({
        projectId: selectedProjectId,
        scriptId: selectedScriptId || undefined,
        musicId: selectedMusicId || undefined,
        settings: {
          voiceVolume: voiceVolume / 100,
          musicVolume: musicVolume / 100,
          fadeIn,
          fadeOut,
          audioDucking,
          outputFormat,
        },
      }),
    onSuccess: (data) => {
      setProductionId(data.id);
      setProduction(data);
      toast.success('Production created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create production');
    },
  });

  // Mix production mutation
  const mixProductionMutation = useMutation({
    mutationFn: (id: string) => productionService.mixProductionSync(id),
    onSuccess: (data) => {
      const fullUrl = `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}${data.outputUrl}`;
      setProduction((prev) => prev ? { ...prev, outputUrl: fullUrl, status: 'COMPLETED', progress: 100 } : null);
      toast.success('Audio production completed successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to mix production');
    },
  });

  const handleCreateAndMix = async () => {
    if (!selectedProjectId) {
      toast.error('Please select a project');
      return;
    }

    if (!selectedScriptId) {
      toast.error('Please select a script');
      return;
    }

    try {
      // Create production first
      const prod = await createProductionMutation.mutateAsync();

      // Then mix it
      await mixProductionMutation.mutateAsync(prod.id);
    } catch (error) {
      // Error already handled in mutations
    }
  };

  const getScriptPreview = () => {
    const script = scripts.find((s) => s.id === selectedScriptId);
    if (!script) return '';
    return script.content.substring(0, 200) + (script.content.length > 200 ? '...' : '');
  };

  const isProcessing = createProductionMutation.isPending || mixProductionMutation.isPending;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Mic sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" gutterBottom>
            Audio Production Mixer
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Combine voice, music, and effects into a professional audio production
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left side - Controls */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Source Selection
            </Typography>
            <Divider sx={{ mb: 3 }} />

            {/* Project Selection */}
            <FormControl fullWidth margin="normal">
              <InputLabel>Project</InputLabel>
              <Select
                value={selectedProjectId}
                onChange={(e: SelectChangeEvent) => {
                  setSelectedProjectId(e.target.value);
                  setSelectedScriptId(''); // Reset script when project changes
                }}
                label="Project"
              >
                <MenuItem value="">
                  <em>Select a project</em>
                </MenuItem>
                {projects.map((project) => (
                  <MenuItem key={project.id} value={project.id}>
                    {project.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Script Selection */}
            <FormControl fullWidth margin="normal" disabled={!selectedProjectId}>
              <InputLabel>Script (Voice)</InputLabel>
              <Select
                value={selectedScriptId}
                onChange={(e: SelectChangeEvent) => setSelectedScriptId(e.target.value)}
                label="Script (Voice)"
              >
                <MenuItem value="">
                  <em>Select a script</em>
                </MenuItem>
                {scripts.map((script) => (
                  <MenuItem key={script.id} value={script.id}>
                    {script.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {selectedScriptId && (
              <Box sx={{ mt: 1, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Script Preview:
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {getScriptPreview()}
                </Typography>
              </Box>
            )}

            {/* Music Selection */}
            <FormControl fullWidth margin="normal">
              <InputLabel>Background Music (Optional)</InputLabel>
              <Select
                value={selectedMusicId}
                onChange={(e: SelectChangeEvent) => setSelectedMusicId(e.target.value)}
                label="Background Music (Optional)"
              >
                <MenuItem value="">
                  <em>No background music</em>
                </MenuItem>
                {musicTracks.map((music) => (
                  <MenuItem key={music.id} value={music.id}>
                    {music.name} ({music.duration}s)
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Audio Settings
            </Typography>
            <Divider sx={{ mb: 3 }} />

            {/* Voice Volume */}
            <Box sx={{ mb: 3 }}>
              <Typography gutterBottom>Voice Volume: {voiceVolume}%</Typography>
              <Slider
                value={voiceVolume}
                onChange={(_, value) => setVoiceVolume(value as number)}
                min={0}
                max={200}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: '0%' },
                  { value: 100, label: '100%' },
                  { value: 200, label: '200%' },
                ]}
              />
            </Box>

            {/* Music Volume */}
            <Box sx={{ mb: 3 }}>
              <Typography gutterBottom>Music Volume: {musicVolume}%</Typography>
              <Slider
                value={musicVolume}
                onChange={(_, value) => setMusicVolume(value as number)}
                min={0}
                max={200}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: '0%' },
                  { value: 100, label: '100%' },
                  { value: 200, label: '200%' },
                ]}
                disabled={!selectedMusicId}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Fade In */}
            <Box sx={{ mb: 3 }}>
              <Typography gutterBottom>Fade In: {fadeIn}s</Typography>
              <Slider
                value={fadeIn}
                onChange={(_, value) => setFadeIn(value as number)}
                min={0}
                max={10}
                step={0.5}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: '0s' },
                  { value: 5, label: '5s' },
                  { value: 10, label: '10s' },
                ]}
              />
            </Box>

            {/* Fade Out */}
            <Box sx={{ mb: 3 }}>
              <Typography gutterBottom>Fade Out: {fadeOut}s</Typography>
              <Slider
                value={fadeOut}
                onChange={(_, value) => setFadeOut(value as number)}
                min={0}
                max={10}
                step={0.5}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: '0s' },
                  { value: 5, label: '5s' },
                  { value: 10, label: '10s' },
                ]}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            {/* Audio Ducking */}
            <FormControlLabel
              control={
                <Switch
                  checked={audioDucking}
                  onChange={(e) => setAudioDucking(e.target.checked)}
                  disabled={!selectedMusicId}
                />
              }
              label="Audio Ducking (Lower music when voice plays)"
            />

            {/* Output Format */}
            <FormControl fullWidth margin="normal">
              <InputLabel>Output Format</InputLabel>
              <Select
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as 'mp3' | 'wav' | 'aac')}
                label="Output Format"
              >
                <MenuItem value="mp3">MP3 (Compressed, Small)</MenuItem>
                <MenuItem value="wav">WAV (Uncompressed, Large)</MenuItem>
                <MenuItem value="aac">AAC (High Quality, Medium)</MenuItem>
              </Select>
            </FormControl>

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleCreateAndMix}
              disabled={isProcessing || !selectedProjectId || !selectedScriptId}
              startIcon={isProcessing ? <CircularProgress size={20} /> : <PlayArrow />}
              sx={{ mt: 3 }}
            >
              {isProcessing ? 'Mixing Audio...' : 'Mix Audio Production'}
            </Button>
          </Paper>
        </Grid>

        {/* Right side - Output */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, minHeight: 600 }}>
            <Typography variant="h6" gutterBottom>
              Production Output
            </Typography>
            <Divider sx={{ my: 2 }} />

            {isProcessing && (
              <Box sx={{ mb: 3 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Processing your audio production...
                </Alert>
                <LinearProgress />
              </Box>
            )}

            {production && production.status === 'COMPLETED' && production.outputUrl ? (
              <Box>
                <AudioPlayer audioUrl={production.outputUrl} title="Final Production" />

                <Box sx={{ mt: 3, p: 2, bgcolor: 'success.50', borderRadius: 1 }}>
                  <Typography variant="subtitle2" gutterBottom color="success.main">
                    Production Details
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Duration: {production.duration}s
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Format: {outputFormat.toUpperCase()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Voice Volume: {voiceVolume}%
                  </Typography>
                  {selectedMusicId && (
                    <Typography variant="body2" color="text.secondary">
                      Music Volume: {musicVolume}%
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    Audio Ducking: {audioDucking ? 'Enabled' : 'Disabled'}
                  </Typography>
                </Box>

                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<Download />}
                  href={production.outputUrl}
                  download
                  sx={{ mt: 2 }}
                >
                  Download Production
                </Button>
              </Box>
            ) : production && production.status === 'FAILED' ? (
              <Alert severity="error">
                Production failed: {production.errorMessage || 'Unknown error'}
              </Alert>
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
                <Mic sx={{ fontSize: 80, mb: 2, opacity: 0.3 }} />
                <Typography variant="body1" align="center">
                  Your final audio production will appear here
                </Typography>
                <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                  Select sources, adjust settings, and click "Mix Audio Production"
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Tips Section */}
      <Paper sx={{ p: 3, mt: 3, bgcolor: 'info.50' }}>
        <Typography variant="h6" gutterBottom>
          Production Tips
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Balance Voice & Music
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Typically, voice should be at 100% and music at 20-40% for clear communication
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Use Audio Ducking
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Audio ducking automatically lowers music volume when voice is speaking for professional results
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Add Fades
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Fade in/out creates smooth transitions and prevents abrupt starts or stops
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default Production;
