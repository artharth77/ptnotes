export type NoteTemplate = {
  id: string
  name: string
  description: string
  icon: string
  builtIn: boolean
  content: (title: string, date: Date) => string
}

function todayISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayLong(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    name: 'Blank Note',
    description: 'Empty note with just a title heading',
    icon: '📝',
    builtIn: true,
    content: (title) => `# ${title}\n\n`
  },
  {
    id: 'meeting',
    name: 'Meeting Notes',
    description: 'Attendees, agenda, decisions & action items',
    icon: '🗓️',
    builtIn: true,
    content: (title, d) => `# ${title}

**Date:** ${todayLong(d)}
**Attendees:** 
**Facilitator:** 
**Notetaker:** 

---

## 🎯 Agenda

1. 

## 📝 Discussion & Notes

### 1. 

- 
- 

## ✅ Decisions Made

| # | Decision | By | Date |
|---|----------|----|------|
| 1 |          |    | ${todayISO(d)} |

## 🎬 Action Items

| # | Task | Owner | Due | Status |
|---|------|-------|-----|--------|
| 1 |      |       |     | ⬜ Open |

## 📌 Next Meeting

- **Date:** 
- **Topics:** 
- **Prep:** 

---

*Created ${todayISO(d)}*
`
  },
  {
    id: 'weekly',
    name: 'Weekly Report',
    description: 'This week&apos;s accomplishments, next week, blockers',
    icon: '📊',
    builtIn: true,
    content: (title, d) => `# ${title}

**Week of:** ${todayLong(d)}
**Team:** 
**Report by:** 

---

## ✅ This Week — Accomplished

- 
- 
- 

### Key Metrics / Wins

- 
- 

## 🚧 In Progress

| Item | Owner | Status | ETA |
|------|-------|--------|-----|
|      |       | 🟡     |     |

## ⏭️ Next Week — Planned

- 
- 

## 🚫 Blockers / Risks

| # | Blocker | Impact | Mitigation |
|---|---------|--------|------------|
| 1 |         |        |            |

## 💡 Questions / Need Input

- [ ] 
- [ ] 

## 📎 Links & References

- 
`
  },
  {
    id: 'retro',
    name: 'Sprint Retrospective',
    description: 'What went well, what to improve, action items',
    icon: '🔁',
    builtIn: true,
    content: (title, d) => `# ${title}

**Sprint:** 
**Date:** ${todayLong(d)}
**Facilitator:** 
**Attendees:** 

---

## 🟢 What Went Well

- 
- 

## 🔴 What Didn't Go Well

- 
- 

## 🟡 Puzzling / Needs Discussion

- 
- 

## 💡 Ideas for Improvement

1. 
2. 

## ✅ Action Items for Next Sprint

| # | Action | Owner | Due |
|---|--------|-------|-----|
| 1 |        |       |     |

## 📈 Confidence Vote

How confident are we the next sprint will go better?
- 1 😞 — 
- 2 🙂 — 
- 3 😄 — 
- 4 🤩 — 

---

*Retro facilitated ${todayISO(d)}*
`
  },
  {
    id: 'research',
    name: 'Research Log',
    description: 'Hypothesis, sources, findings & conclusions',
    icon: '🔬',
    builtIn: true,
    content: (title, d) => `# ${title}

**Date started:** ${todayLong(d)}
**Author:** 
**Status:** 🔍 In progress
**Tags:** 

---

## 🎯 Research Goal

What question are we trying to answer?

## 🧪 Hypothesis

- **H0 (null):** 
- **H1 (expected):** 

## 📚 Sources & References

| # | Source | Type | Relevance | Notes |
|---|--------|------|-----------|-------|
| 1 |        | Web  |           |       |

## 🔎 Findings

### Source 1: 

- 
- 

### Source 2: 

- 
- 

## 📊 Comparison / Analysis

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
|           |          |          |          |

## 🧠 Key Insights

1. 
2. 

## ✅ Conclusion / Recommendation

- **Decision:** 
- **Reasoning:** 
- **Next steps:** 

## ❓ Open Questions

- [ ] 
- [ ] 

---

*Research log started ${todayISO(d)} — last updated ${todayISO(new Date())}*
`
  },
  {
    id: 'daily',
    name: 'Daily Journal',
    description: 'Gratitude, wins, focus, reflection',
    icon: '📔',
    builtIn: true,
    content: (title, d) => `# ${title} — ${todayLong(d)}

---

## 🌞 Morning

### Today's Top 3 Priorities

1. 
2. 
3. 

### Gratitude

- I'm thankful for: 
- One small win yesterday: 
- Something I'm looking forward to: 

### How I'm Feeling

😀 😐 😕 😔 (circle or note)
- Energy: 
- Mood: 
- Health: 

---

## 🌙 Evening

### ✅ What I got done

- 
- 

### 🧠 What I learned

- 
- 

### 💭 Reflection

- Best moment today: 
- Hardest moment today: 
- If I could redo today, I'd: 

### 📌 Tomorrow

1. Priority 1: 
2. Priority 2: 
3. Priority 3: 

---

*${todayISO(d)}*
`
  },
  {
    id: 'project-brief',
    name: 'Project Brief',
    description: 'Goals, scope, stakeholders, timeline, risks',
    icon: '🚀',
    builtIn: true,
    content: (title, d) => `# ${title}

**Created:** ${todayLong(d)}
**Owner:** 
**Sponsor:** 
**Status:** 🟡 Defining

---

## 🎯 Project Goal (1 sentence)

What does success look like?

## 💼 Business Case & Background

- Why now?
- Expected impact / value:
- Alignment with strategy:

## 👥 Stakeholders

| Role | Name | R-A-C-I |
|------|------|---------|
|      |      |         |

## 📥 In Scope

- 
- 

## 📤 Out of Scope (Explicitly)

- 
- 

## 🗓️ Timeline & Milestones

| Milestone | Target Date | Owner |
|-----------|-------------|-------|
| Kickoff   | ${todayISO(d)} |  |
|           |             |       |
| Launch    |             |       |

## 💰 Budget / Resources

- People: 
- Budget: 
- Tools: 

## ⚠️ Risks & Mitigation

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 |      | 🟡         | 🟡     |            |

## ✅ Success Criteria (Measurable)

1. 
2. 
3. 

## 📌 Open Decisions

| # | Decision | Owner | Due |
|---|----------|-------|-----|
| 1 |          |       |     |

---

*Brief v1.0 — drafted ${todayISO(d)}*
`
  }
]

export function getNoteTemplate(id: string): NoteTemplate | undefined {
  return NOTE_TEMPLATES.find((t) => t.id === id) ?? NOTE_TEMPLATES[0]
}
