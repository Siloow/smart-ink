export interface SceneData {
  id: string;
  name: string;
  model: 'Monk' | 'FinalBaseMesh';
  decalImage: string | null;
  decalRotation: number;
  decalScale: number;
  decalColor: string; // Hex color for tinting
  decalOpacity: number; // 0-1 opacity value
  decalVisible: boolean; // Whether the decal is visible
  decalPosition: [number, number, number] | null;
  decalNormal: [number, number, number] | null;
  lightingPreset: string;
  background: string;
  thumbnail: string | null;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  // Business tools fields
  version?: number;
  parentVersionId?: string; // For version branching
  collaborators?: string[];
  status?: 'draft' | 'in_review' | 'approved' | 'rejected';
  clientApproval?: {
    requested: boolean;
    requestedAt?: Date;
    approvedAt?: Date;
    approvedBy?: string;
    signature?: string;
    comments?: string;
  };
  tags?: string[];
  referenceImages?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  // New features
  pricing?: PricingEstimate;
  progressStates?: ProgressState[];
  beforeAfterComparison?: BeforeAfterComparison;
  appointmentId?: string;
}

// Version control system
export interface VersionHistory {
  id: string;
  sceneId: string;
  version: number;
  sceneData: SceneData;
  createdAt: Date;
  createdBy: string;
  description: string;
  changes: string[];
}

// Collaboration system
export interface Comment {
  id: string;
  sceneId: string;
  userId: string;
  userName: string;
  content: string;
  position?: [number, number, number]; // 3D position for annotations
  createdAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

// Reference library
export interface ReferenceImage {
  id: string;
  name: string;
  url: string;
  tags: string[];
  category: string;
  uploadedBy: string;
  uploadedAt: Date;
  projects: string[]; // Associated project IDs
}

// Approval workflow
export interface ApprovalRequest {
  id: string;
  sceneId: string;
  requestedBy: string;
  requestedAt: Date;
  clientEmail: string;
  clientName: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedAt?: Date;
  approvedBy?: string;
  signature?: string;
  comments?: string;
}

// User management
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'designer' | 'client' | 'viewer';
  avatar?: string;
  createdAt: Date;
}

// Project management
export interface Project {
  id: string;
  name: string;
  description: string;
  clientId: string;
  status: 'active' | 'completed' | 'on_hold';
  scenes: string[]; // Scene IDs
  team: string[]; // User IDs
  createdAt: Date;
  updatedAt: Date;
}

// Pricing Calculator
export interface PricingEstimate {
  id: string;
  sceneId: string;
  basePrice: number;
  sizeMultiplier: number;
  complexityMultiplier: number;
  timeEstimate: number; // in hours
  rushFee: number;
  totalPrice: number;
  breakdown: {
    size: { factor: string; price: number };
    complexity: { factor: string; price: number };
    time: { hours: number; rate: number; price: number };
    rush: { factor: string; price: number };
  };
  createdAt: Date;
  createdBy: string;
}

export interface PricingFactors {
  size: {
    small: { label: string; multiplier: number; description: string };
    medium: { label: string; multiplier: number; description: string };
    large: { label: string; multiplier: number; description: string };
  };
  complexity: {
    simple: { label: string; multiplier: number; description: string };
    moderate: { label: string; multiplier: number; description: string };
    complex: { label: string; multiplier: number; description: string };
  };
  rushOptions: {
    standard: { label: string; multiplier: number; days: number };
    rush: { label: string; multiplier: number; days: number };
    emergency: { label: string; multiplier: number; days: number };
  };
}

// Progress Documentation
export interface ProgressState {
  id: string;
  sceneId: string;
  name: string;
  description: string;
  sceneData: SceneData;
  thumbnail: string;
  createdAt: Date;
  createdBy: string;
  tags: string[];
  notes: string;
  isMilestone: boolean;
}

// Before/After Comparison
export interface BeforeAfterComparison {
  id: string;
  sceneId: string;
  beforeImage: string;
  afterImage: string;
  beforeSceneData: SceneData;
  afterSceneData: SceneData;
  createdAt: Date;
  createdBy: string;
  description: string;
  clientFeedback?: string;
  isPublic: boolean;
}

// Appointment Scheduler
export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  date: Date;
  duration: number; // in minutes
  type: 'consultation' | 'design_review' | 'final_approval' | 'touch_up';
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
  notes: string;
  sceneIds: string[]; // Related scenes
  location: 'studio' | 'video_call' | 'phone';
  meetingLink?: string;
  createdAt: Date;
  createdBy: string;
}

export interface TimeSlot {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  appointmentId?: string;
}

export interface StudioSchedule {
  id: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  openTime: string;
  closeTime: string;
  isAvailable: boolean;
  breakStart?: string;
  breakEnd?: string;
} 