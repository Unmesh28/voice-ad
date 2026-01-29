import { Box, Typography, Grid, Paper, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Add, Mic, MusicNote, AutoAwesome } from '@mui/icons-material';

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
      title: 'New Production',
      description: 'Create a new audio production',
      icon: <Mic fontSize="large" />,
      path: '/production',
      color: '#2e7d32',
    },
  ];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        Welcome to VoiceAd - AI-powered audio production platform
      </Typography>

      <Grid container spacing={3} sx={{ mt: 2 }}>
        {cards.map((card, index) => (
          <Grid item xs={12} md={4} key={index}>
            <Paper
              sx={{
                p: 3,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 4,
                },
              }}
              onClick={() => navigate(card.path)}
            >
              <Box
                sx={{
                  width: 60,
                  height: 60,
                  borderRadius: 2,
                  bgcolor: card.color,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                }}
              >
                {card.icon}
              </Box>
              <Typography variant="h6" gutterBottom>
                {card.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
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
