import { useState, useRef, useEffect } from 'react';
import {
  Box,
  IconButton,
  Slider,
  Typography,
  Paper,
} from '@mui/material';
import {
  PlayArrow,
  Pause,
  VolumeUp,
  VolumeOff,
  Download,
} from '@mui/icons-material';

interface AudioPlayerProps {
  audioUrl: string;
  title?: string;
  showDownload?: boolean;
}

const AudioPlayer = ({ audioUrl, title, showDownload = true }: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);
    const handleEnded = () => setPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  };

  const handleSeek = (_: Event, value: number | number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const time = value as number;
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (_: Event, value: number | number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const vol = value as number;
    audio.volume = vol;
    setVolume(vol);
    if (vol > 0) setMuted(false);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.muted = !muted;
    setMuted(!muted);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = title || 'audio.mp3';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <Paper sx={{ p: 2 }}>
      <audio ref={audioRef} src={audioUrl} />

      {title && (
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton onClick={togglePlay} color="primary" size="large">
          {playing ? <Pause /> : <PlayArrow />}
        </IconButton>

        <Typography variant="caption" sx={{ minWidth: 40 }}>
          {formatTime(currentTime)}
        </Typography>

        <Slider
          value={currentTime}
          max={duration || 100}
          onChange={handleSeek}
          sx={{ flex: 1 }}
          size="small"
        />

        <Typography variant="caption" sx={{ minWidth: 40 }}>
          {formatTime(duration)}
        </Typography>

        <IconButton onClick={toggleMute} size="small">
          {muted || volume === 0 ? <VolumeOff /> : <VolumeUp />}
        </IconButton>

        <Slider
          value={muted ? 0 : volume}
          max={1}
          step={0.01}
          onChange={handleVolumeChange}
          sx={{ width: 80 }}
          size="small"
        />

        {showDownload && (
          <IconButton onClick={handleDownload} size="small">
            <Download />
          </IconButton>
        )}
      </Box>
    </Paper>
  );
};

export default AudioPlayer;
