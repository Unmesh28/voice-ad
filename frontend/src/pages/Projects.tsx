import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Card,
  CardContent,
  CardActions,
  Chip,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import { Add, MoreVert, Edit, Archive, Delete, Folder } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import projectService from '../services/project.service';
import { useNavigate } from 'react-router-dom';

const Projects = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });

  // Fetch projects
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getProjects(),
  });

  // Create project mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => projectService.createProject(data),
    onSuccess: () => {
      toast.success('Project created successfully!');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreateDialogOpen(false);
      setFormData({ name: '', description: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create project');
    },
  });

  // Update project mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof formData> }) =>
      projectService.updateProject(id, data),
    onSuccess: () => {
      toast.success('Project updated successfully!');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditDialogOpen(false);
      setSelectedProject(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update project');
    },
  });

  // Delete project mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectService.deleteProject(id),
    onSuccess: () => {
      toast.success('Project deleted successfully!');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setMenuAnchor(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete project');
    },
  });

  // Archive project mutation
  const archiveMutation = useMutation({
    mutationFn: (id: string) => projectService.archiveProject(id),
    onSuccess: () => {
      toast.success('Project archived successfully!');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setMenuAnchor(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to archive project');
    },
  });

  const handleCreateProject = () => {
    if (!formData.name.trim()) {
      toast.error('Project name is required');
      return;
    }
    createMutation.mutate(formData);
  };

  const handleUpdateProject = () => {
    if (!formData.name.trim()) {
      toast.error('Project name is required');
      return;
    }
    updateMutation.mutate({
      id: selectedProject.id,
      data: formData,
    });
  };

  const handleOpenEdit = (project: any) => {
    setSelectedProject(project);
    setFormData({
      name: project.name,
      description: project.description || '',
    });
    setEditDialogOpen(true);
    setMenuAnchor(null);
  };

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>, project: any) => {
    setMenuAnchor(event.currentTarget);
    setSelectedProject(project);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setSelectedProject(null);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Projects
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Organize your audio productions into projects
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          New Project
        </Button>
      </Box>

      {isLoading ? (
        <Typography>Loading projects...</Typography>
      ) : projects && projects.length > 0 ? (
        <Grid container spacing={3}>
          {projects.map((project: any) => (
            <Grid item xs={12} sm={6} md={4} key={project.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Folder sx={{ mr: 1, color: 'primary.main' }} />
                      <Typography variant="h6">{project.name}</Typography>
                    </Box>
                    <IconButton size="small" onClick={(e) => handleMenuClick(e, project)}>
                      <MoreVert />
                    </IconButton>
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                    {project.description || 'No description'}
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                    <Chip
                      label={`${project._count?.scripts || 0} scripts`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      label={`${project._count?.productions || 0} productions`}
                      size="small"
                      color="secondary"
                      variant="outlined"
                    />
                  </Box>

                  <Chip
                    label={project.status}
                    size="small"
                    color={project.status === 'ACTIVE' ? 'success' : 'default'}
                  />
                </CardContent>
                <CardActions>
                  <Button
                    size="small"
                    onClick={() => navigate(`/script-generator?projectId=${project.id}`)}
                  >
                    Generate Script
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            No projects yet
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            Create your first project to get started with audio production
          </Typography>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setCreateDialogOpen(true)}
          >
            Create Project
          </Button>
        </Paper>
      )}

      {/* Create Project Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Project Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            margin="normal"
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateProject} variant="contained" disabled={createMutation.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Project</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Project Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            margin="normal"
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateProject} variant="contained" disabled={updateMutation.isPending}>
            Update
          </Button>
        </DialogActions>
      </Dialog>

      {/* Context Menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
        <MenuItem onClick={() => handleOpenEdit(selectedProject)}>
          <Edit sx={{ mr: 1 }} fontSize="small" />
          Edit
        </MenuItem>
        <MenuItem onClick={() => archiveMutation.mutate(selectedProject?.id)}>
          <Archive sx={{ mr: 1 }} fontSize="small" />
          Archive
        </MenuItem>
        <MenuItem onClick={() => {
          if (window.confirm('Are you sure you want to delete this project?')) {
            deleteMutation.mutate(selectedProject?.id);
          }
        }}>
          <Delete sx={{ mr: 1 }} fontSize="small" color="error" />
          <Typography color="error">Delete</Typography>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default Projects;
