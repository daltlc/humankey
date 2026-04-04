# humankey — Agent & Engineering Standards

## Documentation Rule

Always update code comments, documentation, README, and config pages whenever a feature is modified or added. No feature change is complete without corresponding documentation updates.

## Engineering Standards

- **DRY**: Do not repeat yourself. Extract shared logic into reusable modules.
- **Modular**: Each file has a single responsibility. Keep modules small and focused.
- **Maintainable**: Code should be readable and self-documenting. Add comments only where the logic isn't self-evident.
- **Tests**: Every feature must have corresponding tests. Write tests alongside implementation, not after.
- **Naming**: Use clear, descriptive names. Functions use camelCase. Types use PascalCase. Constants use UPPER_SNAKE_CASE. Files use kebab-case.
- **Consistency**: Follow existing patterns in the codebase. Match style of adjacent code.
- **Performance**: Prefer efficient algorithms. Avoid unnecessary allocations. Cache expensive computations where usage patterns justify it.
- **Security**: Validate at system boundaries. Never trust client-provided data on the server. Use constant-time comparisons for secrets. Follow OWASP guidelines.
- **Architecture**: Keep the dependency tree shallow. Prefer composition over inheritance. No circular dependencies.

Extra tokens in exchange for stability and maintainable, production-ready code is an acceptable tradeoff.

## Code Quality Checklist (apply on every code generation)

- [ ] Tests cover the new/changed behavior
- [ ] Naming is clear and consistent with the codebase
- [ ] No code duplication — reuse existing utilities
- [ ] Performance considerations addressed
- [ ] Security implications reviewed
- [ ] Documentation updated (comments, README, types)

## Branching Strategy

| Prefix     | Purpose                                  |
|------------|------------------------------------------|
| `feature/` | New features                             |
| `chore/`   | Maintenance, refactoring, dependency updates |
| `fix/`     | Bug fixes                                |

## Pull Request Titles

| Branch Type | PR Title Format            |
|-------------|----------------------------|
| `feature/`  | `[Feature] - Description`  |
| `fix/`      | `[Fix] - Description`      |
| `chore/`    | `[Chore] - Description`    |

## Scope

All improvements should be self-contained to the code and not include infrastructure assumptions, CI/CD, etc. The exception is things that will improve performance (e.g., caching, more efficient data structures) based on analyzed usage patterns.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Build**: tsup (dual ESM/CJS)
- **Test**: vitest
- **Core dependency**: @simplewebauthn/browser (peer), @simplewebauthn/server (direct)
- **Framework adapter**: `humankey/express` — Express.js router with challenge lifecycle, registration, and verification
- **Target runtimes**: Browser (client), Node/Deno/Bun/Edge (verify)
