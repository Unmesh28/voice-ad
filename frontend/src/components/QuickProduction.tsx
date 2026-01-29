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
  Fade,
  Slide,
  Grow,
  Zoom,
} from '@mui/material';
import { AutoAwesome, Download, CheckCircle, Error, PlayArrow } from '@mui/icons-material';
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
    <Fade in timeout={800}>
      <Paper
        elevation={3}
        sx={{
          p: { xs: 2, sm: 3, md: 4 },
          mb: 4,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          borderRadius: 3,
          transition: 'all 0.3s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: '0 8px 24px rgba(102, 126, 234, 0.4)',
          },
        }}
      >
        <Slide direction="down" in timeout={600}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
            <AutoAwesome
              sx={{
                fontSize: { xs: 28, sm: 32 },
                animation: 'pulse 2s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.6 },
                },
              }}
            />
            <Typography
              variant="h5"
              fontWeight="bold"
              sx={{
                fontSize: { xs: '1.25rem', sm: '1.5rem' },
              }}
            >
              Quick Production - One-Click AI Audio
            </Typography>
          </Box>
        </Slide>

        <Fade in timeout={1000}>
          <Typography
            variant="body2"
            sx={{
              mb: 3,
              opacity: 0.9,
              fontSize: { xs: '0.875rem', sm: '1rem' },
            }}
          >
            Enter a prompt and let AI handle everything: script generation, voice synthesis, music creation, and mixing!
          </Typography>
        </Fade>

      {!loading && !outputUrl && (
        <Grow in timeout={800}>
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
                  borderRadius: 2,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  },
                  '&.Mui-focused': {
                    boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
                  },
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
                  sx={{
                    bgcolor: 'white',
                    borderRadius: 2,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    },
                  }}
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
                  sx={{
                    bgcolor: 'white',
                    borderRadius: 2,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    },
                  }}
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
              startIcon={<PlayArrow />}
              sx={{
                bgcolor: 'white',
                color: '#667eea',
                borderRadius: 2,
                py: 1.5,
                fontSize: { xs: '0.95rem', sm: '1.1rem' },
                fontWeight: 'bold',
                transition: 'all 0.3s ease',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.95)',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              Generate Production
            </Button>
          </Box>
        </Grow>
      )}

      {loading && (
        <Fade in timeout={600}>
          <Box>
            <Slide direction="up" in={loading} timeout={500}>
              <Typography
                variant="body2"
                sx={{
                  mb: 1,
                  fontSize: { xs: '0.875rem', sm: '1rem' },
                  fontWeight: 500,
                }}
              >
                {currentStage}
              </Typography>
            </Slide>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                mb: 2,
                height: 10,
                borderRadius: 5,
                bgcolor: 'rgba(255, 255, 255, 0.3)',
                '& .MuiLinearProgress-bar': {
                  bgcolor: 'white',
                  borderRadius: 5,
                  transition: 'transform 0.4s ease',
                },
              }}
            />

            <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
              {stages.map((stage, index) => (
                <Zoom
                  key={index}
                  in={true}
                  style={{ transitionDelay: `${index * 100}ms` }}
                >
                  <Chip
                    label={stage.label}
                    icon={stage.completed ? <CheckCircle /> : undefined}
                    sx={{
                      bgcolor: stage.completed ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.3)',
                      color: stage.completed ? '#667eea' : 'white',
                      fontWeight: stage.completed ? 600 : 400,
                      fontSize: { xs: '0.75rem', sm: '0.875rem' },
                      transition: 'all 0.4s ease',
                      '&:hover': {
                        transform: 'scale(1.05)',
                      },
                    }}
                  />
                </Zoom>
              ))}
            </Stack>
          </Box>
        </Fade>
      )}

      {outputUrl && !error && (
        <Fade in timeout={800}>
          <Box>
            <Zoom in timeout={600}>
              <Alert
                icon={<CheckCircle />}
                severity="success"
                sx={{
                  mb: 2,
                  bgcolor: 'rgba(255, 255, 255, 0.95)',
                  borderRadius: 2,
                  fontWeight: 500,
                  fontSize: { xs: '0.875rem', sm: '1rem' },
                }}
              >
                Your production is ready!
              </Alert>
            </Zoom>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ mb: 3 }}
            >
              <Button
                variant="contained"
                startIcon={<Download />}
                onClick={handleDownload}
                fullWidth={false}
                sx={{
                  bgcolor: 'white',
                  color: '#667eea',
                  borderRadius: 2,
                  px: 3,
                  py: 1.5,
                  fontWeight: 600,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.95)',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
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
                  borderRadius: 2,
                  px: 3,
                  py: 1.5,
                  fontWeight: 600,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    borderColor: 'white',
                    bgcolor: 'rgba(255, 255, 255, 0.15)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                Create Another
              </Button>
            </Stack>

            <Grow in timeout={1000}>
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                  p: 2,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  },
                }}
              >
                <audio
                  controls
                  src={`http://localhost:5000${outputUrl}`}
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    outline: 'none',
                  }}
                />
              </Box>
            </Grow>
          </Box>
        </Fade>
      )}

      {error && (
        <Zoom in timeout={600}>
          <Alert
            icon={<Error />}
            severity="error"
            sx={{
              bgcolor: 'rgba(255, 255, 255, 0.95)',
              borderRadius: 2,
              fontSize: { xs: '0.875rem', sm: '1rem' },
            }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={handleReset}
                sx={{
                  fontWeight: 600,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    transform: 'scale(1.05)',
                  },
                }}
              >
                Try Again
              </Button>
            }
          >
            {error}
          </Alert>
        </Zoom>
      )}
      </Paper>
    </Fade>
  );
};

export default QuickProduction;
