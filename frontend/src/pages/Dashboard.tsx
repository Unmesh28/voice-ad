import { Box, Typography, Grid, Paper, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Add, Mic, MusicNote, AutoAwesome, RecordVoiceOver } from '@mui/icons-material';
import QuickProduction from '../components/QuickProduction';

const Dashboard = () => {
  const navigate = useNavigate();

  const cards = [
    {
      title: 'Projects',
      description: 'Manage your audio production projects',
      icon: <Add fontSize="large" />,
      path: '/projects',
      color: '#1976d2',
    },
    {
      title: 'Script Generator',
      description: 'Generate ad scripts with AI',
      icon: <AutoAwesome fontSize="large" />,
      path: '/script-generator',
      color: '#9c27b0',
    },
    {
      title: 'TTS Generator',
      description: 'Convert text to speech with AI voices',
      icon: <RecordVoiceOver fontSize="large" />,
      path: '/tts-generator',
      color: '#ed6c02',
    },
    {
      title: 'Music Generator',
      description: 'Generate background music with AI',
      icon: <MusicNote fontSize="large" />,
      path: '/music-generator',
      color: '#f57c00',
    },
    {
      title: 'New Production',
      description: 'Create a new audio production',
      icon: <Mic fontSize="large" />,
      path: '/production',
      color: '#2e7d32',
    },
  ];

  return (
    <Box sx={{ maxWidth: '100%', mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h4" gutterBottom fontWeight="bold">
          Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          Welcome to VoiceAd - AI-powered audio production platform
        </Typography>
      </Box>

      {/* Quick Production - One-Click AI */}
      <QuickProduction />

      <Box sx={{ textAlign: 'center', mt: 6, mb: 3 }}>
        <Typography variant="h5" gutterBottom fontWeight="600">
          Or use individual tools:
        </Typography>
      </Box>

      <Grid container spacing={3} sx={{ mt: 1 }}>
        {cards.map((card, index) => (
          <Grid item xs={12} md={4} key={index}>
            <Paper
              elevation={2}
              sx={{
                p: 3,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                borderRadius: 3,
                transition: 'all 0.3s ease',
                '&:hover': {
                  transform: 'translateY(-6px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                },
              }}
              onClick={() => navigate(card.path)}
            >
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: 2.5,
                  bgcolor: card.color,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2.5,
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    transform: 'rotate(5deg) scale(1.1)',
                  },
                }}
              >
                {card.icon}
              </Box>
              <Typography variant="h6" gutterBottom fontWeight="600">
                {card.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                {card.description}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;
