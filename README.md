# Cadence Onboarding Flow

Production-ready onboarding component for Cadence — the music release planning tool.

## 📁 Project Structure

```
cadence-map/
├── pages/
│   └── OnboardingPage.tsx          # Main onboarding component (5-screen flow)
├── lib/
│   ├── supabase.ts                 # Supabase client setup
│   └── releaseTemplates.ts         # Task templates for Single/EP/Album releases
├── hooks/
│   └── useAuth.ts                  # Authentication hook
├── index.css                       # Design system variables & global styles
└── README.md                       # This file
```

## 🚀 Features

### Complete 60-Second Onboarding Flow
1. **Release Type Selection** — Single/EP/Album
2. **Release Date & Title** — Backward-planning from target date
3. **Progress Check-in** — Mark already-completed tasks
4. **Timeline Preview** — AI-generated task timeline with feasibility warnings
5. **Account Creation** — Magic link signup (skipped for logged-in users)

### Technical Capabilities
- ✅ **Supabase Integration** — Full CRUD for releases, tasks, and dependencies
- ✅ **Mobile Responsive** — 768px breakpoint with touch-optimized UI
- ✅ **Logged-in Variant** — Detects auth state, skips signup for dashboard use
- ✅ **AI Feasibility Warnings** — 3 personality variations (invisible/friendly/strategist)
- ✅ **Template Engine** — Industry-standard task templates with dependency graphs
- ✅ **Design System** — CSS variables matching existing Cadence brand

## 🎨 Design System

The onboarding flow uses the Cadence design system defined in `index.css`:

**Colors:**
- Background: `#0f0f13`
- Surface: `#18181c` / `#222227`
- Accent: `#7c6cfc`
- Text: `#f6f4ef` / `#9b9b9f` (muted)

**Typography:**
- Font: Inter
- Mobile-first sizing (smaller on <768px)

**Spacing:**
- Consistent spacing scale (4/8/12/16/24/32/48px)
- Border radius: 6/10/14/18px

## 📊 Data Flow

### 1. User Input Collection
```typescript
releaseType: 'Single' | 'EP' | 'Album'
releaseDate: string (ISO date)
title: string
artist: string (optional)
doneTasks: string[] (template keys)
```

### 2. Task Generation
```typescript
buildReleaseTaskPayload(releaseType, releaseDate, releaseId, userId)
// Returns: { tasks: TaskInsert[], keyOrder: string[] }
```

### 3. Supabase Writes
```sql
-- 1. Insert release
INSERT INTO releases (title, artist, release_date, release_type, user_id)

-- 2. Insert tasks with computed due dates
INSERT INTO tasks (title, description, phase, due_date, ...)

-- 3. Insert task dependencies
INSERT INTO task_dependencies (task_id, depends_on_task_id, lag_days)
```

## 🔧 Integration Guide

### As Standalone Page
```tsx
import OnboardingPage from './pages/OnboardingPage'

// In your router:
<Route path="/onboarding" element={<OnboardingPage />} />
```

### In Dashboard (New Release Button)
```tsx
import OnboardingPage from './pages/OnboardingPage'

function Dashboard() {
  return (
    <div>
      {/* Existing dashboard UI */}
      <button onClick={() => navigate('/releases/new')}>
        + New Release
      </button>
      
      {/* Route that renders OnboardingPage */}
    </div>
  )
}
```

The component automatically detects logged-in users via `useAuth()` and skips Screen 5 (account creation).

## 📱 Mobile Responsiveness

All screens adapt at **768px breakpoint**:
- Smaller typography (24px → 22px headings)
- Reduced padding (32px → 20px)
- Touch-optimized tap targets (min 44px)
- Simplified layouts where needed

## 🔐 Authentication

Uses **Supabase Magic Links**:
```typescript
supabase.auth.signInWithOtp({ email })
```

Users receive an email with a sign-in link. No password required.

## 🗄️ Database Schema

### `releases` table
```sql
- id (uuid, pk)
- user_id (uuid, fk → auth.users)
- title (text)
- artist (text, nullable)
- release_date (date)
- release_type (text: 'Single'|'EP'|'Album')
- created_at (timestamp)
```

### `tasks` table
```sql
- id (uuid, pk)
- release_id (uuid, fk → releases)
- user_id (uuid, fk → auth.users)
- title (text)
- description (text)
- phase (text: 'Pre-Production'|'Production'|...)
- due_date (date)
- due_date_offset (int) -- days before release
- effort_hours (real)
- is_external (bool)
- is_optional (bool)
- template_key (text) -- for dependency wiring
- sort_order (int)
- status (text: 'pending'|'in_progress'|'complete'|'skipped')
```

### `task_dependencies` table
```sql
- id (uuid, pk)
- task_id (uuid, fk → tasks)
- depends_on_task_id (uuid, fk → tasks)
- lag_days (int) -- buffer after dependency completes
```

## 🎯 Next Steps

### Phase 2 Enhancements (Not Yet Implemented)
- [ ] Drag-to-cascade interaction (tasks auto-shift on dependency drag)
- [ ] Contextual refinement (time availability, collaborator buffers)
- [ ] Stalled project nudge modal
- [ ] Subway Map & Gantt Chart visualizations (currently only Vertical Cards)
- [ ] AI personality selection in user settings

### Known Limitations
- Timeline visualization is currently **Vertical Cards only** (Subway/Gantt in prototype but not wired)
- AI personality is hardcoded to `'invisible'` (no user preference yet)
- No actual drag interaction (static preview only)

## 💡 Usage Example

```tsx
// After user completes onboarding:
// 1. Release created in database
// 2. Tasks generated with computed due dates
// 3. Dependencies wired up
// 4. User navigated to /releases/{id}
// 5. Timeline ready for cascade/drag editing
```

## 📦 Dependencies

```json
{
  "react": "^18.3.1",
  "react-router-dom": "^6.x",
  "@supabase/supabase-js": "^2.x"
}
```

## 🤝 Contributing

When modifying the onboarding flow:
1. **Preserve mobile breakpoints** — Always test at 768px
2. **Maintain design system** — Use CSS variables, not hardcoded values
3. **Keep Supabase logic** — Don't remove existing auth/database connections
4. **Update task templates** — Edit `lib/releaseTemplates.ts` for task changes

## 📝 License

Proprietary — Cadence internal project
