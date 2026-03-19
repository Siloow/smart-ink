# **SMART INK**

### The 3D Tattoo Visualization Platform

**Business Plan** — March 2026

*Confidential*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Problem](#2-the-problem)
3. [The Solution](#3-the-solution)
4. [Market Analysis](#4-market-analysis)
5. [Business Model](#5-business-model)
6. [Technical Architecture](#6-technical-architecture)
7. [Go-to-Market Strategy](#7-go-to-market-strategy)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [Next Steps](#9-next-steps)

---

## 1. Executive Summary

Smart Ink is a web-based 3D tattoo visualization platform that connects tattoo artists with clients through realistic design previews, collaborative workflows, and professional-quality rendering. The platform solves three core problems in the tattoo industry: clients cannot preview how a tattoo will look on their body before committing, artists lack affordable tools to create portfolio-quality images without a photographer, and the design iteration process between artist and client is slow and fragmented.

Smart Ink provides a browser-based 3D editor where artists place tattoo designs onto realistic body meshes, adjust lighting and camera angles, and produce high-fidelity renders. Clients can view, comment on, and approve designs remotely. The platform also serves as a marketplace and community where artists showcase portfolios and sell design concepts.

### Value Proposition

**For tattoo clients:** Preview your tattoo on a realistic 3D body model from home. Collaborate with your artist on design changes, approve revisions, and walk into the studio with full confidence in the final result.

**For tattoo artists:** Create stunning portfolio images using 3D rendering instead of hiring a photographer. Manage client communication, pricing, and approvals in one place. Sell design concepts to a global audience.

### Key Metrics (Target Year 1)

| Metric | Target |
|---|---|
| Registered artists | 500 |
| Active clients | 5,000 |
| Monthly renders | 10,000 |
| Community designs listed | 2,000 |

---

## 2. The Problem

### 2.1 Client Uncertainty

Getting a tattoo is a permanent, emotionally significant decision. Clients frequently struggle to visualize how a design will look on their body. Current options are limited to flat 2D sketches, quick Photoshop mockups, or basic AR apps that overlay a flat image on skin with no depth, shading, or anatomical accuracy. This uncertainty leads to hesitation, last-minute design changes at the studio, or worse, post-tattoo regret.

### 2.2 Fragmented Artist-Client Workflow

The typical design process involves back-and-forth over Instagram DMs, WhatsApp, or email. There is no structured way to track versions, collect feedback, calculate pricing, or obtain formal approval. This wastes time for both parties and often leads to miscommunication about design intent, placement, or cost.

### 2.3 Portfolio Limitations

Tattoo artists need high-quality images to attract new clients. Currently, this means photographing finished tattoos on real skin, which depends on good lighting, a cooperative client, and often a professional photographer. Many talented artists have mediocre portfolios simply because they lack access to quality photography. There is no tool that lets them render their designs in a controlled, professional-looking environment.

---

## 3. The Solution

### 3.1 3D Tattoo Preview Editor

The core product is a browser-based 3D editor (already in prototype) built with React, Three.js, and React Three Fiber. Artists upload a tattoo design as a PNG, place it on a realistic body mesh using a decal system, and adjust position, rotation, scale, color, and opacity. Multiple lighting presets (studio, dramatic, sunset) and camera angles let the artist compose the perfect scene.

Clients receive a link to view the composed scene. They can orbit the 3D model, toggle before/after views, and leave comments directly on the design. This replaces the need for an in-person studio visit for the initial design review.

### 3.2 Realistic Rendering Pipeline

The editor exports scene data (model, decal placement, lighting, camera) which is sent to a server-side Blender instance. Using Cycles (a physically-based path tracer), the scene is rendered into a photorealistic image with accurate skin shading, subsurface scattering, and tattoo ink appearance. This gives artists a portfolio-quality image without a camera. A working demo of this pipeline already exists.

### 3.3 Artist-Client Collaboration Tools

Built into the platform (and already prototyped in the current codebase) are business workflow features:

- **Version control:** Every design revision is tracked. Artists and clients can compare versions side by side.
- **Approval workflow:** Clients can formally approve or reject a design with optional digital signature.
- **Pricing calculator:** Artists set base rates. The platform calculates estimates based on size, complexity, and rush fees.
- **Appointment scheduling:** Integrated booking system for consultations and tattoo sessions.
- **Before/after comparison:** Toggle tattoo visibility on the 3D model to show clients the exact change.
- **Comments and feedback:** Threaded comments attached to specific scenes or design elements.

### 3.4 Community and Marketplace

Smart Ink doubles as a social platform for tattoo culture:

- **Artist portfolios:** Public profile pages showcasing rendered tattoo designs, styles, and client testimonials.
- **Design marketplace:** Artists can list tattoo concepts for sale. Buyers get the design file and a license to use it.
- **Community remix:** Inspired by the Spline community model, users can share and remix 3D scenes.
- **Discover feed:** Trending designs, featured artists, and style categories (blackwork, watercolor, traditional, fine-line, etc.).

---

## 4. Market Analysis

### 4.1 Market Size

The global tattoo market was valued at approximately €2.3 billion in 2025 and is projected to grow at a CAGR of around 10% through 2034, reaching nearly €5.7 billion. The tattoo design app segment alone is estimated at €475 million in 2025, growing at 15% CAGR. Europe leads with 33% market share, making it an ideal launch region.

Key growth drivers include increasing social acceptance of tattoos across all age groups, the influence of social media (Instagram, TikTok) on tattoo culture, and growing demand for technology-assisted design tools including AR previews.

### 4.2 Competitive Landscape

| Competitor | Approach | Smart Ink Advantage |
|---|---|---|
| InkHunter | AR overlay on phone camera (2D flat decal) | Full 3D body model with accurate placement, depth, and shading |
| TattoosAI | AI-generated 2D tattoo designs | 3D visualization on body mesh, not just design generation |
| Tattoodo | Social platform and artist directory | Smart Ink adds 3D preview and collaboration workflow on top of community |
| Procreate / Photoshop | Manual 2D mockup by artist | Automated 3D placement with consistent quality, no design skills needed |
| Inkbox Trace | Temporary tattoo stencils | Digital-only preview, no physical product needed |

Smart Ink's core differentiation is the combination of 3D visualization on realistic body meshes, a Blender-based photorealistic rendering pipeline, integrated collaboration tools, and a community marketplace. No competitor offers all four.

### 4.3 Target Audience

**Primary:** Professional tattoo artists (estimated 300,000+ in Europe) seeking portfolio tools and client management.

**Secondary:** Tattoo clients (millions annually) wanting to preview designs before committing.

**Tertiary:** Tattoo studios and chains looking for a white-label solution to modernize their client experience.

---

## 5. Business Model

### 5.1 Revenue Streams

| Stream | Model |
|---|---|
| Artist subscriptions | Free tier (3 scenes, watermarked renders) / Pro €19/mo / Studio €49/mo |
| Render credits | Pay-per-render for Blender/Cycles high-quality output (€1–2 each) |
| Marketplace commission | 15% fee on design sales |
| Client booking fees | Small fee (€2) per confirmed appointment via platform |
| Enterprise / White-label | Custom pricing for studio chains |

### 5.2 Pricing Tiers

| Feature | Free | Pro (€19/mo) | Studio (€49/mo) |
|---|---|---|---|
| Scenes | 3 | Unlimited | Unlimited |
| 3D editor access | Full | Full | Full |
| Browser renders | Watermarked | Unwatermarked | Unwatermarked |
| Blender/Cycles renders | — | 10/month included | 50/month included |
| Client sharing links | 1 active | Unlimited | Unlimited |
| Collaboration tools | Basic | Full | Full + team |
| Marketplace listings | — | 5 | Unlimited |
| Portfolio page | Basic | Customizable | Branded |
| Priority support | — | — | ✓ |

---

## 6. Technical Architecture

### 6.1 Frontend (Current Prototype)

The existing prototype is built with React 19, Vite 7, TypeScript, and React Three Fiber with Three.js for 3D rendering. The app already includes a functional 3D editor with decal placement, multiple body meshes, cinematic lighting presets, camera controls, and an export pipeline. Business tools (versioning, pricing calculator, appointments, approval workflows) are prototyped with localStorage persistence.

### 6.2 Rendering Pipeline

1. **Browser render:** Quick preview using Three.js WebGL renderer. Available on all tiers.
2. **Scene export:** The editor serializes scene data (mesh, decal UV coords, lighting, camera) to JSON.
3. **Server-side Blender:** A Python script loads the JSON, reconstructs the scene in Blender with Cycles materials (PBR skin shader, tattoo ink material), and renders at high resolution. A working demo of this pipeline already exists.
4. **Delivery:** Final image returned to the client via the platform or downloadable as PNG/JPEG.

### 6.3 Backend (To Build)

The production backend requires user authentication, a database for scenes and user data (replacing localStorage), file storage for uploads and renders, a job queue for Blender rendering, and API endpoints for the frontend. A practical stack would be Node.js or Python (FastAPI), PostgreSQL, S3-compatible storage, and a GPU-equipped render server.

---

## 7. Go-to-Market Strategy

### 7.1 Phase 1: Launch (Months 1–3)

- Launch with the 3D editor, browser-based rendering, and Blender/Cycles rendering pipeline (free tier).
- Target 20–50 tattoo artists in the Netherlands and Germany for beta testing.
- Build initial content: showcase 100+ community designs.
- Collect feedback on workflow, pain points, and missing features.

### 7.2 Phase 2: Growth (Months 4–8)

- Launch Pro subscription tier.
- Open the design marketplace for artist-to-artist and artist-to-client sales.
- Instagram and TikTok marketing: before/after 3D renders are highly shareable content.
- Partner with 5–10 established tattoo studios for co-marketing.

### 7.3 Phase 3: Scale (Months 9–12)

- Launch Studio tier with team features and white-label options.
- Expand to UK, France, Spain, and Nordic markets.
- Explore partnerships with tattoo conventions and industry events.

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Artists don't adopt new tools | High | Start free, focus on immediate value (portfolio renders). Minimize learning curve with Spline-like UX. |
| Blender rendering costs scale poorly | Medium | Optimize Cycles scenes for speed. Use spot GPU instances. Offer browser-only renders as fallback. |
| Competitors add 3D features | Medium | Moat is the full workflow (editor + render + collaboration + marketplace). Hard to replicate all four. |
| 3D body models feel uncanny | Medium | Invest in high-quality meshes and skin shaders. Iterate based on artist feedback. |
| Marketplace fails to generate supply | Low-Medium | Seed with 100+ designs. Run contests. Feature top artists prominently. |

---

## 9. Next Steps

### 9.1 Immediate Priorities (Next 30 Days)

1. Finalize the Spline-inspired UI redesign using the existing Cursor merge instructions.
2. Replace localStorage with a proper database (Supabase or PostgreSQL).
3. Set up user authentication (email + Google OAuth).
4. Recruit 5 beta-testing tattoo artists.

### 9.2 Key Milestones

| Milestone | Timeline |
|---|---|
| Proof of concept complete (current UI + Blender render) | April 2026 |
| Beta launch with 20 artists | June 2026 |
| Marketplace and community features live | August 2026 |
| Public launch with Pro tier | October 2026 |
| 500 registered artists | March 2027 |

---

*Smart Ink — Where ink meets imagination.*
