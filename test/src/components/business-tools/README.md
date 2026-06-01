# Business Tools Components

This directory contains the unified business tools system that combines both basic and advanced business functionality into a single, organized interface.

## Structure

```
business-tools/
├── BusinessToolsPanel.tsx      # Main panel component
├── BusinessToolsTabs.tsx       # Tab navigation component
├── tabs/                       # Individual tab components
│   ├── VersioningTab.tsx       # Version control functionality
│   ├── CollaborationTab.tsx    # Comments and feedback
│   ├── ReferencesTab.tsx       # Reference library management
│   ├── ApprovalTab.tsx         # Client approval workflow
│   ├── PricingTab.tsx          # Pricing calculator
│   ├── ProgressTab.tsx         # Progress documentation
│   ├── ComparisonTab.tsx       # Before/after comparisons
│   └── AppointmentsTab.tsx     # Appointment scheduling
└── README.md                   # This file
```

## Features

### Core Business Tools
- **Versioning**: Save and restore scene versions with descriptions
- **Collaboration**: Add comments and feedback, resolve discussions
- **References**: Upload and search reference images with tags
- **Approval**: Request and manage client approvals

### Advanced Business Tools
- **Pricing**: Calculate project pricing based on size, complexity, and time
- **Progress**: Document progress states and milestones
- **Comparison**: Create before/after 3D scene comparisons
- **Appointments**: Schedule client meetings and consultations

## Usage

The business tools are accessed through a single "Business Tools" button in the main application. The interface is organized into two groups:

1. **Core** - Essential business functionality
2. **Advanced** - Additional professional features

## Component Organization

Each tab is a separate component for better maintainability and code organization. The main panel (`BusinessToolsPanel.tsx`) handles the overall layout and tab switching, while individual tab components handle their specific functionality.

## Data Storage

All business tools data is managed through the `businessToolsStorage.ts` file, which provides a unified interface for:
- Version history
- Comments and collaboration
- Reference images
- Approval requests
- Pricing estimates
- Progress states
- Comparisons
- Appointments

## Styling

The components use consistent styling with a dark theme that matches the main application. All styling is done inline for simplicity and consistency. 