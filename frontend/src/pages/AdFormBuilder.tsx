import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Slider,
  Collapse,
  LinearProgress,
  Alert,
} from '@mui/material';
import {
  Campaign,
  PlayArrow,
  Pause,
  Download,
  ExpandMore,
  ExpandLess,
  MusicNote,
  RecordVoiceOver,
  Tune,
  GraphicEq,
  Add,
  Delete,
} from '@mui/icons-material';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import adformService from '../services/adform.service';
import type {
  AdFormDocument,
  AdFormSection,
  AdFormBuildResult,
  SoundTemplate,
  AdFormVoice,
} from '../services/adform.service';
import { getMediaUrl } from '../config/api.config';

// ============================================================================
// AdForm Builder — One-page ad production with elastic templates
// ============================================================================

const DEFAULT_SECTIONS: AdFormSection[] = [
  { name: 'hook', soundSegment: 'intro', text: '' },
  { name: 'body', soundSegment: 'main', text: '' },
  { name: 'cta', soundSegment: 'outro', text: '' },
];

const AdFormBuilder = () => {
  // ── Script State ──
  const [sections, setSections] = useState<AdFormSection[]>(DEFAULT_SECTIONS);
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');

  // ── Voice State ──
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);

  // ── Template State ──
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [genreFilter, setGenreFilter] = useState('');

  // ── Production State ──
  const [masteringPreset, setMasteringPreset] = useState('balanced');
  const [loudnessPreset, setLoudnessPreset] = useState('crossPlatform');
  const [outputFormat, setOutputFormat] = useState('mp3');
  const [soundTail, setSoundTail] = useState(1.5);

  // ── UI State ──
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [buildResult, setBuildResult] = useState<AdFormBuildResult | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // ── Data Queries ──
  const { data: voicesData, isLoading: voicesLoading } = useQuery({
    queryKey: ['adform-voices'],
    queryFn: () => adformService.getVoices(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['adform-templates'],
    queryFn: () => adformService.getTemplates(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: presetsData } = useQuery({
    queryKey: ['adform-presets'],
    queryFn: () => adformService.getPresets(),
    staleTime: 10 * 60 * 1000,
  });

  const voices = voicesData?.voices || [];
  const templates = templatesData?.templates || [];

  // Unique genres from templates
  const genres = [...new Set(templates.map((t) => t.genre).filter(Boolean))] as string[];

  // Filter templates by genre
  const filteredTemplates = genreFilter
    ? templates.filter((t) => t.genre === genreFilter)
    : templates;

  // Auto-select first voice
  useEffect(() => {
    if (voices.length > 0 && !selectedVoiceId) {
      const adam = voices.find((v) => v.name?.toLowerCase().includes('adam'));
      setSelectedVoiceId(adam?.voiceId || voices[0].voiceId);
    }
  }, [voices, selectedVoiceId]);

  // Auto-select first template
  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  // ── Build Mutation ──
  const buildMutation = useMutation({
    mutationFn: (adform: AdFormDocument) => adformService.build(adform),
    onSuccess: (result) => {
      setBuildResult(result);
      if (result.status === 'completed') {
        toast.success(`Ad built in ${((result.timing?.totalMs || 0) / 1000).toFixed(1)}s`);
      } else {
        toast.error(result.error || 'Build failed');
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err.message || 'Build failed');
    },
  });

  // ── Handlers ──
  const handleSectionChange = (index: number, field: keyof AdFormSection, value: string) => {
    setSections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleAddSection = () => {
    setSections((prev) => [
      ...prev,
      { name: `section_${prev.length + 1}`, soundSegment: 'main', text: '' },
    ]);
  };

  const handleRemoveSection = (index: number) => {
    if (sections.length <= 1) return;
    setSections((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBuild = () => {
    const nonEmpty = sections.filter((s) => s.text.trim());
    if (nonEmpty.length === 0) {
      toast.error('Write at least one section of your ad script');
      return;
    }
    if (!selectedVoiceId) {
      toast.error('Select a voice');
      return;
    }
    if (!selectedTemplateId) {
      toast.error('Select a sound template');
      return;
    }

    const adform: AdFormDocument = {
      version: 'v1',
      content: {
        sections: nonEmpty,
      },
      speech: {
        voice: {
          provider: 'elevenlabs',
          voiceId: selectedVoiceId,
          speed: voiceSpeed,
          settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        },
      },
      production: {
        soundTemplate: selectedTemplateId,
        masteringPreset,
        loudnessPreset,
        timelineProperties: {
          fadeIn: 0.08,
          fadeOut: 0.5,
          fadeCurve: 'exp',
          soundTail,
        },
      },
      delivery: {
        format: outputFormat,
        public: true,
      },
      metadata: {
        title: title || undefined,
        brand: brand || undefined,
      },
    };

    setBuildResult(null);
    buildMutation.mutate(adform);
  };

  const handlePlay = () => {
    if (!buildResult?.outputs?.[0]?.url) return;
    const url = getMediaUrl(buildResult.outputs[0].url);

    if (isPlaying && audioEl) {
      audioEl.pause();
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(url);
    audio.onended = () => setIsPlaying(false);
    audio.play();
    setAudioEl(audio);
    setIsPlaying(true);
  };

  const handleDownload = () => {
    if (!buildResult?.outputs?.[0]?.url) return;
    const url = getMediaUrl(buildResult.outputs[0].url);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'ad'}_${buildResult.buildId}.mp3`;
    a.click();
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedVoice = voices.find((v) => v.voiceId === selectedVoiceId);
  const totalChars = sections.reduce((sum, s) => sum + s.text.length, 0);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Header */}
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography
          variant="h3"
          gutterBottom
          fontWeight="bold"
          sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' } }}
        >
          <Campaign sx={{ fontSize: 'inherit', verticalAlign: 'middle', mr: 1 }} />
          Ad Builder
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ fontSize: { xs: '0.95rem', sm: '1.05rem' } }}>
          Write your script, pick a voice and music template — get a professional audio ad in seconds
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* ── LEFT: Script + Voice + Template ── */}
        <Grid item xs={12} md={7}>
          {/* Script Sections */}
          <Paper elevation={3} sx={{ p: 3, mb: 3, borderRadius: 3 }}>
            <Typography variant="h6" fontWeight="600" gutterBottom>
              <GraphicEq sx={{ mr: 1, verticalAlign: 'middle' }} />
              Ad Script
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Write your ad in sections. Each section maps to a sound template segment (intro/main/outro).
            </Typography>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Ad Title (optional)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Brand Name (optional)"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </Grid>
            </Grid>

            {sections.map((section, index) => (
              <Box
                key={index}
                sx={{
                  mb: 2,
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: index === 0 ? 'rgba(25,118,210,0.04)' : index === sections.length - 1 ? 'rgba(46,125,50,0.04)' : 'transparent',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
                  <Chip
                    label={section.soundSegment.toUpperCase()}
                    size="small"
                    color={
                      section.soundSegment === 'intro'
                        ? 'primary'
                        : section.soundSegment === 'outro'
                        ? 'success'
                        : 'default'
                    }
                  />
                  <TextField
                    size="small"
                    label="Section Name"
                    value={section.name}
                    onChange={(e) => handleSectionChange(index, 'name', e.target.value)}
                    sx={{ width: 150 }}
                  />
                  <FormControl size="small" sx={{ width: 120 }}>
                    <InputLabel>Segment</InputLabel>
                    <Select
                      value={section.soundSegment}
                      label="Segment"
                      onChange={(e) =>
                        handleSectionChange(index, 'soundSegment', e.target.value)
                      }
                    >
                      <MenuItem value="intro">Intro</MenuItem>
                      <MenuItem value="main">Main</MenuItem>
                      <MenuItem value="outro">Outro</MenuItem>
                    </Select>
                  </FormControl>
                  {sections.length > 1 && (
                    <IconButton size="small" onClick={() => handleRemoveSection(index)} color="error">
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                </Box>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={6}
                  placeholder={
                    section.soundSegment === 'intro'
                      ? 'Hook: Grab attention in the first few seconds...'
                      : section.soundSegment === 'outro'
                      ? 'CTA: Tell listeners what to do next...'
                      : 'Body: Describe your product/service, key benefits...'
                  }
                  value={section.text}
                  onChange={(e) => handleSectionChange(index, 'text', e.target.value)}
                />
              </Box>
            ))}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button startIcon={<Add />} size="small" onClick={handleAddSection}>
                Add Section
              </Button>
              <Typography variant="caption" color="text.secondary">
                {totalChars} characters
              </Typography>
            </Box>
          </Paper>

          {/* Voice Selection */}
          <Paper elevation={3} sx={{ p: 3, mb: 3, borderRadius: 3 }}>
            <Typography variant="h6" fontWeight="600" gutterBottom>
              <RecordVoiceOver sx={{ mr: 1, verticalAlign: 'middle' }} />
              Voice
            </Typography>

            {voicesLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2">Loading voices...</Typography>
              </Box>
            ) : (
              <FormControl fullWidth size="small">
                <InputLabel>Select Voice</InputLabel>
                <Select
                  value={selectedVoiceId}
                  label="Select Voice"
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                >
                  {voices.slice(0, 50).map((v) => (
                    <MenuItem key={v.voiceId} value={v.voiceId}>
                      {v.name} {v.gender ? `(${v.gender})` : ''}{' '}
                      {v.category ? `- ${v.category}` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {selectedVoice && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {selectedVoice.name} | {selectedVoice.gender || 'n/a'} | {selectedVoice.category || 'premade'}
              </Typography>
            )}
          </Paper>

          {/* Sound Template Selection */}
          <Paper elevation={3} sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6" fontWeight="600" gutterBottom>
              <MusicNote sx={{ mr: 1, verticalAlign: 'middle' }} />
              Sound Template
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Music automatically stretches to match your voiceover duration (elastic template).
            </Typography>

            {/* Genre Filter */}
            <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              <Chip
                label="All"
                size="small"
                variant={!genreFilter ? 'filled' : 'outlined'}
                color={!genreFilter ? 'primary' : 'default'}
                onClick={() => setGenreFilter('')}
              />
              {genres.map((g) => (
                <Chip
                  key={g}
                  label={g}
                  size="small"
                  variant={genreFilter === g ? 'filled' : 'outlined'}
                  color={genreFilter === g ? 'primary' : 'default'}
                  onClick={() => setGenreFilter(g)}
                />
              ))}
            </Box>

            {templatesLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2">Loading templates...</Typography>
              </Box>
            ) : (
              <Grid container spacing={1}>
                {filteredTemplates.map((t) => (
                  <Grid item xs={6} sm={4} key={t.id}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        cursor: 'pointer',
                        borderRadius: 2,
                        borderColor:
                          selectedTemplateId === t.id ? 'primary.main' : 'divider',
                        borderWidth: selectedTemplateId === t.id ? 2 : 1,
                        bgcolor:
                          selectedTemplateId === t.id
                            ? 'rgba(25,118,210,0.08)'
                            : 'transparent',
                        transition: 'all 0.2s',
                        '&:hover': {
                          borderColor: 'primary.light',
                          bgcolor: 'rgba(25,118,210,0.04)',
                        },
                      }}
                      onClick={() => setSelectedTemplateId(t.id)}
                    >
                      <Typography variant="body2" fontWeight="600" noWrap>
                        {t.name || t.id.replace(/_/g, ' ')}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                        {t.genre && <Chip label={t.genre} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                        {t.mood && <Chip label={t.mood} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                        {t.energy && <Chip label={t.energy} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />}
                      </Box>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            )}

            {selectedTemplate && (
              <Box sx={{ mt: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="body2" fontWeight="600">
                  Selected: {selectedTemplate.name || selectedTemplate.id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedTemplate.genre} | {selectedTemplate.mood} | Energy: {selectedTemplate.energy}
                  {selectedTemplate.bpm ? ` | ${selectedTemplate.bpm} BPM` : ''}
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ── RIGHT: Production Settings + Output ── */}
        <Grid item xs={12} md={5}>
          {/* Production Settings */}
          <Paper elevation={3} sx={{ p: 3, mb: 3, borderRadius: 3 }}>
            <Typography variant="h6" fontWeight="600" gutterBottom>
              <Tune sx={{ mr: 1, verticalAlign: 'middle' }} />
              Production Settings
            </Typography>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Mastering Preset</InputLabel>
              <Select
                value={masteringPreset}
                label="Mastering Preset"
                onChange={(e) => setMasteringPreset(e.target.value)}
              >
                <MenuItem value="balanced">Balanced (recommended)</MenuItem>
                <MenuItem value="voiceenhanced">Voice Enhanced (voice focus)</MenuItem>
                <MenuItem value="musicenhanced">Music Enhanced (music forward)</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Loudness Standard</InputLabel>
              <Select
                value={loudnessPreset}
                label="Loudness Standard"
                onChange={(e) => setLoudnessPreset(e.target.value)}
              >
                <MenuItem value="crossPlatform">Cross-Platform (-16 LUFS)</MenuItem>
                <MenuItem value="spotify">Spotify (-16 LUFS)</MenuItem>
                <MenuItem value="youtube">YouTube (-14 LUFS)</MenuItem>
                <MenuItem value="podcast">Podcast (-16 LUFS)</MenuItem>
                <MenuItem value="radio">Radio / EBU R128 (-24 LUFS)</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Output Format</InputLabel>
              <Select
                value={outputFormat}
                label="Output Format"
                onChange={(e) => setOutputFormat(e.target.value)}
              >
                <MenuItem value="mp3">MP3 (320 kbps)</MenuItem>
                <MenuItem value="mp3_medium">MP3 (192 kbps)</MenuItem>
                <MenuItem value="wav">WAV (48kHz)</MenuItem>
                <MenuItem value="aac">AAC (256 kbps)</MenuItem>
                <MenuItem value="ogg">OGG Vorbis</MenuItem>
                <MenuItem value="flac">FLAC (lossless)</MenuItem>
              </Select>
            </FormControl>

            {/* Advanced */}
            <Button
              size="small"
              onClick={() => setShowAdvanced(!showAdvanced)}
              endIcon={showAdvanced ? <ExpandLess /> : <ExpandMore />}
              sx={{ mb: 1 }}
            >
              Advanced Settings
            </Button>
            <Collapse in={showAdvanced}>
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" gutterBottom>
                  Voice Speed: {voiceSpeed.toFixed(1)}x
                </Typography>
                <Slider
                  value={voiceSpeed}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  onChange={(_, v) => setVoiceSpeed(v as number)}
                  size="small"
                  sx={{ mb: 2 }}
                />
                <Typography variant="body2" gutterBottom>
                  Music Tail: {soundTail.toFixed(1)}s
                </Typography>
                <Slider
                  value={soundTail}
                  min={0}
                  max={5}
                  step={0.5}
                  onChange={(_, v) => setSoundTail(v as number)}
                  size="small"
                />
              </Box>
            </Collapse>
          </Paper>

          {/* Build Button */}
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleBuild}
            disabled={buildMutation.isPending || totalChars === 0}
            sx={{
              mb: 3,
              py: 2,
              fontSize: '1.1rem',
              fontWeight: 700,
              borderRadius: 3,
              background: 'linear-gradient(135deg, #1976d2 0%, #9c27b0 100%)',
              '&:hover': {
                background: 'linear-gradient(135deg, #1565c0 0%, #7b1fa2 100%)',
              },
            }}
          >
            {buildMutation.isPending ? (
              <>
                <CircularProgress size={24} color="inherit" sx={{ mr: 1 }} />
                Building Ad...
              </>
            ) : (
              'Build Audio Ad'
            )}
          </Button>

          {/* Progress */}
          {buildMutation.isPending && (
            <Paper elevation={3} sx={{ p: 3, mb: 3, borderRadius: 3 }}>
              <Typography variant="body2" fontWeight="600" gutterBottom>
                Processing...
              </Typography>
              <LinearProgress sx={{ borderRadius: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Generating voice, assembling elastic music bed, mixing and mastering...
              </Typography>
            </Paper>
          )}

          {/* Output */}
          {buildResult && (
            <Paper
              elevation={3}
              sx={{
                p: 3,
                borderRadius: 3,
                borderLeft: '4px solid',
                borderColor:
                  buildResult.status === 'completed' ? 'success.main' : 'error.main',
              }}
            >
              <Typography variant="h6" fontWeight="600" gutterBottom>
                {buildResult.status === 'completed' ? 'Ad Ready!' : 'Build Failed'}
              </Typography>

              {buildResult.status === 'completed' && buildResult.outputs?.[0] && (
                <>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <Button
                      variant="contained"
                      startIcon={isPlaying ? <Pause /> : <PlayArrow />}
                      onClick={handlePlay}
                    >
                      {isPlaying ? 'Pause' : 'Play'}
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<Download />}
                      onClick={handleDownload}
                    >
                      Download
                    </Button>
                  </Box>

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Chip
                      label={`${buildResult.outputs[0].duration?.toFixed(1)}s`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      label={outputFormat.toUpperCase()}
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label={masteringPreset}
                      size="small"
                      variant="outlined"
                    />
                    {buildResult.outputs[0].fileSize && (
                      <Chip
                        label={`${(buildResult.outputs[0].fileSize / 1024).toFixed(0)} KB`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>

                  {buildResult.timing && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        Speech: {((buildResult.timing.speechMs || 0) / 1000).toFixed(1)}s
                        {' | '}Production: {((buildResult.timing.productionMs || 0) / 1000).toFixed(1)}s
                        {' | '}Total: {((buildResult.timing.totalMs || 0) / 1000).toFixed(1)}s
                      </Typography>
                    </Box>
                  )}
                </>
              )}

              {buildResult.status === 'failed' && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {buildResult.error}
                </Alert>
              )}
            </Paper>
          )}

          {/* Info */}
          <Paper elevation={1} sx={{ p: 2, mt: 3, borderRadius: 3, bgcolor: 'grey.50' }}>
            <Typography variant="body2" fontWeight="600" gutterBottom>
              How it works:
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.8 }}>
              1. Your script is converted to speech using ElevenLabs AI voice<br />
              2. The sound template auto-stretches to match your voice duration<br />
              3. Voice + music are mixed with 5-band sidechain ducking<br />
              4. Professional mastering is applied (compression, EQ, loudness)<br />
              5. Final audio is encoded in your chosen format
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdFormBuilder;
