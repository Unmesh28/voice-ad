import { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import { AutoAwesome, ContentCopy, Save, Refresh } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import projectService from '../services/project.service';
import scriptService from '../services/script.service';

const ScriptGenerator = () => {
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    projectId: '',
    prompt: '',
    tone: '',
    length: 'medium' as 'short' | 'medium' | 'long',
    targetAudience: '',
    productName: '',
    additionalContext: '',
    title: '',
  });

  const [generatedScript, setGeneratedScript] = useState('');

  // Fetch projects
  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getProjects('ACTIVE'),
  });

  // Auto-select first project if available
  useEffect(() => {
    if (projects && projects.length > 0 && !formData.projectId) {
      setFormData((prev) => ({ ...prev, projectId: projects[0].id }));
    }
  }, [projects, formData.projectId]);

  // Generate script mutation
  const generateMutation = useMutation({
    mutationFn: (data: typeof formData) => scriptService.generateScript(data),
    onSuccess: (data) => {
      setGeneratedScript(data.content);
      toast.success('Script generated successfully!');
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to generate script');
    },
  });

  // Save script mutation
  const saveMutation = useMutation({
    mutationFn: (data: { projectId: string; title: string; content: string }) =>
      scriptService.createScript(data),
    onSuccess: () => {
      toast.success('Script saved successfully!');
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
      // Reset form
      setGeneratedScript('');
      setFormData({
        ...formData,
        prompt: '',
        tone: '',
        targetAudience: '',
        productName: '',
        additionalContext: '',
        title: '',
      });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save script');
    },
  });

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerate = () => {
    if (!formData.projectId) {
      toast.error('Please select a project');
      return;
    }
    if (!formData.prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    generateMutation.mutate(formData);
  };

  const handleSave = () => {
    if (!generatedScript) {
      toast.error('No script to save');
      return;
    }

    const title = formData.title || `Generated Script - ${new Date().toLocaleString()}`;

    saveMutation.mutate({
      projectId: formData.projectId,
      title,
      content: generatedScript,
    });
  };

  const handleCopy = () => {
    if (generatedScript) {
      navigator.clipboard.writeText(generatedScript);
      toast.success('Script copied to clipboard!');
    }
  };

  const handleReset = () => {
    setGeneratedScript('');
    setFormData({
      ...formData,
      prompt: '',
      tone: '',
      targetAudience: '',
      productName: '',
      additionalContext: '',
      title: '',
    });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <AutoAwesome sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" gutterBottom>
            AI Script Generator
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Generate professional audio advertisement scripts powered by AI
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left side - Input Form */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Script Parameters
            </Typography>

            <Box sx={{ mt: 2 }}>
              <FormControl fullWidth margin="normal">
                <InputLabel>Project</InputLabel>
                <Select
                  value={formData.projectId}
                  onChange={(e) => handleChange('projectId', e.target.value)}
                  label="Project"
                  disabled={loadingProjects}
                >
                  {projects?.map((project) => (
                    <MenuItem key={project.id} value={project.id}>
                      {project.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Product/Service Name"
                value={formData.productName}
                onChange={(e) => handleChange('productName', e.target.value)}
                margin="normal"
                placeholder="e.g., VoiceAd Platform"
              />

              <TextField
                fullWidth
                multiline
                rows={4}
                label="What should the ad be about?"
                value={formData.prompt}
                onChange={(e) => handleChange('prompt', e.target.value)}
                margin="normal"
                placeholder="Describe your product, key features, benefits, or the message you want to convey..."
                required
              />

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Tone</InputLabel>
                    <Select
                      value={formData.tone}
                      onChange={(e) => handleChange('tone', e.target.value)}
                      label="Tone"
                    >
                      <MenuItem value="">Any</MenuItem>
                      <MenuItem value="professional">Professional</MenuItem>
                      <MenuItem value="friendly">Friendly</MenuItem>
                      <MenuItem value="enthusiastic">Enthusiastic</MenuItem>
                      <MenuItem value="casual">Casual</MenuItem>
                      <MenuItem value="urgent">Urgent</MenuItem>
                      <MenuItem value="inspirational">Inspirational</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Length</InputLabel>
                    <Select
                      value={formData.length}
                      onChange={(e) => handleChange('length', e.target.value)}
                      label="Length"
                    >
                      <MenuItem value="short">Short (15-20s)</MenuItem>
                      <MenuItem value="medium">Medium (30-40s)</MenuItem>
                      <MenuItem value="long">Long (50-60s)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <TextField
                fullWidth
                label="Target Audience"
                value={formData.targetAudience}
                onChange={(e) => handleChange('targetAudience', e.target.value)}
                margin="normal"
                placeholder="e.g., Young professionals, tech enthusiasts"
              />

              <TextField
                fullWidth
                multiline
                rows={2}
                label="Additional Context (Optional)"
                value={formData.additionalContext}
                onChange={(e) => handleChange('additionalContext', e.target.value)}
                margin="normal"
                placeholder="Any specific details, requirements, or style preferences..."
              />

              <Button
                fullWidth
                variant="contained"
                size="large"
                onClick={handleGenerate}
                disabled={generateMutation.isPending || !formData.prompt}
                startIcon={
                  generateMutation.isPending ? <CircularProgress size={20} /> : <AutoAwesome />
                }
                sx={{ mt: 3 }}
              >
                {generateMutation.isPending ? 'Generating...' : 'Generate Script'}
              </Button>
            </Box>
          </Paper>
        </Grid>

        {/* Right side - Generated Output */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, minHeight: 600 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" gutterBottom>
                Generated Script
              </Typography>
              {generatedScript && (
                <Box>
                  <Tooltip title="Copy to clipboard">
                    <IconButton onClick={handleCopy} size="small">
                      <ContentCopy />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Reset">
                    <IconButton onClick={handleReset} size="small">
                      <Refresh />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {generatedScript ? (
              <Box>
                <TextField
                  fullWidth
                  multiline
                  rows={15}
                  value={generatedScript}
                  onChange={(e) => setGeneratedScript(e.target.value)}
                  variant="outlined"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: '0.95rem',
                    },
                  }}
                />

                <TextField
                  fullWidth
                  label="Script Title (Optional)"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  margin="normal"
                  placeholder="Enter a custom title for this script"
                />

                <Button
                  fullWidth
                  variant="contained"
                  color="success"
                  size="large"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  startIcon={saveMutation.isPending ? <CircularProgress size={20} /> : <Save />}
                  sx={{ mt: 2 }}
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Script'}
                </Button>
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
                <AutoAwesome sx={{ fontSize: 80, mb: 2, opacity: 0.3 }} />
                <Typography variant="body1" align="center">
                  Your generated script will appear here
                </Typography>
                <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                  Fill in the form and click "Generate Script" to get started
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Tips Section */}
      <Paper sx={{ p: 3, mt: 3, bgcolor: 'info.50' }}>
        <Typography variant="h6" gutterBottom>
          Tips for Better Results
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Be Specific
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Provide clear details about your product, key benefits, and what makes it unique
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Know Your Audience
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Specify your target demographic to get a script that resonates with them
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" gutterBottom>
              Set the Right Tone
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Choose a tone that matches your brand and the emotions you want to evoke
            </Typography>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default ScriptGenerator;
