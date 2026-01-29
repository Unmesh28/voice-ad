import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  LinearProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Chip,
  Stack,
} from '@mui/material';
import { AutoAwesome, Download, CheckCircle, Error } from '@mui/icons-material';
import productionService from '../services/production.service';
import toast from 'react-hot-toast';

interface ProductionStage {
  label: string;
  completed: boolean;
}

const QuickProduction = () => {
  const [prompt, setPrompt] = useState('');
  const [voiceId, setVoiceId] = useState('default');
  const [duration, setDuration] = useState(30);
  const [tone, setTone] = useState('professional');
  const [loading, setLoading] = useState(false);
  const [productionId, setProductionId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stages: ProductionStage[] = [
    { label: 'Generating Script', completed: progress >= 25 },
    { label: 'Creating Voice', completed: progress >= 50 },
    { label: 'Generating Music', completed: progress >= 75 },
    { label: 'Mixing Audio', completed: progress >= 90 },
    { label: 'Complete', completed: progress === 100 },
  ];

  const handleCreate = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    setLoading(true);
    setError(null);
    setOutputUrl(null);
    setProgress(0);

    try {
      // Start the production
      const response = await productionService.createQuickProduction({
        prompt,
        voiceId,
        duration,
        tone,
      });

      setProductionId(response.productionId);
      toast.success('Production started!');

      // Poll for progress
      pollProgress(response.productionId);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start production');
      setError(err.response?.data?.message || 'Failed to start production');
      setLoading(false);
    }
  };

  const pollProgress = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const progressData = await productionService.getProductionProgress(id);
        setProgress(progressData.progress);
        setCurrentStage(progressData.message);

        if (progressData.stage === 'completed' && progressData.outputUrl) {
          setOutputUrl(progressData.outputUrl);
          setLoading(false);
          clearInterval(interval);
          toast.success('Production completed!');
        } else if (progressData.stage === 'failed') {
          setError(progressData.message);
          setLoading(false);
          clearInterval(interval);
          toast.error('Production failed');
        }
      } catch (err) {
        console.error('Failed to get progress:', err);
      }
    }, 2000); // Poll every 2 seconds

    // Stop polling after 10 minutes
    setTimeout(() => {
      clearInterval(interval);
      if (loading) {
        setLoading(false);
        setError('Production timed out');
      }
    }, 600000);
  };

  const handleDownload = () => {
    if (outputUrl) {
      const link = document.createElement('a');
      link.href = `http://localhost:5000${outputUrl}`;
      link.download = 'production.mp3';
      link.click();
    }
  };

  const handleReset = () => {
    setPrompt('');
    setProgress(0);
    setCurrentStage('');
    setOutputUrl(null);
    setError(null);
    setProductionId(null);
  };

  return (
    <Paper
      elevation={3}
      sx={{
        p: 4,
        mb: 4,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <AutoAwesome sx={{ mr: 1, fontSize: 32 }} />
        <Typography variant="h5" fontWeight="bold">
          Quick Production - One-Click AI Audio
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ mb: 3, opacity: 0.9 }}>
        Enter a prompt and let AI handle everything: script generation, voice synthesis, music creation, and mixing!
      </Typography>

      {!loading && !outputUrl && (
        <Box>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Describe your audio production"
            placeholder="e.g., Create a 30-second energetic ad for a new fitness app targeting young professionals"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                bgcolor: 'white',
              },
            }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Tone</InputLabel>
              <Select
                value={tone}
                label="Tone"
                onChange={(e) => setTone(e.target.value)}
                sx={{ bgcolor: 'white' }}
              >
                <MenuItem value="professional">Professional</MenuItem>
                <MenuItem value="friendly">Friendly</MenuItem>
                <MenuItem value="energetic">Energetic</MenuItem>
                <MenuItem value="calm">Calm</MenuItem>
                <MenuItem value="exciting">Exciting</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Duration</InputLabel>
              <Select
                value={duration}
                label="Duration"
                onChange={(e) => setDuration(Number(e.target.value))}
                sx={{ bgcolor: 'white' }}
              >
                <MenuItem value={15}>15 seconds</MenuItem>
                <MenuItem value={30}>30 seconds</MenuItem>
                <MenuItem value={60}>60 seconds</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleCreate}
            disabled={loading}
            sx={{
              bgcolor: 'white',
              color: '#667eea',
              '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 0.9)',
              },
            }}
          >
            Generate Production
          </Button>
        </Box>
      )}

      {loading && (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {currentStage}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              mb: 2,
              height: 8,
              borderRadius: 4,
              bgcolor: 'rgba(255, 255, 255, 0.3)',
              '& .MuiLinearProgress-bar': {
                bgcolor: 'white',
              },
            }}
          />

          <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
            {stages.map((stage, index) => (
              <Chip
                key={index}
                label={stage.label}
                icon={stage.completed ? <CheckCircle /> : undefined}
                sx={{
                  bgcolor: stage.completed ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.3)',
                  color: stage.completed ? '#667eea' : 'white',
                }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {outputUrl && !error && (
        <Box>
          <Alert
            icon={<CheckCircle />}
            severity="success"
            sx={{ mb: 2, bgcolor: 'rgba(255, 255, 255, 0.9)' }}
          >
            Your production is ready!
          </Alert>

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={handleDownload}
              sx={{
                bgcolor: 'white',
                color: '#667eea',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.9)',
                },
              }}
            >
              Download
            </Button>
            <Button
              variant="outlined"
              onClick={handleReset}
              sx={{
                color: 'white',
                borderColor: 'white',
                '&:hover': {
                  borderColor: 'white',
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                },
              }}
            >
              Create Another
            </Button>
          </Stack>

          <Box sx={{ mt: 2 }}>
            <audio controls src={`http://localhost:5000${outputUrl}`} style={{ width: '100%' }} />
          </Box>
        </Box>
      )}

      {error && (
        <Alert
          icon={<Error />}
          severity="error"
          sx={{ bgcolor: 'rgba(255, 255, 255, 0.9)' }}
          action={
            <Button color="inherit" size="small" onClick={handleReset}>
              Try Again
            </Button>
          }
        >
          {error}
        </Alert>
      )}
    </Paper>
  );
};

export default QuickProduction;
