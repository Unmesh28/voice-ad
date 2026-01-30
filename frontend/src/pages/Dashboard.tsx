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
    <Box sx={{ width: '100%' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h3" gutterBottom fontWeight="bold" sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' } }}>
          Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph sx={{ fontSize: { xs: '0.95rem', sm: '1.05rem' } }}>
          Welcome to VoiceAd - AI-powered audio production platform
        </Typography>
      </Box>

      {/* Quick Production - One-Click AI */}
      <QuickProduction />

      <Box sx={{ textAlign: 'center', mt: 8, mb: 4 }}>
        <Typography variant="h4" gutterBottom fontWeight="600" sx={{ fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2rem' } }}>
          Or use individual tools:
        </Typography>
      </Box>

      <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} sx={{ mt: 1 }}>
        {cards.map((card, index) => (
          <Grid item xs={12} sm={6} md={4} lg={2.4} key={index}>
            <Paper
              elevation={3}
              sx={{
                p: { xs: 2.5, sm: 3, md: 3.5 },
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                borderRadius: 3,
                border: '1px solid',
                borderColor: 'transparent',
                background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  transform: 'translateY(-8px)',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.15)',
                  borderColor: card.color,
                },
              }}
              onClick={() => navigate(card.path)}
            >
              <Box
                sx={{
                  width: { xs: 60, sm: 64, md: 68 },
                  height: { xs: 60, sm: 64, md: 68 },
                  borderRadius: 2.5,
                  bgcolor: card.color,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2.5,
                  boxShadow: `0 4px 12px ${card.color}40`,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: 'rotate(8deg) scale(1.12)',
                    boxShadow: `0 6px 16px ${card.color}60`,
                  },
                }}
              >
                {card.icon}
              </Box>
              <Typography variant="h6" gutterBottom fontWeight="600" sx={{ fontSize: { xs: '1.05rem', sm: '1.15rem', md: '1.25rem' } }}>
                {card.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7, fontSize: { xs: '0.85rem', sm: '0.9rem' } }}>
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
