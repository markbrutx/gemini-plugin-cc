---
name: gemini-prompting
description: Internal guidance for composing effective Gemini prompts for visual analysis, design review, and coding tasks
user-invocable: false
---

# Gemini Prompting Guide

Gemini excels at two things that Claude does not:
1. **Visual analysis** — screenshots, mockups, UI layouts, design comparison
2. **Design/styling** — color palettes, modern frontend aesthetics, creative UI

## Prompt Structure

Good Gemini prompts follow this pattern:

```
<context>
Brief project context and what the user is working on.
</context>

<task>
Clear, specific instruction. One task per prompt.
</task>

<constraints>
Output format, style guidelines, framework requirements.
</constraints>
```

## Visual Analysis Prompts

When the task involves visual input:
- Describe what the screenshot/mockup shows
- Be specific about what to look for (spacing, color, alignment, hierarchy)
- Ask for structured observations, not free-form descriptions

## Design/Styling Prompts

When the task involves UI aesthetics:
- Reference the existing design system or framework (Tailwind, CSS vars, etc.)
- Ask for specific CSS/component code, not just suggestions
- Include the current state so Gemini can compare

## Anti-Patterns

- Do not dump entire codebases into the prompt — Gemini works best with focused context
- Do not ask Gemini to reason about complex logic — that's Claude's strength
- Do not ask Gemini to write backend/infrastructure code — delegate only visual/design tasks
- Do not include prompts longer than ~4000 words — keep it focused
