import type { 
  VersionHistory, 
  Comment, 
  ReferenceImage, 
  ApprovalRequest, 
  User, 
  Project,
  SceneData 
} from './types';

// Local storage keys
const STORAGE_KEYS = {
  VERSIONS: 'smart_ink_versions',
  COMMENTS: 'smart_ink_comments',
  REFERENCES: 'smart_ink_references',
  APPROVALS: 'smart_ink_approvals',
  USERS: 'smart_ink_users',
  PROJECTS: 'smart_ink_projects',
  CURRENT_USER: 'smart_ink_current_user',
  // New features
  PRICING: 'smart_ink_pricing',
  PROGRESS: 'smart_ink_progress',
  COMPARISONS: 'smart_ink_comparisons',
  APPOINTMENTS: 'smart_ink_appointments',
  TIMESLOTS: 'smart_ink_timeslots',
  SCHEDULE: 'smart_ink_schedule'
};

// Helper functions
const getStorage = (key: string) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    console.error(`Error reading from localStorage (${key}):`, error);
    return null;
  }
};

const setStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(`Error writing to localStorage (${key}):`, error);
    return false;
  }
};

// Version Control System
export const versionStorage = {
  // Save a new version
  saveVersion: (version: VersionHistory): boolean => {
    const versions = getStorage(STORAGE_KEYS.VERSIONS) || [];
    versions.push(version);
    return setStorage(STORAGE_KEYS.VERSIONS, versions);
  },

  // Get all versions for a scene
  getVersions: (sceneId: string): VersionHistory[] => {
    const versions = getStorage(STORAGE_KEYS.VERSIONS) || [];
    return versions.filter(v => v.sceneId === sceneId).sort((a, b) => b.version - a.version);
  },

  // Get specific version
  getVersion: (sceneId: string, version: number): VersionHistory | null => {
    const versions = getStorage(STORAGE_KEYS.VERSIONS) || [];
    return versions.find(v => v.sceneId === sceneId && v.version === version) || null;
  },

  // Get latest version number for a scene
  getLatestVersionNumber: (sceneId: string): number => {
    const versions = getStorage(STORAGE_KEYS.VERSIONS) || [];
    const sceneVersions = versions.filter(v => v.sceneId === sceneId);
    return sceneVersions.length > 0 ? Math.max(...sceneVersions.map(v => v.version)) : 0;
  },

  // Compare two versions
  compareVersions: (sceneId: string, version1: number, version2: number): any => {
    const v1 = versionStorage.getVersion(sceneId, version1);
    const v2 = versionStorage.getVersion(sceneId, version2);
    
    if (!v1 || !v2) return null;

    const changes: any = {};
    const scene1 = v1.sceneData;
    const scene2 = v2.sceneData;

    // Compare key properties
    if (scene1.decalRotation !== scene2.decalRotation) changes.decalRotation = { from: scene1.decalRotation, to: scene2.decalRotation };
    if (scene1.decalScale !== scene2.decalScale) changes.decalScale = { from: scene1.decalScale, to: scene2.decalScale };
    if (scene1.decalColor !== scene2.decalColor) changes.decalColor = { from: scene1.decalColor, to: scene2.decalColor };
    if (scene1.decalOpacity !== scene2.decalOpacity) changes.decalOpacity = { from: scene1.decalOpacity, to: scene2.decalOpacity };
    if (scene1.lightingPreset !== scene2.lightingPreset) changes.lightingPreset = { from: scene1.lightingPreset, to: scene2.lightingPreset };
    if (scene1.background !== scene2.background) changes.background = { from: scene1.background, to: scene2.background };
    if (scene1.decalImage !== scene2.decalImage) changes.decalImage = { changed: true };

    return changes;
  }
};

// Collaboration System
export const commentStorage = {
  // Add a new comment
  addComment: (comment: Comment): boolean => {
    const comments = getStorage(STORAGE_KEYS.COMMENTS) || [];
    comments.push(comment);
    return setStorage(STORAGE_KEYS.COMMENTS, comments);
  },

  // Get all comments for a scene
  getComments: (sceneId: string): Comment[] => {
    const comments = getStorage(STORAGE_KEYS.COMMENTS) || [];
    return comments.filter(c => c.sceneId === sceneId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  // Resolve a comment
  resolveComment: (commentId: string, resolvedBy: string): boolean => {
    const comments = getStorage(STORAGE_KEYS.COMMENTS) || [];
    const commentIndex = comments.findIndex(c => c.id === commentId);
    
    if (commentIndex !== -1) {
      comments[commentIndex].resolved = true;
      comments[commentIndex].resolvedAt = new Date().toISOString();
      comments[commentIndex].resolvedBy = resolvedBy;
      return setStorage(STORAGE_KEYS.COMMENTS, comments);
    }
    return false;
  },

  // Delete a comment
  deleteComment: (commentId: string): boolean => {
    const comments = getStorage(STORAGE_KEYS.COMMENTS) || [];
    const filteredComments = comments.filter(c => c.id !== commentId);
    return setStorage(STORAGE_KEYS.COMMENTS, filteredComments);
  }
};

// Reference Library System
export const referenceStorage = {
  // Add a reference image
  addReference: (reference: ReferenceImage): boolean => {
    const references = getStorage(STORAGE_KEYS.REFERENCES) || [];
    references.push(reference);
    return setStorage(STORAGE_KEYS.REFERENCES, references);
  },

  // Get all references
  getReferences: (): ReferenceImage[] => {
    return getStorage(STORAGE_KEYS.REFERENCES) || [];
  },

  // Search references by tags
  searchReferences: (query: string, tags?: string[]): ReferenceImage[] => {
    const references = getStorage(STORAGE_KEYS.REFERENCES) || [];
    
    return references.filter(ref => {
      const matchesQuery = query ? 
        ref.name.toLowerCase().includes(query.toLowerCase()) ||
        ref.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase())) : true;
      
      const matchesTags = tags && tags.length > 0 ?
        tags.some(tag => ref.tags.includes(tag)) : true;
      
      return matchesQuery && matchesTags;
    });
  },

  // Get references by category
  getReferencesByCategory: (category: string): ReferenceImage[] => {
    const references = getStorage(STORAGE_KEYS.REFERENCES) || [];
    return references.filter(ref => ref.category === category);
  },

  // Delete a reference
  deleteReference: (referenceId: string): boolean => {
    const references = getStorage(STORAGE_KEYS.REFERENCES) || [];
    const filteredReferences = references.filter(ref => ref.id !== referenceId);
    return setStorage(STORAGE_KEYS.REFERENCES, filteredReferences);
  },

  // Get all unique tags
  getAllTags: (): string[] => {
    const references = getStorage(STORAGE_KEYS.REFERENCES) || [];
    const allTags = references.flatMap(ref => ref.tags);
    return [...new Set(allTags)].sort();
  },

  // Get all categories
  getAllCategories: (): string[] => {
    const references = getStorage(STORAGE_KEYS.REFERENCES) || [];
    const categories = references.map(ref => ref.category);
    return [...new Set(categories)].sort();
  }
};

// Approval Workflow System
export const approvalStorage = {
  // Create approval request
  createApprovalRequest: (request: ApprovalRequest): boolean => {
    const approvals = getStorage(STORAGE_KEYS.APPROVALS) || [];
    approvals.push(request);
    return setStorage(STORAGE_KEYS.APPROVALS, approvals);
  },

  // Get approval requests for a scene
  getApprovalRequests: (sceneId: string): ApprovalRequest[] => {
    const approvals = getStorage(STORAGE_KEYS.APPROVALS) || [];
    return approvals.filter(a => a.sceneId === sceneId).sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  },

  // Update approval status
  updateApprovalStatus: (requestId: string, status: 'approved' | 'rejected', approvedBy: string, signature?: string, comments?: string): boolean => {
    const approvals = getStorage(STORAGE_KEYS.APPROVALS) || [];
    const approvalIndex = approvals.findIndex(a => a.id === requestId);
    
    if (approvalIndex !== -1) {
      approvals[approvalIndex].status = status;
      approvals[approvalIndex].approvedAt = new Date().toISOString();
      approvals[approvalIndex].approvedBy = approvedBy;
      if (signature) approvals[approvalIndex].signature = signature;
      if (comments) approvals[approvalIndex].comments = comments;
      return setStorage(STORAGE_KEYS.APPROVALS, approvals);
    }
    return false;
  },

  // Get pending approvals
  getPendingApprovals: (): ApprovalRequest[] => {
    const approvals = getStorage(STORAGE_KEYS.APPROVALS) || [];
    return approvals.filter(a => a.status === 'pending').sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());
  }
};

// User Management System
export const userStorage = {
  // Add a new user
  addUser: (user: User): boolean => {
    const users = getStorage(STORAGE_KEYS.USERS) || [];
    users.push(user);
    return setStorage(STORAGE_KEYS.USERS, users);
  },

  // Get all users
  getUsers: (): User[] => {
    return getStorage(STORAGE_KEYS.USERS) || [];
  },

  // Get user by ID
  getUser: (userId: string): User | null => {
    const users = getStorage(STORAGE_KEYS.USERS) || [];
    return users.find(u => u.id === userId) || null;
  },

  // Update user
  updateUser: (user: User): boolean => {
    const users = getStorage(STORAGE_KEYS.USERS) || [];
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (userIndex !== -1) {
      users[userIndex] = user;
      return setStorage(STORAGE_KEYS.USERS, users);
    }
    return false;
  },

  // Set current user
  setCurrentUser: (user: User): boolean => {
    return setStorage(STORAGE_KEYS.CURRENT_USER, user);
  },

  // Get current user
  getCurrentUser: (): User | null => {
    return getStorage(STORAGE_KEYS.CURRENT_USER);
  }
};

// Project Management System
export const projectStorage = {
  // Add a new project
  addProject: (project: Project): boolean => {
    const projects = getStorage(STORAGE_KEYS.PROJECTS) || [];
    projects.push(project);
    return setStorage(STORAGE_KEYS.PROJECTS, projects);
  },

  // Get all projects
  getProjects: (): Project[] => {
    return getStorage(STORAGE_KEYS.PROJECTS) || [];
  },

  // Get project by ID
  getProject: (projectId: string): Project | null => {
    const projects = getStorage(STORAGE_KEYS.PROJECTS) || [];
    return projects.find(p => p.id === projectId) || null;
  },

  // Update project
  updateProject: (project: Project): boolean => {
    const projects = getStorage(STORAGE_KEYS.PROJECTS) || [];
    const projectIndex = projects.findIndex(p => p.id === project.id);
    
    if (projectIndex !== -1) {
      projects[projectIndex] = project;
      return setStorage(STORAGE_KEYS.PROJECTS, projects);
    }
    return false;
  },

  // Add scene to project
  addSceneToProject: (projectId: string, sceneId: string): boolean => {
    const projects = getStorage(STORAGE_KEYS.PROJECTS) || [];
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex !== -1) {
      if (!projects[projectIndex].scenes.includes(sceneId)) {
        projects[projectIndex].scenes.push(sceneId);
        projects[projectIndex].updatedAt = new Date().toISOString();
        return setStorage(STORAGE_KEYS.PROJECTS, projects);
      }
    }
    return false;
  },

  // Remove scene from project
  removeSceneFromProject: (projectId: string, sceneId: string): boolean => {
    const projects = getStorage(STORAGE_KEYS.PROJECTS) || [];
    const projectIndex = projects.findIndex(p => p.id === projectId);
    
    if (projectIndex !== -1) {
      projects[projectIndex].scenes = projects[projectIndex].scenes.filter(id => id !== sceneId);
      projects[projectIndex].updatedAt = new Date().toISOString();
      return setStorage(STORAGE_KEYS.PROJECTS, projects);
    }
    return false;
  }
};

// Initialize default data
export const initializeBusinessTools = () => {
  // Create default admin user if no users exist
  const users = userStorage.getUsers();
  if (users.length === 0) {
    const defaultUser: User = {
      id: 'admin-1',
      name: 'Admin User',
      email: 'admin@smartinkstudio.com',
      role: 'admin',
      createdAt: new Date().toISOString()
    };
    userStorage.addUser(defaultUser);
    userStorage.setCurrentUser(defaultUser);
  }

  // Create default project if no projects exist
  const projects = projectStorage.getProjects();
  if (projects.length === 0) {
    const defaultProject: Project = {
      id: 'project-1',
      name: 'Default Project',
      description: 'Your first project in Smart Ink Studio',
      clientId: 'client-1',
      status: 'active',
      scenes: [],
      team: ['admin-1'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    projectStorage.addProject(defaultProject);
  }
};

// Pricing Calculator System
export const pricingStorage = {
  // Save pricing estimate
  saveEstimate: (estimate: PricingEstimate): boolean => {
    const estimates = getStorage(STORAGE_KEYS.PRICING) || [];
    estimates.push(estimate);
    return setStorage(STORAGE_KEYS.PRICING, estimates);
  },

  // Get estimates for a scene
  getEstimates: (sceneId: string): PricingEstimate[] => {
    const estimates = getStorage(STORAGE_KEYS.PRICING) || [];
    return estimates.filter(e => e.sceneId === sceneId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  // Get latest estimate for a scene
  getLatestEstimate: (sceneId: string): PricingEstimate | null => {
    const estimates = pricingStorage.getEstimates(sceneId);
    return estimates.length > 0 ? estimates[0] : null;
  },

  // Calculate pricing based on factors
  calculatePrice: (basePrice: number, size: string, complexity: string, timeEstimate: number, rushOption: string): PricingEstimate => {
    const factors: PricingFactors = {
      size: {
        small: { label: 'Small', multiplier: 1.0, description: 'Simple design, minimal detail' },
        medium: { label: 'Medium', multiplier: 1.5, description: 'Moderate complexity, good detail' },
        large: { label: 'Large', multiplier: 2.0, description: 'Complex design, high detail' }
      },
      complexity: {
        simple: { label: 'Simple', multiplier: 1.0, description: 'Basic shapes and patterns' },
        moderate: { label: 'Moderate', multiplier: 1.3, description: 'Mixed complexity elements' },
        complex: { label: 'Complex', multiplier: 1.8, description: 'Intricate details and shading' }
      },
      rushOptions: {
        standard: { label: 'Standard', multiplier: 1.0, days: 7 },
        rush: { label: 'Rush', multiplier: 1.25, days: 3 },
        emergency: { label: 'Emergency', multiplier: 1.5, days: 1 }
      }
    };

    const sizeMultiplier = factors.size[size as keyof typeof factors.size]?.multiplier || 1.0;
    const complexityMultiplier = factors.complexity[complexity as keyof typeof factors.complexity]?.multiplier || 1.0;
    const rushMultiplier = factors.rushOptions[rushOption as keyof typeof factors.rushOptions]?.multiplier || 1.0;

    const sizePrice = basePrice * (sizeMultiplier - 1);
    const complexityPrice = basePrice * (complexityMultiplier - 1);
    const timePrice = timeEstimate * 75; // $75/hour rate
    const rushFee = (basePrice + sizePrice + complexityPrice + timePrice) * (rushMultiplier - 1);

    const totalPrice = basePrice + sizePrice + complexityPrice + timePrice + rushFee;

    return {
      id: `pricing-${Date.now()}`,
      sceneId: '',
      basePrice,
      sizeMultiplier,
      complexityMultiplier,
      timeEstimate,
      rushFee,
      totalPrice,
      breakdown: {
        size: { factor: factors.size[size as keyof typeof factors.size]?.label || 'Unknown', price: sizePrice },
        complexity: { factor: factors.complexity[complexity as keyof typeof factors.complexity]?.label || 'Unknown', price: complexityPrice },
        time: { hours: timeEstimate, rate: 75, price: timePrice },
        rush: { factor: factors.rushOptions[rushOption as keyof typeof factors.rushOptions]?.label || 'Standard', price: rushFee }
      },
      createdAt: new Date(),
      createdBy: 'admin-1'
    };
  }
};

// Progress Documentation System
export const progressStorage = {
  // Save progress state
  saveProgressState: (state: ProgressState): boolean => {
    const states = getStorage(STORAGE_KEYS.PROGRESS) || [];
    states.push(state);
    return setStorage(STORAGE_KEYS.PROGRESS, states);
  },

  // Get progress states for a scene
  getProgressStates: (sceneId: string): ProgressState[] => {
    const states = getStorage(STORAGE_KEYS.PROGRESS) || [];
    return states.filter(s => s.sceneId === sceneId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  // Get milestone states
  getMilestones: (sceneId: string): ProgressState[] => {
    const states = progressStorage.getProgressStates(sceneId);
    return states.filter(s => s.isMilestone);
  },

  // Delete progress state
  deleteProgressState: (stateId: string): boolean => {
    const states = getStorage(STORAGE_KEYS.PROGRESS) || [];
    const filteredStates = states.filter(s => s.id !== stateId);
    return setStorage(STORAGE_KEYS.PROGRESS, filteredStates);
  }
};

// Before/After Comparison System
export const comparisonStorage = {
  // Save comparison
  saveComparison: (comparison: BeforeAfterComparison): boolean => {
    const comparisons = getStorage(STORAGE_KEYS.COMPARISONS) || [];
    comparisons.push(comparison);
    return setStorage(STORAGE_KEYS.COMPARISONS, comparisons);
  },

  // Get comparisons for a scene
  getComparisons: (sceneId: string): BeforeAfterComparison[] => {
    const comparisons = getStorage(STORAGE_KEYS.COMPARISONS) || [];
    return comparisons.filter(c => c.sceneId === sceneId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  // Get public comparisons
  getPublicComparisons: (): BeforeAfterComparison[] => {
    const comparisons = getStorage(STORAGE_KEYS.COMPARISONS) || [];
    return comparisons.filter(c => c.isPublic).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  // Delete comparison
  deleteComparison: (comparisonId: string): boolean => {
    const comparisons = getStorage(STORAGE_KEYS.COMPARISONS) || [];
    const filteredComparisons = comparisons.filter(c => c.id !== comparisonId);
    return setStorage(STORAGE_KEYS.COMPARISONS, filteredComparisons);
  }
};

// Appointment Scheduler System
export const appointmentStorage = {
  // Save appointment
  saveAppointment: (appointment: Appointment): boolean => {
    const appointments = getStorage(STORAGE_KEYS.APPOINTMENTS) || [];
    appointments.push(appointment);
    return setStorage(STORAGE_KEYS.APPOINTMENTS, appointments);
  },

  // Get all appointments
  getAppointments: (): Appointment[] => {
    return getStorage(STORAGE_KEYS.APPOINTMENTS) || [];
  },

  // Get appointments for a client
  getClientAppointments: (clientId: string): Appointment[] => {
    const appointments = appointmentStorage.getAppointments();
    return appointments.filter(a => a.clientId === clientId).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  },

  // Get appointments for a date range
  getAppointmentsByDateRange: (startDate: Date, endDate: Date): Appointment[] => {
    const appointments = appointmentStorage.getAppointments();
    return appointments.filter(a => {
      const appointmentDate = new Date(a.date);
      return appointmentDate >= startDate && appointmentDate <= endDate;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  },

  // Update appointment status
  updateAppointmentStatus: (appointmentId: string, status: Appointment['status']): boolean => {
    const appointments = getStorage(STORAGE_KEYS.APPOINTMENTS) || [];
    const appointmentIndex = appointments.findIndex(a => a.id === appointmentId);
    
    if (appointmentIndex !== -1) {
      appointments[appointmentIndex].status = status;
      return setStorage(STORAGE_KEYS.APPOINTMENTS, appointments);
    }
    return false;
  },

  // Delete appointment
  deleteAppointment: (appointmentId: string): boolean => {
    const appointments = getStorage(STORAGE_KEYS.APPOINTMENTS) || [];
    const filteredAppointments = appointments.filter(a => a.id !== appointmentId);
    return setStorage(STORAGE_KEYS.APPOINTMENTS, filteredAppointments);
  }
};

// Time Slot Management
export const timeSlotStorage = {
  // Save time slot
  saveTimeSlot: (timeSlot: TimeSlot): boolean => {
    const timeSlots = getStorage(STORAGE_KEYS.TIMESLOTS) || [];
    timeSlots.push(timeSlot);
    return setStorage(STORAGE_KEYS.TIMESLOTS, timeSlots);
  },

  // Get available time slots for a date
  getAvailableTimeSlots: (date: Date): TimeSlot[] => {
    const timeSlots = getStorage(STORAGE_KEYS.TIMESLOTS) || [];
    const targetDate = date.toDateString();
    return timeSlots.filter(ts => {
      const slotDate = new Date(ts.date).toDateString();
      return slotDate === targetDate && ts.isAvailable;
    }).sort((a, b) => a.startTime.localeCompare(b.startTime));
  },

  // Generate time slots for a date
  generateTimeSlots: (date: Date, startTime: string, endTime: string, duration: number = 60): TimeSlot[] => {
    const timeSlots: TimeSlot[] = [];
    const start = new Date(date);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    start.setHours(startHour, startMinute, 0, 0);
    const end = new Date(date);
    end.setHours(endHour, endMinute, 0, 0);

    while (start < end) {
      const slotEnd = new Date(start.getTime() + duration * 60000);
      if (slotEnd <= end) {
        timeSlots.push({
          id: `slot-${Date.now()}-${Math.random()}`,
          date: new Date(start),
          startTime: start.toTimeString().slice(0, 5),
          endTime: slotEnd.toTimeString().slice(0, 5),
          isAvailable: true
        });
      }
      start.setTime(start.getTime() + duration * 60000);
    }

    return timeSlots;
  }
}; 