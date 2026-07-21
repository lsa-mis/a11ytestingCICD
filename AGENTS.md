# AGENTS.md

## Project overview

This repository is a Vite + TypeScript demo that shows how to run Siteimprove Alfa accessibility checks in a GitHub Actions CI/CD pipeline. The primary app is a static, accessible landing page with Playwright-based accessibility tests.

## Working conventions

- Keep the project small, dependency-light, and framework-agnostic unless a change explicitly requires otherwise.
- Prefer standards-based HTML, CSS, TypeScript, and accessibility patterns over custom abstractions.
- Preserve the educational tone of the documentation and examples.
- Do not add generated build artifacts, Playwright reports, screenshots, or dependency directories to commits unless explicitly requested.
- Do not wrap imports in `try`/`catch` blocks.

## Accessibility expectations

- Treat accessibility regressions as blocking defects.
- Maintain keyboard accessibility, visible focus states, semantic HTML, useful labels, and sufficient color contrast.
- When adding pages or routes, add or update Playwright/Alfa coverage so the CI accessibility gate continues to protect user-facing content.
- Keep the gate aligned with WCAG 2.1 A/AA, Alfa Best Practices, and ARIA rules unless the project owner asks for a different target.

## Commands

Use these checks before committing relevant changes:

```bash
npm run typecheck
npm run build
npm test
```

If dependencies are missing, run `npm install` first. If Playwright browsers are missing, run `npx playwright install chromium`.

## GitHub profile and attribution

- Do not add, suggest, or configure GitHub profile text, commit metadata, PR metadata, or repository documentation that presents the work as authored by ChatGPT, Codex, or any other AI assistant.
- Keep GitHub-facing profile or attribution language human-owned and project-focused.
- Do not add AI assistant badges, signatures, co-author trailers, or promotional references to ChatGPT/Codex in commits, pull requests, README content, or profile-related files.
